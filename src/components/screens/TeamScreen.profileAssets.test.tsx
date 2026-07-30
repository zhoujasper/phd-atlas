import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  phdApi,
  type AuthSession,
  type ProfileAsset,
  type TeamMember,
  type TeamProfilePreset,
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
const originalStartViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition')

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
    delete document.documentElement.dataset.teamPortraitTransitionToken
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    })
    if (originalStartViewTransition) {
      Object.defineProperty(document, 'startViewTransition', originalStartViewTransition)
    } else {
      Reflect.deleteProperty(document, 'startViewTransition')
    }
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

  it('places preset creation at the end of the administrator and teacher source lists', async () => {
    const user = userEvent.setup()
    const organizationPreset: TeamProfilePreset = {
      id: 'org-ui-preset',
      kind: 'ResearchProposal',
      nameZh: '组织研究计划',
      nameEn: 'Organization research plan',
      descriptionZh: '组织统一模板',
      descriptionEn: 'Organization-managed template',
      contentZh: '研究问题与方法',
      contentEn: 'Research question and methods',
      icon: 'flask-conical',
      color: 'teal',
      builtIn: false,
      createdBy: 'owner_1',
      createdByRole: 'owner',
      syncToTeachers: true,
      syncToStudents: true,
      manageable: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const ownerView = renderResources(session, {
      ...summary,
      team: { ...summary.team, profilePresets: [organizationPreset] },
    })

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    const ownerInspector = ownerView.container.querySelector<HTMLElement>(
      '.team-portrait-template-pane .team-portrait-presets',
    )
    expect(ownerInspector).not.toBeNull()
    expect(within(ownerInspector!).queryByRole('button', { name: 'Add organization preset' })).not.toBeInTheDocument()

    await user.click(within(ownerInspector!).getByRole('tab', { name: /Org admin/i }))
    const ownerAdd = await within(ownerInspector!).findByRole('button', { name: 'Add organization preset' })
    const ownerList = ownerInspector!.querySelector<HTMLElement>('.team-portrait-preset-list')
    expect(ownerList?.lastElementChild).toContainElement(ownerAdd)
    expect(within(ownerAdd).getByText('Organization')).toBeInTheDocument()

    ownerView.unmount()

    const teacherPreset: TeamProfilePreset = {
      ...organizationPreset,
      id: 'teacher-ui-preset',
      nameZh: '老师研究计划',
      nameEn: 'Teacher research plan',
      createdBy: 'teacher_1',
      createdByRole: 'admin',
    }
    const teacherView = renderResources(teacherSession, {
      ...teacherSummary,
      team: {
        ...teacherSummary.team,
        profilePresets: [
          { ...organizationPreset, manageable: false },
          teacherPreset,
        ],
      },
    })

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    const teacherInspector = teacherView.container.querySelector<HTMLElement>(
      '.team-portrait-template-pane .team-portrait-presets',
    )
    expect(teacherInspector).not.toBeNull()
    expect(within(teacherInspector!).queryByRole('button', { name: 'Add teacher preset' })).not.toBeInTheDocument()

    await user.click(within(teacherInspector!).getByRole('tab', { name: /Mine/i }))
    const teacherAdd = await within(teacherInspector!).findByRole('button', { name: 'Add teacher preset' })
    const teacherList = teacherInspector!.querySelector<HTMLElement>('.team-portrait-preset-list')
    expect(teacherList?.lastElementChild).toContainElement(teacherAdd)
    expect(within(teacherAdd).getByText('Teacher presets')).toBeInTheDocument()

    await user.click(teacherAdd)
    expect(await screen.findByRole('dialog', { name: 'Create preset' })).toBeInTheDocument()
  })

  it('chooses an explicit preset destination and can switch it again in the editor header', async () => {
    const user = userEvent.setup()
    const preset: TeamProfilePreset = {
      id: 'org-research-plan',
      kind: 'ResearchProposal',
      nameZh: '组织研究计划',
      nameEn: 'Organization research plan',
      descriptionZh: '组织统一模板',
      descriptionEn: 'Organization-managed template',
      contentZh: '研究问题与方法',
      contentEn: 'Research question and methods',
      icon: 'flask-conical' as const,
      color: 'teal' as const,
      builtIn: false,
      createdBy: 'owner_1',
      createdByRole: 'owner' as const,
      syncToTeachers: true,
      syncToStudents: true,
      manageable: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const created = {
      ...secondStudentAsset,
      name: preset.nameEn,
      kind: preset.kind,
      description: preset.contentEn,
    }
    vi.mocked(phdApi.listTeamMemberProfileAssets).mockImplementation(
      async (_token, _teamId, studentUserId) => studentUserId === 'student_2' ? [] : [asset],
    )
    const create = vi.spyOn(phdApi, 'addTeamMemberProfileAsset').mockResolvedValue(created)

    renderResources(session, {
      ...summary,
      team: { ...summary.team, profilePresets: [preset] },
      members: [owner, student, secondStudent],
      roleCounts: { owner: 1, admin: 0, member: 2 },
    })

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    const targetTrigger = screen.getByRole('button', { name: 'Choose a student: Lina Student' })
    expect(within(targetTrigger).getByText('Student list')).toBeInTheDocument()
    expect(within(targetTrigger).getByText('Choose a student')).toBeInTheDocument()
    expect(within(targetTrigger).getByText('Lina Student')).toBeInTheDocument()
    await user.click(targetTrigger)
    const picker = await screen.findByRole('dialog', { name: 'Choose a student' })
    await user.click(within(picker).getByRole('option', { name: /Noah Student/i }))

    const usePreset = await screen.findByRole('button', {
      name: 'Use preset: Organization research plan · Noah Student',
    })
    await user.click(usePreset)

    const dialog = await screen.findByRole('dialog', { name: 'Use preset' }, { timeout: 10_000 })
    expect(within(dialog).getByText("Noah Student's reusable library")).toBeInTheDocument()
    const dialogTargetTrigger = within(dialog).getByRole('button', { name: 'Choose a student: Noah Student' })
    expect(dialogTargetTrigger.closest('.snippet-editor-head-accessory')).toBeInTheDocument()
    await user.click(dialogTargetTrigger)
    const dialogPicker = await screen.findByRole('dialog', { name: 'Choose a student' })
    await user.click(within(dialogPicker).getByRole('option', { name: /Lina Student/i }))
    expect(within(dialog).getByText("Lina Student's reusable library")).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith(
      'owner-token',
      'team_1',
      'student_1',
      expect.objectContaining({
        name: preset.nameEn,
        kind: 'Custom',
      }),
    ))
  })

  it('offers a direct student invitation when the portrait workspace has no students', async () => {
    const user = userEvent.setup()
    renderResources(session, {
      ...summary,
      members: [owner, teacher],
      roleCounts: { owner: 1, admin: 1, member: 0 },
    })

    expect(screen.getByRole('heading', { name: 'No organization students yet' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Invite student' }))

    const invite = await screen.findByRole('dialog', { name: 'Invite a student into my scope' })
    expect(within(invite).getByRole('textbox', { name: 'Email' })).toBeInTheDocument()
  })

  it('keeps the complete student-material description in the clickable row without opting into a reveal', async () => {
    const user = userEvent.setup()
    const description = [
      'A complete reusable description with enough detail to exceed the former one-hundred-and-thirty-two-character rendering limit.',
      'The final sentence must remain available to the overflow reveal.',
    ].join(' ')
    vi.mocked(phdApi.listTeamMemberProfileAssets).mockResolvedValue([{
      ...asset,
      description,
    }])
    renderResources()

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    await user.click(screen.getByRole('button', { name: 'List view' }))

    const value = await screen.findByText(description)
    expect(value).toHaveTextContent(description)
    expect(value).not.toHaveAttribute('data-overflow-full-text')
    expect(value).not.toHaveAttribute('data-overflow-reveal')
    expect(value).not.toHaveTextContent('…')
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

  it('opens a selected student as a focused mobile portrait and returns to the same list row', async () => {
    const user = userEvent.setup()
    const view = renderResources(session, {
      ...summary,
      members: [owner, student, secondStudent],
      roleCounts: { owner: 1, admin: 0, member: 2 },
    })

    await screen.findByRole('button', { name: 'Open material: Student CV' })
    const list = screen.getByRole('listbox', { name: 'Choose a student' })
    const secondOption = within(list).getByRole('option', { name: /Noah Student/i })
    const workspace = view.container.querySelector<HTMLElement>('.team-portrait-workspace')
    expect(workspace).not.toBeNull()
    expect(workspace).not.toHaveClass('is-mobile-detail-open')
    expect(workspace).not.toHaveClass('has-mobile-navigation')

    await user.click(secondOption)

    await waitFor(() => {
      expect(secondOption).toHaveAttribute('aria-selected', 'true')
      expect(workspace).toHaveClass('is-mobile-detail-open')
      expect(workspace).toHaveClass('has-mobile-navigation')
    })
    const backButton = screen.getByLabelText('Back')
    expect(backButton).toHaveAttribute('aria-controls', 'team-student-portrait-list')

    await user.click(backButton)

    await waitFor(() => {
      expect(workspace).not.toHaveClass('is-mobile-detail-open')
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument()
      expect(secondOption).toHaveFocus()
    })
  })

  it('slides the selection immediately and keeps the outgoing portrait mounted until the next one is ready', async () => {
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
    let finishViewTransition: () => void = () => undefined
    const viewTransitionFinished = new Promise<void>((resolve) => {
      finishViewTransition = resolve
    })
    const startViewTransition = vi.fn((update: () => void) => {
      update()
      return { finished: viewTransitionFinished }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
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
    const content = profilePane?.querySelector<HTMLElement>('.team-portrait-profile-content')
    expect(content?.className).toMatch(/is-handoff-[ab]/)
    expect(content).toHaveAttribute('data-student-portrait-stable', 'true')
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(document.documentElement).toHaveAttribute('data-team-portrait-transition-token')
    expect(content?.style.getPropertyValue('view-transition-name')).toBe('team-portrait-student-profile')
    expect(listAssets.mock.calls.filter((call) => call[2] === 'student_2')).toHaveLength(1)

    await act(async () => {
      finishViewTransition()
      await viewTransitionFinished
    })
    await waitFor(() => {
      expect(document.documentElement).not.toHaveAttribute('data-team-portrait-transition-token')
      expect(content).not.toHaveClass('is-native-handoff')
      expect(content?.style.getPropertyValue('view-transition-name')).toBe('')
    })
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
