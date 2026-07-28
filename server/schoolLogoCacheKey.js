import { createHash } from 'node:crypto'

export function normalizeSchoolLogoWebsiteCacheUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:') return ''
    url.username = ''
    url.password = ''
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./u, '')
    url.pathname = url.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/'
    return url.toString()
  } catch {
    return ''
  }
}

export function schoolLogoWebsiteCacheKey(value) {
  const normalized = normalizeSchoolLogoWebsiteCacheUrl(value)
  return normalized
    ? createHash('sha256').update(`compact-mark-v3:${normalized}`).digest('hex')
    : ''
}
