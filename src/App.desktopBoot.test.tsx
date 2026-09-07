import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { phdApi, type AuthSession } from './api/phdApi'
import { resetConnectivityForTests } from './connectivity'
import { setDesktopRuntime } from './desktopRuntime'

const webauthn = vi.hoisted(() => ({
  startAuthentication: vi.fn(async () => ({ id: 'credential-test' })),
}))

vi.mock('@simplewebauthn/browser', () => webauthn)

vi.mock('./components/screens/AuthScreen', async () => {
  const { createElement } = await import('react')
  return {
    AuthScreen: () => createElement('section', { 'aria-label': 'Sign in' }, 'Website login'),
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('desktop app opens without website login', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('phd-atlas-onboarding-done', '1')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    resetConnectivityForTests()
    setDesktopRuntime(null)
    window.phdAtlasDesktop = { enabled: true }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    setDesktopRuntime(null)
    delete window.phdAtlasDesktop
    vi.unstubAllGlobals()
  })

  it('keeps the local workspace boot instead of the email/password screen when the runtime route is missing', async () => {
    const held = deferred<never>()
    const createSession = vi.spyOn(phdApi, 'createDesktopSession').mockReturnValue(held.promise)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/desktop/runtime')) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(JSON.stringify({ ok: true, data: null, requestId: 'req_test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    render(<App />)

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
    })
    expect(screen.queryByRole('region', { name: /sign in/i })).not.toBeInTheDocument()
    expect(document.querySelector('.launch-screen')).not.toBeNull()
  })

  it('opens the usable workspace without internet or a website session', async () => {
    const setLanguage = vi.fn()
    window.phdAtlasDesktop = { enabled: true, language: 'ja', setLanguage }
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const runtime = { enabled: true, mode: 'local' as const, unlimited: true, unlocked: true,
      unlockRequired: false, remoteOrigin: null, remoteEmail: null, linkedAt: null,
      shareEnabled: false, adminEnabled: false, teamEnabled: false }
    const local: AuthSession = {
      token: 'fresh-local-session',
      user: { id: 'local-owner', name: 'Local', email: 'local@desktop.phd-atlas', role: 'user',
        createdAt: '2026-09-07T00:00:00Z', lastLoginAt: null,
        settings: { language: 'en', membershipPlan: 'pro', receiveEmails: [], highContrast: false, themeAccent: 'Alpine blue' } },
      settings: { allowRegistration: false, notificationMailbox: '', backupFrequency: 'weekly', encryptionAtRest: true },
    } as AuthSession
    const createSession = vi.spyOn(phdApi, 'createDesktopSession').mockResolvedValue({ ...local, runtime })
    const bootstrap = vi.spyOn(phdApi, 'workspaceBootstrap').mockResolvedValue({
      me: { user: local.user, settings: local.settings, mailFetchStatus: {} },
      applications: [], profileAssets: [], backups: [], applicationTrash: [],
      teamWorkspaces: [], activeTeamId: null, teamSummary: null, teamApplications: [], aiKeys: [],
    } as never)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const route = String(input)
      const data = route.includes('/api/desktop/runtime') ? runtime
        : route.includes('/api/auth/me') ? { user: local.user, settings: local.settings }
          : route.includes('/api/notifications/unread-count') ? { count: 0 } : []
      return new Response(JSON.stringify({ ok: true, data, requestId: 'desktop-test' }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await waitFor(() => expect(document.querySelector('.atlas-shell.app-shell-ready')).not.toBeNull(), { timeout: 10_000 })
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(bootstrap).toHaveBeenCalled()
    expect(setLanguage).toHaveBeenCalledWith('ja')
    expect(setLanguage).toHaveBeenLastCalledWith('ja')
    expect(screen.queryByRole('region', { name: /sign in/i })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => /\/api\/auth\/(login|register)/.test(String(url)))).toBe(false)
  })
})
