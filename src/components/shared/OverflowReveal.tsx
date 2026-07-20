import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { copyToClipboard } from './CopyButton'
import { useI18n } from '../hooks/useI18n'

type OverflowRevealProps = {
  text: string
  children?: ReactNode
  className?: string
  /** Element tag — default `span`. Use `strong` / `code` to match table styles. */
  as?: 'span' | 'strong' | 'code' | 'em'
  /** Optional override for the value written to the clipboard (defaults to `text`). */
  copyValue?: string
  /** Accessible name for the copy action (e.g. application name, link). */
  label?: string
  tabIndex?: number
  /**
   * Prefer top-of-page toast feedback (same as other app copy actions).
   * When provided, local “Copied!” tooltip flash is skipped.
   */
  onCopyResult?: (ok: boolean, detail: { value: string; label: string }) => void
}

type TooltipRect = {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Truncated text that expands on hover/focus via a portal tooltip (never clipped by table overflow),
 * and copies the full value on double-click.
 */
export function OverflowReveal({
  text,
  children,
  className = '',
  as = 'span',
  copyValue,
  label,
  tabIndex = 0,
  onCopyResult,
}: OverflowRevealProps) {
  const { tx, format } = useI18n()
  const tooltipId = useId()
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<TooltipRect | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const Tag = as as ElementType
  const value = (copyValue ?? text).trim()
  const display = children ?? text
  const actionLabel = label || tx('copySummary')

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearResetTimer(), [clearResetTimer])

  const measure = useCallback(() => {
    const el = rootRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    } satisfies TooltipRect
  }, [])

  const show = useCallback(() => {
    const next = measure()
    if (!next) return
    setAnchor(next)
    setOpen(true)
  }, [measure])

  const hide = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onScroll = () => {
      const next = measure()
      if (next) setAnchor(next)
      else setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [measure, open])

  const flashStatus = useCallback((next: 'copied' | 'failed') => {
    // When a top toast handles feedback, keep the hover tooltip on the full text.
    if (onCopyResult) return
    clearResetTimer()
    setStatus(next)
    show()
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null
      setStatus('idle')
      if (!rootRef.current?.matches(':hover') && document.activeElement !== rootRef.current) {
        setOpen(false)
      }
    }, 1600)
  }, [clearResetTimer, onCopyResult, show])

  const handleCopy = useCallback(async () => {
    if (!value) return
    const ok = await copyToClipboard(value)
    onCopyResult?.(ok, { value, label: actionLabel })
    flashStatus(ok ? 'copied' : 'failed')
  }, [actionLabel, flashStatus, onCopyResult, value])

  const handleDoubleClick = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    window.getSelection()?.removeAllRanges()
    void handleCopy()
  }, [handleCopy])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !event.shiftKey && !event.altKey) {
      const selection = window.getSelection()?.toString() ?? ''
      if (selection.trim()) return
      event.preventDefault()
      void handleCopy()
    }
  }, [handleCopy])

  const hint = format(tx('doubleClickToCopy'), { label: actionLabel })
  const title = !onCopyResult && status === 'copied'
    ? tx('copiedBang')
    : !onCopyResult && status === 'failed'
      ? tx('copyFailed')
      : hint

  const tooltipText = !onCopyResult && status === 'copied'
    ? tx('copiedBang')
    : !onCopyResult && status === 'failed'
      ? tx('copyFailed')
      : text

  const tooltipStyle = (() => {
    if (!anchor) return { display: 'none' } as const
    const padding = 8
    const maxWidth = Math.min(320, Math.max(160, window.innerWidth - padding * 2))
    let left = anchor.left
    let top = anchor.top + anchor.height / 2
    // Keep inside viewport horizontally.
    left = Math.min(Math.max(padding, left), window.innerWidth - maxWidth - padding)
    const preferAbove = anchor.top < 48
    return {
      position: 'fixed' as const,
      top,
      left,
      maxWidth,
      transform: preferAbove
        ? 'translateY(calc(-50% + 18px))'
        : 'translateY(-50%)',
      zIndex: 12000,
    }
  })()

  const portalHost = typeof document !== 'undefined'
    ? (document.querySelector<HTMLElement>('.atlas-shell, .admin-shell') ?? document.body)
    : null

  return (
    <>
      <Tag
        ref={rootRef}
        className={`overflow-reveal${status !== 'idle' ? ` is-${status}` : ''}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        tabIndex={tabIndex}
        title={title}
        aria-label={status === 'idle' ? `${text}. ${hint}` : title}
        aria-describedby={open ? tooltipId : undefined}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {display}
      </Tag>
      {open && portalHost && text
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              className={`overflow-reveal-portal${status !== 'idle' ? ` is-${status}` : ''}`}
              style={tooltipStyle}
            >
              {tooltipText}
            </span>,
            portalHost,
          )
        : null}
    </>
  )
}
