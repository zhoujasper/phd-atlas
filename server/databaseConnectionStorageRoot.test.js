import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanupRoots = []

async function loadDatabaseConnection({ storageRoot = '', sqlitePath = '' } = {}) {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', storageRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.resetModules()
  return import('./databaseConnection.js')
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetModules()
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.sequential('database configuration storage root', () => {
  it('uses one safe runtime root for default first-run SQLite setup when no root env is configured', async () => {
    const database = await loadDatabaseConnection()
    cleanupRoots.push(database.runtimeStorageRoot)

    expect(database.defaultSqlitePath).toBe(path.join(database.runtimeStorageRoot, 'phd-atlas.sqlite'))
    expect(database.databaseConfigPath).toBe(path.join(database.runtimeStorageRoot, 'database-connection.json'))
    await expect(database.verifyDatabaseConnection(
      { type: 'sqlite', sqlitePath: database.defaultSqlitePath },
      { setupSafety: true },
    )).resolves.toMatchObject({
      type: 'sqlite',
      sqlitePath: database.defaultSqlitePath,
    })
  })

  it('honours the explicit storage root and rejects lexical and symlink escapes by default', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-database-root-'))
    cleanupRoots.push(testRoot)
    const storageRoot = path.join(testRoot, 'storage')
    const outsideRoot = path.join(testRoot, 'outside')
    await mkdir(storageRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })

    const database = await loadDatabaseConnection({ storageRoot })
    expect(database.runtimeStorageRoot).toBe(path.resolve(storageRoot))
    await expect(database.verifyDatabaseConnection(
      { type: 'sqlite', sqlitePath: path.join(storageRoot, 'nested', 'workspace.sqlite') },
      { setupSafety: true },
    )).resolves.toMatchObject({ type: 'sqlite' })
    await expect(database.verifyDatabaseConnection(
      { type: 'sqlite', sqlitePath: path.join(testRoot, 'outside.sqlite') },
      { setupSafety: true },
    )).rejects.toMatchObject({ code: 'DATABASE_PATH_OUTSIDE_STORAGE_ROOT' })

    const linkedRoot = path.join(storageRoot, 'linked')
    await symlink(outsideRoot, linkedRoot, 'junction')
    await expect(database.verifyDatabaseConnection(
      { type: 'sqlite', sqlitePath: path.join(linkedRoot, 'workspace.sqlite') },
      { setupSafety: true },
    )).rejects.toMatchObject({ code: 'DATABASE_PATH_OUTSIDE_STORAGE_ROOT' })
  })

  it('persists configuration beneath the explicit root and reads it after a fresh module load', async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-database-persist-'))
    cleanupRoots.push(storageRoot)
    const sqlitePath = path.join(storageRoot, 'workspace.sqlite')

    const database = await loadDatabaseConnection({ storageRoot })
    await expect(database.persistDatabaseConfiguration({ type: 'sqlite', sqlitePath })).resolves.toEqual({
      type: 'sqlite',
      sqlitePath,
    })

    vi.resetModules()
    const restartedDatabase = await import('./databaseConnection.js')
    expect(restartedDatabase.runtimeStorageRoot).toBe(path.resolve(storageRoot))
    await expect(restartedDatabase.readPersistedDatabaseConfiguration()).resolves.toEqual({
      type: 'sqlite',
      sqlitePath,
    })
  })
})
