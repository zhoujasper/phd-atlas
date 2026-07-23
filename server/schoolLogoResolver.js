import { Buffer } from 'node:buffer'
import { lookup as nodeDnsLookup } from 'node:dns/promises'
import { isDiscoverPublicHostname, isDiscoverPublicNetworkTarget } from './discover-source-crawler.js'

const MAX_URL_LENGTH = 2_048
const MAX_REDIRECTS = 4
const MAX_HTML_BYTES = 900_000
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_CANDIDATES = 8
const PAGE_TIMEOUT_MS = 6_000
const IMAGE_TIMEOUT_MS = 5_000
const LOGO_USER_AGENT = 'PhDAtlas-SchoolLogo/1.0 (+official-school-identity)'

function cleanHtmlUrl(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .trim()
}

export function normalizeSchoolLogoRemoteUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
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

function attributesFromTag(tag) {
  const attributes = {}
  const body = String(tag || '').replace(/^<\s*\/?\s*[^\s>]+/u, '').replace(/\/?\s*>$/u, '')
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu
  for (const match of body.matchAll(pattern)) {
    attributes[String(match[1] || '').toLowerCase()] = cleanHtmlUrl(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function logoValuesFromJson(value, values = []) {
  if (!value || values.length >= 12) return values
  if (Array.isArray(value)) {
    for (const entry of value) logoValuesFromJson(entry, values)
    return values
  }
  if (typeof value !== 'object') return values
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase() === 'logo') {
      if (typeof entry === 'string') values.push(entry)
      else if (entry && typeof entry === 'object' && typeof entry.url === 'string') values.push(entry.url)
    }
    logoValuesFromJson(entry, values)
  }
  return values
}

function candidateUrl(value, pageUrl, baseUrl) {
  try {
    const resolved = new URL(cleanHtmlUrl(value), baseUrl || pageUrl)
    return normalizeSchoolLogoRemoteUrl(resolved.toString())?.toString() ?? ''
  } catch {
    return ''
  }
}

function iconSizeScore(value) {
  const sizes = String(value || '').toLowerCase()
  if (sizes.includes('any')) return 22
  const largest = Array.from(sizes.matchAll(/(\d{1,4})x(\d{1,4})/gu))
    .reduce((best, match) => Math.max(best, Number(match[1]) * Number(match[2])), 0)
  if (largest >= 512 * 512) return 20
  if (largest >= 192 * 192) return 16
  if (largest >= 96 * 96) return 12
  if (largest >= 32 * 32) return 6
  return 0
}

function schoolNameSignals(schoolName) {
  return String(schoolName || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4 && !['university', 'college', 'school', 'institute', 'academy'].includes(token))
    .slice(0, 6)
}

export function extractSchoolLogoCandidates(html, pageUrl, schoolName = '') {
  const source = String(html || '')
  const candidates = []
  const baseTag = source.match(/<base\b[^>]*>/iu)?.[0]
  const baseAttributes = baseTag ? attributesFromTag(baseTag) : {}
  const baseUrl = candidateUrl(baseAttributes.href, pageUrl, pageUrl) || pageUrl
  const schoolSignals = schoolNameSignals(schoolName)

  const add = (value, score, kind) => {
    const url = candidateUrl(value, pageUrl, baseUrl)
    if (url) candidates.push({ url, score, kind })
  }

  for (const tag of source.match(/<link\b[^>]*>/giu) ?? []) {
    const attributes = attributesFromTag(tag)
    const rel = String(attributes.rel || '').toLowerCase()
    const href = attributes.href
    if (!href) continue
    if (rel.includes('apple-touch-icon')) {
      add(href, 106 + iconSizeScore(attributes.sizes), 'apple-touch-icon')
    } else if (rel.split(/\s+/u).includes('icon') || rel.includes('shortcut icon')) {
      const typeBonus = /svg|png/iu.test(attributes.type || href) ? 5 : 0
      add(href, 64 + iconSizeScore(attributes.sizes) + typeBonus, 'icon')
    } else if (rel.includes('mask-icon')) {
      add(href, 74, 'mask-icon')
    }
  }

  for (const tag of source.match(/<meta\b[^>]*>/giu) ?? []) {
    const attributes = attributesFromTag(tag)
    const identity = `${attributes.property || ''} ${attributes.name || ''} ${attributes.itemprop || ''}`.toLowerCase()
    if (!/(?:^|\s|:)logo(?:$|\s)/u.test(identity)) continue
    add(attributes.content, 112, 'metadata-logo')
  }

  for (const tag of source.match(/<img\b[^>]*>/giu) ?? []) {
    const attributes = attributesFromTag(tag)
    const signalText = [
      attributes.id,
      attributes.class,
      attributes.alt,
      attributes.title,
      attributes.src,
    ].filter(Boolean).join(' ').toLowerCase()
    const explicitLogo = /(?:^|[\s_/-])(?:logo|brand|crest|seal|wordmark)(?:$|[\s_.?&/-])/u.test(signalText)
    const schoolMatch = schoolSignals.some((token) => signalText.includes(token))
    if (!explicitLogo && !schoolMatch) continue
    const sourceUrl = attributes.src || attributes['data-src'] || attributes['data-lazy-src']
    add(sourceUrl, explicitLogo ? 96 + (schoolMatch ? 4 : 0) : 78, explicitLogo ? 'page-logo' : 'school-image')
  }

  for (const match of source.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/giu)) {
    const attributes = attributesFromTag(match[1])
    if (String(attributes.type || '').toLowerCase() !== 'application/ld+json') continue
    try {
      const parsed = JSON.parse(String(match[2] || '').trim())
      for (const value of logoValuesFromJson(parsed)) add(value, 132, 'structured-logo')
    } catch {
      // Malformed structured data should not prevent favicon discovery.
    }
  }

  add('/favicon.ico', 46, 'favicon-fallback')

  const unique = new Map()
  for (const candidate of candidates) {
    const current = unique.get(candidate.url)
    if (!current || candidate.score > current.score) unique.set(candidate.url, candidate)
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_IMAGE_CANDIDATES)
}

async function readBoundedBuffer(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0)
  if (declaredLength > maxBytes) return null
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.length <= maxBytes ? bytes : null
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value || [])
      total += chunk.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, total)
}

async function fetchBoundedRemote(url, {
  fetchImpl,
  dnsLookup,
  timeoutMs,
  maxBytes,
  accept,
}) {
  let current = normalizeSchoolLogoRemoteUrl(url)
  if (!current) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (!(await isDiscoverPublicNetworkTarget(current, dnsLookup))) return null
      const response = await fetchImpl(current.toString(), {
        headers: {
          'User-Agent': LOGO_USER_AGENT,
          Accept: accept,
        },
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location')
        const next = location
          ? normalizeSchoolLogoRemoteUrl(new URL(location, current).toString())
          : null
        if (!next) return null
        current = next
        continue
      }
      if (!response.ok) return null
      const finalUrl = normalizeSchoolLogoRemoteUrl(response.url || current.toString())
      if (!finalUrl || !(await isDiscoverPublicNetworkTarget(finalUrl, dnsLookup))) return null
      const bytes = await readBoundedBuffer(response, maxBytes)
      if (!bytes) return null
      return {
        bytes,
        contentType: String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase(),
        url: finalUrl.toString(),
      }
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function startsWithBytes(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value)
}

function safeSvg(bytes) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/u, '').trim()
  if (!/<svg(?:\s|>)/iu.test(text.slice(0, 1_000))) return false
  if (/<(?:script|foreignObject|iframe|object|embed)\b/iu.test(text)) return false
  if (/\son[a-z]+\s*=/iu.test(text)) return false
  if (/<!ENTITY|<\?xml-stylesheet/iu.test(text)) return false
  if (/(?:href|src)\s*=\s*["']\s*(?!#|data:image\/)[^"']+["']/iu.test(text)) return false
  if (/url\(\s*["']?(?!#)[^)]+\)/iu.test(text)) return false
  return true
}

export function detectSchoolLogoMime(bytes, declaredType = '') {
  const normalized = String(declaredType || '').toLowerCase()
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) return null
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp'
  if (startsWithBytes(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
  if (
    bytes.length >= 16
    && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
    && /^(?:avif|avis)$/u.test(bytes.subarray(8, 12).toString('ascii'))
  ) return 'image/avif'
  if ((normalized === 'image/svg+xml' || bytes.subarray(0, 1_000).toString('utf8').includes('<svg')) && safeSvg(bytes)) {
    return 'image/svg+xml'
  }
  return null
}

async function fetchLogoCandidate(candidate, options) {
  const result = await fetchBoundedRemote(candidate.url, {
    ...options,
    timeoutMs: IMAGE_TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES,
    accept: 'image/avif,image/webp,image/png,image/svg+xml,image/jpeg,image/x-icon,image/*;q=0.8',
  })
  if (!result) return null
  const mimeType = detectSchoolLogoMime(result.bytes, result.contentType)
  if (!mimeType) return null
  return {
    found: true,
    dataUrl: `data:${mimeType};base64,${result.bytes.toString('base64')}`,
    sourceUrl: result.url,
    candidateKind: candidate.kind,
  }
}

export async function resolveSchoolLogoAsset({
  website,
  imageUrl,
  schoolName = '',
  fetchImpl = globalThis.fetch,
  dnsLookup = nodeDnsLookup,
} = {}) {
  if (typeof fetchImpl !== 'function') return { found: false, reason: 'unavailable' }
  const directImage = normalizeSchoolLogoRemoteUrl(imageUrl)
  if (directImage) {
    return await fetchLogoCandidate(
      { url: directImage.toString(), kind: 'manual-link' },
      { fetchImpl, dnsLookup },
    ) ?? { found: false, reason: 'not-found' }
  }

  const page = normalizeSchoolLogoRemoteUrl(website)
  if (!page) return { found: false, reason: 'invalid-url' }
  const pageResult = await fetchBoundedRemote(page, {
    fetchImpl,
    dnsLookup,
    timeoutMs: PAGE_TIMEOUT_MS,
    maxBytes: MAX_HTML_BYTES,
    accept: 'text/html,application/xhtml+xml;q=0.9',
  })
  if (!pageResult) return { found: false, reason: 'unreachable' }
  const contentType = pageResult.contentType
  if (contentType && !contentType.includes('html') && !contentType.includes('xhtml')) {
    return { found: false, reason: 'not-found' }
  }

  const candidates = extractSchoolLogoCandidates(
    pageResult.bytes.toString('utf8'),
    pageResult.url,
    schoolName,
  )
  for (let index = 0; index < candidates.length; index += 3) {
    const batch = candidates.slice(index, index + 3)
    const results = await Promise.all(batch.map((candidate) => (
      fetchLogoCandidate(candidate, { fetchImpl, dnsLookup })
    )))
    const match = results.find(Boolean)
    if (match) return match
  }
  return { found: false, reason: 'not-found' }
}
