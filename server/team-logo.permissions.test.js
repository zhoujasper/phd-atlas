import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './index.js'

const VALID_ONE_PIXEL_PNG = [
  'data:image/png;base64,',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
].join('')

let server
let baseUrl

beforeEach(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('organization logo permissions', () => {
  it('rejects a teacher attempting to change the organization logo', async () => {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'teacher@phd-atlas.local',
        password: 'demo123456',
      }),
    })
    const loginPayload = await loginResponse.json()
    expect(loginResponse.status).toBe(200)

    const workspacesResponse = await fetch(`${baseUrl}/api/teams/mine/workspaces`, {
      headers: { authorization: `Bearer ${loginPayload.data.token}` },
    })
    const workspacesPayload = await workspacesResponse.json()
    const workspace = workspacesPayload.data[0]
    expect(workspace?.viewerRole).toBe('admin')

    const updateResponse = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(workspace.teamId)}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${loginPayload.data.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ logoDataUrl: VALID_ONE_PIXEL_PNG }),
    })
    const updatePayload = await updateResponse.json()

    expect(updateResponse.status).toBe(403)
    expect(updatePayload.error.code).toBe('TEAM_ROLE_FORBIDDEN')
  })
})
