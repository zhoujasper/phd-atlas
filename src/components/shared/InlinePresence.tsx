import {
  createElement,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import clsx from 'clsx'

type InlinePresenceStyle = CSSProperties & {
  '--inline-presence-duration'?: string
  '--inline-presence-gap'?: string
}

type InlinePresenceElement = 'span' | 'div'

export type InlinePresenceProps = {
  present: boolean
  children: ReactNode
  className?: string
  innerClassName?: string
  durationMs?: number
  /** Compensates for a flex/grid parent gap while the item collapses to zero. */
  parentGap?: string
  /** Skips width measurement when a busy surface should only animate on the compositor. */
  layout?: 'measured' | 'instant'
  /** Uses block-safe markup when the presence owns controls that render div roots. */
  as?: InlinePresenceElement
}

/**
 * Width-aware presence for inline labels and actions.
 *
 * Keeping the child mounted gives it an exit frame. Measuring its intrinsic
 * width lets the wrapper interpolate layout, so siblings are pushed smoothly
 * instead of jumping after an opacity-only animation. Busy surfaces can opt
 * into instant layout, keeping only the compositor-friendly content motion.
 */
export function InlinePresence({
  present,
  children,
  className,
  innerClassName,
  durationMs = 380,
  parentGap = '0px',
  layout = 'measured',
  as = 'span',
}: InlinePresenceProps) {
  const rootRef = useRef<HTMLElement>(null)
  const innerRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (layout === 'instant') return undefined

    const root = rootRef.current
    const inner = innerRef.current
    if (!root || !inner) return undefined

    let frame = 0
    const measure = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const bounds = inner.getBoundingClientRect()
        const width = Math.ceil(bounds.width)
        const height = Math.ceil(bounds.height)
        if (width > 0) root.style.setProperty('--inline-presence-width', `${width}px`)
        if (height > 0) root.style.setProperty('--inline-presence-height', `${height}px`)
      })
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => {
        window.cancelAnimationFrame(frame)
        window.removeEventListener('resize', measure)
      }
    }

    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [children, layout])

  const style = {
    '--inline-presence-duration': `${durationMs}ms`,
    '--inline-presence-gap': parentGap,
  } as InlinePresenceStyle

  return createElement(
    as,
    {
      ref: rootRef,
      className: clsx('inline-presence', layout === 'instant' && 'inline-presence-instant', className),
      'data-present': present ? 'true' : 'false',
      'aria-hidden': !present,
      inert: present ? undefined : true,
      style,
    },
    createElement(
      as,
      {
        ref: innerRef,
        className: clsx('inline-presence-inner', innerClassName),
      },
      children,
    ),
  )
}
