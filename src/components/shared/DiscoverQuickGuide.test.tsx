import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import { DiscoverQuickGuide } from './DiscoverQuickGuide'

const copy: Record<string, string> = {
  close: 'Close',
  'discover.flowTitle': 'Discover workflow',
  'discover.subtitle': 'Turn a research direction into an evidence-backed shortlist.',
  'discover.flowDirection': 'Set direction',
  'discover.flowResearch': 'Research and verify',
  'discover.flowShortlist': 'Build shortlist',
  'discover.flowImport': 'Add to applications',
  'discover.nextActionCriteria': 'Set your field, regions and funding floor.',
  'discover.nextActionResearch': 'Refresh program, advisor and funding evidence.',
  'discover.nextActionWatch': 'Watch the serious candidates.',
  'discover.nextActionImport': 'Move a verified choice into the application workspace.',
  'discover.configureNow': 'Set criteria',
}

describe('DiscoverQuickGuide', () => {
  it('opens from the information control and hands the user into research setup', () => {
    const onOpenResearch = vi.fn()
    render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: {},
        format: (template) => template,
        tx: (path, fallback) => copy[path] ?? fallback ?? path,
      }}>
        <DiscoverQuickGuide onOpenResearch={onOpenResearch} />
      </I18nContext.Provider>,
    )

    const trigger = screen.getByRole('button', { name: 'Discover workflow' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)

    const guide = screen.getByRole('dialog', { name: 'Discover workflow' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(guide).getAllByRole('listitem')).toHaveLength(4)
    expect(within(guide).getByText('Research and verify')).toBeInTheDocument()
    expect(within(guide).getByText('Add to applications')).toBeInTheDocument()

    fireEvent.click(within(guide).getByRole('button', { name: 'Set criteria' }))
    expect(onOpenResearch).toHaveBeenCalledTimes(1)
    expect(guide).toHaveClass('is-exiting')
  })
})
