import { MailerError, sendMail } from './mailer.js'
import { logEvent } from './storage.js'

function auditRecipient(value) {
  const address = String(value ?? '').trim().toLowerCase()
  const separator = address.lastIndexOf('@')
  if (separator <= 0) return 'redacted recipient'
  const local = address.slice(0, separator)
  const domain = address.slice(separator + 1)
  return `${local.slice(0, 1) || '*'}***@${domain}`
}

async function deliverEmail(store, smtpSettings, {
  from,
  to,
  subject,
  text,
  html,
  attachments = [],
  scope,
  metadata,
}) {
  const sender = from
    || smtpSettings?.smtpUser
    || smtpSettings?.sendFrom
    || smtpSettings?.notificationMailbox
  const attachmentLog = attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
  }))
  try {
    const result = await sendMail(smtpSettings, {
      from: sender,
      to,
      subject,
      text,
      html,
      attachments,
    })
    logEvent(store, {
      scope,
      message: `Email sent to ${auditRecipient(to)}`,
      metadata: { ...metadata, delivery: 'sent', messageId: result.messageId, attachments: attachmentLog },
    })
    return { sent: true, delivery: 'smtp', messageId: result.messageId }
  } catch (error) {
    if (error instanceof MailerError && error.code === 'NOT_CONFIGURED') {
      logEvent(store, {
        scope,
        message: `Email not sent (SMTP not configured) for ${auditRecipient(to)}`,
        metadata: {
          ...metadata,
          delivery: 'log-only',
          attachments: attachmentLog,
        },
      })
      return { sent: false, delivery: 'log-only', errorCode: 'NOT_CONFIGURED' }
    }
    throw error
  }
}

/**
 * Delivers product-generated mail exclusively through the administrator-managed SMTP account.
 * Callers cannot supply a user's SMTP settings, which keeps notifications, reminders, account
 * mail, team invitations, and other automatic messages on the system transport by construction.
 */
export function deliverSystemEmail(store, message) {
  const systemSettings = store?.settings ?? {}
  return deliverEmail(store, systemSettings, {
    ...message,
    from: systemSettings.smtpUser
      || systemSettings.sendFrom
      || systemSettings.notificationMailbox,
  })
}

/**
 * Delivers an email explicitly authored and sent by the signed-in user from the composer.
 * This is the only production delivery path that is allowed to use a user's SMTP account.
 */
export function deliverUserComposedEmail(store, user, message) {
  return deliverEmail(store, user?.settings ?? {}, message)
}
