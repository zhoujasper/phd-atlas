import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { copyToClipboard } from './clipboard'
import { GlobalOverflowReveal } from './GlobalOverflowReveal'
import { isElementVisuallyTruncated } from './overflowRevealModel'

vi.mock('./clipboard', () => ({
  copyToClipboard: vi.fn(),
}))

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path, fallback) => ({
    copiedBang: 'Copied!',
    copyFailed: "Couldn't copy — select and copy manually",
  })[path] ?? fallback ?? path,
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

function renderLayer(children: React.ReactNode) {
  return render(
    <I18nContext.Provider value={i18nContext}>
      <GlobalOverflowReveal />
      {children}
    </I18nContext.Provider>,
  )
}

describe('GlobalOverflowReveal', () => {
  beforeEach(() => {
    vi.mocked(copyToClipboard).mockReset()
    vi.mocked(copyToClipboard).mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('waits 500ms before revealing genuinely clipped text and restores it on pointer leave', () => {
    vi.useFakeTimers()
    renderLayer(
      <>
        <span
          data-testid="clipped"
          style={{
            display: 'block',
            width: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Director of Graduate Research and Admissions
        </span>
        <span
          data-testid="complete"
          style={{
            display: 'block',
            width: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
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
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()

    fireEvent.pointerOver(clipped, { pointerType: 'mouse' })
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()
    act(() => vi.advanceTimersByTime(499))
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()
    fireEvent.pointerOut(clipped, { pointerType: 'mouse', relatedTarget: document.body })
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('.global-overflow-reveal')).toBeNull()

    fireEvent.pointerOver(clipped, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(500))
    act(() => vi.advanceTimersByTime(16))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Director of Graduate Research and Admissions',
    )
    expect(clipped).toHaveAttribute('data-overflow-reveal-active', 'true')

    fireEvent.pointerOut(clipped, { pointerType: 'mouse', relatedTarget: document.body })
    expect(document.querySelector('.global-overflow-reveal')).not.toHaveClass('is-open')
    expect(clipped).not.toHaveAttribute('data-overflow-reveal-active')
  })

  it('copies the complete value on double-click and shows localized confirmation', async () => {
    renderLayer(
      <strong
        data-testid="copy-target"
        data-overflow-copy-value="Professor of Human-Centred Computing"
        style={{
          display: 'block',
          width: 72,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        Professor of Human-Centred Computing
      </strong>,
    )

    const target = screen.getByTestId('copy-target')
    setElementBox(target, { clientWidth: 72, scrollWidth: 240 })
    fireEvent.doubleClick(target)

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('Professor of Human-Centred Computing')
      expect(screen.getByRole('status')).toHaveTextContent('Copied!')
    })
  })

  it('preserves a clipped control single-click but suppresses its action during a double-click copy', async () => {
    const onClick = vi.fn()
    renderLayer(
      <button type="button" onClick={onClick}>
        <span
          data-testid="button-label"
          style={{
            display: 'block',
            width: 64,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Open the complete application record
        </span>
      </button>,
    )

    const label = screen.getByTestId('button-label')
    setElementBox(label, { clientWidth: 64, scrollWidth: 220 })

    fireEvent.click(label, { button: 0, detail: 1 })
    expect(onClick).not.toHaveBeenCalled()
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))
    onClick.mockClear()

    fireEvent.click(label, { button: 0, detail: 1 })
    fireEvent.click(label, { button: 0, detail: 2 })
    fireEvent.doubleClick(label, { button: 0, detail: 2 })

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('Open the complete application record')
    })
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.pointerDown(label, { pointerType: 'touch' })
    fireEvent.click(label, { button: 0, detail: 1 })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('supports multi-line clamping while excluding editable and explicitly managed content', () => {
    renderLayer(
      <>
        <p
          data-testid="clamped"
          style={{
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitLineClamp: 2,
          }}
        >
          A long multi-line research summary that continues beyond the two visible lines.
        </p>
        <input
          data-testid="editable"
          value="Long editable value"
          readOnly
          style={{
            width: 60,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        />
        <span
          data-testid="managed"
          data-overflow-reveal="off"
          style={{
            display: 'block',
            width: 60,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Managed elsewhere
        </span>
      </>,
    )

    const clamped = screen.getByTestId('clamped')
    const editable = screen.getByTestId('editable')
    const managed = screen.getByTestId('managed')
    setElementBox(clamped, {
      clientWidth: 160,
      scrollWidth: 160,
      clientHeight: 36,
      scrollHeight: 72,
    })
    setElementBox(editable, { clientWidth: 60, scrollWidth: 160 })
    setElementBox(managed, { clientWidth: 60, scrollWidth: 160 })

    expect(isElementVisuallyTruncated(clamped)).toBe(true)
    expect(isElementVisuallyTruncated(editable)).toBe(false)
    expect(isElementVisuallyTruncated(managed)).toBe(false)
  })
})
