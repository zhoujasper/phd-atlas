import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, phdApi, type RealtimeInvalidationEvent } from '../../api/phdApi'
import {
  reportApiReachable,
  reportApiUnavailable,
  resetConnectivityForTests,
} from '../../connectivity'
import {
  realtimeInvalidationBatchDelayMs,
  useRealtimeUpdates,
} from './useRealtimeUpdates'

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  resetConnectivityForTests()
  reportApiReachable(80)
})

afterEach(() => {
  resetConnectivityForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRealtimeUpdates', () => {
  it('assigns 100 clients stable delays across the bounded refresh window', () => {
    const delays = Array.from({ length: 100 }, (_, index) => (
      realtimeInvalidationBatchDelayMs('stable-account-token', `client-${index}`)
    ))
    const eightyMillisecondBins = Array.from({ length: 6 }, () => 0)
    for (const delay of delays) {
      const bin = Math.min(5, Math.floor((delay - 120) / 81))
      eightyMillisecondBins[bin] += 1
    }

    expect(delays.every((delay) => delay >= 120 && delay <= 600)).toBe(true)
    expect(new Set(delays).size).toBeGreaterThan(80)
    expect(Math.max(...eightyMillisecondBins)).toBeLessThanOrEqual(25)
    expect(realtimeInvalidationBatchDelayMs('stable-account-token', 'client-42')).toBe(
      realtimeInvalidationBatchDelayMs('stable-account-token', 'client-42'),
    )
  })

  it('keeps one stream and batches a burst of scoped invalidations', async () => {
    let emit: ((event: RealtimeInvalidationEvent) => void) | null = null
    const stream = vi.spyOn(phdApi, 'streamRealtimeUpdates').mockImplementation((_token, onEvent, signal) => {
      emit = onEvent
      onEvent({
        type: 'connected',
        scopes: [],
        revision: 0,
        at: '2026-07-20T00:00:00.000Z',
      })
      return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
    })
    const onInvalidate = vi.fn()
    const { result, unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate,
      invalidationBatchDelayMs: 120,
    }))

    await waitFor(() => expect(result.current.connected).toBe(true))
    expect(stream).toHaveBeenCalledTimes(1)
    act(() => {
      emit?.({
        type: 'invalidate',
        scopes: ['applications'],
        revision: 1,
        at: '2026-07-20T00:00:01.000Z',
      })
      emit?.({
        type: 'invalidate',
        scopes: ['applications', 'teams'],
        revision: 2,
        at: '2026-07-20T00:00:01.010Z',
      })
    })

    await waitFor(() => expect(onInvalidate).toHaveBeenCalledTimes(1))
    expect([...onInvalidate.mock.calls[0][0]]).toEqual(['applications', 'teams'])
    unmount()
  })

  it('delivers a later stream event to the latest callback without reconnecting', async () => {
    let emit: ((event: RealtimeInvalidationEvent) => void) | null = null
    const stream = vi.spyOn(phdApi, 'streamRealtimeUpdates').mockImplementation(
      (_token, onEvent, signal) => {
        emit = onEvent
        return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      },
    )
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ onInvalidate }) => useRealtimeUpdates({
        token: 'realtime-token',
        enabled: true,
        onInvalidate,
        invalidationBatchDelayMs: 120,
      }),
      { initialProps: { onInvalidate: firstCallback } },
    )
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(1))

    rerender({ onInvalidate: secondCallback })
    act(() => {
      emit?.({
        type: 'invalidate',
        scopes: ['notifications'],
        revision: 1,
        at: '2026-07-20T00:00:01.000Z',
      })
    })

    await waitFor(() => expect(secondCallback).toHaveBeenCalledTimes(1))
    expect(firstCallback).not.toHaveBeenCalled()
    expect(stream).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does not let a suspended stream completion disconnect its replacement', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const attempts: Array<{
      emit: (event: RealtimeInvalidationEvent) => void
      resolve: () => void
      signal?: AbortSignal
    }> = []
    const stream = vi.spyOn(phdApi, 'streamRealtimeUpdates').mockImplementation(
      (_token, onEvent, signal) => new Promise<void>((resolve) => {
        attempts.push({ emit: onEvent, resolve, signal })
      }),
    )
    const { result, unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate: vi.fn(),
    }))

    await waitFor(() => expect(attempts).toHaveLength(1))
    act(() => {
      attempts[0].emit({
        type: 'connected',
        scopes: [],
        revision: 0,
        at: '2026-07-20T00:00:00.000Z',
      })
    })
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(attempts[0].signal?.aborted).toBe(true)
    await waitFor(() => expect(result.current.connected).toBe(false))

    act(() => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(attempts).toHaveLength(2))
    act(() => {
      attempts[1].emit({
        type: 'connected',
        scopes: [],
        revision: 1,
        at: '2026-07-20T00:00:01.000Z',
      })
    })
    await waitFor(() => expect(result.current.connected).toBe(true))

    await act(async () => {
      attempts[0].resolve()
      await Promise.resolve()
    })

    expect(result.current.connected).toBe(true)
    expect(stream).toHaveBeenCalledTimes(2)
    unmount()
    attempts[1].resolve()
  })

  it('defers pending invalidations while hidden and ignores events from a stale stream', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const attempts: Array<{
      emit: (event: RealtimeInvalidationEvent) => void
      resolve: () => void
    }> = []
    vi.spyOn(phdApi, 'streamRealtimeUpdates').mockImplementation(
      (_token, onEvent) => new Promise<void>((resolve) => {
        attempts.push({ emit: onEvent, resolve })
      }),
    )
    const onInvalidate = vi.fn()
    const { unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate,
      invalidationBatchDelayMs: 0,
    }))
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      attempts[0].emit({
        type: 'invalidate',
        scopes: ['applications'],
        revision: 1,
        at: '2026-07-20T00:00:01.000Z',
      })
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(onInvalidate).not.toHaveBeenCalled()

    act(() => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(attempts).toHaveLength(2)

    act(() => {
      attempts[0].emit({
        type: 'invalidate',
        scopes: ['teams'],
        revision: 2,
        at: '2026-07-20T00:00:02.000Z',
      })
    })
    await vi.advanceTimersByTimeAsync(120)

    expect(onInvalidate).toHaveBeenCalledTimes(1)
    expect([...onInvalidate.mock.calls[0][0]]).toEqual(['applications'])
    unmount()
    attempts.forEach((attempt) => attempt.resolve())
  })

  it('aborts without scheduling a stream retry while the API circuit is open', async () => {
    const attempts: AbortSignal[] = []
    vi.spyOn(phdApi, 'streamRealtimeUpdates').mockImplementation(
      (_token, _onEvent, signal) => new Promise<void>((resolve) => {
        if (signal) {
          attempts.push(signal)
          signal.addEventListener('abort', () => resolve(), { once: true })
        }
      }),
    )
    const { unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate: vi.fn(),
    }))
    await waitFor(() => expect(attempts).toHaveLength(1))

    act(() => {
      reportApiUnavailable()
    })
    expect(attempts[0]?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts).toHaveLength(1)

    act(() => {
      reportApiReachable(80)
    })
    await waitFor(() => expect(attempts).toHaveLength(2))
    unmount()
  })

  it('does not reconnect before a SERVER_BUSY retry-after floor', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const busy = new ApiError('Server busy.', 'SERVER_BUSY', 503)
    busy.retryAfterMs = 2_500
    const stream = vi.spyOn(phdApi, 'streamRealtimeUpdates')
      .mockRejectedValueOnce(busy)
      .mockImplementation((_token, _onEvent, signal) => (
        new Promise((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      ))
    const { unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate: vi.fn(),
    }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(stream).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499)
    })
    expect(stream).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(stream).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('keeps the ordinary jittered reconnect delay without retry-after', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const stream = vi.spyOn(phdApi, 'streamRealtimeUpdates')
      .mockResolvedValueOnce(undefined)
      .mockImplementation((_token, _onEvent, signal) => (
        new Promise((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      ))
    const { unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate: vi.fn(),
    }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(stream).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(849)
    })
    expect(stream).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(stream).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('cancels a retry-after reconnect when the hook unmounts', async () => {
    vi.useFakeTimers()
    const busy = new ApiError('Rate limited.', 'RATE_LIMITED', 429)
    busy.retryAfterMs = 3_000
    const stream = vi.spyOn(phdApi, 'streamRealtimeUpdates').mockRejectedValue(busy)
    const { unmount } = renderHook(() => useRealtimeUpdates({
      token: 'realtime-token',
      enabled: true,
      onInvalidate: vi.fn(),
    }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(stream).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(stream).toHaveBeenCalledTimes(1)
  })
})
