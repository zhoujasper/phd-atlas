import { describe, expect, it } from 'vitest'
import { AbortDeadlineError } from '../abortDeadline.js'
import { SourceHttpError, SourceStructureChangedError } from './sourceErrors.js'
import {
  buildRedditSearchUrl,
  buildRedditRssSearchUrl,
  parseRedditAtomFeed,
  parseRedditSearchResponse,
  redditSubmissionsSource,
} from './redditSubmissions.js'
import { createSourceHttpClient, createOriginScheduler } from './sourceHttpClient.js'
import {
  fetchSequence,
  htmlResponse,
  jsonFixture,
  jsonResponse,
  neverSettlingFetch,
  readFixture,
} from './adapterTestSupport.js'

const credentials = {
  auth: {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    username: 'test-user',
    password: 'test-password',
  },
}

const query = { keyword: 'acceptance timeline', limit: 25 }

describe('Reddit adapter', () => {
  it('builds the official API URL and parses a deterministic fixture', () => {
    const url = buildRedditSearchUrl(query)
    expect(url.toString()).toContain('/r/gradadmissions/search')
    expect(url.searchParams.get('restrict_sr')).toBe('1')
    expect(url.searchParams.get('sort')).toBe('new')

    const parsed = parseRedditSearchResponse(jsonFixture('reddit-search-ok.json'), {
      sourceUrl: url.toString(),
      fetchedAt: '2026-08-03T00:00:00.000Z',
    })
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].value).toMatchObject({
      id: 'abc123',
      title: 'Accepted to PhD program, timeline inside',
      subreddit: 'gradadmissions',
    })
    expect(parsed.records[0].sourceUrl).toContain('reddit.com/r/gradadmissions/comments/abc123')
  })

  it('parses the official Atom fallback with post-level provenance', () => {
    const url = buildRedditRssSearchUrl(query)
    expect(url.pathname).toBe('/r/gradadmissions/search.rss')
    expect(url.searchParams.get('t')).toBe('all')
    const parsed = parseRedditAtomFeed(readFixture('reddit-search-ok.atom.xml'), {
      sourceUrl: url.toString(),
      fetchedAt: '2026-08-09T00:00:00.000Z',
    })
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({
      sourceUrl: 'https://www.reddit.com/r/gradadmissions/comments/atom123/accepted_to_phd_program_timeline_inside/',
      confidence: 0.82,
      value: {
        id: 'atom123',
        subreddit: 'gradadmissions',
        transport: 'official-atom-feed',
      },
    })
    expect(parsed.records[0].value.selfText).toMatch(/applied in December/i)
  })

  it('uses OAuth for token and search, then keeps provenance', async () => {
    let tokenRequested = false
    let authHeader = ''
    const fetchImpl = async (url, init) => {
      if (String(url).includes('/api/v1/access_token')) {
        tokenRequested = true
        authHeader = init.headers.authorization
        return jsonResponse(jsonFixture('reddit-token-ok.json'))
      }
      expect(init.headers.authorization).toBe('Bearer test-access-token')
      return jsonResponse(jsonFixture('reddit-search-ok.json'))
    }
    const result = await redditSubmissionsSource.run(query, {
      fetchImpl,
      ...credentials,
      retry: { maxAttempts: 1 },
    })
    expect(tokenRequested).toBe(true)
    expect(authHeader).toContain('Basic ')
    expect(result.status).toBe('ok')
    expect(result.records[0].sourceId).toBe('reddit-submissions')
  })

  it('uses the official Atom feed when OAuth credentials are missing', async () => {
    const result = await redditSubmissionsSource.run(query, {
      fetchImpl: async (url) => {
        expect(String(url)).toContain('/search.rss')
        return htmlResponse(readFixture('reddit-search-ok.atom.xml'), {
          headers: { 'content-type': 'application/atom+xml' },
        })
      },
      retry: { maxAttempts: 1 },
    })
    expect(result.status).toBe('ok')
    expect(result.records).toHaveLength(1)
    expect(result.warnings).toEqual([
      'Reddit OAuth credentials are not configured; used the official Reddit Atom search feed.',
    ])
    expect(result.meta.transport).toBe('official-atom-feed')
  })

  it('supports app-only OAuth without storing a Reddit username or password', async () => {
    let tokenBody = ''
    const result = await redditSubmissionsSource.run(query, {
      auth: { clientId: 'client-only', clientSecret: 'secret-only' },
      fetchImpl: async (url, init) => {
        if (String(url).includes('/access_token')) {
          tokenBody = String(init.body)
          return jsonResponse(jsonFixture('reddit-token-ok.json'))
        }
        return jsonResponse(jsonFixture('reddit-search-ok.json'))
      },
      retry: { maxAttempts: 1 },
    })
    expect(tokenBody).toContain('grant_type=client_credentials')
    expect(result.meta.transport).toBe('oauth-client-credentials')
    expect(result.status).toBe('ok')
  })

  it('times out, retries transient HTTP, and limits request spacing through the adapter path', async () => {
    await expect(redditSubmissionsSource.run(query, {
      fetchImpl: neverSettlingFetch(),
      timeoutMs: 10,
      retry: { maxAttempts: 1 },
      ...credentials,
    })).rejects.toBeInstanceOf(AbortDeadlineError)

    let tokenCalls = 0
    const retryFetch = fetchSequence([
      jsonResponse({}, { status: 429 }),
      jsonResponse({}, { status: 503 }),
      jsonResponse(jsonFixture('reddit-search-ok.json')),
    ])
    const wrapped = async (url, init) => {
      if (String(url).includes('/api/v1/access_token')) {
        tokenCalls += 1
        return jsonResponse(jsonFixture('reddit-token-ok.json'))
      }
      return retryFetch(url, init)
    }
    const retried = await redditSubmissionsSource.run(query, {
      fetchImpl: wrapped,
      ...credentials,
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      delayFn: async () => {},
    })
    expect(retried.status).toBe('ok')
    expect(tokenCalls).toBe(1)

    let clock = 0
    const scheduler = createOriginScheduler({
      minIntervalMs: 1_000,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    const httpClient = createSourceHttpClient({
      fetchImpl: async (url, init) => (
        String(url).includes('/api/v1/access_token')
          ? jsonResponse(jsonFixture('reddit-token-ok.json'))
          : jsonResponse(jsonFixture('reddit-search-ok.json'))
      ),
      scheduler,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    await redditSubmissionsSource.run(query, { httpClient, cacheTtlMs: 0, ...credentials })
    await redditSubmissionsSource.run(query, { httpClient, cacheTtlMs: 0, ...credentials })
    expect(clock).toBeGreaterThanOrEqual(1_000)
  })

  it('degrades on HTTP errors and on API structure changes', async () => {
    await expect(redditSubmissionsSource.run(query, {
      fetchImpl: async (url) => (
        String(url).includes('/api/v1/access_token')
          ? jsonResponse(jsonFixture('reddit-token-ok.json'))
          : jsonResponse({}, { status: 400 })
      ),
      retry: { maxAttempts: 1 },
      ...credentials,
    })).rejects.toBeInstanceOf(SourceHttpError)

    await expect(redditSubmissionsSource.run(query, {
      fetchImpl: async (url) => (
        String(url).includes('/api/v1/access_token')
          ? jsonResponse(jsonFixture('reddit-token-ok.json'))
          : jsonResponse({ unexpected: true })
      ),
      retry: { maxAttempts: 1 },
      ...credentials,
    })).rejects.toBeInstanceOf(SourceStructureChangedError)
  })
})
