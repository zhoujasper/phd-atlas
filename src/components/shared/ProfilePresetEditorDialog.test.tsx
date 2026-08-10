import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProfilePreset } from '../../api/phdApi'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import { prepareForSafeReload } from '../../safeReload'
import englishProfile from '../../i18n/en/profile.json'
import englishShared from '../../i18n/en/shared.json'
import englishTeam from '../../i18n/en/team.json'
import { I18nContext } from '../hooks/useI18n'
import { ProfilePresetEditorDialog } from './ProfilePresetEditorDialog'

registerLanguage('en', englishProfile as LangDict, 'profile')
registerLanguage('en', englishTeam as LangDict, 'team')
registerLanguage('en', englishShared as LangDict)

function renderEditor(role: 'owner' | 'admin', onSave = vi.fn()) {
  return {
    onSave,
    ...render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <ProfilePresetEditorDialog
          open
          preset={null}
          scope="team"
          role={role}
          onClose={vi.fn()}
          onSave={onSave}
        />
      </I18nContext.Provider>,
    ),
  }
}

async function fillRequiredGuides(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const guides = within(dialog).getAllByLabelText(/guide$/i)
  await user.type(guides[0], 'Guidance shown in English')
  await user.type(guides[1], '中文引导语')
}

describe('ProfilePresetEditorDialog organization visibility', () => {
  it('creates organization presets without sync toggles or uploads', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor('owner')
    const dialog = screen.getByRole('dialog', { name: /create preset/i })

    expect(within(dialog).queryByLabelText(/upload/i)).not.toBeInTheDocument()
    expect(dialog.querySelector('input[type="file"]')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/organization visibility/i)).not.toBeInTheDocument()

    const nameInput = within(dialog).getByLabelText('Name')
    expect(nameInput).toBeRequired()
    await user.type(nameInput, 'Team portfolio')
    await fillRequiredGuides(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: /save preset/i }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      nameEn: 'Team portfolio',
      nameZh: 'Team portfolio',
      descriptionEn: 'Guidance shown in English',
      descriptionZh: '中文引导语',
      syncToTeachers: true,
      syncToStudents: true,
    }))
  })

  it('auto-syncs teacher presets to students without sync controls', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor('admin')
    const dialog = screen.getByRole('dialog', { name: /create preset/i })

    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Name'), 'Teacher checklist')
    await fillRequiredGuides(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: /save preset/i }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      nameEn: 'Teacher checklist',
      syncToTeachers: false,
      syncToStudents: true,
    }))
  })

  it('puts icon and name at the top and opens a searchable icon/color popover', async () => {
    const user = userEvent.setup()
    renderEditor('admin')
    const dialog = screen.getByRole('dialog', { name: /create preset/i })

    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument()
    expect(within(dialog).queryByText('Preset appearance')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/English label/i)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Change icon and color' }))
    const popover = await screen.findByRole('dialog', { name: 'Icon and color' })
    expect(within(popover).getByPlaceholderText('Search icons…')).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'System' })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Document' })).toBeInTheDocument()
    // Icon labels stay in aria/title only — no visible name text in the grid.
    expect(within(popover).queryByText('Document')).not.toBeInTheDocument()
  })

  it('requires guidance in both content languages before saving', async () => {
    const user = userEvent.setup()
    renderEditor('admin')
    const dialog = screen.getByRole('dialog', { name: /create preset/i })
    const save = within(dialog).getByRole('button', { name: /save preset/i })

    await user.type(within(dialog).getByLabelText('Name'), 'Interview notes')
    expect(save).toBeDisabled()
    const guides = within(dialog).getAllByLabelText(/guide$/i)
    await user.type(guides[0], 'English card guidance')
    expect(save).toBeDisabled()
    await user.type(guides[1], '中文卡片引导语')
    expect(save).toBeEnabled()
  })
})

describe('ProfilePresetEditorDialog draft ownership', () => {
  it('blocks automatic reload and keeps a rejected save mounted with its fields', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Preset save failed'))
    renderEditor('owner', onSave)
    const dialog = screen.getByRole('dialog', { name: /create preset/i })
    const nameInput = within(dialog).getByLabelText('Name')

    await user.type(nameInput, 'Resident interview preset')
    await fillRequiredGuides(user, dialog)
    await expect(prepareForSafeReload({ reason: 'identity-change' })).resolves.toBe(false)

    await user.click(within(dialog).getByRole('button', { name: /save preset/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('dialog', { name: /create preset/i })).toBeInTheDocument()
    expect(nameInput).toHaveValue('Resident interview preset')
    await expect(prepareForSafeReload({ reason: 'lazy-module' })).resolves.toBe(false)
  })

  it('preserves an in-progress edit across same-id server snapshots and reseeds for a different preset', async () => {
    const user = userEvent.setup()
    const firstPreset: ProfilePreset = {
      id: 'preset-one',
      kind: 'Custom',
      nameZh: 'First preset',
      nameEn: 'First preset',
      descriptionZh: '第一中文引导',
      descriptionEn: 'First English guidance',
      contentZh: '第一中文内容',
      contentEn: 'First English content',
      icon: 'file-text',
      color: 'blue',
    }
    const secondPreset: ProfilePreset = {
      ...firstPreset,
      id: 'preset-two',
      nameZh: 'Second preset',
      nameEn: 'Second preset',
      descriptionZh: '第二中文引导',
      descriptionEn: 'Second English guidance',
    }
    const renderPreset = (preset: ProfilePreset) => (
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <ProfilePresetEditorDialog
          open
          preset={preset}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </I18nContext.Provider>
    )
    const view = render(renderPreset(firstPreset))
    const dialog = screen.getByRole('dialog', { name: /edit preset/i })
    const nameInput = within(dialog).getByLabelText('Name')
    const englishGuide = within(dialog).getAllByLabelText(/guide$/i)[0]

    await user.clear(nameInput)
    await user.type(nameInput, 'Local preset name')
    await user.clear(englishGuide)
    await user.type(englishGuide, 'Local guidance in progress')

    view.rerender(renderPreset({
      ...firstPreset,
      nameZh: 'Server refreshed name',
      nameEn: 'Server refreshed name',
      descriptionEn: 'Server refreshed guidance',
    }))

    expect(nameInput).toHaveValue('Local preset name')
    expect(englishGuide).toHaveValue('Local guidance in progress')

    view.rerender(renderPreset(secondPreset))

    expect(nameInput).toHaveValue('Second preset')
    expect(englishGuide).toHaveValue('Second English guidance')
  })
})
