import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'

const UNLOCK_PASSWORD = 'lock-4321'

describe('desktop opening password and auto session', () => {
  let app
  let server
  let baseUrl
  let storageRoot
  let token

  async function jsonRequest(pathname, options = {}, currentToken = token) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
        ...(options.headers ?? {}),
      },
    })
    const payload = await response.json().catch(() => ({}))
    return { response, payload, data: payload.data }
  }

  async function startDesktopApp() {
    const next = createApp({ desktopEnabled: true, desktopStorageRoot: storageRoot })
    const listener = next.listen(0, '127.0.0.1')
    await new Promise((resolve) => listener.once('listening', resolve))
    return {
      app: next,
      server: listener,
      baseUrl: `http://127.0.0.1:${listener.address().port}`,
    }
  }

  async function stopDesktopApp(instance) {
    await instance.app?.locals.stopPersistedMailSyncWorker?.()
    await instance.app?.locals.stopRecurringTasks?.()
    if (instance.server) await new Promise((resolve) => instance.server.close(resolve))
  }

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'phd-atlas-desktop-unlock-'))
    const started = await startDesktopApp()
    app = started.app
    server = started.server
    baseUrl = started.baseUrl
  }, 90_000)

  afterAll(async () => {
    await stopDesktopApp({ app, server })
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true })
  }, 90_000)

  it('opens a local desktop session without a web login', async () => {
    const runtime = await jsonRequest('/api/desktop/runtime', {}, null)
    expect(runtime.response.status).toBe(200)
    expect(runtime.data.enabled).toBe(true)
    expect(runtime.data.unlockRequired).toBe(false)
    expect(runtime.data.unlocked).toBe(true)

    const session = await jsonRequest('/api/desktop/session', {
      method: 'POST',
      body: '{}',
    }, null)
    expect(session.response.status, JSON.stringify(session.payload)).toBe(200)
    expect(session.data.token).toMatch(/\S/)
    expect(session.data.user?.id).toBeTruthy()
    token = session.data.token

    const me = await jsonRequest('/api/auth/me')
    expect(me.response.status).toBe(200)
    expect(me.data.user.id).toBe(session.data.user.id)
  })

  it('rejects a mismatched or too-short opening password and keeps the app unlocked in this process', async () => {
    const short = await jsonRequest('/api/desktop/unlock-password', {
      method: 'POST',
      body: JSON.stringify({ enabled: true, password: 'ab', confirmPassword: 'ab' }),
    })
    expect(short.response.status).toBe(400)
    expect(short.payload.error.code).toBe('DESKTOP_UNLOCK_TOO_SHORT')

    const mismatch = await jsonRequest('/api/desktop/unlock-password', {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        password: UNLOCK_PASSWORD,
        confirmPassword: 'lock-9999',
      }),
    })
    expect(mismatch.response.status).toBe(400)
    expect(mismatch.payload.error.code).toBe('DESKTOP_UNLOCK_MISMATCH')

    const enabled = await jsonRequest('/api/desktop/unlock-password', {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        password: UNLOCK_PASSWORD,
        confirmPassword: UNLOCK_PASSWORD,
      }),
    })
    expect(enabled.response.status, JSON.stringify(enabled.payload)).toBe(200)
    expect(enabled.data.unlockRequired).toBe(true)
    expect(enabled.data.unlocked).toBe(true)

    const stillOpen = await jsonRequest('/api/auth/me')
    expect(stillOpen.response.status).toBe(200)
  })

  it('requires the opening password only after the desktop process is restarted', async () => {
    await stopDesktopApp({ app, server })
    const restarted = await startDesktopApp()
    app = restarted.app
    server = restarted.server
    baseUrl = restarted.baseUrl

    const runtime = await jsonRequest('/api/desktop/runtime', {}, null)
    expect(runtime.data.unlockRequired).toBe(true)
    expect(runtime.data.unlocked).toBe(false)

    const blockedSession = await jsonRequest('/api/desktop/session', {
      method: 'POST',
      body: '{}',
    }, null)
    expect(blockedSession.response.status).toBe(401)
    expect(blockedSession.payload.error.code).toBe('DESKTOP_UNLOCK_REQUIRED')

    const blockedMe = await jsonRequest('/api/auth/me')
    expect(blockedMe.response.status).toBe(401)
    expect(blockedMe.payload.error.code).toBe('DESKTOP_UNLOCK_REQUIRED')

    const wrong = await jsonRequest('/api/desktop/unlock', {
      method: 'POST',
      body: JSON.stringify({ password: 'wrong-password' }),
    }, null)
    expect(wrong.response.status).toBe(401)
    expect(wrong.payload.error.code).toBe('DESKTOP_UNLOCK_INVALID')

    const unlocked = await jsonRequest('/api/desktop/unlock', {
      method: 'POST',
      body: JSON.stringify({ password: UNLOCK_PASSWORD }),
    }, null)
    expect(unlocked.response.status, JSON.stringify(unlocked.payload)).toBe(200)
    expect(unlocked.data.runtime.unlocked).toBe(true)
    token = unlocked.data.token

    const me = await jsonRequest('/api/auth/me')
    expect(me.response.status).toBe(200)

    const again = await jsonRequest('/api/desktop/session', {
      method: 'POST',
      body: '{}',
    }, null)
    expect(again.response.status).toBe(200)
  }, 90_000)
})
