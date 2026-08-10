import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applications as sampleApplications } from '../../data/applications'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { KanbanBoard } from './KanbanBoard'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path, fallback) => ({
    'kanban.showMore': 'Show {count} more',
    'kanban.board': 'Board',
    'kanban.table': 'Table',
    'kanban.tableView': 'Table view',
    'kanban.tableChangeStatus': 'Change status for {name}',
    'kanban.tableOpenApplication': 'Open {name}',
    'kanban.tableSelectApplication': 'Select {name}',
    'explorer.open': 'Open',
    'dossier.expand': 'Show details',
    'dossier.collapse': 'Hide details',
    'dossier.research': 'Research & lab',
    'dossier.details': 'Details',
    'dossier.tabs.materials': 'Materials',
    'dossier.tasks': 'Tasks',
    'dossier.tabs.mail': 'Correspondence',
    'dossier.country': 'Country',
    'dossier.tags': 'Tags',
    'dossier.nextReminder': 'Next reminder',
    'settings.priorityLow': 'Low',
    'settings.priorityMedium': 'Medium',
    'settings.priorityHigh': 'High',
  }[path] ?? fallback ?? path),
}

function withinPipelineView(view: 'board' | 'table') {
  const slot = document.querySelector<HTMLElement>(`[data-pipeline-view-slot="${view}"]`)
  expect(slot).not.toBeNull()
  return within(slot!)
}

describe('KanbanBoard mobile rendering', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    window.localStorage.removeItem('phd-atlas:application-pipeline-view:v1:personal')
    window.localStorage.removeItem('phd-atlas:application-pipeline-view:v1:team')
    window.localStorage.removeItem('phd-atlas:application-pipeline-sort:v1:personal')
    window.localStorage.removeItem('phd-atlas:application-pipeline-sort:v1:team')
    window.localStorage.removeItem('phd-atlas-table-cols:application-pipeline-personal-v1')
    window.localStorage.removeItem('phd-atlas-table-cols:application-pipeline-team-v1')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('max-width: 820px'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
    delete document.documentElement.dataset.applicationPipelineTransitionToken
    delete document.documentElement.dataset.applicationPipelineTransitionScope
    delete document.documentElement.dataset.applicationPipelineTransitionDirection
    delete document.documentElement.dataset.applicationPipelineTransitionMode
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reveals mobile cards in explicit batches without a permanent progressive loader', async () => {
    const user = userEvent.setup()
    const applications = Array.from({ length: 12 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `mobile-card-${index}`,
      status: 'Draft' as const,
      school: { ...sampleApplications[0].school, name: `Mobile school ${index + 1}` },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    expect(withinPipelineView('board').getByText('Mobile school 8')).toBeVisible()
    expect(withinPipelineView('board').queryByText('Mobile school 9')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.kanban-card')).toHaveLength(8)
    expect(document.querySelector('.kanban-progressive-loader')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show 4 more' }))

    expect(withinPipelineView('board').getByText('Mobile school 12')).toBeVisible()
    expect(document.querySelectorAll('.kanban-card')).toHaveLength(12)
    expect(document.querySelector('.kanban-progressive-loader')).not.toBeInTheDocument()
  })

  it('paints a bounded board scaffold before committing the first card batch', async () => {
    const applications = Array.from({ length: 12 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `staged-card-${index}`,
      status: 'Draft' as const,
      school: { ...sampleApplications[0].school, name: `Staged school ${index + 1}` },
    }))

    const view = render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
          deferInactiveView
        />
      </I18nContext.Provider>,
    )

    const boardView = view.container.querySelector('.application-pipeline-board-view')
    expect(boardView).toHaveAttribute('aria-busy', 'true')
    expect(boardView).toHaveAttribute('data-entry-state', 'preview')
    expect(view.container.querySelectorAll('.kanban-card')).toHaveLength(0)
    expect(view.container.querySelector('.kanban-column-preview')).toBeInTheDocument()

    await waitFor(() => expect(view.container.querySelectorAll('.kanban-card')).toHaveLength(8))
    expect(boardView).not.toHaveAttribute('aria-busy')
    expect(boardView).toHaveAttribute('data-entry-state', 'ready')
  })

  it('keeps custom-status applications renderable and offers account-saved statuses in move actions', async () => {
    const user = userEvent.setup()
    const application = {
      ...structuredClone(sampleApplications[0]),
      id: 'custom-status-application',
      status: 'Committee review',
      school: {
        ...sampleApplications[0].school,
        name: 'Custom status school',
      },
    }

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={[application]}
          customApplicationStatuses={['Committee review', 'Funding pending']}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    expect(withinPipelineView('board').getByText('Custom status school')).toBeVisible()
    expect(withinPipelineView('board').getByText('Committee review')).toBeVisible()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Custom status school/i }), {
      clientX: 48,
      clientY: 64,
    })
    await user.click(screen.getByText('kanban.moveTo'))
    expect(screen.getByText('Funding pending')).toBeVisible()
  })

  it('switches the personal pipeline to an editable smart table', async () => {
    const user = userEvent.setup()
    const onStatusChange = vi.fn()
    const onPrefetch = vi.fn()
    const application = {
      ...structuredClone(sampleApplications[0]),
      id: 'smart-table-application',
      status: 'Draft' as const,
      school: {
        ...sampleApplications[0].school,
        name: 'Smart Table University',
      },
    }

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={[application]}
          onStatusChange={onStatusChange}
          onSelect={vi.fn()}
          onPrefetch={onPrefetch}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))

    expect(document.querySelector('.application-smart-table')).toBeInTheDocument()
    await waitFor(() => {
      expect(withinPipelineView('table').getByText('Smart Table University')).toBeVisible()
    })
    expect(window.localStorage.getItem('phd-atlas:application-pipeline-view:v1:personal')).toBe('table')

    const row = document.querySelector('[data-pipeline-row-id="smart-table-application"]')
    fireEvent.pointerEnter(row as HTMLElement)
    expect(onPrefetch).toHaveBeenLastCalledWith('smart-table-application')
    expect(row?.querySelector('.application-table-status .custom-select-root')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change status for Smart Table University' }))
    expect(row?.querySelector('.application-table-status .custom-select-root')).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Preparing' }))
    expect(onStatusChange).toHaveBeenCalledWith('smart-table-application', 'Preparing')

    const tableShell = document.querySelector<HTMLElement>('.application-smart-table-shell')
    expect(tableShell).not.toBeNull()
    vi.spyOn(tableShell!, 'getBoundingClientRect').mockReturnValue({
      x: 120,
      y: 80,
      top: 80,
      right: 1000,
      bottom: 680,
      left: 120,
      width: 880,
      height: 600,
      toJSON: () => ({}),
    })

    const checkbox = screen.getByRole('checkbox', { name: 'Select Smart Table University' })
    expect(checkbox.closest('.application-table-checkbox')?.querySelector('.animated-checkmark.is-square')).toBeInTheDocument()
    await user.click(checkbox)
    expect(row).toHaveClass('is-selected')

    await waitFor(() => {
      expect(document.body.querySelector('.application-table-selection-dock')).toHaveClass('is-open')
    })
    const selectionDock = document.body.querySelector<HTMLElement>('.application-table-selection-dock')
    expect(selectionDock?.parentElement).toBe(document.body)
    expect(selectionDock).toHaveClass('is-viewport-bottom')
    expect(selectionDock?.style.getPropertyValue('--explorer-selection-anchor-center-x')).toBe('560px')
    expect(selectionDock?.style.getPropertyValue('--explorer-selection-anchor-width')).toBe('880px')
    expect(selectionDock?.querySelector('.explorer-selection-dot')).not.toBeInTheDocument()
    expect(document.querySelector('.application-table-sticky-tools .explorer-selection-presence'))
      .not.toBeInTheDocument()

    const deadline = row?.querySelector('.application-table-deadline')
    expect(deadline?.firstElementChild?.tagName).toBe('TIME')
    expect(deadline?.lastElementChild).toHaveClass('deadline-badge')
    expect(row?.querySelector('.application-table-priority')).toHaveTextContent('High')
    expect(row?.querySelector('.application-table-priority')).not.toHaveTextContent(String(application.priority))

    const actionsCell = row?.querySelector('.application-table-actions-cell')
    expect(actionsCell?.querySelectorAll('button')).toHaveLength(1)
    expect(within(actionsCell as HTMLElement).getByRole('button', {
      name: 'Open Smart Table University',
    })).toHaveTextContent('Open')

    await user.click(screen.getByRole('button', { name: 'Board' }))
    await waitFor(() => expect(selectionDock).not.toBeVisible())
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Smart Table University/i }))
    expect(onPrefetch).toHaveBeenLastCalledWith('smart-table-application')

    await user.click(screen.getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(selectionDock).toBeVisible())
  })

  it('navigates before deferring selected-row cleanup in the smart table', async () => {
    const user = userEvent.setup()
    const application = {
      ...structuredClone(sampleApplications[0]),
      id: 'table-open-priority',
      school: {
        ...sampleApplications[0].school,
        name: 'Priority Table University',
      },
    }
    let row: HTMLElement | null = null
    const onSelect = vi.fn(() => {
      expect(row).toHaveClass('is-selected')
    })

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={[application]}
          onStatusChange={vi.fn()}
          onSelect={onSelect}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))
    row = document.querySelector('[data-pipeline-row-id="table-open-priority"]')
    expect(row).not.toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Select Priority Table University' }))
    expect(row).toHaveClass('is-selected')

    await user.click(row!)

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('table-open-priority')
    await waitFor(() => expect(row).not.toHaveClass('is-selected'))
  })

  it('keeps Shift range selection inside the smart table without selecting page text', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const applications = Array.from({ length: 4 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `range-table-${index}`,
      deadline: `2027-01-${String(index + 1).padStart(2, '0')}`,
      school: {
        ...sampleApplications[0].school,
        name: `Range school ${index + 1}`,
      },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={onSelect}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(withinPipelineView('table').getByText('Range school 1')).toBeVisible())
    await user.click(screen.getByRole('checkbox', { name: 'Select Range school 1' }))

    const thirdIdentity = withinPipelineView('table').getByText('Range school 3')
    const ordinaryMouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    expect(thirdIdentity.dispatchEvent(ordinaryMouseDown)).toBe(true)

    const shiftMouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      shiftKey: true,
    })
    expect(thirdIdentity.dispatchEvent(shiftMouseDown)).toBe(false)
    expect(shiftMouseDown.defaultPrevented).toBe(true)

    fireEvent.click(thirdIdentity, { shiftKey: true })

    expect(document.querySelector('[data-pipeline-row-id="range-table-0"]')).toHaveClass('is-selected')
    expect(document.querySelector('[data-pipeline-row-id="range-table-1"]')).toHaveClass('is-selected')
    expect(document.querySelector('[data-pipeline-row-id="range-table-2"]')).toHaveClass('is-selected')
    expect(document.querySelector('[data-pipeline-row-id="range-table-3"]')).not.toHaveClass('is-selected')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens the persisted column visibility menu from a table-header right click', async () => {
    const user = userEvent.setup()
    const application = {
      ...structuredClone(sampleApplications[0]),
      id: 'column-menu-application',
      school: {
        ...sampleApplications[0].school,
        name: 'Column Menu University',
      },
    }

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={[application]}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(withinPipelineView('table').getByText('Column Menu University')).toBeVisible())
    const professorHeader = document.querySelector<HTMLElement>('th[data-column="professor"]')
    expect(professorHeader).not.toBeNull()

    fireEvent.contextMenu(professorHeader!, { clientX: 240, clientY: 120 })
    expect(screen.getByRole('menu', { name: 'table.columns' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'kanban.tableProfessor' }))

    expect(professorHeader).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('td[data-column="professor"]')).toHaveAttribute('aria-hidden', 'true')
    expect(JSON.parse(window.localStorage.getItem(
      'phd-atlas-table-cols:application-pipeline-personal-v1',
    ) ?? '{}')).toMatchObject({ hidden: ['professor'] })

    const applicationHeader = document.querySelector<HTMLElement>('th[data-column="application"]')
    fireEvent.contextMenu(applicationHeader!, { clientX: 180, clientY: 120 })
    await user.click(screen.getByRole('menuitem', { name: 'kanban.tableProfessor' }))

    expect(professorHeader).toHaveAttribute('aria-hidden', 'false')
    expect(document.querySelector('td[data-column="professor"]')).toHaveAttribute('aria-hidden', 'false')
  })

  it('mounts the smart table in small mobile batches and reveals later rows on demand', async () => {
    const user = userEvent.setup()
    const geometrySpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const applications = Array.from({ length: 23 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `lazy-table-${index}`,
      status: 'Draft' as const,
      school: {
        ...sampleApplications[0].school,
        name: `Lazy table school ${index + 1}`,
      },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))

    await waitFor(() => {
      expect(document.querySelector('.application-smart-table')).toBeVisible()
      expect(document.querySelectorAll('[data-pipeline-row-id^="lazy-table-"]')).toHaveLength(8)
    })
    expect(screen.queryByText('Lazy table school 9')).not.toBeInTheDocument()

    geometrySpy.mockClear()
    await user.click(screen.getByRole('button', { name: 'Show 8 more' }))

    expect(document.querySelectorAll('[data-pipeline-row-id^="lazy-table-"]')).toHaveLength(16)
    expect(screen.getByText('Lazy table school 16')).toBeVisible()
    expect(screen.queryByText('Lazy table school 17')).not.toBeInTheDocument()
    expect(geometrySpy).not.toHaveBeenCalled()

    const enteringRows = document.querySelectorAll('tr.is-entering')
    expect(enteringRows).toHaveLength(8)
  })

  it('does not auto-append an initially visible table marker before scroll intent', async () => {
    const user = userEvent.setup()
    const observerState: {
      callback?: IntersectionObserverCallback
      instance?: IntersectionObserver
    } = {}
    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null
      readonly rootMargin = '0px'
      readonly scrollMargin = '0px'
      readonly thresholds = [0.01]
      constructor(callback: IntersectionObserverCallback) {
        observerState.callback = callback
        observerState.instance = this
      }
      disconnect() {}
      observe() {}
      takeRecords() { return [] }
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    const applications = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `intent-table-${index}`,
      status: 'Draft' as const,
      school: {
        ...sampleApplications[0].school,
        name: `Intent table school ${index + 1}`,
      },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(observerState.callback).toBeTypeOf('function'))

    if (!observerState.callback || !observerState.instance) {
      throw new Error('Expected the table IntersectionObserver to be installed')
    }
    observerState.callback([
      { isIntersecting: true } as IntersectionObserverEntry,
    ], observerState.instance)
    expect(document.querySelectorAll('[data-pipeline-row-id^="intent-table-"]')).toHaveLength(8)

    fireEvent.scroll(window)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-pipeline-row-id^="intent-table-"]')).toHaveLength(16)
    })
  })

  it('prewarms both presentations and preserves their resident state across rapid handoffs', async () => {
    const user = userEvent.setup()
    const applications = Array.from({ length: 12 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `resident-pipeline-${index}`,
      status: 'Draft' as const,
      school: {
        ...sampleApplications[0].school,
        name: `Resident pipeline school ${index + 1}`,
      },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Show 4 more' }))
    const boardView = document.querySelector<HTMLElement>('.application-pipeline-board-view')
    expect(boardView?.querySelectorAll('.kanban-card')).toHaveLength(12)

    const tableView = await screen.findByRole('table', { hidden: true })
    expect(tableView).not.toBeVisible()
    expect(tableView.querySelectorAll('tbody tr')).toHaveLength(8)
    expect(tableView.querySelector('tbody tr.is-entering')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(tableView).toBeVisible())

    await user.click(screen.getByRole('button', { name: 'Board' }))
    await waitFor(() => expect(boardView).toBeVisible())
    expect(boardView?.querySelectorAll('.kanban-card')).toHaveLength(12)
  })

  it('keeps desktop rows in natural page flow while retaining resident tools', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    const user = userEvent.setup()
    const applications = Array.from({ length: 25 }, (_, index) => ({
      ...structuredClone(sampleApplications[0]),
      id: `desktop-table-${index}`,
      status: 'Draft' as const,
      school: {
        ...sampleApplications[0].school,
        name: `Desktop table school ${index + 1}`,
      },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={applications}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Table' }))

    const shell = document.querySelector('.application-smart-table-shell')
    expect(shell).toBeInTheDocument()
    await waitFor(() => expect(shell).toBeVisible())
    expect(shell?.querySelector('thead')).toBeInTheDocument()
    expect(document.querySelector('.application-table-sticky-tools')).toBeInTheDocument()
    expect(document.querySelector('.project-footer')).toBeInTheDocument()
    expect(shell?.querySelectorAll('tr[data-pipeline-row-id]')).toHaveLength(12)

    await user.click(screen.getByRole('button', { name: 'Show 12 more' }))

    expect(shell?.querySelectorAll('tr[data-pipeline-row-id]')).toHaveLength(24)
  })

  it('groups team applications by student and progressively discloses each student flow', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onNewForStudent = vi.fn()
    const onOpenInNewPage = vi.fn()
    const onCopy = vi.fn()
    const studentApplications = Array.from({ length: 4 }, (_, index) => ({
      ...structuredClone(sampleApplications[index % sampleApplications.length]),
      id: `student-application-${index}`,
      status: (['Draft', 'Preparing', 'Submitted', 'Accepted'] as const)[index],
      school: {
        ...sampleApplications[index % sampleApplications.length].school,
        name: `Student school ${index + 1}`,
      },
    }))

    render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={studentApplications}
          teamStudents={[
            {
              id: 'student-ada',
              name: 'Ada Lovelace',
              email: 'ada@example.com',
              advisorName: 'Dr. Turing',
              applications: studentApplications,
              allApplications: studentApplications,
            },
            {
              id: 'student-grace',
              name: 'Grace Hopper',
              email: 'grace@example.com',
              advisorName: 'Dr. Hamilton',
              applications: [],
              allApplications: [],
            },
          ]}
          onStatusChange={vi.fn()}
          onSelect={onSelect}
          onNewForStudent={onNewForStudent}
          onOpenInNewPage={onOpenInNewPage}
          onCopy={onCopy}
        />
      </I18nContext.Provider>,
    )

    expect(document.querySelectorAll('.team-kanban-student')).toHaveLength(2)
    expect(withinPipelineView('board').getByText('Ada Lovelace')).toBeVisible()
    expect(withinPipelineView('board').getByText('Grace Hopper')).toBeVisible()
    expect(document.querySelectorAll('.team-kanban-application-row')).toHaveLength(3)
    const teamHero = document.querySelector('.team-kanban-hero')
    expect(teamHero?.querySelector('.kanban-hero-info > p')).toBeNull()
    const guidanceTrigger = within(teamHero as HTMLElement).getByRole('button', {
      name: 'team.teacherApplicationsDesc',
    })
    await user.click(guidanceTrigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('team.teacherApplicationsDesc')
    expect(screen.getByRole('tooltip')).toHaveClass('is-open')

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(document.querySelectorAll('.team-kanban-application-row')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: /Student school 4/i }))

    expect(withinPipelineView('board').getByText('Student school 4')).toBeVisible()
    expect(onSelect).toHaveBeenCalledWith('student-application-3')

    const firstApplication = screen.getByRole('button', { name: /Student school 1/i })
    fireEvent.contextMenu(firstApplication, { clientX: 48, clientY: 64 })
    expect(screen.getByText('explorer.copySchool')).toBeVisible()
    expect(screen.getByText('explorer.copyProgram')).toBeVisible()
    await user.click(screen.getByText('explorer.copySchool'))
    expect(onCopy).toHaveBeenCalledWith('Student school 1', 'inspector.copySchool')

    firstApplication.focus()
    await user.keyboard('n')
    expect(onOpenInNewPage).toHaveBeenCalledWith('student-application-0')

    const graceCard = screen.getByText('Grace Hopper').closest('article')
    expect(graceCard).not.toBeNull()
    await user.click(within(graceCard!).getByRole('button', { name: 'team.teacherCreateForStudent' }))
    expect(onNewForStudent).toHaveBeenCalledWith('student-grace')

    await user.click(screen.getByRole('button', { name: 'Table' }))
    const smartTable = document.querySelector('.application-smart-table')
    expect(smartTable).toBeInTheDocument()
    await waitFor(() => expect(smartTable).toBeVisible())
    expect(within(smartTable as HTMLElement).getAllByText('Ada Lovelace').length).toBeGreaterThan(0)
    expect(window.localStorage.getItem('phd-atlas:application-pipeline-view:v1:team')).toBe('table')
  })

  it('assigns measured row spans once and reuses them after a presentation handoff', async () => {
    const user = userEvent.setup()
    const geometrySpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(this: HTMLElement) {
      const height = this.classList.contains('team-kanban-student')
        ? (this.textContent?.includes('Ada Lovelace') ? 420 : 260)
        : 0
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: height,
        left: 0,
        width: 360,
        height,
        toJSON: () => ({}),
      } as DOMRect
    })

    const view = render(
      <I18nContext.Provider value={i18nContext}>
        <KanbanBoard
          applications={[]}
          teamStudents={[
            {
              id: 'student-ada',
              name: 'Ada Lovelace',
              applications: [],
              allApplications: [],
            },
            {
              id: 'student-grace',
              name: 'Grace Hopper',
              applications: [],
              allApplications: [],
            },
          ]}
          onStatusChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const grid = view.container.querySelector('.team-kanban-grid')
    const cards = view.container.querySelectorAll<HTMLElement>('.team-kanban-student')

    expect(grid).toHaveClass('is-masonry-ready')
    expect(cards).toHaveLength(2)
    expect(cards[0].style.getPropertyValue('--team-kanban-masonry-span')).toBe('216')
    expect(cards[1].style.getPropertyValue('--team-kanban-masonry-span')).toBe('136')
    expect(cards[0]).toHaveTextContent('Ada Lovelace')
    expect(cards[1]).toHaveTextContent('Grace Hopper')

    geometrySpy.mockClear()
    await user.click(screen.getByRole('button', { name: 'Table' }))
    await waitFor(() => expect(document.querySelector('[data-pipeline-view-slot="table"]')).toBeVisible())
    await user.click(screen.getByRole('button', { name: 'Board' }))
    await waitFor(() => expect(grid).toBeVisible())
    expect(geometrySpy).not.toHaveBeenCalled()
  })
})
