import { describe, expect, it } from 'vitest'
import { AbortDeadlineError } from '../abortDeadline.js'
import { SourceHttpError, SourceStructureChangedError } from './sourceErrors.js'
import {
  buildGradCafeResultsUrl,
  gradcafeResultsSource,
  parseGradCafeResultsHtml,
} from './gradcafeResults.js'
import { createSourceHttpClient, createOriginScheduler } from './sourceHttpClient.js'
import {
  fetchSequence,
  htmlResponse,
  neverSettlingFetch,
  readFixture,
} from './adapterTestSupport.js'

const query = { keyword: 'computer science', year: 2024 }

describe('GradCafe adapter', () => {
  it('builds a reference URL and parses a deterministic HTML fixture', () => {
    const url = buildGradCafeResultsUrl(query)
    expect(url.searchParams.get('q')).toBe('computer science')
    expect(url.searchParams.get('year')).toBe('2024')

    const parsed = parseGradCafeResultsHtml(readFixture('gradcafe-results-ok.html'), {
      sourceUrl: url.toString(),
      fetchedAt: '2026-08-03T00:00:00.000Z',
    })
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0].value).toMatchObject({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      decision: 'accepted',
      date: '2024-02-01',
    })
    expect(parsed.records[0].sourceUrl).toContain('/institution/stanford-university')
    expect(parsed.records[0].confidence).toBe(0.85)
  })

  it('fetches HTML through the adapter and keeps source links', async () => {
    const result = await gradcafeResultsSource.run(query, {
      fetchImpl: async () => htmlResponse(readFixture('gradcafe-results-ok.html')),
      retry: { maxAttempts: 1 },
    })
    expect(result.status).toBe('ok')
    expect(result.records[0].sourceUrl).toContain('thegradcafe.com')
  })

  it('times out, retries transient HTTP, and limits request spacing through the adapter path', async () => {
    await expect(gradcafeResultsSource.run(query, {
      fetchImpl: neverSettlingFetch(),
      timeoutMs: 10,
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(AbortDeadlineError)

    const retried = await gradcafeResultsSource.run(query, {
      fetchImpl: fetchSequence([
        htmlResponse('', { status: 429 }),
        htmlResponse('', { status: 503 }),
        htmlResponse(readFixture('gradcafe-results-ok.html')),
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
      fetchImpl: async () => htmlResponse(readFixture('gradcafe-results-ok.html')),
      scheduler,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    await gradcafeResultsSource.run(query, { httpClient, cacheTtlMs: 0 })
    await gradcafeResultsSource.run(query, { httpClient, cacheTtlMs: 0 })
    expect(clock).toBeGreaterThanOrEqual(1_000)
  })

  it('degrades on HTTP errors and HTML structure changes', async () => {
    await expect(gradcafeResultsSource.run(query, {
      fetchImpl: async () => htmlResponse('', { status: 400 }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceHttpError)
    expect(() => parseGradCafeResultsHtml(
      readFixture('gradcafe-results-structure-changed.html'),
    )).toThrow(SourceStructureChangedError)
  })
})
