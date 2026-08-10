import { MutationAdmissionError } from './runtimeResilience.js'

function responseClosed(response) {
  return Boolean(response?.destroyed || response?.writableEnded)
}

/**
 * Own the password concurrency slot and memory reservation until native
 * password work itself settles. Client disconnects only cancel queueing; once
 * Argon2/scrypt has started it cannot be cancelled, so transport lifecycle
 * events must never release these resources early.
 */
export async function runPasswordWorkWithAdmission({
  admission,
  request,
  response,
  reservationBytes = 0,
  acquireMemoryReservation,
  onCapacityExceeded,
  work,
}) {
  if (!admission || typeof admission.acquire !== 'function') {
    throw new TypeError('password admission controller is required.')
  }
  if (typeof acquireMemoryReservation !== 'function') {
    throw new TypeError('acquireMemoryReservation is required.')
  }
  if (typeof onCapacityExceeded !== 'function') {
    throw new TypeError('onCapacityExceeded is required.')
  }
  if (typeof work !== 'function') throw new TypeError('password work is required.')

  const cancellation = new AbortController()
  const cancelWaiting = () => cancellation.abort()
  request.once('aborted', cancelWaiting)
  request.once('error', cancelWaiting)
  response.once('close', cancelWaiting)
  response.once('error', cancelWaiting)

  let releaseAdmission
  try {
    releaseAdmission = await admission.acquire({ signal: cancellation.signal })
  } catch (error) {
    if (error instanceof MutationAdmissionError && error.reason === 'cancelled') {
      return { admitted: false, reason: 'cancelled' }
    }
    if (error instanceof MutationAdmissionError) {
      await onCapacityExceeded(error)
      return { admitted: false, reason: 'capacity' }
    }
    throw error
  } finally {
    request.removeListener('aborted', cancelWaiting)
    request.removeListener('error', cancelWaiting)
    response.removeListener('close', cancelWaiting)
    response.removeListener('error', cancelWaiting)
  }

  if (cancellation.signal.aborted || responseClosed(response)) {
    releaseAdmission()
    return { admitted: false, reason: 'closed' }
  }

  const releaseMemory = acquireMemoryReservation(reservationBytes)
  if (!releaseMemory) {
    releaseAdmission()
    return { admitted: false, reason: 'memory' }
  }

  try {
    return { admitted: true, value: await work() }
  } finally {
    releaseMemory()
    releaseAdmission()
  }
}

/**
 * Shares identical password work before it enters the native-work admission
 * queue. This matters under reconnect or multi-client login bursts: admitting
 * first would split one identical Argon2 verification into several serial
 * batches when the memory budget allows only a few native jobs at a time.
 *
 * Entries exist only while work is in flight. Every later login performs a
 * fresh verification, and a bounded map prevents attacker-controlled keys from
 * becoming retained state. A disconnected subscriber stops waiting without
 * releasing resources still owned by uncancellable native work.
 */
export function createSharedPasswordWorkCoordinator({
  admission,
  acquireMemoryReservation,
  execute,
  maxEntries = 128,
}) {
  if (!admission || typeof admission.acquire !== 'function') {
    throw new TypeError('password admission controller is required.')
  }
  if (typeof acquireMemoryReservation !== 'function') {
    throw new TypeError('acquireMemoryReservation is required.')
  }
  if (typeof execute !== 'function') throw new TypeError('password work is required.')

  const entryLimit = Number.isSafeInteger(Number(maxEntries)) && Number(maxEntries) > 0
    ? Number(maxEntries)
    : 128
  const inFlight = new Map()

  const createEntry = (key, payload, reservationBytes, tracked) => {
    const cancellation = new AbortController()
    const entry = {
      cancellation,
      started: false,
      settled: false,
      subscribers: new Set(),
      promise: null,
    }
    entry.promise = Promise.resolve().then(async () => {
      let releaseAdmission
      try {
        releaseAdmission = await admission.acquire({ signal: cancellation.signal })
      } catch (error) {
        if (error instanceof MutationAdmissionError && error.reason === 'cancelled') {
          return { admitted: false, reason: 'cancelled' }
        }
        if (error instanceof MutationAdmissionError) {
          return { admitted: false, reason: 'capacity', error }
        }
        throw error
      }

      if (cancellation.signal.aborted) {
        releaseAdmission()
        return { admitted: false, reason: 'cancelled' }
      }

      const reservation = acquireMemoryReservation(reservationBytes)
      if (!reservation?.allowed) {
        releaseAdmission()
        return {
          admitted: false,
          reason: 'memory',
          decision: reservation?.decision,
        }
      }

      entry.started = true
      try {
        return { admitted: true, value: await execute(payload) }
      } finally {
        reservation.release()
        releaseAdmission()
      }
    }).finally(() => {
      entry.settled = true
      if (tracked && inFlight.get(key) === entry) inFlight.delete(key)
    })
    // If every subscriber disconnects while native work is running, retain no
    // unhandled rejection while still allowing active subscribers to observe it.
    void entry.promise.catch(() => undefined)
    return entry
  }

  const waitForEntry = (entry, signal) => new Promise((resolve, reject) => {
    const subscriber = {}
    let finished = false
    const detach = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', onAbort)
      entry.subscribers.delete(subscriber)
      return true
    }
    const onAbort = () => {
      if (!detach()) return
      if (!entry.started && !entry.settled && entry.subscribers.size === 0) {
        entry.cancellation.abort()
      }
      resolve({ admitted: false, reason: 'closed' })
    }

    entry.subscribers.add(subscriber)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      (result) => {
        if (detach()) resolve(result)
      },
      (error) => {
        if (detach()) reject(error)
      },
    )
  })

  return (key, { payload, reservationBytes = 0, signal } = {}) => {
    const normalizedKey = String(key ?? '')
    let entry = inFlight.get(normalizedKey)
    if (!entry) {
      const tracked = inFlight.size < entryLimit
      entry = createEntry(normalizedKey, payload, reservationBytes, tracked)
      if (tracked) inFlight.set(normalizedKey, entry)
    }
    return waitForEntry(entry, signal)
  }
}
