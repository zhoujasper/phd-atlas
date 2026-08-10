import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import { DatePicker } from './DatePicker'

const copy: Record<string, string> = {
  'datePicker.placeholder': 'Select date…',
  'datePicker.toggle': 'Toggle calendar',
  'datePicker.previousMonth': 'Previous month',
  'datePicker.nextMonth': 'Next month',
  'datePicker.previousYears': 'Previous 12 years',
  'datePicker.nextYears': 'Next 12 years',
  'datePicker.today': 'Today',
  'datePicker.clear': 'Clear',
  'timePicker.placeholder': '--:--',
  'timePicker.toggle': 'Choose time',
  'timePicker.hour': 'Hour',
  'timePicker.minute': 'Minute',
  'timePicker.now': 'Now',
  'timePicker.clear': 'Clear',
}

function renderPicker(props: Partial<Parameters<typeof DatePicker>[0]> = {}) {
  const onChange = vi.fn()
  const onTimeChange = vi.fn()
  render(
    <I18nContext.Provider
      value={{
        lang: 'en',
        t: {},
        tx: (path) => copy[path] ?? path,
        format: (template) => template,
      }}
    >
      <DatePicker
        value=""
        onChange={onChange}
        placeholder="Deadline"
        timeValue=""
        onTimeChange={onTimeChange}
        {...props}
      />
    </I18nContext.Provider>,
  )
  return { onChange, onTimeChange }
}

describe('DatePicker time footer', () => {
  it('keeps a time-enabled calendar open after selecting a date and commits its lower-right time field', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 1, 9, 0))
    try {
      const { onChange, onTimeChange } = renderPicker()
      const trigger = screen.getByRole('textbox', { name: 'Deadline' })

      fireEvent.mouseDown(trigger)
      const day = screen.getByRole('button', { name: 'August 12' })
      fireEvent.click(day)

      expect(onChange).toHaveBeenCalledWith('2026-08-12')
      expect(trigger).toHaveAttribute('aria-expanded', 'true')

      const time = screen.getByRole('textbox', { name: 'Choose time' })
      fireEvent.change(time, { target: { value: '1745' } })
      fireEvent.blur(time)

      expect(onTimeChange).toHaveBeenLastCalledWith('17:45')
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens a two-column wheel from the time field and keeps both selections in the same draft', () => {
    const { onTimeChange } = renderPicker({ timeValue: '08:15' })
    const trigger = screen.getByRole('textbox', { name: 'Deadline' })

    fireEvent.mouseDown(trigger)
    const time = screen.getByRole('textbox', { name: 'Choose time' })
    fireEvent.focus(time)

    expect(screen.getByRole('dialog', { name: 'Choose time' })).toBeInTheDocument()
    const hourWheel = screen.getByRole('listbox', { name: 'Hour' })
    const minuteWheel = screen.getByRole('listbox', { name: 'Minute' })

    fireEvent.click(within(hourWheel).getByRole('option', { name: '17' }))
    expect(onTimeChange).toHaveBeenLastCalledWith('17:15')
    fireEvent.click(within(minuteWheel).getByRole('option', { name: '45' }))
    expect(onTimeChange).toHaveBeenLastCalledWith('17:45')
    expect(screen.getByRole('dialog', { name: 'Choose time' })).toBeInTheDocument()
  })
})
