import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { phdApi, type RealtimeInvalidationEvent } from '../../api/phdApi'
import {
  reportApiReachable,
  reportApiUnavailable,
  resetConnectivityForTests,
} from '../../connectivity'
import { useRealtimeUpdates } from './useRealtimeUpdates'

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
})
