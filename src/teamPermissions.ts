import type {
  TeamMember,
  TeamMemberRelationships,
  TeamPermissionDefaults,
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

export function teamPermissionDefaults(
  value?: Partial<{
    student: Partial<TeamStudentPermissions>
    teacher: Partial<TeamTeacherPermissions>
  }> | null,
): TeamPermissionDefaults {
  const student = value?.student
  return {
    student: {
      ...DEFAULT_TEAM_STUDENT_PERMISSIONS,
      ...(student ?? {}),
      activeApplicationLimit: student?.activeApplicationLimit === undefined
        ? DEFAULT_TEAM_STUDENT_PERMISSIONS.activeApplicationLimit
        : normalizedOptionalLimit(student.activeApplicationLimit),
      lifetimeApplicationLimit: student?.lifetimeApplicationLimit === undefined
        ? DEFAULT_TEAM_STUDENT_PERMISSIONS.lifetimeApplicationLimit
        : normalizedOptionalLimit(student.lifetimeApplicationLimit),
      activeShareLimit: student?.activeShareLimit === undefined
        ? DEFAULT_TEAM_STUDENT_PERMISSIONS.activeShareLimit
        : normalizedOptionalLimit(student.activeShareLimit),
      lifetimeShareLimit: student?.lifetimeShareLimit === undefined
        ? DEFAULT_TEAM_STUDENT_PERMISSIONS.lifetimeShareLimit
        : normalizedOptionalLimit(student.lifetimeShareLimit),
    },
    teacher: {
      ...DEFAULT_TEAM_TEACHER_PERMISSIONS,
      ...(value?.teacher ?? {}),
    },
  }
}

export function teamStudentPermissions(
  relationships?: TeamMemberRelationships | null,
  defaults?: TeamPermissionDefaults | null,
): TeamStudentPermissions {
  const candidate = relationships?.studentPermissions
  const roleDefaults = teamPermissionDefaults(defaults).student
  return {
    ...roleDefaults,
    ...(candidate ?? {}),
    activeApplicationLimit: candidate?.activeApplicationLimit === undefined
      ? roleDefaults.activeApplicationLimit
      : normalizedOptionalLimit(candidate.activeApplicationLimit),
    lifetimeApplicationLimit: candidate?.lifetimeApplicationLimit === undefined
      ? roleDefaults.lifetimeApplicationLimit
      : normalizedOptionalLimit(candidate.lifetimeApplicationLimit),
    activeShareLimit: candidate?.activeShareLimit === undefined
      ? roleDefaults.activeShareLimit
      : normalizedOptionalLimit(candidate.activeShareLimit),
    lifetimeShareLimit: candidate?.lifetimeShareLimit === undefined
      ? roleDefaults.lifetimeShareLimit
      : normalizedOptionalLimit(candidate.lifetimeShareLimit),
  }
}

export function teamTeacherPermissions(
  relationships?: TeamMemberRelationships | null,
  defaults?: TeamPermissionDefaults | null,
): TeamTeacherPermissions {
  return {
    ...teamPermissionDefaults(defaults).teacher,
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
  defaults?: TeamPermissionDefaults | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') return teamTeacherPermissions(membership?.relationships, defaults).useDiscover
  if (role === 'member') return teamStudentPermissions(membership?.relationships, defaults).useDiscover
  return false
}

export function canCreateTeamApplication(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
  defaults?: TeamPermissionDefaults | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') {
    return teamTeacherPermissions(membership?.relationships, defaults).createStudentApplications
  }
  if (role === 'member') {
    return teamStudentPermissions(membership?.relationships, defaults).createApplications
  }
  return false
}

export function canEditTeamApplication(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
  defaults?: TeamPermissionDefaults | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') {
    return teamTeacherPermissions(membership?.relationships, defaults).editStudentApplications
  }
  if (role === 'member') {
    return teamStudentPermissions(membership?.relationships, defaults).editApplications
  }
  return false
}

export function canCreateTeamShare(
  role: TeamRole | null | undefined,
  membership?: TeamMember | null,
  defaults?: TeamPermissionDefaults | null,
): boolean {
  if (role === 'owner') return true
  if (role === 'admin') {
    return teamTeacherPermissions(membership?.relationships, defaults).manageStudentShares
  }
  if (role === 'member') {
    return teamStudentPermissions(membership?.relationships, defaults).createShareLinks
  }
  return false
}
