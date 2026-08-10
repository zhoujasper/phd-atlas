import { describe, expect, it } from 'vitest'
import { AbortDeadlineError } from '../abortDeadline.js'
import { SourceHttpError, SourceStructureChangedError } from './sourceErrors.js'
import {
  buildOpenAlexWorksUrl,
  openalexWorksSource,
  parseOpenAlexWorksResponse,
} from './openalexWorks.js'
import { createSourceHttpClient, createOriginScheduler } from './sourceHttpClient.js'
import {
  fetchSequence,
  jsonFixture,
  jsonResponse,
  neverSettlingFetch,
} from './adapterTestSupport.js'

const query = { search: 'doctoral advising', countryCode: 'US', limit: 25 }

describe('OpenAlex Works adapter', () => {
  it('builds a documented works URL and parses a deterministic fixture', () => {
    const url = buildOpenAlexWorksUrl(query)
    expect(url.searchParams.get('search')).toBe('doctoral advising')
    expect(url.searchParams.get('filter')).toContain('authorships.institutions.country_code:US')
    expect(url.searchParams.get('per-page')).toBe('25')

    const records = parseOpenAlexWorksResponse(jsonFixture('openalex-works-ok.json'), {
      sourceUrl: url.toString(),
      fetchedAt: '2026-08-03T00:00:00.000Z',
    })
    expect(records[0].value).toMatchObject({
      id: 'W123456789',
      authors: ['Lin Zhang'],
      institutions: ['Example University'],
      citedByCount: 42,
    })
    expect(records[0].sourceUrl).toBe('https://doi.org/10.1000/example')
    expect(records[0].apiUrl).toBe(url.toString())
  })

  it('fetches through the adapter and keeps provenance', async () => {
    const result = await openalexWorksSource.run(query, {
      fetchImpl: async () => jsonResponse(jsonFixture('openalex-works-ok.json')),
      retry: { maxAttempts: 1 },
    })
    expect(result.status).toBe('ok')
    expect(result.records[0].sourceUrl).toBe('https://doi.org/10.1000/example')
    expect(result.records[0].apiUrl).toContain('api.openalex.org')
    expect(result.records[0].confidence).toBe(1)
  })

  it('times out, retries transient HTTP, and limits request spacing through the adapter path', async () => {
    await expect(openalexWorksSource.run(query, {
      fetchImpl: neverSettlingFetch(),
      timeoutMs: 10,
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(AbortDeadlineError)

    const retried = await openalexWorksSource.run(query, {
      fetchImpl: fetchSequence([
        jsonResponse({}, { status: 500 }),
        jsonResponse({}, { status: 503 }),
        jsonResponse(jsonFixture('openalex-works-ok.json')),
      ]),
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      delayFn: async () => {},
    })
    expect(retried.status).toBe('ok')

    let clock = 0
    const scheduler = createOriginScheduler({
      minIntervalMs: 1_000,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    const httpClient = createSourceHttpClient({
      fetchImpl: async () => jsonResponse(jsonFixture('openalex-works-ok.json')),
      scheduler,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    await openalexWorksSource.run(query, { httpClient, cacheTtlMs: 0 })
    await openalexWorksSource.run(query, { httpClient, cacheTtlMs: 0 })
    expect(clock).toBeGreaterThanOrEqual(1_000)
  })

  it('degrades on HTTP errors and on API structure changes', async () => {
    await expect(openalexWorksSource.run(query, {
      fetchImpl: async () => jsonResponse({}, { status: 400 }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceHttpError)
    await expect(openalexWorksSource.run(query, {
      fetchImpl: async () => jsonResponse({ unexpected: true }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceStructureChangedError)
  })
})
