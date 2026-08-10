import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const LARGE_UNRELATED_BYTES = 20 * 1024 * 1024
const UNRELATED_TENANT_SENTINEL = 'UNRELATED_PUBLIC_GRANT_TENANT_SECRET'
const VALID_TOKEN = 'public-grant-valid-token'
const EDIT_TOKEN = 'public-grant-edit-token'
const EXPIRED_TOKEN = 'public-grant-expired-token'
const PROFILE_TOKEN = 'public-profile-valid-token'
const CALENDAR_TOKEN = 'public-calendar-valid-token'
const FILE_ID = 'public-grant-file-id'
const STORAGE_NAME = 'public-grant-file.bin'

let app
let baseUrl
let server
let storage
let testRoot
let ownerId
let targetApplicationId
let targetProfileAssetId

async function waitForLedgerRelease(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = app.locals.memoryReservationLedger.snapshot()
    if (snapshot.activeReservations === 0 && snapshot.reservedBytes === 0) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Memory reservations did not drain: ${JSON.stringify(app.locals.memoryReservationLedger.snapshot())}`)
}

function focusedSelector(applicationId, publicGrant = undefined) {
  return {
    includeApplications: false,
    applicationIds: applicationId ? [applicationId] : [],
    includeProfileAssets: false,
    includeTeams: false,
    includeTeamPeers: false,
    includeSystemEvents: false,
    publicGrant,
    retainMemoryReservation: false,
  }
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-public-grants-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'public-grant-hydration-test-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'public-grant-settings-test-key')

  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const { createUploadVault } = await import('./uploadVault.js')
  const vault = createUploadVault({ root: storage.uploadRoot })
  await vault.ensureReady()
  await vault.writeBuffer(STORAGE_NAME, Buffer.from('indexed public file'))

  const setup = await storage.readStore()
  const owner = setup.users.find((candidate) => candidate.email === 'jasper@example.com')
    ?? setup.users.find((candidate) => candidate.role !== 'admin')
  const sourceApplication = setup.applications.find((candidate) => candidate.ownerId === owner?.id)
    ?? setup.applications[0]
  const sourceAsset = setup.profileAssets.find((candidate) => candidate.ownerId === owner?.id)
    ?? setup.profileAssets[0]
  if (!owner || !sourceApplication || !sourceAsset) {
    throw new Error('The public grant fixture requires one owner, application, and Profile asset.')
  }
  ownerId = owner.id
  owner.settings = { ...owner.settings, calendarToken: CALENDAR_TOKEN }

  const outsider = {
    ...structuredClone(owner),
    id: 'public_grant_outsider',
    email: 'public-grant-outsider@example.test',
    name: 'Unrelated public grant tenant',
    createdAt: new Date().toISOString(),
    settings: {
      ...structuredClone(owner.settings),
      calendarToken: undefined,
      storageQuotaMb: 100,
    },
  }
  setup.users.push(outsider)

  targetApplicationId = 'public_grant_target_application'
  const target = {
    ...structuredClone(sourceApplication),
    id: targetApplicationId,
    ownerId,
    teamId: null,
    school: { ...structuredClone(sourceApplication.school), name: 'Public Target University' },
    program: 'Public Grant Program',
    notes: 'Small public target',
    materials: [{
      id: 'public_grant_material',
      name: 'Public indexed file',
      file: 'public-grant-file.bin',
      fileName: 'public-grant-file.bin',
      fileId: FILE_ID,
      storageName: STORAGE_NAME,
      fileSize: Buffer.byteLength('indexed public file'),
      uploadReserved: true,
      versions: [],
    }],
    tasks: [{ id: 'public_grant_task', title: 'Public task', due: '2026-10-01', done: false }],
    shares: [
      {
        id: 'public_grant_valid',
        token: VALID_TOKEN,
        permission: 'view',
        sections: ['overview', 'materials'],
        createdAt: '2026-08-02T00:00:00.000Z',
        expiresAt: '2099-12-31T23:59:59.000Z',
      },
      {
        id: 'public_grant_edit',
        token: EDIT_TOKEN,
        permission: 'edit',
        sections: ['overview', 'tasks'],
        createdAt: '2026-08-02T00:00:00.000Z',
        expiresAt: '2099-12-31T23:59:59.000Z',
      },
      {
        id: 'public_grant_expired',
        token: EXPIRED_TOKEN,
        permission: 'view',
        sections: ['overview'],
        createdAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-01-02T00:00:00.000Z',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const unrelated = {
    ...structuredClone(sourceApplication),
    id: 'public_grant_unrelated_large_application',
    ownerId: outsider.id,
    teamId: null,
    notes: `${UNRELATED_TENANT_SENTINEL}:${'x'.repeat(LARGE_UNRELATED_BYTES)}`,
    materials: [],
    shares: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  setup.applications.push(target, unrelated)

  targetProfileAssetId = 'public_grant_profile_asset'
  setup.profileAssets.push({
    ...structuredClone(sourceAsset),
    id: targetProfileAssetId,
    ownerId,
    teamId: null,
    name: 'Public Profile upload target',
    attachments: [],
    shares: [{
      id: 'public_profile_valid',
      token: PROFILE_TOKEN,
      note: 'Upload the signed document.',
      createdAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2099-12-31T23:59:59.000Z',
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await storage.lockedWriteStore(setup)

  expect(await storage.findWorkspacePublicGrant('application-share', VALID_TOKEN)).toMatchObject({
    sourceId: targetApplicationId,
    ownerId,
    grantId: 'public_grant_valid',
  })
  expect(await storage.findWorkspacePublicGrant('profile-share', PROFILE_TOKEN)).toMatchObject({
    sourceId: targetProfileAssetId,
    ownerId,
  })
  expect(await storage.findWorkspacePublicGrant('calendar', CALENDAR_TOKEN)).toMatchObject({ ownerId })

  const index = await import('./index.js')
  app = index.createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  // Explicitly invalidate the fixture's last broad read before measuring the
  // public routes. This is a real scoped transaction, not a test-only hook.
  const compactOwner = await storage.readScopedStore(ownerId, {
    ...focusedSelector(null),
    compactWorkspaceUsers: true,
  })
  await storage.lockedWriteStore(compactOwner)
}, 120_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 30_000)

describe.sequential('hash-only public grant hydration', () => {
  it('keeps 100 invalid share/file/calendar tokens on a constant small workset', async () => {
    const pid = process.pid
    const cacheBefore = storage.sharedStoreCacheDiagnostics()
    const scopedHydrationBefore = storage.scopedStoreHydrationDiagnostics()
    const ledgerBefore = app.locals.memoryReservationLedger.snapshot()
    expect(ledgerBefore).toMatchObject({ activeReservations: 0, reservedBytes: 0 })

    const responses = await Promise.all(Array.from({ length: 100 }, (_, index) => {
      const token = `invalid-public-token-${index}`
      const pathname = index % 3 === 0
        ? `/api/share/${token}`
        : index % 3 === 1
          ? `/api/share/${token}/files/${FILE_ID}/download`
          : `/api/calendar/feed?token=${token}`
      return fetch(`${baseUrl}${pathname}`)
    }))
    expect(responses.every((response, index) => response.status === (index % 3 === 2 ? 401 : 404)))
      .toBe(true)
    await Promise.all(responses.map((response) => response.arrayBuffer()))

    expect(storage.sharedStoreCacheDiagnostics()).toEqual(cacheBefore)
    expect(storage.scopedStoreHydrationDiagnostics()).toEqual(scopedHydrationBefore)
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
    expect(process.pid).toBe(pid)
  }, 60_000)

  it('serves valid targets, preserves expiry, and keeps the unrelated 20 MiB tenant out', async () => {
    const cacheBefore = storage.sharedStoreCacheDiagnostics()

    const shared = await fetch(`${baseUrl}/api/share/${VALID_TOKEN}`)
    expect(shared.status, await shared.clone().text()).toBe(200)
    const sharedText = await shared.text()
    expect(sharedText).not.toContain(UNRELATED_TENANT_SENTINEL)
    expect(Buffer.byteLength(sharedText, 'utf8')).toBeLessThan(1024 * 1024)
    const sharedPayload = JSON.parse(sharedText)
    expect(sharedPayload.data ?? sharedPayload).toMatchObject({
      school: { name: 'Public Target University' },
      program: 'Public Grant Program',
    })

    const download = await fetch(`${baseUrl}/api/share/${VALID_TOKEN}/files/${FILE_ID}/download`)
    expect(download.status, await download.clone().text()).toBe(200)
    expect(Buffer.from(await download.arrayBuffer()).toString('utf8')).toBe('indexed public file')

    const expired = await fetch(`${baseUrl}/api/share/${EXPIRED_TOKEN}`)
    expect(expired.status).toBe(410)
    await expired.arrayBuffer()

    const profile = await fetch(`${baseUrl}/api/asset-upload/${PROFILE_TOKEN}`)
    expect(profile.status, await profile.clone().text()).toBe(200)
    expect((await profile.json()).data).toMatchObject({ assetName: 'Public Profile upload target' })

    const calendar = await fetch(`${baseUrl}/api/calendar/feed?token=${CALENDAR_TOKEN}`)
    expect(calendar.status, await calendar.clone().text()).toBe(200)
    expect(await calendar.text()).toContain('BEGIN:VCALENDAR')

    await waitForLedgerRelease()
    expect(storage.sharedStoreCacheDiagnostics()).toEqual(cacheBefore)
    expect(app.locals.memoryReservationLedger.snapshot().peakReservedBytes).toBeLessThan(160 * 1024 * 1024)
  }, 60_000)

  it('rejects a stale shared mutation after revocation and removes revoked token lookups', async () => {
    const pid = process.pid
    const grant = await storage.findWorkspacePublicGrant('application-share', EDIT_TOKEN)
    const stale = await storage.readScopedStore(ownerId, focusedSelector(targetApplicationId, grant))
    const latest = await storage.readScopedStore(ownerId, focusedSelector(targetApplicationId))
    const latestApplication = latest.applications.find(({ id }) => id === targetApplicationId)
    latestApplication.shares = latestApplication.shares.filter((share) => share.token !== EDIT_TOKEN)
    latestApplication.updatedAt = new Date().toISOString()
    await storage.lockedWriteStore(latest)

    const staleApplication = stale.applications.find(({ id }) => id === targetApplicationId)
    staleApplication.tasks[0].done = true
    staleApplication.updatedAt = new Date().toISOString()
    await expect(storage.lockedWriteStore(stale)).rejects.toMatchObject({
      code: 'PUBLIC_GRANT_CONFLICT',
      status: 409,
    })
    expect(await storage.findWorkspacePublicGrant('application-share', EDIT_TOKEN)).toBeNull()

    const revoked = await fetch(`${baseUrl}/api/share/${EDIT_TOKEN}`)
    expect(revoked.status).toBe(404)
    await revoked.arrayBuffer()
    await waitForLedgerRelease()
    expect(storage.sharedStoreCacheDiagnostics().populated).toBe(false)
    expect(process.pid).toBe(pid)
  }, 30_000)
})
