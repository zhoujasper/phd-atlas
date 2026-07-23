import { describe, expect, it, vi } from 'vitest'

import {
  loadExternalDatabaseSmokeSettings,
  runExternalDatabaseSmoke,
  runExternalDatabaseSmokeCli,
} from '../tools/smoke-external-database.mjs'

const enabledBase = {
  PHD_ATLAS_RUN_EXTERNAL_DB_SMOKE: '1',
  PHD_ATLAS_SMOKE_DB_HOST: '127.0.0.1',
  PHD_ATLAS_SMOKE_DB_PORT: '1433',
  PHD_ATLAS_SMOKE_DB_NAME: 'master',
  PHD_ATLAS_SMOKE_DB_USER: 'smoke_user',
  PHD_ATLAS_SMOKE_DB_PASSWORD: 'not-a-real-password',
  PHD_ATLAS_SMOKE_DB_SSL: 'false',
}

function createMemoryDatabaseApi({ corruptFirstRead = false } = {}) {
  let state = null
  let readCount = 0
  const calls = []

  return {
    calls,
    async verifyDatabaseConnection(config, options) {
      calls.push({ method: 'verify', type: config.type, options })
      return { type: config.type, passwordSet: true }
    },
    async writeExternalDatabaseState(config, payload, revision, updatedAt, options) {
      calls.push({ method: 'write', type: config.type, options })
      if (options?.overwrite === false && state) {
        const error = new Error('Target is not empty.')
        error.code = 'DATABASE_TARGET_NOT_EMPTY'
        throw error
      }
      state = {
        payload: Buffer.from(payload),
        revision,
        updatedAt,
      }
    },
    async readExternalDatabaseState(config) {
      calls.push({ method: 'read', type: config.type })
      readCount += 1
      if (!state) return null
      return {
        ...state,
        payload: corruptFirstRead && readCount === 1
          ? Buffer.from('corrupt')
          : Buffer.from(state.payload),
      }
    },
  }
}

describe('external database smoke configuration', () => {
  it('skips without validating or calling a database by default', async () => {
    const databaseApi = {
      verifyDatabaseConnection: vi.fn(),
    }
    const output = []

    const result = await runExternalDatabaseSmoke({
      env: {},
      databaseApi,
      writeLine: (line) => output.push(line),
    })

    expect(result.status).toBe('skipped')
    expect(databaseApi.verifyDatabaseConnection).not.toHaveBeenCalled()
    expect(JSON.parse(output[0])).toMatchObject({ status: 'skipped' })
  })

  it.each([
    ['mssql', { schema: 'phd_atlas_ci', mysql57Compatibility: undefined }],
    ['postgresql', { schema: 'public', mysql57Compatibility: undefined }],
    ['mysql', { schema: undefined, mysql57Compatibility: true }],
  ])('maps %s environment variables to the production configuration', (engine, expected) => {
    const settings = loadExternalDatabaseSmokeSettings({
      ...enabledBase,
      PHD_ATLAS_SMOKE_DB_ENGINE: engine,
      PHD_ATLAS_SMOKE_DB_SCHEMA: engine === 'mssql' ? 'phd_atlas_ci' : undefined,
      PHD_ATLAS_SMOKE_MYSQL57_COMPATIBILITY: engine === 'mysql' ? 'true' : undefined,
    })

    expect(settings.enabled).toBe(true)
    expect(settings.config).toMatchObject({
      type: engine,
      host: '127.0.0.1',
      port: 1433,
      database: 'master',
      username: 'smoke_user',
      password: 'not-a-real-password',
      ssl: false,
    })
    expect(settings.config.schema).toBe(expected.schema)
    expect(settings.config.mysql57Compatibility).toBe(expected.mysql57Compatibility)
    expect(settings.readyTimeoutMs).toBe(180_000)
  })

  it('rejects unsupported engines before making a connection', () => {
    expect(() => loadExternalDatabaseSmokeSettings({
      ...enabledBase,
      PHD_ATLAS_SMOKE_DB_ENGINE: 'sqlite',
    })).toThrow(/mysql, postgresql, mssql/)
  })
})

describe('external database smoke assertions', () => {
  it('covers connection, ensure, insert-only protection, overwrite, and binary readback', async () => {
    const databaseApi = createMemoryDatabaseApi()
    const output = []

    const result = await runExternalDatabaseSmoke({
      env: {
        ...enabledBase,
        PHD_ATLAS_SMOKE_DB_ENGINE: 'mssql',
        PHD_ATLAS_SMOKE_DB_SCHEMA: 'phd_atlas_ci',
      },
      databaseApi,
      writeLine: (line) => output.push(line),
      waitOptions: { retryIntervalMs: 0 },
    })

    expect(result.status).toBe('passed')
    expect(databaseApi.calls.filter(({ method }) => method === 'verify')).toEqual([
      { method: 'verify', type: 'mssql', options: { ensure: false } },
      { method: 'verify', type: 'mssql', options: { ensure: true } },
    ])
    expect(databaseApi.calls.filter(({ method }) => method === 'write').map(({ options }) => options)).toEqual([
      { overwrite: false },
      { overwrite: false },
      { overwrite: true },
    ])
    expect(JSON.parse(output.at(-1))).toMatchObject({
      status: 'passed',
      engine: 'mssql',
    })
  })

  it('returns a non-zero CLI result and redacts the configured password on assertion failure', async () => {
    const password = 'Secret!must-not-leak'
    const errors = []

    const result = await runExternalDatabaseSmokeCli({
      env: {
        ...enabledBase,
        PHD_ATLAS_SMOKE_DB_ENGINE: 'postgresql',
        PHD_ATLAS_SMOKE_DB_PASSWORD: password,
      },
      databaseApi: createMemoryDatabaseApi({ corruptFirstRead: true }),
      writeLine: () => undefined,
      writeError: (line) => errors.push(line),
      waitOptions: { retryIntervalMs: 0 },
    })

    expect(result.exitCode).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toContain(password)
    expect(JSON.parse(errors[0])).toMatchObject({ status: 'failed' })
  })
})
