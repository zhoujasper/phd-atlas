import { useEffect, useState } from 'react'
import type { Language } from '../../i18n'
import type { Theme } from '../hooks/useTheme'

export type MarketingScreenshotSurface =
  | 'workspace'
  | 'correspondence'
  | 'funding'
  | 'timeline'
  | 'discover'
  | 'profile'

const MOBILE_SCREENSHOT_QUERY = '(max-width: 700px)'

function screenshotUrl(surface: MarketingScreenshotSurface, language: Language, theme: Theme, mobile: boolean) {
  return `/assets/product-tour/${surface}-${language}-${theme}${mobile ? '-mobile' : ''}.webp?v=2x-20260731c`
}

function usesMobileScreenshotCapture() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_SCREENSHOT_QUERY).matches
}

export function MarketingProductScreenshot({
  language,
  theme,
  alt,
  caption,
  className = '',
  surface = 'workspace',
  loading: imageLoading = 'eager',
  priority = false,
}: {
  language: Language
  theme: Theme
  alt: string
  caption?: string
  className?: string
  surface?: MarketingScreenshotSurface
  loading?: 'eager' | 'lazy'
  priority?: boolean
}) {
  const [mobile, setMobile] = useState(usesMobileScreenshotCapture)
  const requestedSource = screenshotUrl(surface, language, theme, mobile)
  const fallbackSource = screenshotUrl('workspace', language, theme, mobile)
  const [displayedSource, setDisplayedSource] = useState(requestedSource)
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(MOBILE_SCREENSHOT_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (requestedSource === displayedSource) return
    let active = true
    const image = new Image()
    image.decoding = 'async'
    setTransitioning(true)
    image.onload = async () => {
      try {
        await image.decode()
      } catch {
        // A successful load is still usable in browsers that reject decode().
      }
      if (!active) return
      setDisplayedSource(requestedSource)
      setTransitioning(false)
    }
    image.onerror = () => {
      if (!active) return
      setTransitioning(false)
    }
    image.src = requestedSource
    return () => { active = false }
  }, [displayedSource, requestedSource])

  return (
    <figure
      className={`auth-product-screenshot${mobile ? ' is-mobile-capture' : ''}${transitioning ? ' is-loading' : ''}${className ? ` ${className}` : ''}`}
      aria-busy={transitioning || undefined}
      data-marketing-surface={surface}
    >
      <div className="auth-product-screenshot-frame">
        <img
          src={displayedSource}
          width={mobile ? 780 : 3200}
          height={mobile ? 1688 : 1800}
          alt={alt}
          loading={imageLoading}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onError={() => {
            setTransitioning(false)
            if (displayedSource !== fallbackSource) setDisplayedSource(fallbackSource)
          }}
        />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}
