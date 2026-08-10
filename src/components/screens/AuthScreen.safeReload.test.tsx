import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareForSafeReload,
  SAFE_RELOAD_BLOCKED_EVENT,
  type SafeReloadBlockedDetail,
} from '../../safeReload'
import { AuthScreen } from './AuthScreen'
import { registrationIdentityStorageKey } from './authRegistrationDraft'
import { PUBLIC_DISTRIBUTION } from '../../edition'

function renderAuth() {
  return render(
    <AuthScreen
      busy={false}
      onLogin={vi.fn()}
      onRegister={vi.fn()}
      onForgotPassword={vi.fn()}
      onCaptcha={vi.fn().mockResolvedValue({
        provider: 'math',
        question: '2 + 3',
        token: 'captcha-secret-token',
      })}
      onSendEmailCode={vi.fn().mockResolvedValue({
        token: 'email-code-secret-token',
        expiresInSeconds: 600,
      })}
      languages={[{ value: 'en', label: 'English' }]}
      onLanguageChange={vi.fn()}
    />,
  )
}

async function openRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /create a new account/i }))
  await screen.findByRole('button', { name: /^create account$/i })
}

describe('anonymous registration resident state', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('blocks automatic/native reload and recovers only name and email', async () => {
    const user = userEvent.setup()
    const first = renderAuth()
    await openRegistration(user)

    const name = screen.getByLabelText(/^name$/i)
    const email = screen.getByLabelText(/^email$/i)
    const password = screen.getByLabelText(/^password$/i)
    await user.clear(name)
    await user.type(name, 'Resident Applicant')
    await user.clear(email)
    await user.type(email, 'resident@example.com')
    await user.clear(password)
    await user.type(password, 'Sensitive password 2026!')
    await waitFor(() => expect(screen.getByText('2 + 3')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText(/^answer$/i), '5')
    await user.click(screen.getByRole('button', { name: /^send code$/i }))
    await waitFor(() => expect(screen.getByText(/code sent/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/email.*code/i), '123456')

    const blocked: SafeReloadBlockedDetail[] = []
    const onBlocked = (event: Event) => {
      blocked.push((event as CustomEvent<SafeReloadBlockedDetail>).detail)
    }
    window.addEventListener(SAFE_RELOAD_BLOCKED_EVENT, onBlocked)
    await expect(prepareForSafeReload({ reason: 'application-update' })).resolves.toBe(false)
    window.removeEventListener(SAFE_RELOAD_BLOCKED_EVENT, onBlocked)
    expect(blocked).toContainEqual({ reason: 'application-update', cause: 'resident-dirty' })

    const serialized = sessionStorage.getItem(registrationIdentityStorageKey()) ?? ''
    expect(serialized).toContain('Resident Applicant')
    expect(serialized).toContain('resident@example.com')
    expect(serialized).not.toContain('Sensitive password 2026!')
    expect(serialized).not.toContain('123456')
    expect(serialized).not.toContain('captcha-secret-token')
    expect(serialized).not.toContain('email-code-secret-token')

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    first.unmount()
    renderAuth()
    await openRegistration(userEvent.setup())
    await waitFor(() => {
      expect(screen.getByLabelText(/^name$/i)).toHaveValue('Resident Applicant')
      expect(screen.getByLabelText(/^email$/i)).toHaveValue('resident@example.com')
    })
    expect(screen.getByLabelText(/^password$/i)).toHaveValue(PUBLIC_DISTRIBUTION ? '' : 'demo123456')
    expect(screen.getByLabelText(/email.*code/i)).toHaveValue('')
    expect(screen.getByPlaceholderText(/^answer$/i)).toHaveValue('')
  })

  it('keeps every resident field mounted when registration submission returns', async () => {
    const user = userEvent.setup()
    const onRegister = vi.fn().mockResolvedValue(undefined)
    render(
      <AuthScreen
        busy={false}
        onLogin={vi.fn()}
        onRegister={onRegister}
        onCaptcha={vi.fn().mockResolvedValue({ question: '4 + 4', token: 'captcha-token' })}
        onSendEmailCode={vi.fn().mockResolvedValue({ token: 'code-token', expiresInSeconds: 600 })}
        languages={[{ value: 'en', label: 'English' }]}
        onLanguageChange={vi.fn()}
      />,
    )
    await openRegistration(user)
    await user.clear(screen.getByLabelText(/^name$/i))
    await user.type(screen.getByLabelText(/^name$/i), 'Retry Applicant')
    await user.clear(screen.getByLabelText(/^email$/i))
    await user.type(screen.getByLabelText(/^email$/i), 'retry@example.com')
    await user.clear(screen.getByLabelText(/^password$/i))
    await user.type(screen.getByLabelText(/^password$/i), 'Retry password 2026!')
    await waitFor(() => expect(screen.getByText('4 + 4')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText(/^answer$/i), '8')
    await user.click(screen.getByRole('button', { name: /^send code$/i }))
    await waitFor(() => expect(screen.getByLabelText(/email.*code/i)).toBeEnabled())
    await user.type(screen.getByLabelText(/email.*code/i), '654321')
    fireEvent.submit(screen.getByRole('button', { name: /^create account$/i }).closest('form')!)

    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Retry Applicant')
    expect(screen.getByLabelText(/^email$/i)).toHaveValue('retry@example.com')
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('Retry password 2026!')
    expect(screen.getByLabelText(/email.*code/i)).toHaveValue('654321')
  })
})
