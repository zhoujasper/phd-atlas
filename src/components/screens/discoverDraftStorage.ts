import type { DiscoverIntake, DiscoverRankerWeights } from '../../data/discover'
import { clearVerifiedStorageItem, setVerifiedStorageItem } from '../../verifiedStorage'

const DISCOVER_DRAFT_PREFIX = 'phd-atlas-discover-draft:v1'
const MAX_DRAFT_NOTE_COUNT = 400
const MAX_DRAFT_NOTE_LENGTH = 4_000

export type DiscoverDraftScope = {
  userId: string
  applicationIds: readonly string[]
  teamId?: string | null
  targetUserId?: string | null
}

export type RecoverableDiscoverDraft = {
  intake: DiscoverIntake | null
  ranker: DiscoverRankerWeights | null
  programNotes: Record<string, string>
  piNotes: Record<string, string>
  dirtyProgramNoteIds: string[]
  dirtyPiNoteIds: string[]
  updatedAt: number
}

type DiscoverDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function cleanScopePart(value: string | null | undefined, fallback: string) {
  const normalized = String(value || '').trim()
  return encodeURIComponent(normalized || fallback)
}

export function discoverDraftStorageKey(scope: DiscoverDraftScope) {
  const applicationScope = [...new Set(scope.applicationIds.map((id) => String(id || '').trim()).filter(Boolean))]
    .sort()
    .join('\u001f')
  return [
    DISCOVER_DRAFT_PREFIX,
    cleanScopePart(scope.userId, 'unknown-user'),
    cleanScopePart(scope.teamId, 'personal'),
    cleanScopePart(scope.targetUserId, 'self'),
    stableHash(applicationScope || 'no-applications'),
  ].join(':')
}

export function opaqueDiscoverDraftUserId(token: string) {
  return `opaque-${stableHash(token)}`
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecoverableIntake(value: unknown): value is DiscoverIntake {
  if (!value || typeof value !== 'object') return false
  const intake = value as Partial<DiscoverIntake>
  return typeof intake.field === 'string'
    && isStringArray(intake.subfields)
    && isStringArray(intake.regions)
    && typeof intake.stipendFloor === 'number'
    && Number.isFinite(intake.stipendFloor)
    && typeof intake.currency === 'string'
    && typeof intake.nPrograms === 'number'
    && Number.isFinite(intake.nPrograms)
    && typeof intake.nPisPerProgram === 'number'
    && Number.isFinite(intake.nPisPerProgram)
    && isStringArray(intake.piPreferences)
    && ['strong', 'moderate', 'neutral'].includes(String(intake.risingStarBias))
    && typeof intake.notes === 'string'
    && isStringArray(intake.interestTags)
    && typeof intake.notifyMatches === 'boolean'
    && typeof intake.notifyDeadlines === 'boolean'
    && (intake.seedPrograms === undefined || isStringArray(intake.seedPrograms))
}

function isRecoverableRanker(value: unknown): value is DiscoverRankerWeights {
  if (!value || typeof value !== 'object') return false
  const ranker = value as Partial<DiscoverRankerWeights>
  return ['fit', 'stipend', 'city', 'advisorDensity', 'topics'].every((key) => {
    const score = ranker[key as keyof DiscoverRankerWeights]
    return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
  })
}

function recoverNoteIds(value: unknown) {
  if (!isStringArray(value)) return []
  return [...new Set(value.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_DRAFT_NOTE_COUNT)
}

function recoverNotes(value: unknown, ids: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(ids.flatMap((id) => (
    typeof source[id] === 'string' ? [[id, source[id].slice(0, MAX_DRAFT_NOTE_LENGTH)]] : []
  )))
}

function parseRecoverableDiscoverDraft(value: unknown): RecoverableDiscoverDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<RecoverableDiscoverDraft> & { version?: unknown }
  if (draft.version !== 1 || typeof draft.updatedAt !== 'number' || !Number.isFinite(draft.updatedAt)) return null
  const dirtyProgramNoteIds = recoverNoteIds(draft.dirtyProgramNoteIds)
  const dirtyPiNoteIds = recoverNoteIds(draft.dirtyPiNoteIds)
  const intake = isRecoverableIntake(draft.intake) ? draft.intake : null
  const ranker = isRecoverableRanker(draft.ranker) ? draft.ranker : null
  const programNotes = recoverNotes(draft.programNotes, dirtyProgramNoteIds)
  const piNotes = recoverNotes(draft.piNotes, dirtyPiNoteIds)
  if (!intake && !ranker && !dirtyProgramNoteIds.length && !dirtyPiNoteIds.length) return null
  return {
    intake,
    ranker,
    programNotes,
    piNotes,
    dirtyProgramNoteIds: dirtyProgramNoteIds.filter((id) => Object.hasOwn(programNotes, id)),
    dirtyPiNoteIds: dirtyPiNoteIds.filter((id) => Object.hasOwn(piNotes, id)),
    updatedAt: draft.updatedAt,
  }
}

function storageOrDefault(storage?: DiscoverDraftStorage) {
  return storage ?? globalThis.sessionStorage
}

export function loadRecoverableDiscoverDraft(scope: DiscoverDraftScope, storage?: DiscoverDraftStorage) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return null
    const raw = target.getItem(discoverDraftStorageKey(scope))
    return raw ? parseRecoverableDiscoverDraft(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveRecoverableDiscoverDraft(
  scope: DiscoverDraftScope,
  draft: Omit<RecoverableDiscoverDraft, 'updatedAt'>,
  storage?: DiscoverDraftStorage,
) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    const key = discoverDraftStorageKey(scope)
    const dirtyProgramNoteIds = recoverNoteIds(draft.dirtyProgramNoteIds)
    const dirtyPiNoteIds = recoverNoteIds(draft.dirtyPiNoteIds)
    if (!draft.intake && !draft.ranker && !dirtyProgramNoteIds.length && !dirtyPiNoteIds.length) {
      return clearVerifiedStorageItem(target, key)
    }
    const payload = {
      version: 1,
      intake: draft.intake,
      ranker: draft.ranker,
      programNotes: recoverNotes(draft.programNotes, dirtyProgramNoteIds),
      piNotes: recoverNotes(draft.piNotes, dirtyPiNoteIds),
      dirtyProgramNoteIds,
      dirtyPiNoteIds,
      updatedAt: Date.now(),
    }
    return setVerifiedStorageItem(target, key, JSON.stringify(payload))
  } catch {
    return false
  }
}

export function clearRecoverableDiscoverDraft(scope: DiscoverDraftScope, storage?: DiscoverDraftStorage) {
  try {
    const target = storageOrDefault(storage)
    if (!target) return false
    return clearVerifiedStorageItem(target, discoverDraftStorageKey(scope))
  } catch {
    return false
  }
}
