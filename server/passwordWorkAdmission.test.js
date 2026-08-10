import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createMutationAdmissionController } from './runtimeResilience.js'
import {
  createSharedPasswordWorkCoordinator,
  runPasswordWorkWithAdmission,
} from './passwordWorkAdmission.js'

function transport() {
  const request = new EventEmitter()
  const response = new EventEmitter()
  request.destroyed = false
  response.destroyed = false
  response.writableEnded = false
  return { request, response }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('password native-work admission lifecycle', () => {
  it('keeps the slot and reservation until uncancellable work settles after disconnect', async () => {
    const admission = createMutationAdmissionController({ maxActive: 1, maxQueued: 1 })
    const { request, response } = transport()
    const work = deferred()
    const releaseMemory = vi.fn()

    const running = runPasswordWorkWithAdmission({
      admission,
      request,
      response,
      acquireMemoryReservation: () => releaseMemory,
      onCapacityExceeded: vi.fn(),
      work: () => work.promise,
    })
    await vi.waitFor(() => expect(admission.snapshot().active).toBe(1))

    response.destroyed = true
    response.emit('close')
    expect(admission.snapshot().active).toBe(1)
    expect(releaseMemory).not.toHaveBeenCalled()

    work.resolve('done')
    await expect(running).resolves.toEqual({ admitted: true, value: 'done' })
    expect(admission.snapshot().active).toBe(0)
    expect(releaseMemory).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued request on disconnect without starting password work', async () => {
    const admission = createMutationAdmissionController({ maxActive: 1, maxQueued: 1 })
    const firstRelease = await admission.acquire()
    const { request, response } = transport()
    const work = vi.fn()
    const running = runPasswordWorkWithAdmission({
      admission,
      request,
      response,
      acquireMemoryReservation: vi.fn(),
      onCapacityExceeded: vi.fn(),
      work,
    })
    await vi.waitFor(() => expect(admission.snapshot().waiting).toBe(1))

    request.destroyed = true
    request.emit('aborted')
    await expect(running).resolves.toEqual({ admitted: false, reason: 'cancelled' })
    expect(work).not.toHaveBeenCalled()
    firstRelease()
    expect(admission.snapshot()).toMatchObject({ active: 0, waiting: 0 })
  })

  it('releases the slot when the memory boundary refuses work', async () => {
    const admission = createMutationAdmissionController({ maxActive: 1, maxQueued: 1 })
    const { request, response } = transport()
    const work = vi.fn()
    await expect(runPasswordWorkWithAdmission({
      admission,
      request,
      response,
      reservationBytes: 68 * 1024 * 1024,
      acquireMemoryReservation: (bytes) => {
        expect(bytes).toBe(68 * 1024 * 1024)
        return null
      },
      onCapacityExceeded: vi.fn(),
      work,
    })).resolves.toEqual({ admitted: false, reason: 'memory' })
    expect(work).not.toHaveBeenCalled()
    expect(admission.snapshot().active).toBe(0)
  })

  it('releases both owners when password work rejects', async () => {
    const admission = createMutationAdmissionController({ maxActive: 1, maxQueued: 1 })
    const { request, response } = transport()
    const releaseMemory = vi.fn()
    await expect(runPasswordWorkWithAdmission({
      admission,
      request,
      response,
      acquireMemoryReservation: () => releaseMemory,
      onCapacityExceeded: vi.fn(),
      work: async () => { throw new Error('native failure') },
    })).rejects.toThrow('native failure')
    expect(releaseMemory).toHaveBeenCalledTimes(1)
    expect(admission.snapshot().active).toBe(0)
  })

  it('shares a 100-client identical burst before admission and never caches the result', async () => {
    const admission = createMutationAdmissionController({ maxActive: 1, maxQueued: 4 })
    const workGate = deferred()
    const releaseMemory = vi.fn()
    const execute = vi.fn(() => workGate.promise)
    const run = createSharedPasswordWorkCoordinator({
      admission,
      acquireMemoryReservation: () => ({
        allowed: true,
        release: releaseMemory,
      }),
      execute,
    })

    const burst = Array.from({ length: 100 }, () => run('same-key', {
      payload: { password: 'shared' },
      reservationBytes: 24 * 1024 * 1024,
    }))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(admission.snapshot()).toMatchObject({ active: 1, waiting: 0 })

    workGate.resolve({ valid: true, needsRehash: false })
    const results = await Promise.all(burst)
    expect(results).toHaveLength(100)
    expect(results.every((result) => result.admitted && result.value.valid)).toBe(true)
    expect(releaseMemory).toHaveBeenCalledTimes(1)
    expect(admission.snapshot()).toMatchObject({ active: 0, waiting: 0 })

    await expect(run('same-key', { payload: { password: 'shared' } })).resolves.toEqual({
      admitted: true,
      value: { valid: true, needsRehash: false },
    })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(releaseMemory).toHaveBeenCalledTimes(2)
  })

  it('cancels shared queueing only after the last subscriber disconnects', async () => {
    const admission = createMutationAdmissionController({ maxActive: 1, maxQueued: 2 })
    const activeRelease = await admission.acquire()
    const execute = vi.fn()
    const run = createSharedPasswordWorkCoordinator({
      admission,
      acquireMemoryReservation: vi.fn(),
      execute,
    })
    const first = new AbortController()
    const second = new AbortController()
    const firstResult = run('same-key', { signal: first.signal })
    const secondResult = run('same-key', { signal: second.signal })
    await vi.waitFor(() => expect(admission.snapshot().waiting).toBe(1))

    first.abort()
    await expect(firstResult).resolves.toEqual({ admitted: false, reason: 'closed' })
    expect(admission.snapshot().waiting).toBe(1)

    second.abort()
    await expect(secondResult).resolves.toEqual({ admitted: false, reason: 'closed' })
    await vi.waitFor(() => expect(admission.snapshot().waiting).toBe(0))
    expect(execute).not.toHaveBeenCalled()
    activeRelease()
  })
})
