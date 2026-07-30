import webPush from 'web-push'
import https from 'node:https'
import {
  deletePushSubscriptionByEndpoint,
  getPushVapidKeys,
  listPushSubscriptions,
  savePushVapidKeys,
} from './storage.js'
import {
  OutboundNetworkPolicyError,
  resolvePinnedNetworkTarget,
} from './outboundNetworkPolicy.js'

const WEB_PUSH_REQUEST_TIMEOUT_MS = 10_000
let configurationPromise = null

function defaultVapidSubject() {
  try {
    const baseUrl = new URL(String(process.env.BASE_URL ?? '').trim())
    if (baseUrl.protocol === 'https:') return baseUrl.origin
  } catch {}
  return 'mailto:notifications@phd-atlas.local'
}

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
    String(process.env.PUSH_VAPID_SUBJECT ?? defaultVapidSubject()).trim(),
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
  if (error instanceof OutboundNetworkPolicyError || error?.code === 'INVALID_PUSH_ENDPOINT') {
    return true
  }
  const status = Number(error?.statusCode ?? error?.status ?? 0)
  // Provider 4xx responses are permanent for this endpoint/key envelope.
  // Retaining them makes every later reminder fail and prevents the explicit
  // enable/test flow from creating a clean subscription.
  return [400, 401, 403, 404, 410].includes(status)
}

async function pinnedPushAgent(endpoint) {
  let url
  try {
    url = new URL(String(endpoint ?? ''))
  } catch {
    url = null
  }
  if (
    !url
    || url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hash
    || (url.port && url.port !== '443')
  ) {
    const error = new Error('Push endpoint must be a credential-free HTTPS URL on port 443.')
    error.code = 'INVALID_PUSH_ENDPOINT'
    throw error
  }
  const target = await resolvePinnedNetworkTarget(url.hostname)
  if (!target.pinned || !target.family) return null
  return new https.Agent({
    keepAlive: false,
    lookup(_hostname, lookupOptions, callback) {
      if (lookupOptions?.all) {
        callback(null, [{ address: target.address, family: target.family }])
        return
      }
      callback(null, target.address, target.family)
    },
  })
}

async function sendPinnedPush(subscription, payload, options) {
  const agent = await pinnedPushAgent(subscription.endpoint)
  try {
    return await webPush.sendNotification(subscription, payload, {
      ...options,
      ...(agent ? { agent } : {}),
    })
  } finally {
    agent?.destroy()
  }
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
    subscriptions.map((subscription) => sendPinnedPush(subscription, payload, {
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
