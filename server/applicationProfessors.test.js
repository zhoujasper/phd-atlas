import { describe, expect, it } from 'vitest'
import { applicationProfessors, emptyProfessor, findApplicationProfessor, professorCollectionIssues } from './shared/applicationProfessors.js'
import { applyFetchedMailMessages, applicationProfessorAddresses, trackedProfessorAddressUpdate, mailWhitelistDigest } from './mailSync.js'
import { mailClassificationThreadContext } from './mailClassificationContext.js'
import { copyApplicationSetup } from './applicationDuplicate.js'
import { ApplicationSchema, CreateApplicationSchema } from './validation.js'

const profile = (id, email) => ({ ...emptyProfessor(), id, english: `Professor ${id}`, email, research: `Research ${id}` })
const fixture = () => ({
  id: 'app-one', ownerId: 'owner', school: { name: 'University' }, professor: profile('first', 'first@example.edu'),
  additionalProfessors: [{ ...profile('second', 'second@example.edu'), correspondenceEmails: ['second@lab.example.edu'] }],
  communications: [], timeline: [], tags: [], priority: 50,
})
const owner = { id: 'owner', email: 'student@example.com', settings: {} }
const mail = (key, from) => ({
  key, messageId: `<${key}@example.edu>`, fromAddresses: [from], toAddresses: ['student@example.com'],
  ccAddresses: [], bccAddresses: [], subject: 'Research fit', text: 'Thanks for your email.',
  date: new Date('2026-09-07T09:00:00Z'), attachments: [], mailboxPath: 'INBOX', folderRole: 'mail',
})

describe('multiple intended supervisors', () => {
  it('retains legacy contact identity and separates recommendation-letter contacts', () => {
    const app = fixture()
    delete app.professor.id
    app.recommenders = [{ name: 'Reference', email: 'reference@example.edu' }]
    expect(applicationProfessors(app)[0].id).toBe('primary')
    expect(applicationProfessorAddresses(app)).toEqual(['first@example.edu', 'second@example.edu', 'second@lab.example.edu'])
    expect(findApplicationProfessor(app, 'Professor Two <SECOND@LAB.EXAMPLE.EDU>').id).toBe('second')
    expect(findApplicationProfessor(app, 'reference@example.edu')).toBeNull()
  })

  it('files both supervisors and aliases once, with the correct sender notification', () => {
    const app = fixture()
    const store = { applications: [app] }
    const messages = [mail('a', app.professor.email), mail('b', 'second@lab.example.edu')]
    const result = applyFetchedMailMessages(store, owner, messages)
    expect(result.filed).toBe(2)
    expect(app.communications).toHaveLength(2)
    expect(result.notifications.find((item) => item.metadata.senderEmail === 'second@lab.example.edu').title).toContain('Professor second')
    expect(applyFetchedMailMessages(store, owner, messages).filed).toBe(0)
    const before = mailWhitelistDigest(applicationProfessorAddresses(app))
    app.additionalProfessors = []
    expect(mailWhitelistDigest(applicationProfessorAddresses(app))).not.toBe(before)
    expect(applyFetchedMailMessages(store, owner, [mail('c', 'second@example.edu')]).filed).toBe(0)
    expect(app.communications).toHaveLength(2)
  })

  it('does not truncate the total to the old single-supervisor ten-address limit', () => {
    const app = fixture()
    app.additionalProfessors = Array.from({ length: 15 }, (_, index) => profile(`p-${index}`, `p${index}@example.edu`))
    expect(applicationProfessorAddresses(app)).toHaveLength(16)
    expect(trackedProfessorAddressUpdate(app, 'p14@example.edu')).toMatchObject({ status: 'already-tracked', correspondenceEmails: [] })
    expect(trackedProfessorAddressUpdate(app, 'extra@example.edu').correspondenceEmails).toEqual(['extra@example.edu'])
  })

  it('rejects duplicate identities and addresses across the create and update boundaries', () => {
    const app = fixture()
    app.additionalProfessors[0].id = 'first'
    expect(professorCollectionIssues(app)[0].path).toEqual(['additionalProfessors', 0, 'id'])
    const input = { professor: '', professorEmail: 'same@example.edu', university: 'University', program: 'PhD', deadline: '',
      additionalProfessors: [profile('second', 'SAME@example.edu')] }
    expect(CreateApplicationSchema.safeParse(input).success).toBe(false)
    expect(CreateApplicationSchema.safeParse({ ...input, professorEmail: '', additionalProfessors: [] }).success).toBe(true)
  })

  it('keeps same-subject conversations with different professors apart', () => {
    const incoming = { id: 'a', channel: 'Email', direction: 'incoming', from: 'first@example.edu', to: owner.email, subject: 'Re: PhD enquiry', summary: 'First reply' }
    const same = { id: 'b', channel: 'Email', direction: 'outgoing', from: owner.email, to: 'first@example.edu', subject: 'PhD enquiry', summary: 'Same professor' }
    const other = { ...same, id: 'c', to: 'second@example.edu', summary: 'Other professor private context' }
    const result = mailClassificationThreadContext({ communications: [incoming, same, other] }, incoming)
    expect(result.map((item) => item.bodyText)).toEqual(['Same professor'])
  })

  it('preserves long historical research when a default contact moves or is duplicated', () => {
    const contact = { ...profile('long-notes', 'long@example.edu'), research: 'Existing notes. '.repeat(80_000) }
    expect(ApplicationSchema.shape.additionalProfessors.parse([contact])[0].research).toBe(contact.research)
    const created = CreateApplicationSchema.parse({ professor: contact.english, professorEmail: contact.email,
      professorProfile: contact, additionalProfessors: [], duplicateFromId: 'source',
      university: 'University', program: 'PhD', deadline: '' })
    expect(created.professorProfile.research).toBe(contact.research)
  })
})

describe('application duplication', () => {
  it('copies requirements independently and never reuses files, messages or scheduled delivery', () => {
    const source = { ...fixture(), status: 'Submitted', progress: 100, shares: [{ id: 'secret-share' }],
      communications: [{ id: 'send', deliveryStatus: 'queued', scheduledAt: '2027-01-01T00:00:00Z' }],
      materials: [{ id: 'm', name: 'Statement', type: 'SOP', details: 'Two pages', status: 'Done', fileId: 'private-file', storageName: 'vault-handle', versions: [{ id: 'v' }] }],
      tasks: [{ id: 't', title: 'Submit', done: true, status: 'Done', fileId: 'file', reminderEnabled: true }],
      recommenders: [{ id: 'r', name: 'Reference', contact: 'ref@example.edu', reminderDate: '2026-10-01' }],
    }
    const baseline = structuredClone(source)
    const target = { ...fixture(), id: 'new-app', materials: [], tasks: [], recommenders: [], communications: [], shares: [], versions: [] }
    let sequence = 0
    const copy = copyApplicationSetup(source, target, (kind) => `${kind}-${++sequence}`, '2026-09-07')
    expect(copy).toMatchObject({ id: 'new-app', status: 'Draft', progress: 0, result: '', communications: [], shares: [], versions: [] })
    expect(copy.materials[0]).toMatchObject({ name: 'Statement', details: 'Two pages', status: 'Draft', versions: [] })
    expect(copy.materials[0].fileId).toBeUndefined()
    expect(copy.materials[0].storageName).toBeUndefined()
    expect(copy.materials[0].id).not.toBe('m')
    expect(copy.tasks[0]).toMatchObject({ done: false, reminderEnabled: false })
    expect(copy.recommenders[0].reminderDate).toBe('')
    copy.professor.research = 'New research'
    expect(source).toEqual(baseline)
  })
})
