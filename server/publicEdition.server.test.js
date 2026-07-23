import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../server/index.js'

let server
let baseUrl

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

async function expectPublicNotFound(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()

  expect(response.status).toBe(404)
  expect(payload).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
}

async function expectAuthenticationRequired(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()

  expect(response.status).toBe(401)
  expect(payload).toMatchObject({
    ok: false,
    error: { code: 'UNAUTHORIZED' },
  })
}

describe('public-edition Team and organization boundary', () => {
  it.each([
    ['GET', '/api/teams'],
    ['GET', '/api/teams/mine'],
    ['GET', '/API/TEAMS'],
    ['GET', '/api/admin/teams'],
    ['GET', '/api/Admin/Teams'],
    ['POST', '/api/admin/teams', { name: 'Blocked organization' }],
    ['POST', '/api/applications/example/team-transfer/preflight', { teamId: 'blocked-team' }],
    ['PATCH', '/api/applications/example/team-visibility', { teamId: 'blocked-team' }],
    ['POST', '/api/applications/example/review-comments', { body: 'Blocked feedback' }],
    ['GET', '/api/applications/example/review-comments/threaded'],
    ['POST', '/api/applications/example/request-feedback'],
    ['POST', '/api/Auth/Impersonate/', { userId: 'blocked-user' }],
    ['POST', '/api/auth/impersonate', { userId: 'blocked-user', teamId: 'blocked-team' }],
    ['GET', '/api/discover/state?teamId=blocked-team&targetUserId=blocked-user'],
    ['POST', '/api/discover/programs/delete', { ids: ['blocked'], teamId: 'blocked-team', targetUserId: 'blocked-user' }],
    ['POST', '/api/ai/keys', { scope: 'team', teamId: 'blocked-team' }],
    ['POST', '/api/applications', { visibleToTeam: true }],
    ['POST', '/api/applications/', { ownerId: 'blocked-user' }],
    ['POST', '/api/admin/notifications/publish', { audiences: ['team'] }],
    ['PATCH', '/api/admin/users/blocked-user', { membershipPlan: 'team' }],
    ['PATCH', '/api/admin/users/blocked-user', { seatLimit: 105 }],
  ])('returns 404 before authentication for %s %s', async (method, route, body) => {
    await expectPublicNotFound(method, route, body)
  })

  it.each([
    ['GET', '/api/discover/state'],
    ['GET', '/api/ai/keys'],
    ['POST', '/api/ai/keys', { scope: 'personal' }],
    ['POST', '/api/applications', { visibleToTeam: false }],
    ['POST', '/api/admin/notifications/publish', { audiences: ['pro'] }],
    ['PATCH', '/api/admin/users/example', { storageQuotaMb: 1024 }],
    ['GET', '/api/workspace/bootstrap?teamId=stale-browser-selection'],
  ])('keeps the personal variant behind authentication for %s %s', async (method, route, body) => {
    await expectAuthenticationRequired(method, route, body)
  })

  it('returns a personal-only bootstrap and admin user payload', async () => {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@phd-atlas.local',
        password: 'admin123456',
        scope: 'admin',
      }),
    })
    const loginPayload = await loginResponse.json()
    expect(loginResponse.status).toBe(200)
    const token = loginPayload.data.token
    const headers = { authorization: `Bearer ${token}` }

    const bootstrapResponse = await fetch(`${baseUrl}/api/workspace/bootstrap?teamId=stale-browser-selection`, { headers })
    const bootstrapPayload = await bootstrapResponse.json()
    expect(bootstrapResponse.status).toBe(200)
    expect(bootstrapPayload.data).toMatchObject({
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
    })
    expect(bootstrapPayload.data.me.usage).toMatchObject({
      teamApplicationCount: 0,
      pendingTeamTransferCount: 0,
      pendingTeamTransferLimit: 0,
    })

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`, { headers })
    const usersPayload = await usersResponse.json()
    expect(usersResponse.status).toBe(200)
    for (const user of usersPayload.data) {
      expect(user).toMatchObject({
        teamId: null,
        teamName: null,
        seatLimit: null,
        activeMemberCount: null,
        teamMemberOf: null,
        isTeamInternalAccount: false,
      })
      expect(user.settings.membershipPlan).not.toBe('team')
    }
  })
})
