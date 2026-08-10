import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

const DEFAULT_CACHE_MAX_ENTRIES = 256
const DEFAULT_CACHE_MAX_BYTES = 32 * 1024 * 1024
const DEFAULT_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024
const DEFAULT_RATE_LIMIT_MAX_ENTRIES = 20_000

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function serializedBytes(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8')
}

/**
 * Per-store conditional response cache with strict LRU entry and byte bounds.
 * The WeakMap never keeps an obsolete store snapshot alive by itself.
 */
export function createBoundedConditionalPayloadCache({
  maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
  maxBytes = DEFAULT_CACHE_MAX_BYTES,
  maxEntryBytes = DEFAULT_CACHE_MAX_ENTRY_BYTES,
  now = () => Date.now(),
} = {}) {
  const entryLimit = positiveInteger(maxEntries, DEFAULT_CACHE_MAX_ENTRIES)
  const byteLimit = positiveInteger(maxBytes, DEFAULT_CACHE_MAX_BYTES)
  const singleEntryLimit = Math.min(
    byteLimit,
    positiveInteger(maxEntryBytes, DEFAULT_CACHE_MAX_ENTRY_BYTES),
  )
  const stores = new WeakMap()
  const lifetime = {
    hits: 0,
    misses: 0,
    evictions: 0,
    oversized: 0,
    stores: 0,
  }

  const stateFor = (store, create = false) => {
    if (!store || (typeof store !== 'object' && typeof store !== 'function')) return null
    let state = stores.get(store)
    if (!state && create) {
      state = { entries: new Map(), bytes: 0 }
      stores.set(store, state)
      lifetime.stores += 1
    }
    return state ?? null
  }

  const remove = (state, key, { evicted = false } = {}) => {
    const entry = state?.entries.get(key)
    if (!entry) return false
    state.entries.delete(key)
    state.bytes = Math.max(0, state.bytes - entry.bytes)
    if (evicted) lifetime.evictions += 1
    return true
  }

  const get = (store, key, { revision, maxAgeMs = Number.POSITIVE_INFINITY } = {}) => {
    const state = stateFor(store)
    const entry = state?.entries.get(key)
    const stale = entry && (
      entry.revision !== revision
      || now() - entry.storedAt > maxAgeMs
    )
    if (!entry || stale) {
      if (stale) remove(state, key)
      lifetime.misses += 1
      return null
    }
    // Map insertion order is the LRU order. Refresh it on every successful read.
    state.entries.delete(key)
    state.entries.set(key, entry)
    lifetime.hits += 1
    return entry
  }

  const set = (store, key, payload) => {
    const state = stateFor(store, true)
    if (!state) return false
    remove(state, key)
    const bytes = serializedBytes(payload?.dataJson)
    if (bytes > singleEntryLimit || bytes > byteLimit) {
      lifetime.oversized += 1
      return false
    }
    const entry = { ...payload, bytes }
    state.entries.set(key, entry)
    state.bytes += bytes
    while (state.entries.size > entryLimit || state.bytes > byteLimit) {
      const oldestKey = state.entries.keys().next().value
      if (oldestKey === undefined) break
      remove(state, oldestKey, { evicted: true })
    }
    return state.entries.get(key) === entry
  }

  const inspect = (store) => {
    const state = stateFor(store)
    return {
      entries: state?.entries.size ?? 0,
      bytes: state?.bytes ?? 0,
      maxEntries: entryLimit,
      maxBytes: byteLimit,
      maxEntryBytes: singleEntryLimit,
      ...lifetime,
    }
  }

  return { get, inspect, set }
}

/**
 * Process-local fixed-window buckets with a strict LRU entry bound.
 *
 * A hostile client can continuously rotate IPs, tokens, or email addresses.
 * Keeping eviction here O(1) prevents that traffic from turning a full bucket
 * map into a per-request scan of every retained identity.
 */
export function createBoundedRateLimitBuckets({
  maxEntries = DEFAULT_RATE_LIMIT_MAX_ENTRIES,
} = {}) {
  const entryLimit = positiveInteger(maxEntries, DEFAULT_RATE_LIMIT_MAX_ENTRIES)
  const buckets = new Map()
  let evictions = 0
  let stalePruned = 0

  const evictOldest = () => {
    const oldestKey = buckets.keys().next().value
    if (oldestKey === undefined) return false
    buckets.delete(oldestKey)
    evictions += 1
    return true
  }

  const getOrCreate = (key, startedAt) => {
    let bucket = buckets.get(key)
    if (bucket) {
      // Map insertion order is the LRU order. Refresh without allocating a new
      // bucket so counters held by the limiter remain authoritative.
      buckets.delete(key)
      buckets.set(key, bucket)
      return bucket
    }
    while (buckets.size >= entryLimit) {
      if (!evictOldest()) break
    }
    bucket = { startedAt, count: 0 }
    buckets.set(key, bucket)
    return bucket
  }

  const pruneBefore = (cutoff) => {
    let removed = 0
    for (const [key, bucket] of buckets) {
      if (bucket.startedAt >= cutoff) continue
      buckets.delete(key)
      removed += 1
    }
    stalePruned += removed
    return removed
  }

  const inspect = () => ({
    entries: buckets.size,
    maxEntries: entryLimit,
    evictions,
    stalePruned,
  })

  return { getOrCreate, inspect, pruneBefore }
}

export function startupRetryDelayMs(attempt, {
  baseDelayMs = 250,
  maxDelayMs = 8_000,
  random = Math.random,
} = {}) {
  const exponent = Math.max(0, Number(attempt) - 1)
  const base = Math.min(
    positiveInteger(maxDelayMs, 8_000),
    positiveInteger(baseDelayMs, 250) * (2 ** Math.min(exponent, 20)),
  )
  const jitter = 0.8 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4)
  return Math.max(1, Math.round(base * jitter))
}

export class StartupOperationAbortedError extends Error {
  constructor(message = 'Server startup was cancelled.') {
    super(message)
    this.name = 'StartupOperationAbortedError'
    this.code = 'STARTUP_ABORTED'
  }
}

export class StartupOperationTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Startup operation exceeded its ${timeoutMs} ms deadline.`)
    this.name = 'StartupOperationTimeoutError'
    this.code = 'STARTUP_SUBSYSTEM_TIMEOUT'
    this.timeoutMs = timeoutMs
  }
}

function startupAbortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  return new StartupOperationAbortedError()
}

/**
 * Races work against cancellation while retaining rejection handlers on work
 * that ignores AbortSignal and settles late. This is important during startup:
 * a timed-out optional subsystem must not turn into an unhandled rejection.
 */
function settleStartupPromiseWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise)
  if (signal.aborted) return Promise.reject(startupAbortReason(signal))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, startupAbortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}

export function abortableStartupDelay(delayMs, {
  signal,
  timers = globalThis,
} = {}) {
  const delay = Math.max(1, Number(delayMs) || 1)
  if (signal?.aborted) return Promise.reject(startupAbortReason(signal))
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      if (timer) timers.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, startupAbortReason(signal))
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = timers.setTimeout(() => finish(resolve), delay)
    timer?.unref?.()
  })
}

/** Runs one optional startup attempt with an independent hard deadline. */
export async function runStartupOperationWithDeadline(operation, {
  timeoutMs = 30_000,
  signal,
  timers = globalThis,
} = {}) {
  const timeout = positiveInteger(timeoutMs, 30_000)
  if (signal?.aborted) throw startupAbortReason(signal)
  const attemptController = new AbortController()
  const forwardAbort = () => attemptController.abort(startupAbortReason(signal))
  signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeoutError = new StartupOperationTimeoutError(timeout)
  const timer = timers.setTimeout(() => attemptController.abort(timeoutError), timeout)
  timer?.unref?.()
  try {
    const operationPromise = Promise.resolve().then(() => operation({
      signal: attemptController.signal,
    }))
    return await settleStartupPromiseWithSignal(operationPromise, attemptController.signal)
  } finally {
    timers.clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Keeps a listener alive through a transient dependency outage. */
export async function retryStartupOperation(operation, {
  maxAttempts = 7,
  baseDelayMs = 250,
  maxDelayMs = 8_000,
  random = Math.random,
  sleep = (delayMs, options) => abortableStartupDelay(delayMs, options),
  onAttempt,
  shouldRetry = () => true,
  signal,
} = {}) {
  const attempts = maxAttempts === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : positiveInteger(maxAttempts, 7)
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw startupAbortReason(signal)
    try {
      const operationPromise = Promise.resolve().then(() => operation(attempt, { signal }))
      const value = await settleStartupPromiseWithSignal(operationPromise, signal)
      onAttempt?.({ attempt, status: 'ready', error: null, retryDelayMs: null })
      return value
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.code === 'STARTUP_ABORTED') {
        onAttempt?.({ attempt, status: 'aborted', error, retryDelayMs: null })
        throw startupAbortReason(signal)
      }
      if (attempt >= attempts || !shouldRetry(error, attempt)) {
        onAttempt?.({ attempt, status: 'failed', error, retryDelayMs: null })
        break
      }
      const retryDelayMs = startupRetryDelayMs(attempt, { baseDelayMs, maxDelayMs, random })
      onAttempt?.({ attempt, status: 'retrying', error, retryDelayMs })
      try {
        const sleepPromise = Promise.resolve(sleep(retryDelayMs, { signal }))
        await settleStartupPromiseWithSignal(sleepPromise, signal)
      } catch (error) {
        if (signal?.aborted || error?.code === 'STARTUP_ABORTED') {
          onAttempt?.({ attempt, status: 'aborted', error, retryDelayMs: null })
          throw startupAbortReason(signal)
        }
        throw error
      }
    }
  }
  throw lastError
}

export class MutationAdmissionError extends Error {
  constructor(reason, message = 'The server is busy. Please retry shortly.') {
    super(message)
    this.name = 'MutationAdmissionError'
    this.code = reason === 'cancelled' ? 'REQUEST_CANCELLED' : 'SERVER_BUSY'
    this.reason = reason
    this.status = reason === 'cancelled' ? 499 : 503
  }
}

/**
 * Owns an admission lease until both the incoming body and outgoing response
 * have settled. A response can finish before an HTTP client has stopped
 * uploading; treating that finish as sufficient would let many slow bodies
 * reuse one bounded parser slot. When the caller explicitly requires closing
 * an unconsumed body, the transport is destroyed only after the early response
 * has been handed to the socket.
 */
export function bindAdmissionToHttpLifecycle(request, response, {
  release,
  bodyDeadlineMs = 0,
  closeUnconsumedBody = false,
  releaseOnBodyComplete = false,
  onBodyTimeout = null,
  timers = globalThis,
} = {}) {
  if (typeof release !== 'function') {
    throw new TypeError('An admission release callback is required.')
  }

  let released = false
  let requestBodyComplete = Boolean(request.complete)
  let requestTerminated = Boolean(request.destroyed || request.aborted)
  let responseSettled = Boolean(response.destroyed || response.writableFinished)
  let bodyDeadlineTimer = null

  const transportClosed = () => Boolean(
    request.socket?.destroyed,
  )

  const closeTransport = ({ immediate = false } = {}) => {
    const socket = request.socket
    if (!socket || socket.destroyed) return
    if (immediate) {
      socket.destroy()
      return
    }
    if (typeof socket.destroySoon === 'function') {
      socket.destroySoon()
      return
    }
    socket.end?.()
  }

  const clearBodyDeadline = () => {
    if (bodyDeadlineTimer) timers.clearTimeout(bodyDeadlineTimer)
    bodyDeadlineTimer = null
  }

  const removeListeners = () => {
    request.removeListener('end', completeRequestBody)
    request.removeListener('aborted', terminateRequest)
    request.removeListener('error', terminateRequest)
    request.removeListener('close', terminateRequest)
    response.removeListener('finish', settleResponse)
    response.removeListener('close', settleResponse)
    response.removeListener('error', settleResponse)
    request.socket?.removeListener?.('close', settleTransport)
  }

  const releaseAdmission = () => {
    if (released) return false
    released = true
    clearBodyDeadline()
    removeListeners()
    release()
    return true
  }

  const maybeRelease = () => {
    if (transportClosed() || (requestBodyComplete && responseSettled)) {
      return releaseAdmission()
    }
    return false
  }

  function completeRequestBody() {
    requestBodyComplete = true
    clearBodyDeadline()
    if (releaseOnBodyComplete) {
      releaseAdmission()
      return
    }
    maybeRelease()
  }

  function terminateRequest() {
    requestTerminated = true
    clearBodyDeadline()
    if (
      !request.complete
      && closeUnconsumedBody
      && !responseSettled
    ) {
      // An aborted IncomingMessage can close before its underlying socket on
      // some runtimes. Do not leave that socket parked forever waiting for the
      // declared remainder of a body the client will never send.
      closeTransport({ immediate: true })
    }
    maybeRelease()
  }

  function settleResponse() {
    responseSettled = true
    if (request.complete) requestBodyComplete = true
    if (
      closeUnconsumedBody
      && !requestBodyComplete
      && !transportClosed()
    ) {
      response.shouldKeepAlive = false
      closeTransport()
    }
    maybeRelease()
  }

  function settleTransport() {
    requestTerminated = true
    clearBodyDeadline()
    maybeRelease()
  }

  request.once('end', completeRequestBody)
  request.once('aborted', terminateRequest)
  request.once('error', terminateRequest)
  request.once('close', terminateRequest)
  response.once('finish', settleResponse)
  response.once('close', settleResponse)
  response.once('error', settleResponse)
  request.socket?.once?.('close', settleTransport)

  if (requestTerminated && !requestBodyComplete && closeUnconsumedBody) {
    closeTransport({ immediate: true })
  }

  const deadlineMs = Math.max(0, Number(bodyDeadlineMs) || 0)
  if (deadlineMs > 0 && !requestBodyComplete && !requestTerminated) {
    bodyDeadlineTimer = timers.setTimeout(() => {
      bodyDeadlineTimer = null
      if (request.complete) {
        completeRequestBody()
        return
      }
      if (transportClosed()) {
        maybeRelease()
        return
      }
      response.shouldKeepAlive = false
      if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        response.setHeader?.('Connection', 'close')
        if (typeof onBodyTimeout === 'function') {
          onBodyTimeout()
          return
        }
      }
      closeTransport({ immediate: true })
      maybeRelease()
    }, deadlineMs)
    bodyDeadlineTimer?.unref?.()
  }

  if (requestBodyComplete && releaseOnBodyComplete) releaseAdmission()
  else maybeRelease()
  return {
    isReleased: () => released,
    release: releaseAdmission,
  }
}

/** FIFO admission controller used before expensive mutation snapshot hydration. */
export function createMutationAdmissionController({
  maxActive = 4,
  maxQueued = 64,
  waitTimeoutMs = 15_000,
  maxActivePerKey = Number.MAX_SAFE_INTEGER,
  maxQueuedPerKey = Number.MAX_SAFE_INTEGER,
  queueWhenPerKeyActive = false,
  timers = globalThis,
  now = () => Date.now(),
} = {}) {
  const activeLimit = positiveInteger(maxActive, 4)
  const queueLimit = positiveInteger(maxQueued, 64)
  const timeout = positiveInteger(waitTimeoutMs, 15_000)
  const perKeyActiveLimit = positiveInteger(maxActivePerKey, Number.MAX_SAFE_INTEGER)
  const perKeyQueueLimit = positiveInteger(maxQueuedPerKey, Number.MAX_SAFE_INTEGER)
  const queue = []
  const activeByKey = new Map()
  const queuedByKey = new Map()
  let active = 0
  let closed = false
  const counters = {
    admitted: 0,
    queued: 0,
    rejected: 0,
    timedOut: 0,
    cancelled: 0,
    perKeyRejected: 0,
    maxObservedActive: 0,
    maxObservedQueued: 0,
    totalWaitMs: 0,
  }

  const snapshot = () => ({
    active,
    waiting: queue.length,
    maxActive: activeLimit,
    maxQueued: queueLimit,
    waitTimeoutMs: timeout,
    maxActivePerKey: perKeyActiveLimit,
    maxQueuedPerKey: perKeyQueueLimit,
    queueWhenPerKeyActive: queueWhenPerKeyActive === true,
    activeKeys: activeByKey.size,
    queuedKeys: queuedByKey.size,
    closed,
    ...counters,
  })

  const updateKeyCount = (map, key, delta) => {
    if (!key) return
    const next = Math.max(0, (map.get(key) ?? 0) + delta)
    if (next === 0) map.delete(key)
    else map.set(key, next)
  }

  const markWaiterDequeued = (waiter) => {
    if (!waiter.inQueue) return
    waiter.inQueue = false
    updateKeyCount(queuedByKey, waiter.key, -1)
  }

  const settleWaiter = (waiter, error = null) => {
    if (waiter.settled) return false
    waiter.settled = true
    markWaiterDequeued(waiter)
    if (waiter.timer) timers.clearTimeout(waiter.timer)
    waiter.signal?.removeEventListener('abort', waiter.onAbort)
    if (error) waiter.reject(error)
    else waiter.resolve(grant(waiter.queuedAt, waiter.key))
    return true
  }

  const removeWaiter = (waiter) => {
    const index = queue.indexOf(waiter)
    if (index >= 0) queue.splice(index, 1)
    markWaiterDequeued(waiter)
  }

  const drain = () => {
    if (closed) return
    while (active < activeLimit && queue.length > 0) {
      const waiterIndex = queue.findIndex((candidate) => (
        !candidate?.key
        || (activeByKey.get(candidate.key) ?? 0) < perKeyActiveLimit
      ))
      if (waiterIndex < 0) return
      const [waiter] = queue.splice(waiterIndex, 1)
      if (!waiter || waiter.settled) continue
      settleWaiter(waiter)
    }
  }

  function grant(queuedAt = now(), key = '') {
    active += 1
    updateKeyCount(activeByKey, key, 1)
    counters.admitted += 1
    counters.totalWaitMs += Math.max(0, now() - queuedAt)
    counters.maxObservedActive = Math.max(counters.maxObservedActive, active)
    let released = false
    return () => {
      if (released) return
      released = true
      active = Math.max(0, active - 1)
      updateKeyCount(activeByKey, key, -1)
      drain()
    }
  }

  const enqueue = ({ signal, key }) => {
    if (queue.length >= queueLimit) {
      counters.rejected += 1
      return Promise.reject(new MutationAdmissionError('queue-full'))
    }
    if (key && (queuedByKey.get(key) ?? 0) >= perKeyQueueLimit) {
      counters.rejected += 1
      counters.perKeyRejected += 1
      return Promise.reject(new MutationAdmissionError('per-key-queue-full'))
    }

    counters.queued += 1
    const queuedAt = now()
    return new Promise((resolve, reject) => {
      const waiter = {
        queuedAt,
        resolve,
        reject,
        signal,
        key,
        inQueue: true,
        settled: false,
        timer: null,
        onAbort: null,
      }
      waiter.onAbort = () => {
        removeWaiter(waiter)
        counters.cancelled += 1
        settleWaiter(waiter, new MutationAdmissionError('cancelled'))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      waiter.timer = timers.setTimeout(() => {
        removeWaiter(waiter)
        counters.timedOut += 1
        settleWaiter(waiter, new MutationAdmissionError('timeout'))
      }, timeout)
      waiter.timer?.unref?.()
      queue.push(waiter)
      updateKeyCount(queuedByKey, key, 1)
      counters.maxObservedQueued = Math.max(counters.maxObservedQueued, queue.length)
    })
  }

  const acquire = ({ signal, key: rawKey } = {}) => {
    const key = String(rawKey ?? '').trim().slice(0, 256)
    if (signal?.aborted) {
      counters.cancelled += 1
      return Promise.reject(new MutationAdmissionError('cancelled'))
    }
    if (closed) {
      counters.rejected += 1
      return Promise.reject(new MutationAdmissionError('closed'))
    }
    if (key && (activeByKey.get(key) ?? 0) >= perKeyActiveLimit) {
      if (queueWhenPerKeyActive === true) return enqueue({ signal, key })
      counters.rejected += 1
      counters.perKeyRejected += 1
      return Promise.reject(new MutationAdmissionError('per-key-active'))
    }
    if (active < activeLimit) return Promise.resolve(grant(now(), key))
    return enqueue({ signal, key })
  }

  const close = () => {
    if (closed) return
    closed = true
    for (const waiter of queue.splice(0)) {
      markWaiterDequeued(waiter)
      counters.rejected += 1
      settleWaiter(waiter, new MutationAdmissionError('closed'))
    }
  }

  return { acquire, close, snapshot }
}

/** Lightweight process and event-loop sampler for the admin diagnostics route. */
export function createRuntimeHealthMonitor({ resolution = 20 } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: positiveInteger(resolution, 20) })
  histogram.enable()
  let previousUtilization = performance.eventLoopUtilization()
  let closed = false

  const milliseconds = (nanoseconds) => {
    const value = Number(nanoseconds)
    return Number.isFinite(value) ? Math.round((value / 1e6) * 100) / 100 : 0
  }

  const snapshot = ({ admission, cache } = {}) => {
    const current = performance.eventLoopUtilization()
    const delta = performance.eventLoopUtilization(current, previousUtilization)
    previousUtilization = current
    const memory = process.memoryUsage()
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      processMemory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      eventLoop: {
        utilization: Math.round(delta.utilization * 10_000) / 10_000,
        delayMeanMs: milliseconds(histogram.mean),
        delayP50Ms: milliseconds(histogram.percentile(50)),
        delayP95Ms: milliseconds(histogram.percentile(95)),
        delayP99Ms: milliseconds(histogram.percentile(99)),
        delayMaxMs: milliseconds(histogram.max),
      },
      mutationAdmission: admission ?? null,
      conditionalCache: cache ?? null,
    }
  }

  const close = () => {
    if (closed) return
    closed = true
    histogram.disable()
  }

  return { close, snapshot }
}
