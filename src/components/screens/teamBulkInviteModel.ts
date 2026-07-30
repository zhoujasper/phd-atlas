import type { TeamMember } from '../../api/phdApi'
import { parseCsvRows, stringifyCsvRows } from '../shared/csv'

export const MAX_TEAM_BULK_INVITE_ROWS = 200

export type TeamBulkInviteRole = 'admin' | 'member'
export type TeamBulkInviteIssueCode =
  | 'invalid-email'
  | 'invalid-role'
  | 'unavailable-role'
  | 'missing-teachers'
  | 'unknown-teacher'
  | 'ambiguous-teacher'
  | 'duplicate-email'

export type TeamBulkInviteIssue = {
  code: TeamBulkInviteIssueCode
  value?: string
}

export type TeamBulkInvitePreviewRow = {
  lineNumber: number
  email: string
  role: TeamBulkInviteRole | null
  teacherReferences: string[]
  teacherMemberIds: string[]
  teacherNames: string[]
  issues: TeamBulkInviteIssue[]
}

export type TeamBulkInvitePreview = {
  rows: TeamBulkInvitePreviewRow[]
  validRows: TeamBulkInvitePreviewRow[]
  invalidRows: TeamBulkInvitePreviewRow[]
  truncatedCount: number
}

const EMAIL_HEADERS = new Set(['email', 'email_address', 'emailaddress', '邮箱', '电子邮箱'])
const ROLE_HEADERS = new Set(['role', 'member_role', 'memberrole', '角色'])
const TEACHER_HEADERS = new Set([
  'responsible_teachers',
  'responsible_teacher',
  'teacher',
  'teachers',
  'teacher_ids',
  'teacher_id',
  '负责老师',
  '负责人',
])

function normalizeLookup(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeHeader(value: string) {
  return normalizeLookup(value).replace(/[\s-]+/g, '_')
}

function normalizeInputRow(row: string[]) {
  if (row.length !== 1) return row
  const value = row[0] ?? ''
  if (value.includes('\t')) return value.split('\t').map((cell) => cell.trim())
  if (value.includes(';')) return value.split(';').map((cell) => cell.trim())
  return row
}

function parseRole(value: string): TeamBulkInviteRole | null {
  const normalized = normalizeLookup(value || 'student')
  if ([
    'admin',
    'teacher',
    'counselor',
    '老师',
    '教师',
    '导师',
    'lehrer',
    'lehrerin',
    'profesor',
    'profesora',
    'docente',
    'maestro',
    'maestra',
    'enseignant',
    'enseignante',
    'professeur',
    'insegnante',
    '教師',
    '先生',
    '교사',
    '선생님',
    'professor',
    'professora',
    'учитель',
    'преподаватель',
    'ครู',
    'giáo viên',
  ].includes(normalized)) return 'admin'
  if ([
    'member',
    'student',
    '学生',
    'schüler',
    'schülerin',
    'studentin',
    'estudiante',
    'alumno',
    'alumna',
    'étudiant',
    'étudiante',
    'élève',
    'studente',
    'studentessa',
    'alunno',
    'alunna',
    '生徒',
    '학생',
    'aluno',
    'aluna',
    'ученик',
    'ученица',
    'студент',
    'студентка',
    'นักเรียน',
    'นักศึกษา',
    'sinh viên',
    'học sinh',
  ].includes(normalized)) return 'member'
  return null
}

function teacherReferences(value: string) {
  return value
    .split(/[|;]/)
    .map((reference) => reference.trim())
    .filter(Boolean)
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function buildTeacherLookup(teachers: readonly TeamMember[]) {
  const lookup = new Map<string, TeamMember[]>()
  for (const teacher of teachers) {
    const values = [
      teacher.id,
      teacher.userId ?? '',
      teacher.displayName ?? '',
      teacher.invitedEmail,
    ]
    for (const value of values) {
      const normalized = normalizeLookup(value)
      if (!normalized) continue
      const matches = lookup.get(normalized) ?? []
      if (!matches.some((match) => match.id === teacher.id)) matches.push(teacher)
      lookup.set(normalized, matches)
    }
  }
  return lookup
}

function headerIndex(headers: string[], candidates: Set<string>) {
  return headers.findIndex((header) => candidates.has(header))
}

export function buildTeamBulkInvitePreview(
  text: string,
  teachers: readonly TeamMember[],
  allowedRoles: readonly TeamBulkInviteRole[] = ['admin', 'member'],
): TeamBulkInvitePreview {
  const parsedRows = parseCsvRows(text).map(normalizeInputRow)
  if (parsedRows.length === 0) {
    return { rows: [], validRows: [], invalidRows: [], truncatedCount: 0 }
  }

  const normalizedHeaders = parsedRows[0].map(normalizeHeader)
  const emailHeaderIndex = headerIndex(normalizedHeaders, EMAIL_HEADERS)
  const roleHeaderIndex = headerIndex(normalizedHeaders, ROLE_HEADERS)
  const teacherHeaderIndex = headerIndex(normalizedHeaders, TEACHER_HEADERS)
  const hasHeader = emailHeaderIndex >= 0 && roleHeaderIndex >= 0
  const sourceRows = hasHeader ? parsedRows.slice(1) : parsedRows
  const limitedRows = sourceRows.slice(0, MAX_TEAM_BULK_INVITE_ROWS)
  const truncatedCount = Math.max(0, sourceRows.length - limitedRows.length)
  const teacherLookup = buildTeacherLookup(teachers)
  const seenEmails = new Set<string>()

  const rows = limitedRows.map((row, index): TeamBulkInvitePreviewRow => {
    const emailIndex = hasHeader ? emailHeaderIndex : 0
    const roleIndex = hasHeader ? roleHeaderIndex : 1
    const teachersIndex = hasHeader ? teacherHeaderIndex : 2
    const email = (row[emailIndex] ?? '').trim().toLocaleLowerCase()
    const role = parseRole(row[roleIndex] ?? '')
    const references = teachersIndex >= 0 ? teacherReferences(row[teachersIndex] ?? '') : []
    const issues: TeamBulkInviteIssue[] = []
    const resolvedTeachers: TeamMember[] = []

    if (!validEmail(email)) issues.push({ code: 'invalid-email' })
    if (!role) issues.push({ code: 'invalid-role', value: row[roleIndex] ?? '' })
    if (role && !allowedRoles.includes(role)) {
      issues.push({ code: 'unavailable-role', value: row[roleIndex] ?? '' })
    }
    if (email && seenEmails.has(email)) issues.push({ code: 'duplicate-email', value: email })
    if (email) seenEmails.add(email)

    if (role === 'member') {
      if (references.length === 0) {
        issues.push({ code: 'missing-teachers' })
      } else {
        for (const reference of references) {
          const matches = teacherLookup.get(normalizeLookup(reference)) ?? []
          if (matches.length === 0) {
            issues.push({ code: 'unknown-teacher', value: reference })
          } else if (matches.length > 1) {
            issues.push({ code: 'ambiguous-teacher', value: reference })
          } else if (!resolvedTeachers.some((teacher) => teacher.id === matches[0].id)) {
            resolvedTeachers.push(matches[0])
          }
        }
      }
    }

    return {
      lineNumber: index + (hasHeader ? 2 : 1),
      email,
      role,
      teacherReferences: references,
      teacherMemberIds: role === 'member' ? resolvedTeachers.map((teacher) => teacher.id) : [],
      teacherNames: role === 'member'
        ? resolvedTeachers.map((teacher) => teacher.displayName || teacher.invitedEmail)
        : [],
      issues,
    }
  })

  return {
    rows,
    validRows: rows.filter((row) => row.issues.length === 0),
    invalidRows: rows.filter((row) => row.issues.length > 0),
    truncatedCount,
  }
}

export function createTeamBulkInviteTemplate(
  teachers: readonly TeamMember[],
  allowedRoles: readonly TeamBulkInviteRole[] = ['admin', 'member'],
) {
  const firstTeacher = teachers[0]
  const secondTeacher = teachers[1]
  const references = [
    firstTeacher?.invitedEmail || firstTeacher?.displayName || '',
    secondTeacher?.userId || '',
  ].filter(Boolean)

  const rows = [
    ['email', 'role', 'responsible_teachers'],
    ['alex@school.edu', 'student', references.join(' | ') || 'user_teacher_id'],
  ]
  if (allowedRoles.includes('admin')) {
    rows.push(['jordan@school.edu', 'teacher', ''])
  }
  return stringifyCsvRows(rows)
}
