import type { CSSProperties } from 'react'

type FloatingOverlayOptions = {
  minWidth: number
  maxWidth: number
  estimatedHeight: number
  actualHeight?: number
  gap?: number
  viewportPadding?: number
  align?: 'start' | 'end'
  baseZIndex?: number
}

export const FLOATING_POPOVER_BASE_Z_INDEX = 420
export const FLOATING_CONTROL_BASE_Z_INDEX = 440
export const FLOATING_OVERLAY_LAYER_STEP = 20

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getViewportBounds() {
  const visualViewport = window.visualViewport
  const left = visualViewport?.offsetLeft ?? 0
  const top = visualViewport?.offsetTop ?? 0
  const width = visualViewport?.width ?? window.innerWidth
  const height = visualViewport?.height ?? window.innerHeight
  return { left, top, right: left + width, bottom: top + height, width }
}

/**
 * Portal overlays leave their trigger's stacking context, so a fixed global
 * z-index can put a child menu behind the popover/dialog that opened it.
 * Promote the portal one layer above the highest ancestor while retaining a
 * calm global baseline for ordinary page controls.
 */
export function getFloatingOverlayZIndex(
  trigger: HTMLElement | null,
  baseZIndex: number,
) {
  if (!trigger || typeof window === 'undefined') return baseZIndex

  let highestAncestorZIndex = baseZIndex - FLOATING_OVERLAY_LAYER_STEP
  let current = trigger.parentElement
  while (current) {
    const parsedZIndex = Number.parseInt(window.getComputedStyle(current).zIndex, 10)
    if (Number.isFinite(parsedZIndex)) {
      highestAncestorZIndex = Math.max(highestAncestorZIndex, parsedZIndex)
    }
    current = current.parentElement
  }

  return Math.max(baseZIndex, highestAncestorZIndex + FLOATING_OVERLAY_LAYER_STEP)
}

/** Keep a portal overlay spatially attached to the control that opened it. */
export function getAnchoredOverlayStyle(
  trigger: HTMLElement | null,
  {
    minWidth,
    maxWidth,
    estimatedHeight,
    actualHeight,
    gap = 4,
    viewportPadding = 8,
    align = 'start',
    baseZIndex,
  }: FloatingOverlayOptions,
): CSSProperties {
  if (!trigger || typeof window === 'undefined') return { visibility: 'hidden' }

  const rect = trigger.getBoundingClientRect()
  const viewport = getViewportBounds()
  const availableWidth = Math.max(0, viewport.width - viewportPadding * 2)
  const width = Math.min(availableWidth, Math.max(Math.min(minWidth, availableWidth), Math.min(maxWidth, rect.width)))
  const preferredLeft = align === 'end' ? rect.right - width : rect.left
  const left = clamp(
    preferredLeft,
    viewport.left + viewportPadding,
    Math.max(viewport.left + viewportPadding, viewport.right - viewportPadding - width),
  )
  const spaceBelow = Math.max(0, viewport.bottom - viewportPadding - rect.bottom - gap)
  const spaceAbove = Math.max(0, rect.top - gap - viewport.top - viewportPadding)
  const measuredHeight = actualHeight && actualHeight > 0 ? actualHeight : estimatedHeight
  const openAbove = spaceBelow < Math.min(measuredHeight, estimatedHeight) && spaceAbove > spaceBelow
  const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow)
  const renderedHeight = Math.min(measuredHeight, availableHeight)
  const top = openAbove
    ? Math.max(viewport.top + viewportPadding, rect.top - gap - renderedHeight)
    : rect.bottom + gap

  return {
    position: 'fixed',
    left,
    right: 'auto',
    top,
    bottom: 'auto',
    ...(baseZIndex === undefined
      ? {}
      : { zIndex: getFloatingOverlayZIndex(trigger, baseZIndex) }),
    width,
    maxWidth: availableWidth,
    maxHeight: availableHeight,
    '--floating-available-height': `${availableHeight}px`,
    '--floating-transform-origin': openAbove ? 'bottom left' : 'top left',
    '--floating-enter-y': openAbove ? '4px' : '-4px',
    '--floating-exit-y': openAbove ? '3px' : '-3px',
  } as CSSProperties
}

export function addFloatingViewportListeners(listener: EventListener) {
  window.addEventListener('resize', listener)
  window.addEventListener('scroll', listener, { capture: true, passive: true })
  window.visualViewport?.addEventListener('resize', listener)
  window.visualViewport?.addEventListener('scroll', listener)

  return () => {
    window.removeEventListener('resize', listener)
    window.removeEventListener('scroll', listener, true)
    window.visualViewport?.removeEventListener('resize', listener)
    window.visualViewport?.removeEventListener('scroll', listener)
  }
}
