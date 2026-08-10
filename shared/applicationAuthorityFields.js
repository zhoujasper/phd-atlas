/**
 * The single definition of which application state the server owns.
 *
 * These sets answer one question — "may the editor author this value?" — and
 * two separate mechanisms depend on the same answer:
 *
 *   - `applicationCanonical.js` excludes them from the canonical projection the
 *     delta guard compares, so a server rewrite is not read as a lost field.
 *   - `applicationPersistenceProtocol.js` excludes them from the authored hash
 *     the browser verifies, so a server rewrite is not read as a refused save.
 *
 * They were maintained as two separate copies in the same directory, and both
 * classes of failure above are what happened when the copies drifted: a save
 * the person could not complete, with no way to act on it and nothing in any
 * log. `mailCategoryOverride` was the most recent; `bodyFormat`, `bodyHtml`,
 * `bodyText` and `mailClassification` were four more of the same lined up
 * behind it.
 *
 * The invariant, in one line: **anything the server rewrites behind a
 * submission belongs in these sets.** Adding an enforcement without adding it
 * here refuses every save that carries the field. There is no partial credit —
 * `server/communicationAuthorityContract.test.js` fails the build for it.
 *
 * The application editor and API ship as one current protocol. Every semantic
 * change to these sets must update the authored projection version and both
 * sides together; older projection contracts are intentionally unsupported.
 */

export const APPLICATION_AUTHORED_PROJECTION_VERSION = 2

/** Top-level application keys the editor never authors. */
export const APPLICATION_SERVER_AUTHORITY_FIELDS = Object.freeze(new Set([
  'ownerId',
  'teamId',
  'teamTransferRequest',
  'shares',
  'reviewComments',
  'backupSettings',
  'versions',
  'deletedAt',
  'createdAt',
  'updatedAt',
  // Team list payload decoration. These values are never part of the stored
  // application and must not make a Team editor acknowledgement diverge.
  'ownerName',
  'ownerEmail',
  'currentUserApplicationRole',
  // Transport-only optimistic merge metadata; never part of authored state.
  'clientBaseApplication',
]))

/** Upload-vault handles on a material or task; the vault owns these. */
export const VAULT_REFERENCE_FIELDS = Object.freeze(new Set([
  'fileId',
  'fileName',
  'fileSize',
  'mimeType',
  'storageName',
  'versions',
]))

/** Communication state the server owns; see `preserveCommunicationAuthority`. */
export const COMMUNICATION_SERVER_AUTHORITY_FIELDS = Object.freeze(new Set([
  'attachments',
  'deliveryStatus',
  'scheduledAt',
  'sentAt',
  'deliveryId',
  'deliveryUserId',
  'deliveryStartedAt',
  'nextDeliveryAttemptAt',
  'deliveryAttemptCount',
  'deliveryLastErrorCode',
  'deliveryLastErrorAt',
  'sourceMessageKey',
  'sourceMailbox',
  'importedAt',
  'mailSecurity',
  // The immutable snapshot of a message that has been sent.
  'bodyFormat',
  'bodyHtml',
  'bodyText',
  // The classifier's own output. The manual selection it can be overridden by
  // (`mailCategories` and its primary `mailCategoryOverride`) is authored by
  // the person and is deliberately absent from this set.
  'mailClassification',
]))

/** The school logo is resolved and stamped by the server. */
export const SCHOOL_SERVER_AUTHORITY_FIELDS = Object.freeze(new Set(['logo']))

/** True when the exact application path belongs to a server-owned value. */
export function isApplicationServerAuthorityPath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false
  const [root, _index, field] = segments
  if (segments.length === 1) return APPLICATION_SERVER_AUTHORITY_FIELDS.has(root)
  if (root === 'school' && segments.length >= 2) {
    return SCHOOL_SERVER_AUTHORITY_FIELDS.has(segments[1])
  }
  if (
    (root === 'materials' || root === 'tasks')
    && segments.length >= 3
  ) return VAULT_REFERENCE_FIELDS.has(field)
  if (root === 'communications' && segments.length >= 3) {
    return COMMUNICATION_SERVER_AUTHORITY_FIELDS.has(field)
  }
  return false
}
