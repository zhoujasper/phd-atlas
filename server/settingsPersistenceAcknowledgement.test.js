import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const previousStorageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
let isolatedStorageRoot
let createApp
let shutdownStorage
const openApps = []

beforeAll(async () => {
  isolatedStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-settings-ack-'))
  process.env.PHD_ATLAS_STORAGE_ROOT = isolatedStorageRoot
  const [indexModule, storageModule] = await Promise.all([
    import('./index.js'),
    import('./storage.js'),
  ])
  ;({ createApp } = indexModule)
  ;({ shutdownStorage } = storageModule)
}, 60_000)

async function startTestApp() {
  const app = createApp()
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const running = { app, server, baseUrl: `http://127.0.0.1:${address.port}` }
  openApps.push(running)
  return running
}

async function stopTestApp(running) {
  const index = openApps.indexOf(running)
  if (index >= 0) openApps.splice(index, 1)
  await running.app.locals.stopRecurringTasks(new Error('Settings acknowledgement test stopped.'))
  if (running.server.listening) {
    await new Promise((resolve, reject) => running.server.close((error) => (
      error ? reject(error) : resolve()
    )))
  }
}

async function jsonRequest(baseUrl, pathname, token, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  return { response, payload: await response.json() }
}

async function login(baseUrl) {
  const result = await jsonRequest(baseUrl, '/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@phd-atlas.local',
      password: 'admin123456',
    }),
  })
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  return result.payload.data
}

afterAll(async () => {
  for (const running of openApps.splice(0)) {
    await stopTestApp(running).catch(() => undefined)
  }
  if (typeof shutdownStorage === 'function') await shutdownStorage()
  if (isolatedStorageRoot) await fs.rm(isolatedStorageRoot, { recursive: true, force: true })
  if (previousStorageRoot === undefined) delete process.env.PHD_ATLAS_STORAGE_ROOT
  else process.env.PHD_ATLAS_STORAGE_ROOT = previousStorageRoot
}, 60_000)

describe.sequential('durable settings acknowledgement', () => {
  it('rejects settings writers that do not use the current acknowledgement protocol', async () => {
    const running = await startTestApp()
    try {
      const session = await login(running.baseUrl)
      const outdated = await jsonRequest(running.baseUrl, '/api/settings', session.token, {
        method: 'PATCH',
        body: JSON.stringify({ language: 'en' }),
      })

      expect(outdated.response.status).toBe(400)
      expect(outdated.payload).toMatchObject({
        error: { code: 'SETTINGS_ACKNOWLEDGEMENT_INVALID' },
      })
    } finally {
      await stopTestApp(running)
    }
  })

  it('binds the exact patch and secret presence to a fresh read across restart', async () => {
    const first = await startTestApp()
    const session = await login(first.baseUrl)
    const mutationId = `settings-receipt-${Date.now()}`
    const patch = {
      browserNotificationsEnabled: true,
      smtpHost: 'smtp.receipt.example.test',
      smtpPort: 587,
      smtpUser: 'admin@phd-atlas.local',
      smtpPass: 'test-only-settings-receipt-secret',
      smtpTls: true,
    }
    const saved = await jsonRequest(first.baseUrl, '/api/settings', session.token, {
      method: 'PATCH',
      headers: {
        'X-PhD-Settings-Acknowledgement': 'v1',
        'X-PhD-Settings-Mutation-Id': mutationId,
      },
      body: JSON.stringify(patch),
    })

    expect(saved.response.status, JSON.stringify(saved.payload)).toBe(200)
    expect(saved.payload.data).toMatchObject({
      protocol: 'phd-atlas-settings-ack-v1',
      version: 1,
      durable: true,
      mutationId,
      keys: Object.keys(patch).sort(),
      secretReceipts: {
        smtpPass: { operation: 'set', present: true },
      },
      user: {
        id: session.user.id,
        settings: {
          browserNotificationsEnabled: true,
          smtpHost: patch.smtpHost,
          smtpPass: '',
          smtpPassSet: true,
        },
      },
    })
    expect(saved.payload.data.settingsVersion).toBeGreaterThan(session.user.settingsVersion)
    expect(saved.payload.data.secretReceipts.smtpPass.version)
      .toBe(saved.payload.data.settingsVersion)
    expect(saved.payload.data.user.settingsVersion).toBe(saved.payload.data.settingsVersion)

    const fresh = await jsonRequest(first.baseUrl, '/api/auth/me', session.token)
    expect(fresh.response.status, JSON.stringify(fresh.payload)).toBe(200)
    expect(fresh.payload.data.user).toMatchObject({
      settingsVersion: saved.payload.data.settingsVersion,
      settings: {
        browserNotificationsEnabled: true,
        smtpHost: patch.smtpHost,
        smtpPass: '',
        smtpPassSet: true,
      },
    })

    await stopTestApp(first)
    await shutdownStorage()

    const second = await startTestApp()
    const restartedSession = await login(second.baseUrl)
    const restarted = await jsonRequest(second.baseUrl, '/api/auth/me', restartedSession.token)
    expect(restarted.response.status, JSON.stringify(restarted.payload)).toBe(200)
    expect(restarted.payload.data.user).toMatchObject({
      settingsVersion: saved.payload.data.settingsVersion,
      settings: {
        browserNotificationsEnabled: true,
        smtpHost: patch.smtpHost,
        smtpPass: '',
        smtpPassSet: true,
      },
    })
    expect(JSON.stringify(restarted.payload)).not.toContain(patch.smtpPass)
    await stopTestApp(second)
  })
})
