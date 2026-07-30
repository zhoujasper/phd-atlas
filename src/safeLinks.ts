const bareDomainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i
const emailPattern = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i

function hasUnsafeUrlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return character === '\\'
      || /\s/u.test(character)
      || codePoint <= 0x1f
      || codePoint === 0x7f
  })
}

export function safeExternalHttpUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || hasUnsafeUrlCharacter(trimmed)) return ''

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
