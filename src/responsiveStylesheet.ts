const pendingResponsiveStylesheets = new Set<string>()

function findResponsiveStylesheet(key: string) {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[data-atlas-responsive-stylesheet]'))
    .find((link) => link.dataset.atlasResponsiveStylesheet === key) ?? null
}

/**
 * Keeps viewport-only CSS out of the desktop critical graph without losing the
 * stylesheet when a desktop window is later narrowed. A matching viewport
 * starts the CSS request immediately, in parallel with React's lazy route.
 */
export function installResponsiveStylesheet(key: string, href: string, media: string) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  const existing = findResponsiveStylesheet(key)
  if (existing) return existing
  if (pendingResponsiveStylesheets.has(key)) return null

  const appendStylesheet = () => {
    const current = findResponsiveStylesheet(key)
    if (current) return current
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.media = media
    link.fetchPriority = 'high'
    link.dataset.atlasResponsiveStylesheet = key
    document.head.append(link)
    return link
  }

  if (typeof window.matchMedia !== 'function') return appendStylesheet()
  const mediaQuery = window.matchMedia(media)
  if (mediaQuery.matches) return appendStylesheet()

  pendingResponsiveStylesheets.add(key)
  const handleMatch = (event: MediaQueryListEvent) => {
    if (!event.matches) return
    pendingResponsiveStylesheets.delete(key)
    mediaQuery.removeEventListener('change', handleMatch)
    appendStylesheet()
  }
  mediaQuery.addEventListener('change', handleMatch)
  return null
}
