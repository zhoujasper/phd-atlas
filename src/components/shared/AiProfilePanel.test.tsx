import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareForSafeReload } from '../../safeReload'
import { I18nContext } from '../hooks/useI18n'
import { AiProfilePanel } from './AiProfilePanel'

describe('AiProfilePanel', () => {
  afterEach(() => {
    cleanup()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })
  it('uses an edit icon instead of an expand chevron', () => {
    const { container } = render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: {},
        format: (template) => template,
        tx: (path) => path === 'profile.aiProfileTitle' ? 'Personal profile' : path,
      }}>
        <AiProfilePanel onUpdate={vi.fn()} />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('button', { name: /personal profile/i })).toBeInTheDocument()
    expect(container.querySelector('.ai-profile-summary .eyebrow')).not.toBeInTheDocument()
    expect(container.querySelector('.ai-profile-edit-icon')).toHaveClass('lucide-pencil')
    expect(container.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
  })

  it('keeps the resident draft when a background settings snapshot arrives', () => {
    const context = {
      lang: 'en' as const,
      t: {},
      format: (template: string) => template,
      tx: (path: string) => path === 'profile.aiProfileTitle'
        ? 'Personal profile'
        : path === 'profile.aiProfileFields.preferredName'
          ? 'Preferred name'
          : path,
    }
    const view = render(
      <I18nContext.Provider value={context}>
        <AiProfilePanel value={{ ...blankAiProfile, preferredName: 'Server name' }} onUpdate={vi.fn()} />
      </I18nContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /personal profile/i }))
    const nameInput = screen.getByRole('textbox', { name: 'Preferred name' })
    fireEvent.change(nameInput, { target: { value: 'Local unsaved name' } })

    view.rerender(
      <I18nContext.Provider value={context}>
        <AiProfilePanel value={{ ...blankAiProfile, preferredName: 'Stale server name' }} onUpdate={vi.fn()} />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('textbox', { name: 'Preferred name' })).toHaveValue('Local unsaved name')
  })

  it('restores only the matching account draft after a remount', async () => {
    const context = aiProfileTestContext()
    const first = render(
      <I18nContext.Provider value={context}>
        <AiProfilePanel
          draftUserId="user-a"
          value={{ ...blankAiProfile, preferredName: 'Canonical name' }}
          onUpdate={vi.fn()}
        />
      </I18nContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /personal profile/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Preferred name' }), { target: { value: 'Recovered name' } })
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    first.unmount()

    const other = render(
      <I18nContext.Provider value={context}>
        <AiProfilePanel
          draftUserId="user-b"
          value={{ ...blankAiProfile, preferredName: 'Other account' }}
          onUpdate={vi.fn()}
        />
      </I18nContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /personal profile/i }))
    expect(screen.getByRole('textbox', { name: 'Preferred name' })).toHaveValue('Other account')
    other.unmount()

    render(
      <I18nContext.Provider value={context}>
        <AiProfilePanel
          draftUserId="user-a"
          value={{ ...blankAiProfile, preferredName: 'Canonical name' }}
          onUpdate={vi.fn()}
        />
      </I18nContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /personal profile/i }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preferred name' })).toHaveValue('Recovered name'))
  })

  it('blocks automatic reload and retains a rejected save for retry', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('rejected'))
    render(
      <I18nContext.Provider value={aiProfileTestContext()}>
        <AiProfilePanel draftUserId="user-a" value={blankAiProfile} onUpdate={onUpdate} />
      </I18nContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /personal profile/i }))
    const field = screen.getByRole('textbox', { name: 'Preferred name' })
    fireEvent.change(field, { target: { value: 'Retry me' } })

    await expect(prepareForSafeReload({ reason: 'identity-change' })).resolves.toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'profile.aiProfileSave' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(field).toHaveValue('Retry me')
    await waitFor(() => expect(screen.getByRole('button', { name: 'profile.aiProfileSave' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'profile.aiProfileSave' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2))
  })

  it('clears the account recovery record after a durable acknowledgement', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <I18nContext.Provider value={aiProfileTestContext()}>
        <AiProfilePanel draftUserId="user-a" value={blankAiProfile} onUpdate={onUpdate} />
      </I18nContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /personal profile/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Preferred name' }), { target: { value: 'Saved name' } })
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'profile.aiProfileSave' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(sessionStorage.length).toBe(0)
  })
})

function aiProfileTestContext() {
  return {
    lang: 'en' as const,
    t: {},
    format: (template: string) => template,
    tx: (path: string) => path === 'profile.aiProfileTitle'
      ? 'Personal profile'
      : path === 'profile.aiProfileFields.preferredName'
        ? 'Preferred name'
        : path,
  }
}

const blankAiProfile = {
  preferredName: '', pronouns: '', location: '', timezone: '', citizenship: '',
  currentRole: '', institution: '', degree: '', field: '', graduation: '',
  researchInterests: '', researchMethods: '', achievements: '', goals: '',
  writingLanguage: '', writingTone: '', signature: '', boundaries: '',
}
