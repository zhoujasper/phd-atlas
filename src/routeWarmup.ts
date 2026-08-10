export type RouteWarmupTask = () => Promise<unknown> | unknown

type RouteWarmupConnection = {
  saveData?: boolean
  effectiveType?: string
  addEventListener?: (type: 'change', listener: EventListener) => void
  removeEventListener?: (type: 'change', listener: EventListener) => void
}

type RouteWarmupWindow = Pick<Window, 'setTimeout' | 'clearTimeout' | 'addEventListener' | 'removeEventListener'> & {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export type RouteWarmupEnvironment = {
  window: RouteWarmupWindow
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
  navigator: Pick<Navigator, 'onLine'> & { connection?: RouteWarmupConnection }
}

export type RouteWarmupOptions = {
  initialDelay?: number
  idleTimeout?: number
  interTaskDelay?: number
  maxTasks?: number
  environment?: RouteWarmupEnvironment
}

const BLOCKED_EFFECTIVE_TYPES = new Set(['slow-2g', '2g'])

function browserEnvironment(): RouteWarmupEnvironment {
  return {
    window: window as RouteWarmupWindow,
    document,
    navigator: navigator as Navigator & { connection?: RouteWarmupConnection },
  }
}

export function routeWarmupAllowed(environment: RouteWarmupEnvironment = browserEnvironment()) {
  if (environment.navigator.onLine === false) return false
  if (environment.document.visibilityState !== 'visible') return false

  const connection = environment.navigator.connection
  if (connection?.saveData) return false
  return !BLOCKED_EFFECTIVE_TYPES.has(connection?.effectiveType?.toLowerCase() ?? '')
}

/**
 * Warms optional route chunks one at a time, and only while the page has spare
 * time on a network where speculative transfer is appropriate. Intent-driven
 * pointer/focus warmups remain independent of this background queue.
 */
export function scheduleIdleRouteWarmups(
  tasks: RouteWarmupTask[],
  options: RouteWarmupOptions = {},
) {
  const environment = options.environment ?? browserEnvironment()
  const initialDelay = options.initialDelay ?? 1_200
  const idleTimeout = options.idleTimeout ?? 2_500
  const interTaskDelay = options.interTaskDelay ?? 180
  const maxTasks = Math.max(0, Math.floor(options.maxTasks ?? 3))
  const taskLimit = Math.min(tasks.length, maxTasks)
  const idleWindow = environment.window
  const connection = environment.navigator.connection
  let cancelled = false
  let index = 0
  let timer: number | null = null
  let idleHandle: number | null = null

  const clearScheduledWork = () => {
    if (timer !== null) idleWindow.clearTimeout(timer)
    if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
    timer = null
    idleHandle = null
  }

  const removeListeners = () => {
    idleWindow.removeEventListener('offline', stop)
    environment.document.removeEventListener('visibilitychange', stopWhenBlocked)
    connection?.removeEventListener?.('change', stopWhenBlocked)
  }

  function stop() {
    if (cancelled) return
    cancelled = true
    clearScheduledWork()
    removeListeners()
  }

  function stopWhenBlocked() {
    if (!routeWarmupAllowed(environment)) stop()
  }

  const scheduleIdle = () => {
    timer = null
    if (cancelled || index >= taskLimit) return
    if (!routeWarmupAllowed(environment)) {
      stop()
      return
    }
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(runNext, { timeout: idleTimeout })
    } else {
      // Safari has no requestIdleCallback. A delayed, single-item fallback still
      // avoids a startup burst and yields between every optional import.
      timer = idleWindow.setTimeout(() => runNext(), 250)
    }
  }

  function runNext(deadline?: IdleDeadline) {
    idleHandle = null
    timer = null
    if (cancelled || index >= taskLimit) return
    if (!routeWarmupAllowed(environment)) {
      stop()
      return
    }
    if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 8) {
      scheduleIdle()
      return
    }

    const task = tasks[index]
    index += 1
    void Promise.resolve()
      .then(task)
      .catch(() => undefined)
      .finally(() => {
        if (cancelled || index >= taskLimit) return
        timer = idleWindow.setTimeout(scheduleIdle, interTaskDelay)
      })
  }

  if (taskLimit === 0 || !routeWarmupAllowed(environment)) return () => undefined

  idleWindow.addEventListener('offline', stop)
  environment.document.addEventListener('visibilitychange', stopWhenBlocked)
  connection?.addEventListener?.('change', stopWhenBlocked)
  timer = idleWindow.setTimeout(scheduleIdle, initialDelay)
  return stop
}
