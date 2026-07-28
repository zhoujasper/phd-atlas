import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  phdApi,
  type AuthSession,
  type ProfileAsset,
  type TeamMember,
  type TeamSummary,
} from '../../api/phdApi'
import { registerLanguage, type LangDict } from '../../i18n'
import englishProfile from '../../i18n/en/profile.json'
import englishShared from '../../i18n/en/shared.json'
import '../shared/SnippetEditorDialog'
import { TeamScreen } from './TeamScreen'

registerLanguage('en', englishProfile as LangDict, 'profile')
registerLanguage('en', englishShared as LangDict, 'shared')

const originalMatchMedia = window.matchMedia

const owner: TeamMember = {
  id: 'member_owner',
  teamId: 'team_1',
  userId: 'owner_1',
  displayName: 'Team Admin',
  invitedEmail: 'owner@example.com',
  role: 'owner',
  status: 'active',
  invitedBy: 'owner_1',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const student: TeamMember = {
  id: 'member_student',
  teamId: 'team_1',
  userId: 'student_1',
  displayName: 'Lina Student',
  invitedEmail: 'lina@example.com',
  role: 'member',
  status: 'active',
  invitedBy: 'owner_1',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const secondStudent: TeamMember = {
  ...student,
  id: 'member_student_2',
  userId: 'student_2',
  displayName: 'Noah Student',
  invitedEmail: 'noah@example.com',
}

const teacher: TeamMember = {
  id: 'member_teacher',
  teamId: 'team_1',
  userId: 'teacher_1',
  displayName: 'Dr. Teacher',
  invitedEmail: 'teacher@example.com',
  role: 'admin',
  status: 'active',
  invitedBy: 'owner_1',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const summary: TeamSummary = {
  team: {
    id: 'team_1',
    name: 'Atlas Lab',
    ownerId: 'owner_1',
    seatLimit: 10,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  membership: owner,
  members: [owner, student],
  usage: {
    storageUsedBytes: 0,
    storageQuotaBytes: 1024 * 1024,
    applicationCount: 0,
    activeShareCount: 0,
    shareQuota: 10,
    shareCreatedCount: 0,
    shareCreateQuota: 10,
  },
  memberStats: {},
  roleCounts: { owner: 1, admin: 0, member: 1 },
  recentEvents: [],
}

const session = {
  token: 'owner-token',
  user: {
    id: 'owner_1',
    name: 'Team Admin',
    email: 'owner@example.com',
    role: 'user',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastLoginAt: null,
    settings: {
      language: 'en',
      contentLanguagePrimary: 'en',
      contentLanguageSecondary: 'zh',
    },
  },
  settings: {},
} as unknown as AuthSession

const teacherSession = {
  ...session,
  token: 'teacher-token',
  user: {
    ...session.user,
    id: 'teacher_1',
    name: 'Dr. Teacher',
    email: 'teacher@example.com',
  },
} as AuthSession

const teacherSummary: TeamSummary = {
  ...summary,
  membership: teacher,
  members: [
    owner,
    teacher,
    { ...student, invitedBy: 'teacher_1' },
  ],
  roleCounts: { owner: 1, admin: 1, member: 1 },
}

const studentSession = {
  ...session,
  token: 'student-token',
  user: {
    ...session.user,
    id: 'student_1',
    name: 'Lina Student',
    email: 'lina@example.com',
  },
} as AuthSession

const studentSummary: TeamSummary = {
  ...summary,
  team: {
    ...summary.team,
    profilePresets: [{
      id: 'org-research-plan',
      kind: 'ResearchProposal',
      nameZh: '组织研究计划',
      nameEn: 'Organization research plan',
      descriptionZh: '组织统一模板',
      descriptionEn: 'Organization-managed template',
      contentZh: '研究问题与方法',
      contentEn: 'Research question and methods',
      icon: 'flask-conical',
      color: 'teal',
      createdBy: 'owner_1',
      createdByRole: 'owner',
      syncToTeachers: true,
      syncToStudents: true,
    }],
  },
  membership: student,
  members: [owner, teacher, student],
  roleCounts: { owner: 1, admin: 1, member: 1 },
}

const asset: ProfileAsset = {
  id: 'asset_student_1',
  ownerId: 'student_1',
  name: 'Student CV',
  kind: 'CV',
  description: 'Initial student CV notes',
  notes: '',
  customLabelZh: '',
  customLabelEn: '',
  icon: 'file-text',
  color: 'blue',
  familyId: 'asset_student_1',
  versionLabel: 'v1',
  versionNumber: 1,
  isPrimary: true,
  familyName: '',
  uploadReserved: false,
  allowedFileTypes: [],
  attachments: [],
  shares: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const secondStudentAsset: ProfileAsset = {
  ...asset,
  id: 'asset_student_2',
  ownerId: 'student_2',
  name: 'Second Student CV',
  familyId: 'asset_student_2',
}

const deckAssets: ProfileAsset[] = Array.from({ length: 7 }, (_, index) => ({
  ...asset,
  id: `asset_student_cv_${index + 1}`,
  name: `Student CV v${index + 1}`,
  familyId: `legacy_family_${index + 1}`,
  versionLabel: `v${index + 1}`,
  versionNumber: index + 1,
  isPrimary: index === 0,
  updatedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
}))

function renderResources(
  activeSession: AuthSession = session,
  activeSummary: TeamSummary = summary,
) {
  return render(
    <TeamScreen
      session={activeSession}
      initialSummary={activeSummary}
      activeSection="resources"
      hideTabs
      applications={[]}
      activeTeamId="team_1"
    />,
  )
}

describe('TeamScreen student profile assets', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
    vi.spyOn(phdApi, 'teamNotificationGroups').mockResolvedValue([])
    vi.spyOn(phdApi, 'listTeamMemberProfileAssets').mockResolvedValue([asset])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    })
  })

  it('opens the shared editor from the list and saves through the scoped team API', async () => {
    const user = userEvent.setup()
    const updated = { ...asset, name: 'Updated Student CV', updatedAt: '2026-07-23T12:00:00.000Z' }
    const update = vi.spyOn(phdApi, 'updateTeamMemberProfileAsset').mockResolvedValue(updated)
    renderResources()

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    expect(document.querySelector('.team-portrait-library-view')).toHaveClass('is-cards')
    await user.click(screen.getByRole('button', { name: 'List view' }))
    await user.click(await screen.findByRole('button', { name: 'Open material: Student CV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit snippet' }, { timeout: 10_000 })
    const nameInput = within(dialog).getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(nameInput).toHaveValue(asset.name))
    await user.clear(nameInput)
    await user.type(nameInput, updated.name)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith(
      'owner-token',
      'team_1',
      'student_1',
      asset.id,
      expect.objectContaining({ name: updated.name }),
    ))
    expect(await screen.findByRole('button', { name: `Open material: ${updated.name}` })).toBeInTheDocument()
  })

  it('uses the personal Profile layout for a Team student with organization templates only', () => {
    window.localStorage.setItem('phd-atlas-team-student-profiles:v1', JSON.stringify([{
      id: 'student-org-snippet',
      teamId: 'team_1',
      studentUserId: 'student_1',
      kind: 'ResearchProposal',
      name: 'Org research draft',
      description: 'A reusable organization-scoped research paragraph.',
      updatedAt: '2026-07-25T00:00:00.000Z',
    }]))

    const view = renderResources(studentSession, studentSummary)

    expect(view.container.querySelector('.team-student-personal-profile')).toBeInTheDocument()
    expect(view.container.querySelector('.profile-toolbar')).toBeInTheDocument()
    expect(view.container.querySelector('.profile-snippet-section')).toBeInTheDocument()
    expect(screen.getByText('Organization research plan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add preset' })).not.toBeInTheDocument()
    expect(view.container.querySelector('.ai-profile-panel')).not.toBeInTheDocument()
  })

  it('opens the same editor from card view and allows deletion', async () => {
    const user = userEvent.setup()
    const remove = vi.spyOn(phdApi, 'deleteTeamMemberProfileAsset').mockResolvedValue({ id: asset.id })
    renderResources(teacherSession, teacherSummary)

    await user.click(await screen.findByRole('button', { name: 'Open material: Student CV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit snippet' }, { timeout: 10_000 })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit snippet' })).not.toBeInTheDocument())

    await user.click(screen.getByTitle('Delete snippet'))
    const confirmation = await screen.findByRole('alertdialog', { name: 'Delete snippet' })
    await user.click(within(confirmation).getByRole('button', { name: 'Delete snippet' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith(
      'teacher-token',
      'team_1',
      'student_1',
      asset.id,
    ))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open material: Student CV' })).not.toBeInTheDocument())
  })

  it('slides the selection immediately and keeps the outgoing portrait mounted until the next one is ready', async () => {
    let resolveSecondStudentAssets: (assets: ProfileAsset[]) => void = () => undefined
    const secondStudentAssets = new Promise<ProfileAsset[]>((resolve) => {
      resolveSecondStudentAssets = resolve
    })
    const listAssets = vi.mocked(phdApi.listTeamMemberProfileAssets)
    listAssets.mockImplementation((_token, _teamId, studentUserId) => (
      studentUserId === 'student_2'
        ? secondStudentAssets
        : Promise.resolve([asset])
    ))
    renderResources(session, {
      ...summary,
      members: [owner, student, secondStudent],
      roleCounts: { owner: 1, admin: 0, member: 2 },
    })

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    const list = screen.getByRole('listbox', { name: 'Choose a student' })
    const firstOption = within(list).getByRole('option', { name: /Lina Student/i })
    const secondOption = within(list).getByRole('option', { name: /Noah Student/i })
    const selection = list.querySelector<HTMLElement>('.team-portrait-student-selection')
    expect(selection).not.toBeNull()

    Object.defineProperties(firstOption, {
      offsetTop: { configurable: true, value: 0 },
      offsetHeight: { configurable: true, value: 66 },
    })
    Object.defineProperties(secondOption, {
      offsetTop: { configurable: true, value: 66 },
      offsetHeight: { configurable: true, value: 66 },
    })

    fireEvent.pointerDown(secondOption, { button: 0 })
    expect(selection?.style.getPropertyValue('--team-portrait-selection-y')).toBe('66px')
    expect(selection).toHaveClass('is-moving')

    fireEvent.click(secondOption)
    await waitFor(() => expect(secondOption).toHaveAttribute('aria-selected', 'true'))

    const profilePane = document.querySelector<HTMLElement>('.team-portrait-profile-pane')
    expect(profilePane).not.toBeNull()
    expect(profilePane).toHaveAttribute('aria-busy', 'true')
    expect(within(profilePane!).getByRole('heading', { name: 'Lina Student' })).toBeInTheDocument()
    expect(within(profilePane!).getByRole('button', { name: 'Open material: Student CV' })).toBeInTheDocument()
    expect(profilePane?.querySelector('.team-portrait-profile-loading')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecondStudentAssets([secondStudentAsset])
      await secondStudentAssets
    })

    await waitFor(() => {
      expect(within(profilePane!).getByRole('heading', { name: 'Noah Student' })).toBeInTheDocument()
      expect(within(profilePane!).getByRole('button', { name: 'Open material: Second Student CV' })).toBeInTheDocument()
      expect(profilePane).not.toHaveAttribute('aria-busy')
    })
    const content = profilePane?.querySelector('.team-portrait-profile-content')
    expect(content?.className).toMatch(/is-handoff-[ab]/)
    expect(content).toHaveAttribute('data-student-portrait-stable', 'true')
    expect(listAssets.mock.calls.filter((call) => call[2] === 'student_2')).toHaveLength(1)
  })

  it('turns the real Team portrait deck continuously with one bounded follow-up', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
    vi.mocked(phdApi.listTeamMemberProfileAssets).mockResolvedValue(deckAssets)
    const user = userEvent.setup()
    renderResources()

    await screen.findByRole('button', { name: 'Open material: Student CV v1' })
    const stack = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('.team-portrait-profile-stack')
      expect(node).not.toBeNull()
      expect(node?.querySelectorAll('.team-portrait-profile-deck-card')).toHaveLength(7)
      return node as HTMLElement
    })
    const initialFrontId = stack.querySelector<HTMLElement>('.is-deck-front')?.dataset.assetId

    for (let index = 0; index < 4; index += 1) {
      fireEvent.wheel(stack, { deltaY: 12, deltaMode: 0 })
    }
    expect(stack).toHaveClass('is-turning')
    expect(stack.querySelectorAll('.is-deck-active-turn')).toHaveLength(5)
    const firstOutgoing = stack.querySelector<HTMLElement>('.is-deck-outgoing')
    expect(firstOutgoing?.dataset.assetId).toBe(initialFrontId)

    // A long same-direction stroke may request one next turn, but never builds
    // a delayed replay queue.
    for (let index = 0; index < 20; index += 1) {
      fireEvent.wheel(stack, { deltaY: 12, deltaMode: 0 })
    }
    fireEvent.animationEnd(firstOutgoing as HTMLElement)

    const secondTurn = await waitFor(() => {
      const outgoing = stack.querySelector<HTMLElement>('.is-deck-outgoing')
      const incoming = stack.querySelector<HTMLElement>('.is-deck-incoming')
      expect(outgoing).not.toBeNull()
      expect(outgoing?.dataset.assetId).not.toBe(initialFrontId)
      expect(incoming).not.toBeNull()
      return { outgoing: outgoing!, incoming: incoming! }
    })
    fireEvent.animationEnd(secondTurn.outgoing)

    await waitFor(() => expect(stack).not.toHaveClass('is-turning'))
    expect(stack.querySelector<HTMLElement>('.is-deck-front')).toBe(secondTurn.incoming)
    await new Promise((resolve) => window.setTimeout(resolve, 240))
    expect(stack).not.toHaveClass('is-turning')

    await user.click(screen.getByRole('button', { name: /7 items/i }))
    await waitFor(() => {
      expect(stack).toHaveClass('is-expanded')
      expect(document.querySelectorAll('.team-portrait-profile-version')).toHaveLength(6)
      expect(stack.querySelector('.team-portrait-profile-version')).toBeNull()
    })
    const pageWheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 60,
    })
    stack.dispatchEvent(pageWheel)
    expect(pageWheel.defaultPrevented).toBe(false)
  })
})
