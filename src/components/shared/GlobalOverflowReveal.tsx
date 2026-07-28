import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { copyToClipboard } from './clipboard'
import {
  isElementVisuallyTruncated,
  overflowRevealCopyValue,
  overflowRevealText,
  OVERFLOW_REVEAL_EXCLUDED_SELECTOR,
  OVERFLOW_REVEAL_HOVER_DELAY_MS,
} from './overflowRevealModel'

const EXIT_DURATION_MS = 170
const INTERACTIVE_CLICK_DELAY_MS = 240
const MAX_TOOLTIP_WIDTH = 440
const VIEWPORT_GUTTER = 8
const INTERACTIVE_SELECTOR = 'a[href], button, [role="button"], [role="link"], summary'

type RevealRect = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

type RevealTypography = {
  color: string
  direction: CSSProperties['direction']
  fontFamily: string
  fontSize: string
  fontStyle: string
  fontWeight: CSSProperties['fontWeight']
  letterSpacing: string
  lineHeight: string
  textTransform: CSSProperties['textTransform']
}

type RevealSnapshot = {
  target: HTMLElement
  text: string
  copyValue: string
  rect: RevealRect
  typography: RevealTypography
  version: number
}

type RevealPosition = {
  top: number
  left: number
  minWidth: number
  maxWidth: number
}

type SuppressedTitle = {
  target: HTMLElement
  value: string
}

function closestOverflowTarget(eventTarget: EventTarget | null) {
  let element = eventTarget instanceof Element
    ? (eventTarget instanceof HTMLElement ? eventTarget : eventTarget.parentElement)
    : null

  if (!element || element.closest(OVERFLOW_REVEAL_EXCLUDED_SELECTOR)) return null

  while (element && element !== document.body && element !== document.documentElement) {
    if (isElementVisuallyTruncated(element)) return element
    element = element.parentElement
  }
  return null
}

function firstOverflowDescendant(root: HTMLElement) {
  if (root.closest(OVERFLOW_REVEAL_EXCLUDED_SELECTOR)) return null
  const descendants = root.querySelectorAll<HTMLElement>('*')
  const limit = Math.min(descendants.length, 48)
  for (let index = 0; index < limit; index += 1) {
    const candidate = descendants[index]
    if (isElementVisuallyTruncated(candidate)) return candidate
  }
  return null
}

function revealRect(element: HTMLElement): RevealRect {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function snapshotForTarget(target: HTMLElement, version: number): RevealSnapshot | null {
  if (!isElementVisuallyTruncated(target)) return null
  const text = overflowRevealText(target)
  const copyValue = overflowRevealCopyValue(target, text)
  if (!text || !copyValue) return null
  const style = window.getComputedStyle(target)
  return {
    target,
    text,
    copyValue,
    rect: revealRect(target),
    typography: {
      color: style.color,
      direction: style.direction as CSSProperties['direction'],
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight as CSSProperties['fontWeight'],
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textTransform: style.textTransform as CSSProperties['textTransform'],
    },
    version,
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return minimum
  return Math.min(Math.max(value, minimum), maximum)
}

function targetStillInteractedWith(target: HTMLElement) {
  try {
    if (target.matches(':hover')) return true
  } catch {
    // JSDOM and older embedded webviews may not support :hover matching.
  }
  const focused = document.activeElement
  return focused instanceof Element && (focused === target || focused.contains(target) || target.contains(focused))
}

/**
 * One delegated interaction layer for every genuinely truncated text node in
 * the current document. It avoids layout shifts by rendering the full value in
 * a fixed portal, keeps the source controls clickable, and copies on dblclick.
 */
export function GlobalOverflowReveal() {
  const { tx } = useI18n()
  const [snapshot, setSnapshot] = useState<RevealSnapshot | null>(null)
  const [position, setPosition] = useState<RevealPosition | null>(null)
  const [open, setOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const activeTargetRef = useRef<HTMLElement | null>(null)
  const snapshotRef = useRef<RevealSnapshot | null>(null)
  const versionRef = useRef(0)
  const exitTimerRef = useRef<number | null>(null)
  const statusTimerRef = useRef<number | null>(null)
  const hoverOpenTimerRef = useRef<number | null>(null)
  const pendingHoverTargetRef = useRef<HTMLElement | null>(null)
  const suppressedTitleRef = useRef<SuppressedTitle | null>(null)
  const pendingInteractiveClicksRef = useRef<Map<HTMLElement, number>>(new Map())
  const replayingInteractiveClicksRef = useRef<Set<HTMLElement>>(new Set())
  const lastTouchPointerAtRef = useRef(0)

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [])

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
  }, [])

  const clearHoverOpenTimer = useCallback((expectedTarget?: HTMLElement | null) => {
    if (
      expectedTarget
      && pendingHoverTargetRef.current
      && pendingHoverTargetRef.current !== expectedTarget
    ) {
      return
    }
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
    pendingHoverTargetRef.current = null
  }, [])

  const restoreTarget = useCallback((target: HTMLElement | null) => {
    if (!target) return
    target.removeAttribute('data-overflow-reveal-active')
    const suppressed = suppressedTitleRef.current
    if (suppressed?.target === target) {
      if (!target.hasAttribute('title')) target.setAttribute('title', suppressed.value)
      suppressedTitleRef.current = null
    }
  }, [])

  const hide = useCallback((expectedTarget?: HTMLElement | null) => {
    clearHoverOpenTimer()
    const activeTarget = activeTargetRef.current
    if (expectedTarget && activeTarget && expectedTarget !== activeTarget) return
    restoreTarget(activeTarget)
    activeTargetRef.current = null
    setOpen(false)
    setCopyStatus('idle')
    clearStatusTimer()
    clearExitTimer()
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null
      if (activeTargetRef.current) return
      snapshotRef.current = null
      setSnapshot(null)
      setPosition(null)
    }, EXIT_DURATION_MS)
  }, [clearExitTimer, clearHoverOpenTimer, clearStatusTimer, restoreTarget])

  const activate = useCallback((target: HTMLElement) => {
    clearHoverOpenTimer()
    const currentTarget = activeTargetRef.current
    if (currentTarget === target) return snapshotRef.current

    const next = snapshotForTarget(target, ++versionRef.current)
    if (!next) return null

    restoreTarget(currentTarget)
    clearExitTimer()
    clearStatusTimer()
    activeTargetRef.current = target
    snapshotRef.current = next
    target.setAttribute('data-overflow-reveal-active', 'true')

    const nativeTitle = target.getAttribute('title')
    if (nativeTitle && nativeTitle.trim() === next.text) {
      suppressedTitleRef.current = { target, value: nativeTitle }
      target.removeAttribute('title')
    }

    setOpen(false)
    setCopyStatus('idle')
    setPosition(null)
    setSnapshot(next)
    return next
  }, [clearExitTimer, clearHoverOpenTimer, clearStatusTimer, restoreTarget])

  const scheduleHoverActivate = useCallback((target: HTMLElement) => {
    if (
      activeTargetRef.current === target
      || pendingHoverTargetRef.current === target
    ) {
      return
    }
    clearHoverOpenTimer()
    pendingHoverTargetRef.current = target
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null
      pendingHoverTargetRef.current = null
      if (target.isConnected) activate(target)
    }, OVERFLOW_REVEAL_HOVER_DELAY_MS)
  }, [activate, clearHoverOpenTimer])

  const refreshActiveTarget = useCallback(() => {
    const target = activeTargetRef.current
    const current = snapshotRef.current
    if (!target || !current || !target.isConnected || !isElementVisuallyTruncated(target)) {
      hide(target)
      return
    }
    const next = snapshotForTarget(target, current.version)
    if (!next) {
      hide(target)
      return
    }
    snapshotRef.current = next
    setSnapshot(next)
  }, [hide])

  const copyTarget = useCallback(async (target: HTMLElement) => {
    const active = activate(target) ?? snapshotForTarget(target, ++versionRef.current)
    if (!active) return
    const ok = await copyToClipboard(active.copyValue)
    if (activeTargetRef.current !== target) return
    setCopyStatus(ok ? 'copied' : 'failed')
    setOpen(true)
    clearStatusTimer()
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null
      setCopyStatus('idle')
      if (!targetStillInteractedWith(target)) hide(target)
    }, 1500)
  }, [activate, clearStatusTimer, hide])

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!snapshot || !tooltip) return

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768
    const maxWidth = Math.min(MAX_TOOLTIP_WIDTH, Math.max(160, viewportWidth - VIEWPORT_GUTTER * 2))
    const minWidth = Math.min(maxWidth, Math.max(48, snapshot.rect.width))
    const tooltipRect = tooltip.getBoundingClientRect()
    const parsedFontSize = Number.parseFloat(snapshot.typography.fontSize) || 13
    const parsedLineHeight = Number.parseFloat(snapshot.typography.lineHeight) || parsedFontSize * 1.45
    const estimatedWidth = Math.min(
      maxWidth,
      Math.max(minWidth, snapshot.text.length * parsedFontSize * 0.56 + 20),
    )
    const measuredWidth = tooltipRect.width || estimatedWidth
    const estimatedLines = Math.max(1, Math.ceil(estimatedWidth / Math.max(measuredWidth, 1)))
    const measuredHeight = tooltipRect.height || estimatedLines * parsedLineHeight + 14
    const preferredLeft = snapshot.typography.direction === 'rtl'
      ? snapshot.rect.right - measuredWidth
      : snapshot.rect.left
    const left = clamp(
      preferredLeft,
      VIEWPORT_GUTTER,
      viewportWidth - measuredWidth - VIEWPORT_GUTTER,
    )
    const top = clamp(
      snapshot.rect.top + snapshot.rect.height / 2 - measuredHeight / 2,
      VIEWPORT_GUTTER,
      viewportHeight - measuredHeight - VIEWPORT_GUTTER,
    )

    setPosition({ top, left, minWidth, maxWidth })
  }, [snapshot])

  useEffect(() => {
    if (!snapshot || !position || activeTargetRef.current !== snapshot.target) return undefined
    const frame = window.requestAnimationFrame(() => setOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [position, snapshot])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (Date.now() - lastTouchPointerAtRef.current < 900) return
      const eventElement = event.target instanceof Element ? event.target : null
      const eventInteractive = eventElement?.closest<HTMLElement>(INTERACTIVE_SELECTOR) ?? null
      if (eventInteractive && replayingInteractiveClicksRef.current.has(eventInteractive)) return
      if (
        event.button !== 0
        || event.detail < 1
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) {
        return
      }

      const target = closestOverflowTarget(event.target)
      const interactive = target?.closest<HTMLElement>(INTERACTIVE_SELECTOR) ?? null
      if (!target || !interactive || interactive.hasAttribute('disabled')) return

      event.preventDefault()
      event.stopPropagation()
      const pending = pendingInteractiveClicksRef.current.get(interactive)
      if (pending !== undefined) {
        window.clearTimeout(pending)
        pendingInteractiveClicksRef.current.delete(interactive)
      }
      // A second click is followed immediately by dblclick, which owns the copy.
      if (event.detail > 1) return

      const timer = window.setTimeout(() => {
        pendingInteractiveClicksRef.current.delete(interactive)
        if (!interactive.isConnected) return
        replayingInteractiveClicksRef.current.add(interactive)
        try {
          interactive.click()
        } finally {
          replayingInteractiveClicksRef.current.delete(interactive)
        }
      }, INTERACTIVE_CLICK_DELAY_MS)
      pendingInteractiveClicksRef.current.set(interactive, timer)
    }

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const target = closestOverflowTarget(event.target)
      if (target) scheduleHoverActivate(target)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      lastTouchPointerAtRef.current = Date.now()
      clearHoverOpenTimer()
      if (activeTargetRef.current) hide(activeTargetRef.current)
    }

    const onPointerOut = (event: PointerEvent) => {
      const pending = pendingHoverTargetRef.current
      const related = event.relatedTarget
      if (
        pending
        && !(related instanceof Node && pending.contains(related))
      ) {
        clearHoverOpenTimer(pending)
      }
      const active = activeTargetRef.current
      if (!active) return
      if (related instanceof Node && active.contains(related)) return
      hide(active)
    }

    const onDoubleClick = (event: MouseEvent) => {
      if (Date.now() - lastTouchPointerAtRef.current < 900) return
      const target = closestOverflowTarget(event.target)
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
      void copyTarget(target)
    }

    const onFocusIn = (event: FocusEvent) => {
      if (Date.now() - lastTouchPointerAtRef.current < 900) return
      const eventElement = event.target instanceof HTMLElement ? event.target : null
      const target = closestOverflowTarget(event.target)
        ?? (eventElement ? firstOverflowDescendant(eventElement) : null)
      if (target) activate(target)
    }

    const onFocusOut = (event: FocusEvent) => {
      const active = activeTargetRef.current
      if (!active) return
      const related = event.relatedTarget
      if (related instanceof Node && (active.contains(related) || (related instanceof Element && related.contains(active)))) {
        return
      }
      if (!targetStillInteractedWith(active)) hide(active)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeTargetRef.current) hide(activeTargetRef.current)
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('dblclick', onDoubleClick, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('dblclick', onDoubleClick, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activate, clearHoverOpenTimer, copyTarget, hide, scheduleHoverActivate])

  useEffect(() => {
    const target = snapshot?.target
    if (!target) return undefined

    let frame: number | null = null
    const scheduleRefresh = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        refreshActiveTarget()
      })
    }
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleRefresh)
      : null
    resizeObserver?.observe(target)
    const mutationObserver = typeof MutationObserver !== 'undefined' && document.body
      ? new MutationObserver(() => {
          if (!target.isConnected) hide(target)
        })
      : null
    mutationObserver?.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', scheduleRefresh)
    window.addEventListener('scroll', scheduleRefresh, true)

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('scroll', scheduleRefresh, true)
    }
  }, [hide, refreshActiveTarget, snapshot?.target])

  useEffect(() => () => {
    restoreTarget(activeTargetRef.current)
    clearExitTimer()
    clearHoverOpenTimer()
    clearStatusTimer()
    pendingInteractiveClicksRef.current.forEach((timer) => window.clearTimeout(timer))
    pendingInteractiveClicksRef.current.clear()
    replayingInteractiveClicksRef.current.clear()
  }, [clearExitTimer, clearHoverOpenTimer, clearStatusTimer, restoreTarget])

  if (!snapshot || typeof document === 'undefined') return null

  const style: CSSProperties = {
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    minWidth: position?.minWidth,
    maxWidth: position?.maxWidth ?? MAX_TOOLTIP_WIDTH,
    color: snapshot.typography.color,
    direction: snapshot.typography.direction,
    fontFamily: snapshot.typography.fontFamily,
    fontSize: snapshot.typography.fontSize,
    fontStyle: snapshot.typography.fontStyle,
    fontWeight: snapshot.typography.fontWeight,
    letterSpacing: snapshot.typography.letterSpacing,
    lineHeight: snapshot.typography.lineHeight,
    textTransform: snapshot.typography.textTransform,
  }

  return createPortal(
    <span
      ref={tooltipRef}
      role="tooltip"
      aria-hidden={!open}
      data-global-overflow-reveal=""
      className={`global-overflow-reveal${open && position ? ' is-open' : ''}${copyStatus !== 'idle' ? ` is-${copyStatus}` : ''}`}
      style={style}
    >
      <span className="global-overflow-reveal-text">{snapshot.text}</span>
      <span
        className="global-overflow-reveal-copy-status"
        role="status"
        aria-live="polite"
      >
        {copyStatus === 'copied'
          ? tx('copiedBang', 'Copied!')
          : copyStatus === 'failed'
            ? tx('copyFailed', "Couldn't copy — select and copy manually")
            : ''}
      </span>
    </span>,
    document.body,
  )
}
