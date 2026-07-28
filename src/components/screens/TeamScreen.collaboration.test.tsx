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
      teacherGroups: [{
        id: 'group-writing',
        name: 'Writing & Research',
        memberIds: ['member-mei'],
        createdBy: 'owner-1',
        createdAt: NOW,
        updatedAt: NOW,
      }],
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

function renderMembers(
  onChanged?: () => void | Promise<void>,
  onImpersonateMember?: (userId: string) => void,
) {
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
        onImpersonateMember={onImpersonateMember}
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
    vi.spyOn(phdApi, 'listTeamMemberProfileAssets').mockResolvedValue([])
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
    expect(updateAccess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

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
    expect(teamStyles).toContain('--anchored-popover-enter-duration: 190ms')
    expect(teamStyles).toContain('--anchored-popover-exit-duration: 150ms')
    expect(teamStyles).toContain('grid-template-columns: 1fr;')
  })

  it('keeps contextual tools beside the mode switch and uses compact animated teacher controls', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    vi.spyOn(phdApi, 'listTeamMemberProfileAssets').mockResolvedValue([])
    const onImpersonateMember = vi.fn()
    const { container } = renderMembers(undefined, onImpersonateMember)

    const commandRow = container.querySelector('.team-collaboration-command-row')
    expect(commandRow).not.toBeNull()
    expect(commandRow?.firstElementChild).toHaveClass('team-collaboration-mode-switch')
    expect(commandRow?.lastElementChild).toHaveClass('team-collaboration-top-tools')

    fireEvent.click(screen.getByRole('button', { name: /Teacher groups/i }))
    await waitFor(() => {
      expect(container.querySelector('.team-teacher-group-layout')).toBeInTheDocument()
    })

    const accountActions = screen.getAllByRole('button', { name: 'Enter member view' })
    const mapActions = screen.getAllByRole('button', { name: 'View relationship map' })
    expect(accountActions).toHaveLength(2)
    expect(mapActions).toHaveLength(2)
    expect(accountActions[0]).toHaveClass('team-teacher-directory-shortcut', 'is-account')
    expect(mapActions[0]).toHaveClass('team-teacher-directory-shortcut')
    fireEvent.click(accountActions[0]!)
    expect(onImpersonateMember).toHaveBeenCalledWith('teacher-mei')

    fireEvent.click(screen.getByRole('button', { name: /Writing & Research/i }))
    expect(container.querySelector('[data-teacher-group-stage="group-writing"]')).toBeInTheDocument()
    expect(container.querySelector('.team-teacher-group-nav-indicator')).toHaveClass('is-ready')

    expect(teamStyles).toContain('grid-template-columns: minmax(340px, 440px) minmax(0, 1fr)')
    expect(teamStyles).toContain('team-collaboration-local-exit-forward 90ms')
    expect(teamStyles).toContain('team-collaboration-local-enter-forward 190ms')
    expect(teamStyles).toContain('.team-teacher-group-nav-indicator.is-moving')
    expect(teamStyles).toContain('grid-template-columns: 38px minmax(180px, 1fr) 152px 168px auto')
    expect(teamStyles).toContain('min-width: 68px;')
  })

  it('lets a manager grant or restrict Team Pro for an assigned student', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const updateAccess = vi.spyOn(phdApi, 'updateTeamMemberAccess')
      .mockResolvedValue({
        ...fixture().summary.members[3]!,
        relationships: { teacherIds: ['teacher-mei'], accessLevel: 'standard' },
      })
    const onChanged = vi.fn().mockResolvedValue(undefined)
    renderMembers(onChanged)

    fireEvent.click(screen.getByText('Lina Zhao').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }))

    await waitFor(() => {
      expect(updateAccess).toHaveBeenCalledWith(
        'owner-token',
        'team-1',
        'member-lina',
        { accessLevel: 'standard' },
      )
    })
    expect(onChanged).toHaveBeenCalled()
  })
})
