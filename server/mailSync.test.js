import { describe, expect, it } from 'vitest'
import {
  applyFetchedMailMessages,
  communicationIdForMail,
  mailWhitelistDigest,
  ownerMailboxAddresses,
  trackedProfessorAddresses,
} from './mailSync.js'

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
    securityWarnings: [],
    mailboxPath: 'INBOX',
    folderRole: 'mail',
    ...overrides,
  }
}

describe('mail sync application matching', () => {
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
