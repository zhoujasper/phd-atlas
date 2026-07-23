import { describe, expect, it } from 'vitest'
import {
  shareAllowsFileDownload,
  shareAllowsReservedUpload,
  profileAssetPayload,
  sharedApplicationPayload,
} from './index.js'

function applicationFixture() {
  return {
    school: { name: 'Example University', country: 'United Kingdom', website: 'https://example.edu' },
    professor: {
      english: 'Professor Example',
      chinese: '',
      email: 'professor@example.edu',
      phone: '',
      social: '',
      homepage: 'https://example.edu/professor',
      research: 'Human-computer interaction',
      lab: '',
    },
    program: 'Computer Science PhD',
    status: 'Preparing',
    deadline: '2026-12-01',
    progress: 0,
    priority: 0,
    tags: [],
    nextReminder: '',
    result: '',
    dossierCards: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    materials: [
      {
        id: 'material-reserved',
        name: 'Reserved proposal',
        type: 'Document',
        status: 'Missing',
        uploadReserved: true,
        allowedFileTypes: ['.pdf'],
        versions: [{ id: 'version-reserved', fileId: 'file-reserved', file: 'proposal.pdf', author: 'Owner', createdAt: '2026-01-01', size: 12 }],
      },
      {
        id: 'material-private',
        name: 'Private CV',
        type: 'Document',
        status: 'Ready',
        uploadReserved: false,
        versions: [{ id: 'version-private', fileId: 'file-private', file: 'cv.pdf', author: 'Owner', createdAt: '2026-01-01', size: 12 }],
      },
    ],
    tasks: [
      { id: 'task-reserved', title: 'Reserved references', due: '2026-11-01', done: false, uploadReserved: true, versions: [] },
      { id: 'task-private', title: 'Private follow-up', due: '2026-11-02', done: false, uploadReserved: false, versions: [] },
    ],
    communications: [],
    scholarships: [],
    fees: [],
    timeline: [],
    versions: [],
  }
}

describe('upload-only application shares', () => {
  const uploadShare = { permission: 'upload', sections: ['materials', 'tasks'] }

  it('exposes only requested attachments and preserves the allowed-type reservation', () => {
    const payload = sharedApplicationPayload(applicationFixture(), uploadShare)

    expect(payload.materials).toMatchObject([
      { id: 'material-reserved', uploadReserved: true, allowedFileTypes: ['.pdf'] },
    ])
    expect(payload.tasks).toMatchObject([
      { id: 'task-reserved', uploadReserved: true },
    ])
    expect(payload.materials.map((item) => item.id)).not.toContain('material-private')
    expect(payload.tasks.map((item) => item.id)).not.toContain('task-private')
  })

  it('rejects unreserved upload targets and private file downloads for upload-only links', () => {
    const application = applicationFixture()

    expect(shareAllowsReservedUpload(uploadShare, application.materials[0])).toBe(true)
    expect(shareAllowsReservedUpload(uploadShare, application.materials[1])).toBe(false)
    expect(shareAllowsFileDownload(application, uploadShare, 'file-reserved')).toBe(true)
    expect(shareAllowsFileDownload(application, uploadShare, 'file-private')).toBe(false)
  })

  it('keeps full checklist access for view and edit links', () => {
    const application = applicationFixture()

    expect(sharedApplicationPayload(application, { permission: 'view', sections: ['materials', 'tasks'] }).materials).toHaveLength(2)
    expect(sharedApplicationPayload(application, { permission: 'edit', sections: ['materials', 'tasks'] }).tasks).toHaveLength(2)
    expect(shareAllowsReservedUpload({ permission: 'edit' }, application.materials[1])).toBe(true)
  })
})

describe('profile asset share payloads', () => {
  it('rebuilds the public upload URL after a saved asset is loaded again', () => {
    const payload = profileAssetPayload({
      id: 'asset-cv',
      shares: [{ id: 'share-cv', token: 'persisted-token', createdAt: '2026-07-22T00:00:00.000Z', expiresAt: null }],
    })

    expect(payload.shares).toEqual([
      expect.objectContaining({ url: '/asset-upload/persisted-token' }),
    ])
  })
})
