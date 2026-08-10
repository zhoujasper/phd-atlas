import { cleanOptionalText, finiteNumberOrNull } from './sourceSchemas.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import { httpClientFor, createSourceAdapter } from './sourceAdapter.js'
import { provenanceRecord } from './sourceProvenance.js'

export const OPENALEX_BASE_URL = 'https://api.openalex.org'

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

export function buildOpenAlexWorksUrl(query = {}, config = {}) {
  const url = new URL('/works', `${String(config.baseUrl || OPENALEX_BASE_URL).replace(/\/$/, '')}/`)
  const keyword = cleanOptionalText(query.search || query.keyword, 500)
  // `search` is full text over titles and abstracts, so searching a person's
  // name returns papers that merely mention them -- an interview about
  // Fei-Fei Li rather than a paper by her. `authorName` is the filter that
  // actually asks "written by this person".
  const authorName = cleanOptionalText(query.authorName, 240)
  if (authorName) {
    url.searchParams.set('filter', `raw_author_name.search:${authorName}`)
  } else if (keyword) {
    url.searchParams.set('search', keyword)
  }

  const filters = url.searchParams.get('filter')
    ? [url.searchParams.get('filter')]
    : []
  if (typeof query.filter === 'string') filters.push(query.filter)
  else if (query.filter && typeof query.filter === 'object') {
    for (const [name, value] of Object.entries(query.filter)) {
      if (value !== undefined && value !== null && value !== '') filters.push(`${name}:${value}`)
    }
  }
  const optionalFilters = [
    ['authorships.author.id', query.authorId],
    ['authorships.institutions.id', query.institutionId],
    ['authorships.institutions.country_code', query.countryCode],
    ['concepts.id', query.conceptId],
    ['from_publication_date', query.fromPublicationDate],
    ['to_publication_date', query.toPublicationDate],
    ['publication_year', query.publicationYear],
    ['type', query.type],
  ]
  for (const [name, value] of optionalFilters) {
    if (value !== undefined && value !== null && value !== '') filters.push(`${name}:${value}`)
  }
  if (filters.length) url.searchParams.set('filter', filters.join(','))
  if (query.sort) url.searchParams.set('sort', cleanOptionalText(query.sort, 120))
  url.searchParams.set('per-page', String(boundedInteger(query.limit, 25, 1, 200)))
  url.searchParams.set('select', String(
    query.select
      || 'id,doi,title,display_name,publication_date,authorships,cited_by_count,topics',
  ))
  if (query.mailto || process.env.OPENALEX_MAILTO) {
    url.searchParams.set('mailto', query.mailto || process.env.OPENALEX_MAILTO)
  }
  if (query.apiKey || process.env.OPENALEX_API_KEY) {
    url.searchParams.set('api_key', query.apiKey || process.env.OPENALEX_API_KEY)
  }
  return url
}

function openAlexId(value) {
  const match = String(value || '').match(/(?:^|\/)([WADISTC]\d+)$/i)
  return match?.[1]?.toUpperCase() || null
}

function normalizeOpenAlexWork(row) {
  const authorships = Array.isArray(row?.authorships) ? row.authorships : []
  return {
    id: openAlexId(row?.id),
    openAlexId: cleanOptionalText(row?.id, 240),
    doi: cleanOptionalText(row?.doi, 240),
    title: cleanOptionalText(row?.title || row?.display_name, 600),
    publicationDate: cleanOptionalText(row?.publication_date, 40),
    publicationYear: finiteNumberOrNull(row?.publication_year),
    authors: authorships
      .map((authorship) => cleanOptionalText(authorship?.author?.display_name || authorship?.author?.name, 240))
      .filter(Boolean),
    authorCount: authorships.length,
    institutions: [...new Set(authorships
      .flatMap((authorship) => authorship?.institutions || [])
      .map((institution) => cleanOptionalText(institution?.display_name, 300))
      .filter(Boolean))],
    citedByCount: finiteNumberOrNull(row?.cited_by_count),
    topics: Array.isArray(row?.topics)
      ? row.topics.map((topic) => cleanOptionalText(topic?.display_name, 200)).filter(Boolean)
      : [],
  }
}

export function parseOpenAlexWorksResponse(payload, context = {}) {
  if (!Array.isArray(payload?.results)) {
    throw new SourceStructureChangedError(
      'OpenAlex works response no longer contains results[].',
      context.sourceId || 'openalex-works',
    )
  }
  const sourceId = context.sourceId || 'openalex-works'
  const sourceUrl = context.sourceUrl || `${OPENALEX_BASE_URL}/works`
  const fetchedAt = context.fetchedAt || new Date().toISOString()
  return payload.results.map((row) => {
    const value = normalizeOpenAlexWork(row)
    const readableUrl = safePublicWorkUrl(value.doi)
      || safePublicWorkUrl(value.openAlexId)
      || sourceUrl
    return provenanceRecord({
      kind: 'openalex:work',
      value,
      sourceId,
      sourceUrl: readableUrl,
      apiUrl: sourceUrl,
      fetchedAt,
      confidence: 1,
    })
  })
}

function safePublicWorkUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

async function openalexWorksImpl(query, context) {
  const http = httpClientFor(context)
  const requestUrl = buildOpenAlexWorksUrl(query, context.source).toString()
  const fetched = await http.fetchJson(requestUrl, {
    source: context.source,
    headers: { accept: 'application/json' },
    cacheKey: `openalex-works:${requestUrl}`,
  })
  const records = parseOpenAlexWorksResponse(fetched.json, {
    sourceId: context.source.id,
    sourceUrl: fetched.sourceUrl || requestUrl,
    fetchedAt: fetched.fetchedAt,
  })
  return {
    records,
    meta: {
      requestUrl,
      count: Number(fetched.json?.meta?.count) || 0,
      perPage: Number(fetched.json?.meta?.per_page) || null,
    },
  }
}

export const openalexWorksSource = createSourceAdapter({
  id: 'openalex-works',
  name: 'OpenAlex Works API',
  kind: 'api',
  baseUrl: OPENALEX_BASE_URL,
  enabled: true,
  rateLimitPerMin: 30,
  concurrency: 2,
  cacheTtlMs: 6 * 60 * 60 * 1_000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research; OpenAlex public API)',
  robotsPolicy: 'respect',
  timeoutMs: 20_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
    retryableStatuses: [429, 500, 502, 503, 504],
    retryNetworkErrors: true,
  },
  description: 'OpenAlex public works search for publications, authors, and topics.',
}, openalexWorksImpl)
