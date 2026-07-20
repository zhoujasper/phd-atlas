import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applications as sampleApplications } from '../../data/applications'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { ApplicationPane } from './ApplicationPane'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template) => template,
  tx: (path, fallback) => fallback ?? path,
}

describe('ApplicationPane owner picker', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps the picker mounted while its close motion plays', () => {
    vi.useFakeTimers()
    render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationPane
          applications={[]}
          totalApplicationCount={0}
          applicationLimit={10}
          isPro
          selectedId={null}
          query=""
          statusFilters={[]}
          sort="deadline:asc"
          onQuery={vi.fn()}
          onStatusFilters={vi.fn()}
          onSort={vi.fn()}
          onSelect={vi.fn()}
          onUpgrade={vi.fn()}
          ownerFilterOptions={[
            { id: 'student-1', name: 'Ada Lovelace', count: 2 },
            { id: 'student-2', name: 'Grace Hopper', count: 1 },
          ]}
          ownerFilter={null}
          onOwnerFilter={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const trigger = screen.getByRole('button', { name: 'workspace.ownerFilter' })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox', { name: 'workspace.ownerFilter' })).toBeInTheDocument()

    fireEvent.click(trigger)
    expect(document.querySelector('.owner-picker')).toHaveClass('exiting')
    expect(screen.getByRole('listbox', { name: 'workspace.ownerFilter' })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(160))
    expect(screen.queryByRole('listbox', { name: 'workspace.ownerFilter' })).not.toBeInTheDocument()
  })

  it('keeps a confirmed application row mounted with a collapsing exit class', () => {
    const application = sampleApplications[0]
    const view = render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationPane
          applications={[application]}
          totalApplicationCount={1}
          applicationLimit={10}
          isPro
          selectedId={null}
          query=""
          statusFilters={[]}
          sort="deadline:asc"
          onQuery={vi.fn()}
          onStatusFilters={vi.fn()}
          onSort={vi.fn()}
          onSelect={vi.fn()}
          onUpgrade={vi.fn()}
          removingApplicationIds={new Set([application.id])}
        />
      </I18nContext.Provider>,
    )

    expect(view.container.querySelector('.application-line')).toHaveClass('is-removing')
  })
})
