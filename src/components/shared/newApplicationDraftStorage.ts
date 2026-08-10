import { clearVerifiedStorageItem, setVerifiedStorageItem } from '../../verifiedStorage'
import type { NewApplicationTeamMode } from './NewApplicationDialog'

const NEW_APPLICATION_DRAFT_PREFIX = 'phd-atlas-new-application-draft:v1'
const MAX_SHORT_FIELD_LENGTH = 2_000
const MAX_NOTES_LENGTH = 20_000

export type NewApplicationDraftScope = {
  userId: string
  workspaceId: string
  teamMode: NewApplicationTeamMode
}

export type RecoverableNewApplicationDraft = {
  professor: string
  professorChinese: string
  professorEmail: string
  professorHomepage: string
  university: string
  country: string
  website: string
  program: string
  deadline: string
  notes: string
  visibleToTeam: boolean
  ownerId: string
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function scopePart(value: string, fallback: string) {
  const normalized = value.trim()
  return encodeURIComponent(normalized || fallback)
}

export function newApplicationDraftStorageKey(scope: NewApplicationDraftScope) {
  return [
    NEW_APPLICATION_DRAFT_PREFIX,
    scopePart(scope.userId, 'unknown-user'),
    scopePart(scope.workspaceId, 'personal'),
    scopePart(scope.teamMode, 'none'),
  ].join(':')
}

function boundedString(value: unknown, maxLength = MAX_SHORT_FIELD_LENGTH) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function parseDraft(value: unknown): RecoverableNewApplicationDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1) return null
  return {
    professor: boundedString(record.professor),
    professorChinese: boundedString(record.professorChinese),
    professorEmail: boundedString(record.professorEmail),
    professorHomepage: boundedString(record.professorHomepage),
    university: boundedString(record.university),
    country: boundedString(record.country),
    website: boundedString(record.website),
    program: boundedString(record.program),
    deadline: boundedString(record.deadline, 64),
    notes: boundedString(record.notes, MAX_NOTES_LENGTH),
    visibleToTeam: record.visibleToTeam === true,
    ownerId: boundedString(record.ownerId, 512),
  }
}

function storageOrDefault(storage?: DraftStorage) {
  return storage ?? globalThis.sessionStorage
}

export function loadRecoverableNewApplicationDraft(
  scope: NewApplicationDraftScope,
  storage?: DraftStorage,
) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return null
    const raw = target.getItem(newApplicationDraftStorageKey(scope))
    return raw ? parseDraft(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveRecoverableNewApplicationDraft(
  scope: NewApplicationDraftScope,
  draft: RecoverableNewApplicationDraft,
  storage?: DraftStorage,
) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return setVerifiedStorageItem(target, newApplicationDraftStorageKey(scope), JSON.stringify({
      version: 1,
      ...draft,
      updatedAt: Date.now(),
    }))
  } catch {
    return false
  }
}

export function clearRecoverableNewApplicationDraft(
  scope: NewApplicationDraftScope,
  storage?: DraftStorage,
) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return clearVerifiedStorageItem(target, newApplicationDraftStorageKey(scope))
  } catch {
    return false
  }
}
