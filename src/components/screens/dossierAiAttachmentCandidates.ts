import type { ProfileAsset } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import type { AiAttachmentCandidate } from '../shared/AiDraftPanel'

function aiAttachmentCandidateId(fileId: string) {
  return `file:${fileId}`
}

/**
 * Builds the durable-file candidates that an AI draft may attach to an outgoing
 * email. Browser-only uploads are deliberately excluded because they do not
 * have a server-side file record for the constrained attachment tool to use.
 */
export function buildDossierAiAttachmentCandidates(
  application: ApplicationRecord,
  profileAssets: ProfileAsset[],
): AiAttachmentCandidate[] {
  const candidates: AiAttachmentCandidate[] = []
  const seenFileIds = new Set<string>()
  const add = (input: Omit<AiAttachmentCandidate, 'id'>) => {
    const fileId = String(input.fileId ?? '').trim()
    if (!fileId || seenFileIds.has(fileId)) return
    seenFileIds.add(fileId)
    candidates.push({ ...input, fileId, id: aiAttachmentCandidateId(fileId) })
  }

  for (const asset of profileAssets) {
    for (const attachment of asset.attachments ?? []) {
      add({
        fileId: attachment.fileId,
        name: attachment.fileName || asset.name,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        source: 'profile',
        sourceId: asset.id,
      })
    }
  }

  for (const material of application.materials ?? []) {
    if (material.fileId) {
      add({
        fileId: material.fileId,
        name: material.fileName || material.name,
        mimeType: material.mimeType,
        fileSize: material.fileSize,
        source: 'checklist',
        sourceId: material.id,
      })
    }
    for (const version of material.versions ?? []) {
      if (!version.fileId) continue
      add({
        fileId: version.fileId,
        name: version.file || material.fileName || material.name,
        mimeType: version.mimeType ?? material.mimeType,
        fileSize: version.size ?? material.fileSize,
        source: 'checklist',
        sourceId: material.id,
      })
    }
  }

  for (const communication of application.communications ?? []) {
    for (const attachment of communication.attachments ?? []) {
      if (!attachment.fileId) continue
      add({
        fileId: attachment.fileId,
        name: attachment.fileName || communication.subject || attachment.fileId,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        source: 'correspondence',
        sourceId: communication.id,
      })
    }
  }

  return candidates
}
