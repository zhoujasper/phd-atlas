import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let storage
let testRoot
let userId
let applicationId

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-quota-expiry-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()

  const store = await storage.readStore()
  const application = store.applications.find((candidate) => candidate.ownerId)
  if (!application) throw new Error('Quota-expiry fixture requires an owned application.')
  applicationId = application.id
  userId = application.ownerId
}, 120_000)

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

afterAll(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 120_000)

async function reserve(requestId) {
  const expectedSourceVersion = await storage.readWorkspaceQuotaSourceVersion(
    'application',
    applicationId,
  )
  return storage.reserveWorkspaceQuota({
    domainKind: 'personal',
    domainId: userId,
    sourceKind: 'application',
    sourceId: applicationId,
    expectedSourceVersion,
    requestId,
    reserveBytes: 1024,
    ttlMs: 30_000,
  })
}

describe.sequential('workspace quota reservation expiry lifecycle', () => {
  it('preserves a not-yet-expired reservation and stops heartbeat immediately on release', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    const initialTimers = vi.getTimerCount()
    const reservation = await reserve('quota-expiry-live')
    expect(vi.getTimerCount()).toBe(initialTimers + 1)

    await vi.advanceTimersByTimeAsync(29_999)
    await expect(storage.releaseWorkspaceQuotaReservation(reservation.token)).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(initialTimers)
  })

  it('reclaims this live process reservation at its own expiry and stops heartbeat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T13:00:00.000Z'))
    const initialTimers = vi.getTimerCount()
    const reservation = await reserve('quota-expiry-current-process')
    expect(vi.getTimerCount()).toBe(initialTimers + 1)

    // The first heartbeat refreshes the process lease. The second crosses the
    // independent 30-second reservation lease and must still reclaim the row.
    await vi.advanceTimersByTimeAsync(30_001)
    await expect(storage.releaseWorkspaceQuotaReservation(reservation.token)).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(initialTimers)
  })
})
