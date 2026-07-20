import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { ConfirmDialog } from './ConfirmDialog'

const zhContext: I18nContextValue = {
  lang: 'zh',
  t: {},
  format: (template) => template,
  tx: (path, fallback) => ({
    cancel: '取消',
    confirm: '确认',
  })[path] ?? fallback ?? path,
}

describe('ConfirmDialog', () => {
  afterEach(() => vi.useRealTimers())

  it('localizes default action labels from the active language', () => {
    render(
      <I18nContext.Provider value={zhContext}>
        <ConfirmDialog
          open
          title="放弃"
          message="放弃未保存的修改？"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('plays the shared exit motion before unmounting the dialog', () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    const view = render(
      <I18nContext.Provider value={zhContext}>
        <ConfirmDialog
          open
          title="放弃"
          message="放弃未保存的修改？"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </I18nContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(document.querySelector('.dialog-layer')).toHaveClass('exiting')
    expect(onCancel).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(160))
    expect(onCancel).toHaveBeenCalledTimes(1)
    view.rerender(
      <I18nContext.Provider value={zhContext}>
        <ConfirmDialog
          open={false}
          title="放弃"
          message="放弃未保存的修改？"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </I18nContext.Provider>,
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
