import type { EncryptionAlgorithm } from '../api/phdApi'
import type { BackupFrequency } from '../data/applications'

const ADMIN_RESIDENT_DRAFT_PREFIX = 'phd-atlas-admin-resident-v1:'
const ADMIN_RESIDENT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type AdminMailResidentDraft = {
  notificationMailbox: string
  smtpHost: string
  smtpPort: string
  smtpUser: string
  smtpTls: boolean
}

export type AdminBackupResidentDraft = {
  backupFrequency: BackupFrequency
  maxBackupsLimit: string
}

export type AdminSessionResidentDraft = {
  adminSessionDuration: string
}

export type AdminEntryResidentDraft = {
  adminEntryEnabled: boolean
}

export type AdminEncryptionResidentDraft = {
  enabled: boolean
  algorithm: EncryptionAlgorithm
  passwordEnabled: boolean
  sqliteEncryption: boolean
}

export type AdminResidentDraft = {
  version: 1
  accountId: string
  updatedAt: number
  mail?: AdminMailResidentDraft
  backup?: AdminBackupResidentDraft
  session?: AdminSessionResidentDraft
  adminEntry?: AdminEntryResidentDraft
  encryption?: AdminEncryptionResidentDraft
}

export type AdminResidentDraftDomain = Exclude<
  keyof AdminResidentDraft,
  'version' | 'accountId' | 'updatedAt'
>

type AdminResidentDraftDomainValue<TDomain extends AdminResidentDraftDomain> =
  NonNullable<AdminResidentDraft[TDomain]>

function boundedString(value: unknown, maximum = 2_048) {
  return typeof value === 'string' && value.length <= maximum ? value : null
}

function resolveStorage(storage?: Storage | null) {
  if (storage !== undefined) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function adminResidentDraftStorageKey(accountId: string) {
  return `${ADMIN_RESIDENT_DRAFT_PREFIX}${encodeURIComponent(accountId)}`
}

function normalizeResidentDraft(raw: unknown, accountId: string, now: number): AdminResidentDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  if (
    candidate.version !== 1
    || candidate.accountId !== accountId
    || typeof candidate.updatedAt !== 'number'
    || !Number.isFinite(candidate.updatedAt)
    || candidate.updatedAt > now + 60_000
    || now - candidate.updatedAt > ADMIN_RESIDENT_DRAFT_MAX_AGE_MS
  ) return null

  const draft: AdminResidentDraft = {
    version: 1,
    accountId,
    updatedAt: candidate.updatedAt,
  }

  if (candidate.mail && typeof candidate.mail === 'object' && !Array.isArray(candidate.mail)) {
    const mail = candidate.mail as Record<string, unknown>
    const notificationMailbox = boundedString(mail.notificationMailbox)
    const smtpHost = boundedString(mail.smtpHost)
    const smtpPort = boundedString(mail.smtpPort, 8)
    const smtpUser = boundedString(mail.smtpUser)
    if (
      notificationMailbox !== null
      && smtpHost !== null
      && smtpPort !== null
      && smtpUser !== null
      && typeof mail.smtpTls === 'boolean'
    ) {
      draft.mail = { notificationMailbox, smtpHost, smtpPort, smtpUser, smtpTls: mail.smtpTls }
    }
  }

  if (candidate.backup && typeof candidate.backup === 'object' && !Array.isArray(candidate.backup)) {
    const backup = candidate.backup as Record<string, unknown>
    const backupFrequency = boundedString(backup.backupFrequency, 32)
    const maxBackupsLimit = boundedString(backup.maxBackupsLimit, 16)
    if (
      backupFrequency !== null
      && ['1m', '5m', '15m', '30m', '1h', '3h', '6h', '12h', 'daily', '3d', '7d', 'weekly', 'monthly'].includes(backupFrequency)
      && maxBackupsLimit !== null
    ) {
      draft.backup = {
        backupFrequency: backupFrequency as BackupFrequency,
        maxBackupsLimit,
      }
    }
  }

  if (candidate.session && typeof candidate.session === 'object' && !Array.isArray(candidate.session)) {
    const session = candidate.session as Record<string, unknown>
    const adminSessionDuration = boundedString(session.adminSessionDuration, 16)
    if (adminSessionDuration !== null) draft.session = { adminSessionDuration }
  }

  if (candidate.adminEntry && typeof candidate.adminEntry === 'object' && !Array.isArray(candidate.adminEntry)) {
    const adminEntry = candidate.adminEntry as Record<string, unknown>
    if (typeof adminEntry.adminEntryEnabled === 'boolean') {
      draft.adminEntry = { adminEntryEnabled: adminEntry.adminEntryEnabled }
    }
  }

  if (candidate.encryption && typeof candidate.encryption === 'object' && !Array.isArray(candidate.encryption)) {
    const encryption = candidate.encryption as Record<string, unknown>
    if (
      typeof encryption.enabled === 'boolean'
      && (encryption.algorithm === 'aes-256-gcm' || encryption.algorithm === 'chacha20-poly1305')
      && typeof encryption.passwordEnabled === 'boolean'
      && typeof encryption.sqliteEncryption === 'boolean'
    ) {
      draft.encryption = {
        enabled: encryption.enabled,
        algorithm: encryption.algorithm,
        passwordEnabled: encryption.passwordEnabled,
        sqliteEncryption: encryption.sqliteEncryption,
      }
    }
  }

  return draft
}

export function readAdminResidentDraft(
  accountId: string,
  { storage, now = Date.now() }: { storage?: Storage | null; now?: number } = {},
) {
  const target = resolveStorage(storage)
  if (!target || !accountId) return null
  const key = adminResidentDraftStorageKey(accountId)
  try {
    const serialized = target.getItem(key)
    if (!serialized) return null
    const normalized = normalizeResidentDraft(JSON.parse(serialized), accountId, now)
    if (!normalized) target.removeItem(key)
    return normalized
  } catch {
    return null
  }
}

export function writeAdminResidentDraftDomain<TDomain extends AdminResidentDraftDomain>(
  accountId: string,
  domain: TDomain,
  value: AdminResidentDraftDomainValue<TDomain> | null,
  { storage, now = Date.now() }: { storage?: Storage | null; now?: number } = {},
) {
  const target = resolveStorage(storage)
  if (!target || !accountId) return false
  const key = adminResidentDraftStorageKey(accountId)
  try {
    const current = readAdminResidentDraft(accountId, { storage: target, now }) ?? {
      version: 1 as const,
      accountId,
      updatedAt: now,
    }
    if (value === null) delete current[domain]
    else current[domain] = value
    const hasDraft = Boolean(
      current.mail
      || current.backup
      || current.session
      || current.adminEntry
      || current.encryption
    )
    if (!hasDraft) {
      target.removeItem(key)
      return target.getItem(key) === null
    }
    current.updatedAt = now
    const serialized = JSON.stringify(current)
    target.setItem(key, serialized)
    return target.getItem(key) === serialized
  } catch {
    return false
  }
}
