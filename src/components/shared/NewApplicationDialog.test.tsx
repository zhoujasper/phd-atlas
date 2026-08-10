import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareForSafeReload } from '../../safeReload'
import { NewApplicationDialog } from './NewApplicationDialog'

describe('NewApplicationDialog', () => {
  beforeAll(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps focus in text fields while typing', async () => {
    const user = userEvent.setup()

    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    const professorInput = screen.getByLabelText(/^Professor \*$/)
    await user.click(professorInput)
    await user.type(professorInput, 'Jasper')

    expect(professorInput).toHaveValue('Jasper')
    expect(professorInput).toHaveFocus()

    const emailInput = screen.getByLabelText(/^Professor email \*$/)
    await user.click(emailInput)
    await user.type(emailInput, 'jasper@example.com')

    expect(emailInput).toHaveValue('jasper@example.com')
    expect(emailInput).toHaveFocus()
  })

  it('uses an optional shared searchable country picker for every new application flow', async () => {
    const user = userEvent.setup()

    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        teamMode="team-student-picker"
        studentOptions={[{ id: 'student-1', name: 'Ada Lovelace' }]}
        defaultStudentId="student-1"
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'Country' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.new-dialog .field-required-mark')).toHaveLength(5)

    const countryTrigger = screen.getByRole('button', { name: 'Country' })
    expect(countryTrigger.querySelector('.country-select-value')).toHaveClass('placeholder')
    expect(countryTrigger).not.toHaveTextContent('United States')

    await user.click(countryTrigger)
    const countrySearch = await screen.findByRole('searchbox', { name: 'Search countries…' })
    await user.type(countrySearch, 'Canada')
    await user.click(screen.getByRole('option', { name: /Canada/ }))

    expect(countryTrigger).toHaveTextContent('Canada')
  })

  it('creates an application without a country while retaining required-field markers', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(() => false)

    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    )

    await user.type(screen.getByLabelText(/^Professor \*$/), 'Professor Lee')
    await user.type(screen.getByLabelText(/^Professor email \*$/), 'lee@example.edu')
    await user.type(screen.getByLabelText(/^University \*$/), 'Example University')
    await user.type(screen.getByLabelText(/^Program \*$/), 'Computer Science PhD')
    await user.click(screen.getByRole('button', { name: /create dossier/i }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      country: '',
      professor: 'Professor Lee',
      professorEmail: 'lee@example.edu',
      university: 'Example University',
      program: 'Computer Science PhD',
    }))
  })

  it('marks the server-rejected field with a pale error state and clears it on edit', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue({ field: 'professorHomepage' })

    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    )

    await user.type(screen.getByLabelText(/^Professor \*$/), 'Professor Lee')
    await user.type(screen.getByLabelText(/^Professor email \*$/), 'lee@example.edu')
    await user.type(screen.getByLabelText(/^University \*$/), 'Example University')
    await user.type(screen.getByLabelText(/^Program \*$/), 'Computer Science PhD')
    const homepage = screen.getByLabelText('Professor homepage')
    await user.type(homepage, 'https://example.edu/professor')
    await user.click(screen.getByRole('button', { name: /create dossier/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(homepage).toHaveAttribute('aria-invalid', 'true')
    expect(homepage.closest('[data-field-path="professorHomepage"]')).toHaveClass('field-has-error')

    await user.clear(homepage)
    expect(homepage).not.toHaveAttribute('aria-invalid')
    expect(homepage.closest('[data-field-path="professorHomepage"]')).not.toHaveClass('field-has-error')
  })

  it('persists a resident draft by user and workspace and restores only the matching scope', async () => {
    const user = userEvent.setup()
    const common = { open: true, busy: false, onClose: vi.fn(), onCreate: vi.fn() }
    const first = render(
      <NewApplicationDialog {...common} draftIdentity={{ userId: 'user-a', workspaceId: 'personal' }} />,
    )

    await user.type(screen.getByLabelText(/^Professor \*$/), 'Resident Professor')
    await user.type(screen.getByLabelText('Professor homepage'), 'https://example.edu/resident')
    await waitFor(() => expect(Array.from({ length: sessionStorage.length }, (_, index) => (
      sessionStorage.getItem(sessionStorage.key(index) ?? '') ?? ''
    )).join('')).toContain('https://example.edu/resident'))
    first.unmount()

    const otherWorkspace = render(
      <NewApplicationDialog {...common} draftIdentity={{ userId: 'user-a', workspaceId: 'team-b' }} />,
    )
    expect(screen.getByLabelText(/^Professor \*$/)).toHaveValue('')
    otherWorkspace.unmount()

    const otherUser = render(
      <NewApplicationDialog {...common} draftIdentity={{ userId: 'user-b', workspaceId: 'personal' }} />,
    )
    expect(screen.getByLabelText(/^Professor \*$/)).toHaveValue('')
    otherUser.unmount()

    render(
      <NewApplicationDialog {...common} draftIdentity={{ userId: 'user-a', workspaceId: 'personal' }} />,
    )
    expect(screen.getByLabelText(/^Professor \*$/)).toHaveValue('Resident Professor')
    expect(screen.getByLabelText('Professor homepage')).toHaveValue('https://example.edu/resident')
  })

  it('blocks automatic reload while dirty after verifying the recovery write', async () => {
    const user = userEvent.setup()
    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        draftIdentity={{ userId: 'user-a', workspaceId: 'personal' }}
      />,
    )

    await user.type(screen.getByLabelText(/^Professor \*$/), 'Unsaved Professor')
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    await expect(prepareForSafeReload({ reason: 'lazy-module' })).resolves.toBe(false)
  })

  it('keeps the resident fields when a background Team snapshot refreshes options', async () => {
    const user = userEvent.setup()
    const common = {
      open: true,
      busy: false,
      onClose: vi.fn(),
      onCreate: vi.fn(),
      teamMode: 'team-student-picker' as const,
      defaultStudentId: 'student-1',
      draftIdentity: { userId: 'teacher-a', workspaceId: 'team-a' },
    }
    const view = render(
      <NewApplicationDialog {...common} studentOptions={[{ id: 'student-1', name: 'Student One' }]} />,
    )
    await user.type(screen.getByLabelText(/^Professor \*$/), 'Local unsaved professor')

    view.rerender(
      <NewApplicationDialog
        {...common}
        studentOptions={[
          { id: 'student-1', name: 'Student One refreshed' },
          { id: 'student-2', name: 'Student Two' },
        ]}
      />,
    )

    expect(screen.getByLabelText(/^Professor \*$/)).toHaveValue('Local unsaved professor')
  })

  it('keeps the complete draft retryable after a rejected durable create', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(new Error('write rejected'))
    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        draftIdentity={{ userId: 'user-a', workspaceId: 'personal' }}
      />,
    )

    await user.type(screen.getByLabelText(/^Professor \*$/), 'Professor Retry')
    await user.type(screen.getByLabelText(/^Professor email \*$/), 'retry@example.edu')
    await user.type(screen.getByLabelText(/^University \*$/), 'Retry University')
    await user.type(screen.getByLabelText(/^Program \*$/), 'Retry PhD')
    await user.type(screen.getByLabelText('Professor homepage'), 'https://example.edu/retry')
    await user.click(screen.getByRole('button', { name: /create dossier/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText(/^Professor \*$/)).toHaveValue('Professor Retry')
    expect(screen.getByLabelText('Professor homepage')).toHaveValue('https://example.edu/retry')
    await waitFor(() => expect(screen.getByRole('button', { name: /create dossier/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /create dossier/i }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
  })

  it('clears recovery only after a successful durable create', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(true)
    render(
      <NewApplicationDialog
        open
        busy={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        draftIdentity={{ userId: 'user-a', workspaceId: 'personal' }}
      />,
    )

    await user.type(screen.getByLabelText(/^Professor \*$/), 'Professor Saved')
    await user.type(screen.getByLabelText(/^Professor email \*$/), 'saved@example.edu')
    await user.type(screen.getByLabelText(/^University \*$/), 'Saved University')
    await user.type(screen.getByLabelText(/^Program \*$/), 'Saved PhD')
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    await user.click(screen.getByRole('button', { name: /create dossier/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(sessionStorage.length).toBe(0)
  })
})
