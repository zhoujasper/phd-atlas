import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { GlobalOverflowReveal } from './GlobalOverflowReveal'
import {
  hasVisualTextTruncation,
  isElementVisuallyTruncated,
  OVERFLOW_REVEAL_HOVER_DELAY_MS,
  overflowRevealText,
} from './overflowRevealModel'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path, fallback) => fallback ?? path,
}

function setElementBox(
  element: HTMLElement,
  {
    clientWidth,
    scrollWidth,
    clientHeight = 20,
    scrollHeight = 20,
    left = 24,
    top = 32,
  }: {
    clientWidth: number
    scrollWidth: number
    clientHeight?: number
    scrollHeight?: number
    left?: number
    top?: number
  },
) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  })
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    top,
    right: left + clientWidth,
    bottom: top + clientHeight,
    left,
    width: clientWidth,
    height: clientHeight,
    toJSON: () => ({}),
  } as DOMRect)
}

function clippedStyle() {
  return {
    display: 'block',
    width: 80,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const
}

function renderLayer(children: React.ReactNode) {
  return render(
    <I18nContext.Provider value={i18nContext}>
      <GlobalOverflowReveal />
      {children}
    </I18nContext.Provider>,
  )
}

describe('GlobalOverflowReveal', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps incidental clipping and compact controls passive unless data text explicitly opts in', () => {
    vi.useFakeTimers()
    const onClick = vi.fn()
    renderLayer(
      <>
        <span data-testid="implicit" style={clippedStyle()}>
          Director of Graduate Research and Admissions
        </span>
        <button
          type="button"
          data-testid="compact-control"
          data-overflow-reveal="auto"
          onClick={onClick}
          style={clippedStyle()}
        >
          Retry and sync
        </button>
        <span data-testid="intentional" data-overflow-reveal="auto" style={clippedStyle()}>
          Professor of Human-Centred Computing
        </span>
      </>,
    )

    const implicit = screen.getByTestId('implicit')
    const control = screen.getByTestId('compact-control')
    const intentional = screen.getByTestId('intentional')
    setElementBox(implicit, { clientWidth: 80, scrollWidth: 260 })
    setElementBox(control, { clientWidth: 80, scrollWidth: 132 })
    setElementBox(intentional, { clientWidth: 80, scrollWidth: 240 })

    expect(hasVisualTextTruncation(implicit)).toBe(true)
    expect(isElementVisuallyTruncated(implicit)).toBe(false)
    expect(isElementVisuallyTruncated(control)).toBe(false)
    expect(isElementVisuallyTruncated(intentional)).toBe(true)

    fireEvent.pointerOver(implicit, { pointerType: 'mouse' })
    fireEvent.pointerOver(control, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS))
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()

    fireEvent.click(control)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()
  })

  it('waits 1s before revealing opted-in clipped text and ignores a complete value', () => {
    vi.useFakeTimers()
    renderLayer(
      <>
        <span data-testid="clipped" data-overflow-reveal="auto" style={clippedStyle()}>
          Director of Graduate Research and Admissions
        </span>
        <span data-testid="complete" data-overflow-reveal="auto" style={clippedStyle()}>
          Fully visible
        </span>
      </>,
    )

    const clipped = screen.getByTestId('clipped')
    const complete = screen.getByTestId('complete')
    setElementBox(clipped, { clientWidth: 80, scrollWidth: 260 })
    setElementBox(complete, { clientWidth: 180, scrollWidth: 180 })

    expect(isElementVisuallyTruncated(clipped)).toBe(true)
    expect(isElementVisuallyTruncated(complete)).toBe(false)

    fireEvent.pointerOver(complete, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS))
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()

    fireEvent.pointerOver(clipped, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS - 1))
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    act(() => vi.advanceTimersByTime(16))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Director of Graduate Research and Admissions',
    )

    fireEvent.pointerOut(clipped, { pointerType: 'mouse', relatedTarget: document.body })
    expect(document.querySelector('.global-overflow-reveal')).not.toHaveClass('is-open')
  })

  it('cancels the dwell on pointer down and stays suppressed until the pointer leaves', () => {
    vi.useFakeTimers()
    renderLayer(
      <span data-testid="clipped" data-overflow-reveal="auto" style={clippedStyle()}>
        Director of Graduate Research and Admissions
      </span>,
    )

    const clipped = screen.getByTestId('clipped')
    setElementBox(clipped, { clientWidth: 80, scrollWidth: 260 })

    fireEvent.pointerOver(clipped, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerDown(clipped, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS))
    fireEvent.pointerOver(clipped, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS))
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()

    fireEvent.pointerOut(clipped, { pointerType: 'mouse', relatedTarget: document.body })
    fireEvent.pointerOver(clipped, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS))
    act(() => vi.advanceTimersByTime(16))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Director of Graduate Research and Admissions',
    )

    fireEvent.pointerDown(clipped, { pointerType: 'mouse' })
    expect(document.querySelector('.global-overflow-reveal')).not.toHaveClass('is-open')
  })

  it('keeps explicit keyboard-focus disclosure immediate while ignoring pointer focus', async () => {
    renderLayer(
      <span
        data-testid="focus-value"
        data-overflow-reveal="auto"
        tabIndex={0}
        style={clippedStyle()}
      >
        Director of Graduate Research and Admissions
      </span>,
    )

    const value = screen.getByTestId('focus-value')
    setElementBox(value, { clientWidth: 80, scrollWidth: 260 })

    fireEvent.pointerDown(value, { pointerType: 'mouse' })
    fireEvent.focusIn(value)
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()

    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.focusIn(value)
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Director of Graduate Research and Admissions',
      )
    })
  })

  it('reveals an explicit complete value while keeping full semantic text in the DOM', () => {
    vi.useFakeTimers()
    const fullValue = 'AMD Ryzen 7 6800H with Radeon Graphics'
    renderLayer(
      <span data-overflow-full-text={fullValue}>
        <strong data-testid="legacy-shortened" style={clippedStyle()}>
          AMD Ryzen 7 6800H with Radeon Gr…
        </strong>
      </span>,
    )

    const target = screen.getByTestId('legacy-shortened')
    setElementBox(target, { clientWidth: 92, scrollWidth: 220 })

    expect(overflowRevealText(target)).toBe(fullValue)
    fireEvent.pointerOver(target, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(OVERFLOW_REVEAL_HOVER_DELAY_MS))
    act(() => vi.advanceTimersByTime(16))

    expect(screen.getByRole('tooltip')).toHaveTextContent(fullValue)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Radeon Gr…')
  })

  it('recovers a compatible complete title for explicitly opted-in legacy text', () => {
    const target = document.createElement('span')
    target.dataset.overflowReveal = 'auto'
    target.title = 'Director of Graduate Research and Admissions'
    target.textContent = 'Director of Graduate Research…'

    expect(overflowRevealText(target)).toBe('Director of Graduate Research and Admissions')
  })

  it('supports opted-in line clamps while excluding implicit, editable, and managed content', () => {
    renderLayer(
      <>
        <p
          data-testid="clamped"
          data-overflow-reveal="auto"
          style={{ display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 2 }}
        >
          A long multi-line research summary that continues beyond the two visible lines.
        </p>
        <p
          data-testid="implicit-clamp"
          style={{ display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 2 }}
        >
          An ordinary compact summary with no full-text interaction.
        </p>
        <input
          data-testid="editable"
          data-overflow-reveal="auto"
          value="Long editable value"
          readOnly
          style={clippedStyle()}
        />
        <span
          data-testid="managed"
          data-overflow-reveal="off"
          data-overflow-full-text="Managed elsewhere"
          style={clippedStyle()}
        >
          Managed elsewhere
        </span>
      </>,
    )

    const clamped = screen.getByTestId('clamped')
    const implicitClamp = screen.getByTestId('implicit-clamp')
    const editable = screen.getByTestId('editable')
    const managed = screen.getByTestId('managed')
    setElementBox(clamped, {
      clientWidth: 160,
      scrollWidth: 160,
      clientHeight: 36,
      scrollHeight: 72,
    })
    setElementBox(implicitClamp, {
      clientWidth: 160,
      scrollWidth: 160,
      clientHeight: 36,
      scrollHeight: 72,
    })
    setElementBox(editable, { clientWidth: 60, scrollWidth: 160 })
    setElementBox(managed, { clientWidth: 60, scrollWidth: 160 })

    expect(isElementVisuallyTruncated(clamped)).toBe(true)
    expect(isElementVisuallyTruncated(implicitClamp)).toBe(false)
    expect(isElementVisuallyTruncated(editable)).toBe(false)
    expect(isElementVisuallyTruncated(managed)).toBe(false)
  })
})
