import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession, TeamMember, TeamSummary } from '../../api/phdApi'
import { phdApi } from '../../api/phdApi'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { TeamScreen } from './TeamScreen'

const ownerSession = {
  token: 'owner-token',
  user: {
    id: 'owner-1',
    name: 'Jasper',
    email: 'jasper@example.com',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    settings: {},
  },
  settings: {},
} as unknown as AuthSession

function teamMember(
  id: string,
  userId: string,
  displayName: string,
  role: TeamMember['role'],
  relationships?: TeamMember['relationships'],
): TeamMember {
  return {
    id,
    teamId: 'team-1',
    userId,
    displayName,
    invitedEmail: `${userId}@example.com`,
    role,
    status: 'active',
    invitedBy: 'owner-1',
    relationships,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function membersSummary(): TeamSummary {
  const owner = teamMember('member-owner', 'owner-1', 'Jasper', 'owner')
  const teacher = teamMember('member-teacher', 'teacher-1', 'Dr. Mei Chen', 'admin')
  const student = teamMember(
    'member-student',
    'student-1',
    'Lina Zhao',
    'member',
    { teacherIds: ['teacher-1'] },
  )
  return {
    team: {
      id: 'team-1',
      name: "Jasper's Team",
      ownerId: 'owner-1',
      seatLimit: 105,
      teacherGroups: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    membership: owner,
    members: [owner, teacher, student],
    capacity: {
      storageUsedBytes: 0,
      storageQuotaBytes: 1024 * 1024 * 1024,
      teacherSeatsUsed: 1,
      teacherSeatLimit: 5,
      studentSeatsUsed: 1,
      studentSeatLimit: 100,
      activeShareCount: 0,
      activeShareLimit: 10_000,
      shareCreateQuota: null,
    },
    recentEvents: [],
    transferRequests: [],
  }
}

function renderMembers() {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <TeamScreen
        session={ownerSession}
        initialSummary={membersSummary()}
        applications={[]}
        aiKeys={[]}
        activeSection="members"
        hideTabs
      />
    </I18nContext.Provider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamScreen member collaboration workspace', () => {
  it('places inline group creation immediately after Ungrouped', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    renderMembers()

    fireEvent.click(await screen.findByRole('button', { name: /Teacher groups/ }))
    const groupNav = screen.getByRole('navigation', { name: 'Teacher groups' })
    const ungrouped = within(groupNav).getByRole('button', { name: /Ungrouped/ })
    const create = within(groupNav).getByRole('button', { name: 'New group' })

    expect(
      ungrouped.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(create)
    const input = within(groupNav).getByPlaceholderText('e.g. Writing team')
    expect(input).toHaveFocus()
    expect(input.closest('.team-teacher-group-create.is-inline')).toBeInTheDocument()
  })

  it('opens the shared context menu from teacher and student relationship nodes', async () => {
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    const view = renderMembers()

    fireEvent.click(await screen.findByRole('button', { name: 'Map' }))
    await waitFor(() => expect(view.container.querySelector('.team-relation-map')).toBeInTheDocument())

    const teacherNode = Array.from(view.container.querySelectorAll<HTMLElement>('.team-relation-node.teacher'))
      .find((node) => node.textContent?.includes('Dr. Mei Chen'))
    const studentNode = Array.from(view.container.querySelectorAll<HTMLElement>('.team-relation-node.student'))
      .find((node) => node.textContent?.includes('Lina Zhao'))

    expect(teacherNode).toBeDefined()
    expect(studentNode).toBeDefined()

    fireEvent.contextMenu(teacherNode!, { clientX: 80, clientY: 80 })
    expect(await screen.findByRole('menu', { name: 'Dr. Mei Chen' })).toBeInTheDocument()

    fireEvent.contextMenu(studentNode!, { clientX: 100, clientY: 100 })
    expect(await screen.findByRole('menu', { name: 'Lina Zhao' })).toBeInTheDocument()
  })
})
