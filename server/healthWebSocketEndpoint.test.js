import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createApp } from './index.js'

let server
let httpBase
let webSocketEndpoint

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  httpBase = `http://127.0.0.1:${address.port}`
  webSocketEndpoint = `ws://127.0.0.1:${address.port}/api/health/ws`
})

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('health WebSocket endpoint wiring', () => {
  it('attaches to apps launched through createApp().listen()', async () => {
    const payload = await new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketEndpoint, { headers: { Origin: 'http://localhost:5173' } })
      socket.once('error', reject)
      socket.once('message', (message) => {
        const parsed = JSON.parse(message.toString())
        socket.close()
        socket.once('close', () => resolve(parsed))
      })
    })

    expect(payload).toMatchObject({ type: 'ready', ok: true })
  })

  it('returns a clear upgrade error instead of an authentication 401 for an HTTP fallback', async () => {
    const response = await fetch(`${httpBase}/api/health/ws`)
    const payload = await response.json()

    expect(response.status).toBe(426)
    expect(payload).toMatchObject({
      ok: false,
      error: { code: 'WEBSOCKET_REQUIRED' },
    })
  })
})
