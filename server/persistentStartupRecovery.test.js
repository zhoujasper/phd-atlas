import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServer, stopServer } from './index.js'

const ENV_KEYS = [
  'STORAGE_STARTUP_RETRY_BASE_MS',
  'STORAGE_STARTUP_RETRY_MAX_MS',
  'STARTUP_RECOVERY_INITIAL_DELAY_MS',
]

let previousEnvironment

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for startup test state.')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

function startupOptions(overrides = {}) {
  return {
    port: 0,
    appOptions: {
      testHooks: {
        startupSubsystems: {
          uploadVault: vi.fn(async () => {}),
          webPush: vi.fn(async () => {}),
          browserPushJournal: vi.fn(async () => {}),
        },
      },
    },
    readStore: vi.fn(async () => ({ settings: {} })),
    ...overrides,
  }
}

beforeEach(() => {
  previousEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  process.env.STORAGE_STARTUP_RETRY_BASE_MS = '1'
  process.env.STORAGE_STARTUP_RETRY_MAX_MS = '2'
  process.env.STARTUP_RECOVERY_INITIAL_DELAY_MS = '60000'
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnvironment[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

describe('persistent core startup recovery', () => {
  it('resolves only after the HTTP listener has a real bound address', async () => {
    const server = await startServer(startupOptions({
      host: '127.0.0.1',
      ensureStorage: vi.fn(async () => {}),
    }))

    try {
      expect(server.listening).toBe(true)
      expect(server.address()).toMatchObject({
        address: '127.0.0.1',
        port: expect.any(Number),
      })
      expect(server.phdAtlasApp.locals.startupState.status).toBe('ready')
    } finally {
      await stopServer(server)
    }
  })

  it('cannot open a listener after an immediate stop during pending startup', async () => {
    let listenerServer
    let stopping
    const starting = startServer(startupOptions({
      host: '127.0.0.1',
      ensureStorage: vi.fn(async () => {}),
      onListener: (server) => {
        listenerServer = server
        stopping = stopServer(server)
      },
    }))

    await expect(starting).rejects.toMatchObject({ code: 'STARTUP_ABORTED' })
    await expect(stopping).resolves.toMatchObject({
      httpClosed: true,
      safeToShutdownStorage: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(listenerServer.listening).toBe(false)
    expect(listenerServer.address()).toBeNull()
  })

  it('keeps one listener alive while an encrypted SQLite lease handoff retries', async () => {
    let attempts = 0
    let releaseStorage
    let listenerServer
    let listenerApp
    const processRef = new EventEmitter()
    const legacyDirectMailSyncKick = vi.fn(async () => {})
    const storageGate = new Promise((resolve) => { releaseStorage = resolve })
    const ensureStorage = vi.fn(async (attempt) => {
      attempts = attempt
      if (attempt <= 8) {
        throw Object.assign(new Error('the previous encrypted SQLite worker is still handing off'), {
          code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_HELD',
        })
      }
      await storageGate
    })

    const starting = startServer(startupOptions({
      ensureStorage,
      kickPersistedMailSyncWorker: legacyDirectMailSyncKick,
      installStartupSignalHandlers: true,
      processRef,
      onListener: (server, app) => {
        listenerServer = server
        listenerApp = app
      },
    }))

    await waitFor(() => listenerServer?.listening && attempts >= 9)
    const port = listenerServer.address().port
    expect(processRef.listenerCount('SIGINT')).toBe(1)
    expect(processRef.listenerCount('SIGTERM')).toBe(1)

    const [live, ready, business] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/health/live`),
      fetch(`http://127.0.0.1:${port}/api/health/ready`),
      fetch(`http://127.0.0.1:${port}/api/auth/me`),
    ])
    expect(live.status).toBe(200)
    expect(await live.json()).toMatchObject({ data: { live: true } })
    expect(ready.status).toBe(503)
    expect(await ready.json()).toMatchObject({ error: { code: 'SERVER_STARTING' } })
    expect(business.status).toBe(503)
    expect(await business.json()).toMatchObject({ error: { code: 'SERVER_STARTING' } })

    const guardedTask = listenerApp.locals.recurringTasks.find((entry) => entry.name === 'retention-maintenance')
    await expect(guardedTask.run()).resolves.toEqual({
      skipped: true,
      reason: 'SERVER_STARTING',
    })

    releaseStorage()
    const readyServer = await starting
    expect(readyServer).toBe(listenerServer)
    expect(ensureStorage).toHaveBeenCalledTimes(9)
    expect(processRef.listenerCount('SIGINT')).toBe(0)
    expect(processRef.listenerCount('SIGTERM')).toBe(0)
    expect(legacyDirectMailSyncKick).not.toHaveBeenCalled()
    const readyAfterRecovery = await fetch(`http://127.0.0.1:${port}/api/health/ready`)
    expect(readyAfterRecovery.status).toBe(200)
    await stopServer(readyServer)
  })

  it('fails a non-retryable storage configuration error immediately', async () => {
    let listenerServer
    const processRef = new EventEmitter()
    const ensureStorage = vi.fn(async () => {
      throw Object.assign(new Error('saved credentials cannot be decrypted'), {
        code: 'DATABASE_CONFIG_UNREADABLE',
      })
    })

    await expect(startServer(startupOptions({
      ensureStorage,
      installStartupSignalHandlers: true,
      processRef,
      onListener: (server) => { listenerServer = server },
    }))).rejects.toMatchObject({ code: 'DATABASE_CONFIG_UNREADABLE' })

    expect(ensureStorage).toHaveBeenCalledOnce()
    expect(listenerServer.listening).toBe(false)
    expect(processRef.listenerCount('SIGINT')).toBe(0)
    expect(processRef.listenerCount('SIGTERM')).toBe(0)
  })

  it.each(['stopServer', 'SIGINT', 'SIGTERM'])('interrupts a pending retry delay through %s', async (stopMethod) => {
    process.env.STORAGE_STARTUP_RETRY_BASE_MS = '5000'
    process.env.STORAGE_STARTUP_RETRY_MAX_MS = '5000'
    let listenerServer
    const processRef = new EventEmitter()
    let attempts = 0
    const ensureStorage = vi.fn(async () => {
      attempts += 1
      throw Object.assign(new Error('database still unavailable'), {
        code: 'DATABASE_CONNECTION_FAILED',
      })
    })
    const starting = startServer(startupOptions({
      ensureStorage,
      installStartupSignalHandlers: true,
      processRef,
      onListener: (server) => { listenerServer = server },
    }))
    await waitFor(() => listenerServer?.listening && attempts === 1)

    if (stopMethod === 'stopServer') await stopServer(listenerServer)
    else processRef.emit(stopMethod)
    await expect(starting).rejects.toMatchObject({ code: 'STARTUP_ABORTED' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(attempts).toBe(1)
    expect(listenerServer.listening).toBe(false)
    expect(processRef.listenerCount('SIGINT')).toBe(0)
    expect(processRef.listenerCount('SIGTERM')).toBe(0)
  })
})
