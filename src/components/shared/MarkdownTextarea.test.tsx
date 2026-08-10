import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState, type ChangeEvent, type Ref } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl, type Language } from '../../i18n'
import { prepareForSafeReload, registerSafeReloadGuard } from '../../safeReload'
import { I18nContext } from '../hooks/useI18n'
import { MarkdownTextarea, type MarkdownTextareaController } from './MarkdownTextarea'
import { resolveCodeEditorExport } from './codeEditorInterop'

function ControlledEditorHarness({
  controllerRef,
  lang = 'en',
  onChange,
  preservePlainLineBreaks = false,
  value,
}: {
  controllerRef?: Ref<MarkdownTextareaController>
  lang?: Language
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  preservePlainLineBreaks?: boolean
  value: string
}) {
  return (
    <I18nContext.Provider
      value={{
        lang,
        t: getDict(lang),
        format: tpl,
        tx: (path, fallback) => t(lang, path, fallback),
      }}
    >
      <MarkdownTextarea
        value={value}
        onChange={onChange}
        aria-label={lang === 'zh' ? '备注' : 'Notes'}
        placeholder={lang === 'zh' ? '填写备注' : 'Add notes'}
        controllerRef={controllerRef}
        preservePlainLineBreaks={preservePlainLineBreaks}
        rows={4}
      />
    </I18nContext.Provider>
  )
}

function EditorHarness({
  controllerRef,
  initial = '',
  lang = 'en',
  preservePlainLineBreaks = false,
}: {
  controllerRef?: Ref<MarkdownTextareaController>
  initial?: string
  lang?: Language
  preservePlainLineBreaks?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <ControlledEditorHarness
        controllerRef={controllerRef}
        lang={lang}
        onChange={(event) => setValue(event.target.value)}
        preservePlainLineBreaks={preservePlainLineBreaks}
        value={value}
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

beforeAll(() => {
  if (!globalThis.DragEvent) {
    Object.defineProperty(globalThis, 'DragEvent', {
      configurable: true,
      value: class DragEvent extends MouseEvent {},
    })
  }
  if (!globalThis.ClipboardEvent) {
    Object.defineProperty(globalThis, 'ClipboardEvent', {
      configurable: true,
      value: class ClipboardEvent extends Event {
        clipboardData: DataTransfer | null
        constructor(type: string, init: ClipboardEventInit = {}) {
          super(type, init)
          this.clipboardData = init.clipboardData ?? null
        }
      },
    })
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* iterator() {},
    }) as DOMRectList
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MarkdownTextarea rich editor', () => {
  it('unwraps the CommonJS editor export before passing it to React', () => {
    const component = () => null
    expect(resolveCodeEditorExport({ default: component })).toBe(component)
    expect(resolveCodeEditorExport(component)).toBe(component)
  })

  it('renders Markdown in place without adding a separate preview panel', () => {
    render(<EditorHarness initial="Needs **portfolio polish**" />)

    expect(screen.getByText('portfolio polish', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText('Preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit source/ })).toBeInTheDocument()
    expect(document.querySelector('.markdown-format-badge')).not.toBeInTheDocument()
    expect(document.querySelector('.markdown-mode-toggle .sr-only')).toHaveTextContent('Edit source')
  })

  it('renders safe HTML and keeps a canonical HTML source', async () => {
    render(<EditorHarness initial="<p>Needs <strong>portfolio polish</strong></p>" />)

    expect(screen.getByText('portfolio polish', { selector: 'strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Edit source · HTML/ }))
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('<p>Needs <strong>portfolio polish</strong></p>')
    })
  })

  it('toggles between rendered content and the original source', () => {
    render(<EditorHarness initial="Needs **portfolio polish**" />)

    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' })
    expect(source).toHaveValue('Needs **portfolio polish**')

    fireEvent.click(screen.getByRole('button', { name: /Show rendered/ }))
    expect(screen.getByText('portfolio polish', { selector: 'strong' })).toBeInTheDocument()
  })

  it('keeps focused source typing local during the short external sync window', () => {
    vi.useFakeTimers()
    render(<EditorHarness />)

    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    source.focus()
    fireEvent.change(source, { target: { value: 'Draft' } })

    expect(source).toHaveValue('Draft')
    expect(screen.getByTestId('value')).toHaveTextContent('')

    act(() => {
      vi.advanceTimersByTime(47)
    })
    expect(screen.getByTestId('value')).toHaveTextContent('')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('value')).toHaveTextContent('Draft')
  })

  it('does not let a delayed controlled echo overwrite newer source typing', () => {
    vi.useFakeTimers()
    const emittedValues: string[] = []
    const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
      emittedValues.push(event.target.value)
    }
    const { rerender } = render(
      <ControlledEditorHarness value="" onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    source.focus()
    fireEvent.change(source, { target: { value: 'A' } })
    act(() => {
      vi.advanceTimersByTime(48)
    })
    expect(emittedValues).toEqual(['A'])

    fireEvent.change(source, { target: { value: 'Add' } })
    rerender(<ControlledEditorHarness value="A" onChange={onChange} />)

    expect(source).toHaveValue('Add')
    act(() => {
      vi.advanceTimersByTime(48)
    })
    expect(emittedValues).toEqual(['A', 'Add'])
    expect(source).toHaveValue('Add')
  })

  it('supports Ctrl/Cmd formatting shortcuts without execCommand', async () => {
    const user = userEvent.setup()
    render(<EditorHarness initial="Portfolio" />)
    const editor = screen.getByRole('textbox', { name: 'Notes' })

    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}{Control>}u{/Control}{Control>}b{/Control}')

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('++**Portfolio**++')
    })
  })

  it('toggles visual formatting off with the same platform shortcut', async () => {
    const user = userEvent.setup()
    render(<EditorHarness initial="Portfolio" />)
    const editor = screen.getByRole('textbox', { name: 'Notes' })

    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}{Control>}b{/Control}{Control>}b{/Control}')

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('Portfolio')
    })
  })

  it('toggles source wrappers instead of nesting duplicate markers', async () => {
    render(<EditorHarness initial="Portfolio" />)
    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement

    source.setSelectionRange(0, source.value.length)
    fireEvent.keyDown(source, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('**Portfolio**'))

    source.setSelectionRange(2, source.value.length - 2)
    fireEvent.keyDown(source, { key: 'b', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('Portfolio'))
  })

  it('shows the platform-specific primary modifier in the formatting menu', () => {
    render(<EditorHarness initial="Portfolio" />)
    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Notes' }), { clientX: 80, clientY: 80 })

    expect(within(screen.getByRole('menuitem', { name: /Bold/ })).getByText('Ctrl+B')).toBeInTheDocument()
    expect(within(screen.getByRole('menuitem', { name: /Strikethrough/ })).getByText('Ctrl+Shift+X')).toBeInTheDocument()
  })

  it('uses Command and Shift symbols on macOS', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
    render(<EditorHarness initial="Portfolio" />)
    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Notes' }), { clientX: 80, clientY: 80 })

    expect(within(screen.getByRole('menuitem', { name: /Bold/ })).getByText('⌘B')).toBeInTheDocument()
    expect(within(screen.getByRole('menuitem', { name: /Strikethrough/ })).getByText('⌘⇧X')).toBeInTheDocument()
  })

  it('highlights and automatically formats HTML source', async () => {
    render(<EditorHarness initial="<section><h2>Plan</h2><p>Ready</p></section>" />)

    fireEvent.click(screen.getByRole('button', { name: /Edit source · HTML/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' })

    await waitFor(() => {
      expect(source).toHaveValue('<section>\n  <h2>Plan</h2>\n  <p>Ready</p>\n</section>')
    })
    await waitFor(() => {
      expect(document.querySelector('.markdown-source-highlight .token.tag')).toBeInTheDocument()
    })
    expect(document.querySelector('.markdown-source-language')).toHaveTextContent('HTML')
    expect(screen.getByRole('button', { name: /Format source · HTML/ })).toBeInTheDocument()
  })

  it('visibly highlights GFM task, table, and footnote syntax', async () => {
    render(<EditorHarness initial={'- [x] Ready\n\n| Stage | Status |\n| --- | --- |\n| Draft | Ready |\n\nSee [^1].\n\n[^1]: Note'} />)

    fireEvent.click(screen.getByRole('button', { name: /Edit source · Markdown/ }))

    await waitFor(() => {
      expect(document.querySelector('.markdown-source-highlight .token.atlas-task')).toBeInTheDocument()
      expect(document.querySelector('.markdown-source-highlight .token.atlas-table')).toBeInTheDocument()
      expect(document.querySelector('.markdown-source-highlight .token.atlas-footnote')).toBeInTheDocument()
    })
    expect(document.querySelector('.markdown-source-language')).toHaveTextContent('MD')
  })

  it('offers keyboard HTML completions at the source caret', async () => {
    render(<EditorHarness initial="<p></p>" />)

    fireEvent.click(screen.getByRole('button', { name: /Edit source · HTML/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    await waitFor(() => expect(source).toHaveValue('<p></p>'))

    fireEvent.change(source, { target: { value: '<se' } })
    source.setSelectionRange(3, 3)
    fireEvent.keyUp(source, { key: 'e' })

    expect(await screen.findByRole('listbox', { name: 'Code suggestions' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector('.markdown-source-language')).toHaveTextContent('HTML')
    })
    expect(source).toHaveAttribute('aria-autocomplete', 'list')
    expect(source).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('option', { name: /section/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(source, { key: 'Tab' })

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('<section></section>')
      expect(source.selectionStart).toBe(9)
      expect(source.selectionEnd).toBe(9)
    })
    expect(screen.queryByRole('listbox', { name: 'Code suggestions' })).not.toBeInTheDocument()
  })

  it('automatically closes a typed HTML element', async () => {
    render(<EditorHarness initial="<p></p>" />)

    fireEvent.click(screen.getByRole('button', { name: /Edit source · HTML/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    fireEvent.change(source, { target: { value: '<section' } })
    source.setSelectionRange(8, 8)
    fireEvent.keyDown(source, { key: '>', shiftKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('<section></section>')
      expect(source.selectionStart).toBe(9)
    })
  })

  it('keeps complex GFM structures in a fidelity preview', () => {
    render(
      <EditorHarness
        initial={'| Stage | Status |\n| --- | --- |\n| Draft | Ready |'}
        preservePlainLineBreaks
      />,
    )

    const preview = document.querySelector<HTMLElement>('.markdown-fidelity-layer')
    expect(preview).toBeInTheDocument()
    if (!preview) return
    expect(preview.querySelector('table')).toBeInTheDocument()
    expect(document.querySelector('.markdown-lexical-layer')).toHaveClass('is-fidelity-hidden')

    fireEvent.click(screen.getByRole('button', { name: /Edit source · Markdown/ }))
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
      '| Stage | Status |\n| --- | --- |\n| Draft | Ready |',
    )
  })

  it('preserves casing through a visual and source round-trip', () => {
    render(<EditorHarness initial="Mixed Case: PhD Atlas" />)

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveTextContent('Mixed Case: PhD Atlas')
    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Mixed Case: PhD Atlas')
  })

  it('keeps ordinary email line breaks visible and exact through a visual round-trip', async () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    const initial = 'Dear **Professor**,\nThank you for your time.\nBest regards,'
    render(
      <EditorHarness
        controllerRef={controllerRef}
        initial={initial}
        preservePlainLineBreaks
      />,
    )

    const visual = screen.getByRole('textbox', { name: 'Notes' })
    expect(screen.getByText('Professor', { selector: 'strong' })).toBeInTheDocument()
    expect(visual.querySelectorAll('br')).toHaveLength(2)

    act(() => controllerRef.current?.focus({ atEnd: true }))
    act(() => controllerRef.current?.insertText('!'))
    const edited = `${initial}!`
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe(edited))

    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(edited)

    fireEvent.click(screen.getByRole('button', { name: /Show rendered/ }))
    await waitFor(() => {
      const rendered = screen.getByRole('textbox', { name: 'Notes' })
      expect(rendered.querySelectorAll('br')).toHaveLength(2)
    })
    expect(screen.getByTestId('value').textContent).toBe(edited)
  })

  it('keeps single line breaks when pasting formatted Markdown into a plain-line editor', async () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    render(
      <EditorHarness
        controllerRef={controllerRef}
        preservePlainLineBreaks
      />,
    )
    const visual = screen.getByRole('textbox', { name: 'Notes' })
    act(() => controllerRef.current?.focus({ atEnd: true }))

    fireEvent.paste(visual, {
      clipboardData: {
        getData: (format: string) => format === 'text/plain' ? '**Hello**\nWorld' : '',
      },
    })

    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('**Hello**\nWorld'))
    expect(screen.getByText('Hello', { selector: 'strong' })).toBeInTheDocument()
    expect(visual.querySelectorAll('br')).toHaveLength(1)
  })

  it('focuses and inserts at the visual Lexical selection through the controller', async () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    render(<EditorHarness controllerRef={controllerRef} initial="Hello" />)
    const visual = screen.getByRole('textbox', { name: 'Notes' })

    act(() => controllerRef.current?.focus({ atEnd: true }))
    await waitFor(() => expect(visual).toHaveFocus())
    expect(controllerRef.current?.getMode()).toBe('visual')

    act(() => controllerRef.current?.insertText(' world'))
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('Hello world'))
    expect(controllerRef.current?.getMode()).toBe('visual')
  })

  it('reads and replaces a retained visual range without exposing Markdown source offsets', async () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    render(<EditorHarness controllerRef={controllerRef} initial="Hello" />)

    act(() => controllerRef.current?.focus({ atEnd: true }))
    const caret = controllerRef.current?.getSelection()
    expect(caret?.mode).toBe('visual')

    const firstInsert = {
      current: null as ReturnType<MarkdownTextareaController['replaceRange']>,
    }
    act(() => {
      firstInsert.current = controllerRef.current?.replaceRange(caret ?? null, ' first') ?? null
    })
    expect(firstInsert.current?.selection?.mode).toBe('visual')
    expect(firstInsert.current?.value).toBe('Hello first')
    expect(controllerRef.current?.getValue()).toBe('Hello first')

    act(() => {
      controllerRef.current?.replaceRange(firstInsert.current?.selection ?? null, ' second')
    })
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('Hello second'))
    expect(controllerRef.current?.getValue()).toBe('Hello second')
  })

  it('reads and replaces a retained source range through the same controller', async () => {
    const controllerRef = createRef<MarkdownTextareaController>()
    render(<EditorHarness controllerRef={controllerRef} initial="Hello world" />)
    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    source.setSelectionRange(0, 5)

    const selected = controllerRef.current?.getSelection()
    expect(selected).toEqual({ mode: 'source', start: 0, end: 5 })
    let firstInsert: ReturnType<MarkdownTextareaController['replaceRange']> = null
    act(() => {
      firstInsert = controllerRef.current?.replaceRange(selected ?? null, 'Hi') ?? null
    })
    expect(firstInsert).toEqual({
      value: 'Hi world',
      selection: { mode: 'source', start: 0, end: 2 },
    })

    act(() => {
      controllerRef.current?.replaceRange(firstInsert?.selection ?? null, 'Greetings')
    })
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('Greetings world'))
    expect(controllerRef.current?.getValue()).toBe('Greetings world')
  })

  it.each(['component unmount', 'pagehide'] as const)(
    'flushes pending visual input before %s',
    async (exitKind) => {
      vi.useFakeTimers()
      const controllerRef = createRef<MarkdownTextareaController>()
      const received: string[] = []
      const view = render(
        <ControlledEditorHarness
          controllerRef={controllerRef}
          value=""
          onChange={(event) => received.push(event.target.value)}
        />,
      )

      await act(async () => {
        controllerRef.current?.focus({ atEnd: true })
        controllerRef.current?.insertText('Draft in progress')
      })
      expect(received).toEqual([])

      if (exitKind === 'pagehide') {
        act(() => window.dispatchEvent(new Event('pagehide')))
      } else {
        view.unmount()
      }

      expect(received).toEqual(['Draft in progress'])
    },
  )

  it.each([
    { label: '48ms short-input buffer', initial: '', inserted: 'Draft in progress' },
    { label: '220ms large-input buffer', initial: 'x'.repeat(12_001), inserted: ' final thought' },
  ])('flushes the last $label before an automatic reload decision', async ({ initial, inserted }) => {
    vi.useFakeTimers()
    const controllerRef = createRef<MarkdownTextareaController>()
    const received: string[] = []
    let dirty = false
    const unregister = registerSafeReloadGuard(`markdown-${initial.length}`, {
      prepare: () => true,
      hasUnsavedChanges: () => dirty,
    })
    try {
      render(
        <ControlledEditorHarness
          controllerRef={controllerRef}
          value={initial}
          onChange={(event) => {
            received.push(event.target.value)
            dirty = true
          }}
        />,
      )

      await act(async () => {
        controllerRef.current?.focus({ atEnd: true })
        controllerRef.current?.insertText(inserted)
      })
      expect(received).toEqual([])

      let allowed = true
      await act(async () => {
        allowed = await prepareForSafeReload({ reason: 'application-update' })
      })

      expect(allowed).toBe(false)
      expect(received).toEqual([`${initial}${inserted}`])
    } finally {
      unregister()
    }
  })

  it('does not replace dirty visual input with a stale external snapshot', async () => {
    vi.useFakeTimers()
    const controllerRef = createRef<MarkdownTextareaController>()
    const received: string[] = []
    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => received.push(event.target.value)
    const renderSurface = (value: string) => (
      <ControlledEditorHarness
        controllerRef={controllerRef}
        value={value}
        onChange={handleChange}
      />
    )
    const view = render(renderSurface('Original'))

    await act(async () => {
      controllerRef.current?.focus({ atEnd: true })
      controllerRef.current?.insertText(' local edit')
    })
    view.rerender(renderSurface('Stale server copy'))

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveTextContent('Original local edit')
    expect(received).toEqual([])

    act(() => vi.advanceTimersByTime(48))
    expect(received).toEqual(['Original local edit'])
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveTextContent('Original local edit')
  })

  it('keeps Shift+Enter as a hard Markdown break after a source round-trip', async () => {
    const user = userEvent.setup()
    render(<EditorHarness initial="Line" />)
    const editor = screen.getByRole('textbox', { name: 'Notes' })

    await user.click(editor)
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('Line\\\n')
    })

    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Line\\\n')

    fireEvent.click(screen.getByRole('button', { name: /Show rendered/ }))
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Notes' }).querySelector('br')).toBeInTheDocument()
    })
  })

  it('opens a formatting context menu on right click', () => {
    render(<EditorHarness initial="Portfolio" />)

    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Notes' }), { clientX: 80, clientY: 80 })

    expect(screen.getByRole('menu', { name: 'Formatting menu' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Bold/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Underline/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Edit source/ })).toBeInTheDocument()
  })

  it('keeps the formatting menu mounted until its exit motion finishes', () => {
    vi.useFakeTimers()
    render(<EditorHarness initial="Portfolio" />)

    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Notes' }), { clientX: 80, clientY: 80 })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.getByRole('menu', { name: 'Formatting menu' })).toHaveClass('exiting')

    act(() => vi.advanceTimersByTime(160))
    expect(screen.queryByRole('menu', { name: 'Formatting menu' })).not.toBeInTheDocument()
  })

  it('renders Markdown immediately after editing the source', async () => {
    const user = userEvent.setup()
    render(<EditorHarness />)
    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' })

    await user.type(source, 'Needs **portfolio polish**')
    fireEvent.click(screen.getByRole('button', { name: /Show rendered/ }))

    await waitFor(() => {
      expect(screen.getByText('portfolio polish', { selector: 'strong' })).toBeInTheDocument()
      expect(screen.getByTestId('value')).toHaveTextContent('Needs **portfolio polish**')
    })
  })


  it('uses Tab and Shift+Tab to indent source lines', async () => {
    render(<EditorHarness initial={'line one\nline two'} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    const source = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    source.setSelectionRange(0, source.value.length)

    fireEvent.keyDown(source, { key: 'Tab' })
    await waitFor(() => expect(source).toHaveValue('  line one\n  line two'))

    source.setSelectionRange(0, source.value.length)
    fireEvent.keyDown(source, { key: 'Tab', shiftKey: true })
    await waitFor(() => expect(source).toHaveValue('line one\nline two'))
  })

  it('localizes the editor controls in Chinese', () => {
    render(<EditorHarness lang="zh" initial="需要 **润色**" />)

    expect(screen.getByRole('button', { name: /编辑源码/ })).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('textbox', { name: '备注' }), { clientX: 80, clientY: 80 })
    expect(screen.getByRole('menu', { name: '格式菜单' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /下划线/ })).toBeInTheDocument()
  })
})
