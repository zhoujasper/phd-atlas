import { describe, expect, it } from 'vitest'
import {
  applyFetchedMailMessages,
  applicationProfessorAddresses,
  communicationIdForMail,
  mailWhitelistDigest,
  ownerMailboxAddresses,
  preserveApplicationCommunicationAuthority,
  preserveCommunicationAuthority,
  trackedProfessorAddresses,
  trackedProfessorAddressUpdate,
} from './mailSync.js'
import { createCommunicationMailClassificationFingerprint } from './mailClassificationContext.js'

function application(id, professorEmail, overrides = {}) {
  return {
    id,
    ownerId: 'user_1',
    professor: { english: 'Professor Lee', email: professorEmail },
    school: { name: 'Example University' },
    communications: [],
    timeline: [],
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function user(overrides = {}) {
  return {
    id: 'user_1',
    email: 'student@example.com',
    settings: {
      language: 'en',
      incomingUser: 'student@example.com',
      sendFrom: 'student@example.com',
      ...overrides,
    },
  }
}

function message(overrides = {}) {
  return {
    key: 'mail-key-1',
    messageId: '<mail-key-1@example.com>',
    fromAddresses: ['professor@example.edu'],
    toAddresses: ['student@example.com'],
    ccAddresses: [],
    bccAddresses: [],
    subject: 'Research fit',
    date: new Date('2026-07-09T09:15:00.000Z'),
    text: 'Thanks for reaching out.',
    attachments: [],
    mailboxPath: 'INBOX',
    folderRole: 'mail',
    ...overrides,
  }
}

describe('mail sync application matching', () => {
  it('keeps imported-mail provenance and threat status server-authoritative across edits', () => {
    const existing = {
      id: 'comm-imported',
      subject: 'Flagged mail',
      channel: 'Email',
      direction: 'incoming',
      from: 'professor@example.edu',
      to: 'student@example.com',
      messageType: 'fetched-email',
      bodyFormat: 'markdown',
      bodyHtml: '<p><strong>Server</strong> snapshot</p>',
      bodyText: 'Server snapshot',
      sourceMessageKey: 'mail-key',
      sourceMailbox: 'INBOX',
      importedAt: '2026-07-29T08:39:00.000Z',
      deliveryStatus: 'queued',
      scheduledAt: '2026-07-29T12:00:00.000Z',
      deliveryId: 'delivery-server-owned',
      deliveryUserId: 'user-server-owned',
      attachments: [],
      mailSecurity: {
        level: 'danger',
        signals: ['deceptive-link'],
        linksDisabled: true,
        quarantinedAttachmentCount: 1,
      },
    }
    const edited = preserveCommunicationAuthority(existing, {
      ...existing,
      subject: 'Edited locally',
      messageType: 'note',
      direction: 'outgoing',
      from: 'attacker@example.com',
      attachments: [{ fileName: 'restored.exe' }],
      mailSecurity: undefined,
      deliveryStatus: 'sent',
      scheduledAt: undefined,
      deliveryId: 'forged-delivery',
      bodyFormat: 'html',
      bodyHtml: '<script>forged</script>',
      bodyText: 'Forged snapshot',
    })

    expect(edited).toMatchObject({
      subject: 'Edited locally',
      channel: 'Email',
      direction: 'incoming',
      from: 'professor@example.edu',
      to: 'student@example.com',
      messageType: 'fetched-email',
      sourceMessageKey: 'mail-key',
      sourceMailbox: 'INBOX',
      importedAt: '2026-07-29T08:39:00.000Z',
      deliveryStatus: 'queued',
      scheduledAt: '2026-07-29T12:00:00.000Z',
      deliveryId: 'delivery-server-owned',
      deliveryUserId: 'user-server-owned',
      bodyFormat: 'markdown',
      bodyHtml: '<p><strong>Server</strong> snapshot</p>',
      bodyText: 'Server snapshot',
      attachments: [],
      mailSecurity: existing.mailSecurity,
    })

    const applicationEdit = preserveApplicationCommunicationAuthority(
      { communications: [existing] },
      {
        communications: [
          edited,
          {
            id: 'client-created',
            subject: 'Client record',
            messageType: 'fetched-email',
            sourceMessageKey: 'spoofed-key',
            deliveryStatus: 'queued',
            deliveryId: 'spoofed-delivery',
            bodyFormat: 'html',
            bodyHtml: '<h1>Spoofed</h1>',
            bodyText: 'Spoofed',
            importedAt: '2026-07-29T08:39:00.000Z',
            mailSecurity: existing.mailSecurity,
          },
        ],
      },
    )
    expect(applicationEdit.communications[1]).not.toHaveProperty('sourceMessageKey')
    expect(applicationEdit.communications[1]).not.toHaveProperty('deliveryStatus')
    expect(applicationEdit.communications[1]).not.toHaveProperty('deliveryId')
    expect(applicationEdit.communications[1]).not.toHaveProperty('importedAt')
    expect(applicationEdit.communications[1]).not.toHaveProperty('mailSecurity')
    expect(applicationEdit.communications[1]).not.toHaveProperty('bodyFormat')
    expect(applicationEdit.communications[1]).not.toHaveProperty('bodyHtml')
    expect(applicationEdit.communications[1]).not.toHaveProperty('bodyText')
    expect(applicationEdit.communications[1].messageType).toBe('note')
  })

  it('keeps communications added after a personal full-update baseline without blocking intentional removal', () => {
    const knownDraft = {
      id: 'comm-known-draft',
      subject: '[DRAFT] Known draft',
      messageType: 'draft-email',
    }
    const importedAfterBaseline = {
      id: 'comm-imported-after-baseline',
      subject: 'New professor reply',
      channel: 'Email',
      direction: 'incoming',
      messageType: 'fetched-email',
      sourceMessageKey: 'mail-new-after-baseline',
      importedAt: '2026-08-02T09:00:00.000Z',
    }
    const existingApplication = {
      communications: [importedAfterBaseline, knownDraft],
    }
    const clientBaseApplication = {
      communications: [knownDraft],
    }

    const staleEdit = preserveApplicationCommunicationAuthority(
      existingApplication,
      { communications: [{ ...knownDraft, subject: '[DRAFT] Edited locally' }] },
      clientBaseApplication,
    )

    expect(staleEdit.communications.map((communication) => communication.id)).toEqual([
      importedAfterBaseline.id,
      knownDraft.id,
    ])
    expect(staleEdit.communications[1].subject).toBe('[DRAFT] Edited locally')

    const intentionalRemoval = preserveApplicationCommunicationAuthority(
      existingApplication,
      { communications: [importedAfterBaseline] },
      { communications: [importedAfterBaseline, knownDraft] },
    )
    expect(intentionalRemoval.communications.map((communication) => communication.id)).toEqual([
      importedAfterBaseline.id,
    ])

    const legacyStaleEdit = preserveApplicationCommunicationAuthority(
      existingApplication,
      { communications: [knownDraft] },
    )
    expect(legacyStaleEdit.communications.map((communication) => communication.id)).toEqual([
      importedAfterBaseline.id,
      knownDraft.id,
    ])
  })

  it('preserves a current thread-aware AI result and invalidates real content or thread changes', () => {
    const prior = {
      id: 'mail-thread-prior',
      subject: 'Research fit',
      channel: 'Email',
      date: '2026-07-08',
      summary: 'The lab expects to recruit one student.',
      direction: 'outgoing',
      messageType: 'outgoing-email',
      from: 'student@example.com',
      to: 'professor@example.edu',
    }
    const target = {
      id: 'mail-thread-target',
      subject: 'Re: Research fit',
      channel: 'Email',
      date: '2026-07-09',
      summary: 'Please choose an interview time.',
      direction: 'incoming',
      messageType: 'incoming-email',
      from: 'professor@example.edu',
      to: 'student@example.com',
      mailCategoryOverride: 'funding',
    }
    const existing = application('app-thread', 'professor@example.edu', {
      communications: [target, prior],
    })
    target.mailClassification = {
      category: 'interview_invite',
      confidence: 0.94,
      summary: 'The professor invited the applicant to interview.',
      evidence: ['Choose an interview time.'],
      actions: ['schedule_interview'],
      source: 'ai',
      classifiedAt: '2026-07-09T10:00:00.000Z',
      inputHash: createCommunicationMailClassificationFingerprint(existing, target),
      version: 1,
    }

    const unchanged = preserveApplicationCommunicationAuthority(
      existing,
      { ...structuredClone(existing), notes: 'Ordinary resident save.' },
      structuredClone(existing),
    )
    expect(unchanged.communications.find((item) => item.id === target.id)?.mailClassification)
      .toEqual(target.mailClassification)
    expect(unchanged.communications.find((item) => item.id === target.id)?.mailCategoryOverride)
      .toBe('funding')

    // Since correspondence categories became a manual, multi-valued choice,
    // this field has a legitimate author. Reverting a submitted value here made
    // every save that carried a manual selection fail its persistence
    // acknowledgement, which the person saw as a refused save with no way out.
    const manualOverride = structuredClone(existing)
    manualOverride.communications.find((item) => item.id === target.id).mailCategoryOverride = 'rejection'
    const overrideKept = preserveApplicationCommunicationAuthority(existing, manualOverride, existing)
    expect(overrideKept.communications.find((item) => item.id === target.id)?.mailCategoryOverride)
      .toBe('rejection')
    // The classifier's own result is still the server's, and survives the same save.
    expect(overrideKept.communications.find((item) => item.id === target.id)?.mailClassification)
      .toEqual(target.mailClassification)

    const changedTarget = structuredClone(existing)
    changedTarget.communications.find((item) => item.id === target.id).summary = 'The interview was cancelled.'
    const targetInvalidated = preserveApplicationCommunicationAuthority(existing, changedTarget, existing)
    expect(targetInvalidated.communications.find((item) => item.id === target.id))
      .not.toHaveProperty('mailClassification')

    const changedThread = structuredClone(existing)
    changedThread.communications.find((item) => item.id === prior.id).summary = 'The lab has no openings.'
    const threadInvalidated = preserveApplicationCommunicationAuthority(existing, changedThread, existing)
    expect(threadInvalidated.communications.find((item) => item.id === target.id))
      .not.toHaveProperty('mailClassification')
  })

  it('tracks every configured recipient address and files exact alias matches', () => {
    const tracked = application('app_1', 'professor@example.edu', {
      professor: {
        english: 'Professor Lee',
        email: 'professor@example.edu',
        correspondenceEmails: ['lab@example.edu', 'PROFESSOR@example.edu'],
      },
    })
    const store = { applications: [tracked] }

    expect(applicationProfessorAddresses(tracked)).toEqual([
      'professor@example.edu',
      'lab@example.edu',
    ])
    expect(trackedProfessorAddresses(store.applications, 'user_1')).toEqual([
      'lab@example.edu',
      'professor@example.edu',
    ])

    const result = applyFetchedMailMessages(store, user(), [message({
      key: 'mail-alias',
      messageId: '<mail-alias@example.com>',
      fromAddresses: ['lab@example.edu'],
    })], { now: '2026-07-10T10:00:00.000Z' })

    expect(result).toMatchObject({ filed: 1, incoming: 1 })
    expect(tracked.communications[0]).toMatchObject({
      sourceMessageKey: 'mail-alias',
      from: 'lab@example.edu',
    })
  })

  it('adds a normalized recipient once and fails closed at the application limit', () => {
    const tracked = application('app_1', 'professor@example.edu')
    expect(trackedProfessorAddressUpdate(tracked, 'Lab@Example.edu')).toEqual({
      status: 'added',
      address: 'lab@example.edu',
      correspondenceEmails: ['lab@example.edu'],
    })

    const full = application('app_2', 'primary@example.edu', {
      professor: {
        english: 'Professor Lee',
        email: 'primary@example.edu',
        correspondenceEmails: Array.from({ length: 9 }, (_, index) => `alias-${index}@example.edu`),
      },
    })
    expect(trackedProfessorAddressUpdate(full, 'overflow@example.edu')).toMatchObject({
      status: 'limit',
      address: 'overflow@example.edu',
    })
  })

  it('imports only messages from professor emails currently recorded in the application list', () => {
    const tracked = application('app_1', 'professor@example.edu')
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [
      message(),
      message({
        key: 'mail-unrelated',
        messageId: '<mail-unrelated@example.com>',
        fromAddresses: ['newsletter@example.com'],
        subject: 'Unrelated account mail',
      }),
    ], { now: '2026-07-10T10:00:00.000Z' })

    expect(result).toMatchObject({ filed: 1, incoming: 1, outgoing: 0 })
    expect(tracked.communications).toHaveLength(1)
    expect(tracked.communications[0]).toMatchObject({
      id: communicationIdForMail('app_1', 'mail-key-1'),
      subject: 'Research fit',
      direction: 'incoming',
      sourceMessageKey: 'mail-key-1',
    })
    expect(tracked.communications.some((item) => item.subject === 'Unrelated account mail')).toBe(false)
    expect(result.notifications).toHaveLength(1)
  })

  it('imports mail sent from the owner mailbox outside PhD Atlas and ignores third-party mail to a professor', () => {
    const tracked = application('app_1', 'professor@example.edu')
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [
      message({
        key: 'mail-outgoing',
        fromAddresses: ['student@example.com'],
        toAddresses: ['professor@example.edu'],
        subject: 'Proposal sent externally',
        text: 'Please find the proposal attached.',
        mailboxPath: 'Sent',
        folderRole: 'sent',
      }),
      message({
        key: 'mail-third-party',
        fromAddresses: ['colleague@example.com'],
        toAddresses: ['professor@example.edu', 'student@example.com'],
        subject: 'Group thread',
      }),
    ], { now: '2026-07-10T10:00:00.000Z' })

    expect(result).toMatchObject({ filed: 1, incoming: 0, outgoing: 1 })
    expect(tracked.communications).toHaveLength(1)
    expect(tracked.communications[0]).toMatchObject({
      subject: 'Proposal sent externally',
      direction: 'outgoing',
    })
    expect(result.notifications[0].title).toContain('Sent email to')
  })

  it('does not import the same message twice across folders or repeated sync runs', () => {
    const tracked = application('app_1', 'professor@example.edu')
    const store = { applications: [tracked] }
    const duplicateCopy = message({ mailboxPath: 'Archive', uid: 88 })

    const first = applyFetchedMailMessages(store, user(), [message(), duplicateCopy], {
      now: '2026-07-10T10:00:00.000Z',
    })
    const second = applyFetchedMailMessages(store, user(), [message()], {
      now: '2026-07-10T11:00:00.000Z',
    })

    expect(first.filed).toBe(1)
    expect(second.filed).toBe(0)
    expect(tracked.communications).toHaveLength(1)
    expect(tracked.timeline).toHaveLength(1)
  })

  it('enriches an existing imported email with retained attachment references on a later history sync', () => {
    const existing = {
      id: communicationIdForMail('app_1', 'mail-key-1'),
      subject: 'Research fit',
      channel: 'Email',
      date: '2026-07-09',
      summary: 'Thanks for reaching out.',
      direction: 'incoming',
      messageType: 'fetched-email',
      from: 'professor@example.edu',
      to: 'student@example.com',
      time: '09:15',
      sourceMessageKey: 'mail-key-1',
      attachments: [{ id: 'mail-legacy-1', fileName: 'CV.pdf', fileSize: 12, mimeType: 'application/pdf', source: 'mail' }],
    }
    const tracked = application('app_1', 'professor@example.edu', { communications: [existing] })
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [message({
      attachments: [{
        id: 'mail-current-1',
        fileId: 'file_mail_cv',
        fileName: 'CV.pdf',
        fileSize: 12,
        mimeType: 'application/pdf',
        storageName: 'mail-cv.pdf',
        source: 'mail',
      }],
    })], { now: '2026-07-10T11:00:00.000Z' })

    expect(result).toMatchObject({ filed: 0, changed: true })
    expect(tracked.communications).toHaveLength(1)
    expect(tracked.communications[0].attachments).toEqual([expect.objectContaining({
      fileId: 'file_mail_cv',
      storageName: 'mail-cv.pdf',
    })])
  })

  it('persists dangerous-mail status, quarantines legacy attachments, and raises a warning notification', () => {
    const existing = {
      id: communicationIdForMail('app_1', 'mail-key-1'),
      subject: 'Research fit',
      channel: 'Email',
      date: '2026-07-09',
      summary: 'Thanks for reaching out.',
      direction: 'incoming',
      messageType: 'fetched-email',
      from: 'professor@example.edu',
      to: 'student@example.com',
      time: '09:15',
      sourceMessageKey: 'mail-key-1',
      importedAt: '2026-07-09T09:16:00.000Z',
      attachments: [{ id: 'mail-old-1', fileName: 'invoice.pdf', source: 'mail' }],
    }
    const tracked = application('app_1', 'professor@example.edu', { communications: [existing] })
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [message({
      mailSecurity: {
        level: 'danger',
        signals: ['authentication-failed', 'deceptive-link'],
        linksDisabled: true,
        quarantinedAttachmentCount: 1,
      },
    })], { now: '2026-07-10T11:00:00.000Z' })

    expect(result).toMatchObject({ filed: 0, changed: true })
    expect(existing.attachments).toEqual([])
    expect(existing.mailSecurity).toMatchObject({
      level: 'danger',
      linksDisabled: true,
      quarantinedAttachmentCount: 1,
    })
    expect(result.notifications[0]).toMatchObject({
      type: 'dangerous_email_imported',
      metadata: expect.objectContaining({
        mailSecurityLevel: 'danger',
        quarantinedAttachmentCount: 1,
      }),
    })
  })

  it('files one professor message into each matching application without duplicating either application', () => {
    const firstApp = application('app_1', 'professor@example.edu')
    const secondApp = application('app_2', 'PROFESSOR@example.edu')
    const store = { applications: [firstApp, secondApp] }

    const first = applyFetchedMailMessages(store, user(), [message()], { now: '2026-07-10T10:00:00.000Z' })
    const second = applyFetchedMailMessages(store, user(), [message()], { now: '2026-07-10T11:00:00.000Z' })

    expect(first.filed).toBe(2)
    expect(second.filed).toBe(0)
    expect(firstApp.communications).toHaveLength(1)
    expect(secondApp.communications).toHaveLength(1)
  })

  it('keeps previously imported correspondence when the professor email is later changed', () => {
    const previousCommunication = {
      id: 'comm_existing',
      subject: 'Earlier reply',
      channel: 'Email',
      date: '2026-07-01',
      summary: 'Earlier content',
      direction: 'incoming',
      messageType: 'fetched-email',
      from: 'old-professor@example.edu',
      to: 'student@example.com',
      time: '09:00',
      sourceMessageKey: 'old-key',
      importedAt: '2026-07-01T09:00:00.000Z',
    }
    const tracked = application('app_1', 'new-professor@example.edu', {
      communications: [previousCommunication],
    })
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [message({
      key: 'old-address-new-message',
      fromAddresses: ['old-professor@example.edu'],
    })], { now: '2026-07-10T10:00:00.000Z' })

    expect(result.filed).toBe(0)
    expect(tracked.communications).toEqual([previousCommunication])
  })

  it('does not collapse two distinct same-content messages into one existing manual record', () => {
    const existing = {
      id: 'comm_manual',
      subject: 'Research fit',
      channel: 'Email',
      date: '2026-07-09',
      summary: 'Thanks for reaching out.',
      direction: 'incoming',
      messageType: 'incoming-email',
      from: 'professor@example.edu',
      to: 'student@example.com',
      time: '09:15',
    }
    const tracked = application('app_1', 'professor@example.edu', { communications: [existing] })
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [
      message({ key: 'same-content-1' }),
      message({ key: 'same-content-2', messageId: '<second-copy@example.com>' }),
    ], { now: '2026-07-10T10:00:00.000Z' })

    expect(result.filed).toBe(1)
    expect(tracked.communications).toHaveLength(2)
    expect(existing.sourceMessageKey).toBe('same-content-1')
    expect(tracked.communications.some((item) => item.sourceMessageKey === 'same-content-2')).toBe(true)
  })

  it('recognizes an already logged system-sent message by exact content instead of duplicating it', () => {
    const existing = {
      id: 'comm_sent_in_system',
      subject: 'Research fit',
      channel: 'Email',
      date: '2026-07-09',
      summary: 'Thanks for reaching out.',
      direction: 'outgoing',
      messageType: 'outgoing-email',
      from: 'student@example.com',
      to: 'professor@example.edu',
      time: '09:15',
      deliveryStatus: 'sent',
    }
    const tracked = application('app_1', 'professor@example.edu', { communications: [existing] })
    const store = { applications: [tracked] }

    const result = applyFetchedMailMessages(store, user(), [message({
      key: 'sent-copy-key',
      fromAddresses: ['student@example.com'],
      toAddresses: ['professor@example.edu'],
      folderRole: 'sent',
    })], { now: '2026-07-10T10:00:00.000Z' })

    expect(result.filed).toBe(0)
    expect(tracked.communications).toHaveLength(1)
    expect(existing.sourceMessageKey).toBe('sent-copy-key')
  })

  it('uses mailbox identities for outgoing detection without trusting notification-only addresses', () => {
    expect(ownerMailboxAddresses(user({
      receiveAt: 'recovery@example.com',
      receiveEmails: [{ address: 'alerts@example.com' }],
      smtpUser: 'sender@example.com',
    }))).toEqual(expect.arrayContaining([
      'student@example.com',
      'sender@example.com',
    ]))
    expect(ownerMailboxAddresses(user({
      receiveAt: 'recovery@example.com',
      receiveEmails: [{ address: 'alerts@example.com' }],
    }))).not.toEqual(expect.arrayContaining([
      'recovery@example.com',
      'alerts@example.com',
    ]))
  })

  it('builds stable tracked-address and whitelist snapshots', () => {
    const applications = [
      application('app_1', 'professor@example.edu'),
      application('app_2', 'PROFESSOR@example.edu'),
      { ...application('app_3', 'other@example.edu'), ownerId: 'user_2' },
    ]
    expect(trackedProfessorAddresses(applications, 'user_1')).toEqual(['professor@example.edu'])
    expect(mailWhitelistDigest(applications, 'user_1')).toBe(mailWhitelistDigest([...applications].reverse(), 'user_1'))
  })
})
