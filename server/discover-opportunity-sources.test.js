import { describe, expect, it } from 'vitest'
import {
  DISCOVER_OPPORTUNITY_SOURCES,
  listDiscoverOpportunitySources,
  summarizeOpportunitySourceHealth,
} from './discover-opportunity-sources.js'
import { allowsDiscoverCrawl, crawlDiscoverSource } from './discover-source-crawler.js'
import { groundDiscoverPrograms } from './discover-source-grounding.js'

describe('Discover opportunity lead sources', () => {
  it('includes the requested multi-source portals and marks every one lead-only', () => {
    const names = DISCOVER_OPPORTUNITY_SOURCES.map((source) => source.name)
    expect(names).toEqual(expect.arrayContaining([
      'AcademicPositions', 'EURAXESS', 'ScholarshipDB', 'jobvector Doktorand', 'PhDFinder', 'Max Planck Jobboard',
    ]))
    expect(DISCOVER_OPPORTUNITY_SOURCES.length).toBeGreaterThanOrEqual(10)
    expect(DISCOVER_OPPORTUNITY_SOURCES.every((source) => source.authority === 'lead-only')).toBe(true)
    expect(DISCOVER_OPPORTUNITY_SOURCES.every((source) => source.evidencePolicy.canVerifyApplicationFact === false)).toBe(true)
  })

  it('ships a deep adapter contract for queries, details, pagination, and live policy health', () => {
    for (const source of DISCOVER_OPPORTUNITY_SOURCES) {
      expect(source.id).toMatch(/^[a-z0-9-]+$/)
      expect(source.url).toMatch(/^https:\/\//)
      expect(source.seeds).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'doctoral', url: source.url }),
      ]))
      expect(source.pathHints.program.length).toBeGreaterThan(0)
      expect(source.queryHints.strategy).toBeTruthy()
      expect(source.pagination.strategy).toBeTruthy()
      expect(source.detail.pathPatterns.length).toBeGreaterThan(0)
      expect(source.detail.outboundOfficialLinkRequired).toBe(true)
      expect(source.dataAccess.mode).toBeTruthy()
      expect(source.dataAccess.useApi).toBe(false)
      expect(source.policyUrls.robots).toMatch(/^https:\/\/[^/]+\/robots\.txt$/)
      expect(source.crawlPolicy.checkedAt).toBe('2026-07-22')
      expect(source.crawlPolicy.robots).not.toBe('unknown')
      expect(Object.isFrozen(source)).toBe(true)
      expect(Object.isFrozen(source.crawlPolicy)).toBe(true)
    }
  })

  it('keeps policy-blocked portals visible while excluding them from direct-crawl execution', () => {
    const blockedIds = DISCOVER_OPPORTUNITY_SOURCES
      .filter((source) => !source.crawlPolicy.enabled)
      .map((source) => source.id)
    expect(blockedIds).toEqual(expect.arrayContaining([
      'euraxess', 'scholarshipdb', 'jobvector-doktorand', 'findaphd',
    ]))
    expect(listDiscoverOpportunitySources()).toHaveLength(DISCOVER_OPPORTUNITY_SOURCES.length)
    expect(listDiscoverOpportunitySources({ includePolicyBlocked: false }).every((source) => source.crawlPolicy.enabled)).toBe(true)
    expect(DISCOVER_OPPORTUNITY_SOURCES.find((source) => source.id === 'euraxess')?.crawlPolicy.reason).toBe('robots-disallow-/jobs/*')
    expect(DISCOVER_OPPORTUNITY_SOURCES.find((source) => source.id === 'academictransfer')?.crawlPolicy.crawlDelayMs).toBe(10_000)
    expect(DISCOVER_OPPORTUNITY_SOURCES.find((source) => source.id === 'phdfinder')?.crawlPolicy.contentSignals).toContain('use=reference')
    expect(DISCOVER_OPPORTUNITY_SOURCES.find((source) => source.id === 'daad-phdgermany')?.dataAccess.publicFeed).toMatch(/^https:\/\/api\.daad\.de\//)
    expect(DISCOVER_OPPORTUNITY_SOURCES.find((source) => source.id === 'euraxess')?.dataAccess.note).toContain('*/api/*')
  })

  it('does not issue a network request for a source disabled by robots or access policy', async () => {
    const source = DISCOVER_OPPORTUNITY_SOURCES.find((candidate) => candidate.id === 'euraxess')
    let requests = 0
    const result = await crawlDiscoverSource(source, {
      fetchImpl: async () => {
        requests += 1
        return new Response('<title>Should not be fetched</title>', { status: 200 })
      },
    })
    expect(requests).toBe(0)
    expect(result).toMatchObject({
      skipped: 'blocked',
      health: { status: 'blocked', policyReason: 'robots-disallow-/jobs/*' },
    })
  })

  it('understands wildcard robots rules before allowing portal paths', () => {
    const euraxessStyle = 'User-agent: *\nDisallow: /jobs/*\nAllow: /jobs'
    expect(allowsDiscoverCrawl(euraxessStyle, '/jobs')).toBe(true)
    expect(allowsDiscoverCrawl(euraxessStyle, '/jobs/search')).toBe(false)
    expect(allowsDiscoverCrawl('User-agent: *\nDisallow: /*?private=*$', '/jobs?private=yes')).toBe(false)
  })

  it('reports a newly robots-denied enabled source as blocked, not unavailable', async () => {
    const source = {
      id: 'policy-change-example',
      name: 'Policy change example',
      school: 'Policy change example',
      region: 'GLOBAL',
      url: 'https://portal.example/jobs/search',
      allowedHosts: ['portal.example'],
      seeds: [{ kind: 'doctoral', url: 'https://portal.example/jobs/search' }],
      crawlPolicy: { enabled: true, followSitemaps: false },
    }
    const requested = []
    const result = await crawlDiscoverSource(source, {
      fetchImpl: async (url) => {
        requested.push(url)
        if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /jobs/*', { status: 200 })
        return new Response('<title>Must not be fetched</title>', { status: 200 })
      },
    })
    expect(requested).toEqual(['https://portal.example/robots.txt'])
    expect(result).toMatchObject({
      skipped: 'blocked',
      health: {
        status: 'blocked',
        policyReason: 'robots-disallow',
        robotsDenied: ['https://portal.example/jobs/search'],
      },
    })
  })

  it('records blocked portal health instead of pretending the crawl succeeded', () => {
    expect(summarizeOpportunitySourceHealth([{
      source: DISCOVER_OPPORTUNITY_SOURCES[0],
      pages: [],
      candidatePages: [],
      skipped: 'blocked',
      health: { status: 'blocked', attemptedAt: '2026-07-22T00:00:00.000Z', httpFailures: [403] },
    }])[0]).toMatchObject({
      id: 'academicpositions',
      status: 'blocked',
      fetchedPageCount: 0,
      httpFailures: [403],
      robots: 'allowed-for-search-reference',
      accessMode: 'direct-crawl',
    })
  })

  it('cannot use any portal-only URL as official programme evidence', () => {
    const sourceIndex = {
      schools: [{ school: 'Example University', region: 'US', officialUrl: 'https://example.edu/', advisorPages: [] }],
    }
    const portalRows = DISCOVER_OPPORTUNITY_SOURCES.map((source) => ({
      id: `portal-only-${source.id}`,
      school: 'Example University',
      program: 'Computer Science PhD',
      website: source.url,
      sources: [source.url],
    }))
    const result = groundDiscoverPrograms(portalRows, sourceIndex)
    expect(result.programs).toEqual([])
    expect(result.rejected).toHaveLength(DISCOVER_OPPORTUNITY_SOURCES.length)
    expect(result.rejected.every((row) => row.reason === 'no-program-specific-official-source')).toBe(true)
  })
})
