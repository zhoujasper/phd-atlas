import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketingWorkspaceDemo, type MarketingWorkspaceTab } from './MarketingWorkspaceDemo'

describe('MarketingWorkspaceDemo', () => {
  it('opens on the reference ETH Zurich checklist state by default', () => {
    const { container } = render(<MarketingWorkspaceDemo />)
    const selectedApplication = container.querySelector<HTMLButtonElement>(
      '.mwd-application-list > button.is-selected',
    )
    const selectedTab = container.querySelector<HTMLButtonElement>('.mwd-tabs > button.is-active')

    expect(selectedApplication?.textContent).toContain('ETH')
    expect(selectedTab?.textContent).toMatch(/Checklist|材料|清单/i)
    expect(container.querySelector('.mwd-checklist-tools')).not.toBeNull()
  })

  it('renders the real per-tab workspace anatomy', () => {
    const { container, rerender } = render(<MarketingWorkspaceDemo activeTab="dossier" />)

    expect(container.querySelector('.mwd-dossier-overview')).not.toBeNull()
    expect(container.querySelectorAll('.school-logo-mark.has-image').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelector('.mwd-inspector-deadlines')).not.toBeNull()
    expect(container.querySelector('.mwd-inspector-progress .progress-orbit')).not.toBeNull()
    expect(container.querySelectorAll('.mwd-inspector-links > button')).toHaveLength(5)

    const tabSurfaces: Array<[MarketingWorkspaceTab, string]> = [
      ['materials', '.mwd-checklist-tools'],
      ['mail', '.mwd-correspondence-timeline'],
      ['funding', '.mwd-fee-panel'],
      ['timeline', '.mwd-timeline-tasks'],
    ]

    for (const [activeTab, selector] of tabSurfaces) {
      rerender(<MarketingWorkspaceDemo activeTab={activeTab} />)
      expect(container.querySelector(selector)).not.toBeNull()
    }
  })

  it('keeps application filtering, sorting, and fee status genuinely interactive', () => {
    const { container, rerender } = render(<MarketingWorkspaceDemo activeTab="dossier" />)
    const applicationRows = () => Array.from(
      container.querySelectorAll<HTMLButtonElement>('.mwd-application-list > button'),
    )

    expect(applicationRows()[0]?.textContent).toContain('ETH')

    const prioritySort = container.querySelector<HTMLButtonElement>('.mwd-sort-list button:nth-child(4)')
    fireEvent.click(prioritySort as HTMLButtonElement)
    expect(applicationRows()[0]?.textContent).toContain('Stanford')

    const draftFilter = container.querySelector<HTMLButtonElement>('.mwd-filters button:nth-child(2)')
    fireEvent.click(draftFilter as HTMLButtonElement)
    expect(applicationRows()).toHaveLength(1)
    expect(applicationRows()[0]?.textContent).toContain('MIT')

    rerender(<MarketingWorkspaceDemo activeTab="funding" />)
    const feeToggle = container.querySelector<HTMLButtonElement>('.mwd-fee-summary > button')
    expect(feeToggle?.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(feeToggle as HTMLButtonElement)
    expect(feeToggle?.getAttribute('aria-pressed')).toBe('true')
    expect(feeToggle?.classList.contains('is-paid')).toBe(true)
  })

  it('keeps the checklist checkmark mounted while drawing its checked state', () => {
    const { container } = render(<MarketingWorkspaceDemo activeTab="materials" />)
    const toggle = container.querySelector<HTMLButtonElement>('.mwd-check-toggle[aria-pressed="false"]')
    const checkmark = toggle?.querySelector('.animated-checkmark')

    expect(toggle).not.toBeNull()
    expect(checkmark).not.toBeNull()

    fireEvent.click(toggle as HTMLButtonElement)

    expect(toggle?.getAttribute('aria-pressed')).toBe('true')
    expect(toggle?.querySelector('.animated-checkmark')).toBe(checkmark)
    expect(checkmark?.classList.contains('is-checked')).toBe(true)
  })
})
