import cluster from 'node:cluster'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAccountPassword, hashAccountPassword } from './passwordSecurity.js'

export const CLUSTER_WORKERS_ENV = 'PHD_ATLAS_CLUSTER_WORKERS'
export const CLUSTER_ROLE_ENV = 'PHD_ATLAS_CLUSTER_ROLE'
export const PASSWORD_WORKER_ROLE = 'password'
export const PASSWORD_WORKER_INDEX_ENV = 'PHD_ATLAS_PASSWORD_WORKER_INDEX'
export const CLUSTER_WORKER_THREADPOOL_ENV = 'PHD_ATLAS_CLUSTER_WORKER_THREADPOOL_SIZE'
export const DEFAULT_CLUSTER_WORKERS = 0

const REQUEST_TYPE = 'phd-atlas.password-work.request'
const RESPONSE_TYPE = 'phd-atlas.password-work.response'
const READY_TYPE = 'phd-atlas.password-work.ready'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_WORKER_READY_TIMEOUT_MS = 15_000
const DEFAULT_RESTART_BURST = 6
const DEFAULT_RESTART_INTERVAL_MS = 300_000
const DEFAULT_RESTART_DELAY_MS = 100
const MAX_CLUSTER_WORKERS = 32

function resolveWorkerExecPath() {
  try {
    return fileURLToPath(new URL('./clusterPasswordWorker.mjs', import.meta.url))
  } catch {
    return path.join(process.cwd(), 'server', 'clusterPasswordWorker.mjs')
  }
}

const workerExecPath = resolveWorkerExecPath()

export function parseClusterWorkerCount(value = process.env[CLUSTER_WORKERS_ENV]) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_CLUSTER_WORKERS
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return DEFAULT_CLUSTER_WORKERS
  return Math.min(MAX_CLUSTER_WORKERS, parsed)
}

export function clusterPasswordWorkEnabled(
  workerCount = parseClusterWorkerCount(),
  environment = process.env,
) {
  return workerCount > 0
    && cluster.isPrimary
    && environment[CLUSTER_ROLE_ENV] !== PASSWORD_WORKER_ROLE
}

export function clusterWorkerThreadPoolSize(
  workerCount = parseClusterWorkerCount(),
  primaryThreadPoolSize = Number.parseInt(String(process.env.UV_THREADPOOL_SIZE ?? ''), 10),
) {
  const parsedPrimary = Number.isSafeInteger(primaryThreadPoolSize) && primaryThreadPoolSize > 0
    ? primaryThreadPoolSize
    : 4
  const configured = Number.parseInt(
    String(process.env[CLUSTER_WORKER_THREADPOOL_ENV] ?? ''),
    10,
  )
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= 128) {
    return configured
  }
  if (workerCount <= 0) return parsedPrimary
  // Keep the primary threadpool unchanged for storage/fs/zlib and give each
  // stateless worker a modest pool sized for its share of password CPU work.
  return Math.max(4, Math.min(32, Math.ceil(parsedPrimary / Math.max(1, workerCount))))
}

export function createRestartBudget({
  burst = DEFAULT_RESTART_BURST,
  intervalMs = DEFAULT_RESTART_INTERVAL_MS,
  now = Date.now,
} = {}) {
  const timestamps = []
  return {
    allow() {
      const nowAt = now()
      while (timestamps.length > 0 && nowAt - timestamps[0] > intervalMs) {
        timestamps.shift()
      }
      if (timestamps.length >= burst) return false
      timestamps.push(nowAt)
      return true
    },
    get count() {
      return timestamps.length
    },
  }
}

function workerUnavailableError(workerId, cause) {
  const error = new Error(`Password cluster worker ${workerId} is unavailable.`)
  error.code = 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_UNAVAILABLE'
  error.workerId = workerId
  if (cause) error.cause = cause
  return error
}

function workerDisconnectedError(workerId, cause) {
  const error = new Error(`Password cluster worker ${workerId} disconnected.`)
  error.code = 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_DISCONNECTED'
  error.workerId = workerId
  if (cause) error.cause = cause
  return error
}

function silenceWorkerProcessErrors(worker) {
  worker.process?.on?.('error', () => {})
}

function requestTimeoutError(timeoutMs) {
  const error = new Error(`Password cluster worker request exceeded ${timeoutMs}ms.`)
  error.code = 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

function normalizeRequestResult(value) {
  if (value && typeof value === 'object' && typeof value.valid === 'boolean') {
    return {
      valid: value.valid,
      needsRehash: value.needsRehash === true,
    }
  }
  if (typeof value === 'string') return value
  throw new Error('Password cluster worker returned an invalid result.')
}

export function createClusterPasswordWorkPool({
  workerCount = parseClusterWorkerCount(),
  fallbackVerify = verifyAccountPassword,
  fallbackHash = hashAccountPassword,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  workerReadyTimeoutMs = DEFAULT_WORKER_READY_TIMEOUT_MS,
  restartBurst = DEFAULT_RESTART_BURST,
  restartIntervalMs = DEFAULT_RESTART_INTERVAL_MS,
  restartDelayMs = DEFAULT_RESTART_DELAY_MS,
  execPath = workerExecPath,
  setupPrimary = (options) => cluster.setupPrimary(options),
  fork = (environment) => cluster.fork(environment),
  addMessageListener = (listener) => cluster.on('message', listener),
  addExitListener = (listener) => cluster.on('exit', listener),
  now = Date.now,
  log = (message, error) => console.error(message, error),
} = {}) {
  const enabled = clusterPasswordWorkEnabled(workerCount)
  const states = new Map()
  const pending = new Map()
  const restartTimers = new Set()
  const restartBudget = createRestartBudget({ burst: restartBurst, intervalMs: restartIntervalMs, now })
  const workerThreadPoolSize = clusterWorkerThreadPoolSize(workerCount)
  let started = false
  let closed = false
  let nextWorkerIndex = 0
  let restartCount = 0
  let readyResolve
  let readyReject
  let readyTimer
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  const failPendingForWorker = (workerId, error) => {
    for (const [requestId, entry] of pending) {
      if (entry.workerId !== workerId) continue
      pending.delete(requestId)
      clearTimeout(entry.timer)
      entry.reject(error)
    }
  }

  const failAllPending = (error) => {
    for (const [requestId, entry] of [...pending]) {
      pending.delete(requestId)
      clearTimeout(entry.timer)
      entry.reject(error)
    }
  }

  const registerWorker = (worker) => {
    if (closed) {
      try { worker.send({ type: 'shutdown', sourcePid: process.pid }) } catch {}
      return
    }
    const workerIndex = states.size
    worker.phdAtlasPasswordWorkerIndex = workerIndex
    silenceWorkerProcessErrors(worker)
    const state = {
      worker,
      index: workerIndex,
      ready: false,
      healthy: false,
      dead: false,
      createdAt: now(),
    }
    states.set(worker.id, state)
  }

  const restartWorker = (worker) => {
    if (closed) return
    if (!restartBudget.allow()) {
      log(`[cluster] Password worker restart burst exceeded ${restartBurst}/300s; keeping the remaining worker pool local-fallback.`)
      return
    }
    restartCount += 1
    const timer = setTimeout(() => {
      restartTimers.delete(timer)
      if (closed) return
      try {
        registerWorker(fork({
          ...process.env,
          [CLUSTER_ROLE_ENV]: PASSWORD_WORKER_ROLE,
          [PASSWORD_WORKER_INDEX_ENV]: String(worker.phdAtlasPasswordWorkerIndex ?? 0),
          UV_THREADPOOL_SIZE: String(workerThreadPoolSize),
        }))
      } catch (error) {
        log('[cluster] Failed to restart password worker:', error)
      }
    }, restartDelayMs)
    timer.unref?.()
    restartTimers.add(timer)
  }

  const start = () => {
    if (started || closed) return
    started = true
    if (!enabled) {
      readyResolve?.()
      readyResolve = null
      return
    }
    setupPrimary({ exec: execPath, execArgv: [] })
    readyTimer = setTimeout(() => {
      readyTimer = null
      if (readyResolve) {
        readyResolve()
        readyResolve = null
      }
    }, workerReadyTimeoutMs)
    readyTimer.unref?.()
    addMessageListener((worker, message) => {
      if (message && message.type === READY_TYPE) {
        const state = states.get(worker.id)
        if (state && !state.dead) {
          state.ready = true
          state.healthy = true
          readyResolve?.()
          readyResolve = null
          if (readyTimer) {
            clearTimeout(readyTimer)
            readyTimer = null
          }
        }
        return
      }
      if (!message || message.type !== RESPONSE_TYPE || typeof message.requestId !== 'string') return
      const entry = pending.get(message.requestId)
      if (!entry || entry.workerId !== worker.id) return
      pending.delete(message.requestId)
      clearTimeout(entry.timer)
      if (message.error) {
        const error = new Error(message.error.message || 'Password cluster worker failed.')
        error.code = message.error.code || 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_ERROR'
        entry.reject(error)
        return
      }
      try {
        entry.resolve(normalizeRequestResult(message.result))
      } catch (error) {
        entry.reject(error)
      }
    })
    addExitListener((worker, code, signal) => {
      const state = states.get(worker.id)
      states.delete(worker.id)
      if (state) state.dead = true
      failPendingForWorker(worker.id, workerDisconnectedError(worker.id, { code, signal }))
      if (!closed) restartWorker(worker)
    })
    for (let index = 0; index < workerCount; index += 1) {
      try {
        registerWorker(fork({
          ...process.env,
          [CLUSTER_ROLE_ENV]: PASSWORD_WORKER_ROLE,
          [PASSWORD_WORKER_INDEX_ENV]: String(index),
          UV_THREADPOOL_SIZE: String(workerThreadPoolSize),
        }))
      } catch (error) {
        log('[cluster] Failed to fork password worker:', error)
        readyReject?.(error)
        readyReject = null
      }
    }
  }

  const chooseWorker = () => {
    const healthy = [...states.values()].filter((state) => state.healthy && !state.dead)
    if (healthy.length === 0) return null
    const worker = healthy[nextWorkerIndex % healthy.length].worker
    nextWorkerIndex += 1
    return worker
  }

  const dispatch = async (operation, payload) => {
    const runFallback = () => (
      operation === 'verify'
        ? fallbackVerify(payload.password, payload.encoded)
        : fallbackHash(payload.password)
    )
    if (!enabled || closed) {
      return runFallback()
    }
    await readyPromise
    if (closed || !enabled) {
      return runFallback()
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const worker = chooseWorker()
      if (!worker) break
      const requestId = randomUUID()
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            reject(requestTimeoutError(requestTimeoutMs))
          }, requestTimeoutMs)
          timer.unref?.()
          pending.set(requestId, {
            workerId: worker.id,
            resolve,
            reject,
            timer,
          })
          const accepted = worker.send({
            type: REQUEST_TYPE,
            requestId,
            sourcePid: process.pid,
            operation,
            ...payload,
          })
          if (!accepted) {
            pending.delete(requestId)
            clearTimeout(timer)
            reject(workerUnavailableError(worker.id))
          }
        })
      } catch (error) {
        const state = states.get(worker.id)
        if (state && !state.dead) continue
      }
    }
    return runFallback()
  }

  const close = async () => {
    if (closed) return
    closed = true
    for (const timer of restartTimers) clearTimeout(timer)
    restartTimers.clear()
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
    if (!enabled || states.size === 0) {
      failAllPending(workerDisconnectedError('pool', new Error('Password worker pool closed.')))
      return
    }
    const workers = [...states.values()].map((state) => state.worker)
    failAllPending(workerDisconnectedError('pool', new Error('Password worker pool closed.')))
    for (const worker of workers) {
      silenceWorkerProcessErrors(worker)
      try {
        worker.send({ type: 'shutdown', sourcePid: process.pid })
      } catch {}
      // The worker may already be disconnected.
    }
    await Promise.all(workers.map((worker) => new Promise((resolve) => {
      if (worker.isDead()) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, 1_000)
      timer.unref?.()
      worker.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })))
    states.clear()
  }

  start()

  return Object.freeze({
    enabled,
    workerCount: enabled ? workerCount : 0,
    workerThreadPoolSize: enabled ? workerThreadPoolSize : null,
    ready: readyPromise,
    async verifyAccountPassword(password, encoded) {
      return dispatch('verify', { password, encoded })
    },
    async hashAccountPassword(password) {
      return dispatch('hash', { password })
    },
    snapshot() {
      return {
        enabled,
        closed,
        workerCount: enabled ? workerCount : 0,
        healthyWorkers: enabled ? [...states.values()].filter((state) => state.healthy).length : 0,
        restartCount,
        restartBurst,
        restartIntervalMs,
        pending: pending.size,
      }
    },
    getWorkerProcessIds() {
      return [...states.values()]
        .filter((state) => !state.dead)
        .map((state) => state.worker.process.pid)
    },
    close,
  })
}

export function createPasswordWorkPoolForRuntime(environment = process.env) {
  const workerCount = parseClusterWorkerCount(environment[CLUSTER_WORKERS_ENV])
  return createClusterPasswordWorkPool({ workerCount })
}
