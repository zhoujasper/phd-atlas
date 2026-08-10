import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let storage
let testRoot

function clone(value) {
  return structuredClone(value)
}

function personalApplication(source, id, ownerId, marker) {
  return {
    ...clone(source),
    id,
    ownerId,
    teamId: null,
    program: marker,
    school: { ...clone(source.school), name: marker, logo: undefined },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function teamApplication(source, id, ownerId, teamId, marker) {
  return {
    ...personalApplication(source, id, ownerId, marker),
    teamId,
  }
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-scoped-store-'))
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'scoped-store-test-server-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'scoped-store-test-settings-key')
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

describe.sequential('tenant-scoped store hydration', () => {
  it('reads a constant-size authored receipt whose hash changes with content at the same timestamp', async () => {
    const setup = await storage.readStore()
    const owner = setup.users[0]
    const source = setup.applications[0]
    const applicationId = `receipt_app_${Date.now()}`
    const stamp = '2026-08-02T20:00:00.000Z'
    setup.applications.push({
      ...personalApplication(source, applicationId, owner.id, 'Receipt programme'),
      notes: 'First durable nested value',
      updatedAt: stamp,
    })
    await storage.lockedWriteStore(setup)

    const first = await storage.readApplicationMutationReceipt(applicationId)
    expect(first).toMatchObject({ id: applicationId, updatedAt: stamp })
    expect(first.authoredHash).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(Object.keys(first.authorityHashes).sort()).toEqual([
      'create',
      'none',
      'school-logo',
      'team-transfer',
      'trash-restore',
    ])
    for (const digest of Object.values(first.authorityHashes)) {
      expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    }

    const latest = await storage.readScopedStore(owner.id, {
      applicationIds: [applicationId],
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
    })
    const changed = latest.applications.find((candidate) => candidate.id === applicationId)
    changed.notes = 'Second durable nested value'
    changed.teamTransferRequest = { id: 'receipt-transfer', status: 'pending' }
    await storage.lockedWriteStore(latest)

    let receiptMemoryAdmissions = 0
    storage.configureStoreHydrationMemoryAdmission(() => {
      receiptMemoryAdmissions += 1
      return () => undefined
    })
    const second = await storage.readApplicationMutationReceipt(applicationId)
    expect(second).toMatchObject({ id: applicationId, updatedAt: stamp })
    expect(second.authoredHash).not.toBe(first.authoredHash)
    expect(second.authorityHashes.none).toBe(first.authorityHashes.none)
    expect(second.authorityHashes['school-logo']).toBe(first.authorityHashes['school-logo'])
    expect(second.authorityHashes['trash-restore']).toBe(first.authorityHashes['trash-restore'])
    expect(second.authorityHashes.create).not.toBe(first.authorityHashes.create)
    expect(second.authorityHashes['team-transfer']).not.toBe(first.authorityHashes['team-transfer'])
    expect(receiptMemoryAdmissions).toBe(0)
  })

  it('loads only reachable rows and a scoped save cannot delete another tenant', async () => {
    const setup = await storage.readStore()
    const owner = setup.users[0]
    const outsiderId = `outsider_${Date.now()}`
    const outsider = clone(owner)
    outsider.id = outsiderId
    outsider.email = `${outsiderId}@example.test`
    outsider.name = 'Unrelated tenant'
    outsider.createdAt = new Date().toISOString()
    outsider.settings = { ...outsider.settings, teamProfileRecommenders: {} }
    setup.users.push(outsider)

    const ownerApplicationId = `owner_app_${Date.now()}`
    const outsiderApplicationId = `outsider_app_${Date.now()}`
    setup.applications.push(
      personalApplication(setup.applications[0], ownerApplicationId, owner.id, 'Owner marker'),
      personalApplication(setup.applications[0], outsiderApplicationId, outsiderId, 'Outsider marker'),
    )
    await storage.lockedWriteStore(setup)

    let released = 0
    const reservations = []
    storage.configureStoreHydrationMemoryAdmission((bytes) => {
      reservations.push(bytes)
      let done = false
      return () => {
        if (done) return
        done = true
        released += 1
      }
    })
    const scoped = await storage.readScopedStore(owner.id, { retainMemoryReservation: true })
    expect(scoped.users.some((candidate) => candidate.id === outsiderId)).toBe(false)
    expect(scoped.applications.some((candidate) => candidate.id === outsiderApplicationId)).toBe(false)
    expect(scoped.applications.some((candidate) => candidate.id === ownerApplicationId)).toBe(true)
    expect(reservations.at(-1)).toBeGreaterThanOrEqual(16 * 1024 * 1024)
    expect(released).toBe(0)

    scoped.applications.find((candidate) => candidate.id === ownerApplicationId).program = 'Owner updated safely'
    await storage.lockedWriteStore(scoped)
    expect(released).toBe(0)
    storage.takeStoreMemoryLease(scoped)?.()
    expect(released).toBe(1)

    storage.configureStoreHydrationMemoryAdmission(null)
    const persisted = await storage.readStore()
    expect(persisted.users.some((candidate) => candidate.id === outsiderId)).toBe(true)
    expect(persisted.applications.find((candidate) => candidate.id === outsiderApplicationId)?.program)
      .toBe('Outsider marker')
    expect(persisted.applications.find((candidate) => candidate.id === ownerApplicationId)?.program)
      .toBe('Owner updated safely')
  })

  it('uses a measured compact reservation for Team validation metadata', async () => {
    const setup = await storage.readStore()
    const owner = setup.users[0]
    const team = await storage.createTeam(owner.id, 'Compact authorization Team')
    const reservations = []
    let releases = 0
    storage.configureStoreHydrationMemoryAdmission((bytes) => {
      reservations.push(bytes)
      let released = false
      return () => {
        if (released) return
        released = true
        releases += 1
      }
    })

    const scoped = await storage.readScopedStore(owner.id, {
      includeApplications: false,
      includeProfileAssets: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
      retainMemoryReservation: true,
    })
    expect(scoped.teams.map(({ id }) => id)).toContain(team.id)
    expect(scoped.applications).toEqual([])
    expect(scoped.profileAssets).toEqual([])
    expect(reservations).toHaveLength(1)
    expect(reservations[0]).toBeGreaterThanOrEqual(256 * 1024)
    expect(reservations[0]).toBeLessThan(16 * 1024 * 1024)
    expect(releases).toBe(0)
    storage.takeStoreMemoryLease(scoped)?.()
    expect(releases).toBe(1)
    storage.configureStoreHydrationMemoryAdmission(null)
  })

  it('keeps the personal application-list principal independent of large optional settings', async () => {
    const setup = await storage.readStore()
    const owner = setup.users[0]
    owner.settings = {
      ...owner.settings,
      membershipPlan: 'pro',
      personalMembershipPlan: 'pro',
      backupFrequency: '1h',
      maxBackupsPerApp: 17,
      autoBackup: true,
      sessionDurationMinutes: 720,
      profileRecommenders: Array.from({ length: 2_000 }, (_, index) => ({
        id: `large_optional_${index}`,
        name: 'x'.repeat(128),
      })),
    }
    await storage.lockedWriteStore(setup)

    const scoped = await storage.readApplicationListHydrationStore(owner.id)
    const principal = scoped.users.find((candidate) => candidate.id === owner.id)
    expect(principal.settings).toMatchObject({
      membershipPlan: 'pro',
      personalMembershipPlan: 'pro',
      backupFrequency: '1h',
      maxBackupsPerApp: 17,
      autoBackup: true,
      sessionDurationMinutes: 720,
    })
    expect(principal.settings.profileRecommenders).toBeUndefined()
    expect(Buffer.byteLength(JSON.stringify(principal), 'utf8')).toBeLessThan(8 * 1024)
  })

  it('builds the account summary from a bounded direct principal without Team or collection hydration', async () => {
    const setup = await storage.readStore()
    const owner = setup.users[0]
    const scoped = await storage.readAccountSummaryHydrationStore(owner.id)
    const principal = scoped.users.find((candidate) => candidate.id === owner.id)

    expect(principal).toMatchObject({
      id: owner.id,
      email: owner.email,
      settings: { authVersion: owner.settings.authVersion },
    })
    expect(scoped.teams).toEqual([])
    expect(scoped.applications).toEqual([])
    expect(scoped.profileAssets).toEqual([])
    expect(scoped.systemEvents).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(principal), 'utf8')).toBeLessThan(900 * 1024)
  })

  it('uses differential user deletion for a scoped account without reconciling unseen users', async () => {
    const setup = await storage.readStore()
    const owner = setup.users[0]
    const outsiderId = `retained_user_${Date.now()}`
    const outsider = clone(owner)
    outsider.id = outsiderId
    outsider.email = `${outsiderId}@example.test`
    outsider.name = 'Must remain'
    outsider.createdAt = new Date().toISOString()
    setup.users.push(outsider)
    await storage.lockedWriteStore(setup)

    const scoped = await storage.readScopedStore(owner.id, { retainMemoryReservation: false })
    scoped.users = scoped.users.filter((candidate) => candidate.id !== owner.id)
    await storage.lockedWriteStore(scoped)

    const persisted = await storage.readStore()
    expect(persisted.users.some((candidate) => candidate.id === owner.id)).toBe(false)
    expect(persisted.users.some((candidate) => candidate.id === outsiderId)).toBe(true)
  })

  it('hydrates one Team target and reuses the exact selector after a revision conflict', async () => {
    const initial = await storage.readStore()
    const teamOwner = initial.users[0]
    const targetOwner = {
      ...clone(teamOwner),
      id: `focused_target_owner_${Date.now()}`,
      email: `focused-target-${Date.now()}@example.test`,
      name: 'Focused target owner',
      createdAt: new Date().toISOString(),
    }
    const siblingOwner = {
      ...clone(teamOwner),
      id: `focused_sibling_owner_${Date.now()}`,
      email: `focused-sibling-${Date.now()}@example.test`,
      name: 'Unrelated Team peer',
      createdAt: new Date().toISOString(),
    }
    initial.users.push(targetOwner, siblingOwner)
    await storage.lockedWriteStore(initial)
    const team = await storage.createTeam(teamOwner.id, 'Focused hydration Team')

    const setup = await storage.readStore()
    const source = setup.applications[0]
    const targetId = `focused_target_${Date.now()}`
    const siblingId = `focused_sibling_${Date.now()}`
    setup.applications.push(
      teamApplication(source, targetId, targetOwner.id, team.id, 'Small target'),
      teamApplication(source, siblingId, siblingOwner.id, team.id, 'x'.repeat(16 * 1024 * 1024)),
    )
    await storage.lockedWriteStore(setup)

    const selector = {
      applicationIds: [targetId],
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      retainMemoryReservation: false,
    }
    const reservations = []
    storage.configureStoreHydrationMemoryAdmission((bytes) => {
      reservations.push(bytes)
      return () => undefined
    })
    const focused = await storage.readScopedStore(teamOwner.id, selector)
    expect(focused.applications.map(({ id }) => id)).toEqual([targetId])
    expect(focused.profileAssets).toEqual([])
    expect(focused.teams.map(({ id }) => id)).toEqual([team.id])
    expect(focused.users.some(({ id }) => id === targetOwner.id)).toBe(true)
    expect(focused.users.some(({ id }) => id === siblingOwner.id)).toBe(false)
    expect(reservations).toHaveLength(1)
    expect(reservations[0]).toBeLessThan(60 * 1024 * 1024)

    // Commit an unrelated row first so the target write must take the stale
    // revision merge path. That reread must retain this same one-row selector.
    const sibling = await storage.readScopedStore(teamOwner.id, {
      ...selector,
      applicationIds: [siblingId],
    })
    sibling.applications[0].priority = sibling.applications[0].priority === 'high' ? 'medium' : 'high'
    await storage.lockedWriteStore(sibling)
    reservations.length = 0

    focused.applications[0].program = 'Focused target persisted'
    await storage.lockedWriteStore(focused)
    expect(reservations).toHaveLength(1)
    expect(reservations[0]).toBeLessThan(60 * 1024 * 1024)

    storage.configureStoreHydrationMemoryAdmission(null)
    const persisted = await storage.readStore()
    expect(persisted.applications.find(({ id }) => id === targetId)?.program)
      .toBe('Focused target persisted')
    expect(persisted.applications.find(({ id }) => id === siblingId)?.program)
      .toHaveLength(16 * 1024 * 1024)
  })
})
