// @vitest-environment node

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SERVER_KEY = randomBytes(32).toString('base64url')
const SETTINGS_KEY = randomBytes(32).toString('base64url')
const USER_PASSWORD = randomBytes(24).toString('base64url')
const ADMIN_PASSWORD = randomBytes(24).toString('base64url')
const SELECTOR = `sel_${randomBytes(18).toString('hex')}`
const TOKEN_HASH = randomBytes(32).toString('hex')
let testRoot
let activeChild = null

const workerScript = String.raw`
  import path from 'node:path'
  import { pathToFileURL } from 'node:url'

  const storage = await import(pathToFileURL(path.resolve('server/storage.js')).href)
  const phase = process.env.SECURITY_DURABILITY_PHASE
  const selector = process.env.SECURITY_DURABILITY_SELECTOR

  if (phase === 'write-revoke') {
    const store = await storage.readStore()
    store.settings.encryptionAtRest = true
    store.settings.sqliteEncryption = true
    await storage.writeStore(store)
    const userId = store.users[0].id
    const created = await storage.createCodexAuthorization({
      userId,
      tokenSelector: selector,
      tokenHash: process.env.SECURITY_DURABILITY_TOKEN_HASH,
      tokenHint: 'durable',
      name: 'Encrypted crash revoke',
      clientName: 'Durability test',
      clientVersion: '1',
      deviceName: 'Crash worker',
      scopes: ['applications:read'],
      scopeVersion: 2,
    })
    const revoked = await storage.revokeCodexAuthorization(userId, created.id)
    process.stdout.write(JSON.stringify({ ready: true, authorizationId: created.id, status: revoked.status }) + '\n')
    await new Promise(() => setInterval(() => {}, 1000))
  } else {
    const store = await storage.readStore()
    const current = await storage.findCurrentCodexAuthorizationBySelector(selector)
    const authorizations = await storage.listCodexAuthorizations(store.users[0].id)
    const target = authorizations.find((authorization) => authorization.name === 'Encrypted crash revoke')
    await storage.shutdownStorage()
    process.stdout.write(JSON.stringify({
      current: current?.id ?? null,
      status: target?.status ?? null,
      active: target?.active ?? null,
    }) + '\n')
  }
`

function workerEnvironment(phase) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    SECURITY_DURABILITY_PHASE: phase,
    SECURITY_DURABILITY_SELECTOR: SELECTOR,
    SECURITY_DURABILITY_TOKEN_HASH: TOKEN_HASH,
    PHD_ATLAS_STORAGE_ROOT: testRoot,
    PHD_ATLAS_SQLITE_PATH: path.join(testRoot, 'workspace.sqlite'),
    PHD_ATLAS_SERVER_KEY: SERVER_KEY,
    SETTINGS_ENCRYPTION_KEY: SETTINGS_KEY,
    BOOTSTRAP_USER_PASSWORD: USER_PASSWORD,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    PHD_ATLAS_ENCRYPTED_SQLITE_LEASE_WAIT_MS: '0',
    PHD_ATLAS_SNAPSHOT_MAX_BYTES: String(128 * 1024 * 1024),
    RUNTIME_MEMORY_BUDGET_BYTES: String(512 * 1024 * 1024),
  }
}

function spawnWorker(phase) {
  const child = spawn(process.execPath, [
    '--max-old-space-size=512',
    '--input-type=module',
    '--eval',
    workerScript,
  ], {
    cwd: process.cwd(),
    env: workerEnvironment(phase),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  activeChild = child
  child.once('exit', () => {
    if (activeChild === child) activeChild = null
  })
  return child
}

function waitForJsonLine(child, timeoutMs = 45_000) {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16 * 1024) })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Security durability worker timed out: ${stderr}`)), timeoutMs)
    const inspect = () => {
      const line = stdout.split(/\r?\n/u).find((entry) => entry.trim().startsWith('{'))
      if (!line) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(line))
      } catch (error) {
        reject(new Error(`Security durability worker returned invalid JSON: ${error.message}`))
      }
    }
    child.stdout.on('data', inspect)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      inspect()
      if (code !== 0 && !stdout.includes('{')) {
        clearTimeout(timer)
        reject(new Error(`Security durability worker failed (${code}): ${stderr}`))
      }
    })
  })
}

function waitForExit(child, timeoutMs = 20_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Security durability worker exit timed out.')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-encrypted-security-'))
})

afterAll(async () => {
  if (activeChild) {
    activeChild.kill('SIGKILL')
    await waitForExit(activeChild).catch(() => undefined)
  }
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
})

describe('encrypted SQLite security durability', () => {
  it('does not resurrect a revoked authorization after an immediate hard crash', async () => {
    const writer = spawnWorker('write-revoke')
    const committed = await waitForJsonLine(writer)
    expect(committed).toMatchObject({ ready: true, status: 'revoked' })

    writer.kill('SIGKILL')
    await waitForExit(writer)

    const reader = spawnWorker('read-after-crash')
    const restored = await waitForJsonLine(reader)
    await waitForExit(reader)
    expect(restored).toEqual({ current: null, status: 'revoked', active: false })
  }, 90_000)
})
