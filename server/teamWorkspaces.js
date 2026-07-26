import {
  isTeacherAssignedToStudent,
  teamMemberTeacherIds,
} from './teamRelationships.js'

export function scopeTeamMembersForViewer(members, viewerUserId, viewerRole) {
  if (viewerRole === 'owner') return members
  const viewerMembership = members.find((member) => member.userId === viewerUserId)
  const studentTeacherIds = viewerMembership?.role === 'member'
    ? new Set(teamMemberTeacherIds(viewerMembership))
    : new Set()
  return members.filter((member) => (
    member.role === 'owner' ||
    member.userId === viewerUserId ||
    (viewerRole === 'admin' && member.role === 'admin') ||
    (viewerRole === 'admin' && isTeacherAssignedToStudent(member, viewerUserId)) ||
    (viewerMembership?.role === 'member' && Boolean(member.userId && studentTeacherIds.has(member.userId)))
  ))
}

function appendGrouped(map, key, value) {
  const current = map.get(key)
  if (current) {
    current.push(value)
  } else {
    map.set(key, [value])
  }
}

/**
 * Build the compact workspace switcher payload without calculating the much
 * larger team command-center summary for every accessible team.
 */
export function buildTeamWorkspaceOptions({
  teams,
  viewerUser,
  applications,
  members,
  isSystemAdmin = false,
}) {
  const teamIds = new Set(teams.map((team) => team.id))
  const membersByTeamId = new Map()
  const applicationsByTeamId = new Map()
  const pendingTransfersByTeamId = new Map()

  for (const member of members) {
    if (teamIds.has(member.teamId)) appendGrouped(membersByTeamId, member.teamId, member)
  }

  for (const application of applications) {
    if (teamIds.has(application.teamId)) {
      appendGrouped(applicationsByTeamId, application.teamId, application)
    }
    const transfer = application.teamTransferRequest
    if (transfer?.status === 'pending' && teamIds.has(transfer.teamId)) {
      appendGrouped(pendingTransfersByTeamId, transfer.teamId, application)
    }
  }

  return teams.map((team) => {
    const teamMembers = membersByTeamId.get(team.id) ?? []
    const viewerMembership = teamMembers.find((member) => member.userId === viewerUser.id) ?? null
    const viewerRole = isSystemAdmin || viewerUser.id === team.ownerId
      ? 'owner'
      : viewerMembership?.role ?? null
    const scopedMembers = scopeTeamMembersForViewer(teamMembers, viewerUser.id, viewerRole)
    const scopedOwnerIds = new Set(scopedMembers
      .filter((member) => member.role === 'member')
      .map((member) => member.userId)
      .filter(Boolean))
    if (viewerRole === 'member') scopedOwnerIds.add(viewerUser.id)

    const applicationCount = (applicationsByTeamId.get(team.id) ?? [])
      .reduce((count, application) => count + Number(scopedOwnerIds.has(application.ownerId)), 0)
    const pendingTransferCount = (pendingTransfersByTeamId.get(team.id) ?? [])
      .reduce((count, application) => count + Number(scopedOwnerIds.has(application.ownerId)), 0)

    return {
      teamId: team.id,
      name: team.name,
      ownerId: team.ownerId,
      viewerRole,
      membershipId: viewerMembership?.id ?? null,
      memberCount: scopedMembers.length,
      applicationCount,
      pendingTransferCount,
      updatedAt: team.updatedAt,
    }
  })
}
