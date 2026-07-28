import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LibraryViewSwitch } from './LibraryViewSwitch'
import appStyles from '../../index.css?raw'

const originalMatchMedia = window.matchMedia
const originalViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition')

function renderSwitch(onChange = vi.fn()) {
  render(
    <LibraryViewSwitch
      value="cards"
      onChange={onChange}
      label="View mode"
      cardLabel="Card view"
      listLabel="List view"
      transitionScope="profile"
      controlsId="profile-library-view"
    />,
  )
  return onChange
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  if (originalViewTransition) Object.defineProperty(document, 'startViewTransition', originalViewTransition)
  else Reflect.deleteProperty(document, 'startViewTransition')
  delete document.documentElement.dataset.libraryViewTransitionToken
  delete document.documentElement.dataset.libraryViewTransitionScope
  delete document.documentElement.dataset.libraryViewTransitionDirection
  delete document.documentElement.dataset.libraryViewTransitionMode
})

describe('LibraryViewSwitch', () => {
  it('uses a scoped native view transition for the content handoff', async () => {
    let finishTransition = () => {}
    const finished = new Promise<void>((resolve) => {
      finishTransition = () => resolve()
    })
    const startViewTransition = vi.fn((update: () => void) => {
      update()
      return { finished }
    })
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })

    const onChange = renderSwitch()
    const listButton = screen.getByRole('button', { name: 'List view' })
    expect(listButton.getAttribute('aria-controls')).toBe('profile-library-view')

    fireEvent.click(listButton)

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('list')
    expect(document.documentElement.dataset.libraryViewTransitionScope).toBe('profile')
    expect(document.documentElement.dataset.libraryViewTransitionDirection).toBe('forward')
    expect(document.documentElement.dataset.libraryViewTransitionMode).toBe('native')

    finishTransition()
    await waitFor(() => {
      expect(document.documentElement.hasAttribute('data-library-view-transition-token')).toBe(false)
    })
  })

  it('keeps a directional CSS fallback when native transitions are unavailable', () => {
    vi.useFakeTimers()
    Reflect.deleteProperty(document, 'startViewTransition')
    const onChange = renderSwitch()

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(onChange).toHaveBeenCalledWith('list')
    expect(document.documentElement.dataset.libraryViewTransitionMode).toBe('fallback')
    vi.advanceTimersByTime(360)
    expect(document.documentElement.hasAttribute('data-library-view-transition-token')).toBe(false)
  })

  it('switches immediately when reduced motion is requested', () => {
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    const onChange = renderSwitch()

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(onChange).toHaveBeenCalledWith('list')
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.hasAttribute('data-library-view-transition-token')).toBe(false)
  })

  it('reserves the larger library height so switching layouts cannot move the page', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    const onChange = vi.fn()
    render(
      <div>
        <LibraryViewSwitch
          value="cards"
          onChange={onChange}
          label="View mode"
          cardLabel="Card view"
          listLabel="List view"
          transitionScope="profile"
          controlsId="stable-library"
        />
        <div>
          <div id="stable-library">Library</div>
        </div>
      </div>,
    )
    const library = document.getElementById('stable-library')!
    vi.spyOn(library, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 300,
      bottom: 420,
      left: 0,
      width: 300,
      height: 420,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(library.parentElement?.style.getPropertyValue('--library-view-stable-height')).toBe('420px')
    expect(library.parentElement?.dataset.libraryViewStable).toBe('true')
  })

  it('does not replay the mount animation after the view transition finishes', () => {
    expect(appStyles).toMatch(
      /\[data-library-view-stable="true"\] > \.profile-library-view,\s*\[data-library-view-stable="true"\] > \.team-portrait-library-view\s*\{\s*animation: none;/,
    )
  })
})
