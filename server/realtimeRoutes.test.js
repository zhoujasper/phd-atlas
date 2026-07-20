import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'

let server
let baseUrl

beforeAll(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'jasper@example.com',
      password: 'demo123456',
      scope: 'app',
    }),
  })
  const payload = await response.json()
  return payload.data.token
}

async function nextEvent(reader, decoder, state) {
  while (true) {
    const separator = state.buffer.search(/\r?\n\r?\n/)
    if (separator >= 0) {
      const block = state.buffer.slice(0, separator)
      const match = state.buffer.slice(separator).match(/^\r?\n\r?\n/)
      state.buffer = state.buffer.slice(separator + (match?.[0].length ?? 2))
      const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))
      if (data) return JSON.parse(data.slice(5).trim())
    }
    const { done, value } = await reader.read()
    if (done) throw new Error('Realtime stream closed before the expected event.')
    state.buffer += decoder.decode(value, { stream: true })
  }
}

describe('authenticated realtime route', () => {
  it('returns the full workspace startup graph in one conditional response', async () => {
    const token = await login()
    const first = await fetch(`${baseUrl}/api/workspace/bootstrap`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')
    const payload = await first.json()
    expect(payload.data).toMatchObject({
      me: { user: { email: 'jasper@example.com' } },
    })
    expect(Array.isArray(payload.data.applications)).toBe(true)
    expect(Array.isArray(payload.data.profileAssets)).toBe(true)
    expect(Array.isArray(payload.data.teamWorkspaces)).toBe(true)

    const revalidated = await fetch(`${baseUrl}/api/workspace/bootstrap`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'If-None-Match': etag,
      },
    })
    expect(revalidated.status).toBe(304)
  })

  it('serves repeated workspace reads from the revision cache before recomputing the payload', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}` }
    const first = await fetch(`${baseUrl}/api/applications`, { headers })
    expect(first.status).toBe(200)
    expect(first.headers.get('server-timing')).toContain('desc="miss"')
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    await first.arrayBuffer()

    const cached = await fetch(`${baseUrl}/api/applications`, { headers })
    expect(cached.status).toBe(200)
    expect(cached.headers.get('server-timing')).toContain('desc="hit"')
    await cached.arrayBuffer()

    const revalidated = await fetch(`${baseUrl}/api/applications`, {
      headers: { ...headers, 'If-None-Match': etag },
    })
    expect(revalidated.status).toBe(304)
    expect(revalidated.headers.get('server-timing')).toContain('desc="hit"')
  })

  it('streams a scoped invalidation after a successful mutation from another tab', async () => {
    const token = await login()
    const controller = new AbortController()
    const streamResponse = await fetch(`${baseUrl}/api/events`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Phd-Client-Id': 'reader-tab',
      },
      signal: controller.signal,
    })
    expect(streamResponse.status).toBe(200)
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream')
    const reader = streamResponse.body.getReader()
    const decoder = new TextDecoder()
    const state = { buffer: '' }

    await expect(nextEvent(reader, decoder, state)).resolves.toMatchObject({ type: 'connected' })
    const mutation = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Phd-Client-Id': 'writer-tab',
      },
    })
    expect(mutation.status).toBe(200)
    await expect(nextEvent(reader, decoder, state)).resolves.toMatchObject({
      type: 'invalidate',
      scopes: ['notifications'],
    })

    controller.abort()
    await reader.cancel().catch(() => undefined)
  })
})
