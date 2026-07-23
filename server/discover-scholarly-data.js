const OPENALEX_BASE = 'https://api.openalex.org'
const ROR_BASE = 'https://api.ror.org/v2'

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

function nameScore(left, right) {
  const words = (value) => new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !['the', 'university', 'college', 'institute'].includes(word)))
  const a = words(left)
  const b = words(right)
  return [...a].filter((word) => b.has(word)).length / Math.max(1, Math.min(a.size, b.size))
}

async function fetchJson(url, { fetchImpl, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'PhD-Atlas/0.1 (official-source research)' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
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
  if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY)
  const payload = await fetchJson(url, { fetchImpl })
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

async function findRelevantResearchers(institution, queries, fetchImpl, maxResearchers = 30) {
  const authors = new Map()
  for (const query of queries) {
    const url = new URL(`${OPENALEX_BASE}/works`)
    url.searchParams.set('search', query)
    url.searchParams.set('filter', `authorships.institutions.id:${institution.id},from_publication_date:2021-01-01`)
    url.searchParams.set('sort', 'relevance_score:desc')
    url.searchParams.set('per-page', '35')
    url.searchParams.set('select', 'id,doi,display_name,publication_year,cited_by_count,authorships')
    if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY)
    const payload = await fetchJson(url, { fetchImpl })
    for (const work of payload?.results || []) {
      for (const authorship of work.authorships || []) {
        if (!(authorship.institutions || []).some((item) => item.id === institution.id)) continue
        const author = authorship.author
        if (!author?.id || !author?.display_name) continue
        const current = authors.get(author.id) || {
          openAlexId: author.id,
          name: author.display_name,
          orcid: author.orcid || null,
          profileUrl: author.id,
          score: 0,
          matchedQueries: [],
          recentWorks: [],
          workIds: new Set(),
        }
        if (!current.matchedQueries.includes(query)) current.matchedQueries.push(query)
        if (!current.workIds.has(work.id)) {
          current.score += 1 + Math.log10(1 + Math.max(0, Number(work.cited_by_count) || 0))
          current.workIds.add(work.id)
        }
        const source = workSource(work)
        if (current.recentWorks.length < 5 && source && !current.recentWorks.some((item) => item.source === source)) {
          current.recentWorks.push({
            title: String(work.display_name || '').slice(0, 300),
            year: work.publication_year || null,
            citedByCount: Math.max(0, Number(work.cited_by_count) || 0),
            source,
            matchedQuery: query,
          })
        }
        authors.set(author.id, current)
      }
    }
  }
  return [...authors.values()]
    .map(({ workIds: _workIds, ...author }) => author)
    .sort((left, right) => (right.matchedQueries.length - left.matchedQueries.length) || (right.score - left.score))
    .slice(0, Math.min(60, Math.max(1, Number(maxResearchers) || 30)))
}

export async function collectScholarlyEvidence({
  schools,
  query,
  fetchImpl = globalThis.fetch,
  concurrency = 3,
  maxResearchersPerSchool = 30,
  onProgress,
} = {}) {
  const targets = (schools || []).filter((school) => school?.crawlStatus === 'ok')
  const queries = [...new Set((Array.isArray(query) ? query : [query])
    .map((item) => String(item || '').trim())
    .filter(Boolean))].slice(0, 4)
  if (!queries.length) queries.push('doctoral research')
  const results = new Array(targets.length)
  let cursor = 0
  let completed = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), targets.length || 1) }, async () => {
    while (cursor < targets.length) {
      const index = cursor++
      const school = targets[index]
      try {
        const ror = await resolveRor(school.school, school.officialUrl, fetchImpl).catch(() => null)
        const institution = await resolveOpenAlex(school.school, school.officialUrl, ror, fetchImpl)
        if (!institution) throw new Error('institution-not-resolved')
        const researchers = await findRelevantResearchers(
          institution,
          queries,
          fetchImpl,
          maxResearchersPerSchool,
        )
        results[index] = {
          provider: 'openalex+ror',
          queriedAt: new Date().toISOString(),
          query: queries.join(' | '),
          status: 'ok',
          institution: {
            openAlexId: institution.id,
            rorId: institution.ror || ror?.id || null,
            displayName: institution.display_name,
            homepageUrl: institution.homepage_url || school.officialUrl,
            domains: ror?.domains || [],
          },
          candidateResearchers: researchers,
        }
      } catch (error) {
        results[index] = {
          provider: 'openalex+ror',
          queriedAt: new Date().toISOString(),
          query: queries.join(' | '),
          status: 'unavailable',
          error: String(error?.message || error).slice(0, 160),
          institution: null,
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
