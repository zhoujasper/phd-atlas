import type { TeamMember } from './api/phdApi'

/** Public-edition compatibility boundary; Team relationships are unavailable. */
export type TeamMemberRelationshipSource = {
  role?: TeamMember['role']
  invitedBy?: string | null
  relationships?: { teacherIds?: readonly unknown[] }
}
export function teamMemberTeacherIds(_member: TeamMemberRelationshipSource | null | undefined): string[] { return [] }
export function isTeacherAssignedToStudent(
  _member: TeamMemberRelationshipSource | null | undefined,
  _teacherUserId: string | null | undefined,
) { return false }
export function teachersForStudent(
  _member: TeamMember | null | undefined,
  _membersByUserId: ReadonlyMap<string, TeamMember>,
): TeamMember[] { return [] }
export function primaryTeacherForStudent(
  _member: TeamMember | null | undefined,
  _membersByUserId: ReadonlyMap<string, TeamMember>,
): TeamMember | null { return null }
