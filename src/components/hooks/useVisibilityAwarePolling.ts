import { useEffect, useRef } from 'react'
import {
  connectivityUnavailable,
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '../../connectivity'

export type VisibilityAwarePollDecision = number | false | void

type VisibilityAwarePollingOptions = {
  enabled: boolean
  initialDelayMs?: number
  intervalMs: number
  /**
   * Restarts the schedule when the identity of the polled resource changes.
   * The callback itself stays behind a ref so ordinary renders never reset a
   * healthy timer.
   */
  restartKey?: unknown
  pauseWhenHidden?: boolean
  pauseWhenOffline?: boolean
  /**
   * Pauses network-backed work while the Atlas API circuit is open, even when
   * `navigator.onLine` still reports a working internet connection.
   */
  pauseWhenServerUnavailable?: boolean
  poll: (signal: AbortSignal) => Promise<VisibilityAwarePollDecision> | VisibilityAwarePollDecision
  onError?: (error: unknown) => void
}

function finiteDelay(value: number | undefined, fallback: number) {
  const candidate = value ?? fallback
  return Number.isFinite(candidate) ? Math.max(0, candidate) : Math.max(0, fallback)
}

/**
 * Runs one non-overlapping browser poll that sleeps while the document is
 * hidden or the browser is offline, then refreshes immediately on resume.
 *
 * Returning a number selects the next delay, `false` stops the current
 * schedule, and `undefined` uses `intervalMs`.
 */
export function useVisibilityAwarePolling({
  enabled,
  initialDelayMs = 0,
  intervalMs,
  restartKey,
  pauseWhenHidden = true,
  pauseWhenOffline = true,
  pauseWhenServerUnavailable = true,
  poll,
  onError,
}: VisibilityAwarePollingOptions) {
  const pollRef = useRef(poll)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    pollRef.current = poll
    onErrorRef.current = onError
  }, [onError, poll])

  useEffect(() => {
    if (!enabled) return undefined

    let disposed = false
    let running = false
    let stopped = false
    let resumePending = false
    let timer: number | null = null
    let currentController: AbortController | null = null

    const available = () => (
      (!pauseWhenHidden || document.visibilityState !== 'hidden')
      && (!pauseWhenOffline || navigator.onLine !== false)
      && (
        !pauseWhenServerUnavailable
        || !connectivityUnavailable(getConnectivitySnapshot())
      )
    )

    const clearTimer = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }

    function schedule(delayMs: number) {
      if (disposed || stopped) return
      clearTimer()
      if (!available()) {
        resumePending = true
        return
      }
      resumePending = false
      timer = window.setTimeout(() => {
        timer = null
        void run()
      }, finiteDelay(delayMs, intervalMs))
    }

    async function run() {
      if (disposed || stopped) return
      if (!available()) {
        resumePending = true
        return
      }
      if (running) {
        resumePending = true
        return
      }

      running = true
      const runController = new AbortController()
      currentController = runController
      let decision: VisibilityAwarePollDecision = undefined
      try {
        decision = await pollRef.current(runController.signal)
      } catch (error) {
        if (!runController.signal.aborted) onErrorRef.current?.(error)
      } finally {
        running = false
        if (currentController === runController) currentController = null
      }

      if (disposed) return
      if (runController.signal.aborted) {
        if (!stopped && available() && resumePending) schedule(0)
        return
      }
      if (decision === false) {
        stopped = true
        clearTimer()
        return
      }
      schedule(typeof decision === 'number' ? decision : intervalMs)
    }

    const suspendOrResume = () => {
      if (disposed || stopped) return
      if (!available()) {
        resumePending = true
        clearTimer()
        currentController?.abort()
        return
      }
      if (running) {
        resumePending = true
        return
      }
      if (resumePending || timer === null) schedule(0)
    }

    document.addEventListener('visibilitychange', suspendOrResume)
    window.addEventListener('online', suspendOrResume)
    window.addEventListener('offline', suspendOrResume)
    const unsubscribeConnectivity = pauseWhenServerUnavailable
      ? subscribeConnectivity(suspendOrResume)
      : () => undefined
    schedule(finiteDelay(initialDelayMs, 0))

    return () => {
      disposed = true
      currentController?.abort()
      clearTimer()
      document.removeEventListener('visibilitychange', suspendOrResume)
      window.removeEventListener('online', suspendOrResume)
      window.removeEventListener('offline', suspendOrResume)
      unsubscribeConnectivity()
    }
  }, [
    enabled,
    initialDelayMs,
    intervalMs,
    pauseWhenHidden,
    pauseWhenOffline,
    pauseWhenServerUnavailable,
    restartKey,
  ])
}
