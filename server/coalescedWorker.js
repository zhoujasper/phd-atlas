export const COALESCED_WORKER_STOPPED = 'COALESCED_WORKER_STOPPED'

export class CoalescedWorkerStoppedError extends Error {
  constructor(name) {
    super(`Coalesced worker "${name}" is stopped.`)
    this.name = 'CoalescedWorkerStoppedError'
    this.code = COALESCED_WORKER_STOPPED
  }
}

function describeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
    }
  }
  return {
    name: 'Error',
    message: String(error),
  }
}

/**
 * Creates a single-flight worker for event-driven background drains.
 *
 * One kick starts an idle worker. While a drain is active, any number of kicks
 * collapse into one additional drain. A kick during that additional drain can
 * request one more round, so a wake-up is never lost without allowing an
 * unbounded queue to accumulate.
 */
export function createCoalescedWorker({
  name = 'coalesced-worker',
  drain,
  onError = () => {},
  now = Date.now,
} = {}) {
  if (typeof drain !== 'function') {
    throw new TypeError('Coalesced worker drain must be a function.')
  }
  if (typeof onError !== 'function') {
    throw new TypeError('Coalesced worker onError must be a function.')
  }
  if (typeof now !== 'function') {
    throw new TypeError('Coalesced worker now must be a function.')
  }

  const workerName = String(name || 'coalesced-worker')
  const stoppedError = new CoalescedWorkerStoppedError(workerName)
  const stoppedKickPromise = Promise.reject(stoppedError)
  // A shutdown-time callback may intentionally fire and forget a late kick.
  // Mark this stable rejection as observed while still returning a rejected
  // promise to callers that explicitly await it.
  stoppedKickPromise.catch(() => {})

  let activePromise = null
  let stopPromise = null
  let acceptingKicks = true
  let rerunRequested = false
  let drainCount = 0
  let kickCount = 0
  let coalescedKickCount = 0
  let rejectedKickCount = 0
  let errorCount = 0
  let errorReporterErrorCount = 0
  let lastStartedAt = null
  let lastFinishedAt = null
  let lastErrorAt = null
  let lastError = null

  const state = () => {
    if (acceptingKicks) return activePromise ? 'running' : 'idle'
    return activePromise ? 'stopping' : 'stopped'
  }

  const snapshot = () => ({
    name: workerName,
    state: state(),
    acceptingKicks,
    active: activePromise !== null,
    rerunRequested,
    kickCount,
    coalescedKickCount,
    rejectedKickCount,
    drainCount,
    errorCount,
    errorReporterErrorCount,
    lastStartedAt,
    lastFinishedAt,
    lastErrorAt,
    lastError,
  })

  const runDrainLoop = async () => {
    try {
      while (true) {
        drainCount += 1
        lastStartedAt = now()
        try {
          await drain()
        } catch (error) {
          errorCount += 1
          lastErrorAt = now()
          lastError = describeError(error)
          try {
            await onError(error)
          } catch {
            errorReporterErrorCount += 1
          }
        } finally {
          lastFinishedAt = now()
        }

        if (!rerunRequested) return
        // Consume the single pending wake before the next drain. A kick during
        // that next drain can then request a third round without being lost.
        rerunRequested = false
      }
    } finally {
      // This finally executes inside the same async-function continuation that
      // decided there is no pending rerun. Clearing ownership here, before the
      // returned promise settles, makes the handoff atomic: a later kick either
      // joined this loop in time or observes idle and starts a fresh owner.
      activePromise = null
    }
  }

  const kick = () => {
    if (!acceptingKicks) {
      rejectedKickCount += 1
      return stoppedKickPromise
    }

    kickCount += 1
    if (activePromise) {
      coalescedKickCount += 1
      rerunRequested = true
      return activePromise
    }

    rerunRequested = false
    const startedPromise = Promise.resolve().then(runDrainLoop)
    activePromise = startedPromise
    return startedPromise
  }

  const stopAndWait = () => {
    if (stopPromise) return stopPromise

    acceptingKicks = false
    const pending = activePromise
    stopPromise = Promise.resolve(pending).then(() => undefined)
    return stopPromise
  }

  return {
    kick,
    stopAndWait,
    snapshot,
  }
}
