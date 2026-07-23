import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decryptSecret,
  decryptSecretWithProfile,
  encryptSecretWithProfile,
} from './crypto.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const storageRoot = path.join(projectRoot, 'storage')

function defaultTestSqlitePath() {
  const worker = String(process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID || process.pid)
    .replace(/[^a-z0-9_-]/gi, '_')
    .slice(0, 48)
  return path.join(projectRoot, 'logs', 'tmp', `phd-atlas-vitest-${process.pid}-${worker}.sqlite`)
}

// Allows an isolated local verification server to use a copied workspace
// database without competing with the normal development service. Production
// defaults remain unchanged when the variable is absent.
export const defaultSqlitePath = process.env.PHD_ATLAS_SQLITE_PATH
  ? path.resolve(process.env.PHD_ATLAS_SQLITE_PATH)
  : (process.env.NODE_ENV === 'test' ? defaultTestSqlitePath() : path.join(storageRoot, 'phd-atlas.sqlite'))
export const databaseConfigPath = path.join(storageRoot, 'database-connection.json')
export const databaseStateId = 'primary'
const DATABASE_PASSWORD_ENCRYPTION = 'server-key-v1'
const DATABASE_PASSWORD_PROFILE = Object.freeze({
  algorithm: 'aes-256-gcm',
  passwordBinding: '',
})

const EXTERNAL_ENGINES = new Set(['mysql', 'postgresql', 'mssql'])
const SUPPORTED_ENGINES = new Set(['sqlite', ...EXTERNAL_ENGINES])
const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/

function databaseError(code, message, field) {
  const error = new Error(message)
  error.code = code
  error.status = code === 'DATABASE_AUTH_FAILED'
    ? 422
    : code === 'DATABASE_TARGET_NOT_EMPTY'
      ? 409
      : 400
  if (field) error.field = field
  return error
}

export function createDatabaseTargetNotEmptyError() {
  return databaseError(
    'DATABASE_TARGET_NOT_EMPTY',
    'The selected database already contains a PhD Atlas workspace. Initial setup will not overwrite it.',
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
  await fs.mkdir(storageRoot, { recursive: true })
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

async function openMysql(config) {
  const mysql = await import('mysql2/promise')
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? {} : undefined,
    connectionLimit: 1,
    connectTimeout: 10_000,
    enableKeepAlive: false,
    charset: 'utf8mb4',
  })
  try {
    const [versionRows] = await pool.query('SELECT VERSION() AS version')
    const version = String(versionRows[0]?.version ?? '')
    if (config.mysql57Compatibility && !/^5\.7\.44(?:[-+.]|$)/.test(version)) {
      throw databaseError(
        'MYSQL_57_COMPATIBILITY_FAILED',
        `MySQL 5.7.44 compatibility mode requires a MySQL 5.7.44 server (connected server: ${version || 'unknown'}).`,
        'mysql57Compatibility',
      )
    }
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
  return {
    async ensure() {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${stateTableReference(config)} (
          id VARCHAR(32) NOT NULL PRIMARY KEY,
          state_blob LONGBLOB NOT NULL,
          revision BIGINT NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`,
      )
    },
    async read() {
      const [rows] = await pool.query(
        `SELECT state_blob, revision, updated_at FROM ${stateTableReference(config)} WHERE id = ?`,
        [databaseStateId],
      )
      const row = rows[0]
      return row ? { payload: Buffer.from(row.state_blob), revision: Number(row.revision), updatedAt: row.updated_at } : null
    },
    async write(payload, revision, updatedAt, options = {}) {
      if (options.overwrite === false) {
        try {
          await pool.query(
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
      await pool.query(
        `INSERT INTO ${stateTableReference(config)} (id, state_blob, revision, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE state_blob = VALUES(state_blob), revision = VALUES(revision), updated_at = VALUES(updated_at)`,
        [databaseStateId, payload, revision, updatedAt],
      )
    },
    close: () => pool.end(),
  }
}

async function openPostgres(config) {
  const { Client } = await import('pg')
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: 10_000,
  })
  await client.connect()
  const table = stateTableReference(config)
  return {
    async ensure() {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(config.schema, 'postgresql')}`)
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${table} (
          id VARCHAR(32) PRIMARY KEY,
          state_blob BYTEA NOT NULL,
          revision BIGINT NOT NULL,
          updated_at VARCHAR(40) NOT NULL
        )`,
      )
    },
    async read() {
      const result = await client.query(
        `SELECT state_blob, revision, updated_at FROM ${table} WHERE id = $1`,
        [databaseStateId],
      )
      const row = result.rows[0]
      return row ? { payload: Buffer.from(row.state_blob), revision: Number(row.revision), updatedAt: row.updated_at } : null
    },
    async write(payload, revision, updatedAt, options = {}) {
      if (options.overwrite === false) {
        const result = await client.query(
          `INSERT INTO ${table} (id, state_blob, revision, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [databaseStateId, payload, revision, updatedAt],
        )
        if (result.rowCount !== 1) throw createDatabaseTargetNotEmptyError()
        return
      }
      await client.query(
        `INSERT INTO ${table} (id, state_blob, revision, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET state_blob = EXCLUDED.state_blob, revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at`,
        [databaseStateId, payload, revision, updatedAt],
      )
    },
    close: () => client.end(),
  }
}

async function openMssql(config) {
  const module = await import('mssql')
  const sql = module.default ?? module
  const pool = new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    options: {
      encrypt: config.ssl,
      trustServerCertificate: !config.ssl,
    },
    connectionTimeout: 10_000,
    requestTimeout: 20_000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
  })
  await pool.connect()
  const schema = config.schema.replaceAll(']', ']]')
  const table = stateTableReference(config)
  return {
    async ensure() {
      await pool.request().query(`IF SCHEMA_ID(N'${schema.replaceAll("'", "''")}') IS NULL EXEC(N'CREATE SCHEMA [${schema}]')`)
      await pool.request().query(
        `IF OBJECT_ID(N'${schema}.phd_atlas_state', N'U') IS NULL
         CREATE TABLE ${table} (
           id NVARCHAR(32) NOT NULL PRIMARY KEY,
           state_blob VARBINARY(MAX) NOT NULL,
           revision BIGINT NOT NULL,
           updated_at NVARCHAR(40) NOT NULL
         )`,
      )
    },
    async read() {
      const result = await pool.request()
        .input('id', sql.NVarChar(32), databaseStateId)
        .query(`SELECT state_blob, revision, updated_at FROM ${table} WHERE id = @id`)
      const row = result.recordset[0]
      return row ? { payload: Buffer.from(row.state_blob), revision: Number(row.revision), updatedAt: row.updated_at } : null
    },
    async write(payload, revision, updatedAt, options = {}) {
      const request = pool.request()
        .input('id', sql.NVarChar(32), databaseStateId)
        .input('stateBlob', sql.VarBinary(sql.MAX), payload)
        .input('revision', sql.BigInt, revision)
        .input('updatedAt', sql.NVarChar(40), updatedAt)
      if (options.overwrite === false) {
        const result = await request.query(
          `INSERT INTO ${table} (id, state_blob, revision, updated_at)
           SELECT @id, @stateBlob, @revision, @updatedAt
           WHERE NOT EXISTS (
             SELECT 1 FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE id = @id
           );`,
        )
        if (Number(result.rowsAffected?.[0] ?? 0) !== 1) throw createDatabaseTargetNotEmptyError()
        return
      }
      await request.query(
          `MERGE ${table} WITH (HOLDLOCK) AS target
           USING (SELECT @id AS id, @stateBlob AS state_blob, @revision AS revision, @updatedAt AS updated_at) AS source
           ON target.id = source.id
           WHEN MATCHED THEN UPDATE SET state_blob = source.state_blob, revision = source.revision, updated_at = source.updated_at
           WHEN NOT MATCHED THEN INSERT (id, state_blob, revision, updated_at)
             VALUES (source.id, source.state_blob, source.revision, source.updated_at);`,
        )
    },
    close: () => pool.close(),
  }
}

async function openExternalDatabase(config) {
  const normalized = normalizeDatabaseConfiguration(config)
  if (normalized.type === 'mysql') return openMysql(normalized)
  if (normalized.type === 'postgresql') return openPostgres(normalized)
  if (normalized.type === 'mssql') return openMssql(normalized)
  throw databaseError('DATABASE_INVALID_CONFIG', 'SQLite does not use a network connection.')
}

function connectionError(error) {
  if (
    error?.code === 'MYSQL_57_COMPATIBILITY_FAILED'
    || error?.code === 'DATABASE_TARGET_NOT_EMPTY'
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
    await fs.mkdir(path.dirname(config.sqlitePath), { recursive: true })
    return publicDatabaseConfiguration(config)
  }
  let connection
  try {
    connection = await openExternalDatabase(config)
    if (options.ensure !== false) await connection.ensure()
    return publicDatabaseConfiguration(config)
  } catch (error) {
    throw connectionError(error)
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export async function readExternalDatabaseState(config) {
  let connection
  try {
    connection = await openExternalDatabase(config)
    await connection.ensure()
    return await connection.read()
  } catch (error) {
    throw connectionError(error)
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export async function assertExternalDatabaseTargetEmpty(config) {
  const state = await readExternalDatabaseState(config)
  if (state?.payload?.length) throw createDatabaseTargetNotEmptyError()
  return true
}

export async function writeExternalDatabaseState(config, payload, revision, updatedAt, options = {}) {
  let connection
  try {
    connection = await openExternalDatabase(config)
    await connection.ensure()
    await connection.write(payload, revision, updatedAt, options)
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
