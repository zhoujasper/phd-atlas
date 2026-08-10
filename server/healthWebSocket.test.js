import http from 'node:http'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { attachHealthWebSocket } from './healthWebSocket.js'

let server
let hub
let endpoint

function connectHealthSocket(origin = 'http://localhost:5173', target = endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target, { headers: { Origin: origin } })
    const fail = (error) => {
      socket.close()
      reject(error)
    }
    socket.once('error', fail)
    socket.once('message', (value) => {
      socket.off('error', fail)
      resolve({ socket, message: JSON.parse(value.toString()) })
    })
  })
}

function rejectedHealthSocket(target, origin = 'http://localhost:5173') {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target, { headers: { Origin: origin } })
    socket.once('unexpected-response', (_request, response) => {
      const result = { statusCode: response.statusCode, headers: response.headers }
      response.resume()
      response.once('end', () => resolve(result))
    })
    socket.once('open', () => {
      socket.terminate()
      reject(new Error('Expected the health WebSocket upgrade to be rejected.'))
    })
    socket.once('error', reject)
  })
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  socket.close()
  return once(socket, 'close')
}

async function waitForClientCount(expectedCount, targetHub = hub) {
  const deadline = Date.now() + 500
  while (targetHub.clientCount() !== expectedCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(targetHub.clientCount()).toBe(expectedCount)
}

async function startHealthServer(options = {}) {
  const localServer = http.createServer()
  const localHub = attachHealthWebSocket(localServer, options)
  localServer.listen(0, '127.0.0.1')
  await once(localServer, 'listening')
  const address = localServer.address()
  return {
    server: localServer,
    hub: localHub,
    endpoint: `ws://127.0.0.1:${address.port}/api/health/ws`,
  }
}

async function closeHealthServer(instance) {
  instance.hub.close()
  if (!instance.server.listening) return
  await new Promise((resolve, reject) => {
    instance.server.close((error) => (error ? reject(error) : resolve()))
  })
}

beforeAll(async () => {
  server = http.createServer()
  hub = attachHealthWebSocket(server, {
    heartbeatMs: 20,
    maxConnectionsPerIp: 4,
    retryAfterBaseMs: 1_000,
    retryAfterJitterMs: 1_000,
    random: () => 0.5,
    isOriginAllowed: (origin) => origin !== 'https://rejected.example',
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  endpoint = `ws://127.0.0.1:${address.port}/api/health/ws`
})

afterAll(async () => {
  hub.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('health WebSocket', () => {
  it('accepts concurrent clients and sends each a health-ready event', async () => {
    const clients = await Promise.all(Array.from({ length: 4 }, () => connectHealthSocket()))

    expect(hub.clientCount()).toBe(4)
    for (const client of clients) {
      expect(client.message).toMatchObject({ type: 'ready', ok: true })
    }

    await Promise.all(clients.map(({ socket }) => closeSocket(socket)))
    await waitForClientCount(0)
  })

  it('rejects upgrades while startup storage is not ready and accepts them after readiness', async () => {
    let startupState = { status: 'retrying', retryDelayMs: 2_600 }
    const instance = await startHealthServer({
      heartbeatMs: 5_000,
      isReady: (state) => state?.status === 'ready',
      getStartupState: () => startupState,
    })
    let client = null
    try {
      const rejected = await rejectedHealthSocket(instance.endpoint)

      expect(rejected.statusCode).toBe(503)
      expect(rejected.headers['retry-after']).toBe('3')
      expect(rejected.headers['x-phd-retry-after-ms']).toBe('2600')
      expect(instance.hub.clientCount()).toBe(0)

      startupState = { status: 'ready', retryDelayMs: null }
      client = await connectHealthSocket(undefined, instance.endpoint)
      expect(client.message).toMatchObject({ type: 'ready', ok: true })
      expect(instance.hub.clientCount()).toBe(1)
    } finally {
      if (client) await closeSocket(client.socket)
      await closeHealthServer(instance)
    }
  })

  it('stops an established health channel without emitting ok when readiness is lost', async () => {
    let ready = true
    const instance = await startHealthServer({
      heartbeatMs: 20,
      isReady: () => ready,
    })
    let client = null
    try {
      client = await connectHealthSocket(undefined, instance.endpoint)
      expect(client.message).toMatchObject({ type: 'ready', ok: true })

      const messages = []
      client.socket.on('message', (value) => messages.push(JSON.parse(value.toString())))
      const closed = once(client.socket, 'close')
      ready = false
      await closed

      expect(messages).toEqual([])
      await waitForClientCount(0, instance.hub)
    } finally {
      if (client) await closeSocket(client.socket)
      await closeHealthServer(instance)
    }
  })

  it('supports 300 health clients sharing one NAT address by default and releases every slot', async () => {
    const instance = await startHealthServer({ heartbeatMs: 5_000 })
    let clients = []
    try {
      // Keep all 300 sockets resident while opening them in bounded waves. A
      // single 300-SYN burst can overflow the Windows test listener backlog
      // before the WebSocket capacity controller gets to evaluate the upgrade.
      for (let offset = 0; offset < 300; offset += 50) {
        clients.push(...await Promise.all(
          Array.from({ length: 50 }, () => connectHealthSocket(undefined, instance.endpoint)),
        ))
      }

      expect(instance.hub.clientCount()).toBe(300)
      expect(clients.every(({ message }) => message.type === 'ready' && message.ok === true)).toBe(true)

      await Promise.all(clients.map(({ socket }) => closeSocket(socket)))
      await waitForClientCount(0, instance.hub)
    } finally {
      await Promise.allSettled(clients.map(({ socket }) => closeSocket(socket)))
      await closeHealthServer(instance)
    }
  }, 15_000)

  it('rejects excess same-IP clients with randomized retry guidance without leaking a slot', async () => {
    const clients = await Promise.all(Array.from({ length: 4 }, () => connectHealthSocket()))

    const rejected = await rejectedHealthSocket(endpoint)

    expect(rejected.statusCode).toBe(429)
    expect(rejected.headers['retry-after']).toBe('2')
    expect(rejected.headers['x-phd-retry-after-ms']).toBe('1500')
    expect(hub.clientCount()).toBe(4)

    await Promise.all(clients.map(({ socket }) => closeSocket(socket)))
    await waitForClientCount(0)
  })

  it('enforces a configurable global cap and reuses a slot immediately after close', async () => {
    const instance = await startHealthServer({
      heartbeatMs: 5_000,
      maxConnectionsPerIp: 128,
      maxConnections: 2,
      retryAfterBaseMs: 800,
      retryAfterJitterMs: 400,
      random: () => 0.5,
    })
    let clients = []
    try {
      clients = await Promise.all(
        Array.from({ length: 2 }, () => connectHealthSocket(undefined, instance.endpoint)),
      )
      const rejected = await rejectedHealthSocket(instance.endpoint)

      expect(rejected.statusCode).toBe(503)
      expect(rejected.headers['retry-after']).toBe('1')
      expect(rejected.headers['x-phd-retry-after-ms']).toBe('1000')
      expect(instance.hub.clientCount()).toBe(2)

      await closeSocket(clients[0].socket)
      await waitForClientCount(1, instance.hub)
      const replacement = await connectHealthSocket(undefined, instance.endpoint)
      clients.push(replacement)
      expect(instance.hub.clientCount()).toBe(2)

      await Promise.all(clients.slice(1).map(({ socket }) => closeSocket(socket)))
      await waitForClientCount(0, instance.hub)
    } finally {
      await Promise.allSettled(clients.map(({ socket }) => closeSocket(socket)))
      await closeHealthServer(instance)
    }
  })

  it('terminates every active connection and clears capacity during hub shutdown', async () => {
    const instance = await startHealthServer({ heartbeatMs: 5_000 })
    let clients = []
    try {
      clients = await Promise.all(
        Array.from({ length: 8 }, () => connectHealthSocket(undefined, instance.endpoint)),
      )
      const closed = clients.map(({ socket }) => once(socket, 'close'))

      instance.hub.close()

      await Promise.all(closed)
      expect(instance.hub.clientCount()).toBe(0)
      const rejected = await rejectedHealthSocket(instance.endpoint)
      expect(rejected.statusCode).toBe(503)
      expect(rejected.headers['retry-after']).toBeTruthy()
    } finally {
      await Promise.allSettled(clients.map(({ socket }) => closeSocket(socket)))
      await closeHealthServer(instance)
    }
  })

  it('rejects a disallowed cross-origin upgrade before allocating a connection', async () => {
    const status = await new Promise((resolve, reject) => {
      const socket = new WebSocket(endpoint, { headers: { Origin: 'https://rejected.example' } })
      socket.once('unexpected-response', (_request, response) => {
        response.resume()
        resolve(response.statusCode)
      })
      socket.once('error', reject)
    })

    expect(status).toBe(403)
    expect(hub.clientCount()).toBe(0)
  })
})
