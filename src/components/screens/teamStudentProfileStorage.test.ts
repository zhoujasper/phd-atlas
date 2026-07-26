import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultStudentProfileDraft,
  readStoredTeamStudentProfiles,
  writeStoredTeamStudentProfiles,
} from './teamStudentProfileStorage'

const storageKey = 'phd-atlas-team-student-profiles:v1'

describe('team student profile storage', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('retains only complete persisted profile assets', () => {
    window.localStorage.setItem(storageKey, JSON.stringify([
      {
        id: 'profile-1',
        teamId: 'team-1',
        studentUserId: 'student-1',
        kind: 'cv',
        name: 'CV',
        description: 'Latest CV',
        updatedAt: '2026-07-22T10:00:00.000Z',
      },
      { id: 'incomplete' },
    ]))

    expect(readStoredTeamStudentProfiles()).toEqual([
      {
        id: 'profile-1',
        teamId: 'team-1',
        studentUserId: 'student-1',
        kind: 'cv',
        name: 'CV',
        description: 'Latest CV',
        updatedAt: '2026-07-22T10:00:00.000Z',
      },
    ])
  })

  it('round-trips local notes without changing the default draft', () => {
    const items = [{
      id: 'profile-2',
      teamId: 'team-2',
      studentUserId: 'student-2',
      kind: 'statement',
      name: 'Statement',
      description: '',
      updatedAt: '2026-07-22T11:00:00.000Z',
    }]

    writeStoredTeamStudentProfiles(items)

    expect(readStoredTeamStudentProfiles()).toEqual(items)
    expect(defaultStudentProfileDraft).toMatchObject({ name: '', description: '' })
  })
})
