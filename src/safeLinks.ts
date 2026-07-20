const bareDomainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i
const emailPattern = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i

export function safeExternalHttpUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || /[\s\\\u0000-\u001F\u007F]/.test(trimmed)) return ''

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : bareDomainPattern.test(trimmed)
      ? `https://${trimmed.replace(/^\/+/, '')}`
      : ''
  if (!candidate) return ''

  try {
    const url = new URL(candidate)
    if (url.username || url.password) return ''
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : ''
  } catch {
    return ''
  }
}

export function safeMailtoHref(value: string) {
  const trimmed = value.trim()
  if (/[?#]/.test(trimmed)) return ''
  if (!emailPattern.test(trimmed) || /[\r\n]/.test(trimmed)) return ''
  return `mailto:${trimmed}`
}

export function safeTelHref(value: string) {
  const sanitized = value.trim().replace(/[^\d+]/g, '')
  if (!sanitized || sanitized === '+') return ''
  return `tel:${sanitized}`
}

export function safeMarkdownHref(value: string) {
  const trimmed = value.trim()
  if (/^mailto:/i.test(trimmed)) {
    return safeMailtoHref(trimmed.replace(/^mailto:/i, ''))
  }
  return safeExternalHttpUrl(trimmed)
}
