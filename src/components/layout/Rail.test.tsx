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

  it('keeps organization settings out of the student team rail', () => {
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
    expect(nav.querySelectorAll('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Audit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('keeps organization settings out of the teacher team rail', () => {
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
          teamViewerRole="admin"
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
    expect(nav.querySelectorAll('button')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Discover' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Audit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('hides personal Discover when the current personal plan is not eligible', () => {
    render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}>
        <Rail
          screen="dashboard"
          theme="light"
          interfaceMode="personal"
          teamViewerRole="member"
          teamSection="overview"
          canUseDiscover={false}
          onScreen={vi.fn()}
          onTeamSection={vi.fn()}
          onModeChange={vi.fn()}
          onToggleTheme={vi.fn()}
          onLogout={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    expect(screen.queryByRole('button', { name: 'Discover' })).not.toBeInTheDocument()
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
    expect(nav.querySelectorAll('button')).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Audit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(document.querySelector('.rail-mobile-overflow-trigger')).not.toBeInTheDocument()
  })

  it('keeps Team Discover selected while researching for a student', () => {
    render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}>
        <Rail
          screen="discover"
          theme="light"
          interfaceMode="team"
          teamViewerRole="owner"
          teamSection="discover"
          onScreen={vi.fn()}
          onTeamSection={vi.fn()}
          onModeChange={vi.fn()}
          onToggleTheme={vi.fn()}
          onLogout={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('button', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
  })
})
