import { describe, expect, it, vi } from 'vitest'
import { AbortDeadlineError, withAbortDeadline } from './abortDeadline.js'

describe('withAbortDeadline', () => {
  it('returns normal results and clears the deadline timer', async () => {
    vi.useFakeTimers()
    const operation = vi.fn(async (signal) => {
      expect(signal.aborted).toBe(false)
      return 'ready'
    })

    await expect(withAbortDeadline(operation, { timeoutMs: 500 })).resolves.toBe('ready')
    await vi.advanceTimersByTimeAsync(500)
    expect(operation).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('aborts slow work and reports an explicit deadline error', async () => {
    vi.useFakeTimers()
    let operationSignal
    const result = withAbortDeadline(
      (signal) => {
        operationSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
      { timeoutMs: 250 },
    )
    const assertion = expect(result).rejects.toMatchObject({
      name: 'AbortDeadlineError',
      code: 'ABORT_DEADLINE_EXCEEDED',
      timeoutMs: 250,
    })

    await vi.advanceTimersByTimeAsync(250)
    await assertion
    expect(operationSignal.aborted).toBe(true)
    vi.useRealTimers()
  })

  it('enforces the deadline even when an upstream ignores cancellation', async () => {
    vi.useFakeTimers()
    const result = withAbortDeadline(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 5_000)),
      { timeoutMs: 200 },
    )
    const assertion = expect(result).rejects.toBeInstanceOf(AbortDeadlineError)

    await vi.advanceTimersByTimeAsync(200)
    await assertion
    vi.useRealTimers()
  })

  it('preserves parent cancellation instead of misreporting a timeout', async () => {
    const controller = new AbortController()
    const cancellation = new Error('request owner disconnected')
    const result = withAbortDeadline(
      (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
      { signal: controller.signal, timeoutMs: 5_000 },
    )

    controller.abort(cancellation)

    await expect(result).rejects.toBe(cancellation)
    await expect(result).rejects.not.toBeInstanceOf(AbortDeadlineError)
  })

  it('keeps the first parent-cancellation cause even when work settles after the deadline', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const cancellation = new Error('client disconnected first')
    let rejectOperation
    const result = withAbortDeadline(
      () => new Promise((_resolve, reject) => {
        rejectOperation = reject
      }),
      { signal: controller.signal, timeoutMs: 100 },
    )
    const assertion = expect(result).rejects.toBe(cancellation)

    controller.abort(cancellation)
    await vi.advanceTimersByTimeAsync(500)
    rejectOperation(new Error('transport eventually stopped'))

    await assertion
    vi.useRealTimers()
  })

  it('does not arm a timer for an absent or non-positive deadline', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    await expect(withAbortDeadline(async () => 'none')).resolves.toBe('none')
    await expect(withAbortDeadline(async () => 'zero', { timeoutMs: 0 })).resolves.toBe('zero')

    expect(timeoutSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })
})
