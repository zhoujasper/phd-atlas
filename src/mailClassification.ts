export const mailCategories = [
  'outreach',
  'positive_reply',
  'neutral_reply',
  'negative_reply',
  'interview_invite',
  'interview_followup',
  'offer',
  'rejection',
  'application_update',
  'funding',
  'recommendation',
  'administrative',
  'other',
  'not_relevant',
] as const

export type MailCategory = (typeof mailCategories)[number]

export const mailClassificationActions = [
  'reply',
  'follow_up',
  'schedule_interview',
  'prepare_interview',
  'submit_materials',
  'review_funding',
  'update_application',
  'track_deadline',
  'review_security',
  'none',
] as const

export type MailClassificationAction = (typeof mailClassificationActions)[number]

const mailClassificationActionLabelKeys: Record<MailClassificationAction, string> = {
  reply: 'dossier.mailClassificationActions.reply',
  follow_up: 'dossier.mailClassificationActions.followUp',
  schedule_interview: 'dossier.mailClassificationActions.scheduleInterview',
  prepare_interview: 'dossier.mailClassificationActions.prepareInterview',
  submit_materials: 'dossier.mailClassificationActions.submitMaterials',
  review_funding: 'dossier.mailClassificationActions.reviewFunding',
  update_application: 'dossier.mailClassificationActions.updateApplication',
  track_deadline: 'dossier.mailClassificationActions.trackDeadline',
  review_security: 'dossier.mailClassificationActions.reviewSecurity',
  none: 'dossier.mailClassificationActions.none',
}

/** Stable localized-label contract for every action the classifier can return. */
export function mailClassificationActionLabelKey(action: MailClassificationAction): string {
  return mailClassificationActionLabelKeys[action]
}

export type MailClassification = {
  /** Built-in id or an account-defined `custom:` id. */
  category: string
  /** Every category the classifier found, most confident first. */
  categories?: readonly string[]
  confidence: number
  summary: string
  evidence: string[]
  actions: MailClassificationAction[]
  source: 'ai' | 'rule'
  provider?: string
  model?: string
  classifiedAt: string
  inputHash: string
  version: number
}

export type MailCategorizedRecord = {
  /** Manual selection, one or more. Supersedes `mailCategoryOverride`. */
  mailCategories?: readonly string[] | null
  /** Legacy single manual value, still honoured when no list is stored. */
  mailCategoryOverride?: MailCategory | null
  mailClassification?: Pick<MailClassification, 'category'> & Partial<MailClassification>
}

export const CUSTOM_MAIL_CATEGORY_PREFIX = 'custom:'
export const MAX_CUSTOM_MAIL_CATEGORIES = 24
export const MAX_MAIL_CATEGORIES_PER_MESSAGE = 6
export const MAX_MAIL_CATEGORY_ID_LENGTH = 64
export const MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH = 40

export type MailCategoryTone =
  'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent' | 'purple'

export const mailCategoryTonePalette: readonly MailCategoryTone[] = [
  'accent', 'success', 'info', 'purple', 'warning', 'danger', 'neutral',
]

/** A category this account defined. Built-ins stay code-owned and unremovable. */
export type CustomMailCategory = {
  id: string
  label: string
  tone: MailCategoryTone
}

export function isCustomMailCategoryId(id: string): boolean {
  return id.startsWith(CUSTOM_MAIL_CATEGORY_PREFIX)
}

/**
 * Ids are derived from the label but never re-derived afterwards: renaming a
 * category must not orphan every message already filed under it.
 */
export function customMailCategoryId(label: string, taken: ReadonlySet<string>): string {
  const slug = label
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32)
  const base = `${CUSTOM_MAIL_CATEGORY_PREFIX}${slug || 'category'}`
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

export function normalizedCustomMailCategories(
  values: readonly unknown[] | null | undefined,
): CustomMailCategory[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: CustomMailCategory[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const candidate = value as Partial<CustomMailCategory>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
    if (!id || !label || !isCustomMailCategoryId(id)) continue
    if (id.length > MAX_MAIL_CATEGORY_ID_LENGTH || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      label: label.slice(0, MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH),
      tone: mailCategoryTonePalette.includes(candidate.tone as MailCategoryTone)
        ? candidate.tone as MailCategoryTone
        : 'neutral',
    })
    if (result.length >= MAX_CUSTOM_MAIL_CATEGORIES) break
  }
  return result
}

export type MailClassificationDelta = {
  id: string
  mailCategories?: readonly string[] | null
  mailCategoryOverride?: MailCategory | null
  mailClassification?: MailClassification | null
}

const MAIL_CLASSIFICATION_REQUEST_STORE_VERSION = 1
const MAIL_CLASSIFICATION_REQUEST_TTL_MS = 24 * 60 * 60_000
const MAIL_CLASSIFICATION_REQUEST_MAX_ENTRIES = 24
export const MAIL_CLASSIFICATION_BATCH_LIMIT = 50

type StoredMailClassificationRequest = {
  signature: string
  requestId: string
  updatedAt: number
}

function availableSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
  } catch {
    return null
  }
}

function mailClassificationRequestStoreKey(userId: string) {
  return `phd-atlas:mail-classification-requests:${encodeURIComponent(userId)}`
}

function readStoredMailClassificationRequests(
  storage: Storage | null,
  userId: string,
  now: number,
): StoredMailClassificationRequest[] {
  if (!storage || !userId) return []
  try {
    const value = JSON.parse(storage.getItem(mailClassificationRequestStoreKey(userId)) ?? 'null')
    if (value?.version !== MAIL_CLASSIFICATION_REQUEST_STORE_VERSION || !Array.isArray(value.entries)) return []
    return value.entries
      .filter((entry: unknown): entry is StoredMailClassificationRequest => {
        if (!entry || typeof entry !== 'object') return false
        const candidate = entry as Partial<StoredMailClassificationRequest>
        return typeof candidate.signature === 'string'
          && candidate.signature.length <= 32_768
          && typeof candidate.requestId === 'string'
          && candidate.requestId.length <= 256
          && Number.isFinite(candidate.updatedAt)
          && now - Number(candidate.updatedAt) <= MAIL_CLASSIFICATION_REQUEST_TTL_MS
      })
      .sort((left: StoredMailClassificationRequest, right: StoredMailClassificationRequest) => (
        right.updatedAt - left.updatedAt
      ))
      .slice(0, MAIL_CLASSIFICATION_REQUEST_MAX_ENTRIES)
  } catch {
    return []
  }
}

function writeStoredMailClassificationRequests(
  storage: Storage | null,
  userId: string,
  entries: StoredMailClassificationRequest[],
): boolean {
  if (!storage || !userId) return false
  const key = mailClassificationRequestStoreKey(userId)
  try {
    if (entries.length === 0) {
      storage.removeItem(key)
      return storage.getItem(key) === null
    }
    const serialized = JSON.stringify({
      version: MAIL_CLASSIFICATION_REQUEST_STORE_VERSION,
      entries: entries.slice(0, MAIL_CLASSIFICATION_REQUEST_MAX_ENTRIES),
    })
    storage.setItem(key, serialized)
    return storage.getItem(key) === serialized
  } catch {
    return false
  }
}

/** Split one user operation into the server's bounded request size without losing ids. */
export function mailClassificationCommunicationIdBatches(
  communicationIds: readonly string[],
): string[][] {
  const uniqueIds = [...new Set(communicationIds.filter((id) => Boolean(id)))]
  const batches: string[][] = []
  for (let offset = 0; offset < uniqueIds.length; offset += MAIL_CLASSIFICATION_BATCH_LIMIT) {
    batches.push(uniqueIds.slice(offset, offset + MAIL_CLASSIFICATION_BATCH_LIMIT))
  }
  return batches
}

/** Keep ambiguous request identities through a same-tab reload without sharing them across accounts. */
export function persistedMailClassificationRequestId(
  userId: string,
  signature: string,
  storage: Storage | null = availableSessionStorage(),
  now = Date.now(),
): string | null {
  return readStoredMailClassificationRequests(storage, userId, now)
    .find((entry) => entry.signature === signature)?.requestId ?? null
}

export function rememberMailClassificationRequestId(
  userId: string,
  signature: string,
  requestId: string,
  storage: Storage | null = availableSessionStorage(),
  now = Date.now(),
): boolean {
  if (!userId || !signature || !requestId) return false
  const entries = readStoredMailClassificationRequests(storage, userId, now)
    .filter((entry) => entry.signature !== signature)
  entries.unshift({ signature, requestId, updatedAt: now })
  return writeStoredMailClassificationRequests(storage, userId, entries)
}

export function forgetMailClassificationRequestId(
  userId: string,
  signature: string,
  storage: Storage | null = availableSessionStorage(),
  now = Date.now(),
): boolean {
  const entries = readStoredMailClassificationRequests(storage, userId, now)
    .filter((entry) => entry.signature !== signature)
  return writeStoredMailClassificationRequests(storage, userId, entries)
}

/** Merge the server's bounded classification acknowledgement without replacing the mailbox. */
export function mergeMailClassificationDeltas<
  T extends { id: string } & MailCategorizedRecord,
>(records: readonly T[], deltas: readonly MailClassificationDelta[]): T[] {
  if (deltas.length === 0) return [...records]
  const byId = new Map(deltas.map((delta) => [delta.id, delta]))
  return records.map((record) => {
    const delta = byId.get(record.id)
    if (!delta) return record
    const next = { ...record } as T & {
      mailCategories?: readonly string[]
      mailCategoryOverride?: MailCategory | null
      mailClassification?: MailClassification
    }
    if (Object.hasOwn(delta, 'mailCategories')) {
      if (delta.mailCategories === null) delete next.mailCategories
      else next.mailCategories = normalizedMailCategoryList(delta.mailCategories ?? [])
    }
    if (Object.hasOwn(delta, 'mailCategoryOverride')) {
      if (delta.mailCategoryOverride === null) delete next.mailCategoryOverride
      else next.mailCategoryOverride = delta.mailCategoryOverride
    }
    if (Object.hasOwn(delta, 'mailClassification')) {
      if (delta.mailClassification === null) delete next.mailClassification
      else next.mailClassification = delta.mailClassification
    }
    return next
  })
}

/**
 * A message is rarely one thing. An interview invitation that also asks for a
 * funding form is both, and forcing a single winner threw away the half the
 * reader needed. Manual selection and the classifier therefore both carry a
 * list; the older single-valued fields are still read when a list is absent so
 * rows written before this keep their category.
 */
export function manualMailCategories(record: MailCategorizedRecord): string[] {
  if (Array.isArray(record.mailCategories)) return normalizedMailCategoryList(record.mailCategories)
  return record.mailCategoryOverride ? [record.mailCategoryOverride] : []
}

export function classifiedMailCategories(record: MailCategorizedRecord): string[] {
  const classification = record.mailClassification
  if (!classification) return []
  if (Array.isArray(classification.categories)) {
    return normalizedMailCategoryList(classification.categories)
  }
  return classification.category ? [classification.category] : []
}

/** Manual selection wins outright: it is a decision, not a second opinion. */
export function effectiveMailCategories(record: MailCategorizedRecord): string[] {
  const manual = manualMailCategories(record)
  return manual.length > 0 ? manual : classifiedMailCategories(record)
}

export function hasManualMailCategory(record: MailCategorizedRecord): boolean {
  return manualMailCategories(record).length > 0
}

/** The single label a compact badge shows; the rest surface on the row itself. */
export function effectiveMailCategory(record: MailCategorizedRecord): string | null {
  return effectiveMailCategories(record)[0] ?? null
}

export function normalizedMailCategoryList(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > MAX_MAIL_CATEGORY_ID_LENGTH || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= MAX_MAIL_CATEGORIES_PER_MESSAGE) break
  }
  return result
}

const mailCategoryLabelKeys: Record<MailCategory, string> = {
  outreach: 'dossier.mailCategories.outreach',
  positive_reply: 'dossier.mailCategories.positiveReply',
  neutral_reply: 'dossier.mailCategories.neutralReply',
  negative_reply: 'dossier.mailCategories.negativeReply',
  interview_invite: 'dossier.mailCategories.interviewInvite',
  interview_followup: 'dossier.mailCategories.interviewFollowup',
  offer: 'dossier.mailCategories.offer',
  rejection: 'dossier.mailCategories.rejection',
  application_update: 'dossier.mailCategories.applicationUpdate',
  funding: 'dossier.mailCategories.funding',
  recommendation: 'dossier.mailCategories.recommendation',
  administrative: 'dossier.mailCategories.administrative',
  other: 'dossier.mailCategories.other',
  not_relevant: 'dossier.mailCategories.notRelevant',
}

const mailCategoryTones: Record<
  MailCategory,
  'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent' | 'purple'
> = {
  outreach: 'accent',
  positive_reply: 'success',
  neutral_reply: 'info',
  negative_reply: 'warning',
  interview_invite: 'purple',
  interview_followup: 'purple',
  offer: 'success',
  rejection: 'danger',
  application_update: 'info',
  funding: 'success',
  recommendation: 'purple',
  administrative: 'neutral',
  other: 'neutral',
  not_relevant: 'neutral',
}

export function mailCategoryLabelKey(category: MailCategory): string {
  return mailCategoryLabelKeys[category]
}

export function mailCategoryTone(category: MailCategory) {
  return mailCategoryTones[category]
}

export function mailCategorySlug(category: string): string {
  return category.replaceAll('_', '-').replace(CUSTOM_MAIL_CATEGORY_PREFIX, 'custom-')
}

export function isBuiltInMailCategory(id: string): id is MailCategory {
  return Object.hasOwn(mailCategoryLabelKeys, id)
}

/**
 * One list the whole UI orders by: the built-ins in their designed sequence,
 * then this account's own categories in the order it arranged them.
 */
export function mailCategoryOptions(
  custom: readonly CustomMailCategory[],
): Array<{ id: string; tone: MailCategoryTone; custom: boolean }> {
  return [
    ...mailCategories.map((id) => ({ id, tone: mailCategoryTones[id], custom: false })),
    ...custom.map((entry) => ({ id: entry.id, tone: entry.tone, custom: true })),
  ]
}

/**
 * Resolves any id to a label. A custom id whose definition has been deleted
 * still appears on the messages already filed under it, so fall back to the
 * readable part of the id rather than showing nothing.
 */
export function resolveMailCategoryLabel(
  id: string,
  custom: readonly CustomMailCategory[],
  translate: (key: string) => string,
): string {
  if (isBuiltInMailCategory(id)) return translate(mailCategoryLabelKeys[id])
  const defined = custom.find((entry) => entry.id === id)
  if (defined) return defined.label
  return id.startsWith(CUSTOM_MAIL_CATEGORY_PREFIX)
    ? id.slice(CUSTOM_MAIL_CATEGORY_PREFIX.length).replaceAll('-', ' ')
    : id
}

export function resolveMailCategoryTone(
  id: string,
  custom: readonly CustomMailCategory[],
): MailCategoryTone {
  if (isBuiltInMailCategory(id)) return mailCategoryTones[id]
  return custom.find((entry) => entry.id === id)?.tone ?? 'neutral'
}

export function mailConfidencePercent(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100)
}
