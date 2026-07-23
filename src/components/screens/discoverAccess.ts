import type { AuthSession, TeamRole } from '../../api/phdApi'
import type { InterfaceMode } from '../../appModel'

/** Public-edition compatibility boundary; only personal Discover entitlement is available. */
type DiscoverSession = Pick<AuthSession, 'usage' | 'user'> | null | undefined
export function hasPersonalDiscoverAccess(session: DiscoverSession) {
  if (!session) return false
  const settings = session.user.settings
  if (settings.personalMembershipPlan) return settings.personalMembershipPlan === 'pro'
  if (settings.membershipPlan === 'pro') return true
  return session.usage?.plan === 'pro'
}
export function hasTeamDiscoverAccess(_role: TeamRole | null | undefined) { return false }
export function discoverStudentMembers<TMember>(
  _members: readonly TMember[],
  _role: TeamRole | null | undefined,
  _actorId: string | null | undefined,
): TMember[] { return [] }
export function canAccessDiscover(
  mode: InterfaceMode,
  session: DiscoverSession,
  _teamRole: TeamRole | null | undefined,
) { return mode !== 'team' && hasPersonalDiscoverAccess(session) }
