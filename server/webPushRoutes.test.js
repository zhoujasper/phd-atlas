import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, flushBrowserPushBatches } from './index.js'
import { deletePushSubscription } from './storage.js'

const webPush = vi.hoisted(() => ({
  deliverWebPush: vi.fn(),
  getWebPushPublicKey: vi.fn(),
  initializeWebPush: vi.fn(),
}))

vi.mock('./webPush.js', () => webPush)

let server
let baseUrl
let token
let userId
let endpoint

beforeEach(async () => {
  webPush.getWebPushPublicKey.mockResolvedValue('B'.repeat(87))
  webPush.initializeWebPush.mockResolvedValue(undefined)
  webPush.deliverWebPush.mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456' }),
  })
  const payload = await response.json()
  token = payload.data.token
  userId = payload.data.user.id
  endpoint = `https://push.example.test/subscriptions/${Date.now()}`
  await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ browserNotificationsEnabled: true }),
  })
  await flushBrowserPushBatches({ force: true })
  webPush.deliverWebPush.mockClear()
})

afterEach(async () => {
  await flushBrowserPushBatches({ force: true })
  if (token && endpoint) {
    const identity = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    await deletePushSubscription(identity.sub, endpoint)
  }
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('web push subscription API', () => {
  it('returns the VAPID public key and saves then removes the authenticated device endpoint', async () => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const keyResponse = await fetch(`${baseUrl}/api/push/public-key`, { headers })
    const keyPayload = await keyResponse.json()

    expect(keyResponse.status).toBe(200)
    expect(keyPayload.data.publicKey).toHaveLength(87)

    const saveResponse = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: 'a'.repeat(32), auth: 'b'.repeat(16) },
      }),
    })
    expect(await saveResponse.json()).toMatchObject({ ok: true, data: { endpoint } })

    const deleteResponse = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ endpoint }),
    })
    expect(await deleteResponse.json()).toMatchObject({ ok: true, data: { endpoint, deleted: true } })
  })

  it('sends a real test alert through the authenticated device subscription', async () => {
    const listBeforeResponse = await fetch(`${baseUrl}/api/notifications`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const listBefore = await listBeforeResponse.json()
    const response = await fetch(`${baseUrl}/api/push/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    const listAfterResponse = await fetch(`${baseUrl}/api/notifications`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const listAfter = await listAfterResponse.json()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        attempted: 1,
        delivered: 1,
        failed: 0,
        removed: 0,
        notification: { id: expect.stringMatching(/^push-test:/), type: 'push_test' },
      },
    })
    expect(listBeforeResponse.status).toBe(200)
    expect(listAfterResponse.status).toBe(200)
    expect(listAfter.data).toEqual(listBefore.data)
    expect(webPush.deliverWebPush).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        id: expect.stringMatching(/^push-test:/),
        type: 'push_test',
        targetPath: '/settings',
      }),
    )
  })

  it('does not send a browser alert after the account-level browser setting is turned off', async () => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    try {
      const settingResponse = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ browserNotificationsEnabled: false }),
      })
      expect(settingResponse.status).toBe(200)

      const response = await fetch(`${baseUrl}/api/push/test`, { method: 'POST', headers })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ ok: false, error: { code: 'PUSH_DISABLED' } })
      expect(webPush.deliverWebPush).not.toHaveBeenCalled()
    } finally {
      await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ browserNotificationsEnabled: true }),
      })
    }
  })

  it('drops an already queued browser alert if the account setting is turned off before flush', async () => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const adminResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@phd-atlas.local', password: 'admin123456', scope: 'admin' }),
    })
    const adminPayload = await adminResponse.json()
    try {
      const publishResponse = await fetch(`${baseUrl}/api/admin/notifications/publish`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminPayload.data.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: `Queued opt-out test ${Date.now()}`,
          body: 'This queued notification must respect a later opt-out.',
          channels: ['in_app'],
          userIds: [userId],
          groupIds: [],
          audiences: [],
        }),
      })
      expect(publishResponse.status).toBe(200)
      expect(webPush.deliverWebPush).not.toHaveBeenCalled()

      const settingResponse = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ browserNotificationsEnabled: false }),
      })
      expect(settingResponse.status).toBe(200)
      await expect(flushBrowserPushBatches({ force: true })).resolves.toContainEqual(expect.objectContaining({
        status: 'delivered',
        userId,
        delivery: expect.objectContaining({ skipped: true }),
      }))
      expect(webPush.deliverWebPush).not.toHaveBeenCalled()
    } finally {
      await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ browserNotificationsEnabled: true }),
      })
    }
  })

  it('persists an admin-published message and leaves Web Push delivery to the aggregate batcher', async () => {
    const adminResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@phd-atlas.local', password: 'admin123456', scope: 'admin' }),
    })
    const adminPayload = await adminResponse.json()
    const title = `Push route test ${Date.now()}`
    const response = await fetch(`${baseUrl}/api/admin/notifications/publish`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminPayload.data.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: 'Published message body',
        channels: ['in_app'],
        userIds: [userId],
        groupIds: [],
        audiences: [],
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { recipients: 1, created: 1 } })
    expect(webPush.deliverWebPush).not.toHaveBeenCalled()

    const notificationsResponse = await fetch(`${baseUrl}/api/notifications`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const notificationsPayload = await notificationsResponse.json()
    expect(notificationsPayload.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'admin_announcement', title }),
    ]))

    await expect(flushBrowserPushBatches({ force: true })).resolves.toContainEqual(expect.objectContaining({
      status: 'delivered',
      userId,
      topic: 'announcements',
      count: 1,
    }))
    expect(webPush.deliverWebPush).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ type: 'admin_announcement', title }),
    )
  })
})
