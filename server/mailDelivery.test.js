import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))

vi.mock('./mailer.js', () => ({
  MailerError: class MailerError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  },
  sendMail,
}))

import { deliverSystemEmail, deliverUserComposedEmail } from './mailDelivery.js'

const message = {
  to: 'recipient@example.com',
  subject: 'Subject',
  text: 'Body',
  html: '<p>Body</p>',
  scope: 'Mail routing test',
  metadata: { kind: 'test' },
}

describe('mail delivery transport policy', () => {
  beforeEach(() => {
    sendMail.mockReset()
    sendMail.mockResolvedValue({ messageId: 'message-1', accepted: [], rejected: [] })
  })

  it('always uses administrator SMTP for system-generated mail', async () => {
    const adminSettings = {
      smtpHost: 'smtp.admin.example',
      smtpUser: 'system@example.com',
      smtpPass: 'admin-secret',
      notificationMailbox: 'notifications@example.com',
    }
    const store = { settings: adminSettings, systemEvents: [] }

    await deliverSystemEmail(store, { ...message, from: 'personal@example.com' })

    expect(sendMail).toHaveBeenCalledOnce()
    expect(sendMail).toHaveBeenCalledWith(adminSettings, expect.objectContaining({
      from: 'system@example.com',
      to: 'recipient@example.com',
    }))
  })

  it('uses user SMTP only for an explicitly composed email', async () => {
    const userSettings = {
      smtpHost: 'smtp.user.example',
      smtpUser: 'author@example.com',
      smtpPass: 'user-secret',
      sendFrom: 'author@example.com',
    }
    const store = {
      settings: { smtpHost: 'smtp.admin.example', smtpUser: 'system@example.com' },
      systemEvents: [],
    }
    const user = { settings: userSettings }

    await deliverUserComposedEmail(store, user, message)

    expect(sendMail).toHaveBeenCalledOnce()
    expect(sendMail).toHaveBeenCalledWith(userSettings, expect.objectContaining({
      from: 'author@example.com',
      to: 'recipient@example.com',
    }))
  })
})
