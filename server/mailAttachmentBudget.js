export const MAX_MAIL_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024
export const MAX_MAIL_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

export class MailAttachmentBudgetError extends Error {
  constructor(code, message, { status = 413, limitBytes, actualBytes } = {}) {
    super(message)
    this.name = 'MailAttachmentBudgetError'
    this.code = code
    this.status = status
    this.limitBytes = limitBytes
    this.actualBytes = actualBytes
  }
}

function boundedSize(value) {
  const size = Number(value)
  return Number.isSafeInteger(size) && size >= 0 ? size : null
}

/**
 * Validate attachment metadata before any encrypted payload is decrypted.
 * The vault repeats the per-file check against the authenticated plaintext
 * length, so stale or forged metadata cannot bypass this preflight budget.
 */
export function assertMailAttachmentBudget(entries, {
  maxFileBytes = MAX_MAIL_ATTACHMENT_FILE_BYTES,
  maxTotalBytes = MAX_MAIL_ATTACHMENT_TOTAL_BYTES,
} = {}) {
  let totalBytes = 0
  for (const [index, entry] of (entries || []).entries()) {
    const size = boundedSize(entry?.size)
    if (size === null) {
      throw new MailAttachmentBudgetError(
        'MAIL_ATTACHMENT_SIZE_UNKNOWN',
        `Attachment ${index + 1} has no trustworthy size metadata.`,
        { status: 400 },
      )
    }
    if (size > maxFileBytes) {
      throw new MailAttachmentBudgetError(
        'MAIL_ATTACHMENT_TOO_LARGE',
        `An attachment exceeds the ${maxFileBytes}-byte decrypted size limit.`,
        { limitBytes: maxFileBytes, actualBytes: size },
      )
    }
    totalBytes += size
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) {
      throw new MailAttachmentBudgetError(
        'MAIL_ATTACHMENTS_TOTAL_TOO_LARGE',
        `Attachments exceed the ${maxTotalBytes}-byte total decrypted size limit.`,
        { limitBytes: maxTotalBytes, actualBytes: totalBytes },
      )
    }
  }
  return { totalBytes, maxFileBytes, maxTotalBytes }
}

/**
 * Stateful budget for the actual authenticated plaintext lengths returned by
 * the upload vault. Metadata preflight is only an optimization; callers must
 * use this tracker while decrypting so a client cannot under-report sizes.
 */
export function createMailAttachmentBudgetTracker({
  maxFileBytes = MAX_MAIL_ATTACHMENT_FILE_BYTES,
  maxTotalBytes = MAX_MAIL_ATTACHMENT_TOTAL_BYTES,
} = {}) {
  let totalBytes = 0
  return Object.freeze({
    maxBytesForNext() {
      return Math.min(maxFileBytes, Math.max(0, maxTotalBytes - totalBytes))
    },
    recordActualBytes(size) {
      const checked = assertMailAttachmentBudget([{ size }], {
        maxFileBytes,
        maxTotalBytes: maxTotalBytes - totalBytes,
      })
      totalBytes += checked.totalBytes
      return { totalBytes, remainingBytes: maxTotalBytes - totalBytes }
    },
    totalBytes() {
      return totalBytes
    },
  })
}
