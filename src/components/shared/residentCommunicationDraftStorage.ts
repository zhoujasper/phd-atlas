import { clearVerifiedStorageItem, setVerifiedStorageItem } from '../../verifiedStorage'

const NOTIFICATION_PUBLISHER_DRAFT_PREFIX = 'phd-atlas-notification-publisher-draft:v1'
const GUIDANCE_MESSAGE_DRAFT_PREFIX = 'phd-atlas-guidance-message-draft:v1'
const TEAM_BULK_INVITE_DRAFT_PREFIX = 'phd-atlas-team-bulk-invite-draft:v1'
const MAX_TITLE_LENGTH = 160
const MAX_BODY_LENGTH = 2_000
const MAX_GROUP_NAME_LENGTH = 160
const MAX_FILE_NAME_LENGTH = 512
const MAX_ID_LENGTH = 512
const MAX_DRAFT_IDS = 2_000
const MAX_CSV_GROUPS = 200
const MAX_BULK_INVITE_TEXT_LENGTH = 512 * 1024
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1_000

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type ResidentDraftScope = {
  userId: string
  workspaceId: string
}

export type GuidanceMessageDraftScope = ResidentDraftScope & {
  recipientId: string
}

export type RecoverableNotificationCsvPreview = {
  groups: Array<{ name: string; memberIds: string[] }>
  matchedMembers: number
  skippedRows: number
}

export type RecoverableNotificationPublisherDraft = {
  title: string
  body: string
  channels: Array<'in_app' | 'email'>
  recipientIds: string[]
  groupIds: string[]
  audienceIds: string[]
  groupName: string
  groupMemberIds: string[]
  csvPreview: RecoverableNotificationCsvPreview | null
  csvFileName: string
}

export type RecoverableGuidanceMessageDraft = {
  title: string
  body: string
}

export type RecoverableTeamBulkInviteDraft = {
  text: string
  fileName: string
}

function storageOrDefault(storage?: DraftStorage) {
  return storage ?? globalThis.sessionStorage
}

function cleanScopePart(value: string) {
  const normalized = value.trim()
  return normalized ? encodeURIComponent(normalized) : null
}

function scopedKey(prefix: string, scope: ResidentDraftScope, subjectId?: string) {
  const userId = cleanScopePart(scope.userId)
  const workspaceId = cleanScopePart(scope.workspaceId)
  const subject = typeof subjectId === 'string' ? cleanScopePart(subjectId) : undefined
  if (!userId || !workspaceId || subject === null) return null
  return [prefix, userId, workspaceId, subject].filter(Boolean).join(':')
}

export function notificationPublisherDraftStorageKey(scope: ResidentDraftScope) {
  return scopedKey(NOTIFICATION_PUBLISHER_DRAFT_PREFIX, scope)
}

export function guidanceMessageDraftStorageKey(scope: GuidanceMessageDraftScope) {
  return scopedKey(GUIDANCE_MESSAGE_DRAFT_PREFIX, scope, scope.recipientId)
}

export function teamBulkInviteDraftStorageKey(scope: ResidentDraftScope) {
  return scopedKey(TEAM_BULK_INVITE_DRAFT_PREFIX, scope)
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function boundedIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => {
    if (typeof item !== 'string') return []
    const id = item.trim().slice(0, MAX_ID_LENGTH)
    return id ? [id] : []
  }))].slice(0, MAX_DRAFT_IDS)
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function parseCsvPreview(value: unknown): RecoverableNotificationCsvPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.groups)) return null
  const groups = source.groups.slice(0, MAX_CSV_GROUPS).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const group = item as Record<string, unknown>
    const name = boundedString(group.name, MAX_GROUP_NAME_LENGTH).trim()
    const memberIds = boundedIds(group.memberIds)
    return name && memberIds.length > 0 ? [{ name, memberIds }] : []
  })
  if (groups.length === 0) return null
  return {
    groups,
    matchedMembers: groups.reduce((total, group) => total + group.memberIds.length, 0),
    skippedRows: nonNegativeInteger(source.skippedRows),
  }
}

function readDraft<T>(
  key: string | null,
  parse: (value: unknown) => T | null,
  storage?: DraftStorage,
) {
  if (!key) return null
  try {
    const target = storageOrDefault(storage)
    if (!target) return null
    const raw = target.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const envelope = value as Record<string, unknown>
    if (
      envelope.version !== 1
      || typeof envelope.updatedAt !== 'number'
      || !Number.isFinite(envelope.updatedAt)
      || envelope.updatedAt > Date.now() + 60_000
      || Date.now() - envelope.updatedAt > MAX_DRAFT_AGE_MS
    ) return null
    return parse(value)
  } catch {
    return null
  }
}

function writeDraft(
  key: string | null,
  value: Record<string, unknown>,
  storage?: DraftStorage,
) {
  if (!key) return false
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return setVerifiedStorageItem(target, key, JSON.stringify({
      version: 1,
      ...value,
      updatedAt: Date.now(),
    }))
  } catch {
    return false
  }
}

function clearDraft(key: string | null, storage?: DraftStorage) {
  if (!key) return false
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return clearVerifiedStorageItem(target, key)
  } catch {
    return false
  }
}

export function emptyNotificationPublisherDraft(): RecoverableNotificationPublisherDraft {
  return {
    title: '',
    body: '',
    channels: ['in_app'],
    recipientIds: [],
    groupIds: [],
    audienceIds: [],
    groupName: '',
    groupMemberIds: [],
    csvPreview: null,
    csvFileName: '',
  }
}

export function isNotificationPublisherDraftDirty(draft: RecoverableNotificationPublisherDraft) {
  return Boolean(
    draft.title.trim()
    || draft.body.trim()
    || draft.channels.length !== 1
    || draft.channels[0] !== 'in_app'
    || draft.recipientIds.length
    || draft.groupIds.length
    || draft.audienceIds.length
    || draft.groupName.trim()
    || draft.groupMemberIds.length
    || draft.csvPreview?.groups.length,
  )
}

function parseNotificationPublisherDraft(value: unknown): RecoverableNotificationPublisherDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const storedChannels = Array.isArray(source.channels) ? source.channels : null
  const channels = storedChannels
    ? [...new Set(storedChannels.filter((item): item is 'in_app' | 'email' => item === 'in_app' || item === 'email'))]
    : []
  const draft: RecoverableNotificationPublisherDraft = {
    title: boundedString(source.title, MAX_TITLE_LENGTH),
    body: boundedString(source.body, MAX_BODY_LENGTH),
    channels: storedChannels ? channels : ['in_app'],
    recipientIds: boundedIds(source.recipientIds),
    groupIds: boundedIds(source.groupIds),
    audienceIds: boundedIds(source.audienceIds),
    groupName: boundedString(source.groupName, MAX_GROUP_NAME_LENGTH),
    groupMemberIds: boundedIds(source.groupMemberIds),
    csvPreview: parseCsvPreview(source.csvPreview),
    csvFileName: boundedString(source.csvFileName, MAX_FILE_NAME_LENGTH),
  }
  return isNotificationPublisherDraftDirty(draft) ? draft : null
}

export function loadRecoverableNotificationPublisherDraft(
  scope: ResidentDraftScope,
  storage?: DraftStorage,
) {
  return readDraft(notificationPublisherDraftStorageKey(scope), parseNotificationPublisherDraft, storage)
}

export function saveRecoverableNotificationPublisherDraft(
  scope: ResidentDraftScope,
  draft: RecoverableNotificationPublisherDraft,
  storage?: DraftStorage,
) {
  const ids = [draft.recipientIds, draft.groupIds, draft.audienceIds, draft.groupMemberIds]
  if (
    draft.title.length > MAX_TITLE_LENGTH
    || draft.body.length > MAX_BODY_LENGTH
    || draft.groupName.length > MAX_GROUP_NAME_LENGTH
    || draft.csvFileName.length > MAX_FILE_NAME_LENGTH
    || ids.some((items) => items.length > MAX_DRAFT_IDS || items.some((id) => id.length > MAX_ID_LENGTH))
    || (draft.csvPreview?.groups.length ?? 0) > MAX_CSV_GROUPS
  ) return false
  if (!isNotificationPublisherDraftDirty(draft)) {
    return clearDraft(notificationPublisherDraftStorageKey(scope), storage)
  }
  return writeDraft(notificationPublisherDraftStorageKey(scope), draft, storage)
}

export function clearRecoverableNotificationPublisherDraft(
  scope: ResidentDraftScope,
  storage?: DraftStorage,
) {
  return clearDraft(notificationPublisherDraftStorageKey(scope), storage)
}

function parseGuidanceDraft(value: unknown): RecoverableGuidanceMessageDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const draft = {
    title: boundedString(source.title, MAX_TITLE_LENGTH),
    body: boundedString(source.body, MAX_BODY_LENGTH),
  }
  return draft.title.trim() || draft.body.trim() ? draft : null
}

export function loadRecoverableGuidanceMessageDraft(
  scope: GuidanceMessageDraftScope,
  storage?: DraftStorage,
) {
  return readDraft(guidanceMessageDraftStorageKey(scope), parseGuidanceDraft, storage)
}

export function saveRecoverableGuidanceMessageDraft(
  scope: GuidanceMessageDraftScope,
  draft: RecoverableGuidanceMessageDraft,
  storage?: DraftStorage,
) {
  if (draft.title.length > MAX_TITLE_LENGTH || draft.body.length > MAX_BODY_LENGTH) return false
  if (!draft.title.trim() && !draft.body.trim()) {
    return clearDraft(guidanceMessageDraftStorageKey(scope), storage)
  }
  return writeDraft(guidanceMessageDraftStorageKey(scope), draft, storage)
}

export function clearRecoverableGuidanceMessageDraft(
  scope: GuidanceMessageDraftScope,
  storage?: DraftStorage,
) {
  return clearDraft(guidanceMessageDraftStorageKey(scope), storage)
}

function parseTeamBulkInviteDraft(value: unknown): RecoverableTeamBulkInviteDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (typeof source.text !== 'string' || source.text.length > MAX_BULK_INVITE_TEXT_LENGTH) return null
  const text = source.text
  if (!text.trim()) return null
  return {
    text,
    fileName: boundedString(source.fileName, MAX_FILE_NAME_LENGTH),
  }
}

export function loadRecoverableTeamBulkInviteDraft(
  scope: ResidentDraftScope,
  storage?: DraftStorage,
) {
  return readDraft(teamBulkInviteDraftStorageKey(scope), parseTeamBulkInviteDraft, storage)
}

export function saveRecoverableTeamBulkInviteDraft(
  scope: ResidentDraftScope,
  draft: RecoverableTeamBulkInviteDraft,
  storage?: DraftStorage,
) {
  if (draft.text.length > MAX_BULK_INVITE_TEXT_LENGTH || draft.fileName.length > MAX_FILE_NAME_LENGTH) return false
  if (!draft.text.trim()) return clearDraft(teamBulkInviteDraftStorageKey(scope), storage)
  return writeDraft(teamBulkInviteDraftStorageKey(scope), draft, storage)
}

export function clearRecoverableTeamBulkInviteDraft(
  scope: ResidentDraftScope,
  storage?: DraftStorage,
) {
  return clearDraft(teamBulkInviteDraftStorageKey(scope), storage)
}
