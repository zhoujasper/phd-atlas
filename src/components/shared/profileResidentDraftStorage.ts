import type { AiUserProfile } from '../../api/phdApi'
import { clearVerifiedStorageItem, setVerifiedStorageItem } from '../../verifiedStorage'

const PROFILE_DRAFT_PREFIX = 'phd-atlas-profile-resident-draft:v1'
const AI_PROFILE_FIELDS: Array<keyof AiUserProfile> = [
  'preferredName', 'pronouns', 'location', 'timezone', 'citizenship',
  'currentRole', 'institution', 'degree', 'field', 'graduation',
  'researchInterests', 'researchMethods', 'achievements', 'goals',
  'writingLanguage', 'writingTone', 'signature', 'boundaries',
]
const MAX_PROFILE_FIELD_LENGTH = 4_000
const MAX_PHRASE_FIELD_LENGTH = 4_000

export type RecoverableSnippetPhraseDraft = {
  leadPrimary: string
  tailPrimary: string
  leadSecondary: string
  tailSecondary: string
}

type ProfileDraftKind = 'ai-profile' | 'snippet-phrase'
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storageOrDefault(storage?: DraftStorage) {
  return storage ?? globalThis.sessionStorage
}

function profileDraftKey(userId: string, kind: ProfileDraftKind) {
  return `${PROFILE_DRAFT_PREFIX}:${encodeURIComponent(userId.trim() || 'unknown-user')}:${kind}`
}

function readRecord(userId: string, kind: ProfileDraftKind, storage?: DraftStorage) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return null
    const raw = target.getItem(profileDraftKey(userId, kind))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return record.version === 1 ? record : null
  } catch {
    return null
  }
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function writeRecord(
  userId: string,
  kind: ProfileDraftKind,
  draft: Record<string, unknown>,
  storage?: DraftStorage,
) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return setVerifiedStorageItem(target, profileDraftKey(userId, kind), JSON.stringify({
      version: 1,
      ...draft,
      updatedAt: Date.now(),
    }))
  } catch {
    return false
  }
}

function clearRecord(userId: string, kind: ProfileDraftKind, storage?: DraftStorage) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return clearVerifiedStorageItem(target, profileDraftKey(userId, kind))
  } catch {
    return false
  }
}

export function loadAiProfileDraft(userId: string, storage?: DraftStorage): AiUserProfile | null {
  const record = readRecord(userId, 'ai-profile', storage)
  if (!record) return null
  return Object.fromEntries(AI_PROFILE_FIELDS.map((field) => [
    field,
    boundedString(record[field], MAX_PROFILE_FIELD_LENGTH),
  ])) as AiUserProfile
}

export function saveAiProfileDraft(userId: string, draft: AiUserProfile, storage?: DraftStorage) {
  return writeRecord(userId, 'ai-profile', Object.fromEntries(AI_PROFILE_FIELDS.map((field) => [
    field,
    boundedString(draft[field], MAX_PROFILE_FIELD_LENGTH),
  ])), storage)
}

export function clearAiProfileDraft(userId: string, storage?: DraftStorage) {
  return clearRecord(userId, 'ai-profile', storage)
}

export function loadSnippetPhraseDraft(userId: string, storage?: DraftStorage): RecoverableSnippetPhraseDraft | null {
  const record = readRecord(userId, 'snippet-phrase', storage)
  if (!record) return null
  return {
    leadPrimary: boundedString(record.leadPrimary, MAX_PHRASE_FIELD_LENGTH),
    tailPrimary: boundedString(record.tailPrimary, MAX_PHRASE_FIELD_LENGTH),
    leadSecondary: boundedString(record.leadSecondary, MAX_PHRASE_FIELD_LENGTH),
    tailSecondary: boundedString(record.tailSecondary, MAX_PHRASE_FIELD_LENGTH),
  }
}

export function saveSnippetPhraseDraft(
  userId: string,
  draft: RecoverableSnippetPhraseDraft,
  storage?: DraftStorage,
) {
  return writeRecord(userId, 'snippet-phrase', {
    leadPrimary: boundedString(draft.leadPrimary, MAX_PHRASE_FIELD_LENGTH),
    tailPrimary: boundedString(draft.tailPrimary, MAX_PHRASE_FIELD_LENGTH),
    leadSecondary: boundedString(draft.leadSecondary, MAX_PHRASE_FIELD_LENGTH),
    tailSecondary: boundedString(draft.tailSecondary, MAX_PHRASE_FIELD_LENGTH),
  }, storage)
}

export function clearSnippetPhraseDraft(userId: string, storage?: DraftStorage) {
  return clearRecord(userId, 'snippet-phrase', storage)
}
