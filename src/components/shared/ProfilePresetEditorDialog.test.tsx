import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
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

    await user.type(within(dialog).getByLabelText('Name'), 'Team portfolio')
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
