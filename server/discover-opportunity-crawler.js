import { createHash } from 'node:crypto'
import { crawlDiscoverSource } from './discover-source-crawler.js'
import { listDiscoverOpportunitySources } from './discover-opportunity-sources.js'

const MAX_LIST_PAGES = 2
const MAX_DETAIL_PAGES = 4

export function opportunityPolicyFingerprint(source) {
  const policy = {
    id: source?.id || '',
    url: source?.url || '',
    allowedHosts: source?.allowedHosts || [],
    crawlPolicy: source?.crawlPolicy || {},
    pagination: source?.pagination || {},
    detail: source?.detail || {},
    dataAccess: source?.dataAccess || {},
  }
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 24)
}

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

function allowedUrl(source, value) {
  try {
    const url = new URL(value, source?.url)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    const root = new URL(source.url)
    const allowed = [cleanHost(root.hostname), ...(source.allowedHosts || []).map(cleanHost)].filter(Boolean)
    const host = cleanHost(url.hostname)
    if (!allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function uniqueUrls(source, values) {
  return [...new Set((values || [])
    .map((value) => allowedUrl(source, value)?.toString())
    .filter(Boolean))]
}

function pageSize(pagination) {
  if (Number(pagination?.pageSize) > 0) return Math.floor(Number(pagination.pageSize))
  const name = String(pagination?.pageSizeParameter || 'pageSize').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  return Number(String(pagination?.verifiedExample || '').match(new RegExp(`(?:^|[?&])${name}=(\\d+)`, 'i'))?.[1]) || 25
}

/** Build at most two declared list pages. Runtime/private endpoints are never guessed. */
export function buildOpportunityListingUrls(source) {
  if (!source?.url || source?.crawlPolicy?.enabled === false) return []
  const first = allowedUrl(source, source.url)
  if (!first) return []
  const limit = Math.min(MAX_LIST_PAGES, Math.max(1, Math.floor(Number(source.crawlPolicy?.maxPages) || 1)))
  const pagination = source.pagination || {}
  const urls = [first.toString()]
  if (limit < 2) return urls

  if (pagination.strategy === 'query' || pagination.strategy === 'zero-based-query') {
    const next = new URL(first)
    const firstValue = Number.isFinite(Number(pagination.firstValue)) ? Number(pagination.firstValue) : 1
    next.searchParams.set(String(pagination.parameter || 'page'), String(firstValue + 1))
    urls.push(next.toString())
  } else if (pagination.strategy === 'path' && pagination.template) {
    const firstValue = Number.isFinite(Number(pagination.firstValue)) ? Number(pagination.firstValue) : 1
    const next = allowedUrl(source, String(pagination.template).replace(/\{page\}/g, String(firstValue + 1)))
    if (next) urls.push(next.toString())
  } else if (pagination.strategy === 'one-based-offset') {
    const next = new URL(first)
    const size = pageSize(pagination)
    const firstValue = Number.isFinite(Number(pagination.firstValue)) ? Number(pagination.firstValue) : 1
    next.searchParams.set(String(pagination.parameter || 'startIndex'), String(firstValue + size))
    next.searchParams.set(String(pagination.pageSizeParameter || 'pageSize'), String(size))
    urls.push(next.toString())
  }
  // html-fragment tokens and client-load-more endpoint=null are deliberately
  // not synthesized. Their server-rendered first page is still consumed.
  return uniqueUrls(source, urls).slice(0, limit)
}

export function isOpportunityDetailUrl(source, value) {
  const url = allowedUrl(source, value)
  if (!url) return false
  return (source?.detail?.pathPatterns || []).some((pattern) => {
    try { return new RegExp(String(pattern), 'i').test(url.pathname) } catch { return false }
  })
}

function phaseSource(source, urls) {
  return {
    ...source,
    seeds: urls.map((url) => ({ kind: 'doctoral', url })),
    crawlPolicy: { ...source.crawlPolicy, followSitemaps: false, maxPages: urls.length },
  }
}

function blockedResult(source, status = 'blocked', reason = null) {
  return {
    source,
    pages: [],
    candidatePages: [],
    skipped: status,
    health: {
      status,
      policyFingerprint: opportunityPolicyFingerprint(source),
      authority: 'lead-only',
      canVerifyApplicationFact: false,
      attemptedAt: new Date().toISOString(),
      paginationStrategy: source?.pagination?.strategy || 'unknown',
      accessMode: source?.dataAccess?.mode || 'unknown',
      plannedListingPageCount: 0,
      fetchedListingPageCount: 0,
      detailCandidateCount: 0,
      attemptedDetailPageCount: 0,
      fetchedDetailPageCount: 0,
      attemptedPageCount: 0,
      fetchedPageCount: 0,
      candidatePageCount: 0,
      httpFailures: [], robotsDenied: [], robotsUnavailable: [], fetchFailureReasons: [],
      policyReason: reason || source?.crawlPolicy?.reason || 'source-crawl-disabled-by-policy',
    },
  }
}

function mergeRecords(results, key) {
  const records = new Map()
  for (const result of results) {
    for (const item of result?.[key] || []) {
      const previous = records.get(item.url)
      records.set(item.url, {
        ...previous, ...item,
        types: [...new Set([...(previous?.types || []), ...(item.types || [])])],
        discoveredFrom: [...new Set([...(previous?.discoveredFrom || []), ...(item.discoveredFrom || [])])].slice(0, 12),
        authority: 'lead-only',
        canVerifyApplicationFact: false,
      })
    }
  }
  return [...records.values()]
}

export async function crawlDiscoverOpportunitySource(source, {
  fetchImpl = globalThis.fetch,
  dnsLookup,
  timeoutMs = 12_000,
} = {}) {
  if (!source?.url) return blockedResult(source, 'invalid-source', 'invalid-source')
  if (source.crawlPolicy?.enabled === false) return blockedResult(source)
  const listingUrls = buildOpportunityListingUrls(source)
  if (!listingUrls.length) return blockedResult(source, 'invalid-source', 'invalid-source')

  const listing = await crawlDiscoverSource(phaseSource(source, listingUrls), {
    fetchImpl, dnsLookup, timeoutMs, maxPages: listingUrls.length, maxCandidatePages: 500,
  })
  const detailUrls = uniqueUrls(source, (listing.candidatePages || [])
    .map((candidate) => candidate.url)
    .filter((url) => isOpportunityDetailUrl(source, url)))
    .slice(0, MAX_DETAIL_PAGES)
  const detail = detailUrls.length
    ? await crawlDiscoverSource(phaseSource(source, detailUrls), {
        fetchImpl, dnsLookup, timeoutMs, maxPages: detailUrls.length, maxCandidatePages: 200,
      })
    : null
  const phases = [listing, detail].filter(Boolean)
  const pages = mergeRecords(phases, 'pages')
  const candidatePages = mergeRecords(phases, 'candidatePages').map((candidate) => ({
    ...candidate,
    fetched: candidate.fetched || pages.some((page) => page.url === candidate.url),
  }))
  const healthRows = phases.map((phase) => phase.health || {})
  const httpFailures = [...new Set(healthRows.flatMap((health) => health.httpFailures || []))]
  const robotsDenied = [...new Set(healthRows.flatMap((health) => health.robotsDenied || []))]
  const robotsUnavailable = [...new Set(healthRows.flatMap((health) => health.robotsUnavailable || []))]
  const fetchFailureReasons = [...new Set(healthRows.flatMap((health) => health.fetchFailureReasons || []))]
  const listingPages = new Set(listing.pages?.map((page) => page.url) || [])
  const detailPages = new Set(detail?.pages?.map((page) => page.url) || [])
  const blocked = robotsDenied.length > 0 || robotsUnavailable.length > 0 || httpFailures.some((status) => [401, 403, 429].includes(status))
  const hasFailure = blocked || httpFailures.length > 0 || fetchFailureReasons.length > 0
  const status = listingPages.size ? (hasFailure ? 'partial' : 'ok') : (blocked ? 'blocked' : 'unavailable')
  return {
    source, pages, candidatePages, skipped: listingPages.size ? null : status,
    health: {
      status,
      policyFingerprint: opportunityPolicyFingerprint(source),
      authority: 'lead-only', canVerifyApplicationFact: false,
      attemptedAt: new Date().toISOString(),
      paginationStrategy: source.pagination?.strategy || 'unknown',
      accessMode: source.dataAccess?.mode || 'unknown',
      plannedListingPageCount: listingUrls.length,
      fetchedListingPageCount: listingPages.size,
      detailCandidateCount: detailUrls.length,
      attemptedDetailPageCount: detailUrls.length,
      fetchedDetailPageCount: detailPages.size,
      attemptedPageCount: healthRows.reduce((sum, row) => sum + (row.attemptedPageCount || 0), 0),
      fetchedPageCount: pages.length,
      candidatePageCount: candidatePages.length,
      httpFailures, robotsDenied, robotsUnavailable, fetchFailureReasons,
      policyReason: robotsDenied.length ? 'robots-disallow' : (robotsUnavailable.length ? 'robots-unavailable' : null),
    },
  }
}

export async function crawlDiscoverOpportunitySources({
  sources = listDiscoverOpportunitySources(), concurrency = 2, fetchImpl = globalThis.fetch,
  dnsLookup, timeoutMs, onProgress,
} = {}) {
  const results = new Array(sources.length)
  let cursor = 0
  let completed = 0
  const workers = Math.min(Math.max(1, Math.floor(concurrency)), sources.length)
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < sources.length) {
      const index = cursor++
      results[index] = await crawlDiscoverOpportunitySource(sources[index], { fetchImpl, dnsLookup, timeoutMs })
      completed += 1
      await onProgress?.({ completed, total: sources.length, source: sources[index], result: results[index] })
    }
  }))
  return results
}
