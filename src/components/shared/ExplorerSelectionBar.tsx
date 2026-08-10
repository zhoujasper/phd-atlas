import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
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

/** Keep in sync with the compositor-only content transitions in index.css. */
const EXIT_MS = 180
const OPEN_MS = 180

type FrozenContent = {
  label: string
  clearLabel: string
  actions: ExplorerSelectionAction[]
  leadingContent?: ReactNode
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
  leadingContent,
  placement = 'inline',
  viewportAnchorRef,
  className,
  onClear,
}: {
  visible?: boolean
  label: string
  clearLabel: string
  actions: ExplorerSelectionAction[]
  leadingContent?: ReactNode
  placement?: 'inline' | 'viewport-bottom'
  viewportAnchorRef?: RefObject<HTMLElement | null>
  className?: string
  onClear: () => void
}) {
  const [mounted, setMounted] = useState(visible)
  const [open, setOpen] = useState(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // Freeze last non-empty content so exit does not flash "0 selected".
  const contentRef = useRef<FrozenContent>({ label, clearLabel, actions, leadingContent, onClear })
  if (visible) {
    contentRef.current = { label, clearLabel, actions, leadingContent, onClear }
  }

  const enterFrameRef = useRef<number | null>(null)
  const unmountTimerRef = useRef<number | null>(null)
  const presenceRef = useRef<HTMLDivElement>(null)

  const cancelEnterFrame = () => {
    if (enterFrameRef.current === null) return
    cancelAnimationFrame(enterFrameRef.current)
    enterFrameRef.current = null
  }

  useLayoutEffect(() => {
    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current)
      unmountTimerRef.current = null
    }

    if (visible) {
      setMounted(true)
      cancelEnterFrame()
      setOpen(false)
      // One frame is enough to mount the closed content before the compositor
      // transition starts. The surrounding layout snaps once; it never
      // interpolates table geometry frame by frame.
      enterFrameRef.current = window.requestAnimationFrame(() => {
        enterFrameRef.current = null
        if (visibleRef.current) setOpen(true)
      })
      return () => cancelEnterFrame()
    }

    cancelEnterFrame()
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
    cancelEnterFrame()
    if (unmountTimerRef.current !== null) window.clearTimeout(unmountTimerRef.current)
  }, [])

  // React Activity hides resident views without unmounting them. A body portal
  // sits outside that hidden DOM branch, so mirror the layout-effect lifecycle
  // onto the portal root to prevent a table-owned dock lingering over Board.
  useLayoutEffect(() => {
    if (placement !== 'viewport-bottom' || !mounted) return undefined
    const presence = presenceRef.current
    presence?.removeAttribute('hidden')
    return () => presence?.setAttribute('hidden', '')
  }, [mounted, placement])

  // Keep viewport docks centered on their owning surface without feeding
  // transient geometry through React state. Resize/scroll work is collapsed
  // into one animation-frame write to the portal root.
  useLayoutEffect(() => {
    if (placement !== 'viewport-bottom' || !mounted) return undefined
    const presence = presenceRef.current
    const anchor = viewportAnchorRef?.current
    if (!presence || !anchor) return undefined

    let frame: number | null = null
    const syncAnchorGeometry = () => {
      frame = null
      const bounds = anchor.getBoundingClientRect()
      if (bounds.width <= 0 || !Number.isFinite(bounds.left)) return
      presence.style.setProperty(
        '--explorer-selection-anchor-center-x',
        `${bounds.left + bounds.width / 2}px`,
      )
      presence.style.setProperty('--explorer-selection-anchor-width', `${bounds.width}px`)
    }
    const scheduleAnchorSync = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(syncAnchorGeometry)
    }

    syncAnchorGeometry()
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleAnchorSync)
      : null
    resizeObserver?.observe(anchor)
    window.addEventListener('resize', scheduleAnchorSync)
    window.addEventListener('scroll', scheduleAnchorSync, { capture: true, passive: true })

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleAnchorSync)
      window.removeEventListener('scroll', scheduleAnchorSync, true)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [mounted, placement, viewportAnchorRef])

  if (!mounted) return null

  const content = contentRef.current
  const style = {
    '--explorer-selection-open-ms': `${OPEN_MS}ms`,
    '--explorer-selection-close-ms': `${EXIT_MS}ms`,
  } as CSSProperties

  const selectionBar = (
    <div
      ref={presenceRef}
      className={clsx(
        'explorer-selection-presence',
        placement === 'viewport-bottom' && 'is-viewport-bottom',
        open && 'is-open',
        className,
      )}
      style={style}
      aria-hidden={!open}
    >
      <div className="explorer-selection-presence-clip">
        <div className="explorer-selection-bar" role="status">
          <div className="explorer-selection-label">
            <strong>{content.label}</strong>
          </div>
          <div className="explorer-selection-actions">
            {content.leadingContent ? (
              <div className="explorer-selection-leading">{content.leadingContent}</div>
            ) : null}
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
                <span className="explorer-selection-action-label">{action.label}</span>
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

  return placement === 'viewport-bottom' && typeof document !== 'undefined'
    ? createPortal(selectionBar, document.body)
    : selectionBar
}
