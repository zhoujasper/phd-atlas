import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getClientInstanceId,
  invalidateClientReadCacheForScopes,
  phdApi,
  readSessionTokenSubject,
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
  /** Deterministic override for focused tests; production values are clamped. */
  invalidationBatchDelayMs?: number
}

const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_RETRY_AFTER_MAX_MS = 5 * 60_000
const INVALIDATION_BATCH_MIN_MS = 120
const INVALIDATION_BATCH_MAX_MS = 600

function clampInvalidationBatchDelay(value: number) {
  if (!Number.isFinite(value)) return INVALIDATION_BATCH_MIN_MS
  return Math.min(INVALIDATION_BATCH_MAX_MS, Math.max(INVALIDATION_BATCH_MIN_MS, Math.round(value)))
}

/**
 * Give each account/browser pair a stable place in the 120–600ms refresh
 * window. A shared mutation therefore no longer makes every connected tab hit
 * the API at the exact same 120ms boundary, while UI convergence stays < 1s.
 */
export function realtimeInvalidationBatchDelayMs(token: string, clientId: string) {
  const accountKey = readSessionTokenSubject(token) ?? token
  const seed = `${accountKey}:${clientId}`
  let hash = 2_166_136_261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  const windowSize = INVALIDATION_BATCH_MAX_MS - INVALIDATION_BATCH_MIN_MS + 1
  return INVALIDATION_BATCH_MIN_MS + ((hash >>> 0) % windowSize)
}

/**
 * Maintains one authenticated fetch/SSE stream per visible browser tab.
 * Invalidation bursts are coalesced before reaching App, so a multi-row server
 * mutation produces one scoped refresh instead of a request storm.
 */
export function useRealtimeUpdates({
  token,
  enabled,
  onInvalidate,
  invalidationBatchDelayMs,
}: UseRealtimeUpdatesOptions) {
  const callbackRef = useRef(onInvalidate)
  callbackRef.current = onInvalidate
  const [connected, setConnected] = useState(false)
  const batchDelayMs = token
    ? clampInvalidationBatchDelay(
        invalidationBatchDelayMs ?? realtimeInvalidationBatchDelayMs(token, getClientInstanceId()),
      )
    : INVALIDATION_BATCH_MIN_MS

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
      // Invalidate once per stable client-jittered event batch. Invalidating inside the raw SSE
      // parser restarts every in-flight read for every frame and amplifies a
      // collaborative write burst into an O(reads × events) request wave.
      invalidateClientReadCacheForScopes(token, scopes)
      callbackRef.current(scopes)
    }

    const scheduleInvalidationFlush = () => {
      if (canConnect() && pendingScopes.size > 0 && batchTimer === null) {
        batchTimer = window.setTimeout(flushInvalidations, batchDelayMs)
      }
    }

    const scheduleReconnect = (connect: () => void, retryAfterMs = 0) => {
      if (!canConnect() || retryTimer !== null) return
      const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** retryAttempt)
      retryAttempt += 1
      const jittered = Math.round(base * (0.85 + Math.random() * 0.3))
      const serverFloor = Number.isFinite(retryAfterMs)
        ? Math.min(RECONNECT_RETRY_AFTER_MAX_MS, Math.max(0, Math.ceil(retryAfterMs)))
        : 0
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        connect()
      }, Math.max(jittered, serverFloor))
    }

    const connect = () => {
      if (!canConnect() || activeAttempt !== null) return
      const attempt = { controller: new AbortController() }
      let retryAfterMs = 0
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
          if (
            error instanceof ApiError
            && ['SERVER_BUSY', 'RATE_LIMITED'].includes(error.code)
            && Number.isFinite(error.retryAfterMs)
          ) {
            retryAfterMs = Number(error.retryAfterMs)
          }
        })
        .finally(() => {
          if (activeAttempt !== attempt) return
          activeAttempt = null
          if (disposed) return
          setConnected(false)
          scheduleReconnect(connect, retryAfterMs)
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
  }, [batchDelayMs, enabled, token])

  return { connected }
}
