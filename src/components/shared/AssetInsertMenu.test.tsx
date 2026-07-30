import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileAsset } from '../../api/phdApi'
import {
  getDict,
  registerLanguage,
  t as translate,
  tpl,
  type LangDict,
} from '../../i18n'
import englishDossier from '../../i18n/en/dossier.json'
import englishProfile from '../../i18n/en/profile.json'
import englishShared from '../../i18n/en/shared.json'
import { I18nContext } from '../hooks/useI18n'
import { AssetInsertMenu } from './AssetInsertMenu'

registerLanguage('en', englishDossier as LangDict, 'dossier')
registerLanguage('en', englishProfile as LangDict, 'profile')
registerLanguage('en', englishShared as LangDict, 'shared')

const assets: ProfileAsset[] = [
  {
    id: 'cv-current',
    name: 'Research CV',
    kind: 'CV',
    description: '',
    versionNumber: 2,
    isPrimary: true,
    attachments: [{
      id: 'cv-file',
      fileId: 'cv-file',
      fileName: 'Research CV.pdf',
    }],
  },
  {
    id: 'cv-archived',
    name: 'Archived CV',
    kind: 'CV',
    description: '',
    versionNumber: 1,
    attachments: [],
  },
  {
    id: 'sop-current',
    name: 'Doctoral SOP',
    kind: 'SOP',
    description: '',
    attachments: [],
  },
]

function renderMenu(props: {
  onInsert: (selected: ProfileAsset[], language: string) => void
}) {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      ready: true,
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <AssetInsertMenu assets={assets} onInsert={props.onInsert} />
    </I18nContext.Provider>,
  )
}

describe('AssetInsertMenu', () => {
  it('renders unmistakable family selection and select-all state', async () => {
    const user = userEvent.setup()
    renderMenu({ onInsert: vi.fn() })

    const trigger = screen.getByRole('button', { name: /insert asset/i })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })
    const cvCheckbox = within(dialog).getByRole('checkbox', { name: /CV \/ Resume/i })
    const sopCheckbox = within(dialog).getByRole('checkbox', { name: /statement of purpose/i })

    await user.click(cvCheckbox)

    expect(cvCheckbox).toBeChecked()
    expect(cvCheckbox.closest('.asset-insert-family-row')).toHaveClass('checked')
    expect(cvCheckbox.closest('.asset-insert-family')).toHaveClass('checked')
    expect(dialog.querySelector('.asset-insert-selected-count')).toHaveTextContent('1')
    expect(dialog.querySelector('.asset-insert-selected-count')).toHaveAccessibleName('1 selected')

    const selectAll = within(dialog).getByRole('button', { name: /^all$/i })
    await user.click(selectAll)

    expect(cvCheckbox).toBeChecked()
    expect(sopCheckbox).toBeChecked()
    expect(selectAll).toHaveAttribute('aria-pressed', 'true')
    expect(dialog.querySelector('.asset-insert-selected-count')).toHaveTextContent('2')

    await user.click(within(dialog).getByRole('button', { name: /^clear$/i }))
    expect(cvCheckbox).not.toBeChecked()
    expect(sopCheckbox).not.toBeChecked()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps collapsed versions inert, labels disclosure, and switches one version in place', async () => {
    const onInsert = vi.fn()
    const user = userEvent.setup()
    renderMenu({ onInsert })

    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })
    const expand = within(dialog).getByRole('button', { name: /expand group: CV \/ Resume/i })
    const versionsId = expand.getAttribute('aria-controls')
    const versions = versionsId ? document.getElementById(versionsId) : null

    expect(versions).toHaveAttribute('aria-hidden', 'true')
    expect(versions).toHaveAttribute('inert')

    await user.click(expand)

    expect(expand).toHaveAccessibleName(/collapse group: CV \/ Resume/i)
    expect(expand.querySelector('.asset-insert-expand-icon')).toHaveClass('open')
    expect(versions).toHaveAttribute('aria-hidden', 'false')
    expect(versions).not.toHaveAttribute('inert')

    await user.click(within(dialog).getByRole('radio', { name: /archived CV/i }))

    const cvFamily = within(dialog).getByRole('checkbox', { name: /CV \/ Resume/i })
      .closest('.asset-insert-family')
    expect(cvFamily).toHaveClass('checked')
    expect(cvFamily?.querySelector('.asset-insert-family-row .asset-insert-version-name'))
      .toHaveTextContent('Archived CV')

    await user.click(expand)
    expect(versions).toHaveAttribute('aria-hidden', 'true')
    expect(versions).toHaveAttribute('inert')

    await user.click(within(dialog).getByRole('button', { name: /^insert$/i }))
    expect(onInsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'cv-archived' })],
      'en',
    )
  })
})
