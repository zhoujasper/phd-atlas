import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { decryptSecretWithProfile, encryptSecretWithProfile } from './crypto.js'
import { storageRoot } from './storage.js'

const STATE_VERSION = 2
const DEFAULT_BATCH_WINDOW_MS = 2 * 60 * 1000
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000
const DEFAULT_USER_MIN_INTERVAL_MS = 2 * 60 * 1000
const DEFAULT_RETRY_BASE_MS = 30 * 1000
const DEFAULT_RETRY_MAX_MS = 15 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 6
const DEFAULT_MAX_BATCH_SIZE = 50
const DEFAULT_MAX_JOURNAL_BYTES = 4 * 1024 * 1024
const MAX_TIMER_DELAY_MS = 2_147_000_000
const DIRECT_TEST_TYPES = new Set(['push_test'])
const PERSISTENCE_CRYPTO_PROFILE = Object.freeze({
  algorithm: 'aes-256-gcm',
  passwordBinding: '',
})

function emptySnapshot() {
  return { version: STATE_VERSION, revision: 0, batches: [], userDispatches: [] }
}

function finiteTimestamp(value, fallback) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback
}

function compactNotification(notification, { bypassCooldown = false, at = Date.now() } = {}) {
  return {
    id: String(notification.id ?? ''),
    type: String(notification.type ?? 'notification'),
    title: String(notification.title ?? 'PhD Atlas'),
    body: String(notification.body ?? ''),
    applicationId: notification.applicationId ?? null,
    targetPath: notification.targetPath ?? null,
    targetTab: notification.targetTab ?? null,
    targetId: notification.targetId ?? null,
    triggerDate: notification.triggerDate ?? null,
    createdAt: notification.createdAt ?? new Date().toISOString(),
    // This flag is internal queue state. Persisting it prevents a critical/due alert from
    // losing its cooldown bypass while another delivery is in flight or after a restart.
    bypassCooldown: bypassCooldown === true
      || notification.bypassCooldown === true
      || shouldDeliverBrowserPushImmediately(notification, at),
  }
}

function isoDay(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(String(value ?? '').trim())
  return match?.[1] ?? null
}

/**
 * Transport tests are always direct. Deadline notifications bypass the delay only when their
 * semantic type says they are due, the producer explicitly marks them critical, or the supplied
 * trigger date has arrived. Merely approaching deadlines still join the normal reminder digest.
 */
export function shouldDeliverBrowserPushImmediately(notification, at = Date.now()) {
  const type = String(notification?.type ?? '').trim().toLowerCase()
  if (DIRECT_TEST_TYPES.has(type)) return true
  if (type === 'deadline_due') return true
  if (!type.includes('deadline')) return false

  const metadata = notification?.metadata && typeof notification.metadata === 'object'
    ? notification.metadata
    : {}
  if (metadata.critical === true || String(metadata.urgency ?? '').toLowerCase() === 'critical') return true

  const triggerDay = isoDay(notification?.triggerDate)
  const referenceDay = isoDay(notification?.createdAt) || new Date(at).toISOString().slice(0, 10)
  return Boolean(triggerDay && triggerDay <= referenceDay)
}

function normalizeBatch(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const userId = String(raw.userId ?? '').trim()
  const topic = String(raw.topic ?? '').trim()
  if (!userId || !topic || !Array.isArray(raw.notifications)) return null
  const notifications = raw.notifications
    .filter((notification) => notification && typeof notification === 'object' && notification.id)
    .map((notification) => compactNotification(notification, { at: now }))
  if (notifications.length === 0) return null
  const firstQueuedAt = finiteTimestamp(raw.firstQueuedAt, now)
  const lastQueuedAt = finiteTimestamp(raw.lastQueuedAt, firstQueuedAt)
  return {
    userId,
    topic,
    notifications,
    firstQueuedAt,
    lastQueuedAt,
    dueAt: finiteTimestamp(raw.dueAt, now),
    attempts: Math.max(0, Number(raw.attempts) || 0),
  }
}

function normalizeSnapshot(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.batches)) return emptySnapshot()
  return {
    version: STATE_VERSION,
    revision: Math.max(0, Number(raw.revision) || 0),
    batches: raw.batches.map((batch) => normalizeBatch(batch, now)).filter(Boolean),
    userDispatches: Array.isArray(raw.userDispatches)
      ? raw.userDispatches
        .map((entry) => ({
          userId: String(entry?.userId ?? '').trim(),
          lastDeliveredAt: finiteTimestamp(entry?.lastDeliveredAt, 0),
        }))
        .filter((entry) => entry.userId)
      : [],
  }
}

function batchKey(userId, topic) {
  return `${userId}\u001f${topic}`
}

function batchBypassesCooldown(batch) {
  return batch.notifications.some((notification) => notification.bypassCooldown === true)
}

function notificationFamily(type) {
  const normalized = String(type ?? '').trim().toLowerCase()
  if (/mail|email|correspondence/.test(normalized)) return 'correspondence'
  if (/discover|match|position|program|advisor/.test(normalized)) return 'discover'
  if (/deadline|task|material|reminder/.test(normalized)) return 'reminders'
  if (/team/.test(normalized)) return 'team'
  if (/admin|announcement/.test(normalized)) return 'announcements'
  return normalized || 'general'
}

/**
 * Stable topic selection keeps independent classes of updates from being mixed while still
 * coalescing the common bursts produced by mail sync, Discover research, and reminder scans.
 * A producer may set metadata.pushTopic when a finer domain-specific topic is useful.
 */
export function browserPushTopic(notification) {
  const explicit = String(notification?.metadata?.pushTopic ?? '').trim()
  if (explicit) return explicit.slice(0, 160)
  return notificationFamily(notification?.type)
}

function batchPayload(userId, topic, notifications, now) {
  if (notifications.length === 1) {
    const { bypassCooldown: _bypassCooldown, ...payload } = notifications[0]
    return payload
  }
  const chinese = notifications.some((notification) => /[\u3400-\u9fff]/u.test(notification.title))
  const previewLimit = 3
  const titles = notifications.slice(0, previewLimit).map((notification) => notification.title)
  const remaining = notifications.length - titles.length
  const body = chinese
    ? `${titles.join('；')}${remaining > 0 ? `；另有 ${remaining} 条` : ''}`
    : `${titles.join('; ')}${remaining > 0 ? `; ${remaining} more` : ''}`
  const targetPaths = new Set(notifications.map((notification) => notification.targetPath).filter(Boolean))
  const targetTabs = new Set(notifications.map((notification) => notification.targetTab).filter(Boolean))
  const targetIds = new Set(notifications.map((notification) => notification.targetId).filter(Boolean))
  const applicationIds = new Set(notifications.map((notification) => notification.applicationId).filter(Boolean))
  const digest = createHash('sha256')
    .update(`${userId}\0${topic}\0${notifications.map((notification) => notification.id).sort().join('\0')}`)
    .digest('hex')
    .slice(0, 24)
  return {
    id: `push-batch:${digest}`,
    type: 'notification_batch',
    title: chinese ? `PhD Atlas：${notifications.length} 条新通知` : `PhD Atlas: ${notifications.length} new notifications`,
    body,
    applicationId: applicationIds.size === 1 ? [...applicationIds][0] : null,
    targetPath: targetPaths.size === 1 ? [...targetPaths][0] : '/notifications',
    targetTab: targetTabs.size === 1 ? [...targetTabs][0] : null,
    targetId: targetIds.size === 1 ? [...targetIds][0] : null,
    triggerDate: null,
    createdAt: new Date(now).toISOString(),
    metadata: {
      aggregate: true,
      count: notifications.length,
      topic,
      notificationIds: notifications.map((notification) => notification.id),
    },
  }
}

function retryDelay(attempts, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempts - 1)))
}

function deliveryNeedsRetry(result) {
  if (!result || typeof result !== 'object') return false
  const attempted = Number(result.attempted ?? 0)
  const delivered = Number(result.delivered ?? 0)
  const failed = Number(result.failed ?? 0)
  // No registered endpoint is not a transport failure: the durable in-app row remains the source
  // of truth, and retaining the batch forever would only grow the journal for an unsubscribed user.
  return attempted > 0 && delivered === 0 && failed > 0
}

function parseJournal(content) {
  let newest = null
  for (const line of String(content ?? '').split(/\r?\n/u)) {
    const sealed = line.trim()
    if (!sealed) continue
    const plaintext = decryptSecretWithProfile(sealed, PERSISTENCE_CRYPTO_PROFILE)
    if (!plaintext) continue
    try {
      const candidate = normalizeSnapshot(JSON.parse(plaintext))
      if (!newest || candidate.revision > newest.revision) newest = candidate
    } catch {
      // A process can stop halfway through the final append. Earlier complete records remain valid.
    }
  }
  return newest
}

async function readJournalCandidate(filePath) {
  try {
    return parseJournal(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function durableWrite(filePath, content, { append = false } = {}) {
  const handle = await fs.open(filePath, append ? 'a' : 'w', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Encrypted append journal used by the default batcher. Each record is a complete state snapshot,
 * so an interrupted final write cannot invalidate the preceding state. Compaction keeps a recovery
 * sidecar until the replacement journal has itself been flushed to disk.
 */
export function createFileBrowserPushPersistence({
  filePath = path.join(storageRoot, 'browser-push-batches.journal'),
  maxJournalBytes = DEFAULT_MAX_JOURNAL_BYTES,
} = {}) {
  const recoveryPath = `${filePath}.recovery`

  return {
    filePath,
    async load() {
      const [primary, recovery] = await Promise.all([
        readJournalCandidate(filePath),
        readJournalCandidate(recoveryPath),
      ])
      if (!primary) return recovery ?? emptySnapshot()
      if (!recovery) return primary
      return recovery.revision > primary.revision ? recovery : primary
    },
    async save(snapshot) {
      const normalized = normalizeSnapshot(snapshot)
      const record = `${encryptSecretWithProfile(JSON.stringify(normalized), PERSISTENCE_CRYPTO_PROFILE)}\n`
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await durableWrite(filePath, record, { append: true })

      const stats = await fs.stat(filePath)
      if (stats.size <= maxJournalBytes) return

      await durableWrite(recoveryPath, record)
      await fs.copyFile(recoveryPath, filePath)
      // Windows requires a writable handle for FlushFileBuffers/fsync.
      const compacted = await fs.open(filePath, 'r+')
      try {
        await compacted.sync()
      } finally {
        await compacted.close()
      }
      await fs.unlink(recoveryPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
    },
  }
}

export function createMemoryBrowserPushPersistence(initialState = emptySnapshot()) {
  let state = structuredClone(normalizeSnapshot(initialState))
  return {
    async load() {
      return structuredClone(state)
    },
    async save(snapshot) {
      state = structuredClone(normalizeSnapshot(snapshot))
    },
    inspect() {
      return structuredClone(state)
    },
  }
}

/**
 * Browser Push is deliberately delayed; in-app notification rows are still created immediately.
 * State is persisted before enqueue resolves, so a process restart cannot silently lose a batch.
 */
export function createBrowserPushBatcher({
  deliver,
  persistence = createFileBrowserPushPersistence(),
  topicFor = browserPushTopic,
  formatBatch = batchPayload,
  now = () => Date.now(),
  batchWindowMs = DEFAULT_BATCH_WINDOW_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  userMinIntervalMs = DEFAULT_USER_MIN_INTERVAL_MS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxBatchSize = DEFAULT_MAX_BATCH_SIZE,
  scheduleTimers = true,
  onError = (error) => console.error('Browser Push batch delivery failed:', error),
} = {}) {
  if (typeof deliver !== 'function') throw new TypeError('createBrowserPushBatcher requires a deliver function.')
  if (!persistence || typeof persistence.load !== 'function' || typeof persistence.save !== 'function') {
    throw new TypeError('Browser Push persistence must expose load() and save().')
  }

  const batches = new Map()
  const inFlight = new Set()
  const usersInFlight = new Set()
  const userDispatches = new Map()
  let loaded = false
  let revision = 0
  let timer = null
  let mutation = Promise.resolve()

  function withLock(work) {
    const result = mutation.then(work, work)
    mutation = result.catch(() => undefined)
    return result
  }

  function snapshotUnsafe() {
    return {
      version: STATE_VERSION,
      revision,
      batches: [...batches.values()].map((batch) => structuredClone(batch)),
      userDispatches: [...userDispatches.entries()].map(([userId, lastDeliveredAt]) => ({ userId, lastDeliveredAt })),
    }
  }

  async function persistUnsafe() {
    revision += 1
    await persistence.save(snapshotUnsafe())
  }

  function scheduleUnsafe() {
    if (!scheduleTimers) return
    if (timer) clearTimeout(timer)
    timer = null
    const nextDueAt = Math.min(...[...batches.entries()]
      .filter(([key]) => !inFlight.has(key))
      .map(([, batch]) => {
        if (batchBypassesCooldown(batch)) return batch.dueAt
        const lastDeliveredAt = userDispatches.get(batch.userId)
        return Math.max(batch.dueAt, lastDeliveredAt == null ? 0 : lastDeliveredAt + userMinIntervalMs)
      }))
    if (!Number.isFinite(nextDueAt)) return
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, nextDueAt - now()))
    timer = setTimeout(() => {
      timer = null
      void flushDue().catch(onError)
    }, delay)
    timer.unref?.()
  }

  async function loadUnsafe() {
    if (loaded) return
    const stored = normalizeSnapshot(await persistence.load(), now())
    revision = stored.revision
    for (const batch of stored.batches) batches.set(batchKey(batch.userId, batch.topic), batch)
    for (const entry of stored.userDispatches) userDispatches.set(entry.userId, entry.lastDeliveredAt)
    loaded = true
    scheduleUnsafe()
  }

  async function start() {
    return withLock(async () => {
      await loadUnsafe()
      return { batches: batches.size, notifications: [...batches.values()].reduce((sum, batch) => sum + batch.notifications.length, 0) }
    })
  }

  async function enqueue(userId, notification) {
    const normalizedUserId = String(userId ?? '').trim()
    if (!normalizedUserId) throw new TypeError('Browser Push enqueue requires a user id.')
    if (!notification?.id) throw new TypeError('Browser Push enqueue requires a notification id.')
    const notificationType = String(notification.type ?? '').trim().toLowerCase()
    if (DIRECT_TEST_TYPES.has(notificationType)) {
      return { mode: 'immediate', delivery: await deliver(normalizedUserId, notification) }
    }
    const immediate = shouldDeliverBrowserPushImmediately(notification, now())

    const topic = String(topicFor(notification) ?? '').trim() || 'general'
    const key = batchKey(normalizedUserId, topic)
    const queued = await withLock(async () => {
      await loadUnsafe()
      const timestamp = now()
      const duplicateBatch = [...batches.values()].find((candidateBatch) => (
        candidateBatch.userId === normalizedUserId
        && candidateBatch.notifications.some((candidate) => candidate.id === String(notification.id))
      ))
      if (duplicateBatch) {
        return {
          mode: 'queued',
          duplicate: true,
          key: batchKey(normalizedUserId, duplicateBatch.topic),
          dueAt: duplicateBatch.dueAt,
          flushNow: false,
          immediate: false,
        }
      }
      let batch = batches.get(key)
      if (!batch) {
        batch = {
          userId: normalizedUserId,
          topic,
          notifications: [],
          firstQueuedAt: timestamp,
          lastQueuedAt: timestamp,
          dueAt: timestamp + batchWindowMs,
          attempts: 0,
        }
        batches.set(key, batch)
      }
      batch.notifications.push(compactNotification(notification, { bypassCooldown: immediate, at: timestamp }))
      batch.lastQueuedAt = timestamp
      const userQueuedCount = [...batches.values()]
        .filter((candidateBatch) => candidateBatch.userId === normalizedUserId)
        .reduce((sum, candidateBatch) => sum + candidateBatch.notifications.length, 0)
      const reachedGlobalLimit = userQueuedCount >= maxBatchSize
      batch.dueAt = immediate || reachedGlobalLimit
        ? timestamp
        : Math.min(timestamp + batchWindowMs, batch.firstQueuedAt + maxWaitMs)
      batch.attempts = 0
      await persistUnsafe()
      scheduleUnsafe()
      return {
        mode: 'queued',
        duplicate: false,
        key,
        dueAt: batch.dueAt,
        count: batch.notifications.length,
        flushNow: immediate || reachedGlobalLimit,
        immediate,
      }
    })
    const delivery = queued.flushNow
      ? await flushUser(normalizedUserId, { at: now(), forceReady: true, bypassCooldown: queued.immediate })
      : null
    const { flushNow: _flushNow, immediate: wasImmediate, ...result } = queued
    return wasImmediate
      ? { ...result, mode: 'immediate', delivery }
      : result
  }

  async function claimUser(userId, { at, forceReady = false, bypassCooldown = false } = {}) {
    return withLock(async () => {
      await loadUnsafe()
      if (usersInFlight.has(userId)) return null
      const entries = [...batches.entries()]
        .filter(([key, batch]) => batch.userId === userId && !inFlight.has(key))
      if (entries.length === 0) return null
      if (!forceReady && !entries.some(([, batch]) => batch.dueAt <= at)) return null
      const lastDeliveredAt = userDispatches.get(userId)
      const cooldownUntil = lastDeliveredAt == null ? 0 : lastDeliveredAt + userMinIntervalMs
      const pendingBypassesCooldown = entries.some(([, batch]) => batchBypassesCooldown(batch))
      if (!bypassCooldown && !pendingBypassesCooldown && at < cooldownUntil) {
        scheduleUnsafe()
        return { throttled: true, userId, dueAt: cooldownUntil }
      }
      usersInFlight.add(userId)
      for (const [key] of entries) inFlight.add(key)
      return {
        userId,
        entries: entries.map(([key, batch]) => ({ key, batch: structuredClone(batch) })),
      }
    })
  }

  async function finishUser(claimed, outcome, deliveredAt) {
    return withLock(async () => {
      usersInFlight.delete(claimed.userId)
      if (outcome === 'delivered') userDispatches.set(claimed.userId, deliveredAt)
      for (const { key, batch } of claimed.entries) {
        inFlight.delete(key)
        const current = batches.get(key)
        if (!current) continue
        const deliveredIds = new Set(batch.notifications.map((notification) => notification.id))
        if (outcome === 'delivered' || outcome === 'abandoned') {
          current.notifications = current.notifications.filter((notification) => !deliveredIds.has(notification.id))
          if (current.notifications.length === 0) {
            batches.delete(key)
          } else {
            // Anything left was queued while the claimed delivery was in flight.
            current.firstQueuedAt = current.lastQueuedAt
            current.attempts = 0
            current.dueAt = batchBypassesCooldown(current)
              ? now()
              : Math.min(current.lastQueuedAt + batchWindowMs, current.firstQueuedAt + maxWaitMs)
          }
        } else {
          current.attempts = batch.attempts + 1
          current.dueAt = now() + retryDelay(current.attempts, retryBaseMs, retryMaxMs)
        }
      }
      await persistUnsafe()
      scheduleUnsafe()
    })
  }

  async function flushUser(userId, options = {}) {
    const claimed = await claimUser(userId, options)
    if (!claimed) return { status: 'skipped', userId }
    if (claimed.throttled) return { status: 'throttled', userId, dueAt: claimed.dueAt }
    const topics = [...new Set(claimed.entries.map(({ batch }) => batch.topic))].sort()
    const notifications = claimed.entries.flatMap(({ batch }) => batch.notifications)
    const topic = topics.length === 1 ? topics[0] : 'mixed'
    let payload = formatBatch(claimed.userId, topic, notifications, now())
    if (topics.length > 1) {
      payload = {
        ...payload,
        metadata: {
          ...(payload?.metadata ?? {}),
          aggregate: true,
          count: notifications.length,
          topic: 'mixed',
          topics,
          notificationIds: notifications.map((notification) => notification.id),
        },
      }
    }
    try {
      const delivery = await deliver(claimed.userId, payload)
      if (deliveryNeedsRetry(delivery)) {
        const error = new Error('No Browser Push endpoint accepted the batch.')
        error.code = 'PUSH_BATCH_DELIVERY_FAILED'
        throw error
      }
      await finishUser(claimed, 'delivered', now())
      return { status: 'delivered', userId: claimed.userId, topic, topics, count: notifications.length, delivery }
    } catch (error) {
      const attempts = Math.max(...claimed.entries.map(({ batch }) => batch.attempts)) + 1
      const abandoned = attempts >= maxAttempts
      await finishUser(claimed, abandoned ? 'abandoned' : 'retry', now())
      onError(error, { userId: claimed.userId, topic, topics, attempts, abandoned })
      return { status: abandoned ? 'abandoned' : 'retry', userId: claimed.userId, topic, topics, count: notifications.length, error }
    }
  }

  async function flushDue({ at = now(), force = false } = {}) {
    const userIds = await withLock(async () => {
      await loadUnsafe()
      return [...new Set([...batches.entries()]
        .filter(([key, batch]) => !inFlight.has(key) && (force || batch.dueAt <= at))
        .map(([, batch]) => batch.userId))]
    })
    const results = await Promise.all(userIds.map((userId) => flushUser(userId, {
      at,
      forceReady: force,
      bypassCooldown: force,
    })))
    return results.filter((result) => result.status !== 'throttled' && result.status !== 'skipped')
  }

  async function pending() {
    return withLock(async () => {
      await loadUnsafe()
      return snapshotUnsafe().batches
    })
  }

  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { enqueue, flushDue, pending, start, stop }
}
