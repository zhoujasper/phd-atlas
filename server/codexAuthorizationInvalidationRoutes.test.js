import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const TEST_EMAIL = 'jasper@example.com'
const TEST_PASSWORD = 'demo123456'

let app
let server
let baseUrl
let storage
let testRoot
let userId
let originalAuthVersion
let originalDisabledAt

async function request(route, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, payload: await response.json() }
}

async function updateAccount(update) {
  await storage.withWriteLock(async () => {
    const store = await storage.readStore()
    const user = store.users.find((candidate) => candidate.id === userId)
    if (!user) throw new Error(`Missing isolated test account ${userId}`)
    await update(user)
    await storage.writeStore(store)
  })
}

async function issueAuthorization(label) {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: TEST_EMAIL, password: TEST_PASSWORD },
  })
  expect(login.response.status, JSON.stringify(login.payload)).toBe(200)

  const created = await request('/api/codex/authorizations', {
    token: login.payload.data.token,
    method: 'POST',
    body: {
      name: label,
      scopeVersion: 2,
      scopes: ['applications:read'],
      expiresInDays: 30,
    },
  })
  expect(created.response.status, JSON.stringify(created.payload)).toBe(201)

  const authorization = created.payload.data
  const baseline = await request('/api/codex/whoami', { token: authorization.token })
  expect(baseline.response.status, JSON.stringify(baseline.payload)).toBe(200)
  expect(baseline.response.headers.get('x-session-token')).toBeNull()
  return authorization
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-codex-invalidation-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.resetModules()

  storage = await import('./storage.js')
  await storage.ensureStorage()
  const store = await storage.readStore()
  const user = store.users.find((candidate) => candidate.email === TEST_EMAIL)
  if (!user) throw new Error(`Missing isolated seed account ${TEST_EMAIL}`)
  userId = user.id
  originalAuthVersion = Number(user.settings?.authVersion ?? 0)
  originalDisabledAt = user.disabledAt ?? null

  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 90_000)

afterEach(async () => {
  if (!storage || !userId) return
  await storage.revokeAllCodexAuthorizations(userId, { reason: 'focused_test_cleanup' })
  await updateAccount((user) => {
    user.settings = {
      ...(user.settings ?? {}),
      authVersion: originalAuthVersion,
    }
    user.disabledAt = originalDisabledAt
  })
})

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe.sequential('Codex authorization HTTP invalidation', () => {
  it('rejects the same PAT immediately after the account authVersion changes', async () => {
    const authorization = await issueAuthorization('Auth version invalidation')
    await updateAccount((user) => {
      user.settings = {
        ...(user.settings ?? {}),
        authVersion: Number(user.settings?.authVersion ?? 0) + 1,
      }
    })

    const rejected = await request('/api/codex/whoami', { token: authorization.token })
    expect(rejected.response.status).toBe(401)
    expect(rejected.payload).toMatchObject({ ok: false })
  })

  it('rejects the same PAT immediately after the account is disabled', async () => {
    const authorization = await issueAuthorization('Disabled account invalidation')
    await updateAccount((user) => {
      user.disabledAt = new Date().toISOString()
    })

    const rejected = await request('/api/codex/whoami', { token: authorization.token })
    expect(rejected.response.status).toBe(401)
    expect(rejected.payload).toMatchObject({ ok: false })
  })

  it('rejects the same PAT at its absolute expiresAt boundary', async () => {
    const authorization = await issueAuthorization('Absolute expiry invalidation')
    const expiresAtMs = Date.now() + 1_000
    const expiresAt = new Date(expiresAtMs).toISOString()
    await storage.updateCodexAuthorization(
      userId,
      authorization.authorization.id,
      { expiresAt },
      { actorId: userId },
    )
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAtMs - Date.now() + 25)))
    expect(Date.now()).toBeGreaterThanOrEqual(expiresAtMs)

    const rejected = await request('/api/codex/whoami', { token: authorization.token })
    expect(rejected.response.status).toBe(401)
    expect(rejected.payload).toMatchObject({ ok: false })
  })
})
