import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const TEST_EMAIL = 'jasper@example.com'
const TEST_PASSWORD = 'demo123456'
const APPLICATION_ID = 'fee_quota_application'
const EXISTING_FEE_ID = 'fee_quota_existing'

let app
let baseUrl
let server
let storage
let testRoot
let token

async function jsonRequest(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return { response, payload, data: payload.data }
}

async function persistedApplication() {
  const store = await storage.readStore()
  return store.applications.find((candidate) => candidate.id === APPLICATION_ID)
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-fee-quota-'))
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
  const template = store.applications[0]
  if (!user || !template) throw new Error('The isolated fee quota fixture is incomplete.')
  // Seed the large canonical row while the account can still own it. The
  // second write only lowers the limit; the storage transaction must allow an
  // administrator-style quota reduction without treating existing bytes as a
  // new allocation.
  user.settings = { ...(user.settings ?? {}), storageQuotaMb: 10 }
  store.applications.push({
    ...structuredClone(template),
    id: APPLICATION_ID,
    ownerId: user.id,
    teamId: null,
    program: 'q'.repeat(1_100_000),
    fees: [{
      id: EXISTING_FEE_ID,
      amount: 95,
      currency: 'GBP',
      paidDate: null,
      waived: false,
      notes: '',
      createdAt: '2026-08-02T00:00:00.000Z',
    }],
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  })
  await storage.lockedWriteStore(store)
  const limitedStore = await storage.readStore()
  const limitedUser = limitedStore.users.find((candidate) => candidate.email === TEST_EMAIL)
  if (!limitedUser) throw new Error('The isolated fee quota account disappeared.')
  limitedUser.settings = { ...(limitedUser.settings ?? {}), storageQuotaMb: 1 }
  await storage.lockedWriteStore(limitedStore)
  const usage = await storage.readWorkspaceQuotaUsage(user.id)
  expect(usage.personalBytes).toBeGreaterThan(1024 * 1024)

  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
  token = login.data.token
}, 90_000)

afterAll(async () => {
  await app?.locals.stopPersistedMailSyncWorker?.()
  await app?.locals.stopRecurringTasks?.()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe.sequential('application fee storage quota', () => {
  it('rejects a new fee above the authoritative personal quota without committing it', async () => {
    const before = await persistedApplication()
    const result = await jsonRequest(`/api/applications/${APPLICATION_ID}/fees`, {
      method: 'POST',
      body: JSON.stringify({
        amount: 125,
        currency: 'GBP',
        waived: false,
        notes: 'Must not be committed',
      }),
    })
    expect(result.response.status, JSON.stringify(result.payload)).toBe(413)
    expect(result.payload).toMatchObject({ error: { code: 'STORAGE_QUOTA_EXCEEDED' } })
    const after = await persistedApplication()
    expect(after.fees).toEqual(before.fees)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('rejects positive fee-note growth above quota without mutating the existing fee', async () => {
    const before = await persistedApplication()
    const result = await jsonRequest(
      `/api/applications/${APPLICATION_ID}/fees/${EXISTING_FEE_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'x'.repeat(500) }),
      },
    )
    expect(result.response.status, JSON.stringify(result.payload)).toBe(413)
    expect(result.payload).toMatchObject({ error: { code: 'STORAGE_QUOTA_EXCEEDED' } })
    const after = await persistedApplication()
    expect(after.fees).toEqual(before.fees)
    expect(after.updatedAt).toBe(before.updatedAt)
  })
})
