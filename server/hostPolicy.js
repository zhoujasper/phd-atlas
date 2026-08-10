export function hostFromUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    return url.username || url.password ? '' : url.host.toLowerCase()
  } catch {
    return ''
  }
}

export function normalizeHttpHost(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (
    !raw
    || raw.length > 260
    || /[\s/@?#\\]/.test(raw)
  ) return ''
  try {
    const parsed = new URL(`http://${raw}/`)
    return parsed.username || parsed.password || parsed.host !== raw
      ? ''
      : parsed.host
  } catch {
    return ''
  }
}

export function configuredAllowedHosts({
  allowedHosts = '',
  baseUrl = '',
  corsOrigin = '',
} = {}) {
  const explicit = String(allowedHosts)
    .split(',')
    .map(normalizeHttpHost)
    .filter(Boolean)
  const origins = [
    hostFromUrl(baseUrl),
    ...String(corsOrigin)
      .split(',')
      .map((origin) => hostFromUrl(origin.trim())),
  ].filter(Boolean)
  return new Set([...explicit, ...origins])
}

export function trustedRequestHost(value, {
  production = false,
  allowedHosts = new Set(),
} = {}) {
  const host = normalizeHttpHost(value)
  if (!host) return ''
  if (production && !allowedHosts.has(host)) return ''
  return host
}

function normalizedNetworkAddress(value) {
  const address = String(value ?? '').trim().toLowerCase()
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
}

function isLoopbackNetworkAddress(value) {
  const address = normalizedNetworkAddress(value)
  return address === '127.0.0.1' || address === '::1'
}

/**
 * Narrow compatibility boundary for an isolated production-like QA listener
 * bound to an OS-selected loopback port. The normal production allowlist still
 * runs first; this fallback is valid only when the caller explicitly enables
 * QA mode and proves both ends of the live socket plus the Host hostname are
 * loopback. A wildcard/all-interface listener can never pass this helper.
 */
export function trustedQaLoopbackRequestHost(value, {
  enabled = false,
  remoteAddress = '',
  listenerAddress = '',
} = {}) {
  if (enabled !== true) return ''
  if (!isLoopbackNetworkAddress(remoteAddress) || !isLoopbackNetworkAddress(listenerAddress)) return ''
  const host = normalizeHttpHost(value)
  if (!host) return ''
  try {
    const hostname = new URL(`http://${host}/`).hostname.toLowerCase()
    return ['127.0.0.1', '[::1]', '::1', 'localhost'].includes(hostname) ? host : ''
  } catch {
    return ''
  }
}
