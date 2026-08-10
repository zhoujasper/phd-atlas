import { describe, expect, it } from 'vitest'
import {
  applicationListPayload,
  APPLICATION_LIST_SLIM_MARKER,
} from './applicationListPayload.js'

function largeApplication() {
  return {
    id: 'app-1',
    ownerId: 'user-1',
    professor: { english: 'Professor Example', email: 'prof@example.edu' },
    school: { name: 'Example University', country: 'United Kingdom' },
    program: 'PhD in Example Studies',
    deadline: '2027-01-15',
    status: 'preparing',
    materials: [{
      id: 'material-1',
      name: 'Research statement',
      type: 'statement',
      status: 'draft',
      details: 'x'.repeat(64 * 1024),
      version: 'v1',
      updatedAt: '2026-08-03T00:00:00.000Z',
      versions: [{ id: 'file-1', file: 'draft.docx', author: 'user-1', createdAt: '2026-08-01' }],
    }],
    communications: [{
      id: 'mail-1',
      subject: 'PhD enquiry',
      channel: 'email',
      date: '2026-08-02',
      summary: 'A short summary',
      bodyHtml: 'x'.repeat(128 * 1024),
      bodyText: 'x'.repeat(128 * 1024),
      attachments: [{ id: 'attachment-1', fileName: 'cv.pdf', fileSize: 1_000_000 }],
    }],
    scholarships: [{
      id: 'scholarship-1',
      name: 'Full scholarship',
      amount: 'GBP 20,000',
      startDate: '2027-09-01',
      endDate: '2031-09-01',
      notes: 'x'.repeat(32 * 1024),
    }],
    tasks: [{
      id: 'task-1',
      title: 'Submit transcripts',
      due: '2026-12-01',
      done: false,
      details: 'x'.repeat(16 * 1024),
      versions: [{ id: 'task-file-1', file: 'transcript.pdf', author: 'user-1', createdAt: '2026-08-01' }],
    }],
    timeline: [],
    versions: [{ id: 'version-1', file: 'draft.docx', author: 'user-1', createdAt: '2026-08-01' }],
    reviewComments: [{ id: 'comment-1', authorId: 'user-1', body: 'x'.repeat(8 * 1024), createdAt: '2026-08-01' }],
  }
}

describe('application list payload', () => {
  it('removes large correspondence and nested file bodies while retaining list metadata', () => {
    const slim = applicationListPayload(largeApplication())

    expect(slim[APPLICATION_LIST_SLIM_MARKER]).toBe(true)
    expect(slim.communications[0].summary).toBe('A short summary')
    expect(slim.communications[0]).not.toHaveProperty('bodyHtml')
    expect(slim.communications[0]).not.toHaveProperty('bodyText')
    expect(slim.communications[0]).not.toHaveProperty('attachments')
    expect(slim.materials[0].details).toBeUndefined()
    expect(slim.materials[0].versions).toEqual([])
    expect(slim.tasks[0].details).toBeUndefined()
    expect(slim.tasks[0].versions).toEqual([])
    expect(slim.scholarships[0].notes).toBeUndefined()
    expect(slim.versions).toEqual([])
    expect(slim.reviewComments).toEqual([])
  })

  it('shrinks a realistic application response by at least 40 percent', () => {
    const full = largeApplication()
    const slim = applicationListPayload(full)
    const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8')
    const slimBytes = Buffer.byteLength(JSON.stringify(slim), 'utf8')

    expect(slimBytes).toBeLessThanOrEqual(Math.floor(fullBytes * 0.6))
  })
})
