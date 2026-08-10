import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LibraryViewSwitch, type LibraryViewMode } from './LibraryViewSwitch'
import appStyles from '../../index.css?raw'

const originalMatchMedia = window.matchMedia
const originalViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition')

function SwitchHarness({
  initialView = 'cards',
  onChange = vi.fn(),
}: {
  initialView?: LibraryViewMode
  onChange?: (value: LibraryViewMode) => void
}) {
  const [view, setView] = useState<LibraryViewMode>(initialView)
  return (
    <>
      <LibraryViewSwitch
        value={view}
        onChange={(nextView) => {
          onChange(nextView)
          setView(nextView)
        }}
        label="View mode"
        cardLabel="Card view"
        listLabel="List view"
        transitionScope="profile"
        controlsId="profile-library-view"
      />
      <div className="library-insertion-motion-boundary" data-testid="library-boundary">
        <div
          id="profile-library-view"
          key={view}
          className={`profile-library-view is-${view}`}
        >
          {view}
        </div>
      </div>
    </>
  )
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  if (originalViewTransition) Object.defineProperty(document, 'startViewTransition', originalViewTransition)
  else Reflect.deleteProperty(document, 'startViewTransition')
})

describe('LibraryViewSwitch', () => {
  it('uses only a local library handoff and never starts a document transition', () => {
    vi.useFakeTimers()
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
    const onChange = vi.fn()
    render(<SwitchHarness onChange={onChange} />)

    const listButton = screen.getByRole('button', { name: 'List view' })
    expect(listButton.getAttribute('aria-controls')).toBe('profile-library-view')
    fireEvent.click(listButton)

    const boundary = screen.getByTestId('library-boundary')
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith('list')
    expect(document.querySelector('.profile-library-view.is-list')).not.toBeNull()
    expect(boundary.dataset.libraryViewTransitionScope).toBe('profile')
    expect(boundary.dataset.libraryViewTransitionDirection).toBe('forward')
    expect(document.documentElement.hasAttribute('data-library-view-transition-token')).toBe(false)

    vi.advanceTimersByTime(280)
    expect(boundary.hasAttribute('data-library-view-transition-token')).toBe(false)
  })

  it('restores the active pane scroll position after the synchronous layout change', () => {
    const onChange = vi.fn(() => {
      screen.getByTestId('library-boundary').scrollTop = 480
    })
    render(<SwitchHarness onChange={onChange} />)
    const boundary = screen.getByTestId('library-boundary')
    boundary.style.overflowY = 'auto'
    boundary.scrollTop = 132

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(boundary.scrollTop).toBe(132)
  })

  it('reverses only the horizontal handoff direction when returning to cards', () => {
    render(<SwitchHarness initialView="list" />)

    fireEvent.click(screen.getByRole('button', { name: 'Card view' }))

    expect(screen.getByTestId('library-boundary').dataset.libraryViewTransitionDirection).toBe('backward')
    expect(document.querySelector('.profile-library-view.is-cards')).not.toBeNull()
  })

  it('switches immediately without adding motion state when reduced motion is requested', () => {
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
    render(<SwitchHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(document.querySelector('.profile-library-view.is-list')).not.toBeNull()
    expect(screen.getByTestId('library-boundary').hasAttribute('data-library-view-transition-token')).toBe(false)
  })

  it('keeps the handoff opacity-only with no persistent height or mount animation', () => {
    const localMotion = appStyles.slice(
      appStyles.indexOf('/* Card/list switching has one local motion owner.'),
      appStyles.indexOf('.profile-heading-row'),
    )

    expect(localMotion).toContain('animation: atlas-library-view-local-forward 240ms')
    expect(localMotion).toContain('animation: atlas-library-view-local-backward 240ms')
    expect(localMotion).toMatch(
      /data-library-view-transition-token[\s\S]*?\.profile-snippet-list-row,[\s\S]*?\.team-portrait-snippet-card[\s\S]*?animation: none;/,
    )
    expect(localMotion).toContain('transform: translate3d(10px, 0, 0)')
    expect(localMotion).toContain('transform: translate3d(-10px, 0, 0)')
    const translationAxes = [...localMotion.matchAll(/translate3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g)]
    expect(translationAxes.every(([, , y]) => y.trim() === '0')).toBe(true)
    expect(localMotion).not.toContain('scale(')
    expect(appStyles).not.toContain('atlas-profile-library-view')
    expect(appStyles).not.toContain('profile-library-view-enter')
    expect(appStyles).not.toContain('--library-view-stable-height')
  })
})
