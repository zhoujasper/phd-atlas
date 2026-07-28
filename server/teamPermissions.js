const MAX_TEAM_MEMBER_LIMIT = 10_000

export const DEFAULT_STUDENT_PERMISSIONS = Object.freeze({
  editApplications: true,
  createApplications: true,
  useDiscover: false,
  createShareLinks: true,
  requestTeamTransfers: true,
  activeApplicationLimit: null,
  lifetimeApplicationLimit: null,
  activeShareLimit: null,
  lifetimeShareLimit: null,
})

export const DEFAULT_TEACHER_PERMISSIONS = Object.freeze({
  inviteStudents: true,
  manageStudentPermissions: true,
  useDiscover: true,
  createStudentApplications: true,
  editStudentApplications: true,
  manageStudentShares: true,
})

function normalizedOptionalLimit(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  return Math.max(1, Math.min(MAX_TEAM_MEMBER_LIMIT, parsed))
}

function normalizedCounter(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed)))
}

export function normalizeStudentPermissions(value) {
  const candidate = value && typeof value === 'object' ? value : {}
  const booleans = Object.fromEntries(
    Object.keys(DEFAULT_STUDENT_PERMISSIONS)
      .filter((key) => typeof DEFAULT_STUDENT_PERMISSIONS[key] === 'boolean')
      .map((key) => [
        key,
        candidate[key] === undefined
          ? DEFAULT_STUDENT_PERMISSIONS[key]
          : Boolean(candidate[key]),
      ]),
  )
  return {
    ...DEFAULT_STUDENT_PERMISSIONS,
    ...booleans,
    activeApplicationLimit: normalizedOptionalLimit(candidate.activeApplicationLimit),
    lifetimeApplicationLimit: normalizedOptionalLimit(candidate.lifetimeApplicationLimit),
    activeShareLimit: normalizedOptionalLimit(candidate.activeShareLimit),
    lifetimeShareLimit: normalizedOptionalLimit(candidate.lifetimeShareLimit),
  }
}

export function normalizeTeacherPermissions(value) {
  const candidate = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    Object.keys(DEFAULT_TEACHER_PERMISSIONS).map((key) => [
      key,
      candidate[key] === undefined ? DEFAULT_TEACHER_PERMISSIONS[key] : Boolean(candidate[key]),
    ]),
  )
}

export function normalizeTeamMemberUsage(value) {
  const candidate = value && typeof value === 'object' ? value : {}
  return {
    applicationsCreated: normalizedCounter(candidate.applicationsCreated),
    sharesCreated: normalizedCounter(candidate.sharesCreated),
  }
}

export function normalizeTeamMemberRelationships(relationships, role) {
  const candidate = relationships && typeof relationships === 'object' ? relationships : {}
  return {
    ...candidate,
    ...(role === 'member'
      ? { studentPermissions: normalizeStudentPermissions(candidate.studentPermissions) }
      : {}),
    ...(role === 'admin'
      ? { teacherPermissions: normalizeTeacherPermissions(candidate.teacherPermissions) }
      : {}),
    usage: normalizeTeamMemberUsage(candidate.usage),
  }
}

export function mergeTeamMemberPermissions(relationships, role, patch = {}) {
  const normalized = normalizeTeamMemberRelationships(relationships, role)
  return {
    ...normalized,
    ...(patch.studentPermissions
      ? {
          studentPermissions: normalizeStudentPermissions({
            ...normalized.studentPermissions,
            ...patch.studentPermissions,
          }),
        }
      : {}),
    ...(patch.teacherPermissions
      ? {
          teacherPermissions: normalizeTeacherPermissions({
            ...normalized.teacherPermissions,
            ...patch.teacherPermissions,
          }),
        }
      : {}),
  }
}

export function incrementTeamMemberUsage(relationships, role, field) {
  const normalized = normalizeTeamMemberRelationships(relationships, role)
  return {
    ...normalized,
    usage: {
      ...normalized.usage,
      [field]: normalizedCounter(normalized.usage?.[field]) + 1,
    },
  }
}
