import { describe, expect, it } from 'vitest'
import { AbortDeadlineError } from '../abortDeadline.js'
import { SourceHttpError, SourceStructureChangedError } from './sourceErrors.js'
import {
  buildNsfAwardsUrl,
  nsfAwardsSource,
  parseNsfAwardsResponse,
} from './nsfAwards.js'
import { createSourceHttpClient, createOriginScheduler } from './sourceHttpClient.js'
import {
  fetchSequence,
  jsonFixture,
  jsonResponse,
  neverSettlingFetch,
} from './adapterTestSupport.js'

const query = { keyword: 'active learning', limit: 25 }

describe('NSF Award adapter', () => {
  it('builds a documented API URL and parses a deterministic fixture', () => {
    const url = buildNsfAwardsUrl({ keyword: 'active learning', activeAwards: true })
    expect(url.searchParams.get('keyword')).toBe('active learning')
    expect(url.searchParams.get('ActiveAwards')).toBe('true')
    expect(url.searchParams.get('rpp')).toBe('25')

    const records = parseNsfAwardsResponse(jsonFixture('nsf-awards-ok.json'), {
      sourceUrl: url.toString(),
      fetchedAt: '2026-08-03T00:00:00.000Z',
    })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'nsf:award',
      sourceId: 'nsf-awards',
      confidence: 1,
      value: {
        id: '2043098',
        title: 'Collaborative Research: Mechanisms of Active Learning',
        piName: 'Ada Turing',
        activeAwd: true,
      },
    })
  })

  it('fetches through the adapter and keeps provenance on every record', async () => {
    const fetchImpl = fetchSequence([jsonResponse(jsonFixture('nsf-awards-ok.json'))])
    const result = await nsfAwardsSource.run(query, {
      fetchImpl,
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    })
    expect(result.status).toBe('ok')
    // Provenance leads with the public award page a person can read; the API
    // endpoint the row was parsed from stays available alongside it.
    expect(result.records[0].sourceUrl).toContain('nsf.gov/awardsearch/showAward')
    expect(result.records[0].apiUrl).toContain('api.nsf.gov')
    expect(result.records[0].fetchedAt).toBeTruthy()
  })

  it('returns nothing rather than the newest awards when the query constrains nothing', async () => {
    // NSF drops an unmatched keyword and answers with its newest awards, so an
    // unconstrained request comes back full of records nobody asked about.
    let calls = 0
    const result = await nsfAwardsSource.run({}, {
      fetchImpl: async () => {
        calls += 1
        return jsonResponse(jsonFixture('nsf-awards-ok.json'))
      },
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    })
    expect(result.records).toEqual([])
    expect(result.meta.unbounded).toBe(true)
    expect(calls).toBe(0)
  })

  it('times out, retries 429/503, and limits request spacing through the adapter path', async () => {
    await expect(nsfAwardsSource.run(query, {
      fetchImpl: neverSettlingFetch(),
      timeoutMs: 10,
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(AbortDeadlineError)

    const retryFetch = fetchSequence([
      jsonResponse({}, { status: 429 }),
      jsonResponse({}, { status: 503 }),
      jsonResponse(jsonFixture('nsf-awards-ok.json')),
    ])
    const retried = await nsfAwardsSource.run(query, {
      fetchImpl: retryFetch,
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
      fetchImpl: async () => jsonResponse(jsonFixture('nsf-awards-ok.json')),
      scheduler,
      now: () => clock,
      delayFn: async (milliseconds) => {
        clock += milliseconds
      },
    })
    await nsfAwardsSource.run(query, { httpClient, cacheTtlMs: 0 })
    await nsfAwardsSource.run(query, { httpClient, cacheTtlMs: 0 })
    expect(clock).toBeGreaterThanOrEqual(1_000)
  })

  it('degrades on HTTP errors and on API structure changes', async () => {
    await expect(nsfAwardsSource.run(query, {
      fetchImpl: async () => jsonResponse({}, { status: 400 }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceHttpError)
    await expect(nsfAwardsSource.run(query, {
      fetchImpl: async () => jsonResponse({ response: { unexpected: true } }),
      retry: { maxAttempts: 1 },
    })).rejects.toBeInstanceOf(SourceStructureChangedError)
  })
})
