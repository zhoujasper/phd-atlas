import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { PrioritySlider } from './PrioritySlider'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template) => template,
  tx: (path, fallback) => fallback ?? path,
}

function PriorityHarness() {
  const [value, setValue] = useState(50)
  return (
    <label>
      <span>Priority</span>
      <PrioritySlider value={value} onChange={setValue} />
    </label>
  )
}

describe('PrioritySlider', () => {
  it('moves its shared indicator when a level is clicked', async () => {
    const user = userEvent.setup()
    render(
      <I18nContext.Provider value={i18nContext}>
        <PriorityHarness />
      </I18nContext.Provider>,
    )

    const indicator = document.querySelector<HTMLElement>('.priority-picker-indicator')
    expect(indicator).toHaveStyle({ '--priority-position': '2' })

    await user.click(screen.getByRole('radio', { name: 'settings.priorityHigh' }))

    expect(screen.getByRole('radio', { name: 'settings.priorityHigh' })).toHaveAttribute('aria-checked', 'true')
    expect(indicator).toHaveStyle({ '--priority-position': '3' })
  })

  it('tracks a pointer continuously and commits the snapped level on release', () => {
    render(
      <I18nContext.Provider value={i18nContext}>
        <PriorityHarness />
      </I18nContext.Provider>,
    )

    const picker = screen.getByRole('radiogroup')
    const indicator = document.querySelector<HTMLElement>('.priority-picker-indicator')
    Object.defineProperty(picker, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 250, top: 0, bottom: 32, width: 250, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
    })

    fireEvent.pointerDown(picker, { button: 0, clientX: 125, pointerId: 7 })
    fireEvent.pointerMove(window, { clientX: 211, pointerId: 7 })

    expect(indicator?.style.getPropertyValue('--priority-position')).not.toMatch(/^\d+$/)
    expect(picker).toHaveClass('dragging')

    fireEvent.pointerUp(window, { clientX: 211, pointerId: 7 })
    fireEvent.click(picker)

    expect(screen.getByRole('radio', { name: 'settings.priorityCritical' })).toHaveAttribute('aria-checked', 'true')
    expect(picker).not.toHaveClass('dragging')
  })
})
