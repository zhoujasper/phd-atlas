import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LazyMarkdownTextarea } from './LazyMarkdownTextarea'
import type { MarkdownTextareaController } from './MarkdownTextarea'

vi.mock('../../lazyModuleRecovery', () => ({
  createRecoverableModuleLoader: () => () => new Promise<never>(() => undefined),
}))

describe('LazyMarkdownTextarea loading fallback', () => {
  it.each([
    ['Markdown', 'Hello **world**'],
    ['HTML', '<p>Hello <strong>world</strong></p>'],
  ])('renders %s safely in visual mode without exposing its raw source', (_format, value) => {
    render(
      <LazyMarkdownTextarea
        value={value}
        onChange={vi.fn()}
        aria-label="Email body"
      />,
    )

    const fallback = screen.getByRole('textbox', { name: 'Email body' })
    expect(fallback).toHaveAttribute('data-editor-loading', 'true')
    expect(fallback).toHaveAttribute('aria-readonly', 'true')
    expect(screen.getByText('world', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue(value)).not.toBeInTheDocument()
    expect(fallback.querySelector('textarea')).not.toBeInTheDocument()
  })

  it('keeps an explicit source-mode fallback editable', () => {
    const onChange = vi.fn()
    const value = 'Hello **world**'
    render(
      <LazyMarkdownTextarea
        defaultMode="source"
        value={value}
        onChange={onChange}
        aria-label="Email source"
      />,
    )

    const fallback = screen.getByRole('textbox', { name: 'Email source' })
    expect(fallback).toHaveValue(value)
    expect(fallback).not.toHaveAttribute('readonly')
    fireEvent.change(fallback, { target: { value: 'Updated' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('exposes range reads and replacement while the source fallback is loading', () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    const onChange = vi.fn()
    render(
      <LazyMarkdownTextarea
        controllerRef={controllerRef}
        defaultMode="source"
        value="Hello world"
        onChange={onChange}
        aria-label="Email source"
      />,
    )
    const source = screen.getByRole('textbox', { name: 'Email source' }) as HTMLTextAreaElement
    source.setSelectionRange(0, 5)

    const selection = controllerRef.current?.getSelection()
    expect(controllerRef.current?.getValue()).toBe('Hello world')
    expect(selection).toEqual({ mode: 'source', start: 0, end: 5 })
    const result = controllerRef.current?.replaceRange(selection ?? null, 'Hi')

    expect(result).toEqual({
      value: 'Hi world',
      selection: { mode: 'source', start: 0, end: 2 },
    })
    expect(source).toHaveValue('Hi world')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('preserves formatted email line breaks and required semantics in the visual fallback', () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    const value = 'Dear **Professor**,\nThank you.'
    render(
      <LazyMarkdownTextarea
        value={value}
        onChange={vi.fn()}
        aria-label="Email body"
        controllerRef={controllerRef}
        preservePlainLineBreaks
        required
      />,
    )

    const fallback = screen.getByRole('textbox', { name: 'Email body' })
    expect(screen.getByText('Professor', { selector: 'strong' })).toBeInTheDocument()
    expect(fallback.querySelectorAll('br')).toHaveLength(1)
    expect(document.querySelector('textarea[required]')).toBeInTheDocument()
    expect(screen.queryByDisplayValue(value)).not.toBeInTheDocument()

    expect(controllerRef.current?.getMode()).toBe('visual')
    expect(controllerRef.current?.getValue()).toBe(value)
    expect(controllerRef.current?.getSelection()).toBeNull()
    expect(controllerRef.current?.replaceRange(null, 'Not yet')).toBeNull()
    act(() => controllerRef.current?.focus({ atEnd: true }))
    expect(fallback).toHaveFocus()
  })
})
