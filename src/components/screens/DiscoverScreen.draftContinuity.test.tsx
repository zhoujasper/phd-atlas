import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INTAKE, DEFAULT_RANKER, defaultDiscoverState, type DiscoverIntake, type DiscoverRankerWeights } from '../../data/discover'
import { DiscoverScreen } from './DiscoverScreen'

const apiMocks = vi.hoisted(() => ({
  getDiscoverCatalog: vi.fn(),
  listAiKeys: vi.fn(),
  updateDiscoverState: vi.fn(),
  runDiscoverResearch: vi.fn(),
}))

vi.mock('../../api/phdApi', () => ({
  phdApi: apiMocks,
  readSessionTokenSubject: () => 'user-1',
}))

vi.mock('../hooks/useI18n', () => {
  const tx = (path: string, fallback?: string) => fallback ?? path
  return { useI18n: () => ({ lang: 'en', tx }) }
})

vi.mock('../hooks/useVisibilityAwarePolling', () => ({ useVisibilityAwarePolling: () => undefined }))

vi.mock('../shared/ConfirmDialog', () => ({ ConfirmDialog: () => null }))

vi.mock('../shared/DiscoverWorkspace', () => ({
  DiscoverWorkspace: ({
    programNoteDrafts,
    piNoteDrafts,
    rankerDraft,
    actions,
  }: {
    programNoteDrafts: Record<string, string>
    piNoteDrafts: Record<string, string>
    rankerDraft: DiscoverRankerWeights
    actions: {
      updateProgramNote: (id: string, value: string) => void
      updatePiNote: (id: string, value: string) => void
      setRankerWeight: (key: keyof DiscoverRankerWeights, value: number) => void
    }
  }) => (
    <div>
      <input
        aria-label="Program note"
        value={programNoteDrafts['program-1'] ?? ''}
        onChange={(event) => actions.updateProgramNote('program-1', event.target.value)}
      />
      <input
        aria-label="PI note"
        value={piNoteDrafts['pi-1'] ?? ''}
        onChange={(event) => actions.updatePiNote('pi-1', event.target.value)}
      />
      <output aria-label="Fit weight">{rankerDraft.fit}</output>
      <button type="button" onClick={() => actions.setRankerWeight('fit', 91)}>Edit fit weight</button>
    </div>
  ),
}))

vi.mock('../shared/DiscoverResearchSheet', () => ({
  DiscoverResearchSheet: ({
    draft,
    onDraftChange,
  }: {
    draft: DiscoverIntake
    onDraftChange: (draft: DiscoverIntake) => void
  }) => (
    <input
      aria-label="Research field"
      value={draft.field}
      onChange={(event) => onDraftChange({ ...draft, field: event.target.value })}
    />
  ),
}))

function catalogPayload({
  field,
  note,
  piNote = 'Server PI note',
  fit,
}: {
  field: string
  note: string
  piNote?: string
  fit: number
}) {
  return {
    meta: null,
    state: {
      ...defaultDiscoverState(),
      intake: { ...DEFAULT_INTAKE, field },
      programNotes: { 'program-1': note },
      piNotes: { 'pi-1': piNote },
      ranker: { ...DEFAULT_RANKER, fit },
    },
    programs: [],
    pis: [],
  }
}

const baseProps = {
  token: 'token-1',
  applications: [],
  onImported: vi.fn(),
  onNotify: vi.fn(),
  onConfigureAiKeys: vi.fn(),
}

describe('Discover draft continuity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    apiMocks.listAiKeys.mockResolvedValue([])
  })

  it('keeps newer local notes, research criteria, and weights across a stale realtime refresh', async () => {
    apiMocks.getDiscoverCatalog
      .mockResolvedValueOnce(catalogPayload({ field: 'Server field', note: 'Server note', fit: 30 }))
      .mockResolvedValueOnce(catalogPayload({ field: 'Stale field', note: 'Stale note', fit: 12 }))

    const view = render(<DiscoverScreen {...baseProps} realtimeConnected realtimeRevision={0} />)

    expect(await screen.findByRole('textbox', { name: 'Program note' })).toHaveValue('Server note')
    fireEvent.change(screen.getByRole('textbox', { name: 'Program note' }), { target: { value: 'Local note' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Research field' }), { target: { value: 'Local field' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit fit weight' }))

    view.rerender(<DiscoverScreen {...baseProps} realtimeConnected realtimeRevision={1} />)

    await waitFor(() => expect(apiMocks.getDiscoverCatalog).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Program note' })).toHaveValue('Local note')
    expect(screen.getByRole('textbox', { name: 'Research field' })).toHaveValue('Local field')
    expect(screen.getByLabelText('Fit weight')).toHaveTextContent('91')
  })

  it('restores dirty notes, research criteria, and weights after unmount and remount', async () => {
    apiMocks.getDiscoverCatalog
      .mockResolvedValueOnce(catalogPayload({ field: 'Server field', note: 'Server note', piNote: 'Server PI note', fit: 30 }))
      .mockResolvedValueOnce(catalogPayload({ field: 'Stale field', note: 'Stale note', piNote: 'Stale PI note', fit: 12 }))

    const first = render(<DiscoverScreen {...baseProps} />)
    expect(await screen.findByRole('textbox', { name: 'Program note' })).toHaveValue('Server note')
    fireEvent.change(screen.getByRole('textbox', { name: 'Program note' }), { target: { value: 'Recovered program note' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'PI note' }), { target: { value: 'Recovered PI note' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Research field' }), { target: { value: 'Recovered field' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit fit weight' }))
    first.unmount()

    render(<DiscoverScreen {...baseProps} />)
    expect(await screen.findByRole('textbox', { name: 'Program note' })).toHaveValue('Recovered program note')
    expect(screen.getByRole('textbox', { name: 'PI note' })).toHaveValue('Recovered PI note')
    expect(screen.getByRole('textbox', { name: 'Research field' })).toHaveValue('Recovered field')
    expect(screen.getByLabelText('Fit weight')).toHaveTextContent('91')
    await waitFor(() => expect(apiMocks.getDiscoverCatalog).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Program note' })).toHaveValue('Recovered program note')
  })
})
