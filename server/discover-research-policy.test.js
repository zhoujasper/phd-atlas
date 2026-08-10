import { describe, expect, it } from 'vitest'
import {
  DISCOVER_RESEARCH_FUNNEL_LIMITS,
  collectFinalFetchedEvidenceUrls,
  collectPhaseEvidenceUrls,
  createAiKeyRoundRobin,
  discoverAgentConcurrency,
  compactScholarlyEvidenceForAgent,
  discoverCrawlConcurrency,
  dedupeDiscoverPrograms,
  DISCOVER_AGENT_BATCH_SIZES,
  discoverAdvisorAgentMaxTokens,
  discoverCandidateHydrationLimits,
  discoverDynamicSourceLimit,
  discoverOfficialProgramLeadLimit,
  discoverReasoningEffortForRole,
  discoverResearchCrawlLimit,
  deterministicProgramsFromOfficialLeads,
  isRetryableDiscoverAgentError,
  mergeDiscoverResearchSources,
  uniqueUrls,
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

  it('crawls the whole finite scoped source set regardless of legacy result counts', () => {
    expect(discoverResearchCrawlLimit(145, 5)).toBe(145)
    expect(discoverResearchCrawlLimit(145, 20)).toBe(145)
    expect(discoverResearchCrawlLimit(145, 100)).toBe(145)
    expect(discoverResearchCrawlLimit(12, 20)).toBe(12)
    expect(discoverResearchCrawlLimit(700, 20)).toBe(640)
  })

  it('keeps discovery and deep hydration evidence-exhaustive within internal safety ceilings', () => {
    expect(discoverDynamicSourceLimit(5)).toBe(192)
    expect(discoverDynamicSourceLimit(20)).toBe(192)
    expect(discoverDynamicSourceLimit(100)).toBe(192)
    expect(discoverCandidateHydrationLimits(120, 20)).toEqual({
      schoolLimit: 120,
      perSchool: 3,
      totalLimit: 360,
    })
    expect(discoverCandidateHydrationLimits(12, 20)).toEqual({
      schoolLimit: 12,
      perSchool: 3,
      totalLimit: 36,
    })
    expect(discoverOfficialProgramLeadLimit(5)).toBe(2_000)
    expect(discoverOfficialProgramLeadLimit(20)).toBe(2_000)
    expect(discoverOfficialProgramLeadLimit(100)).toBe(2_000)
  })

  it('merges same-school evaluation seeds into the maintained source adapter', () => {
    const [source] = mergeDiscoverResearchSources([
      {
        region: 'UK',
        school: 'Example University',
        url: 'https://www.example.edu/',
        allowedHosts: ['www.example.edu'],
        seeds: [{ kind: 'program', url: 'https://www.example.edu/phd' }],
        pathHints: { program: ['/phd'] },
      },
      {
        region: 'UK',
        school: 'Example University',
        url: 'https://www.example.edu/',
        allowedHosts: ['profiles.example.edu'],
        seeds: [
          { kind: 'program', url: 'https://www.example.edu/phd' },
          { kind: 'advisor', url: 'https://profiles.example.edu/ada' },
        ],
        pathHints: { advisor: ['/ada'] },
        crawlPolicy: { maxPages: 24, followSitemaps: true },
        sourceProvenance: 'independent-official-gold-evaluation',
      },
    ])

    expect(source).toMatchObject({
      url: 'https://www.example.edu/',
      allowedHosts: ['www.example.edu', 'profiles.example.edu'],
      crawlPolicy: { maxPages: 24, followSitemaps: true },
    })
    expect(source.seeds).toHaveLength(2)
    expect(source.pathHints).toEqual({ program: ['/phd'], advisor: ['/ada'] })
  })

  it('retains only fetched official seeds or doctoral titles matching the applicant field', () => {
    const rows = deterministicProgramsFromOfficialLeads([
      {
        region: 'EU', school: 'Example', candidateLabel: 'Neuroscience PhD',
        officialUrl: 'https://example.edu/neuro-phd', matchedFieldTerms: [],
        evidence: { fetched: true, official: true, declarationBasis: 'source-doctoral-seed' },
      },
      {
        region: 'EU', school: 'Example', candidateLabel: 'Computational Neuroscience PhD',
        officialUrl: 'https://example.edu/comp-neuro-phd', matchedFieldTerms: ['computational neuroscience'],
        evidence: { fetched: true, official: true, declarationBasis: 'dual-page-signals' },
      },
      {
        region: 'EU', school: 'Example', candidateLabel: 'Unrelated PhD',
        officialUrl: 'https://example.edu/unrelated', matchedFieldTerms: [],
        evidence: { fetched: true, official: true, declarationBasis: 'dual-page-signals' },
      },
      {
        region: 'EU', school: 'Example', candidateLabel: 'Unfetched Neuroscience PhD',
        officialUrl: 'https://example.edu/unfetched', matchedFieldTerms: ['neuroscience'],
        evidence: { fetched: false, official: true, declarationBasis: 'source-doctoral-seed' },
      },
    ])

    expect(rows.map((row) => row.website)).toEqual([
      'https://example.edu/neuro-phd',
      'https://example.edu/comp-neuro-phd',
    ])
  })

  it('round-robins multiple saved AI keys across independent agent batches', () => {
    const next = createAiKeyRoundRobin([{ id: 'k1' }, { id: 'k2' }])
    expect([next().id, next().id, next().id, next().id]).toEqual(['k1', 'k2', 'k1', 'k2'])
  })

  it('weights research batches independently from concurrency and skips disabled keys', () => {
    const next = createAiKeyRoundRobin([
      { id: 'preferred', weight: 75, maxConcurrency: 1 },
      { id: 'fallback', weight: 25, maxConcurrency: 100 },
      { id: 'paused', weight: 100, maxConcurrency: 100, enabled: false },
    ])
    expect([next().id, next().id, next().id, next().id]).toEqual([
      'preferred',
      'fallback',
      'preferred',
      'preferred',
    ])
    expect(discoverAgentConcurrency([{ maxConcurrency: 2_500 }])).toBe(2_500)
    expect(discoverAgentConcurrency([{ maxConcurrency: 2_000 }, { maxConcurrency: 1_000 }])).toBe(2_500)
    expect(discoverAgentConcurrency([{ maxConcurrency: 2_500, enabled: false }], 2)).toBe(2)
  })

  it('keeps the broad scholarly pool while bounding each AI agent payload', () => {
    const evidence = {
      provider: 'openalex+ror+crossref',
      status: 'ok',
      candidateResearchers: Array.from({ length: 120 }, (_, index) => ({
        name: `Researcher ${index}`,
        matchedQueries: Array.from({ length: 12 }, (__, queryIndex) => `query-${queryIndex}`),
        recentWorks: Array.from({ length: 6 }, (__, workIndex) => ({ title: `Work ${workIndex}` })),
        internalOnly: 'discard',
      })),
    }

    const compact = compactScholarlyEvidenceForAgent(evidence, 6)
    expect(compact.candidateResearchers).toHaveLength(48)
    expect(compact.candidateResearchers[0].matchedQueries).toHaveLength(8)
    expect(compact.candidateResearchers[0].recentWorks).toHaveLength(4)
    expect(compact.candidateResearchers[0]).not.toHaveProperty('internalOnly')

    const named = compactScholarlyEvidenceForAgent(evidence, 500, ['Researcher 7'])
    expect(named.candidateResearchers.map((item) => item.name)).toEqual(['Researcher 7'])
  })

  it('gives each programme its own advisor and independent verification tasks', () => {
    expect(DISCOVER_AGENT_BATCH_SIZES).toMatchObject({ advisor: 1, verification: 1 })
    expect(discoverAdvisorAgentMaxTokens(6)).toBe(6_000)
    expect(discoverAdvisorAgentMaxTokens(10)).toBe(8_000)
    expect(discoverAdvisorAgentMaxTokens(20)).toBe(8_000)
  })

  it('uses maximum reasoning for every gpt-5.6-luna research role', () => {
    for (const role of ['planner', 'program', 'advisor', 'verifier']) {
      expect(discoverReasoningEffortForRole({ model: 'gpt-5.6-luna' }, role)).toBe('max')
      expect(discoverReasoningEffortForRole({ model: 'deepseek-v4-flash' }, role)).toBe('max')
    }
    expect(discoverReasoningEffortForRole({ model: 'gpt-5.6-luna' }, 'unknown')).toBe(null)
    expect(discoverReasoningEffortForRole({ model: 'other-model' }, 'advisor')).toBe(null)
  })

  it('makes every funnel gate deterministic and keeps non-advisor ceilings conservative', () => {
    expect(DISCOVER_RESEARCH_FUNNEL_LIMITS).toMatchObject({
      advisorAgentMaxTokens: { floor: 6_000, ceiling: 8_000, perAdvisor: 800 },
      crawlConcurrency: { default: 6, max: 8 },
      crawlSources: { max: 640 },
      dynamicSources: { max: 192 },
      candidateHydration: { maxSchools: 640, perSchool: 3, maxLinks: 1_920 },
      officialProgramLeads: { max: 2_000 },
      scholarlyEvidence: { researcherMin: 24, researcherMax: 500, perAdvisor: 8, recentWorks: 20 },
      evidenceUrls: 20,
      mergedPrograms: 2_000,
      searchDomains: 100,
    })
    expect(discoverCrawlConcurrency('5')).toBe(5)
    expect(discoverCrawlConcurrency('0')).toBe(6)
    expect(discoverCrawlConcurrency('99')).toBe(8)
    expect(uniqueUrls(Array.from(
      { length: 25 },
      (_, index) => `https://example-${index}.edu/page`,
    ))).toHaveLength(20)
    expect(webSearchDomainsForSources(Array.from(
      { length: 145 },
      (_, index) => `https://university-${index}.edu`,
    ))).toHaveLength(100)
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
