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

export type ApiRequestBlockReason = 'manual-offline' | 'browser-offline' | 'server-unreachable'

type ApiUnavailableEvidence = 'transport' | 'timeout'

type ApiUnavailableOptions = {
  evidence?: ApiUnavailableEvidence
  observedGeneration?: number
}

type ApiReachableOptions = {
  healthChannel?: boolean
  observedGeneration?: number
}

const SOCKET_CONNECT_TIMEOUT_MS = 4_500
const SOCKET_STALE_TIMEOUT_MS = 42_000
const RECOVERY_PROBE_TIMEOUT_MS = 4_500
const RECONNECT_MIN_MS = 1_500
const RECONNECT_MAX_MS = 30_000
const SLOW_RESPONSE_MS = 1_500
const MANUAL_OFFLINE_KEY = 'phd-atlas-manual-offline:v1'
const listeners = new Set<() => void>()

function storedManualOffline() {
  if (typeof sessionStorage === 'undefined') return false
  try {
    return sessionStorage.getItem(MANUAL_OFFLINE_KEY) === '1'
  } catch {
    return false
  }
}

function persistManualOffline(enabled: boolean) {
  if (typeof sessionStorage === 'undefined') return
  try {
    if (enabled) sessionStorage.setItem(MANUAL_OFFLINE_KEY, '1')
    else sessionStorage.removeItem(MANUAL_OFFLINE_KEY)
  } catch {
    // Private browsing or a storage policy can reject writes. The in-memory
    // mode still works for the current tab. Deliberate offline mode is scoped
    // to one browser session so it cannot silently carry into another account.
  }
}

function browserIsOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function documentIsVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
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

let connectivityGeneration = 0
let socketProbeInFlight: Promise<ConnectivitySnapshot> | null = null
let resolveSocketProbe: ((value: ConnectivitySnapshot) => void) | null = null
let recoveryProbeInFlight: Promise<ConnectivitySnapshot> | null = null
let recoveryController: AbortController | null = null
let recoveryGeneration = 0
let healthSocket: WebSocket | null = null
let healthSocketReady = false
let healthSocketGeneration = 0
let connectTimeout: number | null = null
let staleTimeout: number | null = null
let reconnectTimeout: number | null = null
let automaticProbeNotBefore = 0
let recoveryReconnectAttempt = 0
let socketReconnectAttempt = 0
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

function clearReconnectTimer({ preserveDeadline = false } = {}) {
  if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout)
  reconnectTimeout = null
  if (!preserveDeadline) automaticProbeNotBefore = 0
}

function takeSocketProbeResolver() {
  const resolve = resolveSocketProbe
  resolveSocketProbe = null
  socketProbeInFlight = null
  return resolve
}

function settleSocketProbe(result = snapshot) {
  takeSocketProbeResolver()?.(result)
}

function cancelRecoveryProbe() {
  recoveryGeneration += 1
  const controller = recoveryController
  recoveryController = null
  recoveryProbeInFlight = null
  controller?.abort()
}

function retireHealthSocket(socket: WebSocket) {
  const closeAfterOpen = () => {
    socket.onopen = null
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'connectivity monitoring paused')
    }
  }

  // A browser reports `WebSocket is closed before the connection is
  // established` when close() is called in CONNECTING. Detach this retired
  // generation immediately, then close it normally if the handshake wins the
  // race. Generation checks remain the authority for all active callbacks.
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.onopen = closeAfterOpen
  } else {
    closeAfterOpen()
  }
}

export function resolveHealthSocketUrl(
  locationHref: string,
  { development = false, apiPort = '4317' }: { development?: boolean; apiPort?: string } = {},
) {
  const url = new URL('/api/health/ws', locationHref)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  // The HTTP API continues to use Vite's development proxy, but a long-lived
  // WebSocket is better connected straight to the local API server. On Windows
  // a page refresh/background transition can close the browser side while the
  // proxy is forwarding a heartbeat, which makes Vite log a noisy
  // `write ECONNABORTED` even though both endpoints handled the disconnect.
  // Production remains same-origin, and custom local API ports can opt in
  // through the matching VITE_API_PORT value.
  if (development && url.port === '5173') {
    url.port = apiPort.trim() || '4317'
  }
  return url.toString()
}

export function resolveHealthHttpUrl(
  locationHref: string,
) {
  const url = new URL('/api/health', locationHref)
  // HTTP recovery deliberately follows the same origin/path as application
  // reads. This validates the complete proxy/edge route and prevents a direct
  // API-port success from falsely closing the circuit while normal requests
  // are still receiving gateway failures. The circuit emits only this one
  // bounded, backed-off probe while unavailable.
  return url.toString()
}

function healthSocketUrl() {
  return resolveHealthSocketUrl(window.location.href, {
    development: import.meta.env.DEV,
    apiPort: import.meta.env.VITE_API_PORT,
  })
}

function healthHttpUrl() {
  return resolveHealthHttpUrl(window.location.href)
}

function reconnectDelay() {
  const recoveringServer = snapshot.serverReachable === false
  const attempt = recoveringServer ? recoveryReconnectAttempt : socketReconnectAttempt
  if (recoveringServer) recoveryReconnectAttempt += 1
  else socketReconnectAttempt += 1
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt)
  return Math.round(base * (0.85 + Math.random() * 0.3))
}

function scheduleReconnect() {
  if (
    reconnectTimeout !== null
    || monitorConsumers === 0
    || snapshot.manualOffline
    || !browserIsOnline()
    || !documentIsVisible()
  ) return

  const delay = reconnectDelay()
  automaticProbeNotBefore = Date.now() + delay
  reconnectTimeout = window.setTimeout(() => {
    reconnectTimeout = null
    automaticProbeNotBefore = 0
    void probeServerConnectivity()
  }, delay)
}

function armStaleTimeout(socket: WebSocket, generation: number) {
  if (staleTimeout !== null) window.clearTimeout(staleTimeout)
  staleTimeout = window.setTimeout(() => {
    if (generation !== healthSocketGeneration || healthSocket !== socket) return
    // The server sends an application heartbeat as well as a WebSocket ping.
    // Closing this stale socket gives the recovery path one deterministic
    // owner instead of leaving multiple overlapping probes alive.
    socket.close(4000, 'health heartbeat timed out')
  }, SOCKET_STALE_TIMEOUT_MS)
}

function disconnectHealthSocket() {
  const socket = healthSocket
  healthSocketGeneration += 1
  healthSocket = null
  healthSocketReady = false
  clearSocketTimers()
  settleSocketProbe(snapshot)
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    retireHealthSocket(socket)
  }
}

async function parseHealthResponse(response: Response) {
  if (!response.ok) return false
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) return false
  try {
    const payload = await response.json() as {
      ok?: unknown
      data?: { status?: unknown }
    }
    return payload.ok === true && payload.data?.status === 'ok'
  } catch {
    return false
  }
}

function probeServerViaHttp({ force = false } = {}) {
  if (snapshot.manualOffline || !browserIsOnline()) {
    reportApiUnavailable()
    return Promise.resolve(snapshot)
  }
  if (recoveryProbeInFlight) return recoveryProbeInFlight

  const remainingCooldown = automaticProbeNotBefore - Date.now()
  if (!force && remainingCooldown > 0) {
    scheduleReconnect()
    return Promise.resolve(snapshot)
  }
  if (force) clearReconnectTimer()

  const generation = ++recoveryGeneration
  const observedGeneration = connectivityGeneration
  const controller = new AbortController()
  recoveryController = controller
  const startedAt = performance.now()
  const promise = (async () => {
    const timeout = window.setTimeout(
      () => controller.abort(),
      RECOVERY_PROBE_TIMEOUT_MS,
    )
    try {
      const response = await fetch(healthHttpUrl(), {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      const reachable = await parseHealthResponse(response)
      if (
        generation !== recoveryGeneration
        || recoveryController !== controller
        || controller.signal.aborted
      ) return snapshot
      if (!reachable) {
        reportApiUnavailable({ observedGeneration })
        return snapshot
      }
      reportApiReachable(performance.now() - startedAt)
      return snapshot
    } catch {
      if (
        generation !== recoveryGeneration
        || recoveryController !== controller
        || controller.signal.aborted && !browserIsOnline()
      ) return snapshot
      reportApiUnavailable({ observedGeneration })
      return snapshot
    } finally {
      window.clearTimeout(timeout)
      if (generation === recoveryGeneration && recoveryController === controller) {
        recoveryController = null
        recoveryProbeInFlight = null
      }
    }
  })()
  recoveryProbeInFlight = promise
  return promise
}

function handleSocketClosed(socket: WebSocket, generation: number) {
  if (generation !== healthSocketGeneration || healthSocket !== socket) return
  healthSocket = null
  healthSocketReady = false
  clearSocketTimers()

  // A dropped or refused WebSocket does not by itself prove the HTTP API is
  // unavailable. Confirm once over HTTP, then use adaptive HTTP recovery while
  // the server is down. This avoids an endless sequence of noisy failed socket
  // handshakes and prevents a proxy-only WebSocket issue from disabling Atlas.
  const pendingResolver = takeSocketProbeResolver()
  void probeServerViaHttp({ force: true }).then((result) => {
    pendingResolver?.(result)
    scheduleReconnect()
  })
}

function openHealthSocket({ replace = false } = {}) {
  if (snapshot.manualOffline) return Promise.resolve(snapshot)
  if (!browserIsOnline()) {
    reportApiUnavailable()
    return Promise.resolve(snapshot)
  }
  if (typeof WebSocket !== 'function' || typeof window === 'undefined') {
    return probeServerViaHttp({ force: replace })
  }
  if (!replace && healthSocket?.readyState === WebSocket.OPEN) return Promise.resolve(snapshot)
  if (!replace && socketProbeInFlight) return socketProbeInFlight

  if (replace || healthSocket) disconnectHealthSocket()
  const generation = ++healthSocketGeneration
  const startedAt = performance.now()
  const pending = new Promise<ConnectivitySnapshot>((resolve) => {
    resolveSocketProbe = resolve
  })
  socketProbeInFlight = pending

  let socket: WebSocket
  try {
    socket = new WebSocket(healthSocketUrl())
  } catch {
    const pendingResolver = takeSocketProbeResolver()
    void probeServerViaHttp({ force: true }).then((result) => {
      pendingResolver?.(result)
      scheduleReconnect()
    })
    return pending
  }
  healthSocket = socket
  healthSocketReady = false
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

    healthSocketReady = true
    socketReconnectAttempt = 0
    clearReconnectTimer()
    const latency = message.type === 'ready'
      ? performance.now() - startedAt
      : snapshot.latencyMs ?? undefined
    reportApiReachable(latency, { healthChannel: true })
    if (connectTimeout !== null) window.clearTimeout(connectTimeout)
    connectTimeout = null
    armStaleTimeout(socket, generation)
    settleSocketProbe(snapshot)
  }
  socket.onclose = () => handleSocketClosed(socket, generation)
  socket.onerror = () => {
    // Browsers always follow a WebSocket error with close. Keeping all state
    // changes in the confirmation path prevents duplicate failure counters and
    // reconnects.
  }

  return pending
}

export function getConnectivitySnapshot() {
  return snapshot
}

export function getConnectivityGeneration() {
  return connectivityGeneration
}

export function subscribeConnectivity(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function connectivityUnavailable(value = snapshot) {
  return value.manualOffline || value.mode === 'offline' || value.mode === 'server-unreachable'
}

export function apiRequestBlockReason(
  method = 'GET',
  value = snapshot,
): ApiRequestBlockReason | null {
  if (value.manualOffline) return 'manual-offline'
  if (!value.browserOnline || value.mode === 'offline') return 'browser-offline'
  const normalizedMethod = method.toUpperCase()
  if (
    value.serverReachable === false
    && ['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)
  ) {
    return 'server-unreachable'
  }
  return null
}

export function reportApiReachable(
  latencyMs?: number,
  {
    healthChannel = false,
    observedGeneration,
  }: ApiReachableOptions = {},
) {
  // A response that started before the current outage cannot prove that the
  // server is accepting new work. Without this generation guard, one late
  // response from the retiring development process can close the circuit,
  // restart SSE/background reads, and create another refused-connection wave.
  // The health channel and the single recovery probe deliberately omit an
  // observed generation because they are current reachability checks.
  if (
    snapshot.serverReachable === false
    && observedGeneration !== undefined
    && observedGeneration !== connectivityGeneration
  ) {
    return snapshot
  }
  connectivityGeneration += 1
  recoveryReconnectAttempt = 0
  const measuredLatency = typeof latencyMs === 'number' && Number.isFinite(latencyMs)
    ? Math.max(0, Math.round(latencyMs))
    : snapshot.latencyMs
  const nextMode = snapshot.manualOffline
    ? 'offline'
    : connectionLooksSlow()
      || (!isLoopbackRuntime() && measuredLatency !== null && measuredLatency >= SLOW_RESPONSE_MS)
      ? 'slow'
      : 'online'
  const stateChanged = snapshot.mode !== nextMode
    || !snapshot.browserOnline
    || snapshot.serverReachable !== true
    || snapshot.consecutiveFailures !== 0
    || measuredLatency !== snapshot.latencyMs
  const checkedAt = stateChanged ? nowIso() : snapshot.checkedAt
  const next = stateChanged
    ? publish({
        mode: nextMode,
        browserOnline: true,
        serverReachable: true,
        manualOffline: snapshot.manualOffline,
        latencyMs: measuredLatency,
        checkedAt,
        lastOnlineAt: checkedAt,
        consecutiveFailures: 0,
      })
    : snapshot

  if (healthChannel) {
    socketReconnectAttempt = 0
    clearReconnectTimer()
  } else if (
    monitorConsumers > 0
    && healthSocket === null
    && socketProbeInFlight === null
    && reconnectTimeout === null
  ) {
    scheduleReconnect()
  }
  return next
}

export function setManualOfflineMode(enabled: boolean) {
  if (enabled === snapshot.manualOffline) return snapshot
  persistManualOffline(enabled)
  if (enabled) {
    clearReconnectTimer()
    cancelRecoveryProbe()
    disconnectHealthSocket()
    connectivityGeneration += 1
    return publish({
      ...snapshot,
      mode: 'offline',
      manualOffline: true,
    })
  }
  const browserOnline = browserIsOnline()
  connectivityGeneration += 1
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

export function reportApiUnavailable({
  evidence = 'transport',
  observedGeneration,
}: ApiUnavailableOptions = {}) {
  if (
    observedGeneration !== undefined
    && observedGeneration !== connectivityGeneration
  ) return snapshot
  if (
    evidence === 'timeout'
    && healthSocketReady
    && healthSocket?.readyState === WebSocket.OPEN
    && snapshot.serverReachable === true
  ) {
    return snapshot
  }

  const browserOnline = browserIsOnline()
  const nextMode = snapshot.manualOffline ? 'offline' : browserOnline ? 'server-unreachable' : 'offline'
  const stateChanged = snapshot.mode !== nextMode
    || snapshot.browserOnline !== browserOnline
    || snapshot.serverReachable !== false
  if (stateChanged) connectivityGeneration += 1
  const next = stateChanged
    ? publish({
        ...snapshot,
        mode: nextMode,
        browserOnline,
        serverReachable: false,
        latencyMs: null,
        checkedAt: nowIso(),
        consecutiveFailures: snapshot.consecutiveFailures + 1,
      })
    : snapshot

  disconnectHealthSocket()
  if (browserOnline && !snapshot.manualOffline) {
    clearReconnectTimer()
    scheduleReconnect()
  }
  return next
}

/**
 * Establishes (or explicitly refreshes) the single health channel. A known
 * outage is recovered through one bounded HTTP probe; WebSocket monitoring is
 * reintroduced only after HTTP reachability returns.
 */
export function probeServerConnectivity(options: { force?: boolean } = {}) {
  const force = options.force === true
  if (snapshot.manualOffline || !browserIsOnline()) {
    reportApiUnavailable()
    return Promise.resolve(snapshot)
  }
  if (recoveryProbeInFlight) return recoveryProbeInFlight
  if (snapshot.serverReachable === false) {
    return probeServerViaHttp({ force })
  }
  if (!force && automaticProbeNotBefore > Date.now()) {
    scheduleReconnect()
    return Promise.resolve(snapshot)
  }
  return openHealthSocket({ replace: force })
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
  const handleOnline = () => {
    void probeServerConnectivity({ force: true })
  }
  const handleOffline = () => {
    clearReconnectTimer()
    cancelRecoveryProbe()
    disconnectHealthSocket()
    reportApiUnavailable()
  }
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      checkNow()
      return
    }
    clearReconnectTimer({ preserveDeadline: true })
    cancelRecoveryProbe()
    disconnectHealthSocket()
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('focus', checkNow)
  window.addEventListener('pageshow', checkNow)
  document.addEventListener('visibilitychange', handleVisibility)
  checkNow()

  monitorCleanup = () => {
    clearReconnectTimer()
    cancelRecoveryProbe()
    disconnectHealthSocket()
    window.removeEventListener('online', handleOnline)
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
  clearReconnectTimer()
  cancelRecoveryProbe()
  monitorCleanup?.()
  disconnectHealthSocket()
  recoveryReconnectAttempt = 0
  socketReconnectAttempt = 0
  connectivityGeneration = 0
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
