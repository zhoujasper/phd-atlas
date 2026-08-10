import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TextareaHTMLAttributes } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareForSafeReload } from '../../safeReload'
import { I18nContext } from '../hooks/useI18n'
import { SnippetPhraseSettingsDialog } from './SnippetPhraseSettingsDialog'

vi.mock('./LazyMarkdownTextarea', async () => {
  const React = await import('react')
  return {
    LazyMarkdownTextarea: React.forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
      (props, ref) => <textarea {...props} ref={ref} />,
    ),
  }
})

const canonicalSettings = {
  leadEn: 'Canonical primary lead',
  tailEn: 'Canonical primary tail',
  leadZh: 'Canonical secondary lead',
  tailZh: 'Canonical secondary tail',
}

describe('SnippetPhraseSettingsDialog resident persistence', () => {
  afterEach(() => {
    cleanup()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('does not let a background settings snapshot overwrite the open draft', () => {
    const view = renderDialog({ draftUserId: 'user-a' })
    const primaryLead = screen.getAllByRole('textbox', { name: 'Prefix' })[0]!
    fireEvent.change(primaryLead, { target: { value: 'Local phrase draft' } })

    view.rerender(dialogNode({
      draftUserId: 'user-a',
      settings: {
        leadEn: 'Stale refreshed lead',
        tailEn: 'Stale refreshed tail',
        leadZh: 'Stale secondary lead',
        tailZh: 'Stale secondary tail',
      },
    }))

    expect(screen.getAllByRole('textbox', { name: 'Prefix' })[0]).toHaveValue('Local phrase draft')
  })

  it('restores only the matching account after remount', async () => {
    const first = renderDialog({ draftUserId: 'user-a' })
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Prefix' })[0]!, {
      target: { value: 'Recovered phrase' },
    })
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    first.unmount()

    const other = renderDialog({ draftUserId: 'user-b' })
    expect(screen.getAllByRole('textbox', { name: 'Prefix' })[0]).toHaveValue('Canonical primary lead')
    other.unmount()

    renderDialog({ draftUserId: 'user-a' })
    expect(screen.getAllByRole('textbox', { name: 'Prefix' })[0]).toHaveValue('Recovered phrase')
  })

  it('blocks automatic reload and keeps a rejected save retryable', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('rejected'))
    renderDialog({ draftUserId: 'user-a', onSave })
    const primaryLead = screen.getAllByRole('textbox', { name: 'Prefix' })[0]!
    fireEvent.change(primaryLead, { target: { value: 'Retry phrase' } })

    await expect(prepareForSafeReload({ reason: 'lazy-module' })).resolves.toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(primaryLead).toHaveValue('Retry phrase')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  })

  it('clears the account recovery record after the durable settings acknowledgement', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDialog({ draftUserId: 'user-a', onSave })
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Prefix' })[0]!, {
      target: { value: 'Saved phrase' },
    })
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(sessionStorage.length).toBe(0)
  })
})

function renderDialog(overrides: Partial<Parameters<typeof dialogNode>[0]> = {}) {
  return render(dialogNode(overrides))
}

function dialogNode({
  draftUserId = 'user-a',
  settings = canonicalSettings,
  onSave = vi.fn(),
}: {
  draftUserId?: string
  settings?: typeof canonicalSettings
  onSave?: (patch: Record<string, unknown>) => void | Promise<void>
} = {}) {
  return (
    <I18nContext.Provider value={{
      lang: 'en',
      t: {},
      format: (template) => template,
      tx: (path) => {
        if (path === 'profile.phrasePrefixA') return 'Prefix'
        if (path === 'profile.phraseSuffixB') return 'Suffix'
        if (path === 'save') return 'Save'
        if (path === 'close') return 'Close'
        if (path === 'cancel') return 'Cancel'
        return path
      },
    }}>
      <SnippetPhraseSettingsDialog
        open
        draftUserId={draftUserId}
        settings={settings}
        onClose={vi.fn()}
        onSave={onSave}
      />
    </I18nContext.Provider>
  )
}
