import { describe, expect, it } from 'vitest'
import type { TeamMember } from './api/phdApi'
import {
  isTeacherAssignedToStudent,
  primaryTeacherForStudent,
  teamMemberTeacherIds,
  teachersForStudent,
} from './teamRelationships'

const member = (input: Partial<TeamMember>): TeamMember => ({
  id: input.id ?? 'member',
  teamId: 'team',
  userId: input.userId ?? null,
  invitedEmail: input.invitedEmail ?? '',
  role: input.role ?? 'member',
  status: input.status ?? 'active',
  invitedBy: input.invitedBy ?? '',
  relationships: input.relationships,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
})

describe('team relationship client model', () => {
  it('resolves multiple teachers in the stored order', () => {
    const student = member({
      invitedBy: 'teacher_legacy',
      relationships: { teacherIds: ['teacher_2', 'teacher_1', 'teacher_2'] },
    })
    const teacher1 = member({ id: 'm1', userId: 'teacher_1', role: 'admin' })
    const teacher2 = member({ id: 'm2', userId: 'teacher_2', role: 'admin' })
    const directory = new Map([
      ['teacher_1', teacher1],
      ['teacher_2', teacher2],
    ])

    expect(teamMemberTeacherIds(student)).toEqual(['teacher_2', 'teacher_1'])
    expect(teachersForStudent(student, directory)).toEqual([teacher2, teacher1])
    expect(primaryTeacherForStudent(student, directory)).toBe(teacher2)
    expect(isTeacherAssignedToStudent(student, 'teacher_1')).toBe(true)
  })

  it('does not revive invitedBy after an explicit unassignment', () => {
    const student = member({
      invitedBy: 'teacher_legacy',
      relationships: { teacherIds: [] },
    })
    expect(teamMemberTeacherIds(student)).toEqual([])
    expect(isTeacherAssignedToStudent(student, 'teacher_legacy')).toBe(false)
  })
})
