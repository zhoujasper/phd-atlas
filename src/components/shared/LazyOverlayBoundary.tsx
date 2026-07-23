import { Suspense, type ReactNode } from 'react'
import type { I18nNamespace } from '../../i18n'
import { I18nContext, useI18n, useI18nValue } from '../hooks/useI18n'
import { ModalPortal } from './ModalPortal'

export function LazyOverlayFallback() {
  const { tx } = useI18n()

  return (
    <ModalPortal>
      <div className="lazy-overlay-fallback" role="status" aria-live="polite">
        <span className="lazy-overlay-fallback-indicator" aria-hidden="true">
          <span />
        </span>
        <span className="sr-only">{tx('working')}</span>
      </div>
    </ModalPortal>
  )
}

/**
 * Loads an overlay's code and language pack independently from the screen
 * beneath it. The small immediate cue removes the dead-click interval on cold
 * chunks without making the full application consume the overlay namespace.
 */
export function LazyOverlayBoundary({
  namespaces,
  children,
}: {
  namespaces: I18nNamespace[]
  children: ReactNode
}) {
  const parentI18n = useI18n()
  const overlayI18n = useI18nValue(parentI18n.lang, namespaces)
  const fallback = <LazyOverlayFallback />

  return (
    <I18nContext.Provider value={overlayI18n}>
      {overlayI18n.ready
        ? <Suspense fallback={fallback}>{children}</Suspense>
        : fallback}
    </I18nContext.Provider>
  )
}
