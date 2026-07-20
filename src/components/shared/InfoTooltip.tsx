import { Info } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

type TooltipAnchor = {
  left: number
  top: number
  width: number
  placement: 'top' | 'bottom'
}

export function InfoTooltip({
  content,
  label,
  className = '',
}: {
  content: string
  label?: string
  className?: string
}) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null)

  const measure = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320
    const tooltipWidth = Math.min(320, Math.max(160, viewportWidth - 24))
    const halfWidth = tooltipWidth / 2
    return {
      left: Math.min(Math.max(rect.left + rect.width / 2, halfWidth + 12), viewportWidth - halfWidth - 12),
      top: rect.top > 96 ? rect.top - 8 : rect.bottom + 8,
      width: tooltipWidth,
      placement: rect.top > 96 ? 'top' : 'bottom',
    } satisfies TooltipAnchor
  }, [])

  const show = useCallback(() => {
    const next = measure()
    if (!next) return
    setAnchor(next)
    setOpen(true)
  }, [measure])

  const hide = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return undefined
    const updatePosition = () => {
      const next = measure()
      if (next) setAnchor(next)
      else setOpen(false)
    }
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [measure, open])

  const tooltipStyle = anchor
    ? ({
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
      } satisfies CSSProperties)
    : undefined

  const portalHost = typeof document !== 'undefined' ? document.body : null

  return (
    <span className={`info-tooltip${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="info-tooltip-trigger"
        aria-label={label ?? content}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            hide()
          }
        }}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {portalHost
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              aria-hidden={!open}
              className={`info-tooltip-portal placement-${anchor?.placement ?? 'top'}${open ? ' is-open' : ''}`}
              style={tooltipStyle ?? { left: 0, top: 0, width: 240 }}
            >
              {content}
            </span>,
            portalHost,
          )
        : null}
    </span>
  )
}
