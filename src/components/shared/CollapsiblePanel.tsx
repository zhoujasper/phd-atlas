import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { getMotionDelay } from '../hooks/useAnimatedClose'

type CollapsiblePanelProps = {
  open: boolean
  children: ReactNode
  className?: string
  innerClassName?: string
  id?: string
  maxHeight?: string
  /** Shared duration when openMs / closeMs are not set. */
  collapseMs?: number
  /** Expand duration (defaults to collapseMs). */
  openMs?: number
  /** Collapse duration (defaults to collapseMs). */
  closeMs?: number
  keepMounted?: boolean
  warmMount?: boolean
  measureKey?: string | number
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

type IdleDeadline = {
  didTimeout: boolean
  timeRemaining: () => number
}

const warmMountQueue = new Set<() => void>()
let warmMountQueueHandle: number | null = null

function isJsdomRuntime() {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isLayoutSiblingVisible(element: Element | null) {
  return element instanceof HTMLElement && window.getComputedStyle(element).display !== 'none'
}

function findVisibleLayoutSibling(element: HTMLElement, direction: 'previous' | 'next') {
  let sibling: Element | null = direction === 'previous' ? element.previousElementSibling : element.nextElementSibling
  while (sibling) {
    if (isLayoutSiblingVisible(sibling)) return sibling
    sibling = direction === 'previous' ? sibling.previousElementSibling : sibling.nextElementSibling
  }
  return null
}

function measureParentGapCompensation(element: HTMLElement) {
  const parent = element.parentElement
  if (!parent) return { start: 0, end: 0 }

  const parentStyle = window.getComputedStyle(parent)
  const isGrid = parentStyle.display === 'grid' || parentStyle.display === 'inline-grid'
  const isVerticalFlex = (parentStyle.display === 'flex' || parentStyle.display === 'inline-flex')
    && parentStyle.flexDirection === 'column'
  if (!isGrid && !isVerticalFlex) return { start: 0, end: 0 }

  const rowGap = Number.parseFloat(parentStyle.rowGap)
  if (!Number.isFinite(rowGap) || rowGap <= 0) return { start: 0, end: 0 }
  const elementStyle = window.getComputedStyle(element)
  const marginStart = Number.parseFloat(elementStyle.marginBlockStart) || 0
  const marginEnd = Number.parseFloat(elementStyle.marginBlockEnd) || 0
  const removableSpacing = rowGap + marginStart + marginEnd

  // A zero-height layout item still creates a parent gap. Cancel exactly one
  // adjacent gap while closed so removing the empty shell cannot snap siblings.
  if (findVisibleLayoutSibling(element, 'previous')) return { start: removableSpacing, end: 0 }
  if (findVisibleLayoutSibling(element, 'next')) return { start: 0, end: removableSpacing }
  return { start: 0, end: 0 }
}

function scheduleWarmMountQueue() {
  if (warmMountQueueHandle !== null || warmMountQueue.size === 0) return

  const idleWindow = window as IdleWindow
  const flush = (deadline?: IdleDeadline) => {
    warmMountQueueHandle = null

    let mounted = 0
    while (warmMountQueue.size > 0) {
      if (mounted > 0 && deadline && !deadline.didTimeout && deadline.timeRemaining() < 6) break
      const mount = warmMountQueue.values().next().value
      if (!mount) break
      warmMountQueue.delete(mount)
      mount()
      mounted += 1
      if (mounted >= 2) break
    }

    if (warmMountQueue.size > 0) scheduleWarmMountQueue()
  }

  if (idleWindow.requestIdleCallback) {
    warmMountQueueHandle = idleWindow.requestIdleCallback(flush, { timeout: 360 })
    return
  }

  warmMountQueueHandle = window.setTimeout(() => flush(), 48)
}

function enqueueWarmMount(mount: () => void) {
  warmMountQueue.add(mount)
  scheduleWarmMountQueue()
  return () => {
    warmMountQueue.delete(mount)
  }
}

/**
 * Expand/collapse shell used across checklist, settings, dossier, team, etc.
 *
 * Critical: never mount content already marked `.open`. Browsers only animate
 * `grid-template-rows` when they paint a closed frame first. Content that was
 * unmounted on close used to remount with `.open` in the same commit — which
 * skipped the open animation intermittently (warm/keepMounted paths worked).
 */
export function CollapsiblePanel({
  open,
  children,
  className = '',
  innerClassName = '',
  id,
  maxHeight,
  collapseMs = 260,
  openMs,
  closeMs,
  keepMounted = false,
  warmMount = false,
}: CollapsiblePanelProps) {
  const resolvedOpenMs = openMs ?? collapseMs
  const resolvedCloseMs = closeMs ?? collapseMs
  const [mounted, setMounted] = useState(() => open || keepMounted)
  // Visual class is intentionally one step behind `open` when expanding from
  // an unmounted state so CSS always has a closed → open transition pair.
  const [visuallyOpen, setVisuallyOpen] = useState(() => open)
  const [parentGapCompensation, setParentGapCompensation] = useState({ start: 0, end: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const gapSiblingRef = useRef<{
    element: HTMLElement
    property: 'marginTop' | 'marginBottom'
    originalValue: string
    animation: Animation | null
  } | null>(null)
  const openRef = useRef(open)
  const unmountTimerRef = useRef<number | null>(null)
  const warmMountCancelRef = useRef<(() => void) | null>(null)
  const expandFrameRef = useRef<number | null>(null)
  const expandFrame2Ref = useRef<number | null>(null)
  const canWarmMount = warmMount && !isJsdomRuntime()
  const shouldRender = keepMounted || open || mounted

  openRef.current = open

  const cancelExpandFrames = () => {
    if (expandFrameRef.current !== null) {
      window.cancelAnimationFrame(expandFrameRef.current)
      expandFrameRef.current = null
    }
    if (expandFrame2Ref.current !== null) {
      window.cancelAnimationFrame(expandFrame2Ref.current)
      expandFrame2Ref.current = null
    }
  }

  // Mount lifecycle: keep content while open (or keepMounted); delay unmount after close.
  useEffect(() => {
    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current)
      unmountTimerRef.current = null
    }

    // Warm mounting is a one-time pre-render. Once warmed, preserve the closed
    // content instead of unmounting and queueing it again after every close.
    if (open || keepMounted || (canWarmMount && mounted)) {
      setMounted(true)
      return undefined
    }

    // Still open visually until collapse finishes — unmount after close duration.
    unmountTimerRef.current = window.setTimeout(() => {
      unmountTimerRef.current = null
      // Only unmount if still closed (guard against reopen races).
      if (!openRef.current) setMounted(false)
    }, getMotionDelay(resolvedCloseMs + 160))

    return () => {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
    }
  }, [canWarmMount, keepMounted, mounted, open, resolvedCloseMs])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const next = measureParentGapCompensation(panel)
    setParentGapCompensation((current) => (
      current.start === next.start && current.end === next.end ? current : next
    ))
  }, [className, mounted, open, visuallyOpen])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const gap = parentGapCompensation.start || parentGapCompensation.end
    const sibling = panel
      ? findVisibleLayoutSibling(panel, parentGapCompensation.start > 0 ? 'previous' : 'next')
      : null
    const property = parentGapCompensation.start > 0 ? 'marginBottom' : 'marginTop'

    const restorePrevious = () => {
      const previous = gapSiblingRef.current
      if (!previous) return
      previous.animation?.cancel()
      previous.element.style[previous.property] = previous.originalValue
      gapSiblingRef.current = null
    }

    if (!mounted || !gap || !(sibling instanceof HTMLElement)) {
      restorePrevious()
      return
    }

    let tracked = gapSiblingRef.current
    if (!tracked || tracked.element !== sibling || tracked.property !== property) {
      restorePrevious()
      tracked = {
        element: sibling,
        property,
        originalValue: sibling.style[property],
        animation: null,
      }
      gapSiblingRef.current = tracked
    }

    const computed = window.getComputedStyle(sibling)
    const current = Number.parseFloat(computed[property]) || 0
    tracked.animation?.cancel()
    const base = Number.parseFloat(window.getComputedStyle(sibling)[property]) || 0
    const target = visuallyOpen ? base : base - gap
    const duration = visuallyOpen ? resolvedOpenMs : resolvedCloseMs

    if (typeof sibling.animate === 'function' && !prefersReducedMotion()) {
      const animation = sibling.animate(
        [
          { [property]: `${current}px` },
          { [property]: `${target}px` },
        ],
        {
          duration,
          easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
          fill: 'forwards',
        },
      )
      tracked.animation = animation
      if (visuallyOpen) {
        void animation.finished.then(() => {
          if (gapSiblingRef.current?.animation !== animation) return
          animation.cancel()
          gapSiblingRef.current.animation = null
        }).catch(() => undefined)
      }
      return
    }

    sibling.style[property] = `${target}px`
  }, [mounted, parentGapCompensation, resolvedCloseMs, resolvedOpenMs, visuallyOpen])

  // Warm-mount idle queue: pre-render closed content so the next expand always animates.
  useEffect(() => {
    if (!canWarmMount || mounted || open || keepMounted) return undefined

    const mount = () => {
      warmMountCancelRef.current = null
      setMounted(true)
    }

    warmMountCancelRef.current = enqueueWarmMount(mount)

    return () => {
      warmMountCancelRef.current?.()
      warmMountCancelRef.current = null
    }
  }, [canWarmMount, keepMounted, open, mounted])

  // Drive the visual open class after content is in the DOM.
  useLayoutEffect(() => {
    cancelExpandFrames()

    if (!open) {
      setVisuallyOpen(false)
      return undefined
    }

    if (!mounted) {
      // Wait for the mount effect/render to place closed content first.
      setMounted(true)
      return undefined
    }

    if (visuallyOpen) return undefined

    // Reduced motion: still mount closed content first (this layout pass), then
    // open on the next frame so parents that depend on the closed paint stay correct.
    if (prefersReducedMotion()) {
      expandFrameRef.current = window.requestAnimationFrame(() => {
        expandFrameRef.current = null
        if (openRef.current) setVisuallyOpen(true)
      })
      return () => {
        cancelExpandFrames()
      }
    }

    // Double rAF: first frame applies closed styles with content mounted;
    // second frame flips to open so grid-template-rows can interpolate.
    expandFrameRef.current = window.requestAnimationFrame(() => {
      expandFrameRef.current = null
      expandFrame2Ref.current = window.requestAnimationFrame(() => {
        expandFrame2Ref.current = null
        if (openRef.current) setVisuallyOpen(true)
      })
    })

    return () => {
      cancelExpandFrames()
    }
  }, [open, mounted, visuallyOpen])

  useEffect(() => () => {
    if (unmountTimerRef.current !== null) window.clearTimeout(unmountTimerRef.current)
    warmMountCancelRef.current?.()
    warmMountCancelRef.current = null
    cancelExpandFrames()
    const sibling = gapSiblingRef.current
    sibling?.animation?.cancel()
    if (sibling) sibling.element.style[sibling.property] = sibling.originalValue
    gapSiblingRef.current = null
  }, [])

  const style = {
    '--collapsible-open-duration': `${resolvedOpenMs}ms`,
    '--collapsible-close-duration': `${resolvedCloseMs}ms`,
    '--collapsible-close-visibility-delay': `${resolvedCloseMs}ms`,
    // Shared expandable surfaces use the same restrained reveal motion.
    '--collapsible-panel-y': '-4px',
    '--collapsible-content-y': '-4px',
    '--collapsible-closed-gap-start': `${parentGapCompensation.start}px`,
    '--collapsible-closed-gap-end': `${parentGapCompensation.end}px`,
    ...(maxHeight ? { '--collapsible-max-height': maxHeight } : null),
  } as CSSProperties

  return (
    <div
      ref={panelRef}
      id={id}
      className={`collapsible-panel ${visuallyOpen ? 'open' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-collapsible-open={open ? 'true' : 'false'}
      data-collapsible-visual={visuallyOpen ? 'open' : 'closed'}
      style={style}
    >
      {shouldRender ? (
        <div className="collapsible-panel-grid">
          <div className={`collapsible-panel-inner${innerClassName ? ` ${innerClassName}` : ''}`}>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  )
}
