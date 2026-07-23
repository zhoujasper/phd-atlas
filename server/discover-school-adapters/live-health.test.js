import { describe, expect, it, vi } from 'vitest'
import { checkSchoolAdaptersLive } from './live-health.js'

const adapter = {
  school: 'Example University',
  region: 'US',
  allowedHosts: ['example.edu'],
  seeds: [
    { kind: 'faculty', url: 'https://www.example.edu/faculty/' },
    { kind: 'research', url: 'https://research.example.edu/labs/' },
  ],
  pathHints: { faculty: ['people'], lab: ['labs'], department: ['department'], program: ['phd'] },
}

describe('school adapter live health', () => {
  it('accepts official HTML pages whose URL or body matches the declared kind', async () => {
    const fetchImpl = vi.fn(async (value) => {
      const url = String(value)
      return new Response(
        url.includes('/faculty/') ? '<html><body>Faculty and people</body></html>' : '<html><body>Research laboratories</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
    })
    const report = await checkSchoolAdaptersLive([adapter], { fetchImpl, concurrency: 2, perHostDelayMs: 0 })

    expect(report).toMatchObject({ schoolCount: 1, seedCount: 2, passedSeedCount: 2, failedSeedCount: 0, passed: true })
  })

  it('rejects redirects to non-school hosts before fetching the target', async () => {
    const fetchImpl = vi.fn(async (value) => String(value).endsWith('/robots.txt')
      ? new Response('User-agent: *\nAllow: /', { status: 200 })
      : new Response('', {
          status: 302,
          headers: { location: 'https://tracking.example.net/faculty' },
        }))
    const report = await checkSchoolAdaptersLive([{ ...adapter, seeds: adapter.seeds.slice(0, 1) }], {
      fetchImpl,
      perHostDelayMs: 0,
    })

    expect(report.passed).toBe(false)
    expect(report.failures[0].reason).toBe('redirect-left-official-hosts')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports pages that do not semantically match their declared adapter kind', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html><body>News and events</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))
    const report = await checkSchoolAdaptersLive([{
      ...adapter,
      seeds: [{ kind: 'doctoral', url: 'https://www.example.edu/news/' }],
    }], { fetchImpl, perHostDelayMs: 0 })

    expect(report.failures[0].reason).toBe('kind-mismatch:doctoral')
  })

  it('fails closed when robots disallows a seed and never requests that page', async () => {
    const fetchImpl = vi.fn(async (value) => String(value).endsWith('/robots.txt')
      ? new Response('User-agent: *\nDisallow: /faculty/', { status: 200 })
      : new Response('<html><body>Faculty</body></html>', { status: 200 }))
    const report = await checkSchoolAdaptersLive([{ ...adapter, seeds: adapter.seeds.slice(0, 1) }], {
      fetchImpl,
      perHostDelayMs: 0,
    })

    expect(report.failures[0].reason).toBe('robots-denied')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('serializes requests to the same origin even with multiple workers', async () => {
    let active = 0
    let maximumActive = 0
    const sameOriginAdapter = {
      ...adapter,
      seeds: [
        { kind: 'faculty', url: 'https://www.example.edu/faculty/' },
        { kind: 'research', url: 'https://www.example.edu/research/' },
      ],
    }
    const fetchImpl = vi.fn(async (value) => {
      if (String(value).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return new Response('<html><body>Faculty people research laboratories</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const report = await checkSchoolAdaptersLive([sameOriginAdapter], {
      fetchImpl,
      concurrency: 2,
      perHostDelayMs: 0,
    })

    expect(report.passed).toBe(true)
    expect(maximumActive).toBe(1)
  })

  it('retries 503 responses and honours Retry-After', async () => {
    let seedAttempts = 0
    const fetchImpl = vi.fn(async (value) => {
      if (String(value).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      seedAttempts += 1
      if (seedAttempts === 1) return new Response('', { status: 503, headers: { 'retry-after': '0' } })
      return new Response('<html><body>Faculty people</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const report = await checkSchoolAdaptersLive([{ ...adapter, seeds: adapter.seeds.slice(0, 1) }], {
      fetchImpl,
      retries: 1,
      perHostDelayMs: 0,
    })

    expect(report.passed).toBe(true)
    expect(seedAttempts).toBe(2)
  })

  it('bounds 429 retries while honouring Retry-After', async () => {
    let seedAttempts = 0
    const fetchImpl = vi.fn(async (value) => {
      if (String(value).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      seedAttempts += 1
      if (seedAttempts <= 2) return new Response('', { status: 429, headers: { 'retry-after': '0' } })
      return new Response('<html><body>Faculty people</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const report = await checkSchoolAdaptersLive([{ ...adapter, seeds: adapter.seeds.slice(0, 1) }], {
      fetchImpl,
      retries: 1,
      perHostDelayMs: 0,
    })

    expect(report.passed).toBe(false)
    expect(report.failedSeedCount).toBe(1)
    expect(report.failures[0]).toMatchObject({ status: 429, reason: 'http-error' })
    expect(seedAttempts).toBe(2)
  })

  it('bounds a robots response body that never finishes', async () => {
    const fetchImpl = vi.fn(async (value) => {
      if (String(value).endsWith('/robots.txt')) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('User-agent: *\nAllow: /'))
          },
        }), { status: 200 })
      }
      return new Response('<html><body>Faculty people</body></html>', { status: 200 })
    })
    const startedAt = Date.now()
    const report = await checkSchoolAdaptersLive([{ ...adapter, seeds: adapter.seeds.slice(0, 1) }], {
      fetchImpl,
      timeoutMs: 250,
      perHostDelayMs: 0,
    })

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(['robots-timeout', 'timeout']).toContain(report.failures[0].reason)
  })

  it('counts the per-host courtesy wait inside the request deadline', async () => {
    const fetchImpl = vi.fn(async (value) => String(value).endsWith('/robots.txt')
      ? new Response('User-agent: *\nAllow: /', { status: 200 })
      : new Response('<html><body>Faculty people</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }))
    const startedAt = Date.now()
    const report = await checkSchoolAdaptersLive([{ ...adapter, seeds: adapter.seeds.slice(0, 1) }], {
      fetchImpl,
      timeoutMs: 250,
      perHostDelayMs: 1_000,
    })

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(report.failures[0].reason).toBe('timeout')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not release an origin lock while a timed-out custom fetch is still running', async () => {
    let active = 0
    let maximumActive = 0
    let seedAttempts = 0
    const stubbornFetch = vi.fn(async (value) => {
      if (String(value).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      seedAttempts += 1
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 400))
      active -= 1
      return new Response('<html><body>Faculty people research laboratories</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const sameOriginAdapter = {
      ...adapter,
      seeds: [
        { kind: 'faculty', url: 'https://www.example.edu/faculty/' },
        { kind: 'research', url: 'https://www.example.edu/research/' },
      ],
    }
    const report = await checkSchoolAdaptersLive([sameOriginAdapter], {
      fetchImpl: stubbornFetch,
      concurrency: 2,
      timeoutMs: 250,
      perHostDelayMs: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(report.failedSeedCount).toBe(2)
    expect(seedAttempts).toBe(1)
    expect(maximumActive).toBe(1)
  })
})
