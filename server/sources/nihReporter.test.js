import { describe, expect, it } from 'vitest'
import { AbortDeadlineError } from '../abortDeadline.js'
import { SourceHttpError, SourceStructureChangedError } from './sourceErrors.js'
import {
  buildNihReporterBody,
  nihReporterSource,
  parseNihReporterResponse,
} from './nihReporter.js'
import { createSourceHttpClient, createOriginScheduler } from './sourceHttpClient.js'
import {
  fetchSequence,
  jsonFixture,
  jsonResponse,
  neverSettlingFetch,
} from './adapterTestSupport.js'

const query = { keyword: 'machine learning immunology', fiscalYears: [2025, 2026] }

describe('NIH RePORTER adapter', () => {
  it('builds a documented POST body and parses a deterministic fixture', () => {
    const body = buildNihReporterBody(query)
    expect(body.criteria.include_active_projects).toBe(true)
    expect(body.criteria.fiscal_years).toEqual([2025, 2026])
    expect(body.criteria.advanced_text_search.search_text).toContain('machine learning')
    expect(body.limit).toBe(50)

    const records = parseNihReporterResponse(jsonFixture('nih-projects-ok.json'), {
      sourceUrl: 'https://api.reporter.nih.gov/v2/projects/search',
      fetchedAt: '2026-08-03T00:00:00.000Z',
    })
    expect(records).toHaveLength(1)
    expect(records[0].value).toMatchObject({
      applicationId: '1111111',
      projectNumber: '1R01AI000001-01A1',
      piName: 'Rosa Franklin',
      awardAmount: 750000,
    })
  })

  it('posts JSON through the adapter and keeps provenance', async () => {
    let requestBody = ''
    const fetchImpl = async (url, init) => {
      requestBody = init.body
      return jsonResponse(jsonFixture('nih-projects-ok.json'))
    }
    const result = await nihReporterSource.run(query, {
      fetchImpl,
      retry: { maxAttempts: 1 },
    })
    expect(JSON.parse(requestBody).criteria.advanced_text_search.operator).toBe('AND')
    expect(result.status).toBe('ok')
    expect(result.records[0].sourceId).toBe('nih-reporter')
  })

  it('times out, retries transient HTTP, and limits request spacing through the adapter path', async () => {
    await expect(nihReporterSource.run(query, {
      fetchImpl: neverSettlingFetch(),
      timeoutMs: 10,
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(AbortDeadlineError)

    const retried = await nihReporterSource.run(query, {
      fetchImpl: fetchSequence([
        jsonResponse({}, { status: 429 }),
        jsonResponse({}, { status: 503 }),
        jsonResponse(jsonFixture('nih-projects-ok.json')),
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
      fetchImpl: async () => jsonResponse(jsonFixture('nih-projects-ok.json')),
      scheduler,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    await nihReporterSource.run(query, { httpClient, cacheTtlMs: 0 })
    await nihReporterSource.run(query, { httpClient, cacheTtlMs: 0 })
    expect(clock).toBeGreaterThanOrEqual(1_000)
  })

  it('degrades on HTTP errors and on API structure changes', async () => {
    await expect(nihReporterSource.run(query, {
      fetchImpl: async () => jsonResponse({}, { status: 400 }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceHttpError)
    await expect(nihReporterSource.run(query, {
      fetchImpl: async () => jsonResponse({ unexpected: true }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceStructureChangedError)
  })
})
