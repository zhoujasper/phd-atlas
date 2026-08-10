import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import { readStore } from './storage.js'

let app
let server
let baseUrl
let token

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

async function authenticatedGet(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })
}

describe.sequential('authenticated shared GET store purity', () => {
  beforeAll(async () => {
    app = createApp()
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'jasper@example.com',
        password: 'demo123456',
      }),
    })
    const payload = await response.json()
    expect(response.status, JSON.stringify(payload)).toBe(200)
    token = payload.data.token
  })

  afterAll(async () => {
    await app?.locals.stopRecurringTasks?.()
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('serves the core session, application, and bootstrap reads without mutating their shared snapshot', async () => {
    const sharedStore = await readStore({ cache: true })
    const before = JSON.stringify(sharedStore)
    deepFreeze(sharedStore)

    for (const path of [
      '/api/auth/me',
      '/api/applications',
      '/api/applications/trash',
      '/api/profile-assets',
      '/api/analytics',
      '/api/workspace/bootstrap',
    ]) {
      const response = await authenticatedGet(path)
      const payload = await response.json()
      expect(response.status, `${path}: ${JSON.stringify(payload)}`).toBe(200)
      expect(payload.ok, path).toBe(true)
    }

    const headResponse = await authenticatedGet('/api/applications', { method: 'HEAD' })
    expect(headResponse.status).toBe(200)
    expect(await headResponse.text()).toBe('')

    expect(await readStore({ cache: true })).toBe(sharedStore)
    expect(JSON.stringify(sharedStore)).toBe(before)
  })

  it('keeps realtime subscription behavior after releasing hydrated store references', async () => {
    const cancellation = new AbortController()
    const response = await authenticatedGet('/api/events', { signal: cancellation.signal })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('event: connected')
    cancellation.abort()
    await reader.cancel().catch(() => undefined)
  })
})
