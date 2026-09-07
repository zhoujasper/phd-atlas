import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'

const root = await mkdtemp(path.join(os.tmpdir(), 'phdatlas-desktop-launcher-'))
let child, occupiedPort
const diagnostics = []

async function launch() {
  const env = { ...process.env, NODE_ENV: 'production', PHD_ATLAS_DESKTOP_DEV: '1',
    PHD_ATLAS_STORAGE_ROOT: root, PHD_ATLAS_SQLITE_PATH: path.join(root, 'workspace.sqlite'),
    PHD_ATLAS_DESKTOP_PORT_FILE: path.join(root, 'desktop-http.json'), PORT: '0',
  }
  for (const name of ['JWT_SECRET', 'SETTINGS_ENCRYPTION_KEY', 'PHD_ATLAS_SERVER_KEY', 'RATE_LIMIT_DISABLED']) delete env[name]
  child = spawn(process.execPath, ['desktop/launch-runtime.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Desktop startup timeout: ${diagnostics.join('').slice(-3000)}`)), 30_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Desktop exited ${code}/${signal}: ${diagnostics.join('').slice(-3000)}`)) })
    child.stderr.on('data', (chunk) => diagnostics.push(String(chunk)))
    child.stdout.on('data', (chunk) => {
      const value = String(chunk)
      diagnostics.push(value)
      const match = value.match(/desktop runtime ready on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
}

async function quit({ disconnect = false } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closing = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Desktop did not finish graceful shutdown')), 25_000)
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  })
  if (disconnect) child.disconnect()
  else child.send({ type: 'phd-atlas-desktop-shutdown' })
  expect(await closing).toEqual({ code: 0, signal: null })
}

async function request(origin, route, token, body) {
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, connection: 'close', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, ...(await response.json()) }
}

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }
  if (occupiedPort) await new Promise((resolve) => occupiedPort.close(resolve))
  await rm(root, { recursive: true, force: true })
})

it('boots in production without login, persists through graceful IPC quit, and restores the optional lock and local address', async () => {
  const firstOrigin = await launch()
  const first = await request(firstOrigin, '/api/desktop/session', null, {})
  expect(first.status, JSON.stringify(first.error)).toBe(200)
  const token = first.data.token
  expect(first.data.user.email).toBe('local@desktop.phd-atlas')
  const created = await request(firstOrigin, '/api/applications', token, {
    university: 'Native Offline University', program: 'PhD', professor: '', professorEmail: '', deadline: '',
  })
  expect(created.status, JSON.stringify(created.error)).toBe(201)
  expect((await request(firstOrigin, '/api/desktop/unlock-password', token, {
    enabled: true, password: 'local-check-4821', confirmPassword: 'local-check-4821',
  })).status).toBe(200)
  await quit()

  const secondOrigin = await launch()
  expect(secondOrigin).toBe(firstOrigin)
  expect((await request(secondOrigin, '/api/desktop/session', null, {})).error.code).toBe('DESKTOP_UNLOCK_REQUIRED')
  expect((await request(secondOrigin, '/api/desktop/unlock', null, { password: 'incorrect' })).status).toBe(401)
  const unlocked = await request(secondOrigin, '/api/desktop/unlock', null, { password: 'local-check-4821' })
  expect(unlocked.status).toBe(200)
  expect(unlocked.data.user.id).toBe(first.data.user.id)
  const exported = await request(secondOrigin, '/api/workspace/complete-export', unlocked.data.token)
  expect(exported.data.applications).toHaveLength(1)
  expect(exported.data.applications[0].id).toBe(created.data.id)
  await quit()

  occupiedPort = http.createServer()
  await new Promise((resolve) => occupiedPort.listen(Number(new URL(firstOrigin).port), '127.0.0.1', resolve))
  const thirdOrigin = await launch()
  expect(thirdOrigin).not.toBe(firstOrigin)
  expect((await request(thirdOrigin, '/api/desktop/runtime')).data.unlockRequired).toBe(true)
  await quit({ disconnect: true })
}, 90_000)
