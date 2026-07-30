import { afterEach, describe, expect, it } from 'vitest'
import {
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
  getFloatingOverlayZIndex,
} from './floatingOverlay'

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

function triggerAt(x: number, y: number, width: number, height: number) {
  const trigger = document.createElement('button')
  trigger.getBoundingClientRect = () => new DOMRect(x, y, width, height)
  return trigger
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
})

describe('getAnchoredOverlayStyle', () => {
  it('opens beside a mobile trigger instead of detaching into a bottom sheet', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })

    const style = getAnchoredOverlayStyle(triggerAt(220, 260, 136, 36), {
      minWidth: 160,
      maxWidth: 340,
      estimatedHeight: 286,
    })

    expect(style).toMatchObject({
      position: 'fixed',
      left: 220,
      top: 300,
      bottom: 'auto',
      width: 160,
    })
  })

  it('flips above controls near the bottom and stays inside the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 780 })

    const style = getAnchoredOverlayStyle(triggerAt(24, 720, 180, 40), {
      minWidth: 180,
      maxWidth: 340,
      estimatedHeight: 286,
    })

    expect(style.left).toBe(24)
    expect(style.top).toBe(430)
    expect(style.maxHeight).toBe(708)
    expect(style['--floating-transform-origin' as keyof typeof style]).toBe('bottom left')
    expect(style['--floating-enter-y' as keyof typeof style]).toBe('4px')
    expect(style['--floating-exit-y' as keyof typeof style]).toBe('3px')
  })

  it('clamps wide overlays to narrow screens without horizontal overflow', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 })

    const style = getAnchoredOverlayStyle(triggerAt(280, 80, 32, 40), {
      minWidth: 300,
      maxWidth: 400,
      estimatedHeight: 360,
    })

    expect(style.left).toBe(12)
    expect(style.width).toBe(300)
    expect(style.maxWidth).toBe(304)
  })

  it('promotes a portal menu above the overlay layer containing its trigger', () => {
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.zIndex = '470'
    const trigger = triggerAt(24, 80, 180, 36)
    overlay.append(trigger)
    document.body.append(overlay)

    expect(getFloatingOverlayZIndex(trigger, FLOATING_CONTROL_BASE_Z_INDEX)).toBe(490)

    const style = getAnchoredOverlayStyle(trigger, {
      minWidth: 180,
      maxWidth: 340,
      estimatedHeight: 286,
      baseZIndex: FLOATING_CONTROL_BASE_Z_INDEX,
    })
    expect(style.zIndex).toBe(490)

    overlay.remove()
  })
})
