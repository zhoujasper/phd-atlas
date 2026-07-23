export type ConnectivityMode = 'checking' | 'online' | 'slow' | 'offline' | 'server-unreachable'

export type ConnectivitySnapshot = {
  mode: ConnectivityMode
  browserOnline: boolean
  serverReachable: boolean | null
  manualOffline: boolean
  latencyMs: number | null
  checkedAt: string | null
  lastOnlineAt: string | null
  consecutiveFailures: number
}

const SOCKET_CONNECT_TIMEOUT_MS = 4_500
const SOCKET_STALE_TIMEOUT_MS = 42_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const SLOW_RESPONSE_MS = 1_500
const MANUAL_OFFLINE_KEY = 'phd-atlas-manual-offline:v1'
const listeners = new Set<() => void>()

function storedManualOffline() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(MANUAL_OFFLINE_KEY) === '1'
  } catch {
    return false
  }
}

function persistManualOffline(enabled: boolean) {
  if (typeof localStorage === 'undefined') return
  try {
    if (enabled) localStorage.setItem(MANUAL_OFFLINE_KEY, '1')
    else localStorage.removeItem(MANUAL_OFFLINE_KEY)
  } catch {
    // Private browsing or a storage policy can reject writes. The in-memory
    // mode still works for the current session.
  }
}

function browserIsOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function isLoopbackRuntime() {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname.toLowerCase()
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
}

function connectionLooksSlow() {
  if (typeof navigator === 'undefined') return false
  // Network Information describes the device's outward-facing connection. It
  // cannot diagnose a loopback request, so using it on localhost produces the
  // misleading "slow network" state even though Atlas never leaves the device.
  if (isLoopbackRuntime()) return false
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; rtt?: number; downlink?: number }
  }).connection
  if (!connection) return false
  return connection.effectiveType === 'slow-2g'
    || connection.effectiveType === '2g'
    || (typeof connection.rtt === 'number' && connection.rtt >= 1_200)
    || (typeof connection.downlink === 'number' && connection.downlink > 0 && connection.downlink < 0.7)
}

const initialManualOffline = storedManualOffline()
let snapshot: ConnectivitySnapshot = {
  mode: initialManualOffline || !browserIsOnline() ? 'offline' : 'checking',
  browserOnline: browserIsOnline(),
  serverReachable: browserIsOnline() ? null : false,
  manualOffline: initialManualOffline,
  latencyMs: null,
  checkedAt: null,
  lastOnlineAt: null,
  consecutiveFailures: 0,
}

let probeInFlight: Promise<ConnectivitySnapshot> | null = null
let resolveProbe: ((value: ConnectivitySnapshot) => void) | null = null
let healthSocket: WebSocket | null = null
let healthSocketGeneration = 0
let connectTimeout: number | null = null
let staleTimeout: number | null = null
let reconnectTimeout: number | null = null
let reconnectAttempt = 0
let monitorCleanup: (() => void) | null = null
let monitorConsumers = 0

function publish(next: ConnectivitySnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
  return next
}

function nowIso() {
  return new Date().toISOString()
}

function clearSocketTimers() {
  if (connectTimeout !== null) window.clearTimeout(connectTimeout)
  if (staleTimeout !== null) window.clearTimeout(staleTimeout)
  connectTimeout = null
  staleTimeout = null
}

function settleProbe(result = snapshot) {
  const resolve = resolveProbe
  resolveProbe = null
  probeInFlight = null
  resolve?.(result)
}

function healthSocketUrl() {
  const url = new URL('/api/health/ws', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function scheduleReconnect() {
  if (
    reconnectTimeout !== null
    || monitorConsumers === 0
    || snapshot.manualOffline
    || !browserIsOnline()
    || typeof document !== 'undefined' && document.visibilityState !== 'visible'
  ) return

  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** reconnectAttempt)
  reconnectAttempt += 1
  const delay = Math.round(base * (0.85 + Math.random() * 0.3))
  reconnectTimeout = window.setTimeout(() => {
    reconnectTimeout = null
    void probeServerConnectivity()
  }, delay)
}

function armStaleTimeout(socket: WebSocket, generation: number) {
  if (staleTimeout !== null) window.clearTimeout(staleTimeout)
  staleTimeout = window.setTimeout(() => {
    if (generation !== healthSocketGeneration || healthSocket !== socket) return
    // The server sends an application heartbeat as well as a WebSocket ping.
    // Closing this stale socket gives the reconnect path one deterministic
    // owner instead of leaving multiple overlapping probes alive.
    socket.close(4000, 'health heartbeat timed out')
  }, SOCKET_STALE_TIMEOUT_MS)
}

function disconnectHealthSocket() {
  const socket = healthSocket
  healthSocketGeneration += 1
  healthSocket = null
  clearSocketTimers()
  settleProbe(snapshot)
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    socket.close(1000, 'connectivity monitoring paused')
  }
}

function handleSocketClosed(socket: WebSocket, generation: number) {
  if (generation !== healthSocketGeneration || healthSocket !== socket) return
  healthSocket = null
  clearSocketTimers()
  reportApiUnavailable()
  settleProbe(snapshot)
  scheduleReconnect()
}

function openHealthSocket({ replace = false } = {}) {
  if (snapshot.manualOffline) return Promise.resolve(snapshot)
  if (!browserIsOnline()) {
    disconnectHealthSocket()
    return Promise.resolve(publish({
      ...snapshot,
      mode: 'offline',
      browserOnline: false,
      serverReachable: false,
      latencyMs: null,
      checkedAt: nowIso(),
      consecutiveFailures: snapshot.consecutiveFailures + 1,
    }))
  }
  if (typeof WebSocket !== 'function' || typeof window === 'undefined') {
    return Promise.resolve(reportApiUnavailable())
  }
  if (!replace && healthSocket?.readyState === WebSocket.OPEN) return Promise.resolve(snapshot)
  if (!replace && probeInFlight) return probeInFlight

  if (replace || healthSocket) disconnectHealthSocket()
  const generation = ++healthSocketGeneration
  const startedAt = performance.now()
  const pending = new Promise<ConnectivitySnapshot>((resolve) => {
    resolveProbe = resolve
  })
  probeInFlight = pending

  let socket: WebSocket
  try {
    socket = new WebSocket(healthSocketUrl())
  } catch {
    reportApiUnavailable()
    settleProbe(snapshot)
    scheduleReconnect()
    return pending
  }
  healthSocket = socket
  connectTimeout = window.setTimeout(() => {
    if (generation !== healthSocketGeneration || healthSocket !== socket) return
    socket.close(4000, 'health connection timed out')
  }, SOCKET_CONNECT_TIMEOUT_MS)

  socket.onmessage = (event) => {
    if (generation !== healthSocketGeneration || healthSocket !== socket) return
    let message: { type?: unknown; ok?: unknown }
    try {
      message = JSON.parse(String(event.data)) as { type?: unknown; ok?: unknown }
    } catch {
      socket.close(1008, 'invalid health event')
      return
    }
    if (message.ok !== true || (message.type !== 'ready' && message.type !== 'heartbeat')) {
      socket.close(1008, 'invalid health event')
      return
    }

    const latency = message.type === 'ready'
      ? performance.now() - startedAt
      : snapshot.latencyMs ?? undefined
    reportApiReachable(latency)
    reconnectAttempt = 0
    if (connectTimeout !== null) window.clearTimeout(connectTimeout)
    connectTimeout = null
    armStaleTimeout(socket, generation)
    settleProbe(snapshot)
  }
  socket.onclose = () => handleSocketClosed(socket, generation)
  socket.onerror = () => {
    // Browsers always follow a WebSocket error with close. Keeping all state
    // changes in onclose prevents duplicate failure counters and reconnects.
  }

  return pending
}

export function getConnectivitySnapshot() {
  return snapshot
}

export function subscribeConnectivity(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function connectivityUnavailable(value = snapshot) {
  return value.manualOffline || value.mode === 'offline' || value.mode === 'server-unreachable'
}

export function reportApiReachable(latencyMs?: number) {
  const measuredLatency = typeof latencyMs === 'number' && Number.isFinite(latencyMs)
    ? Math.max(0, Math.round(latencyMs))
    : snapshot.latencyMs
  const checkedAt = nowIso()
  return publish({
    mode: snapshot.manualOffline
      ? 'offline'
      : connectionLooksSlow()
        || (!isLoopbackRuntime() && measuredLatency !== null && measuredLatency >= SLOW_RESPONSE_MS)
        ? 'slow'
        : 'online',
    browserOnline: true,
    serverReachable: true,
    manualOffline: snapshot.manualOffline,
    latencyMs: measuredLatency,
    checkedAt,
    lastOnlineAt: checkedAt,
    consecutiveFailures: 0,
  })
}

export function setManualOfflineMode(enabled: boolean) {
  if (enabled === snapshot.manualOffline) return snapshot
  persistManualOffline(enabled)
  if (enabled) {
    disconnectHealthSocket()
    return publish({
      ...snapshot,
      mode: 'offline',
      manualOffline: true,
    })
  }
  const browserOnline = browserIsOnline()
  return publish({
    ...snapshot,
    manualOffline: false,
    browserOnline,
    mode: !browserOnline
      ? 'offline'
      : snapshot.serverReachable === false
        ? 'server-unreachable'
        : connectionLooksSlow()
          || (!isLoopbackRuntime() && snapshot.latencyMs !== null && snapshot.latencyMs >= SLOW_RESPONSE_MS)
          ? 'slow'
          : snapshot.serverReachable === true ? 'online' : 'checking',
  })
}

export function reportApiUnavailable() {
  const browserOnline = browserIsOnline()
  return publish({
    ...snapshot,
    mode: snapshot.manualOffline ? 'offline' : browserOnline ? 'server-unreachable' : 'offline',
    browserOnline,
    serverReachable: false,
    checkedAt: nowIso(),
    consecutiveFailures: snapshot.consecutiveFailures + 1,
  })
}

/**
 * Establishes (or explicitly refreshes) the single WebSocket health channel.
 * Calls share one in-flight promise, which is the client-side interlock that
 * prevents focus/visibility/retry events from creating duplicate sockets.
 */
export function probeServerConnectivity(options: { force?: boolean } = {}) {
  return openHealthSocket({ replace: options.force === true })
}

export function startConnectivityMonitoring() {
  // Unit tests own WebSocket events deterministically. A mounted app monitor
  // would otherwise create background sockets unrelated to the test subject.
  if (import.meta.env.MODE === 'test') return () => undefined
  monitorConsumers += 1
  if (monitorCleanup) return stopConnectivityMonitoring

  const checkNow = () => {
    void probeServerConnectivity()
  }
  const handleOffline = () => {
    disconnectHealthSocket()
    reportApiUnavailable()
  }
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') checkNow()
    else disconnectHealthSocket()
  }

  window.addEventListener('online', checkNow)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('focus', checkNow)
  window.addEventListener('pageshow', checkNow)
  document.addEventListener('visibilitychange', handleVisibility)
  checkNow()

  monitorCleanup = () => {
    if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout)
    reconnectTimeout = null
    disconnectHealthSocket()
    window.removeEventListener('online', checkNow)
    window.removeEventListener('offline', handleOffline)
    window.removeEventListener('focus', checkNow)
    window.removeEventListener('pageshow', checkNow)
    document.removeEventListener('visibilitychange', handleVisibility)
    monitorCleanup = null
  }
  return stopConnectivityMonitoring
}

function stopConnectivityMonitoring() {
  monitorConsumers = Math.max(0, monitorConsumers - 1)
  if (monitorConsumers === 0) monitorCleanup?.()
}

export function resetConnectivityForTests() {
  monitorConsumers = 0
  if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout)
  reconnectTimeout = null
  monitorCleanup?.()
  disconnectHealthSocket()
  reconnectAttempt = 0
  const online = browserIsOnline()
  persistManualOffline(false)
  publish({
    mode: online ? 'checking' : 'offline',
    browserOnline: online,
    serverReachable: online ? null : false,
    manualOffline: false,
    latencyMs: null,
    checkedAt: null,
    lastOnlineAt: null,
    consecutiveFailures: 0,
  })
}
