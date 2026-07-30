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

function fixture(role: 'owner' | 'admin' | 'member') {
  const owner = member({
    id: 'member-owner',
    userId: 'owner-1',
    displayName: 'Jasper',
    invitedEmail: 'jasper@example.com',
    role: 'owner',
  })
  const teacher = member({
    id: 'member-teacher',
    userId: 'teacher-1',
    displayName: 'Dr. Mei Chen',
    invitedEmail: 'mei@example.edu',
    role: 'admin',
  })
  const student = member({
    id: 'member-student',
    userId: 'student-1',
    displayName: 'Lina Zhao',
    invitedEmail: 'lina@example.edu',
    role: 'member',
    relationships: { teacherIds: ['teacher-1'] },
  })
  const current = role === 'owner' ? owner : role === 'admin' ? teacher : student
  const session = {
    token: `${role}-token`,
    user: {
      id: current.userId,
      name: current.displayName,
      email: current.invitedEmail,
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
      teacherGroups: [],
    },
    membership: current,
    members: [owner, teacher, student],
    roleCounts: { owner: 1, admin: 1, member: 1 },
    memberStats: {},
    recentEvents: [],
    transferRequests: [],
  } satisfies TeamSummary
  return { current, session, summary }
}

function renderMembers(
  role: 'owner' | 'admin' | 'member',
  onChanged = vi.fn(),
  onNotify = vi.fn(),
) {
  const { session, summary } = fixture(role)
  const result = render(
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
        onNotify={onNotify}
      />
    </I18nContext.Provider>,
  )
  return { ...result, onChanged, onNotify }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen student-visible contact profile', () => {
  it('lets a teacher expand, edit, and save only their own organization profile', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const saved = {
      ...fixture('admin').current,
      contactProfile: {
        title: 'Senior Advisor',
        department: 'Graduate Admissions',
        contactEmail: 'mei@example.edu',
        phone: '+44 20 7000 0000',
        office: 'Room 314',
        website: 'https://example.edu/mei',
        availability: 'Monday to Thursday',
        bio: 'Application strategy and writing feedback.',
      },
    }
    const updateProfile = vi.spyOn(phdApi, 'updateMyTeamContactProfile').mockResolvedValue(saved)
    const { container, onChanged, onNotify } = renderMembers('admin')

    fireEvent.click(screen.getByRole('button', { name: /Visible to your students/i }))
    fireEvent.change(await screen.findByLabelText('Role / title'), { target: { value: 'Senior Advisor' } })
    fireEvent.change(screen.getByLabelText('Department / team'), { target: { value: 'Graduate Admissions' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+44 20 7000 0000' } })
    fireEvent.change(screen.getByLabelText('Office / location'), { target: { value: 'Room 314' } })
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://example.edu/mei' } })
    fireEvent.change(screen.getByLabelText('Availability / office hours'), { target: { value: 'Monday to Thursday' } })
    fireEvent.change(screen.getByLabelText('How I support students'), {
      target: { value: 'Application strategy and writing feedback.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith('admin-token', 'team-1', {
        title: 'Senior Advisor',
        department: 'Graduate Admissions',
        contactEmail: 'mei@example.edu',
        phone: '+44 20 7000 0000',
        office: 'Room 314',
        website: 'https://example.edu/mei',
        availability: 'Monday to Thursday',
        bio: 'Application strategy and writing feedback.',
      })
    })
    expect(onChanged).toHaveBeenCalled()
    expect(onNotify).toHaveBeenCalledWith(t('en', 'team.contactProfileSaved'), 'success')
    expect(container.querySelector('.team-message')).not.toBeInTheDocument()
  })

  it('shows the editor to the institution administrator but not to students', () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const ownerView = renderMembers('owner')
    expect(screen.getByRole('button', { name: /Visible to your students/i })).toBeInTheDocument()

    ownerView.unmount()
    renderMembers('member')
    expect(screen.queryByRole('button', { name: /Visible to your students/i })).not.toBeInTheDocument()
  })

  it('uses one disclosure band with responsive and reduced-motion states', () => {
    expect(teamStyles).toContain('.team-contact-profile-summary')
    expect(teamStyles).toContain('.team-contact-profile-form-grid')
    expect(teamStyles).toContain('@media (max-width: 560px)')
    expect(teamStyles).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
