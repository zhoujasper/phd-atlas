import { useEffect, useRef, useState } from 'react'
import {
  phdApi,
  type RealtimeInvalidationEvent,
  type RealtimeInvalidationScope,
} from '../../api/phdApi'

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
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    callbackRef.current = onInvalidate
  }, [onInvalidate])

  useEffect(() => {
    if (!token || !enabled) {
      setConnected(false)
      return undefined
    }

    let disposed = false
    let connecting = false
    let retryAttempt = 0
    let controller: AbortController | null = null
    let retryTimer: number | null = null
    let batchTimer: number | null = null
    const pendingScopes = new Set<RealtimeInvalidationScope>()

    const flushInvalidations = () => {
      batchTimer = null
      if (disposed || pendingScopes.size === 0) return
      const scopes = new Set(pendingScopes)
      pendingScopes.clear()
      callbackRef.current(scopes)
    }

    const handleEvent = (event: RealtimeInvalidationEvent) => {
      if (event.type === 'connected') {
        retryAttempt = 0
        setConnected(true)
        return
      }
      for (const scope of event.scopes) pendingScopes.add(scope)
      if (batchTimer === null) {
        batchTimer = window.setTimeout(flushInvalidations, INVALIDATION_BATCH_MS)
      }
    }

    const canConnect = () => (
      !disposed
      && document.visibilityState !== 'hidden'
      && navigator.onLine !== false
    )

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
      if (!canConnect() || connecting) return
      connecting = true
      controller = new AbortController()
      void phdApi.streamRealtimeUpdates(token, handleEvent, controller.signal)
        .catch((error) => {
          if (controller?.signal.aborted || disposed) return
          // Realtime is an optimization layer. Normal API error handling remains
          // authoritative, so a blocked stream never creates a user-facing toast.
          if (error instanceof DOMException && error.name === 'AbortError') return
        })
        .finally(() => {
          connecting = false
          controller = null
          if (disposed) return
          setConnected(false)
          scheduleReconnect(connect)
        })
    }

    const suspend = () => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) {
        controller?.abort()
        controller = null
        setConnected(false)
        if (retryTimer !== null) window.clearTimeout(retryTimer)
        retryTimer = null
        return
      }
      connect()
    }

    document.addEventListener('visibilitychange', suspend)
    window.addEventListener('online', suspend)
    window.addEventListener('offline', suspend)
    connect()

    return () => {
      disposed = true
      controller?.abort()
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (batchTimer !== null) window.clearTimeout(batchTimer)
      document.removeEventListener('visibilitychange', suspend)
      window.removeEventListener('online', suspend)
      window.removeEventListener('offline', suspend)
    }
  }, [enabled, token])

  return { connected }
}
