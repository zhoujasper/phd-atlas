import { describe, expect, it } from 'vitest'
import type { ScholarshipItem } from './dossierScholarshipDraft'
import {
  cleanScholarshipDraft,
  createScholarshipDraft,
  scholarshipToDraft,
} from './dossierScholarshipDraft'

describe('dossier scholarship drafts', () => {
  it('creates a complete default form without leaking UI-only state', () => {
    expect(createScholarshipDraft('Example University')).toMatchObject({
      name: '',
      school: 'Example University',
      status: 'Preparing',
      materials: [],
      tasks: [],
      timeline: [],
    })
  })

  it('round-trips persisted scholarship data while trimming and omitting blank nested records', () => {
    const scholarship: ScholarshipItem = {
      id: 'scholarship-1',
      name: '  Research Fellowship  ',
      amount: '  £20,000 ',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      school: '  ',
      issuer: '  Council ',
      status: 'Submitted',
      notes: '  Awaiting decision. ',
      materials: [
        { id: 'material-1', name: '  Proposal ', status: 'Draft', due: '2026-07-30', details: '  Final review ' },
        { id: 'material-empty', name: '  ', status: 'Draft', due: '', details: '' },
      ],
      tasks: [
        { id: 'task-1', title: '  Submit form ', due: '', done: false, details: '  Before noon ' },
        { id: 'task-empty', title: '', due: '', done: false, details: '' },
      ],
      timeline: [
        { id: 'event-1', title: '  Deadline ', date: '', note: '  Portal closes ' },
        { id: 'event-empty', title: ' ', date: '', note: '' },
      ],
    }

    const draft = scholarshipToDraft(scholarship, 'Fallback University')

    // The existing form treats any non-empty string, including whitespace, as
    // supplied input and performs trimming only at the persistence boundary.
    expect(draft.school).toBe('  ')
    expect(draft.tasks[0].due).toBe('2027-08-31')
    expect(draft.timeline[0].date).toBe('2027-08-31')
    expect(cleanScholarshipDraft(draft)).toEqual({
      name: 'Research Fellowship',
      amount: '£20,000',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      school: '',
      issuer: 'Council',
      status: 'Submitted',
      notes: 'Awaiting decision.',
      materials: [{ id: 'material-1', name: 'Proposal', status: 'Draft', due: '2026-07-30', details: 'Final review' }],
      tasks: [{ id: 'task-1', title: 'Submit form', due: '2027-08-31', done: false, details: 'Before noon' }],
      timeline: [{ id: 'event-1', title: 'Deadline', date: '2027-08-31', note: 'Portal closes' }],
    })
  })
})
