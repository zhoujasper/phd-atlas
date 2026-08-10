import '@testing-library/jest-dom/vitest'
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileAsset } from '../../api/phdApi'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import englishDossier from '../../i18n/en/dossier.json'
import englishProfile from '../../i18n/en/profile.json'
import englishShared from '../../i18n/en/shared.json'
import { prepareForSafeReload } from '../../safeReload'
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

type SnippetEditorDialogProps = ComponentProps<typeof SnippetEditorDialog>

function renderSnippetEditor(overrides: Partial<SnippetEditorDialogProps> = {}) {
  const onCreate = vi.fn()
  const onUpdate = vi.fn()
  const props: SnippetEditorDialogProps = {
    open: true,
    asset: null,
    globalPhrase: { leadZh: '', tailZh: '', leadEn: '', tailEn: '' },
    onClose: vi.fn(),
    onCreate,
    onUpdate,
    onUploadFiles: vi.fn(),
    onRenameFile: vi.fn(),
    onDeleteFile: vi.fn(),
    onDownloadFile: vi.fn(),
    onCreateShare: vi.fn(),
    onRevokeShare: vi.fn(),
    ...overrides,
  }

  const view = render(
    <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
      <SnippetEditorDialog {...props} />
    </I18nContext.Provider>,
  )

  return { onCreate, onUpdate, props, ...view }
}

function getDialogElement(dialog: HTMLElement, selector: string) {
  const element = dialog.querySelector<HTMLElement>(selector)
  expect(element).not.toBeNull()
  return element as HTMLElement
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
}

async function getReadyMarkdownTextbox(dialog: HTMLElement, name: string) {
  return waitFor(() => {
    const textbox = within(dialog).getByRole('textbox', { name })
    expect(textbox).not.toHaveAttribute('aria-busy', 'true')
    return textbox
  }, { timeout: 15_000 })
}

describe('SnippetEditorDialog appearance', () => {
  it('defers preset insert-phrase design until after attachments and expands it on demand', async () => {
    const user = userEvent.setup()
    renderSnippetEditor({
      initialKind: 'CV',
      initialName: 'Academic CV',
      fromPreset: true,
    })

    const dialog = screen.getByRole('dialog', { name: /use preset/i })
    const advancedTrigger = within(dialog).getByRole('button', {
      name: t('en', 'profile.advancedSettings'),
    })
    const attachments = getDialogElement(dialog, '.snippet-attachments-section')
    const advancedPanel = getDialogElement(dialog, '#snippet-advanced-design')

    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(advancedPanel).toHaveAttribute('aria-hidden', 'true')
    expect(advancedPanel).toBeEmptyDOMElement()
    expectBefore(attachments, advancedPanel)
    expect(within(dialog).queryByText(t('en', 'profile.writingBriefHint'))).not.toBeInTheDocument()
    expect(within(dialog).queryByText(t('en', 'profile.optional'))).not.toBeInTheDocument()
    expect(within(dialog).queryByText(t('en', 'profile.officialSource'))).not.toBeInTheDocument()
    expect(within(dialog).queryByText(t('en', 'profile.wordLimit'))).not.toBeInTheDocument()
    expect(within(dialog).queryByText(t('en', 'profile.pageLimit'))).not.toBeInTheDocument()
    expect(within(dialog).queryByText(t('en', 'profile.customBriefFields'))).not.toBeInTheDocument()

    await user.click(advancedTrigger)

    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(advancedPanel).toHaveAttribute('aria-hidden', 'false')
    expect(within(advancedPanel).getByText(t('en', 'profile.insertPhraseName'))).toBeInTheDocument()

    await user.click(advancedTrigger)

    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(advancedPanel).toBeEmptyDOMElement())
  })

  it('keeps preset requirements and content as non-persistent writing hints', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderSnippetEditor({
      initialKind: 'Scholarship Essay',
      initialName: 'Funding essay',
      fromPreset: true,
    })

    const dialog = screen.getByRole('dialog', { name: /use preset/i })
    const requirements = await getReadyMarkdownTextbox(
      dialog,
      t('en', 'profile.writingBrief'),
    )
    const content = await getReadyMarkdownTextbox(
      dialog,
      t('en', 'profile.snippetContent'),
    )

    expect(requirements).toHaveTextContent('')
    expect(content).toHaveTextContent('')
    expect(requirements).toHaveAttribute('aria-placeholder', t('en', 'profile.presetScholarshipEssayHint'))
    expect(within(dialog).getByText(/Scholarship \/ fellowship essay\./)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: t('en', 'profile.saveSnippet') }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      description: '',
      writingBrief: undefined,
    }), [])
  })

  it('changes the writing-requirements hint with the selected system preset', async () => {
    const user = userEvent.setup()
    renderSnippetEditor({ initialName: 'Application material' })

    const dialog = screen.getByRole('dialog', { name: /add snippet/i })
    await user.click(within(dialog).getByRole('button', {
      name: t('en', 'profile.presetScholarshipEssay'),
    }))

    const requirements = await getReadyMarkdownTextbox(
      dialog,
      t('en', 'profile.writingBrief'),
    )
    expect(requirements).toHaveAttribute('aria-placeholder', t('en', 'profile.presetScholarshipEssayHint'))

    await user.click(within(dialog).getByRole('button', {
      name: t('en', 'profile.presetCoverLetter'),
    }))

    expect(within(dialog).getByRole('textbox', {
      name: t('en', 'profile.writingBrief'),
    })).toHaveAttribute('aria-placeholder', t('en', 'profile.presetCoverLetterHint'))
  })

  it('keeps blank custom creation expanded before attachments', () => {
    renderSnippetEditor({ initialName: 'Research overview' })

    const dialog = screen.getByRole('dialog', { name: /add snippet/i })
    const advancedTrigger = within(dialog).getByRole('button', {
      name: t('en', 'profile.advancedSettings'),
    })
    const attachments = getDialogElement(dialog, '.snippet-attachments-section')
    const advancedPanel = getDialogElement(dialog, '#snippet-advanced-design')

    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(advancedPanel).toHaveAttribute('aria-hidden', 'false')
    expectBefore(advancedPanel, attachments)
  })

  it('moves the custom insert-phrase panel ahead of attachments when selected from Add snippet', async () => {
    const user = userEvent.setup()
    renderSnippetEditor({ initialKind: 'CV', initialName: 'Research overview' })

    const dialog = screen.getByRole('dialog', { name: /add snippet/i })
    await user.click(within(dialog).getByRole('button', { name: t('en', 'profile.presetCustom') }))

    const advancedTrigger = within(dialog).getByRole('button', {
      name: t('en', 'profile.advancedSettings'),
    })
    const attachments = getDialogElement(dialog, '.snippet-attachments-section')
    const advancedPanel = getDialogElement(dialog, '#snippet-advanced-design')
    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(advancedPanel).toHaveAttribute('aria-hidden', 'false')
    expectBefore(advancedPanel, attachments)
    expect(within(advancedPanel).getByText(t('en', 'profile.snippetPhrasePreviewTitle'))).toBeInTheDocument()
  })

  it('adds a half-width writing section after notes and persists it', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderSnippetEditor({ initialName: 'Research statement' })
    const dialog = screen.getByRole('dialog', { name: /add snippet/i })
    const notes = getDialogElement(dialog, '.snippet-notes-field')
    const addContent = getDialogElement(dialog, '.snippet-writing-section-add')

    expectBefore(notes, addContent)

    await user.click(within(dialog).getByRole('button', {
      name: t('en', 'profile.addSection'),
    }))
    const layoutGroup = await within(dialog).findByRole('group', {
      name: t('en', 'profile.sectionLayout'),
    })
    await user.click(within(layoutGroup).getByRole('button', {
      name: t('en', 'profile.sectionTwoColumns'),
    }))
    fireEvent.change(
      within(dialog).getByRole('textbox', {
        name: tpl(t('en', 'profile.sectionTitleLabel'), { count: 1 }),
      }),
      { target: { value: 'Research focus' } },
    )
    const sectionContentEditor = await getReadyMarkdownTextbox(
      dialog,
      tpl(t('en', 'profile.sectionContentLabel'), { count: 1 }),
    )
    const sectionContentRoot = sectionContentEditor.closest<HTMLElement>('.markdown-textarea')
    if (sectionContentRoot) {
      await user.click(within(sectionContentRoot).getByRole('button', { name: /Edit source/ }))
      const sectionContentSource = within(sectionContentRoot).getByRole('textbox', {
        name: tpl(t('en', 'profile.sectionContentLabel'), { count: 1 }),
      }) as HTMLTextAreaElement
      fireEvent.change(sectionContentSource, { target: { value: 'Phase-field modelling evidence' } })
      fireEvent.blur(sectionContentSource)
    } else {
      fireEvent.change(sectionContentEditor, { target: { value: 'Phase-field modelling evidence' } })
    }
    await user.click(within(dialog).getByRole('button', {
      name: t('en', 'profile.saveSnippet'),
    }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      writingBrief: expect.objectContaining({
        sections: [expect.objectContaining({
          title: 'Research focus',
          content: 'Phase-field modelling evidence',
          width: 'half',
        })],
      }),
    }), [])
  })

  it('keeps the editor open until a create request is durably acknowledged', async () => {
    const user = userEvent.setup()
    let resolveCreate!: () => void
    const onCreate = vi.fn(() => new Promise<void>((resolve) => {
      resolveCreate = resolve
    }))
    const onClose = vi.fn()
    renderSnippetEditor({ initialName: 'Durable custom material', onCreate, onClose })

    const dialog = screen.getByRole('dialog', { name: /add snippet/i })
    const save = within(dialog).getByRole('button', { name: t('en', 'profile.saveSnippet') })
    await user.click(save)

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(save).toBeDisabled()

    resolveCreate()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 1000 })
  })

  it('keeps a failed attachment upload retryable instead of treating it as saved', async () => {
    const onUploadFiles = vi.fn(async () => {
      throw new Error('upload failed')
    })
    const reservedAsset: ProfileAsset = {
      ...asset,
      id: 'asset-upload-retry',
      uploadReserved: true,
    }
    renderSnippetEditor({ asset: reservedAsset, onUploadFiles })

    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    const reservation = within(dialog).getByRole('checkbox')
    expect(reservation).toBeChecked()

    const dropzone = within(dialog).getByRole('button', { name: /upload files/i })
    const file = new File(['resume'], 'resume.pdf', { type: 'application/pdf' })
    fireEvent.drop(dropzone, { dataTransfer: { files: [file], dropEffect: 'none' } })

    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith('asset-upload-retry', [file]))
    expect(reservation).toBeChecked()
    expect(dialog).toBeInTheDocument()
  })

  it('keeps an attachment rename editor open when the durable rename fails', async () => {
    const user = userEvent.setup()
    const onRenameFile = vi.fn(async () => {
      throw new Error('rename failed')
    })
    const assetWithFile: ProfileAsset = {
      ...asset,
      id: 'asset-rename-retry',
      attachments: [{ id: 'attachment-cv', fileId: 'file-cv', fileName: 'Resume.pdf', mimeType: 'application/pdf' }],
    }
    renderSnippetEditor({ asset: assetWithFile, onRenameFile })

    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    await user.click(within(dialog).getByRole('button', { name: t('en', 'profile.renameFile') }))
    const input = within(dialog).getByRole('textbox', { name: t('en', 'profile.renameFile') })
    fireEvent.change(input, { target: { value: 'Updated resume.pdf' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onRenameFile).toHaveBeenCalledWith('asset-rename-retry', 'file-cv', 'Updated resume.pdf'))
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('Updated resume.pdf')
  })

  it('keeps the share form and note when link creation fails', async () => {
    const user = userEvent.setup()
    const onCreateShare = vi.fn(async () => {
      throw new Error('share failed')
    })
    renderSnippetEditor({
      asset: { ...asset, id: 'asset-share-retry', uploadReserved: true },
      onCreateShare,
    })

    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    await user.click(within(dialog).getByRole('button', { name: t('en', 'profile.shareUpload') }))
    const note = within(dialog).getByPlaceholderText(t('en', 'profile.linkNotePlaceholder'))
    fireEvent.change(note, { target: { value: 'review access' } })
    await user.click(within(dialog).getByRole('button', { name: t('en', 'profile.createLink') }))

    await waitFor(() => expect(onCreateShare).toHaveBeenCalledWith('asset-share-retry', '7d', 'review access'))
    expect(note).toHaveValue('review access')
    expect(within(dialog).getByRole('button', { name: t('en', 'profile.shareUpload') })).toBeInTheDocument()
  })

  it('animates the section and sibling reflow when switching between full and half width', async () => {
    const user = userEvent.setup()
    const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const animate = vi.fn((..._args: unknown[]) => ({
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }) as unknown as Animation)
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    })

    try {
      const writingAsset: ProfileAsset = {
        ...asset,
        id: 'asset-section-layout',
        writingBrief: {
          sections: [
            { id: 'section-a', title: 'A', content: 'First', width: 'half' },
            { id: 'section-b', title: 'B', content: 'Second', width: 'half' },
          ],
        },
      }
      renderSnippetEditor({ asset: writingAsset })
      const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
      const sections = Array.from(dialog.querySelectorAll<HTMLElement>('[data-writing-section-id]'))
      let reads = 0
      const rects = [
        { left: 0, top: 0, width: 400, height: 120 },
        { left: 410, top: 0, width: 400, height: 120 },
        { left: 0, top: 0, width: 820, height: 140 },
        { left: 0, top: 160, width: 820, height: 140 },
      ]
      sections.forEach((section) => {
        vi.spyOn(section, 'getBoundingClientRect').mockImplementation(() => {
          const rect = rects[Math.min(reads, rects.length - 1)]
          reads += 1
          return { ...rect, toJSON: () => rect } as DOMRect
        })
      })

      await user.click(within(dialog).getAllByRole('radio', {
        name: t('en', 'profile.sectionSingleColumn'),
      })[0])

      expect(animate).toHaveBeenCalledTimes(2)
      expect(animate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        duration: 320,
        fill: 'both',
      }))
    } finally {
      if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
      else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    }
  })

  it('round-trips hidden legacy brief metadata and saved sections while editing', async () => {
    const user = userEvent.setup()
    const legacyWritingBrief = {
      requirements: 'Follow the programme prompt.',
      sourceUrl: 'https://example.edu/programme/prompt',
      wordLimit: 1200,
      pageLimit: 2,
      customFields: [{
        id: 'legacy-focus',
        label: 'Evidence checklist',
        value: 'Connect each claim to a result.',
        includeInExport: true,
        placement: 'beforeBody' as const,
      }],
      sections: [{
        id: 'saved-context',
        title: 'Project context',
        content: 'A concise supporting note.',
        width: 'half' as const,
      }],
    }
    const legacyAsset: ProfileAsset = {
      ...asset,
      id: 'asset-legacy-brief',
      name: 'Statement of purpose',
      kind: 'SOP',
      writingBrief: legacyWritingBrief,
    }
    const { onUpdate } = renderSnippetEditor({ asset: legacyAsset })
    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })

    expect(within(dialog).queryByDisplayValue(legacyWritingBrief.sourceUrl)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', {
      name: t('en', 'profile.saveSnippet'),
    }))

    expect(onUpdate).toHaveBeenCalledWith('asset-legacy-brief', expect.objectContaining({
      writingBrief: {
        ...legacyWritingBrief,
        customFields: legacyWritingBrief.customFields,
        sections: legacyWritingBrief.sections,
      },
    }))
  })

  it('keeps the resident draft when a same-asset background snapshot arrives', () => {
    const editingAsset: ProfileAsset = {
      ...asset,
      id: 'asset-resident-draft',
      writingBrief: {
        sections: [{
          id: 'resident-section',
          title: 'Server title',
          content: 'Server content',
          width: 'full',
        }],
      },
    }
    const { props, rerender } = renderSnippetEditor({ asset: editingAsset })
    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'My in-progress name' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Section 1 title' }), {
      target: { value: 'My in-progress section' },
    })

    const refreshedAsset: ProfileAsset = {
      ...editingAsset,
      name: 'Stale server name',
      updatedAt: '2026-08-02T10:00:00.000Z',
      writingBrief: {
        sections: [{
          id: 'resident-section',
          title: 'Stale server section',
          content: 'Stale server content',
          width: 'full',
        }],
      },
    }
    rerender(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SnippetEditorDialog {...props} asset={refreshedAsset} />
      </I18nContext.Provider>,
    )

    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('My in-progress name')
    expect(within(dialog).getByRole('textbox', { name: 'Section 1 title' })).toHaveValue('My in-progress section')
  })

  it('blocks automatic reload and keeps a rejected snippet save retryable', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockRejectedValue(new Error('Snippet save failed'))
    renderSnippetEditor({ asset, onUpdate })
    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    const nameInput = within(dialog).getByRole('textbox', { name: 'Name' })

    await user.clear(nameInput)
    await user.type(nameInput, 'Resident profile draft')
    await expect(prepareForSafeReload({ reason: 'identity-change' })).resolves.toBe(false)

    await user.click(within(dialog).getByRole('button', {
      name: t('en', 'profile.saveSnippet'),
    }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('dialog', { name: /edit snippet/i })).toBeInTheDocument()
    expect(nameInput).toHaveValue('Resident profile draft')
    await expect(prepareForSafeReload({ reason: 'lazy-module' })).resolves.toBe(false)
  })

  it('keeps a failed document export retryable and marks only a successful retry complete', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onExport = vi.fn()
      .mockRejectedValueOnce(new Error('Export route unavailable'))
      .mockResolvedValueOnce(undefined)
    renderSnippetEditor({ asset, onUpdate, onExport })

    const dialog = screen.getByRole('dialog', { name: /edit snippet/i })
    const pdfButton = within(dialog).getByRole('button', { name: 'PDF' })

    await user.click(pdfButton)
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(pdfButton).toBeEnabled())
    expect(onUpdate).toHaveBeenNthCalledWith(1, asset.id, expect.objectContaining({
      description: asset.description,
    }))
    expect(onUpdate.mock.invocationCallOrder[0]).toBeLessThan(onExport.mock.invocationCallOrder[0])
    expect(pdfButton).not.toHaveClass('is-complete')

    await user.click(pdfButton)
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(pdfButton).toHaveClass('is-complete'))
    expect(onExport).toHaveBeenLastCalledWith(asset.id, 'pdf')
  })

  it('supports a metadata-only team preset flow with destination context', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SnippetEditorDialog
          open
          asset={null}
          initialKind="CV"
          initialName="Academic CV"
          fromPreset
          attachmentsEnabled={false}
          contextLabel="Lina Zhao's reusable library"
          globalPhrase={{ leadZh: '', tailZh: '', leadEn: '', tailEn: '' }}
          onClose={vi.fn()}
          onCreate={onCreate}
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

    const dialog = screen.getByRole('dialog', { name: /use preset/i })
    expect(within(dialog).getByText("Lina Zhao's reusable library")).toBeInTheDocument()
    expect(within(dialog).queryByText('Attachments')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Academic CV',
      kind: 'CV',
      description: '',
      uploadReserved: false,
    }), [])
  })

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

  it('reveals share upload after reservation, restores saved links, and previews attachments', async () => {
    const user = userEvent.setup()
    const onLoadFile = vi.fn(async () => new Blob(['CV preview'], { type: 'text/plain' }))
    const assetWithFile: ProfileAsset = {
      ...asset,
      uploadReserved: false,
      attachments: [{ id: 'attachment-cv', fileId: 'file-cv', fileName: 'Resume.txt', mimeType: 'text/plain' }],
      shares: [{
        id: 'share-cv',
        token: 'persisted-token',
        url: '',
        createdAt: '2026-07-22T00:00:00.000Z',
        expiresAt: null,
      }],
    }

    render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <SnippetEditorDialog
          open
          asset={assetWithFile}
          globalPhrase={{ leadZh: '', tailZh: '', leadEn: '', tailEn: '' }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onUploadFiles={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDownloadFile={vi.fn()}
          onLoadFile={onLoadFile}
          onCreateShare={vi.fn()}
          onRevokeShare={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const editor = screen.getByRole('dialog', { name: /edit snippet/i })
    expect(within(editor).queryByRole('button', { name: 'Share upload' })).not.toBeInTheDocument()
    expect(within(editor).getByText('/asset-upload/persisted-token')).toBeInTheDocument()

    await user.click(within(editor).getByText('Reserve upload'))
    expect(await within(editor).findByRole('button', { name: 'Share upload' })).toBeInTheDocument()

    await user.click(within(editor).getByRole('button', { name: 'File preview' }))
    expect(await screen.findByRole('dialog', { name: 'Resume.txt' })).toBeInTheDocument()
    expect(onLoadFile).toHaveBeenCalledWith('file-cv')
    expect(await screen.findByText('CV preview')).toBeInTheDocument()
  })
})
