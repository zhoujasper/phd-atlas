function restoreMaterialAuthority(incomingItems = [], currentItems = []) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]))
  return incomingItems.map((item) => {
    const current = currentById.get(item.id)
    if (!current) {
      const {
        fileId: _fileId,
        storageName: _storageName,
        fileName: _fileName,
        fileSize: _fileSize,
        mimeType: _mimeType,
        versions: _versions,
        ...safe
      } = item
      return safe
    }
    return {
      ...item,
      fileId: current.fileId,
      storageName: current.storageName,
      fileName: current.fileName,
      fileSize: current.fileSize,
      mimeType: current.mimeType,
      versions: current.versions,
    }
  })
}

function restoreCommunicationAuthority(incomingItems = [], currentItems = []) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]))
  return incomingItems.map((item) => {
    const current = currentById.get(item.id)
    if (!current) return { ...item, attachments: [] }
    return {
      ...item,
      attachments: current.attachments,
      sourceMessageKey: current.sourceMessageKey,
      sourceMailbox: current.sourceMailbox,
      importedAt: current.importedAt,
    }
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
  return {
    ...incoming,
    id: current.id,
    ownerId: current.ownerId,
    teamId: current.teamId ?? null,
    teamTransferRequest: current.teamTransferRequest ?? null,
    shares: current.shares,
    reviewComments: current.reviewComments,
    backupSettings: current.backupSettings,
    versions: current.versions,
    createdAt: current.createdAt,
    materials: restoreMaterialAuthority(incoming.materials, current.materials),
    tasks: restoreMaterialAuthority(incoming.tasks, current.tasks),
    communications: restoreCommunicationAuthority(
      incoming.communications,
      current.communications,
    ),
  }
}
