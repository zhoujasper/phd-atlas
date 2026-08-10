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

describe.sequential('saved draft email delivery', () => {
  beforeAll(async () => {
    server = createApp().listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it('atomically replaces one saved draft and keeps delivery retries idempotent', async () => {
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
        professor: 'Professor Atomic Draft',
        professorChinese: '',
        professorEmail: 'atomic-draft@example.edu',
        professorHomepage: '',
        university: `Atomic Draft ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Atomic Draft PhD',
        deadline: '2027-01-15',
        notes: '',
      }),
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)

    const savedDraft = await jsonRequest(`/api/applications/${created.data.id}/communications`, token, {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Saved draft subject',
        summary: 'Saved draft body',
        channel: 'Email',
        date: '2026-08-02',
        time: '10:30',
        direction: 'outgoing',
        messageType: 'draft-email',
        from: 'admin@phd-atlas.local',
        to: 'atomic-draft@example.edu',
      }),
    })
    expect(savedDraft.response.status, JSON.stringify(savedDraft.payload)).toBe(201)

    const idempotencyKey = `draft-delivery-${Date.now()}`
    const sendPayload = {
      subject: 'Saved draft subject',
      summary: 'Saved draft body',
      bodyFormat: 'plain',
      date: '2026-08-02',
      time: '10:30',
      from: 'admin@phd-atlas.local',
      to: 'atomic-draft@example.edu',
      sourceDraftId: savedDraft.data.id,
      idempotencyKey,
    }
    const sent = await jsonRequest(`/api/applications/${created.data.id}/communications/send`, token, {
      method: 'POST',
      body: JSON.stringify(sendPayload),
    })
    expect([201, 202]).toContain(sent.response.status)
    expect(sent.data.communication).toMatchObject({
      deliveryId: idempotencyKey,
      subject: 'Saved draft subject',
    })

    const reloaded = await jsonRequest(`/api/applications/${created.data.id}`, token)
    expect(reloaded.response.status, JSON.stringify(reloaded.payload)).toBe(200)
    expect(reloaded.data.communications.some((item) => item.id === savedDraft.data.id)).toBe(false)
    expect(reloaded.data.communications.filter((item) => item.deliveryId === idempotencyKey)).toHaveLength(1)

    const retried = await jsonRequest(`/api/applications/${created.data.id}/communications/send`, token, {
      method: 'POST',
      body: JSON.stringify(sendPayload),
    })
    expect(retried.response.status, JSON.stringify(retried.payload)).toBe(200)
    expect(retried.data.communication.id).toBe(sent.data.communication.id)

    const differentDelivery = await jsonRequest(
      `/api/applications/${created.data.id}/communications/send`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          ...sendPayload,
          idempotencyKey: `${idempotencyKey}-different`,
        }),
      },
    )
    expect(differentDelivery.response.status, JSON.stringify(differentDelivery.payload)).toBe(409)
    expect(differentDelivery.payload.error).toMatchObject({
      code: 'SOURCE_DRAFT_NOT_FOUND',
      field: 'sourceDraftId',
    })

    const finalRead = await jsonRequest(`/api/applications/${created.data.id}`, token)
    expect(finalRead.data.communications.filter((item) => item.deliveryId === idempotencyKey)).toHaveLength(1)
  })
})
