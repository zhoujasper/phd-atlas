import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl, type Language } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { Rail } from './Rail'

function renderRail(lang: Language, theme: 'light' | 'dark' = 'light') {
  return render(
    <I18nContext.Provider
      value={{
        lang,
        t: getDict(lang),
        format: tpl,
        tx: (path, fallback) => t(lang, path, fallback),
      }}
    >
      <Rail
        screen="dashboard"
        theme={theme}
        interfaceMode="personal"
        teamViewerRole={null}
        teamSection="overview"
        onScreen={vi.fn()}
        onTeamSection={vi.fn()}
        onModeChange={vi.fn()}
        onToggleTheme={vi.fn()}
        onLogout={vi.fn()}
      />
    </I18nContext.Provider>,
  )
}

describe('Rail i18n', () => {
  it('uses shared theme labels instead of raw settings keys', () => {
    renderRail('en', 'light')

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.queryByText(/settings\.light/i)).not.toBeInTheDocument()
  })

  it('localizes the global theme toggle in Chinese without loading the settings screen pack', () => {
    renderRail('zh', 'dark')

    expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument()
    expect(screen.queryByText(/settings\.dark/i)).not.toBeInTheDocument()
  })

  it('keeps the four-item personal layout for a student in team mode', () => {
    render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}>
        <Rail
          screen="team"
          theme="light"
          interfaceMode="team"
          teamViewerRole="member"
          teamSection="overview"
          onScreen={vi.fn()}
          onTeamSection={vi.fn()}
          onModeChange={vi.fn()}
          onToggleTheme={vi.fn()}
          onLogout={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const nav = screen.getByRole('navigation')
    expect(nav.querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps audit and settings as direct team destinations without a center menu', () => {
    render(
      <I18nContext.Provider value={{
        lang: 'zh',
        t: getDict('zh'),
        format: tpl,
        tx: (path, fallback) => t('zh', path, fallback),
      }}>
        <Rail
          screen="team"
          theme="light"
          interfaceMode="team"
          teamViewerRole="owner"
          teamSection="overview"
          onScreen={vi.fn()}
          onTeamSection={vi.fn()}
          onModeChange={vi.fn()}
          onToggleTheme={vi.fn()}
          onLogout={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const nav = screen.getByRole('navigation')
    expect(nav.querySelectorAll('button')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Audit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(document.querySelector('.rail-mobile-overflow-trigger')).not.toBeInTheDocument()
  })
})
