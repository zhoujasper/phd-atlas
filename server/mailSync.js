import { createHash } from 'node:crypto'
import {
  classifyTrackedMailMessage,
  mailMessageKey,
  messageToCommunicationInput,
  normalizeMailAddress,
  normalizeMailAddressList,
} from './mailFetch.js'
import { reconcileMailClassificationFingerprints } from './mailClassificationContext.js'
import { COMMUNICATION_SERVER_AUTHORITY_FIELDS } from './shared/applicationAuthorityFields.js'

export { reconcileMailClassificationFingerprints } from './mailClassificationContext.js'

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export const MAX_APPLICATION_CORRESPONDENCE_EMAILS = 10

export function applicationProfessorAddresses(application) {
  return normalizeMailAddressList([
    application?.professor?.email,
    ...(application?.professor?.correspondenceEmails ?? []),
  ]).slice(0, MAX_APPLICATION_CORRESPONDENCE_EMAILS)
}

export function trackedProfessorAddressUpdate(application, address) {
  const normalizedAddress = normalizeMailAddress(address)
  const primaryAddress = normalizeMailAddress(application?.professor?.email)
  const currentAddresses = applicationProfessorAddresses(application)
  const correspondenceEmails = currentAddresses.filter((email) => email !== primaryAddress)
  if (!normalizedAddress) {
    return { status: 'invalid', address: '', correspondenceEmails }
  }
  if (currentAddresses.includes(normalizedAddress)) {
    return { status: 'already-tracked', address: normalizedAddress, correspondenceEmails }
  }
  if (currentAddresses.length >= MAX_APPLICATION_CORRESPONDENCE_EMAILS) {
    return { status: 'limit', address: normalizedAddress, correspondenceEmails }
  }
  return {
    status: 'added',
    address: normalizedAddress,
    correspondenceEmails: normalizeMailAddressList([
      ...correspondenceEmails,
      normalizedAddress,
    ]).filter((email) => email !== primaryAddress),
  }
}

export function trackedProfessorAddresses(applications, userId) {
  return Array.from(new Set(
    (applications ?? [])
      .filter((application) => application?.ownerId === userId)
      .flatMap((application) => applicationProfessorAddresses(application))
      .filter(Boolean),
  )).sort()
}

export function ownerMailboxAddresses(user) {
  const settings = user?.settings ?? {}
  return normalizeMailAddressList([
    user?.email,
    settings.incomingUser,
    settings.smtpUser,
    settings.sendFrom,
  ])
}

export function mailWhitelistDigest(applications, userId) {
  const rows = (applications ?? [])
    .filter((application) => application?.ownerId === userId)
    .map((application) => `${application.id}:${applicationProfessorAddresses(application).sort().join(',')}`)
    .sort()
  return sha256(rows.join('|'))
}

/**
 * Enforced here, defined once in the shared protocol. Adding a field to this
 * enforcement without adding it there refuses every save that carries it — see
 * the invariant documented beside the shared list.
 *
 * `attachments` is excluded from the authored projection but not enforced here,
 * because a communication's attachment rows are reconciled by their own route.
 * That direction is safe; the reverse is not.
 */
const SERVER_OWNED_COMMUNICATION_FIELDS = [...COMMUNICATION_SERVER_AUTHORITY_FIELDS]
  .filter((field) => field !== 'attachments')

function isFetchedCommunication(communication) {
  return communication?.messageType === 'fetched-email'
    || Boolean(communication?.sourceMessageKey && communication?.importedAt)
}

export function preserveCommunicationAuthority(existing, candidate) {
  const next = { ...candidate }
  for (const field of SERVER_OWNED_COMMUNICATION_FIELDS) {
    if (existing?.[field] !== undefined) next[field] = existing[field]
    else delete next[field]
  }
  if (isFetchedCommunication(existing)) {
    next.messageType = 'fetched-email'
    next.channel = 'Email'
    next.direction = existing?.direction ?? 'incoming'
    next.from = existing?.from ?? ''
    next.to = existing?.to ?? ''
    next.attachments = existing?.attachments ?? []
  } else if (next.messageType === 'fetched-email') {
    next.messageType = next.direction === 'outgoing'
      ? 'outgoing-email'
      : next.direction === 'incoming'
        ? 'incoming-email'
        : 'note'
  }
  if (existing?.mailSecurity?.level === 'danger') next.attachments = []
  return next
}

function hasServerOwnedCommunicationState(communication) {
  return isFetchedCommunication(communication)
    || SERVER_OWNED_COMMUNICATION_FIELDS.some((field) => communication?.[field] !== undefined)
}

export function preserveApplicationCommunicationAuthority(
  existingApplication,
  candidateApplication,
  clientBaseApplication = null,
) {
  const existingById = new Map(
    (existingApplication?.communications ?? []).map((communication) => [communication.id, communication]),
  )
  const candidateCommunications = candidateApplication?.communications ?? []
  const candidateIds = new Set(candidateCommunications.map((communication) => communication.id))
  const clientBaseIds = new Set(
    (clientBaseApplication?.communications ?? []).map((communication) => communication.id),
  )
  const concurrentlyAdded = (existingApplication?.communications ?? []).filter((communication) => {
    if (candidateIds.has(communication.id)) return false
    if (clientBaseApplication) return !clientBaseIds.has(communication.id)
    // Older callers cannot communicate their edit baseline. Keep only rows
    // whose provenance/delivery fields prove that a server workflow owns them;
    // normal client notes remain removable through the legacy full-update path.
    return hasServerOwnedCommunicationState(communication)
  })
  const nextApplication = {
    ...candidateApplication,
    communications: [
      ...concurrentlyAdded,
      ...candidateCommunications.map((communication) => (
        preserveCommunicationAuthority(existingById.get(communication.id), communication)
      )),
    ],
  }
  reconcileMailClassificationFingerprints(nextApplication)
  return nextApplication
}

export function communicationIdForMail(applicationId, messageKey) {
  return `comm_mail_${sha256(`${applicationId}|${messageKey}`).slice(0, 32)}`
}

export function timelineIdForMail(applicationId, messageKey) {
  return `time_mail_${sha256(`${applicationId}|${messageKey}`).slice(0, 32)}`
}

function normalizedCopy(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase()
}

function communicationEquivalent(existing, input) {
  if (String(existing?.channel ?? '').toLowerCase() !== 'email') return false
  if ((existing?.direction ?? 'note') !== input.direction) return false
  if (normalizedCopy(existing?.subject) !== normalizedCopy(input.subject)) return false
  if (String(existing?.date ?? '') !== input.date) return false
  if (normalizedCopy(existing?.summary) !== normalizedCopy(input.summary)) return false
  const existingFrom = normalizeMailAddressList(existing?.from)
  const existingTo = normalizeMailAddressList(existing?.to)
  const incomingFrom = normalizeMailAddressList(input.from)
  const incomingTo = normalizeMailAddressList(input.to)
  return existingFrom.some((address) => incomingFrom.includes(address))
    && existingTo.some((address) => incomingTo.includes(address))
}

function attachmentMetadataIdentity(attachment) {
  return [
    String(attachment?.fileName ?? '').toLowerCase(),
    Number(attachment?.fileSize ?? 0),
    String(attachment?.mimeType ?? '').toLowerCase(),
  ].join('|')
}

function attachmentIdentity(attachment) {
  if (attachment?.fileId) return `file:${attachment.fileId}`
  return attachmentMetadataIdentity(attachment)
}

/**
 * A previously imported correspondence row may predate encrypted mail-file
 * retention. On a later history sync, enrich that same row instead of adding
 * a duplicate email so its attachments become available to the AI context.
 */
function mergeFetchedAttachmentReferences(communication, input) {
  const incoming = input.attachments ?? []
  if (incoming.length === 0) return false
  const next = [...(communication.attachments ?? [])]
  let changed = false
  for (const attachment of incoming) {
    const identity = attachmentIdentity(attachment)
    const metadataIdentity = attachmentMetadataIdentity(attachment)
    const index = next.findIndex((candidate) => (
      attachmentIdentity(candidate) === identity
      || (!candidate.fileId && attachmentMetadataIdentity(candidate) === metadataIdentity)
    ))
    if (index === -1) {
      next.push(attachment)
      changed = true
      continue
    }
    const current = next[index]
    if (
      (!current.fileId && attachment.fileId)
      || (current.fileId === attachment.fileId && !current.storageName && attachment.storageName)
    ) {
      next[index] = { ...current, ...attachment }
      changed = true
    }
  }
  if (changed) communication.attachments = next
  return changed
}

function mergeFetchedMailSecurity(communication, input) {
  if (!input.mailSecurity) return false
  let changed = JSON.stringify(communication.mailSecurity ?? null) !== JSON.stringify(input.mailSecurity)
  communication.mailSecurity = input.mailSecurity
  if (input.mailSecurity.level === 'danger' && (communication.attachments ?? []).length > 0) {
    communication.attachments = []
    changed = true
  }
  return changed
}

function professorIndex(applications, userId) {
  const result = new Map()
  for (const application of applications ?? []) {
    if (application?.ownerId !== userId) continue
    for (const email of applicationProfessorAddresses(application)) {
      const matches = result.get(email) ?? []
      matches.push(application)
      result.set(email, matches)
    }
  }
  return result
}

function notificationForImportedMail(application, communication, message, messageKey) {
  const professorName = application?.professor?.english || application?.professor?.email || 'professor'
  const schoolName = application?.school?.name || 'your'
  const incoming = communication.direction === 'incoming'
  const dangerous = incoming && communication.mailSecurity?.level === 'danger'
  const quarantinedAttachmentCount = Number(communication.mailSecurity?.quarantinedAttachmentCount ?? 0)
  return {
    type: dangerous ? 'dangerous_email_imported' : 'new_email_imported',
    applicationId: application.id,
    dedupeKey: `mail-import:${application.id}:${messageKey}`,
    triggerDate: communication.date,
    title: dangerous
      ? `Suspicious email from ${professorName} quarantined`
      : incoming ? `New email from ${professorName}` : `Sent email to ${professorName} imported`,
    body: dangerous
      ? `"${communication.subject}" was imported as plain text with links disabled${quarantinedAttachmentCount > 0 ? ` and ${quarantinedAttachmentCount} attachment(s) quarantined` : ''}. Verify the sender through a trusted channel.`
      : incoming
      ? `"${communication.subject}" was imported into ${schoolName} correspondence.`
      : `"${communication.subject}" sent from your mailbox was imported into ${schoolName} correspondence.`,
    titleZh: dangerous
      ? `已隔离来自 ${professorName} 的可疑邮件`
      : incoming ? `收到 ${professorName} 的新邮件` : `已导入发送给 ${professorName} 的邮件`,
    bodyZh: dangerous
      ? `“${communication.subject}”已按纯文本导入并禁用链接${quarantinedAttachmentCount > 0 ? `，同时隔离 ${quarantinedAttachmentCount} 个附件` : ''}。请通过可信渠道核实发件人。`
      : incoming
      ? `“${communication.subject}”已导入${application?.school?.name ?? '对应申请'}的往来消息。`
      : `从你的邮箱发送的“${communication.subject}”已导入${application?.school?.name ?? '对应申请'}的往来消息。`,
    targetPath: `/applications/${encodeURIComponent(application.id)}/mail`,
    targetTab: 'mail',
    targetId: `communication-${communication.id}`,
    metadata: {
      communicationId: communication.id,
      messageKey,
      direction: communication.direction,
      sender: communication.from,
      senderEmail: normalizeMailAddressList(communication.from)[0] ?? '',
      recipient: communication.to,
      recipientName: professorName,
      recipientEmail: normalizeMailAddressList(communication.to)[0] ?? '',
      subject: communication.subject,
      emailSubject: communication.subject,
      applicationName: application?.school?.name,
      mailSecurityLevel: communication.mailSecurity?.level ?? '',
      mailSecuritySignals: communication.mailSecurity?.signals ?? [],
      quarantinedAttachmentCount,
    },
  }
}

/**
 * Idempotently applies fetched messages to current application state. Exact matching is repeated
 * here (after the network request) so a stale mailbox scan can never file mail into an unrelated
 * application. Existing correspondence is never removed when a professor address changes.
 */
export function applyFetchedMailMessages(store, user, fetchedMessages, options = {}) {
  const mode = options.mode === 'history' ? 'history' : 'incremental'
  const now = options.now ?? new Date().toISOString()
  const applications = store?.applications ?? []
  const index = professorIndex(applications, user.id)
  const trackedAddresses = [...index.keys()]
  const ownerAddresses = ownerMailboxAddresses(user)
  const messages = [...(fetchedMessages ?? [])].sort((left, right) => {
    const leftTime = new Date(left?.date ?? left?.internalDate ?? 0).getTime()
    const rightTime = new Date(right?.date ?? right?.internalDate ?? 0).getTime()
    return leftTime - rightTime
  })
  const handledKeys = new Set()
  const notifications = []
  let filed = 0
  let incoming = 0
  let outgoing = 0
  let caution = 0
  let danger = 0
  let duplicates = 0
  let ignored = 0
  let changed = false
  const classificationAffectedApplications = new Set()

  for (const message of messages) {
    const messageKey = message?.key || mailMessageKey(message)
    if (handledKeys.has(messageKey)) {
      duplicates += 1
      continue
    }
    const classification = classifyTrackedMailMessage(message, trackedAddresses, ownerAddresses)
    if (!classification) {
      // Do not mark the key handled: a duplicate copy in the real Sent folder may provide the
      // reliable outbound signal when an alias is not listed in account settings.
      ignored += 1
      continue
    }
    const matchingApplications = Array.from(new Map(
      classification.matchedAddresses
        .flatMap((address) => index.get(address) ?? [])
        .map((application) => [application.id, application]),
    ).values())
    if (matchingApplications.length === 0) {
      ignored += 1
      continue
    }
    handledKeys.add(messageKey)
    const baseInput = messageToCommunicationInput({ ...message, direction: classification.direction })

    for (const application of matchingApplications) {
      const selectedAttachments = options.attachmentsForApplication
        ? options.attachmentsForApplication(application, message, baseInput.attachments)
        : (options.retainAttachments?.(application, message) === false ? [] : baseInput.attachments)
      const input = selectedAttachments === baseInput.attachments
        ? baseInput
        : { ...baseInput, attachments: Array.isArray(selectedAttachments) ? selectedAttachments : [] }
      application.communications = application.communications ?? []
      application.timeline = application.timeline ?? []
      const deterministicId = communicationIdForMail(application.id, messageKey)
      let communication = application.communications.find((item) => (
        item.id === deterministicId || item.sourceMessageKey === messageKey
      ))
      let newlyImported = false

      if (!communication) {
        communication = application.communications.find((item) => (
          !item.sourceMessageKey && communicationEquivalent(item, input)
        ))
        if (communication) {
          communication.sourceMessageKey = messageKey
          communication.sourceMailbox = message.mailboxPath ?? ''
          changed = true
          duplicates += 1
        }
      } else {
        duplicates += 1
      }

      if (!communication) {
        communication = {
          id: deterministicId,
          ...input,
          sourceMessageKey: messageKey,
          sourceMailbox: message.mailboxPath ?? '',
          importedAt: now,
        }
        application.communications.unshift(communication)
        const timelineId = timelineIdForMail(application.id, messageKey)
        if (!application.timeline.some((item) => item.id === timelineId)) {
          application.timeline.unshift({
            id: timelineId,
            title: `Email: ${communication.subject}`,
            date: communication.date,
            note: communication.summary,
          })
        }
        application.updatedAt = now
        filed += 1
        if (communication.direction === 'incoming') incoming += 1
        else outgoing += 1
        if (communication.mailSecurity?.level === 'caution') caution += 1
        if (communication.mailSecurity?.level === 'danger') danger += 1
        changed = true
        newlyImported = true
        classificationAffectedApplications.add(application)
      } else {
        const securityChanged = mergeFetchedMailSecurity(communication, input)
        const attachmentsChanged = input.mailSecurity?.level === 'danger'
          ? false
          : mergeFetchedAttachmentReferences(communication, input)
        if (securityChanged || attachmentsChanged) {
          application.updatedAt = now
          changed = true
        }
        if (securityChanged) classificationAffectedApplications.add(application)
      }

      if (mode === 'incremental' && (newlyImported || communication.importedAt)) {
        notifications.push(notificationForImportedMail(application, communication, message, messageKey))
      }
    }
  }

  for (const application of classificationAffectedApplications) {
    if (!reconcileMailClassificationFingerprints(application)) continue
    application.updatedAt = now
    changed = true
  }

  return {
    changed,
    filed,
    incoming,
    outgoing,
    caution,
    danger,
    duplicates,
    ignored,
    notifications,
  }
}
