import { createHash } from 'node:crypto'

export const OUTGOING_MAIL_STALE_CLAIM_MS = 2 * 60 * 1000
export const OUTGOING_MAIL_MAX_RETRY_MS = 6 * 60 * 60 * 1000

const retryDelaysMs = [
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  OUTGOING_MAIL_MAX_RETRY_MS,
]

function parsedTime(value) {
  const stamp = Date.parse(String(value ?? ''))
  return Number.isFinite(stamp) ? stamp : null
}

export function outgoingMailRetryDelayMs(attemptCount) {
  const attempt = Math.max(1, Math.floor(Number(attemptCount) || 1))
  return retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)]
}

export function nextOutgoingMailAttemptAt(attemptCount, nowMs = Date.now()) {
  return new Date(nowMs + outgoingMailRetryDelayMs(attemptCount)).toISOString()
}

export function outgoingCommunicationIsClaimable(
  communication,
  nowMs = Date.now(),
  staleClaimMs = OUTGOING_MAIL_STALE_CLAIM_MS,
) {
  if (!communication?.deliveryId) return false
  const status = communication.deliveryStatus
  if (status === 'sending') {
    const startedAt = parsedTime(communication.deliveryStartedAt)
    return startedAt === null || startedAt <= nowMs - staleClaimMs
  }
  if (status !== 'queued') return false

  const scheduledAt = parsedTime(communication.scheduledAt)
  if (scheduledAt !== null && scheduledAt > nowMs) return false
  const nextAttemptAt = parsedTime(communication.nextDeliveryAttemptAt)
  return nextAttemptAt === null || nextAttemptAt <= nowMs
}

export function outgoingDeliveryMessageId(deliveryId) {
  const digest = createHash('sha256')
    .update(String(deliveryId ?? ''))
    .digest('hex')
    .slice(0, 40)
  return `<phd-atlas.${digest}@mail.local>`
}
