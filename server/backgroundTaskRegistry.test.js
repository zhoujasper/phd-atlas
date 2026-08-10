import { describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_TASK_REGISTRY_STOPPED,
  createBackgroundTaskRegistry,
} from './backgroundTaskRegistry.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('createBackgroundTaskRegistry', () => {
  it('tracks accepted detached work by name until it really settles', async () => {
    const first = deferred()
    const second = deferred()
    const registry = createBackgroundTaskRegistry({ name: 'server-background' })

    const firstRun = registry.track('system-mail', () => first.promise)
    const secondRun = registry.track('system-mail', () => second.promise)
    expect(registry.snapshot()).toMatchObject({
      accepting: true,
      active: 2,
      pending: [{ name: 'system-mail', count: 2 }],
    })

    first.resolve('first')
    await expect(firstRun).resolves.toBe('first')
    expect(registry.pending()).toEqual([{ name: 'system-mail', count: 1 }])

    second.resolve('second')
    await expect(secondRun).resolves.toBe('second')
    await registry.whenIdle()
    expect(registry.snapshot().active).toBe(0)
  })

  it('aborts cooperatively but never reports idle before a commit settles', async () => {
    const commit = deferred()
    let receivedSignal
    const registry = createBackgroundTaskRegistry()
    registry.track('durable-commit', async (signal) => {
      receivedSignal = signal
      await commit.promise
    })
    await Promise.resolve()

    const reason = new Error('shutdown')
    const stopping = registry.stopAndWait(reason)
    expect(receivedSignal.aborted).toBe(true)
    expect(receivedSignal.reason).toBe(reason)
    expect(registry.snapshot()).toMatchObject({ accepting: false, active: 1 })

    let settled = false
    void stopping.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    commit.resolve()
    await stopping
    expect(registry.snapshot().active).toBe(0)
  })

  it('rejects late work with one stable observed error', async () => {
    const registry = createBackgroundTaskRegistry({ name: 'stopped-registry' })
    registry.stop()
    const work = vi.fn()

    await expect(registry.track('late', work)).rejects.toMatchObject({
      code: BACKGROUND_TASK_REGISTRY_STOPPED,
    })
    expect(work).not.toHaveBeenCalled()
    expect(registry.snapshot()).toMatchObject({
      accepting: false,
      active: 0,
      rejectedCount: 1,
    })
  })

  it('observes a detached rejection and removes it from the registry', async () => {
    const registry = createBackgroundTaskRegistry()
    const failure = new Error('provider failed after the response ended')
    const rejected = registry.track('detached-provider', async () => { throw failure })

    await expect(rejected).rejects.toBe(failure)
    await registry.whenIdle()
    expect(registry.pending()).toEqual([])
  })
})
