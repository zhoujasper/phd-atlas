import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdirSync, promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decryptSecret,
  decryptSecretWithProfile,
  encryptSecretWithProfile,
} from './crypto.js'
import { resolvePinnedNetworkTarget } from './outboundNetworkPolicy.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function defaultTestStorageRoot() {
  const worker = String(process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID || process.pid)
    .replace(/[^a-z0-9_-]/gi, '_')
    .slice(0, 48)
  // Windows may recycle a worker PID during one large Vitest run. A
  // per-module nonce prevents a later worker from reopening the earlier
  // process's SQLite/WAL files when that happens.
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12)
  const testRoot = path.join(projectRoot, 'logs', 'tmp')
  // Clean public exports intentionally omit ignored runtime directories.
  // Create this test-only parent before better-sqlite3 opens the database.
  mkdirSync(testRoot, { recursive: true })
  const runtimeRoot = path.join(testRoot, `phd-atlas-vitest-${process.pid}-${worker}-${nonce}`)
  mkdirSync(runtimeRoot, { recursive: true })
  return runtimeRoot
}

export const runtimeStorageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
  ? path.resolve(process.env.PHD_ATLAS_STORAGE_ROOT)
  : process.env.NODE_ENV === 'test'
    ? defaultTestStorageRoot()
    : path.join(projectRoot, 'storage')

// Allows an isolated local verification server to use a copied workspace
// database without competing with the normal development service. Production
// defaults remain unchanged when the variable is absent.
export const defaultSqlitePath = process.env.PHD_ATLAS_SQLITE_PATH
  ? path.resolve(process.env.PHD_ATLAS_SQLITE_PATH)
  : path.join(runtimeStorageRoot, 'phd-atlas.sqlite')
export const databaseConfigPath = path.join(runtimeStorageRoot, 'database-connection.json')
export const databaseStateId = 'primary'
const DATABASE_PASSWORD_ENCRYPTION = 'server-key-v1'
const DATABASE_PASSWORD_PROFILE = Object.freeze({
  algorithm: 'aes-256-gcm',
  passwordBinding: '',
})

const EXTERNAL_ENGINES = new Set(['mysql', 'postgresql', 'mssql'])
const SUPPORTED_ENGINES = new Set(['sqlite', ...EXTERNAL_ENGINES])
const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/
export const DEFAULT_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS = 20_000
export const MIN_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS = 1_000
export const MAX_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS = 60_000

function databaseError(code, message, field) {
  const error = new Error(message)
  error.code = code
  error.status = code === 'DATABASE_AUTH_FAILED'
    ? 422
    : code === 'DATABASE_QUERY_TIMEOUT'
      ? 504
      : code === 'DATABASE_TARGET_NOT_EMPTY' || code === 'DATABASE_REVISION_CONFLICT'
      ? 409
      : 400
  if (field) error.field = field
  return error
}

export function normalizeExternalDatabaseQueryTimeoutMs(
  value = process.env.PHD_ATLAS_EXTERNAL_DB_QUERY_TIMEOUT_MS,
) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS
  }
  const timeout = Number(value)
  if (!Number.isFinite(timeout)) return DEFAULT_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS
  return Math.min(
    MAX_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS,
    Math.max(MIN_EXTERNAL_DATABASE_QUERY_TIMEOUT_MS, Math.trunc(timeout)),
  )
}

function databaseQueryTimeoutError(timeoutMs, operation) {
  return databaseError(
    'DATABASE_QUERY_TIMEOUT',
    `External database ${operation} exceeded the ${timeoutMs} ms deadline.`,
  )
}

function createOperationDeadline(timeoutMs) {
  const startedAt = Date.now()
  const remaining = () => Math.max(1, timeoutMs - (Date.now() - startedAt))
  const run = async (operation, label = 'operation') => {
    const waitMs = remaining()
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(databaseQueryTimeoutError(timeoutMs, label)), waitMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  return { remaining, run }
}

async function closeFailedExternalConnection(operation, timeoutMs) {
  const cleanupDeadline = createOperationDeadline(Math.min(1_000, timeoutMs))
  await cleanupDeadline.run(operation, 'connection cleanup').catch(() => undefined)
}

export function createDatabaseTargetNotEmptyError() {
  return databaseError(
    'DATABASE_TARGET_NOT_EMPTY',
    'The selected database already contains a PhD Atlas workspace. Initial setup will not overwrite it.',
    'database',
  )
}

export function createDatabaseRevisionConflictError(revision) {
  return databaseError(
    'DATABASE_REVISION_CONFLICT',
    `The external database already contains different workspace content for revision ${revision}.`,
    'database',
  )
}

function normalizePort(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'Database port must be between 1 and 65535.', 'port')
  }
  return port
}

function normalizeIdentifier(value, fallback) {
  const normalized = String(value ?? fallback).trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'Database schema must contain only letters, numbers, and underscores.', 'schema')
  }
  return normalized
}

function normalizeSqlitePath(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return defaultSqlitePath
  const resolved = path.resolve(raw)
  if (!resolved.toLowerCase().endsWith('.sqlite') && !resolved.toLowerCase().endsWith('.sqlite3')) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'SQLite database file must end in .sqlite or .sqlite3.', 'sqlitePath')
  }
  return resolved
}

function pathIsWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

async function realPathForProspectiveTarget(targetPath) {
  const missingSegments = []
  let current = targetPath
  while (true) {
    try {
      const real = await fs.realpath(current)
      return path.resolve(real, ...missingSegments.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Initial setup is reachable before an administrator exists, so its SQLite
 * target is deliberately narrower than the authenticated database settings
 * surface. Validate both the lexical path and every existing symlink/junction
 * component before creating a directory or opening SQLite.
 */
export async function assertSetupSqlitePath(sqlitePath, options = {}) {
  const configuredRoot = path.resolve(options.storageRoot ?? runtimeStorageRoot)
  await fs.mkdir(configuredRoot, { recursive: true })
  const rootRealPath = await fs.realpath(configuredRoot)
  const targetPath = path.resolve(sqlitePath)
  if (!pathIsWithinRoot(configuredRoot, targetPath)) {
    throw databaseError(
      'DATABASE_PATH_OUTSIDE_STORAGE_ROOT',
      'Initial setup SQLite files must be stored inside PHD_ATLAS_STORAGE_ROOT.',
      'sqlitePath',
    )
  }
  const targetRealPath = await realPathForProspectiveTarget(targetPath)
  if (!pathIsWithinRoot(rootRealPath, targetRealPath)) {
    throw databaseError(
      'DATABASE_PATH_OUTSIDE_STORAGE_ROOT',
      'Initial setup SQLite files must not traverse a symlink outside PHD_ATLAS_STORAGE_ROOT.',
      'sqlitePath',
    )
  }
  return targetPath
}

export async function resolveSetupDatabaseNetworkTarget(config, options = {}) {
  const normalized = normalizeDatabaseConfiguration(config)
  if (!isExternalDatabaseConfiguration(normalized)) return null
  try {
    return await resolvePinnedNetworkTarget(normalized.host, {
      enforcePublic: true,
      privateHostAllowlist: options.privateHostAllowlist
        ?? process.env.DATABASE_PRIVATE_HOST_ALLOWLIST,
      lookup: options.lookup,
    })
  } catch (error) {
    const wrapped = databaseError(
      'DATABASE_HOST_NOT_ALLOWED',
      'The database host must resolve only to public addresses unless it is explicitly listed in DATABASE_PRIVATE_HOST_ALLOWLIST.',
      'host',
    )
    wrapped.cause = error
    throw wrapped
  }
}

async function setupConnectionTarget(config, options = {}) {
  if (!options.setupSafety || !isExternalDatabaseConfiguration(config)) return null
  return resolveSetupDatabaseNetworkTarget(config, options)
}

/**
 * Validate the configuration once at the server boundary. Credentials are accepted
 * here but deliberately omitted by publicDatabaseConfiguration().
 */
export function normalizeDatabaseConfiguration(input = {}, options = {}) {
  const type = String(input.type ?? 'sqlite').trim().toLowerCase()
  if (!SUPPORTED_ENGINES.has(type)) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'Unsupported database engine.', 'type')
  }
  if (type === 'sqlite') {
    return { type, sqlitePath: normalizeSqlitePath(input.sqlitePath) }
  }

  const host = String(input.host ?? '').trim()
  const database = String(input.database ?? '').trim()
  const username = String(input.username ?? '').trim()
  const password = input.password === undefined || input.password === null ? '' : String(input.password)
  if (!host) throw databaseError('DATABASE_INVALID_CONFIG', 'Database host is required.', 'host')
  if (!database) throw databaseError('DATABASE_INVALID_CONFIG', 'Database name is required.', 'database')
  if (!username) throw databaseError('DATABASE_INVALID_CONFIG', 'Database username is required.', 'username')
  if (!password && options.requirePassword !== false) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'Database password is required.', 'password')
  }
  const defaults = type === 'mysql' ? 3306 : type === 'postgresql' ? 5432 : 1433
  return {
    type,
    host,
    port: normalizePort(input.port, defaults),
    database,
    username,
    password,
    ssl: Boolean(input.ssl),
    mysql57Compatibility: type === 'mysql' && Boolean(input.mysql57Compatibility),
    schema: normalizeIdentifier(input.schema, type === 'postgresql' ? 'public' : 'dbo'),
  }
}

export function isExternalDatabaseConfiguration(config) {
  return Boolean(config && EXTERNAL_ENGINES.has(config.type))
}

export function publicDatabaseConfiguration(config) {
  const normalized = config ? normalizeDatabaseConfiguration(config, { requirePassword: false }) : {
    type: 'sqlite',
    sqlitePath: defaultSqlitePath,
  }
  if (normalized.type === 'sqlite') {
    return {
      configured: Boolean(config),
      type: 'sqlite',
      sqlitePath: normalized.sqlitePath,
      passwordSet: false,
      cachePath: normalized.sqlitePath,
    }
  }
  return {
    configured: Boolean(config),
    type: normalized.type,
    host: normalized.host,
    port: normalized.port,
    database: normalized.database,
    username: normalized.username,
    ssl: normalized.ssl,
    mysql57Compatibility: normalized.mysql57Compatibility,
    schema: normalized.schema,
    passwordSet: Boolean(normalized.password),
    cachePath: defaultSqlitePath,
  }
}

/**
 * Database credentials must be readable before the workspace database is
 * opened and before its encryption settings can be loaded. Keep this bootstrap
 * secret bound to SETTINGS_ENCRYPTION_KEY only; normal workspace encryption may
 * still use the administrator-selected password binding.
 */
export function encryptDatabasePassword(password) {
  return encryptSecretWithProfile(String(password ?? ''), DATABASE_PASSWORD_PROFILE)
}

export function decryptDatabasePassword(ciphertext, options = {}) {
  const value = String(ciphertext ?? '')
  if (!value) return ''
  const stable = decryptSecretWithProfile(value, DATABASE_PASSWORD_PROFILE)
  if (stable) return stable
  // Version 1 configurations used the active runtime profile. Retain a
  // same-process migration fallback without making new configurations depend
  // on workspace settings that are unavailable during cold start.
  return options.allowLegacyRuntime === false ? '' : decryptSecret(value)
}

export async function readPersistedDatabaseConfiguration() {
  try {
    const raw = JSON.parse(await fs.readFile(databaseConfigPath, 'utf8'))
    if (!raw || typeof raw !== 'object') return null
    const config = raw.config && typeof raw.config === 'object' ? { ...raw.config } : null
    if (!config) return null
    if (isExternalDatabaseConfiguration(config)) {
      config.password = decryptDatabasePassword(String(raw.passwordEncrypted ?? ''), {
        allowLegacyRuntime: raw.passwordEncryption !== DATABASE_PASSWORD_ENCRYPTION,
      })
      if (!config.password) {
        throw databaseError('DATABASE_CONFIG_UNREADABLE', 'Saved database credentials could not be decrypted.')
      }
    }
    return normalizeDatabaseConfiguration(config)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function persistDatabaseConfiguration(config) {
  const normalized = normalizeDatabaseConfiguration(config)
  await fs.mkdir(runtimeStorageRoot, { recursive: true })
  const storedConfig = { ...normalized }
  let passwordEncrypted = ''
  if (isExternalDatabaseConfiguration(storedConfig)) {
    passwordEncrypted = encryptDatabasePassword(storedConfig.password)
    delete storedConfig.password
  }
  const temp = `${databaseConfigPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temp, JSON.stringify({
    version: 2,
    config: storedConfig,
    passwordEncryption: DATABASE_PASSWORD_ENCRYPTION,
    passwordEncrypted,
  }, null, 2), 'utf8')
  await fs.rename(temp, databaseConfigPath)
  return normalized
}

function quoteIdentifier(identifier, engine) {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'Unsafe database identifier.')
  }
  return engine === 'mysql' ? `\`${identifier}\`` : `"${identifier}"`
}

function stateTableReference(config) {
  if (config.type === 'postgresql') return `${quoteIdentifier(config.schema, 'postgresql')}."phd_atlas_state"`
  if (config.type === 'mssql') return `[${config.schema.replaceAll(']', ']]')}].[phd_atlas_state]`
  return '`phd_atlas_state`'
}

// External snapshots are produced under the local write lock, but separate
// network flushes can still finish out of order. Every adapter must therefore
// leave a newer stored revision untouched and compare equal-revision bytes.
function assertGuardedRevisionResult(row, payload, revision) {
  if (!row) throw new Error('The guarded workspace write did not leave a readable database row.')
  const storedRevision = Number(row.revision)
  if (!Number.isSafeInteger(storedRevision)) {
    throw new Error('The external database returned an invalid workspace revision.')
  }
  if (storedRevision > revision) return 'stale'
  if (storedRevision < revision) {
    throw new Error('The guarded workspace write did not persist the requested revision.')
  }
  if (!Buffer.from(row.state_blob).equals(Buffer.from(payload))) {
    throw createDatabaseRevisionConflictError(revision)
  }
  return 'accepted'
}

async function openMysql(config, mysql, timeoutMs) {
  const deadline = createOperationDeadline(timeoutMs)
  const pool = mysql.createPool({
    // Keep the validated DNS name for TLS identity while the socket itself is
    // pinned to the already-vetted numeric address.
    host: config.connectionAddress ? (config.servername ?? config.host) : config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? {} : undefined,
    ...(config.connectionAddress
      ? { stream: () => net.connect({ host: config.connectionAddress, port: config.port }) }
      : {}),
    connectionLimit: 1,
    connectTimeout: Math.min(10_000, timeoutMs),
    enableKeepAlive: false,
    charset: 'utf8mb4',
  })
  const query = (executor, sql, parameters = []) => deadline.run(
    () => executor.query({ sql, timeout: deadline.remaining() }, parameters),
    'query',
  )
  try {
    const [versionRows] = await query(pool, 'SELECT VERSION() AS version')
    const version = String(versionRows[0]?.version ?? '')
    if (config.mysql57Compatibility && !/^5\.7\.44(?:[-+.]|$)/.test(version)) {
      throw databaseError(
        'MYSQL_57_COMPATIBILITY_FAILED',
        `MySQL 5.7.44 compatibility mode requires a MySQL 5.7.44 server (connected server: ${version || 'unknown'}).`,
        'mysql57Compatibility',
      )
    }
  } catch (error) {
    await closeFailedExternalConnection(() => pool.end(), timeoutMs)
    throw error
  }
  return {
    async ensure() {
      await query(
        pool,
        `CREATE TABLE IF NOT EXISTS ${stateTableReference(config)} (
          id VARCHAR(32) NOT NULL PRIMARY KEY,
          state_blob LONGBLOB NOT NULL,
          revision BIGINT NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`,
      )
    },
    async read(options = {}) {
      if (typeof options.acquirePayloadMemory === 'function') {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const [metadataRows] = await query(
            pool,
            `SELECT OCTET_LENGTH(state_blob) AS payload_bytes,
                    LEFT(state_blob, 16) AS payload_prefix,
                    revision, updated_at
             FROM ${stateTableReference(config)} WHERE id = ?`,
            [databaseStateId],
          )
          const metadata = metadataRows[0]
          if (!metadata) return null
          const payloadBytes = Number(metadata.payload_bytes)
          if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
            throw new Error('MySQL returned an invalid workspace payload length.')
          }
          const releaseMemory = options.acquirePayloadMemory(payloadBytes, {
            payloadPrefix: Buffer.from(metadata.payload_prefix ?? ''),
            revision: Number(metadata.revision),
            updatedAt: metadata.updated_at,
          })
          let retained = false
          try {
            const [rows] = await query(
              pool,
              `SELECT state_blob, revision, updated_at FROM ${stateTableReference(config)}
               WHERE id = ? AND revision = ? AND OCTET_LENGTH(state_blob) = ?`,
              [databaseStateId, metadata.revision, payloadBytes],
            )
            const row = rows[0]
            if (!row) continue
            retained = true
            return {
              payload: Buffer.from(row.state_blob),
              revision: Number(row.revision),
              updatedAt: row.updated_at,
              releaseMemory,
            }
          } finally {
            if (!retained) releaseMemory?.()
          }
        }
        throw databaseError('DATABASE_STATE_CHANGED', 'The external workspace changed while it was being read.')
      }
      const [rows] = await query(
        pool,
        `SELECT state_blob, revision, updated_at FROM ${stateTableReference(config)} WHERE id = ?`,
        [databaseStateId],
      )
      const row = rows[0]
      return row ? { payload: Buffer.from(row.state_blob), revision: Number(row.revision), updatedAt: row.updated_at } : null
    },
    async readMetadata() {
      const [rows] = await query(
        pool,
        `SELECT OCTET_LENGTH(state_blob) AS payload_bytes,
                LEFT(state_blob, 16) AS payload_prefix,
                revision, updated_at
         FROM ${stateTableReference(config)} WHERE id = ?`,
        [databaseStateId],
      )
      const row = rows[0]
      return row
        ? {
            payloadBytes: Number(row.payload_bytes),
            payloadPrefix: Buffer.from(row.payload_prefix ?? ''),
            revision: Number(row.revision),
            updatedAt: row.updated_at,
          }
        : null
    },
    async write(payload, revision, updatedAt, options = {}) {
      if (options.overwrite === false) {
        try {
          await query(
            pool,
            `INSERT INTO ${stateTableReference(config)} (id, state_blob, revision, updated_at)
             VALUES (?, ?, ?, ?)`,
            [databaseStateId, payload, revision, updatedAt],
          )
        } catch (error) {
          if (error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062) {
            throw createDatabaseTargetNotEmptyError()
          }
          throw error
        }
        return
      }
      const connection = await deadline.run(() => pool.getConnection(), 'connection acquisition')
      try {
        await deadline.run(() => connection.beginTransaction(), 'transaction begin')
        const [result] = await query(
          connection,
          `INSERT INTO ${stateTableReference(config)} (id, state_blob, revision, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             state_blob = IF(VALUES(revision) > revision, VALUES(state_blob), state_blob),
             updated_at = IF(VALUES(revision) > revision, VALUES(updated_at), updated_at),
             revision = GREATEST(revision, VALUES(revision))`,
          [databaseStateId, payload, revision, updatedAt],
        )
        const affectedRows = Number(result?.affectedRows)
        if (!Number.isInteger(affectedRows) || affectedRows < 0 || affectedRows > 2) {
          throw new Error('MySQL returned an invalid affected-row count for the guarded workspace write.')
        }
        const [rows] = await query(
          connection,
          `SELECT state_blob, revision FROM ${stateTableReference(config)} WHERE id = ? FOR UPDATE`,
          [databaseStateId],
        )
        const outcome = assertGuardedRevisionResult(rows[0], payload, revision)
        await deadline.run(() => connection.commit(), 'transaction commit')
        if (outcome === 'stale') return { outcome }
      } catch (error) {
        await deadline.run(() => connection.rollback(), 'transaction rollback').catch(() => undefined)
        throw error
      } finally {
        connection.release()
      }
    },
    close: () => deadline.run(() => pool.end(), 'connection close'),
  }
}

function createPinnedMssqlConnector(address, port) {
  return async (options, _lookup, signal) => {
    if (
      String(options?.host ?? '').toLowerCase() !== String(address).toLowerCase()
      || Number(options?.port) !== Number(port)
    ) {
      throw databaseError(
        'DATABASE_HOST_NOT_ALLOWED',
        'The database server attempted to redirect outside its validated network target.',
        'host',
      )
    }
    if (signal?.aborted) {
      const error = new Error('The database connection was aborted.')
      error.name = 'AbortError'
      throw error
    }
    return await new Promise((resolve, reject) => {
      const socket = net.connect({ host: address, port })
      const cleanup = () => {
        socket.removeListener('connect', onConnect)
        socket.removeListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const onConnect = () => {
        cleanup()
        resolve(socket)
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const onAbort = () => {
        cleanup()
        socket.destroy()
        const error = new Error('The database connection was aborted.')
        error.name = 'AbortError'
        reject(error)
      }
      socket.once('connect', onConnect)
      socket.once('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

async function openPostgres(config, postgres, timeoutMs) {
  const { Client } = postgres
  const deadline = createOperationDeadline(timeoutMs)
  const client = new Client({
    host: config.connectionAddress ?? config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl
      ? {
          rejectUnauthorized: true,
          ...(config.servername ? { servername: config.servername } : {}),
        }
      : undefined,
    connectionTimeoutMillis: Math.min(10_000, timeoutMs),
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
  })
  try {
    await deadline.run(() => client.connect(), 'connection')
  } catch (error) {
    await closeFailedExternalConnection(() => client.end(), timeoutMs)
    throw error
  }
  const query = (statement, parameters = []) => deadline.run(
    () => client.query(statement, parameters),
    'query',
  )
  const table = stateTableReference(config)
  return {
    async ensure() {
      await query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(config.schema, 'postgresql')}`)
      await query(
        `CREATE TABLE IF NOT EXISTS ${table} (
          id VARCHAR(32) PRIMARY KEY,
          state_blob BYTEA NOT NULL,
          revision BIGINT NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`,
      )
    },
    async read(options = {}) {
      if (typeof options.acquirePayloadMemory === 'function') {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const metadataResult = await query(
            `SELECT octet_length(state_blob)::bigint AS payload_bytes,
                    substring(state_blob from 1 for 16) AS payload_prefix,
                    revision, updated_at
             FROM ${table} WHERE id = $1`,
            [databaseStateId],
          )
          const metadata = metadataResult.rows[0]
          if (!metadata) return null
          const payloadBytes = Number(metadata.payload_bytes)
          if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
            throw new Error('PostgreSQL returned an invalid workspace payload length.')
          }
          const releaseMemory = options.acquirePayloadMemory(payloadBytes, {
            payloadPrefix: Buffer.from(metadata.payload_prefix ?? ''),
            revision: Number(metadata.revision),
            updatedAt: metadata.updated_at,
          })
          let retained = false
          try {
            const result = await query(
              `SELECT state_blob, revision, updated_at FROM ${table}
               WHERE id = $1 AND revision = $2 AND octet_length(state_blob) = $3`,
              [databaseStateId, metadata.revision, payloadBytes],
            )
            const row = result.rows[0]
            if (!row) continue
            retained = true
            return {
              payload: Buffer.from(row.state_blob),
              revision: Number(row.revision),
              updatedAt: row.updated_at,
              releaseMemory,
            }
          } finally {
            if (!retained) releaseMemory?.()
          }
        }
        throw databaseError('DATABASE_STATE_CHANGED', 'The external workspace changed while it was being read.')
      }
      const result = await query(
        `SELECT state_blob, revision, updated_at FROM ${table} WHERE id = $1`,
        [databaseStateId],
      )
      const row = result.rows[0]
      return row ? { payload: Buffer.from(row.state_blob), revision: Number(row.revision), updatedAt: row.updated_at } : null
    },
    async readMetadata() {
      const result = await query(
        `SELECT octet_length(state_blob)::bigint AS payload_bytes,
                substring(state_blob from 1 for 16) AS payload_prefix,
                revision, updated_at
         FROM ${table} WHERE id = $1`,
        [databaseStateId],
      )
      const row = result.rows[0]
      return row
        ? {
            payloadBytes: Number(row.payload_bytes),
            payloadPrefix: Buffer.from(row.payload_prefix ?? ''),
            revision: Number(row.revision),
            updatedAt: row.updated_at,
          }
        : null
    },
    async write(payload, revision, updatedAt, options = {}) {
      if (options.overwrite === false) {
        const result = await query(
          `INSERT INTO ${table} (id, state_blob, revision, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [databaseStateId, payload, revision, updatedAt],
        )
        if (result.rowCount !== 1) throw createDatabaseTargetNotEmptyError()
        return
      }
      await query('BEGIN')
      try {
        const result = await query(
          `INSERT INTO ${table} (id, state_blob, revision, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE
             SET state_blob = EXCLUDED.state_blob,
                 revision = EXCLUDED.revision,
                 updated_at = EXCLUDED.updated_at
             WHERE ${table}.revision < EXCLUDED.revision
           RETURNING state_blob, revision`,
          [databaseStateId, payload, revision, updatedAt],
        )
        if (result.rowCount !== 0 && result.rowCount !== 1) {
          throw new Error('PostgreSQL returned an invalid affected-row count for the guarded workspace write.')
        }
        if (result.rowCount === 0) {
          const current = await query(
            `SELECT state_blob, revision FROM ${table} WHERE id = $1 FOR UPDATE`,
            [databaseStateId],
          )
          const outcome = assertGuardedRevisionResult(current.rows[0], payload, revision)
          if (outcome === 'stale') {
            await query('COMMIT')
            return { outcome }
          }
        } else {
          assertGuardedRevisionResult(result.rows[0], payload, revision)
        }
        await query('COMMIT')
      } catch (error) {
        await query('ROLLBACK').catch(() => undefined)
        throw error
      }
    },
    close: () => deadline.run(() => client.end(), 'connection close'),
  }
}

async function openMssql(config, module, timeoutMs) {
  const sql = module.default ?? module
  const deadline = createOperationDeadline(timeoutMs)
  const pool = new sql.ConnectionPool({
    server: config.connectionAddress ?? config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    options: {
      encrypt: config.ssl,
      trustServerCertificate: !config.ssl,
      ...(config.servername ? { serverName: config.servername } : {}),
      ...(config.connectionAddress
        ? { connector: createPinnedMssqlConnector(config.connectionAddress, config.port) }
        : {}),
    },
    connectionTimeout: Math.min(10_000, timeoutMs),
    requestTimeout: timeoutMs,
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
  })
  try {
    await deadline.run(() => pool.connect(), 'connection')
  } catch (error) {
    await closeFailedExternalConnection(() => pool.close(), timeoutMs)
    throw error
  }
  const query = (request, statement) => deadline.run(
    () => request.query(statement),
    'query',
  )
  const schema = config.schema.replaceAll(']', ']]')
  const table = stateTableReference(config)
  return {
    async ensure() {
      await query(pool.request(), `IF SCHEMA_ID(N'${schema.replaceAll("'", "''")}') IS NULL EXEC(N'CREATE SCHEMA [${schema}]')`)
      await query(
        pool.request(),
        `IF OBJECT_ID(N'${schema}.phd_atlas_state', N'U') IS NULL
         CREATE TABLE ${table} (
           id NVARCHAR(32) NOT NULL PRIMARY KEY,
           state_blob VARBINARY(MAX) NOT NULL,
           revision BIGINT NOT NULL,
           updated_at NVARCHAR(40) NOT NULL
         )`,
      )
    },
    async read(options = {}) {
      if (typeof options.acquirePayloadMemory === 'function') {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const metadataResult = await query(
            pool.request().input('id', sql.NVarChar(32), databaseStateId),
            `SELECT DATALENGTH(state_blob) AS payload_bytes,
                    SUBSTRING(state_blob, 1, 16) AS payload_prefix,
                    revision, updated_at
             FROM ${table} WHERE id = @id`,
          )
          const metadata = metadataResult.recordset[0]
          if (!metadata) return null
          const payloadBytes = Number(metadata.payload_bytes)
          if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
            throw new Error('Microsoft SQL Server returned an invalid workspace payload length.')
          }
          const releaseMemory = options.acquirePayloadMemory(payloadBytes, {
            payloadPrefix: Buffer.from(metadata.payload_prefix ?? ''),
            revision: Number(metadata.revision),
            updatedAt: metadata.updated_at,
          })
          let retained = false
          try {
            const result = await query(
              pool.request()
                .input('id', sql.NVarChar(32), databaseStateId)
                .input('revision', sql.BigInt, metadata.revision)
                .input('payloadBytes', sql.BigInt, payloadBytes),
              `SELECT state_blob, revision, updated_at FROM ${table}
               WHERE id = @id AND revision = @revision AND DATALENGTH(state_blob) = @payloadBytes`,
            )
            const row = result.recordset[0]
            if (!row) continue
            retained = true
            return {
              payload: Buffer.from(row.state_blob),
              revision: Number(row.revision),
              updatedAt: row.updated_at,
              releaseMemory,
            }
          } finally {
            if (!retained) releaseMemory?.()
          }
        }
        throw databaseError('DATABASE_STATE_CHANGED', 'The external workspace changed while it was being read.')
      }
      const result = await query(
        pool.request().input('id', sql.NVarChar(32), databaseStateId),
        `SELECT state_blob, revision, updated_at FROM ${table} WHERE id = @id`,
      )
      const row = result.recordset[0]
      return row ? { payload: Buffer.from(row.state_blob), revision: Number(row.revision), updatedAt: row.updated_at } : null
    },
    async readMetadata() {
      const result = await query(
        pool.request().input('id', sql.NVarChar(32), databaseStateId),
        `SELECT DATALENGTH(state_blob) AS payload_bytes,
                SUBSTRING(state_blob, 1, 16) AS payload_prefix,
                revision, updated_at
         FROM ${table} WHERE id = @id`,
      )
      const row = result.recordset[0]
      return row
        ? {
            payloadBytes: Number(row.payload_bytes),
            payloadPrefix: Buffer.from(row.payload_prefix ?? ''),
            revision: Number(row.revision),
            updatedAt: row.updated_at,
          }
        : null
    },
    async write(payload, revision, updatedAt, options = {}) {
      const request = pool.request()
        .input('id', sql.NVarChar(32), databaseStateId)
        .input('stateBlob', sql.VarBinary(sql.MAX), payload)
        .input('revision', sql.BigInt, revision)
        .input('updatedAt', sql.NVarChar(40), updatedAt)
      if (options.overwrite === false) {
        const result = await query(
          request,
          `INSERT INTO ${table} (id, state_blob, revision, updated_at)
           SELECT @id, @stateBlob, @revision, @updatedAt
           WHERE NOT EXISTS (
             SELECT 1 FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE id = @id
           );`,
        )
        if (Number(result.rowsAffected?.[0] ?? 0) !== 1) throw createDatabaseTargetNotEmptyError()
        return
      }
      const result = await query(
        request,
        `SET NOCOUNT ON;
         SET XACT_ABORT ON;
         BEGIN TRY
           BEGIN TRANSACTION;
           DECLARE @outcome NVARCHAR(16);
           DECLARE @affected_rows INT = 0;
           DECLARE @current_revision BIGINT;
           DECLARE @same_payload BIT;

           UPDATE ${table} WITH (UPDLOCK, HOLDLOCK)
             SET state_blob = @stateBlob, revision = @revision, updated_at = @updatedAt
             WHERE id = @id AND revision < @revision;
           SET @affected_rows = @@ROWCOUNT;

           IF @affected_rows = 1
             SET @outcome = N'written';
           ELSE IF EXISTS (SELECT 1 FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE id = @id)
           BEGIN
             SELECT
               @current_revision = revision,
               @same_payload = CASE WHEN state_blob = @stateBlob THEN 1 ELSE 0 END
             FROM ${table} WITH (UPDLOCK, HOLDLOCK)
             WHERE id = @id;

             IF @current_revision > @revision
               SET @outcome = N'stale';
             ELSE IF @current_revision = @revision AND @same_payload = 1
               SET @outcome = N'idempotent';
             ELSE IF @current_revision = @revision
               SET @outcome = N'conflict';
             ELSE
               SET @outcome = N'invalid';
           END
           ELSE
           BEGIN
             INSERT INTO ${table} (id, state_blob, revision, updated_at)
               VALUES (@id, @stateBlob, @revision, @updatedAt);
             SET @affected_rows = @@ROWCOUNT;
             SET @outcome = N'written';
           END;

           COMMIT TRANSACTION;
           SELECT @outcome AS outcome, @affected_rows AS affected_rows;
         END TRY
         BEGIN CATCH
           IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
           THROW;
         END CATCH;`,
      )
      const row = result.recordset?.[0]
      const outcome = String(row?.outcome ?? '')
      const affectedRows = Number(row?.affected_rows)
      if (outcome === 'conflict') throw createDatabaseRevisionConflictError(revision)
      if (outcome === 'stale' && affectedRows === 0) return { outcome }
      if (
        (outcome === 'written' && affectedRows === 1)
        || (outcome === 'idempotent' && affectedRows === 0)
      ) return
      throw new Error('Microsoft SQL Server returned an invalid outcome for the guarded workspace write.')
    },
    close: () => deadline.run(() => pool.close(), 'connection close'),
  }
}

// Keep driver loading injectable so concurrency and SQL-shape tests exercise
// the real adapter methods without requiring three database servers.
export function createExternalDatabaseOpener(driverLoaders = {}, options = {}) {
  const loadMysql = driverLoaders.mysql ?? (() => import('mysql2/promise'))
  const loadPostgres = driverLoaders.postgresql ?? (() => import('pg'))
  const loadMssql = driverLoaders.mssql ?? (() => import('mssql'))
  return async function openExternalDatabaseWithDrivers(config, connectionOptions = {}) {
    const normalized = normalizeDatabaseConfiguration(config)
    const target = connectionOptions.target ?? null
    const connectionConfig = target
      ? {
          ...normalized,
          connectionAddress: target.address,
          servername: target.servername,
        }
      : normalized
    const timeoutMs = normalizeExternalDatabaseQueryTimeoutMs(options.queryTimeoutMs)
    if (normalized.type === 'mysql') return openMysql(connectionConfig, await loadMysql(), timeoutMs)
    if (normalized.type === 'postgresql') return openPostgres(connectionConfig, await loadPostgres(), timeoutMs)
    if (normalized.type === 'mssql') return openMssql(connectionConfig, await loadMssql(), timeoutMs)
    throw databaseError('DATABASE_INVALID_CONFIG', 'SQLite does not use a network connection.')
  }
}

const openExternalDatabase = createExternalDatabaseOpener()

function connectionError(error) {
  if (
    error?.code === 'MYSQL_57_COMPATIBILITY_FAILED'
    || error?.code === 'DATABASE_TARGET_NOT_EMPTY'
    || error?.code === 'DATABASE_REVISION_CONFLICT'
    || error?.code === 'DATABASE_QUERY_TIMEOUT'
    || error?.code === 'DATABASE_PATH_OUTSIDE_STORAGE_ROOT'
    || error?.code === 'DATABASE_HOST_NOT_ALLOWED'
    || error?.code === 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED'
  ) return error
  const message = String(error?.message ?? 'Database connection failed.')
  const lower = message.toLowerCase()
  const code = lower.includes('access denied') || lower.includes('password authentication') || lower.includes('login failed')
    ? 'DATABASE_AUTH_FAILED'
    : 'DATABASE_CONNECTION_FAILED'
  const wrapped = databaseError(code, `Could not connect to the selected database: ${message}`)
  wrapped.cause = error
  return wrapped
}

export async function verifyDatabaseConnection(input, options = {}) {
  const config = normalizeDatabaseConfiguration(input, options)
  if (config.type === 'sqlite') {
    if (options.setupSafety) {
      await assertSetupSqlitePath(config.sqlitePath, options)
    }
    await fs.mkdir(path.dirname(config.sqlitePath), { recursive: true })
    return publicDatabaseConfiguration(config)
  }
  let connection
  try {
    const target = await setupConnectionTarget(config, options)
    connection = await openExternalDatabase(config, { target })
    if (options.ensure !== false) await connection.ensure()
    return publicDatabaseConfiguration(config)
  } catch (error) {
    throw connectionError(error)
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export async function readExternalDatabaseState(config, options = {}) {
  let connection
  try {
    const target = await setupConnectionTarget(config, options)
    connection = await openExternalDatabase(config, { target })
    await connection.ensure()
    return await connection.read(options)
  } catch (error) {
    throw connectionError(error)
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export async function readExternalDatabaseStateMetadata(config, options = {}) {
  let connection
  try {
    const target = await setupConnectionTarget(config, options)
    connection = await openExternalDatabase(config, { target })
    await connection.ensure()
    return await connection.readMetadata()
  } catch (error) {
    throw connectionError(error)
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export async function assertExternalDatabaseTargetEmpty(config, options = {}) {
  const state = await readExternalDatabaseStateMetadata(config, options)
  if (state?.payloadBytes) throw createDatabaseTargetNotEmptyError()
  return true
}

export async function writeExternalDatabaseState(config, payload, revision, updatedAt, options = {}) {
  let connection
  try {
    const target = await setupConnectionTarget(config, options)
    connection = await openExternalDatabase(config, { target })
    await connection.ensure()
    return await connection.write(payload, revision, updatedAt, options)
  } catch (error) {
    throw connectionError(error)
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export function createExternalDatabaseSqlDump(config, state) {
  const normalized = normalizeDatabaseConfiguration(config, { requirePassword: false })
  if (!isExternalDatabaseConfiguration(normalized)) {
    throw databaseError('DATABASE_INVALID_CONFIG', 'A database SQL dump requires an external database configuration.')
  }
  const payload = Buffer.from(state.payload)
  const updatedAt = String(state.updatedAt ?? new Date().toISOString())
  const revision = Number(state.revision ?? 0)
  const base64 = payload.toString('base64')
  if (normalized.type === 'mysql') {
    const dialect = normalized.mysql57Compatibility ? 'MySQL 5.7.44-compatible' : 'MySQL/MariaDB'
    return `-- PhD Atlas ${dialect} workspace backup\nSTART TRANSACTION;\nCREATE TABLE IF NOT EXISTS ${stateTableReference(normalized)} (id VARCHAR(32) NOT NULL PRIMARY KEY, state_blob LONGBLOB NOT NULL, revision BIGINT NOT NULL, updated_at VARCHAR(40) NOT NULL);\nINSERT INTO ${stateTableReference(normalized)} (id, state_blob, revision, updated_at) VALUES ('${databaseStateId}', FROM_BASE64('${base64}'), ${revision}, '${updatedAt.replaceAll("'", "''")}') ON DUPLICATE KEY UPDATE state_blob = VALUES(state_blob), revision = VALUES(revision), updated_at = VALUES(updated_at);\nCOMMIT;\n`
  }
  if (normalized.type === 'postgresql') {
    return `-- PhD Atlas PostgreSQL workspace backup\nBEGIN;\nCREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(normalized.schema, 'postgresql')};\nCREATE TABLE IF NOT EXISTS ${stateTableReference(normalized)} (id VARCHAR(32) PRIMARY KEY, state_blob BYTEA NOT NULL, revision BIGINT NOT NULL, updated_at VARCHAR(40) NOT NULL);\nINSERT INTO ${stateTableReference(normalized)} (id, state_blob, revision, updated_at) VALUES ('${databaseStateId}', decode('${base64}', 'base64'), ${revision}, '${updatedAt.replaceAll("'", "''")}') ON CONFLICT (id) DO UPDATE SET state_blob = EXCLUDED.state_blob, revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at;\nCOMMIT;\n`
  }
  return `-- PhD Atlas Microsoft SQL Server workspace backup\nIF OBJECT_ID(N'${normalized.schema.replaceAll("'", "''")}.phd_atlas_state', N'U') IS NULL CREATE TABLE ${stateTableReference(normalized)} (id NVARCHAR(32) NOT NULL PRIMARY KEY, state_blob VARBINARY(MAX) NOT NULL, revision BIGINT NOT NULL, updated_at NVARCHAR(40) NOT NULL);\nMERGE ${stateTableReference(normalized)} WITH (HOLDLOCK) AS target USING (SELECT N'${databaseStateId}' AS id, 0x${payload.toString('hex')} AS state_blob, CAST(${revision} AS BIGINT) AS revision, N'${updatedAt.replaceAll("'", "''")}' AS updated_at) AS source ON target.id = source.id WHEN MATCHED THEN UPDATE SET state_blob = source.state_blob, revision = source.revision, updated_at = source.updated_at WHEN NOT MATCHED THEN INSERT (id, state_blob, revision, updated_at) VALUES (source.id, source.state_blob, source.revision, source.updated_at);\n`
}
