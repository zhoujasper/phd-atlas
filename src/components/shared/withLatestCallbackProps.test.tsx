import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { withLatestCallbackProps } from './withLatestCallbackProps'

describe('withLatestCallbackProps', () => {
  it('keeps the inner screen stable while dispatching to the latest committed callback', () => {
    const firstAction = vi.fn()
    const latestAction = vi.fn()
    const renderSpy = vi.fn()

    function TestScreen({ label, onAction }: { label: string; onAction: () => void }) {
      renderSpy(label)
      return <button onClick={onAction}>{label}</button>
    }

    const StableScreen = withLatestCallbackProps(TestScreen)
    const view = render(<StableScreen label="Application" onAction={firstAction} />)

    view.rerender(<StableScreen label="Application" onAction={latestAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Application' }))

    expect(renderSpy).toHaveBeenCalledTimes(1)
    expect(firstAction).not.toHaveBeenCalled()
    expect(latestAction).toHaveBeenCalledTimes(1)
  })

  it('rerenders the inner screen when a visible data prop changes', () => {
    const renderSpy = vi.fn()

    function TestScreen({ label, onAction }: { label: string; onAction: () => void }) {
      renderSpy(label)
      return <button onClick={onAction}>{label}</button>
    }

    const StableScreen = withLatestCallbackProps(TestScreen)
    const view = render(<StableScreen label="First" onAction={() => undefined} />)

    view.rerender(<StableScreen label="Second" onAction={() => undefined} />)

    expect(renderSpy).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Second' })).toBeTruthy()
  })

  it('lets render-time function props participate in shallow equality', () => {
    const renderSpy = vi.fn()

    function TestScreen({ formatLabel }: { formatLabel: () => string }) {
      renderSpy()
      return <span>{formatLabel()}</span>
    }

    const StableScreen = withLatestCallbackProps(TestScreen)
    const view = render(<StableScreen formatLabel={() => 'First'} />)

    view.rerender(<StableScreen formatLabel={() => 'Second'} />)

    expect(renderSpy).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Second')).toBeTruthy()
  })
})
