import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDatabaseTargetNotEmptyError,
  createExternalDatabaseSqlDump,
  decryptDatabasePassword,
  encryptDatabasePassword,
  normalizeDatabaseConfiguration,
  verifyDatabaseConnection,
} from './databaseConnection.js'
import { encryptSecret, setRuntimeCryptoConfig } from './crypto.js'

describe('database connection configuration', () => {
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
})
