/**
 * Opportunity portals are candidate-lead indexes only. A portal record can
 * suggest a university or vacancy to investigate, but it can never satisfy
 * the same-institution official-evidence gate in discover-source-grounding.js.
 *
 * `crawlPolicy` is deliberately explicit. Some portals permit search/reference
 * crawling, some expose only server-rendered first pages, and some currently
 * block or disallow our crawler. Disabled sources remain in the registry so a
 * health report explains the gap instead of silently pretending coverage.
 */

const POLICY_CHECKED_AT = '2026-07-22'

function freezeList(values = []) {
  return Object.freeze([...values])
}

function freezeRecord(value = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (Array.isArray(item)) return [key, freezeList(item)]
    if (item && typeof item === 'object') return [key, freezeRecord(item)]
    return [key, item]
  })))
}

function defineOpportunitySource(config) {
  const url = new URL(config.url)
  return freezeRecord({
    ...config,
    school: config.name,
    region: 'GLOBAL',
    authority: 'lead-only',
    evidencePolicy: {
      canVerifyApplicationFact: false,
      nextStep: 'resolve-employer-and-verify-on-same-institution-official-domain',
    },
    crawlPolicy: { followSitemaps: false, ...config.crawlPolicy },
    dataAccess: config.dataAccess || { mode: 'html', useApi: false, apiEndpoint: null },
    policyUrls: {
      robots: new URL('/robots.txt', url.origin).toString(),
      terms: config.termsUrl || null,
    },
    allowedHosts: config.allowedHosts || [url.hostname.toLowerCase().replace(/^www\./, '')],
    seeds: config.seeds || [{ kind: 'doctoral', url: config.url }],
  })
}

export const DISCOVER_OPPORTUNITY_SOURCES = freezeList([
  defineOpportunitySource({
    id: 'academicpositions',
    name: 'AcademicPositions',
    url: 'https://academicpositions.com/jobs/position/phd',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/jobs/position/phd', '/ad/', 'doctoral', 'phd', 'studentship'],
    },
    queryHints: {
      strategy: 'path-facets',
      allDoctoral: '/jobs/position/phd',
      fieldTemplate: '/jobs/position/phd/field/{fieldSlug}',
      countryTemplate: '/jobs/position/phd/country/{countrySlug}',
    },
    pagination: { strategy: 'query', parameter: 'page', firstValue: 1, verifiedExample: '?page=2' },
    detail: { pathPatterns: ['^/ad/[^/]+/\\d+/[^/]+/\\d+$'], outboundOfficialLinkRequired: true },
    crawlPolicy: {
      enabled: true,
      robots: 'allowed-for-search-reference',
      contentSignals: 'search=yes,ai-train=no',
      rendering: 'static-html',
      crawlDelayMs: 1_000,
      maxPages: 3,
      probe: 'http-403-anti-bot',
      checkedAt: POLICY_CHECKED_AT,
      note: 'Robots permits generic search/reference access; the live crawler probe was denied by edge protection, so health must remain blocked when that recurs.',
    },
  }),
  defineOpportunitySource({
    id: 'euraxess',
    name: 'EURAXESS',
    url: 'https://euraxess.ec.europa.eu/jobs/search',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/jobs/search', '/jobs/', 'phd positions', 'first stage researcher'],
    },
    queryHints: {
      strategy: 'drupal-query-facets',
      filterParameter: 'f[]',
      sortParameters: ['sort[name]', 'sort[direction]'],
      phdFacetLabel: 'PhD Positions',
    },
    pagination: { strategy: 'zero-based-query', parameter: 'page', firstValue: 0, verifiedExample: '?page=1' },
    detail: { pathPatterns: ['^/jobs/\\d+$'], outboundOfficialLinkRequired: true },
    dataAccess: {
      mode: 'html-disabled-by-robots',
      useApi: false,
      apiEndpoint: null,
      note: 'robots.txt also disallows */api/* and */rest/*; do not substitute those endpoints for the blocked HTML paths.',
    },
    crawlPolicy: {
      enabled: false,
      robots: 'disallowed',
      rendering: 'static-html',
      accessMode: 'search-index-only',
      reason: 'robots-disallow-/jobs/*',
      checkedAt: POLICY_CHECKED_AT,
      note: 'The public list is readable in a browser, but robots.txt explicitly disallows /jobs/*; PhD Atlas must not crawl the search or detail paths.',
    },
  }),
  defineOpportunitySource({
    id: 'scholarshipdb',
    name: 'ScholarshipDB',
    url: 'https://scholarshipdb.net/PhD-scholarships',
    allowedHosts: ['scholarshipdb.net'],
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['phd-scholarships', 'program-phd', 'research-job', 'scholarship'],
    },
    queryHints: {
      strategy: 'path-facets-plus-query',
      allDoctoral: '/PhD-scholarships',
      countryTemplate: '/PhD-scholarships-in-{countrySlug}',
      keywordParameter: 'r_q',
    },
    pagination: { strategy: 'query', parameter: 'page', firstValue: 1, verifiedExample: '?page=2' },
    detail: { pathPatterns: ['^/scholarship/[^/]+$', '^/job/[^/]+$'], outboundOfficialLinkRequired: true },
    dataAccess: { mode: 'search-index-only', useApi: false, apiEndpoint: null },
    crawlPolicy: {
      enabled: false,
      robots: 'unverified',
      rendering: 'static-search-index',
      accessMode: 'search-index-only',
      reason: 'tls-and-robots-probe-failed',
      checkedAt: POLICY_CHECKED_AT,
      note: 'Search indexes expose current listings, but the direct TLS handshake and robots probe failed in the production-like client. Do not bypass TLS or assume permission.',
    },
  }),
  defineOpportunitySource({
    id: 'jobvector-doktorand',
    name: 'jobvector Doktorand',
    url: 'https://www.jobvector.de/jobs/doktorand/',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/jobs/doktorand', '/job/', 'doktorand', 'promotion', 'phd'],
    },
    queryHints: {
      strategy: 'localized-path',
      allDoctoral: '/jobs/doktorand/',
      relatedLabels: ['doktorandenstelle', 'phd-kandidat'],
    },
    pagination: { strategy: 'site-managed', parameter: null, firstValue: 1 },
    detail: { pathPatterns: ['^/job/[^/]+/$'], outboundOfficialLinkRequired: true },
    dataAccess: { mode: 'search-index-only', useApi: false, apiEndpoint: null },
    crawlPolicy: {
      enabled: false,
      robots: 'unverified-http-403',
      rendering: 'static-html-behind-bot-protection',
      accessMode: 'search-index-only',
      reason: 'robots-and-list-probe-http-403',
      checkedAt: POLICY_CHECKED_AT,
      note: 'Both robots.txt and the list rejected the crawler. Keep only indexed lead discovery until the site publishes a usable policy or feed.',
    },
  }),
  defineOpportunitySource({
    id: 'phdfinder',
    name: 'PhDFinder',
    url: 'https://phdfinder.com/search/phd/',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/search/phd/', '/category/', '/20', 'phd-position', 'doctoral'],
    },
    queryHints: {
      strategy: 'wordpress-search-and-taxonomy',
      allDoctoral: '/search/phd/',
      categoryTemplate: '/category/{categorySlug}/',
    },
    pagination: { strategy: 'path', template: '/search/phd/page/{page}/', firstValue: 1, verifiedExample: '/search/phd/page/2/' },
    detail: { pathPatterns: ['^/\\d{4}/\\d{2}/\\d{2}/[^/]+/$'], outboundOfficialLinkRequired: true },
    termsUrl: 'https://phdfinder.com/terms-legal/',
    dataAccess: {
      mode: 'wordpress-html',
      useApi: false,
      apiEndpoint: null,
      note: 'No stable public opportunity API contract was verified; use the permitted server-rendered pages only.',
    },
    crawlPolicy: {
      enabled: true,
      robots: 'allowed-for-search-reference',
      contentSignals: 'search=yes,ai-train=no,use=reference',
      rendering: 'static-html',
      crawlDelayMs: 1_000,
      maxPages: 3,
      probe: 'http-200',
      checkedAt: POLICY_CHECKED_AT,
      note: 'The site identifies itself as an aggregator and tells users to verify every listing independently; portal claims remain leads only.',
    },
  }),
  defineOpportunitySource({
    id: 'max-planck-jobboard',
    name: 'Max Planck Jobboard',
    url: 'https://www.mpg.de/jobboard',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/jobboard', '/job-', 'phd-', 'doctoral', 'young researchers'],
    },
    queryHints: {
      strategy: 'html-filters',
      doctoralLabels: ['Young Researchers', 'PhD Student'],
      researchSubjectFilter: true,
      regionFilter: true,
    },
    pagination: { strategy: 'html-fragment', discoveredPattern: '/jobboard/{token}/more_items', firstValue: 1 },
    detail: { pathPatterns: ['^/\\d+/[^/]+$', '^/job-[a-f0-9]+$'], outboundOfficialLinkRequired: true },
    dataAccess: {
      mode: 'html-plus-fragment',
      useApi: false,
      apiEndpoint: null,
      fragmentPattern: '/jobboard/{token}/more_items',
    },
    crawlPolicy: {
      enabled: true,
      robots: 'allowed',
      rendering: 'static-html-with-load-more-fragment',
      crawlDelayMs: 1_000,
      maxPages: 3,
      probe: 'http-200',
      checkedAt: POLICY_CHECKED_AT,
      note: 'The board is on an official MPG domain, but this adapter is intentionally still lead-only; the linked institute/application page must verify the opportunity.',
    },
  }),
  defineOpportunitySource({
    id: 'findaphd',
    name: 'FindAPhD',
    url: 'https://www.findaphd.com/phds/',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/phds/', '/project/', 'phd', 'studentship'],
    },
    queryHints: {
      strategy: 'path-facets',
      allDoctoral: '/phds/',
      subjectTemplate: '/phds/{subjectSlug}/',
      filters: ['discipline', 'location', 'institution', 'phd-type', 'funding'],
    },
    pagination: { strategy: 'query', parameter: 'PG', firstValue: 1 },
    detail: { pathPatterns: ['^/phds/project/[^/]+/'], outboundOfficialLinkRequired: true },
    dataAccess: { mode: 'search-index-only', useApi: false, apiEndpoint: null },
    crawlPolicy: {
      enabled: false,
      robots: 'unverified-http-403',
      rendering: 'static-html-behind-bot-protection',
      accessMode: 'search-index-only',
      reason: 'robots-and-list-probe-http-403',
      checkedAt: POLICY_CHECKED_AT,
      note: 'The site rejected both policy and list probes for the crawler, so automated crawling is disabled rather than routed around its protection.',
    },
  }),
  defineOpportunitySource({
    id: 'jobs-ac-uk-phds',
    name: 'jobs.ac.uk',
    url: 'https://www.jobs.ac.uk/search/phds',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/search/phds', '/job/', 'phd', 'studentship'],
    },
    queryHints: {
      strategy: 'query-facets',
      doctoralFacet: 'jobTypeFacet[0]=phds',
      parameters: ['activeFacet', 'jobTypeFacet[0]', 'pageSize', 'sortOrder', 'startIndex'],
    },
    pagination: { strategy: 'one-based-offset', parameter: 'startIndex', pageSizeParameter: 'pageSize', firstValue: 1, verifiedExample: 'startIndex=26&pageSize=25' },
    detail: { pathPatterns: ['^/job/[A-Z0-9]+/[^/]+$'], outboundOfficialLinkRequired: true },
    crawlPolicy: {
      enabled: true,
      robots: 'allowed-except-feedback-and-enhanced-pages',
      rendering: 'static-html',
      crawlDelayMs: 1_000,
      maxPages: 3,
      probe: 'http-200-list-http-403-detail-observed',
      checkedAt: POLICY_CHECKED_AT,
      note: 'The list is readable and robots permits it, but detail requests may be edge-blocked; each failed detail remains a health failure, never a verified lead.',
    },
  }),
  defineOpportunitySource({
    id: 'daad-phdgermany',
    name: 'DAAD PhDGermany',
    url: 'https://www.daad.de/en/studying-in-germany/phd-studies-research/phd-germany/',
    allowedHosts: ['daad.de'],
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/phd-germany/', '/detail/', 'phd-id', 'phd-p'],
    },
    queryHints: {
      strategy: 'query-filters',
      filters: ['subject', 'working-language', 'funding-support', 'location', 'required-degree', 'type-of-promotion'],
      publicFeed: 'https://api.daad.de/api/feeds/rss/en/phd.xml',
    },
    pagination: { strategy: 'query', parameter: 'phd-p', firstValue: 1, verifiedExample: '?phd-p=2' },
    detail: { pathPatterns: ['^/en/studying-in-germany/phd-studies-research/phd-germany/detail/'], outboundOfficialLinkRequired: true },
    dataAccess: {
      mode: 'html-plus-public-rss',
      useApi: false,
      apiEndpoint: null,
      publicFeed: 'https://api.daad.de/api/feeds/rss/en/phd.xml',
      note: 'The generic HTML crawler does not parse RSS; this verified feed is metadata for a bounded specialized reader.',
    },
    crawlPolicy: {
      enabled: true,
      robots: 'allowed-on-phdgermany-path',
      rendering: 'static-html',
      crawlDelayMs: 1_000,
      maxPages: 3,
      probe: 'http-200',
      checkedAt: POLICY_CHECKED_AT,
      note: 'DAAD exposes server-rendered listings and a public RSS feed. The feed is metadata for a future specialized reader; the generic crawler stays on the declared HTTPS page seed.',
    },
  }),
  defineOpportunitySource({
    id: 'academictransfer',
    name: 'AcademicTransfer',
    url: 'https://www.academictransfer.com/en/jobs/',
    pathHints: {
      faculty: [], lab: [], department: [],
      program: ['/en/jobs/', '/phd-', '/engd-', 'doctoral', 'candidate'],
    },
    queryHints: {
      strategy: 'client-filters-over-ssr-results',
      allJobs: '/en/jobs/',
      doctoralKeywords: ['PhD', 'doctoral candidate', 'EngD'],
    },
    pagination: { strategy: 'client-load-more', initialServerRenderedItems: 10, endpoint: null, endpointDiscovery: 'runtime-only' },
    detail: { pathPatterns: ['^/en/jobs/\\d+/[^/]+/$'], outboundOfficialLinkRequired: true },
    dataAccess: {
      mode: 'nuxt-ssr-html',
      useApi: false,
      apiEndpoint: null,
      note: 'The runtime load-more endpoint is not a published API contract; use only the first-page SSR links until it is documented.',
    },
    crawlPolicy: {
      enabled: true,
      robots: 'allowed-for-search-reference',
      rendering: 'nuxt-server-rendered-first-page',
      crawlDelayMs: 10_000,
      maxPages: 2,
      probe: 'http-200',
      checkedAt: POLICY_CHECKED_AT,
      note: 'robots.txt explicitly permits search/reference assistants, prohibits model-training crawlers, and requests a ten-second crawl delay. Only server-rendered links are followed.',
    },
  }),
])

export function listDiscoverOpportunitySources({ includePolicyBlocked = true } = {}) {
  return DISCOVER_OPPORTUNITY_SOURCES.filter((source) => includePolicyBlocked || source.crawlPolicy.enabled)
}

export function summarizeOpportunitySourceHealth(results, at = new Date().toISOString()) {
  return (results || []).map((result) => {
    const source = result?.source || {}
    return {
      id: source.id || '',
      name: source.name || source.school || '',
      url: source.url || '',
      authority: 'lead-only',
      status: result?.health?.status || result?.skipped || 'ok',
      checkedAt: result?.health?.attemptedAt || at,
      fetchedPageCount: result?.pages?.length || 0,
      candidatePageCount: result?.candidatePages?.length || 0,
      httpFailures: result?.health?.httpFailures || [],
      robotsDeniedCount: result?.health?.robotsDenied?.length || 0,
      robots: source.crawlPolicy?.robots || 'unknown',
      accessMode: source.crawlPolicy?.accessMode || 'direct-crawl',
      policyReason: result?.health?.policyReason || source.crawlPolicy?.reason || null,
      rendering: source.crawlPolicy?.rendering || 'unknown',
    }
  }).filter((item) => item.name && item.url)
}
