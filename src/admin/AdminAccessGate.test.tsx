import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { phdApi } from '../api/phdApi'
import { registerLanguage, type LangDict } from '../i18n'
import englishAdmin from '../i18n/en/admin.json'
import { AdminAccessGate } from './AdminAccessGate'

registerLanguage('en', englishAdmin as LangDict, 'admin')

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('AdminAccessGate', () => {
  it('normalizes a valid activation path and allows a session without remembering it', async () => {
    window.history.replaceState({}, '', '/admin/aaa')
    vi.spyOn(phdApi, 'activateAdminAccess').mockResolvedValue({ hidden: true, allowed: true })
    const remember = vi.spyOn(phdApi, 'rememberAdminAccess')
    const user = userEvent.setup()

    render(
      <AdminAccessGate>
        <div>Administrator login</div>
      </AdminAccessGate>,
    )

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /not now/i }))

    expect(await screen.findByText('Administrator login')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/admin')
    expect(remember).not.toHaveBeenCalled()
  })

  it('persists the browser grant when the user chooses remember', async () => {
    window.history.replaceState({}, '', '/admin/aaa')
    vi.spyOn(phdApi, 'activateAdminAccess').mockResolvedValue({ hidden: true, allowed: true })
    const remember = vi.spyOn(phdApi, 'rememberAdminAccess').mockResolvedValue({ hidden: true, allowed: true })
    const user = userEvent.setup()

    render(
      <AdminAccessGate>
        <div>Administrator login</div>
      </AdminAccessGate>,
    )

    await user.click(await screen.findByRole('button', { name: /remember this device/i }))

    await waitFor(() => expect(remember).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Administrator login')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/admin')
  })
})
