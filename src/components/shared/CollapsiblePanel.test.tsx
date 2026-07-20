import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollapsiblePanel } from './CollapsiblePanel'

describe('CollapsiblePanel layout work', () => {
  it('does not synchronously measure panels that start open', () => {
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')

    render(
      <CollapsiblePanel open>
        <div>Already visible</div>
      </CollapsiblePanel>,
    )

    expect(measure).not.toHaveBeenCalled()
    measure.mockRestore()
  })

  it('paints a closed frame before applying the open class when expanding', async () => {
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })

    const { rerender, container } = render(
      <CollapsiblePanel open={false}>
        <div>Expandable content</div>
      </CollapsiblePanel>,
    )

    rerender(
      <CollapsiblePanel open>
        <div>Expandable content</div>
      </CollapsiblePanel>,
    )

    // Allow mount state to settle while visual open is still deferred.
    await act(async () => {
      // no-op tick for any synchronous setState from layout effects
    })

    expect(container.firstElementChild).not.toHaveClass('open')
    expect(container.firstElementChild).toHaveAttribute('data-collapsible-open', 'true')
    expect(container.firstElementChild).toHaveAttribute('data-collapsible-visual', 'closed')
    expect(container.textContent).toContain('Expandable content')

    await act(async () => {
      // Flush the double-rAF open sequence.
      const first = frames.splice(0, frames.length)
      first.forEach((callback) => callback(performance.now()))
      const second = frames.splice(0, frames.length)
      second.forEach((callback) => callback(performance.now()))
    })

    expect(container.firstElementChild).toHaveClass('open')
    expect(container.firstElementChild).toHaveAttribute('data-collapsible-visual', 'open')
    expect(measure).not.toHaveBeenCalled()

    raf.mockRestore()
    measure.mockRestore()
  })

  it('collapses visually immediately when closing', () => {
    const { rerender, container } = render(
      <CollapsiblePanel open>
        <div>Visible content</div>
      </CollapsiblePanel>,
    )

    expect(container.firstElementChild).toHaveClass('open')

    rerender(
      <CollapsiblePanel open={false}>
        <div>Visible content</div>
      </CollapsiblePanel>,
    )

    expect(container.firstElementChild).not.toHaveClass('open')
    expect(container.firstElementChild).toHaveAttribute('data-collapsible-open', 'false')
    // Content stays mounted briefly so the close transition can run.
    expect(container.textContent).toContain('Visible content')
  })

  it('uses the shared configuration-card motion by default', () => {
    const { container } = render(
      <CollapsiblePanel open>
        <div>Configuration details</div>
      </CollapsiblePanel>,
    )

    const panel = container.firstElementChild
    expect(panel).toHaveStyle({
      '--collapsible-open-duration': '260ms',
      '--collapsible-close-duration': '260ms',
      '--collapsible-panel-y': '-4px',
      '--collapsible-content-y': '-4px',
    })
  })

  it('cancels a parent grid gap while closed so delayed unmount cannot snap', async () => {
    const renderPanel = (open: boolean) => (
      <div style={{ display: 'grid', rowGap: '10px' }}>
        <div data-testid="before">Before</div>
        <CollapsiblePanel open={open}>
          <div>Expandable content</div>
        </CollapsiblePanel>
        <div>After</div>
      </div>
    )
    const { container, getByTestId, rerender } = render(renderPanel(true))

    const panel = container.querySelector('.collapsible-panel')
    await waitFor(() => {
      expect(panel).toHaveStyle({
        '--collapsible-closed-gap-start': '10px',
        '--collapsible-closed-gap-end': '0px',
      })
    })

    rerender(renderPanel(false))
    await waitFor(() => expect(getByTestId('before')).toHaveStyle({ marginBottom: '-10px' }))
  })
})
