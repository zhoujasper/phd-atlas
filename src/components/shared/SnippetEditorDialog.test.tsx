import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileAsset } from '../../api/phdApi'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import englishDossier from '../../i18n/en/dossier.json'
import englishProfile from '../../i18n/en/profile.json'
import englishShared from '../../i18n/en/shared.json'
import { I18nContext } from '../hooks/useI18n'
import { SnippetEditorDialog } from './SnippetEditorDialog'

registerLanguage('en', englishProfile as LangDict, 'profile')
registerLanguage('en', englishDossier as LangDict, 'dossier')
registerLanguage('en', englishShared as LangDict)

const asset: ProfileAsset = {
  id: 'asset-appearance-test',
  name: 'Project portfolio',
  kind: 'Other',
  description: 'Selected project evidence',
  customLabelEn: 'portfolio',
  customLabelZh: '作品集',
  icon: 'file-text',
  color: 'blue',
  attachments: [],
  shares: [],
}

describe('SnippetEditorDialog appearance', () => {
  it('keeps the empty attachment row as a hidden layout placeholder while reservation options expand', async () => {
    const user = userEvent.setup()

    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SnippetEditorDialog
          open
          asset={asset}
          globalPhrase={{ leadZh: '', tailZh: '', leadEn: '', tailEn: '' }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onUploadFiles={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDownloadFile={vi.fn()}
          onCreateShare={vi.fn()}
          onRevokeShare={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    const emptyRow = within(dialog).getByText('No attachments yet.')
    await user.click(within(dialog).getByText('Reserve upload'))

    expect(emptyRow).toBeInTheDocument()
    expect(emptyRow).toHaveClass('is-reserved-placeholder')
    expect(emptyRow).toHaveAttribute('aria-hidden', 'true')
  })

  it('edits and persists the library icon and color from the shared popover', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SnippetEditorDialog
          open
          asset={asset}
          globalPhrase={{ leadZh: '', tailZh: '', leadEn: '', tailEn: '' }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={onUpdate}
          onUploadFiles={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDownloadFile={vi.fn()}
          onCreateShare={vi.fn()}
          onRevokeShare={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    await user.click(within(dialog).getByRole('button', { name: 'Change icon and color' }))
    const popover = await screen.findByRole('dialog', { name: 'Icon and color' })
    await user.click(within(popover).getByRole('button', { name: 'Portfolio' }))
    await user.click(within(popover).getByRole('button', { name: 'Purple' }))
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(onUpdate).toHaveBeenCalledWith('asset-appearance-test', expect.objectContaining({
      icon: 'briefcase',
      color: 'purple',
    }))
  })
})
