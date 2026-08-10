// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PUBLIC_EDITION } from './edition.js'

vi.mock('morgan', () => {
  const quietRequestLogger = () => (_request, _response, next) => next()
  quietRequestLogger.token = () => undefined
  return { default: quietRequestLogger }
})

const CONNECTIONS = 100
const JWT_SECRET = 'realtime-hydration-memory-test-secret-that-is-long-enough'
const SETTINGS_ENCRYPTION_KEY = 'realtime-hydration-memory-test-encryption-key'

let baseUrl
let storage
let testRoot
let tokens = []
let largeTeamId = null
let activeLoadWorker = null
let activeServerWorker = null
let serverWorkerPid = null
let loadWorkerPid = null
let fixtureMaxPayloadBytes = 0
let largeStreamToken = ''
const LARGE_TEAM_PAYLOAD_BYTES = 20 * 1024 * 1024
const LARGE_TEAM_STREAM_CLIENTS = 100

function sessionToken(user) {
  return jwt.sign({
    sub: user.id,
    role: 'user',
    email: user.email,
    scope: 'app',
    mode: 'sliding',
    authVersion: Number(user.settings?.authVersion ?? 0),
  }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'phd-atlas',
    audience: 'phd-atlas-api',
    jwtid: randomUUID(),
    expiresIn: '1h',
  })
}

async function runFreshNodeScript(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      env: { ...controlledLoadWorkerEnvironment(), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => {
      // Syntax errors produced by JSON.parse can echo an entire encrypted
      // multi-megabyte source line. Retain only the diagnostic tail.
      stderr = `${stderr}${chunk}`.slice(-16 * 1024)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Fresh Node worker failed (${code}): ${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`Fresh Node worker returned invalid JSON: ${error.message}; stderr=${stderr}`))
      }
    })
  })
}

function controlledLoadWorkerEnvironment() {
  const names = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
  return Object.fromEntries(names
    .filter((name) => typeof process.env[name] === 'string')
    .map((name) => [name, process.env[name]]))
}

function realtimeServerWorkerEnvironment() {
  return {
    ...controlledLoadWorkerEnvironment(),
    NODE_ENV: 'test',
    RATE_LIMIT_DISABLED: '1',
    JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY,
    PHD_ATLAS_STORAGE_ROOT: testRoot,
    PHD_ATLAS_SQLITE_PATH: path.join(testRoot, 'workspace.sqlite'),
    PHD_ATLAS_SERVER_KEY: 'realtime-hydration-memory-test-key',
    PHD_ATLAS_REALTIME_MAX_CONNECTIONS: '128',
    RUNTIME_MEMORY_BUDGET_BYTES: String(512 * 1024 * 1024),
    STREAM_MAX_ACTIVE: '32',
    STREAM_MAX_QUEUED: '128',
    STREAM_MAX_ACTIVE_PER_PRINCIPAL: '4',
    STREAM_MAX_QUEUED_PER_PRINCIPAL: '8',
    STREAM_WAIT_TIMEOUT_MS: '120000',
  }
}

function sendServerIpc(state, message) {
  return new Promise((resolve, reject) => {
    if (!state || state.exited || !state.child.connected) {
      reject(new Error('Realtime server worker is not connected.'))
      return
    }
    let encoded
    try {
      encoded = JSON.stringify(message)
    } catch (error) {
      reject(error)
      return
    }
    if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
      reject(new Error('Realtime server worker IPC input exceeded 256 KiB.'))
      return
    }
    state.child.send(message, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function startRealtimeServerWorker() {
  const workerPath = path.join(process.cwd(), 'server', 'realtimeHydrationServerWorker.mjs')
  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: realtimeServerWorkerEnvironment(),
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  const state = {
    child,
    stderr: '',
    exited: false,
    exitCode: null,
    exitSignal: null,
    reports: new Map(),
    resolveExit: null,
    exitPromise: null,
  }
  state.exitPromise = new Promise((resolve) => { state.resolveExit = resolve })
  activeServerWorker = state
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    state.stderr = `${state.stderr}${chunk}`.slice(-16 * 1024)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const deadline = setTimeout(() => {
      child.kill()
      settleReady(new Error('Realtime server worker startup timed out.'))
    }, 60_000)
    const settleReady = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (error) reject(error)
      else resolve(value)
    }
    child.once('error', (error) => settleReady(error))
    child.on('message', (message) => {
      let encoded
      try {
        encoded = JSON.stringify(message)
      } catch {
        child.kill()
        return
      }
      if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
        child.kill()
        return
      }
      if (message?.type === 'ready') {
        settleReady(null, message)
        return
      }
      if (message?.type === 'report' && typeof message.requestId === 'string') {
        const pending = state.reports.get(message.requestId)
        if (!pending) return
        state.reports.delete(message.requestId)
        clearTimeout(pending.timer)
        pending.resolve(message.report)
        return
      }
      if (message?.type === 'error') {
        state.stderr = `${state.stderr}\n${String(message.message ?? 'Server worker failed.').slice(0, 4_096)}`
      }
    })
    child.once('exit', (code, signal) => {
      state.exited = true
      state.exitCode = code
      state.exitSignal = signal
      state.resolveExit({ code, signal })
      for (const pending of state.reports.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(
          `Realtime server worker exited (code=${code}, signal=${signal ?? 'none'}): ${state.stderr}`,
        ))
      }
      state.reports.clear()
      if (!settled) {
        settleReady(new Error(
          `Realtime server worker failed to start (code=${code}, signal=${signal ?? 'none'}): ${state.stderr}`,
        ))
      }
    })
  })
}

function requestRealtimeServerReport(timeoutMs = 10_000) {
  const state = activeServerWorker
  if (!state || state.exited) return Promise.reject(new Error('Realtime server worker is unavailable.'))
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.reports.delete(requestId)
      reject(new Error('Realtime server worker report timed out.'))
    }, timeoutMs)
    state.reports.set(requestId, { resolve, reject, timer })
    sendServerIpc(state, { type: 'report', requestId }).catch((error) => {
      clearTimeout(timer)
      state.reports.delete(requestId)
      reject(error)
    })
  })
}

function recordRealtimeServerPhase(phase) {
  return sendServerIpc(activeServerWorker, { type: 'phase', phase })
}

async function stopRealtimeServerWorker() {
  const state = activeServerWorker
  if (!state) return
  activeServerWorker = null
  if (state.exited) return
  await sendServerIpc(state, { type: 'stop' }).catch(() => undefined)
  let timer
  const exited = await Promise.race([
    state.exitPromise.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 15_000) }),
  ])
  clearTimeout(timer)
  if (exited) return
  state.child.kill('SIGKILL')
  await Promise.race([
    state.exitPromise,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
}

function runRealtimeLoadWorker(input, { onPhase, timeoutMs = 240_000 } = {}) {
  const workerPath = path.join(process.cwd(), 'server', 'realtimeHydrationLoadWorker.mjs')
  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: controlledLoadWorkerEnvironment(),
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  activeLoadWorker = child
  let stderr = ''
  let report = null
  let settled = false
  let dispatched = false
  const deadline = setTimeout(() => {
    child.kill()
  }, timeoutMs)
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16 * 1024)
  })

  return new Promise((resolve, reject) => {
    const settle = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      activeLoadWorker = null
      if (error) reject(error)
      else resolve(value)
    }
    const sendIpc = (message) => new Promise((sendResolve, sendReject) => {
      let encoded
      try {
        encoded = JSON.stringify(message)
      } catch (error) {
        sendReject(error)
        return
      }
      if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
        sendReject(new Error('Realtime load worker IPC input exceeded 256 KiB.'))
        return
      }
      child.send(message, (error) => {
        if (error) sendReject(error)
        else sendResolve()
      })
    })
    const dispatchInput = async () => {
      if (dispatched || settled) return
      dispatched = true
      const { tokens: transientTokens, ...configuration } = input
      await sendIpc({
        type: 'configure',
        ...configuration,
        expectedTokenCount: transientTokens.length,
      })
      for (let offset = 0; offset < transientTokens.length; offset += 25) {
        await sendIpc({ type: 'tokens', tokens: transientTokens.slice(offset, offset + 25) })
      }
      await sendIpc({ type: 'start' })
    }
    child.once('error', (error) => settle(error))
    child.on('message', (message) => {
      let encoded
      try {
        encoded = JSON.stringify(message)
      } catch {
        child.kill()
        return
      }
      if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
        child.kill()
        return
      }
      if (message?.type === 'ready') {
        void dispatchInput().catch((error) => {
          child.kill()
          settle(error)
        })
      }
      if (message?.type === 'phase') onPhase?.(message.phase)
      if (message?.type === 'result') report = message.report
      if (message?.type === 'error') {
        stderr = `${stderr}\n${String(message.message ?? 'Load worker failed.').slice(0, 4_096)}`
      }
    })
    child.once('exit', (code, signal) => {
      if (code === 0 && report) {
        settle(null, report)
        return
      }
      settle(new Error(
        `Realtime load worker failed (code=${code}, signal=${signal ?? 'none'}): ${stderr}`,
      ))
    })
  })
}

async function stopRealtimeLoadWorker() {
  const child = activeLoadWorker
  if (!child) return
  activeLoadWorker = null
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try { child.disconnect?.() } catch { /* already disconnected */ }
  let timer
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000) }),
  ])
  clearTimeout(timer)
  if (graceful) return
  child.kill('SIGKILL')
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-realtime-memory-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('RATE_LIMIT_DISABLED', '1')
  vi.stubEnv('JWT_SECRET', JWT_SECRET)
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', SETTINGS_ENCRYPTION_KEY)
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'realtime-hydration-memory-test-key')
  vi.stubEnv('PHD_ATLAS_REALTIME_MAX_CONNECTIONS', '128')
  // NODE_ENV=test otherwise raises the budget to 2 GiB. Qualify the actual
  // standalone production default and let pre-header row admission decide
  // between a complete stream and one structured overload response.
  vi.stubEnv('RUNTIME_MEMORY_BUDGET_BYTES', String(512 * 1024 * 1024))
  vi.stubEnv('STREAM_MAX_ACTIVE', '32')
  vi.stubEnv('STREAM_MAX_QUEUED', '128')
  // Keep the production per-principal isolation boundary. The 100 callers
  // arrive simultaneously, while one account cannot consume every global
  // stream slot or reserve away the headroom its admitted streams require.
  vi.stubEnv('STREAM_MAX_ACTIVE_PER_PRINCIPAL', '4')
  vi.stubEnv('STREAM_MAX_QUEUED_PER_PRINCIPAL', '8')
  vi.stubEnv('STREAM_WAIT_TIMEOUT_MS', '120000')

  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const store = await storage.readStore()
  const template = store.users[0]
  if (!template) throw new Error('The isolated realtime fixture requires one seed user.')
  const users = Array.from({ length: CONNECTIONS }, (_, index) => ({
    ...structuredClone(template),
    id: `realtime_memory_user_${String(index).padStart(3, '0')}`,
    email: `realtime-memory-${String(index).padStart(3, '0')}@example.test`,
    name: `Realtime memory user ${index}`,
    role: 'user',
    disabledAt: null,
    settings: {
      ...structuredClone(template.settings ?? {}),
      authVersion: 0,
    },
  }))
  // The public edition has no Team scope in which to isolate the deliberately
  // huge fixture. Keep its owner outside the 100-client tiny-traffic fleet so
  // the read phase remains genuinely tiny and the later large-stream phase
  // measures the large payload exactly once per admitted stream.
  const publicLargeOwner = PUBLIC_EDITION
    ? {
        ...structuredClone(template),
        id: 'realtime_memory_large_owner',
        email: 'realtime-memory-large-owner@example.test',
        name: 'Realtime memory large owner',
        role: 'user',
        disabledAt: null,
        settings: {
          ...structuredClone(template.settings ?? {}),
          authVersion: 0,
          membershipPlan: 'pro',
          personalMembershipPlan: 'pro',
          storageQuotaMb: 100,
        },
      }
    : null
  store.users.push(...users, ...(publicLargeOwner ? [publicLargeOwner] : []))
  await storage.lockedWriteStore(store)
  const team = await storage.createTeam(template.id, 'Large realtime hydration Team', CONNECTIONS + 1)
  largeTeamId = team.id
  const assignedTeacherIds = users.slice(1).map((user) => user.id)
  for (const [index, user] of users.entries()) {
    const memberId = `realtime_memory_member_${String(index).padStart(3, '0')}`
    await storage.createTeamInvite(team.id, {
      id: memberId,
      email: user.email,
      // One student owns the large application. The other 99 distinct users
      // are explicitly assigned teachers, so the distinct-principal phase
      // exercises the same shared Team row rather than 99 empty projections.
      role: index === 0 ? 'member' : 'admin',
      invitedBy: template.id,
      existingUserId: user.id,
      token: `realtime-memory-token-${index}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      relationships: index === 0 ? { teacherIds: assignedTeacherIds } : {},
    })
    await storage.acceptTeamInvite(memberId, user.id)
  }
  // Construct and encrypt the deliberately huge fixture in a short-lived
  // worker. This keeps allocation history from falsely putting the actual
  // server process into soft pressure before qualification even begins.
  await storage.shutdownStorage()
  const storageModuleUrl = pathToFileURL(path.join(process.cwd(), 'server', 'storage.js')).href
  const seedScript = `
    const storage = await import(${JSON.stringify(storageModuleUrl)});
    try {
      await storage.ensureStorage();
      const workspace = await storage.readStore();
      const template = workspace.applications[0];
      const stamp = new Date().toISOString();
      workspace.applications.push({
        ...structuredClone(template),
        id: 'realtime_memory_large_team_application',
        ownerId: ${JSON.stringify(PUBLIC_EDITION ? publicLargeOwner.id : users[0].id)},
        teamId: ${JSON.stringify(PUBLIC_EDITION ? null : team.id)},
        program: 'x'.repeat(${LARGE_TEAM_PAYLOAD_BYTES}),
        school: {
          ...structuredClone(template.school),
          name: 'Large realtime hydration fixture',
          logo: undefined,
        },
        createdAt: stamp,
        updatedAt: stamp,
      });
      await storage.lockedWriteStore(workspace);
      const cursor = await storage.createScopedApplicationSectionCursor(
        ${JSON.stringify(PUBLIC_EDITION
          ? { userId: publicLargeOwner.id, mode: 'personal', personalOnly: true }
          : { mode: 'team-all', teamId: team.id })}
      );
      const maxPayloadBytes = cursor.maxPayloadBytes;
      cursor.release();
      process.stdout.write(JSON.stringify({
        ok: true,
        bytes: ${LARGE_TEAM_PAYLOAD_BYTES},
        maxPayloadBytes,
      }));
    } finally {
      await storage.shutdownStorage();
    }
  `
  const seedResult = await runFreshNodeScript(seedScript, {
    NODE_ENV: 'test',
    PHD_ATLAS_STORAGE_ROOT: testRoot,
    PHD_ATLAS_SQLITE_PATH: path.join(testRoot, 'workspace.sqlite'),
    PHD_ATLAS_SERVER_KEY: 'realtime-hydration-memory-test-key',
    JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY,
  })
  expect(seedResult).toMatchObject({
    ok: true,
    bytes: LARGE_TEAM_PAYLOAD_BYTES,
    maxPayloadBytes: expect.any(Number),
  })
  fixtureMaxPayloadBytes = seedResult.maxPayloadBytes
  expect(fixtureMaxPayloadBytes).toBeGreaterThan(LARGE_TEAM_PAYLOAD_BYTES)
  tokens = users.map(sessionToken)
  largeStreamToken = sessionToken(publicLargeOwner ?? users[0])

  const ready = await startRealtimeServerWorker()
  serverWorkerPid = ready.serverPid
  expect(serverWorkerPid).not.toBe(process.pid)
  baseUrl = `http://127.0.0.1:${ready.port}`
}, 180_000)

afterAll(async () => {
  await stopRealtimeLoadWorker()
  await stopRealtimeServerWorker()
  await storage?.shutdownStorage().catch(() => undefined)
  const storageModuleUrl = pathToFileURL(path.join(process.cwd(), 'server', 'storage.js')).href
  const readbackScript = `
    const storage = await import(${JSON.stringify(storageModuleUrl)});
    try {
      await storage.ensureStorage();
      const cursor = await storage.createScopedApplicationSectionCursor(
        ${JSON.stringify(PUBLIC_EDITION
          ? { userId: 'realtime_memory_large_owner', mode: 'personal', personalOnly: true }
          : { mode: 'team-all', teamId: largeTeamId })}
      );
      let found = null;
      for await (const application of cursor.values) {
        if (application.id === 'realtime_memory_large_team_application') {
          found = {
            id: application.id,
            teamId: application.teamId,
            programBytes: Buffer.byteLength(application.program, 'utf8'),
          };
        }
      }
      process.stdout.write(JSON.stringify({ ok: true, pid: process.pid, count: cursor.count, found }));
    } finally {
      await storage.shutdownStorage();
    }
  `
  const readback = await runFreshNodeScript(readbackScript, {
    NODE_ENV: 'production',
    PHD_ATLAS_STORAGE_ROOT: testRoot,
    PHD_ATLAS_SQLITE_PATH: path.join(testRoot, 'workspace.sqlite'),
    PHD_ATLAS_SERVER_KEY: 'realtime-hydration-memory-test-key',
    JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY,
    BOOTSTRAP_USER_PASSWORD: 'Realtime-Memory-Readback-u9T!A4v7zX2p',
    BOOTSTRAP_ADMIN_PASSWORD: 'Realtime-Memory-Readback-a8K!F3q6nV1s',
  })
  expect(readback).toMatchObject({
    ok: true,
    pid: expect.any(Number),
    count: 1,
    found: {
      id: 'realtime_memory_large_team_application',
      teamId: PUBLIC_EDITION ? null : largeTeamId,
      programBytes: LARGE_TEAM_PAYLOAD_BYTES,
    },
  })
  expect(readback.pid).not.toBe(process.pid)
  expect(readback.pid).not.toBe(serverWorkerPid)
  if (loadWorkerPid) expect(readback.pid).not.toBe(loadWorkerPid)
  console.info('REALTIME_MEMORY_DURABLE_READBACK', JSON.stringify(readback))
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
}, 180_000)

describe('realtime hydration memory ownership', () => {
  it('keeps 100-user tiny traffic and same-account/distinct-Team large streams bounded and recoverable', async () => {
    expect(CONNECTIONS).toBe(100)
    expect(LARGE_TEAM_STREAM_CLIENTS).toBe(100)
    const genericRowReservationBytes = Math.max(
      16 * 1024 * 1024,
      ((fixtureMaxPayloadBytes + 1024) * 2) + (32 * 1024 * 1024),
    )
    const initialServerReport = await requestRealtimeServerReport()
    expect(initialServerReport).toMatchObject({
      serverPid: serverWorkerPid,
      listening: true,
      memoryLedger: { activeReservations: 0, reservedBytes: 0 },
    })
    expect(initialServerReport.serverPid).not.toBe(process.pid)

    let loadReport = null
    const phaseWrites = []
    try {
      // Both operational owners are outside Vitest: one stable server PID owns
      // SQLite and runtime telemetry while one controlled load PID owns all
      // client sockets and gzip decoding. Neither can pollute the other's RSS.
      loadReport = await runRealtimeLoadWorker({
        baseUrl,
        tokens,
        connections: CONNECTIONS,
        marker: 'realtime_memory_large_team_application',
        largeStreamSection: PUBLIC_EDITION ? 'applications' : 'teamApplications',
        firstLargeMatrixUsesSharedAccount: PUBLIC_EDITION,
        largeStreamToken,
      }, {
        onPhase(phase) {
          if (['afterSse', 'afterTinyReads', 'afterTinyWrites'].includes(phase)) {
            phaseWrites.push(recordRealtimeServerPhase(phase))
          }
        },
      })
    } catch (error) {
      await Promise.allSettled(phaseWrites)
      const serverDiagnostic = await requestRealtimeServerReport().catch((reportError) => ({
        reportError: String(reportError?.message ?? reportError).slice(0, 4_096),
      }))
      console.info('REALTIME_MEMORY_FAILURE_DIAGNOSTIC', JSON.stringify({
        testPid: process.pid,
        serverPid: serverWorkerPid,
        error: String(error?.message ?? error).slice(0, 4_096),
        fixtureMaxPayloadBytes,
        genericRowReservationBytes,
        serverDiagnostic,
      }))
      throw error
    } finally {
      await stopRealtimeLoadWorker()
    }
    await Promise.all(phaseWrites)
    loadWorkerPid = loadReport.workerPid

    expect(loadReport).toBeTruthy()
    expect(loadWorkerPid).not.toBe(process.pid)
    expect(loadWorkerPid).not.toBe(serverWorkerPid)
    expect(loadReport).toMatchObject({
      onlineSseClients: CONNECTIONS,
      sseAliveDuringLarge: true,
      tinyReads: { total: CONNECTIONS, status200: CONNECTIONS },
      tinyWrites: { total: CONNECTIONS, status200: CONNECTIONS },
      samePidRecovery: {
        status: 200,
        gzipDecoded: true,
        terminalFrame: 'complete',
      },
      health: { samples: expect.any(Number), p95Ms: expect.any(Number) },
    })

    const verifyLargeMatrix = (matrix, label) => {
      expect(matrix, label).toMatchObject({
        total: LARGE_TEAM_STREAM_CLIENTS,
        complete200: expect.any(Number),
        structured503: expect.any(Number),
        statusCounts: { 200: expect.any(Number), 503: expect.any(Number) },
        pressure: expect.any(Object),
        allCompleteGzipDecoded: true,
        overloadRetryAfterMs: expect.any(Array),
      })
      expect(matrix.complete200, label).toBeGreaterThan(0)
      expect(matrix.structured503, label).toBeGreaterThan(0)
      expect(matrix.complete200 + matrix.structured503, label).toBe(LARGE_TEAM_STREAM_CLIENTS)
      expect(matrix.statusCounts[200], label).toBe(matrix.complete200)
      expect(matrix.statusCounts[503], label).toBe(matrix.structured503)
      expect(matrix.minimumDecodedBytes, label).toBeGreaterThan(17 * 1024 * 1024)
      expect(matrix.maximumDecodedBytes, label).toBeGreaterThanOrEqual(matrix.minimumDecodedBytes)
      expect(matrix.overloadRetryAfterMs.length, label).toBeGreaterThan(0)
      for (const retryAfterMs of matrix.overloadRetryAfterMs) {
        expect(Number(retryAfterMs), label).toBeGreaterThan(0)
      }
      expect(matrix.maximumOverloadResponseBytes, label).toBeLessThan(16 * 1024)
      expect(
        Object.values(matrix.pressure).reduce((total, count) => total + count, 0),
        label,
      ).toBe(matrix.structured503)
    }
    verifyLargeMatrix(
      loadReport.firstLargeStreams,
      PUBLIC_EDITION ? '100 personal streams for one account' : '100 distinct Team principals',
    )
    verifyLargeMatrix(loadReport.repeatLargeStreams, '100 repeated streams for one account')
    expect(loadReport.samePidRecovery.decodedBytes).toBeGreaterThan(17 * 1024 * 1024)
    expect(loadReport.health.samples).toBeGreaterThanOrEqual(2)
    expect(loadReport.health.p95Ms).toBeLessThan(500)

    const normalMemoryDeadline = performance.now() + 60_000
    let postQualificationHealthPayload = null
    while (performance.now() < normalMemoryDeadline) {
      const response = await fetch(`${baseUrl}/api/health`)
      expect(response.status).toBe(200)
      postQualificationHealthPayload = await response.json()
      if (postQualificationHealthPayload.data.memoryPressure.level === 'normal') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(postQualificationHealthPayload).toMatchObject({
      ok: true,
      data: { status: 'ok', ready: true, memoryPressure: { level: 'normal' } },
    })
    const finalServerReport = await requestRealtimeServerReport()
    expect(finalServerReport).toMatchObject({
      serverPid: serverWorkerPid,
      listening: true,
      memory: {
        phases: {
          afterSse: expect.any(Object),
          afterTinyReads: expect.any(Object),
          afterTinyWrites: expect.any(Object),
        },
      },
      memoryPressure: { level: 'normal', budgetBytes: 512 * 1024 * 1024 },
    })
    expect(finalServerReport.serverPid).toBe(initialServerReport.serverPid)
    expect(finalServerReport.maximumEventLoopLagMs).toBeLessThan(500)
    expect(finalServerReport.memory.peak.rss).toBeLessThan(512 * 1024 * 1024)
    expect(
      finalServerReport.memory.peak.heapUsed - finalServerReport.memory.baseline.heapUsed,
    ).toBeLessThan(384 * 1024 * 1024)
    expect(
      finalServerReport.memory.peak.external - finalServerReport.memory.baseline.external,
    ).toBeLessThan(384 * 1024 * 1024)
    expect(
      finalServerReport.memory.peak.arrayBuffers - finalServerReport.memory.baseline.arrayBuffers,
    ).toBeLessThan(384 * 1024 * 1024)

    const finalStreamAdmission = finalServerReport.streamAdmission
    expect(finalStreamAdmission).toMatchObject({
      active: 0,
      waiting: 0,
      timedOut: 0,
    })
    expect(
      finalStreamAdmission.rejected + finalStreamAdmission.counters.memoryRejected,
    ).toBeGreaterThan(0)
    expect(finalStreamAdmission.counters.bytesProgressed).toBeGreaterThan(17 * 1024 * 1024)
    const finalWorkspacePreparationAdmission = finalServerReport.workspaceStreamPreparationAdmission
    expect(finalWorkspacePreparationAdmission).toMatchObject({
      active: 0,
      waiting: 0,
      timedOut: 0,
    })
    const finalWorkspacePreAuthAdmission = finalServerReport.workspaceStreamPreAuthAdmission
    expect(finalWorkspacePreAuthAdmission).toMatchObject({
      active: 0,
      waiting: 0,
      activeKeys: 0,
      queuedKeys: 0,
      maxActive: 4,
      maxActivePerKey: 4,
      timedOut: 0,
    })
    expect(finalWorkspacePreAuthAdmission.maxObservedActive).toBeGreaterThan(0)
    expect(finalWorkspacePreAuthAdmission.maxObservedActive).toBeLessThanOrEqual(4)
    // The first bounded gate is allowed to hand every admitted request to a
    // later authoritative gate before pressure rises. Qualification requires
    // structured overload above and a real rejection somewhere in the
    // pre-auth/preparation/stream-memory chain, not at one incidental layer.
    expect(
      finalWorkspacePreAuthAdmission.rejected
      + finalWorkspacePreparationAdmission.rejected
      + finalStreamAdmission.rejected
      + finalStreamAdmission.counters.memoryRejected,
    ).toBeGreaterThan(0)
    expect(finalServerReport.memoryLedger).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
    expect(finalServerReport.memoryLedger.peakReservedBytes).toBeGreaterThan(0)
    const postQualificationHealth = await fetch(`${baseUrl}/api/health`)
    expect(postQualificationHealth.status).toBe(200)
    const finalHealthPayload = await postQualificationHealth.json()
    expect(finalHealthPayload).toMatchObject({
      data: { ready: true, memoryPressure: { level: 'normal' } },
    })

    console.info('REALTIME_MEMORY_QUALIFICATION', JSON.stringify({
      testPid: process.pid,
      serverPid: serverWorkerPid,
      loadWorkerPid,
      budgetBytes: 512 * 1024 * 1024,
      onlineSseClients: loadReport.onlineSseClients,
      sseAliveDuringLarge: loadReport.sseAliveDuringLarge,
      tinyReads: loadReport.tinyReads,
      tinyWrites: loadReport.tinyWrites,
      largeStreamSection: loadReport.largeStreamSection,
      firstLargeStreams: loadReport.firstLargeStreams,
      repeatLargeStreams: loadReport.repeatLargeStreams,
      samePidRecovery: loadReport.samePidRecovery,
      memory: finalServerReport.memory,
      eventLoop: {
        maximumLagMs: finalServerReport.maximumEventLoopLagMs,
        externalHealthSamples: loadReport.health.samples,
        externalHealthP95Ms: loadReport.health.p95Ms,
        externalHealthMaximumMs: loadReport.health.maximumMs,
      },
      memoryLedger: finalServerReport.memoryLedger,
      workspaceStreamPreAuthAdmission: finalWorkspacePreAuthAdmission,
      workspaceStreamPreparationAdmission: finalWorkspacePreparationAdmission,
      streamAdmission: finalStreamAdmission,
      health: finalHealthPayload.data,
    }))
  }, 300_000)
})
