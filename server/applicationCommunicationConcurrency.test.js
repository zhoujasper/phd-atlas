import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'

let server
let baseUrl

async function jsonRequest(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return { response, data: payload.data, payload }
}

describe.sequential('application communication concurrency', () => {
  beforeAll(async () => {
    server = createApp().listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it('merges a server-added communication around a stale personal PUT and still honors a based deletion', async () => {
    const login = await jsonRequest('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@phd-atlas.local',
        password: 'admin123456',
      }),
    })
    expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
    const token = login.data.token

    const created = await jsonRequest('/api/applications', token, {
      method: 'POST',
      body: JSON.stringify({
        professor: 'Professor Concurrent Mail',
        professorChinese: '',
        professorEmail: 'concurrent-mail@example.edu',
        professorHomepage: '',
        university: `Concurrent Mail ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Mail Continuity PhD',
        deadline: '2027-01-15',
        notes: '',
      }),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
    expect(created.data).toMatchObject({
      protocol: 'phd-atlas-application-mutation-ack-v2',
      durable: true,
      id: expect.any(String),
    })
    const applicationPath = `/api/applications/${encodeURIComponent(created.data.id)}`
    const createdRead = await jsonRequest(applicationPath, token)
    expect(createdRead.response.status, JSON.stringify(createdRead.payload)).toBe(200)
    const createdApplication = createdRead.data
    expect(createdApplication).toMatchObject({
      id: created.data.id,
      professor: {
        english: 'Professor Concurrent Mail',
        email: 'concurrent-mail@example.edu',
      },
      school: { name: expect.stringContaining('Concurrent Mail') },
      program: 'Mail Continuity PhD',
    })

    const serverAdded = await jsonRequest(`${applicationPath}/communications`, token, {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Server-added draft',
        summary: 'This row was committed after the client baseline.',
        channel: 'Email',
        date: '2026-08-02',
        time: '09:30',
        direction: 'outgoing',
        messageType: 'draft-email',
        from: 'admin@phd-atlas.local',
        to: 'concurrent-mail@example.edu',
      }),
    })
    expect(serverAdded.response.status, JSON.stringify(serverAdded.payload)).toBe(201)

    const staleSave = await jsonRequest(applicationPath, token, {
      method: 'PUT',
      body: JSON.stringify({
        ...createdApplication,
        result: 'A local field changed on the stale client.',
        clientBaseApplication: createdApplication,
      }),
    })
    expect(staleSave.response.status, JSON.stringify(staleSave.payload)).toBe(200)
    expect(staleSave.data).toMatchObject({
      protocol: 'phd-atlas-application-mutation-ack-v2',
      durable: true,
      id: createdApplication.id,
    })
    const afterStaleSave = await jsonRequest(applicationPath, token)
    expect(afterStaleSave.response.status, JSON.stringify(afterStaleSave.payload)).toBe(200)
    expect(afterStaleSave.data.result).toBe('A local field changed on the stale client.')
    expect(afterStaleSave.data.communications).toEqual([
      expect.objectContaining({ id: serverAdded.data.id, subject: 'Server-added draft' }),
    ])

    const intentionalRemoval = await jsonRequest(applicationPath, token, {
      method: 'PUT',
      body: JSON.stringify({
        ...afterStaleSave.data,
        communications: [],
        clientBaseApplication: afterStaleSave.data,
      }),
    })
    expect(intentionalRemoval.response.status, JSON.stringify(intentionalRemoval.payload)).toBe(200)
    expect(intentionalRemoval.data).toMatchObject({
      protocol: 'phd-atlas-application-mutation-ack-v2',
      durable: true,
      id: createdApplication.id,
    })
    const afterIntentionalRemoval = await jsonRequest(applicationPath, token)
    expect(afterIntentionalRemoval.response.status, JSON.stringify(afterIntentionalRemoval.payload)).toBe(200)
    expect(afterIntentionalRemoval.data.result).toBe('A local field changed on the stale client.')
    expect(afterIntentionalRemoval.data.communications).toEqual([])
  })
})
