import http from 'node:http'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { attachHealthWebSocket } from './healthWebSocket.js'

let server
let hub
let endpoint

function connectHealthSocket(origin = 'http://localhost:5173') {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, { headers: { Origin: origin } })
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

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  socket.close()
  return once(socket, 'close')
}

async function waitForClientCount(expectedCount) {
  const deadline = Date.now() + 500
  while (hub.clientCount() !== expectedCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(hub.clientCount()).toBe(expectedCount)
}

beforeAll(async () => {
  server = http.createServer()
  hub = attachHealthWebSocket(server, {
    heartbeatMs: 20,
    maxConnectionsPerIp: 4,
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
