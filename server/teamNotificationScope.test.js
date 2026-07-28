import { describe, expect, it } from 'vitest'
import { teamNotificationAllowedMembers } from './index.js'

const members = [
  { id: 'student-member', userId: 'student-user', role: 'member', status: 'active' },
  { id: 'assigned-teacher', userId: 'teacher-assigned', role: 'admin', status: 'active' },
  { id: 'other-teacher', userId: 'teacher-other', role: 'admin', status: 'active' },
  { id: 'owner-member', userId: 'owner-user', role: 'owner', status: 'active' },
  { id: 'other-student', userId: 'other-student-user', role: 'member', status: 'active' },
  { id: 'removed-teacher', userId: 'teacher-removed', role: 'admin', status: 'removed' },
]

describe('student guidance-message recipient scope', () => {
  it('allows only assigned teachers and the active organization owner', () => {
    const allowed = teamNotificationAllowedMembers(
      members,
      'member',
      'student-user',
      {
        id: 'student-member',
        userId: 'student-user',
        role: 'member',
        status: 'active',
        relationships: { teacherIds: ['teacher-assigned'] },
      },
    )

    expect(allowed.map((member) => member.id)).toEqual([
      'assigned-teacher',
      'owner-member',
    ])
  })
})
