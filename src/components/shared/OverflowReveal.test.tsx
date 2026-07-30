import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { OverflowReveal } from './OverflowReveal'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path, fallback) => ({
    copySummary: 'summary',
    copiedBang: 'Copied!',
    copyFailed: "Couldn't copy — select and copy manually",
    doubleClickToCopy: 'Double-click to copy {label}',
  })[path] ?? fallback ?? path,
}

function setElementBox(element: HTMLElement, clientWidth: number, scrollWidth: number) {
  Object.assign(element.style, {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
    clientHeight: { configurable: true, value: 20 },
    scrollHeight: { configurable: true, value: 20 },
  })
  element.getBoundingClientRect = () => ({
    x: 24,
    y: 32,
    top: 32,
    right: 24 + clientWidth,
    bottom: 52,
    left: 24,
    width: clientWidth,
    height: 20,
    toJSON: () => ({}),
  } as DOMRect)
}

function renderReveal() {
  const view = render(
    <I18nContext.Provider value={i18nContext}>
      <OverflowReveal text="Director of Graduate Research and Admissions" />
    </I18nContext.Provider>,
  )
  const target = screen.getByText('Director of Graduate Research and Admissions')
  return { ...view, target }
}

describe('OverflowReveal', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens after a 1s mouse dwell only when the value is actually truncated', () => {
    vi.useFakeTimers()
    const { target } = renderReveal()
    setElementBox(target, 80, 260)

    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(999))
    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()
    fireEvent.mouseLeave(target)
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()

    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Director of Graduate Research and Admissions')

    fireEvent.mouseLeave(target)
    expect(document.querySelector('.overflow-reveal-portal')).not.toHaveClass('is-open')
  })

  it('does not create a tooltip for a fully visible explicit value', () => {
    vi.useFakeTimers()
    const { target } = renderReveal()
    setElementBox(target, 260, 260)

    expect(target).not.toHaveAttribute('title')
    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.focus(target)

    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()
  })

  it('keeps keyboard focus disclosure immediate for genuinely truncated text', () => {
    const { target } = renderReveal()
    setElementBox(target, 80, 260)

    fireEvent.focus(target)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Director of Graduate Research and Admissions')
  })

  it('cancels a pending or open reveal on pointer down until the pointer leaves', () => {
    vi.useFakeTimers()
    const { target } = renderReveal()
    setElementBox(target, 80, 260)

    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerDown(target, { pointerType: 'mouse' })
    fireEvent.focus(target)
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(1000))
    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()

    fireEvent.mouseLeave(target)
    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Director of Graduate Research and Admissions')

    fireEvent.pointerDown(target, { pointerType: 'mouse' })
    expect(document.querySelector('.overflow-reveal-portal')).not.toHaveClass('is-open')
  })

  it('restores keyboard intent after a pointer-induced focus', () => {
    const { target } = renderReveal()
    setElementBox(target, 80, 260)

    fireEvent.pointerDown(target, { pointerType: 'mouse' })
    fireEvent.focus(target)
    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()

    fireEvent.keyDown(target, { key: 'Tab' })
    fireEvent.focus(target)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Director of Graduate Research and Admissions')
  })
})
