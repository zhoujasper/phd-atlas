import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDENT_PERMISSIONS,
  DEFAULT_TEACHER_PERMISSIONS,
  incrementTeamMemberUsage,
  mergeTeamMemberPermissions,
  normalizeStudentPermissions,
  normalizeTeamMemberRelationships,
} from './teamPermissions.js'

describe('team member permissions', () => {
  it('keeps safe role defaults while preserving existing relationship data', () => {
    expect(normalizeTeamMemberRelationships({ teacherIds: ['teacher-a'] }, 'member')).toEqual({
      teacherIds: ['teacher-a'],
      studentPermissions: DEFAULT_STUDENT_PERMISSIONS,
      usage: { applicationsCreated: 0, sharesCreated: 0 },
    })
    expect(normalizeTeamMemberRelationships({}, 'admin').teacherPermissions).toEqual(DEFAULT_TEACHER_PERMISSIONS)
  })

  it('normalizes optional limits and merges partial permission updates', () => {
    expect(normalizeStudentPermissions({
      useDiscover: true,
      activeApplicationLimit: 0,
      lifetimeApplicationLimit: 100_000,
      activeShareLimit: '',
    })).toMatchObject({
      useDiscover: true,
      activeApplicationLimit: 1,
      lifetimeApplicationLimit: 10_000,
      activeShareLimit: null,
    })

    const merged = mergeTeamMemberPermissions({
      studentPermissions: {
        editApplications: false,
        activeApplicationLimit: 8,
      },
    }, 'member', {
      studentPermissions: { useDiscover: true },
    })
    expect(merged.studentPermissions).toMatchObject({
      editApplications: false,
      useDiscover: true,
      activeApplicationLimit: 8,
    })
  })

  it('increments lifetime usage without resetting the other counter', () => {
    const next = incrementTeamMemberUsage({
      usage: { applicationsCreated: 3, sharesCreated: 7 },
    }, 'member', 'applicationsCreated')
    expect(next.usage).toEqual({ applicationsCreated: 4, sharesCreated: 7 })
  })
})
