import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let app
let baseUrl
let requestSystemUpdateGracefulShutdown
let server
let sessionToken
let storage
let testRoot

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-update-shutdown-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('TRUST_PROXY', 'loopback')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.stubEnv('PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST', '1')
  vi.doMock('./edition.js', () => ({
    PUBLIC_DISTRIBUTION: true,
    PUBLIC_EDITION: false,
  }))
  vi.resetModules()

  storage = await import('./storage.js')
  await storage.ensureStorage()
  const store = await storage.readStore()
  const administrator = store.users.find((user) => user.email === 'jasper@example.com')
  if (!administrator) throw new Error('Missing isolated administrator seed account.')
  administrator.role = 'admin'
  await storage.writeStore(store)
  const index = await import('./index.js')
  requestSystemUpdateGracefulShutdown = index.requestSystemUpdateGracefulShutdown
  app = index.createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  app.locals.qaListenerAddress = address.address
  baseUrl = `http://127.0.0.1:${address.port}`

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456' }),
  })
  const payload = await login.json()
  expect(login.status, JSON.stringify(payload)).toBe(200)
  sessionToken = payload.data.token
}, 90_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.doUnmock('./edition.js')
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe.sequential('system update graceful-shutdown boundary', () => {
  it('threads the immutable scheduled-lock receipt through every cleanup branch', async () => {
    const source = await fs.readFile(path.resolve(process.cwd(), 'server', 'index.js'), 'utf8')
    const start = source.indexOf('function scheduleStoredSystemUpdate(')
    const end = source.indexOf('\n  async function recordStoredSystemUpdate(', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const scheduleSource = source.slice(start, end)
    expect(scheduleSource).toContain('scheduledLock = await writeUpdateLock(updateStorageRoot, {')
    const cleanupArguments = [...scheduleSource.matchAll(/clearUpdateLock\(([^)]*)\)/g)]
      .map((match) => match[1].replace(/\s+/g, ' ').trim())
    expect(cleanupArguments).toEqual([
      'updateStorageRoot, scheduledLock',
      'updateStorageRoot, scheduledLock',
      'updateStorageRoot, scheduledLock',
    ])
  })

  it('delegates the exact update exit request without directly exiting', async () => {
    const requestShutdown = vi.fn().mockResolvedValue({
      durabilityPreserved: true,
      safeToExit: true,
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined)
    try {
      await expect(requestSystemUpdateGracefulShutdown(requestShutdown)).resolves.toMatchObject({
        durabilityPreserved: true,
        safeToExit: true,
      })
      expect(requestShutdown).toHaveBeenCalledOnce()
      expect(requestShutdown).toHaveBeenCalledWith({
        expectedExitCode: 75,
        reason: 'system-update',
      })
      expect(exit).not.toHaveBeenCalled()
    } finally {
      exit.mockRestore()
    }
  })

  it('returns a controlled 503 when a production update has no launcher callback', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const response = await fetch(`${baseUrl}/api/admin/system-update/install-release`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json',
          'x-forwarded-proto': 'https',
        },
        body: JSON.stringify({ tagName: 'v0.2.0' }),
      })
      const payload = await response.json()
      expect(response.status, JSON.stringify(payload)).toBe(503)
      expect(payload).toMatchObject({
        ok: false,
        error: { code: 'UPDATE_GRACEFUL_SHUTDOWN_UNAVAILABLE' },
      })
    } finally {
      vi.stubEnv('NODE_ENV', 'test')
    }
  })

  it('fails closed when the shutdown callback is absent', async () => {
    await expect(requestSystemUpdateGracefulShutdown(null)).rejects.toMatchObject({
      status: 503,
      code: 'UPDATE_GRACEFUL_SHUTDOWN_UNAVAILABLE',
    })
  })
})
