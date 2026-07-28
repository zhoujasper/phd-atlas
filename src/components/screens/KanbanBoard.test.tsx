import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applications as sampleApplications } from '../../data/applications'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { KanbanBoard } from './KanbanBoard'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path, fallback) => path === 'kanban.showMore' ? 'Show {count} more' : (fallback ?? path),
}

describe('KanbanBoard mobile rendering', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
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
    vi.restoreAllMocks()
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

    expect(screen.getByText('Mobile school 8')).toBeVisible()
    expect(screen.queryByText('Mobile school 9')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.kanban-card')).toHaveLength(8)
    expect(document.querySelector('.kanban-progressive-loader')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show 4 more' }))

    expect(screen.getByText('Mobile school 12')).toBeVisible()
    expect(document.querySelectorAll('.kanban-card')).toHaveLength(12)
    expect(document.querySelector('.kanban-progressive-loader')).not.toBeInTheDocument()
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

    expect(screen.getByText('Custom status school')).toBeVisible()
    expect(screen.getByText('Committee review')).toBeVisible()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Custom status school/i }), {
      clientX: 48,
      clientY: 64,
    })
    await user.click(screen.getByText('kanban.moveTo'))
    expect(screen.getByText('Funding pending')).toBeVisible()
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
    expect(screen.getByText('Ada Lovelace')).toBeVisible()
    expect(screen.getByText('Grace Hopper')).toBeVisible()
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

    expect(screen.getByText('Student school 4')).toBeVisible()
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
  })

  it('assigns measured row spans so unequal team cards do not reserve shared grid-row gaps', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(this: HTMLElement) {
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
  })
})
