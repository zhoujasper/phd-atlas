import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startNonOverlappingRecurringTask } from './recurringTask.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startNonOverlappingRecurringTask', () => {
  it('skips interval ticks while a slow run is still active', async () => {
    let releaseFirst
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = resolve
      }))
      .mockResolvedValue(undefined)
    const task = startNonOverlappingRecurringTask({ intervalMs: 1_000, run })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(task.isRunning()).toBe(true)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)

    releaseFirst()
    await Promise.resolve()
    await Promise.resolve()
    expect(task.isRunning()).toBe(false)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(2)
    task.stop()
  })

  it('reports a failed run and continues on the next interval', async () => {
    const failure = new Error('mail provider unavailable')
    const run = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const onError = vi.fn()
    const task = startNonOverlappingRecurringTask({
      intervalMs: 500,
      run,
      onError,
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(onError).toHaveBeenCalledWith(failure)
    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(2)
    task.stop()
  })

  it('contains failures thrown by the error reporter itself', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('task failed'))
      .mockResolvedValue(undefined)
    const task = startNonOverlappingRecurringTask({
      intervalMs: 500,
      run,
      onError: () => {
        throw new Error('logger failed')
      },
    })

    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(2)
    task.stop()
  })

  it('clears its interval and refuses manual work after stop', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const task = startNonOverlappingRecurringTask({ intervalMs: 250, run })

    task.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).not.toHaveBeenCalled()
    await expect(task.runNow()).resolves.toBe(false)
  })

  it('stops future ticks and waits for an active run during graceful shutdown', async () => {
    let release
    const run = vi.fn(() => new Promise((resolve) => {
      release = resolve
    }))
    const task = startNonOverlappingRecurringTask({ intervalMs: 250, run })
    await vi.advanceTimersByTimeAsync(250)

    const stopped = task.stopAndWait()
    let settled = false
    void stopped.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await stopped
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledOnce()
  })
})
