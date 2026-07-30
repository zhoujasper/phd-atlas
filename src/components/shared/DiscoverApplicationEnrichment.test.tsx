import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { phdApi } from '../../api/phdApi'
import type { AiKey } from '../../api/phdApi'
import { applications } from '../../data/applications'
import type { DiscoverApplicationEnrichmentProposal } from '../../data/discover'
import { DiscoverApplicationEnrichment } from './DiscoverApplicationEnrichment'

vi.mock('../../api/phdApi', () => ({
  phdApi: {
    previewDiscoverApplicationEnrichment: vi.fn(),
    applyDiscoverApplicationEnrichment: vi.fn(),
  },
}))

const proposal: DiscoverApplicationEnrichmentProposal = {
  applicationId: applications[0].id,
  generatedAt: '2026-07-18T12:00:00.000Z',
  usedAi: false,
  matchedProgram: {
    id: 'prog_test',
    school: applications[0].school.name,
    program: applications[0].program,
    matchScore: 88,
  },
  changes: [
    {
      id: 'discover-dossier',
      target: 'dossier.discover',
      category: 'research',
      mode: 'create',
      before: '',
      after: 'Program fit and official sources',
      source: 'catalog',
      confidence: 'high',
      recommended: true,
      sources: ['https://example.edu/phd'],
    },
    {
      id: 'application-deadline',
      target: 'deadline',
      category: 'requirements',
      mode: 'update',
      before: '2026-11-01',
      after: '2026-12-01',
      source: 'catalog',
      confidence: 'medium',
      recommended: false,
      sources: ['https://example.edu/phd'],
    },
  ],
  caveats: ['Verify on the official page.'],
  payload: {},
}

const aiKey: AiKey = {
  id: 'key-1',
  ownerId: 'user-1',
  teamId: null,
  scope: 'personal',
  provider: 'openai',
  label: 'Research key',
  model: 'gpt-5',
  baseUrl: 'https://api.openai.com/v1',
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z',
  lastUsedAt: null,
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, resetAt: null },
  secretSet: true,
}

describe('DiscoverApplicationEnrichment', () => {
  it('keeps replacements collapsed and applies only reviewed defaults', async () => {
    vi.mocked(phdApi.previewDiscoverApplicationEnrichment).mockResolvedValue(proposal)
    vi.mocked(phdApi.applyDiscoverApplicationEnrichment).mockResolvedValue(applications[0])
    const onApplied = vi.fn()

    render(
      <DiscoverApplicationEnrichment
        token="token"
        applications={[applications[0]]}
        aiKeys={[aiKey]}
        onApplied={onApplied}
        onNotify={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    await waitFor(() => expect(phdApi.previewDiscoverApplicationEnrichment).toHaveBeenCalledWith(
      'token',
      applications[0].id,
      { useAi: true, keyId: 'key-1' },
    ))
    expect(await screen.findByText('Suggested additions')).toBeTruthy()
    expect(screen.getByText('1 changes selected')).toBeTruthy()
    expect(screen.queryByText('This replaces an existing value and is left unselected.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /1 existing values differ/ }))
    expect(await screen.findByText('This replaces an existing value and is left unselected.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply selected changes' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applications[0]))
    expect(phdApi.applyDiscoverApplicationEnrichment).toHaveBeenCalledWith(
      'token',
      applications[0].id,
      proposal,
      ['discover-dossier'],
    )
  })

  it('blocks preview and routes to AI key settings when no saved key is available', () => {
    const onConfigureAiKeys = vi.fn()
    render(
      <DiscoverApplicationEnrichment
        token="token"
        applications={[applications[0]]}
        aiKeys={[{ ...aiKey, id: 'unusable-key', secretSet: false }]}
        onConfigureAiKeys={onConfigureAiKeys}
        onApplied={vi.fn()}
        onNotify={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Preview changes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Configure AI key' }))
    expect(onConfigureAiKeys).toHaveBeenCalledOnce()
  })
})
