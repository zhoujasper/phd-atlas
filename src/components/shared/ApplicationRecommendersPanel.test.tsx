import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ChangeEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MaterialRecommender } from '../../data/applications'
import { I18nContext } from '../hooks/useI18n'
import {
  ApplicationRecommendersPanel,
  type ApplicationRecommenderPatch,
  type ApplicationRecommenderUpdateIntent,
} from './ApplicationRecommendersPanel'

vi.mock('./RecommenderCombobox', () => ({
  RecommenderCombobox: ({
    value,
    onChange,
    nameLabel,
    emailLabel,
    phoneLabel,
    nameRequired,
  }: {
    value: MaterialRecommender
    onChange: (next: MaterialRecommender, reason: 'input' | 'selection') => void
    nameLabel: string
    emailLabel: string
    phoneLabel: string
    nameRequired?: boolean
  }) => (
    <div data-testid={`combobox-${value.id}`}>
      <input
        className="recommender-combobox-name-input"
        aria-label={nameLabel}
        value={value.name}
        required={nameRequired}
        onChange={(event) => onChange({ ...value, name: event.target.value }, 'input')}
      />
      <input
        type="email"
        aria-label={emailLabel}
        value={value.email ?? value.contact}
        onChange={(event) => onChange({
          ...value,
          contact: event.target.value,
          email: event.target.value,
        }, 'input')}
      />
      <input
        type="tel"
        aria-label={phoneLabel}
        value={value.phone ?? ''}
        onChange={(event) => onChange({ ...value, phone: event.target.value }, 'input')}
      />
    </div>
  ),
}))

vi.mock('./LazyMarkdownTextarea', () => ({
  LazyMarkdownTextarea: ({
    value,
    onChange,
    ...props
  }: {
    value: string
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
    'aria-label'?: string
    placeholder?: string
    disabled?: boolean
  }) => <textarea value={value} onChange={onChange} {...props} />,
}))

vi.mock('./DatePicker', () => ({
  DatePicker: ({
    value,
    onChange,
    placeholder,
    timeValue,
    onTimeChange,
    timeAriaLabel,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    timeValue?: string
    onTimeChange?: (value: string) => void
    timeAriaLabel?: string
  }) => (
    <>
      <input
        type="text"
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {onTimeChange ? (
        <input
          type="text"
          aria-label={timeAriaLabel ?? 'Choose time'}
          value={timeValue ?? ''}
          onChange={(event) => onTimeChange(event.target.value)}
        />
      ) : null}
    </>
  ),
}))

const copy: Record<string, string> = {
  'dossier.recommenderOverviewTitle': 'Recommendation letters',
  'dossier.recommenderOverviewDescription': 'Recommendation schedule',
  'dossier.recommenderOverviewCount': '{count} recommenders',
  'dossier.recommenderOverviewAdd': 'Add recommender',
  'dossier.recommenderOverviewEmptyTitle': 'No recommenders yet',
  'dossier.recommenderOverviewEmptyDescription': 'Add the people preparing recommendation letters.',
  'dossier.recommenderOverviewUnnamed': 'Unnamed recommender',
  'dossier.recommenderOverviewEmailMissing': 'No contact details',
  'dossier.recommenderOverviewToggle': 'Show or hide {name}',
  'dossier.recommenderOverviewDue': 'Deadline {date}',
  'dossier.recommenderOverviewRemind': 'Reminder {date}',
  'dossier.recommenderOverviewNotes': 'Notes',
  'dossier.recommenderOverviewNotesPlaceholder': 'Private application notes',
  'dossier.recommenderOverviewDeadline': 'Deadline',
  'dossier.recommenderOverviewReminderDate': 'Reminder date',
  'dossier.recommenderOverviewReminderTime': 'Time',
  'dossier.recommenderOverviewRemove': 'Remove',
  'dossier.recommenderOverviewSuggestions': 'Saved recommenders',
  'dossier.recommenderOverviewNoSuggestions': 'No saved match',
  'dossier.recommenderOverviewReminderAfterDeadline': 'Reminder must not be after the deadline.',
  'dossier.recommenderOverviewDuplicateEmail': 'Another recommender already uses this email address.',
  'dossier.recommenderName': 'Recommender name',
  'dossier.recommenderContact': 'Email or contact',
  'dossier.recommenderEmail': 'Email address',
  'dossier.recommenderPhone': 'Phone number',
  'dossier.save': 'Save',
  'dossier.saving': 'Saving…',
  'timePicker.toggle': 'Choose time',
  'timePicker.placeholder': '--:--',
}

function renderPanel({
  recommenders,
  onAdd = vi.fn(),
  onUpdate = vi.fn(),
  onSave = vi.fn(),
  onRemove = vi.fn(),
  onRequestClose,
  disabled = false,
}: {
  recommenders: MaterialRecommender[]
  onAdd?: () => string | void
  onUpdate?: (
    id: string,
    patch: ApplicationRecommenderPatch,
    intent: ApplicationRecommenderUpdateIntent,
  ) => void
  onSave?: (id: string) => boolean | void | Promise<boolean | void>
  onRemove?: (id: string) => void
  onRequestClose?: (id: string, proceed: () => void) => void
  disabled?: boolean
}) {
  return render(
    <I18nContext.Provider
      value={{
        lang: 'en',
        t: {},
        format: (template, values) => Object.entries(values).reduce(
          (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
          template,
        ),
        tx: (path) => copy[path] ?? path,
      }}
    >
      <ApplicationRecommendersPanel
        recommenders={recommenders}
        options={[]}
        disabled={disabled}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onSave={onSave}
        onRemove={onRemove}
        onRequestClose={onRequestClose}
      />
    </I18nContext.Provider>,
  )
}

const ada = {
  id: 'ada',
  name: 'Prof. Ada Lovelace',
  contact: 'ada@example.edu',
  email: 'ada@example.edu',
  phone: '+44 20 7946 0958',
  notes: 'Discussed research fit.',
  deadline: '2026-12-15',
  reminderDate: '2026-12-01',
  reminderTime: '09:30',
} as MaterialRecommender

const grace = {
  id: 'grace',
  name: 'Prof. Grace Hopper',
  contact: 'grace@example.edu',
  deadline: '2027-01-10',
} as MaterialRecommender

describe('ApplicationRecommendersPanel', () => {
  it('renders a calm empty state and keeps Add as the single compact creation action', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    renderPanel({ recommenders: [], onAdd })

    expect(screen.getByRole('heading', { name: 'Recommendation letters' })).toBeInTheDocument()
    expect(screen.getByText('0 recommenders')).toBeInTheDocument()
    expect(screen.getByText('No recommenders yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add recommender' }))
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('keeps a newly added teacher mounted through its inline entrance and focuses its name field', async () => {
    const user = userEvent.setup()
    function StatefulPanel() {
      const [recommenders, setRecommenders] = useState<MaterialRecommender[]>([])
      return (
        <I18nContext.Provider
          value={{
            lang: 'en',
            t: {},
            format: (template, values) => Object.entries(values).reduce(
              (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
              template,
            ),
            tx: (path) => copy[path] ?? path,
          }}
        >
          <ApplicationRecommendersPanel
            recommenders={recommenders}
            options={[]}
            onAdd={() => {
              const recommender = {
                id: 'new-teacher',
                name: '',
                contact: '',
              } as MaterialRecommender
              setRecommenders((current) => [...current, recommender])
              return recommender.id
            }}
            onUpdate={(id, patch) => {
              setRecommenders((current) => current.map((recommender) => (
                recommender.id === id ? { ...recommender, ...patch } : recommender
              )))
            }}
            onSave={vi.fn()}
            onRemove={(id) => setRecommenders((current) => current.filter((recommender) => recommender.id !== id))}
          />
        </I18nContext.Provider>
      )
    }

    render(<StatefulPanel />)
    await user.click(screen.getByRole('button', { name: 'Add recommender' }))

    const row = document.querySelector<HTMLElement>('[data-recommender-id="new-teacher"]')
    expect(row).toHaveClass('is-expanded')
    expect(screen.getByRole('textbox', { name: 'Recommender name' })).toBeInTheDocument()

    await waitFor(() => {
      expect(document.querySelector('[data-recommender-id="new-teacher"]')).toBeInTheDocument()
      expect(document.querySelector('[data-recommender-id="new-teacher"]')).not.toHaveClass('is-entering')
    })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Recommender name' })).toHaveFocus())
  })

  it('keeps one row expanded, exposes inert disclosure state, and summarizes the nearest milestone', async () => {
    const user = userEvent.setup()
    renderPanel({ recommenders: [ada, grace] })

    const rows = document.querySelectorAll<HTMLElement>('.application-recommender-row')
    const adaSummary = within(rows[0]).getByRole('button', { name: /Ada Lovelace/ })
    const graceSummary = within(rows[1]).getByRole('button', { name: /Grace Hopper/ })

    expect(rows[0].querySelector('.application-recommender-milestone')).toHaveTextContent(/Reminder/)
    expect(adaSummary).toHaveAttribute('aria-expanded', 'false')
    expect(rows[0].querySelector('.application-recommender-detail')).toHaveAttribute('inert')

    await user.click(adaSummary)
    expect(adaSummary).toHaveAttribute('aria-expanded', 'true')
    expect(rows[0].querySelector('.application-recommender-detail')).not.toHaveAttribute('inert')

    await user.click(graceSummary)
    expect(graceSummary).toHaveAttribute('aria-expanded', 'true')
    expect(adaSummary).toHaveAttribute('aria-expanded', 'false')
    expect(rows[0].querySelector('.application-recommender-detail')).toHaveAttribute('inert')
  })

  it('asks the owner before collapsing or switching away from the active row', async () => {
    const user = userEvent.setup()
    let proceed: (() => void) | undefined
    const onRequestClose = vi.fn((_id: string, next: () => void) => {
      proceed = next
    })
    renderPanel({ recommenders: [ada, grace], onRequestClose })

    const rows = document.querySelectorAll<HTMLElement>('.application-recommender-row')
    const adaSummary = within(rows[0]).getByRole('button', { name: /Ada Lovelace/ })
    const graceSummary = within(rows[1]).getByRole('button', { name: /Grace Hopper/ })
    await user.click(adaSummary)
    await user.click(graceSummary)

    expect(onRequestClose).toHaveBeenCalledWith('ada', expect.any(Function))
    expect(adaSummary).toHaveAttribute('aria-expanded', 'true')
    expect(graceSummary).toHaveAttribute('aria-expanded', 'false')

    await act(async () => proceed?.())
    expect(adaSummary).toHaveAttribute('aria-expanded', 'false')
    expect(graceSummary).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps email, phone and private application notes separate while routing resident edits', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    renderPanel({ recommenders: [ada], onUpdate })
    const row = document.querySelector<HTMLElement>('.application-recommender-row')!
    await user.click(within(row).getByRole('button', { name: /Ada Lovelace/ }))

    fireEvent.change(within(row).getByRole('textbox', { name: 'Recommender name' }), {
      target: { value: 'Professor Ada' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', {
      name: 'Professor Ada',
      contact: 'ada@example.edu',
      email: 'ada@example.edu',
      phone: '+44 20 7946 0958',
      profileId: undefined,
    }, 'settled')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'new-ada@example.edu' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', {
      name: 'Prof. Ada Lovelace',
      contact: 'new-ada@example.edu',
      email: 'new-ada@example.edu',
      phone: '+44 20 7946 0958',
      profileId: undefined,
    }, 'settled')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Phone number' }), {
      target: { value: '+44 20 7000 0000' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', {
      name: 'Prof. Ada Lovelace',
      contact: 'ada@example.edu',
      email: 'ada@example.edu',
      phone: '+44 20 7000 0000',
      profileId: undefined,
    }, 'settled')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Updated notes' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', { notes: 'Updated notes' }, 'settled')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Deadline' }), {
      target: { value: '2026-12-20' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', { deadline: '2026-12-20' }, 'immediate')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Choose time' }), {
      target: { value: '17:00' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', { deadlineTime: '17:00' }, 'immediate')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Reminder date' }), {
      target: { value: '2026-12-10' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', { reminderDate: '2026-12-10' }, 'immediate')

    fireEvent.change(within(row).getByRole('textbox', { name: 'Time' }), {
      target: { value: '08:45' },
    })
    expect(onUpdate).toHaveBeenLastCalledWith('ada', { reminderTime: '08:45' }, 'immediate')
  })

  it('requires a teacher name and exposes an explicit save action', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => true)
    const unnamed = { ...ada, name: '' }
    const view = renderPanel({ recommenders: [unnamed], onSave })
    const row = document.querySelector<HTMLElement>('.application-recommender-row')!
    await user.click(within(row).getByRole('button', { name: /Unnamed recommender/ }))

    expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled()

    view.rerender(
      <I18nContext.Provider value={{
        lang: 'en',
        t: {},
        format: (template, values) => Object.entries(values).reduce(
          (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
          template,
        ),
        tx: (path) => copy[path] ?? path,
      }}>
        <ApplicationRecommendersPanel
          recommenders={[ada]}
          options={[]}
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          onSave={onSave}
          onRemove={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('ada')
  })

  it('keeps the editor mounted until the asynchronous save is confirmed', async () => {
    const user = userEvent.setup()
    let resolveSave: ((saved: boolean) => void) | undefined
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveSave = resolve
    }))
    renderPanel({ recommenders: [ada], onSave })
    const row = document.querySelector<HTMLElement>('.application-recommender-row')!
    const summary = within(row).getByRole('button', { name: /Ada Lovelace/ })

    await user.click(summary)
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(within(row).getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(summary).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add recommender' })).toBeDisabled()

    resolveSave?.(false)
    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    expect(summary).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps a teacher mounted for a short exit before removing it', () => {
    vi.useFakeTimers()
    try {
      const onRemove = vi.fn()
      renderPanel({ recommenders: [ada], onRemove })
      const row = document.querySelector<HTMLElement>('.application-recommender-row')!

      fireEvent.click(within(row).getByRole('button', { name: /Ada Lovelace/ }))
      fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
      expect(row).toHaveClass('is-removing')
      expect(onRemove).not.toHaveBeenCalled()

      vi.advanceTimersByTime(220)
      expect(onRemove).toHaveBeenCalledWith('ada')
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes a localized alert when the reminder falls after the recommendation deadline', async () => {
    const user = userEvent.setup()
    const invalid = {
      ...ada,
      deadline: '2026-12-01',
      reminderDate: '2026-12-02',
    } as MaterialRecommender
    renderPanel({ recommenders: [invalid] })

    await user.click(screen.getByRole('button', { name: /Ada Lovelace/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Reminder must not be after the deadline.')
    expect(document.querySelector('.application-recommender-row')).toHaveClass('has-invalid-reminder')
    expect(document.querySelector('.application-recommender-milestone')).toHaveTextContent(/Deadline/)
  })

  it('opens the row that was clicked even when a legacy record repeats a recommender id', async () => {
    const user = userEvent.setup()
    // Aggregation before the directory deduplicated could emit one id twice.
    // Keying on the raw id made React treat both rows as one, so clicking the
    // later row expanded the earlier one.
    const duplicated = [
      { ...ada, id: 'shared', name: 'Prof. Ada Lovelace', email: 'ada@example.edu' },
      { ...grace, id: 'shared', name: 'Prof. Grace Hopper', email: 'grace@example.edu' },
    ] as MaterialRecommender[]
    renderPanel({ recommenders: duplicated })

    const rows = document.querySelectorAll('.application-recommender-row')
    expect(rows).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /Grace Hopper/ }))
    expect(rows[1]).toHaveClass('is-expanded')
    expect(rows[0]).not.toHaveClass('is-expanded')

    await user.click(screen.getByRole('button', { name: /Ada Lovelace/ }))
    expect(rows[0]).toHaveClass('is-expanded')
    expect(rows[1]).not.toHaveClass('is-expanded')
  })

  it('blocks saving a second row that reuses another recommender email on the same application', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const collided = [
      ada,
      { ...grace, contact: 'ada@example.edu', email: 'ada@example.edu' },
    ] as MaterialRecommender[]
    renderPanel({ recommenders: collided, onSave })

    const rows = document.querySelectorAll('.application-recommender-row')
    expect(rows[0]).toHaveClass('has-invalid-reminder')
    expect(rows[1]).toHaveClass('has-invalid-reminder')

    await user.click(screen.getByRole('button', { name: /Grace Hopper/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Another recommender already uses this email address.')
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })
})
