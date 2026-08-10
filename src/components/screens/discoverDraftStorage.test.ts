import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_INTAKE, DEFAULT_RANKER } from '../../data/discover'
import {
  clearRecoverableDiscoverDraft,
  discoverDraftStorageKey,
  loadRecoverableDiscoverDraft,
  saveRecoverableDiscoverDraft,
  type DiscoverDraftScope,
} from './discoverDraftStorage'

const baseScope: DiscoverDraftScope = {
  userId: 'user-1',
  applicationIds: ['personal-applications:user-1'],
  teamId: null,
  targetUserId: null,
}

describe('Discover draft recovery storage', () => {
  beforeEach(() => sessionStorage.clear())

  it('isolates drafts by user, application workspace, team, and target student', () => {
    const baseKey = discoverDraftStorageKey(baseScope)
    expect(discoverDraftStorageKey({ ...baseScope, userId: 'user-2' })).not.toBe(baseKey)
    expect(discoverDraftStorageKey({ ...baseScope, applicationIds: ['application-2'] })).not.toBe(baseKey)
    expect(discoverDraftStorageKey({ ...baseScope, teamId: 'team-1' })).not.toBe(baseKey)
    expect(discoverDraftStorageKey({ ...baseScope, targetUserId: 'student-1' })).not.toBe(baseKey)
  })

  it('round-trips only dirty intake, ranker, and note values', () => {
    const intake = { ...DEFAULT_INTAKE, field: 'Phase-field modelling' }
    const ranker = { ...DEFAULT_RANKER, fit: 40 }
    expect(saveRecoverableDiscoverDraft(baseScope, {
      intake,
      ranker,
      programNotes: { 'program-1': 'Keep me', clean: 'Do not persist' },
      piNotes: { 'pi-1': 'Contact after reading paper' },
      dirtyProgramNoteIds: ['program-1'],
      dirtyPiNoteIds: ['pi-1'],
    })).toBe(true)

    expect(loadRecoverableDiscoverDraft(baseScope)).toMatchObject({
      intake,
      ranker,
      programNotes: { 'program-1': 'Keep me' },
      piNotes: { 'pi-1': 'Contact after reading paper' },
      dirtyProgramNoteIds: ['program-1'],
      dirtyPiNoteIds: ['pi-1'],
    })
  })

  it('removes recovery data after every dirty field is durably acknowledged', () => {
    saveRecoverableDiscoverDraft(baseScope, {
      intake: { ...DEFAULT_INTAKE, field: 'AI safety' },
      ranker: null,
      programNotes: {},
      piNotes: {},
      dirtyProgramNoteIds: [],
      dirtyPiNoteIds: [],
    })
    expect(loadRecoverableDiscoverDraft(baseScope)).not.toBeNull()

    expect(saveRecoverableDiscoverDraft(baseScope, {
      intake: null,
      ranker: null,
      programNotes: {},
      piNotes: {},
      dirtyProgramNoteIds: [],
      dirtyPiNoteIds: [],
    })).toBe(true)
    expect(loadRecoverableDiscoverDraft(baseScope)).toBeNull()
  })

  it('fails closed for malformed session data', () => {
    sessionStorage.setItem(discoverDraftStorageKey(baseScope), JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      intake: { field: '<incomplete>' },
      ranker: { fit: 'high' },
      dirtyProgramNoteIds: 'program-1',
    }))
    expect(loadRecoverableDiscoverDraft(baseScope)).toBeNull()
  })

  it('bounds recovered note count and body length to protect sessionStorage quota', () => {
    const ids = Array.from({ length: 450 }, (_, index) => `program-${index}`)
    saveRecoverableDiscoverDraft(baseScope, {
      intake: null,
      ranker: null,
      programNotes: Object.fromEntries(ids.map((id) => [id, 'x'.repeat(4_500)])),
      piNotes: {},
      dirtyProgramNoteIds: ids,
      dirtyPiNoteIds: [],
    })

    const recovered = loadRecoverableDiscoverDraft(baseScope)
    expect(recovered?.dirtyProgramNoteIds).toHaveLength(400)
    expect(recovered?.programNotes['program-0']).toHaveLength(4_000)
    expect(recovered?.programNotes['program-449']).toBeUndefined()
  })

  it('does not acknowledge silent recovery writes or stale deletes', () => {
    const stale = JSON.stringify({ version: 1 })
    const ignoredWrite = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(saveRecoverableDiscoverDraft(baseScope, {
      intake: { ...DEFAULT_INTAKE, field: 'Keep this resident' },
      ranker: null,
      programNotes: {},
      piNotes: {},
      dirtyProgramNoteIds: [],
      dirtyPiNoteIds: [],
    }, ignoredWrite)).toBe(false)

    const ignoredDelete = {
      getItem: () => stale,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(clearRecoverableDiscoverDraft(baseScope, ignoredDelete)).toBe(false)
  })
})
