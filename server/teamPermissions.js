import { normalizeOptionalMemberLimit } from './shared/teamLimits.js'

const PERMISSION_OVERRIDES_VERSION = 1

export const DEFAULT_STUDENT_PERMISSIONS = Object.freeze({
  editApplications: true,
  createApplications: true,
  useDiscover: false,
  useInterviewPrep: true,
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
  manageStudentInterviewPrep: true,
  createStudentApplications: true,
  editStudentApplications: true,
  manageStudentShares: true,
})

const STUDENT_BOOLEAN_PERMISSION_KEYS = Object.freeze([
  'editApplications',
  'createApplications',
  'useDiscover',
  'useInterviewPrep',
  'createShareLinks',
  'requestTeamTransfers',
])

const STUDENT_LIMIT_PERMISSION_KEYS = Object.freeze([
  'activeApplicationLimit',
  'lifetimeApplicationLimit',
  'activeShareLimit',
  'lifetimeShareLimit',
])

const TEACHER_PERMISSION_KEYS = Object.freeze(Object.keys(DEFAULT_TEACHER_PERMISSIONS))

/** Clamped by the same rule the permission editor applies, not a second copy. */
const normalizedOptionalLimit = normalizeOptionalMemberLimit

function normalizedCounter(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed)))
}

export function normalizeStudentPermissions(value, defaults = DEFAULT_STUDENT_PERMISSIONS) {
  const normalizedDefaults = defaults === DEFAULT_STUDENT_PERMISSIONS
    ? DEFAULT_STUDENT_PERMISSIONS
    : normalizeStudentPermissions(defaults)
  const candidate = value && typeof value === 'object' ? value : {}
  const booleans = Object.fromEntries(
    STUDENT_BOOLEAN_PERMISSION_KEYS.map((key) => [
      key,
      candidate[key] === undefined
        ? normalizedDefaults[key]
        : Boolean(candidate[key]),
    ]),
  )
  return {
    ...normalizedDefaults,
    ...booleans,
    ...Object.fromEntries(STUDENT_LIMIT_PERMISSION_KEYS.map((key) => [
      key,
      candidate[key] === undefined
        ? normalizedDefaults[key]
        : normalizedOptionalLimit(candidate[key]),
    ])),
  }
}

export function normalizeTeacherPermissions(value, defaults = DEFAULT_TEACHER_PERMISSIONS) {
  const normalizedDefaults = defaults === DEFAULT_TEACHER_PERMISSIONS
    ? DEFAULT_TEACHER_PERMISSIONS
    : normalizeTeacherPermissions(defaults)
  const candidate = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    TEACHER_PERMISSION_KEYS.map((key) => [
      key,
      candidate[key] === undefined ? normalizedDefaults[key] : Boolean(candidate[key]),
    ]),
  )
}

export function normalizeTeamPermissionDefaults(value) {
  const candidate = value && typeof value === 'object' ? value : {}
  return {
    student: normalizeStudentPermissions(candidate.student),
    teacher: normalizeTeacherPermissions(candidate.teacher),
  }
}

function normalizeStudentPermissionOverrides(value) {
  const candidate = value && typeof value === 'object' ? value : {}
  return {
    ...Object.fromEntries(
      STUDENT_BOOLEAN_PERMISSION_KEYS
        .filter((key) => candidate[key] !== undefined)
        .map((key) => [key, Boolean(candidate[key])]),
    ),
    ...Object.fromEntries(
      STUDENT_LIMIT_PERMISSION_KEYS
        .filter((key) => candidate[key] !== undefined)
        .map((key) => [key, normalizedOptionalLimit(candidate[key])]),
    ),
  }
}

function normalizeTeacherPermissionOverrides(value) {
  const candidate = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    TEACHER_PERMISSION_KEYS
      .filter((key) => candidate[key] !== undefined)
      .map((key) => [key, Boolean(candidate[key])]),
  )
}

function compactLegacyPermissionOverrides(value, role) {
  if (!value || typeof value !== 'object') return {}
  if (role === 'member') {
    const normalized = normalizeStudentPermissions(value)
    return Object.fromEntries(
      [...STUDENT_BOOLEAN_PERMISSION_KEYS, ...STUDENT_LIMIT_PERMISSION_KEYS]
        .filter((key) => normalized[key] !== DEFAULT_STUDENT_PERMISSIONS[key])
        .map((key) => [key, normalized[key]]),
    )
  }
  if (role === 'admin') {
    const normalized = normalizeTeacherPermissions(value)
    return Object.fromEntries(
      TEACHER_PERMISSION_KEYS
        .filter((key) => normalized[key] !== DEFAULT_TEACHER_PERMISSIONS[key])
        .map((key) => [key, normalized[key]]),
    )
  }
  return {}
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
  const rest = { ...candidate }
  const storedStudentPermissions = rest.studentPermissions
  const storedTeacherPermissions = rest.teacherPermissions
  const permissionOverridesVersion = rest.permissionOverridesVersion
  delete rest.accessLevel
  delete rest.studentProLimit
  delete rest.studentPermissions
  delete rest.teacherPermissions
  delete rest.permissionOverridesVersion
  const versioned = permissionOverridesVersion === PERMISSION_OVERRIDES_VERSION
  const studentPermissions = versioned
    ? normalizeStudentPermissionOverrides(storedStudentPermissions)
    : compactLegacyPermissionOverrides(storedStudentPermissions, 'member')
  const teacherPermissions = versioned
    ? normalizeTeacherPermissionOverrides(storedTeacherPermissions)
    : compactLegacyPermissionOverrides(storedTeacherPermissions, 'admin')
  return {
    ...rest,
    ...(role === 'member' && Object.keys(studentPermissions).length > 0
      ? { studentPermissions }
      : {}),
    ...(role === 'admin' && Object.keys(teacherPermissions).length > 0
      ? { teacherPermissions }
      : {}),
    ...(role === 'member' || role === 'admin'
      ? { permissionOverridesVersion: PERMISSION_OVERRIDES_VERSION }
      : {}),
    usage: normalizeTeamMemberUsage(candidate.usage),
  }
}

export function mergeTeamMemberPermissions(relationships, role, patch = {}) {
  const normalized = normalizeTeamMemberRelationships(relationships, role)
  const next = {
    ...normalized,
  }
  if (role === 'member' && patch.studentPermissions !== undefined) {
    if (patch.studentPermissions === null) {
      delete next.studentPermissions
    } else {
      next.studentPermissions = normalizeStudentPermissionOverrides({
        ...normalized.studentPermissions,
        ...patch.studentPermissions,
      })
    }
  }
  if (role === 'admin' && patch.teacherPermissions !== undefined) {
    if (patch.teacherPermissions === null) {
      delete next.teacherPermissions
    } else {
      next.teacherPermissions = normalizeTeacherPermissionOverrides({
        ...normalized.teacherPermissions,
        ...patch.teacherPermissions,
      })
    }
  }
  return normalizeTeamMemberRelationships({
    ...next,
    permissionOverridesVersion: PERMISSION_OVERRIDES_VERSION,
  }, role)
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
