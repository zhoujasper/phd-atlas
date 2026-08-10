export const BACKGROUND_TASK_REGISTRY_STOPPED = 'BACKGROUND_TASK_REGISTRY_STOPPED'

export class BackgroundTaskRegistryStoppedError extends Error {
  constructor(name) {
    super(`Background task registry "${name}" is stopped.`)
    this.name = 'BackgroundTaskRegistryStoppedError'
    this.code = BACKGROUND_TASK_REGISTRY_STOPPED
  }
}

/**
 * Tracks detached work that can outlive the HTTP request which created it.
 *
 * Cancellation is deliberately cooperative: stop() aborts the lifecycle
 * signal, but accepted promises remain registered until their real durable
 * boundary settles. This lets shutdown distinguish "asked to stop" from
 * "storage is now safe to close".
 */
export function createBackgroundTaskRegistry({
  name = 'background-tasks',
} = {}) {
  const registryName = String(name || 'background-tasks')
  const controller = new AbortController()
  const activeByName = new Map()
  const stoppedError = new BackgroundTaskRegistryStoppedError(registryName)
  const stoppedPromise = Promise.reject(stoppedError)
  stoppedPromise.catch(() => {})
  let accepting = true
  let acceptedCount = 0
  let rejectedCount = 0

  const remove = (taskName, promise) => {
    const active = activeByName.get(taskName)
    if (!active) return
    active.delete(promise)
    if (active.size === 0) activeByName.delete(taskName)
  }

  const track = (rawTaskName, work) => {
    if (!accepting) {
      rejectedCount += 1
      return stoppedPromise
    }
    if (typeof work !== 'function') {
      throw new TypeError('Background task work must be a function.')
    }

    const taskName = String(rawTaskName || 'unnamed').slice(0, 160)
    acceptedCount += 1
    const promise = Promise.resolve().then(() => work(controller.signal))
    const active = activeByName.get(taskName) ?? new Set()
    active.add(promise)
    activeByName.set(taskName, active)
    // Observe both outcomes without replacing the promise returned to callers.
    // This prevents a deliberately detached task from becoming an unhandled
    // rejection while preserving its rejection for an explicit awaiter.
    void promise.then(
      () => remove(taskName, promise),
      () => remove(taskName, promise),
    )
    return promise
  }

  const pending = () => [...activeByName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskName, promises]) => ({ name: taskName, count: promises.size }))

  const snapshot = () => ({
    name: registryName,
    accepting,
    active: [...activeByName.values()].reduce((total, tasks) => total + tasks.size, 0),
    pending: pending(),
    acceptedCount,
    rejectedCount,
  })

  const stop = (reason = new Error(`${registryName} is stopping.`)) => {
    if (!accepting) return
    accepting = false
    controller.abort(reason)
  }

  const whenIdle = async () => {
    while (activeByName.size > 0) {
      const active = [...activeByName.values()].flatMap((tasks) => [...tasks])
      await Promise.allSettled(active)
    }
  }

  const stopAndWait = async (reason) => {
    stop(reason)
    await whenIdle()
  }

  return {
    pending,
    snapshot,
    stop,
    stopAndWait,
    track,
    whenIdle,
  }
}
