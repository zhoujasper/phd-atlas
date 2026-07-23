import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

describe('Select', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView })
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('keeps the options anchored to the trigger on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('custom-select-root')) return new DOMRect(220, 260, 136, 36)
      if (this.classList.contains('custom-select-dropdown')) return new DOMRect(220, 300, 160, 286)
      return new DOMRect()
    })
    const user = userEvent.setup()

    render(
      <Select
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('listbox')).toHaveStyle({
      position: 'fixed',
      left: '220px',
      top: '300px',
      bottom: 'auto',
      width: '160px',
    })
    rectSpy.mockRestore()
  })

  it('creates a searchable custom option from the trailing action', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <Select
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={vi.fn()}
        searchable
        create={{
          label: 'Add custom option',
          placeholder: 'Option name',
          createAriaLabel: 'Create option',
          renameAriaLabel: 'Rename option',
          deleteAriaLabel: 'Delete option',
          onCreate,
        }}
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Add custom option' }))
    const input = screen.getByRole('textbox', { name: 'Create option' })
    await user.type(input, 'My option{enter}')

    expect(onCreate).toHaveBeenCalledWith('My option')
  })

  it('exposes rename and delete controls only for custom options', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const onDelete = vi.fn()

    render(
      <Select
        value="custom"
        options={[
          { value: 'built-in', label: 'Built in' },
          { value: 'custom', label: 'Custom value', custom: true },
        ]}
        onChange={vi.fn()}
        create={{
          label: 'Add custom option',
          placeholder: 'Option name',
          createAriaLabel: 'Create option',
          renameAriaLabel: 'Rename option',
          deleteAriaLabel: 'Delete option',
          onCreate: vi.fn(),
          onRename,
          onDelete,
        }}
      />,
    )

    await user.click(screen.getByRole('button'))
    expect(screen.queryByRole('button', { name: /Rename option: Built in/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Rename option: Custom value' }))
    const renameInput = screen.getByRole('textbox', { name: 'Rename option' })
    await user.clear(renameInput)
    await user.type(renameInput, 'Renamed{enter}')
    expect(onRename).toHaveBeenCalledWith('custom', 'Renamed')

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Delete option: Custom value' }))
    expect(onDelete).toHaveBeenCalledWith('custom')
  })
})
