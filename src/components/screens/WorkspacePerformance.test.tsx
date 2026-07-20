import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ApplicationRecord } from '../../data/applications'
import { applications as seedApplications } from '../../data/applications'
import { today } from '../../appModel'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { Dashboard } from './Dashboard'
import { KanbanBoard } from './KanbanBoard'
import { Inspector } from './Inspector'

const messages: Record<string, string> = {
  'dashboard.scrollApplicationsRight': 'Scroll application cards right',
  'dashboard.scrollApplicationsLeft': 'Scroll application cards left',
  'dashboard.openApplicationCard': 'Open {name}',
  'kanban.showMore': 'Show {count} more',
  'inspector.showMore': 'Show more',
  'inspector.showPastDeadlines': 'Show expired',
  'inspector.hidePastDeadlines': 'Hide expired',
  'inspector.pastDeadlines': 'Expired',
}

const i18n: I18nContextValue = {
  lang: 'en',
  t: {},
  tx: (path, fallback) => messages[path] ?? fallback ?? path,
  format: (template, values) => Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  ),
}

function manyApplications(count: number, status: ApplicationRecord['status'] = 'Draft') {
  const seed = seedApplications[0]
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(seed),
    id: `performance-app-${index + 1}`,
    status,
    school: {
      ...seed.school,
      name: `Performance University ${index + 1}`,
    },
    professor: {
      ...seed.professor,
      english: `Professor ${index + 1}`,
    },
  }))
}

function renderWithI18n(node: React.ReactNode) {
  return render(<I18nContext.Provider value={i18n}>{node}</I18nContext.Provider>)
}

function dateFromToday(offset: number) {
  const value = new Date(`${today}T12:00:00`)
  value.setDate(value.getDate() + offset)
  return value.toISOString().slice(0, 10)
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  window.requestAnimationFrame ??= (callback) => window.setTimeout(() => callback(performance.now()), 0)
  window.cancelAnimationFrame ??= (handle) => window.clearTimeout(handle)
  HTMLElement.prototype.scrollBy ??= vi.fn()
})

describe('large workspace collections', () => {
  it('places the application overview first, then priority/tasks/deadlines as a triple row', async () => {
    const application = manyApplications(1)[0]
    application.tasks = [{
      id: 'dashboard-task-1',
      title: 'Submit research proposal',
      due: today,
      done: false,
    }]
    const onToggleTask = vi.fn().mockResolvedValue(undefined)
    const { container } = renderWithI18n(
      <Dashboard
        applications={[application]}
        onSelect={vi.fn()}
        onToggleTask={onToggleTask}
      />,
    )

    const snapshot = container.querySelector('.dashboard-application-snapshot')
    const focusRow = container.querySelector('[data-tour="dashboard-focus-row"]')
    const taskPanel = container.querySelector<HTMLElement>('.dashboard-panel-tasks')
    expect(snapshot).toBeInTheDocument()
    expect(focusRow).toBeInTheDocument()
    expect(taskPanel).toBeInTheDocument()
    if (!snapshot || !focusRow || !taskPanel) throw new Error('Dashboard overview layout did not render')
    expect(snapshot.compareDocumentPosition(focusRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(focusRow.contains(taskPanel)).toBe(true)
    const focusSlots = focusRow.querySelectorAll('.dashboard-focus-slot')
    expect(focusSlots).toHaveLength(3)
    expect(focusSlots[1]).toContainElement(taskPanel)
    await waitFor(() => {
      expect(focusRow).toHaveAttribute('data-focus-reveal', 'ready')
      expect(focusRow).toHaveAttribute('aria-busy', 'false')
      expect(focusRow.querySelectorAll('.dashboard-focus-slot.is-ready')).toHaveLength(3)
    })
    expect(screen.queryByText('dashboard.applicationSnapshotDesc')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mark complete: Submit research proposal' }))
    expect(container.querySelector('.stat-task-item')).toHaveClass('is-pending-done')
    // Grace window: still on the list until ~5s pass.
    expect(onToggleTask).not.toHaveBeenCalled()

    // Second click within the grace window restores the open state.
    await userEvent.click(screen.getByRole('button', { name: 'Undo complete: Submit research proposal' }))
    expect(container.querySelector('.stat-task-item')).not.toHaveClass('is-pending-done')
    expect(onToggleTask).not.toHaveBeenCalled()

    // Complete again and wait for the grace window to commit.
    await userEvent.click(screen.getByRole('button', { name: 'Mark complete: Submit research proposal' }))
    expect(container.querySelector('.stat-task-item')).toHaveClass('is-pending-done')
    await waitFor(() => {
      expect(onToggleTask).toHaveBeenCalledWith(application.id, 'dashboard-task-1', true)
    }, { timeout: 6_500 })
    await waitFor(() => {
      expect(screen.queryByText('Submit research proposal')).not.toBeInTheDocument()
    })
  })

  it('renders dashboard application cards in progressive batches', async () => {
    const items = manyApplications(20)
    const { container } = renderWithI18n(
      <Dashboard applications={items} onSelect={vi.fn()} />,
    )

    expect(container.querySelector('.dashboard-application-snapshot')).toBeInTheDocument()
    // First row is filled from measured capacity (fallback row size in jsdom).
    const initialCount = container.querySelectorAll('.stat-application-card').length
    expect(initialCount).toBeGreaterThanOrEqual(4)
    expect(initialCount).toBeLessThan(20)

    await userEvent.click(screen.getByRole('button', { name: 'Scroll application cards right' }))

    await waitFor(() => {
      expect(container.querySelectorAll('.stat-application-card').length).toBeGreaterThan(initialCount)
    })

    // Keep paging right until every application card is mounted.
    for (let i = 0; i < 12; i += 1) {
      if (container.querySelectorAll('.stat-application-card').length >= 20) break
      await userEvent.click(screen.getByRole('button', { name: 'Scroll application cards right' }))
      await waitFor(() => {
        expect(container.querySelectorAll('.stat-application-card').length).toBeGreaterThan(0)
      })
    }

    await waitFor(() => {
      expect(container.querySelectorAll('.stat-application-card')).toHaveLength(20)
    })
  })

  it('unifies application and scholarship checklist work by due date with overdue and keyboard controls', async () => {
    localStorage.removeItem('phd-atlas-dashboard-tasks-show-expired:v1')
    const application = manyApplications(1)[0]
    const materialSeed = application.materials[0]
    application.tasks = [
      { id: 'regular-overdue', title: 'Regular overdue', due: dateFromToday(-1), done: false },
      { id: 'regular-upcoming', title: 'Regular upcoming', due: dateFromToday(3), done: false },
      { id: 'regular-undated', title: 'Regular undated', due: '', done: false },
    ]
    application.materials = [{
      ...structuredClone(materialSeed),
      id: 'application-material',
      name: 'Application material',
      status: 'Draft',
      reminderEnabled: true,
      reminderDate: dateFromToday(1),
    }]
    application.scholarships = [{
      id: 'scholarship-1',
      name: 'Atlas Scholarship',
      amount: '1000',
      startDate: dateFromToday(-30),
      endDate: dateFromToday(30),
      materials: [{
        id: 'scholarship-material',
        name: 'Scholarship material',
        status: 'Draft',
        due: dateFromToday(2),
      }],
      tasks: [
        { id: 'scholarship-overdue', title: 'Scholarship overdue', due: dateFromToday(-2), done: false },
        { id: 'scholarship-upcoming', title: 'Scholarship upcoming', due: dateFromToday(4), done: false },
      ],
    }]

    const onSelect = vi.fn()
    const onCopy = vi.fn()
    const onToggleScholarshipTask = vi.fn().mockResolvedValue(undefined)
    const onPatchScholarshipMaterialStatus = vi.fn().mockResolvedValue(undefined)
    const { container } = renderWithI18n(
      <Dashboard
        applications={[application]}
        onSelect={onSelect}
        onCopy={onCopy}
        onToggleTask={vi.fn().mockResolvedValue(undefined)}
        onPatchMaterialStatus={vi.fn().mockResolvedValue(undefined)}
        onToggleScholarshipTask={onToggleScholarshipTask}
        onPatchScholarshipMaterialStatus={onPatchScholarshipMaterialStatus}
      />,
    )

    const visibleTitles = () => [...container.querySelectorAll('.stat-task-title')].map((node) => node.textContent)
    expect(visibleTitles()).toEqual([
      'Application material',
      'Scholarship material',
      'Regular upcoming',
      'Scholarship upcoming',
      'Regular undated',
    ])

    await userEvent.click(screen.getByRole('switch', { name: 'Show expired checklist items' }))
    expect(visibleTitles()).toEqual([
      'Regular overdue',
      'Scholarship overdue',
      'Application material',
      'Scholarship material',
      'Regular upcoming',
      'Scholarship upcoming',
      'Regular undated',
    ])

    const scholarshipMaterialRow = container.querySelector<HTMLElement>(
      '[data-dashboard-checklist-key$=":material:scholarship-material"]',
    )
    expect(scholarshipMaterialRow).toBeInTheDocument()
    fireEvent.contextMenu(scholarshipMaterialRow!)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change status' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ready' }))
    expect(onPatchScholarshipMaterialStatus).toHaveBeenCalledWith(
      application.id,
      'scholarship-1',
      'scholarship-material',
      'Ready',
    )

    const scholarshipTaskRow = container.querySelector<HTMLElement>(
      '[data-dashboard-checklist-key$=":task:scholarship-upcoming"]',
    )
    scholarshipTaskRow?.focus()
    fireEvent.keyDown(scholarshipTaskRow!, { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })

    fireEvent.keyDown(scholarshipTaskRow!, { key: 'c', ctrlKey: true })
    expect(onCopy).toHaveBeenCalledWith('Scholarship upcoming', 'Task title')
    fireEvent.keyDown(scholarshipTaskRow!, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(application.id, expect.objectContaining({ tab: 'funding' }))
    fireEvent.keyDown(scholarshipTaskRow!, { key: ' ' })
    expect(scholarshipTaskRow).toHaveClass('is-pending-done')
    fireEvent.keyDown(scholarshipTaskRow!, { key: ' ' })
    expect(scholarshipTaskRow).not.toHaveClass('is-pending-done')
    expect(onToggleScholarshipTask).not.toHaveBeenCalled()
  })

  it('keeps dense kanban columns bounded and progressively reveals cards while scrolling', () => {
    const items = manyApplications(20, 'Draft')
    const { container } = renderWithI18n(
      <KanbanBoard
        applications={items}
        onStatusChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('.kanban-card')).toHaveLength(4)
    const draftColumn = container.querySelector<HTMLElement>('.kanban-column-body.is-scrollable')
    expect(draftColumn).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show 8 more' })).not.toBeInTheDocument()

    fireEvent.wheel(draftColumn!, { deltaY: 120 })
    expect(container.querySelectorAll('.kanban-card')).toHaveLength(12)
    const firstRevealBatch = [...container.querySelectorAll('.kanban-card.is-revealing')] as HTMLElement[]
    expect(firstRevealBatch).toHaveLength(8)
    expect(firstRevealBatch[0].style.getPropertyValue('--reveal-index')).toBe('0')
    expect(firstRevealBatch[7].style.getPropertyValue('--reveal-index')).toBe('7')

    fireEvent.wheel(draftColumn!, { deltaY: 120 })
    expect(container.querySelectorAll('.kanban-card')).toHaveLength(20)
    expect(container.querySelectorAll('.kanban-card.is-revealing')).toHaveLength(8)
  })

  it('uses one clear create action when the kanban board is empty', async () => {
    const onNew = vi.fn()
    const { container } = renderWithI18n(
      <KanbanBoard
        applications={[]}
        onStatusChange={vi.fn()}
        onSelect={vi.fn()}
        onNew={onNew}
      />,
    )

    const createButton = container.querySelector<HTMLButtonElement>('.kanban-empty-action')
    expect(createButton).toBeInTheDocument()
    expect(createButton).toHaveClass('kanban-empty-action', 'primary-action')
    expect(createButton?.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('.kanban-mobile-new')).not.toBeInTheDocument()

    await userEvent.click(createButton!)
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('progressively reveals long inspector deadline lists', async () => {
    const application = manyApplications(1)[0]
    const taskSeed = application.tasks[0]
    application.tasks = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(taskSeed),
      id: `deadline-task-${index + 1}`,
      title: `Deadline task ${index + 1}`,
      due: `2027-01-${String((index % 28) + 1).padStart(2, '0')}`,
      done: false,
    }))

    const { container } = renderWithI18n(
      <Inspector
        application={application}
        backups={[]}
        isPro
        onCopy={vi.fn()}
        onEditField={vi.fn()}
        onExport={vi.fn()}
        onBackup={vi.fn()}
        onUpgrade={vi.fn()}
        onRestore={vi.fn()}
        onDeleteBackup={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('.inspector-deadline-row')).toHaveLength(12)
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(container.querySelectorAll('.inspector-deadline-row').length).toBeGreaterThan(12)
  })

  it('keeps expired inspector deadlines hidden until the user asks to reveal them', async () => {
    const application = manyApplications(1)[0]
    application.deadline = `${Number(today.slice(0, 4)) - 1}-01-01`
    application.materials = []
    application.tasks = []
    application.scholarships = []
    const onShowPastDeadlinesChange = vi.fn()
    const inspectorProps = {
      application,
      backups: [],
      isPro: true,
      onCopy: vi.fn(),
      onEditField: vi.fn(),
      onExport: vi.fn(),
      onBackup: vi.fn(),
      onUpgrade: vi.fn(),
      onRestore: vi.fn(),
      onDeleteBackup: vi.fn(),
      onShowPastDeadlinesChange,
    }

    const hidden = renderWithI18n(<Inspector {...inspectorProps} />)

    expect(hidden.container.querySelector('#inspector-past-deadlines')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(screen.getByRole('button', { name: /Show expired/ }))
    expect(onShowPastDeadlinesChange).toHaveBeenCalledWith(true)

    hidden.unmount()
    const visible = renderWithI18n(<Inspector {...inspectorProps} showPastDeadlines />)
    expect(visible.container.querySelectorAll('.inspector-deadline-row.past')).toHaveLength(1)
  })
})
