import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExplorerContextMenu, type ExplorerContextMenuState } from './ExplorerContextMenu'

function renderMenu(menu: ExplorerContextMenuState, onClose = vi.fn()) {
  render(<ExplorerContextMenu menu={menu} onClose={onClose} />)
  return onClose
}

describe('ExplorerContextMenu', () => {
  it('opens status submenus as an animated flyout on hover', async () => {
    const onReady = vi.fn()
    const onClose = renderMenu({
      x: 120,
      y: 100,
      title: 'Funding item',
      items: [{
        id: 'status',
        label: 'Change status',
        submenu: {
          title: 'Change status',
          backLabel: 'Back',
          items: [
            {
              id: 'draft',
              label: 'Draft',
              radio: true,
              selected: true,
              statusTone: 'neutral',
              statusSlug: 'draft',
              onSelect: vi.fn(),
            },
            {
              id: 'ready',
              label: 'Ready',
              radio: true,
              statusTone: 'success',
              statusSlug: 'ready',
              onSelect: onReady,
            },
          ],
        },
      }],
    })

    await userEvent.hover(screen.getByRole('menuitem', { name: 'Change status' }))
    const flyout = screen.getByRole('menu', { name: 'Change status' })
    expect(flyout).toHaveClass('explorer-context-submenu')
    expect(flyout).toHaveClass('side-right')
    expect(flyout).toHaveClass('is-status-picker')
    expect(flyout.querySelectorAll('.explorer-context-status-dot')).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: 'Draft' })).toHaveClass('status-slug-draft')
    expect(screen.getByRole('menuitemradio', { name: 'Ready' })).toHaveClass('status-slug-ready')
    expect(screen.getByRole('menuitemradio', { name: 'Draft' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ready' }))
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('runs single-key accelerators without Ctrl or Command once open', () => {
    const onOpen = vi.fn()
    const onCopy = vi.fn()
    const onClose = renderMenu({
      x: 120,
      y: 100,
      title: 'Checklist item',
      items: [
        { id: 'open', label: 'Open', shortcut: 'O', accessKey: 'o', onSelect: onOpen },
        { id: 'copy', label: 'Copy', shortcut: 'C', accessKey: 'c', onSelect: onCopy },
      ],
    })

    fireEvent.keyDown(window, { key: 'c' })
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps main-menu accelerators active while a status flyout is open', async () => {
    const onCopy = vi.fn()
    const onClose = renderMenu({
      x: 120,
      y: 100,
      title: 'Checklist item',
      items: [
        {
          id: 'status',
          label: 'Change status',
          submenu: {
            title: 'Change status',
            backLabel: 'Back',
            items: [{ id: 'ready', label: 'Ready' }],
          },
        },
        { id: 'copy', label: 'Copy', shortcut: 'C', accessKey: 'c', onSelect: onCopy },
      ],
    })

    await userEvent.hover(screen.getByRole('menuitem', { name: 'Change status' }))
    expect(screen.getByRole('menu', { name: 'Change status' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'c' })
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores scroll dismiss while nested scrollers settle after open', () => {
    vi.useFakeTimers()
    const onClose = renderMenu({
      x: 120,
      y: 100,
      title: 'Application',
      items: [{ id: 'open', label: 'Open', onSelect: vi.fn() }],
    })

    // Focus/snap on dashboard cards can emit scroll in the same tick the menu mounts.
    fireEvent.scroll(window)
    expect(onClose).not.toHaveBeenCalled()

    vi.advanceTimersByTime(150)
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('stabilizes a snapping carousel until the menu exit animation completes', () => {
    vi.useFakeTimers()
    const scrollTarget = document.createElement('div')
    scrollTarget.scrollLeft = 186
    scrollTarget.scrollTop = 4
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scrollTarget.scrollLeft = options.left ?? scrollTarget.scrollLeft
      scrollTarget.scrollTop = options.top ?? scrollTarget.scrollTop
    })
    Object.defineProperty(scrollTarget, 'scrollTo', { configurable: true, value: scrollTo })
    document.body.appendChild(scrollTarget)
    const menu: ExplorerContextMenuState = {
      x: 120,
      y: 100,
      title: 'Application',
      scrollLockTarget: scrollTarget,
      items: [{ id: 'open', label: 'Open' }],
    }
    const onClose = vi.fn()
    const view = render(<ExplorerContextMenu menu={menu} onClose={onClose} />)

    expect(scrollTarget).toHaveClass('explorer-context-scroll-lock')
    expect(scrollTo).toHaveBeenCalledWith({ left: 186, top: 4, behavior: 'auto' })

    view.rerender(<ExplorerContextMenu menu={null} onClose={onClose} />)
    expect(screen.getByRole('menu', { name: 'Application' })).toHaveClass('exit')
    expect(scrollTarget).toHaveClass('explorer-context-scroll-lock')

    act(() => vi.advanceTimersByTime(160))
    expect(screen.queryByRole('menu', { name: 'Application' })).not.toBeInTheDocument()
    expect(scrollTarget).not.toHaveClass('explorer-context-scroll-lock')

    view.unmount()
    scrollTarget.remove()
    vi.useRealTimers()
  })

  it('does not dismiss when scrolling inside the status flyout list', async () => {
    vi.useFakeTimers()
    const onClose = renderMenu({
      x: 40,
      y: 40,
      title: 'Checklist item',
      items: [{
        id: 'status',
        label: 'Change status',
        submenu: {
          title: 'Change status',
          backLabel: 'Back',
          items: Array.from({ length: 12 }, (_, index) => ({
            id: `status-${index}`,
            label: `Status ${index}`,
            radio: true,
            statusTone: 'neutral' as const,
          })),
        },
      }],
    })

    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Change status' }), { clientX: 80, clientY: 90 })
    const flyout = screen.getByRole('menu', { name: 'Change status' })
    const list = flyout.querySelector('.explorer-context-actions')
    expect(list).toBeTruthy()

    vi.advanceTimersByTime(150)
    // Internal list scroll must keep the menu open.
    fireEvent.scroll(list!)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { name: 'Change status' })).toBeInTheDocument()

    // Page scroll still dismisses.
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('keeps the status flyout open while the pointer crosses other rows toward it', async () => {
    vi.useFakeTimers()
    renderMenu({
      x: 40,
      y: 40,
      title: 'Checklist item',
      items: [
        {
          id: 'status',
          label: 'Change status',
          submenu: {
            title: 'Change status',
            backLabel: 'Back',
            items: [
              { id: 'draft', label: 'Draft', radio: true, statusTone: 'neutral', statusSlug: 'draft' },
              { id: 'ready', label: 'Ready', radio: true, statusTone: 'success', statusSlug: 'ready' },
            ],
          },
        },
        { id: 'copy', label: 'Copy title', shortcut: 'C', accessKey: 'c', onSelect: vi.fn() },
      ],
    })

    const statusItem = screen.getByRole('menuitem', { name: 'Change status' })
    fireEvent.pointerEnter(statusItem, { clientX: 80, clientY: 90 })
    const flyout = screen.getByRole('menu', { name: 'Change status' })
    expect(flyout).toBeInTheDocument()

    // Simulate diagonal travel: leave status row, cross "Copy title", stay aimed at flyout.
    const flyoutBox = flyout.getBoundingClientRect()
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 })
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Copy title' }), {
      clientX: flyoutBox.left - 8,
      clientY: flyoutBox.top + 20,
    })

    // Still open after a short delay (safe-triangle grace).
    vi.advanceTimersByTime(200)
    expect(screen.getByRole('menu', { name: 'Change status' })).toBeInTheDocument()

    // After the longer safe delay without re-entering, it may close.
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
  })
})
