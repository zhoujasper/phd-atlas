import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl, type Language } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { MarkdownTextarea } from './MarkdownTextarea'

function EditorHarness({ initial = '', lang = 'en' }: { initial?: string; lang?: Language }) {
  const [value, setValue] = useState(initial)
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
        onChange={(event) => setValue(event.target.value)}
        aria-label={lang === 'zh' ? '备注' : 'Notes'}
        placeholder={lang === 'zh' ? '填写备注' : 'Add notes'}
        rows={4}
      />
      <output data-testid="value">{value}</output>
    </I18nContext.Provider>
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

  it('preserves casing through a visual and source round-trip', () => {
    render(<EditorHarness initial="Mixed Case: PhD Atlas" />)

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveTextContent('Mixed Case: PhD Atlas')
    fireEvent.click(screen.getByRole('button', { name: /Edit source/ }))
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Mixed Case: PhD Atlas')
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
