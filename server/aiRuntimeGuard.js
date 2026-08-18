import { AI_KEY_MAX_CONCURRENCY } from './shared/aiConcurrency.js'

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(parsed)))
}

function identity(value, fallback) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized.slice(0, 256) : fallback
}

function increment(counter, key) {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function decrement(counter, key) {
  const next = (counter.get(key) ?? 0) - 1
  if (next > 0) counter.set(key, next)
  else counter.delete(key)
}

export class AiCapacityError extends Error {
  constructor(reason = 'capacity') {
    super(reason === 'cancelled'
      ? 'The AI request was cancelled while waiting for capacity.'
      : 'AI capacity is busy. Please retry shortly.')
    this.name = 'AiCapacityError'
    this.code = 'AI_CAPACITY_EXCEEDED'
    this.reason = reason
  }
}

export class AiRequestDeadlineError extends Error {
  constructor(timeoutMs) {
    super('The AI request exceeded its absolute lifecycle deadline.')
    this.name = 'AiRequestDeadlineError'
    this.code = 'AI_REQUEST_TIMEOUT'
    this.status = 504
    this.timeoutMs = timeoutMs
  }
}

/**
 * Fair, process-local admission for expensive provider/crawler work.
 *
 * Reservations are atomic across the global, caller, and key dimensions. A
 * queued request never owns one scarce dimension while waiting for another,
 * avoiding the deadlocks and head-of-line stalls caused by stacked semaphores.
 */
export function createAiAdmissionController({
  maxActive = 2,
  maxQueued = 32,
  maxPerPrincipal = 1,
  maxPerKey = 1,
  waitTimeoutMs = 12_000,
} = {}) {
  const limits = {
    maxActive: positiveInteger(maxActive, 2, AI_KEY_MAX_CONCURRENCY),
    maxQueued: positiveInteger(maxQueued, 32, 10_000),
    maxPerPrincipal: positiveInteger(maxPerPrincipal, 1, AI_KEY_MAX_CONCURRENCY),
    maxPerKey: positiveInteger(maxPerKey, 1, AI_KEY_MAX_CONCURRENCY),
    waitTimeoutMs: positiveInteger(waitTimeoutMs, 12_000, 300_000),
  }
  const principalActive = new Map()
  const keyActive = new Map()
  const queue = []
  let active = 0
  let closed = false
  let accepted = 0
  let rejected = 0
  let timedOut = 0
  let cancelled = 0

  const normalizeRequest = ({
    principalId,
    keyIds = [],
    signal,
    maxActive: requestMaxActive,
    maxPerKey: requestMaxPerKey,
  } = {}) => ({
    principalId: identity(principalId, 'unknown-principal'),
    keyIds: [...new Set((Array.isArray(keyIds) ? keyIds : [keyIds])
      .map((keyId) => identity(keyId, 'unknown-key')))],
    effectiveMaxActive: positiveInteger(requestMaxActive, limits.maxActive, limits.maxActive),
    effectiveMaxPerKey: positiveInteger(requestMaxPerKey, limits.maxPerKey, limits.maxPerKey),
    signal,
  })

  const canRun = (entry) => (
    active < entry.effectiveMaxActive
    && (principalActive.get(entry.principalId) ?? 0) < limits.maxPerPrincipal
    && entry.keyIds.every((keyId) => (keyActive.get(keyId) ?? 0) < entry.effectiveMaxPerKey)
  )

  const removeQueued = (entry) => {
    const index = queue.indexOf(entry)
    if (index >= 0) queue.splice(index, 1)
  }

  const settleQueued = (entry) => {
    if (entry.settled) return false
    entry.settled = true
    if (entry.timer) clearTimeout(entry.timer)
    entry.signal?.removeEventListener('abort', entry.onAbort)
    return true
  }

  let pump = () => {}
  const grant = (entry) => {
    if (!settleQueued(entry)) return
    active += 1
    accepted += 1
    increment(principalActive, entry.principalId)
    for (const keyId of entry.keyIds) increment(keyActive, keyId)
    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.signal?.removeEventListener('abort', release)
      active = Math.max(0, active - 1)
      decrement(principalActive, entry.principalId)
      for (const keyId of entry.keyIds) decrement(keyActive, keyId)
      pump()
    }
    entry.signal?.addEventListener('abort', release, { once: true })
    entry.resolve(release)
  }

  pump = () => {
    if (closed) return
    while (active < limits.maxActive) {
      const index = queue.findIndex((entry) => !entry.settled && canRun(entry))
      if (index < 0) break
      const [entry] = queue.splice(index, 1)
      grant(entry)
    }
  }

  const acquire = (request = {}) => {
    const normalized = normalizeRequest(request)
    if (closed) return Promise.reject(new AiCapacityError('closed'))
    if (normalized.signal?.aborted) {
      cancelled += 1
      return Promise.reject(new AiCapacityError('cancelled'))
    }
    if (queue.length >= limits.maxQueued && !canRun(normalized)) {
      rejected += 1
      return Promise.reject(new AiCapacityError('queue_full'))
    }

    return new Promise((resolve, reject) => {
      const entry = {
        ...normalized,
        resolve,
        reject,
        settled: false,
        timer: null,
        onAbort: null,
      }
      entry.onAbort = () => {
        if (!settleQueued(entry)) return
        removeQueued(entry)
        cancelled += 1
        reject(new AiCapacityError('cancelled'))
        pump()
      }
      entry.timer = setTimeout(() => {
        if (!settleQueued(entry)) return
        removeQueued(entry)
        timedOut += 1
        reject(new AiCapacityError('wait_timeout'))
        pump()
      }, limits.waitTimeoutMs)
      entry.timer.unref?.()
      entry.signal?.addEventListener('abort', entry.onAbort, { once: true })
      if (canRun(entry)) grant(entry)
      else queue.push(entry)
    })
  }

  const close = () => {
    if (closed) return
    closed = true
    for (const entry of queue.splice(0)) {
      if (!settleQueued(entry)) continue
      rejected += 1
      entry.reject(new AiCapacityError('closed'))
    }
  }

  return {
    acquire,
    close,
    snapshot: () => ({
      ...limits,
      active,
      queued: queue.length,
      activePrincipals: principalActive.size,
      activeKeys: keyActive.size,
      accepted,
      rejected,
      timedOut,
      cancelled,
      closed,
    }),
  }
}

const AI_CAPACITY_ROUTES = [
  // Express routes are case-insensitive by default. Capacity and deadline
  // ownership must use identical matching semantics or a mixed-case URL could
  // reach a real provider route through the ordinary mutation pool.
  { kind: 'draft', pattern: /^\/api\/ai\/draft\/?$/i },
  { kind: 'keyTest', pattern: /^\/api\/ai\/keys\/[^/]+\/test\/?$/i },
  { kind: 'researchStart', pattern: /^\/api\/discover\/research\/start\/?$/i },
  { kind: 'enrichmentPreview', pattern: /^\/api\/discover\/applications\/[^/]+\/enrichment\/preview\/?$/i },
  { kind: 'mailClassification', pattern: /^\/api\/applications\/[^/]+\/communications\/classify\/?$/i },
  { kind: 'interviewQuestions', pattern: /^\/api\/interview-prep\/ai\/questions\/?$/i },
  { kind: 'interviewMockTurn', pattern: /^\/api\/interview-prep\/ai\/mock-turn\/?$/i },
  { kind: 'interviewFeedback', pattern: /^\/api\/interview-prep\/ai\/feedback\/?$/i },
]

const DEFAULT_AI_REQUEST_DEADLINES_MS = {
  draft: 195_000,
  keyTest: 45_000,
  researchStart: 60_000,
  enrichmentPreview: 480_000,
  mailClassification: 195_000,
  interviewQuestions: 195_000,
  interviewMockTurn: 195_000,
  interviewFeedback: 195_000,
}

function aiCapacityRoute(request) {
  if (String(request?.method ?? '').toUpperCase() !== 'POST') return null
  let pathname = ''
  try {
    pathname = new URL(request.originalUrl || request.url || '/', 'http://localhost').pathname
  } catch {
    return null
  }
  return AI_CAPACITY_ROUTES.find(({ pattern }) => pattern.test(pathname)) ?? null
}

export function isAiCapacityRequest(request) {
  return Boolean(aiCapacityRoute(request))
}

export function aiCapacityRequestDeadlineMs(request, configured = {}) {
  const kind = aiCapacityRoute(request)?.kind
  if (!kind) return 0
  return positiveInteger(
    configured[kind],
    DEFAULT_AI_REQUEST_DEADLINES_MS[kind],
    30 * 60_000,
  )
}

export function aiCapacityIdentity(request) {
  let pathname = ''
  try {
    pathname = new URL(request.originalUrl || request.url || '/', 'http://localhost').pathname
  } catch { /* use the body only */ }
  const pathKey = pathname.match(/^\/api\/ai\/keys\/([^/]+)\/test\/?$/i)?.[1]
  const bodyKeyIds = [
    request?.body?.keyId,
    ...(Array.isArray(request?.body?.keyIds) ? request.body.keyIds : []),
  ]
  return {
    principalId: request?.auth?.act?.sub ?? request?.auth?.sub ?? 'unknown-principal',
    keyIds: [...new Set([pathKey, ...bodyKeyIds]
      .filter(Boolean)
      .map((keyId) => {
        try { return decodeURIComponent(String(keyId)) } catch { return String(keyId) }
      }))],
  }
}

// Each active request owns its socket override. This prevents an older
// pipelined response from restoring a timeout after a newer AI request has
// already taken ownership of the same keep-alive connection.
const aiSocketTimeoutOwners = new WeakMap()

/**
 * Disable Node's short inactivity timeout only while an admitted AI request is
 * active. The independent timer remains the hard lifecycle boundary. On a
 * normal finish, restore the server's idle keep-alive policy rather than
 * leaking the long-request override into the next request on this socket.
 */
export function bindAiRequestLifecycle(request, response, {
  controller,
  deadlineMs,
  onDeadline,
} = {}) {
  if (!(controller instanceof AbortController)) {
    throw new TypeError('An AbortController is required for the AI request lifecycle.')
  }
  const boundedDeadlineMs = positiveInteger(deadlineMs, 195_000, 30 * 60_000)
  const socket = request?.socket
  const socketOwner = {}
  const previousSocketTimeoutMs = Number.isFinite(socket?.timeout)
    ? Math.max(0, socket.timeout)
    : 0
  if (socket && typeof socket.setTimeout === 'function') {
    aiSocketTimeoutOwners.set(socket, socketOwner)
    // Provider/crawler deadlines and this request-level deadline now own the
    // lifecycle. A 30-second gap before the first model token is not failure.
    socket.setTimeout(0)
  }

  let settled = false
  let deadlineExceeded = false
  let deadlineTimer = null
  const restoreSocket = (finished) => {
    if (!socket || typeof socket.setTimeout !== 'function') return
    if (aiSocketTimeoutOwners.get(socket) !== socketOwner) return
    aiSocketTimeoutOwners.delete(socket)
    if (socket.destroyed) return
    const idleKeepAliveTimeoutMs = Number(socket.server?.keepAliveTimeout)
    const restoredTimeoutMs = finished && Number.isFinite(idleKeepAliveTimeoutMs)
      ? Math.max(0, idleKeepAliveTimeoutMs)
      : previousSocketTimeoutMs
    socket.setTimeout(restoredTimeoutMs)
  }
  const cleanup = (finished = false) => {
    if (settled) return
    settled = true
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = null
    request?.removeListener?.('aborted', onAborted)
    response?.removeListener?.('finish', onFinished)
    response?.removeListener?.('close', onClosed)
    restoreSocket(finished)
  }
  const onAborted = () => cleanup(false)
  const onFinished = () => cleanup(true)
  const onClosed = () => cleanup(false)
  deadlineTimer = setTimeout(() => {
    if (settled || controller.signal.aborted) return
    deadlineExceeded = true
    const error = new AiRequestDeadlineError(boundedDeadlineMs)
    controller.abort(error)
    onDeadline?.(error)
  }, boundedDeadlineMs)
  deadlineTimer.unref?.()
  request?.once?.('aborted', onAborted)
  response?.once?.('finish', onFinished)
  response?.once?.('close', onClosed)

  return {
    cleanup,
    deadlineMs: boundedDeadlineMs,
    get deadlineExceeded() { return deadlineExceeded },
  }
}

/**
 * Schedule at most one heartbeat write at a time. Recursive scheduling keeps a
 * backpressured client from accumulating interval callbacks or output frames.
 */
export function startSseHeartbeat({
  send,
  signal,
  intervalMs = 20_000,
  onFailure,
} = {}) {
  if (typeof send !== 'function') throw new TypeError('A heartbeat sender is required.')
  const boundedIntervalMs = positiveInteger(intervalMs, 20_000, 120_000)
  let stopped = false
  let timer = null
  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    signal?.removeEventListener('abort', stop)
  }
  const schedule = () => {
    if (stopped || signal?.aborted) return
    timer = setTimeout(async () => {
      timer = null
      if (stopped || signal?.aborted) return
      try {
        if (!(await send())) {
          stop()
          onFailure?.()
          return
        }
      } catch (error) {
        stop()
        onFailure?.(error)
        return
      }
      schedule()
    }, boundedIntervalMs)
    timer.unref?.()
  }
  signal?.addEventListener('abort', stop, { once: true })
  schedule()
  return stop
}

async function writeSseChunk(response, frame, { signal, drainTimeoutMs = 15_000 } = {}) {
  if (signal?.aborted || response.writableEnded || response.destroyed) return false
  if (Buffer.byteLength(frame) > 512 * 1024) {
    throw new AiCapacityError('frame_too_large')
  }
  const writable = response.write(frame)
  if (writable) return true

  const eventName = await new Promise((resolve) => {
    let settled = false
    let timer = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      response.removeListener('drain', onDrain)
      response.removeListener('close', onClose)
      signal?.removeEventListener('abort', onAbort)
    }
    const settle = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const onDrain = () => settle('drain')
    const onClose = () => settle('close')
    const onAbort = () => settle('abort')
    timer = setTimeout(() => settle('timeout'), positiveInteger(drainTimeoutMs, 15_000, 120_000))
    timer.unref?.()
    response.once('drain', onDrain)
    response.once('close', onClose)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted || response.destroyed || response.writableEnded) settle('abort')
  })
  return eventName === 'drain' && !signal?.aborted && !response.destroyed
}

/** Write one SSE frame without letting a slow client grow Node's output queue. */
export function writeSseFrame(response, event, data, options = {}) {
  return writeSseChunk(response, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, options)
}

/** SSE comments keep intermediaries alive without surfacing an application event. */
export function writeSseHeartbeat(response, options = {}) {
  return writeSseChunk(response, ': heartbeat\n\n', options)
}
