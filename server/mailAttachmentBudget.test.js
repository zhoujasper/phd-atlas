import { describe, expect, it } from 'vitest'
import {
  MAX_MAIL_ATTACHMENT_FILE_BYTES,
  MAX_MAIL_ATTACHMENT_TOTAL_BYTES,
  MailAttachmentBudgetError,
  assertMailAttachmentBudget,
  createMailAttachmentBudgetTracker,
} from './mailAttachmentBudget.js'

describe('mail attachment decrypted-memory budget', () => {
  it('accepts a bounded set and reports its total', () => {
    expect(assertMailAttachmentBudget([{ size: 4 }, { size: 7 }])).toMatchObject({ totalBytes: 11 })
  })

  it('rejects an oversized individual attachment before decryption', () => {
    expect(() => assertMailAttachmentBudget([{ size: MAX_MAIL_ATTACHMENT_FILE_BYTES + 1 }]))
      .toThrow(expect.objectContaining({
        name: 'MailAttachmentBudgetError',
        code: 'MAIL_ATTACHMENT_TOO_LARGE',
        status: 413,
      }))
  })

  it('rejects an aggregate that would amplify mail memory usage', () => {
    const half = Math.floor(MAX_MAIL_ATTACHMENT_TOTAL_BYTES / 2)
    expect(() => assertMailAttachmentBudget([{ size: half }, { size: half }, { size: 1 }]))
      .toThrow(MailAttachmentBudgetError)
    try {
      assertMailAttachmentBudget([{ size: half }, { size: half }, { size: 1 }])
    } catch (error) {
      expect(error).toMatchObject({ code: 'MAIL_ATTACHMENTS_TOTAL_TOO_LARGE', status: 413 })
    }
  })

  it('fails closed when stored metadata has no finite non-negative size', () => {
    for (const size of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => assertMailAttachmentBudget([{ size }])).toThrow(expect.objectContaining({
        code: 'MAIL_ATTACHMENT_SIZE_UNKNOWN',
        status: 400,
      }))
    }
  })

  it('enforces the total again from actual decrypted bytes when metadata is under-reported', () => {
    expect(assertMailAttachmentBudget([{ size: 1 }, { size: 1 }, { size: 1 }], {
      maxFileBytes: 25,
      maxTotalBytes: 50,
    })).toMatchObject({ totalBytes: 3 })

    const tracker = createMailAttachmentBudgetTracker({ maxFileBytes: 25, maxTotalBytes: 50 })
    tracker.recordActualBytes(20)
    tracker.recordActualBytes(20)
    expect(tracker.maxBytesForNext()).toBe(10)
    expect(() => tracker.recordActualBytes(11)).toThrow(expect.objectContaining({
      code: 'MAIL_ATTACHMENTS_TOTAL_TOO_LARGE',
      status: 413,
    }))
    tracker.recordActualBytes(10)
    expect(tracker.totalBytes()).toBe(50)
    expect(tracker.maxBytesForNext()).toBe(0)
  })
})
