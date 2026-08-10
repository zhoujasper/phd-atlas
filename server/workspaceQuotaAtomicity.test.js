import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const ONE_MIB = 1024 * 1024
const PERSONAL_HEADROOM = 90_000
const GROWTH_BYTES = 60_000

let storage
let testRoot
let userId
let secondOwnerId
let teamId

function quotaApplication(template, id, ownerId, teamId = null) {
  return {
    ...structuredClone(template),
    id,
    ownerId,
    teamId,
    school: { ...structuredClone(template.school), name: id },
    professor: { ...structuredClone(template.professor) },
    program: '',
    materials: [],
    tasks: [],
    communications: [],
    scholarships: [],
    fees: [],
    shares: [],
    versions: [],
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  }
}

async function writeFresh(mutator) {
  const store = await storage.readStore()
  await mutator(store)
  await storage.lockedWriteStore(store)
}

async function resetPersonalNearLimit(headroom = PERSONAL_HEADROOM) {
  await writeFresh((store) => {
    const user = store.users.find((candidate) => candidate.id === userId)
    user.settings = {
      ...(user.settings ?? {}),
      storageQuotaMb: 10,
      smtpHost: '',
      incomingHost: '',
    }
    store.applications.find((item) => item.id === 'quota_atomic_app_a').program = ''
    store.applications.find((item) => item.id === 'quota_atomic_app_b').program = ''
    store.applications.find((item) => item.id === 'quota_atomic_filler').program = ''
    store.profileAssets.find((item) => item.id === 'quota_atomic_profile').description = ''
  })
  const emptyUsage = await storage.readWorkspaceQuotaUsage(userId)
  const fillerBytes = ONE_MIB - headroom - emptyUsage.personalBytes
  expect(fillerBytes).toBeGreaterThan(100_000)
  await writeFresh((store) => {
    store.applications.find((item) => item.id === 'quota_atomic_filler').program = 'f'.repeat(fillerBytes)
  })
  await writeFresh((store) => {
    const user = store.users.find((candidate) => candidate.id === userId)
    user.settings = { ...(user.settings ?? {}), storageQuotaMb: 1 }
  })
  const usage = await storage.readWorkspaceQuotaUsage(userId)
  expect(usage.personalBytes).toBeLessThanOrEqual(ONE_MIB)
  expect(ONE_MIB - usage.personalBytes).toBeGreaterThan(GROWTH_BYTES)
  expect(ONE_MIB - usage.personalBytes).toBeLessThan(GROWTH_BYTES * 2)
  return usage.personalBytes
}

async function resetTeamNearLimit() {
  await writeFresh((store) => {
    for (const id of ['quota_atomic_team_a', 'quota_atomic_team_b', 'quota_atomic_team_filler']) {
      store.applications.find((item) => item.id === id).program = ''
    }
  })
  const emptyUsage = await storage.readWorkspaceQuotaUsage(userId, [teamId])
  const fillerBytes = ONE_MIB - PERSONAL_HEADROOM - emptyUsage.teamBytes[teamId]
  expect(fillerBytes).toBeGreaterThan(100_000)
  await writeFresh((store) => {
    store.applications.find((item) => item.id === 'quota_atomic_team_filler').program = 't'.repeat(fillerBytes)
  })
  const usage = await storage.readWorkspaceQuotaUsage(userId, [teamId])
  expect(ONE_MIB - usage.teamBytes[teamId]).toBeGreaterThan(GROWTH_BYTES)
  expect(ONE_MIB - usage.teamBytes[teamId]).toBeLessThan(GROWTH_BYTES * 2)
  return usage.teamBytes[teamId]
}

function expectExactlyOneQuotaWinner(results, expectedCode) {
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.filter((result) => result.status === 'rejected')
  expect(rejected).toHaveLength(1)
  expect(rejected[0].reason).toMatchObject({ status: 413, code: expectedCode })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-quota-atomic-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_TEAM_STORAGE_QUOTA_BYTES', String(ONE_MIB))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()

  const store = await storage.readStore()
  const user = store.users.find((candidate) => candidate.role !== 'admin')
  const secondOwner = store.users.find((candidate) => candidate.id !== user?.id)
  const template = store.applications[0]
  if (!user || !secondOwner || !template) throw new Error('Quota fixture requires two users and one application.')
  userId = user.id
  secondOwnerId = secondOwner.id
  teamId = (await storage.createTeam(userId, 'Atomic quota team', 5)).id
  user.settings = { ...(user.settings ?? {}), storageQuotaMb: 10 }
  store.applications.push(
    quotaApplication(template, 'quota_atomic_app_a', userId),
    quotaApplication(template, 'quota_atomic_app_b', userId),
    quotaApplication(template, 'quota_atomic_filler', userId),
    quotaApplication(template, 'quota_atomic_team_a', userId, teamId),
    quotaApplication(template, 'quota_atomic_team_b', secondOwnerId, teamId),
    quotaApplication(template, 'quota_atomic_team_filler', userId, teamId),
  )
  store.profileAssets.push({
    id: 'quota_atomic_profile',
    ownerId: userId,
    teamId: null,
    name: 'Quota profile',
    kind: 'snippet',
    description: '',
    notes: '',
    attachments: [],
    shares: [],
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  })
  await storage.lockedWriteStore(store)
}, 120_000)

afterAll(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 120_000)

describe.sequential('atomic workspace quota gate', () => {
  it('allows only one concurrent growth across different applications', async () => {
    const beforeBytes = await resetPersonalNearLimit()
    const first = await storage.readStore()
    const second = await storage.readStore()
    first.applications.find((item) => item.id === 'quota_atomic_app_a').program = 'a'.repeat(GROWTH_BYTES)
    second.applications.find((item) => item.id === 'quota_atomic_app_b').program = 'b'.repeat(GROWTH_BYTES)

    const results = await Promise.allSettled([
      storage.lockedWriteStore(first),
      storage.lockedWriteStore(second),
    ])
    expectExactlyOneQuotaWinner(results, 'STORAGE_QUOTA_EXCEEDED')
    const usage = await storage.readWorkspaceQuotaUsage(userId)
    expect(usage.personalBytes - beforeBytes).toBe(GROWTH_BYTES)
    const durable = await storage.readStore()
    const lengths = ['quota_atomic_app_a', 'quota_atomic_app_b']
      .map((id) => durable.applications.find((item) => item.id === id).program.length)
      .sort((left, right) => left - right)
    expect(lengths).toEqual([0, GROWTH_BYTES])
  })

  it('serializes application and profile-asset growth against one personal limit', async () => {
    const beforeBytes = await resetPersonalNearLimit()
    const applicationWrite = await storage.readStore()
    const profileWrite = await storage.readStore()
    applicationWrite.applications.find((item) => item.id === 'quota_atomic_app_a').program = 'a'.repeat(GROWTH_BYTES)
    profileWrite.profileAssets.find((item) => item.id === 'quota_atomic_profile').description = 'p'.repeat(GROWTH_BYTES)

    const results = await Promise.allSettled([
      storage.lockedWriteStore(applicationWrite),
      storage.lockedWriteStore(profileWrite),
    ])
    expectExactlyOneQuotaWinner(results, 'STORAGE_QUOTA_EXCEEDED')
    const usage = await storage.readWorkspaceQuotaUsage(userId)
    expect(usage.personalBytes - beforeBytes).toBe(GROWTH_BYTES)
  })

  it('serializes SMTP/IMAP settings growth against application JSON growth', async () => {
    await resetPersonalNearLimit()
    const mailSettingsWrite = await storage.readStore()
    const applicationWrite = await storage.readStore()
    const user = mailSettingsWrite.users.find((candidate) => candidate.id === userId)
    user.settings = {
      ...(user.settings ?? {}),
      smtpHost: `smtp.${'s'.repeat((GROWTH_BYTES / 2) - 5)}`,
      incomingHost: `imap.${'i'.repeat((GROWTH_BYTES / 2) - 5)}`,
      incomingProtocol: 'imap',
    }
    applicationWrite.applications
      .find((item) => item.id === 'quota_atomic_app_a').program = 'm'.repeat(GROWTH_BYTES)

    const results = await Promise.allSettled([
      storage.lockedWriteStore(mailSettingsWrite),
      storage.lockedWriteStore(applicationWrite),
    ])
    expectExactlyOneQuotaWinner(results, 'STORAGE_QUOTA_EXCEEDED')
    const durable = await storage.readStore()
    const durableUser = durable.users.find((candidate) => candidate.id === userId)
    const protocolGrowthWon = durableUser.settings.smtpHost.length > 10_000
    const applicationGrowthWon = durable.applications
      .find((item) => item.id === 'quota_atomic_app_a').program.length === GROWTH_BYTES
    expect(Number(protocolGrowthWon) + Number(applicationGrowthWon)).toBe(1)
  })

  it('allows only one Team growth from two different owners', async () => {
    const beforeBytes = await resetTeamNearLimit()
    const first = await storage.readStore()
    const second = await storage.readStore()
    first.applications.find((item) => item.id === 'quota_atomic_team_a').program = 'a'.repeat(GROWTH_BYTES)
    second.applications.find((item) => item.id === 'quota_atomic_team_b').program = 'b'.repeat(GROWTH_BYTES)

    const results = await Promise.allSettled([
      storage.lockedWriteStore(first),
      storage.lockedWriteStore(second),
    ])
    expectExactlyOneQuotaWinner(results, 'TEAM_STORAGE_QUOTA_EXCEEDED')
    const usage = await storage.readWorkspaceQuotaUsage(userId, [teamId])
    expect(usage.teamBytes[teamId] - beforeBytes).toBe(GROWTH_BYTES)
  })

  it('allows a negative delta while the account is already over quota', async () => {
    await writeFresh((store) => {
      const user = store.users.find((candidate) => candidate.id === userId)
      user.settings = { ...(user.settings ?? {}), storageQuotaMb: 10 }
      store.applications.find((item) => item.id === 'quota_atomic_app_a').program = ''
      store.applications.find((item) => item.id === 'quota_atomic_app_b').program = ''
      store.profileAssets.find((item) => item.id === 'quota_atomic_profile').description = ''
      store.applications.find((item) => item.id === 'quota_atomic_filler').program = 'o'.repeat(ONE_MIB + 100_000)
    })
    await writeFresh((store) => {
      const user = store.users.find((candidate) => candidate.id === userId)
      user.settings = { ...(user.settings ?? {}), storageQuotaMb: 1 }
    })
    const before = await storage.readWorkspaceQuotaUsage(userId)
    expect(before.personalBytes).toBeGreaterThan(ONE_MIB)
    await expect(writeFresh((store) => {
      store.applications.find((item) => item.id === 'quota_atomic_filler').program = 'o'.repeat(ONE_MIB)
    })).resolves.toBeUndefined()
    const after = await storage.readWorkspaceQuotaUsage(userId)
    expect(after.personalBytes).toBeLessThan(before.personalBytes)
  })

  it('counts an active staged-file reservation against competing JSON growth', async () => {
    await resetPersonalNearLimit()
    const version = await storage.readWorkspaceQuotaSourceVersion('application', 'quota_atomic_app_a')
    const digest = createHash('sha256').update('reserved-file').digest('hex')
    const reservation = await storage.reserveWorkspaceQuota({
      domainKind: 'personal',
      domainId: userId,
      sourceKind: 'application',
      sourceId: 'quota_atomic_app_a',
      expectedSourceVersion: version,
      requestId: 'quota-reservation-competing-growth',
      observedFiles: [{ storageName: 'quota-reserved-a.bin', size: GROWTH_BYTES, digest }],
    })
    try {
      const competing = await storage.readStore()
      competing.applications.find((item) => item.id === 'quota_atomic_app_b').program = 'c'.repeat(GROWTH_BYTES)
      await expect(storage.lockedWriteStore(competing)).rejects.toMatchObject({
        status: 413,
        code: 'STORAGE_QUOTA_EXCEEDED',
      })
    } finally {
      await storage.releaseWorkspaceQuotaReservation(reservation.token)
    }
  })

  it('replays an identical reservation and rejects key reuse with different content', async () => {
    await resetPersonalNearLimit()
    const version = await storage.readWorkspaceQuotaSourceVersion('application', 'quota_atomic_app_a')
    const firstInput = {
      domainKind: 'personal',
      domainId: userId,
      sourceKind: 'application',
      sourceId: 'quota_atomic_app_a',
      expectedSourceVersion: version,
      requestId: 'quota-reservation-replay',
      observedFiles: [{
        storageName: 'quota-replay.bin',
        size: 20_000,
        digest: createHash('sha256').update('same').digest('hex'),
      }],
    }
    const first = await storage.reserveWorkspaceQuota(firstInput)
    try {
      await expect(storage.reserveWorkspaceQuota(firstInput)).resolves.toMatchObject({
        token: first.token,
        replayed: true,
      })
      await expect(storage.reserveWorkspaceQuota({
        ...firstInput,
        observedFiles: [{
          ...firstInput.observedFiles[0],
          size: 20_001,
        }],
      })).rejects.toMatchObject({
        status: 409,
        code: 'WORKSPACE_QUOTA_RESERVATION_CONFLICT',
      })
    } finally {
      await storage.releaseWorkspaceQuotaReservation(first.token)
    }
  })

  it('consumes a verified file reservation in the same transaction as its source index', async () => {
    const beforeBytes = await resetPersonalNearLimit()
    const version = await storage.readWorkspaceQuotaSourceVersion('application', 'quota_atomic_app_a')
    const storageName = 'quota-committed.bin'
    const reservation = await storage.reserveWorkspaceQuota({
      domainKind: 'personal',
      domainId: userId,
      sourceKind: 'application',
      sourceId: 'quota_atomic_app_a',
      expectedSourceVersion: version,
      requestId: 'quota-reservation-commit',
      observedFiles: [{
        storageName,
        size: GROWTH_BYTES,
        digest: createHash('sha256').update('committed').digest('hex'),
      }],
    })
    const store = await storage.readStore()
    const application = store.applications.find((item) => item.id === 'quota_atomic_app_a')
    application.materials.push({
      id: 'quota-reserved-material',
      name: 'Reserved file',
      storageName,
      fileSize: GROWTH_BYTES,
      versions: [],
    })
    await storage.lockedWriteStore(store, { quotaReservationTokens: [reservation.token] })
    const usage = await storage.readWorkspaceQuotaUsage(userId)
    expect(usage.personalBytes - beforeBytes).toBeGreaterThanOrEqual(GROWTH_BYTES)

    const retry = await storage.readStore()
    retry.applications.find((item) => item.id === 'quota_atomic_app_a').program = 'retry'
    await expect(storage.lockedWriteStore(retry, {
      quotaReservationTokens: [reservation.token],
    })).rejects.toMatchObject({
      status: 409,
      code: 'WORKSPACE_QUOTA_RESERVATION_INVALID',
    })
  })

  it('journals physical deletion only after the canonical reference is removed', async () => {
    const storageName = 'quota-delete-journal.bin'
    await writeFresh((store) => {
      const user = store.users.find((candidate) => candidate.id === userId)
      user.settings = { ...(user.settings ?? {}), storageQuotaMb: 10 }
      const application = store.applications.find((item) => item.id === 'quota_atomic_app_b')
      application.materials.push({
        id: 'quota-delete-journal-material',
        name: 'Delete journal',
        storageName,
        fileSize: 1024,
        versions: [],
      })
    })
    await writeFresh((store) => {
      const application = store.applications.find((item) => item.id === 'quota_atomic_app_b')
      application.materials = application.materials.filter((item) => item.id !== 'quota-delete-journal-material')
    })

    const claim = await storage.claimNextWorkspaceUploadDeletion()
    expect(claim).toMatchObject({ storageName })
    const racingReference = await storage.readStore()
    racingReference.applications.find((item) => item.id === 'quota_atomic_app_b').materials.push({
      id: 'quota-delete-journal-race',
      name: 'Must wait',
      storageName,
      fileSize: 1024,
      versions: [],
    })
    await expect(storage.lockedWriteStore(racingReference)).rejects.toMatchObject({
      status: 409,
      code: 'WORKSPACE_UPLOAD_DELETION_CONFLICT',
    })
    await storage.finishWorkspaceUploadDeletion(claim.token, storageName, { deleted: false })

    await writeFresh((store) => {
      store.applications.find((item) => item.id === 'quota_atomic_app_b').materials.push({
        id: 'quota-delete-journal-restored',
        name: 'Restored reference',
        storageName,
        fileSize: 1024,
        versions: [],
      })
    })
    await expect(storage.claimNextWorkspaceUploadDeletion()).resolves.toBeNull()
  })
})
