import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRecoverableModuleLoader,
  installLazyModuleRecovery,
  isLazyModuleLoadFailure,
  loadLazyModule,
} from './lazyModuleRecovery'

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

  it('reloads once for a stale Vite preload and suppresses refresh loops', () => {
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
    const stop = installLazyModuleRecovery({ reload, setTimer, storage, now: () => 50_000 })

    const firstEvent = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    firstEvent.payload = new TypeError('Failed to fetch dynamically imported module: /assets/ProfileScreen.js')
    window.dispatchEvent(firstEvent)

    const repeatedEvent = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
    repeatedEvent.payload = firstEvent.payload
    window.dispatchEvent(repeatedEvent)

    expect(firstEvent.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(setTimer).toHaveBeenCalledTimes(1)
    stop()
  })
})
