import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const DOWNLOAD_BYTES = 20 * 1024 * 1024
const FILE_ID = 'stream_admission_slow_file'
const STORAGE_NAME = 'stream-admission-slow-file.bin'
const SHARE_TOKEN = 'stream-admission-public-share-token'

let app
let baseUrl
let server
let storage
let testRoot
let token
let owner

function waitFor(predicate, describeState, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for response-stream state: ${JSON.stringify(describeState())}`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

function openPausedDownload(pathname, authorizationToken = null) {
  let request
  let response
  const ready = new Promise((resolve, reject) => {
    request = http.get(`${baseUrl}${pathname}`, {
      headers: authorizationToken ? { authorization: `Bearer ${authorizationToken}` } : {},
    }, (incoming) => {
      response = incoming
      incoming.pause()
      resolve(incoming)
    })
    request.once('error', reject)
  })
  return {
    ready,
    close() {
      response?.destroy()
      request?.destroy()
    },
  }
}

async function expectHeavyRoutesRemainLive() {
  const streamSnapshot = () => app.locals.streamAdmission.snapshot()
  const heavySnapshot = () => app.locals.heavyWorkAdmission.snapshot()
  const ledgerSnapshot = () => app.locals.memoryReservationLedger.snapshot()
  expect(streamSnapshot()).toMatchObject({ active: 1, activeLeases: 1 })
  expect(heavySnapshot().active).toBe(0)
  expect(ledgerSnapshot()).toMatchObject({
    activeReservations: 1,
    reservedBytes: 512 * 1024,
  })

  const bootstrap = await fetch(`${baseUrl}/api/workspace/bootstrap`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(bootstrap.status, await bootstrap.clone().text()).toBe(200)

  const exported = await fetch(`${baseUrl}/api/exports?format=json`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(exported.status, await exported.clone().text()).toBe(200)

  expect(streamSnapshot()).toMatchObject({ active: 1, activeLeases: 1 })
  expect(heavySnapshot()).toMatchObject({ active: 0, waiting: 0 })
  expect(ledgerSnapshot()).toMatchObject({
    activeReservations: 1,
    reservedBytes: 512 * 1024,
  })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-stream-routes-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'stream-admission-routes-test-key')
  vi.stubEnv('HEAVY_WORK_MAX_ACTIVE', '1')
  vi.stubEnv('STREAM_MAX_ACTIVE', '1')
  vi.stubEnv('STREAM_MAX_QUEUED', '1')
  vi.stubEnv('STREAM_MAX_ACTIVE_PER_PRINCIPAL', '1')
  vi.stubEnv('STREAM_MAX_QUEUED_PER_PRINCIPAL', '1')
  vi.stubEnv('STREAM_IDLE_TIMEOUT_MS', '10000')
  vi.stubEnv('STREAM_BUFFER_RESERVATION_BYTES', String(512 * 1024))

  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const { createUploadVault } = await import('./uploadVault.js')
  const fixtureVault = createUploadVault({ root: storage.uploadRoot })
  await fixtureVault.ensureReady()
  await fixtureVault.writeBuffer(STORAGE_NAME, Buffer.alloc(DOWNLOAD_BYTES, 0x61))

  const store = await storage.readStore()
  owner = store.users.find((candidate) => candidate.email === 'jasper@example.com') ?? store.users[0]
  const application = store.applications.find((candidate) => candidate.ownerId === owner.id)
    ?? store.applications[0]
  if (!owner || !application) throw new Error('The isolated stream fixture requires one owner and application.')
  application.ownerId = owner.id
  application.materials = [
    ...(application.materials ?? []),
    {
      ...(application.materials?.[0] ?? {}),
      id: 'stream_admission_material',
      name: 'Slow response stream fixture',
      file: 'slow-response.bin',
      fileName: 'slow-response.bin',
      fileId: FILE_ID,
      storageName: STORAGE_NAME,
      uploadReserved: true,
      versions: [],
    },
  ]
  application.shares = [
    ...(application.shares ?? []).filter((share) => share.token !== SHARE_TOKEN),
    {
      id: 'stream_admission_public_share',
      token: SHARE_TOKEN,
      permission: 'view',
      sections: ['materials'],
      createdAt: '2026-08-02T10:00:00.000Z',
      expiresAt: '2099-12-31T23:59:59.000Z',
    },
  ]
  await storage.lockedWriteStore(store)

  const index = await import('./index.js')
  app = index.createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: owner.email,
      password: 'demo123456',
      scope: 'app',
    }),
  })
  const loginPayload = await login.json()
  if (login.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(loginPayload)}`)
  token = loginPayload.data.token
}, 60_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 30_000)

describe('response stream admission routes', () => {
  it('keeps a slow authenticated download outside the unique HEAVY slot', async () => {
    const slow = openPausedDownload(`/api/files/${FILE_ID}/download`, token)
    try {
      const response = await slow.ready
      expect(response.statusCode).toBe(200)
      await waitFor(
        () => app.locals.streamAdmission.snapshot().activeLeases === 1,
        () => app.locals.streamAdmission.snapshot(),
      )
      await expectHeavyRoutesRemainLive()
    } finally {
      slow.close()
    }
    await waitFor(
      () => app.locals.streamAdmission.snapshot().activeLeases === 0,
      () => app.locals.streamAdmission.snapshot(),
    )
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
  }, 30_000)

  it('keeps a slow unauthenticated public-share download outside the unique HEAVY slot', async () => {
    const slow = openPausedDownload(`/api/share/${SHARE_TOKEN}/files/${FILE_ID}/download`)
    try {
      const response = await slow.ready
      expect(response.statusCode).toBe(200)
      await waitFor(
        () => app.locals.streamAdmission.snapshot().activeLeases === 1,
        () => app.locals.streamAdmission.snapshot(),
      )
      await expectHeavyRoutesRemainLive()
    } finally {
      slow.close()
    }
    await waitFor(
      () => app.locals.streamAdmission.snapshot().activeLeases === 0,
      () => app.locals.streamAdmission.snapshot(),
    )
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
  }, 30_000)

  it('returns one strict retryable 503 while active and queued stream buffers stay bounded', async () => {
    const snapshot = () => app.locals.streamAdmission.snapshot()
    const first = openPausedDownload(`/api/files/${FILE_ID}/download`, token)
    const queuedController = new AbortController()
    let queuedResponsePromise
    try {
      expect((await first.ready).statusCode).toBe(200)
      await waitFor(() => snapshot().active === 1, snapshot)
      // Queue a different principal behind the global slot. A second request
      // from the active account is then refused by the account bound without
      // allocating another stream buffer.
      queuedResponsePromise = fetch(`${baseUrl}/api/share/${SHARE_TOKEN}/files/${FILE_ID}/download`, {
        signal: queuedController.signal,
      })
      await waitFor(() => snapshot().active === 1 && snapshot().waiting === 1, snapshot)
      const beforeBusy = snapshot()

      const busy = await fetch(`${baseUrl}/api/files/${FILE_ID}/download`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = await busy.json()
      expect(busy.status).toBe(503)
      expect(busy.headers.get('retry-after')).toBe('1')
      expect(busy.headers.get('x-phd-retry-after-ms')).toBe('1000')
      expect(busy.headers.get('x-request-id')).toBe(payload.requestId)
      expect(payload).toEqual({
        ok: false,
        error: {
          code: 'SERVER_BUSY',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      })
      expect(snapshot()).toMatchObject({
        active: 1,
        waiting: 1,
        activeLeases: 1,
        reservedBytes: 512 * 1024,
        rejected: beforeBusy.rejected + 1,
      })
    } finally {
      first.close()
    }

    const queued = await queuedResponsePromise
    expect(queued.status).toBe(200)
    await queued.body.cancel()
    queuedController.abort()
    await waitFor(
      () => snapshot().activeLeases === 0 && snapshot().waiting === 0,
      snapshot,
    )
    expect(snapshot()).toMatchObject({ active: 0, waiting: 0, reservedBytes: 0 })
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
  }, 30_000)

  it('classifies only exact long-lived response routes for the dedicated stream pool', async () => {
    const { isDedicatedResponseStreamRequest } = await import('./index.js')
    const classify = (method, url) => isDedicatedResponseStreamRequest({ method, originalUrl: url })
    expect(classify('GET', '/api/workspace/bootstrap/stream?sections=applications')).toBe(true)
    expect(classify('HEAD', '/api/files/file-id/download')).toBe(true)
    expect(classify('GET', '/api/share/token/files/file-id/download')).toBe(true)
    expect(classify('GET', '/api/admin/backups/checkpoint.json/download')).toBe(true)
    expect(classify('POST', '/api/files/file-id/download')).toBe(false)
    expect(classify('GET', '/api/files/file-id/download/extra')).toBe(false)
    expect(classify('GET', '/api/profile-assets/asset/export')).toBe(false)
  })
})
