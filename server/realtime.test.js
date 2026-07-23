import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createRealtimeHub, scopesForMutation } from './realtime.js'

class FakeResponse extends EventEmitter {
  constructor() {
    super()
    this.chunks = []
    this.headers = new Map()
    this.destroyed = false
    this.writableEnded = false
    this.writableLength = 0
    this.socket = { setKeepAlive() {}, setTimeout() {} }
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

  end() {
    this.writableEnded = true
    this.emit('close')
  }
}

function subscribe(hub, { userId, clientId, teamIds = [] }) {
  const request = new EventEmitter()
  request.user = { id: userId }
  request.teamMemberships = teamIds.map((teamId) => ({ teamId }))
  request.get = (name) => name.toLowerCase() === 'x-phd-client-id' ? clientId : ''
  const response = new FakeResponse()
  hub.subscribe(request, response)
  response.chunks.length = 0
  return response
}

describe('realtime invalidation hub', () => {
  it('maps successful mutation families to narrow invalidation scopes', () => {
    expect(scopesForMutation('GET', '/api/applications')).toEqual([])
    expect(scopesForMutation('PUT', '/api/applications/app_1')).toEqual(['applications', 'session'])
    expect(scopesForMutation('POST', '/api/notifications/read-all')).toEqual(['notifications'])
    expect(scopesForMutation('PATCH', '/api/teams/team_1')).toEqual(['teams', 'applications', 'session'])
    expect(scopesForMutation('POST', '/api/discover/programs/delete')).toEqual(['discover'])
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
})
