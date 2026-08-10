import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageReloadMock = vi.hoisted(() => vi.fn())

vi.mock('./pageReload', () => ({
  reloadPage: pageReloadMock,
}))

import App from './App'
import { phdApi, type AuthSession, type WorkspaceBootstrapPayload } from './api/phdApi'
import { resetConnectivityForTests } from './connectivity'
import { applications } from './data/applications'
import { installLazyModuleRecovery } from './lazyModuleRecovery'
import { registerSafeReloadGuard, SAFE_RELOAD_BLOCKED_EVENT } from './safeReload'

const SESSION_KEY = 'phd-atlas-session'
const LANGUAGE_KEY = 'phd-atlas-language'
const ONBOARDING_DONE_KEY = 'phd-atlas-onboarding-done'

const sessionA = {
  token: 'token-a',
  user: {
    id: 'user-a',
    name: 'User A',
    email: 'a@example.edu',
    role: 'user',
    createdAt: '2026-08-02T00:00:00.000Z',
    lastLoginAt: null,
    settings: {
      language: 'en',
      highContrast: false,
      themeAccent: 'Alpine blue',
      sendFrom: 'a@example.edu',
      receiveAt: 'a@example.edu',
      receiveEmails: [{ address: 'a@example.edu', isPrimary: true, notify: true, verified: true }],
      membershipPlan: 'pro',
    },
  },
  settings: {
    allowRegistration: true,
    notificationMailbox: 'admin-alerts@phd-atlas.local',
    backupFrequency: 'weekly',
    encryptionAtRest: true,
  },
} as AuthSession

const sessionB = {
  ...sessionA,
  token: 'token-b',
  user: {
    ...sessionA.user,
    id: 'user-b',
    name: 'User B',
    email: 'b@example.edu',
  },
} as AuthSession

const sessionC = {
  ...sessionA,
  token: 'token-c',
  user: {
    ...sessionA.user,
    id: 'user-c',
    name: 'User C',
    email: 'c@example.edu',
  },
} as AuthSession

const guardCleanups: Array<() => void> = []

function envelope(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'req_safe_reload' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function workspaceBootstrap(session: AuthSession): WorkspaceBootstrapPayload {
  return {
    me: {
      user: session.user,
      settings: session.settings,
      mailFetchStatus: {
        lastFetchedAt: null,
        lastHistorySyncAt: null,
        lastHistoryImported: 0,
        trackedAddressCount: 0,
        lastErrorCode: null,
        lastErrorAt: null,
      },
    },
    applications: [structuredClone(applications[0])],
    profileAssets: [],
    backups: [],
    applicationTrash: [],
    teamWorkspaces: [],
    activeTeamId: null,
    teamSummary: null,
    teamApplications: [],
    aiKeys: [],
  }
}

function publishRemoteSession(nextSession: AuthSession | null) {
  const oldValue = localStorage.getItem(SESSION_KEY)
  const newValue = nextSession ? JSON.stringify(nextSession) : null
  if (newValue === null) localStorage.removeItem(SESSION_KEY)
  else localStorage.setItem(SESSION_KEY, newValue)
  window.dispatchEvent(new StorageEvent('storage', {
    key: SESSION_KEY,
    oldValue,
    newValue,
    storageArea: localStorage,
    url: window.location.href,
  }))
}

async function renderAuthenticatedApp() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionA))
  localStorage.setItem(ONBOARDING_DONE_KEY, '1')
  window.history.replaceState(
    null,
    '',
    `/applications/${encodeURIComponent(applications[0]!.id)}/dossier`,
  )
  vi.spyOn(phdApi, 'workspaceBootstrap').mockResolvedValue(workspaceBootstrap(sessionA))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/notifications/unread-count')) return envelope({ count: 0 })
    if (url.includes('/api/events')) return envelope([])
    return envelope(null)
  }))

  render(<App />)
  return screen.findByRole('searchbox', { name: 'Search applications' }, { timeout: 30_000 })
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  resetConnectivityForTests()
  pageReloadMock.mockReset()
})

afterEach(() => {
  while (guardCleanups.length) guardCleanups.pop()?.()
  cleanup()
  vi.restoreAllMocks()
})

describe('App safe reload integration', () => {
  it.each([
    {
      label: 'throws',
      storage: () => ({
        getItem: () => null,
        setItem: () => {
          throw new DOMException('Storage disabled.', 'SecurityError')
        },
      }),
    },
    {
      label: 'silently ignores writes',
      storage: () => ({
        getItem: () => null,
        setItem: () => undefined,
      }),
    },
  ])('shows the localized resident-state warning and does not reload when cooldown storage $label', async ({ storage }) => {
    localStorage.setItem(LANGUAGE_KEY, 'zh')
    vi.stubGlobal('fetch', vi.fn(async () => envelope({
      question: '2 + 3',
      token: 'captcha-safe-reload',
      expiresInSeconds: 600,
    })))
    render(<App />)
    expect(await screen.findByRole('button', { name: '登录' }, { timeout: 10_000 })).toBeInTheDocument()

    const reload = vi.fn()
    const stop = installLazyModuleRecovery({
      reload,
      storage: storage(),
      now: () => 50_000,
      prepareReload: async () => true,
      setTimer: (callback) => {
        callback()
        return 1
      },
    })
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    event.payload = new Error('ChunkLoadError: Loading chunk 41 failed.')

    act(() => {
      window.dispatchEvent(event)
    })

    expect(await screen.findByText(/此页面不会自动刷新/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    stop()
  }, 60_000)

  it('applies only C after rapid A to B to C storage events and reloads once', async () => {
    await renderAuthenticatedApp()
    let releasePreparation: (allowed: boolean) => void = () => undefined
    const preparation = new Promise<boolean>((resolve) => {
      releasePreparation = resolve
    })
    guardCleanups.push(registerSafeReloadGuard('test-cross-tab-transition', {
      prepare: () => preparation,
    }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    act(() => {
      publishRemoteSession(sessionB)
      publishRemoteSession(sessionC)
    })
    setItem.mockClear()

    await act(async () => {
      releasePreparation(true)
      await preparation
    })

    await waitFor(() => expect(pageReloadMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}').user?.id).toBe('user-c')
    const committedSessionWrites = setItem.mock.calls
      .filter(([key]) => key === SESSION_KEY)
      .map(([, value]) => JSON.parse(String(value)) as AuthSession)
    expect(committedSessionWrites).toHaveLength(1)
    expect(committedSessionWrites[0]?.user.id).toBe('user-c')
  }, 90_000)

  it('keeps resident input mounted when remote logout is dirty-blocked', async () => {
    const search = await renderAuthenticatedApp()
    fireEvent.change(search, { target: { value: 'resident filter' } })
    const blocked = vi.fn()
    window.addEventListener(SAFE_RELOAD_BLOCKED_EVENT, blocked)
    guardCleanups.push(registerSafeReloadGuard('test-resident-dirty', {
      hasUnsavedChanges: () => true,
    }))

    act(() => {
      publishRemoteSession(null)
    })

    await waitFor(() => expect(blocked).toHaveBeenCalledTimes(1))
    expect(search).toHaveValue('resident filter')
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    expect(pageReloadMock).not.toHaveBeenCalled()
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
    window.removeEventListener(SAFE_RELOAD_BLOCKED_EVENT, blocked)
  }, 90_000)

  it('clears the mounted account after an unblocked remote logout without reloading', async () => {
    await renderAuthenticatedApp()

    act(() => {
      publishRemoteSession(null)
    })

    expect(await screen.findByRole('button', { name: /^sign in$/i }, { timeout: 10_000 })).toBeInTheDocument()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(pageReloadMock).not.toHaveBeenCalled()
  }, 90_000)
})
