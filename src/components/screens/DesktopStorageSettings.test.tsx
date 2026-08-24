import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import { DesktopStorageSettings } from './DesktopStorageSettings'
import enSettings from '../../i18n/en/settings.json'
import enShared from '../../i18n/en/shared.json'

function tx(key: string, fallback?: string) {
  const table = { ...enShared, ...enSettings.settings } as unknown as Record<string, string>
  const short = key.startsWith('settings.') ? key.slice('settings.'.length) : key
  return table[short] ?? table[key] ?? fallback ?? key
}

function renderDesktop(runtime: Parameters<typeof DesktopStorageSettings>[0]['runtime']) {
  return render(
    <I18nContext.Provider value={{ lang: 'en', t: {}, ready: true, tx, format: (value: string) => value }}>
      <DesktopStorageSettings
        runtime={runtime}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onCompleteExport={vi.fn()}
        onCompleteImport={vi.fn()}
      />
    </I18nContext.Provider>,
  )
}

describe('desktop storage settings', () => {
  it('shows connect fields while unlinked and omits share-related copy', () => {
    renderDesktop({
      enabled: true,
      mode: 'local',
      remoteOrigin: null,
      remoteEmail: null,
      shareEnabled: false,
      adminEnabled: false,
      teamEnabled: false,
      unlimited: true,
      linkedAt: null,
      unlockRequired: false,
      unlocked: true,
    })
    expect(screen.getByText('Local SQLite')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use local storage' })).not.toBeInTheDocument()
  })

  it('shows the connected origin after a web account is linked', () => {
    renderDesktop({
      enabled: true,
      mode: 'remote',
      remoteOrigin: 'https://phd.example.com',
      remoteEmail: 'user@example.com',
      shareEnabled: true,
      adminEnabled: false,
      teamEnabled: false,
      unlimited: false,
      linkedAt: '2026-08-22T00:00:00.000Z',
      unlockRequired: false,
      unlocked: true,
    })
    expect(screen.getByText('https://phd.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use local storage' })).toBeInTheDocument()
  })
})
