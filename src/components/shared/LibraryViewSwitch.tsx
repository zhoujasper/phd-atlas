import { flushSync } from 'react-dom'
import { LayoutGrid, List } from 'lucide-react'

export type LibraryViewMode = 'cards' | 'list'
export type LibraryViewTransitionScope = 'profile' | 'team' | 'team-discover'

type LibraryScrollAnchor = {
  owner: HTMLElement
  scrollTop: number
}

let libraryViewTransitionSequence = 0
const LIBRARY_VIEW_HANDOFF_CLEANUP_MS = 280

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function findScrollOwner(element: HTMLElement) {
  let parent = element.parentElement
  while (parent && parent !== document.body) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/^(auto|scroll|overlay)$/.test(overflowY)) return parent
    parent = parent.parentElement
  }

  const scrollingElement = document.scrollingElement
  return scrollingElement instanceof HTMLElement ? scrollingElement : document.documentElement
}

function captureScrollAnchor(controlsId: string): LibraryScrollAnchor | null {
  const currentView = document.getElementById(controlsId)
  if (!currentView) return null
  const owner = findScrollOwner(currentView)
  return { owner, scrollTop: owner.scrollTop }
}

function restoreScrollAnchor(anchor: LibraryScrollAnchor | null) {
  if (!anchor || Math.abs(anchor.owner.scrollTop - anchor.scrollTop) < 0.5) return
  anchor.owner.scrollTop = anchor.scrollTop
}

function clearLocalTransition(host: HTMLElement, token: string) {
  if (host.dataset.libraryViewTransitionToken !== token) return
  delete host.dataset.libraryViewTransitionToken
  delete host.dataset.libraryViewTransitionScope
  delete host.dataset.libraryViewTransitionDirection
}

export function LibraryViewSwitch({
  value,
  onChange,
  label,
  cardLabel,
  listLabel,
  transitionScope,
  controlsId,
  className,
}: {
  value: LibraryViewMode
  onChange: (value: LibraryViewMode) => void
  label: string
  cardLabel: string
  listLabel: string
  transitionScope: LibraryViewTransitionScope
  controlsId: string
  className?: string
}) {
  const changeView = (nextValue: LibraryViewMode) => {
    if (value === nextValue) return
    if (typeof document === 'undefined') {
      onChange(nextValue)
      return
    }

    const currentView = document.getElementById(controlsId)
    const host = currentView?.parentElement ?? null
    const scrollAnchor = captureScrollAnchor(controlsId)
    const reducedMotion = prefersReducedMotion()
    const token = String(++libraryViewTransitionSequence)

    // Keep the handoff entirely inside the library boundary. A document View
    // Transition always captures the root as well, which made unrelated page
    // geometry participate in this small card/list toggle.
    if (host && !reducedMotion) {
      host.dataset.libraryViewTransitionToken = token
      host.dataset.libraryViewTransitionScope = transitionScope
      host.dataset.libraryViewTransitionDirection = nextValue === 'list' ? 'forward' : 'backward'
    }

    flushSync(() => onChange(nextValue))
    restoreScrollAnchor(scrollAnchor)

    if (!host || reducedMotion) return

    // Scroll anchoring can run after React's synchronous commit. Re-assert the
    // same local scroll position on the next layout frame without holding a
    // permanent min-height or touching the document transition root.
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        if (host.dataset.libraryViewTransitionToken !== token) return
        restoreScrollAnchor(scrollAnchor)
      })
    }
    window.setTimeout(() => clearLocalTransition(host, token), LIBRARY_VIEW_HANDOFF_CLEANUP_MS)
  }

  return (
    <div
      className={['library-view-switch', className].filter(Boolean).join(' ')}
      data-view={value}
      role="group"
      aria-label={label}
    >
      <span className="library-view-switch-indicator" aria-hidden="true" />
      <button
        type="button"
        className={value === 'cards' ? 'active' : ''}
        title={cardLabel}
        aria-label={cardLabel}
        aria-pressed={value === 'cards'}
        aria-controls={controlsId}
        onClick={() => changeView('cards')}
      >
        <LayoutGrid size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={value === 'list' ? 'active' : ''}
        title={listLabel}
        aria-label={listLabel}
        aria-pressed={value === 'list'}
        aria-controls={controlsId}
        onClick={() => changeView('list')}
      >
        <List size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
