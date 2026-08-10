import { describe, expect, it } from 'vitest'
import { AbortDeadlineError } from '../abortDeadline.js'
import { createOriginScheduler, createSemaphore, createSourceHttpClient } from './sourceHttpClient.js'

const source = {
  id: 'demo',
  userAgent: 'Demo/1.0',
  rateLimitPerMin: 120,
  cacheTtlMs: 1_000,
  timeoutMs: 20_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 0,
    maxDelayMs: 0,
    retryableStatuses: [429, 502, 503, 504],
    retryNetworkErrors: true,
  },
}

describe('source HTTP client', () => {
  it('caches cacheable GET responses before fetching again', async () => {
    let clock = 1_000
    let fetchCount = 0
    const fetchImpl = async () => {
      fetchCount += 1
      return new Response('cached body', { status: 200 })
    }
    const cache = new Map()
    const client = createSourceHttpClient({
      fetchImpl,
      cache,
      now: () => clock,
      delayFn: async () => {},
    })

    const first = await client.fetchText('https://api.example.com/items', { source, cacheKey: 'demo-cache' })
    clock = 1_500
    const second = await client.fetchText('https://api.example.com/items', { source, cacheKey: 'demo-cache' })
    expect(first.text).toBe('cached body')
    expect(second.text).toBe('cached body')
    expect(second.cached).toBe(true)
    expect(fetchCount).toBe(1)

    clock = 2_001
    await client.fetchText('https://api.example.com/items', { source, cacheKey: 'demo-cache' })
    expect(cache.get('demo-cache').fetchedAtMs).toBe(2_001)
  })

  it('retries 429 and 503 with backoff and returns the successful response', async () => {
    const responses = [
      new Response('', { status: 429, headers: { 'retry-after': '0' } }),
      new Response('', { status: 503, headers: { 'retry-after': '0' } }),
      new Response('ok', { status: 200 }),
    ]
    const fetchImpl = async () => responses.shift()
    const client = createSourceHttpClient({
      fetchImpl,
      delayFn: async () => {},
      scheduler: createOriginScheduler({ minIntervalMs: 0, delayFn: async () => {} }),
    })

    const result = await client.fetchText('https://api.example.com/items', {
      source,
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    })
    expect(result.text).toBe('ok')
    expect(responses).toHaveLength(0)
  })

  it('throws SourceHttpError for non-retryable HTTP failures', async () => {
    const client = createSourceHttpClient({
      fetchImpl: async () => new Response('bad', { status: 400 }),
      delayFn: async () => {},
    })
    await expect(client.fetchText('https://api.example.com/items', { source }))
      .rejects.toMatchObject({ name: 'SourceHttpError', status: 400 })
  })

  it('times out slow upstreams with AbortDeadlineError', async () => {
    const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
    const client = createSourceHttpClient({ fetchImpl, delayFn: async () => {} })
    await expect(client.fetchText('https://api.example.com/items', {
      source: { ...source, timeoutMs: 5 },
    })).rejects.toBeInstanceOf(AbortDeadlineError)
  })

  it('serializes and spaces requests to the same origin', async () => {
    let clock = 0
    const seen = []
    const scheduler = createOriginScheduler({
      minIntervalMs: 10,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    const operation = async () => {
      seen.push(clock)
      clock += 3
    }

    await scheduler('https://api.example.com/a', operation)
    await scheduler('https://api.example.com/b', operation)
    await scheduler('https://other.example.com/c', operation)

    expect(seen).toEqual([0, 13, 16])
  })

  it('reuses the per-source scheduler across concurrent client requests', async () => {
    let clock = 0
    const startedAt = []
    const client = createSourceHttpClient({
      maxConcurrency: 2,
      now: () => clock,
      delayFn: async (milliseconds) => { clock += milliseconds },
      fetchImpl: async () => {
        startedAt.push(clock)
        return new Response('ok', { status: 200 })
      },
    })

    await Promise.all([
      client.fetchText('https://api.example.com/a', { source }),
      client.fetchText('https://api.example.com/b', { source }),
    ])

    expect(startedAt).toEqual([0, 500])
  })

  it('does not occupy a global network slot while a source is only waiting for its interval', async () => {
    let releaseInterval
    const intervalGate = new Promise((resolve) => { releaseInterval = resolve })
    const requested = []
    const client = createSourceHttpClient({
      maxConcurrency: 1,
      delayFn: async (milliseconds) => {
        if (milliseconds > 0) await intervalGate
      },
      fetchImpl: async (url) => {
        requested.push(new URL(url).pathname)
        return new Response('ok', { status: 200 })
      },
    })
    const otherSource = { ...source, id: 'other' }

    const requests = [
      client.fetchText('https://api.example.com/a-1', { source }),
      client.fetchText('https://api.example.com/a-2', { source }),
      client.fetchText('https://other.example.com/b-1', { source: otherSource }),
    ]
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requested).toEqual(['/a-1', '/b-1'])
    releaseInterval()
    await expect(Promise.all(requests)).resolves.toHaveLength(3)
    expect(requested).toEqual(['/a-1', '/b-1', '/a-2'])
  })

  it('coalesces concurrent cache misses for the same cache key', async () => {
    let releaseFetch
    const fetchGate = new Promise((resolve) => { releaseFetch = resolve })
    let fetchCount = 0
    const client = createSourceHttpClient({
      fetchImpl: async () => {
        fetchCount += 1
        await fetchGate
        return new Response('shared', { status: 200 })
      },
      scheduler: createOriginScheduler({ minIntervalMs: 0 }),
    })

    const first = client.fetchText('https://api.example.com/items', {
      source,
      cacheKey: 'shared-key',
    })
    const second = client.fetchText('https://api.example.com/items', {
      source,
      cacheKey: 'shared-key',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchCount).toBe(1)

    releaseFetch()
    const results = await Promise.all([first, second])
    expect(results.map((result) => result.text)).toEqual(['shared', 'shared'])
    expect(fetchCount).toBe(1)
  })

  it('bounds global concurrency', async () => {
    let active = 0
    let maximum = 0
    const limiter = createSemaphore(2)
    const work = () => limiter(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 3))
      active -= 1
    })

    await Promise.all([work(), work(), work(), work()])
    expect(maximum).toBe(2)
    expect(active).toBe(0)
  })

  it('rejects non-HTTPS upstreams', async () => {
    const client = createSourceHttpClient({ fetchImpl: async () => new Response('x') })
    await expect(client.fetchText('http://api.example.com/items', { source }))
      .rejects.toMatchObject({ code: 'SOURCE_NON_HTTPS_URL' })
  })
})
