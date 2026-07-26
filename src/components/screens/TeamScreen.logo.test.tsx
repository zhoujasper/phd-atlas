import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession, TeamSummary } from '../../api/phdApi'
import { phdApi } from '../../api/phdApi'
import { getDict, t, tpl } from '../../i18n'
import teamStyles from '../../styles/team.css?raw'
import { I18nContext } from '../hooks/useI18n'
import { TeamScreen } from './TeamScreen'
import { TEAM_LOGO_ACCEPT } from './teamLogo'

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function fixture(role: 'owner' | 'admin') {
  const owner = {
    id: 'member-owner',
    teamId: 'team-1',
    userId: 'owner-1',
    displayName: 'Owner',
    invitedEmail: 'owner@example.com',
    role: 'owner' as const,
    status: 'active' as const,
    invitedBy: 'owner-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const teacher = {
    ...owner,
    id: 'member-teacher',
    userId: 'teacher-1',
    displayName: 'Teacher',
    invitedEmail: 'teacher@example.com',
    role: 'admin' as const,
  }
  const session = {
    token: `${role}-token`,
    user: {
      id: role === 'owner' ? 'owner-1' : 'teacher-1',
      name: role === 'owner' ? 'Owner' : 'Teacher',
      email: role === 'owner' ? 'owner@example.com' : 'teacher@example.com',
      role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
      settings: {
        contentLanguagePrimary: 'en',
        contentLanguageSecondary: 'zh',
      },
    },
    settings: {},
  } as unknown as AuthSession
  const summary = {
    team: {
      id: 'team-1',
      name: 'Atlas Lab',
      ownerId: 'owner-1',
      seatLimit: 105,
      logoDataUrl: LOGO,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    membership: role === 'owner' ? owner : teacher,
    members: [owner, teacher],
    roleCounts: { owner: 1, admin: 1, member: 0 },
    memberStats: {},
    recentEvents: [],
    transferRequests: [],
  } satisfies TeamSummary
  return { session, summary }
}

function renderTeam(role: 'owner' | 'admin') {
  const { session, summary } = fixture(role)
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <TeamScreen
        session={session}
        initialSummary={summary}
        applications={[]}
        activeSection="overview"
        hideTabs
      />
    </I18nContext.Provider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen organization logo', () => {
  it('lets only the institution administrator open the supported-image picker', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const ownerView = renderTeam('owner')

    const action = await screen.findByRole('button', { name: 'Upload organization logo' })
    expect(action.querySelector('img')).toHaveAttribute('src', LOGO)
    expect(ownerView.container.querySelector('input[type="file"]')).toHaveAttribute('accept', TEAM_LOGO_ACCEPT)

    ownerView.unmount()
    renderTeam('admin')
    expect(screen.queryByRole('button', { name: 'Upload organization logo' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Atlas Lab' }).closest('.team-hero-main')?.querySelector('.team-hero-icon img'))
      .toHaveAttribute('src', LOGO)
  })

  it('constrains the rendered logo with contain sizing instead of square cropping', () => {
    const logoRule = teamStyles.match(/\.team-hero-icon\.has-logo img\s*\{[^}]+\}/s)?.[0] ?? ''
    expect(logoRule).toContain('object-fit: contain')
    expect(logoRule).toContain('max-width: 82px')
    expect(logoRule).toContain('max-height: 30px')
  })
})
