import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const BODY_PREFIX_BYTES = 64
const BODY_PADDING_BYTES = 32 * 1024

let app
let baseUrl
let memoryPressureGuard
let server
let storage
let testRoot
let workspaceStreamPreAuthAdmissionKey
let workspaceStreamPreAuthPause = null

function createControllableMemoryPressureGuard() {
  let level = 'hard'
  let rssBytes = 480 * 1024 * 1024
  const calls = []
  const counters = {
    admitted: 0,
    rejected: 0,
    healthBypasses: 0,
  }

  const snapshot = () => ({
    initialized: true,
    level,
    budgetBytes: 512 * 1024 * 1024,
    budgetSource: 'configured',
    softThresholdBytes: 384 * 1024 * 1024,
    hardThresholdBytes: 448 * 1024 * 1024,
    lastRssBytes: rssBytes,
    lastSampleFailed: false,
    pressureRatio: rssBytes / (512 * 1024 * 1024),
    counters: { ...counters },
  })

  return {
    admit(workClass) {
      const allowed = workClass === 'health'
        || level === 'normal'
        || (level === 'soft' && workClass === 'standard')
      calls.push({ workClass, level, allowed })
      if (allowed) {
        counters.admitted += 1
        if (workClass === 'health' && level !== 'normal') counters.healthBypasses += 1
      } else {
        counters.rejected += 1
      }
      return {
        allowed,
        workClass,
        level,
        code: allowed ? null : `MEMORY_PRESSURE_${level.toUpperCase()}`,
        retryAfterMs: allowed ? null : 1_250,
        rssBytes: snapshot().lastRssBytes,
        budgetBytes: snapshot().budgetBytes,
      }
    },
    calls,
    clearCalls() {
      calls.length = 0
    },
    sample: snapshot,
    setLevel(nextLevel) {
      level = nextLevel
      rssBytes = nextLevel === 'hard'
        ? 480 * 1024 * 1024
        : nextLevel === 'soft'
          ? 400 * 1024 * 1024
          : 128 * 1024 * 1024
    },
    setRssBytes(nextValue) {
      rssBytes = Number(nextValue)
    },
    snapshot,
  }
}

function waitFor(predicate, describeState, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for memory-pressure routing: ${JSON.stringify(describeState())}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

function openPausedJsonRequest(pathname, clientIp) {
  const body = Buffer.from(JSON.stringify({
    probe: true,
    padding: 'x'.repeat(BODY_PADDING_BYTES),
  }))
  let request
  let finished = false
  const result = new Promise((resolve, reject) => {
    request = http.request(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        connection: 'keep-alive',
        'content-length': body.byteLength,
        'content-type': 'application/json',
        'x-forwarded-for': clientIp,
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let payload
        try {
          payload = JSON.parse(text)
        } catch (error) {
          reject(new Error(`Expected JSON, received ${text.slice(0, 200)}`, { cause: error }))
          return
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          payload,
        })
      })
    })
    request.once('error', reject)
    request.flushHeaders()
    request.write(body.subarray(0, BODY_PREFIX_BYTES))
  })

  return {
    result,
    get finished() {
      return finished
    },
    finish() {
      if (finished || request.destroyed || request.writableEnded) return
      finished = true
      request.end(body.subarray(BODY_PREFIX_BYTES))
    },
    destroy() {
      request.destroy()
    },
  }
}

function sendChunkedJsonRequest(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: response.statusCode,
          headers: response.headers,
          payload: JSON.parse(text),
        })
      })
    })
    request.once('error', reject)
    // Writing without Content-Length makes Node use Transfer-Encoding: chunked.
    request.write('{"probe":')
    request.end('true}')
  })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-memory-routes-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('TRUST_PROXY', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'memory-pressure-routes-test-key')
  vi.stubEnv('REQUEST_BODY_MAX_ACTIVE', '1')
  vi.stubEnv('REQUEST_BODY_MAX_ACTIVE_PER_IP', '1')
  vi.stubEnv('REQUEST_BODY_MAX_QUEUED', '4')
  vi.stubEnv('REQUEST_BODY_MAX_QUEUED_PER_IP', '1')
  vi.stubEnv('REQUEST_BODY_WAIT_TIMEOUT_MS', '5000')
  vi.stubEnv('REQUEST_BODY_DEADLINE_MS', '5000')
  // An operator may raise password headroom but cannot weaken the safe floor.
  vi.stubEnv('AUTH_PASSWORD_MEMORY_RESERVATION_BYTES', '1')

  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const indexModule = await import('./index.js')
  const { createApp } = indexModule
  workspaceStreamPreAuthAdmissionKey = indexModule.workspaceStreamPreAuthAdmissionKey
  memoryPressureGuard = createControllableMemoryPressureGuard()
  app = createApp({
    testHooks: {
      memoryPressureGuard,
      workspaceStreamPreAuthAfterAcquire: ({ signal }) => workspaceStreamPreAuthPause?.(signal),
    },
  })
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 30_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 30_000)

describe('memory-pressure route integration', () => {
  it('keeps exact liveness probes live and readiness truthful at hard pressure', async () => {
    memoryPressureGuard.setLevel('hard')
    memoryPressureGuard.clearCalls()

    const health = await fetch(`${baseUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      ok: true,
      data: {
        status: 'degraded',
        ready: false,
        eventLoopLagP50: expect.any(Number),
        eventLoopLagP99: expect.any(Number),
        rssBytes: expect.any(Number),
        memoryBudgetBytes: 512 * 1024 * 1024,
        pressureLevel: 'hard',
        memoryPressure: {
          level: 'hard',
          pressureRatio: 0.9375,
        },
      },
    })

    const headHealth = await fetch(`${baseUrl}/api/health`, { method: 'HEAD' })
    expect(headHealth.status).toBe(200)
    expect(await headHealth.text()).toBe('')

    const liveness = await fetch(`${baseUrl}/api/health/live`)
    expect(liveness.status).toBe(200)
    expect(await liveness.json()).toMatchObject({
      ok: true,
      data: { status: 'ok', live: true },
    })

    const readiness = await fetch(`${baseUrl}/api/health/ready`)
    expect(readiness.status).toBe(503)
    expect(readiness.headers.get('retry-after')).toBe('1')
    expect(await readiness.json()).toMatchObject({
      ok: false,
      error: {
        code: 'SERVER_BUSY',
        message: expect.any(String),
      },
      requestId: expect.any(String),
    })

    for (const pathname of ['/api/auth/me', '/api/health/extra']) {
      const response = await fetch(`${baseUrl}${pathname}`)
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('2')
      expect(response.headers.get('x-phd-retry-after-ms')).toBe('1250')
      expect(response.headers.get('x-phd-memory-pressure')).toBe('hard')
      expect(await response.json()).toMatchObject({
        ok: false,
        error: {
          code: 'SERVER_BUSY',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      })
    }

    const preflight = await fetch(`${baseUrl}/api/applications`, {
      method: 'OPTIONS',
      headers: {
        origin: baseUrl,
        'access-control-request-method': 'POST',
      },
    })
    expect(preflight.status).toBe(503)
    expect(preflight.headers.get('x-phd-memory-pressure')).toBe('hard')
    expect(await preflight.json()).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })

    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'health', level: 'hard', allowed: true },
      { workClass: 'health', level: 'hard', allowed: true },
      { workClass: 'health', level: 'hard', allowed: true },
      { workClass: 'health', level: 'hard', allowed: true },
      { workClass: 'standard', level: 'hard', allowed: false },
      { workClass: 'standard', level: 'hard', allowed: false },
      { workClass: 'standard', level: 'hard', allowed: false },
    ])
  })

  it('rechecks hard pressure after a queued unsafe request obtains the body slot', async () => {
    memoryPressureGuard.setLevel('normal')
    memoryPressureGuard.clearCalls()
    const snapshot = () => app.locals.requestBodyAdmission.snapshot()
    const first = openPausedJsonRequest('/api/__memory_pressure_first__', '198.51.100.10')

    await waitFor(
      () => snapshot().active === 1 && memoryPressureGuard.calls.length === 2,
      () => ({ admission: snapshot(), calls: memoryPressureGuard.calls }),
    )
    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'standard', level: 'normal', allowed: true },
      { workClass: 'standard', level: 'normal', allowed: true },
    ])

    const second = openPausedJsonRequest('/api/__memory_pressure_second__', '198.51.100.11')
    await waitFor(
      () => snapshot().active === 1
        && snapshot().waiting === 1
        && memoryPressureGuard.calls.length === 3,
      () => ({ admission: snapshot(), calls: memoryPressureGuard.calls }),
    )
    expect(memoryPressureGuard.calls[2]).toEqual({
      workClass: 'standard',
      level: 'normal',
      allowed: true,
    })

    // The second request has passed the global gate but remains queued before
    // express.json. Raise pressure before the first response releases its slot.
    memoryPressureGuard.setLevel('hard')
    first.finish()
    const firstResponse = await first.result
    expect(firstResponse.status).toBe(401)

    let timeout
    let secondResponse
    try {
      secondResponse = await Promise.race([
        second.result,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Queued request was not rejected before its incomplete body was parsed.')),
            2_000,
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
      second.destroy()
    }

    expect(second.finished).toBe(false)
    expect(secondResponse).toMatchObject({
      status: 503,
      headers: {
        connection: 'close',
        'retry-after': '2',
        'x-phd-memory-pressure': 'hard',
        'x-phd-retry-after-ms': '1250',
      },
      payload: {
        ok: false,
        error: {
          code: 'SERVER_BUSY',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      },
    })
    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'standard', level: 'normal', allowed: true },
      { workClass: 'standard', level: 'normal', allowed: true },
      { workClass: 'standard', level: 'normal', allowed: true },
      { workClass: 'standard', level: 'hard', allowed: false },
    ])

    await waitFor(
      () => snapshot().active === 0 && snapshot().waiting === 0 && snapshot().activeKeys === 0,
      snapshot,
    )
    expect(snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeKeys: 0,
      maxObservedActive: 1,
      maxObservedQueued: 1,
      admitted: 2,
      rejected: 0,
      timedOut: 0,
      cancelled: 0,
    })
  }, 15_000)

  it('admits an exactly reserved sectional workspace stream at soft pressure but not hard pressure', async () => {
    memoryPressureGuard.setLevel('normal')
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'jasper@example.com',
        password: 'demo123456',
        scope: 'app',
      }),
    })
    expect(login.status).toBe(200)
    const token = (await login.json()).data.token

    memoryPressureGuard.setLevel('soft')
    memoryPressureGuard.setRssBytes(400 * 1024 * 1024)
    memoryPressureGuard.clearCalls()
    const preAuthBeforeSoft = app.locals.workspaceStreamPreAuthAdmission.snapshot()
    const boundedWorkspaceStream = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(boundedWorkspaceStream.status).toBe(200)
    const workspaceFrames = (await boundedWorkspaceStream.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(workspaceFrames.at(-1)).toMatchObject({ kind: 'complete' })
    const standardSoftCalls = memoryPressureGuard.calls.filter((call) => (
      call.workClass === 'standard'
    ))
    const completionSoftCalls = memoryPressureGuard.calls.filter((call) => (
      call.workClass === 'health'
    ))
    expect(standardSoftCalls.length).toBeGreaterThan(0)
    expect(standardSoftCalls.every((call) => (
      call.workClass === 'standard' && call.level === 'soft' && call.allowed
    ))).toBe(true)
    expect(completionSoftCalls).toEqual([
      { workClass: 'health', level: 'soft', allowed: true },
    ])
    expect(memoryPressureGuard.calls.length).toBe(
      standardSoftCalls.length + completionSoftCalls.length,
    )
    expect(app.locals.workspaceStreamPreAuthAdmission.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeKeys: 0,
      admitted: preAuthBeforeSoft.admitted + 1,
    })

    // A real cold start requests every cursor-backed section together. Those
    // generators are consumed serially, so charging the 16 MiB safety floor
    // once per source falsely rejected one signed-in user near the soft edge.
    // The response now reserves only its largest row while retaining exact
    // per-source fingerprints, hard-pressure rejection, and final validation.
    memoryPressureGuard.setRssBytes(420 * 1024 * 1024)
    memoryPressureGuard.clearCalls()
    const completeWorkspaceStream = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications,profileAssets,applicationTrash,teamApplications`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(completeWorkspaceStream.status).toBe(200)
    const completeWorkspaceFrames = (await completeWorkspaceStream.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(completeWorkspaceFrames.at(-1)).toMatchObject({ kind: 'complete' })
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })

    memoryPressureGuard.setLevel('hard')
    memoryPressureGuard.clearCalls()
    const preAuthBeforeHard = app.locals.workspaceStreamPreAuthAdmission.snapshot()
    const hardWorkspaceStream = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(hardWorkspaceStream.status).toBe(503)
    expect(await hardWorkspaceStream.json()).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })
    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'standard', level: 'hard', allowed: false },
    ])
    // The process-wide hard gate remains authoritative and rejects before the
    // route-specific controller spends even a token-verification slot.
    expect(app.locals.workspaceStreamPreAuthAdmission.snapshot()).toEqual(preAuthBeforeHard)
  }, 15_000)

  it('bounds 100 distinct pre-auth stream callers by token digest and releases every early exit', async () => {
    memoryPressureGuard.setLevel('normal')
    memoryPressureGuard.clearCalls()

    const requestFor = (authorization, ip = '203.0.113.71') => ({
      get(name) {
        return String(name).toLowerCase() === 'authorization' ? authorization : ''
      },
      ip,
      socket: { remoteAddress: ip },
    })
    const secretToken = 'header.payload.private-signature'
    const tokenKey = workspaceStreamPreAuthAdmissionKey(requestFor(`Bearer ${secretToken}`))
    expect(tokenKey).toBe(workspaceStreamPreAuthAdmissionKey(requestFor(`Bearer ${secretToken}`)))
    expect(tokenKey).not.toContain(secretToken)
    expect(tokenKey).not.toBe(workspaceStreamPreAuthAdmissionKey(requestFor('Bearer another.token.value')))
    expect(workspaceStreamPreAuthAdmissionKey(requestFor(''))).toBe(
      workspaceStreamPreAuthAdmissionKey(requestFor('Malformed bearer text')),
    )
    expect(workspaceStreamPreAuthAdmissionKey(requestFor('', '203.0.113.72'))).not.toBe(
      workspaceStreamPreAuthAdmissionKey(requestFor('', '203.0.113.73')),
    )

    const before = app.locals.workspaceStreamPreAuthAdmission.snapshot()
    let resumePreAuth
    const preAuthPause = new Promise((resolve) => { resumePreAuth = resolve })
    workspaceStreamPreAuthPause = async (signal) => {
      if (signal.aborted) return
      await Promise.race([
        preAuthPause,
        new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
      ])
    }
    const responsePromises = Array.from({ length: 100 }, (_, index) => fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      { headers: { authorization: `Bearer invalid.token.${index}` } },
    ))
    try {
      await waitFor(
        () => {
          const snapshot = app.locals.workspaceStreamPreAuthAdmission.snapshot()
          return snapshot.active === 4 && snapshot.waiting === 96
        },
        () => app.locals.workspaceStreamPreAuthAdmission.snapshot(),
      )
    } finally {
      workspaceStreamPreAuthPause = null
      resumePreAuth()
    }
    const responses = await Promise.all(responsePromises)
    expect(responses.map((response) => response.status)).toEqual(Array(100).fill(401))
    await Promise.all(responses.map((response) => response.arrayBuffer()))

    await waitFor(
      () => {
        const snapshot = app.locals.workspaceStreamPreAuthAdmission.snapshot()
        return snapshot.active === 0 && snapshot.waiting === 0 && snapshot.activeKeys === 0
      },
      () => app.locals.workspaceStreamPreAuthAdmission.snapshot(),
    )
    const after = app.locals.workspaceStreamPreAuthAdmission.snapshot()
    expect(after).toMatchObject({
      active: 0,
      waiting: 0,
      activeKeys: 0,
      maxActive: 4,
      maxActivePerKey: 4,
      maxQueued: 128,
    })
    expect(after.admitted - before.admitted).toBe(100)
    expect(after.maxObservedActive).toBe(4)
    expect(after.maxObservedQueued).toBeGreaterThanOrEqual(96)

    // Prefix lookalikes and non-GET methods never consume the dedicated gate.
    const beforeLookalike = app.locals.workspaceStreamPreAuthAdmission.snapshot()
    const lookalike = await fetch(`${baseUrl}/api/workspace/bootstrap/stream/not-exact`, {
      headers: { authorization: 'Bearer invalid.lookalike.token' },
    })
    expect(lookalike.status).toBe(401)
    await lookalike.arrayBuffer()
    expect(app.locals.workspaceStreamPreAuthAdmission.snapshot()).toEqual(beforeLookalike)

    const beforeDisconnect = app.locals.workspaceStreamPreAuthAdmission.snapshot()
    let resumeDisconnected
    const disconnectedPause = new Promise((resolve) => { resumeDisconnected = resolve })
    workspaceStreamPreAuthPause = async (signal) => {
      if (signal.aborted) return
      await Promise.race([
        disconnectedPause,
        new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
      ])
    }
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const disconnectedRequests = controllers.map((controller, index) => fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      {
        headers: { authorization: `Bearer disconnect.token.${index}` },
        signal: controller.signal,
      },
    ))
    try {
      await waitFor(
        () => app.locals.workspaceStreamPreAuthAdmission.snapshot().active === 4,
        () => app.locals.workspaceStreamPreAuthAdmission.snapshot(),
      )
      for (const controller of controllers) controller.abort()
      await Promise.allSettled(disconnectedRequests)
      await waitFor(
        () => {
          const snapshot = app.locals.workspaceStreamPreAuthAdmission.snapshot()
          return snapshot.active === 0 && snapshot.waiting === 0 && snapshot.activeKeys === 0
        },
        () => app.locals.workspaceStreamPreAuthAdmission.snapshot(),
      )
    } finally {
      workspaceStreamPreAuthPause = null
      resumeDisconnected()
    }
    expect(app.locals.workspaceStreamPreAuthAdmission.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeKeys: 0,
      admitted: beforeDisconnect.admitted + 4,
    })
  }, 30_000)

  it('keeps bounded JSON mutations live at soft pressure while heavy work remains closed', async () => {
    memoryPressureGuard.setLevel('normal')
    memoryPressureGuard.clearCalls()
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'jasper@example.com',
        password: 'demo123456',
        scope: 'app',
      }),
    })
    expect(login.status).toBe(200)
    const token = (await login.json()).data.token

    memoryPressureGuard.setLevel('soft')
    memoryPressureGuard.clearCalls()
    const warmLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'jasper@example.com',
        password: 'demo123456',
        scope: 'app',
      }),
    })
    expect(warmLogin.status).toBe(200)
    expect(memoryPressureGuard.calls.length).toBeGreaterThanOrEqual(4)
    expect(memoryPressureGuard.calls.every((call) => (
      call.workClass === 'standard' && call.level === 'soft' && call.allowed
    ))).toBe(true)

    const legacyStore = await storage.readStore()
    const legacyAdmin = legacyStore.users.find((user) => user.email === 'jasper@example.com')
    const exactApplicationId = legacyStore.applications[0]?.id
    expect(exactApplicationId).toBeTruthy()
    const originalPasswordHash = legacyAdmin.passwordHash
    const legacyNonce = Buffer.alloc(16, 1).toString('base64url')
    const legacyTag = Buffer.alloc(32, 2).toString('base64url')
    legacyAdmin.passwordHash = `$argon2id$v=19$m=65536,t=6,p=4$${legacyNonce}$${legacyTag}`
    await storage.lockedWriteStore(legacyStore)

    memoryPressureGuard.setLevel('normal')
    memoryPressureGuard.setRssBytes(383 * 1024 * 1024)
    memoryPressureGuard.clearCalls()
    const legacyAdminChange = await fetch(`${baseUrl}/api/admin/change-password`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'irrelevant current password',
        newPassword: 'a new atlas administrator phrase 2026',
      }),
    })
    expect(legacyAdminChange.status).toBe(503)
    expect(legacyAdminChange.headers.get('x-phd-memory-pressure')).toBe('soft')
    expect(await legacyAdminChange.json()).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })
    const restoredStore = await storage.readStore()
    restoredStore.users.find((user) => user.id === legacyAdmin.id).passwordHash = originalPasswordHash
    await storage.lockedWriteStore(restoredStore)

    memoryPressureGuard.setLevel('soft')

    const { createPasswordVerifier, newPasswordSalt } = await import('./crypto.js')
    const activationCode = 'memory-pressure-admin-code'
    const activationVerifier = createPasswordVerifier(activationCode, newPasswordSalt())
    const activationStore = await storage.readStore()
    activationStore.settings.adminEntryHidden = true
    activationStore.settings.adminEntryCodeHash = activationVerifier.hash
    activationStore.settings.adminEntryCodeSalt = activationVerifier.salt
    await storage.lockedWriteStore(activationStore)

    memoryPressureGuard.clearCalls()
    const warmAdminActivation = await fetch(`${baseUrl}/API/ADMIN-ACCESS/ACTIVATE`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: activationCode }),
    })
    expect(warmAdminActivation.status).toBe(200)
    expect(memoryPressureGuard.calls.every((call) => (
      call.workClass === 'standard' && call.level === 'soft' && call.allowed
    ))).toBe(true)

    memoryPressureGuard.setRssBytes(440 * 1024 * 1024)
    memoryPressureGuard.clearCalls()
    const noHeadroomLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'jasper@example.com',
        password: 'demo123456',
        scope: 'app',
      }),
    })
    expect(noHeadroomLogin.status).toBe(503)
    expect(noHeadroomLogin.headers.get('x-phd-memory-pressure')).toBe('soft')
    expect(await noHeadroomLogin.json()).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })

    memoryPressureGuard.clearCalls()
    const noHeadroomAdminActivation = await fetch(`${baseUrl}/api/admin-access/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: activationCode }),
    })
    expect(noHeadroomAdminActivation.status).toBe(503)
    expect(await noHeadroomAdminActivation.json()).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })

    memoryPressureGuard.setRssBytes(400 * 1024 * 1024)
    memoryPressureGuard.clearCalls()
    const ordinary = await fetch(`${baseUrl}/api/__memory_pressure_soft_standard__`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ probe: true }),
    })
    expect(ordinary.status).toBe(404)
    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'standard', level: 'soft', allowed: true },
      { workClass: 'standard', level: 'soft', allowed: true },
      { workClass: 'standard', level: 'soft', allowed: true },
      { workClass: 'standard', level: 'soft', allowed: true },
    ])

    memoryPressureGuard.clearCalls()
    const ordinaryRead = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(ordinaryRead.status).toBe(200)
    expect(ordinaryRead.headers.get('x-phd-memory-pressure')).toBeNull()
    expect(await ordinaryRead.json()).toMatchObject({
      ok: true,
      data: { user: { email: 'jasper@example.com' } },
    })
    // The compact account-summary projection is protected by its dedicated
    // 1 MiB admission envelope. It performs one admission and one completion
    // pressure check without hydrating (or leasing) the full workspace.
    expect(memoryPressureGuard.calls).toHaveLength(2)
    expect(memoryPressureGuard.calls.every((call) => (
      call.workClass === 'standard' && call.level === 'soft' && call.allowed
    ))).toBe(true)
    expect(app.locals.accountSummaryAdmission.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
    })
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })

    memoryPressureGuard.clearCalls()
    const concurrentIdentityReads = await Promise.all(Array.from({ length: 8 }, () => fetch(
      `${baseUrl}/api/auth/me`,
      { headers: { authorization: `Bearer ${token}` } },
    )))
    const concurrentIdentityResults = await Promise.all(concurrentIdentityReads.map(async (response) => ({
      status: response.status,
      code: (await response.clone().json().catch(() => null))?.error?.code ?? null,
      pressure: response.headers.get('x-phd-memory-pressure'),
    })))
    expect(concurrentIdentityResults).toEqual(Array.from({ length: 8 }, () => ({
      status: 200,
      code: null,
      pressure: null,
    })))
    await Promise.all(concurrentIdentityReads.map((response) => response.arrayBuffer()))
    expect(memoryPressureGuard.calls).toHaveLength(16)
    expect(memoryPressureGuard.calls.every((call) => (
      call.workClass === 'standard' && call.level === 'soft' && call.allowed
    ))).toBe(true)
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })

    // A write acknowledgement must remain exactly readable near the soft-to-
    // hard boundary. The route owns a 512 KiB envelope plus the row-sized
    // read-only lease instead of the former overlapping 64 MiB aggregate gate.
    memoryPressureGuard.setRssBytes(425 * 1024 * 1024)
    memoryPressureGuard.clearCalls()
    const exactApplication = await fetch(`${baseUrl}/api/applications/${exactApplicationId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(exactApplication.status).toBe(200)
    expect(await exactApplication.json()).toMatchObject({
      ok: true,
      data: { id: exactApplicationId },
    })
    expect(memoryPressureGuard.calls.length).toBeGreaterThanOrEqual(3)
    expect(memoryPressureGuard.calls.every((call) => (
      call.workClass === 'standard' && call.level === 'soft' && call.allowed
    ))).toBe(true)
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })

    memoryPressureGuard.setLevel('hard')
    memoryPressureGuard.clearCalls()
    const exactApplicationAtHard = await fetch(
      `${baseUrl}/api/applications/${exactApplicationId}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(exactApplicationAtHard.status).toBe(503)
    expect(await exactApplicationAtHard.json()).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })

    memoryPressureGuard.setLevel('soft')
    memoryPressureGuard.setRssBytes(400 * 1024 * 1024)

    for (const pathname of [
      '/api/backups/cleanup-probe',
      '/api/admin/backups/cleanup-probe',
      '/api/admin/system-update/cleanup-probe',
    ]) {
      memoryPressureGuard.clearCalls()
      const cleanup = await fetch(`${baseUrl}${pathname}`, { method: 'DELETE' })
      expect(cleanup.status).not.toBe(503)
      expect(memoryPressureGuard.calls.length).toBeGreaterThan(0)
      expect(memoryPressureGuard.calls.every((call) => (
        call.workClass === 'standard' && call.level === 'soft' && call.allowed
      ))).toBe(true)
    }

    for (const probe of [
      {
        path: '/API/EXPORTS?format=pdf',
        method: 'GET',
      },
      {
        path: '/API/AI/DRAFT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ probe: true }),
      },
      {
        path: '/API/SETUP',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ probe: true }),
      },
      {
        path: '/api/__memory_pressure_multipart__',
        headers: { 'content-type': 'multipart/form-data; boundary=probe' },
        body: '--probe--\r\n',
      },
      {
        path: '/api/__memory_pressure_large__',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat((256 * 1024) + 1) }),
      },
    ]) {
      memoryPressureGuard.clearCalls()
      const response = await fetch(`${baseUrl}${probe.path}`, {
        method: probe.method ?? 'POST',
        headers: probe.headers,
        body: probe.body,
      })
      expect(response.status).toBe(503)
      expect(response.headers.get('x-phd-memory-pressure')).toBe('soft')
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'SERVER_BUSY' },
      })
      expect(memoryPressureGuard.calls).toEqual([
        { workClass: 'heavy', level: 'soft', allowed: false },
      ])
    }


    memoryPressureGuard.clearCalls()
    const chunked = await sendChunkedJsonRequest('/api/__memory_pressure_chunked__')
    expect(chunked.status).toBe(503)
    expect(chunked.headers['x-phd-memory-pressure']).toBe('soft')
    expect(chunked.payload).toMatchObject({
      ok: false,
      error: { code: 'SERVER_BUSY' },
    })
    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'heavy', level: 'soft', allowed: false },
    ])

    memoryPressureGuard.setLevel('hard')
    memoryPressureGuard.clearCalls()
    const hard = await fetch(`${baseUrl}/api/__memory_pressure_hard_standard__`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    })
    expect(hard.status).toBe(503)
    expect(hard.headers.get('x-phd-memory-pressure')).toBe('hard')
    expect(memoryPressureGuard.calls).toEqual([
      { workClass: 'standard', level: 'hard', allowed: false },
    ])
  }, 20_000)
})
