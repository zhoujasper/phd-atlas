import { crawlDiscoverSources } from '../discover-source-crawler.js'
import { DISCOVER_SOURCE_REGISTRY } from '../discover-source-registry.js'

const MAX_FACTS = 40
const MAX_OFFICIAL_PAGES = 20
const CURRENT_YEAR = new Date().getUTCFullYear()

function compact(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function normalizedSchool(value) {
  return compact(value)
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function meaningfulSchoolWords(value) {
  return normalizedSchool(value).split(' ').filter((word) => (
    word.length > 2 && !['and', 'college', 'institute', 'school', 'the', 'university'].includes(word)
  ))
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function sourceMatchesSchool(source, school) {
  const target = normalizedSchool(school)
  const candidate = normalizedSchool(source?.school)
  if (!target || !candidate) return false
  if (target === candidate) return true
  const targetWords = meaningfulSchoolWords(target)
  const candidateWords = meaningfulSchoolWords(candidate)
  if (!targetWords.length || !candidateWords.length) return false
  const overlap = targetWords.filter((word) => candidateWords.includes(word)).length
  return overlap >= 2 && overlap / Math.max(targetWords.length, candidateWords.length) >= 0.75
}

/** Resolve only a strong school identity; an approximate top-search result is
 * not safe enough to become the official source for an application record. */
export function resolveOfficialProgramSource({ school, officialUrl = '' } = {}) {
  const registrySource = DISCOVER_SOURCE_REGISTRY.find((source) => sourceMatchesSchool(source, school))
  const explicitUrl = safeOfficialUrl(officialUrl)
  if (!registrySource && !explicitUrl) return null
  if (registrySource) {
    const seeds = [...(registrySource.seeds || [])]
    if (explicitUrl) seeds.unshift({ kind: 'doctoral', url: explicitUrl })
    return {
      ...registrySource,
      seeds: seeds.slice(0, 32),
      crawlPolicy: { ...(registrySource.crawlPolicy || {}), maxPages: 18 },
    }
  }
  const parsed = new URL(explicitUrl)
  return {
    region: 'OTHER',
    school: compact(school).slice(0, 220),
    url: `${parsed.origin}/`,
    allowedHosts: [parsed.hostname.toLowerCase()],
    seeds: [{ kind: 'doctoral', url: explicitUrl }],
    crawlPolicy: { maxPages: 18 },
  }
}

function factYear(statement) {
  const years = [...statement.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1990 && year <= CURRENT_YEAR + 2)
  return years.at(-1) || null
}

function boundedNumber(value, maximum) {
  const parsed = Number(String(value || '').replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null
}

const FACT_PATTERNS = [
  {
    kind: 'acceptance-rate',
    label: 'Acceptance/admission rate',
    maximum: 100,
    regexes: [
      /(?:acceptance|admission|admit)\s+rate(?:\s+(?:was|is|of))?\s*(\d{1,3}(?:\.\d+)?)\s*%/i,
      /(\d{1,3}(?:\.\d+)?)\s*%\s+(?:acceptance|admission|admit)\s+rate/i,
    ],
    unit: 'percent',
  },
  {
    kind: 'applications',
    label: 'Applications received',
    maximum: 100_000,
    regexes: [
      /(?:received|from|among|of)?\s*([\d,]{1,7})\s+(?:completed\s+)?applications?\b/i,
      /\bapplications?\s+(?:received|totalled|totaled|numbered|were|was|:)\s*([\d,]{1,7})\b/i,
    ],
    unit: 'people',
  },
  {
    kind: 'offers-or-admits',
    label: 'Offers/admitted applicants',
    maximum: 100_000,
    regexes: [
      /\b(?:admitted|accepted|offered\s+admission\s+to|made\s+offers?\s+to)\s*([\d,]{1,7})\b/i,
      /\b([\d,]{1,7})\s+(?:applicants?\s+)?(?:were\s+)?(?:admitted|accepted|offered\s+admission)\b/i,
    ],
    unit: 'people',
  },
  {
    kind: 'enrolled-or-cohort',
    label: 'Enrolled/cohort size',
    maximum: 100_000,
    regexes: [
      /\b(?:cohort|intake|class)\s+(?:of|size(?:\s+of)?|included|includes|was|is|:)\s*([\d,]{1,7})\b/i,
      /\b([\d,]{1,7})\s+(?:new\s+)?(?:doctoral|ph\.?d\.?)?\s*(?:students?\s+)?(?:enrolled|matriculated|joined\s+the\s+cohort)\b/i,
    ],
    unit: 'people',
  },
]

/** Extract only explicit numeric admissions/cohort claims. The exact official
 * sentence is retained so every parsed number can be checked in context. */
export function extractOfficialAdmissionFacts(pages = [], { fetchedAt = new Date().toISOString() } = {}) {
  const facts = []
  const seen = new Set()
  for (const page of pages || []) {
    if (page?.fetched !== true || page?.promptInjectionSuspected === true) continue
    const sourceUrl = safeOfficialUrl(page?.url)
    if (!sourceUrl) continue
    const statements = String(page?.excerpt || '')
      .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
      .map((value) => compact(value).slice(0, 420))
      .filter((value) => value.length >= 12)
    for (const statement of statements) {
      for (const pattern of FACT_PATTERNS) {
        let match = null
        for (const regex of pattern.regexes) {
          match = statement.match(regex)
          if (match) break
        }
        if (!match) continue
        const value = boundedNumber(match[1], pattern.maximum)
        if (value === null) continue
        const year = factYear(statement)
        const key = `${pattern.kind}|${year || ''}|${value}|${sourceUrl}`
        if (seen.has(key)) continue
        seen.add(key)
        facts.push({
          kind: 'official-admission-fact',
          value: {
            factType: pattern.kind,
            label: pattern.label,
            value,
            unit: pattern.unit,
            year,
            statement,
            pageTitle: compact(page?.title || page?.label).slice(0, 240),
          },
          sourceId: 'official-program-history',
          sourceUrl,
          fetchedAt,
          confidence: 1,
        })
        if (facts.length >= MAX_FACTS) return facts
      }
    }
  }
  return facts
}

async function runOfficialProgramHistory(query = {}, context = {}) {
  const source = resolveOfficialProgramSource(query)
  if (!source) {
    return {
      status: 'empty',
      records: [],
      warnings: ['official-school-source-not-resolved'],
      meta: { pages: [] },
    }
  }
  const timeoutMs = Math.min(45_000, Math.max(5_000, Number(context.timeoutMs) || 45_000))
  const signal = context.signal || AbortSignal.timeout(timeoutMs)
  const crawls = await crawlDiscoverSources({
    sources: [source],
    regions: source.region ? [source.region] : [],
    limit: 1,
    concurrency: 1,
    maxPages: 18,
    timeoutMs: Math.min(7_000, timeoutMs),
    researchQuery: {
      field: compact(query.program),
      terms: [
        compact(query.program),
        'admissions statistics',
        'applications received',
        'cohort size',
        'admission offers',
      ],
    },
    fetchImpl: context.fetchImpl || globalThis.fetch,
    signal,
  })
  const crawl = crawls[0]
  const pages = (crawl?.pages || [])
    .filter((page) => page?.fetched === true && page?.promptInjectionSuspected !== true)
  const fetchedAt = new Date().toISOString()
  const records = extractOfficialAdmissionFacts(pages, { fetchedAt })
  const pageIndex = pages
    .filter((page) => (page.types || []).some((type) => ['program', 'admissions', 'funding'].includes(type)))
    .map((page) => ({
      title: compact(page.title || page.label).slice(0, 240),
      url: safeOfficialUrl(page.url),
      types: (page.types || []).filter((type) => ['program', 'admissions', 'funding'].includes(type)).slice(0, 4),
      fetchedAt,
    }))
    .filter((page) => page.url)
    .slice(0, MAX_OFFICIAL_PAGES)
  return {
    status: records.length || pageIndex.length ? 'ok' : 'empty',
    records,
    warnings: crawl?.skipped ? [String(crawl.skipped)] : [],
    meta: { pages: pageIndex, crawlStatus: crawl?.health?.status || 'unavailable' },
  }
}

export const officialProgramHistorySource = Object.freeze({
  config: Object.freeze({
    id: 'official-program-history',
    name: 'Official programme evidence',
    description: 'University-owned programme/admissions pages; numeric facts are retained only with the exact official sentence.',
  }),
  run: runOfficialProgramHistory,
})
