import webPush from 'web-push'
import {
  deletePushSubscriptionByEndpoint,
  getPushVapidKeys,
  listPushSubscriptions,
  savePushVapidKeys,
} from './storage.js'

const DEFAULT_VAPID_SUBJECT = 'mailto:notifications@phd-atlas.local'
const WEB_PUSH_REQUEST_TIMEOUT_MS = 10_000
let configurationPromise = null

function configuredEnvironmentKeys() {
  const publicKey = String(process.env.PUSH_VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = String(process.env.PUSH_VAPID_PRIVATE_KEY ?? '').trim()
  if (!publicKey && !privateKey) return null
  if (!publicKey || !privateKey) {
    throw new Error('PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY must be configured together.')
  }
  return { publicKey, privateKey }
}

async function configureWebPush() {
  const configured = configuredEnvironmentKeys()
  const keys = configured ?? await getPushVapidKeys() ?? webPush.generateVAPIDKeys()
  if (!configured) {
    const persisted = await getPushVapidKeys()
    if (!persisted) await savePushVapidKeys(keys)
  }

  webPush.setVapidDetails(
    String(process.env.PUSH_VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT).trim(),
    keys.publicKey,
    keys.privateKey,
  )
  return keys
}

async function vapidConfiguration() {
  if (!configurationPromise) {
    configurationPromise = configureWebPush().catch((error) => {
      configurationPromise = null
      throw error
    })
  }
  return configurationPromise
}

function notificationUrgency(type) {
  return type === 'new_email_imported' || type === 'team_message' ? 'high' : 'normal'
}

function notificationPayload(notification) {
  return JSON.stringify({
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    applicationId: notification.applicationId ?? null,
    targetPath: notification.targetPath ?? null,
    targetTab: notification.targetTab ?? null,
    targetId: notification.targetId ?? null,
  })
}

function isInvalidSubscription(error) {
  const status = Number(error?.statusCode ?? error?.status ?? 0)
  if (status === 404 || status === 410) return true
  if (status !== 403) return false
  const detail = `${error?.message ?? ''}\n${error?.body ?? ''}`.toLowerCase()
  return detail.includes('vapid')
    && (detail.includes('do not correspond') || detail.includes('mismatch'))
}

export async function initializeWebPush() {
  return vapidConfiguration()
}

export async function getWebPushPublicKey() {
  return (await vapidConfiguration()).publicKey
}

/**
 * The application database remains the source of truth. Push delivery is best effort: invalid
 * subscriptions are pruned, while transient provider errors leave the endpoint available for a retry.
 */
export async function deliverWebPush(userId, notification) {
  await vapidConfiguration()
  const subscriptions = await listPushSubscriptions(userId)
  if (subscriptions.length === 0) return { attempted: 0, delivered: 0, failed: 0, removed: 0 }

  const payload = notificationPayload(notification)
  const results = await Promise.allSettled(
    subscriptions.map((subscription) => webPush.sendNotification(subscription, payload, {
      TTL: 60 * 60 * 24,
      urgency: notificationUrgency(notification.type),
      timeout: WEB_PUSH_REQUEST_TIMEOUT_MS,
    })),
  )

  const invalid = subscriptions.filter((subscription, index) => (
    results[index].status === 'rejected' && isInvalidSubscription(results[index].reason)
  ))
  await Promise.all(invalid.map((subscription) => deletePushSubscriptionByEndpoint(subscription.endpoint)))
  return {
    attempted: subscriptions.length,
    delivered: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
    removed: invalid.length,
  }
}
