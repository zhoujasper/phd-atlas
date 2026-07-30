import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServiceWorkerUpdateChecks } from './serviceWorkerUpdateChecks'

let visibility: DocumentVisibilityState
let online: boolean

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'))
  visibility = 'visible'
  online = true
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startServiceWorkerUpdateChecks', () => {
  it('coalesces focus events behind a minimum network interval', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const stop = startServiceWorkerUpdateChecks(
      { update },
      { intervalMs: 15_000, minimumGapMs: 5_000 },
    )
    await act(async () => Promise.resolve())
    expect(update).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pageshow'))
    await act(async () => Promise.resolve())
    expect(update).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledTimes(2)
    stop()
  })

  it('never overlaps updates and resumes immediately after hidden/offline time', async () => {
    let releaseUpdate: (() => void) | undefined
    const update = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseUpdate = resolve
      }))
      .mockResolvedValue(undefined)
    const stop = startServiceWorkerUpdateChecks(
      { update },
      { intervalMs: 10_000, minimumGapMs: 1_000 },
    )
    expect(update).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(update).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseUpdate?.()
      await Promise.resolve()
    })
    visibility = 'hidden'
    online = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('offline'))
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(update).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledTimes(2)
    stop()
  })

  it('removes every listener and timer when stopped', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const stop = startServiceWorkerUpdateChecks(
      { update },
      { intervalMs: 1_000, minimumGapMs: 0 },
    )
    stop()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledTimes(1)
  })
})
