import type { TeamMember } from './api/phdApi'

export type TeamMemberRelationshipSource = {
  role?: TeamMember['role']
  invitedBy?: string | null
  relationships?: {
    teacherIds?: readonly unknown[]
  }
}

function uniqueStrings(values: readonly unknown[]) {
  return Array.from(new Set(
    values
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  ))
}

/**
 * `invitedBy` is the legacy single-teacher fallback. Once teacherIds exists,
 * including as an empty array, it is the authoritative collaboration team.
 */
export function teamMemberTeacherIds(member: TeamMemberRelationshipSource | null | undefined) {
  const relationships = member?.relationships
  if (
    relationships
    && Object.prototype.hasOwnProperty.call(relationships, 'teacherIds')
  ) {
    return uniqueStrings(relationships.teacherIds ?? [])
  }
  return member?.invitedBy ? [member.invitedBy] : []
}

export function isTeacherAssignedToStudent(
  member: TeamMemberRelationshipSource | null | undefined,
  teacherUserId: string | null | undefined,
) {
  return Boolean(
    member?.role === 'member'
    && teacherUserId
    && teamMemberTeacherIds(member).includes(teacherUserId),
  )
}

export function teachersForStudent(
  member: TeamMember | null | undefined,
  membersByUserId: ReadonlyMap<string, TeamMember>,
) {
  return teamMemberTeacherIds(member)
    .map((userId) => membersByUserId.get(userId))
    .filter((teacher): teacher is TeamMember => Boolean(teacher))
}

export function primaryTeacherForStudent(
  member: TeamMember | null | undefined,
  membersByUserId: ReadonlyMap<string, TeamMember>,
) {
  return teachersForStudent(member, membersByUserId)[0] ?? null
}
