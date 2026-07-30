import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
    expect(document.querySelectorAll('.new-dialog .field-required-mark')).toHaveLength(4)

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
})
