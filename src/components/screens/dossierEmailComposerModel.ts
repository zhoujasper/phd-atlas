import { clearVerifiedStorageItem, setVerifiedStorageItem } from '../../verifiedStorage'

const ATTACHMENT_REFERENCE_PATTERNS = [
  /\b(?:attach(?:ed|ing|ment|ments)?|enclos(?:e|ed|ing|ure|ures))\b/iu,
  /(?:附件|附檔|附档|隨附|随附|見附|见附|附上|附送|附呈)/u,
  /(?:請|请).{0,4}查收(?:.{0,8}(?:附件|文件|材料|文檔|文档))?/u,
  /(?:添付|同封)/u,
  /첨부/u,
  /\b(?:adjunt(?:o|a|os|as)|anex(?:o|a|os|as)|anexad(?:o|a|os|as))\b/iu,
  /(?:pi[eè]ce(?:s)?\s+jointe(?:s)?|ci[-\s]?joint(?:e|es|s)?)/iu,
  /\b(?:anhang|anhänge|im\s+anhang|als\s+anlage|beigefügt|beigefuegt)\b/iu,
  /\ballegat(?:o|a|i|e)\b/iu,
  /(?:вложени\p{L}*|прикреп\p{L}*)/iu,
  /แนบ/u,
  /(?:đính\s*kèm|dinh\s*kem)/iu,
]

const SAVED_DRAFT_SUBJECT_MARKERS = [
  'DRAFT',
  '草稿',
  'ENTWURF',
  'BORRADOR',
  'PROJET',
  'BOZZA',
  'ドラフト',
  '초안',
  'RASCUNHO',
  'ЧЕРНОВИК',
  'ฉบับร่าง',
  'Bản nháp',
] as const

const EMAIL_COMPOSER_RECOVERY_PREFIX = 'phd-atlas-email-composer:v1'

export type RecoverableEmailAttachment = {
  id: string
  name: string
  fileName?: string
  fileId?: string
  assetId?: string
  fileSize?: number
  mimeType?: string
}

export type RecoverableEmailComposer = {
  activeDraftId?: string
  attachments: RecoverableEmailAttachment[]
  body: string
  deliveryId: string
  recipient: string
  scheduledDate: string
  scheduledTime: string
  subject: string
  updatedAt: number
}

function emailComposerRecoveryKey(userId: string, applicationId: string) {
  return `${EMAIL_COMPOSER_RECOVERY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(applicationId)}`
}

function isRecoverableAttachment(value: unknown): value is RecoverableEmailAttachment {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Partial<RecoverableEmailAttachment>
  return typeof attachment.id === 'string'
    && typeof attachment.name === 'string'
    && (attachment.fileName === undefined || typeof attachment.fileName === 'string')
    && (attachment.fileId === undefined || typeof attachment.fileId === 'string')
    && (attachment.assetId === undefined || typeof attachment.assetId === 'string')
    && (attachment.fileSize === undefined || typeof attachment.fileSize === 'number')
    && (attachment.mimeType === undefined || typeof attachment.mimeType === 'string')
}

function parseRecoverableEmailComposer(value: unknown): RecoverableEmailComposer | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<RecoverableEmailComposer>
  if (
    typeof draft.subject !== 'string'
    || typeof draft.body !== 'string'
    || typeof draft.recipient !== 'string'
    || typeof draft.scheduledDate !== 'string'
    || typeof draft.scheduledTime !== 'string'
    || typeof draft.deliveryId !== 'string'
    || draft.deliveryId.trim().length < 8
    || draft.deliveryId.trim().length > 128
    || typeof draft.updatedAt !== 'number'
    || !Array.isArray(draft.attachments)
    || !draft.attachments.every(isRecoverableAttachment)
    || (draft.activeDraftId !== undefined && typeof draft.activeDraftId !== 'string')
  ) {
    return null
  }
  return draft as RecoverableEmailComposer
}

export function editableDraftEmailSubject(subject: string) {
  const markerPattern = SAVED_DRAFT_SUBJECT_MARKERS
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return subject.replace(new RegExp(`^(?:\\[(?:${markerPattern})\\]\\s*)+`, 'iu'), '')
}

export function loadRecoverableEmailComposer(
  userId: string,
  applicationId: string,
  storage?: Pick<Storage, 'getItem'>,
) {
  try {
    const target = storage ?? globalThis.sessionStorage
    if (!target) return null
    const raw = target.getItem(emailComposerRecoveryKey(userId, applicationId))
    if (!raw) return null
    const parsed = parseRecoverableEmailComposer(JSON.parse(raw))
    if (!parsed || (!parsed.subject.trim() && !parsed.body.trim() && parsed.attachments.length === 0)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveRecoverableEmailComposer(
  userId: string,
  applicationId: string,
  draft: RecoverableEmailComposer,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
) {
  try {
    const target = storage ?? globalThis.sessionStorage
    if (!target) return false
    return setVerifiedStorageItem(
      target,
      emailComposerRecoveryKey(userId, applicationId),
      JSON.stringify(draft),
    )
  } catch {
    return false
  }
}

export function clearRecoverableEmailComposer(
  userId: string,
  applicationId: string,
  storage?: Pick<Storage, 'getItem' | 'removeItem'> & Partial<Pick<Storage, 'setItem'>>,
) {
  try {
    const target = storage ?? globalThis.sessionStorage
    if (!target) return false
    return clearVerifiedStorageItem(target, emailComposerRecoveryKey(userId, applicationId))
  } catch {
    return false
  }
}

export function emailContentMentionsAttachment(subject: string, body: string) {
  const content = `${subject}\n${body}`.normalize('NFKC')
  return ATTACHMENT_REFERENCE_PATTERNS.some((pattern) => pattern.test(content))
}

export function shouldConfirmMissingEmailAttachment({
  subject,
  body,
  attachmentCount,
}: {
  subject: string
  body: string
  attachmentCount: number
}) {
  return attachmentCount === 0 && emailContentMentionsAttachment(subject, body)
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function localDateValue(value: Date) {
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`
}

function localTimeValue(value: Date) {
  return `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`
}

export function defaultScheduledEmailTime(now = new Date(), minuteStep = 15) {
  const step = Math.max(1, Math.min(60, Math.floor(minuteStep) || 15))
  const next = new Date(now)
  next.setSeconds(0, 0)
  const minutesToAdd = step - (next.getMinutes() % step || 0)
  next.setMinutes(next.getMinutes() + minutesToAdd)
  return {
    date: localDateValue(next),
    time: localTimeValue(next),
  }
}

export function scheduledEmailIso(date: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const value = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (
    value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== day
    || value.getHours() !== hour
    || value.getMinutes() !== minute
  ) return null
  return value.toISOString()
}

export function isFutureScheduledEmail(
  date: string,
  time: string,
  nowMs = Date.now(),
) {
  const iso = scheduledEmailIso(date, time)
  return Boolean(iso && Date.parse(iso) > nowMs)
}
