import { afterEach, describe, expect, it } from 'vitest'
import type { CSSProperties } from 'react'
import {
  applyFloatingOverlayStyle,
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
  getFloatingOverlayZIndex,
} from './floatingOverlay'
import countrySelectSource from './CountrySelect.tsx?raw'
import datePickerSource from './DatePicker.tsx?raw'
import recommenderComboboxSource from './RecommenderCombobox.tsx?raw'
import selectSource from './Select.tsx?raw'
import timePickerSource from './TimePicker.tsx?raw'

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
  it('writes transient geometry on the resident portal without a React rerender', () => {
    const element = document.createElement('div')
    element.style.visibility = 'hidden'

    applyFloatingOverlayStyle(element, {
      position: 'fixed',
      left: 12,
      top: 48,
      zIndex: FLOATING_CONTROL_BASE_Z_INDEX,
      '--floating-transform-origin': 'top left',
    } as CSSProperties)

    expect(element.style.position).toBe('fixed')
    expect(element.style.left).toBe('12px')
    expect(element.style.top).toBe('48px')
    expect(element.style.zIndex).toBe(String(FLOATING_CONTROL_BASE_Z_INDEX))
    expect(element.style.getPropertyValue('--floating-transform-origin')).toBe('top left')
    expect(element.style.visibility).toBe('')
  })

  it('keeps shared trigger menus hidden until measured and observes content growth', () => {
    for (const source of [countrySelectSource, selectSource, datePickerSource, timePickerSource, recommenderComboboxSource]) {
      expect(source).toMatch(/useLayoutEffect/)
      expect(source).toMatch(/actualHeight:[\s\S]*?offsetHeight/)
      expect(source).toMatch(/new ResizeObserver/)
    }

    expect(countrySelectSource).not.toMatch(/requestAnimationFrame\(\(\) => setDropdownStyle\(getDropdownPosition\(\)\)\)/)
    expect(selectSource).not.toMatch(/requestAnimationFrame\(\(\) => setDropdownStyle\(getDropdownPosition\(\)\)\)/)
    expect(datePickerSource).not.toMatch(/requestAnimationFrame\(\(\) => \{\s*updateDropdownPosition\(\)/)
    expect(timePickerSource).not.toMatch(/requestAnimationFrame\(\(\) => setDropdownStyle\(getDropdownPosition\(\)\)\)/)
    expect(recommenderComboboxSource).not.toMatch(/requestAnimationFrame\(\(\) => setMenuStyle\(getMenuPosition\(\)\)\)/)
  })

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

  it('can choose the full-menu side before a collapsed menu grows', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 780 })

    const trigger = triggerAt(24, 500, 180, 40)
    const initial = getAnchoredOverlayStyle(trigger, {
      minWidth: 180,
      maxWidth: 340,
      estimatedHeight: 400,
      actualHeight: 180,
      useEstimatedHeightForPlacement: true,
    })
    const grown = getAnchoredOverlayStyle(trigger, {
      minWidth: 180,
      maxWidth: 340,
      estimatedHeight: 400,
      actualHeight: 380,
      placement: 'above',
    })

    expect(initial['--floating-placement' as keyof typeof initial]).toBe('above')
    expect(grown['--floating-placement' as keyof typeof grown]).toBe('above')
    expect(grown['--floating-transform-origin' as keyof typeof grown]).toBe('bottom left')
  })

  it('can pin an above-growing overlay to the trigger edge', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 780 })

    const style = getAnchoredOverlayStyle(triggerAt(24, 500, 180, 40), {
      minWidth: 180,
      maxWidth: 340,
      estimatedHeight: 400,
      actualHeight: 180,
      useEstimatedHeightForPlacement: true,
      anchorAboveToBottom: true,
      gap: 6,
    })

    expect(style.top).toBe('auto')
    expect(style.bottom).toBe(286)
    expect(style['--floating-placement' as keyof typeof style]).toBe('above')
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
