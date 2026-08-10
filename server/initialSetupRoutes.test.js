import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let app
let server
let baseUrl
let storage
let testRoot
let operatorToken
const clientA = 'setup-browser-a'
const clientB = 'setup-browser-b'

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-setup-security-'))
  operatorToken = randomBytes(32).toString('base64url')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', randomBytes(48).toString('base64url'))
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.stubEnv('PHD_ATLAS_BOOTSTRAP_TOKEN', operatorToken)
  vi.doMock('./edition.js', () => ({
    PUBLIC_DISTRIBUTION: true,
    PUBLIC_EDITION: false,
  }))
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const store = await storage.readStore()
  for (const user of store.users) {
    if (user.role === 'admin') user.role = 'user'
  }
  await storage.writeStore(store)
  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 90_000)

afterAll(async () => {
  await app?.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  await storage?.shutdownStorage().catch(() => undefined)
  vi.doUnmock('./edition.js')
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 90_000)

describe('public initial-setup route boundary', () => {
  it('rejects every probe-capable setup route before a browser owns the out-of-band claim', async () => {
    const requests = await Promise.all([
      fetch(`${baseUrl}/api/setup/secrets`, {
        headers: { 'x-phd-client-id': clientA },
      }),
      fetch(`${baseUrl}/api/setup/secrets/regenerate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-phd-client-id': clientA,
        },
        body: JSON.stringify({ confirm: 'REGENERATE' }),
      }),
      fetch(`${baseUrl}/api/setup/smtp-verification/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-phd-client-id': clientA,
        },
        body: JSON.stringify({ smtpHost: '169.254.169.254' }),
      }),
      fetch(`${baseUrl}/api/setup`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-phd-client-id': clientA,
        },
        body: JSON.stringify({ database: { type: 'postgresql', host: '169.254.169.254' } }),
      }),
    ])
    expect(requests.map((response) => response.status)).toEqual([401, 401, 401, 401])
    for (const response of requests) {
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'BOOTSTRAP_CLAIM_REQUIRED' },
      })
    }
  })

  it('atomically binds one client and never returns full long-lived keys', async () => {
    const invalid = await fetch(`${baseUrl}/api/setup/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-phd-client-id': clientA,
      },
      body: JSON.stringify({ token: 'invalid' }),
    })
    expect(invalid.status).toBe(401)

    const claimed = await fetch(`${baseUrl}/api/setup/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-phd-client-id': clientA,
      },
      body: JSON.stringify({ token: operatorToken }),
    })
    const claimPayload = await claimed.json()
    expect(claimed.status).toBe(200)
    expect(claimPayload.data.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    const competing = await fetch(`${baseUrl}/api/setup/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-phd-client-id': clientB,
      },
      body: JSON.stringify({ token: operatorToken }),
    })
    expect(competing.status).toBe(409)

    const secrets = await fetch(`${baseUrl}/api/setup/secrets`, {
      headers: {
        'x-phd-client-id': clientA,
        'x-phd-bootstrap-claim': claimPayload.data.token,
      },
    })
    const secretsPayload = await secrets.json()
    expect(secrets.status).toBe(200)
    expect(secretsPayload.data).toMatchObject({
      jwtSecretPreview: expect.any(String),
      encryptionKeyPreview: expect.any(String),
    })
    expect(secretsPayload.data).not.toHaveProperty('jwtSecret')
    expect(secretsPayload.data).not.toHaveProperty('encryptionKey')
    expect(JSON.stringify(secretsPayload)).not.toContain(process.env.JWT_SECRET)
    expect(JSON.stringify(secretsPayload)).not.toContain(process.env.SETTINGS_ENCRYPTION_KEY)
  })
})
