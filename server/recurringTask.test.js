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
    await task.whenIdle()
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

  it('passes one lifecycle signal to a run and aborts it synchronously on stop', async () => {
    let receivedSignal
    const run = vi.fn((signal) => {
      receivedSignal = signal
      return new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    })
    const task = startNonOverlappingRecurringTask({ intervalMs: 250, run })
    const active = task.runNow()
    await Promise.resolve()

    const reason = new Error('server stopping')
    task.stop(reason)

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal.aborted).toBe(true)
    expect(receivedSignal.reason).toBe(reason)
    await expect(active).resolves.toBe(true)
    expect(task.isRunning()).toBe(false)
  })

  it('forwards a caller signal without allowing it to cancel the task promise', async () => {
    const caller = new AbortController()
    let release
    let receivedSignal
    const run = vi.fn((signal) => {
      receivedSignal = signal
      return new Promise((resolve) => { release = resolve })
    })
    const task = startNonOverlappingRecurringTask({ intervalMs: 250, run })
    const active = task.runNow({ signal: caller.signal })
    await Promise.resolve()

    caller.abort(new Error('caller left'))
    expect(receivedSignal.aborted).toBe(true)
    expect(task.isRunning()).toBe(true)

    let idle = false
    void task.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)

    release()
    await expect(active).resolves.toBe(true)
    await task.whenIdle()
    task.stop()
  })

  it('does not report a completed shutdown until an in-progress commit settles', async () => {
    let startCommit
    let finishCommit
    let commitStarted = false
    const run = vi.fn(async (signal) => {
      await new Promise((resolve) => { startCommit = resolve })
      commitStarted = true
      await new Promise((resolve) => { finishCommit = resolve })
      return signal.aborted ? 'committed-after-stop' : 'committed'
    })
    const task = startNonOverlappingRecurringTask({ intervalMs: 250, run })
    const active = task.runNow()
    await Promise.resolve()
    startCommit()
    await Promise.resolve()
    expect(commitStarted).toBe(true)

    const stopped = task.stopAndWait(new Error('deadline approaching'))
    let settled = false
    void stopped.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(task.isRunning()).toBe(true)

    finishCommit()
    await expect(active).resolves.toBe(true)
    await stopped
    expect(task.isRunning()).toBe(false)
  })
})
