import type { AuthSession, TeamMemberRelationships, TeamRole } from '../../api/phdApi'
import type { InterfaceMode } from '../../appModel'
import { isTeacherAssignedToStudent } from '../../teamRelationships'
import { teamStudentPermissions, teamTeacherPermissions } from '../../teamPermissions'

type DiscoverSession = Pick<AuthSession, 'usage' | 'user'> | null | undefined

/**
 * Team membership is not a personal Pro entitlement. A team owner, teacher, or
 * student may still have a separate personal Pro plan, which is the only plan
 * that unlocks Discover in the personal workspace.
 */
export function hasPersonalDiscoverAccess(session: DiscoverSession) {
  if (!session) return false
  const settings = session.user.settings
  if (settings.personalMembershipPlan) return settings.personalMembershipPlan === 'pro'
  if (settings.membershipPlan === 'pro') return true
  return session.usage?.plan === 'pro'
}

export function hasTeamDiscoverAccess(
  role: TeamRole | null | undefined,
  relationships?: TeamMemberRelationships | null,
) {
  if (role === 'owner') return true
  if (role === 'admin') return teamTeacherPermissions(relationships).useDiscover
  if (role === 'member') return teamStudentPermissions(relationships).useDiscover
  return false
}

export function discoverStudentMembers<TMember extends {
  status: string
  role: TeamRole
  userId: string | null
  invitedBy?: string | null
  relationships?: {
    teacherIds?: readonly unknown[]
  }
}>(members: readonly TMember[], role: TeamRole | null | undefined, actorId: string | null | undefined) {
  return members.filter((member) => (
    member.status === 'active'
    && member.role === 'member'
    && Boolean(member.userId)
    && (
      role === 'owner'
      || (role === 'admin' && isTeacherAssignedToStudent(member, actorId))
      || (role === 'member' && member.userId === actorId)
    )
  ))
}

export function canAccessDiscover(
  mode: InterfaceMode,
  session: DiscoverSession,
  teamRole: TeamRole | null | undefined,
  relationships?: TeamMemberRelationships | null,
) {
  return mode === 'team'
    ? hasTeamDiscoverAccess(teamRole, relationships)
    : hasPersonalDiscoverAccess(session)
}
