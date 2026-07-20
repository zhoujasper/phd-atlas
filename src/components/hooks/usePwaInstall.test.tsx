import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPwaInstallCaptureForTests,
  capturePwaInstallPrompt,
  PWA_INSTALLED_MARKER_KEY,
  usePwaInstall,
} from './usePwaInstall'

type TestInstallEvent = Event & {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const originalMatchMedia = window.matchMedia

function mockDisplayMode(standalone = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)'
        || query === '(display-mode: minimal-ui)'
        || query === '(display-mode: window-controls-overlay)'
        ? standalone
        : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function mockRelatedApps(apps: Array<{ platform: string }> | null) {
  if (apps === null) {
    Reflect.deleteProperty(navigator, 'getInstalledRelatedApps')
    return
  }
  Object.defineProperty(navigator, 'getInstalledRelatedApps', {
    configurable: true,
    value: vi.fn().mockResolvedValue(apps),
  })
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as TestInstallEvent
  Object.defineProperties(event, {
    prompt: { value: vi.fn().mockResolvedValue(undefined) },
    userChoice: { value: Promise.resolve({ outcome, platform: 'web' }) },
  })
  return event
}

function Probe() {
  const { status, canInstall, install } = usePwaInstall()
  return (
    <div>
      <output>{status}</output>
      <button type="button" disabled={!canInstall} onClick={() => void install()}>Install</button>
    </div>
  )
}

afterEach(() => {
  localStorage.removeItem(PWA_INSTALLED_MARKER_KEY)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  Reflect.deleteProperty(navigator, 'getInstalledRelatedApps')
  __resetPwaInstallCaptureForTests()
  vi.restoreAllMocks()
})

describe('usePwaInstall', () => {
  it('captures the browser prompt and completes an accepted install', async () => {
    mockDisplayMode()
    mockRelatedApps([])
    capturePwaInstallPrompt()
    const user = userEvent.setup()
    render(<Probe />)
    const event = installEvent('accepted')

    act(() => window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByText('available')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('installed')).toBeInTheDocument()
    expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBe('1')
  })

  it('reports a dismissed browser prompt without claiming installation', async () => {
    mockDisplayMode()
    mockRelatedApps([])
    capturePwaInstallPrompt()
    const user = userEvent.setup()
    render(<Probe />)
    const event = installEvent('dismissed')

    act(() => window.dispatchEvent(event))
    await user.click(screen.getByRole('button', { name: 'Install' }))

    expect(await screen.findByText('dismissed')).toBeInTheDocument()
  })

  it('starts installed in a standalone application window', async () => {
    mockDisplayMode(true)
    mockRelatedApps(null)
    capturePwaInstallPrompt()
    render(<Probe />)

    expect(screen.getByText('installed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
    await waitFor(() => {
      expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBe('1')
    })
  })

  it('does not hide install guidance based only on a stale localStorage marker', async () => {
    mockDisplayMode()
    mockRelatedApps([])
    localStorage.setItem(PWA_INSTALLED_MARKER_KEY, '1')
    capturePwaInstallPrompt()

    render(<Probe />)

    await waitFor(() => {
      expect(screen.getByText('unavailable')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
    expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBeNull()
  })

  it('reports installed when the Related Applications API says the PWA is present', async () => {
    mockDisplayMode()
    mockRelatedApps([{ platform: 'webapp' }])
    capturePwaInstallPrompt()

    render(<Probe />)

    await waitFor(() => {
      expect(screen.getByText('installed')).toBeInTheDocument()
    })
    expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBe('1')
  })

  it('restores the install action when the browser offers a prompt after uninstall', async () => {
    mockDisplayMode()
    mockRelatedApps([])
    localStorage.setItem(PWA_INSTALLED_MARKER_KEY, '1')
    capturePwaInstallPrompt()
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())
    const event = installEvent('accepted')

    act(() => window.dispatchEvent(event))

    expect(screen.getByText('available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
    expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBeNull()
  })

  it('reacts when the browser reports that installation completed', async () => {
    mockDisplayMode()
    mockRelatedApps([])
    capturePwaInstallPrompt()
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())

    act(() => window.dispatchEvent(new Event('appinstalled')))

    expect(screen.getByText('installed')).toBeInTheDocument()
    expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBe('1')
  })

  it('revalidates after the tab becomes visible so uninstall restores the card', async () => {
    mockDisplayMode()
    const related = vi.fn()
      .mockResolvedValueOnce([{ platform: 'webapp' }])
      .mockResolvedValueOnce([])
    Object.defineProperty(navigator, 'getInstalledRelatedApps', {
      configurable: true,
      value: related,
    })
    capturePwaInstallPrompt()

    render(<Probe />)
    await waitFor(() => expect(screen.getByText('installed')).toBeInTheDocument())

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
      // Handler reads document.visibilityState on window listener — dispatch on window too.
      window.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())
    expect(localStorage.getItem(PWA_INSTALLED_MARKER_KEY)).toBeNull()
  })

  it('keeps the captured prompt across remounts (Strict Mode / navigation)', async () => {
    mockDisplayMode()
    mockRelatedApps([])
    capturePwaInstallPrompt()
    const event = installEvent('accepted')

    // Prompt arrives before the React tree mounts (lazy App / early SW activation).
    act(() => window.dispatchEvent(event))

    const first = render(<Probe />)
    expect(screen.getByText('available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()

    first.unmount()

    render(<Probe />)
    expect(screen.getByText('available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('installed')).toBeInTheDocument()
  })
})
