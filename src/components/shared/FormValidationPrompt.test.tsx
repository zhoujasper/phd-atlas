import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { getDict, t, tpl, type Language } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { FormValidationPrompt } from './FormValidationPrompt'

function renderWithI18n(ui: ReactNode, lang: Language = 'en') {
  return render(
    <I18nContext.Provider
      value={{
        lang,
        t: getDict(lang),
        format: tpl,
        tx: (path: string, fallback?: string) => t(lang, path, fallback),
      }}
    >
      {ui}
    </I18nContext.Provider>,
  )
}

describe('FormValidationPrompt', () => {
  afterEach(() => {
    cleanup()
  })

  it('replaces the native email validation bubble with the Atlas prompt', async () => {
    renderWithI18n(
      <>
        <FormValidationPrompt />
        <label>
          <span>Professor email *</span>
          <input required type="email" defaultValue="123" />
        </label>
      </>,
    )

    const input = screen.getByLabelText(/^Professor email \*$/)
    const invalidEvent = new Event('invalid', { bubbles: false, cancelable: true })
    input.dispatchEvent(invalidEvent)

    expect(invalidEvent.defaultPrevented).toBe(true)
    expect(await screen.findByRole('alert')).toHaveTextContent('Professor email needs a valid email address.')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('uses Chinese validation copy and clears the prompt when the field becomes valid', async () => {
    renderWithI18n(
      <>
        <FormValidationPrompt />
        <label>
          <span>邮箱 *</span>
          <input required type="email" defaultValue="123" />
        </label>
      </>,
      'zh',
    )

    const input = screen.getByLabelText(/^邮箱 \*$/)
    input.dispatchEvent(new Event('invalid', { bubbles: false, cancelable: true }))

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱需要使用有效邮箱格式。')

    fireEvent.input(input, { target: { value: 'jasper@example.com' } })

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(input).not.toHaveAttribute('aria-invalid')
  })
})
