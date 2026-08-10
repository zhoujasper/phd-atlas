import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

  it('can mount directly into an open, focused editing state', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const onOpenChange = vi.fn()
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <Select
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={onChange}
        ariaLabel="Inline status"
        openOnMount
        onOpenChange={onOpenChange}
      />,
    )

    expect(await screen.findByRole('listbox', { name: 'Inline status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inline status' })).toHaveFocus()
    expect(onOpenChange).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('option', { name: 'Two' }))
    expect(onChange).toHaveBeenCalledWith('two')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
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

  it('preserves typing that begins before a pending positioning frame', async () => {
    const queuedFrames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queuedFrames.push(callback)
      return queuedFrames.length
    })
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <Select
        value="one"
        options={[{ value: 'one', label: 'One' }]}
        onChange={vi.fn()}
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
    await user.type(input, 'M')
    act(() => {
      for (const frame of queuedFrames.splice(0)) frame(performance.now())
    })
    await user.type(input, 'y option{enter}')

    expect(onCreate).toHaveBeenCalledWith('My option')
  })

  it('morphs the resident create action into a compact editor and restores focus on cancel', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const user = userEvent.setup()

    render(
      <Select
        value="one"
        options={[{ value: 'one', label: 'One' }]}
        onChange={vi.fn()}
        create={{
          label: 'Add custom option',
          placeholder: 'Option name',
          createAriaLabel: 'Create option',
          renameAriaLabel: 'Rename option',
          deleteAriaLabel: 'Delete option',
          onCreate: vi.fn(),
        }}
      />,
    )

    await user.click(screen.getByRole('button'))
    const createButton = screen.getByRole('button', { name: 'Add custom option' })
    const stage = createButton.closest('.custom-select-create-stage')
    const panel = stage?.querySelector('.custom-select-create-panel')

    expect(stage).toHaveAttribute('data-edit-mode', 'idle')
    expect(panel).toHaveAttribute('aria-hidden', 'true')

    await user.click(createButton)

    expect(stage).toHaveClass('is-editing')
    expect(stage).toHaveAttribute('data-edit-mode', 'create')
    expect(createButton).toHaveAttribute('aria-hidden', 'true')
    expect(panel).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('textbox', { name: 'Create option' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(stage).not.toHaveClass('is-editing')
    expect(stage).toHaveAttribute('data-edit-mode', 'idle')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    await waitFor(() => expect(createButton).toHaveFocus())
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

  it('renders presentational section labels and inline meta without changing option semantics', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const user = userEvent.setup()

    render(
      <Select
        value="alice"
        options={[
          { value: 'alice', label: 'Alice Chen', section: 'Recent', meta: '3 items' },
          { value: 'bob', label: 'Bob Singh', section: 'Directory' },
          { value: 'carol', label: 'Carol Rivera', section: 'Directory' },
        ]}
        onChange={vi.fn()}
        ariaLabel="Recommender"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Recommender' }))
    const listbox = screen.getByRole('listbox', { name: 'Recommender' })

    expect(listbox.querySelector('.custom-select-menu-header')).toBeNull()
    const meta = within(listbox).getByText('3 items')
    expect(meta).toHaveClass('custom-select-option-meta')
    expect(meta.closest('.custom-select-option-label')).not.toBeNull()
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    const sections = listbox.querySelectorAll('.custom-select-section')
    expect(sections).toHaveLength(2)
    expect(sections[0]).toHaveAttribute('role', 'presentation')
    expect(sections[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps a multi-select menu open and reports the toggled values', async () => {
    const user = userEvent.setup()
    const onMultiChange = vi.fn()

    render(
      <Select
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={vi.fn()}
        multiple
        selectedValues={['one']}
        onMultiChange={onMultiChange}
        multipleSelectedLabel="1 selected"
        ariaLabel="Categories"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    const listbox = screen.getByRole('listbox', { name: 'Categories' })
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getByRole('option', { name: 'One' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('option', { name: 'Two' }))

    expect(onMultiChange).toHaveBeenCalledWith(['one', 'two'])
    expect(screen.getByRole('listbox', { name: 'Categories' })).toBeInTheDocument()
  })

  it('keeps filtered keyboard indices and scroll targets aligned across section labels', async () => {
    const scrolledIndices: string[] = []
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(function (this: HTMLElement) {
        scrolledIndices.push(this.dataset.selectOptionIndex ?? 'missing')
      }),
    })
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <Select
        value="alice"
        options={[
          { value: 'alice', label: 'Alice Chen', section: 'Recent' },
          { value: 'bob', label: 'Bob Singh', section: 'Directory' },
          { value: 'carol', label: 'Carol Rivera', section: 'Directory' },
        ]}
        onChange={onChange}
        searchable
        ariaLabel="Recommender"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Recommender' }))
    await user.type(screen.getByRole('searchbox'), 'a')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('Directory')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('carol')
    expect(scrolledIndices.at(-1)).toBe('1')
  })
})
