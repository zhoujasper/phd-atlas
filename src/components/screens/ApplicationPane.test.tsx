import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applications as sampleApplications } from '../../data/applications'
import { SAFE_RELOAD_FLUSH_EVENT } from '../../safeReload'
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

  it('flushes a buffered search draft before a safe reload can disturb the resident pane', () => {
    vi.useFakeTimers()
    const onQuery = vi.fn()
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
          onQuery={onQuery}
          onStatusFilters={vi.fn()}
          onSort={vi.fn()}
          onSelect={vi.fn()}
          onUpgrade={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const search = screen.getByRole('searchbox', { name: 'workspace.searchApplications' })
    fireEvent.change(search, { target: { value: 'resident filter' } })
    expect(search).toHaveValue('resident filter')
    expect(onQuery).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new Event(SAFE_RELOAD_FLUSH_EVENT)))

    expect(onQuery).toHaveBeenCalledTimes(1)
    expect(onQuery).toHaveBeenCalledWith('resident filter')
    expect(search).toHaveValue('resident filter')
  })

  it('keeps the board action mounted in a fixed compositor slot during board mode', () => {
    const onShowBoard = vi.fn()
    const renderPane = (boardActive: boolean) => (
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
          onShowBoard={onShowBoard}
          boardActive={boardActive}
        />
      </I18nContext.Provider>
    )
    const view = render(renderPane(false))

    expect(view.container.querySelector('.application-board-action-presence')).toHaveAttribute('data-present', 'true')
    expect(view.container.querySelector('.application-board-button')).toBeInTheDocument()

    view.rerender(renderPane(true))

    const presence = view.container.querySelector('.application-board-action-presence')
    expect(presence).toHaveAttribute('data-present', 'false')
    expect(presence).toHaveAttribute('inert')
    expect(view.container.querySelector('.application-board-button')).toBeInTheDocument()
  })

  it('prewarms the board chunk on pointer intent before activation', () => {
    const onPrefetchBoard = vi.fn()
    const view = render(
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
          onShowBoard={vi.fn()}
          onPrefetchBoard={onPrefetchBoard}
        />
      </I18nContext.Provider>,
    )

    const boardButton = view.container.querySelector<HTMLButtonElement>('.application-board-button')
    expect(boardButton).not.toBeNull()
    fireEvent.pointerEnter(boardButton!)
    fireEvent.focus(boardButton!)
    expect(onPrefetchBoard).toHaveBeenCalledTimes(2)
  })

  it('keeps the trash dock after a flexible empty application region', () => {
    const view = render(
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
          showTrash
          trashEnabled
        />
      </I18nContext.Provider>,
    )

    const emptyRegion = view.container.querySelector('.application-list-empty')
    const trashDock = view.container.querySelector('.application-trash-dock')
    expect(emptyRegion).toBeInTheDocument()
    expect(trashDock).toBeInTheDocument()
    expect(emptyRegion?.nextElementSibling).toBe(trashDock)
  })

  it('identifies the student on Team recycle-bin rows without changing a student own row', () => {
    const application = {
      ...sampleApplications[0],
      ownerId: 'student-1',
      teamId: 'team-1',
    }
    const view = render(
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
          trashEnabled
          trashItems={[{
            id: 'trash-team-1',
            deletedAt: '2026-08-02T10:00:00.000Z',
            expiresAt: '2026-09-01T10:00:00.000Z',
            application,
          }]}
          trashCount={1}
          trashOwnerNames={{ 'student-1': 'Omar Patel' }}
        />
      </I18nContext.Provider>,
    )

    expect(view.container.querySelector('.application-trash-copy em')).toHaveTextContent(
      `Omar Patel · ${application.program} · ${application.professor.english}`,
    )
  })

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
    expect(screen.getByRole('listbox', { name: 'workspace.ownerFilter' })).toHaveClass('owner-picker-menu-surface')

    fireEvent.click(trigger)
    expect(document.querySelector('.owner-picker')).toHaveClass('exiting')
    expect(document.querySelector('.owner-picker-menu-surface')).toBeInTheDocument()
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

  it('shows every responsible teacher and the student as two compact Team rows', () => {
    const application = sampleApplications[0]
    const teacherNames = 'Dr. Mei Lin · Prof. Ada Lovelace'
    const studentName = 'Omar Hassan'
    const view = render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationPane
          applications={[application]}
          totalApplicationCount={1}
          applicationLimit={10}
          isPro
          selectedId={application.id}
          query=""
          statusFilters={[]}
          sort="deadline:asc"
          onQuery={vi.fn()}
          onStatusFilters={vi.fn()}
          onSort={vi.fn()}
          onSelect={vi.fn()}
          onUpgrade={vi.fn()}
          teamRelations={{
            [application.id]: {
              advisorName: teacherNames,
              studentName,
            },
          }}
        />
      </I18nContext.Provider>,
    )

    const row = view.container.querySelector('.application-line')
    const context = view.container.querySelector('.team-line-context')
    expect(row).toHaveClass('has-team-context')
    expect(Array.from(context?.children ?? []).map((child) => child.tagName)).toEqual([
      'SMALL',
      'B',
      'SMALL',
      'B',
    ])
    expect(context).toHaveTextContent(`workspace.advisorLabel:${teacherNames}`)
    expect(context).toHaveTextContent(`workspace.studentLabel:${studentName}`)
    expect(context?.querySelectorAll('svg')).toHaveLength(0)
    expect(context?.querySelectorAll('b')[0]).toHaveAttribute('title', teacherNames)
    expect(context?.querySelectorAll('b')[1]).toHaveAttribute('title', studentName)
  })

  it('moves the shared selection surface on pointer down before opening the next record', () => {
    vi.useFakeTimers()
    const onSelect = vi.fn()
    const view = render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationPane
          applications={sampleApplications.slice(0, 2)}
          totalApplicationCount={2}
          applicationLimit={10}
          isPro
          selectedId={sampleApplications[0].id}
          query=""
          statusFilters={[]}
          sort="deadline:asc"
          onQuery={vi.fn()}
          onStatusFilters={vi.fn()}
          onSort={vi.fn()}
          onSelect={onSelect}
          onUpgrade={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const rows = view.container.querySelectorAll<HTMLButtonElement>('.application-line')
    const targetRow = Array.from(rows).find((row) => row.title.startsWith(sampleApplications[1].school.name))
    const slider = view.container.querySelector<HTMLElement>('.application-selection-slider')
    expect(rows).toHaveLength(2)
    expect(targetRow).toBeDefined()
    expect(slider).not.toBeNull()

    Object.defineProperty(targetRow!, 'offsetTop', { configurable: true, value: 52 })
    Object.defineProperty(targetRow!, 'offsetHeight', { configurable: true, value: 46 })

    fireEvent.pointerDown(targetRow!, { button: 0 })

    expect(slider?.style.getPropertyValue('--application-selection-y')).toBe('52px')
    expect(slider?.style.getPropertyValue('--application-selection-height')).toBe('46px')
    expect(slider?.style.getPropertyValue('--application-selection-scale-y')).toBe('1')
    expect(slider).toHaveClass('is-visible', 'is-moving')
    expect(onSelect).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(280))
    expect(slider).toHaveClass('is-moving')

    act(() => vi.advanceTimersByTime(40))
    expect(slider).not.toHaveClass('is-moving')

    fireEvent.click(targetRow!)
    expect(onSelect).toHaveBeenCalledWith(sampleApplications[1].id)

    act(() => vi.advanceTimersByTime(380))
    expect(slider?.style.getPropertyValue('--application-selection-y')).toBe('0px')
    view.unmount()
    vi.useRealTimers()
  })
})
