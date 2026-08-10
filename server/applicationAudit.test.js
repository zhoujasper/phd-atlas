import { describe, expect, it } from 'vitest'
import {
  compactApplicationAuditMetadata,
  MAX_APPLICATION_AUDIT_CHANGED_FIELDS,
} from './applicationAudit.js'

describe('compact application audit metadata', () => {
  it('never duplicates full before/after records into a mutation event', () => {
    const hugePayload = { content: 'x'.repeat(2 * 1024 * 1024) }
    const metadata = compactApplicationAuditMetadata({
      applicationId: 'app-1',
      beforeApplication: hugePayload,
      afterApplication: hugePayload,
      changedFields: Array.from({ length: 1_000 }, (_, index) => `materials.${index}.details`),
    })

    expect(metadata).not.toHaveProperty('beforeApplication')
    expect(metadata).not.toHaveProperty('afterApplication')
    expect(metadata.changedFields).toHaveLength(MAX_APPLICATION_AUDIT_CHANGED_FIELDS)
    expect(metadata.changedFieldCount).toBe(1_000)
    expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(16 * 1024)
  })

  it('preserves identity metadata and deduplicates field paths', () => {
    expect(compactApplicationAuditMetadata({
      applicationId: 'app-1',
      ownerId: 'user-1',
      changedFields: ['program', 'program', '', null],
    })).toEqual({
      applicationId: 'app-1',
      ownerId: 'user-1',
      changedFields: ['program'],
      changedFieldCount: 1,
    })
  })
})
