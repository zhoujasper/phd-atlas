import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createStreamAdmissionController,
  StreamAdmissionError,
} from './streamAdmission.js'

function memoryLedger({ reject = false } = {}) {
  let active = 0
  let released = 0
  const acquisitions = []
  return {
    acquisitions,
    get active() {
      return active
    },
    get released() {
      return released
    },
    acquire(workClass, bytes) {
      acquisitions.push({ workClass, bytes })
      if (reject) {
        return {
          allowed: false,
          decision: { level: 'soft', retryAfterMs: 1_250 },
        }
      }
      active += 1
      let done = false
      return {
        allowed: true,
        release() {
          if (done) return
          done = true
          active -= 1
          released += 1
        },
      }
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('stream admission', () => {
  it('bounds global and per-principal streams while reserving only active buffers', async () => {
    const ledger = memoryLedger()
    const controller = createStreamAdmissionController({
      maxActive: 2,
      maxQueued: 2,
      maxActivePerKey: 1,
      maxQueuedPerKey: 1,
      bufferReservationBytes: 256 * 1024,
      memoryReservationLedger: ledger,
    })

    const first = await controller.acquire({ key: 'person-a' })
    const second = await controller.acquire({ key: 'person-b' })
    await expect(controller.acquire({ key: 'person-a' })).rejects.toMatchObject({
      code: 'SERVER_BUSY',
      reason: 'per-key-active',
    })
    const queuedThird = controller.acquire({ key: 'person-c' })
    const queuedFourth = controller.acquire({ key: 'person-d' })
    await expect(controller.acquire({ key: 'person-e' })).rejects.toMatchObject({
      code: 'SERVER_BUSY',
      reason: 'queue-full',
    })

    expect(controller.snapshot()).toMatchObject({
      active: 2,
      waiting: 2,
      activeLeases: 2,
      reservedBytes: 512 * 1024,
    })
    expect(ledger.acquisitions).toEqual([
      { workClass: 'heavy', bytes: 256 * 1024 },
      { workClass: 'heavy', bytes: 256 * 1024 },
    ])

    first.release()
    const third = await queuedThird
    expect(controller.snapshot()).toMatchObject({ active: 2, waiting: 1, activeLeases: 2 })
    expect(ledger.acquisitions).toHaveLength(3)

    second.release()
    const fourth = await queuedFourth
    third.release()
    fourth.release()
    expect(controller.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeLeases: 0,
      reservedBytes: 0,
    })
    expect(ledger.active).toBe(0)
    expect(ledger.released).toBe(4)
  })

  it('uses a progress idle timeout instead of an absolute stream lifetime', async () => {
    vi.useFakeTimers()
    const controller = createStreamAdmissionController({
      maxActive: 1,
      idleTimeoutMs: 30_000,
      bufferReservationBytes: 64 * 1024,
    })
    const lease = await controller.acquire({ key: 'person-a' })
    const resource = { destroyed: false, destroy: vi.fn() }
    lease.bind(resource)

    for (let interval = 0; interval < 4; interval += 1) {
      await vi.advanceTimersByTimeAsync(20_000)
      expect(lease.signal.aborted).toBe(false)
      expect(lease.markProgress(1_024)).toBe(true)
    }
    expect(lease.transferredBytes).toBe(4_096)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(lease.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(lease.signal.aborted).toBe(true)
    expect(lease.signal.reason).toMatchObject({ code: 'STREAM_IDLE_TIMEOUT' })
    expect(resource.destroy).toHaveBeenCalledTimes(1)

    lease.release()
    expect(controller.snapshot()).toMatchObject({
      active: 0,
      activeLeases: 0,
      reservedBytes: 0,
      counters: { idleTimedOut: 1, bytesProgressed: 4_096 },
    })
  })

  it('releases the concurrency slot when the memory ledger rejects a buffer reservation', async () => {
    const ledger = memoryLedger({ reject: true })
    const controller = createStreamAdmissionController({
      maxActive: 1,
      memoryReservationLedger: ledger,
    })

    await expect(controller.acquire({ key: 'person-a' })).rejects.toMatchObject({
      name: 'StreamAdmissionError',
      code: 'SERVER_BUSY',
      reason: 'memory-pressure',
      retryAfterMs: 1_250,
      decision: { level: 'soft' },
    })
    expect(controller.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeLeases: 0,
      counters: { memoryRejected: 1 },
    })
  })

  it('supports a per-stream memory class without weakening the controller default', async () => {
    const ledger = memoryLedger()
    const controller = createStreamAdmissionController({
      maxActive: 2,
      bufferReservationBytes: 64 * 1024,
      memoryReservationLedger: ledger,
    })

    const boundedSectional = await controller.acquire({
      key: 'sectional-workspace',
      memoryWorkClass: 'standard',
    })
    const ordinaryDownload = await controller.acquire({ key: 'download' })
    expect(ledger.acquisitions).toEqual([
      { workClass: 'standard', bytes: 64 * 1024 },
      { workClass: 'heavy', bytes: 64 * 1024 },
    ])
    boundedSectional.release()
    ordinaryDownload.release()
    expect(ledger.active).toBe(0)
  })

  it('cancels queued and active streams during caller abort and shutdown', async () => {
    const controller = createStreamAdmissionController({ maxActive: 1, maxQueued: 1 })
    const first = await controller.acquire({ key: 'person-a' })
    const waitingController = new AbortController()
    const waiting = controller.acquire({ key: 'person-b', signal: waitingController.signal })
    waitingController.abort(new Error('client disconnected'))
    await expect(waiting).rejects.toBeInstanceOf(StreamAdmissionError)

    const resource = { destroyed: false, destroy: vi.fn() }
    first.bind(resource)
    controller.close(new Error('server shutdown'))
    expect(first.signal.aborted).toBe(true)
    expect(resource.destroy).toHaveBeenCalledTimes(1)
    first.release()
    expect(controller.snapshot()).toMatchObject({
      active: 0,
      waiting: 0,
      activeLeases: 0,
      closed: true,
    })
  })
})
