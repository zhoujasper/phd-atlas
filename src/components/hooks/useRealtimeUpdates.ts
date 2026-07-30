import { useEffect, useRef, useState } from 'react'
import {
  phdApi,
  type RealtimeInvalidationEvent,
  type RealtimeInvalidationScope,
} from '../../api/phdApi'
import {
  connectivityUnavailable,
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '../../connectivity'

type UseRealtimeUpdatesOptions = {
  token: string | null
  enabled: boolean
  onInvalidate: (scopes: ReadonlySet<RealtimeInvalidationScope>) => void
}

const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const INVALIDATION_BATCH_MS = 120

/**
 * Maintains one authenticated fetch/SSE stream per visible browser tab.
 * Invalidation bursts are coalesced before reaching App, so a multi-row server
 * mutation produces one scoped refresh instead of a request storm.
 */
export function useRealtimeUpdates({ token, enabled, onInvalidate }: UseRealtimeUpdatesOptions) {
  const callbackRef = useRef(onInvalidate)
  callbackRef.current = onInvalidate
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token || !enabled) {
      setConnected(false)
      return undefined
    }

    let disposed = false
    let retryAttempt = 0
    let activeAttempt: { controller: AbortController } | null = null
    let retryTimer: number | null = null
    let batchTimer: number | null = null
    const pendingScopes = new Set<RealtimeInvalidationScope>()

    const canConnect = () => (
      !disposed
      && document.visibilityState !== 'hidden'
      && navigator.onLine !== false
      && !connectivityUnavailable(getConnectivitySnapshot())
    )

    const flushInvalidations = () => {
      batchTimer = null
      if (!canConnect() || pendingScopes.size === 0) return
      const scopes = new Set(pendingScopes)
      pendingScopes.clear()
      callbackRef.current(scopes)
    }

    const scheduleInvalidationFlush = () => {
      if (canConnect() && pendingScopes.size > 0 && batchTimer === null) {
        batchTimer = window.setTimeout(flushInvalidations, INVALIDATION_BATCH_MS)
      }
    }

    const scheduleReconnect = (connect: () => void) => {
      if (!canConnect() || retryTimer !== null) return
      const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** retryAttempt)
      retryAttempt += 1
      const jittered = Math.round(base * (0.85 + Math.random() * 0.3))
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        connect()
      }, jittered)
    }

    const connect = () => {
      if (!canConnect() || activeAttempt !== null) return
      const attempt = { controller: new AbortController() }
      activeAttempt = attempt
      const handleEvent = (event: RealtimeInvalidationEvent) => {
        if (activeAttempt !== attempt || attempt.controller.signal.aborted) return
        if (event.type === 'connected') {
          if (!canConnect()) return
          retryAttempt = 0
          setConnected(true)
          return
        }
        for (const scope of event.scopes) pendingScopes.add(scope)
        scheduleInvalidationFlush()
      }
      void phdApi.streamRealtimeUpdates(token, handleEvent, attempt.controller.signal)
        .catch((error) => {
          if (attempt.controller.signal.aborted || disposed) return
          // Realtime is an optimization layer. Normal API error handling remains
          // authoritative, so a blocked stream never creates a user-facing toast.
          if (error instanceof DOMException && error.name === 'AbortError') return
        })
        .finally(() => {
          if (activeAttempt !== attempt) return
          activeAttempt = null
          if (disposed) return
          setConnected(false)
          scheduleReconnect(connect)
        })
    }

    const suspend = () => {
      if (!canConnect()) {
        const attempt = activeAttempt
        activeAttempt = null
        attempt?.controller.abort()
        setConnected(false)
        if (retryTimer !== null) window.clearTimeout(retryTimer)
        retryTimer = null
        if (batchTimer !== null) window.clearTimeout(batchTimer)
        batchTimer = null
        return
      }
      scheduleInvalidationFlush()
      connect()
    }

    document.addEventListener('visibilitychange', suspend)
    window.addEventListener('online', suspend)
    window.addEventListener('offline', suspend)
    const unsubscribeConnectivity = subscribeConnectivity(suspend)
    connect()

    return () => {
      disposed = true
      const attempt = activeAttempt
      activeAttempt = null
      attempt?.controller.abort()
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (batchTimer !== null) window.clearTimeout(batchTimer)
      document.removeEventListener('visibilitychange', suspend)
      window.removeEventListener('online', suspend)
      window.removeEventListener('offline', suspend)
      unsubscribeConnectivity()
    }
  }, [enabled, token])

  return { connected }
}
