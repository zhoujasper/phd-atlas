import { afterEach, describe, expect, it, vi } from 'vitest'
import { installResponsiveStylesheet } from './responsiveStylesheet'

type MatchListener = (event: MediaQueryListEvent) => void

function mockMediaQuery(initiallyMatches: boolean) {
  let listener: MatchListener | null = null
  const addEventListener = vi.fn((_type: string, next: EventListenerOrEventListenerObject) => {
    if (typeof next === 'function') listener = next as MatchListener
  })
  const removeEventListener = vi.fn((_type: string, next: EventListenerOrEventListenerObject) => {
    if (listener === next) listener = null
  })
  const mediaQuery = {
    matches: initiallyMatches,
    media: '(max-width: 820px)',
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery))
  return {
    mediaQuery,
    match() {
      listener?.({ matches: true } as MediaQueryListEvent)
    },
  }
}

afterEach(() => {
  document.head.querySelectorAll('[data-atlas-responsive-stylesheet]').forEach((node) => node.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('installResponsiveStylesheet', () => {
  it('fails open by loading immediately when matchMedia is unavailable', () => {
    expect(window.matchMedia).toBeUndefined()

    const link = installResponsiveStylesheet('phone-legacy', '/assets/mobile.css', '(max-width: 820px)')

    expect(link).toBeInstanceOf(HTMLLinkElement)
    expect(link?.dataset.atlasResponsiveStylesheet).toBe('phone-legacy')
  })

  it('starts a matching viewport stylesheet immediately at high priority', () => {
    mockMediaQuery(true)

    const link = installResponsiveStylesheet('phone-a', '/assets/mobile.css', '(max-width: 820px)')

    expect(link).toBeInstanceOf(HTMLLinkElement)
    expect(link?.rel).toBe('stylesheet')
    expect(link?.getAttribute('href')).toBe('/assets/mobile.css')
    expect(link?.media).toBe('(max-width: 820px)')
    expect(link?.fetchPriority).toBe('high')
  })

  it('waits on desktop, then installs exactly once when the viewport narrows', () => {
    const { mediaQuery, match } = mockMediaQuery(false)

    expect(installResponsiveStylesheet('phone-b', '/assets/mobile.css', '(max-width: 820px)')).toBeNull()
    expect(document.head.querySelectorAll('[data-atlas-responsive-stylesheet="phone-b"]')).toHaveLength(0)

    match()
    installResponsiveStylesheet('phone-b', '/assets/mobile.css', '(max-width: 820px)')

    expect(document.head.querySelectorAll('[data-atlas-responsive-stylesheet="phone-b"]')).toHaveLength(1)
    expect(mediaQuery.removeEventListener).toHaveBeenCalledOnce()
  })
})
