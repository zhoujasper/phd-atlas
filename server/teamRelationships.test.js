import { describe, expect, it } from 'vitest'
import {
  isTeacherAssignedToStudent,
  normalizeTeamTeacherGroups,
  teamMemberTeacherIds,
  withTeamMemberTeacherIds,
} from './teamRelationships.js'

describe('team member teacher relationships', () => {
  it('keeps the legacy invitedBy teacher until an explicit assignment exists', () => {
    expect(teamMemberTeacherIds({ role: 'member', invitedBy: 'teacher_1', relationships: {} }))
      .toEqual(['teacher_1'])
    expect(teamMemberTeacherIds({
      role: 'member',
      invitedBy: 'teacher_1',
      relationships: { teacherIds: ['teacher_2', 'teacher_2', 'teacher_3'] },
    })).toEqual(['teacher_2', 'teacher_3'])
  })

  it('treats an explicit empty teacher list as intentionally unassigned', () => {
    const member = {
      role: 'member',
      invitedBy: 'teacher_1',
      relationships: withTeamMemberTeacherIds({}, []),
    }
    expect(teamMemberTeacherIds(member)).toEqual([])
    expect(isTeacherAssignedToStudent(member, 'teacher_1')).toBe(false)
  })

  it('normalizes durable teacher groups without duplicate ids or names', () => {
    expect(normalizeTeamTeacherGroups([
      { id: 'writing', name: 'Writing', memberIds: ['teacher_1', 'teacher_1'] },
      { id: 'duplicate-name', name: ' writing ', memberIds: ['teacher_2'] },
      { id: 'external', name: 'External affairs', memberIds: ['teacher_2'] },
    ])).toEqual([
      {
        id: 'writing',
        name: 'Writing',
        memberIds: ['teacher_1'],
        createdBy: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'external',
        name: 'External affairs',
        memberIds: ['teacher_2'],
        createdBy: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })
})
