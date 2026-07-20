import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deletePushSubscriptionByEndpoint: vi.fn(),
  getPushVapidKeys: vi.fn(),
  listPushSubscriptions: vi.fn(),
  savePushVapidKeys: vi.fn(),
  generateVAPIDKeys: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}))

vi.mock('./storage.js', () => ({
  deletePushSubscriptionByEndpoint: mocks.deletePushSubscriptionByEndpoint,
  getPushVapidKeys: mocks.getPushVapidKeys,
  listPushSubscriptions: mocks.listPushSubscriptions,
  savePushVapidKeys: mocks.savePushVapidKeys,
}))

vi.mock('web-push', () => ({
  default: {
    deletePushSubscriptionByEndpoint: mocks.deletePushSubscriptionByEndpoint,
    generateVAPIDKeys: mocks.generateVAPIDKeys,
    sendNotification: mocks.sendNotification,
    setVapidDetails: mocks.setVapidDetails,
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.getPushVapidKeys.mockResolvedValue({ publicKey: 'public-key', privateKey: 'private-key' })
  mocks.listPushSubscriptions.mockResolvedValue([])
  mocks.sendNotification.mockResolvedValue({ statusCode: 201 })
})

describe('web push delivery', () => {
  it('sends an encrypted email alert with high urgency and removes expired endpoints', async () => {
    const active = { endpoint: 'https://push.example.test/active', keys: { p256dh: 'key-a', auth: 'auth-a' } }
    const expired = { endpoint: 'https://push.example.test/expired', keys: { p256dh: 'key-b', auth: 'auth-b' } }
    mocks.listPushSubscriptions.mockResolvedValue([active, expired])
    mocks.sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce({ statusCode: 410 })
    const { deliverWebPush } = await import('./webPush.js')

    await expect(deliverWebPush('user_test', {
      id: 'notif_mail',
      type: 'new_email_imported',
      title: 'New email from Professor Chen',
      body: 'Research update',
      applicationId: 'app_1',
      targetPath: '/applications/app_1/mail',
    })).resolves.toEqual({ attempted: 2, delivered: 1, failed: 1, removed: 1 })

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      active,
      expect.stringContaining('New email from Professor Chen'),
      expect.objectContaining({ urgency: 'high', TTL: 86_400, timeout: 10_000 }),
    )
    expect(mocks.deletePushSubscriptionByEndpoint).toHaveBeenCalledWith(expired.endpoint)
  })

  it('removes subscriptions created with an old VAPID key', async () => {
    const stale = { endpoint: 'https://push.example.test/stale-vapid', keys: { p256dh: 'key-a', auth: 'auth-a' } }
    mocks.listPushSubscriptions.mockResolvedValue([stale])
    mocks.sendNotification.mockRejectedValue({
      statusCode: 403,
      body: 'the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.',
    })
    const { deliverWebPush } = await import('./webPush.js')

    await expect(deliverWebPush('user_test', {
      id: 'notif_test',
      type: 'push_test',
      title: 'Test alert',
      body: 'Test body',
    })).resolves.toEqual({ attempted: 1, delivered: 0, failed: 1, removed: 1 })

    expect(mocks.deletePushSubscriptionByEndpoint).toHaveBeenCalledWith(stale.endpoint)
  })
})
