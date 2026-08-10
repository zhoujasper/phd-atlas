import { cleanOptionalText, finiteNumberOrNull } from './sourceSchemas.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import { httpClientFor, createSourceAdapter } from './sourceAdapter.js'
import { provenanceRecord } from './sourceProvenance.js'

export const NIH_REPORTER_BASE_URL = 'https://api.reporter.nih.gov/v2/projects/search'

/**
 * RePORTER takes PascalCase field names on the way in and answers in
 * snake_case. Asking for `project_abstract_text` returns nothing at all, which
 * is why several normalized fields used to come back empty.
 */
export const NIH_INCLUDE_FIELDS = Object.freeze([
  'ApplId',
  'ProjectNum',
  'ProjectTitle',
  'AbstractText',
  'AgencyIcAdmin',
  'FullStudySection',
  'FiscalYear',
  'PrincipalInvestigators',
  'Organization',
  'AwardAmount',
  'ProjectStartDate',
  'ProjectEndDate',
  'Terms',
  'ProjectDetailUrl',
])

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

/**
 * True when the criteria would not narrow the search at all.
 *
 * `include_active_projects` is not a filter -- a body carrying only that is a
 * valid request for the first page of every active project in the agency, and
 * RePORTER answers it with tens of thousands of results. Rendered under one
 * professor's name that reads as their funding record. The caller has to be
 * told to ask a real question instead.
 */
export function nihReporterCriteriaAreUnbounded(criteria = {}) {
  const narrowing = [
    'pi_names', 'org_names', 'advanced_text_search', 'agency', 'agency_ic_admin',
    'fiscal_years', 'project_nums', 'appl_ids', 'award_types', 'org_states',
  ]
  return !narrowing.some((key) => {
    const value = criteria[key]
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && value !== ''
  })
}

export function buildNihReporterBody(query = {}, config = {}) {
  const criteria = {
    include_active_projects: query.active !== false,
  }
  const fiscalYears = Array.isArray(query.fiscalYears)
    ? query.fiscalYears.map(Number).filter((year) => Number.isSafeInteger(year))
    : []
  if (fiscalYears.length) criteria.fiscal_years = fiscalYears
  const keyword = cleanOptionalText(query.keyword, 500)
  if (keyword) {
    criteria.advanced_text_search = {
      operator: String(query.operator || 'AND').toUpperCase(),
      search_field: cleanOptionalText(query.searchField, 80) || 'all',
      search_text: keyword,
    }
  }
  if (query.agency) criteria.agency = cleanOptionalText(query.agency, 120)
  if (query.institute) criteria.agency_ic_admin = cleanOptionalText(query.institute, 120)
  // pi_names entries are NameCriteria objects. A bare string is rejected by the
  // API with a type-conversion error rather than being coerced.
  const pi = cleanOptionalText(query.pi, 240)
  if (pi) criteria.pi_names = [{ any_name: pi }]
  const org = cleanOptionalText(query.org, 240)
  if (org) criteria.org_names = [org]
  return {
    criteria,
    limit: boundedInteger(query.limit, 50, 1, 100),
    offset: boundedInteger(query.offset, 0, 0, 100_000),
    include_fields: Array.isArray(query.includeFields) && query.includeFields.length
      ? query.includeFields
      : config.includeFields || NIH_INCLUDE_FIELDS,
    sort_field: cleanOptionalText(query.sortField, 80) || undefined,
    sort_order: query.sortOrder || undefined,
  }
}

function personName(person) {
  return cleanOptionalText(
    person?.full_name
      || person?.name
      || [person?.first_name, person?.middle_name, person?.last_name].filter(Boolean).join(' '),
    240,
  )
}

/** Every credited investigator, so relevance can check the whole team. */
function piNames(row) {
  const people = Array.isArray(row?.principal_investigators) ? row.principal_investigators : []
  const names = people.map(personName).filter(Boolean)
  const contact = cleanOptionalText(row?.contact_pi_name, 240)
  if (contact && !names.includes(contact)) names.push(contact)
  return names
}

/** `agency_ic_admin` is an object; stringifying it yields "[object Object]". */
function agencyName(value) {
  if (value && typeof value === 'object') {
    return cleanOptionalText(value.name || value.abbreviation || value.code, 200)
  }
  return cleanOptionalText(value, 200)
}

function normalizeNihProject(row) {
  const names = piNames(row)
  const applicationId = cleanOptionalText(row?.appl_id ?? row?.application_id, 80)
  return {
    applicationId,
    projectNumber: cleanOptionalText(row?.project_num, 80),
    title: cleanOptionalText(row?.project_title, 600),
    piName: names[0] ?? null,
    piNames: names,
    piCount: names.length,
    organizationName: cleanOptionalText(
      row?.organization?.org_name || row?.organization?.name || row?.org_name,
      300,
    ),
    organizationCity: cleanOptionalText(
      row?.organization?.org_city || row?.organization?.city || row?.organization_city,
      120,
    ),
    organizationState: cleanOptionalText(
      row?.organization?.org_state || row?.organization?.state || row?.organization_state,
      80,
    ),
    agencyIcAdmin: agencyName(row?.agency_ic_admin),
    studySection: cleanOptionalText(row?.full_study_section || row?.study_section, 200),
    fiscalYear: finiteNumberOrNull(row?.fiscal_year),
    startDate: cleanOptionalText(row?.project_start_date, 40),
    endDate: cleanOptionalText(row?.project_end_date, 40),
    awardAmount: finiteNumberOrNull(row?.award_amount),
    abstractText: cleanOptionalText(row?.abstract_text || row?.project_abstract_text, 10_000),
    projectTerms: (Array.isArray(row?.terms)
      ? row.terms
      : (typeof row?.terms === 'string' ? row.terms.split(';') : row?.project_terms) || [])
      .map((term) => cleanOptionalText(term, 160))
      .filter(Boolean)
      .slice(0, 40),
    // The public project page, so provenance can link a person to something
    // readable instead of an API endpoint that answers with JSON.
    detailUrl: cleanOptionalText(row?.project_detail_url, 500)
      || (applicationId ? `https://reporter.nih.gov/project-details/${encodeURIComponent(applicationId)}` : null),
  }
}

export function parseNihReporterResponse(payload, context = {}) {
  const rows = Array.isArray(payload?.results)
    ? payload.results
    : (Array.isArray(payload?.projects) ? payload.projects : null)
  if (!Array.isArray(rows)) {
    throw new SourceStructureChangedError(
      'NIH RePORTER response no longer contains results[].',
      context.sourceId || 'nih-reporter',
    )
  }
  const sourceId = context.sourceId || 'nih-reporter'
  const apiUrl = context.sourceUrl || NIH_REPORTER_BASE_URL
  const fetchedAt = context.fetchedAt || new Date().toISOString()
  return rows.map((row) => {
    const value = normalizeNihProject(row)
    return provenanceRecord({
      kind: 'nih:project',
      value,
      sourceId,
      // Provenance points at the readable project page; the API endpoint that
      // produced the row stays available as `apiUrl` for anyone who wants it.
      sourceUrl: value.detailUrl || apiUrl,
      apiUrl,
      fetchedAt,
      confidence: 1,
    })
  })
}

async function nihReporterImpl(query, context) {
  const http = httpClientFor(context)
  const requestUrl = context.source.baseUrl || NIH_REPORTER_BASE_URL
  const requestBody = buildNihReporterBody(query, context.source)
  if (nihReporterCriteriaAreUnbounded(requestBody.criteria)) {
    // Refuse rather than return the agency's whole active portfolio. An empty
    // result is honest; a full one would be presented as somebody's funding.
    return { records: [], meta: { requestUrl, total: 0, unbounded: true } }
  }
  const body = JSON.stringify(requestBody)
  const fetched = await http.fetchJson(requestUrl, {
    source: context.source,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body,
    cacheKey: `nih-reporter:${requestUrl}:${body}`,
  })
  const records = parseNihReporterResponse(fetched.json, {
    sourceId: context.source.id,
    sourceUrl: fetched.sourceUrl || requestUrl,
    fetchedAt: fetched.fetchedAt,
  })
  const total = Number(fetched.json?.meta?.total || fetched.json?.total)
  return {
    records,
    meta: {
      requestUrl,
      total: Number.isFinite(total) ? total : null,
    },
  }
}

export const nihReporterSource = createSourceAdapter({
  id: 'nih-reporter',
  name: 'NIH RePORTER API',
  kind: 'api',
  baseUrl: NIH_REPORTER_BASE_URL,
  enabled: true,
  rateLimitPerMin: 30,
  concurrency: 1,
  cacheTtlMs: 24 * 60 * 60 * 1_000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research; NIH public API)',
  robotsPolicy: 'respect',
  timeoutMs: 20_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
    retryableStatuses: [429, 502, 503, 504],
    retryNetworkErrors: true,
  },
  description: 'Official NIH RePORTER v2 search API. No key required for public projects.',
}, nihReporterImpl)
