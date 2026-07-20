import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlinePresence } from './InlinePresence'
import { SmoothDisclosure } from './SmoothDisclosure'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('motion primitives', () => {
  it('keeps inline content mounted while its measured width collapses', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 84,
      bottom: 18,
      left: 0,
      width: 84,
      height: 18,
      toJSON: () => ({}),
    })

    const rendered = render(<InlinePresence present={false}>Primary recovery email</InlinePresence>)
    const root = rendered.container.firstElementChild as HTMLElement

    expect(root).toHaveAttribute('data-present', 'false')
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root).toHaveTextContent('Primary recovery email')

    await act(async () => {
      frames.splice(0).forEach((callback) => callback(performance.now()))
    })
    expect(root.style.getPropertyValue('--inline-presence-width')).toBe('84px')

    rendered.rerender(<InlinePresence present>Primary recovery email</InlinePresence>)
    expect(root).toHaveAttribute('data-present', 'true')
    expect(root).toHaveAttribute('aria-hidden', 'false')
  })

  it('routes disclosure toggles through the shared unknown-height panel', () => {
    render(
      <SmoothDisclosure summary="Application rules" indicator={<span>v</span>}>
        <label>GRE not required</label>
      </SmoothDisclosure>,
    )

    const trigger = screen.getByRole('button', { name: 'Application rules' })
    const panelId = trigger.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('data-collapsible-open', 'false')
    expect(panel).toHaveTextContent('GRE not required')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveAttribute('data-collapsible-open', 'true')
  })
})
