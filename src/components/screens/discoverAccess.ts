import type { AuthSession, TeamRole } from '../../api/phdApi'
import type { InterfaceMode } from '../../appModel'
import { isTeacherAssignedToStudent } from '../../teamRelationships'

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

export function hasTeamDiscoverAccess(role: TeamRole | null | undefined) {
  return role === 'owner' || role === 'admin'
}

export function discoverStudentMembers<TMember extends {
  status: string
  role: TeamRole
  userId: string | null
  invitedBy?: string | null
  relationships?: { teacherIds?: readonly string[] }
}>(members: readonly TMember[], role: TeamRole | null | undefined, actorId: string | null | undefined) {
  if (!hasTeamDiscoverAccess(role)) return []
  return members.filter((member) => (
    member.status === 'active'
    && member.role === 'member'
    && Boolean(member.userId)
    && (role === 'owner' || isTeacherAssignedToStudent(member, actorId))
  ))
}

export function canAccessDiscover(
  mode: InterfaceMode,
  session: DiscoverSession,
  teamRole: TeamRole | null | undefined,
) {
  return mode === 'team'
    ? hasTeamDiscoverAccess(teamRole)
    : hasPersonalDiscoverAccess(session)
}
