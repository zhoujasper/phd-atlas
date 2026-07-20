import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { getMotionDelay } from '../hooks/useAnimatedClose'

export type ExplorerSelectionAction = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  tone?: 'default' | 'danger'
  onClick: () => void
}

/** Keep in sync with CSS `--explorer-selection-close-ms` / transition durations. */
const EXIT_MS = 280
const OPEN_MS = 320

type FrozenContent = {
  label: string
  clearLabel: string
  actions: ExplorerSelectionAction[]
  onClear: () => void
}

/**
 * Bulk multi-select action bar with smooth enter/exit presence.
 * Pass `visible` and keep the component mounted so the exit animation can play
 * when the selection is cleared (do not unmount with a ternary).
 */
export function ExplorerSelectionBar({
  visible = true,
  label,
  clearLabel,
  actions,
  onClear,
}: {
  visible?: boolean
  label: string
  clearLabel: string
  actions: ExplorerSelectionAction[]
  onClear: () => void
}) {
  const [mounted, setMounted] = useState(visible)
  const [open, setOpen] = useState(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // Freeze last non-empty content so exit does not flash "0 selected".
  const contentRef = useRef<FrozenContent>({ label, clearLabel, actions, onClear })
  if (visible) {
    contentRef.current = { label, clearLabel, actions, onClear }
  }

  const frame1Ref = useRef<number | null>(null)
  const frame2Ref = useRef<number | null>(null)
  const unmountTimerRef = useRef<number | null>(null)

  const cancelFrames = () => {
    if (frame1Ref.current !== null) {
      cancelAnimationFrame(frame1Ref.current)
      frame1Ref.current = null
    }
    if (frame2Ref.current !== null) {
      cancelAnimationFrame(frame2Ref.current)
      frame2Ref.current = null
    }
  }

  useEffect(() => {
    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current)
      unmountTimerRef.current = null
    }

    if (visible) {
      setMounted(true)
      cancelFrames()
      // Double rAF: paint closed shell first, then open so grid-template-rows interpolates.
      frame1Ref.current = window.requestAnimationFrame(() => {
        frame1Ref.current = null
        frame2Ref.current = window.requestAnimationFrame(() => {
          frame2Ref.current = null
          if (visibleRef.current) setOpen(true)
        })
      })
      return () => cancelFrames()
    }

    setOpen(false)
    unmountTimerRef.current = window.setTimeout(() => {
      unmountTimerRef.current = null
      setMounted(false)
    }, getMotionDelay(EXIT_MS))

    return () => {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
    }
  }, [visible])

  useEffect(() => () => {
    cancelFrames()
    if (unmountTimerRef.current !== null) window.clearTimeout(unmountTimerRef.current)
  }, [])

  if (!mounted) return null

  const content = contentRef.current
  const style = {
    '--explorer-selection-open-ms': `${OPEN_MS}ms`,
    '--explorer-selection-close-ms': `${EXIT_MS}ms`,
  } as CSSProperties

  return (
    <div
      className={clsx('explorer-selection-presence', open && 'is-open')}
      style={style}
      aria-hidden={!open}
    >
      <div className="explorer-selection-presence-clip">
        <div className="explorer-selection-bar" role="status">
          <div className="explorer-selection-label">
            <span className="explorer-selection-dot" aria-hidden="true" />
            <strong>{content.label}</strong>
          </div>
          <div className="explorer-selection-actions">
            {content.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={action.tone === 'danger' ? 'danger' : ''}
                disabled={action.disabled || !open}
                onClick={action.onClick}
                title={action.label}
                aria-label={action.label}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
            <button
              type="button"
              className="icon-only"
              onClick={content.onClear}
              disabled={!open}
              title={content.clearLabel}
              aria-label={content.clearLabel}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
