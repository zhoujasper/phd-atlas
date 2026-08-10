import { cleanOptionalText } from './sourceSchemas.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import { httpClientFor, createSourceAdapter } from './sourceAdapter.js'
import { provenanceRecord } from './sourceProvenance.js'
import { comparePersonNames } from './sourceRelevance.js'

export const UKRI_PEOPLE_BASE_URL = 'https://gtr.ukri.org/gtr/api/persons'
export const UKRI_ACCEPT = 'application/vnd.rcuk.gtr.json-v7'

const PERSON_PROJECT_ROLES = new Set([
  'PI_PER',
  'COI_PER',
  'RESEARCH_PER',
  'RESEARCH_COI_PER',
  'FELLOW_PER',
])

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol === 'http:' && url.hostname === 'gtr.ukri.org') url.protocol = 'https:'
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function linksFor(value) {
  return Array.isArray(value?.links?.link) ? value.links.link : []
}

function personName(person) {
  return cleanOptionalText(
    [person?.firstName, person?.otherNames, person?.surname].filter(Boolean).join(' '),
    240,
  )
}

function grantReference(project) {
  const identifiers = Array.isArray(project?.identifiers?.identifier)
    ? project.identifiers.identifier
    : []
  const preferred = identifiers.find((entry) => /grant|reference/i.test(String(entry?.type || '')))
    || identifiers[0]
  return cleanOptionalText(preferred?.value || preferred?.identifier, 120)
}

function readableProjectUrl(project, apiUrl) {
  const reference = grantReference(project)
  return reference
    ? `https://gtr.ukri.org/projects?ref=${encodeURIComponent(reference)}`
    : apiUrl
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value))
  if (!Number.isFinite(timestamp)) return cleanOptionalText(value, 40)
  return new Date(timestamp).toISOString()
}

function sortableProjectDate(record) {
  const timestamp = Date.parse(record?.value?.endDate || record?.value?.startDate || '')
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

export function buildUkriPeopleUrl(query = {}, config = {}) {
  const url = new URL(config.baseUrl || UKRI_PEOPLE_BASE_URL)
  const name = cleanOptionalText(query.name, 240)
  url.searchParams.set('p', '1')
  url.searchParams.set('s', String(boundedInteger(query.candidateLimit, 10, 10, 30)))
  if (name) url.searchParams.set('q', name)
  return url
}

export function parseUkriPeopleResponse(payload, context = {}) {
  if (!Array.isArray(payload?.person)) {
    throw new SourceStructureChangedError(
      'UKRI Gateway to Research response no longer contains person[].',
      context.sourceId || 'ukri-gateway-projects',
    )
  }
  return payload.person
}

export function parseUkriProjectResponse(project, context = {}) {
  if (!project || typeof project !== 'object' || !project.id || !project.title) {
    throw new SourceStructureChangedError(
      'UKRI Gateway to Research project response is missing id/title.',
      context.sourceId || 'ukri-gateway-projects',
    )
  }
  const apiUrl = context.apiUrl || httpsUrl(project.href) || UKRI_PEOPLE_BASE_URL
  const value = {
    id: cleanOptionalText(project.id, 120),
    title: cleanOptionalText(project.title, 600),
    piName: cleanOptionalText(context.personName, 240),
    piNames: context.personName ? [cleanOptionalText(context.personName, 240)] : [],
    organizationName: cleanOptionalText(context.organizationName, 300),
    role: cleanOptionalText(context.role, 80),
    status: cleanOptionalText(project.status, 80),
    grantReference: grantReference(project),
    grantCategory: cleanOptionalText(project.grantCategory, 160),
    leadFunder: cleanOptionalText(project.leadFunder, 160),
    startDate: normalizeDate(project.start),
    endDate: normalizeDate(project.end),
    abstractText: cleanOptionalText(project.abstractText, 10_000),
    dataCaveat: 'UKRI GtR is updated quarterly; funded value is a commitment, not actual spend.',
    detailUrl: readableProjectUrl(project, apiUrl),
  }
  return provenanceRecord({
    kind: 'ukri:project',
    value,
    sourceId: context.sourceId || 'ukri-gateway-projects',
    sourceUrl: value.detailUrl,
    apiUrl,
    fetchedAt: context.fetchedAt || new Date().toISOString(),
    confidence: 1,
  })
}

async function ukriGatewayProjectsImpl(query, context) {
  const name = cleanOptionalText(query.name, 240)
  const requestUrl = buildUkriPeopleUrl(query, context.source).toString()
  if (!name) {
    return { records: [], meta: { requestUrl, total: 0, unbounded: true } }
  }

  const http = httpClientFor(context)
  const headers = { accept: UKRI_ACCEPT }
  const peopleResponse = await http.fetchJson(requestUrl, {
    source: context.source,
    headers,
    cacheKey: `ukri-people:${requestUrl}`,
  })
  const matchedPeople = parseUkriPeopleResponse(peopleResponse.json, {
    sourceId: context.source.id,
  })
    .map((person) => ({ person, verdict: comparePersonNames(name, personName(person)) }))
    .filter(({ verdict }) => verdict === 'exact' || verdict === 'strong' || verdict === 'initial')
  const strongPeople = matchedPeople.filter(({ verdict }) => verdict !== 'initial')
  const people = (strongPeople.length > 0 ? strongPeople : matchedPeople).slice(0, 4)

  const limit = boundedInteger(query.limit, 12, 1, 25)
  const organizationTimeoutMs = boundedInteger(
    context.organizationTimeoutMs,
    1_800,
    500,
    5_000,
  )
  let unavailableOrganizationLookups = 0
  const candidates = []
  for (const { person } of people) {
    const personDisplayName = personName(person)
    const organizationLink = linksFor(person).find((link) => link.rel === 'EMPLOYED')
    let organizationName = null
    const organizationUrl = httpsUrl(organizationLink?.href)
    if (organizationUrl) {
      try {
        const organization = await http.fetchJson(organizationUrl, {
          source: context.source,
          headers,
          cacheKey: `ukri-organization:${organizationUrl}`,
          timeoutMs: organizationTimeoutMs,
        })
        organizationName = cleanOptionalText(organization.json?.name, 300)
      } catch {
        // The person/project evidence is still usable. Missing organisation
        // context lowers the later match confidence instead of dropping facts.
        unavailableOrganizationLookups += 1
      }
    }

    for (const link of linksFor(person)) {
      if (!PERSON_PROJECT_ROLES.has(link.rel)) continue
      const apiUrl = httpsUrl(link.href)
      if (!apiUrl || candidates.some((entry) => entry.apiUrl === apiUrl)) continue
      candidates.push({
        apiUrl,
        personName: personDisplayName,
        organizationName,
        role: link.rel,
      })
      if (candidates.length >= limit) break
    }
    if (candidates.length >= limit) break
  }

  const fetchedAt = peopleResponse.fetchedAt || new Date().toISOString()
  const records = (await Promise.all(candidates.map(async (candidate) => {
    try {
      const project = await http.fetchJson(candidate.apiUrl, {
        source: context.source,
        headers,
        cacheKey: `ukri-project:${candidate.apiUrl}`,
      })
      return parseUkriProjectResponse(project.json, {
        ...candidate,
        sourceId: context.source.id,
        fetchedAt: project.fetchedAt || fetchedAt,
      })
    } catch {
      return null
    }
  }))).filter(Boolean)

  records.sort((left, right) => sortableProjectDate(right) - sortableProjectDate(left))
  return {
    records,
    warnings: [
      ...(people.length > 1 ? ['ukri-duplicate-person-candidates'] : []),
      ...(unavailableOrganizationLookups > 0 ? ['ukri-organization-context-unavailable'] : []),
    ],
    meta: {
      requestUrl,
      matchedPeople: people.length,
      attemptedProjects: candidates.length,
      unavailableOrganizationLookups,
      quarterlyData: true,
    },
  }
}

export const ukriGatewayProjectsSource = createSourceAdapter({
  id: 'ukri-gateway-projects',
  name: 'UKRI Gateway to Research',
  kind: 'api',
  baseUrl: UKRI_PEOPLE_BASE_URL,
  enabled: true,
  rateLimitPerMin: 120,
  concurrency: 3,
  cacheTtlMs: 24 * 60 * 60 * 1_000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research; UKRI public API)',
  robotsPolicy: 'respect',
  timeoutMs: 25_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 400,
    maxDelayMs: 10_000,
    retryableStatuses: [429, 500, 502, 503, 504],
    retryNetworkErrors: true,
  },
  description: 'Official UKRI Gateway to Research v7 API. Updated quarterly; public projects only.',
}, ukriGatewayProjectsImpl)
