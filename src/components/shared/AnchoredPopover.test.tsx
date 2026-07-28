import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnchoredPopover } from './AnchoredPopover'

describe('AnchoredPopover', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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
    const dialog = screen.getByRole('dialog', { name: 'Choose icon' })
    expect(dialog).toHaveClass('anchored-popover-positioner', 'is-positioned')
    expect(dialog).toHaveStyle({ position: 'fixed' })
    expect(dialog.querySelector('.anchored-popover')).not.toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'New icon' }))
    expect(screen.getByRole('dialog', { name: 'Choose icon' }).className).toContain('is-exiting')
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    act(() => vi.advanceTimersByTime(170))
    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    vi.useRealTimers()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Icon: Current icon' })))
  })

  it('cancels delayed focus restoration when the popover owner unmounts', () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <AnchoredPopover
        trigger="Current icon"
        triggerAriaLabel="Icon: Current icon"
        popoverAriaLabel="Choose icon"
      >
        {(close) => <button type="button" onClick={close}>New icon</button>}
      </AnchoredPopover>,
    )

    const trigger = screen.getByRole('button', { name: 'Icon: Current icon' })
    const focusSpy = vi.spyOn(trigger, 'focus')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'New icon' }))
    focusSpy.mockClear()

    unmount()
    act(() => vi.advanceTimersByTime(200))

    expect(focusSpy).not.toHaveBeenCalled()
  })
})
