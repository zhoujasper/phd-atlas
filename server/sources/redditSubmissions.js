import { cleanOptionalText } from './sourceSchemas.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import { httpClientFor, createSourceAdapter } from './sourceAdapter.js'
import { provenanceRecord } from './sourceProvenance.js'

export const REDDIT_SEARCH_BASE_URL = 'https://oauth.reddit.com/r/gradadmissions/search'
export const REDDIT_RSS_SEARCH_BASE_URL = 'https://www.reddit.com/r/gradadmissions/search.rss'
export const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

export function buildRedditSearchUrl(query = {}, config = {}) {
  const url = new URL(config.baseUrl || REDDIT_SEARCH_BASE_URL)
  url.searchParams.set('q', cleanOptionalText(query.keyword, 300) || 'PhD admissions')
  url.searchParams.set('restrict_sr', '1')
  url.searchParams.set('sort', cleanOptionalText(query.sort, 40) || 'new')
  url.searchParams.set('limit', String(boundedInteger(query.limit, 25, 1, 100)))
  if (query.after) url.searchParams.set('after', String(query.after))
  if (query.before) url.searchParams.set('before', String(query.before))
  return url
}

export function buildRedditRssSearchUrl(query = {}, config = {}) {
  const url = new URL(config.rssBaseUrl || REDDIT_RSS_SEARCH_BASE_URL)
  url.searchParams.set('q', cleanOptionalText(query.keyword, 300) || 'PhD admissions')
  url.searchParams.set('restrict_sr', '1')
  url.searchParams.set('sort', cleanOptionalText(query.sort, 40) || 'new')
  url.searchParams.set('t', cleanOptionalText(query.time, 20) || 'all')
  return url
}

function redditSubjectTerms(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\b(?:ph\.?d\.?|dphil|doctoral|doctorate|programme|program|degree)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function buildRedditQueryVariants(query = {}) {
  const school = cleanOptionalText(query.school, 200)
  const subject = cleanOptionalText(redditSubjectTerms(query.program), 180)
  const requested = cleanOptionalText(query.keyword, 300) || [school, subject].filter(Boolean).join(' ') || 'PhD admissions'
  const keywords = [
    requested,
    [school, subject].filter(Boolean).join(' '),
    [school, '(accepted OR admit OR rejection OR interview OR decision)'].filter(Boolean).join(' '),
  ].filter(Boolean)
  return [...new Set(keywords)].slice(0, 3).map((keyword) => ({ ...query, keyword }))
}

export function resolveRedditCredentials(source, query = {}, environment = process.env) {
  const configured = source?.auth || {}
  const override = query?.auth || {}
  return {
    tokenUrl: override.tokenUrl || configured.tokenUrl || REDDIT_TOKEN_URL,
    clientId: override.clientId || configured.clientId || environment.REDDIT_CLIENT_ID || '',
    clientSecret: override.clientSecret || configured.clientSecret || environment.REDDIT_CLIENT_SECRET || '',
    username: override.username || configured.username || environment.REDDIT_USERNAME || '',
    password: override.password || configured.password || environment.REDDIT_PASSWORD || '',
  }
}

function hasRedditClientCredentials(credentials) {
  return Boolean(credentials.clientId && credentials.clientSecret)
}

function hasRedditPasswordCredentials(credentials) {
  return Boolean(hasRedditClientCredentials(credentials) && credentials.username && credentials.password)
}

const XML_ENTITIES = Object.freeze({ amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' })

function decodeXmlEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase()
    if (normalized.startsWith('#x')) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16))
    if (normalized.startsWith('#')) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10))
    return XML_ENTITIES[normalized] ?? match
  })
}

function atomTag(entry, tag) {
  const match = String(entry).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return decodeXmlEntities(match?.[1] || '').trim()
}

function atomTextContent(entry) {
  const decoded = decodeXmlEntities(atomTag(entry, 'content'))
  return decodeXmlEntities(decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

/** Parse the official Reddit Atom search feed without treating HTML as data. */
export function parseRedditAtomFeed(payload, context = {}) {
  const xml = String(payload || '')
  if (!/<feed\b/i.test(xml)) {
    throw new SourceStructureChangedError(
      'Reddit Atom response no longer contains a feed element.',
      context.sourceId || 'reddit-submissions',
    )
  }
  const sourceId = context.sourceId || 'reddit-submissions'
  const fetchedAt = context.fetchedAt || new Date().toISOString()
  const warnings = []
  const records = []
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []
  for (const entry of entries) {
    const title = cleanOptionalText(atomTag(entry, 'title'), 600)
    const links = [...entry.matchAll(/<link\b[^>]*\bhref=(['"])(.*?)\1[^>]*\/?\s*>/gi)]
      .map((match) => decodeXmlEntities(match[2]))
    const permalink = links.find((value) => /reddit\.com\/r\/gradadmissions\/comments\//i.test(value)) || links[0] || ''
    const rawId = atomTag(entry, 'id')
    const id = cleanOptionalText(rawId.match(/t3_([\w-]+)/i)?.[1] || permalink.match(/\/comments\/([\w-]+)/i)?.[1], 80)
    if (!id || !title || !/^https:\/\//i.test(permalink)) {
      warnings.push('Skipped Reddit Atom entry without an id, title, or HTTPS permalink.')
      continue
    }
    records.push(provenanceRecord({
      kind: 'reddit:submission',
      value: {
        id,
        title,
        selfText: cleanOptionalText(atomTextContent(entry), 8_000),
        url: cleanOptionalText(permalink, 1_000),
        permalink: cleanOptionalText(new URL(permalink).pathname, 1_000),
        createdAt: cleanOptionalText(atomTag(entry, 'updated') || atomTag(entry, 'published'), 40),
        score: null,
        numComments: null,
        subreddit: 'gradadmissions',
        transport: 'official-atom-feed',
      },
      sourceId,
      sourceUrl: permalink,
      fetchedAt,
      confidence: 0.82,
    }))
  }
  return { records, warnings }
}

export function parseRedditSearchResponse(payload, context = {}) {
  if (!Array.isArray(payload?.data?.children)) {
    throw new SourceStructureChangedError(
      'Reddit API response no longer contains data.children[].',
      context.sourceId || 'reddit-submissions',
    )
  }
  const sourceId = context.sourceId || 'reddit-submissions'
  const fallbackUrl = context.sourceUrl || REDDIT_SEARCH_BASE_URL
  const fetchedAt = context.fetchedAt || new Date().toISOString()
  const warnings = []
  const records = []
  for (const child of payload.data.children) {
    const post = child?.data || child
    if (!post?.id || !post?.title) {
      warnings.push('Skipped Reddit API child without id or title.')
      continue
    }
    const postUrl = post.permalink
      ? new URL(post.permalink, 'https://www.reddit.com').toString()
      : fallbackUrl
    records.push(provenanceRecord({
      kind: 'reddit:submission',
      value: {
        id: cleanOptionalText(post.id, 80),
        title: cleanOptionalText(post.title, 600),
        selfText: cleanOptionalText(post.selftext || post.selftext_html, 8_000),
        url: cleanOptionalText(post.url, 1_000),
        permalink: cleanOptionalText(post.permalink, 1_000),
        createdAt: cleanOptionalText(post.created_utc, 40),
        score: Number.isFinite(Number(post.score)) ? Number(post.score) : null,
        numComments: Number.isFinite(Number(post.num_comments)) ? Number(post.num_comments) : null,
        subreddit: cleanOptionalText(post.subreddit, 120),
      },
      sourceId,
      sourceUrl: postUrl,
      fetchedAt,
      confidence: 0.9,
    }))
  }
  return { records, warnings }
}

async function getRedditAccessToken(credentials, context) {
  const http = httpClientFor(context)
  const tokenKey = `reddit-token:${credentials.clientId}:${credentials.username}`
  const cached = context.tokenCache?.get(tokenKey)
  const clock = typeof context.now === 'function' ? context.now() : Date.now()
  if (cached && cached.expiresAt > clock) return cached.accessToken
  const passwordGrant = hasRedditPasswordCredentials(credentials)
  const body = new URLSearchParams(passwordGrant
    ? { grant_type: 'password', username: credentials.username, password: credentials.password }
    : { grant_type: 'client_credentials' }).toString()
  const fetched = await http.fetchJson(credentials.tokenUrl, {
    source: {
      ...context.source,
      id: `${context.source.id}-token`,
      cacheTtlMs: 0,
    },
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
    },
    body,
    cacheKey: tokenKey,
  })
  const accessToken = cleanOptionalText(fetched.json?.access_token, 512)
  if (!accessToken) {
    throw new SourceStructureChangedError(
      'Reddit OAuth response no longer contains access_token.',
      context.source.id,
    )
  }
  const expiresIn = Number(fetched.json?.expires_in)
  const token = { accessToken, expiresAt: clock + (Number.isFinite(expiresIn) ? expiresIn * 1_000 : 60 * 60 * 1_000) }
  context.tokenCache?.set(tokenKey, token)
  return accessToken
}

async function fetchRedditAtom(query, context, warnings = []) {
  const http = httpClientFor(context)
  const requestUrl = buildRedditRssSearchUrl(query, context.source).toString()
  const fetched = await http.fetchText(requestUrl, {
    source: context.source,
    headers: { accept: 'application/atom+xml,application/xml;q=0.9,text/xml;q=0.8' },
    cacheKey: `reddit-submissions:rss:${requestUrl}`,
  })
  const parsed = parseRedditAtomFeed(fetched.text, {
    sourceId: context.source.id,
    sourceUrl: fetched.sourceUrl || requestUrl,
    fetchedAt: fetched.fetchedAt,
  })
  return {
    records: parsed.records,
    warnings: [...warnings, ...parsed.warnings],
    meta: {
      requestUrl,
      transport: 'official-atom-feed',
      skippedInvalidRows: parsed.warnings.length,
    },
  }
}

async function settleRedditQueries(queries, runner, { transport, warnings = [] } = {}) {
  const settled = await Promise.allSettled(queries.map((query) => runner(query)))
  const successes = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value)
  if (!successes.length) throw settled.find((result) => result.status === 'rejected')?.reason
  const records = new Map()
  for (const result of successes) {
    for (const record of result.records || []) {
      const identity = record?.value?.id || record?.sourceUrl
      if (identity && !records.has(identity)) records.set(identity, record)
    }
  }
  const failures = settled.filter((result) => result.status === 'rejected')
  const failedCount = failures.length
  const failureKinds = [...new Set(failures.map((result) => String(
    result.reason?.code || result.reason?.name || 'request-failed',
  ).slice(0, 80)))]
  return {
    records: [...records.values()],
    warnings: [
      ...warnings,
      ...successes.flatMap((result) => result.warnings || []),
      ...(failedCount ? [`${failedCount}/${settled.length} Reddit search variants failed (${failureKinds.join(', ')}); retained the successful official results.`] : []),
    ],
    meta: {
      transport,
      requestUrls: successes.flatMap((result) => result.meta?.requestUrl ? [result.meta.requestUrl] : []),
      queryCount: settled.length,
      successfulQueryCount: successes.length,
      skippedInvalidRows: successes.reduce((total, result) => total + Number(result.meta?.skippedInvalidRows || 0), 0),
    },
  }
}

async function redditSubmissionsImpl(query, context) {
  // Every query variant must share one scheduler/cache so the adapter's
  // declared single-request concurrency and Reddit rate limit are real rather
  // than being bypassed by one HTTP client per Promise.
  context.httpClient ||= httpClientFor(context)
  const credentials = resolveRedditCredentials(context.source, { auth: context.auth || query.auth })
  const queryVariants = buildRedditQueryVariants(query)
  if (!hasRedditClientCredentials(credentials)) {
    return settleRedditQueries(
      queryVariants,
      (variant) => fetchRedditAtom(variant, context),
      {
        transport: 'official-atom-feed',
        warnings: ['Reddit OAuth credentials are not configured; used the official Reddit Atom search feed.'],
      },
    )
  }
  const http = httpClientFor(context)
  context.tokenCache ||= new Map()
  try {
    const accessToken = await getRedditAccessToken(credentials, context)
    const transport = hasRedditPasswordCredentials(credentials) ? 'oauth-password' : 'oauth-client-credentials'
    return settleRedditQueries(queryVariants, async (variant) => {
      const requestUrl = buildRedditSearchUrl(variant, context.source).toString()
      const fetched = await http.fetchJson(requestUrl, {
        source: context.source,
        headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
        cacheKey: `reddit-submissions:${requestUrl}`,
      })
      const parsed = parseRedditSearchResponse(fetched.json, {
        sourceId: context.source.id,
        sourceUrl: fetched.sourceUrl || requestUrl,
        fetchedAt: fetched.fetchedAt,
      })
      return {
        records: parsed.records,
        warnings: parsed.warnings,
        meta: { requestUrl, skippedInvalidRows: parsed.warnings.length },
      }
    }, { transport })
  } catch (error) {
    return settleRedditQueries(
      queryVariants,
      (variant) => fetchRedditAtom(variant, context),
      {
        transport: 'official-atom-feed',
        warnings: [`Reddit OAuth was unavailable (${String(error?.code || error?.name || 'request-failed')}); used the official Reddit Atom search feed.`],
      },
    )
  }
}

export const redditSubmissionsSource = createSourceAdapter({
  id: 'reddit-submissions',
  name: 'Reddit r/gradadmissions API',
  kind: 'api',
  baseUrl: REDDIT_SEARCH_BASE_URL,
  enabled: true,
  rateLimitPerMin: 20,
  concurrency: 1,
  cacheTtlMs: 30 * 60 * 1_000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research; official Reddit OAuth API)',
  robotsPolicy: 'respect',
  timeoutMs: 20_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    retryableStatuses: [429, 503],
    retryNetworkErrors: true,
  },
  description: 'Official Reddit OAuth search API with the official Atom search feed as a provenance-preserving fallback. No HTML crawling.',
}, redditSubmissionsImpl)
