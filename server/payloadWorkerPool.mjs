import { availableParallelism, cpus } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'

export const PAYLOAD_WORKER_THRESHOLD_BYTES = 64 * 1024

const DEFAULT_POOL_SIZE = Math.max(1, Math.min(4, (
  typeof availableParallelism === 'function' ? availableParallelism() : cpus().length
) - 1))
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_QUEUED = 128

function workerPath() {
  return resolve(process.cwd(), 'server', 'payloadWorker.mjs')
}

function serializedBytes(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {})
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Bounded worker pool for large AES+JSON payload work. Workers are created
 * lazily, so small payloads never pay thread startup cost. Any worker
 * failure, timeout, or pool creation error falls back to the synchronous
 * main-thread implementation rather than surfacing as a 500.
 */
export function createPayloadWorkerPool({
  size = DEFAULT_POOL_SIZE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxQueued = DEFAULT_MAX_QUEUED,
  thresholdBytes = PAYLOAD_WORKER_THRESHOLD_BYTES,
  workerFactory = defaultWorkerFactory,
  now = () => Date.now(),
} = {}) {
  const poolSize = Math.max(1, Math.min(4, Math.trunc(Number(size) || 1)))
  const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_TIMEOUT_MS
  const queueLimit = Number.isSafeInteger(Number(maxQueued)) && Number(maxQueued) > 0
    ? Number(maxQueued)
    : DEFAULT_MAX_QUEUED
  const workerThreshold = Number.isSafeInteger(Number(thresholdBytes))
    ? Math.max(1, Number(thresholdBytes))
    : PAYLOAD_WORKER_THRESHOLD_BYTES

  const workers = new Set()
  const queue = []
  const pending = new Map()
  let active = 0
  let degraded = false
  let closed = false
  const counters = {
    created: 0,
    exited: 0,
    degraded: 0,
    queued: 0,
    timedOut: 0,
    rejected: 0,
    processed: 0,
    fallbacks: 0,
    maxQueuedObserved: 0,
  }

  const rejectPendingForWorker = (worker) => {
    for (const entry of pending.values()) {
      if (entry.worker !== worker) continue
      pending.delete(entry.requestId)
      active = Math.max(0, active - 1)
      counters.rejected += 1
      entry.reject(new Error('Payload worker stopped before completing the request.'))
    }
  }

  const createWorker = () => {
    try {
      const worker = workerFactory(workerPath(), { workerData: { poolSize } })
      workers.add(worker)
      counters.created += 1

      worker.on('message', (message) => {
        const entry = pending.get(message?.id)
        if (!entry) return
        pending.delete(message.id)
        active = Math.max(0, active - 1)
        if (message?.error) {
          counters.rejected += 1
          entry.reject(Object.assign(new Error(message.error.message), {
            code: message.error.code,
          }))
        } else {
          counters.processed += 1
          entry.resolve(message.result)
        }
        drain()
      })

      worker.on('error', (error) => {
        counters.degraded += 1
        degraded = true
        rejectPendingForWorker(worker)
        workers.delete(worker)
        void worker.terminate().catch(() => undefined)
        drain()
      })

      worker.on('exit', () => {
        counters.exited += 1
        rejectPendingForWorker(worker)
        workers.delete(worker)
        drain()
      })
      return worker
    } catch (error) {
      counters.degraded += 1
      degraded = true
      return null
    }
  }

  const dispatch = (entry) => {
    if (closed || degraded) return false
    const worker = [...workers].find((candidate) => (
      ![...pending.values()].some((pendingEntry) => pendingEntry.worker === candidate)
    ))
    const target = worker ?? createWorker()
    if (!target) return false
    entry.worker = target
    pending.set(entry.requestId, entry)
    active += 1
    target.postMessage({
      id: entry.requestId,
      operation: entry.operation,
      value: entry.value,
      policy: entry.policy,
    })
    return true
  }

  const drain = () => {
    while (!closed && queue.length > 0) {
      const entry = queue.shift()
      if (degraded || active >= poolSize || !dispatch(entry)) {
        counters.fallbacks += 1
        entry.resolve(null)
      }
    }
  }

  const enqueue = (operation, value, policy) => {
    if (queue.length >= queueLimit) {
      counters.rejected += 1
      const error = new Error('Payload worker queue is full.')
      error.code = 'PAYLOAD_WORKER_QUEUE_FULL'
      return Promise.reject(error)
    }
    const requestId = randomUUID()
    const startedAt = now()
    const entry = {
      requestId,
      operation,
      value,
      policy,
      worker: null,
      resolve: null,
      reject: null,
      timer: null,
    }
    counters.queued += 1
    counters.maxQueuedObserved = Math.max(counters.maxQueuedObserved, queue.length + active)
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve
      entry.reject = reject
    })
    entry.timer = setTimeout(() => {
      if (!pending.has(requestId) && !queue.includes(entry)) return
      const inQueue = queue.indexOf(entry)
      if (inQueue >= 0) queue.splice(inQueue, 1)
      if (pending.has(requestId)) {
        pending.delete(requestId)
        active = Math.max(0, active - 1)
      }
      counters.timedOut += 1
      counters.fallbacks += 1
      // entry.reject, not the executor's binding: this callback runs outside
      // the Promise executor scope, so a bare reject here is a ReferenceError
      // thrown from a timer -- which terminates the process rather than
      // degrading this one payload back to the main thread.
      entry.reject(Object.assign(new Error('Payload worker timed out.'), {
        code: 'PAYLOAD_WORKER_TIMEOUT',
      }))
      drain()
    }, timeout)
    entry.timer.unref?.()
    promise.finally(() => clearTimeout(entry.timer)).catch(() => undefined)
    queue.push(entry)
    drain()
    return promise
  }

  const encode = async (value, options = {}) => {
    const policy = options.policy ?? null
    // The storage layer already has a conservative size estimate and may want
    // the worker to own serialization itself. Skipping the main-thread size
    // calculation is what lets large object payloads avoid JSON.stringify on
    // the event loop.
    const bytes = options.skipSizeCheck ? workerThreshold + 1 : serializedBytes(value)
    if (bytes <= workerThreshold && !options.forceWorker) return null
    try {
      const result = await enqueue('encode', value, policy)
      return result === null ? null : result
    } catch {
      counters.fallbacks += 1
      return null
    }
  }

  const decode = async (value, options = {}) => {
    const bytes = serializedBytes(value)
    if (bytes <= workerThreshold && !options.forceWorker) return null
    try {
      const result = await enqueue('decode', value, {})
      return result === null ? null : result
    } catch {
      counters.fallbacks += 1
      return null
    }
  }

  const close = async () => {
    if (closed) return
    closed = true
    for (const entry of queue.splice(0)) {
      counters.rejected += 1
      entry.reject(new Error('Payload worker pool closed.'))
    }
    for (const entry of pending.values()) {
      counters.rejected += 1
      entry.reject(new Error('Payload worker pool closed.'))
    }
    pending.clear()
    active = 0
    await Promise.allSettled([...workers].map((worker) => worker.terminate()))
    workers.clear()
  }

  const snapshot = () => ({
    poolSize,
    active,
    queued: queue.length,
    degraded,
    closed,
    counters: { ...counters },
  })

  return { close, decode, encode, snapshot }
}

function defaultWorkerFactory(filename, options) {
  return new Worker(filename, { ...options, type: 'module' })
}

export const payloadWorkerPool = createPayloadWorkerPool()
