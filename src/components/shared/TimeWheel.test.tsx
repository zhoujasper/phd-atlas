import '@testing-library/jest-dom/vitest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { I18nContext } from '../hooks/useI18n'
import englishShared from '../../i18n/en/shared.json'
import { getDict, registerLanguage, t as translate, tpl } from '../../i18n'
import { TimeWheel } from './TimeWheel'

beforeAll(() => {
  registerLanguage('en', { shared: englishShared })
})

function renderWheel(value = '13:11', onChange = vi.fn()) {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <TimeWheel value={value} onChange={onChange} />
    </I18nContext.Provider>,
  )
}

describe('TimeWheel', () => {
  it('repeats each column so 59 rolls into 00 in both directions', () => {
    renderWheel()

    const hours = screen.getByRole('listbox', { name: /hour/i })
    const minutes = screen.getByRole('listbox', { name: /minute/i })

    // 5 copies of the value list: the wheel always has runway on both sides.
    expect(within(hours).getAllByText('00')).toHaveLength(5)
    expect(within(hours).getAllByText('23')).toHaveLength(5)
    expect(within(minutes).getAllByText('00')).toHaveLength(5)
    expect(within(minutes).getAllByText('59')).toHaveLength(5)
  })

  it('exposes exactly one announced option per value', () => {
    renderWheel()

    const hours = screen.getByRole('listbox', { name: /hour/i })
    // The outer copies are visual runway and stay out of the accessibility tree.
    expect(within(hours).getAllByRole('option')).toHaveLength(24)
  })

  it('marks the selected value in every visible copy', () => {
    renderWheel('13:11')

    const hours = screen.getByRole('listbox', { name: /hour/i })
    const selected = Array.from(hours.querySelectorAll('.time-wheel-option.selected'))
    expect(selected).toHaveLength(5)
    expect(selected.every((option) => option.textContent === '13')).toBe(true)
  })
})
