import { crawlDiscoverSource } from './discover-source-crawler.js'
import { findSchoolSourceEntry, isOfficialSchoolUrl } from './discover-source-grounding.js'

const MAX_HYDRATION_SCHOOLS = 16
const MAX_HYDRATION_SEEDS_PER_SCHOOL = 24
const PROGRAM_PATH_SIGNAL = /(?:^|[/_-])(?:phd|dphil|doctoral|doctorate|doctorats?|doctorad[oa]s?|dottorat[oi]|doutorad[oa]s?|doktorat|promotion(?:en)?|graduate|postgraduate|programme|programs?|admissions?|research[-_]?degrees?|courses?|博士|박사)(?:[/_.-]|$)/iu
const NON_PROGRAM_PATH_SIGNAL = /\/(?:[^/]+[-_])?(?:news(?:room)?|nouvelles|notizie|noticias|nachrichten|nieuws|nyheter|uutiset|новости|新闻|新聞|ニュース|뉴스|events?|stories|awards?|press|media|blogs?|alumni|privacy|careers?|jobs?)(?:[-_][^/]*)?(?:\/|$)/iu

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:') return ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return ''
  }
}

function uniqueTypes(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function mergePage(left, right) {
  return {
    ...(left || {}),
    ...(right || {}),
    types: uniqueTypes([...(left?.types || []), ...(right?.types || [])]),
    discoveredFrom: [...new Set([...(left?.discoveredFrom || []), ...(right?.discoveredFrom || [])])].slice(0, 12),
    fetched: Boolean(left?.fetched || right?.fetched),
    promptInjectionSuspected: Boolean(left?.promptInjectionSuspected || right?.promptInjectionSuspected),
  }
}

function mergePages(left, right) {
  const merged = new Map()
  for (const page of [...(left || []), ...(right || [])]) {
    const key = canonicalUrl(page?.url)
    if (!key) continue
    merged.set(key, mergePage(merged.get(key), page))
  }
  return [...merged.values()]
}

function hydrationKind(url, role) {
  if (role === 'advisor') return 'faculty'
  if (role === 'research') return 'research'
  try {
    const parsed = new URL(url)
    const signal = `${parsed.pathname}${parsed.search}`
    return !NON_PROGRAM_PATH_SIGNAL.test(parsed.pathname) && PROGRAM_PATH_SIGNAL.test(signal) ? 'doctoral' : 'research'
  } catch {
    return 'research'
  }
}

function programEvidenceUrls(program) {
  const entries = []
  const add = (value, role) => {
    const url = canonicalUrl(value)
    if (url) entries.push({ url, role })
  }
  add(program?.website, 'program')
  for (const value of program?.sources || []) add(value, 'program')
  for (const pi of program?.pis || []) add(pi?.url, 'advisor')
  for (const value of Object.values(program?.factSources || {})) add(value, 'research')
  for (const scholarship of program?.scholarships || []) add(scholarship?.url, 'research')
  return entries
}

/**
 * Convert model-discovered URLs into bounded crawler seeds. A model URL never
 * becomes trusted merely by appearing here: it still has to be university-
 * owned, pass the crawler's SSRF/robots/content checks, and survive grounding.
 * Ambiguous paths are deliberately seeded as research rather than programme
 * pages so an arbitrary official news URL cannot self-certify a programme.
 */
export function buildDiscoverEvidenceHydrationSources({
  programs = [],
  crawls = [],
  sourceIndex,
  includeDeclaredSeeds = true,
  maxSchools = MAX_HYDRATION_SCHOOLS,
} = {}) {
  const crawlBySchool = new Map((crawls || [])
    .filter((result) => result?.source?.school)
    .map((result) => [result.source.school, result]))
  const grouped = new Map()
  for (const program of programs || []) {
    const schoolEntry = findSchoolSourceEntry(program, sourceIndex)
    const base = schoolEntry ? crawlBySchool.get(schoolEntry.school) : null
    if (!schoolEntry || !base?.source) continue
    const current = grouped.get(schoolEntry.school) || {
      base,
      schoolEntry,
      seeds: new Map(),
      extraHosts: new Set(),
    }
    for (const entry of programEvidenceUrls(program)) {
      if (!isOfficialSchoolUrl(entry.url, schoolEntry)) continue
      const kind = hydrationKind(entry.url, entry.role)
      const key = `${kind}:${entry.url}`
      current.seeds.set(key, { kind, url: entry.url })
      try { current.extraHosts.add(new URL(entry.url).hostname.toLowerCase()) } catch { /* already validated */ }
    }
    grouped.set(schoolEntry.school, current)
  }

  const schoolLimit = Math.min(64, Math.max(1, Number(maxSchools) || MAX_HYDRATION_SCHOOLS))
  return [...grouped.values()].slice(0, schoolLimit).map(({ base, seeds, extraHosts }) => {
    const declared = includeDeclaredSeeds
      ? (base.source.seeds || []).filter((seed) => canonicalUrl(seed?.url))
      : []
    const targeted = [...seeds.values()].slice(0, Math.max(0, MAX_HYDRATION_SEEDS_PER_SCHOOL - declared.length))
    return {
      ...base.source,
      allowedHosts: [...new Set([...(base.source.allowedHosts || []), ...extraHosts])],
      seeds: [...targeted, ...declared].slice(0, MAX_HYDRATION_SEEDS_PER_SCHOOL),
      crawlPolicy: {
        ...(base.source.crawlPolicy || {}),
        maxPages: Math.max(
          includeDeclaredSeeds ? (Number(base.source.crawlPolicy?.maxPages) || 0) : 0,
          Math.min(32, targeted.length + declared.length + (includeDeclaredSeeds ? 6 : 2)),
        ),
      },
      hydrationTargetCount: targeted.length,
    }
  }).filter((source) => source.hydrationTargetCount > 0)
}

export function mergeDiscoverCrawlResults(baseResults = [], additionalResults = []) {
  const bySource = new Map((baseResults || [])
    .filter((result) => result?.source?.url)
    .map((result) => [result.source.url, result]))
  for (const addition of additionalResults || []) {
    if (!addition?.source?.url) continue
    const previous = bySource.get(addition.source.url)
    if (!previous) {
      bySource.set(addition.source.url, addition)
      continue
    }
    const pages = mergePages(previous.pages, addition.pages)
    const candidatePages = mergePages(previous.candidatePages, addition.candidatePages)
    bySource.set(addition.source.url, {
      ...previous,
      pages,
      candidatePages,
      skipped: pages.length ? null : (addition.skipped || previous.skipped),
      health: {
        ...(previous.health || {}),
        ...(addition.health || {}),
        status: pages.length ? 'ok' : (addition.health?.status || previous.health?.status),
        fetchedPageCount: pages.length,
        candidatePageCount: candidatePages.length,
        hydrationFetchedPageCount: (addition.pages || []).length,
      },
    })
  }
  return [...bySource.values()]
}

export async function hydrateDiscoverOfficialEvidence({
  programs = [],
  crawls = [],
  sourceIndex,
  researchQuery,
  fetchImpl = globalThis.fetch,
  dnsLookup,
  concurrency = 3,
  includeDeclaredSeeds = true,
  maxSchools = MAX_HYDRATION_SCHOOLS,
  onProgress,
} = {}) {
  const sources = buildDiscoverEvidenceHydrationSources({
    programs,
    crawls,
    sourceIndex,
    includeDeclaredSeeds,
    maxSchools,
  })
  if (!sources.length) return { crawls, additions: [], attemptedSourceCount: 0, fetchedPageCount: 0 }
  const additions = new Array(sources.length)
  let cursor = 0
  let completed = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), sources.length) }, async () => {
    while (cursor < sources.length) {
      const index = cursor++
      additions[index] = await crawlDiscoverSource(sources[index], {
        fetchImpl,
        dnsLookup,
        maxPages: Math.min(32, Number(sources[index].crawlPolicy?.maxPages) || 16),
        maxCandidatePages: 400,
        researchQuery,
      })
      completed += 1
      await onProgress?.({ completed, total: sources.length, result: additions[index] })
    }
  }))
  return {
    crawls: mergeDiscoverCrawlResults(crawls, additions),
    additions,
    attemptedSourceCount: sources.length,
    fetchedPageCount: additions.reduce((total, result) => total + (result?.pages?.length || 0), 0),
  }
}
