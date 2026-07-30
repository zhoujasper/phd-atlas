import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deadlineRemainingSeconds, useDeadlineCountdown } from './useDeadlineCountdown'

let visibility: DocumentVisibilityState

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'))
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useDeadlineCountdown', () => {
  it('derives seconds from the wall clock and updates once per displayed second', async () => {
    const deadlineAt = Date.now() + 3_000
    const { result } = renderHook(() => useDeadlineCountdown(deadlineAt))
    expect(result.current).toBe(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001)
    })
    expect(result.current).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001)
    })
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sleeps while hidden and catches up immediately on resume', async () => {
    const deadlineAt = Date.now() + 60_000
    const { result } = renderHook(() => useDeadlineCountdown(deadlineAt))
    expect(result.current).toBe(60)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current).toBe(60)

    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await vi.advanceTimersToNextTimerAsync()
    })
    expect(result.current).toBe(30)
  })

  it('handles invalid and elapsed deadlines without scheduling work', () => {
    expect(deadlineRemainingSeconds(null)).toBe(0)
    expect(deadlineRemainingSeconds(Date.now() - 1)).toBe(0)
    const { result } = renderHook(() => useDeadlineCountdown('not-a-date'))
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
