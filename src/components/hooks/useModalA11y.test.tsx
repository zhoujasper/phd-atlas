import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModalA11y } from './useModalA11y'

function Dialog({ name = 'dialog', onClose = vi.fn(), onConfirm = vi.fn() }) {
  const ref = useModalA11y<HTMLDivElement>({ open: true, onClose, onConfirm })
  return <div ref={ref} role="dialog" aria-label={name}>
    <button hidden>Hidden</button>
    <input aria-label={`${name} title`} />
    <div contentEditable suppressContentEditableWarning data-testid={`${name}-editor`}>Notes</div>
    <button onClick={onClose}>Cancel {name}</button>
    <button onClick={onConfirm}>Confirm {name}</button>
  </div>
}

afterEach(() => vi.useRealTimers())

describe('modal keyboard ownership', () => {
  it('lets Enter activate Cancel without confirming a destructive action', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<Dialog onConfirm={onConfirm} onClose={onClose} />)
    const cancel = screen.getByRole('button', { name: 'Cancel dialog' })
    cancel.focus()
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not submit or close while an input method is composing', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<Dialog onConfirm={onConfirm} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'dialog title' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves rich-text Enter and consumed keyboard events to their controls', () => {
    const onConfirm = vi.fn()
    render(<Dialog onConfirm={onConfirm} />)
    fireEvent.keyDown(screen.getByTestId('dialog-editor'), { key: 'Enter' })
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    event.preventDefault()
    screen.getByRole('textbox', { name: 'dialog title' }).dispatchEvent(event)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('gives only the top dialog ownership of Escape and restores the parent', () => {
    const closeParent = vi.fn()
    const closeChild = vi.fn()
    const view = render(<><Dialog name="parent" onClose={closeParent} /><Dialog name="child" onClose={closeChild} /></>)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'child title' }), { key: 'Escape' })
    expect(closeChild).toHaveBeenCalledOnce()
    expect(closeParent).not.toHaveBeenCalled()
    view.rerender(<Dialog name="parent" onClose={closeParent} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'parent title' }), { key: 'Escape' })
    expect(closeParent).toHaveBeenCalledOnce()
  })

  it('does not steal focus the user already placed inside the dialog', () => {
    vi.useFakeTimers()
    render(<Dialog />)
    const cancel = screen.getByRole('button', { name: 'Cancel dialog' })
    cancel.focus()
    act(() => vi.advanceTimersByTime(32))
    expect(cancel).toHaveFocus()
  })

  it('accepts Escape from the opening trigger before the delayed focus enters the dialog', () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const view = render(<button>Open dialog</button>)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    view.rerender(<><button>Open dialog</button><Dialog onClose={close} /></>)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps a nested child above its parent when both mount in the same commit', () => {
    const closeParent = vi.fn()
    const closeChild = vi.fn()
    function Parent() {
      const ref = useModalA11y<HTMLDivElement>({ open: true, onClose: closeParent })
      return <div ref={ref} role="dialog"><Dialog name="nested" onClose={closeChild} /></div>
    }
    render(<Parent />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'nested title' }), { key: 'Escape' })
    expect(closeChild).toHaveBeenCalledOnce()
    expect(closeParent).not.toHaveBeenCalled()
  })

  it('wraps focus around visible controls only', () => {
    render(<Dialog />)
    screen.getByRole('button', { name: 'Confirm dialog' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(screen.getByRole('textbox', { name: 'dialog title' })).toHaveFocus()
  })
})
