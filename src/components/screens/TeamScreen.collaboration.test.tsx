import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void,
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
        onNotify={onNotify}
      />
    </I18nContext.Provider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen collaboration teacher picker', () => {
  it('defaults to the relationship map and opens a resizable permission inspector from a student', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    vi.spyOn(phdApi, 'listTeamMemberProfileAssets').mockResolvedValue([])
    const { container } = renderMembers()

    const viewSwitch = container.querySelector('.team-member-view-switch')
    expect(viewSwitch).not.toBeNull()
    const viewButtons = within(viewSwitch as HTMLElement).getAllByRole('button')
    expect(viewButtons.map((button) => button.textContent?.trim())).toEqual([
      'Map',
      'Collaboration list',
    ])
    expect(viewButtons[0]).toHaveAttribute('aria-selected', 'true')
    expect(viewButtons[1]).toHaveAttribute('aria-selected', 'false')

    const mapHelp = screen.getByRole('button', { name: 'Relationship map controls' })
    fireEvent.mouseEnter(mapHelp)
    fireEvent.focus(mapHelp)
    expect(screen.queryByRole('dialog', { name: 'Relationship map controls' })).not.toBeInTheDocument()
    fireEvent.click(mapHelp)
    expect(await screen.findByRole('dialog', { name: 'Relationship map controls' })).toBeInTheDocument()
    fireEvent.click(mapHelp)

    const inspector = container.querySelector('#team-relation-inspector')
    const resizeHandle = screen.getByRole('button', { name: 'Selected student · Map' })
    expect(inspector).toHaveAttribute('aria-hidden', 'true')
    expect(resizeHandle).toBeDisabled()

    fireEvent.click(screen.getByText('Lina Zhao').closest('button')!)
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'false'))
    expect(resizeHandle).toHaveAttribute('aria-expanded', 'true')
    expect(resizeHandle).not.toBeDisabled()
    expect(within(inspector as HTMLElement).getByText('Student permissions')).toBeInTheDocument()
    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: /Student permissions/i }))
    expect(await within(inspector as HTMLElement).findByRole('switch', { name: 'Use Discover' }))
      .toBeInTheDocument()

    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'true'))
    expect(resizeHandle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' })
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'false'))

    const board = container.querySelector('.team-relation-board') as HTMLElement
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      top: 0,
      right: 1000,
      bottom: 640,
      left: 100,
      width: 900,
      height: 640,
      toJSON: () => ({}),
    })
    const handleBounds = vi.spyOn(resizeHandle, 'getBoundingClientRect')
    handleBounds.mockReturnValue({
      x: 626,
      y: 0,
      top: 0,
      right: 640,
      bottom: 640,
      left: 626,
      width: 14,
      height: 640,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 633 })
    fireEvent.pointerMove(window, { clientX: 900 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'true'))

    handleBounds.mockReturnValue({
      x: 992,
      y: 0,
      top: 0,
      right: 1006,
      bottom: 640,
      left: 992,
      width: 14,
      height: 640,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 996 })
    fireEvent.pointerMove(window, { clientX: 650 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'false'))
  })

  it('uses the searchable multi-select when assigning teachers to an invitation', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    vi.spyOn(phdApi, 'listTeamMemberProfileAssets').mockResolvedValue([])
    const inviteMember = vi.spyOn(phdApi, 'inviteTeamMember')
      .mockResolvedValue(fixture().summary.members[3]!)
    const onChanged = vi.fn().mockResolvedValue(undefined)
    const onNotify = vi.fn()
    renderMembers(onChanged, undefined, onNotify)

    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    const inviteDialog = await screen.findByRole('dialog', { name: 'Invite someone' })
    const teacherTrigger = within(inviteDialog).getByRole('button', {
      name: /Student's teachers: 1 teacher/i,
    })

    fireEvent.click(teacherTrigger)
    const teacherDialog = await screen.findByRole('dialog', { name: "Student's teachers" })
    const search = within(teacherDialog).getByRole('searchbox', { name: 'Search' })
    fireEvent.change(search, { target: { value: 'alex@example.com' } })

    expect(within(teacherDialog).queryByRole('option', { name: /Dr\. Mei Chen/i }))
      .not.toBeInTheDocument()
    fireEvent.click(within(teacherDialog).getByRole('option', { name: /Prof\. Alex Rivera/i }))
    fireEvent.click(within(teacherDialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(within(inviteDialog).getByRole('button', {
        name: /Student's teachers: 2 teachers/i,
      })).toBeInTheDocument()
    })

    fireEvent.change(within(inviteDialog).getByRole('textbox', { name: 'Email' }), {
      target: { value: 'candidate@example.com' },
    })
    fireEvent.click(within(inviteDialog).getByRole('button', { name: 'Send invite' }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledWith(
        'owner-token',
        'team-1',
        'candidate@example.com',
        'member',
        ['member-mei', 'member-alex'],
      )
    })
    expect(onChanged).toHaveBeenCalled()
  })

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
    expect(teamStyles).toContain('.team-relation-board.is-inspector-closed')
    expect(teamStyles).toContain('--team-relation-inspector-width')
    expect(teamStyles).toContain('.team-relation-inspector-resizer')
    expect(teamStyles).toContain('.team-relation-inspector-resizing')
  })

  it('keeps the invite actions resident while only the form body scrolls', () => {
    expect(teamStyles).toMatch(
      /\.team-member-invite-popover-shell\s*\{[^}]*max-height:\s*min\(680px,\s*var\(--floating-available-height/s,
    )
    expect(teamStyles).toMatch(
      /\.team-invite-popover-body\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s,
    )
    expect(teamStyles).toMatch(
      /\.team-invite-popover-actions\s*\{[^}]*flex:\s*0 0 auto[^}]*border-top:\s*1px solid var\(--border\)[^}]*background:\s*var\(--surface\)/s,
    )
    expect(teamStyles).not.toContain('.team-invite-teacher-options')
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

  it('updates an assigned student permission immediately without waiting for a full Team refresh', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    vi.spyOn(phdApi, 'listTeamMemberProfileAssets').mockResolvedValue([])
    const updateAccess = vi.spyOn(phdApi, 'updateTeamMemberAccess')
      .mockResolvedValue({
        ...fixture().summary.members[3]!,
        relationships: {
          teacherIds: ['teacher-mei'],
          studentPermissions: { useDiscover: true },
        },
      })
    const onChanged = vi.fn().mockResolvedValue(undefined)
    const onNotify = vi.fn()
    const { container } = renderMembers(onChanged, undefined, onNotify)

    fireEvent.click(screen.getByText('Lina Zhao').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: /Student permissions/i }))
    const discoverSwitch = await screen.findByRole('switch', { name: 'Use Discover' })
    expect(discoverSwitch).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(discoverSwitch)
    expect(discoverSwitch).toHaveAttribute('aria-checked', 'true')

    await waitFor(() => {
      expect(updateAccess).toHaveBeenCalledWith(
        'owner-token',
        'team-1',
        'member-lina',
        { studentPermissions: { useDiscover: true } },
      )
    })
    expect(onNotify).toHaveBeenCalledWith(
      "Lina Zhao's Team access was updated.",
      'success',
    )
    expect(container.querySelector('.team-message')).not.toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
