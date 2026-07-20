import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { phdApi } from '../../api/phdApi'
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

describe('DiscoverApplicationEnrichment', () => {
  it('keeps replacements collapsed and applies only reviewed defaults', async () => {
    vi.mocked(phdApi.previewDiscoverApplicationEnrichment).mockResolvedValue(proposal)
    vi.mocked(phdApi.applyDiscoverApplicationEnrichment).mockResolvedValue(applications[0])
    const onApplied = vi.fn()

    render(
      <DiscoverApplicationEnrichment
        token="token"
        applications={[applications[0]]}
        aiKeys={[]}
        onApplied={onApplied}
        onNotify={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
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
})
