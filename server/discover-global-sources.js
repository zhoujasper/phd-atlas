import { withAbortDeadline } from './abortDeadline.js'
import { cancelResponseBody, readBoundedResponseJson } from './boundedResponse.js'

const OPENALEX_BASE = 'https://api.openalex.org'
const OPENALEX_TIMEOUT_MS = 12_000
const OPENALEX_RETRY_ATTEMPTS = 3
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const CACHE_MAX_ENTRIES = 128
const OPENALEX_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
const MAX_COUNTRIES_PER_RUN = 48
const MAX_INSTITUTION_GROUPS_PER_COUNTRY = 200
const MAX_DYNAMIC_SOURCES = 192
const boundedConcurrencyEnv = (name, fallback, maximum) => {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? Math.min(maximum, value) : fallback
}
const COUNTRY_LOOKUP_CONCURRENCY = boundedConcurrencyEnv('DISCOVER_GLOBAL_COUNTRY_CONCURRENCY', 2, 4)
const COUNTRY_SEARCH_CONCURRENCY = boundedConcurrencyEnv('DISCOVER_GLOBAL_SEARCH_CONCURRENCY', 1, 2)
const INSTITUTION_DETAIL_CONCURRENCY = boundedConcurrencyEnv('DISCOVER_GLOBAL_DETAIL_CONCURRENCY', 2, 6)

const EU_COUNTRY_CODES = new Set([
  'AL', 'AT', 'BA', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FR', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'ME', 'MK',
  'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK',
])

const COUNTRY_REGION = new Map([
  ['US', 'US'],
  ['GB', 'UK'],
  ['CA', 'CA'],
  ['SG', 'SG'],
  ['HK', 'HK'],
  ['CN', 'CN'],
  ['AU', 'AU'],
  ...[...EU_COUNTRY_CODES].map((country) => [country, 'EU']),
])

const SINGLE_COUNTRY_REGIONS = new Set(['US', 'UK', 'CA', 'SG', 'HK', 'CN', 'AU'])

const GLOBAL_PATH_HINTS = Object.freeze({
  faculty: [
    'faculty', 'people', 'staff', 'profile', 'profiles', 'professor', 'researcher',
    'academic', 'supervisor', 'docente', 'docentes', 'profesor', 'professores',
    'chercheur', 'enseignant', 'wissenschaftler', '教員', '研究者', '导师', '教师',
    '교수', '연구자',
  ],
  lab: [
    'lab', 'labs', 'laboratory', 'group', 'groups', 'centre', 'center', 'institute',
    'research', 'project', 'pesquisa', 'investigacion', 'investigación', 'recherche',
    'forschung', 'ricerca', '研究', '研究室', '研究组', '연구', '연구실',
  ],
  department: [
    'department', 'departments', 'faculty', 'school', 'college', 'institute', 'unit',
    'departamento', 'facultad', 'faculdade', 'institut', 'fakultat', 'fakultät',
    'dipartimento', '研究科', '学院', '学部', '학과', '대학원',
  ],
  program: [
    'phd', 'ph.d', 'doctoral', 'doctorate', 'doctor of philosophy', 'graduate',
    'postgraduate', 'research degree', 'program', 'programme', 'admission',
    'doctorado', 'doctorados', 'doutorado', 'doutorados', 'doctorat', 'doctorats',
    'doktorat', 'dottorato', 'dottorati', 'promotion', 'promotionen',
    '博士', '박사', 'ปริญญาเอก', 'tiến sĩ', 'докторантур',
  ],
})

const cache = new Map()

function cachedSources(cacheKey, now) {
  const cached = cache.get(cacheKey)
  if (!cached) return null
  if (now - cached.cachedAt >= CACHE_TTL_MS) {
    cache.delete(cacheKey)
    return null
  }
  // Map insertion order owns the LRU order.
  cache.delete(cacheKey)
  cache.set(cacheKey, cached)
  return cached.sources
}

function rememberSources(cacheKey, cachedAt, sources) {
  for (const [candidateKey, candidate] of cache) {
    if (cachedAt - candidate.cachedAt >= CACHE_TTL_MS) cache.delete(candidateKey)
  }
  cache.delete(cacheKey)
  cache.set(cacheKey, { cachedAt, sources })
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
}

function cleanText(value, limit = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function normalizeSchool(value) {
  return cleanText(value, 300)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\b(?:the|of|and|at)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function countryCodeFromGroup(group) {
  const match = String(group?.key || '').match(/\/countries\/([A-Z]{2})$/i)
  return match?.[1]?.toUpperCase() || ''
}

function openAlexId(value) {
  const match = String(value || '').match(/(?:^|\/)(I\d+)$/i)
  return match?.[1]?.toUpperCase() || ''
}

function regionForCountry(countryCode) {
  return COUNTRY_REGION.get(String(countryCode || '').toUpperCase()) || 'OTHER'
}

function registrableDomain(hostname) {
  const labels = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length < 3) return labels.join('.')
  const penultimate = labels.at(-2)
  const tld = labels.at(-1)
  const countryEducationSuffix = tld.length === 2
    && ['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'].includes(penultimate)
  return labels.slice(countryEducationSuffix ? -3 : -2).join('.')
}

function canonicalHomepage(value) {
  try {
    const url = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.protocol = 'https:'
    url.port = ''
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.local')) return null
    return url
  } catch {
    return null
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
    : fallback
}

function retryAfterMs(response, attempt) {
  const raw = String(response?.headers?.get?.('retry-after') || '').trim()
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, seconds * 1_000)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.min(5_000, Math.max(0, date - Date.now()))
  return Math.min(4_000, 400 * (2 ** attempt))
}

async function fetchOpenAlexJson(url, {
  fetchImpl,
  timeoutMs = OPENALEX_TIMEOUT_MS,
  attempts = OPENALEX_RETRY_ATTEMPTS,
} = {}) {
  const requestUrl = new URL(url)
  if (process.env.OPENALEX_API_KEY) requestUrl.searchParams.set('api_key', process.env.OPENALEX_API_KEY)
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(process.env.OPENALEX_MAILTO || ''))) {
    requestUrl.searchParams.set('mailto', process.env.OPENALEX_MAILTO)
  }
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { response, payload } = await withAbortDeadline(
        async (signal) => {
          const response = await fetchImpl(requestUrl.toString(), {
            signal,
            headers: {
              accept: 'application/json',
              'user-agent': 'PhD-Atlas/0.1 (official-source discovery)',
            },
          })
          if (!response.ok) await cancelResponseBody(response)
          return {
            response,
            payload: response.ok
              ? await readBoundedResponseJson(response, {
                maxBytes: OPENALEX_RESPONSE_MAX_BYTES,
                signal,
                bodyKind: 'OpenAlex response',
              })
              : null,
          }
        },
        { timeoutMs },
      )
      if (response.ok) return payload
      lastError = new Error(`OpenAlex HTTP ${response.status}`)
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt + 1 >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response, attempt)))
    } catch (error) {
      lastError = error
      if (attempt + 1 >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(null, attempt)))
    }
  }
  throw lastError || new Error('OpenAlex request failed')
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        output[index] = await worker(items[index], index)
      }
    },
  ))
  return output
}

function queryTexts(terms, limit = 2) {
  const values = [...new Set((Array.isArray(terms) ? terms : [terms])
    .flatMap((value) => cleanText(value, 180).split(/[,;\n|]/))
    .map((value) => cleanText(value, 80))
    .filter(Boolean))]
  const latin = values.filter((value) => /[a-z]/i.test(value))
  const native = values.filter((value) => !/[a-z]/i.test(value))
  return [...latin, ...native].slice(0, Math.max(1, Math.min(3, Number(limit) || 2)))
}

function globalResearchQueries(terms, topics, limit = 2) {
  const boundedLimit = Math.max(1, Math.min(2, Number(limit) || 2))
  const output = []
  const seenTopics = new Set()
  const seenQueries = new Set()
  for (const topic of topics || []) {
    if (topic?.primaryForQuery === false) continue
    const topicId = String(topic?.id || topic?.openAlexId || '').match(/(?:^|\/)(T\d+)$/i)?.[1]?.toUpperCase()
    const query = cleanText(topic?.query || topic?.displayName, 100)
    if (!topicId || !query || seenTopics.has(topicId) || output.length >= boundedLimit) continue
    seenTopics.add(topicId)
    seenQueries.add(query.normalize('NFKC').toLocaleLowerCase())
    output.push({ kind: 'topic', query, topicId })
  }
  for (const query of queryTexts(terms, boundedLimit)) {
    if (output.length >= boundedLimit) break
    const key = query.normalize('NFKC').toLocaleLowerCase()
    if (seenQueries.has(key)) continue
    seenQueries.add(key)
    output.push({ kind: 'text', query })
  }
  return output
}

function applyResearchQuery(url, query, filters) {
  const nextFilters = [...filters]
  if (query.kind === 'topic') nextFilters.push(`topics.id:${query.topicId}`)
  else url.searchParams.set('search', query.query)
  url.searchParams.set('filter', nextFilters.join(','))
}

function mergeOpenAlexGroups(payloads) {
  const merged = new Map()
  for (const payload of payloads || []) {
    for (const group of payload?.group_by || []) {
      if (!group?.key) continue
      const current = merged.get(group.key) || {
        ...group,
        count: 0,
      }
      current.count += Math.max(0, Number(group.count) || 0)
      current.key_display_name ||= group.key_display_name
      merged.set(group.key, current)
    }
  }
  return [...merged.values()].sort((left, right) => right.count - left.count)
}

function countryPlan(groups, selectedRegions, limit) {
  const wanted = new Set((selectedRegions || []).map((value) => cleanText(value, 32)).filter(Boolean))
  if (!wanted.size) {
    for (const region of ['US', 'UK', 'EU', 'CA', 'SG', 'HK', 'CN', 'AU', 'OTHER']) wanted.add(region)
  }
  const buckets = new Map([...wanted].map((region) => [region, []]))
  for (const group of groups || []) {
    const countryCode = countryCodeFromGroup(group)
    const region = regionForCountry(countryCode)
    if (!countryCode || !wanted.has(region)) continue
    buckets.get(region)?.push({
      countryCode,
      country: cleanText(group.key_display_name, 100) || countryCode,
      region,
      fieldWorkCount: Math.max(0, Number(group.count) || 0),
    })
  }
  const limitedBuckets = []
  for (const region of wanted) {
    const rows = buckets.get(region) || []
    const countryLimit = SINGLE_COUNTRY_REGIONS.has(region)
      ? 1
      : (region === 'EU' ? 8 : 16)
    limitedBuckets.push(rows.slice(0, countryLimit))
  }
  const planned = []
  const countryCap = Math.min(MAX_COUNTRIES_PER_RUN, Math.max(1, limit))
  while (planned.length < countryCap && limitedBuckets.some((rows) => rows.length)) {
    for (const rows of limitedBuckets) {
      const next = rows.shift()
      if (next) planned.push(next)
      if (planned.length >= countryCap) break
    }
  }
  return planned
}

function institutionQuota(entry, selectedRegionCount, limit) {
  if (SINGLE_COUNTRY_REGIONS.has(entry.region)) {
    return Math.min(48, Math.max(8, Math.ceil(limit / Math.max(1, selectedRegionCount * 2))))
  }
  return Math.min(12, Math.max(2, Math.ceil(limit / Math.max(1, selectedRegionCount * 16))))
}

function institutionSource(institution, group, country) {
  if (
    !institution
    || institution.type !== 'education'
    || String(institution.country_code || '').toUpperCase() !== country.countryCode
  ) return null
  const homepage = canonicalHomepage(institution.homepage_url)
  if (!homepage) return null
  const school = cleanText(institution.display_name || group.key_display_name, 220)
  const domain = registrableDomain(homepage.hostname)
  if (!school || !domain) return null
  const fieldWorkCount = Math.max(0, Number(group.count) || 0)
  const hIndex = Math.max(0, Number(institution.summary_stats?.h_index) || 0)
  const citedByCount = Math.max(0, Number(institution.cited_by_count) || 0)
  const discoveryScore = Number((
    Math.log10(1 + fieldWorkCount) * 20
    + Math.log10(1 + citedByCount) * 2
    + Math.min(8, hIndex / 50)
  ).toFixed(3))
  return Object.freeze({
    region: country.region,
    country: country.country,
    countryCode: country.countryCode,
    school,
    url: homepage.toString(),
    allowedHosts: [domain, homepage.hostname.toLowerCase()],
    seeds: [{ kind: 'homepage', url: homepage.toString() }],
    pathHints: GLOBAL_PATH_HINTS,
    discoveryScore,
    sourceProvenance: 'openalex-field-institution',
    openAlexId: institution.id || group.key,
    adapterVerifiedAt: new Date().toISOString().slice(0, 10),
    crawlPolicy: {
      maxPages: 10,
      followSitemaps: true,
    },
  })
}

function roundRobinRegions(sources, limit) {
  const buckets = new Map()
  for (const source of sources) {
    const bucket = buckets.get(source.region) || []
    bucket.push(source)
    buckets.set(source.region, bucket)
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => right.discoveryScore - left.discoveryScore || left.school.localeCompare(right.school))
  }
  const output = []
  while (output.length < limit && [...buckets.values()].some((bucket) => bucket.length)) {
    for (const bucket of buckets.values()) {
      const source = bucket.shift()
      if (source) output.push(source)
      if (output.length >= limit) break
    }
  }
  return output
}

export function clearDiscoverGlobalSourceCache() {
  cache.clear()
}

/**
 * Use OpenAlex only as a field/country/institution lead index. Every returned
 * homepage is still crawled through the normal HTTPS, DNS, robots, redirect,
 * content, prompt-injection, and final official-evidence gates before a program
 * or advisor can persist.
 */
export async function discoverGlobalInstitutionSources({
  terms = [],
  topics = [],
  regions = [],
  existingSources = [],
  limit = 24,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') return []
  const sourceLimit = boundedInteger(limit, 24, 1, MAX_DYNAMIC_SOURCES)
  const searches = globalResearchQueries(terms, topics)
  if (!searches.length) searches.push({ kind: 'text', query: 'doctoral research' })
  const regionKeys = [...new Set((regions || []).map((value) => cleanText(value, 32)).filter(Boolean))].sort()
  const existingDomains = new Set((existingSources || []).flatMap((source) => [
    canonicalHomepage(source?.url)?.hostname,
    ...(source?.allowedHosts || []),
  ]).map(registrableDomain).filter(Boolean))
  const existingSchools = new Set((existingSources || []).map((source) => normalizeSchool(source?.school)).filter(Boolean))
  const cacheKey = JSON.stringify([searches, regionKeys, sourceLimit, [...existingDomains].sort()])
  const cached = cachedSources(cacheKey, now)
  if (cached) return cached

  const countryPayloads = await mapWithConcurrency(searches, 2, async (search) => {
    const countryUrl = new URL(`${OPENALEX_BASE}/works`)
    applyResearchQuery(countryUrl, search, [
      'from_publication_date:2023-01-01',
      'authorships.institutions.type:education',
    ])
    countryUrl.searchParams.set('group_by', 'authorships.institutions.country_code')
    countryUrl.searchParams.set('per-page', '200')
    return fetchOpenAlexJson(countryUrl, { fetchImpl }).catch(() => null)
  })
  const availableCountryPayloads = countryPayloads.filter(Boolean)
  if (!availableCountryPayloads.length) throw new Error('OpenAlex field discovery unavailable')
  const selectedRegions = regionKeys.length
    ? regionKeys
    : ['US', 'UK', 'EU', 'CA', 'SG', 'HK', 'CN', 'AU', 'OTHER']
  const plannedCountries = countryPlan(
    mergeOpenAlexGroups(availableCountryPayloads),
    selectedRegions,
    sourceLimit,
  )
  const countryCandidates = await mapWithConcurrency(plannedCountries, COUNTRY_LOOKUP_CONCURRENCY, async (country) => {
    const payloads = await mapWithConcurrency(searches, COUNTRY_SEARCH_CONCURRENCY, async (search) => {
      const institutionUrl = new URL(`${OPENALEX_BASE}/works`)
      applyResearchQuery(institutionUrl, search, [
        'from_publication_date:2023-01-01',
        'authorships.institutions.type:education',
        `authorships.institutions.country_code:${country.countryCode}`,
      ])
      institutionUrl.searchParams.set('group_by', 'authorships.institutions.id')
      institutionUrl.searchParams.set('per-page', String(MAX_INSTITUTION_GROUPS_PER_COUNTRY))
      return fetchOpenAlexJson(institutionUrl, { fetchImpl }).catch(() => null)
    })
    const quota = institutionQuota(country, selectedRegions.length, sourceLimit)
    const groups = mergeOpenAlexGroups(payloads)
      .filter((group) => openAlexId(group?.key))
      .filter((group) => !existingSchools.has(normalizeSchool(group?.key_display_name)))
      .slice(0, Math.min(MAX_INSTITUTION_GROUPS_PER_COUNTRY, quota * 5 + 8))
    return { country, quota, groups }
  })

  const detailRequests = countryCandidates.flatMap(({ country, quota, groups }) => (
    groups.map((group) => ({ country, quota, group }))
  ))
  const detailRows = await mapWithConcurrency(detailRequests, INSTITUTION_DETAIL_CONCURRENCY, async ({ country, quota, group }) => {
    const id = openAlexId(group.key)
    if (!id) return { country, quota, source: null }
    const detail = await fetchOpenAlexJson(new URL(`${OPENALEX_BASE}/institutions/${id}`), { fetchImpl })
      .catch(() => null)
    return { country, quota, source: institutionSource(detail, group, country) }
  })

  const acceptedByCountry = new Map()
  const seenDomains = new Set(existingDomains)
  const seenSchools = new Set(existingSchools)
  for (const row of detailRows) {
    const source = row.source
    if (!source) continue
    const countryKey = row.country.countryCode
    const accepted = acceptedByCountry.get(countryKey) || []
    if (accepted.length >= row.quota) continue
    const domain = registrableDomain(canonicalHomepage(source.url)?.hostname)
    const school = normalizeSchool(source.school)
    if (!domain || seenDomains.has(domain) || !school || seenSchools.has(school)) continue
    seenDomains.add(domain)
    seenSchools.add(school)
    accepted.push(source)
    acceptedByCountry.set(countryKey, accepted)
  }

  const sources = Object.freeze(roundRobinRegions(
    [...acceptedByCountry.values()].flat(),
    sourceLimit,
  ))
  rememberSources(cacheKey, now, sources)
  return sources
}
