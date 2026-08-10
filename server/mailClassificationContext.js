import { createMailContentFingerprint } from './mailClassification.js'

export const MAIL_CLASSIFICATION_THREAD_CONTEXT_ITEMS = 8

const BLOCKED_AI_SECURITY_LEVELS = new Set(['caution', 'danger', 'threat', 'unsafe'])

function normalizedString(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

export function isMailClassificationEmail(communication) {
  const channel = normalizedString(communication?.channel, 40).toLowerCase()
  const messageType = normalizedString(communication?.messageType, 80).toLowerCase()
  const direction = normalizedString(communication?.direction, 24).toLowerCase()
  return channel === 'email'
    && messageType !== 'draft-email'
    && messageType !== 'note'
    && direction !== 'note'
}

export function isMailClassificationIncomingEmail(communication) {
  return isMailClassificationEmail(communication)
    && normalizedString(communication?.direction, 24).toLowerCase() === 'incoming'
}

export function isMailClassificationUnsafe(communication) {
  const level = normalizedString(
    communication?.mailSecurity?.level ?? communication?.mailThreat?.level,
    32,
  ).toLowerCase()
  return BLOCKED_AI_SECURITY_LEVELS.has(level)
    || communication?.mailSecurity?.threat === true
    || communication?.mailThreat?.blocked === true
}

function subjectThreadKey(value) {
  return normalizedString(value, 512)
    .toLocaleLowerCase()
    .replace(/^\s*((?:re|fw|fwd|回复|转发)\s*:\s*)+/iu, '')
    .replace(/\s+/g, ' ')
}

function explicitThreadKey(communication) {
  for (const value of [
    communication?.threadId,
    communication?.conversationId,
    communication?.sourceThreadId,
    communication?.sourceThreadKey,
  ]) {
    const key = normalizedString(value, 320)
    if (key) return key
  }
  return ''
}

function addressTokens(communication) {
  const values = [communication?.from, communication?.to, communication?.cc]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => typeof value === 'string')
  const tokens = new Set()
  for (const value of values) {
    for (const token of value.toLocaleLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) ?? []) {
      tokens.add(token)
    }
  }
  return tokens
}

function sharesAddress(left, right) {
  if (left.size === 0 || right.size === 0) return true
  for (const value of left) if (right.has(value)) return true
  return false
}

function threadMatches(target, candidate) {
  const targetExplicit = explicitThreadKey(target)
  const candidateExplicit = explicitThreadKey(candidate)
  if (targetExplicit || candidateExplicit) {
    return Boolean(targetExplicit && candidateExplicit && targetExplicit === candidateExplicit)
  }
  const targetSubject = subjectThreadKey(target?.subject)
  return Boolean(
    targetSubject
    && targetSubject === subjectThreadKey(candidate?.subject)
    && sharesAddress(addressTokens(target), addressTokens(candidate)),
  )
}

function dateValue(communication) {
  const value = Date.parse(String(communication?.date ?? communication?.sentAt ?? communication?.importedAt ?? ''))
  return Number.isFinite(value) ? value : 0
}

export function mailClassificationThreadContext(application, target) {
  return (application?.communications ?? [])
    .filter((candidate) => (
      candidate !== target
      && candidate?.id !== target?.id
      && isMailClassificationEmail(candidate)
      && !isMailClassificationUnsafe(candidate)
      && threadMatches(target, candidate)
    ))
    .sort((left, right) => dateValue(right) - dateValue(left))
    .slice(0, MAIL_CLASSIFICATION_THREAD_CONTEXT_ITEMS)
    .reverse()
    .map((candidate) => ({
      direction: candidate.direction,
      from: candidate.from,
      subject: candidate.subject,
      bodyText: candidate.bodyText ?? candidate.summary,
    }))
}

export function mailClassificationInputForCommunication(
  application,
  communication,
  outputLanguage = '',
) {
  return {
    subject: communication?.subject,
    bodyText: communication?.bodyText ?? communication?.summary,
    from: communication?.from,
    to: communication?.to,
    cc: communication?.cc,
    direction: communication?.direction,
    date: communication?.date ?? communication?.sentAt ?? communication?.importedAt,
    threadContext: mailClassificationThreadContext(application, communication),
    outputLanguage,
  }
}

export function createCommunicationMailClassificationFingerprint(application, communication) {
  return createMailContentFingerprint(
    mailClassificationInputForCommunication(application, communication),
  )
}

/**
 * Revalidate server-owned AI results after the final communication collection
 * is assembled. This is shared by ordinary writes, mailbox sync, and SMTP
 * journal projection so no persistence path can retain a stale classification.
 */
export function reconcileMailClassificationFingerprints(application) {
  let changed = false
  for (const communication of application?.communications ?? []) {
    const classificationFingerprint = String(
      communication?.mailClassification?.inputHash
        ?? communication?.mailClassification?.contentFingerprint
        ?? '',
    ).trim().toLowerCase()
    if (
      classificationFingerprint
      && classificationFingerprint
        !== createCommunicationMailClassificationFingerprint(application, communication)
    ) {
      delete communication.mailClassification
      changed = true
    }
  }
  return changed
}
