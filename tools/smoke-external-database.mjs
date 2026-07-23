import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as productionDatabaseApi from '../server/databaseConnection.js'

const ENABLE_ENV = 'PHD_ATLAS_RUN_EXTERNAL_DB_SMOKE'
const ENGINE_ENV = 'PHD_ATLAS_SMOKE_DB_ENGINE'
const SUPPORTED_ENGINES = new Set(['mysql', 'postgresql', 'mssql'])
const DEFAULT_READY_TIMEOUT_MS = 180_000
const DEFAULT_RETRY_INTERVAL_MS = 3_000
const MAX_READY_TIMEOUT_MS = 900_000
const BINARY_SENTINEL = Buffer.from([0x00, 0x01, 0x02, 0x7f, 0x80, 0xfe, 0xff])

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function requiredEnv(env, name) {
  const value = String(env[name] ?? '').trim()
  if (!value) {
    const error = new Error(`External database smoke test requires ${name}.`)
    error.code = 'DATABASE_SMOKE_INVALID_CONFIG'
    throw error
  }
  return value
}

function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    const error = new Error('PHD_ATLAS_SMOKE_DB_PORT must be an integer from 1 to 65535.')
    error.code = 'DATABASE_SMOKE_INVALID_CONFIG'
    throw error
  }
  return port
}

function parseReadyTimeout(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_READY_TIMEOUT_MS
  }
  const timeoutMs = Number(value)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_READY_TIMEOUT_MS) {
    const error = new Error(
      `PHD_ATLAS_SMOKE_READY_TIMEOUT_MS must be an integer from 1 to ${MAX_READY_TIMEOUT_MS}.`,
    )
    error.code = 'DATABASE_SMOKE_INVALID_CONFIG'
    throw error
  }
  return timeoutMs
}

/**
 * Build the same configuration object consumed by server/databaseConnection.js.
 * No validation is performed until the explicit enable flag is present, keeping
 * normal local development and the default test suite side-effect free.
 */
export function loadExternalDatabaseSmokeSettings(env = process.env) {
  if (!enabled(env[ENABLE_ENV])) {
    return { enabled: false }
  }

  const engine = requiredEnv(env, ENGINE_ENV).toLowerCase()
  if (!SUPPORTED_ENGINES.has(engine)) {
    const error = new Error(`${ENGINE_ENV} must be one of: mysql, postgresql, mssql.`)
    error.code = 'DATABASE_SMOKE_INVALID_CONFIG'
    throw error
  }

  const config = {
    type: engine,
    host: requiredEnv(env, 'PHD_ATLAS_SMOKE_DB_HOST'),
    port: parsePort(requiredEnv(env, 'PHD_ATLAS_SMOKE_DB_PORT')),
    database: requiredEnv(env, 'PHD_ATLAS_SMOKE_DB_NAME'),
    username: requiredEnv(env, 'PHD_ATLAS_SMOKE_DB_USER'),
    password: requiredEnv(env, 'PHD_ATLAS_SMOKE_DB_PASSWORD'),
    ssl: enabled(env.PHD_ATLAS_SMOKE_DB_SSL),
  }

  if (engine === 'postgresql' || engine === 'mssql') {
    config.schema = String(
      env.PHD_ATLAS_SMOKE_DB_SCHEMA
        ?? (engine === 'postgresql' ? 'public' : 'dbo'),
    ).trim()
  }
  if (engine === 'mysql') {
    config.mysql57Compatibility = enabled(env.PHD_ATLAS_SMOKE_MYSQL57_COMPATIBILITY)
  }

  return {
    enabled: true,
    config,
    readyTimeoutMs: parseReadyTimeout(env.PHD_ATLAS_SMOKE_READY_TIMEOUT_MS),
  }
}

function sleepFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForExternalDatabase(
  databaseApi,
  config,
  {
    timeoutMs = DEFAULT_READY_TIMEOUT_MS,
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    now = Date.now,
    sleep = sleepFor,
  } = {},
) {
  const deadline = now() + timeoutMs
  let lastError

  do {
    try {
      return await databaseApi.verifyDatabaseConnection(config, { ensure: false })
    } catch (error) {
      lastError = error
    }

    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(retryIntervalMs, remaining))
  } while (now() <= deadline)

  const error = new Error(
    `External ${config.type} database did not become ready within ${timeoutMs} ms.`,
  )
  error.code = 'DATABASE_SMOKE_NOT_READY'
  error.cause = lastError
  throw error
}

function smokePayload(engine, phase) {
  return Buffer.concat([
    Buffer.from(`phd-atlas-external-db-smoke:${engine}:${phase}:`, 'utf8'),
    BINARY_SENTINEL,
  ])
}

function assertStateMatches(actual, expected, label) {
  assert.ok(actual, `${label}: expected a persisted primary state row.`)
  assert.deepEqual(Buffer.from(actual.payload), expected.payload, `${label}: binary payload mismatch.`)
  assert.equal(Number(actual.revision), expected.revision, `${label}: revision mismatch.`)
  assert.equal(actual.updatedAt, expected.updatedAt, `${label}: updatedAt mismatch.`)
}

async function assertInsertOnlyRejectsOverwrite(databaseApi, config, state) {
  try {
    await databaseApi.writeExternalDatabaseState(
      config,
      smokePayload(config.type, 'unexpected-insert-only-overwrite'),
      state.revision + 1,
      new Date(Date.parse(state.updatedAt) + 1_000).toISOString(),
      { overwrite: false },
    )
  } catch (error) {
    assert.equal(
      error?.code,
      'DATABASE_TARGET_NOT_EMPTY',
      'insert-only duplicate must fail with DATABASE_TARGET_NOT_EMPTY.',
    )
    return
  }
  assert.fail('insert-only duplicate unexpectedly overwrote the primary state row.')
}

/**
 * Run the production adapter through connection, ensure, insert-only, overwrite,
 * and binary readback paths. The injected API exists solely for lightweight tests.
 */
export async function runExternalDatabaseSmoke({
  env = process.env,
  databaseApi = productionDatabaseApi,
  writeLine = (line) => process.stdout.write(`${line}\n`),
  waitOptions = {},
} = {}) {
  const settings = loadExternalDatabaseSmokeSettings(env)
  if (!settings.enabled) {
    const result = { status: 'skipped', reason: `${ENABLE_ENV} is not enabled` }
    writeLine(JSON.stringify(result))
    return result
  }

  const { config, readyTimeoutMs } = settings
  writeLine(JSON.stringify({ status: 'running', engine: config.type, stage: 'connection' }))
  await waitForExternalDatabase(databaseApi, config, {
    timeoutMs: readyTimeoutMs,
    ...waitOptions,
  })

  await databaseApi.verifyDatabaseConnection(config, { ensure: true })
  writeLine(JSON.stringify({ status: 'running', engine: config.type, stage: 'schema' }))

  const first = {
    payload: smokePayload(config.type, 'insert-only'),
    revision: 101,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  await databaseApi.writeExternalDatabaseState(
    config,
    first.payload,
    first.revision,
    first.updatedAt,
    { overwrite: false },
  )
  assertStateMatches(
    await databaseApi.readExternalDatabaseState(config),
    first,
    'insert-only readback',
  )
  await assertInsertOnlyRejectsOverwrite(databaseApi, config, first)
  assertStateMatches(
    await databaseApi.readExternalDatabaseState(config),
    first,
    'insert-only overwrite protection',
  )

  const second = {
    payload: smokePayload(config.type, 'overwrite'),
    revision: 102,
    updatedAt: '2026-01-01T00:01:00.000Z',
  }
  await databaseApi.writeExternalDatabaseState(
    config,
    second.payload,
    second.revision,
    second.updatedAt,
    { overwrite: true },
  )
  assertStateMatches(
    await databaseApi.readExternalDatabaseState(config),
    second,
    'overwrite readback',
  )

  const result = {
    status: 'passed',
    engine: config.type,
    checks: ['connection', 'schema', 'insert-only', 'overwrite-protection', 'binary-readback'],
  }
  writeLine(JSON.stringify(result))
  return result
}

export function redactSmokeFailure(error, env = process.env) {
  const secret = String(env.PHD_ATLAS_SMOKE_DB_PASSWORD ?? '')
  let message = String(error?.message ?? 'External database smoke test failed.')
  if (secret) message = message.split(secret).join('[redacted]')
  return {
    status: 'failed',
    code: String(error?.code ?? 'EXTERNAL_DATABASE_SMOKE_FAILED'),
    message,
  }
}

export async function runExternalDatabaseSmokeCli({
  env = process.env,
  databaseApi = productionDatabaseApi,
  writeLine = (line) => process.stdout.write(`${line}\n`),
  writeError = (line) => process.stderr.write(`${line}\n`),
  waitOptions = {},
} = {}) {
  try {
    const result = await runExternalDatabaseSmoke({
      env,
      databaseApi,
      writeLine,
      waitOptions,
    })
    return { exitCode: 0, result }
  } catch (error) {
    writeError(JSON.stringify(redactSmokeFailure(error, env)))
    return { exitCode: 1, error }
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
}

if (isDirectExecution()) {
  const { exitCode } = await runExternalDatabaseSmokeCli()
  process.exitCode = exitCode
}
