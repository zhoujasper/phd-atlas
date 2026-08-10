import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  codexAuthorizationStreamExpirySeconds,
  createRealtimeHub,
  scopesForMutation,
} from './realtime.js'

class FakeResponse extends EventEmitter {
  constructor() {
    super()
    this.chunks = []
    this.headers = new Map()
    this.destroyed = false
    this.writableEnded = false
    this.writableLength = 0
    this.socket = { setKeepAlive() {}, setTimeout() {} }
    this.locals = {}
  }

  status(code) {
    this.statusCode = code
    return this
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value)
  }

  flushHeaders() {}

  write(chunk) {
    this.chunks.push(String(chunk))
    return true
  }

  end(chunk) {
    if (this.writableEnded) return
    if (chunk !== undefined) this.chunks.push(String(chunk))
    this.writableEnded = true
    this.emit('close')
  }

  destroy() {
    this.destroyed = true
  }
}

function subscribe(hub, {
  userId,
  clientId,
  teamIds = [],
  expiresAtSeconds = null,
  authorizationId = '',
  requestId = 'req_realtime_test',
}) {
  const request = new EventEmitter()
  request.user = { id: userId }
  if (expiresAtSeconds !== null || authorizationId) {
    request.auth = {
      ...(expiresAtSeconds === null ? {} : { exp: expiresAtSeconds }),
      ...(authorizationId ? { kind: 'codex', authorizationId } : {}),
    }
  }
  if (authorizationId) request.codexAuthorization = { id: authorizationId }
  request.teamMemberships = teamIds.map((teamId) => ({ teamId }))
  request.get = (name) => name.toLowerCase() === 'x-phd-client-id' ? clientId : ''
  const response = new FakeResponse()
  response.locals.requestId = requestId
  hub.subscribe(request, response)
  if (response.statusCode === 200) response.chunks.length = 0
  return response
}

describe('realtime invalidation hub', () => {
  it('uses the earlier absolute or 180-day idle boundary for Codex streams', () => {
    const dayMs = 24 * 60 * 60 * 1_000
    const createdAtMs = Date.parse('2026-01-01T00:00:00.000Z')
    const lastUsedAtMs = createdAtMs + (10 * dayMs)

    expect(codexAuthorizationStreamExpirySeconds({
      createdAt: new Date(createdAtMs).toISOString(),
      lastUsedAt: new Date(lastUsedAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + (365 * dayMs)).toISOString(),
    }, 180 * dayMs)).toBe((lastUsedAtMs + (180 * dayMs)) / 1_000)

    expect(codexAuthorizationStreamExpirySeconds({
      createdAt: new Date(createdAtMs).toISOString(),
      lastUsedAt: null,
      expiresAt: new Date(createdAtMs + (30 * dayMs)).toISOString(),
    }, 180 * dayMs)).toBe((createdAtMs + (30 * dayMs)) / 1_000)

    expect(codexAuthorizationStreamExpirySeconds({
      createdAt: 'invalid',
      expiresAt: null,
    }, 180 * dayMs)).toBeNaN()
  })

  it('maps successful mutation families to narrow invalidation scopes', () => {
    expect(scopesForMutation('GET', '/api/applications')).toEqual([])
    expect(scopesForMutation('PUT', '/api/applications/app_1')).toEqual(['applications', 'session'])
    expect(scopesForMutation(
      'PUT',
      '/api/teams/team_1/members/student_1/profile-recommenders',
    )).toEqual(['teams', 'applications', 'session'])
    const recommenderResolveScopes = scopesForMutation(
      'POST',
      '/api/applications/app_1/recommenders/recommender_1/resolve',
    )
    expect(recommenderResolveScopes).toEqual(expect.arrayContaining(['applications', 'teams', 'session']))
    expect(recommenderResolveScopes).toHaveLength(3)
    expect(scopesForMutation('POST', '/api/notifications/read-all')).toEqual(['notifications'])
    expect(scopesForMutation('POST', '/api/applications/app_1/school-logo/resolve')).toEqual([])
    expect(scopesForMutation('POST', '/api/applications/app_1/admission-signals')).toEqual(['admission'])
    expect(scopesForMutation('DELETE', '/api/admission-bookmarks/bookmark_1')).toEqual(['admission'])
    expect(scopesForMutation('PATCH', '/api/teams/team_1')).toEqual(['teams', 'session'])
    expect(scopesForMutation('PATCH', '/api/teams/team_1/members/member_1')).toEqual(['teams', 'session'])
    expect(scopesForMutation('POST', '/api/teams/team_1/teacher-groups')).toEqual(['teams', 'session'])
    expect(scopesForMutation('DELETE', '/api/teams/team_1/teacher-groups/group_1')).toEqual(['teams', 'session'])
    expect(scopesForMutation('POST', '/api/teams/team_1/transfer-requests/request_1/approve')).toEqual([
      'teams',
      'applications',
      'session',
    ])
    expect(scopesForMutation('POST', '/api/teams/team_1/transfer-requests/request_1/reject?reason=duplicate')).toEqual([
      'teams',
      'applications',
      'session',
    ])
    expect(scopesForMutation('DELETE', '/api/teams/team_1/members/member_1')).toEqual([
      'teams',
      'applications',
      'session',
    ])
    expect(scopesForMutation('DELETE', '/api/teams/team_1')).toEqual(['teams', 'applications', 'session'])
    expect(scopesForMutation('POST', '/api/discover/programs/delete')).toEqual(['discover'])
    expect(scopesForMutation('PUT', '/api/interview-prep/workspace')).toEqual(['interview'])
    expect(scopesForMutation('PUT', '/API/INTERVIEW-PREP/WORKSPACE')).toEqual(['interview'])
    expect(scopesForMutation('PUT', '/API/APPLICATIONS/AppCaseSensitiveId')).toEqual(['applications', 'session'])
    expect(scopesForMutation('DELETE', '/API/TEAMS/TeamCaseSensitiveId')).toEqual([
      'teams',
      'applications',
      'session',
    ])
    expect(scopesForMutation('POST', '/api/interview-prep/ai/questions')).toEqual([])
  })

  it('targets users and teams while suppressing the originating browser tab', () => {
    const hub = createRealtimeHub()
    const origin = subscribe(hub, { userId: 'user_1', clientId: 'client_origin', teamIds: ['team_1'] })
    const sibling = subscribe(hub, { userId: 'user_1', clientId: 'client_sibling', teamIds: ['team_1'] })
    const teammate = subscribe(hub, { userId: 'user_2', clientId: 'client_team', teamIds: ['team_1'] })
    const outsider = subscribe(hub, { userId: 'user_3', clientId: 'client_other', teamIds: ['team_2'] })

    expect(hub.publish({
      scopes: ['applications'],
      userIds: ['user_1'],
      teamIds: ['team_1'],
      originClientId: 'client_origin',
    })).toBe(2)

    expect(origin.chunks).toHaveLength(0)
    expect(sibling.chunks.join('')).toContain('"applications"')
    expect(teammate.chunks.join('')).toContain('"applications"')
    expect(outsider.chunks).toHaveLength(0)

    origin.end()
    sibling.end()
    teammate.end()
    outsider.end()
    expect(hub.subscriberCount()).toBe(0)
  })

  it('retires a backpressured stream instead of growing heartbeat buffers', () => {
    vi.useFakeTimers()
    try {
      const hub = createRealtimeHub()
      const response = subscribe(hub, {
        userId: 'user_slow',
        clientId: 'client_slow',
      })
      response.writableLength = 65 * 1024

      vi.advanceTimersByTime(25_000)

      expect(response.writableEnded).toBe(true)
      expect(response.destroyed).toBe(true)
      expect(hub.subscriberCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes an SSE stream exactly when its authenticated JWT expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
    const hub = createRealtimeHub()
    try {
      const response = subscribe(hub, {
        userId: 'user_expiring',
        clientId: 'client_expiring',
        expiresAtSeconds: (Date.now() / 1_000) + 2,
      })

      vi.advanceTimersByTime(1_999)
      expect(response.writableEnded).toBe(false)
      expect(hub.subscriberCount()).toBe(1)

      vi.advanceTimersByTime(1)
      expect(response.writableEnded).toBe(true)
      expect(hub.subscriberCount()).toBe(0)
    } finally {
      hub.close()
      vi.useRealTimers()
    }
  })

  it('rejects an already expired JWT without opening an SSE stream', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
    const hub = createRealtimeHub()
    try {
      const response = subscribe(hub, {
        userId: 'user_expired',
        clientId: 'client_expired',
        expiresAtSeconds: Date.now() / 1_000,
      })

      expect(response.statusCode).toBe(401)
      expect(response.writableEnded).toBe(true)
      expect(response.chunks).toHaveLength(0)
      expect(hub.subscriberCount()).toBe(0)
    } finally {
      hub.close()
      vi.useRealTimers()
    }
  })

  it('rejects streams above the six-per-user limit without evicting resident tabs', () => {
    const hub = createRealtimeHub({
      retryAfterBaseMs: 1_000,
      retryAfterJitterMs: 1_000,
      random: () => 0.5,
    })
    const residents = Array.from({ length: 6 }, (_, index) => subscribe(hub, {
      userId: 'user_many_tabs',
      clientId: `client_${index}`,
    }))
    const rejected = subscribe(hub, {
      userId: 'user_many_tabs',
      clientId: 'client_6',
      requestId: 'req_per_account_capacity',
    })
    const rejectedRetry = subscribe(hub, {
      userId: 'user_many_tabs',
      clientId: 'client_6',
    })

    expect(residents.every((response) => !response.writableEnded)).toBe(true)
    expect(rejected.statusCode).toBe(429)
    expect(rejected.headers.get('retry-after')).toBe('2')
    expect(rejected.headers.get('x-phd-retry-after-ms')).toBe('1500')
    expect(rejected.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(rejected.headers.get('cache-control')).toBe('private, no-store')
    expect(rejected.headers.get('pragma')).toBe('no-cache')
    expect(JSON.parse(rejected.chunks.join(''))).toEqual({
      ok: false,
      error: {
        code: 'SERVER_BUSY',
        message: 'The server is temporarily busy. Please retry shortly.',
      },
      requestId: 'req_per_account_capacity',
    })
    expect(rejected.chunks.join('')).not.toContain('user_many_tabs')
    expect(rejected.writableEnded).toBe(true)
    expect(rejectedRetry.statusCode).toBe(429)
    expect(hub.subscriberCount()).toBe(6)

    hub.close()
    expect(residents.every((response) => response.writableEnded)).toBe(true)
    expect(hub.subscriberCount()).toBe(0)
  })

  it('retires only streams owned by the revoked Codex authorization', () => {
    const hub = createRealtimeHub()
    const first = subscribe(hub, {
      userId: 'user_shared',
      clientId: 'client_first',
      authorizationId: 'codexauth_first',
    })
    const firstSibling = subscribe(hub, {
      userId: 'user_shared',
      clientId: 'client_first_sibling',
      authorizationId: 'codexauth_first',
    })
    const otherAuthorization = subscribe(hub, {
      userId: 'user_shared',
      clientId: 'client_other_authorization',
      authorizationId: 'codexauth_second',
    })
    const browserSession = subscribe(hub, {
      userId: 'user_shared',
      clientId: 'client_browser_session',
    })

    expect(hub.retireAuthorization('codexauth_first')).toBe(2)
    expect(first.writableEnded && first.destroyed).toBe(true)
    expect(firstSibling.writableEnded && firstSibling.destroyed).toBe(true)
    expect(otherAuthorization.writableEnded).toBe(false)
    expect(browserSession.writableEnded).toBe(false)
    expect(hub.subscriberCount()).toBe(2)
    expect(hub.retireAuthorization('')).toBe(0)
    expect(hub.retireAuthorization('codexauth_missing')).toBe(0)

    hub.close()
  })

  it('clears a revoked authorization stream timer and lifecycle listeners', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
    const hub = createRealtimeHub()
    try {
      const response = subscribe(hub, {
        userId: 'user_revoked_timer',
        clientId: 'client_revoked_timer',
        authorizationId: 'codexauth_revoked_timer',
        expiresAtSeconds: (Date.now() / 1_000) + 60,
      })

      expect(vi.getTimerCount()).toBe(2)
      expect(hub.retireAuthorization('codexauth_revoked_timer')).toBe(1)
      expect(response.writableEnded && response.destroyed).toBe(true)
      expect(response.listenerCount('close')).toBe(0)
      expect(response.listenerCount('error')).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      hub.close()
      vi.useRealTimers()
    }
  })

  it('enforces the global stream cap without leaking rejected or closed slots', () => {
    const hub = createRealtimeHub({
      maxConnections: 2,
      retryAfterBaseMs: 800,
      retryAfterJitterMs: 400,
      random: () => 0.5,
    })
    const first = subscribe(hub, { userId: 'user_1', clientId: 'client_1' })
    const second = subscribe(hub, { userId: 'user_2', clientId: 'client_2' })
    const rejected = subscribe(hub, {
      userId: 'user_3',
      clientId: 'client_3',
      requestId: 'req_global_capacity',
    })

    expect(rejected.statusCode).toBe(503)
    expect(rejected.headers.get('retry-after')).toBe('1')
    expect(rejected.headers.get('x-phd-retry-after-ms')).toBe('1000')
    expect(rejected.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(rejected.headers.get('cache-control')).toBe('private, no-store')
    expect(rejected.headers.get('x-content-type-options')).toBe('nosniff')
    expect(JSON.parse(rejected.chunks.join(''))).toEqual({
      ok: false,
      error: {
        code: 'SERVER_BUSY',
        message: 'The server is temporarily busy. Please retry shortly.',
      },
      requestId: 'req_global_capacity',
    })
    expect(rejected.chunks.join('')).not.toContain('user_3')
    expect(rejected.writableEnded).toBe(true)
    expect(hub.subscriberCount()).toBe(2)

    first.end()
    const replacement = subscribe(hub, { userId: 'user_3', clientId: 'client_3' })
    expect(replacement.statusCode).toBe(200)
    expect(hub.subscriberCount()).toBe(2)

    second.end()
    replacement.end()
    expect(hub.subscriberCount()).toBe(0)
    hub.close()
  })

  it('supports 300 independent authenticated users and drains them on shutdown', () => {
    const hub = createRealtimeHub()
    const responses = Array.from({ length: 300 }, (_, index) => subscribe(hub, {
      userId: `user_${index}`,
      clientId: `client_${index}`,
    }))

    expect(hub.subscriberCount()).toBe(300)
    expect(responses.every((response) => response.statusCode === 200)).toBe(true)

    hub.close()
    expect(responses.every((response) => response.writableEnded && response.destroyed)).toBe(true)
    expect(hub.subscriberCount()).toBe(0)
  })

  it('cancels JWT expiration work when the hub shuts down first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
    const hub = createRealtimeHub()
    try {
      const response = subscribe(hub, {
        userId: 'user_shutdown',
        clientId: 'client_shutdown',
        expiresAtSeconds: (Date.now() / 1_000) + 60,
      })
      const closeListener = vi.fn()
      response.on('close', closeListener)

      hub.close()
      vi.advanceTimersByTime(60_000)

      expect(closeListener).toHaveBeenCalledTimes(1)
      expect(hub.subscriberCount()).toBe(0)
    } finally {
      hub.close()
      vi.useRealTimers()
    }
  })

  it('drains every live stream during shutdown and refuses late subscribers', () => {
    const hub = createRealtimeHub()
    const first = subscribe(hub, { userId: 'user_1', clientId: 'client_1' })
    const second = subscribe(hub, { userId: 'user_2', clientId: 'client_2' })

    hub.close()

    expect(first.writableEnded).toBe(true)
    expect(second.writableEnded).toBe(true)
    expect(first.destroyed).toBe(true)
    expect(second.destroyed).toBe(true)
    expect(hub.subscriberCount()).toBe(0)
    expect(hub.publish({
      scopes: ['applications'],
      userIds: ['user_1'],
    })).toBe(0)

    const late = subscribe(hub, { userId: 'user_3', clientId: 'client_3' })
    expect(late.statusCode).toBe(503)
    expect(late.writableEnded).toBe(true)
    expect(hub.subscriberCount()).toBe(0)
  })

})
