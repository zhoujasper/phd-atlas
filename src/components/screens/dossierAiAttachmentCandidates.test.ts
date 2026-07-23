import { describe, expect, it } from 'vitest'
import type { ProfileAsset } from '../../api/phdApi'
import { applications } from '../../data/applications'
import { buildDossierAiAttachmentCandidates } from './dossierAiAttachmentCandidates'

describe('buildDossierAiAttachmentCandidates', () => {
  it('keeps durable files in source order and deduplicates by file id', () => {
    const application = structuredClone(applications[0])
    application.materials = [{
      id: 'material-1',
      name: 'Research proposal',
      type: 'Research Proposal',
      status: 'Draft',
      version: 'v1',
      updatedAt: '2026-07-22T00:00:00.000Z',
      fileId: 'checklist-current',
      fileName: 'proposal.pdf',
      mimeType: 'application/pdf',
      fileSize: 200,
      versions: [
        { id: 'version-1', file: 'proposal-old.pdf', author: 'Jasper', createdAt: '2026-07-21T00:00:00.000Z', fileId: 'shared-file', size: 100, mimeType: 'application/pdf' },
      ],
    }]
    application.communications = [{
      id: 'message-1',
      subject: 'Professor reply',
      channel: 'Email',
      date: '2026-07-22',
      summary: '',
      attachments: [
        { id: 'message-attachment', fileName: 'reply.pdf', fileId: 'message-file', fileSize: 300, mimeType: 'application/pdf' },
        { id: 'duplicate-message-attachment', fileName: 'duplicate.pdf', fileId: 'shared-file' },
      ],
    }]
    const profileAssets: ProfileAsset[] = [{
      id: 'asset-1',
      name: 'Academic CV',
      kind: 'CV',
      description: '',
      attachments: [
        { id: 'asset-attachment', fileId: 'profile-file', fileName: 'cv.pdf', fileSize: 400, mimeType: 'application/pdf' },
        { id: 'shared-attachment', fileId: 'shared-file', fileName: 'shared.pdf' },
      ],
    }]

    expect(buildDossierAiAttachmentCandidates(application, profileAssets)).toEqual([
      { id: 'file:profile-file', fileId: 'profile-file', name: 'cv.pdf', mimeType: 'application/pdf', fileSize: 400, source: 'profile', sourceId: 'asset-1' },
      { id: 'file:shared-file', fileId: 'shared-file', name: 'shared.pdf', mimeType: undefined, fileSize: undefined, source: 'profile', sourceId: 'asset-1' },
      { id: 'file:checklist-current', fileId: 'checklist-current', name: 'proposal.pdf', mimeType: 'application/pdf', fileSize: 200, source: 'checklist', sourceId: 'material-1' },
      { id: 'file:message-file', fileId: 'message-file', name: 'reply.pdf', mimeType: 'application/pdf', fileSize: 300, source: 'correspondence', sourceId: 'message-1' },
    ])
  })
})
