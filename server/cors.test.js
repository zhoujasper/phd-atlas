import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'

let server
let baseUrl
let originalCorsOrigin

beforeAll(async () => {
  originalCorsOrigin = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN
  else process.env.CORS_ORIGIN = originalCorsOrigin
})

describe('development CORS policy', () => {
  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.1.25:5173',
    'http://172.20.10.4:5173',
    'http://phd-atlas-dev:5173',
    'http://phd-atlas.local:5173',
    'http://[::1]:5173',
    'http://[fd12:3456::2]:5173',
  ])('allows the Vite app from local development origin %s', async (origin) => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { origin } })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it.each([
    'https://example.com',
    'https://phd-atlas.example.com',
  ])('rejects public origin %s as a handled 403 response', async (origin) => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { origin } })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'CORS_ORIGIN_DENIED',
        message: 'Request origin is not allowed.',
      },
    })
  })

  it('uses an explicit CORS_ORIGIN allowlist instead of the development defaults', async () => {
    process.env.CORS_ORIGIN = 'https://trusted.example'
    try {
      const trustedResponse = await fetch(`${baseUrl}/api/health`, {
        headers: { origin: 'https://trusted.example' },
      })
      const localResponse = await fetch(`${baseUrl}/api/health`, {
        headers: { origin: 'http://localhost:5173' },
      })

      expect(trustedResponse.status).toBe(200)
      expect(trustedResponse.headers.get('access-control-allow-origin')).toBe('https://trusted.example')
      expect(localResponse.status).toBe(403)
    } finally {
      delete process.env.CORS_ORIGIN
    }
  })
})
