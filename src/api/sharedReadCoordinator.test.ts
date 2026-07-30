import { describe, expect, it, vi } from 'vitest'
import { SharedReadCoordinator, SharedReadInvalidatedError } from './sharedReadCoordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('SharedReadCoordinator', () => {
  it('coalesces identical reads and releases the entry after settlement', async () => {
    const coordinator = new SharedReadCoordinator()
    const result = deferred<number>()
    const start = vi.fn(() => result.promise)

    const first = coordinator.run('session:read', start)
    const second = coordinator.run('session:read', start)
    await Promise.resolve()

    expect(start).toHaveBeenCalledTimes(1)
    result.resolve(42)
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42])

    const third = coordinator.run('session:read', async () => 43)
    await expect(third).resolves.toBe(43)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('cancels one subscriber without interrupting another subscriber', async () => {
    const coordinator = new SharedReadCoordinator()
    const result = deferred<string>()
    let sharedSignal: AbortSignal | undefined
    const start = vi.fn((signal: AbortSignal) => {
      sharedSignal = signal
      return result.promise
    })
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = coordinator.run('shared', start, firstController.signal)
    const second = coordinator.run('shared', start, secondController.signal)
    await Promise.resolve()
    firstController.abort()

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(sharedSignal?.aborted).toBe(false)

    result.resolve('ready')
    await expect(second).resolves.toBe('ready')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('observes cancellation triggered synchronously while the shared read starts', async () => {
    const coordinator = new SharedReadCoordinator()
    const subscriber = new AbortController()
    const result = coordinator.run('applications', async () => {
      subscriber.abort()
      return ['stale']
    }, subscriber.signal)

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts the transport after the final subscriber leaves and lets a later read restart', async () => {
    const coordinator = new SharedReadCoordinator()
    const sharedSignals: AbortSignal[] = []
    const start = vi.fn((signal: AbortSignal) => {
      sharedSignals.push(signal)
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = coordinator.run('shared', start, firstController.signal)
    const second = coordinator.run('shared', start, secondController.signal)
    await Promise.resolve()
    firstController.abort()
    secondController.abort()

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(sharedSignals[0]?.aborted).toBe(true)

    const thirdController = new AbortController()
    const third = coordinator.run('shared', start, thirdController.signal)
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(2)
    thirdController.abort()
    await expect(third).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('invalidates only matching request partitions', async () => {
    const coordinator = new SharedReadCoordinator()
    const signals = new Map<string, AbortSignal>()
    const start = (key: string) => (signal: AbortSignal) => {
      signals.set(key, signal)
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }

    const first = coordinator.run('g1:user-a:read', start('a'))
    const secondController = new AbortController()
    const second = coordinator.run('g1:user-b:read', start('b'), secondController.signal)
    await Promise.resolve()
    coordinator.invalidatePrefix('g1:user-a:')

    await expect(first).rejects.toBeInstanceOf(SharedReadInvalidatedError)
    expect(signals.get('a')?.aborted).toBe(true)
    expect(signals.get('a')?.reason).toBeInstanceOf(SharedReadInvalidatedError)
    expect(signals.get('b')?.aborted).toBe(false)

    secondController.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
  })
})
