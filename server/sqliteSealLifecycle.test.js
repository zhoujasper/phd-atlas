// @vitest-environment node

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockSeal = vi.hoisted(() => ({
  pause: false,
  entered: null,
  enter: null,
  release: null,
}))

vi.mock('./sqliteSeal.js', async () => {
  const actual = await vi.importActual('./sqliteSeal.js')
  return {
    ...actual,
    async sealSqliteBuffer(...args) {
      if (mockSeal.pause) {
        mockSeal.enter?.()
        await new Promise((resolve) => { mockSeal.release = resolve })
      }
      return actual.sealSqliteBuffer(...args)
    },
  }
})

let storage = null
let testRoot = null

afterEach(async () => {
  mockSeal.release?.()
  mockSeal.pause = false
  mockSeal.entered = null
  mockSeal.enter = null
  mockSeal.release = null
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
  testRoot = null
})

describe('SQLite seal lifecycle', () => {
  it('drains an in-flight seal before disabling encryption and removing the sealed image', async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-seal-lifecycle-'))
    vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
    vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
    vi.stubEnv('PHD_ATLAS_FORCE_SQLITE_SEAL_TEST', '1')
    vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64url'))
    vi.stubEnv('BOOTSTRAP_USER_PASSWORD', randomBytes(24).toString('base64url'))
    vi.stubEnv('BOOTSTRAP_ADMIN_PASSWORD', randomBytes(24).toString('base64url'))

    storage = await import('./storage.js')
    const enabling = await storage.readStore()
    enabling.settings.encryptionAtRest = true
    enabling.settings.sqliteEncryption = true
    await storage.writeStore(enabling)
    await storage.flushDurableStorage()

    mockSeal.entered = new Promise((resolve) => { mockSeal.enter = resolve })
    mockSeal.pause = true
    const current = await storage.readStore()
    await storage.insertNotificationIfNew(current.users[0].id, {
      type: 'system',
      title: 'Seal lifecycle probe',
      body: 'Deterministic in-flight seal transition coverage.',
      dedupeKey: 'sqlite-seal-lifecycle-probe',
      triggerDate: new Date().toISOString(),
    })
    await Promise.race([
      mockSeal.entered,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('The scheduled SQLite seal did not start.')),
        10_000,
      )),
    ])

    const disabling = await storage.readStore()
    disabling.settings.sqliteEncryption = false
    let transitionSettled = false
    const transition = storage.writeStore(disabling).finally(() => { transitionSettled = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(transitionSettled).toBe(false)

    mockSeal.pause = false
    mockSeal.release()
    mockSeal.release = null
    await transition
    await expect(fs.stat(storage.sealedDatabasePath)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)
})
