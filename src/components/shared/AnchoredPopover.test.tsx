import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnchoredPopover } from './AnchoredPopover'
import { Select } from './Select'

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

  it('does not steal focus from a field reached before delayed initial focus runs', async () => {
    render(
      <AnchoredPopover
        trigger="Recipients"
        triggerAriaLabel="Recipients"
        popoverAriaLabel="Recipient settings"
      >
        {() => (
          <>
            <button type="button" data-popover-autofocus="true">Current recipient</button>
            <label>
              Add recipient
              <input />
            </label>
          </>
        )}
      </AnchoredPopover>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recipients' }))
    const input = screen.getByRole('textbox', { name: 'Add recipient' })
    input.focus()

    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('keeps a nested Select above its parent and lets Escape close the Select first', () => {
    vi.useFakeTimers()
    render(
      <AnchoredPopover
        trigger="Filters"
        triggerAriaLabel="Member filters"
        popoverAriaLabel="Member filters"
      >
        {() => (
          <Select
            value="all"
            ariaLabel="Role"
            options={[
              { value: 'all', label: 'All roles' },
              { value: 'member', label: 'Student' },
            ]}
            onChange={vi.fn()}
          />
        )}
      </AnchoredPopover>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Member filters' }))
    const parentDialog = screen.getByRole('dialog', { name: 'Member filters' })
    const selectTrigger = screen.getByRole('button', { name: 'Role' })
    fireEvent.mouseDown(selectTrigger)

    const listbox = screen.getByRole('listbox', { name: 'Role' })
    expect(Number(listbox.style.zIndex)).toBeGreaterThan(Number(parentDialog.style.zIndex))

    fireEvent.keyDown(selectTrigger, { key: 'Escape' })
    expect(parentDialog).not.toHaveClass('is-exiting')
    expect(listbox).toHaveClass('custom-select-exit')

    act(() => vi.advanceTimersByTime(170))
    expect(screen.queryByRole('listbox', { name: 'Role' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Member filters' })).toBeVisible()
  })

  it('keeps a nested anchored menu open above its parent without dismissing the parent', () => {
    vi.useFakeTimers()
    render(
      <AnchoredPopover
        trigger="Join code"
        triggerAriaLabel="Join code"
        popoverAriaLabel="Join code"
      >
        {() => (
          <AnchoredPopover
            trigger="Teachers"
            triggerAriaLabel="Teachers"
            popoverAriaLabel="Choose teachers"
          >
            {(close) => <button type="button" onClick={close}>Done choosing</button>}
          </AnchoredPopover>
        )}
      </AnchoredPopover>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Join code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Teachers' }))
    const parentDialog = screen.getByRole('dialog', { name: 'Join code' })
    const childDialog = screen.getByRole('dialog', { name: 'Choose teachers' })
    expect(Number(childDialog.style.zIndex)).toBeGreaterThan(Number(parentDialog.style.zIndex))

    const done = screen.getByRole('button', { name: 'Done choosing' })
    fireEvent.mouseDown(done)
    fireEvent.click(done)
    expect(parentDialog).not.toHaveClass('is-exiting')
    expect(childDialog).toHaveClass('is-exiting')

    act(() => vi.advanceTimersByTime(170))
    expect(screen.queryByRole('dialog', { name: 'Choose teachers' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Join code' })).toBeVisible()
  })
})
