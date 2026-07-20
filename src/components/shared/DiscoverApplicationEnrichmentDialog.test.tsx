import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { applications } from '../../data/applications'
import { DiscoverApplicationEnrichmentDialog } from './DiscoverApplicationEnrichmentDialog'

describe('DiscoverApplicationEnrichmentDialog', () => {
  it('opens for the current dossier application without an application chooser', () => {
    render(
      <DiscoverApplicationEnrichmentDialog
        open
        token="token"
        application={applications[0]}
        aiKeys={[]}
        onApplied={vi.fn()}
        onNotify={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Enrich existing application' })).toBeVisible()
    expect(screen.getByText(applications[0].school.name)).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Application' })).not.toBeInTheDocument()
  })
})
