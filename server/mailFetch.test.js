import { describe, expect, it } from 'vitest'
import {
  classifyTrackedMailMessage,
  mailFetchSecurity,
  mailMessageKey,
  messageToCommunicationInput,
} from './mailFetch.js'

describe('mail fetch safety', () => {
  it('flags links whose visible URL host differs from the href host', () => {
    expect(mailFetchSecurity.detectPhishingHtml(
      '<a href="https://evil.example/login">https://admissions.example.edu/login</a>',
    )).toBe(true)
    expect(mailFetchSecurity.detectPhishingHtml(
      '<a href="https://admissions.example.edu/login">Admissions portal</a>',
    )).toBe(false)
  })

  it('keeps safe attachment metadata without accepting dangerous attachments', () => {
    const result = mailFetchSecurity.attachmentMetadata([
      {
        filename: 'funding-note.txt',
        contentType: 'text/plain',
        content: Buffer.from('safe funding note'),
      },
      {
        filename: 'invoice.pdf.exe',
        contentType: 'application/octet-stream',
        content: Buffer.from('not really a pdf'),
      },
      {
        filename: 'scan-note.txt',
        contentType: 'text/plain',
        content: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      },
    ], 42)

    expect(result.blocked).toBe(2)
    expect(result.attachments).toEqual([expect.objectContaining({
      id: 'mail-42-1',
      fileName: 'funding-note.txt',
      mimeType: 'text/plain',
      source: 'mail',
    })])
  })

  it('adds security warnings and safe attachment metadata to imported communications', () => {
    const input = messageToCommunicationInput({
      subject: 'Suspicious professor mail',
      from: 'prof@example.edu',
      to: 'student@example.com',
      date: new Date('2026-07-09T09:15:00.000Z'),
      text: 'Please sign in.',
      attachments: [{ id: 'mail-1-1', fileName: 'note.txt', fileSize: 4, mimeType: 'text/plain', source: 'mail' }],
      securityWarnings: ['phishing-link', 'unsafe-attachment'],
    })

    expect(input).toMatchObject({
      messageType: 'fetched-email',
      direction: 'incoming',
      date: '2026-07-09',
      time: '09:15',
      attachments: [expect.objectContaining({ fileName: 'note.txt', source: 'mail' })],
    })
    expect(input.summary).toContain('Security warning')
    expect(input.summary).toContain('Please sign in.')
  })

  it('classifies only exact professor correspondence and recognizes external sent mail', () => {
    const tracked = ['professor@example.edu']
    const owner = ['student@example.com']

    expect(classifyTrackedMailMessage({
      fromAddresses: ['professor@example.edu'],
      toAddresses: ['student@example.com'],
    }, tracked, owner)).toEqual({
      direction: 'incoming',
      matchedAddresses: ['professor@example.edu'],
    })

    expect(classifyTrackedMailMessage({
      fromAddresses: ['student@example.com'],
      toAddresses: ['professor@example.edu'],
    }, tracked, owner)).toEqual({
      direction: 'outgoing',
      matchedAddresses: ['professor@example.edu'],
    })

    expect(classifyTrackedMailMessage({
      fromAddresses: ['newsletter@example.com'],
      toAddresses: ['professor@example.edu', 'student@example.com'],
    }, tracked, owner)).toBeNull()

    expect(classifyTrackedMailMessage({
      fromAddresses: ['alias@example.com'],
      toAddresses: ['professor@example.edu'],
      folderRole: 'sent',
    }, tracked, owner)).toEqual({
      direction: 'outgoing',
      matchedAddresses: ['professor@example.edu'],
    })
  })

  it('uses one stable identity for duplicate copies of the same RFC message', () => {
    const base = {
      messageId: '<Same-Message@Example.com>',
      fromAddresses: ['professor@example.edu'],
      toAddresses: ['student@example.com'],
      subject: 'Research fit',
      date: new Date('2026-07-09T09:15:00.000Z'),
      text: 'Thanks for reaching out.',
    }
    expect(mailMessageKey({ ...base, mailboxPath: 'INBOX', uid: 12 }))
      .toBe(mailMessageKey({ ...base, mailboxPath: '[Gmail]/All Mail', uid: 92 }))
  })

  it('preserves outgoing direction when creating a correspondence record', () => {
    expect(messageToCommunicationInput({
      subject: 'External sent message',
      fromAddresses: ['student@example.com'],
      toAddresses: ['professor@example.edu'],
      direction: 'outgoing',
      date: new Date('2026-07-09T10:15:00.000Z'),
      text: 'I attached the proposal.',
    })).toMatchObject({
      direction: 'outgoing',
      from: 'student@example.com',
      to: 'professor@example.edu',
    })
  })
})
