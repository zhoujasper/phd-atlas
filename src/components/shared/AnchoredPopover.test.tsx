import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnchoredPopover } from './AnchoredPopover'

describe('AnchoredPopover', () => {
  it('keeps options hidden until the current selection is opened', async () => {
    const onOpenChange = vi.fn()
    render(
      <AnchoredPopover
        trigger="Current icon"
        triggerAriaLabel="Icon: Current icon"
        popoverAriaLabel="Choose icon"
        onOpenChange={onOpenChange}
      >
        {(close) => <button type="button" onClick={close}>New icon</button>}
      </AnchoredPopover>,
    )

    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Icon: Current icon' }))
    expect(screen.getByRole('dialog', { name: 'Choose icon' })).not.toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'New icon' }))
    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Icon: Current icon' })))
  })
})
