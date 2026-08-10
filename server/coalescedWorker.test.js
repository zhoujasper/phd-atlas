import { describe, expect, it, vi } from 'vitest'
import {
  COALESCED_WORKER_STOPPED,
  createCoalescedWorker,
} from './coalescedWorker.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitForCalls(mock, count) {
  for (let index = 0; index < 20 && mock.mock.calls.length < count; index += 1) {
    await Promise.resolve()
  }
  expect(mock).toHaveBeenCalledTimes(count)
}

describe('createCoalescedWorker', () => {
  it('collapses 100 wakes during one active drain into exactly one rerun', async () => {
    const first = deferred()
    const drain = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined)
    const worker = createCoalescedWorker({ name: 'mail-sync', drain })

    const active = worker.kick()
    await waitForCalls(drain, 1)
    const wakePromises = Array.from({ length: 100 }, () => worker.kick())

    expect(wakePromises.every((promise) => promise === active)).toBe(true)
    first.resolve()
    await active

    expect(drain).toHaveBeenCalledTimes(2)
    expect(worker.snapshot()).toMatchObject({
      state: 'idle',
      active: false,
      rerunRequested: false,
      kickCount: 101,
      coalescedKickCount: 100,
      drainCount: 2,
    })
  })

  it('does not lose a wake racing with completion of the active drain', async () => {
    const first = deferred()
    const drain = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined)
    const worker = createCoalescedWorker({ drain })

    const active = worker.kick()
    await waitForCalls(drain, 1)
    first.resolve()
    const raced = worker.kick()

    expect(raced).toBe(active)
    await active
    expect(drain).toHaveBeenCalledTimes(2)
  })

  it('atomically hands off a wake in the final promise-reaction gap', async () => {
    const finishing = deferred()
    const drain = vi.fn()
      .mockImplementationOnce(() => finishing.promise)
      .mockResolvedValue(undefined)
    const worker = createCoalescedWorker({ drain })

    const firstOwner = worker.kick()
    await waitForCalls(drain, 1)

    // The worker's await reaction was registered first. This reaction therefore
    // runs after the final drain has decided to return but, in the old design,
    // before an outer Promise.finally released active ownership.
    let handoffOwner
    const finishingGapWake = finishing.promise.then(() => {
      handoffOwner = worker.kick()
    })
    finishing.resolve()

    await finishingGapWake
    await Promise.all([firstOwner, handoffOwner])
    expect(handoffOwner).not.toBe(firstOwner)
    expect(drain).toHaveBeenCalledTimes(2)
    expect(worker.snapshot()).toMatchObject({
      state: 'idle',
      active: false,
      drainCount: 2,
      kickCount: 2,
    })
  })

  it('allows a wake during the second drain to request a third round', async () => {
    const first = deferred()
    const second = deferred()
    const drain = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValue(undefined)
    const worker = createCoalescedWorker({ drain })

    const active = worker.kick()
    await waitForCalls(drain, 1)
    worker.kick()
    first.resolve()
    await waitForCalls(drain, 2)
    worker.kick()
    second.resolve()
    await active

    expect(drain).toHaveBeenCalledTimes(3)
  })

  it('contains drain and error-reporter failures and recovers on a rerun', async () => {
    const failure = new Error('temporary provider failure')
    const reporterFailure = new Error('logger unavailable')
    let worker
    const drain = vi.fn()
      .mockImplementationOnce(() => {
        worker.kick()
        throw failure
      })
      .mockResolvedValue(undefined)
    const onError = vi.fn().mockRejectedValue(reporterFailure)
    worker = createCoalescedWorker({ drain, onError })

    await expect(worker.kick()).resolves.toBeUndefined()

    expect(drain).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(worker.snapshot()).toMatchObject({
      state: 'idle',
      errorCount: 1,
      errorReporterErrorCount: 1,
      drainCount: 2,
      lastError: {
        name: 'Error',
        message: 'temporary provider failure',
      },
    })
  })

  it('stops idempotently, drains an accepted rerun, and rejects late kicks', async () => {
    const first = deferred()
    const second = deferred()
    const drain = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const worker = createCoalescedWorker({ name: 'persisted-mail', drain })

    worker.kick()
    await waitForCalls(drain, 1)
    worker.kick()
    const stopped = worker.stopAndWait()
    expect(worker.stopAndWait()).toBe(stopped)
    expect(worker.snapshot().state).toBe('stopping')

    const lateKick = worker.kick()
    await expect(lateKick).rejects.toMatchObject({
      name: 'CoalescedWorkerStoppedError',
      code: COALESCED_WORKER_STOPPED,
    })

    first.resolve()
    await waitForCalls(drain, 2)
    let stopSettled = false
    void stopped.then(() => { stopSettled = true })
    await Promise.resolve()
    expect(stopSettled).toBe(false)

    second.resolve()
    await stopped
    expect(drain).toHaveBeenCalledTimes(2)
    expect(worker.snapshot()).toMatchObject({
      state: 'stopped',
      acceptingKicks: false,
      active: false,
      rejectedKickCount: 1,
    })
  })

  it('can be stopped before its first kick', async () => {
    const drain = vi.fn()
    const worker = createCoalescedWorker({ drain })

    const stopped = worker.stopAndWait()
    await expect(stopped).resolves.toBeUndefined()
    expect(worker.stopAndWait()).toBe(stopped)
    await expect(worker.kick()).rejects.toMatchObject({
      code: COALESCED_WORKER_STOPPED,
    })
    expect(drain).not.toHaveBeenCalled()
    expect(worker.snapshot().state).toBe('stopped')
  })
})
