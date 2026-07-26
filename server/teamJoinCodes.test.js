import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import { deleteTeam, readStore, withWriteLock, writeStore } from './storage.js'

let server
let baseUrl
let temporaryTeamId = null
const settingsSnapshots = new Map()

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { response, payload: await response.json() }
}

async function login(email, password = 'demo123456') {
  const { response, payload } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  expect(response.status).toBe(200)
  return payload.data.token
}

async function createProvisioningTeam(adminToken) {
  const { response, payload } = await request('/api/admin/teams', {
    token: adminToken,
    method: 'POST',
    body: { name: `Join-code test ${Date.now()}` },
  })
  expect(response.status).toBe(201)
  temporaryTeamId = payload.data.team.id
  return payload.data
}

async function generateCode(token, teamId, role, teacherIds = []) {
  const { response, payload } = await request(`/api/teams/${teamId}/join-codes`, {
    token,
    method: 'POST',
    body: { role, teacherIds },
  })
  expect(response.status).toBe(201)
  return payload.data
}

async function snapshotUserSettings(email) {
  const store = await readStore()
  const user = store.users.find((candidate) => candidate.email === email)
  settingsSnapshots.set(email, structuredClone(user.settings))
}

beforeEach(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  if (temporaryTeamId) {
    await deleteTeam(temporaryTeamId)
    temporaryTeamId = null
  }
  if (settingsSnapshots.size > 0) {
    await withWriteLock(async () => {
      const store = await readStore()
      for (const [email, settings] of settingsSnapshots) {
        const user = store.users.find((candidate) => candidate.email === email)
        if (user) user.settings = settings
      }
      await writeStore(store)
    })
    settingsSnapshots.clear()
  }
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe.sequential('team join credentials', () => {
  it('creates a team in provisioning and transfers its only owner with a one-time code', async () => {
    const adminToken = await login('admin@phd-atlas.local', 'admin123456')
    const teacherToken = await login('teacher@phd-atlas.local')
    const created = await createProvisioningTeam(adminToken)
    await snapshotUserSettings('teacher@phd-atlas.local')

    expect(created.team.provisioning).toBe(true)
    expect(created.owner).toBeNull()

    const credential = await generateCode(adminToken, created.team.id, 'owner')
    expect(credential).toMatchObject({
      role: 'owner',
      reusable: false,
      maxUses: 1,
      useCount: 0,
    })

    const preview = await request(`/api/teams/join-codes/${encodeURIComponent(credential.code)}`)
    expect(preview.response.status).toBe(200)
    expect(preview.payload.data).toMatchObject({
      teamId: created.team.id,
      role: 'owner',
      reusable: false,
    })

    const redeemed = await request(`/api/teams/join-codes/${encodeURIComponent(credential.code)}/redeem`, {
      token: teacherToken,
      method: 'POST',
    })
    expect(redeemed.response.status).toBe(200)
    expect(redeemed.payload.data).toMatchObject({
      team: {
        id: created.team.id,
        provisioning: false,
      },
      membership: {
        role: 'owner',
        status: 'active',
      },
    })

    const reused = await request(`/api/teams/join-codes/${encodeURIComponent(credential.code)}/redeem`, {
      token: teacherToken,
      method: 'POST',
    })
    expect(reused.response.status).toBe(410)
    expect(reused.payload.error.code).toBe('EXPIRED')

    const summary = await request(`/api/teams/${created.team.id}/members`, { token: adminToken })
    expect(summary.response.status).toBe(200)
    expect(summary.payload.data.team.provisioning).toBe(false)
    expect(summary.payload.data.members.filter((member) => member.role === 'owner')).toHaveLength(1)
  })

  it('reuses teacher and student codes while preserving every selected teacher assignment', async () => {
    const adminToken = await login('admin@phd-atlas.local', 'admin123456')
    const ownerToken = await login('jasper@example.com')
    const teacherToken = await login('teacher@phd-atlas.local')
    const secondTeacherToken = await login('teacher.alex@phd-atlas.local')
    const studentToken = await login('student.lina@phd-atlas.local')
    const secondStudentToken = await login('student.omar@phd-atlas.local')
    const created = await createProvisioningTeam(adminToken)
    await snapshotUserSettings('jasper@example.com')

    const ownerCode = await generateCode(adminToken, created.team.id, 'owner')
    const ownerClaim = await request(`/api/teams/join-codes/${encodeURIComponent(ownerCode.code)}/redeem`, {
      token: ownerToken,
      method: 'POST',
    })
    expect(ownerClaim.response.status).toBe(200)

    // The global admin keeps Team provisioning authority after ownership is claimed.
    const teacherCode = await generateCode(adminToken, created.team.id, 'admin')
    expect(teacherCode.reusable).toBe(true)
    for (const token of [teacherToken, secondTeacherToken]) {
      const joined = await request(`/api/teams/join-codes/${encodeURIComponent(teacherCode.code)}/redeem`, {
        token,
        method: 'POST',
      })
      expect(joined.response.status).toBe(200)
      expect(joined.payload.data.membership.role).toBe('admin')
    }

    const ownerSummary = await request(`/api/teams/${created.team.id}/members`, { token: ownerToken })
    const teachers = ownerSummary.payload.data.members.filter((member) => member.role === 'admin')
    expect(teachers).toHaveLength(2)

    const studentCode = await generateCode(
      adminToken,
      created.team.id,
      'member',
      teachers.map((teacher) => teacher.id),
    )
    expect(studentCode.managerNames).toHaveLength(2)

    for (const token of [studentToken, secondStudentToken]) {
      const joined = await request(`/api/teams/join-codes/${encodeURIComponent(studentCode.code)}/redeem`, {
        token,
        method: 'POST',
      })
      expect(joined.response.status).toBe(200)
      expect(joined.payload.data.membership).toMatchObject({
        role: 'member',
        status: 'active',
      })
      expect(joined.payload.data.membership.relationships.teacherIds)
        .toEqual(expect.arrayContaining(teachers.map((teacher) => teacher.userId)))
    }
  })
})
