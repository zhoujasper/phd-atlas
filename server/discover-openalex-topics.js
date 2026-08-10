import { withAbortDeadline } from './abortDeadline.js'
import {
  cancelResponseBody,
  readBoundedResponseJson,
  readBoundedResponseText,
} from './boundedResponse.js'

const OPENALEX_BASE = 'https://api.openalex.org'
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const CACHE_MAX_ENTRIES = 256
const OPENALEX_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'approach', 'for', 'in', 'method', 'methods', 'model', 'modeling',
  'modelling', 'of', 'on', 'research', 'science', 'studies', 'study', 'the', 'to',
  'using', 'with',
])
const GEOGRAPHIC_TOKENS = new Set([
  'africa', 'african', 'america', 'american', 'australia', 'australian', 'brazil',
  'brazilian', 'britain', 'british', 'canada', 'canadian', 'china', 'chinese',
  'europe', 'european', 'france', 'french', 'german', 'germany', 'india', 'indian',
  'italian', 'italy', 'japan', 'japanese', 'korea', 'korean', 'latin', 'russia',
  'russian', 'spain', 'spanish', 'states', 'united',
])

const topicCache = new Map()

function cachedTopicResult(cacheKey, now) {
  const cached = topicCache.get(cacheKey)
  if (!cached) return null
  if (now - cached.cachedAt >= CACHE_TTL_MS) {
    topicCache.delete(cacheKey)
    return null
  }
  // Map insertion order owns the LRU order.
  topicCache.delete(cacheKey)
  topicCache.set(cacheKey, cached)
  return cached.result
}

function rememberTopicResult(cacheKey, cachedAt, result) {
  for (const [candidateKey, candidate] of topicCache) {
    if (cachedAt - candidate.cachedAt >= CACHE_TTL_MS) topicCache.delete(candidateKey)
  }
  topicCache.delete(cacheKey)
  topicCache.set(cacheKey, { cachedAt, result })
  while (topicCache.size > CACHE_MAX_ENTRIES) {
    topicCache.delete(topicCache.keys().next().value)
  }
}

function normalizedWords(value, ignored = TOPIC_STOP_WORDS) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!/^[a-z]+$/i.test(word) || word.length <= 4) return word
      if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
      if (word.endsWith('sses')) return word.slice(0, -2)
      if (word.endsWith('s') && !/(?:ss|us|is|ics)$/.test(word)) return word.slice(0, -1)
      return word
    })
    .filter((word) => word && !ignored.has(word))
}

function cleanTerm(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function normalizedOpenAlexId(value, prefix) {
  const match = String(value || '').match(new RegExp(`(?:^|/)(${prefix}\\d+)$`, 'i'))
  return match?.[1]?.toUpperCase() || ''
}

function applyOpenAlexAccess(url) {
  if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY)
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(process.env.OPENALEX_MAILTO || ''))) {
    url.searchParams.set('mailto', process.env.OPENALEX_MAILTO)
  }
  return url
}

function retryDelayMs(response, attempt) {
  const raw = String(response?.headers?.get?.('retry-after') || '').trim()
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3_000, seconds * 1_000)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.min(3_000, Math.max(0, date - Date.now()))
  return Math.min(2_000, 300 * (2 ** attempt))
}

async function fetchOpenAlexJson(url, {
  fetchImpl,
  timeoutMs = 12_000,
  attempts = 3,
} = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { response, payload, refusalDetail } = await withAbortDeadline(
        async (signal) => {
          const response = await fetchImpl(applyOpenAlexAccess(new URL(url)).toString(), {
            signal,
            headers: {
              accept: 'application/json',
              'user-agent': 'PhD-Atlas/0.1 (discipline topic resolution)',
            },
          })
          // Keep a bounded slice of a refusal body. OpenAlex explains an
          // exhausted budget there, and discarding it makes a daily quota
          // indistinguishable from a transient blip worth retrying.
          let refusalDetail = ''
          if (!response.ok) {
            try {
              refusalDetail = String(await readBoundedResponseText(response, {
                maxBytes: 4_096,
                signal,
                bodyKind: 'OpenAlex Topics refusal',
              }) || '').slice(0, 600)
            } catch {
              await cancelResponseBody(response)
            }
          }
          return {
            response,
            refusalDetail,
            payload: response.ok
              ? await readBoundedResponseJson(response, {
                maxBytes: OPENALEX_RESPONSE_MAX_BYTES,
                signal,
                bodyKind: 'OpenAlex Topics response',
              })
              : null,
          }
        },
        { timeoutMs },
      )
      if (response.ok) return payload
      lastError = new Error(`OpenAlex Topics HTTP ${response.status}`)
      lastError.detail = refusalDetail
      if (/insufficient budget|add funds|quota|rate limit exceeded/i.test(refusalDetail)) {
        lastError.code = 'SCHOLARLY_PROVIDER_QUOTA_EXHAUSTED'
        break
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt + 1 >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)))
    } catch (error) {
      lastError = error
      if (attempt + 1 >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(null, attempt)))
    }
  }
  throw lastError || new Error('OpenAlex Topics request failed')
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

function coverageScore(queryWords, candidateWords) {
  if (!queryWords.length || !candidateWords.length) return 0
  const candidate = new Set(candidateWords)
  return queryWords.filter((word) => candidate.has(word)).length / queryWords.length
}

function topicRelevance(query, topic, excludedMeanings = []) {
  const queryWords = normalizedWords(query)
  if (!queryWords.length) return 0
  const name = String(topic?.display_name || '')
  const keywords = (topic?.keywords || []).join(' ')
  const description = String(topic?.description || '')
  const nameWords = normalizedWords(name)
  const keywordWords = normalizedWords(keywords)
  const descriptionWords = normalizedWords(description)
  const normalizedQuery = queryWords.join(' ')
  const normalizedName = nameWords.join(' ')
  const normalizedKeywordText = keywordWords.join(' ')
  const phraseBonus = normalizedName.includes(normalizedQuery) || normalizedKeywordText.includes(normalizedQuery)
    ? 0.12
    : 0
  const nameCoverage = coverageScore(queryWords, nameWords)
  const keywordCoverage = coverageScore(queryWords, keywordWords)
  let score = Math.max(
    nameCoverage * 0.88 + phraseBonus,
    keywordCoverage * 0.78 + phraseBonus,
    coverageScore(queryWords, descriptionWords) * 0.62,
  )
  if (queryWords.length >= 2 && nameCoverage < 0.75 && !normalizedName.includes(normalizedQuery)) {
    score = Math.min(score, 0.66)
  }

  const querySet = new Set(queryWords)
  const unrequestedGeography = nameWords.some((word) => GEOGRAPHIC_TOKENS.has(word) && !querySet.has(word))
  if (unrequestedGeography) score -= 0.2

  for (const excludedMeaning of excludedMeanings) {
    const excludedWords = normalizedWords(excludedMeaning)
      .filter((word) => !querySet.has(word) && word.length >= 4)
    if (excludedWords.length >= 2 && coverageScore(excludedWords, nameWords) >= 0.75) {
      score -= 0.12
    }
  }

  return Math.max(0, Math.min(1, score))
}

function queryTerms(values, limit) {
  const terms = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : [values]) {
    const term = cleanTerm(value)
    const key = term.normalize('NFKC').toLocaleLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  const latin = terms.filter((term) => /[a-z]/i.test(term))
  const native = terms.filter((term) => !/[a-z]/i.test(term))
  return [...latin, ...native].slice(0, Math.max(1, Math.min(16, Number(limit) || 12)))
}

function cleanTopic(query, topic, score) {
  const id = normalizedOpenAlexId(topic?.id, 'T')
  if (!id || !topic?.display_name) return null
  return {
    query,
    id,
    openAlexId: topic.id,
    displayName: cleanTerm(topic.display_name),
    description: String(topic.description || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    keywords: [...new Set((topic.keywords || []).map(cleanTerm).filter(Boolean))].slice(0, 10),
    subfield: topic.subfield ? {
      id: normalizedOpenAlexId(topic.subfield.id, 'S'),
      displayName: cleanTerm(topic.subfield.display_name),
    } : null,
    field: topic.field ? {
      id: normalizedOpenAlexId(topic.field.id, 'F'),
      displayName: cleanTerm(topic.field.display_name),
    } : null,
    domain: topic.domain ? {
      id: normalizedOpenAlexId(topic.domain.id, 'D'),
      displayName: cleanTerm(topic.domain.display_name),
    } : null,
    confidence: Number(score.toFixed(3)),
    worksCount: Math.max(0, Number(topic.works_count) || 0),
  }
}

export function clearDiscoverOpenAlexTopicCache() {
  topicCache.clear()
}

/**
 * Resolve free-form multilingual research terms to stable OpenAlex Topic IDs.
 * Search responses are accepted only after local lexical/phrase checks. The
 * resulting IDs remain lead-layer filters and never become saved facts.
 */
export async function resolveDiscoverOpenAlexTopics({
  terms = [],
  excludedMeanings = [],
  fetchImpl = globalThis.fetch,
  limit = 8,
  maxSearchTerms = 12,
  now = Date.now(),
} = {}) {
  const searches = queryTerms(terms, maxSearchTerms)
  if (!searches.length || typeof fetchImpl !== 'function') {
    return { status: 'empty', searchedTerms: [], topics: [], failures: 0 }
  }
  const boundedLimit = Math.max(1, Math.min(12, Number(limit) || 8))
  const cacheKey = JSON.stringify([searches, excludedMeanings, boundedLimit])
  const cached = cachedTopicResult(cacheKey, now)
  if (cached) return cached

  let failures = 0
  const groups = await mapWithConcurrency(searches, 4, async (query) => {
    const url = new URL(`${OPENALEX_BASE}/topics`)
    url.searchParams.set('search', query)
    url.searchParams.set('per-page', '5')
    url.searchParams.set(
      'select',
      'id,display_name,description,keywords,subfield,field,domain,works_count,cited_by_count',
    )
    try {
      const payload = await fetchOpenAlexJson(url, { fetchImpl })
      return (payload?.results || [])
        .map((topic) => ({ topic, score: topicRelevance(query, topic, excludedMeanings) }))
        .filter((entry) => entry.score >= 0.46)
        .sort((left, right) => (
          right.score - left.score
          || Number(right.topic?.works_count || 0) - Number(left.topic?.works_count || 0)
        ))
        .map((entry) => cleanTopic(query, entry.topic, entry.score))
        .filter(Boolean)
    } catch {
      failures += 1
      return []
    }
  })

  const topics = []
  const seen = new Set()
  const add = (topic, primaryForQuery) => {
    if (!topic) return
    if (seen.has(topic.id)) {
      if (primaryForQuery) {
        const existing = topics.find((item) => item.id === topic.id)
        if (existing) existing.primaryForQuery = true
      }
      return
    }
    if (topics.length >= boundedLimit) return
    seen.add(topic.id)
    topics.push({ ...topic, primaryForQuery })
  }
  for (const group of groups) add(group[0], true)
  for (const group of groups) {
    for (const topic of group.slice(1)) add(topic, false)
  }
  const result = {
    status: topics.length ? (failures ? 'partial' : 'ok') : (failures === searches.length ? 'unavailable' : 'no-match'),
    searchedTerms: searches,
    topics,
    failures,
  }
  rememberTopicResult(cacheKey, now, result)
  return result
}

/**
 * Keep the established eight-query school budget. Stable Topic-ID filters are
 * preferred, with one or two text queries retained to catch recent/unclassified
 * works and to provide a complete fallback when topic resolution is down.
 */
export function buildOpenAlexWorkQueryPlan({
  terms = [],
  topics = [],
  limit = 8,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(8, Number(limit) || 8))
  const textTerms = queryTerms(terms, boundedLimit)
  const output = []
  const representedQueries = new Set()
  const textQueries = new Set()
  const topicLimit = Math.max(0, boundedLimit - Math.min(2, Math.max(1, textTerms.length)))
  for (const topic of (topics || []).filter((topic) => topic?.primaryForQuery !== false)) {
    const topicId = normalizedOpenAlexId(topic?.id || topic?.openAlexId, 'T')
    const query = cleanTerm(topic?.query || topic?.displayName)
    if (!topicId || !query || output.length >= topicLimit) continue
    output.push({
      kind: 'topic',
      query,
      topicId,
      topicName: cleanTerm(topic.displayName),
      domain: cleanTerm(topic.domain?.displayName),
      field: cleanTerm(topic.field?.displayName),
      confidence: Math.max(0, Math.min(1, Number(topic.confidence) || 0)),
    })
    representedQueries.add(query.normalize('NFKC').toLocaleLowerCase())
  }
  for (const query of textTerms) {
    if (output.length >= boundedLimit) break
    const key = query.normalize('NFKC').toLocaleLowerCase()
    if (representedQueries.has(key)) continue
    output.push({ kind: 'text', query })
    textQueries.add(key)
  }
  for (const query of textTerms) {
    if (output.length >= boundedLimit) break
    const key = query.normalize('NFKC').toLocaleLowerCase()
    if (textQueries.has(key)) continue
    output.push({ kind: 'text', query })
    textQueries.add(key)
  }
  if (!output.length) output.push({ kind: 'text', query: 'doctoral research' })
  return output
}
