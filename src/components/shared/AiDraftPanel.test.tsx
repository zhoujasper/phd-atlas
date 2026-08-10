import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AiDraftAttachmentSelection, AiDraftEvent, AiDraftInput, AiKey, ProfileAsset } from '../../api/phdApi'
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
  maxConcurrency: 1,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  lastUsedAt: null,
  secretSet: true,
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, resetAt: null },
}

type DraftRunner = (input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) => Promise<void>

const profileMaterials: ProfileAsset[] = [
  { id: 'asset_cv', name: 'Research CV 2026', kind: 'cv', description: 'Publications and teaching.', attachments: [] },
  { id: 'asset_sop', name: 'Statement of purpose', kind: 'sop', description: 'Why this lab.', attachments: [] },
  { id: 'asset_plan', name: 'Research plan', kind: 'researchPlan', description: 'Three-year outline.', attachments: [] },
]

function DraftHarness({
  onDraft,
  applicationId = 'app_1',
  draftSessionKey = 0,
  profileAssets,
}: {
  onDraft: DraftRunner
  applicationId?: string
  draftSessionKey?: number
  profileAssets?: ProfileAsset[]
}) {
  const [draft, setDraft] = useState({ subject: '', body: '' })
  const [attachmentPlan, setAttachmentPlan] = useState<AiDraftAttachmentSelection[]>([])
  const [generating, setGenerating] = useState(false)
  return (
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <output data-testid="draft-output">{`${draft.subject}\n${draft.body}`}</output>
      <output data-testid="output-attachments">{attachmentPlan.map((attachment) => `${attachment.attachmentId}:${attachment.fileName}`).join(',')}</output>
      <output data-testid="generating-output">{generating ? 'generating' : 'idle'}</output>
      <button type="button" onClick={() => setDraft({ subject: 'Manual subject', body: 'Manual body' })}>Edit draft manually</button>
      <AiDraftPanel
        open
        applicationId={applicationId}
        aiKeys={[testKey]}
        profileAssets={profileAssets}
        mode="compose"
        currentDraft={draft}
        draftSessionKey={draftSessionKey}
        onClose={vi.fn()}
        onDraft={onDraft}
        onDraftChange={(change) => setDraft((current) => ({ ...current, ...change }))}
        onAttachmentPlanChange={setAttachmentPlan}
        onGeneratingChange={setGenerating}
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

  it('searches the profile library and narrows the grant to the chosen materials', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<DraftRunner>(async (_input, onEvent) => {
      onEvent({ type: 'token', text: 'Subject: Narrowed\n\nBody.' })
      onEvent({ type: 'done', draftOnly: true })
    })
    render(<DraftHarness onDraft={onDraft} profileAssets={profileMaterials} />)

    await user.click(screen.getByRole('button', { name: 'Choose which materials to share' }))
    expect((await screen.findAllByText('All 3 materials')).length).toBeGreaterThan(0)

    await user.type(screen.getByRole('searchbox'), 'research')
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2))
    expect(screen.getByText('Research CV 2026')).toBeInTheDocument()
    expect(screen.queryByText('Statement of purpose')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Research CV 2026/ }))
    await user.click(screen.getByRole('checkbox', { name: /Research plan/ }))
    expect(screen.getAllByText('2 selected').length).toBeGreaterThan(0)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Introduce me')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))

    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1))
    expect(onDraft.mock.calls[0][0].grants).toMatchObject({
      userProfile: true,
      profileAssetIds: ['asset_cv', 'asset_plan'],
    })
  })

  it('sends no narrowing when the profile grant still covers everything', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<DraftRunner>(async (_input, onEvent) => {
      onEvent({ type: 'token', text: 'Subject: Everything\n\nBody.' })
      onEvent({ type: 'done', draftOnly: true })
    })
    render(<DraftHarness onDraft={onDraft} profileAssets={profileMaterials} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Introduce me')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))

    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1))
    expect(onDraft.mock.calls[0][0].grants.userProfile).toBe(true)
    expect(onDraft.mock.calls[0][0].grants).not.toHaveProperty('profileAssetIds')
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

  it('keeps a newer generation resident when an aborted older request settles late', async () => {
    const user = userEvent.setup()
    const runs: Array<{
      onEvent: (event: AiDraftEvent) => void
      signal?: AbortSignal
      resolve: () => void
    }> = []
    const onDraft = vi.fn<DraftRunner>((_input, onEvent, signal) => new Promise<void>((resolve) => {
      runs.push({ onEvent, signal, resolve })
    }))
    const view = render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'First request')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))
    await waitFor(() => expect(runs).toHaveLength(1))

    view.rerender(<DraftHarness onDraft={onDraft} applicationId="app_2" draftSessionKey={1} />)
    await waitFor(() => expect(runs[0].signal?.aborted).toBe(true))
    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Second request')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))
    await waitFor(() => expect(runs).toHaveLength(2))

    await act(async () => {
      runs[0].onEvent({ type: 'token', text: 'Subject: Stale draft\n\nThis must not return.' })
      runs[0].onEvent({ type: 'done', draftOnly: true })
      runs[0].resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('draft-output')).not.toHaveTextContent('Stale draft')
    expect(screen.getByTestId('generating-output')).toHaveTextContent('generating')
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()

    await act(async () => {
      runs[1].onEvent({ type: 'token', text: 'Subject: Current draft\n\nThis one belongs here.' })
      runs[1].onEvent({ type: 'done', draftOnly: true })
      runs[1].resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByTestId('draft-output')).toHaveTextContent('Current draft'))
    expect(screen.getByTestId('generating-output')).toHaveTextContent('idle')
  })

  it('revokes stream ownership when the user edits and ignores every later chunk', async () => {
    const user = userEvent.setup()
    let onEvent: ((event: AiDraftEvent) => void) | undefined
    let signal: AbortSignal | undefined
    let resolve: (() => void) | undefined
    const onDraft = vi.fn<DraftRunner>((_input, nextEvent, nextSignal) => new Promise<void>((done) => {
      onEvent = nextEvent
      signal = nextSignal
      resolve = done
    }))
    render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Stream a draft')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))
    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1))
    act(() => onEvent?.({ type: 'token', text: 'Subject: AI partial\n\nPartial body' }))
    await waitFor(() => expect(screen.getByTestId('draft-output')).toHaveTextContent('AI partial'))

    await user.click(screen.getByRole('button', { name: 'Edit draft manually' }))
    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(screen.getByTestId('draft-output')).toHaveTextContent('Manual subject Manual body')

    await act(async () => {
      onEvent?.({ type: 'token', text: ' that arrived late' })
      onEvent?.({ type: 'done', draftOnly: true })
      resolve?.()
      await Promise.resolve()
    })

    expect(screen.getByTestId('draft-output')).toHaveTextContent('Manual subject Manual body')
    expect(screen.getByTestId('draft-output')).not.toHaveTextContent('arrived late')
    expect(screen.getByTestId('generating-output')).toHaveTextContent('idle')
  })

  it('keeps the last streamed partial draft editable after Stop', async () => {
    const user = userEvent.setup()
    let onEvent: ((event: AiDraftEvent) => void) | undefined
    let signal: AbortSignal | undefined
    const onDraft = vi.fn<DraftRunner>((_input, nextEvent, nextSignal) => new Promise<void>(() => {
      onEvent = nextEvent
      signal = nextSignal
    }))
    render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Stream a draft')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))
    await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1))
    act(() => onEvent?.({ type: 'token', text: 'Subject: Keep this\n\nStable partial body' }))
    await waitFor(() => expect(screen.getByTestId('draft-output')).toHaveTextContent('Stable partial body'))

    await user.click(screen.getByRole('button', { name: /stop/i }))

    expect(signal?.aborted).toBe(true)
    expect(screen.getByTestId('draft-output')).toHaveTextContent('Keep this Stable partial body')
    expect(screen.getByTestId('generating-output')).toHaveTextContent('idle')
    act(() => onEvent?.({ type: 'token', text: ' late overwrite' }))
    expect(screen.getByTestId('draft-output')).not.toHaveTextContent('late overwrite')
  })

  it('keeps the last streamed partial draft editable after a rejected request', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<DraftRunner>(async (_input, onEvent) => {
      onEvent({ type: 'token', text: 'Subject: Recoverable\n\nKeep the partial response.' })
      throw new Error('network unavailable')
    })
    render(<DraftHarness onDraft={onDraft} />)

    await user.type(screen.getByRole('textbox', { name: /what should this email accomplish/i }), 'Stream a draft')
    await user.click(screen.getByRole('button', { name: /generate draft/i }))

    await waitFor(() => expect(screen.getByTestId('generating-output')).toHaveTextContent('idle'))
    expect(screen.getByTestId('draft-output')).toHaveTextContent('Recoverable Keep the partial response.')
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeInTheDocument()
  })
})
