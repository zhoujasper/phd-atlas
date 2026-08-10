import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let storage
let testRoot
let sqlitePath

function clone(value) {
  return structuredClone(value)
}

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function applicationFrom(source, { id, ownerId, schoolName }) {
  const application = clone(source)
  application.id = id
  application.ownerId = ownerId
  application.teamId = null
  application.school = {
    ...application.school,
    name: schoolName,
    logo: undefined,
  }
  application.createdAt = new Date().toISOString()
  application.updatedAt = application.createdAt
  return application
}

function userFrom(source, { id, email }) {
  const user = clone(source)
  user.id = id
  user.name = `Tenant user ${id}`
  user.email = email
  user.createdAt = new Date().toISOString()
  user.lastLoginAt = null
  user.settings = {
    ...user.settings,
    smtpPass: `smtp-secret-${id}`,
    incomingPass: `incoming-secret-${id}`,
  }
  return user
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-tenant-concurrency-'))
  sqlitePath = path.join(testRoot, 'workspace.sqlite')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'tenant-concurrency-test-server-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'tenant-concurrency-test-encryption-key')
})

beforeEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true })
  await fs.mkdir(testRoot, { recursive: true })
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
})

afterEach(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  vi.resetModules()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await fs.rm(testRoot, { recursive: true, force: true })
})

describe.sequential('tenant revision isolation', () => {
  it('commits concurrent writes for different tenants without a conflict', async () => {
    const setup = await storage.readStore()
    const userA = setup.users[0]
    const userB = userFrom(setup.users[0], {
      id: uniqueId('user_b'),
      email: 'tenant-b@example.test',
    })
    const appA = applicationFrom(setup.applications[0], {
      id: uniqueId('app_a'),
      ownerId: userA.id,
      schoolName: 'Tenant A University',
    })
    const appB = applicationFrom(setup.applications[0], {
      id: uniqueId('app_b'),
      ownerId: userB.id,
      schoolName: 'Tenant B University',
    })
    setup.users.push(userB)
    setup.applications.push(appA, appB)
    await storage.lockedWriteStore(setup)

    const storeA = await storage.readScopedStore(userA.id)
    const storeB = await storage.readScopedStore(userB.id)
    storeA.applications.find((application) => application.id === appA.id).program = 'tenant-a-marker'
    storeB.applications.find((application) => application.id === appB.id).program = 'tenant-b-marker'

    await Promise.all([
      storage.writeStore(storeA),
      storage.writeStore(storeB),
    ])

    const persisted = await storage.readStore()
    expect(persisted.applications.find((application) => application.id === appA.id)?.program)
      .toBe('tenant-a-marker')
    expect(persisted.applications.find((application) => application.id === appB.id)?.program)
      .toBe('tenant-b-marker')
  })

  it('keeps audit-bearing saves for different tenants on independent lanes', async () => {
    const setup = await storage.readStore()
    const userA = setup.users[0]
    const userB = userFrom(setup.users[0], {
      id: uniqueId('audit_lane_user_b'),
      email: 'audit-lane-b@example.test',
    })
    const appA = applicationFrom(setup.applications[0], {
      id: uniqueId('audit_lane_app_a'),
      ownerId: userA.id,
      schoolName: 'Audit Lane A University',
    })
    const appB = applicationFrom(setup.applications[0], {
      id: uniqueId('audit_lane_app_b'),
      ownerId: userB.id,
      schoolName: 'Audit Lane B University',
    })
    setup.users.push(userB)
    setup.applications.push(appA, appB)
    await storage.lockedWriteStore(setup)

    const storeA = await storage.readScopedStore(userA.id)
    const storeB = await storage.readScopedStore(userB.id)
    storeA.applications.find((application) => application.id === appA.id).program = 'audited-a'
    storeB.applications.find((application) => application.id === appB.id).program = 'audited-b'
    storage.logEvent(storeA, {
      scope: 'Tenant concurrency test',
      actorId: userA.id,
      message: 'Audited tenant A save',
    })
    storage.logEvent(storeB, {
      scope: 'Tenant concurrency test',
      actorId: userB.id,
      message: 'Audited tenant B save',
    })
    storage.resetWriteLaneStatsForTests()

    await Promise.all([
      storage.lockedWriteStore(storeA),
      storage.lockedWriteStore(storeB),
    ])

    const lanes = storage.writeLaneSnapshot()
    expect(lanes.maxActiveLanes).toBeGreaterThanOrEqual(2)
    expect(lanes.globalGranted).toBe(0)
    const persisted = await storage.readStore()
    expect(persisted.applications.find(({ id }) => id === appA.id)?.program).toBe('audited-a')
    expect(persisted.applications.find(({ id }) => id === appB.id)?.program).toBe('audited-b')
    expect(persisted.systemEvents.some(({ message }) => message === 'Audited tenant A save')).toBe(true)
    expect(persisted.systemEvents.some(({ message }) => message === 'Audited tenant B save')).toBe(true)
  })

  it('retries disjoint writes for the same tenant', async () => {
    const setup = await storage.readStore()
    const ownerId = setup.users[0].id
    const appA = applicationFrom(setup.applications[0], {
      id: uniqueId('app_same_a'),
      ownerId,
      schoolName: 'Same Tenant A University',
    })
    const appB = applicationFrom(setup.applications[0], {
      id: uniqueId('app_same_b'),
      ownerId,
      schoolName: 'Same Tenant B University',
    })
    setup.applications.push(appA, appB)
    await storage.lockedWriteStore(setup)

    const storeA = await storage.readScopedStore(ownerId)
    const storeB = await storage.readScopedStore(ownerId)
    storeA.applications.find((application) => application.id === appA.id).program = 'same-a-marker'
    storeB.applications.find((application) => application.id === appB.id).program = 'same-b-marker'

    await Promise.all([
      storage.writeStore(storeA),
      storage.writeStore(storeB),
    ])

    const persisted = await storage.readStore()
    expect(persisted.applications.find((application) => application.id === appA.id)?.program)
      .toBe('same-a-marker')
    expect(persisted.applications.find((application) => application.id === appB.id)?.program)
      .toBe('same-b-marker')
  })

  it('keeps a user save from colliding with an append-only audit write', async () => {
    const setup = await storage.readStore()
    const ownerId = setup.users[0].id
    const app = applicationFrom(setup.applications[0], {
      id: uniqueId('app_audit'),
      ownerId,
      schoolName: 'Audit Concurrency University',
    })
    setup.applications.push(app)
    await storage.lockedWriteStore(setup)

    const userStore = await storage.readScopedStore(ownerId)
    const auditStore = await storage.readStore()
    userStore.applications.find((application) => application.id === app.id).program = 'audit-user-marker'
    auditStore.systemEvents.unshift({
      id: uniqueId('event_audit'),
      time: new Date().toISOString(),
      scope: 'Tenant concurrency test',
      actorId: null,
      message: 'Append-only audit marker',
      metadata: {},
    })

    await Promise.all([
      storage.writeStore(userStore),
      storage.writeStore(auditStore),
    ])

    const persisted = await storage.readStore()
    expect(persisted.applications.find((application) => application.id === app.id)?.program)
      .toBe('audit-user-marker')
    expect(persisted.systemEvents.some((event) => event.message === 'Append-only audit marker')).toBe(true)
  })
})
