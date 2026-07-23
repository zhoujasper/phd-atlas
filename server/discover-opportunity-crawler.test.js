import { describe, expect, it } from 'vitest'
import {
  buildOpportunityListingUrls,
  crawlDiscoverOpportunitySource,
  crawlDiscoverOpportunitySources,
  isOpportunityDetailUrl,
  opportunityPolicyFingerprint,
} from './discover-opportunity-crawler.js'
import { DISCOVER_OPPORTUNITY_SOURCES } from './discover-opportunity-sources.js'

function source(overrides = {}) {
  return {
    id: 'test-portal', name: 'Test Portal', school: 'Test Portal', region: 'GLOBAL',
    authority: 'lead-only', url: 'https://portal.example/jobs?field=ai',
    allowedHosts: ['portal.example'], seeds: [{ kind: 'doctoral', url: 'https://portal.example/jobs?field=ai' }],
    pathHints: { faculty: [], lab: [], department: [], program: ['/jobs', '/job/'] },
    queryHints: { strategy: 'query' },
    pagination: { strategy: 'query', parameter: 'page', firstValue: 1 },
    detail: { pathPatterns: ['^/job/\\d+$'], outboundOfficialLinkRequired: true },
    dataAccess: { mode: 'html', useApi: false, apiEndpoint: null },
    crawlPolicy: { enabled: true, followSitemaps: false, maxPages: 9, crawlDelayMs: 0 },
    evidencePolicy: { canVerifyApplicationFact: false },
    ...overrides,
  }
}

describe('bounded opportunity portal executor', () => {
  it('constructs query, zero-based, path and offset pagination but never exceeds two list pages', () => {
    expect(buildOpportunityListingUrls(source())).toEqual([
      'https://portal.example/jobs?field=ai',
      'https://portal.example/jobs?field=ai&page=2',
    ])
    expect(buildOpportunityListingUrls(source({
      pagination: { strategy: 'zero-based-query', parameter: 'page', firstValue: 0 },
    }))[1]).toBe('https://portal.example/jobs?field=ai&page=1')
    expect(buildOpportunityListingUrls(source({
      url: 'https://portal.example/search/phd/',
      pagination: { strategy: 'path', template: '/search/phd/page/{page}/', firstValue: 1 },
    }))[1]).toBe('https://portal.example/search/phd/page/2/')
    expect(buildOpportunityListingUrls(source({
      pagination: {
        strategy: 'one-based-offset', parameter: 'startIndex', pageSizeParameter: 'pageSize',
        firstValue: 1, verifiedExample: 'startIndex=26&pageSize=25',
      },
    }))[1]).toBe('https://portal.example/jobs?field=ai&startIndex=26&pageSize=25')
  })

  it('does not guess fragment tokens or an undocumented client load-more endpoint', () => {
    expect(buildOpportunityListingUrls(source({
      pagination: { strategy: 'html-fragment', discoveredPattern: '/jobboard/{token}/more_items' },
    }))).toHaveLength(1)
    expect(buildOpportunityListingUrls(source({
      pagination: { strategy: 'client-load-more', endpoint: null, endpointDiscovery: 'runtime-only' },
    }))).toHaveLength(1)
  })

  it('changes the checkpoint fingerprint whenever crawl permission or detail policy changes', () => {
    const baseline = source()
    expect(opportunityPolicyFingerprint(baseline)).toBe(opportunityPolicyFingerprint(source()))
    expect(opportunityPolicyFingerprint(source({
      crawlPolicy: { ...baseline.crawlPolicy, enabled: false },
    }))).not.toBe(opportunityPolicyFingerprint(baseline))
    expect(opportunityPolicyFingerprint(source({
      detail: { ...baseline.detail, pathPatterns: ['^/vacancy/\\d+$'] },
    }))).not.toBe(opportunityPolicyFingerprint(baseline))
  })

  it('fetches two list pages and at most four same-domain detail pages, reporting detail failures as partial', async () => {
    const requests = []
    const fetchImpl = async (value) => {
      const url = new URL(value)
      requests.push(url.toString())
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url.pathname === '/jobs') {
        const offset = url.searchParams.get('page') === '2' ? 3 : 1
        return new Response([
          '<html><head><title>PhD jobs</title></head><body>',
          ...Array.from({ length: 3 }, (_, index) => `<a href="/job/${offset + index}">Record ${offset + index}</a>`),
          '</body></html>',
        ].join(''), { status: 200, headers: { 'content-type': 'text/html' } })
      }
      if (url.pathname === '/job/4') return new Response('edge blocked', { status: 403 })
      if (/^\/job\/\d+$/.test(url.pathname)) {
        return new Response(`<html><title>Detail ${url.pathname}</title><body>Doctoral vacancy</body></html>`, {
          status: 200, headers: { 'content-type': 'text/html' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    const result = await crawlDiscoverOpportunitySource(source(), { fetchImpl })
    expect(requests).toEqual(expect.arrayContaining([
      'https://portal.example/jobs?field=ai',
      'https://portal.example/jobs?field=ai&page=2',
      'https://portal.example/job/1',
      'https://portal.example/job/4',
    ]))
    expect(requests).not.toContain('https://portal.example/job/5')
    expect(requests).not.toContain('https://portal.example/job/6')
    expect(result.health).toMatchObject({
      status: 'partial', plannedListingPageCount: 2,
      fetchedListingPageCount: 2, attemptedDetailPageCount: 4, fetchedDetailPageCount: 3,
      authority: 'lead-only', canVerifyApplicationFact: false,
    })
    expect(result.pages.every((page) => page.authority === 'lead-only' && page.canVerifyApplicationFact === false)).toBe(true)
    expect(isOpportunityDetailUrl(source(), 'https://portal.example/job/42?tracking=x#top')).toBe(true)
    expect(isOpportunityDetailUrl(source(), 'https://evil.example/job/42')).toBe(false)
  })

  it('keeps every policy-disabled source visible while issuing exactly zero requests', async () => {
    const disabled = DISCOVER_OPPORTUNITY_SOURCES.filter((item) => item.crawlPolicy.enabled === false)
    let requests = 0
    const results = await crawlDiscoverOpportunitySources({
      sources: disabled,
      fetchImpl: async () => { requests += 1; return new Response('must not run') },
    })
    expect(disabled.length).toBeGreaterThan(0)
    expect(requests).toBe(0)
    expect(results).toHaveLength(disabled.length)
    expect(results.every((result) => result.health.status === 'blocked')).toBe(true)
    expect(results.every((result) => result.health.authority === 'lead-only')).toBe(true)
    expect(results.every((result) => result.health.canVerifyApplicationFact === false)).toBe(true)
  })
})
