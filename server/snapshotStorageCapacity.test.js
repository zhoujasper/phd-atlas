import Database from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SNAPSHOT_DATABASE_MAX_BYTES,
  MIN_SNAPSHOT_DATABASE_MAX_BYTES,
  SQLITE_NORMAL_MAX_PAGE_COUNT,
  applySqliteSnapshotPageLimit,
  assertExternalSnapshotPayloadAdmission,
  assertSnapshotCapacityPlan,
  assertSqliteSealedPayloadAdmission,
  externalEncryptedPayloadMaxBytes,
  normalizeSnapshotDatabaseMaxBytes,
  resolveSnapshotCapacityPlan,
  sqliteSnapshotMetrics,
} from './snapshotStorageCapacity.js'

const databases = []

function createDatabase() {
  const database = new Database(':memory:')
  database.exec('CREATE TABLE payloads (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)')
  databases.push(database)
  return database
}

afterEach(() => {
  while (databases.length) databases.pop().close()
})

describe('whole-database snapshot capacity', () => {
  it('uses a conservative configurable default', () => {
    expect(normalizeSnapshotDatabaseMaxBytes()).toBe(DEFAULT_SNAPSHOT_DATABASE_MAX_BYTES)
    expect(normalizeSnapshotDatabaseMaxBytes('1')).toBe(MIN_SNAPSHOT_DATABASE_MAX_BYTES)
    expect(normalizeSnapshotDatabaseMaxBytes(String(32 * 1024 * 1024))).toBe(32 * 1024 * 1024)
  })

  it('cannot let a configured snapshot cap overrun a 512 MiB runtime budget', () => {
    const memoryBudget = 512 * 1024 * 1024
    const configured128 = resolveSnapshotCapacityPlan({
      mode: 'encrypted-sqlite-whole-snapshot',
      configuredLimitBytes: 128 * 1024 * 1024,
      runtimeMemoryBudgetBytes: memoryBudget,
    })
    const configured256 = resolveSnapshotCapacityPlan({
      mode: 'encrypted-sqlite-whole-snapshot',
      configuredLimitBytes: 256 * 1024 * 1024,
      runtimeMemoryBudgetBytes: memoryBudget,
    })
    const configured1GiB = resolveSnapshotCapacityPlan({
      mode: 'encrypted-sqlite-whole-snapshot',
      configuredLimitBytes: 1024 * 1024 * 1024,
      runtimeMemoryBudgetBytes: memoryBudget,
    })
    const encryptedExternal = resolveSnapshotCapacityPlan({
      mode: 'external-whole-snapshot',
      encrypted: true,
      configuredLimitBytes: 128 * 1024 * 1024,
      runtimeMemoryBudgetBytes: memoryBudget,
    })

    expect(configured128).toMatchObject({
      configuredLimitBytes: 128 * 1024 * 1024,
      effectiveLimitBytes: 128 * 1024 * 1024,
      memoryConstrained: false,
    })
    expect(configured128.requiredMemoryBytes).toBeLessThanOrEqual(configured128.safeMemoryBytes)
    for (const constrained of [configured256, configured1GiB, encryptedExternal]) {
      expect(constrained.memoryConstrained).toBe(true)
      expect(constrained.effectiveLimitBytes).toBeLessThan(constrained.configuredLimitBytes)
      expect(constrained.effectiveRequiredMemoryBytes).toBeLessThanOrEqual(constrained.safeMemoryBytes)
      expect(constrained.requiredMemoryBytes).toBeGreaterThan(constrained.safeMemoryBytes)
    }
    expect(configured256.effectiveLimitBytes).toBe(configured1GiB.effectiveLimitBytes)
    expect(encryptedExternal.effectiveLimitBytes).toBeLessThan(40 * 1024 * 1024)
  })

  it('refuses a snapshot mode when even the minimum image cannot fit safely', () => {
    const plan = resolveSnapshotCapacityPlan({
      mode: 'external-whole-snapshot',
      encrypted: true,
      configuredLimitBytes: 128 * 1024 * 1024,
      runtimeMemoryBudgetBytes: 128 * 1024 * 1024,
    })
    expect(plan).toMatchObject({ supported: false, memoryConstrained: true })
    expect(() => assertSnapshotCapacityPlan(plan)).toThrowError(expect.objectContaining({
      code: 'DATABASE_SNAPSHOT_MEMORY_BUDGET_TOO_LOW',
      status: 503,
    }))
  })

  it('rejects a 1 GiB-configured image at the 512 MiB effective boundary before serialization', () => {
    const pageSize = 4096
    const plan = resolveSnapshotCapacityPlan({
      mode: 'encrypted-sqlite-whole-snapshot',
      configuredLimitBytes: 1024 * 1024 * 1024,
      runtimeMemoryBudgetBytes: 512 * 1024 * 1024,
    })
    const requestedBytes = plan.effectiveLimitBytes + pageSize
    const fakeDatabase = {
      pragma(statement) {
        if (statement === 'page_count') return Math.ceil(requestedBytes / pageSize)
        if (statement === 'page_size') return pageSize
        throw new Error(`Unexpected pragma after failed pre-admission: ${statement}`)
      },
    }

    expect(plan).toMatchObject({
      configuredLimitBytes: 1024 * 1024 * 1024,
      memoryConstrained: true,
      supported: true,
    })
    expect(() => applySqliteSnapshotPageLimit(fakeDatabase, {
      enabled: true,
      mode: plan.mode,
      limitBytes: plan.effectiveLimitBytes,
    })).toThrowError(expect.objectContaining({
      code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED',
      status: 413,
      requestedBytes: null,
    }))
  })

  it('accepts a workspace below the limit and rejects enabling above it', () => {
    const database = createDatabase()
    const accepted = applySqliteSnapshotPageLimit(database, {
      enabled: true,
      mode: 'encrypted-sqlite-whole-snapshot',
      limitBytes: MIN_SNAPSHOT_DATABASE_MAX_BYTES,
    })
    expect(accepted.enabled).toBe(true)
    expect(accepted.currentBytes).toBeLessThan(accepted.limitBytes)

    applySqliteSnapshotPageLimit(database, { enabled: false })
    database.prepare('INSERT INTO payloads (payload) VALUES (zeroblob(?))')
      .run(MIN_SNAPSHOT_DATABASE_MAX_BYTES + (1024 * 1024))
    expect(() => applySqliteSnapshotPageLimit(database, {
      enabled: true,
      mode: 'external-whole-snapshot',
      limitBytes: MIN_SNAPSHOT_DATABASE_MAX_BYTES,
    })).toThrowError(expect.objectContaining({
      code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED',
      status: 413,
    }))
  })

  it('rolls a crossing transaction back atomically and removes the page cap in plain mode', () => {
    const database = createDatabase()
    const capacity = applySqliteSnapshotPageLimit(database, {
      enabled: true,
      mode: 'encrypted-sqlite-whole-snapshot',
      limitBytes: MIN_SNAPSHOT_DATABASE_MAX_BYTES,
    })
    const crossingWrite = database.transaction(() => {
      database.prepare('INSERT INTO payloads (payload) VALUES (zeroblob(?))')
        .run(MIN_SNAPSHOT_DATABASE_MAX_BYTES + (1024 * 1024))
    })

    expect(crossingWrite).toThrowError(expect.objectContaining({ code: 'SQLITE_FULL' }))
    expect(database.prepare('SELECT COUNT(*) AS count FROM payloads').get().count).toBe(0)
    expect(sqliteSnapshotMetrics(database).currentBytes).toBeLessThanOrEqual(capacity.limitBytes)

    const plain = applySqliteSnapshotPageLimit(database, {
      enabled: false,
      mode: 'plain-local-sqlite',
    })
    expect(plain.maxPageCount).toBeGreaterThan(capacity.maxPageCount)
    expect(plain.maxPageCount).toBeLessThanOrEqual(SQLITE_NORMAL_MAX_PAGE_COUNT)
    crossingWrite()
    expect(database.prepare('SELECT COUNT(*) AS count FROM payloads').get().count).toBe(1)
    expect(sqliteSnapshotMetrics(database).currentBytes).toBeGreaterThan(capacity.limitBytes)
  })

  it('keeps a 94 MiB plain local SQLite workspace outside the snapshot cap', () => {
    const database = createDatabase()
    const plain = applySqliteSnapshotPageLimit(database, {
      enabled: false,
      mode: 'plain-local-sqlite',
    })
    database.prepare('INSERT INTO payloads (payload) VALUES (zeroblob(?))')
      .run(94 * 1024 * 1024)

    const metrics = sqliteSnapshotMetrics(database)
    expect(plain).toMatchObject({
      enabled: false,
      limitBytes: null,
      maxPageCount: SQLITE_NORMAL_MAX_PAGE_COUNT,
    })
    expect(metrics.currentBytes).toBeGreaterThan(94 * 1024 * 1024)
    expect(database.prepare('SELECT length(payload) AS bytes FROM payloads').get().bytes)
      .toBe(94 * 1024 * 1024)
  })

  it('rejects oversized remote payload metadata before a BLOB admission callback can fetch it', () => {
    const magic = Buffer.from('PHDSTATE1\n')
    const databaseLimitBytes = MIN_SNAPSHOT_DATABASE_MAX_BYTES
    const encryptedLimit = externalEncryptedPayloadMaxBytes(databaseLimitBytes)

    expect(() => assertExternalSnapshotPayloadAdmission({
      payloadBytes: databaseLimitBytes + 1,
      payloadPrefix: Buffer.from('SQLite format 3\0'),
      encryptedMagic: magic,
      databaseLimitBytes,
    })).toThrowError(expect.objectContaining({ code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED' }))
    expect(assertExternalSnapshotPayloadAdmission({
      payloadBytes: encryptedLimit,
      payloadPrefix: magic,
      encryptedMagic: magic,
      databaseLimitBytes,
    })).toMatchObject({ encrypted: true, limitBytes: encryptedLimit })
    expect(() => assertExternalSnapshotPayloadAdmission({
      payloadBytes: encryptedLimit + 1,
      payloadPrefix: magic,
      encryptedMagic: magic,
      databaseLimitBytes,
    })).toThrowError(expect.objectContaining({ code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED' }))
  })

  it('rejects an oversized sealed SQLite file from metadata alone', () => {
    expect(() => assertSqliteSealedPayloadAdmission(
      MIN_SNAPSHOT_DATABASE_MAX_BYTES + (8 * 1024),
      MIN_SNAPSHOT_DATABASE_MAX_BYTES,
    )).toThrowError(expect.objectContaining({ code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED' }))
  })
})
