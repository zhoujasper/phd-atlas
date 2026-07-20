import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AiKey } from '../../api/phdApi'
import { getDict, registerLanguage, t as translate, tpl } from '../../i18n'
import englishSettings from '../../i18n/en/settings.json'
import { I18nContext } from '../hooks/useI18n'
import { AiKeyManager } from './AiKeyManager'

registerLanguage('en', englishSettings, 'settings')

const key: AiKey = {
  id: 'key_1',
  ownerId: 'user_1',
  teamId: null,
  scope: 'personal',
  provider: 'openai',
  label: 'Research key',
  model: 'gpt-4.1-mini',
  baseUrl: 'https://api.openai.com/v1',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  lastUsedAt: '2026-07-17T00:00:00.000Z',
  secretSet: true,
  usage: { calls: 12, inputTokens: 800, outputTokens: 434, totalTokens: 1234, resetAt: null },
}

function renderManager(onResetUsage = vi.fn(), keys: AiKey[] = [key], onDelete = vi.fn()) {
  const view = render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <AiKeyManager
        keys={keys}
        scope="personal"
        copyPrefix="settings"
        onResetUsage={onResetUsage}
        onDelete={onDelete}
      />
    </I18nContext.Provider>,
  )
  return { onResetUsage, onDelete, view }
}

describe('AiKeyManager usage metadata', () => {
  it('shows calls and tokens without the attachment capability label', async () => {
    const user = userEvent.setup()
    renderManager()

    await user.click(screen.getByRole('button', { name: /research key/i }))

    expect(screen.getByText('12 calls')).toBeInTheDocument()
    expect(screen.getByText('1,234 tokens')).toBeInTheDocument()
    expect(screen.queryByText(/attachments/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/any file type/i)).not.toBeInTheDocument()
  })

  it('resets counters via inline confirm without a modal', async () => {
    const user = userEvent.setup()
    const { onResetUsage } = renderManager()
    await user.click(screen.getByRole('button', { name: /research key/i }))
    await user.click(screen.getByRole('button', { name: /^reset$/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onResetUsage).not.toHaveBeenCalled()

    // Confirm action is the second button in the expanded pair (Cancel + Reset)
    const confirmButtons = screen.getAllByRole('button', { name: /^reset$/i })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(onResetUsage).toHaveBeenCalledWith('key_1'))
  })

  it('can cancel an inline usage reset', async () => {
    const user = userEvent.setup()
    const { onResetUsage } = renderManager()
    await user.click(screen.getByRole('button', { name: /research key/i }))
    await user.click(screen.getByRole('button', { name: /^reset$/i }))

    const usageGroup = screen.getByRole('group', { name: /^reset$/i })
    await user.click(usageGroup.querySelector('.inline-confirm-cancel') as HTMLButtonElement)

    expect(onResetUsage).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeInTheDocument()
  })

  it('keeps reset available when a fresh counter is still zero', async () => {
    const user = userEvent.setup()
    renderManager(vi.fn(), [{ ...key, usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, resetAt: null } }])

    await user.click(screen.getByRole('button', { name: /research key/i }))

    expect(screen.getByRole('button', { name: /^reset$/i })).toBeInTheDocument()
  })

  it('keeps an accepted delete mounted in its smooth exit state before mutating', async () => {
    const user = userEvent.setup()
    const { onDelete, view } = renderManager()
    const item = view.container.querySelector('.ai-key-item') as HTMLElement

    await user.click(view.container.querySelector('.ai-key-delete-inline .inline-confirm-idle') as HTMLButtonElement)
    await user.click(view.container.querySelector('.ai-key-delete-inline .inline-confirm-commit') as HTMLButtonElement)

    expect(item).toHaveClass('is-removing')
    expect(onDelete).not.toHaveBeenCalled()
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('key_1'), { timeout: 800 })
  })

  it('keeps the cancel controls mounted during their smooth closing phase', async () => {
    const user = userEvent.setup()
    const { onDelete, view } = renderManager()
    const item = view.container.querySelector('.ai-key-item') as HTMLElement
    const actions = view.container.querySelector('.ai-key-delete-inline .inline-confirm-actions') as HTMLElement

    await user.click(view.container.querySelector('.ai-key-delete-inline .inline-confirm-idle') as HTMLButtonElement)
    await user.click(view.container.querySelector('.ai-key-delete-inline .inline-confirm-cancel') as HTMLButtonElement)

    expect(item).toHaveClass('is-deleting', 'is-delete-closing')
    expect(actions).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    await waitFor(() => expect(item).not.toHaveClass('is-deleting'), { timeout: 800 })
    expect(actions).toBeInTheDocument()
  })
})
