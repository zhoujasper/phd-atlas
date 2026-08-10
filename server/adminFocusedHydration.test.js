import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const LARGE_TEAM_BYTES = 20 * 1024 * 1024
const FILE_ID = 'admin_focused_file'
const STORAGE_NAME = 'admin-focused-file.bin'

let app
let baseUrl
let server
let storage
let testRoot
let adminToken
let outsiderToken
let adminId
let targetApplicationId
let fileApplicationId

async function login(email, password, scope = 'app') {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, scope }),
  })
  const payload = await response.json()
  if (response.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(payload)}`)
  return payload.data.token
}

async function waitForLedgerRelease(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = app.locals.memoryReservationLedger.snapshot()
    if (snapshot.activeReservations === 0 && snapshot.reservedBytes === 0) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Memory reservations did not drain: ${JSON.stringify(app.locals.memoryReservationLedger.snapshot())}`)
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-admin-focused-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'admin-focused-hydration-test-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'admin-focused-settings-test-key')

  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const { createUploadVault } = await import('./uploadVault.js')
  const vault = createUploadVault({ root: storage.uploadRoot })
  await vault.ensureReady()
  await vault.writeBuffer(STORAGE_NAME, Buffer.alloc(128 * 1024, 0x61))

  const initial = await storage.readStore()
  adminId = initial.users.find((candidate) => candidate.email === 'admin@phd-atlas.local')?.id
  const owner = initial.users.find((candidate) => candidate.email === 'jasper@example.com')
    ?? initial.users.find((candidate) => candidate.role !== 'admin')
  if (!owner) throw new Error('The focused hydration fixture requires a personal account.')
  const outsider = {
    ...structuredClone(owner),
    id: 'admin_focused_outsider',
    email: 'admin-focused-outsider@example.test',
    name: 'Admin focused outsider',
    createdAt: new Date().toISOString(),
  }
  initial.users.push(outsider)
  await storage.lockedWriteStore(initial)
  const team = await storage.createTeam(owner.id, 'Large focused hydration Team')

  const setup = await storage.readStore()
  const application = setup.applications.find((candidate) => candidate.ownerId === owner.id)
    ?? setup.applications[0]
  if (!application) throw new Error('The focused hydration fixture requires one application.')
  const focusedApplication = structuredClone(application)
  fileApplicationId = application.id
  application.ownerId = owner.id
  application.teamId = team.id
  application.notes = 'x'.repeat(LARGE_TEAM_BYTES)
  application.materials = [
    ...(application.materials ?? []).filter((material) => material.fileId !== FILE_ID),
    {
      id: 'admin_focused_material',
      name: 'Indexed download',
      file: 'indexed-download.bin',
      fileName: 'indexed-download.bin',
      fileId: FILE_ID,
      storageName: STORAGE_NAME,
      fileSize: 128 * 1024,
      uploadReserved: true,
      versions: [],
    },
  ]
  targetApplicationId = 'admin_focused_small_application'
  focusedApplication.id = targetApplicationId
  focusedApplication.ownerId = owner.id
  focusedApplication.teamId = team.id
  focusedApplication.notes = 'Small focused application'
  focusedApplication.materials = []
  focusedApplication.createdAt = new Date().toISOString()
  focusedApplication.updatedAt = focusedApplication.createdAt
  setup.applications.push(focusedApplication)
  await storage.lockedWriteStore(setup)
  expect(await storage.listWorkspaceFileReferences(FILE_ID)).toEqual([
    expect.objectContaining({
      sourceKind: 'application',
      sourceId: fileApplicationId,
      ownerId: owner.id,
      teamId: team.id,
      storageName: STORAGE_NAME,
    }),
  ])

  const index = await import('./index.js')
  app = index.createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  adminToken = await login('admin@phd-atlas.local', 'admin123456', 'admin')
  outsiderToken = await login(outsider.email, 'demo123456')
  const compactAdmin = await storage.readScopedStore(adminId, {
    includeApplications: false,
    includeProfileAssets: false,
    includeTeams: false,
    includeTeamPeers: false,
    includeSystemEvents: false,
    compactWorkspaceUsers: true,
    retainMemoryReservation: false,
  })
  await storage.lockedWriteStore(compactAdmin)
}, 120_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 30_000)

describe.sequential('administrator focused hydration', () => {
  it('keeps auth-only routes and indexed Team downloads off the global workspace snapshot', async () => {
    const pid = process.pid
    const before = storage.sharedStoreCacheDiagnostics()
    expect(before.populated).toBe(false)

    const notifications = await Promise.all(Array.from({ length: 100 }, () => fetch(
      `${baseUrl}/api/notifications/unread-count`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    )))
    expect(notifications.every((response) => response.status === 200)).toBe(true)
    await Promise.all(notifications.map((response) => response.arrayBuffer()))

    for (const pathname of ['/api/push/public-key', '/api/backups']) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
      expect(response.status, await response.clone().text()).toBe(200)
      await response.arrayBuffer()
    }

    const focused = await fetch(`${baseUrl}/api/applications/${encodeURIComponent(targetApplicationId)}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(focused.status).toBe(200)
    await focused.body.cancel()

    const download = await fetch(`${baseUrl}/api/files/${FILE_ID}/download`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(download.status, await download.clone().text()).toBe(200)
    expect((await download.arrayBuffer()).byteLength).toBe(128 * 1024)

    const denied = await fetch(`${baseUrl}/api/files/${FILE_ID}/download`, {
      headers: { authorization: `Bearer ${outsiderToken}` },
    })
    expect(denied.status).toBe(404)
    await denied.arrayBuffer()

    const controller = new AbortController()
    const events = await fetch(`${baseUrl}/api/events`, {
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${adminToken}`,
      },
      signal: controller.signal,
    })
    expect(events.status).toBe(200)
    const reader = events.body.getReader()
    const firstFrame = await reader.read()
    expect(firstFrame.done).toBe(false)
    controller.abort()
    await reader.cancel().catch(() => undefined)

    await waitForLedgerRelease()
    expect(storage.sharedStoreCacheDiagnostics()).toEqual(before)
    expect(process.pid).toBe(pid)
  }, 60_000)
})
