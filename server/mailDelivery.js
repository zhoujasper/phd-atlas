import { MailerError, sendMail } from './mailer.js'
import { logEvent } from './storage.js'

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
      message: `Email sent to ${to}`,
      metadata: { ...metadata, delivery: 'sent', messageId: result.messageId, attachments: attachmentLog },
    })
    return { sent: true, delivery: 'smtp', messageId: result.messageId }
  } catch (error) {
    if (error instanceof MailerError && error.code === 'NOT_CONFIGURED') {
      logEvent(store, {
        scope,
        message: `Email logged (SMTP not configured) for ${to}`,
        metadata: {
          ...metadata,
          delivery: 'log-only',
          emailTemplate: { subject, text, html, attachments: attachmentLog },
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
