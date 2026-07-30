import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDENT_PERMISSIONS,
  DEFAULT_TEACHER_PERMISSIONS,
  incrementTeamMemberUsage,
  mergeTeamMemberPermissions,
  normalizeStudentPermissions,
  normalizeTeamMemberRelationships,
  normalizeTeamPermissionDefaults,
} from './teamPermissions.js'

describe('team member permissions', () => {
  it('keeps new members on sparse role overrides while preserving relationship data', () => {
    expect(normalizeTeamMemberRelationships({ teacherIds: ['teacher-a'] }, 'member')).toEqual({
      teacherIds: ['teacher-a'],
      permissionOverridesVersion: 1,
      usage: { applicationsCreated: 0, sharesCreated: 0 },
    })
    expect(normalizeTeamMemberRelationships({}, 'admin')).toEqual({
      permissionOverridesVersion: 1,
      usage: { applicationsCreated: 0, sharesCreated: 0 },
    })
  })

  it('normalizes configurable team defaults with unlimited student usage by default', () => {
    expect(normalizeTeamPermissionDefaults({
      student: { useDiscover: true, activeApplicationLimit: 4 },
      teacher: { inviteStudents: false },
    })).toEqual({
      student: {
        ...DEFAULT_STUDENT_PERMISSIONS,
        useDiscover: true,
        activeApplicationLimit: 4,
      },
      teacher: {
        ...DEFAULT_TEACHER_PERMISSIONS,
        inviteStudents: false,
      },
    })
  })

  it('merges sparse personal overrides over the selected team defaults', () => {
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
    expect(merged.studentPermissions).toEqual({
      editApplications: false,
      useDiscover: true,
      activeApplicationLimit: 8,
    })
    expect(normalizeStudentPermissions(
      merged.studentPermissions,
      {
        ...DEFAULT_STUDENT_PERMISSIONS,
        createApplications: false,
      },
    )).toMatchObject({
      editApplications: false,
      createApplications: false,
      useDiscover: true,
      activeApplicationLimit: 8,
    })
  })

  it('compacts legacy full permission snapshots so future team defaults still flow through', () => {
    expect(normalizeTeamMemberRelationships({
      accessLevel: 'standard',
      studentPermissions: {
        ...DEFAULT_STUDENT_PERMISSIONS,
        editApplications: false,
      },
    }, 'member')).toEqual({
      studentPermissions: { editApplications: false },
      permissionOverridesVersion: 1,
      usage: { applicationsCreated: 0, sharesCreated: 0 },
    })
  })

  it('resets a member to team defaults without dropping usage or teacher assignments', () => {
    const reset = mergeTeamMemberPermissions({
      teacherIds: ['teacher-a'],
      permissionOverridesVersion: 1,
      studentPermissions: { useDiscover: true },
      usage: { applicationsCreated: 2, sharesCreated: 1 },
    }, 'member', {
      studentPermissions: null,
    })
    expect(reset).toEqual({
      teacherIds: ['teacher-a'],
      permissionOverridesVersion: 1,
      usage: { applicationsCreated: 2, sharesCreated: 1 },
    })
  })

  it('increments lifetime usage without resetting the other counter', () => {
    const next = incrementTeamMemberUsage({
      usage: { applicationsCreated: 3, sharesCreated: 7 },
    }, 'member', 'applicationsCreated')
    expect(next.usage).toEqual({ applicationsCreated: 4, sharesCreated: 7 })
  })
})
