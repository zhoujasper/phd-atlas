import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession, TeamMember, TeamSummary } from '../../api/phdApi'
import { phdApi } from '../../api/phdApi'
import { getDict, t, tpl } from '../../i18n'
import teamStyles from '../../styles/team.css?raw'
import { I18nContext } from '../hooks/useI18n'
import { TeamScreen } from './TeamScreen'

const NOW = '2026-07-23T10:00:00.000Z'

function member(input: Partial<TeamMember> & Pick<TeamMember, 'id' | 'userId' | 'displayName' | 'invitedEmail' | 'role'>): TeamMember {
  return {
    teamId: 'team-1',
    status: 'active',
    invitedBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  }
}

function fixture() {
  const owner = member({
    id: 'member-owner',
    userId: 'owner-1',
    displayName: 'Jasper',
    invitedEmail: 'jasper@example.com',
    role: 'owner',
  })
  const mei = member({
    id: 'member-mei',
    userId: 'teacher-mei',
    displayName: 'Dr. Mei Chen',
    invitedEmail: 'mei@example.com',
    role: 'admin',
  })
  const alex = member({
    id: 'member-alex',
    userId: 'teacher-alex',
    displayName: 'Prof. Alex Rivera',
    invitedEmail: 'alex@example.com',
    role: 'admin',
  })
  const student = member({
    id: 'member-lina',
    userId: 'student-lina',
    displayName: 'Lina Zhao',
    invitedEmail: 'student.lina@example.com',
    role: 'member',
    relationships: { teacherIds: ['teacher-mei'] },
  })
  const session = {
    token: 'owner-token',
    user: {
      id: 'owner-1',
      name: 'Jasper',
      email: 'jasper@example.com',
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
  const summary = {
    team: {
      id: 'team-1',
      name: 'Atlas Lab',
      ownerId: 'owner-1',
      seatLimit: 105,
      createdAt: NOW,
      updatedAt: NOW,
    },
    membership: owner,
    members: [owner, mei, alex, student],
    roleCounts: { owner: 1, admin: 2, member: 1 },
    memberStats: {
      [student.id]: {
        applicationCount: 2,
        riskCount: 1,
        watchCount: 0,
        reviewCommentCount: 3,
      },
    },
    recentEvents: [],
    transferRequests: [],
  } as unknown as TeamSummary
  return { session, summary }
}

function renderMembers(onChanged?: () => void | Promise<void>) {
  const { session, summary } = fixture()
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
        activeSection="members"
        hideTabs
        onChanged={onChanged}
      />
    </I18nContext.Provider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen collaboration teacher picker', () => {
  it('opens a multi-select popover and searches teachers by name or email', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const updateAccess = vi.spyOn(phdApi, 'updateTeamMemberAccess')
      .mockResolvedValue(fixture().summary.members[3]!)
    const onChanged = vi.fn().mockResolvedValue(undefined)
    renderMembers(onChanged)

    const studentRow = screen.getByText('Lina Zhao').closest('button')
    expect(studentRow).not.toBeNull()
    fireEvent.click(studentRow!)

    const picker = screen.getByRole('button', { name: /Quick teacher assignment: 1 teacher/i })
    fireEvent.click(picker)

    const dialog = await screen.findByRole('dialog', { name: 'Quick teacher assignment' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Dr\. Mei Chen/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /Prof\. Alex Rivera/i })).toHaveAttribute('aria-selected', 'false')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'alex@example.com' },
    })

    expect(screen.queryByRole('option', { name: /Dr\. Mei Chen/i })).not.toBeInTheDocument()
    const alex = screen.getByRole('option', { name: /Prof\. Alex Rivera/i })
    expect(alex).toBeInTheDocument()

    fireEvent.click(alex)

    await waitFor(() => {
      expect(updateAccess).toHaveBeenCalledWith(
        'owner-token',
        'team-1',
        'member-lina',
        { teacherIds: ['member-mei', 'member-alex'] },
      )
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('uses a continuous summary band and responsive searchable picker styles', () => {
    expect(teamStyles).toContain('.team-member-access-summary.is-collaboration-summary')
    expect(teamStyles).toContain('.team-teacher-picker-search')
    expect(teamStyles).toContain('.team-teacher-picker-popover-shell')
    expect(teamStyles).toContain('grid-template-columns: 1fr;')
  })
})
