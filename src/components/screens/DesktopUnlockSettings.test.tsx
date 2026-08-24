import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import { DesktopUnlockSettings } from './DesktopUnlockSettings'
import enSettings from '../../i18n/en/settings.json'
import enShared from '../../i18n/en/shared.json'

function tx(key: string, fallback?: string) {
  const table = { ...enShared, ...enSettings.settings } as unknown as Record<string, string>
  const short = key.startsWith('settings.') ? key.slice('settings.'.length) : key
  return table[short] ?? table[key] ?? fallback ?? key
}

const localRuntime = {
  enabled: true,
  mode: 'local' as const,
  remoteOrigin: null,
  remoteEmail: null,
  shareEnabled: false,
  adminEnabled: false,
  teamEnabled: false,
  unlimited: true,
  linkedAt: null,
  unlockRequired: false,
  unlocked: true,
}

describe('desktop opening password settings', () => {
  it('warns that a forgotten opening password cannot be recovered', async () => {
    const onSave = vi.fn()
    render(
      <I18nContext.Provider value={{ lang: 'en', t: {}, ready: true, tx, format: (value: string) => value }}>
        <DesktopUnlockSettings runtime={localRuntime} onSave={onSave} />
      </I18nContext.Provider>,
    )

    await userEvent.click(screen.getByRole('switch', { name: 'Require a password when opening' }))
    expect(screen.getByText(/no forgot-password recovery/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /forgot/i })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Opening password', { selector: 'input' }), 'lock-4321')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'lock-4321')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on password' }))
    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      password: 'lock-4321',
      confirmPassword: 'lock-4321',
      currentPassword: undefined,
    })
  })
})
