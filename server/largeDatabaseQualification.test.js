import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import {
  createBatchedKeysetReader,
  DEFAULT_SCOPED_KEYSET_BATCH_SIZE,
} from './scopedKeysetReader.js'

let sqlitePath
let storage
let testRoot

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function scaleUser(source, id) {
  return {
    ...structuredClone(source),
    id,
    name: id,
    email: `${id}@example.test`,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    disabledAt: null,
    settings: {
      ...structuredClone(source.settings),
      membershipPlan: 'pro',
      personalMembershipPlan: 'pro',
      teamProfileRecommenders: {},
    },
  }
}

function copyApplicationRows(database, { sourceId, ownerId, prefix, count }) {
  const columns = database.prepare('PRAGMA table_info(applications)').all().map((row) => row.name)
  const insertColumns = columns.map(quotedIdentifier).join(', ')
  const selectColumns = columns.map((column) => {
    if (column === 'id') return '@id'
    if (column === 'owner_id') return '@ownerId'
    if (column === 'team_id') return 'NULL'
    if (column === 'deadline') return '@deadline'
    if (column === 'updated_at') return '@updatedAt'
    return `source.${quotedIdentifier(column)}`
  }).join(', ')
  const insert = database.prepare(
    `INSERT INTO applications (${insertColumns})
     SELECT ${selectColumns}
       FROM applications AS source
      WHERE source.id = @sourceId`,
  )
  database.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      insert.run({
        id: `${prefix}_${String(index).padStart(5, '0')}`,
        ownerId,
        deadline: '2030-01-01',
        updatedAt: '2026-08-09T00:00:00.000Z',
        sourceId,
      })
    }
  })()
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-large-database-'))
  sqlitePath = path.join(testRoot, 'workspace.sqlite')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'large-database-test-server-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'large-database-test-settings-key')
})

async function initializeStorage() {
  await fs.rm(testRoot, { recursive: true, force: true })
  await fs.mkdir(testRoot, { recursive: true })
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
}

afterEach(async () => {
  storage?.configureStoreHydrationMemoryAdmission(null)
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  vi.resetModules()
}, 30_000)

afterAll(async () => {
  vi.unstubAllEnvs()
  await fs.rm(testRoot, { recursive: true, force: true })
}, 30_000)

describe.sequential('very-large-database qualification', () => {
  it('bounds keyset query amplification for one hundred thousand metadata rows', () => {
    const totalRows = 100_000
    let batchCalls = 0
    let maxResidentRows = 0
    const next = createBatchedKeysetReader({
      loadBatch: (cursor, batchSize) => {
        batchCalls += 1
        const first = (cursor ?? -1) + 1
        const length = Math.min(batchSize, Math.max(0, totalRows - first))
        const rows = Array.from({ length }, (_, offset) => first + offset)
        maxResidentRows = Math.max(maxResidentRows, rows.length)
        return rows
      },
      cursorFromRow: (row) => row,
    })

    let count = 0
    let last = null
    for (;;) {
      const row = next()
      if (row === null) break
      last = row
      count += 1
    }

    expect(count).toBe(totalRows)
    expect(last).toBe(totalRows - 1)
    expect(maxResidentRows).toBe(DEFAULT_SCOPED_KEYSET_BATCH_SIZE)
    expect(batchCalls).toBeLessThanOrEqual(
      Math.ceil(totalRows / DEFAULT_SCOPED_KEYSET_BATCH_SIZE) + 1,
    )
  })

  it('streams ten thousand owned rows inside a twenty-thousand-row encrypted database', async () => {
    await initializeStorage()
    const setup = await storage.readStore()
    const sourceApplication = setup.applications[0]
    const ownerId = 'large_database_target_owner'
    const noiseOwnerId = 'large_database_noise_owner'
    setup.users.push(
      scaleUser(setup.users[0], ownerId),
      scaleUser(setup.users[0], noiseOwnerId),
    )
    await storage.lockedWriteStore(setup)

    const database = new Database(sqlitePath)
    try {
      database.pragma('busy_timeout = 5000')
      copyApplicationRows(database, {
        sourceId: sourceApplication.id,
        ownerId,
        prefix: 'large_database_target',
        count: 10_000,
      })
      copyApplicationRows(database, {
        sourceId: sourceApplication.id,
        ownerId: noiseOwnerId,
        prefix: 'large_database_noise',
        count: 10_000,
      })
      const plan = database.prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, owner_id, team_id, deadline, updated_at, payload_version
           FROM applications
          WHERE owner_id = ? AND team_id IS NULL
          ORDER BY deadline ASC, id ASC
          LIMIT 128`,
      ).all(ownerId).map((row) => String(row.detail ?? ''))
      expect(plan.join('\n')).toContain('idx_applications_owner_deadline_id')
      expect(plan.join('\n')).not.toContain('USE TEMP B-TREE')
      expect(database.prepare('SELECT COUNT(*) AS count FROM applications').get().count)
        .toBeGreaterThanOrEqual(20_000)
    } finally {
      database.close()
    }

    let activePayloadLeases = 0
    let maximumActivePayloadLeases = 0
    storage.configureStoreHydrationMemoryAdmission(() => {
      activePayloadLeases += 1
      maximumActivePayloadLeases = Math.max(maximumActivePayloadLeases, activePayloadLeases)
      let released = false
      return () => {
        if (released) return
        released = true
        activePayloadLeases -= 1
      }
    })

    let eventLoopTicks = 0
    let maximumLagMs = 0
    let expectedAt = performance.now() + 10
    const interval = setInterval(() => {
      const observedAt = performance.now()
      maximumLagMs = Math.max(maximumLagMs, observedAt - expectedAt)
      expectedAt = observedAt + 10
      eventLoopTicks += 1
    }, 10)
    const startedAt = performance.now()
    try {
      const cursor = await storage.createScopedApplicationSectionCursor({
        userId: ownerId,
        personalOnly: true,
      })
      expect(cursor.count).toBe(10_000)
      let count = 0
      let firstId = null
      let lastId = null
      for await (const application of cursor.values) {
        firstId ??= application.id
        lastId = application.id
        count += 1
      }
      await cursor.validate()
      expect(count).toBe(10_000)
      expect(firstId).toBe('large_database_target_00000')
      expect(lastId).toBe('large_database_target_09999')
    } finally {
      clearInterval(interval)
    }

    expect(performance.now() - startedAt).toBeLessThan(45_000)
    expect(eventLoopTicks).toBeGreaterThan(10)
    expect(maximumLagMs).toBeLessThan(500)
    expect(maximumActivePayloadLeases).toBe(1)
    expect(activePayloadLeases).toBe(0)
  }, 120_000)
})
