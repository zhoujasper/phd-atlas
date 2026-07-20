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

const PROBE_TIMEOUT_MS = 4_500
const PROBE_FRESHNESS_MS = 10_000
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

export async function probeServerConnectivity(options: { force?: boolean } = {}) {
  if (snapshot.manualOffline) return snapshot
  if (!browserIsOnline()) {
    return publish({
      ...snapshot,
      mode: 'offline',
      browserOnline: false,
      serverReachable: false,
      latencyMs: null,
      checkedAt: nowIso(),
      consecutiveFailures: snapshot.consecutiveFailures + 1,
    })
  }
  if (probeInFlight && !options.force) return probeInFlight
  if (!options.force && snapshot.checkedAt) {
    const checkedAt = Date.parse(snapshot.checkedAt)
    if (Number.isFinite(checkedAt) && Date.now() - checkedAt < PROBE_FRESHNESS_MS) return snapshot
  }

  const previous = snapshot
  publish({
    ...previous,
    mode: previous.manualOffline
      ? 'offline'
      : previous.serverReachable === true ? previous.mode : 'checking',
    browserOnline: true,
  })
  probeInFlight = (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const startedAt = performance.now()
    try {
      const response = await fetch(`/api/health?connectivity=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'X-Phd-Atlas-Connectivity-Probe': '1' },
        signal: controller.signal,
      })
      // A Vite proxy can answer while the Express API behind it is completely
      // unavailable. Only Atlas' successful JSON envelope proves business
      // operations can actually reach the server.
      if (!response.ok) return reportApiUnavailable()
      const payload = await response.json() as { ok?: unknown }
      if (payload?.ok === true) return reportApiReachable(performance.now() - startedAt)
      return reportApiUnavailable()
    } catch {
      return reportApiUnavailable()
    } finally {
      window.clearTimeout(timeout)
      probeInFlight = null
    }
  })()
  return probeInFlight
}

export function startConnectivityMonitoring() {
  // Unit tests own fetch deterministically. Background health probes would
  // consume mocked API responses that belong to the component under test.
  if (import.meta.env.MODE === 'test') return () => undefined
  monitorConsumers += 1
  if (monitorCleanup) return stopConnectivityMonitoring

  let timer: number | null = null
  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer)
    const delay = connectivityUnavailable() ? 10_000 : 30_000
    timer = window.setTimeout(async () => {
      if (document.visibilityState === 'visible') await probeServerConnectivity()
      schedule()
    }, delay)
  }
  const checkNow = () => {
    // A focus, pageshow and visibility event often arrive as one burst. Reuse
    // the recent result (or the request already in flight) instead of making
    // three identical health calls.
    void probeServerConnectivity().finally(schedule)
  }
  const handleOffline = () => {
    reportApiUnavailable()
    schedule()
  }
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') checkNow()
  }

  window.addEventListener('online', checkNow)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('focus', checkNow)
  window.addEventListener('pageshow', checkNow)
  document.addEventListener('visibilitychange', handleVisibility)
  checkNow()

  monitorCleanup = () => {
    if (timer !== null) window.clearTimeout(timer)
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
  monitorCleanup?.()
  probeInFlight = null
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
