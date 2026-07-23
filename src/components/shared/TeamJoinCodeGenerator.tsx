import type { TeamJoinCode, TeamRole } from '../../api/phdApi'

/** Public-edition compatibility boundary; Team join-code generation is unavailable. */
export function TeamJoinCodeGenerator(_props: {
  roles: TeamRole[]
  teachers: Array<{ id: string; userId: string | null; displayName?: string; invitedEmail: string }>
  defaultRole?: TeamRole
  defaultTeacherIds?: string[]
  onGenerate: (input: { role: TeamRole; teacherIds: string[] }) => Promise<TeamJoinCode>
}) {
  return null
}
