// @vitest-environment node

import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let storage
let testRoot
let sqlitePath

function sourceIndexFixture() {
  return {
    schemaVersion: 2,
    generatedAt: '2026-08-04T00:00:00.000Z',
    sourceCount: 2,
    schools: [
      {
        school: 'Migration Evidence University',
        officialUrl: 'https://migration.example.edu/',
        collectedAt: '2026-08-04T00:00:00.000Z',
        pages: [{
          url: 'https://migration.example.edu/phd',
          types: ['program'],
          declaredKinds: ['doctoral'],
          fetched: true,
        }],
      },
      {
        school: 'Migration Research University',
        officialUrl: 'https://migration-research.example.edu/',
        collectedAt: '2026-08-03T00:00:00.000Z',
        pages: [{
          url: 'https://migration-research.example.edu/research',
          types: ['research'],
          fetched: true,
        }],
      },
    ],
  }
}

async function addUser(userId, email, settings = {}) {
  await storage.withWriteLock(async () => {
    const store = await storage.readStore()
    const template = structuredClone(store.users.find((user) => user.role === 'user') ?? store.users[0])
    store.users.push({
      ...template,
      id: userId,
      name: `Migration ${userId}`,
      email,
      settings: {
        ...structuredClone(template.settings),
        ...settings,
      },
    })
    await storage.writeStore(store)
  })
}

function readDurableUser(userId) {
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  try {
    return database.prepare(
      'SELECT settings_json, settings_version FROM users WHERE id = ?',
    ).get(userId)
  } finally {
    database.close()
  }
}

function readSourceIndexRow(userId, scope = 'personal') {
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  try {
    return database.prepare(
      `SELECT scope, payload_json, payload_bytes, updated_at
         FROM discover_source_indexes
        WHERE user_id = ? AND scope = ?`,
    ).get(userId, scope)
  } finally {
    database.close()
  }
}

function countSourceIndexRows(userId) {
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  try {
    return Number(database.prepare(
      'SELECT COUNT(*) AS count FROM discover_source_indexes WHERE user_id = ?',
    ).get(userId).count)
  } finally {
    database.close()
  }
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-discover-index-migration-'))
  sqlitePath = path.join(testRoot, 'workspace.sqlite')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'discover-source-index-server-key-32-bytes')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'discover-source-index-settings-key-32-bytes')
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
})

afterAll(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
})

describe.sequential('Discover source-index migration', () => {
  it('moves a legacy settings_json index into dedicated storage and is idempotent', async () => {
    const userId = 'user_legacy_source_index'
    const email = 'legacy-source-index@example.test'
    const legacyIndex = sourceIndexFixture()
    await addUser(userId, email)

    const database = new Database(sqlitePath)
    try {
      const before = JSON.parse(readDurableUser(userId).settings_json)
      before.discoverSourceIndex = legacyIndex
      database.prepare('UPDATE users SET settings_json = ? WHERE id = ?')
        .run(JSON.stringify(before), userId)
    } finally {
      database.close()
    }
    const beforeBytes = Buffer.byteLength(readDurableUser(userId).settings_json, 'utf8')

    await storage.shutdownStorage()
    await storage.ensureStorage()

    const afterRow = readDurableUser(userId)
    const afterSettings = JSON.parse(afterRow.settings_json)
    const tableRow = readSourceIndexRow(userId)
    expect(afterSettings).not.toHaveProperty('discoverSourceIndex')
    expect(Buffer.byteLength(afterRow.settings_json, 'utf8')).toBeLessThan(beforeBytes)
    expect(tableRow.scope).toBe('personal')
    expect(JSON.parse(tableRow.payload_json)).toEqual(legacyIndex)
    expect(Number(tableRow.payload_bytes)).toBe(Buffer.byteLength(tableRow.payload_json, 'utf8'))
    expect(await storage.readDiscoverSourceIndex(userId)).toEqual(legacyIndex)

    await storage.shutdownStorage()
    await storage.ensureStorage()
    expect(countSourceIndexRows(userId)).toBe(1)
    expect(JSON.parse(readSourceIndexRow(userId).payload_json)).toEqual(legacyIndex)
    expect(JSON.parse(readDurableUser(userId).settings_json)).not.toHaveProperty('discoverSourceIndex')
  })

  it('persists source-index writes through writeStore without re-entering settings_json', async () => {
    const userId = 'user_dedicated_source_index'
    const email = 'dedicated-source-index@example.test'
    const index = sourceIndexFixture()
    await addUser(userId, email)

    await storage.withWriteLock(async () => {
      const store = await storage.readStore()
      const user = store.users.find((candidate) => candidate.id === userId)
      user.settings.marker = 'dedicated-index-write'
      await storage.writeStore(store, {
        discoverSourceIndexes: [{
          userId,
          scope: 'team:team_evidence',
          index,
        }],
      })
    })

    const durable = await storage.readStore()
    expect(durable.users.find((candidate) => candidate.id === userId).settings)
      .not.toHaveProperty('discoverSourceIndex')
    expect(await storage.readDiscoverSourceIndex(userId, 'team:team_evidence')).toEqual(index)

    await storage.withWriteLock(async () => {
      const store = await storage.readStore()
      await storage.writeStore(store, {
        discoverSourceIndexes: [{
          userId,
          scope: 'team:team_evidence',
          delete: true,
        }],
      })
    })
    expect(await storage.readDiscoverSourceIndex(userId, 'team:team_evidence')).toBeNull()
  })
})
