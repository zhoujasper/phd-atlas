import { lookup as nodeDnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { listDiscoverResearchSources } from './discover-source-registry.js'

const DISCOVER_CRAWLER_USER_AGENT = 'PhDAtlasDiscover/1.0 (+https://phd-atlas.local/research)'
const CANDIDATE_LIMIT_PER_SOURCE = 160
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_REDIRECTS = 5
const MAX_SITEMAP_DOCUMENTS = 4
const MAX_SITEMAP_URLS = 240
const MAX_SITEMAP_QUEUE = MAX_SITEMAP_DOCUMENTS * 4
const MAX_PAGES_PER_SOURCE = 32
const MAX_CANDIDATES_PER_SOURCE = 1_000
const MAX_SOURCES_PER_RUN = 500
const MAX_CRAWL_CONCURRENCY = 8
const MAX_REQUEST_TIMEOUT_MS = 30_000
const MAX_URL_LENGTH = 2_048
const MAX_ALLOWED_HOSTS = 32
const MAX_SEEDS_PER_SOURCE = 32
const MAX_LINKS_SCANNED_PER_PAGE = 1_200

const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'application', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on',
  'or', 'phd', 'program', 'programme', 'research', 'the', 'to', 'university', 'with',
])

// These pages frequently contain words such as "faculty", "research" or
// "programme" in global navigation, but are poor canonical evidence. They
// remain discoverable as a last resort; the penalty only keeps them from
// consuming a bounded crawl before direct degree/profile/lab pages.
const JUNK_PAGE_RULES = [
  [/(?:^|\/)(?:[^/]+[-_])?(?:news(?:room)?|nouvelles|notizie|noticias|nachrichten|nieuws|nyheter|uutiset|новости|新闻|新聞|ニュース|뉴스|press|media|stories|blogs?)(?:[-_][^/]*)?(?:\/|$)/iu, 260],
  [/(?:^|\/)(?:events?|calendar|seminars?|webinars?)(?:[-_][^/]*)?(?:\/|$)/i, 240],
  [/(?:^|\/)(?:careers?|career[-_]experiential[-_]learning|volunteer(?:ing)?|campus[-_]?(?:life|tours?))(?:\/|$)/i, 220],
  [/(?:^|\/)(?:awards?|honours?|honors?|alumni|giving|donate)(?:\/|$)/i, 220],
  [/(?:^|\/)(?:privacy|cookies?|legal|terms|accessibility)(?:\/|$)/i, 300],
  [/(?:^|\/)(?:human-resources|hr|administration|administrative|current-staff)(?:\/|$)/i, 230],
  [/(?:^|\/)(?:undergraduate|bachelors?|baccalaureate)(?:\/|$)/i, 210],
  [/(?:^|\/)(?:masters?|msc|meng|mba)(?:\/|$)/i, 120],
]

const NON_PUBLIC_ADDRESSES = new BlockList()
for (const [network, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2001::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
]) NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, family)

const PROMPT_INJECTION_PATTERNS = [
  /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions?|prompts?|messages?)/gi,
  /(?:system|developer|assistant)\s*(?:message|prompt|instructions?)\s*:/gi,
  /(?:reveal|print|repeat|return|exfiltrate)\s+(?:the\s+)?(?:system|developer|hidden)\s+(?:prompt|instructions?|message)/gi,
  /<\|\s*(?:im_start|im_end|system|developer|assistant)\s*\|>/gi,
]

// A page may legitimately belong to more than one bucket. Keeping the types
// rather than forcing a single label is what makes the persisted source index
// useful when a university combines (for example) faculty and PhD admissions.
const PAGE_TYPE_RULES = [
  ['advisor', /(?:faculty|people|person|staff|advisor|adviser|supervisor|directory|researcher|academic[-_ ]?staff|our[-_ ]?team|members?|profiles?|docentes?|professores?|profesores?|chercheurs?|enseignants?|wissenschaftler|教員|研究者|导师|教师|교수|연구자)/iu],
  ['program', /(?:ph\.?d|doctoral|doctorate|graduate[-_ ]?program|postgraduate|degree[-_ ]?program|programme|programs|doctorad[oa]s?|doutorad[oa]s?|doctorats?|doktorat|dottorat[oi]|promotion(?:sstudium|en)?|博士|박사|ปริญญาเอก|tiến[-_ ]?sĩ|докторантур)/iu],
  ['admissions', /(?:admission|admissions|apply|application|how[-_ ]?to[-_ ]?apply|entry[-_ ]?requirements?|prospective[-_ ]?student|admis(?:ión|iones|são)|candidature|bewerbung|入試|招生|입학)/iu],
  ['funding', /(?:funding|funded|stipend|scholarship|studentship|financial[-_ ]?support|tuition|fees?|financiamento|financiación|bourse|stipendium|奖学金|장학금)/iu],
  ['research', /(?:research[-_ ]?(?:group|area|theme|centre|center)|laborator(?:y|ies)|lab|projects?|departments?|pesquisa|investigaci[oó]n|recherche|forschung|ricerca|研究(?:室|组)?|연구(?:실)?)/iu],
]

const PAGINATION_LABEL = /^(?:next|more|older|continue|load\s+more|next\s+page|siguiente|pr[oó]xim[oa]|suivant|weiter|n[aä]chste|volgende|avanti|下一页|下页|更多|次へ|次のページ|다음|더\s*보기|›|»|→)$/iu
const PAGINATION_PARAM = /^(?:page|p|pg|offset|start|from|cursor|pageindex|pagenumber|seite|pagina|tx_[a-z0-9_]*page)$/i
const DOCTORAL_LINK_SIGNAL = /(?:^|[^\p{L}\p{N}])(?:ph\s*\.?\s*d\s*\.?|d\s*\.?\s*phil\s*\.?|doctoral|doctorate|doctorats?|doctorad[oa]s?|dottorat[oi]|doutorad[oa]s?|doktorat|promotion(?:sstudium|en)?|博士|박사|ปริญญาเอก|tiến\s+sĩ|докторантур)(?=$|[^\p{L}\p{N}])/iu

function cleanHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

function plainIpHostname(value) {
  return String(value || '').replace(/^\[|\]$/g, '')
}

function isNonPublicAddress(address, family = isIP(plainIpHostname(address))) {
  const normalized = plainIpHostname(address)
  if (!family) return false
  // Reject mapped literals explicitly. Adding ::ffff:0:0/96 to Node's
  // BlockList also makes ordinary public IPv4 checks match that IPv6 subnet,
  // which incorrectly turns every IPv4-only university into a private target.
  if (/^::ffff:/i.test(normalized)) return true
  return NON_PUBLIC_ADDRESSES.check(normalized, family === 6 ? 'ipv6' : 'ipv4')
}

export function isDiscoverPublicHostname(value) {
  const hostname = cleanHostname(value)
  if (!hostname || hostname.length > 253) return false
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.lan')
    || hostname.endsWith('.home')
  ) return false
  const family = isIP(plainIpHostname(hostname))
  return family ? !isNonPublicAddress(hostname, family) : true
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || url.href.length > MAX_URL_LENGTH
      || !isDiscoverPublicHostname(url.hostname)
    ) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function sourceAllowedHosts(source) {
  const hosts = new Set()
  const root = normalizeUrl(source?.url)
  if (root) hosts.add(cleanHostname(root.hostname))
  for (const host of (source?.allowedHosts || []).slice(0, MAX_ALLOWED_HOSTS)) {
    const normalized = cleanHostname(host)
    if (normalized && /^[a-z0-9.-]+$/.test(normalized) && isDiscoverPublicHostname(normalized)) hosts.add(normalized)
  }
  return [...hosts]
}

function hostAllowed(hostname, allowedHosts) {
  const host = cleanHostname(hostname)
  return allowedHosts.some((allowed) => {
    const root = cleanHostname(allowed)
    return root && (host === root || host.endsWith(`.${root}`))
  })
}

function sourceAllowedUrl(value, source) {
  const url = normalizeUrl(value)
  if (!url || !hostAllowed(url.hostname, sourceAllowedHosts(source))) return null
  return url
}

/**
 * Resolve production crawl targets before the request and reject every
 * non-public answer. Curated host allow-lists remain the primary boundary;
 * this check closes direct-IP and ordinary DNS-to-private-network SSRF paths.
 */
export async function isDiscoverPublicNetworkTarget(value, dnsLookup = null) {
  const url = normalizeUrl(value)
  if (!url) return false
  const hostname = plainIpHostname(url.hostname)
  const family = isIP(hostname)
  if (family) return !isNonPublicAddress(hostname, family)
  if (typeof dnsLookup !== 'function') return true
  try {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true })
    const addresses = Array.isArray(resolved) ? resolved : [resolved]
    return addresses.length > 0 && addresses.every((entry) => {
      const address = typeof entry === 'string' ? entry : entry?.address
      const resolvedFamily = typeof entry === 'object' ? entry?.family : isIP(address)
      return Boolean(address) && !isNonPublicAddress(address, resolvedFamily)
    })
  } catch {
    return false
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.floor(number)))
    : fallback
}

function htmlText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeUntrustedWebText(value, maxLength = 4_000) {
  let text = String(value || '')
    // Directional controls and invisible separators can conceal instruction
    // text from reviewers while leaving it visible to a model tokenizer.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let promptInjectionSuspected = false
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    pattern.lastIndex = 0
    if (!pattern.test(text)) continue
    promptInjectionSuspected = true
    pattern.lastIndex = 0
    text = text.replace(pattern, '[untrusted instruction removed]')
  }
  return {
    text: text.slice(0, Math.max(0, maxLength)),
    promptInjectionSuspected,
  }
}

function titleFromHtml(html) {
  const title = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return sanitizeUntrustedWebText(htmlText(title), 180).text
}

export async function readDiscoverResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const limit = boundedInteger(maxBytes, MAX_RESPONSE_BYTES, 1, MAX_RESPONSE_BYTES)
  const body = response?.body
  if (!body?.getReader) {
    const text = await response.text()
    return { text: String(text || '').slice(0, limit), truncated: String(text || '').length > limit }
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let remaining = limit
  let text = ''
  let truncated = false
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || [])
      const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
      text += decoder.decode(accepted, { stream: true })
      remaining -= accepted.byteLength
      if (accepted.byteLength < chunk.byteLength) {
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }
    }
    if (remaining === 0 && !truncated) {
      const { done } = await reader.read()
      truncated = !done
      if (!done) await reader.cancel().catch(() => {})
    }
    text += decoder.decode()
    return { text, truncated }
  } finally {
    reader.releaseLock?.()
  }
}

function uniqueTypes(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function normalizeSearchSignal(value) {
  let decoded = String(value || '')
  try { decoded = decodeURIComponent(decoded) } catch { /* retain the original signal */ }
  return decoded
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function researchQueryValues(value, output = []) {
  if (output.length >= 40 || value == null) return output
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim().slice(0, 500)
    if (text) output.push(text)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) researchQueryValues(item, output)
    return output
  }
  if (typeof value === 'object') {
    // Deliberately accept only research-intake fields. Traversing an arbitrary
    // request object would let unrelated UI prose dominate crawl ranking.
    for (const key of ['field', 'subfields', 'notes', 'seedPrograms', 'query', 'terms']) {
      researchQueryValues(value[key], output)
    }
  }
  return output
}

function buildResearchQueryProfile(value) {
  const phrases = []
  const tokens = new Set()
  const acronyms = new Set()
  for (const raw of researchQueryValues(value)) {
    const phrase = normalizeSearchSignal(raw)
    if (!phrase) continue
    if (!phrases.includes(phrase)) phrases.push(phrase)
    const words = phrase.split(' ').filter((word) => (
      word.length >= 2 && !QUERY_STOP_WORDS.has(word)
    ))
    for (const word of words) tokens.add(word)
    if (words.length >= 2 && words.length <= 8) {
      const acronym = words.map((word) => word[0]).join('')
      if (acronym.length >= 2) acronyms.add(acronym)
    }
  }
  return {
    phrases: phrases.slice(0, 16),
    tokens: [...tokens].slice(0, 48),
    acronyms: [...acronyms].slice(0, 16),
  }
}

function searchSignalHasTerm(signal, term) {
  if (term.length > 3) return signal.includes(term)
  return ` ${signal} `.includes(` ${term} `)
}

function queryRelevanceScore(url, label, queryProfile, excerpt = '') {
  if (!queryProfile?.tokens?.length && !queryProfile?.phrases?.length) return 0
  const path = normalizeSearchSignal(url)
  const heading = normalizeSearchSignal(label)
  const body = normalizeSearchSignal(excerpt).slice(0, 2_000)
  let score = 0
  for (const phrase of queryProfile.phrases || []) {
    if (phrase.length < 4) continue
    if (path.includes(phrase)) score += 46
    else if (heading.includes(phrase)) score += 34
    else if (body.includes(phrase)) score += 12
  }
  for (const token of queryProfile.tokens || []) {
    if (searchSignalHasTerm(path, token)) score += 17
    else if (searchSignalHasTerm(heading, token)) score += 12
    else if (searchSignalHasTerm(body, token)) score += 4
  }
  for (const acronym of queryProfile.acronyms || []) {
    const pattern = new RegExp(`(?:^| )${acronym}(?: |$)`, 'i')
    if (pattern.test(path)) score += 24
    else if (pattern.test(heading)) score += 16
  }
  return Math.min(240, score)
}

function junkPagePenalty(value, label = '') {
  let path = String(value || '')
  try {
    const url = new URL(path, 'https://crawler.invalid')
    path = `${url.pathname}${url.search}`
  } catch { /* use raw signal */ }
  const signal = `${path} ${String(label || '')}`
  return Math.min(500, JUNK_PAGE_RULES.reduce(
    (penalty, [pattern, amount]) => penalty + (pattern.test(signal) ? amount : 0),
    0,
  ))
}

function isIndividualAdvisorPage(value, label = '') {
  let pathname = String(value || '')
  try { pathname = new URL(pathname, 'https://crawler.invalid').pathname } catch { /* use raw signal */ }
  if (junkPagePenalty(pathname, label) >= 200) return false
  const segments = pathname.split('/').filter(Boolean).map((segment) => normalizeSearchSignal(segment))
  const containerIndex = segments.findIndex((segment) => (
    /^(?:people individual|people|persons?|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)$/.test(segment)
  ))
  const genericSegments = /^(?:academic|academic staff|academics|all|browse|contact|current|directory|faculty|home|index|list|listing|members?|our team|people|profiles?|researchers?|search|staff|team)$/
  if (containerIndex >= 0) {
    const detail = segments.slice(containerIndex + 1).filter((segment) => segment && !genericSegments.test(segment))
    if (detail.length > 0) return true
  }
  if (/(?:^|\/)(?:profile|person|people-individual)\//i.test(pathname)) return true
  const nameWords = normalizeSearchSignal(label).split(' ').filter(Boolean)
  return /\b(?:prof(?:essor)?|dr)\b/i.test(String(label || ''))
    && nameWords.length >= 3
    && isPersonOrDirectoryCrawlPath(pathname)
}

function isPersonOrDirectoryCrawlPath(value) {
  let pathname = String(value || '')
  try { pathname = new URL(pathname, 'https://crawler.invalid').pathname } catch { /* use raw signal */ }
  return /\/(?:people[_-]?individual|people|persons?|faculty|staff|directory|profiles?|experts?|researchers?|team|members?)(?:\/|$)/i
    .test(pathname)
}

export function constrainDiscoverPageTypes(value, types) {
  const unique = uniqueTypes(types)
  if (!isPersonOrDirectoryCrawlPath(value)) return unique
  return uniqueTypes([
    ...unique.filter((type) => !['program', 'admissions', 'funding'].includes(type)),
    'advisor',
  ])
}

function pageTypes(value) {
  const signal = String(value || '')
  return PAGE_TYPE_RULES.filter(([, pattern]) => pattern.test(signal)).map(([type]) => type)
}

function seedTypes(kind) {
  if (kind === 'faculty') return ['advisor']
  if (kind === 'doctoral') return ['program', 'admissions']
  if (kind === 'departments' || kind === 'research') return ['research']
  return ['homepage']
}

function sitemapUrlsFromRobots(text, source) {
  const urls = []
  for (const match of String(text || '').matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
    const url = sourceAllowedUrl(match[1], source)?.toString()
    if (url && !urls.includes(url)) urls.push(url)
    if (urls.length >= MAX_SITEMAP_QUEUE) break
  }
  return urls
}

function sitemapLocations(text, source) {
  const locations = []
  for (const match of String(text || '').matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const value = htmlText(match[1]).replace(/&amp;/gi, '&').trim()
    const url = sourceAllowedUrl(value, source)
    if (url) locations.push(url.toString())
    if (locations.length >= MAX_SITEMAP_URLS) break
  }
  return [...new Set(locations)]
}

function hintedPageTypes(value, source) {
  const signal = String(value || '').toLowerCase()
  const hints = source?.pathHints || {}
  const mapping = [
    ['advisor', hints.faculty],
    ['research', hints.lab],
    ['research', hints.department],
    ['program', hints.program],
  ]
  return mapping
    .filter(([, values]) => (values || []).some((hint) => signal.includes(String(hint || '').toLowerCase())))
    .map(([type]) => type)
}

function pagePriority(types) {
  const weights = { program: 160, admissions: 145, research: 132, funding: 120, advisor: 108, homepage: 10 }
  return Math.max(0, ...(types || []).map((type) => weights[type] || 0))
}

function matchesDeclaredDetailPath(url, source) {
  return (source?.detail?.pathPatterns || []).some((pattern) => {
    try { return new RegExp(String(pattern), 'i').test(url.pathname) } catch { return false }
  })
}

function isPaginationLink(target, pageUrl, label) {
  let current
  try {
    current = new URL(pageUrl)
  } catch {
    return false
  }
  if (target.origin !== current.origin) return false
  const paginationParameter = [...target.searchParams.keys()].some((key) => PAGINATION_PARAM.test(key))
  const paginationPath = /\/(?:page|seite|pagina)\/\d+\/?$/i.test(target.pathname)
  const paginationLabel = PAGINATION_LABEL.test(String(label || '').replace(/\s+/g, ' ').trim())
  if (!paginationParameter && !paginationPath && !paginationLabel) return false
  const currentBase = current.pathname.replace(/\/(?:page|seite|pagina)\/\d+\/?$/i, '/').replace(/\/+$/, '')
  const targetBase = target.pathname.replace(/\/(?:page|seite|pagina)\/\d+\/?$/i, '/').replace(/\/+$/, '')
  return currentBase === targetBase
    || target.pathname === current.pathname
    || target.pathname.startsWith(`${currentBase}/`)
}

function candidateLinks(
  html,
  pageUrl,
  source,
  queryProfile,
  limit = CANDIDATE_LIMIT_PER_SOURCE,
  parentTypes = [],
) {
  const byUrl = new Map()
  let scanned = 0
  const hrefMatcher = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of String(html || '').matchAll(hrefMatcher)) {
    scanned += 1
    if (scanned > MAX_LINKS_SCANNED_PER_PAGE) break
    let resolved
    try {
      resolved = new URL(match[1], pageUrl).toString()
    } catch {
      continue
    }
    const target = sourceAllowedUrl(resolved, source)
    if (!target) continue
    const anchor = sanitizeUntrustedWebText(htmlText(match[2]), 220).text
    const pagination = isPaginationLink(target, pageUrl, anchor)
    const types = constrainDiscoverPageTypes(target.toString(), [
      ...pageTypes(`${target.pathname} ${target.search} ${anchor}`),
      ...hintedPageTypes(`${target.pathname} ${target.search} ${anchor}`, source),
      ...(matchesDeclaredDetailPath(target, source) ? ['program'] : []),
      ...(pagination ? parentTypes : []),
    ])
    if (!types.length) continue
    const individualAdvisor = types.includes('advisor') && isIndividualAdvisorPage(target.toString(), anchor)
    const relevanceScore = queryRelevanceScore(target.toString(), anchor, queryProfile)
    const junkPenalty = junkPagePenalty(target.toString(), anchor)
    const doctoral = DOCTORAL_LINK_SIGNAL.test(`${target.pathname} ${target.search} ${anchor}`)
    const candidate = {
      url: target.toString(),
      label: anchor || null,
      types,
      priority: pagePriority(types) + relevanceScore + (individualAdvisor ? 72 : 0) + (pagination ? 24 : 0) + (doctoral ? 180 : 0) - junkPenalty,
      relevanceScore,
      junkPenalty,
      individualAdvisor,
      pagination,
      doctoral,
    }
    const previous = byUrl.get(candidate.url)
    byUrl.set(candidate.url, previous ? {
      ...previous,
      label: previous.label || candidate.label,
      types: uniqueTypes([...previous.types, ...candidate.types]),
      priority: Math.max(previous.priority, candidate.priority),
      relevanceScore: Math.max(previous.relevanceScore || 0, candidate.relevanceScore),
      junkPenalty: Math.min(previous.junkPenalty ?? 500, candidate.junkPenalty),
      individualAdvisor: previous.individualAdvisor || candidate.individualAdvisor,
      pagination: previous.pagination || candidate.pagination,
      doctoral: previous.doctoral || candidate.doctoral,
    } : candidate)
  }
  return [...byUrl.values()]
    .sort((left, right) => (
      right.priority - left.priority
      || right.relevanceScore - left.relevanceScore
      || left.url.localeCompare(right.url)
    ))
    .slice(0, boundedInteger(limit, CANDIDATE_LIMIT_PER_SOURCE, 1, MAX_CANDIDATES_PER_SOURCE))
}

function mergeCandidate(existing, candidate, discoveredFrom) {
  if (!existing) {
    return {
      url: candidate.url,
      label: candidate.label,
      types: uniqueTypes(candidate.types),
      priority: candidate.priority,
      relevanceScore: candidate.relevanceScore || 0,
      junkPenalty: candidate.junkPenalty || 0,
      individualAdvisor: Boolean(candidate.individualAdvisor),
      pagination: Boolean(candidate.pagination),
      doctoral: Boolean(candidate.doctoral),
      discoveredFrom: [discoveredFrom],
      fetched: false,
      title: null,
    }
  }
  return {
    ...existing,
    label: existing.label || candidate.label,
    types: uniqueTypes([...existing.types, ...candidate.types]),
    priority: Math.max(existing.priority, candidate.priority),
    relevanceScore: Math.max(existing.relevanceScore || 0, candidate.relevanceScore || 0),
    junkPenalty: Math.min(existing.junkPenalty ?? 500, candidate.junkPenalty ?? 500),
    individualAdvisor: existing.individualAdvisor || candidate.individualAdvisor,
    pagination: existing.pagination || candidate.pagination,
    doctoral: existing.doctoral || candidate.doctoral,
    discoveredFrom: [...new Set([...existing.discoveredFrom, discoveredFrom])].slice(0, 12),
  }
}

function pageEntry(page) {
  return {
    url: page.url,
    title: page.title ? sanitizeUntrustedWebText(page.title, 180).text : null,
    label: page.label ? sanitizeUntrustedWebText(page.label, 220).text : null,
    types: uniqueTypes(page.types),
    discoveredFrom: [...new Set(page.discoveredFrom || [])].slice(0, 12),
    fetched: Boolean(page.fetched),
    priority: Number.isFinite(page.priority) ? page.priority : 0,
    relevanceScore: Number.isFinite(page.relevanceScore) ? page.relevanceScore : 0,
    junkPenalty: Number.isFinite(page.junkPenalty) ? page.junkPenalty : 0,
    individualAdvisor: Boolean(page.individualAdvisor),
    pagination: Boolean(page.pagination),
    doctoral: Boolean(page.doctoral),
    declaredKinds: [...new Set(page.declaredKinds || [])].slice(0, 8),
    promptInjectionSuspected: Boolean(page.promptInjectionSuspected),
  }
}

function upsertBoundedCandidate(candidates, candidate, discoveredFrom, limit) {
  const previous = candidates.get(candidate.url)
  if (previous) {
    candidates.set(candidate.url, mergeCandidate(previous, candidate, discoveredFrom))
    return candidates.get(candidate.url)
  }
  const merged = mergeCandidate(null, candidate, discoveredFrom)
  if (candidates.size < limit) {
    candidates.set(candidate.url, merged)
    return merged
  }
  let worst = null
  for (const current of candidates.values()) {
    if (
      !worst
      || current.priority < worst.priority
      || (current.priority === worst.priority && current.relevanceScore < worst.relevanceScore)
    ) worst = current
  }
  if (!worst || merged.priority <= worst.priority) return null
  candidates.delete(worst.url)
  candidates.set(merged.url, merged)
  return merged
}

const BALANCED_CRAWL_BUCKETS = ['program', 'individual-advisor', 'research', 'admissions', 'funding', 'advisor']

function crawlBucketMatches(page, bucket) {
  const types = page?.types || []
  if (bucket === 'individual-advisor') return types.includes('advisor') && Boolean(page.individualAdvisor)
  if (bucket === 'advisor') return types.includes('advisor')
  return types.includes(bucket)
}

function balancedCrawlTargets(pageLimit) {
  return {
    program: Math.max(1, Math.ceil(pageLimit * 0.18)),
    'individual-advisor': Math.max(1, Math.ceil(pageLimit * 0.22)),
    research: Math.max(1, Math.ceil(pageLimit * 0.16)),
    admissions: Math.max(1, Math.ceil(pageLimit * 0.1)),
    funding: Math.max(1, Math.ceil(pageLimit * 0.08)),
    advisor: Math.max(1, Math.ceil(pageLimit * 0.08)),
  }
}

function takeBalancedPending(pending, counts, targets, attempts) {
  pending.sort((left, right) => (
    Number(Boolean(right.isDeclaredSeed)) - Number(Boolean(left.isDeclaredSeed))
    || right.priority - left.priority
    || (right.relevanceScore || 0) - (left.relevanceScore || 0)
    || left.depth - right.depth
    || left.url.localeCompare(right.url)
  ))
  const declaredIndex = pending.findIndex((page) => page.isDeclaredSeed)
  if (declaredIndex >= 0) return pending.splice(declaredIndex, 1)[0]

  let chosenBucket = null
  let largestDeficit = 0
  for (const bucket of BALANCED_CRAWL_BUCKETS) {
    const target = targets[bucket] || 0
    if (!target) continue
    const hasUsefulCandidate = pending.some((page) => (
      crawlBucketMatches(page, bucket) && (page.junkPenalty || 0) < 200
    ))
    if (!hasUsefulCandidate) continue
    const failedAttempts = Math.max(0, (attempts[bucket] || 0) - (counts[bucket] || 0))
    const effectiveCoverage = (counts[bucket] || 0) + Math.min(target, failedAttempts) * 0.5
    const deficit = Math.max(0, target - effectiveCoverage) / target
    if (deficit > largestDeficit) {
      largestDeficit = deficit
      chosenBucket = bucket
    }
  }
  if (chosenBucket) {
    const index = pending.findIndex((page) => (
      crawlBucketMatches(page, chosenBucket) && (page.junkPenalty || 0) < 200
    ))
    if (index >= 0) return pending.splice(index, 1)[0]
  }
  return pending.shift()
}

function recordBalancedCrawlSelection(page, counts) {
  for (const bucket of BALANCED_CRAWL_BUCKETS) {
    if (crawlBucketMatches(page, bucket)) counts[bucket] = (counts[bucket] || 0) + 1
  }
}

function robotsRuleMatch(pattern, target) {
  const anchored = pattern.endsWith('$')
  const rawPattern = anchored ? pattern.slice(0, -1) : pattern
  const expression = rawPattern
    .split('*')
    .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
    .join('.*')
  try {
    return new RegExp(`^${expression}${anchored ? '$' : ''}`).test(target)
  } catch {
    return false
  }
}

/**
 * Small RFC 9309-style evaluator for the policy subset used by the crawler.
 * Grouped user-agents plus `*` and terminal `$` path patterns are supported;
 * this is required for policies such as EURAXESS' `Disallow: /jobs/*`.
 */
export function allowsDiscoverCrawl(robotsText, pathname, userAgentValue = DISCOVER_CRAWLER_USER_AGENT) {
  const lines = String(robotsText || '').split(/\r?\n/)
  const groups = []
  let group = null
  let groupHasRules = false
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line || !line.includes(':')) continue
    const separator = line.indexOf(':')
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key === 'user-agent') {
      if (!group || groupHasRules) {
        group = { agents: [], rules: [] }
        groups.push(group)
        groupHasRules = false
      }
      if (value) group.agents.push(value.toLowerCase())
      continue
    }
    if (!group || (key !== 'allow' && key !== 'disallow')) continue
    groupHasRules = true
    // An empty Disallow value means no restriction and has no matching rule.
    if (value) group.rules.push({ path: value, allow: key === 'allow' })
  }

  const userAgent = String(userAgentValue || DISCOVER_CRAWLER_USER_AGENT).toLowerCase()
  const productToken = userAgent.split(/[\s/]/, 1)[0]
  const scoredGroups = groups.map((candidate) => {
    const scores = candidate.agents.map((agent) => {
      if (agent === '*') return 0
      const agentToken = agent.split(/[\s/]/, 1)[0]
      // robots product tokens match from the beginning of our declared
      // crawler token. Arbitrary substrings such as "health" must not select
      // a more permissive specific group over the wildcard policy.
      return agentToken && productToken === agentToken ? agentToken.length : -1
    })
    return { candidate, score: scores.length ? Math.max(...scores) : -1 }
  }).filter((entry) => entry.score >= 0)
  if (!scoredGroups.length) return true
  const bestAgentScore = Math.max(...scoredGroups.map((entry) => entry.score))
  let bestRule = null
  for (const { candidate, score } of scoredGroups) {
    if (score !== bestAgentScore) continue
    for (const rule of candidate.rules) {
      if (!robotsRuleMatch(rule.path, pathname)) continue
      const specificity = rule.path.replace(/\*|\$$/g, '').length
      if (
        !bestRule
        || specificity > bestRule.specificity
        || (specificity === bestRule.specificity && rule.allow && !bestRule.allow)
      ) bestRule = { ...rule, specificity }
    }
  }
  return bestRule?.allow !== false
}

async function fetchText(url, {
  fetchImpl,
  timeoutMs,
  source,
  onHttpStatus,
  onFailure,
  beforeFetch,
  allowRequest,
  dnsLookup,
}) {
  const fail = (reason, details = {}) => {
    onFailure?.({ reason, ...details })
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), boundedInteger(
    timeoutMs,
    12_000,
    250,
    MAX_REQUEST_TIMEOUT_MS,
  ))
  try {
    let current = sourceAllowedUrl(url, source)
    if (!current) return fail('invalid-or-disallowed-url')
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (!(await isDiscoverPublicNetworkTarget(current, dnsLookup))) {
        return fail('non-public-network-target', { url: current.toString() })
      }
      if (allowRequest && !(await allowRequest(current))) {
        return fail('robots-denied', { url: current.toString() })
      }
      await beforeFetch?.(current)
      const response = await fetchImpl(current.toString(), {
        headers: { 'User-Agent': DISCOVER_CRAWLER_USER_AGENT, Accept: 'text/html, text/plain;q=0.9' },
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location')
        let next = null
        try {
          next = location ? sourceAllowedUrl(new URL(location, current).toString(), source) : null
        } catch {
          next = null
        }
        if (!next) return fail('redirect-left-allowed-hosts', { status: response.status })
        current = next
        continue
      }
      if (!response.ok) {
        onHttpStatus?.(response.status)
        return fail('http-error', { status: response.status, url: current.toString() })
      }
      const finalUrl = sourceAllowedUrl(response.url || current.toString(), source)
      if (!finalUrl) return fail('final-url-left-allowed-hosts')
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
      if (
        contentType
        && !contentType.includes('text/html')
        && !contentType.includes('text/plain')
        && !contentType.includes('application/xml')
        && !contentType.includes('text/xml')
      ) return fail('unsupported-content-type', { contentType })
      const body = await readDiscoverResponseText(response)
      return {
        url: finalUrl.toString(),
        text: body.text,
        truncated: body.truncated,
        contentType,
      }
    }
    return fail('too-many-redirects')
  } catch (error) {
    return fail(error?.name === 'AbortError' ? 'timeout' : 'network-error')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Crawl a small, polite same-origin slice of one official university site.
 * We keep every relevant link found within the bounded crawl as structured
 * evidence, including advisor/directory pages that were not fetched before
 * the page budget is reached. This is intentionally an index, not a claim
 * that every link contains a currently accepting supervisor.
 */
export async function crawlDiscoverSource(source, {
  fetchImpl = globalThis.fetch,
  maxPages = 8,
  maxCandidatePages = CANDIDATE_LIMIT_PER_SOURCE,
  timeoutMs = 12_000,
  dnsLookup,
  researchQuery = null,
} = {}) {
  if (!source?.url || typeof fetchImpl !== 'function') return { source, pages: [], candidatePages: [], skipped: 'invalid-source' }
  const origin = sourceAllowedUrl(source.url, source)
  if (!origin) return { source, pages: [], candidatePages: [], skipped: 'invalid-source' }
  const networkLookup = dnsLookup === undefined
    ? (fetchImpl === globalThis.fetch ? nodeDnsLookup : null)
    : dnsLookup
  const requestTimeoutMs = boundedInteger(timeoutMs, 12_000, 250, MAX_REQUEST_TIMEOUT_MS)
  const callerPageLimit = boundedInteger(maxPages, 8, 1, MAX_PAGES_PER_SOURCE)
  const candidateLimit = boundedInteger(
    maxCandidatePages,
    CANDIDATE_LIMIT_PER_SOURCE,
    1,
    MAX_CANDIDATES_PER_SOURCE,
  )
  const queryProfile = buildResearchQueryProfile(researchQuery)
  if (source?.crawlPolicy?.enabled === false) {
    const attemptedAt = new Date().toISOString()
    return {
      source,
      pages: [],
      candidatePages: [],
      skipped: 'blocked',
      health: {
        status: 'blocked',
        attemptedAt,
        declaredSeedCount: source?.seeds?.length || 0,
        distinctSeedUrlCount: new Set((source?.seeds || []).map((seed) => seed?.url).filter(Boolean)).size,
        sitemapCount: 0,
        fetchedPageCount: 0,
        candidatePageCount: 0,
        httpFailures: [],
        robotsDenied: [],
        policyReason: source.crawlPolicy.reason || 'source-crawl-disabled-by-policy',
      },
    }
  }
  const httpFailures = []
  const robotsDenied = []
  const robotsUnavailable = []
  const fetchFailures = []
  const crawlDelayMs = Math.min(60_000, Math.max(0, Number(source?.crawlPolicy?.crawlDelayMs) || 0))
  const nextFetchAt = new Map()
  const beforeFetch = crawlDelayMs > 0
    ? async (url) => {
        const parsed = sourceAllowedUrl(url, source)
        if (!parsed) return
        const waitMs = Math.max(0, (nextFetchAt.get(parsed.origin) || 0) - Date.now())
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
        nextFetchAt.set(parsed.origin, Date.now() + crawlDelayMs)
      }
    : null
  const fetchOptions = {
    fetchImpl,
    timeoutMs: requestTimeoutMs,
    source,
    beforeFetch,
    dnsLookup: networkLookup,
    onHttpStatus: (status) => httpFailures.push(status),
    onFailure: (failure) => fetchFailures.push(failure),
  }
  const robotsByOrigin = new Map()
  const robotsFor = async (url) => {
    const parsed = sourceAllowedUrl(url, source)
    if (!parsed) return null
    if (!robotsByOrigin.has(parsed.origin)) {
      const robotsUrl = new URL('/robots.txt', parsed.origin).toString()
      let failure = null
      let robotsStatus = null
      const robots = await fetchText(robotsUrl, {
        ...fetchOptions,
        onHttpStatus: (status) => { robotsStatus = status },
        onFailure: (value) => { failure = value },
      })
      const missing = failure?.reason === 'http-error' && [404, 410].includes(failure.status)
      if (robotsStatus && !missing) httpFailures.push(robotsStatus)
      robotsByOrigin.set(parsed.origin, robots
        ? { accessible: true, text: robots.text }
        : { accessible: Boolean(missing), text: '', failure })
    }
    return robotsByOrigin.get(parsed.origin)
  }
  const robotsAllows = async (url) => {
    const parsed = sourceAllowedUrl(url, source)
    if (!parsed) return false
    const policy = await robotsFor(parsed)
    if (!policy?.accessible) {
      robotsUnavailable.push(parsed.origin)
      return false
    }
    if (!allowsDiscoverCrawl(policy.text, `${parsed.pathname}${parsed.search}`)) {
      robotsDenied.push(parsed.toString())
      return false
    }
    return true
  }
  const declaredSeeds = (source.seeds || []).slice(0, MAX_SEEDS_PER_SOURCE)
    .map((seed) => {
      const url = sourceAllowedUrl(seed?.url, source)?.toString()
      const types = constrainDiscoverPageTypes(url, seedTypes(seed?.kind))
      const relevanceScore = queryRelevanceScore(url, seed?.kind, queryProfile)
      return {
        url,
        types,
        // Explicitly declared entry points always run before discovered links;
        // query scoring orders peers but never bypasses an adapter seed.
        priority: 1_000 + (pagePriority(types) || 20) + relevanceScore,
        relevanceScore,
        junkPenalty: junkPagePenalty(url, seed?.kind),
        individualAdvisor: types.includes('advisor') && isIndividualAdvisorPage(url, seed?.kind),
        depth: 0,
        declaredKinds: seed?.kind ? [seed.kind] : [],
        isDeclaredSeed: true,
      }
    })
    .filter((seed) => seed.url)
  // A university may deliberately use one index for both departments and
  // research groups. Union duplicate seed meanings before the seen-URL gate;
  // otherwise whichever declaration sorts first silently wins.
  const initialSeeds = [...declaredSeeds.reduce((byUrl, seed) => {
    const previous = byUrl.get(seed.url)
    byUrl.set(seed.url, previous ? {
      ...previous,
      types: uniqueTypes([...previous.types, ...seed.types]),
      priority: Math.max(previous.priority, seed.priority),
      declaredKinds: [...new Set([...previous.declaredKinds, ...seed.declaredKinds])],
    } : seed)
    return byUrl
  }, new Map()).values()]
  const distinctSeedUrlCount = initialSeeds.length
  const pending = initialSeeds.length
    ? initialSeeds
    : [{ url: origin.toString(), types: ['homepage'], priority: 1, depth: 0, declaredKinds: [] }]
  const sitemapQueue = []
  const seedOrigins = [...new Set(pending.map((seed) => new URL(seed.url).origin))]
  for (const seedOrigin of seedOrigins) {
    const policy = await robotsFor(seedOrigin)
    if (policy?.accessible && source?.crawlPolicy?.followSitemaps !== false) {
      // Multi-seed school adapters already provide typed entry points. Guessing
      // /sitemap.xml on every faculty/graduate/research subdomain can add four
      // full request timeouts before useful pages are fetched. Always honour a
      // sitemap declared by robots; only guess the conventional path when the
      // source has no adapter breadth of its own.
      const declaredSitemaps = sitemapUrlsFromRobots(policy.text, source)
      for (const sitemap of [
        ...declaredSitemaps,
        ...(initialSeeds.length <= 1 && !declaredSitemaps.length
          ? [new URL('/sitemap.xml', seedOrigin).toString()]
          : []),
      ]) {
        if (sitemapQueue.length >= MAX_SITEMAP_QUEUE) break
        if (!sitemapQueue.includes(sitemap)) sitemapQueue.push(sitemap)
      }
    }
  }
  const seenSitemaps = new Set()
  while (sitemapQueue.length && seenSitemaps.size < MAX_SITEMAP_DOCUMENTS) {
    const sitemapUrl = sourceAllowedUrl(sitemapQueue.shift(), source)?.toString()
    if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue
    seenSitemaps.add(sitemapUrl)
    const sitemap = await fetchText(sitemapUrl, { ...fetchOptions, allowRequest: robotsAllows })
    if (!sitemap) continue
    for (const location of sitemapLocations(sitemap.text, source)) {
      if (/\.xml(?:$|\?)/i.test(location)) {
        if (sitemapQueue.length < MAX_SITEMAP_QUEUE && !sitemapQueue.includes(location)) sitemapQueue.push(location)
        continue
      }
      const types = constrainDiscoverPageTypes(location, [
        ...pageTypes(location),
        ...hintedPageTypes(location, source),
      ])
      if (!types.length || pending.some((item) => item.url === location)) continue
      const relevanceScore = queryRelevanceScore(location, '', queryProfile)
      const junkPenalty = junkPagePenalty(location)
      const individualAdvisor = types.includes('advisor') && isIndividualAdvisorPage(location)
      const doctoral = DOCTORAL_LINK_SIGNAL.test(location)
      pending.push({
        url: location,
        types,
        priority: pagePriority(types) + relevanceScore + (individualAdvisor ? 72 : 0) + (doctoral ? 180 : 0) - junkPenalty + 10,
        relevanceScore,
        junkPenalty,
        individualAdvisor,
        doctoral,
        depth: 0,
        declaredKinds: ['sitemap'],
      })
    }
  }
  const seen = new Set()
  const candidates = new Map()
  const pagesByUrl = new Map()
  const configuredPageLimit = Number(source?.crawlPolicy?.maxPages)
  const pageLimit = Number.isFinite(configuredPageLimit) && configuredPageLimit > 0
    ? Math.min(callerPageLimit, boundedInteger(configuredPageLimit, callerPageLimit, 1, MAX_PAGES_PER_SOURCE))
    : callerPageLimit
  const balancedCounts = Object.fromEntries(BALANCED_CRAWL_BUCKETS.map((bucket) => [bucket, 0]))
  const balancedAttempts = Object.fromEntries(BALANCED_CRAWL_BUCKETS.map((bucket) => [bucket, 0]))
  const balancedTargets = balancedCrawlTargets(pageLimit)
  let attemptedPageCount = 0
  while (pending.length > 0 && attemptedPageCount < pageLimit) {
    const next = takeBalancedPending(pending, balancedCounts, balancedTargets, balancedAttempts)
    if (!next?.url || seen.has(next.url)) continue
    seen.add(next.url)
    const url = sourceAllowedUrl(next.url, source)
    if (!url || !(await robotsAllows(url))) continue
    attemptedPageCount += 1
    recordBalancedCrawlSelection(next, balancedAttempts)
    const fetched = await fetchText(url.toString(), { ...fetchOptions, allowRequest: robotsAllows })
    if (!fetched) continue
    const fetchedUrl = sourceAllowedUrl(fetched.url, source)
    if (!fetchedUrl) continue
    const sanitized = sanitizeUntrustedWebText(htmlText(fetched.text), 4_000)
    const fetchedTitle = titleFromHtml(fetched.text)
    const fetchedTypes = constrainDiscoverPageTypes(fetchedUrl.toString(), [
      ...next.types,
      ...pageTypes(`${fetchedUrl.pathname} ${fetchedTitle}`),
      ...hintedPageTypes(`${fetchedUrl.pathname} ${fetchedTitle}`, source),
    ])
    if (sanitized.text.length > 0) {
      recordBalancedCrawlSelection(next, balancedCounts)
      const relevanceScore = Math.max(
        next.relevanceScore || 0,
        queryRelevanceScore(fetchedUrl.toString(), fetchedTitle, queryProfile, sanitized.text),
      )
      const junkPenalty = Math.max(next.junkPenalty || 0, junkPagePenalty(fetchedUrl.toString(), fetchedTitle))
      const individualAdvisor = fetchedTypes.includes('advisor')
        && (next.individualAdvisor || isIndividualAdvisorPage(fetchedUrl.toString(), fetchedTitle))
      const page = {
        url: fetchedUrl.toString(),
        title: fetchedTitle || source.school,
        label: next.label || null,
        types: fetchedTypes,
        excerpt: sanitized.text,
        discoveredFrom: next.discoveredFrom || [],
        fetched: true,
        declaredKind: next.declaredKinds?.[0] || null,
        declaredKinds: next.declaredKinds || [],
        priority: Math.max(
          next.priority || 0,
          pagePriority(fetchedTypes) + relevanceScore + (individualAdvisor ? 72 : 0) - junkPenalty,
        ),
        relevanceScore,
        junkPenalty,
        individualAdvisor,
        pagination: Boolean(next.pagination),
        promptInjectionSuspected: sanitized.promptInjectionSuspected,
        truncated: Boolean(fetched.truncated),
        contentType: fetched.contentType || '',
        htmlDocument: /<(?:!doctype\s+html|html|head|body)\b/i.test(fetched.text),
      }
      const previous = pagesByUrl.get(page.url)
      pagesByUrl.set(page.url, previous ? {
        ...previous,
        types: uniqueTypes([...previous.types, ...page.types]),
        discoveredFrom: [...new Set([...previous.discoveredFrom, ...page.discoveredFrom])].slice(0, 12),
        declaredKinds: [...new Set([...previous.declaredKinds, ...page.declaredKinds])],
        promptInjectionSuspected: previous.promptInjectionSuspected || page.promptInjectionSuspected,
        truncated: previous.truncated || page.truncated,
      } : page)
    }
    for (const candidate of candidateLinks(
      fetched.text,
      fetchedUrl.toString(),
      source,
      queryProfile,
      Math.min(candidateLimit, CANDIDATE_LIMIT_PER_SOURCE),
      fetchedTypes,
    )) {
      const indexed = upsertBoundedCandidate(candidates, candidate, fetchedUrl.toString(), candidateLimit)
      if (!indexed || seen.has(indexed.url) || next.depth >= 2) continue
      if (!pending.some((item) => item.url === indexed.url)) {
        pending.push({ ...indexed, depth: next.depth + 1 })
      }
    }
  }

  const pages = [...pagesByUrl.values()]
  const fetchedUrls = new Map(pages.map((page) => [page.url, page]))
  const candidatePages = [...candidates.values()]
    .map((candidate) => {
      const fetchedPage = fetchedUrls.get(candidate.url)
      return pageEntry({
        ...candidate,
        title: fetchedPage?.title || candidate.title,
        types: uniqueTypes([...(candidate.types || []), ...(fetchedPage?.types || [])]),
        fetched: Boolean(fetchedPage),
        relevanceScore: Math.max(candidate.relevanceScore || 0, fetchedPage?.relevanceScore || 0),
        junkPenalty: Math.max(candidate.junkPenalty || 0, fetchedPage?.junkPenalty || 0),
        individualAdvisor: candidate.individualAdvisor || fetchedPage?.individualAdvisor,
        declaredKinds: fetchedPage?.declaredKinds || candidate.declaredKinds || [],
      })
    })
    .sort((left, right) => (
      Number(right.fetched) - Number(left.fetched)
      || right.priority - left.priority
      || right.relevanceScore - left.relevanceScore
      || left.url.localeCompare(right.url)
    ))
  const blocked = robotsDenied.length > 0
    || robotsUnavailable.length > 0
    || httpFailures.some((status) => [401, 403, 429].includes(status))
  const skipped = pages.length ? null : (blocked ? 'blocked' : 'unavailable')
  return {
    source,
    pages,
    candidatePages,
    skipped,
    health: {
      status: skipped || 'ok',
      attemptedAt: new Date().toISOString(),
      declaredSeedCount: declaredSeeds.length,
      attemptedPageCount,
      distinctSeedUrlCount,
      sitemapCount: seenSitemaps.size,
      fetchedPageCount: pages.length,
      candidatePageCount: candidatePages.length,
      httpFailures: [...new Set(httpFailures)].sort((left, right) => left - right),
      robotsDenied: [...new Set(robotsDenied)].slice(0, 20),
      robotsUnavailable: [...new Set(robotsUnavailable)].slice(0, 20),
      fetchFailureReasons: [...new Set(fetchFailures.map((failure) => failure?.reason).filter(Boolean))],
      promptInjectionPageCount: pages.filter((page) => page.promptInjectionSuspected).length,
      balancedFetchCounts: balancedCounts,
      balancedAttemptCounts: balancedAttempts,
      policyReason: robotsDenied.length
        ? 'robots-disallow'
        : (robotsUnavailable.length ? 'robots-unavailable' : null),
    },
  }
}

/**
 * Crawl a broad but throttled source pool. Curated adapters are preferred;
 * application-derived roots still pass the same public-network, host,
 * redirect, robots and resource gates before any request is issued.
 */
export async function crawlDiscoverSources({
  regions = [],
  sources: suppliedSources,
  limit = 120,
  concurrency = 2,
  maxPages = 8,
  timeoutMs = 12_000,
  fetchImpl = globalThis.fetch,
  dnsLookup,
  researchQuery = null,
  onProgress,
  crawlSourceImpl = crawlDiscoverSource,
} = {}) {
  const sourceLimit = boundedInteger(limit, 120, 1, MAX_SOURCES_PER_RUN)
  const sources = (Array.isArray(suppliedSources) ? suppliedSources : listDiscoverResearchSources(regions)).slice(0, sourceLimit)
  const results = new Array(sources.length)
  let nextIndex = 0
  const workerCount = Math.min(
    boundedInteger(concurrency, 2, 1, MAX_CRAWL_CONCURRENCY),
    sources.length,
  )
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < sources.length) {
      const index = nextIndex++
      try {
        results[index] = await crawlSourceImpl(sources[index], {
          fetchImpl,
          dnsLookup,
          researchQuery,
          maxPages,
          timeoutMs,
        })
      } catch (error) {
        // An unexpected adapter/site failure is evidence about this one source,
        // not a reason to discard every other successfully crawled university.
        results[index] = {
          source: sources[index],
          pages: [],
          candidatePages: [],
          skipped: 'unavailable',
          health: {
            status: 'unavailable',
            attemptedAt: new Date().toISOString(),
            declaredSeedCount: sources[index]?.seeds?.length || 0,
            distinctSeedUrlCount: new Set((sources[index]?.seeds || []).map((seed) => seed?.url).filter(Boolean)).size,
            sitemapCount: 0,
            fetchedPageCount: 0,
            candidatePageCount: 0,
            httpFailures: [],
            robotsDenied: [],
            robotsUnavailable: [],
            fetchFailureReasons: ['crawler-exception'],
            errorCode: String(error?.code || error?.name || 'CRAWLER_EXCEPTION').slice(0, 80),
          },
        }
      }
      await onProgress?.({ completed: index + 1, total: sources.length, source: sources[index], result: results[index] })
    }
  }))
  return results
}

/**
 * A standalone, versioned JSON document that callers can persist or export.
 * The category arrays make advisor URLs directly consumable, while the page
 * records retain the type set for future page classes without a schema break.
 */
export function buildDiscoverSourceIndex(results, { generatedAt = new Date().toISOString() } = {}) {
  const categories = ['advisor', 'program', 'admissions', 'funding', 'research']
  const schools = (results || []).map((result) => {
    const pageMap = new Map()
    for (const candidate of result?.candidatePages || []) pageMap.set(candidate.url, pageEntry(candidate))
    for (const page of result?.pages || []) {
      const existing = pageMap.get(page.url)
      pageMap.set(page.url, pageEntry({
        ...existing,
        ...page,
        types: uniqueTypes([...(existing?.types || []), ...(page.types || [])]),
        fetched: true,
      }))
    }
    const pages = [...pageMap.values()].sort((left, right) => left.url.localeCompare(right.url))
    const entry = {
      school: String(result?.source?.school || '').slice(0, 220),
      region: String(result?.source?.region || '').slice(0, 32),
      country: String(result?.source?.country || '').slice(0, 100),
      countryCode: String(result?.source?.countryCode || '').slice(0, 8),
      officialUrl: String(result?.source?.url || '').slice(0, 500),
      sourceProvenance: String(result?.source?.sourceProvenance || 'curated-adapter').slice(0, 80),
      discoveryScore: Number.isFinite(result?.source?.discoveryScore) ? result.source.discoveryScore : null,
      allowedHosts: [...new Set((result?.source?.allowedHosts || [])
        .map((host) => String(host || '').trim().toLowerCase().replace(/^www\./, ''))
        .filter(Boolean))].slice(0, 40),
      collectedAt: generatedAt,
      crawlStatus: result?.skipped || 'ok',
      health: result?.health || {
        status: result?.skipped || 'ok',
        attemptedAt: generatedAt,
        declaredSeedCount: result?.source?.seeds?.length || 0,
        sitemapCount: 0,
        fetchedPageCount: (result?.pages || []).length,
        candidatePageCount: pages.length,
        httpFailures: [],
      },
      fetchedPageCount: (result?.pages || []).length,
      candidatePageCount: pages.length,
      pages,
    }
    for (const category of categories) {
      entry[`${category}Pages`] = pages.filter((page) => page.types.includes(category))
    }
    return entry
  }).filter((school) => school.school && school.officialUrl)
  return {
    schemaVersion: 1,
    generatedAt,
    sourceCount: schools.length,
    schools,
  }
}

function evidencePageScore(page, queryProfile) {
  const types = page?.types || []
  const individualAdvisor = Boolean(page?.individualAdvisor)
    || (types.includes('advisor') && isIndividualAdvisorPage(page?.url, page?.title || page?.label))
  const declared = (page?.declaredKinds || []).some((kind) => kind && kind !== 'sitemap')
  return pagePriority(types)
    + queryRelevanceScore(page?.url, page?.title || page?.label, queryProfile, page?.excerpt)
    + (declared ? 260 : 0)
    + (page?.fetched ? 48 : 0)
    + (individualAdvisor ? 74 : 0)
    - Math.max(page?.junkPenalty || 0, junkPagePenalty(page?.url, page?.title || page?.label))
    - (page?.promptInjectionSuspected ? 420 : 0)
}

function selectBalancedEvidencePages(pages, queryProfile, limit = 8) {
  const ranked = [...(pages || [])]
    .filter((page) => (
      junkPagePenalty(page?.url, page?.title || page?.label) < 200
      || (page?.declaredKinds || []).some((kind) => kind && kind !== 'sitemap')
    ))
    .map((page) => ({ page, score: evidencePageScore(page, queryProfile) }))
    .sort((left, right) => right.score - left.score || left.page.url.localeCompare(right.page.url))
  const selected = []
  const selectedUrls = new Set()
  const buckets = ['program', 'individual-advisor', 'research', 'admissions', 'funding', 'advisor']
  for (const bucket of buckets) {
    const match = ranked.find(({ page }) => !selectedUrls.has(page.url) && crawlBucketMatches({
      ...page,
      individualAdvisor: page.individualAdvisor
        || ((page.types || []).includes('advisor') && isIndividualAdvisorPage(page.url, page.title || page.label)),
    }, bucket))
    if (!match) continue
    selected.push(match.page)
    selectedUrls.add(match.page.url)
    if (selected.length >= limit) return selected
  }
  for (const { page } of ranked) {
    if (selectedUrls.has(page.url)) continue
    selected.push(page)
    selectedUrls.add(page.url)
    if (selected.length >= limit) break
  }
  return selected
}

function compactEvidencePage(page, excerptLength = 420) {
  const title = sanitizeUntrustedWebText(page?.title, 180)
  const excerpt = sanitizeUntrustedWebText(page?.excerpt, excerptLength)
  return {
    url: String(page?.url || '').slice(0, MAX_URL_LENGTH),
    title: title.text,
    types: uniqueTypes(page?.types),
    excerpt: excerpt.text,
    fetched: true,
    declaredKinds: [...new Set(page?.declaredKinds || [])].slice(0, 8),
    individualAdvisor: Boolean(page?.individualAdvisor),
    untrusted: true,
    promptInjectionSuspected: Boolean(
      page?.promptInjectionSuspected
      || title.promptInjectionSuspected
      || excerpt.promptInjectionSuspected
    ),
  }
}

function compactCandidatePage(page) {
  const title = sanitizeUntrustedWebText(page?.title, 120)
  const label = sanitizeUntrustedWebText(page?.label, 140)
  return {
    url: String(page?.url || '').slice(0, MAX_URL_LENGTH),
    title: title.text || null,
    label: label.text || null,
    types: uniqueTypes(page?.types),
    fetched: Boolean(page?.fetched),
    individualAdvisor: Boolean(page?.individualAdvisor),
    relevanceScore: Number.isFinite(page?.relevanceScore) ? page.relevanceScore : 0,
    untrusted: true,
    promptInjectionSuspected: Boolean(
      page?.promptInjectionSuspected
      || title.promptInjectionSuspected
      || label.promptInjectionSuspected
    ),
  }
}

function rankedCandidatePages(pages, type, queryProfile, limit) {
  return [...(pages || [])]
    .filter((page) => (
      (page?.types || []).includes(type)
      && (
        junkPagePenalty(page?.url, page?.title || page?.label) < 200
        || (page?.declaredKinds || []).some((kind) => kind && kind !== 'sitemap')
      )
    ))
    .sort((left, right) => (
      Number(Boolean(right.fetched)) - Number(Boolean(left.fetched))
      || (type === 'advisor'
        ? Number(Boolean(right.individualAdvisor)) - Number(Boolean(left.individualAdvisor))
        : 0)
      || evidencePageScore(right, queryProfile) - evidencePageScore(left, queryProfile)
      || String(left.url).localeCompare(String(right.url))
    ))
    .slice(0, limit)
}

function sourceEvidenceScore(result, queryProfile) {
  const pages = result?.pages || []
  const ranked = pages.map((page) => evidencePageScore(page, queryProfile)).sort((left, right) => right - left)
  const typeCoverage = new Set(pages.flatMap((page) => page?.types || [])).size
  const individualProfiles = pages.filter((page) => (
    page?.individualAdvisor || ((page?.types || []).includes('advisor') && isIndividualAdvisorPage(page.url, page.title))
  )).length
  return ranked.slice(0, 4).reduce((total, score) => total + score, 0)
    + typeCoverage * 90
    + Math.min(3, individualProfiles) * 80
}

function pushWithinBudget(entry, key, value, budget) {
  entry[key].push(value)
  if (JSON.stringify(entry).length <= budget) return true
  entry[key].pop()
  return false
}

function buildCompactEvidenceEntry(result, queryProfile, budget) {
  const school = sanitizeUntrustedWebText(result?.source?.school, 220)
  const region = sanitizeUntrustedWebText(result?.source?.region, 32)
  const entry = {
    school: school.text,
    region: region.text,
    country: String(result?.source?.country || '').slice(0, 100),
    countryCode: String(result?.source?.countryCode || '').slice(0, 8),
    officialUrl: String(result?.source?.url || '').slice(0, 500),
    sourceProvenance: String(result?.source?.sourceProvenance || 'curated-adapter').slice(0, 80),
    untrustedWebEvidence: true,
    promptInjectionSuspected: school.promptInjectionSuspected || region.promptInjectionSuspected,
    allowedHosts: [...new Set((result?.source?.allowedHosts || [])
      .map((host) => String(host || '').trim().toLowerCase().replace(/^www\./, ''))
      .filter(Boolean))].slice(0, 40),
    pages: [],
    advisorPages: [],
    programPages: [],
    admissionsPages: [],
    fundingPages: [],
    researchPages: [],
  }

  // Reserve roughly one third of each school budget for typed URL leads. This
  // prevents long excerpts from hiding every advisor/program candidate, while
  // still retaining enough page text for the model to make a precise match.
  const pageBudget = Math.max(700, Math.floor(budget * 0.66))
  for (const page of selectBalancedEvidencePages(result?.pages, queryProfile, 8)) {
    let added = false
    for (const excerptLength of [420, 260, 140, 0]) {
      if (pushWithinBudget(entry, 'pages', compactEvidencePage(page, excerptLength), pageBudget)) {
        added = true
        break
      }
    }
    if (!added && !entry.pages.length) continue
  }
  if (!entry.pages.length) return null

  const candidatePlans = {
    programPages: rankedCandidatePages(result?.candidatePages, 'program', queryProfile, 8),
    advisorPages: rankedCandidatePages(result?.candidatePages, 'advisor', queryProfile, 10),
    researchPages: rankedCandidatePages(result?.candidatePages, 'research', queryProfile, 6),
    admissionsPages: rankedCandidatePages(result?.candidatePages, 'admissions', queryProfile, 5),
    fundingPages: rankedCandidatePages(result?.candidatePages, 'funding', queryProfile, 4),
  }
  const categoryOrder = ['programPages', 'advisorPages', 'researchPages', 'admissionsPages', 'fundingPages']
  const largestPlan = Math.max(0, ...Object.values(candidatePlans).map((pages) => pages.length))
  for (let index = 0; index < largestPlan; index += 1) {
    for (const key of categoryOrder) {
      const page = candidatePlans[key][index]
      if (page) pushWithinBudget(entry, key, compactCandidatePage(page), budget)
    }
  }
  entry.promptInjectionSuspected = entry.promptInjectionSuspected
    || entry.pages.some((page) => page.promptInjectionSuspected)
    || categoryOrder.some((key) => entry[key].some((page) => page.promptInjectionSuspected))
  return entry
}

export function discoverEvidenceSourceTargetCount(rankedSourceCount, sourceLimit, characterLimit) {
  const available = Math.max(0, Number(rankedSourceCount) || 0)
  const boundedSources = Math.max(1, Number(sourceLimit) || 1)
  const characters = Math.max(1_000, Number(characterLimit) || 1_000)
  // Roughly 2.4k characters is enough for one fetched page plus a balanced set
  // of typed URL leads. The old fixed 12-school ceiling hid most universities
  // in larger regions even when the overall prompt budget had room for them.
  const budgetCapacity = Math.max(1, Math.floor(characters / 2_400))
  return Math.max(1, Math.min(24, available, boundedSources, budgetCapacity))
}

export function compactDiscoverCrawlEvidence(results, {
  maxSources = 120,
  maxChars = 96_000,
  researchQuery = null,
} = {}) {
  const evidence = []
  // Include the JSON array delimiters and inter-entry commas in the same hard
  // character budget that is advertised to callers.
  let used = 2
  const sourceLimit = boundedInteger(maxSources, 120, 1, MAX_SOURCES_PER_RUN)
  const characterLimit = boundedInteger(maxChars, 96_000, 1_000, 512_000)
  const queryProfile = buildResearchQueryProfile(researchQuery)
  const rankedResults = (results || [])
    .filter((result) => (result?.pages || []).length)
    .map((result, index) => ({ result, index, score: sourceEvidenceScore(result, queryProfile) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const targetSourceCount = discoverEvidenceSourceTargetCount(
    rankedResults.length,
    sourceLimit,
    characterLimit,
  )
  const perSourceBudget = Math.max(900, Math.floor(characterLimit / targetSourceCount))

  for (const { result } of rankedResults) {
    if (evidence.length >= targetSourceCount) break
    const separatorSize = evidence.length ? 1 : 0
    const remaining = characterLimit - used - separatorSize
    if (remaining < 500) break
    const entry = buildCompactEvidenceEntry(result, queryProfile, Math.min(perSourceBudget, remaining))
    if (!entry) continue
    const size = JSON.stringify(entry).length
    // Skip an unusually large record instead of ending the whole region. A
    // later school may still fit and yield a directly usable programme page.
    if (used + separatorSize + size > characterLimit) continue
    evidence.push(entry)
    used += separatorSize + size
  }
  return evidence
}
