import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let root, storage, createApp, app, listener, origin, session
const secret = randomBytes(48).toString('base64url')

async function start() {
  app = createApp({ desktopEnabled: true, desktopStorageRoot: root })
  listener = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => listener.once('listening', resolve))
  origin = `http://127.0.0.1:${listener.address().port}`
}

async function stop() {
  await app?.locals.stopRecurringTasks?.()
  if (listener) await new Promise((resolve) => listener.close(resolve))
  listener = null
}

async function request(route, { token = session?.token, body, method = 'GET', headers = {} } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { connection: 'close', 'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, headers: response.headers, ...(await response.json()) }
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'phdatlas-desktop-offline-http-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_DESKTOP', '1')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', root)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(root, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', randomBytes(32).toString('base64url'))
  vi.stubEnv('JWT_SECRET', secret)
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', randomBytes(48).toString('base64url'))
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  createApp = (await import('./index.js')).createApp
  await start()
}, 90_000)

afterAll(async () => {
  await stop()
  await storage?.shutdownStorage()
  vi.unstubAllEnvs()
  vi.resetModules()
  if (root) await fs.rm(root, { recursive: true, force: true })
}, 90_000)

describe.sequential('offline desktop identity and persistence', () => {
  it('starts with one local owner and an empty workspace without website setup or login', async () => {
    const opened = await request('/api/desktop/session', { method: 'POST', body: {}, token: null })
    expect(opened.status, JSON.stringify(opened.error)).toBe(200)
    session = opened.data
    expect(session.user.email).toBe('local@desktop.phd-atlas')
    expect(session.runtime).toMatchObject({ unlocked: true, unlockRequired: false, unlimited: true })
    const stored = await storage.readStore()
    expect(stored.users).toHaveLength(1)
    expect(stored.users[0].role).toBe('user')
    expect(stored.applications).toEqual([])
    expect(stored.profileAssets).toEqual([])
    const settingsSaved = await request('/api/settings', { method: 'PATCH', body: { language: 'ja' }, headers: {
      'X-PhD-Settings-Acknowledgement': 'v1',
      'X-PhD-Settings-Mutation-Id': 'settings-desktop-offline-language',
    } })
    expect(settingsSaved.status, JSON.stringify(settingsSaved.error)).toBe(200)
    expect(settingsSaved.data).toMatchObject({ durable: true, user: { settings: { language: 'ja' } } })
    expect((await storage.readStore()).users[0].settings.language).toBe('ja')
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const me = await request('/api/auth/me', { headers: { origin } })
      expect(me.status, JSON.stringify(me.error)).toBe(200)
      expect(me.headers.get('content-security-policy')).toContain("frame-src 'self' blob:")
      expect((await request('/api/auth/me', { headers: { origin: 'https://example.test' } })).status).toBe(403)
      const foreignHostStatus = await new Promise((resolve, reject) => {
        const probe = http.get(`${origin}/api/auth/me`, { headers: { host: '127.0.0.1:1' } }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        })
        probe.once('error', reject)
      })
      expect(foreignHostStatus).toBe(400)
      const health = await new Promise((resolve, reject) => {
        const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/health/ws`, { origin })
        socket.once('error', reject)
        socket.once('message', (message) => {
          socket.close()
          socket.once('close', () => resolve(JSON.parse(String(message))))
        })
      })
      expect(health).toMatchObject({ type: 'ready', ok: true })
    } finally { vi.stubEnv('NODE_ENV', 'test') }
  })

  it('retains local capacity and saves when a linked free web account is unavailable', async () => {
    const { writeDesktopRuntimeState } = await import('./desktopRuntime.js')
    await writeDesktopRuntimeState(root, {
      mode: 'remote', remoteOrigin: 'http://127.0.0.1:1', remoteEmail: 'web@example.test',
      remoteToken: 'unavailable-test-account',
      remoteUsage: { plan: 'free', applicationQuota: 3, applicationCreateQuota: 3, storageQuotaMb: 1 },
    })
    expect((await request('/api/auth/me')).data.usage.applicationQuota).toBeGreaterThan(10_000)
    for (let index = 0; index < 4; index += 1) {
      const created = await request('/api/applications', { method: 'POST', body: {
        professor: '', professorEmail: '', university: `Offline University ${index}`, program: 'PhD', deadline: '',
      } })
      expect(created.status, JSON.stringify(created.error)).toBe(201)
    }
    expect((await storage.readStore()).applications).toHaveLength(4)
  })

  it('survives session timeouts while enforcing signatures, revocation, and process ownership', async () => {
    const claims = jwt.decode(session.token)
    const expiredClaims = { ...claims, iat: 1_000, exp: 1_100 }
    const expiredLocal = jwt.sign(expiredClaims, secret, { algorithm: 'HS256' })
    const refreshed = await request('/api/auth/me', { token: expiredLocal })
    expect(refreshed.status).toBe(200)
    const refreshedToken = refreshed.headers.get('x-session-token')
    expect(refreshedToken).toBeTruthy()
    expect(jwt.decode(refreshedToken).desktopRuntimeId).toBe(claims.desktopRuntimeId)
    const { desktopRuntimeId: _localClaim, ...ordinaryClaims } = expiredClaims
    expect((await request('/api/auth/me', { token: jwt.sign(ordinaryClaims, secret, { algorithm: 'HS256' }) })).status).toBe(401)
    const revoked = jwt.sign({ ...expiredClaims, authVersion: 999 }, secret, { algorithm: 'HS256' })
    expect((await request('/api/auth/me', { token: revoked })).status).toBe(401)
    expect((await request('/api/auth/me', { token: `${session.token.slice(0, -8)}tampered` })).status).toBe(401)

    const previousToken = session.token
    await stop()
    await storage.shutdownStorage()
    await storage.ensureStorage()
    await start()
    expect((await request('/api/auth/me', { token: previousToken })).status).toBe(401)
    const reopened = await request('/api/desktop/session', { token: null, method: 'POST', body: {} })
    expect(reopened.status).toBe(200)
    expect(reopened.data.user.id).toBe(session.user.id)
    expect(reopened.data.user.settings.language).toBe('ja')
    session = reopened.data
    expect((await storage.readStore()).applications).toHaveLength(4)
    expect((await storage.readStore()).users).toHaveLength(1)
  })
})
