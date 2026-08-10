import {
  REALTIME_SCOPES,
  scopesForMutation,
} from '../shared/realtimeScopes.js'

export { REALTIME_SCOPES, scopesForMutation }

const HEARTBEAT_MS = 25_000
const MAX_CONNECTIONS_PER_USER = 6
const DEFAULT_MAX_CONNECTIONS = 512
const MAX_BUFFERED_BYTES = 64 * 1024
const MAX_TIMER_DELAY_MS = 2_147_000_000
const RETRY_AFTER_BASE_MS = 1_000
const RETRY_AFTER_JITTER_MS = 2_000

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function retryDelayMs(baseMs, jitterMs, random) {
  let randomValue = 0.5
  try {
    const candidate = Number(random())
    if (Number.isFinite(candidate)) randomValue = Math.min(1, Math.max(0, candidate))
  } catch {
    // Keep the midpoint fallback when an injected entropy source fails.
  }
  const base = Math.max(1, Number(baseMs) || RETRY_AFTER_BASE_MS)
  const jitter = Math.max(0, Number(jitterMs) || 0)
  return Math.ceil(base + (jitter * randomValue))
}

export function codexAuthorizationStreamExpirySeconds(
  authorization,
  idleTimeoutMs,
) {
  const activityAtMs = Date.parse(
    authorization?.lastUsedAt ?? authorization?.createdAt ?? '',
  )
  const normalizedIdleTimeoutMs = Number(idleTimeoutMs)
  if (!Number.isFinite(activityAtMs) || !Number.isFinite(normalizedIdleTimeoutMs) || normalizedIdleTimeoutMs <= 0) {
    return Number.NaN
  }

  const rawAbsoluteExpiry = authorization?.expiresAt
  const absoluteExpiryMs = rawAbsoluteExpiry === null || rawAbsoluteExpiry === undefined
    ? Number.POSITIVE_INFINITY
    : Date.parse(rawAbsoluteExpiry)
  if (Number.isNaN(absoluteExpiryMs)) return Number.NaN

  return Math.min(
    absoluteExpiryMs,
    activityAtMs + normalizedIdleTimeoutMs,
  ) / 1_000
}

function endResponse(response, body) {
  if (response.destroyed || response.writableEnded) return
  try {
    response.end(body)
  } catch {
    // A concurrently closed stream is already retired by its lifecycle hooks.
  }
}

function destroyResponse(response) {
  endResponse(response)
  if (response.destroyed) return
  try {
    response.destroy?.()
  } catch {
    // The transport may have closed between end() and destroy().
  }
}

function rejectSubscription(response, statusCode, retryAfterMs = null) {
  response.status(statusCode)
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Connection', 'close')
  if (Number.isFinite(retryAfterMs)) {
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1_000))))
    response.setHeader('X-PhD-Retry-After-Ms', String(Math.ceil(retryAfterMs)))
  }
  endResponse(response)
}

function publicRequestId(request, response) {
  const candidates = [response?.locals?.requestId, request?.requestId]
  for (const candidate of candidates) {
    const requestId = String(candidate ?? '').trim()
    if (/^[A-Za-z0-9._:-]{1,80}$/.test(requestId)) return requestId
  }
  return null
}

function rejectCapacitySubscription(request, response, statusCode, retryAfterMs) {
  response.status(statusCode)
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Pragma', 'no-cache')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Connection', 'close')
  response.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1_000))))
  response.setHeader('X-PhD-Retry-After-Ms', String(Math.ceil(retryAfterMs)))
  endResponse(response, JSON.stringify({
    ok: false,
    error: {
      code: 'SERVER_BUSY',
      message: 'The server is temporarily busy. Please retry shortly.',
    },
    requestId: publicRequestId(request, response),
  }))
}

function writeChunk(response, chunk) {
  if (response.destroyed || response.writableEnded) return false
  if (Number(response.writableLength ?? 0) > MAX_BUFFERED_BYTES) {
    destroyResponse(response)
    return false
  }
  try {
    response.write(chunk)
    if (Number(response.writableLength ?? 0) > MAX_BUFFERED_BYTES) {
      destroyResponse(response)
      return false
    }
    return true
  } catch {
    destroyResponse(response)
    return false
  }
}

function writeEvent(response, event, payload) {
  return writeChunk(response, `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function writeHeartbeat(response, stamp) {
  return writeChunk(response, `: keepalive ${stamp}\n\n`)
}

export function createRealtimeHub({
  maxConnections = positiveInteger(
    process.env.PHD_ATLAS_REALTIME_MAX_CONNECTIONS,
    DEFAULT_MAX_CONNECTIONS,
  ),
  retryAfterBaseMs = RETRY_AFTER_BASE_MS,
  retryAfterJitterMs = RETRY_AFTER_JITTER_MS,
  random = Math.random,
} = {}) {
  const globalLimit = positiveInteger(maxConnections, DEFAULT_MAX_CONNECTIONS)
  const subscribers = new Set()
  let heartbeatTimer = null
  let revision = 0
  let closed = false

  const stopHeartbeatWhenIdle = () => {
    if (subscribers.size > 0 || heartbeatTimer === null) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  const remove = (subscriber) => {
    if (!subscribers.delete(subscriber)) return false
    if (subscriber.expirationTimer !== null) {
      clearTimeout(subscriber.expirationTimer)
      subscriber.expirationTimer = null
    }
    subscriber.detach?.()
    stopHeartbeatWhenIdle()
    return true
  }

  const retire = (subscriber, { force = false } = {}) => {
    remove(subscriber)
    if (force) destroyResponse(subscriber.response)
    else endResponse(subscriber.response)
  }

  const scheduleExpiration = (subscriber) => {
    if (!Number.isFinite(subscriber.expiresAtMs) || !subscribers.has(subscriber)) return
    const remainingMs = subscriber.expiresAtMs - Date.now()
    if (remainingMs <= 0) {
      retire(subscriber)
      return
    }
    subscriber.expirationTimer = setTimeout(() => {
      subscriber.expirationTimer = null
      scheduleExpiration(subscriber)
    }, Math.min(remainingMs, MAX_TIMER_DELAY_MS))
    subscriber.expirationTimer.unref?.()
  }

  const ensureHeartbeat = () => {
    if (heartbeatTimer !== null || closed) return
    heartbeatTimer = setInterval(() => {
      const stamp = Date.now()
      for (const subscriber of [...subscribers]) {
        if (!writeHeartbeat(subscriber.response, stamp)) {
          remove(subscriber)
        }
      }
    }, HEARTBEAT_MS)
    heartbeatTimer.unref?.()
  }

  const subscribe = (request, response) => {
    if (closed) {
      rejectCapacitySubscription(
        request,
        response,
        503,
        retryDelayMs(retryAfterBaseMs, retryAfterJitterMs, random),
      )
      return
    }
    const userId = String(request.user?.id ?? '')
    const clientId = String(request.get('x-phd-client-id') ?? '')
    const teamIds = new Set((request.teamMemberships ?? []).map((membership) => membership.teamId).filter(Boolean))
    const expiresAtSeconds = Number(request.auth?.exp)
    if (Number.isFinite(expiresAtSeconds) && expiresAtSeconds * 1_000 <= Date.now()) {
      rejectSubscription(response, 401)
      return
    }

    const existingForUser = [...subscribers].filter((subscriber) => subscriber.userId === userId)
    // Evicting an established stream makes its browser reconnect and evict the
    // next stream forever. Refuse only the newcomer so the six live streams stay
    // stable and the rejected client can retry after a real close.
    if (existingForUser.length >= MAX_CONNECTIONS_PER_USER) {
      rejectCapacitySubscription(
        request,
        response,
        429,
        retryDelayMs(retryAfterBaseMs, retryAfterJitterMs, random),
      )
      return
    }
    if (subscribers.size >= globalLimit) {
      rejectCapacitySubscription(
        request,
        response,
        503,
        retryDelayMs(retryAfterBaseMs, retryAfterJitterMs, random),
      )
      return
    }

    response.status(200)
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'private, no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders?.()
    response.socket?.setKeepAlive?.(true)
    response.socket?.setTimeout?.(0)

    const subscriber = {
      request,
      response,
      userId,
      clientId,
      teamIds,
      authorizationId: request.auth?.kind === 'codex'
        ? String(request.codexAuthorization?.id ?? request.auth?.authorizationId ?? '')
        : '',
      expiresAtMs: Number.isFinite(expiresAtSeconds) ? expiresAtSeconds * 1_000 : null,
      expirationTimer: null,
      detach: null,
    }
    const cleanup = () => remove(subscriber)
    subscriber.detach = () => {
      request.off('aborted', cleanup)
      request.off('close', cleanup)
      response.off('close', cleanup)
      response.off('error', cleanup)
    }
    request.once('aborted', cleanup)
    request.once('close', cleanup)
    response.once('close', cleanup)
    response.once('error', cleanup)
    subscribers.add(subscriber)
    ensureHeartbeat()
    if (!writeEvent(response, 'connected', {
      type: 'connected',
      scopes: [],
      revision,
      at: new Date().toISOString(),
    })) {
      retire(subscriber)
      return
    }
    scheduleExpiration(subscriber)
  }

  const publish = ({
    scopes,
    userIds = [],
    teamIds = [],
    broadcast = false,
    originClientId = '',
  }) => {
    if (closed) return 0
    const validScopes = [...new Set(scopes)].filter((scope) => REALTIME_SCOPES.includes(scope))
    if (validScopes.length === 0 || subscribers.size === 0) return 0
    revision += 1
    const userSet = new Set(userIds.filter(Boolean))
    const teamSet = new Set(teamIds.filter(Boolean))
    const payload = {
      type: 'invalidate',
      scopes: validScopes,
      revision,
      at: new Date().toISOString(),
    }
    let delivered = 0
    for (const subscriber of [...subscribers]) {
      if (originClientId && subscriber.clientId === originClientId) continue
      const matchesUser = userSet.has(subscriber.userId)
      const matchesTeam = [...teamSet].some((teamId) => subscriber.teamIds.has(teamId))
      if (!broadcast && !matchesUser && !matchesTeam) continue
      if (writeEvent(subscriber.response, 'invalidate', payload)) delivered += 1
      else remove(subscriber)
    }
    return delivered
  }

  const retireAuthorization = (authorizationId) => {
    const normalizedAuthorizationId = String(authorizationId ?? '').trim()
    if (!normalizedAuthorizationId) return 0
    let retired = 0
    for (const subscriber of [...subscribers]) {
      if (subscriber.authorizationId !== normalizedAuthorizationId) continue
      retire(subscriber, { force: true })
      retired += 1
    }
    return retired
  }

  const close = () => {
    if (closed) return
    closed = true
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    for (const subscriber of [...subscribers]) {
      retire(subscriber, { force: true })
    }
  }

  return {
    close,
    publish,
    retireAuthorization,
    subscribe,
    subscriberCount: () => subscribers.size,
  }
}
