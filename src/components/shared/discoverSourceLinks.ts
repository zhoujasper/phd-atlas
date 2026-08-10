import { safeExternalHttpUrl } from '../../safeLinks'

export const DISCOVER_EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
  referrerPolicy: 'no-referrer',
} as const

function safeDiscoverSourceLink(value: string) {
  const safe = safeExternalHttpUrl(value)
  if (!safe) return ''
  try {
    const url = new URL(safe)
    return url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

export function uniqueDiscoverSourceLinks(sources: readonly string[]) {
  return Array.from(new Set(sources.map(safeDiscoverSourceLink).filter(Boolean)))
}
