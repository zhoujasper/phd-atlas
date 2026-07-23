import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
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

  it('groups team applications by student and progressively discloses each student flow', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onNewForStudent = vi.fn()
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
        />
      </I18nContext.Provider>,
    )

    expect(document.querySelectorAll('.team-kanban-student')).toHaveLength(2)
    expect(screen.getByText('Ada Lovelace')).toBeVisible()
    expect(screen.getByText('Grace Hopper')).toBeVisible()
    expect(document.querySelectorAll('.team-kanban-application-row')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(document.querySelectorAll('.team-kanban-application-row')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: /Student school 4/i }))

    expect(screen.getByText('Student school 4')).toBeVisible()
    expect(onSelect).toHaveBeenCalledWith('student-application-3')

    const graceCard = screen.getByText('Grace Hopper').closest('article')
    expect(graceCard).not.toBeNull()
    await user.click(within(graceCard!).getByRole('button', { name: 'team.teacherCreateForStudent' }))
    expect(onNewForStudent).toHaveBeenCalledWith('student-grace')
  })
})
