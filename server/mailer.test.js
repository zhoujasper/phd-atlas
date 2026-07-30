import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class PolicyError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  }
  return {
    close: vi.fn(),
    createTransport: vi.fn(),
    resolveMailNetworkTarget: vi.fn(),
    sendMail: vi.fn(),
    verify: vi.fn(),
    PolicyError,
  }
})

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}))

vi.mock('./outboundNetworkPolicy.js', () => ({
  OutboundNetworkPolicyError: mocks.PolicyError,
  resolveMailNetworkTarget: mocks.resolveMailNetworkTarget,
}))

import { sendMail, verifySmtpConnection } from './mailer.js'

const originalNodeEnv = process.env.NODE_ENV
const originalPlaintext = process.env.MAIL_ALLOW_PLAINTEXT

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveMailNetworkTarget.mockResolvedValue({
    address: '8.8.8.8',
    family: 4,
    host: 'smtp.example.com',
    servername: 'smtp.example.com',
    pinned: true,
  })
  mocks.sendMail.mockResolvedValue({
    messageId: 'message-1',
    accepted: ['student@example.com'],
    rejected: [],
  })
  mocks.verify.mockResolvedValue(true)
  mocks.createTransport.mockReturnValue({
    sendMail: mocks.sendMail,
    verify: mocks.verify,
    close: mocks.close,
  })
  process.env.NODE_ENV = 'production'
  delete process.env.MAIL_ALLOW_PLAINTEXT
})

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  if (originalPlaintext === undefined) delete process.env.MAIL_ALLOW_PLAINTEXT
  else process.env.MAIL_ALLOW_PLAINTEXT = originalPlaintext
})

describe('SMTP network boundary', () => {
  it('pins the validated IP, retains TLS SNI, and requires STARTTLS in production', async () => {
    await sendMail({
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpTls: false,
      smtpUser: 'student@example.com',
      smtpPass: 'test-only',
    }, {
      from: 'student@example.com',
      to: 'professor@example.edu',
      subject: 'Research',
      text: 'Hello',
    })

    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: '8.8.8.8',
      servername: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: {
        rejectUnauthorized: true,
        servername: 'smtp.example.com',
      },
    }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('maps private-network policy failures to a stable mail configuration error', async () => {
    mocks.resolveMailNetworkTarget.mockRejectedValue(
      new mocks.PolicyError('OUTBOUND_HOST_NOT_PUBLIC', 'private'),
    )
    await expect(verifySmtpConnection({
      smtpHost: '127.0.0.1',
      smtpPort: 25,
      smtpUser: 'student@example.com',
    })).rejects.toMatchObject({
      name: 'MailerError',
      code: 'UNSAFE_HOST',
    })
    expect(mocks.createTransport).not.toHaveBeenCalled()
  })
})
