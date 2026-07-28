import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { copyToClipboard } from './clipboard'
import { CopyButton } from './CopyButton'

vi.mock('./clipboard', () => ({
  copyToClipboard: vi.fn(),
}))

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path) => ({
    copy: 'Copy {label}',
    copiedBang: 'Copied!',
    copyFailed: "Couldn't copy — select and copy manually",
  })[path] ?? path,
}

describe('CopyButton failure feedback', () => {
  beforeEach(() => {
    vi.mocked(copyToClipboard).mockReset()
  })

  it('publishes a top-toast error and cross-fades into the warning icon', async () => {
    const user = userEvent.setup()
    const onNotify = vi.fn()
    vi.mocked(copyToClipboard).mockResolvedValue(false)

    render(
      <I18nContext.Provider value={i18nContext}>
        <CopyButton value="" label="Phone" onNotify={onNotify} />
      </I18nContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Copy Phone' }))

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith(
        "Couldn't copy — select and copy manually",
        'error',
      )
      expect(screen.getByRole('button')).toHaveClass('failed')
    })
    expect(document.querySelector('.copy-button-state-icon.failed')).toHaveClass('is-active')
    expect(document.querySelector('.copy-button-state-icon.idle')).not.toHaveClass('is-active')
  })
})
