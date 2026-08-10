import os from 'node:os'
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDatabaseRevisionConflictError,
  createDatabaseTargetNotEmptyError,
  createExternalDatabaseOpener,
  createExternalDatabaseSqlDump,
  decryptDatabasePassword,
  defaultSqlitePath,
  encryptDatabasePassword,
  MAX_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS,
  MIN_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS,
  normalizeDatabaseConfiguration,
  normalizeExternalDatabaseQueryTimeoutMs,
  resolveSetupDatabaseNetworkTarget,
  verifyDatabaseConnection,
} from './databaseConnection.js'
import { encryptSecret, setRuntimeCryptoConfig } from './crypto.js'

const externalConfig = (type) => ({
  type,
  host: 'db.example.test',
  database: 'phd_atlas',
  username: 'atlas',
  password: 'secret',
})

function storedRow(payload, revision, updatedAt) {
  return {
    state_blob: Buffer.from(payload),
    revision,
    updated_at: updatedAt,
  }
}

function createMysqlHarness() {
  const harness = { current: null, sql: [], queryTimeouts: [] }
  const query = async (statement, parameters = []) => {
    if (typeof statement === 'object') {
      harness.queryTimeouts.push(statement.timeout)
      statement = statement.sql
    }
    harness.sql.push(statement)
    if (statement.includes('SELECT VERSION()')) return [[{ version: '8.0.36' }]]
    if (statement.includes('CREATE TABLE')) return [{ affectedRows: 0 }]
    if (statement.includes('ON DUPLICATE KEY UPDATE')) {
      const [, payload, revision, updatedAt] = parameters
      await harness.beforeGuardedWrite?.(revision)
      let affectedRows = 0
      if (!harness.current) {
        harness.current = storedRow(payload, revision, updatedAt)
        affectedRows = 1
      } else if (revision > harness.current.revision) {
        harness.current = storedRow(payload, revision, updatedAt)
        affectedRows = 2
      }
      return [{ affectedRows }]
    }
    if (statement.includes('SELECT state_blob, revision') && statement.includes('FOR UPDATE')) {
      return [[harness.current].filter(Boolean)]
    }
    if (statement.includes('OCTET_LENGTH(state_blob)')) {
      const row = harness.current
      return [[row && {
        payload_bytes: row.state_blob.length,
        payload_prefix: row.state_blob.subarray(0, 16),
        revision: row.revision,
        updated_at: row.updated_at,
      }].filter(Boolean)]
    }
    if (statement.includes('SELECT state_blob, revision, updated_at')) {
      return [[harness.current].filter(Boolean)]
    }
    if (statement.includes('INSERT INTO')) {
      if (harness.current) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY', errno: 1062 })
      const [, payload, revision, updatedAt] = parameters
      harness.current = storedRow(payload, revision, updatedAt)
      return [{ affectedRows: 1 }]
    }
    throw new Error(`Unexpected MySQL test query: ${statement}`)
  }
  const transaction = {
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
    query,
  }
  return {
    harness,
    loaders: {
      mysql: async () => ({
        createPool: (configuration) => {
          harness.configuration = configuration
          return {
            query,
            getConnection: async () => transaction,
            end: async () => undefined,
          }
        },
      }),
    },
  }
}

function createPostgresHarness() {
  const harness = { current: null, sql: [] }
  class Client {
    constructor(configuration) {
      harness.configuration = configuration
    }

    async connect() {}
    async end() {}

    async query(statement, parameters = []) {
      harness.sql.push(statement)
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rowCount: null, rows: [] }
      if (statement.includes('CREATE SCHEMA') || statement.includes('CREATE TABLE')) return { rowCount: null, rows: [] }
      if (statement.includes('ON CONFLICT (id) DO NOTHING')) {
        if (harness.current) return { rowCount: 0, rows: [] }
        const [, payload, revision, updatedAt] = parameters
        harness.current = storedRow(payload, revision, updatedAt)
        return { rowCount: 1, rows: [{ id: 'primary' }] }
      }
      if (statement.includes('ON CONFLICT (id) DO UPDATE')) {
        const [, payload, revision, updatedAt] = parameters
        await harness.beforeGuardedWrite?.(revision)
        if (!harness.current || revision > harness.current.revision) {
          harness.current = storedRow(payload, revision, updatedAt)
          return { rowCount: 1, rows: [harness.current] }
        }
        return { rowCount: 0, rows: [] }
      }
      if (statement.includes('SELECT state_blob, revision') && statement.includes('FOR UPDATE')) {
        return { rowCount: harness.current ? 1 : 0, rows: [harness.current].filter(Boolean) }
      }
      if (statement.includes('octet_length(state_blob)')) {
        const row = harness.current
        return {
          rowCount: row ? 1 : 0,
          rows: [row && {
            payload_bytes: row.state_blob.length,
            payload_prefix: row.state_blob.subarray(0, 16),
            revision: row.revision,
            updated_at: row.updated_at,
          }].filter(Boolean),
        }
      }
      if (statement.includes('SELECT state_blob, revision, updated_at')) {
        return { rowCount: harness.current ? 1 : 0, rows: [harness.current].filter(Boolean) }
      }
      throw new Error(`Unexpected PostgreSQL test query: ${statement}`)
    }
  }
  return {
    harness,
    loaders: { postgresql: async () => ({ Client }) },
  }
}

function createMssqlHarness() {
  const harness = { current: null, sql: [] }
  class Request {
    constructor() {
      this.parameters = {}
    }

    input(name, _type, value) {
      this.parameters[name] = value
      return this
    }

    async query(statement) {
      harness.sql.push(statement)
      if (statement.includes('CREATE SCHEMA') || statement.includes('CREATE TABLE')) {
        return { recordset: [], rowsAffected: [0] }
      }
      if (statement.includes('WHERE NOT EXISTS')) {
        if (harness.current) return { recordset: [], rowsAffected: [0] }
        harness.current = storedRow(
          this.parameters.stateBlob,
          this.parameters.revision,
          this.parameters.updatedAt,
        )
        return { recordset: [], rowsAffected: [1] }
      }
      if (statement.includes('DECLARE @outcome')) {
        const payload = this.parameters.stateBlob
        const revision = this.parameters.revision
        const updatedAt = this.parameters.updatedAt
        await harness.beforeGuardedWrite?.(revision)
        let outcome = 'written'
        let affectedRows = 1
        if (!harness.current || revision > harness.current.revision) {
          harness.current = storedRow(payload, revision, updatedAt)
        } else {
          affectedRows = 0
          outcome = revision < harness.current.revision
            ? 'stale'
            : harness.current.state_blob.equals(Buffer.from(payload))
              ? 'idempotent'
              : 'conflict'
        }
        return { recordset: [{ outcome, affected_rows: affectedRows }], rowsAffected: [] }
      }
      if (statement.includes('DATALENGTH(state_blob)')) {
        const row = harness.current
        return {
          recordset: [row && {
            payload_bytes: row.state_blob.length,
            payload_prefix: row.state_blob.subarray(0, 16),
            revision: row.revision,
            updated_at: row.updated_at,
          }].filter(Boolean),
          rowsAffected: [],
        }
      }
      if (statement.includes('SELECT state_blob, revision, updated_at')) {
        return { recordset: [harness.current].filter(Boolean), rowsAffected: [] }
      }
      throw new Error(`Unexpected Microsoft SQL Server test query: ${statement}`)
    }
  }
  class ConnectionPool {
    constructor(configuration) {
      harness.configuration = configuration
    }

    async connect() {
      return this
    }

    request() {
      return new Request()
    }

    async close() {}
  }
  const sql = {
    BigInt: 'BigInt',
    MAX: 'MAX',
    ConnectionPool,
    NVarChar: (size) => `NVarChar(${size})`,
    VarBinary: (size) => `VarBinary(${size})`,
  }
  return {
    harness,
    loaders: { mssql: async () => ({ default: sql }) },
  }
}

function createDriverHarness(type) {
  if (type === 'mysql') return createMysqlHarness()
  if (type === 'postgresql') return createPostgresHarness()
  return createMssqlHarness()
}

describe('database connection configuration', () => {
  it('creates the isolated test database parent in a clean export', async () => {
    const directory = await stat(path.dirname(defaultSqlitePath))
    expect(directory.isDirectory()).toBe(true)
  })

  it('keeps bootstrap database credentials readable across workspace crypto profile changes', () => {
    setRuntimeCryptoConfig({ algorithm: 'chacha20-poly1305', passwordBinding: 'workspace-binding-a' })
    const encrypted = encryptDatabasePassword('database-secret')

    setRuntimeCryptoConfig({ algorithm: 'aes-256-gcm', passwordBinding: 'workspace-binding-b' })
    expect(decryptDatabasePassword(encrypted, { allowLegacyRuntime: false })).toBe('database-secret')
    setRuntimeCryptoConfig({})
  })

  it('can still read a legacy runtime-bound password while that profile is active', () => {
    setRuntimeCryptoConfig({ algorithm: 'aes-256-gcm', passwordBinding: 'legacy-binding' })
    const encrypted = encryptSecret('legacy-secret')
    expect(decryptDatabasePassword(encrypted)).toBe('legacy-secret')
    setRuntimeCryptoConfig({})
  })

  it('accepts an administrator-selected SQLite file location', async () => {
    const sqlitePath = path.join(os.tmpdir(), `phd-atlas-${Date.now()}.sqlite`)
    const configuration = await verifyDatabaseConnection({ type: 'sqlite', sqlitePath })

    expect(configuration).toMatchObject({
      configured: true,
      type: 'sqlite',
      sqlitePath,
      passwordSet: false,
    })
  })

  it('confines first-run SQLite targets to the real storage root', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-setup-db-'))
    const storageRoot = path.join(testRoot, 'storage')
    const insidePath = path.join(storageRoot, 'nested', 'workspace.sqlite')
    const outsidePath = path.join(testRoot, 'outside.sqlite')
    try {
      await expect(verifyDatabaseConnection(
        { type: 'sqlite', sqlitePath: insidePath },
        { setupSafety: true, storageRoot },
      )).resolves.toMatchObject({ sqlitePath: insidePath })
      await expect(verifyDatabaseConnection(
        { type: 'sqlite', sqlitePath: outsidePath },
        { setupSafety: true, storageRoot },
      )).rejects.toMatchObject({
        code: 'DATABASE_PATH_OUTSIDE_STORAGE_ROOT',
        field: 'sqlitePath',
      })
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('rejects a first-run SQLite path whose existing symlink escapes storage', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-setup-link-'))
    const storageRoot = path.join(testRoot, 'storage')
    const outsideRoot = path.join(testRoot, 'outside')
    const linkPath = path.join(storageRoot, 'linked')
    await mkdir(storageRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    try {
      await symlink(outsideRoot, linkPath, 'junction')
      await expect(verifyDatabaseConnection(
        { type: 'sqlite', sqlitePath: path.join(linkPath, 'workspace.sqlite') },
        { setupSafety: true, storageRoot },
      )).rejects.toMatchObject({ code: 'DATABASE_PATH_OUTSIDE_STORAGE_ROOT' })
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('rejects private and mixed-DNS first-run database targets unless exactly allowlisted', async () => {
    await expect(resolveSetupDatabaseNetworkTarget({
      ...externalConfig('postgresql'),
      host: '169.254.169.254',
    })).rejects.toMatchObject({ code: 'DATABASE_HOST_NOT_ALLOWED', field: 'host' })

    const mixedLookup = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.20.30.40', family: 4 },
    ]
    await expect(resolveSetupDatabaseNetworkTarget({
      ...externalConfig('postgresql'),
      host: 'db.example.test',
    }, { lookup: mixedLookup })).rejects.toMatchObject({ code: 'DATABASE_HOST_NOT_ALLOWED' })

    await expect(resolveSetupDatabaseNetworkTarget({
      ...externalConfig('postgresql'),
      host: 'db.internal.example',
    }, {
      privateHostAllowlist: 'db.internal.example',
      lookup: async () => [{ address: '10.20.30.40', family: 4 }],
    })).resolves.toMatchObject({
      address: '10.20.30.40',
      host: 'db.internal.example',
      pinned: true,
    })
  })

  it.each(['mysql', 'postgresql', 'mssql'])('pins %s setup sockets and preserves the TLS server name', async (type) => {
    const { harness, loaders } = createDriverHarness(type)
    const connection = await createExternalDatabaseOpener(loaders)({ ...externalConfig(type), ssl: true }, {
      target: {
        address: '8.8.8.8',
        family: 4,
        host: 'db.example.test',
        servername: 'db.example.test',
        pinned: true,
      },
    })

    if (type === 'mysql') {
      expect(harness.configuration.host).toBe('db.example.test')
      expect(harness.configuration.stream).toBeTypeOf('function')
    } else if (type === 'postgresql') {
      expect(harness.configuration).toMatchObject({
        host: '8.8.8.8',
        ssl: { servername: 'db.example.test' },
      })
    } else {
      expect(harness.configuration).toMatchObject({
        server: '8.8.8.8',
        options: { serverName: 'db.example.test' },
      })
      await expect(harness.configuration.options.connector(
        { host: '169.254.169.254', port: 1433 },
        undefined,
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'DATABASE_HOST_NOT_ALLOWED' })
    }
    await connection.close()
  })

  it('validates the common external database connection shapes', () => {
    const common = { host: 'db.example.test', database: 'phd_atlas', username: 'atlas', password: 'secret' }

    expect(normalizeDatabaseConfiguration({ type: 'mysql', ...common })).toMatchObject({ type: 'mysql', port: 3306, schema: 'dbo', mysql57Compatibility: false })
    expect(normalizeDatabaseConfiguration({ type: 'mysql', ...common, mysql57Compatibility: true })).toMatchObject({ type: 'mysql', mysql57Compatibility: true })
    expect(normalizeDatabaseConfiguration({ type: 'postgresql', ...common })).toMatchObject({ type: 'postgresql', port: 5432, schema: 'public' })
    expect(normalizeDatabaseConfiguration({ type: 'mssql', ...common })).toMatchObject({ type: 'mssql', port: 1433, schema: 'dbo' })
    expect(() => normalizeDatabaseConfiguration({ type: 'mysql', ...common, port: 0 })).toThrow(/port/i)
  })

  it('builds engine-native, credential-free SQL recovery scripts', () => {
    const state = {
      payload: Buffer.from('SQLite format 3\u0000test-state'),
      revision: 7,
      updatedAt: '2026-07-21T12:00:00.000Z',
    }
    const common = { host: 'db.example.test', database: 'phd_atlas', username: 'atlas', password: 'do-not-export' }

    const mysql = createExternalDatabaseSqlDump({ type: 'mysql', ...common, mysql57Compatibility: true }, state)
    const postgresql = createExternalDatabaseSqlDump({ type: 'postgresql', ...common }, state)
    const mssql = createExternalDatabaseSqlDump({ type: 'mssql', ...common }, state)

    expect(mysql).toContain('FROM_BASE64')
    expect(mysql).toContain('MySQL 5.7.44-compatible')
    expect(postgresql).toContain("decode('")
    expect(mssql).toContain('MERGE')
    for (const dump of [mysql, postgresql, mssql]) {
      expect(dump).not.toContain(common.password)
      expect(dump).toContain('phd_atlas_state')
    }
  })

  it('uses a stable conflict response when initial setup targets an existing workspace', () => {
    const error = createDatabaseTargetNotEmptyError()
    expect(error).toMatchObject({
      code: 'DATABASE_TARGET_NOT_EMPTY',
      status: 409,
      field: 'database',
    })
    expect(error.message).toMatch(/already contains a PhD Atlas workspace/i)
  })

  it('uses a stable conflict response for divergent content at one revision', () => {
    const error = createDatabaseRevisionConflictError(42)
    expect(error).toMatchObject({
      code: 'DATABASE_REVISION_CONFLICT',
      status: 409,
      field: 'database',
    })
    expect(error.message).toMatch(/revision 42/i)
  })

  it('defaults and clamps the external database deadline to a safe range', () => {
    expect(normalizeExternalDatabaseQueryTimeoutMs('')).toBe(20_000)
    expect(normalizeExternalDatabaseQueryTimeoutMs('invalid')).toBe(20_000)
    expect(normalizeExternalDatabaseQueryTimeoutMs('1')).toBe(MIN_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS)
    expect(normalizeExternalDatabaseQueryTimeoutMs('999999')).toBe(MAX_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS)
    expect(normalizeExternalDatabaseQueryTimeoutMs('12345')).toBe(12_345)
  })
})

describe.each(['mysql', 'postgresql', 'mssql'])('%s guarded external workspace writes', (type) => {
  it('runs metadata admission before fetching the workspace BLOB', async () => {
    const { harness, loaders } = createDriverHarness(type)
    const connection = await createExternalDatabaseOpener(loaders)(externalConfig(type))
    const payload = Buffer.from('PHDSTATE1\nremote-workspace')
    harness.current = storedRow(payload, 7, '2026-08-02T12:00:00.000Z')
    const rejection = Object.assign(new Error('snapshot is too large'), {
      code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED',
      status: 413,
    })
    let admission = null

    await expect(connection.read({
      acquirePayloadMemory(payloadBytes, metadata) {
        admission = { payloadBytes, metadata }
        throw rejection
      },
    })).rejects.toBe(rejection)

    expect(admission).toMatchObject({
      payloadBytes: payload.length,
      metadata: {
        payloadPrefix: payload.subarray(0, 16),
        revision: 7,
      },
    })
    expect(harness.sql.some((statement) => (
      statement.includes('SELECT state_blob, revision, updated_at')
    ))).toBe(false)
    await connection.close()
  })

  it('maps the bounded deadline to the native driver and enforces a hard query cutoff', async () => {
    const { harness, loaders } = createDriverHarness(type)
    const open = createExternalDatabaseOpener(loaders, { queryTimeoutMs: 1_234 })
    const connection = await open(externalConfig(type))
    await connection.ensure()

    if (type === 'mysql') {
      expect(harness.configuration.connectTimeout).toBe(1_234)
      expect(harness.queryTimeouts.length).toBeGreaterThan(0)
      expect(harness.queryTimeouts.every((timeout) => timeout > 0 && timeout <= 1_234)).toBe(true)
    } else if (type === 'postgresql') {
      expect(harness.configuration).toMatchObject({
        connectionTimeoutMillis: 1_234,
        statement_timeout: 1_234,
        query_timeout: 1_234,
      })
    } else {
      expect(harness.configuration).toMatchObject({
        connectionTimeout: 1_234,
        requestTimeout: 1_234,
      })
    }

    harness.beforeGuardedWrite = () => new Promise(() => undefined)
    const timedOpen = createExternalDatabaseOpener(loaders, { queryTimeoutMs: 1_000 })
    const timedConnection = await timedOpen(externalConfig(type))
    await expect(
      timedConnection.write(Buffer.from('timeout'), 1, '2026-08-02T12:00:00.000Z'),
    ).rejects.toMatchObject({ code: 'DATABASE_QUERY_TIMEOUT', status: 504 })
    await timedConnection.close().catch(() => undefined)
    await connection.close().catch(() => undefined)
  })

  it('cannot let an older completion replace a newer revision and detects divergent peers', async () => {
    const { harness, loaders } = createDriverHarness(type)
    const open = createExternalDatabaseOpener(loaders)
    const connection = await open(externalConfig(type))
    const lateConnection = await open(externalConfig(type))
    const newer = Buffer.from('workspace-revision-12')
    let releaseLateWrite
    let markLateWriteStarted
    const lateWriteStarted = new Promise((resolve) => { markLateWriteStarted = resolve })
    const lateWriteRelease = new Promise((resolve) => { releaseLateWrite = resolve })
    harness.beforeGuardedWrite = async (revision) => {
      if (revision !== 11) return
      markLateWriteStarted()
      await lateWriteRelease
    }

    const lateWrite = lateConnection.write(
      Buffer.from('late-revision-11'),
      11,
      '2026-08-02T12:00:01.000Z',
    )
    await lateWriteStarted
    await connection.write(newer, 12, '2026-08-02T12:00:00.000Z')
    releaseLateWrite()
    await expect(lateWrite).resolves.toEqual({ outcome: 'stale' })
    expect(harness.current).toMatchObject({ revision: 12 })
    expect(harness.current.state_blob.equals(newer)).toBe(true)

    await expect(connection.write(newer, 12, '2026-08-02T12:00:02.000Z')).resolves.toBeUndefined()
    await expect(
      connection.write(Buffer.from('divergent-revision-12'), 12, '2026-08-02T12:00:03.000Z'),
    ).rejects.toMatchObject({ code: 'DATABASE_REVISION_CONFLICT', status: 409 })
    expect(harness.current.state_blob.equals(newer)).toBe(true)

    await connection.write(Buffer.from('workspace-revision-13'), 13, '2026-08-02T12:00:04.000Z')
    expect(harness.current).toMatchObject({ revision: 13 })
    await lateConnection.close()
    await connection.close()
  })

  it('keeps overwrite=false as an insert-only empty-target operation', async () => {
    const { harness, loaders } = createDriverHarness(type)
    const connection = await createExternalDatabaseOpener(loaders)(externalConfig(type))

    await expect(
      connection.write(Buffer.from('initial'), 1, '2026-08-02T12:00:00.000Z', { overwrite: false }),
    ).resolves.toBeUndefined()
    await expect(
      connection.write(Buffer.from('replacement'), 2, '2026-08-02T12:00:01.000Z', { overwrite: false }),
    ).rejects.toMatchObject({ code: 'DATABASE_TARGET_NOT_EMPTY', status: 409 })
    expect(harness.current.state_blob.equals(Buffer.from('initial'))).toBe(true)
    await connection.close()
  })

  it('uses an engine-native conditional write shape instead of an unconditional upsert', async () => {
    const { harness, loaders } = createDriverHarness(type)
    const connection = await createExternalDatabaseOpener(loaders)(externalConfig(type))
    await connection.write(Buffer.from('shape'), 3, '2026-08-02T12:00:00.000Z')

    const sql = harness.sql.join('\n')
    if (type === 'mysql') {
      expect(sql).toContain('IF(VALUES(revision) > revision')
      expect(sql).toContain('GREATEST(revision, VALUES(revision))')
      expect(sql).toContain('FOR UPDATE')
    } else if (type === 'postgresql') {
      expect(sql).toMatch(/WHERE\s+"public"\."phd_atlas_state"\.revision < EXCLUDED\.revision/)
      expect(sql).toContain('RETURNING state_blob, revision')
      expect(sql).toContain('BEGIN')
    } else {
      expect(sql).toContain('BEGIN TRANSACTION')
      expect(sql).toContain('WITH (UPDLOCK, HOLDLOCK)')
      expect(sql).toContain('WHERE id = @id AND revision < @revision')
      expect(sql).not.toContain('MERGE')
    }
    await connection.close()
  })
})
