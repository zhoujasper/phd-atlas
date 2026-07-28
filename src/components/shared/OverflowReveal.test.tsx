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

function renderReveal() {
  return render(
    <I18nContext.Provider value={i18nContext}>
      <OverflowReveal text="Director of Graduate Research and Admissions" />
    </I18nContext.Provider>,
  )
}

describe('OverflowReveal hover timing', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens after a 500ms mouse dwell and cancels cleanly on leave', () => {
    vi.useFakeTimers()
    renderReveal()
    const target = screen.getByText('Director of Graduate Research and Admissions')

    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(499))
    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()
    fireEvent.mouseLeave(target)
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('.overflow-reveal-portal')).toBeNull()

    fireEvent.mouseEnter(target)
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Director of Graduate Research and Admissions')

    fireEvent.mouseLeave(target)
    expect(document.querySelector('.overflow-reveal-portal')).not.toHaveClass('is-open')
  })

  it('keeps keyboard focus disclosure immediate', () => {
    renderReveal()
    const target = screen.getByText('Director of Graduate Research and Admissions')

    fireEvent.focus(target)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Director of Graduate Research and Admissions')
  })
})
