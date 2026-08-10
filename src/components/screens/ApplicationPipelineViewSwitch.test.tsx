import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationPipelineViewSwitch } from './ApplicationPipelineViewSwitch'

const originalMatchMedia = window.matchMedia
const originalViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition')

function renderSwitch(onChange = vi.fn(), onPrepare = vi.fn()) {
  render(
    <div>
      <ApplicationPipelineViewSwitch
        value="board"
        onChange={onChange}
        label="Application presentation"
        boardLabel="Board"
        tableLabel="Table"
        scope="personal"
        controlsId="application-pipeline-test-view"
        onPrepare={onPrepare}
      />
      <div className="kanban-workspace">
        <div
          id="application-pipeline-test-view"
          className="application-pipeline-view-stage"
          data-pipeline-scope="personal"
        >
          Board content
        </div>
      </div>
    </div>,
  )
  return { onChange, onPrepare }
}

function ControlledPipelineSwitch({
  onChange,
}: {
  onChange?: (value: 'board' | 'table') => void
} = {}) {
  const [value, setValue] = useState<'board' | 'table'>('board')
  return (
    <div>
      <ApplicationPipelineViewSwitch
        value={value}
        onChange={(nextValue) => {
          onChange?.(nextValue)
          setValue(nextValue)
        }}
        label="Application presentation"
        boardLabel="Board"
        tableLabel="Table"
        scope="personal"
        controlsId="application-pipeline-controlled-view"
      />
      <div className="kanban-workspace">
        <div
          id="application-pipeline-controlled-view"
          className="application-pipeline-view-stage"
          data-pipeline-scope="personal"
          data-view={value}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  if (originalViewTransition) Object.defineProperty(document, 'startViewTransition', originalViewTransition)
  else Reflect.deleteProperty(document, 'startViewTransition')
  delete document.documentElement.dataset.applicationPipelineTransitionToken
  delete document.documentElement.dataset.applicationPipelineTransitionScope
  delete document.documentElement.dataset.applicationPipelineTransitionDirection
  delete document.documentElement.dataset.applicationPipelineTransitionMode
})

describe('ApplicationPipelineViewSwitch', () => {
  it('responds immediately and schedules the heavy handoff without capturing or measuring the stage', () => {
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    })
    const { onChange } = renderSwitch()
    const stage = document.getElementById('application-pipeline-test-view')
    if (!stage) throw new Error('Expected pipeline stage')
    const measure = vi.spyOn(stage, 'getBoundingClientRect')

    fireEvent.click(screen.getByRole('button', { name: 'Table' }))

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(measure).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith('table')
    expect(document.documentElement.dataset.applicationPipelineTransitionScope).toBeUndefined()
    expect(document.documentElement.dataset.applicationPipelineTransitionDirection).toBeUndefined()
    expect(document.documentElement.dataset.applicationPipelineTransitionMode).toBeUndefined()
    expect(stage.dataset.applicationPipelineTransitionMode).toBe('preparing')
    expect(stage.dataset.applicationPipelineTransitionDirection).toBe('to-table')
    expect(stage).toHaveAttribute('data-application-pipeline-transition-token')
    expect(screen.getByRole('group', { name: 'Application presentation' })).toHaveAttribute(
      'data-pipeline-scope',
      'personal',
    )
    expect(stage).toHaveAttribute('aria-busy', 'true')
    expect(stage).toHaveAttribute(
      'data-application-pipeline-busy-token',
    )
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Application presentation' })).toHaveAttribute('data-view', 'table')
  })

  it('preserves the owning scroll position across the Activity commit', () => {
    vi.useFakeTimers()
    let workspace: HTMLElement | null = null
    const onChange = vi.fn(() => {
      if (workspace) workspace.scrollTop = 0
    })
    render(<ControlledPipelineSwitch onChange={onChange} />)
    workspace = document.querySelector<HTMLElement>('.kanban-workspace')
    if (!workspace) throw new Error('Expected workspace scroll owner')
    workspace.scrollTop = 240

    fireEvent.click(screen.getByRole('button', { name: 'Table' }))

    expect(onChange).toHaveBeenCalledWith('table')
    expect(workspace.scrollTop).toBe(240)
  })

  it('keeps the latest slide cycle authoritative during a rapid reversal', () => {
    vi.useFakeTimers()
    const { onChange } = renderSwitch()

    const stage = document.getElementById('application-pipeline-test-view')
    if (!stage) throw new Error('Expected controlled pipeline stage')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const pendingToken = stage.dataset.applicationPipelineTransitionToken
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(stage.dataset.applicationPipelineTransitionToken).not.toBe(pendingToken)
    expect(stage.dataset.applicationPipelineTransitionMode).toBe('settling')
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')
    expect(onChange).toHaveBeenNthCalledWith(1, 'table')
    expect(onChange).toHaveBeenNthCalledWith(2, 'board')
    act(() => {
      vi.advanceTimersByTime(240)
    })
    expect(stage).not.toHaveAttribute('data-application-pipeline-transition-token')
  })

  it('settles the committed destination and supersedes it cleanly', () => {
    vi.useFakeTimers()
    render(<ControlledPipelineSwitch />)
    const stage = document.getElementById('application-pipeline-controlled-view')
    if (!stage) throw new Error('Expected controlled pipeline stage')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const firstToken = stage.dataset.applicationPipelineTransitionToken
    expect(stage.dataset.applicationPipelineTransitionDirection).toBe('to-table')
    expect(stage).toHaveTextContent('table')

    act(() => {
      vi.advanceTimersByTime(32)
    })
    expect(stage.dataset.applicationPipelineTransitionMode).toBe('settling')
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(stage.dataset.applicationPipelineTransitionToken).not.toBe(firstToken)
    expect(document.documentElement.dataset.applicationPipelineTransitionDirection).toBeUndefined()
    expect(stage.dataset.applicationPipelineTransitionMode).toBe('preparing')
    expect(stage.dataset.applicationPipelineTransitionDirection).toBe('to-board')
    expect(stage).toHaveAttribute(
      'data-application-pipeline-busy-token',
    )

    act(() => {
      vi.advanceTimersByTime(32)
    })
    expect(document.getElementById('application-pipeline-controlled-view')).toHaveTextContent('board')
    expect(stage.dataset.applicationPipelineTransitionMode).toBe('settling')
    expect(stage).toHaveAttribute('aria-busy', 'true')

    act(() => {
      vi.advanceTimersByTime(240)
    })
    expect(stage).not.toHaveAttribute('data-application-pipeline-transition-token')
    expect(stage).not.toHaveAttribute('data-application-pipeline-transition-mode')
  })

  it('switches immediately for reduced motion', () => {
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
    const { onChange } = renderSwitch()

    fireEvent.click(screen.getByRole('button', { name: 'Table' }))

    expect(onChange).toHaveBeenCalledWith('table')
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.hasAttribute('data-application-pipeline-transition-token')).toBe(false)
    expect(document.getElementById('application-pipeline-test-view')).not.toHaveAttribute('aria-busy')
  })

  it('prepares the destination branch from pointer and keyboard intent', () => {
    const { onPrepare } = renderSwitch()
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Table' }))
    fireEvent.focus(screen.getByRole('button', { name: 'Board' }))
    expect(onPrepare).toHaveBeenNthCalledWith(1, 'table')
    expect(onPrepare).toHaveBeenNthCalledWith(2, 'board')
  })
})
