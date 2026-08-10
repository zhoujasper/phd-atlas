import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authenticatedAbusePolicy,
  createApp,
  requiresPreAuthMutationAdmission,
  smallWorkspaceBootstrapEligible,
} from './index.js'
import {
  createBoundedConditionalPayloadCache,
  createBoundedRateLimitBuckets,
  createMutationAdmissionController,
  createRuntimeHealthMonitor,
  retryStartupOperation,
  runStartupOperationWithDeadline,
  startupRetryDelayMs,
  MutationAdmissionError,
  StartupOperationAbortedError,
} from './runtimeResilience.js'
import { readStore } from './storage.js'

describe('bounded conditional payload cache', () => {
  it('uses strict LRU order and never exceeds its entry or byte budget', () => {
    let clock = 1
    const cache = createBoundedConditionalPayloadCache({
      maxEntries: 2,
      maxBytes: 8,
      maxEntryBytes: 8,
      now: () => clock,
    })
    const store = {}

    expect(cache.set(store, 'a', { revision: '1', storedAt: clock, dataJson: 'aaaa' })).toBe(true)
    clock += 1
    expect(cache.set(store, 'b', { revision: '1', storedAt: clock, dataJson: 'bbbb' })).toBe(true)
    expect(cache.get(store, 'a', { revision: '1' })?.dataJson).toBe('aaaa')
    clock += 1
    expect(cache.set(store, 'c', { revision: '1', storedAt: clock, dataJson: 'cc' })).toBe(true)

    expect(cache.get(store, 'b', { revision: '1' })).toBeNull()
    expect(cache.get(store, 'a', { revision: '1' })?.dataJson).toBe('aaaa')
    expect(cache.get(store, 'c', { revision: '1' })?.dataJson).toBe('cc')
    expect(cache.inspect(store)).toMatchObject({
      entries: 2,
      bytes: 6,
      maxEntries: 2,
      maxBytes: 8,
      evictions: 1,
    })
  })

  it('does not retain oversized payloads and removes stale revisions', () => {
    const cache = createBoundedConditionalPayloadCache({
      maxEntries: 4,
      maxBytes: 16,
      maxEntryBytes: 4,
    })
    const store = {}

    expect(cache.set(store, 'large', { revision: '1', storedAt: Date.now(), dataJson: '12345' })).toBe(false)
    expect(cache.set(store, 'small', { revision: '1', storedAt: Date.now(), dataJson: '1234' })).toBe(true)
    expect(cache.get(store, 'small', { revision: '2' })).toBeNull()
    expect(cache.inspect(store)).toMatchObject({ entries: 0, bytes: 0, oversized: 1 })
  })
})

describe('small workspace bootstrap admission', () => {
  it('fails closed for stale, invalid, or oversized footprint ledgers', () => {
    expect(smallWorkspaceBootstrapEligible({ complete: true, dataBytes: 2_000 }, 2_000)).toBe(true)
    expect(smallWorkspaceBootstrapEligible({ complete: false, dataBytes: 1 }, 2_000)).toBe(false)
    expect(smallWorkspaceBootstrapEligible({ complete: true, dataBytes: 2_001 }, 2_000)).toBe(false)
    expect(smallWorkspaceBootstrapEligible({ complete: true, dataBytes: -1 }, 2_000)).toBe(false)
    expect(smallWorkspaceBootstrapEligible({ complete: true, dataBytes: Number.NaN }, 2_000)).toBe(false)
  })
})

describe('bounded rate-limit buckets', () => {
  it('keeps identity rotation bounded with constant-time LRU eviction', () => {
    const buckets = createBoundedRateLimitBuckets({ maxEntries: 3 })
    const first = buckets.getOrCreate('first', 1)
    first.count += 1
    buckets.getOrCreate('second', 2)
    buckets.getOrCreate('third', 3)

    // Refreshing first makes second the least-recently-used identity.
    expect(buckets.getOrCreate('first', 4)).toBe(first)
    buckets.getOrCreate('fourth', 4)

    expect(buckets.inspect()).toMatchObject({
      entries: 3,
      maxEntries: 3,
      evictions: 1,
    })
    expect(buckets.getOrCreate('first', 5).count).toBe(1)
    expect(buckets.getOrCreate('second', 5).count).toBe(0)
    expect(buckets.inspect()).toMatchObject({ entries: 3, evictions: 2 })
  })

  it('prunes stale identities only from the periodic cleanup path', () => {
    const buckets = createBoundedRateLimitBuckets({ maxEntries: 4 })
    buckets.getOrCreate('old', 10)
    buckets.getOrCreate('fresh', 20)

    expect(buckets.pruneBefore(15)).toBe(1)
    expect(buckets.inspect()).toMatchObject({ entries: 1, stalePruned: 1 })
  })
})

describe('mutation admission controller', () => {
  it('admits FIFO work, rejects overflow, and releases every slot once', async () => {
    const admission = createMutationAdmissionController({
      maxActive: 1,
      maxQueued: 1,
      waitTimeoutMs: 1_000,
    })
    const releaseFirst = await admission.acquire()
    const second = admission.acquire()

    await expect(admission.acquire()).rejects.toMatchObject({
      name: 'MutationAdmissionError',
      code: 'SERVER_BUSY',
      reason: 'queue-full',
    })
    expect(admission.snapshot()).toMatchObject({ active: 1, waiting: 1, rejected: 1 })

    releaseFirst()
    releaseFirst()
    const releaseSecond = await second
    expect(admission.snapshot()).toMatchObject({ active: 1, waiting: 0, admitted: 2 })
    releaseSecond()
    expect(admission.snapshot().active).toBe(0)
  })

  it('cancels disconnected waiters and times out abandoned queue entries', async () => {
    const admission = createMutationAdmissionController({
      maxActive: 1,
      maxQueued: 2,
      waitTimeoutMs: 20,
    })
    const release = await admission.acquire()
    const controller = new AbortController()
    const cancelled = admission.acquire({ signal: controller.signal })
    controller.abort()
    await expect(cancelled).rejects.toBeInstanceOf(MutationAdmissionError)
    await expect(admission.acquire()).rejects.toMatchObject({ reason: 'timeout' })
    expect(admission.snapshot()).toMatchObject({ waiting: 0, cancelled: 1, timedOut: 1 })
    release()
  })

  it('caps one key without blocking eligible work from another key', async () => {
    const admission = createMutationAdmissionController({
      maxActive: 3,
      maxQueued: 4,
      maxActivePerKey: 2,
      maxQueuedPerKey: 1,
      waitTimeoutMs: 1_000,
    })
    const releaseA1 = await admission.acquire({ key: 'network-a' })
    const releaseA2 = await admission.acquire({ key: 'network-a' })

    await expect(admission.acquire({ key: 'network-a' })).rejects.toMatchObject({
      reason: 'per-key-active',
    })
    const releaseB = await admission.acquire({ key: 'network-b' })
    expect(admission.snapshot()).toMatchObject({
      active: 3,
      activeKeys: 2,
      perKeyRejected: 1,
    })

    releaseA1()
    releaseA2()
    releaseB()
    expect(admission.snapshot()).toMatchObject({ active: 0, activeKeys: 0, queuedKeys: 0 })
  })

  it('can queue a saturated lightweight key without consuming another active slot', async () => {
    const admission = createMutationAdmissionController({
      maxActive: 3,
      maxQueued: 4,
      maxActivePerKey: 1,
      maxQueuedPerKey: 1,
      queueWhenPerKeyActive: true,
      waitTimeoutMs: 1_000,
    })
    const releaseA1 = await admission.acquire({ key: 'account-a' })
    const queuedA2 = admission.acquire({ key: 'account-a' })

    await expect(admission.acquire({ key: 'account-a' })).rejects.toMatchObject({
      reason: 'per-key-queue-full',
    })
    const releaseB = await admission.acquire({ key: 'account-b' })
    expect(admission.snapshot()).toMatchObject({
      active: 2,
      waiting: 1,
      queuedKeys: 1,
      queueWhenPerKeyActive: true,
    })

    releaseA1()
    const releaseA2 = await queuedA2
    expect(admission.snapshot()).toMatchObject({ active: 2, waiting: 0 })
    releaseA2()
    releaseB()
    expect(admission.snapshot()).toMatchObject({ active: 0, waiting: 0, queuedKeys: 0 })
  })
})

describe('startup dependency retry', () => {
  it('uses bounded exponential jitter and eventually returns the ready value', async () => {
    const sleeps = []
    const attempts = []
    const operation = async (attempt) => {
      if (attempt < 3) throw Object.assign(new Error('temporary database outage'), { code: 'DATABASE_CONNECTION_FAILED' })
      return 'ready'
    }

    await expect(retryStartupOperation(operation, {
      maxAttempts: 4,
      random: () => 0.5,
      sleep: async (delay) => { sleeps.push(delay) },
      onAttempt: (entry) => attempts.push({
        attempt: entry.attempt,
        status: entry.status,
        retryDelayMs: entry.retryDelayMs,
      }),
    })).resolves.toBe('ready')

    expect(sleeps).toEqual([250, 500])
    expect(attempts).toEqual([
      { attempt: 1, status: 'retrying', retryDelayMs: 250 },
      { attempt: 2, status: 'retrying', retryDelayMs: 500 },
      { attempt: 3, status: 'ready', retryDelayMs: null },
    ])
    expect(startupRetryDelayMs(20, { maxDelayMs: 8_000, random: () => 0.5 })).toBe(8_000)
  })

  it('stops after the bounded attempt count and preserves the final error', async () => {
    const failure = Object.assign(new Error('bad credentials'), { code: 'DATABASE_CONNECTION_FAILED' })
    const statuses = []
    await expect(retryStartupOperation(async () => { throw failure }, {
      maxAttempts: 2,
      random: () => 0.5,
      sleep: async () => {},
      onAttempt: ({ status }) => statuses.push(status),
    })).rejects.toBe(failure)
    expect(statuses).toEqual(['retrying', 'failed'])
  })

  it('fails permanent startup errors without sleeping', async () => {
    const failure = Object.assign(new Error('workspace missing'), { code: 'DATABASE_STATE_MISSING' })
    const sleep = vi.fn()
    await expect(retryStartupOperation(async () => { throw failure }, {
      maxAttempts: 7,
      sleep,
      shouldRetry: (error) => error.code === 'DATABASE_CONNECTION_FAILED',
    })).rejects.toBe(failure)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('keeps retrying transient startup failures beyond the legacy seven-attempt cap', async () => {
    const attempts = []
    const sleeps = []
    await expect(retryStartupOperation(async (attempt) => {
      attempts.push(attempt)
      if (attempt <= 8) {
        throw Object.assign(new Error('database is restarting'), {
          code: 'DATABASE_CONNECTION_FAILED',
        })
      }
      return 'ready-after-eight-failures'
    }, {
      maxAttempts: Number.POSITIVE_INFINITY,
      baseDelayMs: 2,
      maxDelayMs: 4,
      random: () => 0.5,
      sleep: async (delayMs) => { sleeps.push(delayMs) },
      shouldRetry: (error) => error.code === 'DATABASE_CONNECTION_FAILED',
    })).resolves.toBe('ready-after-eight-failures')

    expect(attempts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(sleeps).toEqual([2, 4, 4, 4, 4, 4, 4, 4])
  })

  it('aborts an in-flight retry delay and clears its timer', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const statuses = []
      let markRetrying
      const retrying = new Promise((resolve) => { markRetrying = resolve })
      const recovery = retryStartupOperation(async () => {
        throw Object.assign(new Error('database unavailable'), {
          code: 'DATABASE_CONNECTION_FAILED',
        })
      }, {
        maxAttempts: Number.POSITIVE_INFINITY,
        baseDelayMs: 5_000,
        maxDelayMs: 5_000,
        random: () => 0.5,
        signal: controller.signal,
        shouldRetry: () => true,
        onAttempt: ({ status }) => {
          statuses.push(status)
          if (status === 'retrying') markRetrying()
        },
      })
      await retrying
      expect(statuses).toContain('retrying')
      expect(vi.getTimerCount()).toBe(1)

      controller.abort(new StartupOperationAbortedError('test shutdown'))
      await expect(recovery).rejects.toMatchObject({ code: 'STARTUP_ABORTED' })
      expect(vi.getTimerCount()).toBe(0)
      expect(statuses.at(-1)).toBe('aborted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives each optional startup attempt a hard abortable deadline', async () => {
    vi.useFakeTimers()
    try {
      let attemptSignal
      let rejectLate
      const operation = runStartupOperationWithDeadline(({ signal }) => {
        attemptSignal = signal
        return new Promise((_resolve, reject) => { rejectLate = reject })
      }, { timeoutMs: 1_000 })
      const deadlineRejection = expect(operation).rejects.toMatchObject({
        code: 'STARTUP_SUBSYSTEM_TIMEOUT',
        timeoutMs: 1_000,
      })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1_000)
      await deadlineRejection
      expect(attemptSignal.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)

      // The deadline already owns the result; a signal-ignoring implementation
      // may still settle later, but its rejection remains observed.
      rejectLate(new Error('late ignored rejection'))
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('pre-authentication capacity coverage', () => {
  it('acquires the aggregate unsafe-request budget before JSON parsing', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'server', 'index.js'), 'utf8')
    const admissionIndex = source.indexOf('requestBodyAdmissionMiddleware(request, response, next)')
    const parserIndex = source.indexOf("app.use('/api', express.json({ limit: '1mb' }))")

    expect(admissionIndex).toBeGreaterThan(-1)
    expect(parserIndex).toBeGreaterThan(admissionIndex)
    expect(source).not.toContain("app.use(express.json({ limit: '1mb' }))")
  })

  it('admits every public write or write-like GET before expensive work', () => {
    for (const [method, pathname] of [
      ['POST', '/api/setup'],
      ['POST', '/API/SETUP'],
      ['POST', '/api/setup/smtp-verification/send'],
      ['GET', '/api/auth/captcha'],
      ['GET', '/API/AUTH/CAPTCHA'],
      ['POST', '/api/auth/register/email-code'],
      ['POST', '/api/auth/register'],
      ['POST', '/API/AUTH/REGISTER'],
      ['POST', '/api/auth/password-reset/confirm'],
      ['POST', '/api/auth/passkeys/login/options'],
      ['POST', '/api/auth/passkeys/login/verify'],
      ['PATCH', '/api/share/token/sections/overview'],
      ['POST', '/api/share/token/materials/material/file'],
      ['DELETE', '/api/share/token/tasks/task/files/file'],
      ['POST', '/api/asset-upload/token/file'],
      ['POST', '/api/teams/invites/token/decline'],
      ['GET', '/api/settings/verify-receive-email?token=value'],
      ['GET', '/API/SETTINGS/VERIFY-RECEIVE-EMAIL?token=value'],
    ]) {
      expect(requiresPreAuthMutationAdmission(method, pathname), `${method} ${pathname}`).toBe(true)
    }

    expect(requiresPreAuthMutationAdmission('POST', '/api/auth/login')).toBe(false)
    expect(requiresPreAuthMutationAdmission('GET', '/api/share/token')).toBe(false)
    expect(requiresPreAuthMutationAdmission('GET', '/api/calendar/feed')).toBe(false)
  })

})

describe('authenticated abuse policy routing', () => {
  it('matches Express case-insensitive routes without weakening method checks', () => {
    for (const [method, originalUrl, name] of [
      ['POST', '/API/DISCOVER/RESEARCH/START', 'user-discover-research'],
      ['POST', '/API/AI/DRAFT', 'user-ai-draft'],
      ['POST', '/API/APPLICATIONS/app-1/COMMUNICATIONS/SEND', 'user-email-send'],
      ['POST', '/API/BACKUPS/archive.sqlite/RESTORE', 'user-backup-mutation'],
      ['POST', '/API/ADMIN/NOTIFICATIONS/PUBLISH', 'admin-notification-publish'],
    ]) {
      expect(authenticatedAbusePolicy({ method, originalUrl })?.name).toBe(name)
    }
    expect(authenticatedAbusePolicy({
      method: 'get',
      originalUrl: '/API/BACKUPS/archive.sqlite/RESTORE',
    })).toBeNull()
  })
})

describe('runtime diagnostics', () => {
  it('reports process memory, event-loop, queue, and cache gauges', () => {
    const monitor = createRuntimeHealthMonitor()
    try {
      expect(monitor.snapshot({
        admission: { active: 2, waiting: 3 },
        cache: { entries: 4, bytes: 5 },
      })).toMatchObject({
        processMemory: {
          rss: expect.any(Number),
          heapUsed: expect.any(Number),
        },
        eventLoop: {
          utilization: expect.any(Number),
          delayP50Ms: expect.any(Number),
          delayP95Ms: expect.any(Number),
          delayP99Ms: expect.any(Number),
        },
        mutationAdmission: { active: 2, waiting: 3 },
        conditionalCache: { entries: 4, bytes: 5 },
      })
    } finally {
      monitor.close()
    }
  })
})

describe('100-user read burst safety', () => {
  let app
  let server
  let baseUrl
  let token

  beforeAll(async () => {
    app = createApp()
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456' }),
    })
    token = (await login.json()).data.token
  })

  afterAll(async () => {
    await app.locals.stopRecurringTasks()
    await new Promise((resolve) => server.close(resolve))
  })

  it('serves 100 Bearer requests from one network with bounded backpressure and no GET-side writes', async () => {
    const before = await readStore({ cache: true })
    const beforeClone = structuredClone(before)
    const beforeSnapshot = JSON.stringify(before)
    const beforeRevision = before.meta.revision
    const userId = before.users.find((user) => user.email === 'jasper@example.com')?.id
    const beforeTrash = JSON.stringify(before.users.find((user) => user.id === userId)?.settings?.applicationTrash ?? [])
    const endpoints = [
      '/api/auth/me',
      '/api/workspace/bootstrap',
      '/api/applications/trash',
    ]

    const results = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const attempts = []
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const response = await fetch(`${baseUrl}${endpoints[index % endpoints.length]}`, {
          headers: { authorization: `Bearer ${token}` },
        })
        const rawBody = Buffer.from(await response.arrayBuffer()).toString('utf8')
        let payload = null
        try {
          payload = rawBody ? JSON.parse(rawBody) : null
        } catch {
          // The assertions below deliberately reject malformed capacity bodies.
        }
        const retryAfter = response.headers.get('retry-after')
        const structuredBusy = response.status === 503
          && payload?.error?.code === 'SERVER_BUSY'
          && Number(retryAfter) > 0
        attempts.push({ status: response.status, structuredBusy, retryAfter })
        if (response.status === 200) return { ok: true, attempts }
        if (!structuredBusy) return { ok: false, attempts }
        if (attempt < 8) {
          const jitterMs = ((index + 1) * (attempt + 3) * 17) % 101
          await new Promise((resolve) => setTimeout(
            resolve,
            Math.ceil(Number(retryAfter) * 1_000) + jitterMs,
          ))
        }
      }
      return { ok: false, attempts }
    }))
    const attempts = results.flatMap((result) => result.attempts)

    expect(results.filter((result) => !result.ok)).toEqual([])
    expect(attempts.some((attempt) => attempt.status === 429)).toBe(false)
    expect(attempts.filter((attempt) => attempt.status === 503).every(
      (attempt) => attempt.structuredBusy,
    )).toBe(true)
    const after = await readStore({ cache: true })
    expect(after).toBe(before)
    expect(structuredClone(after)).toEqual(beforeClone)
    expect(JSON.stringify(after)).toBe(beforeSnapshot)
    expect(after.meta.revision).toBe(beforeRevision)
    expect(JSON.stringify(after.users.find((user) => user.id === userId)?.settings?.applicationTrash ?? []))
      .toBe(beforeTrash)
    const runtimeSnapshot = app.locals.runtimeResilienceSnapshot(after)
    expect(runtimeSnapshot).toMatchObject({
      mutationAdmission: { active: 0, waiting: 0 },
      conditionalCache: {
        entries: expect.any(Number),
        bytes: expect.any(Number),
      },
      rateLimits: {
        entries: expect.any(Number),
        maxEntries: 20_000,
      },
      requestBodyAdmission: {
        active: 0,
        waiting: 0,
        maxActive: 8,
      },
      workspaceBootstrapAdmission: {
        active: 0,
        waiting: 0,
        maxActive: 32,
        maxQueued: 256,
      },
      smallWorkspaceBootstrapAdmission: {
        active: 0,
        waiting: 0,
        maxActive: 8,
        maxQueued: 32,
      },
      accountSummaryAdmission: {
        active: 0,
        waiting: 0,
        maxActive: 32,
        maxQueued: 512,
      },
      applicationListAdmission: {
        active: 0,
        waiting: 0,
        maxActive: 8,
        maxQueued: 512,
      },
    })
    expect(runtimeSnapshot.smallWorkspaceBootstrapAdmission.admitted).toBeGreaterThan(0)
    expect(runtimeSnapshot.accountSummaryAdmission.admitted).toBeGreaterThan(0)
  })

  it('keeps exact health probes live after rate-limiting an anonymous same-network flood', async () => {
    const responses = await Promise.all(Array.from({ length: 181 }, () => (
      fetch(`${baseUrl}/api/__anonymous_rate_limit_probe__`)
    )))
    const blockedResponse = responses.find((response) => response.status === 429)
    const blockedPayload = blockedResponse ? await blockedResponse.json() : null
    await Promise.all(responses
      .filter((response) => response !== blockedResponse)
      .map((response) => response.arrayBuffer()))

    expect(responses.some((response) => response.status === 401)).toBe(true)
    expect(blockedResponse).toBeDefined()
    expect(blockedResponse?.headers.get('retry-after')).toBeTruthy()
    expect(blockedPayload).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })

    const stillBlocked = await fetch(`${baseUrl}/api/__anonymous_rate_limit_probe__`)
    expect(stillBlocked.status).toBe(429)
    await expect(stillBlocked.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })

    const healthResponses = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/health/live`),
      fetch(`${baseUrl}/api/health/ready`),
    ])
    expect(healthResponses.map((response) => response.status)).toEqual([200, 200, 200])
    await expect(healthResponses[0].json()).resolves.toMatchObject({ data: { status: 'ok' } })
    await expect(healthResponses[1].json()).resolves.toMatchObject({ data: { live: true } })
    await expect(healthResponses[2].json()).resolves.toMatchObject({ data: { ready: true } })

    const healthHeadResponses = await Promise.all([
      fetch(`${baseUrl}/api/health`, { method: 'HEAD' }),
      fetch(`${baseUrl}/api/health/live`, { method: 'HEAD' }),
      fetch(`${baseUrl}/api/health/ready`, { method: 'HEAD' }),
    ])
    expect(healthHeadResponses.map((response) => response.status)).toEqual([200, 200, 200])

    const nearMisses = await Promise.all([
      fetch(`${baseUrl}/api/health/ws`),
      fetch(`${baseUrl}/api/health/ready/extra`),
      fetch(`${baseUrl}/api/health`, { method: 'POST' }),
    ])
    expect(nearMisses.every((response) => response.status === 429)).toBe(true)
    await Promise.all(nearMisses.map((response) => response.arrayBuffer()))
  })
})
