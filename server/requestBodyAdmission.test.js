import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import jwt from 'jsonwebtoken'
import os from 'node:os'
import path from 'node:path'

const ACTIVE_LIMIT = 8
const ACTIVE_PER_IP_LIMIT = 2
const REQUEST_COUNT = 24
const GLOBAL_QUEUE_LIMIT = 128
const PREFIX_BYTES = 64
const PAYLOAD_BYTES = 980 * 1024
const JWT_SECRET = randomBytes(48).toString('base64url')
const SETTINGS_ENCRYPTION_KEY = randomBytes(48).toString('base64url')

let app
let server
let baseUrl
let storage
let testRoot

function waitFor(predicate, describeState, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for request-body admission: ${JSON.stringify(describeState())}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

function openPausedJsonRequest(
  body,
  pathname = '/api/__request_body_admission_probe__',
  clientIp = '198.51.100.10',
  method = 'POST',
  authorization = '',
  contentType = 'application/json',
) {
  let request
  const result = new Promise((resolve, reject) => {
    const headers = {
      connection: 'keep-alive',
      'content-length': body.byteLength,
      'content-type': contentType,
      'x-forwarded-for': clientIp,
    }
    if (authorization) headers.authorization = authorization
    request = http.request(`${baseUrl}${pathname}`, {
      method,
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let payload = null
        if (String(response.headers['content-type'] ?? '').includes('application/json')) {
          try {
            payload = JSON.parse(text)
          } catch (error) {
            reject(new Error(`Expected a JSON response, received ${text.slice(0, 200)}`, { cause: error }))
            return
          }
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          contentType: response.headers['content-type'],
          payload,
          text,
        })
      })
    })
    request.once('error', reject)
    request.flushHeaders()
    request.write(body.subarray(0, PREFIX_BYTES))
  })

  return {
    result,
    finish() {
      if (request.destroyed || request.writableEnded) return
      request.end(body.subarray(PREFIX_BYTES))
    },
    destroy() {
      request.destroy(new Error('Intentional partial-upload abort.'))
    },
  }
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-body-admission-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('TRUST_PROXY', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'request-body-admission-test-key')
  vi.stubEnv('JWT_SECRET', JWT_SECRET)
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', SETTINGS_ENCRYPTION_KEY)
  vi.stubEnv('REQUEST_BODY_MAX_ACTIVE', String(ACTIVE_LIMIT))
  vi.stubEnv('REQUEST_BODY_MAX_ACTIVE_PER_IP', String(ACTIVE_PER_IP_LIMIT))
  vi.stubEnv('REQUEST_BODY_MAX_QUEUED_PER_IP', '2')
  vi.stubEnv('REQUEST_BODY_MAX_QUEUED', String(GLOBAL_QUEUE_LIMIT))
  vi.stubEnv('REQUEST_BODY_WAIT_TIMEOUT_MS', '15000')
  vi.stubEnv('REQUEST_BODY_DEADLINE_MS', '2000')
  vi.stubEnv('MULTIPART_BODY_DEADLINE_MS', '3000')
  vi.stubEnv('SYSTEM_UPDATE_BODY_DEADLINE_MS', '4000')
  // This suite isolates socket/body admission. Keep the independent RSS guard
  // above any test-runner parallelism noise so it cannot pre-empt the probe.
  vi.stubEnv('RUNTIME_MEMORY_BUDGET_BYTES', String(2 * 1024 * 1024 * 1024))

  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 60_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 60_000)

describe('aggregate request-body admission', () => {
  const sessionToken = (subject) => jwt.sign(
    { scope: 'app', authVersion: 0 },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'phd-atlas',
      audience: 'phd-atlas-api',
      subject,
      expiresIn: '5m',
    },
  )

  it('keeps near-1 MiB unsafe JSON bodies outside express.json until a bounded slot is available', async () => {
    const jsonBody = Buffer.from(JSON.stringify({
      probe: true,
      padding: 'x'.repeat(PAYLOAD_BYTES),
    }))
    expect(jsonBody.byteLength).toBeGreaterThan(950 * 1024)
    expect(jsonBody.byteLength).toBeLessThan(1024 * 1024)

    const requests = Array.from(
      { length: REQUEST_COUNT },
      (_, index) => openPausedJsonRequest(jsonBody, undefined, `198.51.100.${index + 1}`),
    )
    const snapshot = () => app.locals.requestBodyAdmission.snapshot()

    // Every socket has supplied only a JSON prefix. The active requests are
    // waiting inside the parser; all others must remain queued before it.
    await waitFor(
      () => snapshot().active === ACTIVE_LIMIT
        && snapshot().waiting === REQUEST_COUNT - ACTIVE_LIMIT,
      snapshot,
    )
    expect(snapshot()).toMatchObject({
      active: ACTIVE_LIMIT,
      waiting: REQUEST_COUNT - ACTIVE_LIMIT,
      maxActive: ACTIVE_LIMIT,
      maxObservedActive: ACTIVE_LIMIT,
      rejected: 0,
      timedOut: 0,
    })

    requests.forEach((request) => request.finish())
    const responses = await Promise.all(requests.map((request) => request.result))

    expect(responses).toHaveLength(REQUEST_COUNT)
    expect(responses.every((response) => response.status < 500)).toBe(true)
    expect(responses.every((response) => response.status === 401)).toBe(true)
    for (const response of responses) {
      expect(response.contentType).toContain('application/json')
      expect(response.payload).toMatchObject({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      })
    }

    await waitFor(
      () => snapshot().active === 0 && snapshot().waiting === 0,
      snapshot,
    )
    expect(snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      maxObservedActive: ACTIVE_LIMIT,
      maxObservedQueued: REQUEST_COUNT - ACTIVE_LIMIT,
      admitted: REQUEST_COUNT,
      rejected: 0,
      timedOut: 0,
      cancelled: 0,
    })

    const health = await fetch(`${baseUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })
  }, 30_000)

  it('never exposes non-API paths to the JSON parser or the API admission pool', async () => {
    const before = app.locals.requestBodyAdmission.snapshot()
    const oversizedBody = Buffer.from(JSON.stringify({
      probe: 'outside-api-parser-scope',
      padding: 'x'.repeat((1024 * 1024) + 128),
    }))
    const request = openPausedJsonRequest(
      oversizedBody,
      '/NoT-An-Api/__json_parser_scope_probe__',
      '198.51.100.91',
    )
    request.finish()

    let response
    let timer
    try {
      response = await Promise.race([
        request.result,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('A non-API oversized JSON body did not bypass the API-scoped parser.')),
            5_000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
      request.destroy()
    }

    expect(response.status).toBe(404)
    expect(response.headers['content-type']).toContain('text/html')
    expect(app.locals.requestBodyAdmission.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      admitted: before.admitted,
      rejected: before.rejected,
    })
  }, 10_000)

  it('closes an early case-insensitive API response before releasing its partial-body slot', async () => {
    const before = app.locals.requestBodyAdmission.snapshot()
    const body = Buffer.alloc(256 * 1024, 0x61)
    const request = openPausedJsonRequest(
      body,
      '/API/__EARLY_BODY_LIFECYCLE_PROBE__',
      '198.51.100.92',
      'POST',
      '',
      'application/octet-stream',
    )

    const response = await request.result
    expect(response).toMatchObject({
      status: 401,
      payload: {
        ok: false,
        error: { code: 'UNAUTHORIZED' },
      },
    })
    await waitFor(
      () => app.locals.requestBodyAdmission.snapshot().active === 0,
      () => app.locals.requestBodyAdmission.snapshot(),
    )
    expect(app.locals.requestBodyAdmission.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      admitted: before.admitted + 1,
    })
  }, 10_000)

  it('returns structured global queue-full backpressure and recovers after every holder is released', async () => {
    const jsonBody = Buffer.from(JSON.stringify({
      probe: 'global-queue-full',
      padding: 'x'.repeat(8 * 1024),
    }))
    const snapshot = () => app.locals.requestBodyAdmission.snapshot()
    await waitFor(
      () => snapshot().active === 0 && snapshot().waiting === 0,
      snapshot,
    )
    const before = snapshot()
    const holders = []

    try {
      for (let index = 0; index < before.maxActive; index += 1) {
        holders.push(openPausedJsonRequest(
          jsonBody,
          '/api/__global_body_admission_probe__',
          `198.51.100.${index + 1}`,
          'PUT',
          `Bearer ${sessionToken(`global-active-${index}`)}`,
        ))
      }
      await waitFor(
        () => snapshot().active === before.maxActive
          && snapshot().waiting === 0
          && snapshot().activeKeys === before.maxActive,
        snapshot,
      )

      for (let index = 0; index < before.maxQueued; index += 1) {
        holders.push(openPausedJsonRequest(
          jsonBody,
          '/api/__global_body_admission_probe__',
          `203.0.113.${(index % 200) + 1}`,
          'PUT',
          `Bearer ${sessionToken(`global-queued-${index}`)}`,
        ))
      }
      await waitFor(
        () => snapshot().active === before.maxActive
          && snapshot().waiting === before.maxQueued
          && snapshot().activeKeys === before.maxActive
          && snapshot().queuedKeys === before.maxQueued,
        snapshot,
      )
      const saturated = snapshot()
      expect(saturated).toMatchObject({
        active: before.maxActive,
        waiting: before.maxQueued,
        activeKeys: before.maxActive,
        queuedKeys: before.maxQueued,
        rejected: before.rejected,
        perKeyRejected: before.perKeyRejected,
        timedOut: before.timedOut,
      })

      const healthDuring = await fetch(`${baseUrl}/api/health`)
      expect(healthDuring.status).toBe(200)
      await expect(healthDuring.json()).resolves.toMatchObject({ ok: true, data: { status: 'ok' } })

      const rejected = openPausedJsonRequest(
        jsonBody,
        '/api/__global_body_admission_probe__',
        '192.0.2.250',
        'PUT',
        `Bearer ${sessionToken('global-unused-probe')}`,
      )
      const busy = await rejected.result
      expect(busy).toMatchObject({
        status: 503,
        headers: {
          connection: 'close',
          'retry-after': '1',
          'x-phd-retry-after-ms': '1000',
          'x-request-id': expect.any(String),
        },
        contentType: expect.stringContaining('application/json'),
        payload: {
          ok: false,
          error: { code: 'SERVER_BUSY', message: expect.any(String) },
          requestId: expect.any(String),
        },
      })
      expect(busy.headers['x-request-id']).toBe(busy.payload.requestId)
      expect(busy.headers).not.toHaveProperty('x-phd-memory-pressure')
      expect(snapshot()).toMatchObject({
        active: saturated.active,
        waiting: saturated.waiting,
        activeKeys: saturated.activeKeys,
        queuedKeys: saturated.queuedKeys,
        admitted: saturated.admitted,
        rejected: saturated.rejected + 1,
        perKeyRejected: saturated.perKeyRejected,
        timedOut: saturated.timedOut,
        cancelled: saturated.cancelled,
      })
    } finally {
      holders.forEach((holder) => holder.destroy())
      await Promise.allSettled(holders.map((holder) => holder.result))
    }

    await waitFor(
      () => snapshot().active === 0
        && snapshot().waiting === 0
        && snapshot().activeKeys === 0
        && snapshot().queuedKeys === 0,
      snapshot,
    )
    expect(snapshot().timedOut).toBe(before.timedOut)

    const retry = openPausedJsonRequest(
      jsonBody,
      '/api/__global_body_admission_probe__',
      '192.0.2.251',
      'PUT',
      `Bearer ${sessionToken('global-retry-principal')}`,
    )
    retry.finish()
    await expect(retry.result).resolves.toMatchObject({
      status: 401,
      contentType: expect.stringContaining('application/json'),
      payload: {
        ok: false,
        error: { code: 'UNKNOWN_USER' },
      },
    })
    const healthAfter = await fetch(`${baseUrl}/api/health/ready`)
    expect(healthAfter.status).toBe(200)
    await expect(healthAfter.json()).resolves.toMatchObject({ data: { ready: true } })
  }, 15_000)

  it('isolates slow incomplete bodies per IP and releases every timed-out slot', async () => {
    const jsonBody = Buffer.from(JSON.stringify({
      probe: true,
      padding: 'x'.repeat(PAYLOAD_BYTES),
    }))
    const abusiveIp = '203.0.113.40'
    const healthyIp = '203.0.113.41'
    const requests = Array.from(
      { length: 8 },
      () => openPausedJsonRequest(jsonBody, '/api/__slow_body_probe__', abusiveIp),
    )
    const snapshot = () => app.locals.requestBodyAdmission.snapshot()

    await waitFor(
      () => snapshot().active === ACTIVE_PER_IP_LIMIT && snapshot().perKeyRejected >= 6,
      snapshot,
    )

    const healthyResponse = await fetch(`${baseUrl}/api/__healthy_body_probe__`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': healthyIp,
      },
      body: JSON.stringify({ probe: true }),
    })
    expect(healthyResponse.status).toBe(401)
    expect(await healthyResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    })

    // Never provide the remaining bytes. Six requests must be rejected before
    // parsing and the two admitted bodies must expire without holding slots.
    const responses = await Promise.all(requests.map((request) => request.result))
    expect(responses.filter((response) => response.status === 503)).toHaveLength(6)
    expect(responses.filter((response) => response.status === 408)).toHaveLength(2)
    for (const response of responses) {
      expect(response.headers.connection).toBe('close')
      expect(response.contentType).toContain('application/json')
      expect(response.payload).toMatchObject({
        ok: false,
        error: {
          code: response.status === 408 ? 'REQUEST_BODY_TIMEOUT' : 'SERVER_BUSY',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      })
    }

    await waitFor(
      () => snapshot().active === 0 && snapshot().waiting === 0 && snapshot().activeKeys === 0,
      snapshot,
    )
    expect(snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeKeys: 0,
      perKeyRejected: 6,
    })
  }, 15_000)

  it('lets distinct verified accounts behind one NAT use the bounded global budget fairly', async () => {
    const jsonBody = Buffer.from(JSON.stringify({
      probe: true,
      padding: 'x'.repeat(PAYLOAD_BYTES),
    }))
    const sharedNat = '203.0.113.60'
    const before = app.locals.requestBodyAdmission.snapshot()
    const requests = Array.from(
      { length: ACTIVE_LIMIT },
      (_, index) => openPausedJsonRequest(
        jsonBody,
        '/api/__authenticated_nat_probe__',
        sharedNat,
        'POST',
        `Bearer ${sessionToken(`nat-user-${index}`)}`,
      ),
    )
    const snapshot = () => app.locals.requestBodyAdmission.snapshot()

    await waitFor(
      () => snapshot().active === ACTIVE_LIMIT && snapshot().activeKeys === ACTIVE_LIMIT,
      snapshot,
    )
    expect(snapshot()).toMatchObject({
      active: ACTIVE_LIMIT,
      activeKeys: ACTIVE_LIMIT,
      perKeyRejected: before.perKeyRejected,
    })

    requests.forEach((request) => request.finish())
    const responses = await Promise.all(requests.map((request) => request.result))
    expect(responses.every((response) => response.status === 401)).toBe(true)
    expect(responses.every((response) => response.payload.error.code === 'UNKNOWN_USER')).toBe(true)
    await waitFor(
      () => snapshot().active === 0 && snapshot().waiting === 0,
      snapshot,
    )
  }, 15_000)

  it('keeps one verified principal bounded even when it changes source IPs', async () => {
    const jsonBody = Buffer.from(JSON.stringify({
      probe: true,
      padding: 'x'.repeat(PAYLOAD_BYTES),
    }))
    const bearer = `Bearer ${sessionToken('distributed-slow-client')}`
    const before = app.locals.requestBodyAdmission.snapshot()
    const admitted = Array.from(
      { length: ACTIVE_PER_IP_LIMIT },
      (_, index) => openPausedJsonRequest(
        jsonBody,
        '/api/__distributed_session_probe__',
        `203.0.113.${70 + index}`,
        'POST',
        bearer,
      ),
    )
    const snapshot = () => app.locals.requestBodyAdmission.snapshot()

    await waitFor(
      () => snapshot().active === ACTIVE_PER_IP_LIMIT,
      snapshot,
    )
    const rejected = await Promise.all(Array.from({ length: 6 }, (_, index) => (
      openPausedJsonRequest(
        jsonBody,
        '/api/__distributed_session_probe__',
        `203.0.113.${80 + index}`,
        'POST',
        bearer,
      ).result
    )))
    expect(rejected.every((response) => response.status === 503)).toBe(true)
    expect(snapshot().perKeyRejected).toBeGreaterThanOrEqual(before.perKeyRejected + 6)

    admitted.forEach((request) => request.finish())
    const admittedResponses = await Promise.all(admitted.map((request) => request.result))
    expect(admittedResponses.every((response) => response.status === 401)).toBe(true)
    await waitFor(
      () => snapshot().active === 0 && snapshot().waiting === 0,
      snapshot,
    )
  }, 15_000)

  it('rejects declared GET bodies before parsing or admission', async () => {
    const beforeAdmission = app.locals.requestBodyAdmission.snapshot()
    const jsonBody = Buffer.from(JSON.stringify({
      probe: true,
      padding: 'x'.repeat(PAYLOAD_BYTES),
    }))
    const request = openPausedJsonRequest(
      jsonBody,
      '/api/__safe_method_body_probe__',
      '203.0.113.50',
      'GET',
    )

    const response = await request.result
    expect(response).toMatchObject({
      status: 400,
      headers: { connection: 'close' },
      payload: {
        ok: false,
        error: {
          code: 'REQUEST_BODY_NOT_ALLOWED',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      },
    })
    expect(app.locals.requestBodyAdmission.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      admitted: beforeAdmission.admitted,
    })
  }, 10_000)

  it('keeps health live while startup recovery rejects unsafe bodies before parsing', async () => {
    const retryingState = {
      status: 'retrying',
      attempt: 3,
      retryDelayMs: 2_500,
      errorCode: 'DATABASE_CONNECTION_FAILED',
    }
    app.locals.startupState = retryingState

    try {
      const startingHealth = await fetch(`${baseUrl}/api/health`)
      expect(startingHealth.status).toBe(200)
      expect(await startingHealth.json()).toMatchObject({
        ok: true,
        data: {
          status: 'starting',
          ready: false,
          startup: retryingState,
        },
      })

      const startingLiveness = await fetch(`${baseUrl}/api/health/live`)
      expect(startingLiveness.status).toBe(200)
      expect(await startingLiveness.json()).toMatchObject({
        ok: true,
        data: { status: 'ok', live: true },
      })

      const startingReadiness = await fetch(`${baseUrl}/api/health/ready`)
      expect(startingReadiness.status).toBe(503)
      expect(startingReadiness.headers.get('retry-after')).toBe('3')
      expect(await startingReadiness.json()).toMatchObject({
        ok: false,
        error: {
          code: 'SERVER_STARTING',
          message: expect.any(String),
        },
        requestId: expect.any(String),
      })

      const beforeAdmission = app.locals.requestBodyAdmission.snapshot()
      const jsonBody = Buffer.from(JSON.stringify({
        probe: true,
        padding: 'x'.repeat(PAYLOAD_BYTES),
      }))
      const request = openPausedJsonRequest(jsonBody, '/api/__startup_readiness_probe__')

      // Never send the remaining ~980 KiB. Receiving a complete response proves
      // the readiness gate ran before the aggregate admission and JSON parser.
      let timeout
      let response
      try {
        response = await Promise.race([
          request.result,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Startup readiness did not reject the partial request body promptly.')),
              2_000,
            )
          }),
        ])
      } finally {
        clearTimeout(timeout)
        request.destroy()
      }

      expect(response).toMatchObject({
        status: 503,
        payload: {
          ok: false,
          error: {
            code: 'SERVER_STARTING',
            message: expect.any(String),
          },
          requestId: expect.any(String),
        },
      })
      expect(response.contentType).toContain('application/json')
      expect(response.headers['retry-after']).toBe('3')
      expect(response.headers.connection).toBe('close')
      expect(app.locals.requestBodyAdmission.snapshot()).toMatchObject({
        active: 0,
        waiting: 0,
        admitted: beforeAdmission.admitted,
      })
    } finally {
      app.locals.startupState = {
        status: 'ready',
        attempt: retryingState.attempt,
        retryDelayMs: null,
        errorCode: null,
      }
    }

    const readyHealth = await fetch(`${baseUrl}/api/health`)
    expect(readyHealth.status).toBe(200)
    expect(await readyHealth.json()).toMatchObject({
      ok: true,
      data: {
        status: 'ok',
        ready: true,
      },
    })

    const readyReadiness = await fetch(`${baseUrl}/api/health/ready`)
    expect(readyReadiness.status).toBe(200)
    expect(await readyReadiness.json()).toMatchObject({
      ok: true,
      data: { status: 'ok', ready: true },
    })
  }, 15_000)
})
