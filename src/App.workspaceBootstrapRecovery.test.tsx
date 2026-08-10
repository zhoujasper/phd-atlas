import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  ApiError,
  phdApi,
  type AuthSession,
  type WorkspaceBootstrapPayload,
} from './api/phdApi'
import { resetConnectivityForTests } from './connectivity'

const webauthn = vi.hoisted(() => ({
  startAuthentication: vi.fn(async () => ({ id: 'credential-test' })),
}))

vi.mock('@simplewebauthn/browser', () => webauthn)

vi.mock('./components/screens/AuthScreen', async () => {
  const { createElement } = await import('react')
  type Props = {
    onLogin: (email: string, password: string) => Promise<void>
    onPasskeyLogin: (email: string) => Promise<void>
    onRegister: (
      name: string,
      email: string,
      password: string,
      captchaToken: string,
      captchaAnswer: string,
      emailCodeToken: string,
      emailCode: string,
      language: string,
    ) => Promise<void>
  }
  return {
    AuthScreen: (props: Props) => createElement(
      'section',
      { 'aria-label': 'Sign in' },
      createElement('button', {
        onClick: () => { void props.onLogin('a@example.com', 'password-a') },
        type: 'button',
      }, 'Password A'),
      createElement('button', {
        onClick: () => { void props.onLogin('b@example.com', 'password-b') },
        type: 'button',
      }, 'Password B'),
      createElement('button', {
        onClick: () => { void props.onPasskeyLogin('passkey@example.com') },
        type: 'button',
      }, 'Passkey login'),
      createElement('button', {
        onClick: () => {
          void props.onRegister(
            'Registered User',
            'register@example.com',
            'password-register',
            'captcha-token',
            '5',
            'email-code-token',
            '123456',
            'en',
          )
        },
        type: 'button',
      }, 'Register'),
    ),
  }
})

function createSession(id: string, email: string, token = `token-${id}`): AuthSession {
  return {
    token,
    user: {
      id,
      name: id,
      email,
      role: 'user',
      createdAt: '2026-08-03T00:00:00.000Z',
      lastLoginAt: null,
      settings: {
        language: 'en',
        highContrast: false,
        themeAccent: 'Alpine blue',
        sendFrom: email,
        receiveAt: email,
        receiveEmails: [{ address: email, isPrimary: true, notify: true, verified: true }],
        membershipPlan: 'pro',
      },
    },
    settings: {
      allowRegistration: true,
      notificationMailbox: 'admin@example.com',
      backupFrequency: 'weekly',
      encryptionAtRest: true,
    },
  } as AuthSession
}

function workspacePayload(activeSession: AuthSession): WorkspaceBootstrapPayload {
  return {
    me: {
      user: activeSession.user,
      settings: activeSession.settings,
      mailFetchStatus: activeSession.mailFetchStatus,
      usage: activeSession.usage,
    },
    applications: [],
    profileAssets: [],
    backups: [],
    applicationTrash: [],
    teamWorkspaces: [],
    activeTeamId: null,
    teamSummary: null,
    teamApplications: [],
    aiKeys: [],
  } as WorkspaceBootstrapPayload
}

function capacityError(code = 'SERVER_BUSY') {
  const error = new ApiError(
    'PhD Atlas is handling many updates right now. Your work is still here; wait a moment and try again.',
    code,
    503,
  )
  // A hint outside the client retry budget makes these post-auth tests reach the
  // explicit recovery boundary immediately. The zero-hint five-attempt budget
  // is covered by the cold-start integration in App.test.tsx.
  error.retryAfterMs = 20_000
  return error
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: status < 400, data, requestId: 'req_test' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('authenticated workspace bootstrap recovery', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('phd-atlas-onboarding-done', '1')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: function PublicKeyCredential() {},
    })
    resetConnectivityForTests()
    vi.restoreAllMocks()
    webauthn.startAuthentication.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => apiResponse(null)))
  })

  it('keeps the password session when a gateway returns non-JSON after authentication', async () => {
    const activeSession = createSession('user-gateway', 'gateway@example.com')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/login')) return apiResponse(activeSession)
      if (url.includes('/api/workspace/bootstrap')) {
        return new Response('Bad Gateway', {
          status: 502,
          headers: {
            'Content-Type': 'text/plain',
            'X-Request-Id': 'gateway-bootstrap-reference',
          },
        })
      }
      return apiResponse(null)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Password A' }))

    expect(await screen.findByRole('heading', { name: /server unavailable/i }, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('gateway-bootstrap-reference').closest('p')).toHaveClass('offline-launch-request-reference')
    const permissionBoundary = screen.getByText(/server rechecks identity.+before every sync/i).closest('div')
    expect(permissionBoundary).toHaveClass('offline-launch-security')
    expect(permissionBoundary?.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('region', { name: /sign in/i })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('phd-atlas-session') ?? 'null')).toMatchObject({
      token: activeSession.token,
      user: { id: activeSession.user.id },
    })
    // The provisional gateway state leaves room for a normal local API restart,
    // while the serialized bootstrap loop remains capped and cannot form a wave.
    expect(fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/api/workspace/bootstrap')
    ))).toHaveLength(5)
  })

  it.each([
    { button: 'Passkey login', kind: 'passkey' as const },
    { button: 'Register', kind: 'register' as const },
  ])('keeps the $kind session after SERVER_STARTING and recovers explicitly', async ({ button, kind }) => {
    const activeSession = createSession(`user-${kind}`, `${kind}@example.com`)
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap')
      .mockRejectedValueOnce(capacityError('SERVER_STARTING'))
      .mockResolvedValue(workspacePayload(activeSession))

    if (kind === 'passkey') {
      vi.spyOn(phdApi, 'beginPasskeyLogin').mockResolvedValue({ options: {} })
      vi.spyOn(phdApi, 'finishPasskeyLogin').mockResolvedValue(activeSession)
    } else {
      vi.spyOn(phdApi, 'register').mockResolvedValue(activeSession)
    }

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByRole('heading', { name: /slow connection/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /sign in/i })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('phd-atlas-session') ?? 'null')).toMatchObject({
      token: activeSession.token,
      user: { id: activeSession.user.id },
    })

    await user.click(screen.getByRole('button', { name: /retry and sync/i }))
    expect(await screen.findByRole('button', { name: /^applications$/i })).toBeInTheDocument()
    expect(bootstrap).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(screen.getAllByText(kind === 'passkey' ? /^signed in$/i : /^account created$/i)).toHaveLength(1)
    })
    expect(screen.queryByText(/connection restored/i)).not.toBeInTheDocument()
  })

  it.each([
    'WORKSPACE_STREAM_RETRY_REQUIRED',
    'WORKSPACE_REVISION_CHANGED',
    'MEMORY_PRESSURE_SOFT',
    'MEMORY_PRESSURE_HARD',
    'WORK_DEADLINE_EXCEEDED',
  ])('labels transient bootstrap capacity code %s as busy and shows its safe request reference', async (code) => {
    const activeSession = createSession(`user-${code.toLowerCase()}`, `${code.toLowerCase()}@example.com`)
    const error = capacityError(code)
    error.requestId = `bootstrap-${code.toLowerCase().replace(/_/gu, '-')}`
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(error)

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))

    expect(await screen.findByRole('heading', { name: /slow connection/i })).toBeInTheDocument()
    expect(screen.getByText(error.requestId).closest('p')).toHaveTextContent(/request (?:reference|id)/i)
  })

  it('never renders an unsafe bootstrap request reference', async () => {
    const activeSession = createSession('user-unsafe-reference', 'unsafe-reference@example.com')
    const error = capacityError()
    error.requestId = '<script>alert(1)</script>'
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(error)

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))

    expect(await screen.findByRole('heading', { name: /slow connection/i })).toBeInTheDocument()
    expect(screen.queryByText(/request (?:reference|id)/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/alert\(1\)/i)).not.toBeInTheDocument()
  })

  it('runs only one manual retry while the workspace read is pending', async () => {
    const activeSession = createSession('user-single-flight', 'single-flight@example.com')
    const pendingBootstrap = deferred<WorkspaceBootstrapPayload>()
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap')
      .mockRejectedValueOnce(capacityError())
      .mockImplementationOnce(() => pendingBootstrap.promise)
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))
    const retry = await screen.findByRole('button', { name: /retry and sync/i })

    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(bootstrap).toHaveBeenCalledTimes(2)
    expect(retry).toBeDisabled()

    await act(async () => { pendingBootstrap.resolve(workspacePayload(activeSession)) })
    expect(await screen.findByRole('button', { name: /^applications$/i })).toBeInTheDocument()
    expect(bootstrap).toHaveBeenCalledTimes(2)
  })

  it('aborts the retry delay on unmount so no later bootstrap request starts', async () => {
    const activeSession = createSession('user-unmount-delay', 'unmount-delay@example.com')
    localStorage.setItem('phd-atlas-session', JSON.stringify(activeSession))
    const retryable = new ApiError('Server busy.', 'SERVER_BUSY', 503)
    retryable.retryAfterMs = 0
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(retryable)

    const view = render(<App />)
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1))
    const signal = bootstrap.mock.calls[0]?.[2]?.signal

    view.unmount()
    await act(async () => { await Promise.resolve() })
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight manual recovery fetch and performs no post-unmount retry', async () => {
    const activeSession = createSession('user-unmount-fetch', 'unmount-fetch@example.com')
    let retrySignal: AbortSignal | null = null
    const getRetrySignal = (): AbortSignal | null => retrySignal
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap')
      .mockRejectedValueOnce(capacityError())
      .mockImplementationOnce((_token, _teamId, options) => new Promise<WorkspaceBootstrapPayload>((_resolve, reject) => {
        retrySignal = options?.signal ?? null
        retrySignal?.addEventListener('abort', () => {
          reject(retrySignal?.reason ?? new Error('aborted'))
        }, { once: true })
      }))
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const user = userEvent.setup()
    const view = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))
    fireEvent.click(await screen.findByRole('button', { name: /retry and sync/i }))
    await waitFor(() => expect(getRetrySignal()).not.toBeNull())

    view.unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getRetrySignal()?.aborted).toBe(true)
    expect(bootstrap).toHaveBeenCalledTimes(2)
    expect(consoleError.mock.calls.some(([message]) => (
      /state update.*unmounted|unmounted component/i.test(String(message))
    ))).toBe(false)
  })

  it('does not finish authentication state after unmount while automatic bootstrap is pending', async () => {
    const activeSession = createSession('user-auth-unmount', 'auth-unmount@example.com')
    let bootstrapSignal: AbortSignal | null = null
    const getBootstrapSignal = (): AbortSignal | null => bootstrapSignal
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap')
      .mockImplementationOnce((_token, _teamId, options) => new Promise<WorkspaceBootstrapPayload>((_resolve, reject) => {
        bootstrapSignal = options?.signal ?? null
        bootstrapSignal?.addEventListener('abort', () => {
          reject(bootstrapSignal?.reason ?? new Error('aborted'))
        }, { once: true })
      }))
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const user = userEvent.setup()
    const view = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))
    await waitFor(() => expect(getBootstrapSignal()).not.toBeNull())

    view.unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getBootstrapSignal()?.aborted).toBe(true)
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls.some(([message]) => (
      /state update.*unmounted|unmounted component/i.test(String(message))
    ))).toBe(false)
  })

  it.each([
    { code: 'BAD_REQUEST', status: 400 },
    { code: 'FORBIDDEN', status: 403 },
  ])('offers a non-destructive account exit after permanent $status bootstrap failure', async ({ code, status }) => {
    const activeSession = createSession(`user-permanent-${status}`, `permanent-${status}@example.com`)
    const offlineSnapshotKey = `phd-atlas-offline-snapshot:v3:${activeSession.user.id}`
    const offlineSnapshotMarker = JSON.stringify({ authoredDraft: 'keep-me' })
    localStorage.setItem(offlineSnapshotKey, offlineSnapshotMarker)
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(
      new ApiError('This workspace cannot be opened by the current account.', code, status),
    )

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))
    expect(await screen.findByRole('heading', { name: /server unavailable/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(await screen.findByRole('region', { name: /sign in/i })).toBeInTheDocument()
    expect(localStorage.getItem('phd-atlas-session')).toBeNull()
    expect(localStorage.getItem(offlineSnapshotKey)).toBe(offlineSnapshotMarker)
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('lets the latest authentication generation win and ignores the older account callback', async () => {
    const sessionA = createSession('user-a', 'a@example.com')
    const sessionB = createSession('user-b', 'b@example.com')
    const loginA = deferred<AuthSession>()
    const loginB = deferred<AuthSession>()
    vi.spyOn(phdApi, 'login').mockImplementation((email) => (
      email === 'a@example.com' ? loginA.promise : loginB.promise
    ))
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(new TypeError('fetch failed'))

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))
    await user.click(screen.getByRole('button', { name: 'Password B' }))

    await act(async () => { loginB.resolve(sessionB) })
    expect(await screen.findByRole('heading', { name: /server unavailable/i }, { timeout: 10_000 })).toBeInTheDocument()
    await act(async () => { loginA.resolve(sessionA) })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('phd-atlas-session') ?? 'null')).toMatchObject({
        token: sessionB.token,
        user: { id: sessionB.user.id },
      })
    })
    expect(bootstrap).toHaveBeenCalledTimes(5)
    expect(bootstrap).toHaveBeenCalledWith(sessionB.token, null, expect.any(Object))
  })

  it('exhausts four bounded 502 retries before exposing recovery', async () => {
    const activeSession = createSession('user-gateway', 'gateway@example.com')
    localStorage.setItem('phd-atlas-session', JSON.stringify(activeSession))
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(
      new ApiError('The PhD Atlas server is unavailable.', 'SERVER_UNAVAILABLE', 502),
    )

    render(<App />)

    expect(await screen.findByRole('heading', { name: /server unavailable/i }, { timeout: 10_000 })).toBeInTheDocument()
    expect(bootstrap).toHaveBeenCalledTimes(5)
    expect(JSON.parse(localStorage.getItem('phd-atlas-session') ?? 'null')).toMatchObject({
      token: activeSession.token,
      user: { id: activeSession.user.id },
    })
  }, 15_000)

  it('still clears an established session on an authoritative TOKEN_EXPIRED response', async () => {
    const activeSession = createSession('user-expired', 'expired@example.com')
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    vi.spyOn(phdApi, 'workspaceBootstrap').mockRejectedValue(
      new ApiError('Your session expired. Sign in again.', 'TOKEN_EXPIRED', 401),
    )

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))

    expect(await screen.findByRole('region', { name: /sign in/i })).toBeInTheDocument()
    expect(localStorage.getItem('phd-atlas-session')).toBeNull()
    expect(screen.queryByRole('heading', { name: /server unavailable|slow connection/i })).not.toBeInTheDocument()
  })

  it('still clears an established session when bootstrap returns another account', async () => {
    const activeSession = createSession('user-owner', 'owner@example.com')
    const otherSession = createSession('user-other', 'other@example.com')
    vi.spyOn(phdApi, 'login').mockResolvedValue(activeSession)
    vi.spyOn(phdApi, 'workspaceBootstrap').mockResolvedValue(workspacePayload(otherSession))

    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Password A' }))

    expect(await screen.findByRole('region', { name: /sign in/i })).toBeInTheDocument()
    expect(localStorage.getItem('phd-atlas-session')).toBeNull()
    expect(screen.queryByText(otherSession.user.email)).not.toBeInTheDocument()
  })
})
