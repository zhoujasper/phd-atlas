import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { phdApi, type RealtimeInvalidationEvent } from '../../api/phdApi'
import { useRealtimeUpdates } from './useRealtimeUpdates'

afterEach(() => {
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
})
