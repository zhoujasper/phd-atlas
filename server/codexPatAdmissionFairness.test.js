import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createApp,
  prepareCodexPatProvisionalPrincipal,
  requestBodyAdmissionKey,
} from './index.js'
import { createCodexPersonalAccessToken } from './codexAuthorization.js'
import { createMutationAdmissionController } from './runtimeResilience.js'

const SAME_NAT = '203.0.113.40'

function credential(index, userId = `codex-user-${index}`) {
  const generated = createCodexPersonalAccessToken()
  return {
    ...generated,
    authorization: {
      id: `codex-auth-${index}`,
      userId,
      tokenSelector: generated.selector,
      tokenHash: generated.tokenHash,
    },
  }
}

function mockRequest(token, { method = 'GET', originalUrl = '/api/codex/whoami' } = {}) {
  return {
    method,
    originalUrl,
    ip: SAME_NAT,
    socket: { remoteAddress: SAME_NAT },
    get(name) {
      return String(name).toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined
    },
  }
}

async function exerciseAdmission(keys, options) {
  const controller = createMutationAdmissionController(options)
  try {
    const outcomes = await Promise.all(keys.map(async (key) => {
      try {
        const release = await controller.acquire({ key })
        await Promise.resolve()
        release()
        return 'admitted'
      } catch (error) {
        return error?.reason ?? 'error'
      }
    }))
    return { outcomes, snapshot: controller.snapshot() }
  } finally {
    controller.close()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Codex PAT provisional admission fairness', () => {
  it('gives 100 valid accounts behind one NAT distinct STANDARD, body, and HEAVY admission keys', async () => {
    const credentials = Array.from({ length: 100 }, (_, index) => credential(index))
    const bySelector = new Map(credentials.map((entry) => [entry.selector, entry.authorization]))
    const lookupAdmission = createMutationAdmissionController({
      maxActive: 16,
      maxQueued: 256,
      waitTimeoutMs: 1_000,
    })
    const lookupAuthorization = vi.fn(async (selector) => bySelector.get(selector) ?? null)
    const requests = credentials.map((entry) => mockRequest(entry.token))
    try {
      await Promise.all(requests.map((request) => prepareCodexPatProvisionalPrincipal(request, {
        lookupAdmission,
        lookupAuthorization,
      })))
    } finally {
      lookupAdmission.close()
    }

    const keys = requests.map((request) => requestBodyAdmissionKey(request))
    expect(new Set(keys).size).toBe(100)
    expect(keys.every((key) => key.startsWith('codex-account:codex-user-'))).toBe(true)
    expect(lookupAuthorization).toHaveBeenCalledTimes(100)

    const standard = await exerciseAdmission(keys, {
      maxActive: 32,
      maxQueued: 256,
      waitTimeoutMs: 1_000,
      maxActivePerKey: 8,
      maxQueuedPerKey: 16,
    })
    expect(standard.outcomes).toEqual(Array(100).fill('admitted'))
    expect(standard.snapshot.perKeyRejected).toBe(0)

    const body = await exerciseAdmission(keys, {
      maxActive: 8,
      maxQueued: 128,
      waitTimeoutMs: 1_000,
      maxActivePerKey: 2,
      maxQueuedPerKey: 2,
    })
    expect(body.outcomes).toEqual(Array(100).fill('admitted'))
    expect(body.snapshot.perKeyRejected).toBe(0)

    const heavy = await exerciseAdmission(keys, {
      maxActive: 1,
      maxQueued: 128,
      waitTimeoutMs: 1_000,
      maxActivePerKey: 1,
      maxQueuedPerKey: 2,
    })
    expect(heavy.outcomes).toEqual(Array(100).fill('admitted'))
    expect(heavy.snapshot.perKeyRejected).toBe(0)
  })

  it('keeps multiple PATs for one account on one shared account key', async () => {
    const credentials = Array.from({ length: 9 }, (_, index) => credential(index, 'shared-account'))
    const bySelector = new Map(credentials.map((entry) => [entry.selector, entry.authorization]))
    const requests = credentials.map((entry) => mockRequest(entry.token))
    await Promise.all(requests.map((request) => prepareCodexPatProvisionalPrincipal(request, {
      lookupAuthorization: async (selector) => bySelector.get(selector) ?? null,
    })))

    const keys = requests.map((request) => requestBodyAdmissionKey(request))
    expect(new Set(keys)).toEqual(new Set(['codex-account:shared-account']))
    const standard = await exerciseAdmission(keys, {
      maxActive: 32,
      maxQueued: 256,
      waitTimeoutMs: 1_000,
      maxActivePerKey: 8,
      maxQueuedPerKey: 16,
    })
    expect(standard.outcomes.filter((outcome) => outcome === 'admitted')).toHaveLength(8)
    expect(standard.outcomes.filter((outcome) => outcome === 'per-key-active')).toHaveLength(1)
  })

  it('keeps syntactically valid forged PATs on the network key and out of global queues', async () => {
    const credentials = Array.from({ length: 100 }, (_, index) => credential(index))
    const requests = credentials.map((entry) => mockRequest(entry.token))
    const lookupAuthorization = vi.fn(async () => null)
    await Promise.all(requests.map((request) => prepareCodexPatProvisionalPrincipal(request, {
      lookupAuthorization,
    })))

    const keys = requests.map((request) => requestBodyAdmissionKey(request))
    expect(new Set(keys)).toEqual(new Set([`network:${SAME_NAT}/32`]))
    expect(lookupAuthorization).toHaveBeenCalledTimes(100)
    const standard = await exerciseAdmission(keys, {
      maxActive: 32,
      maxQueued: 256,
      waitTimeoutMs: 1_000,
      maxActivePerKey: 8,
      maxQueuedPerKey: 16,
    })
    expect(standard.outcomes.filter((outcome) => outcome === 'admitted')).toHaveLength(8)
    expect(standard.outcomes.filter((outcome) => outcome === 'per-key-active')).toHaveLength(92)
    expect(standard.snapshot.maxObservedActive).toBe(8)
    expect(standard.snapshot.maxObservedQueued).toBe(0)
  })

  it('bounds rotating-selector provisional lookups and fails overflow back to network classification', async () => {
    const credentials = Array.from({ length: 10 }, (_, index) => credential(index))
    const bySelector = new Map(credentials.map((entry) => [entry.selector, entry.authorization]))
    const lookupAdmission = createMutationAdmissionController({
      maxActive: 2,
      maxQueued: 3,
      waitTimeoutMs: 1_000,
    })
    let releaseBlockedLookups
    const blocked = new Promise((resolve) => {
      releaseBlockedLookups = resolve
    })
    let activeLookups = 0
    let maxActiveLookups = 0
    const lookupAuthorization = vi.fn(async (selector) => {
      activeLookups += 1
      maxActiveLookups = Math.max(maxActiveLookups, activeLookups)
      await blocked
      activeLookups -= 1
      return bySelector.get(selector) ?? null
    })
    const requests = credentials.map((entry) => mockRequest(entry.token))
    const preparations = requests.map((request) => prepareCodexPatProvisionalPrincipal(request, {
      lookupAdmission,
      lookupAuthorization,
    }))
    await vi.waitFor(() => {
      expect(lookupAdmission.snapshot()).toMatchObject({ active: 2, waiting: 3 })
    })
    releaseBlockedLookups()
    const principals = await Promise.all(preparations)
    const snapshot = lookupAdmission.snapshot()
    lookupAdmission.close()

    expect(principals.filter(Boolean)).toHaveLength(5)
    expect(maxActiveLookups).toBe(2)
    expect(snapshot.maxObservedActive).toBe(2)
    expect(snapshot.maxObservedQueued).toBe(3)
    expect(snapshot.rejected).toBe(5)
    expect(requests.filter((request) => requestBodyAdmissionKey(request).startsWith('network:')))
      .toHaveLength(5)
  })

  it('uses provisional identity only for admission and rechecks a queued revocation before authorization', async () => {
    const generated = credential('revoked', 'revoked-user')
    let lookupCount = 0
    const app = createApp({
      testHooks: {
        lookupCodexAuthorization: async (selector) => {
          if (selector !== generated.selector) return null
          lookupCount += 1
          return lookupCount === 1 ? generated.authorization : null
        },
      },
    })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const revoked = await fetch(`${baseUrl}/api/codex/whoami`, {
        headers: { authorization: `Bearer ${generated.token}` },
      })
      expect(revoked.status).toBe(401)
      expect(revoked.headers.get('ratelimit-limit')).toBe('12000')
      expect(lookupCount).toBe(2)

      const forbidden = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${generated.token}` },
      })
      expect(forbidden.status).toBe(403)
      expect(forbidden.headers.get('ratelimit-limit')).toBe('180')
      expect(lookupCount).toBe(2)
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
