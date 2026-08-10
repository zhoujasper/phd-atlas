import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let app
let server
let baseUrl
let testRoot
let token
let storage

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-rate-limit-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '0')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.stubEnv('AUTHENTICATED_UPLOAD_MAX_PER_HOUR', '2')
  vi.stubEnv('ADMIN_PASSWORD_CHANGE_MAX_PER_10M', '2')
  vi.resetModules()

  storage = await import('./storage.js')
  await storage.ensureStorage()
  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456', scope: 'app' }),
  })
  const loginPayload = await loginResponse.json()
  if (!loginResponse.ok) {
    throw new Error(`Rate-limit fixture login failed: ${JSON.stringify(loginPayload)}`)
  }
  token = loginPayload.data.token
}, 90_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

async function jsonResponse(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options)
}

describe('rate-limit retry contract', () => {
  it('returns Retry-After when the auth challenge bucket is exhausted', async () => {
    let limited
    for (let index = 0; index < 31; index += 1) {
      const response = await jsonResponse('/api/auth/captcha')
      if (response.status === 429) {
        limited = response
        break
      }
      await response.arrayBuffer()
    }
    expect(limited).toBeTruthy()
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(await limited.json()).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('returns Retry-After when the authenticated upload bucket is exhausted', async () => {
    let limited
    for (let index = 0; index < 3; index += 1) {
      const response = await jsonResponse('/api/applications/sample/materials/sample/file', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status === 429) {
        limited = response
        break
      }
      await response.arrayBuffer()
    }
    expect(limited).toBeTruthy()
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(await limited.json()).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('returns Retry-After when the admin password change bucket is exhausted', async () => {
    let limited
    for (let index = 0; index < 3; index += 1) {
      const response = await jsonResponse('/api/admin/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password' }),
      })
      if (response.status === 429) {
        limited = response
        break
      }
      await response.arrayBuffer()
    }
    expect(limited).toBeTruthy()
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(await limited.json()).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })
})
