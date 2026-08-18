import {
  APPLICATION_SERVER_AUTHORITY_FIELDS,
  COMMUNICATION_SERVER_AUTHORITY_FIELDS,
  VAULT_REFERENCE_FIELDS,
} from './shared/applicationAuthorityFields.js'

function restoreAuthorityFields(incoming, current, fields) {
  const restored = { ...incoming }
  for (const field of fields) {
    if (current && current[field] !== undefined) restored[field] = current[field]
    else delete restored[field]
  }
  return restored
}

function restoreMaterialAuthority(incomingItems = [], currentItems = []) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]))
  return incomingItems.map((item) => restoreAuthorityFields(
    item,
    currentById.get(item.id),
    VAULT_REFERENCE_FIELDS,
  ))
}

function restoreCommunicationAuthority(incomingItems = [], currentItems = []) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]))
  return incomingItems.map((item) => {
    const current = currentById.get(item.id)
    if (!current) {
      return {
        ...restoreAuthorityFields(item, null, COMMUNICATION_SERVER_AUTHORITY_FIELDS),
        attachments: [],
      }
    }
    const restored = restoreAuthorityFields(item, current, COMMUNICATION_SERVER_AUTHORITY_FIELDS)
    if (!Object.hasOwn(item, 'mailCategories') && Object.hasOwn(current, 'mailCategories')) {
      restored.mailCategories = current.mailCategories
    }
    return restored
  })
}

/**
 * Offline replay is deliberately narrower than ordinary application editing.
 * It is available only to the signed-in owner of a personal application and
 * never to administrators, temporary impersonation sessions, Team records, or
 * collaborators. A caller that later regains broader online access must use
 * the ordinary live update path and its current permission checks.
 */
export function offlineReplayScopeAllowed({
  application,
  requestUserId,
  requestUserRole,
  requestScope,
  impersonation,
}) {
  return Boolean(
    application
    && requestUserId
    && requestUserRole !== 'admin'
    && requestScope === 'app'
    && application.ownerId === requestUserId
    && !application.teamId
    && !application.teamTransferRequest
    && !impersonation
  )
}

/**
 * Treat every browser queue as untrusted input. The current server copy owns
 * relationship state, public-share capabilities, backup policy and encrypted
 * file handles even when the client's timestamp still matches.
 */
export function applyOfflineReplayAuthorityBoundary(current, incoming) {
  const bounded = restoreAuthorityFields(
    incoming,
    current,
    APPLICATION_SERVER_AUTHORITY_FIELDS,
  )
  return {
    ...bounded,
    id: current.id,
    // Preserve the normalized nullable shape expected by the application
    // schema even when an older record predates these fields.
    teamId: current.teamId ?? null,
    teamTransferRequest: current.teamTransferRequest ?? null,
    materials: restoreMaterialAuthority(incoming.materials, current.materials),
    tasks: restoreMaterialAuthority(incoming.tasks, current.tasks),
    communications: restoreCommunicationAuthority(
      incoming.communications,
      current.communications,
    ),
  }
}
