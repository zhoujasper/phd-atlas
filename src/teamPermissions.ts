import type {
  TeamMember,
  TeamMemberRelationships,
  TeamRole,
  TeamStudentPermissions,
  TeamTeacherPermissions,
} from './api/phdApi'

export const DEFAULT_TEAM_STUDENT_PERMISSIONS: Readonly<TeamStudentPermissions> = {
  editApplications: true,
  createApplications: true,
  useDiscover: false,
  createShareLinks: true,
  requestTeamTransfers: true,
  activeApplicationLimit: null,
  lifetimeApplicationLimit: null,
  activeShareLimit: null,
  lifetimeShareLimit: null,
}

export const DEFAULT_TEAM_TEACHER_PERMISSIONS: Readonly<TeamTeacherPermissions> = {
  inviteStudents: true,
  manageStudentPermissions: true,
  useDiscover: true,
  createStudentApplications: true,
  editStudentApplications: true,
  manageStudentShares: true,
}

function normalizedOptionalLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(1, Math.min(10_000, parsed)) : null
}

export function teamStudentPermissions(
  relationships?: TeamMemberRelationships | null,
): TeamStudentPermissions {
  const candidate = relationships?.studentPermissions
  return {
    ...DEFAULT_TEAM_STUDENT_PERMISSIONS,
    ...(candidate ?? {}),
    activeApplicationLimit: normalizedOptionalLimit(candidate?.activeApplicationLimit),
    lifetimeApplicationLimit: normalizedOptionalLimit(candidate?.lifetimeApplicationLimit),
    activeShareLimit: normalizedOptionalLimit(candidate?.activeShareLimit),
    lifetimeShareLimit: normalizedOptionalLimit(candidate?.lifetimeShareLimit),
  }
}

export function teamTeacherPermissions(
  relationships?: TeamMemberRelationships | null,
): TeamTeacherPermissions {
  return {
    ...DEFAULT_TEAM_TEACHER_PERMISSIONS,
    ...(relationships?.teacherPermissions ?? {}),
  }
}

export function teamMemberForUser(
  members: TeamMember[] | undefined,
  userId: string | null | undefined,
): TeamMember | null {
  if (!userId) return null
  return members?.find((member) => member.userId === userId && member.status === 'active') ?? null
}

export function canUseTeamDiscover(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') return teamTeacherPermissions(membership?.relationships).useDiscover
  if (role === 'member') return teamStudentPermissions(membership?.relationships).useDiscover
  return false
}

export function canCreateTeamApplication(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') {
    return teamTeacherPermissions(membership?.relationships).createStudentApplications
  }
  if (role === 'member') {
    return teamStudentPermissions(membership?.relationships).createApplications
  }
  return false
}

export function canEditTeamApplication(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') {
    return teamTeacherPermissions(membership?.relationships).editStudentApplications
  }
  if (role === 'member') {
    return teamStudentPermissions(membership?.relationships).editApplications
  }
  return false
}

export function canCreateTeamShare(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') {
    return teamTeacherPermissions(membership?.relationships).manageStudentShares
  }
  if (role === 'member') {
    return teamStudentPermissions(membership?.relationships).createShareLinks
  }
  return false
}
