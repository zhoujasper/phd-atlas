import { describe, expect, it } from 'vitest'
import type { TeamMember } from '../../api/phdApi'
import {
  MAX_TEAM_BULK_INVITE_ROWS,
  buildTeamBulkInvitePreview,
  createTeamBulkInviteTemplate,
} from './teamBulkInviteModel'

function teacher(overrides: Partial<TeamMember>): TeamMember {
  return {
    id: 'member_teacher',
    teamId: 'team_example',
    userId: 'user_teacher',
    displayName: 'Dr. Mei Chen',
    invitedEmail: 'mei@example.edu',
    role: 'admin',
    status: 'active',
    invitedBy: 'user_owner',
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:00.000Z',
    ...overrides,
  }
}

const teachers = [
  teacher({ id: 'member_mei', userId: 'user_mei', displayName: 'Dr. Mei Chen' }),
  teacher({
    id: 'member_alex',
    userId: 'user_alex',
    displayName: 'Prof. Alex Rivera',
    invitedEmail: 'alex@example.edu',
  }),
]

describe('team bulk invite model', () => {
  it('resolves multiple responsible teachers by name and stable User ID', () => {
    const preview = buildTeamBulkInvitePreview(
      [
        'email,role,responsible_teachers',
        'student@example.edu,student,"Dr. Mei Chen | user_alex"',
        'teacher@example.edu,teacher,',
      ].join('\r\n'),
      teachers,
    )

    expect(preview.invalidRows).toHaveLength(0)
    expect(preview.validRows).toHaveLength(2)
    expect(preview.rows[0]).toMatchObject({
      lineNumber: 2,
      email: 'student@example.edu',
      role: 'member',
      teacherMemberIds: ['member_mei', 'member_alex'],
      teacherNames: ['Dr. Mei Chen', 'Prof. Alex Rivera'],
    })
    expect(preview.rows[1]).toMatchObject({
      role: 'admin',
      teacherMemberIds: [],
    })
  })

  it('resolves responsible teachers by email without case sensitivity', () => {
    const preview = buildTeamBulkInvitePreview(
      'student@example.edu,student," MEI@EXAMPLE.EDU | alex@example.edu "',
      teachers,
    )

    expect(preview.invalidRows).toHaveLength(0)
    expect(preview.rows[0]).toMatchObject({
      teacherMemberIds: ['member_mei', 'member_alex'],
      teacherNames: ['Dr. Mei Chen', 'Prof. Alex Rivera'],
    })
  })

  it('accepts headerless and localized role rows', () => {
    const preview = buildTeamBulkInvitePreview(
      'student@example.edu,学生,user_mei',
      teachers,
    )

    expect(preview.invalidRows).toHaveLength(0)
    expect(preview.rows[0]).toMatchObject({
      role: 'member',
      teacherMemberIds: ['member_mei'],
    })
  })

  it('reports missing, unknown, ambiguous, duplicate, and malformed values per row', () => {
    const duplicateNames = [
      ...teachers,
      teacher({
        id: 'member_other_mei',
        userId: 'user_other_mei',
        displayName: 'Dr. Mei Chen',
        invitedEmail: 'other-mei@example.edu',
      }),
    ]
    const preview = buildTeamBulkInvitePreview(
      [
        'invalid,student,user_alex',
        'first@example.edu,student,',
        'second@example.edu,student,missing_teacher',
        'third@example.edu,student,Dr. Mei Chen',
        'first@example.edu,student,user_alex',
        'role@example.edu,unknown,user_alex',
      ].join('\n'),
      duplicateNames,
    )

    expect(preview.rows.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      ['invalid-email'],
      ['missing-teachers'],
      ['unknown-teacher'],
      ['ambiguous-teacher'],
      ['duplicate-email'],
      ['invalid-role'],
    ])
  })

  it('blocks roles that are unavailable from a student-only invite entry point', () => {
    const preview = buildTeamBulkInvitePreview(
      'teacher@example.edu,teacher,',
      teachers,
      ['member'],
    )

    expect(preview.validRows).toHaveLength(0)
    expect(preview.rows[0].issues).toEqual([
      { code: 'unavailable-role', value: 'teacher' },
    ])
  })

  it('creates a parseable template tailored to the allowed roles', () => {
    const studentOnly = createTeamBulkInviteTemplate(teachers, ['member'])
    const studentPreview = buildTeamBulkInvitePreview(studentOnly, teachers, ['member'])
    expect(studentOnly).toContain('email,role,responsible_teachers')
    expect(studentOnly).toContain('mei@example.edu | user_alex')
    expect(studentOnly).not.toContain('jordan@school.edu')
    expect(studentPreview.invalidRows).toHaveLength(0)
    expect(studentPreview.rows).toHaveLength(1)

    const fullTemplate = createTeamBulkInviteTemplate(teachers)
    expect(fullTemplate).toContain('jordan@school.edu,teacher,')
  })

  it('bounds each batch without silently accepting truncated records', () => {
    const source = Array.from(
      { length: MAX_TEAM_BULK_INVITE_ROWS + 1 },
      (_, index) => `teacher-${index}@example.edu,teacher,`,
    ).join('\n')
    const preview = buildTeamBulkInvitePreview(source, teachers)

    expect(preview.rows).toHaveLength(MAX_TEAM_BULK_INVITE_ROWS)
    expect(preview.truncatedCount).toBe(1)
  })
})
