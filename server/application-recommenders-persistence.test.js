import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashAccountPassword } from './passwordSecurity.js'

const TEST_EMAIL = 'jasper@example.com'
const TEST_PASSWORD = 'demo123456'

let app
let server
let baseUrl
let storage
let testRoot
let userId
let baselineProfileRecommenders = []
const createdApplicationIds = new Set()
let settingsMutationSequence = 0

async function jsonRequest(route, token, options = {}) {
  const settingsHeaders = route === '/api/settings' && options.method === 'PATCH'
    ? {
        'X-PhD-Settings-Acknowledgement': 'v1',
        'X-PhD-Settings-Mutation-Id': `recommender-test:${Date.now()}:${++settingsMutationSequence}`,
      }
    : {}
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...settingsHeaders,
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return { response, data: payload.data, payload }
}

async function login() {
  const result = await jsonRequest('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  return result.data.token
}

async function createApplication(token, label) {
  const result = await jsonRequest('/api/applications', token, {
    method: 'POST',
    body: JSON.stringify({
      professor: `Professor ${label}`,
      professorChinese: '',
      professorEmail: `${label.toLowerCase()}@example.edu`,
      professorHomepage: '',
      university: `${label} University`,
      country: 'United Kingdom',
      website: '',
      program: `${label} PhD`,
      deadline: '2027-01-15',
      notes: '',
    }),
  })
  expect(result.response.status, JSON.stringify(result.payload)).toBe(201)
  createdApplicationIds.add(result.data.id)
  return result.data
}

function applicationRecommender(id, overrides = {}) {
  return {
    id,
    name: 'Professor Durable',
    contact: 'durable@example.edu',
    email: 'durable@example.edu',
    phone: '+44 20 7000 0001',
    notes: 'Application-private note',
    deadline: '2026-12-01',
    deadlineTime: '17:00',
    reminderDate: '2026-11-20',
    reminderTime: '09:30',
    ...overrides,
  }
}

async function resolveRecommender(token, application, recommender, options = {}) {
  const result = await jsonRequest(
    `/api/applications/${application.id}/recommenders/${recommender.id}/resolve`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        recommender,
        decision: options.decision ?? 'auto',
        expectedApplicationUpdatedAt: application.updatedAt,
        ...(options.profile?.updatedAt
          ? { expectedProfileUpdatedAt: options.profile.updatedAt }
          : {}),
      }),
    },
  )
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  expect(Number.isSafeInteger(result.data.directoryRevision)).toBe(true)
  expect(result.data.directoryRevision).toBeGreaterThan(0)
  return result.data
}

async function readApplication(token, id) {
  const result = await jsonRequest(`/api/applications/${id}`, token)
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  return result.data
}

async function readProfileLibrary(token) {
  const result = await jsonRequest('/api/auth/me', token)
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  return result.data.user.settings.profileRecommenders ?? []
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-recommender-http-'))
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
  const initialStore = await storage.readStore()
  const user = initialStore.users.find((candidate) => candidate.email === TEST_EMAIL)
  if (!user) throw new Error(`Missing isolated seed account ${TEST_EMAIL}`)
  userId = user.id
  baselineProfileRecommenders = structuredClone(user.settings?.profileRecommenders ?? [])
  user.settings = {
    ...(user.settings ?? {}),
    applicationCreatedCount: 0,
  }
  // The isolated seed intentionally includes three demo applications, which is
  // also the free-account creation limit. This suite owns its temporary store
  // and creates the application under test itself, so remove only this user's
  // seed records before the HTTP server starts.
  initialStore.applications = initialStore.applications.filter(
    (application) => application.ownerId !== userId,
  )
  await storage.writeStore(initialStore)
  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 90_000)

afterEach(async () => {
  if (!storage || !userId) return
  await storage.withWriteLock(async () => {
    const store = await storage.readStore()
    store.applications = store.applications.filter(
      (application) => !createdApplicationIds.has(application.id),
    )
    const user = store.users.find((candidate) => candidate.id === userId)
    if (!user) throw new Error(`Missing isolated seed account ${userId}`)
    user.settings = {
      ...(user.settings ?? {}),
      profileRecommenders: structuredClone(baselineProfileRecommenders),
      applicationCreatedCount: 0,
    }
    store.users = store.users.filter(
      (candidate) => candidate.email !== 'owner-isolation@example.test',
    )
    await storage.writeStore(store)
  })
  createdApplicationIds.clear()
})

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe.sequential('application recommender HTTP persistence', () => {
  async function createOwnerIsolationAccount() {
    const isolationEmail = 'owner-isolation@example.test'
    const isolationPassword = 'Owner-Isolation-Password-2026!'
    const passwordHash = await hashAccountPassword(isolationPassword)
    let isolationUserId
    await storage.withWriteLock(async () => {
      const store = await storage.readStore()
      store.users = store.users.filter((candidate) => candidate.email !== isolationEmail)
      const template = store.users.find((candidate) => candidate.id === userId)
      if (!template) throw new Error(`Missing isolated seed account ${userId}`)
      const isolated = structuredClone(template)
      isolated.id = `user_owner_isolation_${Date.now()}`
      isolated.email = isolationEmail
      isolated.name = 'Owner Isolation User'
      isolated.passwordHash = passwordHash
      isolated.settings = {
        ...structuredClone(template.settings ?? {}),
        profileRecommenders: [{
          id: 'isolation-profile',
          name: 'Private Professor',
          email: 'private@example.edu',
          phone: '',
          title: 'Professor',
          institution: 'Isolation University',
          relationship: 'Research supervisor',
          notes: 'Only the owner should see this.',
        }],
        profileRecommendersTotal: 1,
        profileRecommendersNextCursor: null,
      }
      store.users.push(isolated)
      await storage.writeStore(store)
      isolationUserId = isolated.id
    })
    const result = await jsonRequest('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email: isolationEmail, password: isolationPassword, scope: 'app' }),
    })
    expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    return { token: result.data.token, userId: isolationUserId }
  }

  it('durably saves a new teacher and projects it into the personal Profile library', async () => {
    const runId = `${Date.now()}-create`
    const token = await login()
    const application = await createApplication(token, `Recommender-${runId}`)
    const recommender = applicationRecommender(`row-${runId}`, {
      name: `Professor Durable ${runId}`,
      contact: `durable-${runId}@example.edu`,
      email: `durable-${runId}@example.edu`,
      phone: '+44 20 7111 1111',
      notes: 'Persist this complete application-level teacher.',
    })

    const saved = await resolveRecommender(token, application, recommender)
    expect(saved.resolution).toBe('created')
    expect(Object.keys(saved.application).sort()).toEqual(['id', 'recommenders', 'updatedAt'])
    expect(saved.applications).toEqual([])
    expect(saved.application.recommenders).toEqual([
      expect.objectContaining({
        ...recommender,
        profileId: saved.profile.id,
      }),
    ])

    // A new login and fresh GET model the data reads performed after a page refresh.
    const refreshedToken = await login()
    const reloaded = await readApplication(refreshedToken, application.id)
    expect(reloaded.recommenders).toEqual([
      expect.objectContaining({
        ...recommender,
        profileId: saved.profile.id,
      }),
    ])
    const profileLibrary = await readProfileLibrary(refreshedToken)
    expect(profileLibrary).toContainEqual(expect.objectContaining({
      id: saved.profile.id,
      name: recommender.name,
      email: recommender.email,
      phone: recommender.phone,
    }))
  }, 30_000)

  it('syncs linked identity fields, preserves private fields, and supports independent create and relink', async () => {
    const runId = `${Date.now()}-branches`
    const token = await login()
    const applicationA = await createApplication(token, `Sync-A-${runId}`)
    const applicationB = await createApplication(token, `Sync-B-${runId}`)
    const applicationC = await createApplication(token, `Relink-C-${runId}`)
    const sharedEmail = `shared-${runId}@example.edu`
    const rowA = applicationRecommender(`row-a-${runId}`, {
      name: `Professor Shared ${runId}`,
      contact: sharedEmail,
      email: sharedEmail,
      phone: '+44 20 7222 2222',
      notes: 'Private note A',
      deadline: '2026-12-01',
      deadlineTime: '17:00',
      reminderDate: '2026-11-20',
      reminderTime: '09:30',
    })
    const createdShared = await resolveRecommender(token, applicationA, rowA)

    const rowB = applicationRecommender(`row-b-${runId}`, {
      name: rowA.name,
      contact: sharedEmail,
      email: sharedEmail,
      phone: rowA.phone,
      profileId: createdShared.profile.id,
      notes: 'Private note B',
      deadline: '2027-01-15',
      deadlineTime: '12:15',
      reminderDate: '2027-01-02',
      reminderTime: '08:45',
    })
    await resolveRecommender(token, applicationB, rowB, { profile: createdShared.profile })

    const targetEmail = `target-${runId}@example.edu`
    const rowC = applicationRecommender(`row-c-${runId}`, {
      name: `Professor Target ${runId}`,
      contact: targetEmail,
      email: targetEmail,
      phone: '+44 20 7333 3333',
      notes: 'Private note C',
    })
    const createdTarget = await resolveRecommender(token, applicationC, rowC)

    const latestA = await readApplication(token, applicationA.id)
    const synchronizedRow = {
      ...latestA.recommenders[0],
      name: `Professor Synchronized ${runId}`,
      contact: `synchronized-${runId}@example.edu`,
      email: `synchronized-${runId}@example.edu`,
      phone: '+44 20 7444 4444',
      notes: 'Private note A edited',
      deadline: '2026-12-20',
      deadlineTime: '16:30',
      reminderDate: '2026-12-10',
      reminderTime: '10:15',
    }
    const synchronized = await resolveRecommender(token, latestA, synchronizedRow, {
      decision: 'sync',
      profile: createdShared.profile,
    })
    expect(synchronized.resolution).toBe('synced')

    const syncedA = await readApplication(token, applicationA.id)
    const syncedB = await readApplication(token, applicationB.id)
    expect(syncedA.recommenders[0]).toMatchObject({
      profileId: createdShared.profile.id,
      name: synchronizedRow.name,
      email: synchronizedRow.email,
      phone: synchronizedRow.phone,
      notes: 'Private note A edited',
      deadline: '2026-12-20',
      deadlineTime: '16:30',
      reminderDate: '2026-12-10',
      reminderTime: '10:15',
    })
    expect(syncedB.recommenders[0]).toMatchObject({
      profileId: createdShared.profile.id,
      name: synchronizedRow.name,
      email: synchronizedRow.email,
      phone: synchronizedRow.phone,
      notes: 'Private note B',
      deadline: '2027-01-15',
      deadlineTime: '12:15',
      reminderDate: '2027-01-02',
      reminderTime: '08:45',
    })

    const independentRow = {
      ...syncedA.recommenders[0],
      name: `Professor Independent ${runId}`,
      contact: `independent-${runId}@example.edu`,
      email: `independent-${runId}@example.edu`,
      phone: '+44 20 7555 5555',
    }
    const independentCreated = await resolveRecommender(token, syncedA, independentRow, {
      decision: 'independent',
      profile: synchronized.profile,
    })
    expect(independentCreated.resolution).toBe('created')
    expect(independentCreated.profile.id).not.toBe(createdShared.profile.id)
    expect(independentCreated.recommender).toMatchObject({
      profileId: independentCreated.profile.id,
      notes: 'Private note A edited',
      deadline: '2026-12-20',
      reminderDate: '2026-12-10',
    })

    const originalAfterIndependent = independentCreated.profiles.find(
      (profile) => profile.id === createdShared.profile.id,
    )
    expect(originalAfterIndependent).toMatchObject({
      name: synchronizedRow.name,
      email: synchronizedRow.email,
      phone: synchronizedRow.phone,
    })
    expect((await readApplication(token, applicationB.id)).recommenders[0]).toMatchObject({
      profileId: createdShared.profile.id,
      name: synchronizedRow.name,
      email: synchronizedRow.email,
      notes: 'Private note B',
    })

    const profileCountBeforeRelink = independentCreated.profiles.length
    const independentApplication = await readApplication(token, applicationA.id)
    const relinked = await resolveRecommender(token, independentApplication, {
      ...independentApplication.recommenders[0],
      name: createdTarget.profile.name,
      contact: createdTarget.profile.email,
      email: createdTarget.profile.email,
      phone: createdTarget.profile.phone,
    }, {
      decision: 'independent',
      profile: independentCreated.profile,
    })
    expect(relinked.resolution).toBe('linked')
    expect(relinked.recommender).toMatchObject({
      profileId: createdTarget.profile.id,
      name: createdTarget.profile.name,
      email: createdTarget.profile.email,
      notes: 'Private note A edited',
      deadline: '2026-12-20',
      reminderDate: '2026-12-10',
    })
    expect(relinked.profiles).toHaveLength(profileCountBeforeRelink)
    expect(relinked.profiles.find((profile) => profile.id === createdShared.profile.id)).toMatchObject({
      name: synchronizedRow.name,
      email: synchronizedRow.email,
    })
  }, 30_000)

  it('rejects generic application and settings writes that bypass atomic recommender resolution', async () => {
    const runId = `${Date.now()}-bypass`
    const token = await login()
    const application = await createApplication(token, `Bypass-${runId}`)
    const recommender = applicationRecommender(`row-${runId}`, {
      name: `Professor Guarded ${runId}`,
      contact: `guarded-${runId}@example.edu`,
      email: `guarded-${runId}@example.edu`,
    })
    const saved = await resolveRecommender(token, application, recommender)
    const durableApplication = await readApplication(token, application.id)

    const bypassApplication = await jsonRequest(`/api/applications/${application.id}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        ...durableApplication,
        recommenders: durableApplication.recommenders.map((candidate) => ({
          ...candidate,
          name: `${candidate.name} bypassed`,
        })),
      }),
    })
    expect(bypassApplication.response.status, JSON.stringify(bypassApplication.payload)).toBe(409)
    expect(bypassApplication.payload).toMatchObject({
      ok: false,
      error: { code: 'RECOMMENDER_RESOLUTION_REQUIRED' },
    })

    const profileLibrary = await readProfileLibrary(token)
    const bypassSettings = await jsonRequest('/api/settings', token, {
      method: 'PATCH',
      body: JSON.stringify({ profileRecommenders: profileLibrary }),
    })
    expect(bypassSettings.response.status, JSON.stringify(bypassSettings.payload)).toBe(409)
    expect(bypassSettings.payload).toMatchObject({
      ok: false,
      error: { code: 'PROFILE_RECOMMENDER_ROUTE_REQUIRED' },
    })

    const unchangedApplication = await readApplication(token, application.id)
    expect(unchangedApplication.recommenders[0]).toMatchObject({
      profileId: saved.profile.id,
      name: recommender.name,
      email: recommender.email,
    })
    expect((await readProfileLibrary(token)).find((profile) => profile.id === saved.profile.id)).toMatchObject({
      name: recommender.name,
      email: recommender.email,
    })
  }, 30_000)

  it('pages the personal recommender directory and loads a detail record on demand', async () => {
    const token = await login()
    const now = new Date().toISOString()
    const profiles = Array.from({ length: 60 }, (_, index) => ({
      id: `page-profile-${index}`,
      name: `Professor Page ${index}`,
      email: `page.${index}@example.edu`,
      phone: '',
      title: 'Professor',
      institution: 'Page University',
      relationship: 'Research supervisor',
      notes: `Private notes for ${index}`,
      createdAt: now,
      updatedAt: now,
    }))
    const baseProfiles = await readProfileLibrary(token)
    const saved = await jsonRequest('/api/profile-recommenders', token, {
      method: 'PUT',
      body: JSON.stringify({ profiles, baseProfiles }),
    })
    expect(saved.response.status, JSON.stringify(saved.payload)).toBe(200)

    const firstPage = await jsonRequest('/api/profile/recommenders?limit=50', token)
    expect(firstPage.response.status, JSON.stringify(firstPage.payload)).toBe(200)
    expect(firstPage.data.total).toBe(60)
    expect(firstPage.data.items).toHaveLength(50)
    expect(firstPage.data.nextCursor).toBe('50')

    const secondPage = await jsonRequest('/api/profile/recommenders?cursor=50&limit=50', token)
    expect(secondPage.response.status, JSON.stringify(secondPage.payload)).toBe(200)
    expect(secondPage.data.total).toBe(60)
    expect(secondPage.data.items).toHaveLength(10)
    expect(secondPage.data.nextCursor).toBeNull()

    const detail = await jsonRequest('/api/profile/recommenders/page-profile-7', token)
    expect(detail.response.status, JSON.stringify(detail.payload)).toBe(200)
    expect(detail.data).toMatchObject({
      id: 'page-profile-7',
      name: 'Professor Page 7',
      email: 'page.7@example.edu',
      notes: 'Private notes for 7',
    })

    const pageRevalidation = await fetch(
      `${baseUrl}/api/profile/recommenders?limit=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'If-None-Match': firstPage.response.headers.get('etag') ?? '',
        },
      },
    )
    expect(pageRevalidation.status).toBe(304)
    expect(await pageRevalidation.text()).toBe('')

    const detailRevalidation = await fetch(
      `${baseUrl}/api/profile/recommenders/page-profile-7`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'If-None-Match': detail.response.headers.get('etag') ?? '',
        },
      },
    )
    expect(detailRevalidation.status).toBe(304)
    expect(await detailRevalidation.text()).toBe('')
  }, 30_000)

  it('never lets another owner read a personal recommender record or Team directory', async () => {
    const isolation = await createOwnerIsolationAccount()
    const ownerToken = await login()

    const ownerPage = await jsonRequest('/api/profile/recommenders?limit=50', ownerToken)
    expect(ownerPage.response.status, JSON.stringify(ownerPage.payload)).toBe(200)
    expect(ownerPage.data.items.some((item) => item.id === 'isolation-profile')).toBe(false)

    const isolationPage = await jsonRequest('/api/profile/recommenders?limit=50', isolation.token)
    expect(isolationPage.response.status, JSON.stringify(isolationPage.payload)).toBe(200)
    expect(isolationPage.data.items).toContainEqual(expect.objectContaining({
      id: 'isolation-profile',
      name: 'Private Professor',
    }))

    const crossOwnerDetail = await jsonRequest(
      '/api/profile/recommenders/isolation-profile',
      ownerToken,
    )
    expect(crossOwnerDetail.response.status, JSON.stringify(crossOwnerDetail.payload)).toBe(404)

    const ownDetail = await jsonRequest(
      '/api/profile/recommenders/isolation-profile',
      isolation.token,
    )
    expect(ownDetail.response.status, JSON.stringify(ownDetail.payload)).toBe(200)
    expect(ownDetail.data).toMatchObject({
      id: 'isolation-profile',
      email: 'private@example.edu',
    })

    const crossTeamDirectory = await jsonRequest(
      `/api/teams/team_demo_phd_atlas/members/${isolation.userId}/profile-recommenders`,
      ownerToken,
    )
    expect([403, 404]).toContain(crossTeamDirectory.response.status)
    expect(crossTeamDirectory.data).toBeUndefined()
  }, 30_000)
})
