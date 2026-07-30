import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AiDraftAttachmentSelection, AiDraftEvent, AiDraftInput, AiKey } from '../../api/phdApi'
import englishDossier from '../../i18n/en/dossier.json'
import { getDict, registerLanguage, t as translate, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { AiDraftPanel } from './AiDraftPanel'

registerLanguage('en', englishDossier, 'dossier')

const testKey: AiKey = {
  id: 'key_1',
  ownerId: 'user_1',
  teamId: null,
  scope: 'personal',
  provider: 'openai',
  label: 'Personal OpenAI',
  model: 'gpt-4.1-mini',
  baseUrl: 'https://api.openai.com/v1',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  lastUsedAt: null,
  secretSet: true,
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, resetAt: null },
}

type DraftRunner = (input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) => Promise<void>

function DraftHarness({ onDraft }: { onDraft: DraftRunner }) {
  const [draft, setDraft] = useState({ subject: '', body: '' })
  const [attachmentPlan, setAttachmentPlan] = useState<AiDraftAttachmentSelection[]>([])
  return (
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <output data-testid="draft-output">{`${draft.subject}\n${draft.body}`}</output>
      <output data-testid="output-attachments">{attachmentPlan.map((attachment) => `${attachment.attachmentId}:${attachment.fileName}`).join(',')}</output>
      <AiDraftPanel
        open
        applicationId="app_1"
        aiKeys={[testKey]}
        mode="compose"
        currentDraft={draft}
        draftSessionKey={0}
        onClose={vi.fn()}
        onDraft={onDraft}
        onDraftChange={(change) => setDraft((current) => ({ ...current, ...change }))}
        onAttachmentPlanChange={setAttachmentPlan}
      />
    </I18nContext.Provider>
  )
}

describe('AiDraftPanel revisions', () => {
  it('keeps per-draft source authorization but removes manual attachment planning controls', () => {
    const onDraft = vi.fn<DraftRunner>()
    const view = render(<DraftHarness onDraft={onDraft} />)

    expect(screen.getByRole('button', {
      name: 'Your AI profile, all profile-library material details, and their saved files',
    })).toBeInTheDocument()
    expect(view.container.querySelector('.ai-draft-grant small')).toBeNull()
    expect(screen.getAllByRole('switch')).toHaveLength(6)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(view.container.querySelector('.ai-profile-material-picker')).toBeNull()
    expect(view.container.querySelector('.ai-draft-extra-attachments')).toBeNull()
    expect(view.container.querySelector('.ai-draft-output-attachments')).toBeNull()
  })

  it('revises the editable draft and restores a prior generated version', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<DraftRunner>(async (input, onEvent) => {
      const short = input.instructions.includes('shorter')
      const body = short
        ? 'Subject: Short follow-up\n\nDear Professor Chen,\n\nThank you for your time.'
        : 'Subject: Research fit question\n\nDear Professor Chen,\n\nI am writing to ask about your PhD group.'
      onEvent({ type: 'status', phase: 'drafting' })
      onEvent({ type: 'token', text: body })
      onEvent({ type: 'done', draftOnly: true })
    })
    render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Write a first draft')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: /continue improving/i })).toBeInTheDocument())
    expect(screen.getByTestId('draft-output')).toHaveTextContent('Research fit question')

    await user.type(screen.getByRole('textbox', { name: /continue improving/i }), 'Make it shorter')
    await user.click(screen.getByRole('button', { name: /apply revision/i }))

    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(2))
    expect(onDraft.mock.calls[1][0].currentDraft).toEqual({
      subject: 'Research fit question',
      body: 'Dear Professor Chen,\n\nI am writing to ask about your PhD group.',
    })
    await waitFor(() => expect(screen.getByTestId('draft-output')).toHaveTextContent('Short follow-up'))

    await user.click(screen.getByRole('button', { name: /version 1/i }))
    expect(screen.getByTestId('draft-output')).toHaveTextContent('Research fit question')
  })

  it('authorizes saved material references server-side without reading the file in the browser', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<DraftRunner>(async (_input, onEvent) => {
      onEvent({ type: 'token', text: 'Subject: Attached CV\n\nPlease see the attached CV.' })
      onEvent({ type: 'done', draftOnly: true })
    })
    render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Mention my attached CV')
    await user.click(screen.getByRole('switch', { name: /application materials/i }))
    await user.click(screen.getByRole('button', { name: /generate draft/i }))

    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1))
    expect(onDraft.mock.calls[0][0].grants).toMatchObject({ checklist: true })
    expect(onDraft.mock.calls[0][0]).not.toHaveProperty('attachments')
    expect(onDraft.mock.calls[0][0]).not.toHaveProperty('profileAssetIds')
  })

  it('adds a model-selected safe file to the editable output attachment plan', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<DraftRunner>(async (_input, onEvent) => {
      onEvent({
        type: 'attachment-selection',
        attachments: [{ attachmentId: 'file:cv_1', fileName: 'Jasper-Zhou-CV.pdf' }],
      })
      onEvent({ type: 'status', phase: 'attaching' })
      onEvent({ type: 'token', text: 'Subject: Research fit\n\nDear Professor Chen,' })
      onEvent({ type: 'done', draftOnly: true })
    })
    render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Write a concise introduction')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))

    await waitFor(() => expect(screen.getByTestId('output-attachments')).toHaveTextContent('file:cv_1:Jasper-Zhou-CV.pdf'))
  })
})
