import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reportApiReachable,
  reportApiUnavailable,
  resetConnectivityForTests,
} from '../../connectivity'
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling'

let visibility: DocumentVisibilityState
let online: boolean

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  online = true
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  resetConnectivityForTests()
  reportApiReachable(80)
})

afterEach(() => {
  resetConnectivityForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVisibilityAwarePolling', () => {
  it('does not request in a hidden tab and refreshes immediately after visibility returns', async () => {
    visibility = 'hidden'
    const poll = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useVisibilityAwarePolling({
      enabled: true,
      initialDelayMs: 100,
      intervalMs: 1_000,
      poll,
    }))

    await advance(10_000)
    expect(poll).not.toHaveBeenCalled()

    visibility = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(poll).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(10_000)
    expect(poll).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('never overlaps a slow request and waits one interval after it settles', async () => {
    let resolveFirst: (() => void) | null = null
    const poll = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValue(undefined)

    renderHook(() => useVisibilityAwarePolling({
      enabled: true,
      intervalMs: 1_000,
      poll,
    }))

    await advance(0)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(5_000)
    expect(poll).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst?.()
      await Promise.resolve()
    })
    await advance(999)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('supports dynamic delays, finite completion, and explicit schedule restarts', async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce(250)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false)
    const { rerender } = renderHook(
      ({ restartKey }) => useVisibilityAwarePolling({
        enabled: true,
        intervalMs: 1_000,
        restartKey,
        poll,
      }),
      { initialProps: { restartKey: 'job-a' } },
    )

    await advance(0)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(249)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(poll).toHaveBeenCalledTimes(2)
    await advance(5_000)
    expect(poll).toHaveBeenCalledTimes(2)

    rerender({ restartKey: 'job-b' })
    await advance(0)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('pauses while offline and resumes without waiting for the old timer', async () => {
    const poll = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useVisibilityAwarePolling({
      enabled: true,
      initialDelayMs: 500,
      intervalMs: 2_000,
      poll,
    }))

    online = false
    window.dispatchEvent(new Event('offline'))
    await advance(5_000)
    expect(poll).not.toHaveBeenCalled()

    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('suspends network polling while the server circuit is open and resumes once', async () => {
    const poll = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useVisibilityAwarePolling({
      enabled: true,
      initialDelayMs: 500,
      intervalMs: 2_000,
      poll,
    }))

    act(() => {
      reportApiUnavailable()
    })
    await advance(5_000)
    expect(poll).not.toHaveBeenCalled()

    await act(async () => {
      reportApiReachable(80)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('aborts active transport work while suspended and resumes with a fresh signal', async () => {
    const signals: AbortSignal[] = []
    const poll = vi.fn((signal: AbortSignal): Promise<false | void> => {
      signals.push(signal)
      if (signals.length > 1) return Promise.resolve(false)
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const onError = vi.fn()

    renderHook(() => useVisibilityAwarePolling({
      enabled: true,
      intervalMs: 1_000,
      poll,
      onError,
    }))

    await advance(0)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(false)

    visibility = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(signals[0]?.aborted).toBe(true)
    expect(onError).not.toHaveBeenCalled()

    visibility = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(poll).toHaveBeenCalledTimes(2)
    expect(signals[1]).not.toBe(signals[0])
    expect(signals[1]?.aborted).toBe(false)
  })
})
