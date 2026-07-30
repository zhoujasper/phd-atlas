import type { ProfileAsset } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'

/**
 * A server-owned file that the constrained AI attachment tool may propose for
 * the editable outgoing email. The id mirrors the backend tool id.
 */
export type AiAttachmentCandidate = {
  id: string
  fileId: string
  name: string
  mimeType?: string
  fileSize?: number
  source: 'profile' | 'checklist' | 'tasks' | 'correspondence'
  sourceId: string
}

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
  const candidateByFileId = new Map<string, AiAttachmentCandidate>()
  const add = (input: Omit<AiAttachmentCandidate, 'id'>) => {
    const fileId = String(input.fileId ?? '').trim()
    if (!fileId) return
    const existing = candidateByFileId.get(fileId)
    if (existing) {
      if (!existing.mimeType && input.mimeType) existing.mimeType = input.mimeType
      if (!existing.fileSize && input.fileSize) existing.fileSize = input.fileSize
      return
    }
    const candidate = { ...input, fileId, id: aiAttachmentCandidateId(fileId) }
    candidateByFileId.set(fileId, candidate)
    candidates.push(candidate)
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

  for (const task of application.tasks ?? []) {
    if (task.fileId) {
      add({
        fileId: task.fileId,
        name: task.fileName || task.title,
        mimeType: task.mimeType,
        fileSize: task.fileSize,
        source: 'tasks',
        sourceId: task.id,
      })
    }
    for (const version of task.versions ?? []) {
      if (!version.fileId) continue
      add({
        fileId: version.fileId,
        name: version.file || task.fileName || task.title,
        mimeType: version.mimeType ?? task.mimeType,
        fileSize: version.size ?? task.fileSize,
        source: 'tasks',
        sourceId: task.id,
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
