import { withAbortDeadline } from './abortDeadline.js'
import {
  cancelResponseBody,
  readBoundedResponseJson,
  readBoundedResponseText,
} from './boundedResponse.js'
import {
  buildOpenAlexWorkQueryPlan,
  resolveDiscoverOpenAlexTopics,
} from './discover-openalex-topics.js'

const OPENALEX_BASE = 'https://api.openalex.org'
const ROR_BASE = 'https://api.ror.org/v2'
const CROSSREF_BASE = 'https://api.crossref.org'
const EUROPE_PMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest'
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const SCHOLARLY_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
const INSTITUTION_STOP_WORDS = new Set([
  'and', 'at', 'college', 'de', 'for', 'in', 'institute', 'of', 'school', 'the',
  'universita', 'universitat', 'universite', 'university',
])
/**
 * Stop words for this module only. A second list under the same name in another
 * Discover module is intentionally different — they strip different vocabulary —
 * so they carry distinct names rather than looking like copies that drifted.
 */
const SCHOLARLY_QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'for', 'in', 'of', 'on', 'research', 'the', 'to', 'using', 'with',
])

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function hostMatches(left, right) {
  const a = String(left || '').toLowerCase().replace(/^www\./, '')
  const b = String(right || '').toLowerCase().replace(/^www\./, '')
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)))
}

function normalizedWords(value, ignored = new Set()) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !ignored.has(word))
}

function nameScore(left, right) {
  const a = new Set(normalizedWords(left, INSTITUTION_STOP_WORDS))
  const b = new Set(normalizedWords(right, INSTITUTION_STOP_WORDS))
  return [...a].filter((word) => b.has(word)).length / Math.max(1, Math.min(a.size, b.size))
}

function retryDelayMs(error, attempt) {
  const raw = String(error?.retryAfter || '').trim()
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3_000, seconds * 1_000)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.min(3_000, Math.max(0, date - Date.now()))
  return Math.min(2_000, 250 * (2 ** attempt))
}

async function fetchJson(url, {
  fetchImpl,
  timeoutMs = 15_000,
  attempts = 3,
  userAgent = 'PhD-Atlas/0.1 (scholarly lead research)',
} = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withAbortDeadline(async (signal) => {
        const response = await fetchImpl(url, {
          signal,
          headers: { accept: 'application/json', 'user-agent': userAgent },
        })
        if (!response.ok) {
          // Providers explain refusals in the body. Discarding it turned an
          // exhausted API budget into a generic failure that the caller
          // reported as "institution not resolved", so the operator saw a
          // school-matching problem instead of "configure a key".
          let detail = ''
          try {
            const raw = await readBoundedResponseText(response, {
              maxBytes: 4_096,
              signal,
              bodyKind: 'scholarly provider error',
            })
            detail = String(raw || '').slice(0, 600)
          } catch {
            await cancelResponseBody(response)
          }
          const error = new Error(`HTTP ${response.status}`)
          error.status = response.status
          error.retryAfter = response.headers?.get?.('retry-after') || ''
          error.detail = detail
          if (/insufficient budget|add funds|quota|rate limit exceeded/i.test(detail)) {
            // Budget resets on a daily boundary, so retrying inside one request
            // only multiplies the wait on a guaranteed failure.
            error.code = 'SCHOLARLY_PROVIDER_QUOTA_EXHAUSTED'
            error.terminal = true
          }
          throw error
        }
        return await readBoundedResponseJson(response, {
          maxBytes: SCHOLARLY_RESPONSE_MAX_BYTES,
          signal,
          bodyKind: 'scholarly provider response',
        })
      }, { timeoutMs })
    } catch (error) {
      lastError = error
      if (
        attempt + 1 >= attempts
        || error?.terminal === true
        || (error?.status && !RETRYABLE_STATUS.has(error.status))
      ) break
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(error, attempt)))
    }
  }
  throw lastError || new Error('Scholarly request failed')
}

function applyOpenAlexAccess(url) {
  if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY)
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(process.env.OPENALEX_MAILTO || ''))) {
    url.searchParams.set('mailto', process.env.OPENALEX_MAILTO)
  }
  return url
}

function applyCrossrefAccess(url) {
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(process.env.CROSSREF_MAILTO || ''))) {
    url.searchParams.set('mailto', process.env.CROSSREF_MAILTO)
  }
  return url
}

function rorDisplayName(item) {
  return item?.names?.find((name) => name.types?.includes('ror_display'))?.value
    || item?.names?.find((name) => name.types?.includes('label'))?.value
    || ''
}

async function resolveRor(school, officialUrl, fetchImpl) {
  const url = new URL(`${ROR_BASE}/organizations`)
  url.searchParams.set('query', school)
  const payload = await fetchJson(url, { fetchImpl })
  const officialHost = safeUrl(officialUrl)?.hostname
  const items = (payload?.items || []).map((item) => ({
    item,
    score: Math.max(
      nameScore(school, rorDisplayName(item)),
      (item.domains || []).some((domain) => hostMatches(domain, officialHost)) ? 1 : 0,
    ),
  })).sort((left, right) => right.score - left.score)
  const match = items[0]
  if (!match || match.score < 0.68) return null
  return {
    id: match.item.id,
    displayName: rorDisplayName(match.item),
    domains: (match.item.domains || []).slice(0, 8),
  }
}

async function resolveOpenAlex(school, officialUrl, ror, fetchImpl) {
  const url = new URL(`${OPENALEX_BASE}/institutions`)
  url.searchParams.set('search', school)
  url.searchParams.set('per-page', '8')
  url.searchParams.set('select', 'id,display_name,ror,homepage_url,country_code,works_count,cited_by_count')
  const payload = await fetchJson(applyOpenAlexAccess(url), { fetchImpl })
  const officialHost = safeUrl(officialUrl)?.hostname
  const results = (payload?.results || []).map((item) => ({
    item,
    score: Math.max(
      nameScore(school, item.display_name),
      ror?.id && item.ror === ror.id ? 1 : 0,
      hostMatches(safeUrl(item.homepage_url)?.hostname, officialHost) ? 1 : 0,
    ),
  })).sort((left, right) => right.score - left.score)
  return results[0]?.score >= 0.68 ? results[0].item : null
}

function workSource(work) {
  return safeUrl(work?.doi)?.href || safeUrl(work?.id)?.href || ''
}

function cleanOrcid(value) {
  const match = String(value || '').match(/(?:orcid\.org\/)?(\d{4}-\d{4}-\d{4}-[\dX]{4})/i)
  return match ? `https://orcid.org/${match[1].toUpperCase()}` : null
}

function researcherNameKey(value) {
  return normalizedWords(value).join(' ')
}

function likelyIndividualResearcherName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim()
  if (!name || name.length > 140) return false
  if (/(?:\b(?:collaboration|consortium|committee|initiative|network|project|registry|research group|study group|task force|team|working group)\b|研究组|课题组|研究团队)/i.test(name)) {
    return false
  }
  if (/\b(?:scholarship|research|studies)\s+at\s+(?:the\s+)?[\p{L}\p{N} -]+$/iu.test(name)) return false
  const cjk = name.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []
  if (cjk.length >= 2) return true
  const words = name.match(/[\p{L}][\p{L}'’-]*/gu) || []
  return words.length >= 2 && words.length <= 8
}

/**
 * Prefer distinct Latin-script aliases first so bilingual query pairs do not
 * consume the entire provider budget, then retain native-language terms for
 * local publication metadata. This is a lead-recall plan only.
 */
export function buildScholarlyQueryPlan(values, { limit = 8 } = {}) {
  const boundedLimit = Math.min(12, Math.max(1, Number(limit) || 8))
  const terms = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : [values]) {
    const term = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const key = term.normalize('NFKC').toLocaleLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  const latin = terms.filter((term) => /[a-z]/i.test(term))
  const native = terms.filter((term) => !/[a-z]/i.test(term))
  const output = [...latin.slice(0, boundedLimit)]
  for (const term of native) {
    if (output.length >= boundedLimit) break
    output.push(term)
  }
  for (const term of terms) {
    if (output.length >= boundedLimit) break
    if (!output.includes(term)) output.push(term)
  }
  return output
}

async function findOpenAlexResearchers(
  institution,
  workQueryPlan,
  fetchImpl,
  maxResearchers = 30,
  maxPagesPerQuery = 2,
) {
  const authors = new Map()
  const boundedPages = Math.max(1, Math.min(3, Number(maxPagesPerQuery) || 2))
  for (const planItem of workQueryPlan) {
    const query = planItem.query
    const url = new URL(`${OPENALEX_BASE}/works`)
    const filters = [
      `authorships.institutions.id:${institution.id}`,
      'from_publication_date:2021-01-01',
    ]
    if (planItem.kind === 'topic' && planItem.topicId) filters.push(`topics.id:${planItem.topicId}`)
    else url.searchParams.set('search', query)
    url.searchParams.set('filter', filters.join(','))
    url.searchParams.set('sort', planItem.kind === 'topic' ? 'cited_by_count:desc' : 'relevance_score:desc')
    url.searchParams.set('per-page', '100')
    url.searchParams.set('select', 'id,doi,display_name,publication_year,cited_by_count,authorships,topics,keywords')
    const accessUrl = applyOpenAlexAccess(url)
    let cursor = null
    for (let pageIndex = 0; pageIndex < boundedPages; pageIndex += 1) {
      if (cursor) url.searchParams.set('cursor', cursor)
      const payload = await fetchJson(accessUrl, { fetchImpl })
      for (const work of payload?.results || []) {
        const topicSignal = [
          work.display_name,
          ...(work.topics || []).map((topic) => topic?.display_name),
          ...(work.keywords || []).map((keyword) => keyword?.display_name),
        ].filter(Boolean).join(' ')
        if (queryTitleScore(query, topicSignal) < 0.32) continue
        for (const authorship of work.authorships || []) {
          if (!(authorship.institutions || []).some((item) => item.id === institution.id)) continue
          const author = authorship.author
          if (!author?.id || !author?.display_name) continue
          if (!likelyIndividualResearcherName(author.display_name)) continue
          const current = authors.get(author.id) || {
            openAlexId: author.id,
            name: author.display_name,
            orcid: cleanOrcid(author.orcid),
            profileUrl: author.id,
            score: 0,
            providers: ['openalex'],
            matchedQueries: [],
            matchedTopics: [],
            recentWorks: [],
            workIds: new Set(),
          }
          if (!current.matchedQueries.includes(query)) current.matchedQueries.push(query)
          if (planItem.kind === 'topic' && planItem.topicId) {
            const matchedTopic = {
              id: planItem.topicId,
              name: planItem.topicName,
              domain: planItem.domain,
              field: planItem.field,
              confidence: planItem.confidence,
            }
            if (!current.matchedTopics.some((topic) => topic.id === matchedTopic.id)) {
              current.matchedTopics.push(matchedTopic)
            }
          }
          if (!current.workIds.has(work.id)) {
            current.score += 1 + Math.log10(1 + Math.max(0, Number(work.cited_by_count) || 0))
            current.workIds.add(work.id)
          }
          const source = workSource(work)
          if (current.recentWorks.length < 20 && source && !current.recentWorks.some((item) => item.source === source)) {
            current.recentWorks.push({
              title: String(work.display_name || '').slice(0, 300),
              year: work.publication_year || null,
              citedByCount: Math.max(0, Number(work.cited_by_count) || 0),
              source,
              matchedQuery: query,
              matchedTopic: planItem.kind === 'topic' ? planItem.topicName : null,
            })
          }
          authors.set(author.id, current)
        }
      }
      const nextCursor = payload?.meta?.next_cursor
      if (
        !nextCursor
        || String(nextCursor).toLowerCase() === 'null'
        || String(nextCursor) === String(cursor)
      ) break
      cursor = String(nextCursor)
    }
  }
  return [...authors.values()]
    .map(({ workIds: _workIds, ...author }) => author)
    .sort((left, right) => (right.matchedQueries.length - left.matchedQueries.length) || (right.score - left.score))
    .slice(0, Math.min(500, Math.max(1, Number(maxResearchers) || 30)))
}

function queryTitleScore(query, title) {
  const queryWords = normalizedWords(query, SCHOLARLY_QUERY_STOP_WORDS)
  const titleWords = normalizedWords(title, SCHOLARLY_QUERY_STOP_WORDS)
  if (!queryWords.length || !titleWords.length) return 0
  const titleSet = new Set(titleWords)
  const tokenCoverage = queryWords.filter((word) => titleSet.has(word)).length / queryWords.length
  if (queryWords.length === 1) return tokenCoverage
  const titleBigrams = new Set(titleWords.slice(0, -1).map((word, index) => `${word} ${titleWords[index + 1]}`))
  const queryBigrams = queryWords.slice(0, -1).map((word, index) => `${word} ${queryWords[index + 1]}`)
  const bigramCoverage = queryBigrams.filter((bigram) => titleBigrams.has(bigram)).length / queryBigrams.length
  return tokenCoverage * 0.65 + bigramCoverage * 0.35
}

function crossrefPublishedYear(work) {
  return Number(work?.published?.['date-parts']?.[0]?.[0])
    || Number(work?.published_online?.['date-parts']?.[0]?.[0])
    || Number(work?.published_print?.['date-parts']?.[0]?.[0])
    || null
}

function affiliationMatches(affiliations, institutionNames) {
  return (affiliations || []).some((affiliation) => (
    institutionNames.some((institutionName) => nameScore(affiliation?.name, institutionName) >= 0.78)
  ))
}

function affiliationTextMatches(affiliations, institutionNames) {
  return (affiliations || []).some((affiliation) => (
    institutionNames.some((institutionName) => nameScore(affiliation, institutionName) >= 0.78)
  ))
}

async function findCrossrefResearchers({
  school,
  institution,
  ror,
  queries,
  fetchImpl,
  maxResearchers = 30,
}) {
  const authors = new Map()
  const institutionNames = [...new Set([
    school,
    institution?.display_name,
    ror?.displayName,
  ].map((value) => String(value || '').trim()).filter(Boolean))]
  for (const query of queries.slice(0, 2)) {
    const url = new URL(`${CROSSREF_BASE}/works`)
    url.searchParams.set('query.affiliation', institution?.display_name || ror?.displayName || school)
    url.searchParams.set('query.bibliographic', query)
    url.searchParams.set('filter', 'from-pub-date:2021-01-01')
    url.searchParams.set('rows', '75')
    url.searchParams.set('select', 'DOI,title,author,published,published-online,published-print,is-referenced-by-count')
    const payload = await fetchJson(applyCrossrefAccess(url), {
      fetchImpl,
      userAgent: 'PhD-Atlas/0.1 (Crossref scholarly lead research)',
    })
    for (const work of payload?.message?.items || []) {
      const title = String(work?.title?.[0] || '').trim()
      if (queryTitleScore(query, title) < 0.45) continue
      const doi = String(work?.DOI || '').trim()
      const source = safeUrl(doi ? `https://doi.org/${doi}` : '')?.href || ''
      for (const author of work?.author || []) {
        if (!affiliationMatches(author?.affiliation, institutionNames)) continue
        const name = `${author?.given || ''} ${author?.family || ''}`.replace(/\s+/g, ' ').trim()
        if (!likelyIndividualResearcherName(name)) continue
        const nameKey = researcherNameKey(name)
        if (!nameKey) continue
        const orcid = cleanOrcid(author?.ORCID)
        const key = orcid || nameKey
        const current = authors.get(key) || {
          name,
          orcid,
          profileUrl: orcid || '',
          score: 0,
          providers: ['crossref'],
          matchedQueries: [],
          recentWorks: [],
          workIds: new Set(),
        }
        if (!current.matchedQueries.includes(query)) current.matchedQueries.push(query)
        if (doi && !current.workIds.has(doi)) {
          current.score += 0.7 + Math.log10(1 + Math.max(0, Number(work?.['is-referenced-by-count']) || 0)) * 0.7
          current.workIds.add(doi)
        }
        if (source && current.recentWorks.length < 20 && !current.recentWorks.some((item) => item.source === source)) {
          current.recentWorks.push({
            title: title.slice(0, 300),
            year: crossrefPublishedYear(work),
            citedByCount: Math.max(0, Number(work?.['is-referenced-by-count']) || 0),
            source,
            matchedQuery: query,
          })
        }
        authors.set(key, current)
      }
    }
  }
  return [...authors.values()]
    .map(({ workIds: _workIds, ...author }) => author)
    .sort((left, right) => (right.matchedQueries.length - left.matchedQueries.length) || (right.score - left.score))
    .slice(0, Math.min(500, Math.max(1, Number(maxResearchers) || 30)))
}

function europePmcAuthorAffiliations(author) {
  return (author?.authorAffiliationDetailsList?.authorAffiliation || [])
    .map((entry) => String(entry?.affiliation || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function europePmcAuthorOrcid(author) {
  const ids = [
    author?.authorId,
    ...(author?.authorIdList?.authorId || []),
  ].filter(Boolean)
  const item = ids.find((entry) => String(entry?.type || '').toUpperCase() === 'ORCID')
  return cleanOrcid(item?.value)
}

function europePmcSource(work) {
  const doi = String(work?.doi || '').trim()
  if (doi) return safeUrl(`https://doi.org/${doi}`)?.href || ''
  const source = encodeURIComponent(String(work?.source || '').trim())
  const id = encodeURIComponent(String(work?.id || '').trim())
  return source && id ? `https://europepmc.org/article/${source}/${id}` : ''
}

function europePmcSearchPhrase(value) {
  return String(value || '')
    .replace(/["\\\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function europePmcMeshHeadings(work) {
  return (work?.meshHeadingList?.meshHeading || [])
    .map((heading) => String(heading?.descriptorName || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

async function findEuropePmcResearchers({
  school,
  institution,
  ror,
  queries,
  fetchImpl,
  maxResearchers = 30,
}) {
  const authors = new Map()
  const institutionNames = [...new Set([
    school,
    institution?.display_name,
    ror?.displayName,
  ].map((value) => String(value || '').trim()).filter(Boolean))]
  const affiliationQuery = europePmcSearchPhrase(institution?.display_name || ror?.displayName || school)
  for (const rawQuery of buildScholarlyQueryPlan(queries, { limit: 2 })) {
    const query = europePmcSearchPhrase(rawQuery)
    if (!query || !affiliationQuery) continue
    const url = new URL(`${EUROPE_PMC_BASE}/search`)
    url.searchParams.set(
      'query',
      `"${query}" AND AFFILIATION:"${affiliationQuery}" AND FIRST_PDATE:[2021-01-01 TO 3000-12-31]`,
    )
    url.searchParams.set('format', 'json')
    url.searchParams.set('resultType', 'core')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('synonym', 'true')
    const payload = await fetchJson(url, {
      fetchImpl,
      userAgent: 'PhD-Atlas/0.1 (Europe PMC biomedical lead research)',
    })
    for (const work of payload?.resultList?.result || []) {
      const meshHeadings = europePmcMeshHeadings(work)
      const topicSignal = [
        work?.title,
        work?.abstractText,
        ...meshHeadings,
      ].filter(Boolean).join(' ')
      if (queryTitleScore(query, topicSignal) < 0.25) continue
      const workId = `${work?.source || ''}:${work?.id || work?.doi || ''}`
      const source = europePmcSource(work)
      for (const author of work?.authorList?.author || []) {
        const affiliations = europePmcAuthorAffiliations(author)
        if (!affiliationTextMatches(affiliations, institutionNames)) continue
        const name = `${author?.firstName || ''} ${author?.lastName || ''}`
          .replace(/\s+/g, ' ')
          .trim() || String(author?.fullName || '').trim()
        if (!likelyIndividualResearcherName(name)) continue
        const nameKey = researcherNameKey(name)
        if (!nameKey) continue
        const orcid = europePmcAuthorOrcid(author)
        const key = orcid || nameKey
        const current = authors.get(key) || {
          name,
          orcid,
          profileUrl: orcid || '',
          score: 0,
          providers: ['europepmc'],
          matchedQueries: [],
          matchedTopics: [],
          recentWorks: [],
          workIds: new Set(),
        }
        if (!current.matchedQueries.includes(query)) current.matchedQueries.push(query)
        if (workId && !current.workIds.has(workId)) {
          current.score += 0.9 + Math.log10(1 + Math.max(0, Number(work?.citedByCount) || 0)) * 0.8
          current.workIds.add(workId)
        }
        if (source && current.recentWorks.length < 20 && !current.recentWorks.some((item) => item.source === source)) {
          current.recentWorks.push({
            title: String(work?.title || '').slice(0, 300),
            year: Number(work?.pubYear) || null,
            citedByCount: Math.max(0, Number(work?.citedByCount) || 0),
            source,
            matchedQuery: query,
            meshHeadings: meshHeadings.slice(0, 6),
          })
        }
        authors.set(key, current)
      }
    }
  }
  return [...authors.values()]
    .map(({ workIds: _workIds, ...author }) => author)
    .sort((left, right) => (right.matchedQueries.length - left.matchedQueries.length) || (right.score - left.score))
    .slice(0, Math.min(500, Math.max(1, Number(maxResearchers) || 30)))
}

function mergeResearchers(groups, maxResearchers) {
  const merged = []
  const byIdentity = new Map()
  for (const candidate of groups.flat()) {
    const keys = [
      candidate?.orcid ? `orcid:${candidate.orcid.toLowerCase()}` : '',
      researcherNameKey(candidate?.name) ? `name:${researcherNameKey(candidate.name)}` : '',
    ].filter(Boolean)
    let current = keys.map((key) => byIdentity.get(key)).find(Boolean)
    if (!current) {
      current = {
        ...candidate,
        providers: [...new Set(candidate.providers || [])],
        matchedQueries: [...new Set(candidate.matchedQueries || [])],
        recentWorks: [...(candidate.recentWorks || [])],
      }
      merged.push(current)
    } else {
      if (String(candidate.name || '').length > String(current.name || '').length) current.name = candidate.name
      current.openAlexId ||= candidate.openAlexId || null
      current.orcid ||= candidate.orcid || null
      current.profileUrl ||= candidate.profileUrl || ''
      current.score = Number(current.score || 0) + Number(candidate.score || 0)
      current.providers = [...new Set([...(current.providers || []), ...(candidate.providers || [])])]
      current.matchedQueries = [...new Set([...(current.matchedQueries || []), ...(candidate.matchedQueries || [])])]
      current.matchedTopics = [...(current.matchedTopics || []), ...(candidate.matchedTopics || [])]
        .filter((topic, index, all) => topic?.id && all.findIndex((item) => item?.id === topic.id) === index)
        .slice(0, 8)
      current.recentWorks = [...(current.recentWorks || []), ...(candidate.recentWorks || [])]
        .filter((work, index, all) => work?.source && all.findIndex((item) => item?.source === work.source) === index)
        .slice(0, 20)
    }
    for (const key of keys) byIdentity.set(key, current)
    if (current.orcid) byIdentity.set(`orcid:${current.orcid.toLowerCase()}`, current)
    const currentNameKey = researcherNameKey(current.name)
    if (currentNameKey) byIdentity.set(`name:${currentNameKey}`, current)
  }
  return merged
    .sort((left, right) => (
      (right.matchedQueries?.length || 0) - (left.matchedQueries?.length || 0)
      || (right.providers?.length || 0) - (left.providers?.length || 0)
      || Number(right.score || 0) - Number(left.score || 0)
    ))
    .slice(0, Math.min(500, Math.max(1, Number(maxResearchers) || 30)))
}

function compactTopicResolution(topicResolution) {
  return {
    status: topicResolution?.status || 'unavailable',
    searchedTerms: (topicResolution?.searchedTerms || []).slice(0, 12),
    failures: Math.max(0, Number(topicResolution?.failures) || 0),
    topics: (topicResolution?.topics || []).slice(0, 8).map((topic) => ({
      query: topic.query,
      id: topic.id,
      displayName: topic.displayName,
      confidence: topic.confidence,
      primaryForQuery: topic.primaryForQuery === true,
      domain: topic.domain,
      field: topic.field,
      subfield: topic.subfield,
    })),
  }
}

function compactDisciplinePlan(plan) {
  if (!plan || typeof plan !== 'object') return null
  return {
    taxonomyVersion: plan.taxonomyVersion,
    broadDomains: (plan.broadDomains || []).slice(0, 6),
    disciplines: (plan.disciplines || []).slice(0, 30),
    providerHints: (plan.providerHints || []).slice(0, 12),
    vocabularies: (plan.vocabularies || []).slice(0, 12),
  }
}

export function shouldUseEuropePmcForDiscipline(disciplinePlan, topicResolution) {
  if ((disciplinePlan?.providerHints || []).includes('europepmc')) return true
  return (topicResolution?.topics || []).some((topic) => (
    topic?.primaryForQuery === true && (
      /(?:health|life) sciences?/i.test(String(topic?.domain?.displayName || ''))
      || /(?:medicine|biochemistry|genetics|immunology|neuroscience|pharmacology|nursing|dentistry)/i
        .test(String(topic?.field?.displayName || ''))
    )
  ))
}

export async function collectScholarlyEvidence({
  schools,
  query,
  disciplinePlan = null,
  topicResolution = null,
  fetchImpl = globalThis.fetch,
  concurrency = 3,
  maxResearchersPerSchool = 30,
  maxOpenAlexPagesPerQuery = 2,
  onProgress,
} = {}) {
  const targets = (schools || []).filter((school) => school?.crawlStatus === 'ok')
  const queries = buildScholarlyQueryPlan(query, { limit: 8 })
  if (!queries.length) queries.push('doctoral research')
  const resolvedTopics = topicResolution || await resolveDiscoverOpenAlexTopics({
    terms: queries,
    fetchImpl,
    limit: 8,
  }).catch(() => ({
    status: 'unavailable',
    searchedTerms: queries,
    topics: [],
    failures: queries.length,
  }))
  const openAlexWorkPlan = buildOpenAlexWorkQueryPlan({
    terms: queries,
    topics: resolvedTopics.topics,
    limit: 8,
  })
  const useEuropePmc = shouldUseEuropePmcForDiscipline(disciplinePlan, resolvedTopics)
  const europePmcQueries = [...new Set([
    ...(disciplinePlan?.disciplines || [])
      .filter((discipline) => (discipline?.providers || []).includes('europepmc'))
      .map((discipline) => discipline.canonicalTerm),
    ...(resolvedTopics?.topics || [])
      .filter((topic) => (
        topic?.primaryForQuery === true
        && /(?:health|life) sciences?/i.test(String(topic?.domain?.displayName || ''))
      ))
      .map((topic) => topic.query),
    ...queries,
  ].map((value) => String(value || '').trim()).filter(Boolean))]
  const results = new Array(targets.length)
  let cursor = 0
  let completed = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), targets.length || 1) }, async () => {
    while (cursor < targets.length) {
      const index = cursor++
      const school = targets[index]
      try {
        const ror = await resolveRor(school.school, school.officialUrl, fetchImpl).catch(() => null)
        let institution = null
        let openAlexError = null
        let openAlexResearchers = []
        try {
          institution = await resolveOpenAlex(school.school, school.officialUrl, ror, fetchImpl)
          if (!institution) throw new Error('institution-not-resolved')
          openAlexResearchers = await findOpenAlexResearchers(
            institution,
            openAlexWorkPlan,
            fetchImpl,
            maxResearchersPerSchool,
            maxOpenAlexPagesPerQuery,
          )
        } catch (error) {
          openAlexError = error
        }
        let europePmcStatus = useEuropePmc ? 'unavailable' : 'skipped-discipline'
        let europePmcResearchers = []
        if (useEuropePmc) {
          try {
            europePmcResearchers = await findEuropePmcResearchers({
              school: school.school,
              institution,
              ror,
              queries: europePmcQueries,
              fetchImpl,
              maxResearchers: maxResearchersPerSchool,
            })
            europePmcStatus = 'ok'
          } catch {
            europePmcStatus = 'unavailable'
          }
        }
        let crossrefStatus = 'skipped-sufficient-openalex'
        let crossrefResearchers = []
        const crossrefTarget = Math.min(500, Math.max(1, Number(maxResearchersPerSchool) || 30))
        if (openAlexResearchers.length < crossrefTarget) {
          try {
            crossrefResearchers = await findCrossrefResearchers({
              school: school.school,
              institution,
              ror,
              queries,
              fetchImpl,
              maxResearchers: maxResearchersPerSchool,
            })
            crossrefStatus = 'ok'
          } catch {
            crossrefStatus = 'unavailable'
          }
        }
        const researchers = mergeResearchers(
          [openAlexResearchers, europePmcResearchers, crossrefResearchers],
          maxResearchersPerSchool,
        )
        if (!institution && !researchers.length) throw openAlexError || new Error('institution-not-resolved')
        results[index] = {
          provider: useEuropePmc ? 'openalex+ror+europepmc+crossref' : 'openalex+ror+crossref',
          queriedAt: new Date().toISOString(),
          query: queries.join(' | '),
          status: institution ? 'ok' : 'partial',
          institution: institution || ror ? {
            openAlexId: institution?.id || null,
            rorId: institution?.ror || ror?.id || null,
            displayName: institution?.display_name || ror?.displayName || school.school,
            homepageUrl: institution?.homepage_url || school.officialUrl,
            domains: ror?.domains || [],
          } : null,
          sourceStatus: {
            openalex: institution ? 'ok' : 'unavailable',
            openalexTopics: resolvedTopics.status,
            ror: ror ? 'ok' : 'unavailable',
            europepmc: europePmcStatus,
            mesh: europePmcStatus === 'ok' ? 'indexed-by-europepmc' : europePmcStatus,
            crossref: crossrefStatus,
          },
          sourceCounts: {
            openalex: openAlexResearchers.length,
            europepmc: europePmcResearchers.length,
            crossref: crossrefResearchers.length,
            merged: researchers.length,
          },
          topicResolution: compactTopicResolution(resolvedTopics),
          disciplinePlan: compactDisciplinePlan(disciplinePlan),
          candidateResearchers: researchers,
        }
      } catch (error) {
        results[index] = {
          provider: useEuropePmc ? 'openalex+ror+europepmc+crossref' : 'openalex+ror+crossref',
          queriedAt: new Date().toISOString(),
          query: queries.join(' | '),
          status: 'unavailable',
          error: String(error?.message || error).slice(0, 160),
          // An exhausted provider budget is an operator problem with a fix, not
          // a school that could not be matched. Carry the distinction out so
          // the quality report can say which one happened.
          errorCode: error?.code || null,
          errorDetail: String(error?.detail || '').slice(0, 300),
          institution: null,
          topicResolution: compactTopicResolution(resolvedTopics),
          disciplinePlan: compactDisciplinePlan(disciplinePlan),
          candidateResearchers: [],
        }
      }
      completed += 1
      await onProgress?.({ completed, total: targets.length, school: school.school })
    }
  }))
  return targets.map((school, index) => ({ school: school.school, evidence: results[index] }))
}

export function attachScholarlyEvidence(sourceIndex, entries) {
  const bySchool = new Map((entries || []).map((entry) => [entry.school, entry.evidence]))
  return {
    ...sourceIndex,
    schemaVersion: 2,
    schools: (sourceIndex?.schools || []).map((school) => ({
      ...school,
      scholarlyEvidence: bySchool.get(school.school) || null,
    })),
  }
}
