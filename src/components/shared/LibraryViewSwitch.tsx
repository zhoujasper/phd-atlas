import { flushSync } from 'react-dom'
import { LayoutGrid, List } from 'lucide-react'

export type LibraryViewMode = 'cards' | 'list'
export type LibraryViewTransitionScope = 'profile' | 'team'

type LibraryViewTransition = {
  finished: Promise<unknown>
}

type LibraryViewTransitionDocument = {
  startViewTransition?: (update: () => void) => LibraryViewTransition
}

let libraryViewTransitionSequence = 0

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clearTransitionAttributes(root: HTMLElement, token: string) {
  if (root.dataset.libraryViewTransitionToken !== token) return
  delete root.dataset.libraryViewTransitionToken
  delete root.dataset.libraryViewTransitionScope
  delete root.dataset.libraryViewTransitionDirection
  delete root.dataset.libraryViewTransitionMode
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
    if (typeof document === 'undefined' || prefersReducedMotion()) {
      onChange(nextValue)
      return
    }

    const root = document.documentElement
    const transitionDocument = document as LibraryViewTransitionDocument
    const direction = nextValue === 'list' ? 'forward' : 'backward'
    const token = String(++libraryViewTransitionSequence)
    const nativeTransition = Reflect.get(
      transitionDocument,
      'startViewTransition',
    ) as undefined | ((update: () => void) => LibraryViewTransition)

    root.dataset.libraryViewTransitionToken = token
    root.dataset.libraryViewTransitionScope = transitionScope
    root.dataset.libraryViewTransitionDirection = direction
    root.dataset.libraryViewTransitionMode = nativeTransition ? 'native' : 'fallback'

    if (!nativeTransition) {
      onChange(nextValue)
      window.setTimeout(() => clearTransitionAttributes(root, token), 360)
      return
    }

    let committed = false
    try {
      const transition = nativeTransition.call(transitionDocument, () => {
        committed = true
        flushSync(() => onChange(nextValue))
      })
      void transition.finished.then(
        () => clearTransitionAttributes(root, token),
        () => clearTransitionAttributes(root, token),
      )
    } catch {
      root.dataset.libraryViewTransitionMode = 'fallback'
      if (!committed) onChange(nextValue)
      window.setTimeout(() => clearTransitionAttributes(root, token), 360)
    }
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
