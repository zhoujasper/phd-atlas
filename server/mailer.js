import nodemailer from 'nodemailer'
import {
  OutboundNetworkPolicyError,
  resolveMailNetworkTarget,
} from './outboundNetworkPolicy.js'

export class MailerError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'MailerError'
    this.code = code
    this.cause = cause
  }
}

async function resolveSmtpConfig(settings) {
  const host = String(settings?.smtpHost ?? '').trim()
  const user = String(settings?.smtpUser ?? '').trim()
  if (!host || !user) return null
  const port = Number(settings?.smtpPort ?? 587)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new MailerError('INVALID_CONFIGURATION', 'The SMTP port is invalid.')
  }
  let target
  try {
    target = await resolveMailNetworkTarget(host)
  } catch (error) {
    if (!(error instanceof OutboundNetworkPolicyError)) throw error
    if (['INVALID_OUTBOUND_HOST', 'OUTBOUND_HOST_NOT_PUBLIC'].includes(error.code)) {
      throw new MailerError(
        'UNSAFE_HOST',
        'The SMTP host is invalid or is not permitted by the server network policy.',
        error,
      )
    }
    throw new MailerError('CONNECTION_FAILED', 'Could not resolve the SMTP server host.', error)
  }
  const secure = port === 465
  const requireEncryptedTransport = process.env.NODE_ENV === 'production'
    && process.env.MAIL_ALLOW_PLAINTEXT !== '1'
  return {
    host: target.address,
    ...(target.servername ? { servername: target.servername } : {}),
    port,
    secure,
    requireTLS: !secure && (requireEncryptedTransport || Boolean(settings?.smtpTls ?? true)),
    auth: { user, pass: settings?.smtpPass ?? '' },
    tls: {
      rejectUnauthorized: true,
      ...(target.servername ? { servername: target.servername } : {}),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }
}

function classifySmtpError(error) {
  const code = error?.code
  if (code === 'EAUTH' || error?.responseCode === 535) {
    return new MailerError('AUTH_FAILED', 'SMTP authentication failed. Check the SMTP username and password.', error)
  }
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EDNS'].includes(code)) {
    return new MailerError('CONNECTION_FAILED', 'Could not reach the SMTP server. Check the host and port.', error)
  }
  return new MailerError('SEND_FAILED', error?.message || 'The email failed to send.', error)
}

/**
 * Sends an email through the given SMTP settings. Throws MailerError('NOT_CONFIGURED', ...)
 * when host/user are blank — callers should treat that as an expected, non-fatal state
 * (fall back to logging), not a real failure.
 */
export async function sendMail(settings, {
  from,
  to,
  subject,
  text,
  html,
  attachments = [],
  messageId,
}) {
  const config = await resolveSmtpConfig(settings)
  if (!config) {
    throw new MailerError('NOT_CONFIGURED', 'Outgoing mail is not configured.')
  }
  const transporter = nodemailer.createTransport(config)
  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      attachments,
      ...(messageId ? { messageId } : {}),
    })
    return { messageId: info.messageId, accepted: info.accepted ?? [], rejected: info.rejected ?? [] }
  } catch (error) {
    throw classifySmtpError(error)
  } finally {
    transporter.close()
  }
}

/** Verifies SMTP credentials/connectivity without sending anything. */
export async function verifySmtpConnection(settings) {
  const config = await resolveSmtpConfig(settings)
  if (!config) {
    throw new MailerError('NOT_CONFIGURED', 'Outgoing mail is not configured.')
  }
  const transporter = nodemailer.createTransport(config)
  try {
    await transporter.verify()
  } catch (error) {
    throw classifySmtpError(error)
  } finally {
    transporter.close()
  }
}
