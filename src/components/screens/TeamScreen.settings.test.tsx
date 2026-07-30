import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession, TeamSummary } from '../../api/phdApi'
import { phdApi } from '../../api/phdApi'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { TeamScreen } from './TeamScreen'

const ownerSession = {
  token: 'owner-token',
  user: {
    id: 'owner-1',
    name: 'Owner',
    email: 'owner@example.com',
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

function summaryFor(role: 'owner' | 'admin'): TeamSummary {
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

  return {
    team: {
      id: 'team-1',
      name: 'Atlas Lab',
      ownerId: 'owner-1',
      seatLimit: 105,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    membership: role === 'owner' ? owner : teacher,
    members: [owner, teacher],
    capacity: role === 'owner' ? {
      storageUsedBytes: 0,
      storageQuotaBytes: 1024 * 1024 * 1024,
      teacherSeatsUsed: 1,
      teacherSeatLimit: 5,
      studentSeatsUsed: 0,
      studentSeatLimit: 100,
      activeShareCount: 0,
      activeShareLimit: 10_000,
      shareCreateQuota: null,
    } : undefined,
    recentEvents: [],
    transferRequests: [],
  }
}

function renderSettings(session: AuthSession, summary: TeamSummary, onSectionChange = vi.fn()) {
  return {
    onSectionChange,
    ...render(
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
          aiKeys={[]}
          activeSection="settings"
          hideTabs
          onSectionChange={onSectionChange}
        />
      </I18nContext.Provider>,
    ),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen organization settings access', () => {
  it('shows owners the organization identity, permission summary, quotas, and shared key sections', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const view = renderSettings(ownerSession, summaryFor('owner'))

    expect(await screen.findByRole('heading', { name: 'Organization settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Organization name' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Member permissions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Organization quotas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shared organization keys' })).toBeInTheDocument()
    expect(screen.getByText(/Configure how Atlas Lab separates roles/)).toBeInTheDocument()
    expect(view.container).not.toHaveTextContent('{team}')
    expect(view.container.querySelectorAll('.team-organization-settings-section')).toHaveLength(4)
    expect(view.container.querySelector('.team-role-labels-panel')).not.toBeInTheDocument()
    expect(view.container.querySelector('.team-permission-matrix')).not.toBeInTheDocument()
    expect(view.container.querySelector('.team-profile-preset-settings')).not.toBeInTheDocument()
  })

  it('edits compact role defaults optimistically while saving only the changed role field', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const initial = summaryFor('owner')
    const updateDefaults = vi.spyOn(phdApi, 'updateTeamPermissionDefaults').mockResolvedValue({
      ...initial.team,
      permissionDefaults: {
        student: {
          editApplications: true,
          createApplications: true,
          useDiscover: true,
          createShareLinks: true,
          requestTeamTransfers: true,
          activeApplicationLimit: null,
          lifetimeApplicationLimit: null,
          activeShareLimit: null,
          lifetimeShareLimit: null,
        },
        teacher: {
          inviteStudents: true,
          manageStudentPermissions: true,
          useDiscover: true,
          createStudentApplications: true,
          editStudentApplications: true,
          manageStudentShares: true,
        },
      },
    })
    renderSettings(ownerSession, initial)

    expect(await screen.findByText('Student default')).toBeInTheDocument()
    expect(screen.getByText('Teacher default')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Student default/i }))
    const [studentDiscover] = screen.getAllByRole('switch', { name: 'Use Discover' })
    expect(studentDiscover).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(studentDiscover)
    expect(studentDiscover).toHaveAttribute('aria-checked', 'true')

    await waitFor(() => {
      expect(updateDefaults).toHaveBeenCalledWith(
        'owner-token',
        'team-1',
        { student: { useDiscover: true } },
      )
    })
  })

  it('redirects teachers away from the owner-only settings section', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const teacherSession = {
      ...ownerSession,
      token: 'teacher-token',
      user: {
        ...ownerSession.user,
        id: 'teacher-1',
        name: 'Teacher',
        email: 'teacher@example.com',
      },
    }
    const onSectionChange = vi.fn()
    renderSettings(teacherSession, summaryFor('admin'), onSectionChange)

    await waitFor(() => expect(onSectionChange).toHaveBeenCalledWith('overview'))
    expect(screen.queryByRole('heading', { name: 'Organization settings' })).not.toBeInTheDocument()
  })
})
