import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthSession,
  TeamApplicationRecord,
  TeamMember,
  TeamSummary,
} from '../../api/phdApi'
import { phdApi } from '../../api/phdApi'
import { applications as applicationFixtures } from '../../data/applications'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { TeamScreen } from './TeamScreen'

const NOW = '2026-07-23T10:00:00.000Z'

function teamMember(
  input: Partial<TeamMember> & Pick<TeamMember, 'id' | 'userId' | 'displayName' | 'invitedEmail' | 'role'>,
): TeamMember {
  return {
    teamId: 'team-1',
    status: 'active',
    invitedBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  }
}

const owner = teamMember({
  id: 'member-owner',
  userId: 'owner-1',
  displayName: 'Jasper',
  invitedEmail: 'jasper@example.com',
  role: 'owner',
})

const teacher = teamMember({
  id: 'member-teacher',
  userId: 'teacher-1',
  displayName: 'Dr. Mei Chen',
  invitedEmail: 'mei@example.com',
  role: 'admin',
})

const lina = teamMember({
  id: 'member-lina',
  userId: 'student-lina',
  displayName: 'Lina Zhao',
  invitedEmail: 'lina@example.com',
  role: 'member',
  relationships: { teacherIds: ['teacher-1'] },
})

const alex = teamMember({
  id: 'member-alex',
  userId: 'student-alex',
  displayName: 'Alex Kim',
  invitedEmail: 'alex@example.com',
  role: 'member',
  relationships: { teacherIds: ['teacher-1'] },
})

const pendingInvite = teamMember({
  id: 'member-pending',
  userId: null,
  displayName: 'Pending Student',
  invitedEmail: 'pending@example.com',
  role: 'member',
  status: 'pending',
})

const riskyApplication = {
  ...applicationFixtures[0],
  id: 'team-risk-app',
  teamId: 'team-1',
  ownerId: 'student-lina',
  ownerName: 'Lina Zhao',
  ownerEmail: 'lina@example.com',
  progress: 24,
  status: 'Preparing',
  school: {
    ...applicationFixtures[0]!.school,
    name: 'Northbridge University',
  },
} as TeamApplicationRecord

function session(userId: string, name: string, email: string): AuthSession {
  return {
    token: `${userId}-token`,
    user: {
      id: userId,
      name,
      email,
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

function summary(membership: TeamMember): TeamSummary {
  return {
    team: {
      id: 'team-1',
      name: 'Atlas Lab',
      ownerId: 'owner-1',
      seatLimit: 6,
      createdAt: NOW,
      updatedAt: NOW,
    },
    membership,
    members: [owner, teacher, lina, alex, pendingInvite],
    capacity: membership.role === 'owner'
      ? {
          storageUsedBytes: 900,
          storageQuotaBytes: 1_000,
          teacherSeatsUsed: 1,
          teacherSeatLimit: 2,
          studentSeatsUsed: 2,
          studentSeatLimit: 4,
          activeShareCount: 2,
          activeShareLimit: 20,
          shareCreateQuota: null,
        }
      : undefined,
    memberStats: {
      [lina.id]: {
        memberId: lina.id,
        userId: lina.userId,
        applicationCount: 1,
        riskCount: 1,
        watchCount: 0,
        dueSoonCount: 0,
        activeShareCount: 0,
        storageUsedBytes: 0,
        storageQuotaBytes: null,
        reviewCommentCount: 0,
        lastActivityAt: NOW,
      },
    },
    recentEvents: [],
    transferRequests: membership.role === 'owner'
      ? [{
          id: 'transfer-1',
          teamId: 'team-1',
          direction: 'join',
          requestedAt: NOW,
          requestedBy: 'student-lina',
          applicationId: riskyApplication.id,
          applicationName: 'Northbridge PhD application',
          program: riskyApplication.program,
          ownerId: 'student-lina',
          ownerName: 'Lina Zhao',
          ownerEmail: 'lina@example.com',
          preflight: {
            direction: 'join',
            teamId: 'team-1',
            teamName: 'Atlas Lab',
            eligible: true,
            checks: [],
          },
        }]
      : [],
  }
}

function renderOverview(membership: TeamMember, props: {
  onCreateApplication?: (ownerId?: string | null) => void
} = {}) {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <TeamScreen
        session={session(
          membership.userId!,
          membership.displayName ?? membership.invitedEmail ?? 'Student',
          membership.invitedEmail,
        )}
        initialSummary={summary(membership)}
        applications={[riskyApplication]}
        applicationCounts={{
          'student-lina': 1,
          'student-alex': 0,
        }}
        activeSection="overview"
        hideTabs
        onCreateApplication={props.onCreateApplication}
      />
    </I18nContext.Provider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen role-aware overview', () => {
  it('keeps the owner overview focused on one selected action and discloses secondary lists', () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const view = renderOverview(owner)

    expect(screen.getByRole('heading', { name: 'Handle the items that actually need action first' })).toBeInTheDocument()
    expect(view.container.querySelector('.team-overview-queue-slider')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Northbridge University' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /1 transfer approvals/i }))
    expect(screen.getByRole('heading', { name: 'Northbridge PhD application' })).toBeInTheDocument()

    const more = screen.getByRole('button', { name: 'Show more overview' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Priority queue' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Students without applications' })).toBeInTheDocument()
  })

  it('lets teachers switch the selected student and reveal the inline create flow', () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const onCreateApplication = vi.fn()
    const view = renderOverview(teacher, { onCreateApplication })

    expect(screen.getByRole('heading', { name: 'Sorted by what needs action' })).toBeInTheDocument()
    expect(view.container.querySelector('.team-overview-queue-slider')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Lina Zhao/i }))
    expect(screen.getByRole('heading', { name: 'Lina Zhao' })).toBeInTheDocument()
    expect(screen.getByText('24%')).toBeInTheDocument()

    const createToggle = screen.getByRole('button', { name: 'Create for student' })
    expect(createToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(createToggle)
    expect(createToggle).toHaveAttribute('aria-expanded', 'true')
    expect(view.container.querySelector('.team-overview-create-inner')).toBeInTheDocument()
  })
})
