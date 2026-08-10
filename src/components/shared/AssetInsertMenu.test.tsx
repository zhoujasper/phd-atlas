import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  assets?: ProfileAsset[]
}) {
  const { onInsert, assets: menuAssets = assets } = props
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      ready: true,
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <AssetInsertMenu assets={menuAssets} onInsert={onInsert} />
    </I18nContext.Provider>,
  )
}

function makeAsset(id: string, kind: string, versionNumber: number): ProfileAsset {
  return {
    id,
    name: `${kind} ${versionNumber}`,
    kind,
    description: '',
    versionNumber,
    attachments: [],
  }
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 820px)' ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
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

  it('keeps collapsed versions inert, labels disclosure, and selects a version in place', async () => {
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

    await user.click(within(dialog).getByRole('checkbox', { name: /archived CV/i }))

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

  it('keeps several versions of one type selected together', async () => {
    const onInsert = vi.fn()
    const user = userEvent.setup()
    renderMenu({ onInsert })

    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })
    const expand = within(dialog).getByRole('button', { name: /expand group: CV \/ Resume/i })
    await user.click(expand)
    const versions = within(document.getElementById(expand.getAttribute('aria-controls') ?? '') as HTMLElement)

    // Picking a second version must add to the first, not replace it.
    await user.click(versions.getByRole('checkbox', { name: /archived CV/i }))
    await user.click(versions.getByRole('checkbox', { name: /research CV/i }))

    expect(versions.getByRole('checkbox', { name: /archived CV/i })).toBeChecked()
    expect(versions.getByRole('checkbox', { name: /research CV/i })).toBeChecked()
    expect(dialog.querySelector('.asset-insert-selected-count')).toHaveTextContent('2')
    expect(dialog.querySelector('.asset-insert-extra-count')).toHaveTextContent('+1 more')

    await user.click(within(dialog).getByRole('button', { name: /^insert$/i }))
    expect(onInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cv-archived' }),
        expect.objectContaining({ id: 'cv-current' }),
      ]),
      'en',
    )
    expect(onInsert.mock.calls[0][0]).toHaveLength(2)
  })

  it('clears every version of a type when its row is unchecked', async () => {
    const user = userEvent.setup()
    renderMenu({ onInsert: vi.fn() })

    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })
    const expand = within(dialog).getByRole('button', { name: /expand group: CV \/ Resume/i })
    await user.click(expand)
    const versions = within(document.getElementById(expand.getAttribute('aria-controls') ?? '') as HTMLElement)

    await user.click(versions.getByRole('checkbox', { name: /archived CV/i }))
    await user.click(versions.getByRole('checkbox', { name: /research CV/i }))

    const familyRow = dialog.querySelector('.asset-insert-family-row input') as HTMLInputElement
    await user.click(familyRow)

    expect(familyRow).not.toBeChecked()
    expect(versions.getByRole('checkbox', { name: /archived CV/i })).not.toBeChecked()
    expect(versions.getByRole('checkbox', { name: /research CV/i })).not.toBeChecked()
    // The badge stays mounted for its exit animation; presence is the signal.
    expect(dialog.querySelector('.asset-insert-selected-count-presence'))
      .toHaveAttribute('data-present', 'false')
  })

  it('slides the language selection and hands resident text layers over in place', async () => {
    const user = userEvent.setup()
    renderMenu({ onInsert: vi.fn() })

    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })
    const languageGroup = within(dialog).getByRole('radiogroup')
    const english = within(languageGroup).getByRole('radio', { name: 'English' })
    const chinese = within(languageGroup).getByRole('radio', { name: '中文' })
    const textTransitions = dialog.querySelectorAll<HTMLElement>('.asset-insert-language-text')
    const firstPrimaryLayer = textTransitions[0]?.querySelector<HTMLElement>('[data-language-index="0"]')

    expect(languageGroup).toHaveAttribute('data-active-index', '0')
    expect(english).toHaveAttribute('aria-checked', 'true')
    expect(chinese).toHaveAttribute('aria-checked', 'false')
    expect(languageGroup.querySelector('.asset-insert-lang-indicator')).toBeInTheDocument()
    expect(textTransitions.length).toBeGreaterThan(0)
    for (const transition of textTransitions) {
      expect(transition).toHaveAttribute('data-active-index', '0')
      expect(transition.querySelector('[data-language-index="0"]')).toHaveAttribute('aria-hidden', 'false')
      expect(transition.querySelector('[data-language-index="1"]')).toHaveAttribute('aria-hidden', 'true')
    }

    await user.click(chinese)

    expect(languageGroup).toHaveAttribute('data-active-index', '1')
    expect(english).toHaveAttribute('aria-checked', 'false')
    expect(chinese).toHaveAttribute('aria-checked', 'true')
    for (const transition of textTransitions) {
      expect(transition).toHaveAttribute('data-active-index', '1')
      expect(transition.querySelector('[data-language-index="0"]')).toHaveAttribute('aria-hidden', 'true')
      expect(transition.querySelector('[data-language-index="1"]')).toHaveAttribute('aria-hidden', 'false')
    }
    expect(firstPrimaryLayer?.isConnected).toBe(true)

    await user.click(english)
    expect(languageGroup).toHaveAttribute('data-active-index', '0')
    expect(firstPrimaryLayer?.isConnected).toBe(true)
  })
})

describe('AssetInsertMenu progressive rendering', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bounds desktop family rendering', async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    const manyFamilies = Array.from({ length: 25 }, (_, index) => makeAsset(`family-${index}`, `Family ${index}`, 1))
    renderMenu({ onInsert: vi.fn(), assets: manyFamilies })

    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })

    expect(dialog.querySelectorAll('.asset-insert-family')).toHaveLength(20)
    await user.click(within(dialog).getByRole('button', { name: /show 5 more materials/i }))
    expect(dialog.querySelectorAll('.asset-insert-family')).toHaveLength(25)
  })

  it('bounds expanded desktop version rendering', async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    const versionFamily = Array.from({ length: 25 }, (_, index) => makeAsset(`version-${index}`, 'CV', index + 1))
    renderMenu({ onInsert: vi.fn(), assets: versionFamily })
    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })

    await user.click(within(dialog).getByRole('button', { name: /expand group: CV/i }))
    expect(dialog.querySelectorAll('.asset-insert-version-row')).toHaveLength(20)
    await user.click(within(dialog).getByRole('button', { name: /show 5 more materials/i }))
    expect(dialog.querySelectorAll('.asset-insert-version-row')).toHaveLength(25)
  })

  it('bounds compact viewport family rendering to 10', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const manyFamilies = Array.from({ length: 25 }, (_, index) => makeAsset(`family-${index}`, `Family ${index}`, 1))
    renderMenu({ onInsert: vi.fn(), assets: manyFamilies })

    await user.click(screen.getByRole('button', { name: /insert asset/i }))
    const dialog = screen.getByRole('dialog', { name: /select one or more snippets/i })

    expect(dialog.querySelectorAll('.asset-insert-family')).toHaveLength(10)
    expect(within(dialog).getByRole('button', { name: /show 10 more materials/i })).toBeInTheDocument()
  })
})
