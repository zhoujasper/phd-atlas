import { describe, expect, it } from 'vitest'
import {
  AdminSettingsPatchSchema,
  AdminUserPatchSchema,
  CommunicationCreateSchema,
  CommunicationPatchSchema,
  RegisterSchema,
  UserSettingsPatchSchema,
  parseOrThrow,
} from './validation.js'

describe('correspondence and mailbox validation', () => {
  it('accepts correspondence records with timeline metadata', () => {
    const record = parseOrThrow(CommunicationCreateSchema, {
      subject: 'Research follow-up',
      summary: 'Thank you for the detailed reply.',
      channel: 'Message',
      date: '2026-06-30',
      time: '20:45',
      direction: 'outgoing',
      messageType: 'outgoing-message',
      from: 'jasper@example.com',
      to: 'professor@example.edu',
    })

    expect(record).toMatchObject({
      channel: 'Message',
      direction: 'outgoing',
      messageType: 'outgoing-message',
      time: '20:45',
    })
  })

  it('accepts partial correspondence edits', () => {
    const patch = parseOrThrow(CommunicationPatchSchema, {
      subject: 'Updated follow-up',
      summary: 'Refined next step and reply summary.',
      date: '2026-07-02',
    })

    expect(patch).toMatchObject({
      subject: 'Updated follow-up',
      summary: 'Refined next step and reply summary.',
      date: '2026-07-02',
    })

    expect(() => parseOrThrow(CommunicationPatchSchema, {
      subject: '',
    })).toThrow()
  })

  it('limits receiving mailboxes to five and preserves pending verification', () => {
    const patch = parseOrThrow(UserSettingsPatchSchema, {
      receiveEmails: [
        { address: 'one@example.com', isPrimary: true, notify: true, verified: true },
        { address: 'two@example.com', isPrimary: false, notify: false, verified: false },
      ],
    })

    expect(patch.receiveEmails?.[1]).toMatchObject({
      address: 'two@example.com',
      verified: false,
    })

    expect(() => parseOrThrow(UserSettingsPatchSchema, {
      receiveEmails: Array.from({ length: 6 }, (_, index) => ({
        address: `mail${index}@example.com`,
        isPrimary: index === 0,
        notify: true,
        verified: true,
      })),
    })).toThrow()
  })

  it('requires registration captcha metadata and preserves language preference', () => {
    const registration = parseOrThrow(RegisterSchema, {
      name: 'Jasper',
      email: 'new-user@example.com',
      password: 'demo123456',
      language: 'zh',
      captchaToken: 'captcha-token-long-enough',
      captchaAnswer: '10',
      emailCodeToken: 'email-code-token-long-enough',
      emailCode: '123456',
    })

    expect(registration).toMatchObject({
      email: 'new-user@example.com',
      language: 'zh',
      captchaAnswer: '10',
      emailCodeToken: 'email-code-token-long-enough',
      emailCode: '123456',
    })

    expect(() => parseOrThrow(RegisterSchema, {
      name: 'Jasper',
      email: 'new-user@example.com',
      password: 'demo123456',
      language: 'zh',
    })).toThrow()
  })

  it('accepts personal SMTP and incoming POP3/IMAP mailbox settings', () => {
    const patch = parseOrThrow(UserSettingsPatchSchema, {
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'alerts@example.com',
      smtpPass: 'app-password',
      smtpTls: true,
      incomingProtocol: 'imap',
      incomingHost: 'imap.example.com',
      incomingPort: 993,
      incomingUser: 'jasper@example.com',
      incomingPass: 'mail-password',
      incomingTls: true,
    })

    expect(patch).toMatchObject({
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      incomingProtocol: 'imap',
      incomingPort: 993,
    })

    expect(() => parseOrThrow(UserSettingsPatchSchema, {
      incomingProtocol: 'exchange',
    })).toThrow()
  })

  it('accepts admin SMTP settings and user quota permission updates', () => {
    const settings = parseOrThrow(AdminSettingsPatchSchema, {
      notificationMailbox: 'admin-alerts@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'admin-alerts@example.com',
      smtpPass: 'secret',
      smtpTls: true,
    })
    const userPatch = parseOrThrow(AdminUserPatchSchema, {
      role: 'user',
      disabled: true,
      storageQuotaMb: 250,
      applicationQuota: 80,
      shareQuota: 150,
    })

    expect(settings).toMatchObject({
      smtpHost: 'smtp.example.com',
      smtpTls: true,
    })
    expect(userPatch).toEqual({
      role: 'user',
      disabled: true,
      storageQuotaMb: 250,
      applicationQuota: 80,
      shareQuota: 150,
    })
    expect(() => parseOrThrow(AdminUserPatchSchema, {
      role: 'teacher',
    })).toThrow()
    expect(() => parseOrThrow(AdminUserPatchSchema, {
      storageQuotaMb: 0,
    })).toThrow()
    expect(() => parseOrThrow(AdminUserPatchSchema, {
      applicationQuota: 0,
    })).toThrow()
    expect(() => parseOrThrow(AdminUserPatchSchema, {
      shareQuota: 0,
    })).toThrow()
  })
})
