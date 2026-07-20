import { describe, expect, it } from 'vitest'
import {
  OfflineReplayMetadataSchema,
  hasOfflineReplayConflict,
  parseOrThrow,
} from './validation.js'

describe('offline replay validation', () => {
  it('accepts a matching trusted baseline and rejects a stale one', () => {
    const currentUpdatedAt = '2026-07-13T10:30:00.000Z'

    expect(hasOfflineReplayConflict(currentUpdatedAt, currentUpdatedAt)).toBe(false)
    expect(hasOfflineReplayConflict(currentUpdatedAt, '2026-07-12T08:00:00.000Z')).toBe(true)
  })

  it('validates replay metadata without trusting unrelated request fields', () => {
    expect(parseOrThrow(OfflineReplayMetadataSchema, {
      clientBaseUpdatedAt: '2026-07-13T10:30:00.000Z',
      progress: 90,
    })).toEqual({ clientBaseUpdatedAt: '2026-07-13T10:30:00.000Z' })

    expect(() => parseOrThrow(OfflineReplayMetadataSchema, {
      clientBaseUpdatedAt: '',
    })).toThrow()
  })
})
