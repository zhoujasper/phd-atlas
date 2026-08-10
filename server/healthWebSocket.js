import { WebSocket, WebSocketServer } from 'ws'

const DEFAULT_PATH = '/api/health/ws'
const HEARTBEAT_MS = 15_000
const DEFAULT_MAX_CONNECTIONS_PER_IP = 512
const DEFAULT_MAX_CONNECTIONS = 512
const MAX_BUFFERED_BYTES = 64 * 1024
const RETRY_AFTER_BASE_MS = 1_000
const RETRY_AFTER_JITTER_MS = 2_000

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function boundedRandom(random) {
  try {
    const value = Number(random())
    if (!Number.isFinite(value)) return 0.5
    return Math.min(1, Math.max(0, value))
  } catch {
    return 0.5
  }
}

function retryDelayMs(baseMs, jitterMs, random) {
  const base = Math.max(1, Number(baseMs) || RETRY_AFTER_BASE_MS)
  const jitter = Math.max(0, Number(jitterMs) || 0)
  return Math.ceil(base + (jitter * boundedRandom(random)))
}

function requestPath(request) {
  try {
    return new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
  } catch {
    return ''
  }
}

function rejectUpgrade(socket, statusCode, message, retryAfterMs = null) {
  if (!socket.writable) {
    socket.destroy()
    return
  }
  const retryHeaders = Number.isFinite(retryAfterMs)
    ? `Retry-After: ${Math.max(1, Math.ceil(retryAfterMs / 1_000))}\r\nX-PhD-Retry-After-Ms: ${Math.ceil(retryAfterMs)}\r\n`
    : ''
  socket.end(
    `HTTP/1.1 ${statusCode} ${message}\r\n${retryHeaders}Connection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

/**
 * Attaches the unauthenticated, server-health WebSocket endpoint to an HTTP
 * server. It deliberately owns no application data: concurrent connections
 * only maintain local socket metadata, so they cannot contend with SQLite
 * writes or other request locks.
 */
export function attachHealthWebSocket(server, {
  path = DEFAULT_PATH,
  isOriginAllowed = () => true,
  isReady = () => true,
  getStartupState = () => null,
  heartbeatMs = HEARTBEAT_MS,
  maxConnectionsPerIp = positiveInteger(
    process.env.PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS_PER_IP,
    DEFAULT_MAX_CONNECTIONS_PER_IP,
  ),
  maxConnections = positiveInteger(
    process.env.PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS,
    DEFAULT_MAX_CONNECTIONS,
  ),
  retryAfterBaseMs = RETRY_AFTER_BASE_MS,
  retryAfterJitterMs = RETRY_AFTER_JITTER_MS,
  random = Math.random,
} = {}) {
  const perIpLimit = positiveInteger(maxConnectionsPerIp, DEFAULT_MAX_CONNECTIONS_PER_IP)
  const globalLimit = positiveInteger(maxConnections, DEFAULT_MAX_CONNECTIONS)
  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: 1024,
    perMessageDeflate: false,
  })
  const clients = new Set()
  const clientsByIp = new Map()
  const pendingByIp = new Map()
  const pendingSockets = new Set()
  let pendingUpgradeCount = 0
  let heartbeatTimer = null
  let closed = false

  const readiness = () => {
    try {
      const startupState = getStartupState()
      return {
        ready: isReady(startupState) === true,
        retryAfterMs: Number(startupState?.retryDelayMs),
      }
    } catch {
      // Health must fail closed. A broken readiness callback must never turn a
      // storage/startup failure into a false-positive `ok: true` event.
      return { ready: false, retryAfterMs: Number.NaN }
    }
  }

  const stopHeartbeatWhenIdle = () => {
    if (clients.size !== 0 || heartbeatTimer === null) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  const removeClient = (client) => {
    if (!clients.delete(client)) return
    const remaining = (clientsByIp.get(client.ip) ?? 1) - 1
    if (remaining > 0) clientsByIp.set(client.ip, remaining)
    else clientsByIp.delete(client.ip)
    stopHeartbeatWhenIdle()
  }

  const terminateClient = (client) => {
    removeClient(client)
    try {
      client.socket.terminate()
    } catch {
      // The close/error path may already have destroyed the socket.
    }
  }

  const sendHealthEvent = (client, type) => {
    const socket = client.socket
    if (socket.readyState !== WebSocket.OPEN) return false
    if (!readiness().ready) {
      terminateClient(client)
      return false
    }
    // A slow consumer must never hold server resources or other health
    // connections hostage. Termination also frees its IP connection slot.
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      terminateClient(client)
      return false
    }
    try {
      socket.send(JSON.stringify({
        type,
        ok: true,
        at: new Date().toISOString(),
      }))
      return true
    } catch {
      terminateClient(client)
      return false
    }
  }

  const ensureHeartbeat = () => {
    if (heartbeatTimer !== null || closed) return
    heartbeatTimer = setInterval(() => {
      for (const client of [...clients]) {
        const socket = client.socket
        if (socket.readyState !== WebSocket.OPEN) {
          removeClient(client)
          continue
        }
        if (client.awaitingPong) {
          terminateClient(client)
          continue
        }
        client.awaitingPong = true
        if (!sendHealthEvent(client, 'heartbeat')) continue
        try {
          socket.ping()
        } catch {
          terminateClient(client)
        }
      }
    }, heartbeatMs)
    heartbeatTimer.unref?.()
  }

  const upgrade = (request, socket, head) => {
    const retryAfterMs = () => retryDelayMs(retryAfterBaseMs, retryAfterJitterMs, random)
    if (requestPath(request) !== path) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    if (closed) {
      rejectUpgrade(socket, 503, 'Service Unavailable', retryAfterMs())
      return
    }
    if (!isOriginAllowed(request.headers.origin)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    const startupReadiness = readiness()
    if (!startupReadiness.ready) {
      rejectUpgrade(
        socket,
        503,
        'Service Unavailable',
        Number.isFinite(startupReadiness.retryAfterMs) && startupReadiness.retryAfterMs > 0
          ? startupReadiness.retryAfterMs
          : retryAfterMs(),
      )
      return
    }

    const ip = String(request.socket.remoteAddress ?? 'unknown')
    if (clients.size + pendingUpgradeCount >= globalLimit) {
      rejectUpgrade(socket, 503, 'Service Unavailable', retryAfterMs())
      return
    }
    if ((clientsByIp.get(ip) ?? 0) + (pendingByIp.get(ip) ?? 0) >= perIpLimit) {
      rejectUpgrade(socket, 429, 'Too Many Requests', retryAfterMs())
      return
    }

    pendingUpgradeCount += 1
    pendingByIp.set(ip, (pendingByIp.get(ip) ?? 0) + 1)
    pendingSockets.add(socket)
    let reservationReleased = false
    const releaseReservation = () => {
      if (reservationReleased) return
      reservationReleased = true
      pendingSockets.delete(socket)
      pendingUpgradeCount = Math.max(0, pendingUpgradeCount - 1)
      const remaining = (pendingByIp.get(ip) ?? 1) - 1
      if (remaining > 0) pendingByIp.set(ip, remaining)
      else pendingByIp.delete(ip)
    }
    const abandonReservation = () => releaseReservation()
    socket.once('close', abandonReservation)
    socket.once('error', abandonReservation)

    try {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        socket.off('close', abandonReservation)
        socket.off('error', abandonReservation)
        releaseReservation()
        if (closed) {
          webSocket.terminate()
          return
        }
        if (!readiness().ready) {
          webSocket.terminate()
          return
        }
        webSocketServer.emit('connection', webSocket, request, ip)
      })
    } catch {
      socket.off('close', abandonReservation)
      socket.off('error', abandonReservation)
      releaseReservation()
      socket.destroy()
    }
  }

  webSocketServer.on('connection', (socket, _request, ip) => {
    const client = { socket, ip, awaitingPong: false }
    clients.add(client)
    clientsByIp.set(ip, (clientsByIp.get(ip) ?? 0) + 1)
    ensureHeartbeat()

    socket.on('pong', () => {
      client.awaitingPong = false
    })
    socket.once('close', () => removeClient(client))
    socket.once('error', () => terminateClient(client))

    if (!sendHealthEvent(client, 'ready')) terminateClient(client)
  })

  server.on('upgrade', upgrade)

  const close = () => {
    if (closed) return
    closed = true
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    for (const client of [...clients]) client.socket.terminate()
    for (const socket of [...pendingSockets]) socket.destroy()
    clients.clear()
    clientsByIp.clear()
    pendingByIp.clear()
    pendingSockets.clear()
    pendingUpgradeCount = 0
    webSocketServer.close()
  }
  server.once('close', () => {
    server.off('upgrade', upgrade)
    close()
  })

  return {
    close,
    clientCount: () => clients.size,
  }
}
