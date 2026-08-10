import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRecoverableModuleLoader,
  installLazyModuleRecovery,
  isLazyModuleLoadFailure,
  loadLazyModule,
} from './lazyModuleRecovery'
import {
  SAFE_RELOAD_BLOCKED_EVENT,
  type SafeReloadBlockedDetail,
} from './safeReload'

afterEach(() => {
  vi.useRealTimers()
})

describe('lazy module recovery', () => {
  it('recognizes browser and Vite code-chunk failures without swallowing ordinary render errors', () => {
    expect(isLazyModuleLoadFailure(new TypeError(
      'Failed to fetch dynamically imported module: /assets/DossierView.js',
    ))).toBe(true)
    expect(isLazyModuleLoadFailure(new Error('ChunkLoadError: Loading chunk 41 failed.'))).toBe(true)
    expect(isLazyModuleLoadFailure(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('retries a transient module request and reuses the resolved module', async () => {
    vi.useFakeTimers()
    const module = { default: () => null }
    const loader = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue(module)
    const recoverableLoader = createRecoverableModuleLoader(loader)

    const first = recoverableLoader()
    const second = recoverableLoader()
    expect(first).toBe(second)

    await vi.advanceTimersByTimeAsync(120)
    await expect(first).resolves.toBe(module)
    await expect(recoverableLoader()).resolves.toBe(module)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not retry an application exception from inside a loaded module', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('Component initialization failed'))

    await expect(loadLazyModule(loader, [0, 0])).rejects.toThrow('Component initialization failed')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('reloads once for a stale Vite preload and suppresses refresh loops', async () => {
    const reload = vi.fn()
    const setTimer = vi.fn((callback: () => void) => {
      callback()
      return 1
    })
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const prepareReload = vi.fn(async () => true)
    const stop = installLazyModuleRecovery({ reload, setTimer, storage, now: () => 50_000, prepareReload })

    const firstEvent = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    firstEvent.payload = new TypeError('Failed to fetch dynamically imported module: /assets/ProfileScreen.js')
    window.dispatchEvent(firstEvent)

    const repeatedEvent = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    repeatedEvent.payload = firstEvent.payload
    window.dispatchEvent(repeatedEvent)

    expect(firstEvent.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(prepareReload).toHaveBeenCalledWith('lazy-module')
    expect(setTimer).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not reload or record a cooldown while a resident draft blocks recovery', async () => {
    const reload = vi.fn()
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const stop = installLazyModuleRecovery({
      reload,
      storage,
      now: () => 50_000,
      prepareReload: async () => false,
      setTimer: (callback) => {
        callback()
        return 1
      },
    })
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    event.payload = new Error('ChunkLoadError: Loading chunk 41 failed.')
    window.dispatchEvent(event)

    await vi.waitFor(() => expect(event.defaultPrevented).toBe(true))
    expect(reload).not.toHaveBeenCalled()
    expect(values.size).toBe(0)
    stop()
  })

  it.each([
    {
      label: 'throws',
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('Storage is disabled.', 'SecurityError')
        },
      },
    },
    {
      label: 'silently discards the write',
      storage: {
        getItem: () => null,
        setItem: () => undefined,
      },
    },
  ])('blocks reload and emits a localizable event when cooldown storage $label', async ({ storage }) => {
    const reload = vi.fn()
    const blocked = vi.fn((event: Event) => event)
    window.addEventListener(SAFE_RELOAD_BLOCKED_EVENT, blocked)
    const stop = installLazyModuleRecovery({
      reload,
      storage,
      now: () => 50_000,
      prepareReload: async () => true,
      setTimer: (callback) => {
        callback()
        return 1
      },
    })

    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    event.payload = new Error('ChunkLoadError: Loading chunk 41 failed.')
    window.dispatchEvent(event)

    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(1))
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    const detail = (blocked.mock.calls[0]![0] as CustomEvent<SafeReloadBlockedDetail>).detail
    expect(detail).toEqual({
      reason: 'lazy-module',
      cause: 'recovery-storage-unavailable',
    })

    stop()
    window.removeEventListener(SAFE_RELOAD_BLOCKED_EVENT, blocked)
  })
})
