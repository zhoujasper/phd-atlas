import { WebSocket, WebSocketServer } from 'ws'

const DEFAULT_PATH = '/api/health/ws'
const HEARTBEAT_MS = 15_000
const MAX_CONNECTIONS_PER_IP = 12
const MAX_BUFFERED_BYTES = 64 * 1024

function requestPath(request) {
  try {
    return new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
  } catch {
    return ''
  }
}

function rejectUpgrade(socket, statusCode, message) {
  if (!socket.writable) {
    socket.destroy()
    return
  }
  socket.end(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
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
  heartbeatMs = HEARTBEAT_MS,
  maxConnectionsPerIp = MAX_CONNECTIONS_PER_IP,
} = {}) {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: 1024,
    perMessageDeflate: false,
  })
  const clients = new Set()
  const clientsByIp = new Map()
  let heartbeatTimer = null
  let closed = false

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

  const sendHealthEvent = (client, type) => {
    const socket = client.socket
    if (socket.readyState !== WebSocket.OPEN) return false
    // A slow consumer must never hold server resources or other health
    // connections hostage. Termination also frees its IP connection slot.
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate()
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
      socket.terminate()
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
          socket.terminate()
          continue
        }
        client.awaitingPong = true
        if (!sendHealthEvent(client, 'heartbeat')) continue
        try {
          socket.ping()
        } catch {
          socket.terminate()
        }
      }
    }, heartbeatMs)
    heartbeatTimer.unref?.()
  }

  const upgrade = (request, socket, head) => {
    if (requestPath(request) !== path) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    if (closed) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    if (!isOriginAllowed(request.headers.origin)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }

    const ip = String(request.socket.remoteAddress ?? 'unknown')
    if ((clientsByIp.get(ip) ?? 0) >= maxConnectionsPerIp) {
      rejectUpgrade(socket, 429, 'Too Many Requests')
      return
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request, ip)
    })
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
    socket.once('error', () => removeClient(client))

    if (!sendHealthEvent(client, 'ready')) socket.terminate()
  })

  server.on('upgrade', upgrade)

  const close = () => {
    if (closed) return
    closed = true
    server.off('upgrade', upgrade)
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    for (const client of [...clients]) client.socket.terminate()
    clients.clear()
    clientsByIp.clear()
    webSocketServer.close()
  }
  server.once('close', close)

  return {
    close,
    clientCount: () => clients.size,
  }
}
