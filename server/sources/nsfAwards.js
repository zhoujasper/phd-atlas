import { cleanOptionalText, finiteNumberOrNull, cleanBooleanOrNull } from './sourceSchemas.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import { httpClientFor, createSourceAdapter } from './sourceAdapter.js'
import { provenanceRecord } from './sourceProvenance.js'

export const NSF_AWARDS_BASE_URL = 'https://api.nsf.gov/services/v1/awards.json'

export const NSF_AWARDS_PRINT_FIELDS = Object.freeze([
  'id',
  'title',
  'pdPIName',
  'pi',
  'coPDPI',
  'startDate',
  'expDate',
  'estimatedTotalAmt',
  'fundsObligatedAmt',
  'activeAwd',
  'awardeeName',
  'awardeeCity',
  'awardeeStateCode',
  'fundProgramName',
  'abstractText',
  'date',
  'program',
  'dirAbbr',
  'divAbbr',
])

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

export function buildNsfAwardsUrl(query = {}, config = {}) {
  const url = new URL(config.baseUrl || NSF_AWARDS_BASE_URL)
  url.searchParams.set('rpp', String(boundedInteger(query.limit, 25, 1, 25)))
  url.searchParams.set('offset', String(boundedInteger(query.offset, 0, 0, 10_000)))
  const fields = Array.isArray(query.printFields) && query.printFields.length
    ? query.printFields
    : NSF_AWARDS_PRINT_FIELDS
  url.searchParams.set('printFields', fields.join(','))

  const optionalText = [
    ['keyword', query.keyword],
    ['pdPIName', query.pi],
    ['awardeeName', query.awardee],
    ['awardeeStateCode', query.state],
    ['fundProgramName', query.programName],
    ['startDateStart', query.startDate],
    ['startDateEnd', query.endDate],
    ['expDateStart', query.expirationStartDate],
    ['expDateEnd', query.expirationEndDate],
  ]
  for (const [name, value] of optionalText) {
    const text = cleanOptionalText(value, 240)
    if (text) url.searchParams.set(name, text)
  }
  if (query.activeAwards !== undefined) {
    url.searchParams.set('ActiveAwards', query.activeAwards ? 'true' : 'false')
  }
  if (query.expiredAwards !== undefined) {
    url.searchParams.set('ExpiredAwards', query.expiredAwards ? 'true' : 'false')
  }
  return url
}

function piName(row) {
  const pi = row?.pi
  const piObjectName = pi
    ? [pi.firstName, pi.lastName].filter(Boolean).join(' ').trim()
    : ''
  return cleanOptionalText(
    row?.pdPIName
      || [row?.piFirstName, row?.piLastName].filter(Boolean).join(' ')
      || piObjectName,
    240,
  )
}

export const NSF_AWARD_PAGE_URL = 'https://www.nsf.gov/awardsearch/showAward'

/**
 * True when the query would not narrow the search.
 *
 * NSF's Award Search does not fail an unmatched `keyword`; it drops it and
 * answers with the newest awards. A query that constrains nothing therefore
 * comes back full rather than empty, and every one of those awards belongs to
 * somebody the caller never asked about.
 */
export function nsfAwardsQueryIsUnbounded(url) {
  const narrowing = [
    'keyword', 'pdPIName', 'awardeeName', 'awardeeStateCode', 'fundProgramName',
    'startDateStart', 'startDateEnd', 'expDateStart', 'expDateEnd', 'id',
  ]
  return !narrowing.some((name) => url.searchParams.get(name))
}

function normalizeNsfAward(row) {
  const id = cleanOptionalText(row?.id, 80)
  return {
    id,
    title: cleanOptionalText(row?.title, 500),
    piName: piName(row),
    coPiNames: Array.isArray(row?.coPDPI)
      ? row.coPDPI.map((person) => cleanOptionalText(
        typeof person === 'string' ? person : person?.name,
        240,
      )).filter(Boolean)
      : [],
    // The public award page, so provenance links to something a person (or an
    // agent following the link) can actually read.
    detailUrl: id ? `${NSF_AWARD_PAGE_URL}?AWD_ID=${encodeURIComponent(id)}` : null,
    awardeeName: cleanOptionalText(row?.awardeeName || row?.awardee, 300),
    city: cleanOptionalText(row?.awardeeCity, 120),
    stateCode: cleanOptionalText(row?.awardeeStateCode, 40),
    startDate: cleanOptionalText(row?.startDate, 40),
    expDate: cleanOptionalText(row?.expDate, 40),
    estimatedTotalAmt: finiteNumberOrNull(row?.estimatedTotalAmt),
    fundsObligatedAmt: finiteNumberOrNull(row?.fundsObligatedAmt),
    activeAwd: cleanBooleanOrNull(row?.activeAwd),
    fundProgramName: cleanOptionalText(row?.fundProgramName, 300),
    abstractText: cleanOptionalText(row?.abstractText, 6_000),
    date: cleanOptionalText(row?.date, 40),
    program: cleanOptionalText(row?.program, 200),
    dirAbbr: cleanOptionalText(row?.dirAbbr, 40),
    divAbbr: cleanOptionalText(row?.divAbbr, 40),
  }
}

export function parseNsfAwardsResponse(payload, context = {}) {
  const envelope = payload?.response || payload
  const rows = Array.isArray(envelope?.award)
    ? envelope.award
    : (Array.isArray(envelope?.awards) ? envelope.awards : null)
  if (!Array.isArray(rows)) {
    throw new SourceStructureChangedError(
      'NSF Award Search response no longer contains response.award[].',
      context.sourceId || 'nsf-awards',
    )
  }
  const sourceId = context.sourceId || 'nsf-awards'
  const apiUrl = context.sourceUrl || NSF_AWARDS_BASE_URL
  const fetchedAt = context.fetchedAt || new Date().toISOString()
  return rows.map((row) => {
    const value = normalizeNsfAward(row)
    return provenanceRecord({
      kind: 'nsf:award',
      value,
      sourceId,
      sourceUrl: value.detailUrl || apiUrl,
      apiUrl,
      fetchedAt,
      confidence: 1,
    })
  })
}

async function nsfAwardsImpl(query, context) {
  const http = httpClientFor(context)
  const url = buildNsfAwardsUrl(query, context.source)
  if (nsfAwardsQueryIsUnbounded(url)) {
    // Returning nothing is honest. Returning the newest twenty five awards
    // under a professor's name is not, and that is what NSF would answer with.
    return { records: [], meta: { requestUrl: url.toString(), total: 0, unbounded: true } }
  }
  const requestUrl = url.toString()
  const fetched = await http.fetchJson(requestUrl, {
    source: context.source,
    headers: { accept: 'application/json' },
    cacheKey: `nsf-awards:${requestUrl}`,
  })
  const records = parseNsfAwardsResponse(fetched.json, {
    sourceId: context.source.id,
    sourceUrl: fetched.sourceUrl || requestUrl,
    fetchedAt: fetched.fetchedAt,
  })
  const total = Number(fetched.json?.response?.totalResults)
  return {
    records,
    meta: {
      requestUrl,
      total: Number.isFinite(total) ? total : null,
    },
  }
}

export const nsfAwardsSource = createSourceAdapter({
  id: 'nsf-awards',
  name: 'NSF Award Search API',
  kind: 'api',
  baseUrl: NSF_AWARDS_BASE_URL,
  enabled: true,
  rateLimitPerMin: 30,
  concurrency: 1,
  cacheTtlMs: 24 * 60 * 60 * 1_000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research; NSF public API)',
  robotsPolicy: 'respect',
  timeoutMs: 20_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
    retryableStatuses: [429, 502, 503, 504],
    retryNetworkErrors: true,
  },
  description: 'Official NSF award API. No key required for public award records.',
}, nsfAwardsImpl)
