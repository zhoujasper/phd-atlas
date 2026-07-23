import { describe, expect, it } from 'vitest'
import {
  collectFinalFetchedEvidenceUrls,
  collectPhaseEvidenceUrls,
  createAiKeyRoundRobin,
  dedupeDiscoverPrograms,
  DISCOVER_AGENT_BATCH_SIZES,
  discoverAdvisorAgentMaxTokens,
  discoverResearchCrawlLimit,
  isRetryableDiscoverAgentError,
  webSearchDomainsForSources,
} from './discover-research.js'

describe('Discover multi-agent research policy', () => {
  it('keeps unfetched crawler links as leads rather than trusted evidence', () => {
    const fetched = 'https://example.edu/programs/phd'
    const candidateOnly = 'https://example.edu/people/unfetched-person'
    const cited = 'https://example.edu/people/cited-person'
    const urls = collectPhaseEvidenceUrls({
      crawlerEvidence: [{
        officialUrl: 'https://example.edu/',
        pages: [{ url: fetched, fetched: true }],
        advisorPages: [{ url: candidateOnly, fetched: false }],
      }],
      completionSources: [cited],
    })

    expect(urls).toContain(fetched)
    expect(urls).toContain(cited)
    expect(urls).not.toContain(candidateOnly)
  })

  it('does not let a later agent self-certify prior PI or fact URLs', () => {
    const program = 'https://example.edu/graduate/phd'
    const urls = collectPhaseEvidenceUrls({
      candidates: [{
        website: program,
        sources: [program],
        pis: [{ url: 'https://example.edu/people/unverified' }],
        factSources: { funding: 'https://example.edu/funding/unverified' },
        rankingSources: ['https://topuniversities.com/unverified'],
        scholarships: [{ url: 'https://example.edu/scholarships/unverified' }],
      }],
    })

    expect(urls).toEqual([program])
  })

  it('lets only server-fetched pages support the final persisted decision set', () => {
    const fetchedProgram = 'https://example.edu/programs/phd'
    const fetchedAdvisor = 'https://example.edu/people/fetched-person'
    const candidateOnly = 'https://example.edu/people/candidate-only'
    const urls = collectFinalFetchedEvidenceUrls({
      schools: [{
        officialUrl: 'https://example.edu/',
        pages: [
          { url: fetchedProgram, fetched: true },
          { url: candidateOnly, fetched: false },
        ],
        advisorPages: [
          { url: fetchedAdvisor, fetched: true },
          { url: candidateOnly, fetched: false },
        ],
      }],
    })

    expect(urls).toEqual([fetchedProgram, fetchedAdvisor])
    expect(urls).not.toContain('https://example.edu/')
    expect(urls).not.toContain(candidateOnly)
  })

  it('never trusts a fetched page flagged as prompt injection evidence', () => {
    const poisoned = 'https://example.edu/programs/poisoned-phd'
    const clean = 'https://example.edu/programs/clean-phd'
    const sourceIndex = {
      schools: [{
        pages: [
          { url: poisoned, fetched: true, promptInjectionSuspected: true },
          { url: clean, fetched: true, promptInjectionSuspected: false },
        ],
      }],
    }

    expect(collectFinalFetchedEvidenceUrls(sourceIndex)).toEqual([clean])
    expect(collectPhaseEvidenceUrls({ crawlerEvidence: sourceIndex.schools })).toEqual([clean])
  })

  it('keeps 145-school adapter coverage independent from per-run crawl size', () => {
    expect(discoverResearchCrawlLimit(145, 5)).toBe(24)
    expect(discoverResearchCrawlLimit(145, 20)).toBe(60)
    expect(discoverResearchCrawlLimit(145, 100)).toBe(72)
    expect(discoverResearchCrawlLimit(12, 20)).toBe(12)
  })

  it('round-robins multiple saved AI keys across independent agent batches', () => {
    const next = createAiKeyRoundRobin([{ id: 'k1' }, { id: 'k2' }])
    expect([next().id, next().id, next().id, next().id]).toEqual(['k1', 'k2', 'k1', 'k2'])
  })

  it('gives each programme its own advisor task and scales the output budget to the requested PI count', () => {
    expect(DISCOVER_AGENT_BATCH_SIZES).toMatchObject({ advisor: 1, verification: 5 })
    expect(discoverAdvisorAgentMaxTokens(6)).toBe(3_500)
    expect(discoverAdvisorAgentMaxTokens(10)).toBe(5_500)
    expect(discoverAdvisorAgentMaxTokens(20)).toBe(8_000)
  })

  it('retries only transient provider failures during long research batches', () => {
    expect(isRetryableDiscoverAgentError({ code: 'PROVIDER_TIMEOUT' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'PROVIDER_UNAVAILABLE' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'PROVIDER_REJECTED' })).toBe(false)
    expect(isRetryableDiscoverAgentError({ code: 'EMPTY_DRAFT' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'AI_RESPONSE_INVALID' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'AI_RESPONSE_SCHEMA_INVALID' })).toBe(true)
  })

  it('deduplicates repeated model rows that resolve to one official programme URL', () => {
    const rows = dedupeDiscoverPrograms([
      { id: 'first', school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'], pis: [] },
      { id: 'second', school: 'Example University', website: 'https://example.edu/phd/', sources: ['https://example.edu/phd/'], pis: [{ name: 'Ada', url: 'https://example.edu/people/ada' }] },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'second', pis: [{ name: 'Ada' }] })
  })

  it('deduplicates www and tracking-query variants of the same programme URL', () => {
    const rows = dedupeDiscoverPrograms([
      { id: 'plain', school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'], pis: [] },
      { id: 'tracked', school: 'Example University', website: 'https://www.example.edu/phd/?utm_source=search&fbclid=abc', sources: ['https://www.example.edu/phd/?utm_source=search'], pis: [] },
    ])

    expect(rows).toHaveLength(1)
  })

  it('collapses curated school subdomains to the bounded search root', () => {
    expect(webSearchDomainsForSources([{
      url: 'https://www.mit.edu/',
      allowedHosts: ['eecs.mit.edu', 'csail.mit.edu'],
    }])).toEqual(['mit.edu'])
  })
})
