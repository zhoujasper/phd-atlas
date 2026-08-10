import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const TEST_PASSWORD = 'Codex account isolation 2026!'

let app
let server
let baseUrl
let storage
let testRoot
let accounts

async function request(route, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  return { response, payload, data: payload?.data }
}

async function loginAndAuthorize(account) {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: TEST_PASSWORD },
  })
  expect(login.response.status, JSON.stringify(login.payload)).toBe(200)

  const created = await request('/api/codex/authorizations', {
    token: login.data.token,
    method: 'POST',
    body: {
      name: `Isolation ${account.name}`,
      scopeVersion: 2,
      scopes: [
        'applications:read',
        'applications:write',
        'profile:read',
        'profile:write',
      ],
      expiresInDays: 30,
    },
  })
  expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
  const whoami = await request('/api/codex/whoami', { token: created.data.token })
  expect(whoami.response.status, JSON.stringify(whoami.payload)).toBe(200)
  expect(whoami.data.user).toMatchObject({ id: account.id, email: account.email })
  return created.data.token
}

async function createApplication(token, label) {
  const created = await request('/api/applications', {
    token,
    method: 'POST',
    body: {
      professor: `Professor ${label}`,
      professorChinese: '',
      professorEmail: `${label.toLowerCase()}@example.edu`,
      professorHomepage: '',
      university: `${label} Isolation University`,
      country: 'United Kingdom',
      website: '',
      program: `${label} Private Programme`,
      deadline: '2027-01-15',
      notes: `${label} account private notes`,
      visibleToTeam: false,
    },
  })
  expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
  expect(created.data).toMatchObject({
    protocol: 'phd-atlas-application-mutation-ack-v2',
    durable: true,
    id: expect.any(String),
  })
  const canonical = await request(`/api/applications/${encodeURIComponent(created.data.id)}`, { token })
  expect(canonical.response.status, JSON.stringify(canonical.payload)).toBe(200)
  return canonical.data
}

async function createProfileAsset(token, label) {
  const created = await request('/api/profile-assets', {
    token,
    method: 'POST',
    body: {
      name: `${label} private profile asset`,
      kind: 'Other',
      description: `${label} private description`,
      notes: `${label} private profile notes`,
    },
  })
  expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
  return created.data
}

function expectHidden(collection, hiddenId) {
  expect(collection.some((item) => item.id === hiddenId)).toBe(false)
}

function expectCrossAccountDenied(result) {
  expect([403, 404]).toContain(result.response.status)
  expect(result.payload).toMatchObject({ ok: false })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-codex-account-isolation-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.resetModules()

  storage = await import('./storage.js')
  const { hashAccountPassword } = await import('./passwordSecurity.js')
  await storage.ensureStorage()
  const passwordHash = await hashAccountPassword(TEST_PASSWORD)
  const stamp = `${Date.now()}_${randomBytes(5).toString('hex')}`
  accounts = ['alpha', 'bravo'].map((label) => ({
    id: `user_codex_isolation_${label}_${stamp}`,
    name: `Codex Isolation ${label}`,
    email: `codex-isolation-${label}-${stamp}@example.test`,
  }))
  await storage.withWriteLock(async () => {
    const store = await storage.readStore()
    const createdAt = new Date().toISOString()
    store.users.push(...accounts.map((account) => ({
      ...account,
      role: 'user',
      passwordHash,
      createdAt,
      lastLoginAt: null,
      disabledAt: null,
      settings: {
        language: 'en',
        membershipPlan: 'pro',
        personalMembershipPlan: 'pro',
        authVersion: 0,
      },
    })))
    await storage.writeStore(store)
  })

  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 120_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe.sequential('Codex authorization account isolation', () => {
  it('never reads or mutates another account application or profile resource', async () => {
    const [alpha, bravo] = accounts
    const [alphaToken, bravoToken] = await Promise.all([
      loginAndAuthorize(alpha),
      loginAndAuthorize(bravo),
    ])
    // Keep mutations sequential so the test measures authorization isolation,
    // not the server's intentionally bounded concurrent-mutation admission.
    const alphaApplication = await createApplication(alphaToken, 'Alpha')
    const bravoApplication = await createApplication(bravoToken, 'Bravo')
    const alphaAsset = await createProfileAsset(alphaToken, 'Alpha')
    const bravoAsset = await createProfileAsset(bravoToken, 'Bravo')

    const alphaUpdated = await request(`/api/applications/${alphaApplication.id}`, {
      token: alphaToken,
      method: 'PUT',
      body: { ...alphaApplication, program: 'Alpha owner update' },
    })
    const bravoUpdated = await request(`/api/applications/${bravoApplication.id}`, {
      token: bravoToken,
      method: 'PUT',
      body: { ...bravoApplication, program: 'Bravo owner update' },
    })
    const alphaAssetUpdated = await request(`/api/profile-assets/${alphaAsset.id}`, {
      token: alphaToken,
      method: 'PATCH',
      body: { notes: 'Alpha owner profile update' },
    })
    const bravoAssetUpdated = await request(`/api/profile-assets/${bravoAsset.id}`, {
      token: bravoToken,
      method: 'PATCH',
      body: { notes: 'Bravo owner profile update' },
    })
    for (const result of [alphaUpdated, bravoUpdated, alphaAssetUpdated, bravoAssetUpdated]) {
      expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    }

    const [alphaApplications, bravoApplications, alphaAssets, bravoAssets] = await Promise.all([
      request('/api/applications', { token: alphaToken }),
      request('/api/applications', { token: bravoToken }),
      request('/api/profile-assets', { token: alphaToken }),
      request('/api/profile-assets', { token: bravoToken }),
    ])
    for (const result of [alphaApplications, bravoApplications, alphaAssets, bravoAssets]) {
      expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    }
    expect(alphaApplications.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: alphaApplication.id, program: 'Alpha owner update' }),
    ]))
    expectHidden(alphaApplications.data, bravoApplication.id)
    expect(bravoApplications.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: bravoApplication.id, program: 'Bravo owner update' }),
    ]))
    expectHidden(bravoApplications.data, alphaApplication.id)
    expect(alphaAssets.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: alphaAsset.id, notes: 'Alpha owner profile update' }),
    ]))
    expectHidden(alphaAssets.data, bravoAsset.id)
    expect(bravoAssets.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: bravoAsset.id, notes: 'Bravo owner profile update' }),
    ]))
    expectHidden(bravoAssets.data, alphaAsset.id)

    const crossRequests = []
    crossRequests.push(await request(`/api/applications/${bravoApplication.id}`, { token: alphaToken }))
    crossRequests.push(await request(`/api/applications/${alphaApplication.id}`, { token: bravoToken }))
    crossRequests.push(await request(`/api/applications/${bravoApplication.id}`, {
        token: alphaToken,
        method: 'PUT',
        body: { ...bravoApplication, program: 'Alpha unauthorized overwrite' },
      }))
    crossRequests.push(await request(`/api/applications/${alphaApplication.id}`, {
        token: bravoToken,
        method: 'PUT',
        body: { ...alphaApplication, program: 'Bravo unauthorized overwrite' },
      }))
    crossRequests.push(await request(`/api/profile-assets/${bravoAsset.id}`, {
        token: alphaToken,
        method: 'PATCH',
        body: { notes: 'Alpha unauthorized profile overwrite' },
      }))
    crossRequests.push(await request(`/api/profile-assets/${alphaAsset.id}`, {
        token: bravoToken,
        method: 'PATCH',
        body: { notes: 'Bravo unauthorized profile overwrite' },
      }))
    for (const result of crossRequests) expectCrossAccountDenied(result)

    // Keep the isolation proof independent of the intentionally small
    // production heavy-read admission limit; concurrency has its own strict QA.
    const alphaFinal = await request(`/api/applications/${alphaApplication.id}`, { token: alphaToken })
    const bravoFinal = await request(`/api/applications/${bravoApplication.id}`, { token: bravoToken })
    const alphaAssetsFinal = await request('/api/profile-assets', { token: alphaToken })
    const bravoAssetsFinal = await request('/api/profile-assets', { token: bravoToken })
    expect(alphaFinal.data.program).toBe('Alpha owner update')
    expect(bravoFinal.data.program).toBe('Bravo owner update')
    expect(alphaAssetsFinal.data.find((asset) => asset.id === alphaAsset.id)?.notes)
      .toBe('Alpha owner profile update')
    expect(bravoAssetsFinal.data.find((asset) => asset.id === bravoAsset.id)?.notes)
      .toBe('Bravo owner profile update')
  })
})
