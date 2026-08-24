import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import { DesktopUnlockScreen } from './DesktopUnlockScreen'
import enSettings from '../../i18n/en/settings.json'
import enShared from '../../i18n/en/shared.json'

function tx(key: string, fallback?: string) {
  const table = { ...enShared, ...enSettings.settings } as unknown as Record<string, string>
  const short = key.startsWith('settings.') ? key.slice('settings.'.length) : key
  return table[short] ?? table[key] ?? fallback ?? key
}

describe('desktop opening unlock screen', () => {
  it('asks for the opening password and has no forgot-password action', async () => {
    const onUnlock = vi.fn()
    render(
      <I18nContext.Provider value={{ lang: 'en', t: {}, ready: true, tx, format: (value: string) => value }}>
        <DesktopUnlockScreen onUnlock={onUnlock} />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('heading', { name: 'Enter your opening password' })).toBeInTheDocument()
    expect(screen.getByText(/no way to recover a forgotten password/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /forgot/i })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Opening password'), 'lock-4321')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(onUnlock).toHaveBeenCalledWith('lock-4321')
  })
})
