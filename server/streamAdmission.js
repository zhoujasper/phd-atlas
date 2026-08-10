import {
  createMutationAdmissionController,
  MutationAdmissionError,
} from './runtimeResilience.js'
import { MEMORY_WORK_CLASS } from './memoryPressure.js'

const DEFAULT_MAX_ACTIVE = 32
const DEFAULT_MAX_QUEUED = 256
const DEFAULT_MAX_ACTIVE_PER_KEY = 4
const DEFAULT_MAX_QUEUED_PER_KEY = 8
const DEFAULT_WAIT_TIMEOUT_MS = 15_000
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_BUFFER_RESERVATION_BYTES = 512 * 1024
const DEFAULT_RETRY_AFTER_MS = 1_000

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function streamAbortReason(signal, fallback) {
  return signal?.reason instanceof Error ? signal.reason : fallback
}

export class StreamAdmissionError extends Error {
  constructor(reason, {
    message = 'The server is handling many active downloads. Please retry shortly.',
    retryAfterMs = DEFAULT_RETRY_AFTER_MS,
    decision = null,
  } = {}) {
    super(message)
    this.name = 'StreamAdmissionError'
    this.reason = reason
    this.code = reason === 'cancelled' ? 'REQUEST_CANCELLED' : 'SERVER_BUSY'
    this.status = reason === 'cancelled' ? 499 : 503
    this.retryAfterMs = positiveInteger(retryAfterMs, DEFAULT_RETRY_AFTER_MS)
    this.decision = decision
  }
}

export class StreamIdleTimeoutError extends Error {
  constructor(idleTimeoutMs) {
    super(`The stream made no progress for ${idleTimeoutMs}ms.`)
    this.name = 'StreamIdleTimeoutError'
    this.code = 'STREAM_IDLE_TIMEOUT'
    this.status = 408
    this.idleTimeoutMs = idleTimeoutMs
  }
}

/**
 * Independent bounded admission for long-lived response streams.
 *
 * A lease owns one global/per-principal slot and one small memory-ledger
 * reservation. It has no absolute lifetime: each positive markProgress()
 * re-arms the idle timer, so a large but moving transfer may finish while a
 * stalled client is disconnected without occupying ordinary/heavy work slots.
 */
export function createStreamAdmissionController({
  maxActive = DEFAULT_MAX_ACTIVE,
  maxQueued = DEFAULT_MAX_QUEUED,
  maxActivePerKey = DEFAULT_MAX_ACTIVE_PER_KEY,
  maxQueuedPerKey = DEFAULT_MAX_QUEUED_PER_KEY,
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  bufferReservationBytes = DEFAULT_BUFFER_RESERVATION_BYTES,
  retryAfterMs = DEFAULT_RETRY_AFTER_MS,
  memoryReservationLedger = null,
  memoryWorkClass = MEMORY_WORK_CLASS.HEAVY,
  timers = globalThis,
  now = () => Date.now(),
} = {}) {
  const idleTimeout = positiveInteger(idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS)
  const defaultReservationBytes = positiveInteger(
    bufferReservationBytes,
    DEFAULT_BUFFER_RESERVATION_BYTES,
  )
  const retryDelay = positiveInteger(retryAfterMs, DEFAULT_RETRY_AFTER_MS)
  const admission = createMutationAdmissionController({
    maxActive,
    maxQueued,
    maxActivePerKey,
    maxQueuedPerKey,
    waitTimeoutMs,
    timers,
    now,
  })
  const activeLeases = new Set()
  const leaseAborters = new Map()
  let closed = false
  let reservedBytes = 0
  let peakReservedBytes = 0
  const counters = {
    admitted: 0,
    released: 0,
    memoryRejected: 0,
    idleTimedOut: 0,
    callerCancelled: 0,
    bytesProgressed: 0,
  }

  const acquire = async ({
    key = '',
    signal,
    reservationBytes = defaultReservationBytes,
    memoryWorkClass: requestedMemoryWorkClass = memoryWorkClass,
  } = {}) => {
    let releaseAdmission
    try {
      releaseAdmission = await admission.acquire({ key, signal })
    } catch (error) {
      if (error instanceof MutationAdmissionError) {
        throw new StreamAdmissionError(error.reason, {
          message: error.message,
          retryAfterMs: retryDelay,
        })
      }
      throw error
    }

    const bytes = positiveInteger(reservationBytes, defaultReservationBytes)
    let memoryReservation = null
    if (memoryReservationLedger) {
      try {
        memoryReservation = memoryReservationLedger.acquire(requestedMemoryWorkClass, bytes)
      } catch (error) {
        releaseAdmission()
        throw error
      }
      if (!memoryReservation?.allowed) {
        releaseAdmission()
        counters.memoryRejected += 1
        throw new StreamAdmissionError('memory-pressure', {
          message: 'The server is protecting active work from memory pressure. Please retry shortly.',
          retryAfterMs: memoryReservation?.decision?.retryAfterMs ?? retryDelay,
          decision: memoryReservation?.decision ?? null,
        })
      }
    }

    const controller = new AbortController()
    let idleTimer = null
    let released = false
    let lastProgressAt = now()
    let transferredBytes = 0
    const bindings = new Set()

    const clearIdleTimer = () => {
      if (idleTimer) timers.clearTimeout(idleTimer)
      idleTimer = null
    }
    const abortIdle = () => {
      idleTimer = null
      if (released || controller.signal.aborted) return
      counters.idleTimedOut += 1
      controller.abort(new StreamIdleTimeoutError(idleTimeout))
    }
    const armIdleTimer = () => {
      clearIdleTimer()
      if (released || controller.signal.aborted) return
      idleTimer = timers.setTimeout(abortIdle, idleTimeout)
      idleTimer?.unref?.()
    }
    const abortFromCaller = () => {
      if (released || controller.signal.aborted) return
      counters.callerCancelled += 1
      controller.abort(streamAbortReason(signal, new StreamAdmissionError('cancelled')))
    }
    signal?.addEventListener('abort', abortFromCaller, { once: true })
    if (signal?.aborted) abortFromCaller()
    if (controller.signal.aborted) {
      signal?.removeEventListener('abort', abortFromCaller)
      memoryReservation?.release?.()
      releaseAdmission()
      throw new StreamAdmissionError('cancelled')
    }

    const lease = {
      signal: controller.signal,
      reservationBytes: bytes,
      get lastProgressAt() {
        return lastProgressAt
      },
      get transferredBytes() {
        return transferredBytes
      },
      touchProgress() {
        if (released || controller.signal.aborted) return false
        lastProgressAt = now()
        armIdleTimer()
        return true
      },
      markProgress(byteCount = 1) {
        const progressBytes = Number(byteCount)
        if (released || controller.signal.aborted || !Number.isFinite(progressBytes) || progressBytes <= 0) {
          return false
        }
        transferredBytes += progressBytes
        counters.bytesProgressed += progressBytes
        return lease.touchProgress()
      },
      bind(...resources) {
        const owned = resources.filter((resource) => resource && typeof resource === 'object')
        if (owned.length === 0) return () => undefined
        const destroy = () => {
          const reason = streamAbortReason(controller.signal, new StreamIdleTimeoutError(idleTimeout))
          for (const resource of owned) {
            if (resource.destroyed || resource.writableEnded) continue
            resource.destroy?.(reason)
          }
        }
        const cleanup = () => {
          controller.signal.removeEventListener('abort', destroy)
          bindings.delete(cleanup)
        }
        controller.signal.addEventListener('abort', destroy, { once: true })
        bindings.add(cleanup)
        if (controller.signal.aborted) destroy()
        return cleanup
      },
      release() {
        if (released) return false
        released = true
        clearIdleTimer()
        signal?.removeEventListener('abort', abortFromCaller)
        for (const cleanup of [...bindings]) cleanup()
        activeLeases.delete(lease)
        leaseAborters.delete(lease)
        reservedBytes = Math.max(0, reservedBytes - bytes)
        memoryReservation?.release?.()
        releaseAdmission()
        counters.released += 1
        return true
      },
    }

    activeLeases.add(lease)
    leaseAborters.set(lease, (reason) => {
      if (!controller.signal.aborted) controller.abort(reason)
    })
    reservedBytes += bytes
    peakReservedBytes = Math.max(peakReservedBytes, reservedBytes)
    counters.admitted += 1
    armIdleTimer()
    return lease
  }

  const run = async (options, operation) => {
    if (typeof operation !== 'function') throw new TypeError('A stream operation is required.')
    const lease = await acquire(options)
    try {
      return await operation(lease)
    } finally {
      lease.release()
    }
  }

  const close = (reason = new Error('Stream admission is closing.')) => {
    if (closed) return
    closed = true
    admission.close()
    for (const [lease, abortLease] of leaseAborters) {
      if (!lease.signal.aborted) abortLease(reason)
    }
  }

  const snapshot = () => ({
    ...admission.snapshot(),
    activeLeases: activeLeases.size,
    reservedBytes,
    peakReservedBytes,
    bufferReservationBytes: defaultReservationBytes,
    idleTimeoutMs: idleTimeout,
    closed,
    counters: { ...counters },
  })

  return { acquire, run, close, snapshot }
}
