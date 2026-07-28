import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { useTableColumnMenu } from './useTableColumnMenu'

function ColumnMenuHarness() {
  const { openMenu, menuNode } = useTableColumnMenu('column-menu-toggle-test', [
    { id: 'name', label: 'Name', defaultWidth: 160, hideable: false },
    { id: 'location', label: 'Location', defaultWidth: 120 },
  ])
  return (
    <>
      <button type="button" onClick={(event) => openMenu(event, 'Columns')}>Columns</button>
      {menuNode}
    </>
  )
}

describe('useTableColumnMenu', () => {
  it('closes the open column menu when its trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(<ColumnMenuHarness />)

    const trigger = screen.getByRole('button', { name: 'Columns' })
    await user.click(trigger)
    expect(screen.getByRole('menu', { name: 'Columns' })).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByRole('menu', { name: 'Columns' })).toHaveClass('exit')
  })
})
