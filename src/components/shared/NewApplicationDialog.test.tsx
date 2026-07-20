import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewApplicationDialog } from './NewApplicationDialog'

describe('NewApplicationDialog', () => {
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
})
