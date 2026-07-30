import { describe, expect, it } from 'vitest'
import {
  nextOutgoingMailAttemptAt,
  outgoingCommunicationIsClaimable,
  outgoingDeliveryMessageId,
  outgoingMailRetryDelayMs,
} from './outgoingMailQueue.js'

describe('durable outgoing mail queue model', () => {
  it('claims only due queued mail and stale interrupted sends', () => {
    const now = Date.parse('2026-07-29T12:00:00.000Z')
    expect(outgoingCommunicationIsClaimable({
      deliveryId: 'delivery-1',
      deliveryStatus: 'queued',
      scheduledAt: '2026-07-29T11:59:00.000Z',
    }, now)).toBe(true)
    expect(outgoingCommunicationIsClaimable({
      deliveryId: 'delivery-2',
      deliveryStatus: 'queued',
      scheduledAt: '2026-07-29T12:01:00.000Z',
    }, now)).toBe(false)
    expect(outgoingCommunicationIsClaimable({
      deliveryId: 'delivery-3',
      deliveryStatus: 'sending',
      deliveryStartedAt: '2026-07-29T11:57:00.000Z',
    }, now)).toBe(true)
    expect(outgoingCommunicationIsClaimable({
      deliveryId: 'delivery-4',
      deliveryStatus: 'sending',
      deliveryStartedAt: '2026-07-29T11:59:00.000Z',
    }, now)).toBe(false)
  })

  it('backs off failed attempts without ever dropping the task', () => {
    expect(outgoingMailRetryDelayMs(1)).toBe(30_000)
    expect(outgoingMailRetryDelayMs(3)).toBe(5 * 60_000)
    expect(outgoingMailRetryDelayMs(100)).toBe(6 * 60 * 60_000)
    expect(nextOutgoingMailAttemptAt(1, 0)).toBe('1970-01-01T00:00:30.000Z')
  })

  it('derives a stable RFC message id for crash-window retries', () => {
    const first = outgoingDeliveryMessageId('delivery-42')
    expect(first).toBe(outgoingDeliveryMessageId('delivery-42'))
    expect(first).not.toBe(outgoingDeliveryMessageId('delivery-43'))
    expect(first).toMatch(/^<phd-atlas\.[a-f0-9]{40}@mail\.local>$/)
  })
})
