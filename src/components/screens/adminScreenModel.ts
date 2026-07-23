import type {
  AdminUser,
  DatabaseConfiguration,
  DatabaseConnectionInput,
  DatabaseEngine,
  MembershipPlan,
  SystemEvent,
  UserRole,
} from '../../api/phdApi'
import type { BackupFrequency } from '../../data/applications'
import { localeForLanguage } from '../../i18n'

export type AdminTx = (key: string, fallback?: string) => string
export type AccountType = 'free' | 'pro' | 'admin'
export type UserUpdatePatch = {
  role?: UserRole
  disabled?: boolean
  membershipPlan?: MembershipPlan
  storageQuotaMb?: number
  applicationQuota?: number
  applicationCreateQuota?: number
  shareQuota?: number
  shareCreateQuota?: number
  seatLimit?: number
}
export type UserSortField = 'email' | 'role' | 'status' | 'applicationCount' | 'storageUsedBytes' | 'storageQuotaMb' | 'lastLoginAt'
export type SortDirection = 'asc' | 'desc'
export type LogSortField = 'time' | 'scope' | 'message' | 'actorId'

export const backupFrequencyOptions: Array<{ value: BackupFrequency; labelKey: string; fallback: string }> = [
  { value: '12h', labelKey: 'settings.backupEvery12h', fallback: 'Every 12 hours' },
  { value: 'daily', labelKey: 'settings.backupEvery1d', fallback: 'Daily' },
  { value: '3d', labelKey: 'settings.backupEvery3d', fallback: 'Every 3 days' },
  { value: '7d', labelKey: 'settings.backupEvery7d', fallback: 'Every 7 days' },
]

export const backupLimitOptions = ['1', '2', '5', '10', '20'] as const
export const databaseEngineOptions: DatabaseEngine[] = ['sqlite', 'mysql', 'postgresql', 'mssql']

export function defaultDatabasePort(type: DatabaseEngine) {
  return type === 'mysql' ? 3306 : type === 'postgresql' ? 5432 : type === 'mssql' ? 1433 : 0
}

export function databaseDraftFromConfiguration(configuration: DatabaseConfiguration | null): DatabaseConnectionInput {
  if (!configuration || configuration.type === 'sqlite') {
    return { type: 'sqlite', sqlitePath: configuration?.sqlitePath ?? '' }
  }
  return {
    type: configuration.type,
    host: configuration.host ?? '',
    port: configuration.port ?? defaultDatabasePort(configuration.type),
    database: configuration.database ?? '',
    username: configuration.username ?? '',
    ssl: Boolean(configuration.ssl),
    mysql57Compatibility: Boolean(configuration.mysql57Compatibility),
    schema: configuration.schema ?? '',
  }
}

export function normalizeBackupFrequency(value: string | undefined): BackupFrequency {
  if (value === 'weekly') return '7d'
  return backupFrequencyOptions.some((option) => option.value === value)
    ? (value as BackupFrequency)
    : 'daily'
}

export function normalizeBackupLimitOption(value: string | number | undefined): string {
  const n = Number(value ?? 20)
  if (backupLimitOptions.includes(String(n) as (typeof backupLimitOptions)[number])) return String(n)
  const allowed = backupLimitOptions.map(Number)
  const floor = allowed.filter((option) => option <= n).pop()
  return String(floor ?? allowed[0])
}

type AdminEventMessagePattern = {
  regex: RegExp
  localize: (match: RegExpMatchArray, tx: AdminTx) => string
}

const ADMIN_EVENT_MESSAGE_PATTERNS: AdminEventMessagePattern[] = [
  { regex: /^Updated user (.+)$/, localize: (match, tx) => tx('admin.eventMessages.UpdatedUser', 'Updated user').replace('{email}', match[1] ?? '') },
  { regex: /^Deleted user (.+)$/, localize: (match, tx) => tx('admin.eventMessages.DeletedUser', 'Deleted user').replace('{email}', match[1] ?? '') },
  { regex: /^Password reset link queued for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.PasswordResetQueued', 'Password reset link queued for').replace('{email}', match[1] ?? '') },
  { regex: /^Created application for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.CreatedApp', 'Created application for').replace('{name}', match[1] ?? '') },
  { regex: /^Updated application for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.UpdatedApp', 'Updated application for').replace('{name}', match[1] ?? '') },
  { regex: /^Deleted application for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.DeletedApp', 'Deleted application for').replace('{name}', match[1] ?? '') },
  { regex: /^Added material (.+)$/, localize: (match, tx) => tx('admin.eventMessages.AddedMaterial', 'Added material').replace('{name}', match[1] ?? '') },
  { regex: /^(Updated|Added|Deleted) profile asset (.+)$/, localize: (match, tx) => `${tx(`admin.eventMessages.${match[1]}ProfileAsset`, `${match[1]} profile asset`).replace('{name}', match[2] ?? '')}` },
  { regex: /^Created backup checkpoint for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.CreatedBackup', 'Created backup checkpoint for').replace('{name}', match[1] ?? '') },
  { regex: /^Deleted backup (.+)$/, localize: (match, tx) => tx('admin.eventMessages.DeletedBackup', 'Deleted backup').replace('{name}', match[1] ?? '') },
  { regex: /^Restored backup (.+)$/, localize: (match, tx) => tx('admin.eventMessages.RestoredBackup', 'Restored backup').replace('{name}', match[1] ?? '') },
  { regex: /^Updated share link expiration for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.UpdatedShare', 'Updated share link expiration for').replace('{name}', match[1] ?? '') },
  { regex: /^Revoked share link for (.+)$/, localize: (match, tx) => tx('admin.eventMessages.RevokedShare', 'Revoked share link for').replace('{name}', match[1] ?? '') },
  { regex: /^System update package uploaded: (.+)$/, localize: (match, tx) => tx('admin.eventMessages.UpdateUploaded', 'System update package uploaded:').replace('{name}', match[1] ?? '') },
  { regex: /^System update package removed: (.+)$/, localize: (match, tx) => tx('admin.eventMessages.UpdateRemoved', 'System update package removed:').replace('{name}', match[1] ?? '') },
  { regex: /^Seeded SQLite workspace\.(?: Default login:| Bootstrap user:)\s*(.+)$/, localize: (match, tx) => tx('admin.eventMessages.SeededWorkspace', 'Seeded SQLite workspace.').replace('{info}', match[1] ?? '') },
  { regex: /^Seeded default admin (?:login|account):\s*(.+)$/, localize: (match, tx) => tx('admin.eventMessages.SeededAdmin', 'Seeded default admin login:').replace('{info}', match[1] ?? '') },
]

export function localizeScope(scope: string, tx: AdminTx): string {
  return tx(`admin.scopes.${scope}`, scope)
}

export function localizeEventMessage(message: string, tx: AdminTx): string {
  const direct = tx(`admin.eventMessages.${message}`, '')
  if (direct) return direct

  for (const { regex, localize } of ADMIN_EVENT_MESSAGE_PATTERNS) {
    const match = message.match(regex)
    if (match) return localize(match, tx)
  }

  return message
}

export function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatUptime(seconds: number, tx: AdminTx) {
  if (seconds < 60) return tx('admin.uptimeSeconds', 'uptimeSeconds').replace('{count}', String(seconds))
  const minutes = Math.floor(seconds / 60)
  const secondsRemainder = seconds % 60
  if (minutes < 60) return tx('admin.uptimeMinutes', 'uptimeMinutes').replace('{count}', String(minutes)).replace('{sec}', String(secondsRemainder))
  const hours = Math.floor(minutes / 60)
  const minutesRemainder = minutes % 60
  if (hours < 24) return tx('admin.uptimeHours', 'uptimeHours').replace('{count}', String(hours)).replace('{min}', String(minutesRemainder))
  const days = Math.floor(hours / 24)
  const hoursRemainder = hours % 24
  return tx('admin.uptimeDays', 'uptimeDays').replace('{count}', String(days)).replace('{hr}', String(hoursRemainder))
}

function logTimeValue(event: SystemEvent) {
  const value = Date.parse(event.time)
  return Number.isFinite(value) ? value : 0
}

export function formatLogTime(value: string, lang: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatAdminDateTime(value: string | null | undefined, lang: string, emptyLabel: string) {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function accountTypeForUser(user: Pick<AdminUser, 'role' | 'settings'>): AccountType {
  if (user.role === 'admin') return 'admin'
  // A team is a separate account container. Its owner still has an independent
  // personal account, which legacy `membershipPlan: team` rows treat as Free.
  return (user.settings.personalMembershipPlan ?? user.settings.membershipPlan) === 'pro' ? 'pro' : 'free'
}

export function patchForAccountType(accountType: AccountType): UserUpdatePatch {
  if (accountType === 'admin') return { role: 'admin', membershipPlan: 'pro' }
  return { role: 'user', membershipPlan: accountType }
}

export function isUnlimitedQuota(value: number) {
  return value >= Number.MAX_SAFE_INTEGER
}

export function formatQuotaLimit(value: number) {
  return isUnlimitedQuota(value) ? '∞' : String(value)
}

export function quotaProgressClass(percent: number) {
  return percent >= 100
    ? 'admin-mini-progress-fill-limit'
    : percent >= 80
      ? 'admin-mini-progress-fill-warning'
      : ''
}

function userStatusKey(user: AdminUser) {
  return user.disabledAt ? 'disabled' : 'active'
}

export function compareAdminUsers(
  a: AdminUser,
  b: AdminUser,
  field: UserSortField,
  direction: SortDirection,
) {
  const sign = direction === 'asc' ? 1 : -1
  if (field === 'applicationCount' || field === 'storageUsedBytes' || field === 'storageQuotaMb') {
    return (Number(a[field] ?? 0) - Number(b[field] ?? 0)) * sign
  }
  if (field === 'lastLoginAt') {
    return ((Date.parse(a.lastLoginAt ?? '') || 0) - (Date.parse(b.lastLoginAt ?? '') || 0)) * sign
  }
  const left = field === 'status' ? userStatusKey(a) : field === 'role' ? accountTypeForUser(a) : String(a[field] ?? '')
  const right = field === 'status' ? userStatusKey(b) : field === 'role' ? accountTypeForUser(b) : String(b[field] ?? '')
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }) * sign
}

export function normalizeLogSearchValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.toLowerCase()
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return String(value).toLowerCase()
  }
}

export function compareLogEvents(
  a: SystemEvent,
  b: SystemEvent,
  field: LogSortField,
  direction: SortDirection,
) {
  const sign = direction === 'asc' ? 1 : -1
  if (field === 'time') {
    return (logTimeValue(a) - logTimeValue(b)) * sign
  }
  const left = field === 'actorId' ? (a.actorId ?? '') : a[field]
  const right = field === 'actorId' ? (b.actorId ?? '') : b[field]
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  }) * sign
}
