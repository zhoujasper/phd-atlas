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
