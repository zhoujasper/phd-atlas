const DEFAULT_STARTUP_RECOVERY_ORDER = Object.freeze([
  'persisted-mail-sync-jobs',
  'discover-research-recovery',
  'system-email-delivery',
  'outgoing-email-delivery',
  'browser-notification-journal-recovery',
  'notification-evaluation',
  'notification-email-digest',
  'mail-fetch',
])

const DEFAULT_INITIAL_DELAY_MS = 2_000
const DEFAULT_STAGGER_MS = 150

const boundedNonNegativeInteger = (value, fallback, maximum = 60_000) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(maximum, Math.floor(parsed))
}

const boundedPositiveInteger = (value, fallback, maximum = 16) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(maximum, Math.floor(parsed))
}

const abortError = (signal) => {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('Startup recovery was aborted.')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

const delayWithAbort = (delayMs, signal, timers) => {
  if (signal.aborted) return Promise.reject(abortError(signal))
  if (delayMs <= 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let timer = null
    const onAbort = () => {
      if (timer !== null) timers.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal))
    }
    timer = timers.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    timer?.unref?.()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const sortStartupRecoveryEntries = (
  entries,
  priorityOrder = DEFAULT_STARTUP_RECOVERY_ORDER,
) => {
  const priority = new Map(priorityOrder.map((name, index) => [name, index]))
  return [...entries]
    .map((entry, registrationIndex) => ({ entry, registrationIndex }))
    .filter(({ entry }) => entry?.runOnStartup !== false && typeof entry?.task?.runNow === 'function')
    .sort((left, right) => {
      const leftPriority = priority.get(left.entry.name) ?? priority.size
      const rightPriority = priority.get(right.entry.name) ?? priority.size
      return leftPriority - rightPriority || left.registrationIndex - right.registrationIndex
    })
    .map(({ entry }) => entry)
}

export function createStartupRecoveryOrchestrator({
  entries,
  concurrency = 1,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  staggerMs = DEFAULT_STAGGER_MS,
  priorityOrder = DEFAULT_STARTUP_RECOVERY_ORDER,
  signal,
  timers = globalThis,
  onError = () => {},
} = {}) {
  if (!entries || typeof entries[Symbol.iterator] !== 'function') {
    throw new TypeError('Startup recovery entries must be iterable.')
  }
  if (typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') {
    throw new TypeError('Startup recovery timers must provide setTimeout and clearTimeout.')
  }
  if (typeof onError !== 'function') {
    throw new TypeError('Startup recovery onError must be a function.')
  }

  const maximumConcurrency = boundedPositiveInteger(concurrency, 1)
  const settleDelay = boundedNonNegativeInteger(initialDelayMs, DEFAULT_INITIAL_DELAY_MS)
  const launchStagger = boundedNonNegativeInteger(staggerMs, DEFAULT_STAGGER_MS)
  const controller = new AbortController()
  let runPromise = null
  let finalResults = null

  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) {
    forwardAbort()
  } else {
    signal?.addEventListener('abort', forwardAbort, { once: true })
  }

  const reportError = (error, entry) => {
    try {
      onError(error, entry)
    } catch {
      // Recovery logging must not stop subsequent startup work.
    }
  }

  const runEntry = async (entry, index, results) => {
    try {
      const started = await entry.task.runNow({ signal: controller.signal })
      results[index] = started === false
        ? { name: entry.name, status: 'occupied' }
        : { name: entry.name, status: 'fulfilled' }
    } catch (reason) {
      results[index] = { name: entry.name, status: 'rejected', reason }
      reportError(reason, entry)
    }
  }

  const execute = async () => {
    const orderedEntries = sortStartupRecoveryEntries(entries, priorityOrder)
    const results = new Array(orderedEntries.length)
    const active = new Set()
    let nextIndex = 0
    let launchedAny = false

    try {
      await delayWithAbort(settleDelay, controller.signal, timers)
      while (nextIndex < orderedEntries.length || active.size > 0) {
        while (
          !controller.signal.aborted
          && nextIndex < orderedEntries.length
          && active.size < maximumConcurrency
        ) {
          if (launchedAny) {
            await delayWithAbort(launchStagger, controller.signal, timers)
          }
          if (controller.signal.aborted) break

          const index = nextIndex
          const entry = orderedEntries[index]
          nextIndex += 1
          launchedAny = true
          const taskPromise = runEntry(entry, index, results)
          active.add(taskPromise)
          void taskPromise.finally(() => active.delete(taskPromise))
        }

        if (active.size > 0) {
          await Promise.race(active)
        } else if (controller.signal.aborted) {
          break
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }

    if (active.size > 0) {
      await Promise.allSettled(active)
    }
    for (let index = 0; index < orderedEntries.length; index += 1) {
      if (!results[index]) {
        results[index] = {
          name: orderedEntries[index].name,
          status: 'aborted',
          reason: abortError(controller.signal),
        }
      }
    }
    finalResults = results
    return [...results]
  }

  const run = () => {
    if (finalResults) return Promise.resolve([...finalResults])
    if (!runPromise) {
      runPromise = execute().finally(() => {
        signal?.removeEventListener('abort', forwardAbort)
      })
    }
    return runPromise
  }

  return {
    run,
    stop(reason) {
      if (!controller.signal.aborted) controller.abort(reason)
    },
    isRunning: () => runPromise !== null && finalResults === null,
    results: () => finalResults ? [...finalResults] : null,
    async whenIdle() {
      if (runPromise) await runPromise
    },
  }
}

export {
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_STAGGER_MS,
  DEFAULT_STARTUP_RECOVERY_ORDER,
}
