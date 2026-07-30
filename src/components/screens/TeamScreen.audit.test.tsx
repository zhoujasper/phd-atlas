import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession, TeamMember, TeamSummary } from '../../api/phdApi'
import { phdApi } from '../../api/phdApi'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { TeamScreen } from './TeamScreen'

const NOW = '2026-07-29T10:00:00.000Z'

function member(
  role: 'owner' | 'admin',
  userId: string,
  name: string,
): TeamMember {
  return {
    id: `member-${userId}`,
    teamId: 'team-1',
    userId,
    displayName: name,
    invitedEmail: `${userId}@example.com`,
    role,
    status: 'active',
    invitedBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const owner = member('owner', 'owner-1', 'Owner')
const teacher = member('admin', 'teacher-1', 'Teacher')

function sessionFor(teamMember: TeamMember): AuthSession {
  const userId = teamMember.userId as string
  const name = teamMember.displayName || teamMember.invitedEmail
  return {
    token: `${userId}-token`,
    user: {
      id: userId,
      name,
      email: teamMember.invitedEmail,
      role: 'user',
      createdAt: NOW,
      lastLoginAt: null,
      settings: {
        contentLanguagePrimary: 'en',
        contentLanguageSecondary: 'zh',
      },
    },
    settings: {},
  } as unknown as AuthSession
}

function summaryFor(membership: TeamMember): TeamSummary {
  return {
    team: {
      id: 'team-1',
      name: 'Atlas Lab',
      ownerId: owner.userId!,
      seatLimit: 10,
      createdAt: NOW,
      updatedAt: NOW,
    },
    membership,
    members: [owner, teacher],
    capacity: membership.role === 'owner'
      ? {
          storageUsedBytes: 0,
          storageQuotaBytes: 1024,
          teacherSeatsUsed: 1,
          teacherSeatLimit: 5,
          studentSeatsUsed: 0,
          studentSeatLimit: 5,
          activeShareCount: 0,
          activeShareLimit: 100,
          shareCreateQuota: null,
        }
      : undefined,
    recentEvents: [],
    transferRequests: [],
  }
}

function renderAudit(membership: TeamMember, onSectionChange = vi.fn()) {
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
          session={sessionFor(membership)}
          initialSummary={summaryFor(membership)}
          applications={[]}
          aiKeys={[]}
          activeSection="audit"
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

describe('TeamScreen automatic coordination boundary', () => {
  it('keeps only the owner transfer queue and removes manual version controls', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const view = renderAudit(owner)

    expect(await screen.findByRole('heading', { name: '0 transfer requests' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No transfer requests' })).toBeInTheDocument()
    expect(screen.queryByText('Student version spaces')).not.toBeInTheDocument()
    expect(screen.queryByText('Version, restore, and merge controls')).not.toBeInTheDocument()
    expect(view.container.querySelector('.team-activity-grid')).not.toBeInTheDocument()
  })

  it('redirects teachers away from the owner-only Audit route', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const onSectionChange = vi.fn()
    renderAudit(teacher, onSectionChange)

    await waitFor(() => expect(onSectionChange).toHaveBeenCalledWith('overview'))
    expect(screen.queryByRole('heading', { name: /transfer requests/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Student version spaces')).not.toBeInTheDocument()
  })
})
