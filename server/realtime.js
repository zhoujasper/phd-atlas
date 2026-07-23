const HEARTBEAT_MS = 25_000
const MAX_CONNECTIONS_PER_USER = 6
const MAX_BUFFERED_BYTES = 64 * 1024

export const REALTIME_SCOPES = Object.freeze([
  'applications',
  'profile-assets',
  'backups',
  'teams',
  'notifications',
  'session',
  'ai-keys',
  'discover',
])

export function scopesForMutation(method, originalUrl) {
  const normalizedMethod = String(method ?? 'GET').toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) return []
  const pathname = String(originalUrl ?? '').split('?')[0]
  const scopes = new Set()

  if (pathname.startsWith('/api/applications') || pathname.startsWith('/api/share/')) {
    scopes.add('applications')
    scopes.add('session')
  }
  if (pathname.startsWith('/api/profile-assets') || /\/profile-assets(?:\/|$)/.test(pathname)) {
    scopes.add('profile-assets')
    scopes.add('session')
  }
  if (pathname.startsWith('/api/backups') || pathname.startsWith('/api/admin/backups')) {
    scopes.add('backups')
    scopes.add('session')
  }
  if (pathname.startsWith('/api/teams')) {
    scopes.add('teams')
    scopes.add('applications')
    scopes.add('session')
  }
  if (pathname.startsWith('/api/notifications') || pathname.startsWith('/api/push')) {
    scopes.add('notifications')
  }
  if (pathname.startsWith('/api/admin/notifications')) scopes.add('notifications')
  if (pathname.startsWith('/api/ai/keys')) scopes.add('ai-keys')
  if (pathname.startsWith('/api/discover')) scopes.add('discover')
  if (
    pathname.startsWith('/api/settings')
    || pathname.startsWith('/api/account')
    || pathname.startsWith('/api/auth/passkeys')
    || pathname.startsWith('/api/admin/settings')
    || pathname.startsWith('/api/admin/users')
  ) {
    scopes.add('session')
  }
  return [...scopes]
}

function writeEvent(response, event, payload) {
  if (response.destroyed || response.writableEnded) return false
  if (Number(response.writableLength ?? 0) > MAX_BUFFERED_BYTES) {
    response.end()
    return false
  }
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  return true
}

export function createRealtimeHub() {
  const subscribers = new Set()
  let heartbeatTimer = null
  let revision = 0

  const stopHeartbeatWhenIdle = () => {
    if (subscribers.size > 0 || heartbeatTimer === null) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  const remove = (subscriber) => {
    subscribers.delete(subscriber)
    stopHeartbeatWhenIdle()
  }

  const ensureHeartbeat = () => {
    if (heartbeatTimer !== null) return
    heartbeatTimer = setInterval(() => {
      const stamp = Date.now()
      for (const subscriber of [...subscribers]) {
        if (subscriber.response.destroyed || subscriber.response.writableEnded) {
          remove(subscriber)
          continue
        }
        subscriber.response.write(`: keepalive ${stamp}\n\n`)
      }
    }, HEARTBEAT_MS)
    heartbeatTimer.unref?.()
  }

  const subscribe = (request, response) => {
    const userId = String(request.user?.id ?? '')
    const clientId = String(request.get('x-phd-client-id') ?? '')
    const teamIds = new Set((request.teamMemberships ?? []).map((membership) => membership.teamId).filter(Boolean))
    const existingForUser = [...subscribers].filter((subscriber) => subscriber.userId === userId)
    while (existingForUser.length >= MAX_CONNECTIONS_PER_USER) {
      const oldest = existingForUser.shift()
      oldest?.response.end()
      if (oldest) remove(oldest)
    }

    response.status(200)
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'private, no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders?.()
    response.socket?.setKeepAlive?.(true)
    response.socket?.setTimeout?.(0)

    const subscriber = { response, userId, clientId, teamIds }
    subscribers.add(subscriber)
    ensureHeartbeat()
    writeEvent(response, 'connected', {
      type: 'connected',
      scopes: [],
      revision,
      at: new Date().toISOString(),
    })

    const cleanup = () => remove(subscriber)
    request.once('close', cleanup)
    response.once('close', cleanup)
  }

  const publish = ({
    scopes,
    userIds = [],
    teamIds = [],
    broadcast = false,
    originClientId = '',
  }) => {
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

  return {
    publish,
    subscribe,
    subscriberCount: () => subscribers.size,
  }
}
