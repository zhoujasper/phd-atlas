import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import tar from 'tar-fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGunzip, createGzip } from 'node:zlib'
import {
  decryptPayload,
  decryptSecret,
  decryptSecretWithProfile,
  deriveSqliteKey,
  encryptPayload,
  encryptSecret,
  getRuntimeCryptoConfig,
  isEncryptedPayload,
  normalizeAlgorithm,
  setRuntimeCryptoConfig,
} from './crypto.js'
import {
  EXTERNAL_STATE_MAGIC,
  decodeBackupPayload,
  decodeExternalStatePayload,
  encodeBackupPayload as encodeBackupEnvelope,
  encodeExternalStatePayload as encodeExternalEnvelope,
} from './durableEnvelope.js'
import {
  plainSqliteExists,
  sealSqliteFile,
  sealSqliteBuffer,
  sealedPathFor,
  sealedSqliteExists,
  unsealSqliteBuffer,
} from './sqliteSeal.js'
import {
  assertExternalDatabaseTargetEmpty,
  createExternalDatabaseSqlDump,
  defaultSqlitePath,
  isExternalDatabaseConfiguration,
  persistDatabaseConfiguration,
  publicDatabaseConfiguration,
  readExternalDatabaseState,
  readPersistedDatabaseConfiguration,
  verifyDatabaseConnection,
  writeExternalDatabaseState,
} from './databaseConnection.js'
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_USER_EMAIL,
  DEFAULT_USER_PASSWORD,
  seedApplications,
  seedProfileAssets,
} from './seed-data.js'
import { PUBLIC_EDITION } from './edition.js'
import {
  isTeacherAssignedToStudent,
  normalizeTeamTeacherGroups,
} from './teamRelationships.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

// ---- Write lock ----
// Serialises every readStore() -> modify -> writeStore() cycle so that
// concurrent callers (HTTP handlers, timers) cannot silently overwrite
// each other's changes.
let writeLock = Promise.resolve()
const auditContext = new AsyncLocalStorage()

export async function withWriteLock(fn) {
  const prev = writeLock
  let release
  writeLock = new Promise(resolve => { release = resolve })
  await prev
  try {
    await fn()
  } finally {
    release()
  }
}

/**
 * Convenience wrapper: acquire the write lock, call writeStore, release.
 * Use this for simple fire-and-forget HTTP paths that already hold a fresh
 * store snapshot. For callers that need to guard an entire read-modify-write
 * cycle, use withWriteLock(fn) directly.
 */
export function lockedWriteStore(store, afterWrite) {
  return withWriteLock(async () => {
    const baseline = store?.[storeBaselineSymbol]
    if (!baseline) {
      await writeStore(store)
      await afterWrite?.(store)
      return
    }

    const latest = await readStore()
    const merged = mergeStoreChanges(latest, store, baseline)
    await writeStore(merged)
    Object.assign(store, merged)
    attachStoreBaseline(store)
    await afterWrite?.(store)
  })
}

export function runWithAuditContext(context, fn) {
  return auditContext.run(context, fn)
}

export const storageRoot = path.join(projectRoot, 'storage')
export const uploadRoot = path.join(storageRoot, 'uploads')
export const backupRoot = path.join(storageRoot, 'backups')
export let databasePath = defaultSqlitePath
export let sealedDatabasePath = sealedPathFor(databasePath)

let db
let pendingDatabaseImage = null
let databaseRunsInMemory = false
let storageReadyPromise = null
let storageInitialized = false
let sharedStoreCache = null
let sharedStoreDataVersion = null
/** @type {{ encryptionAtRest: boolean, encryptionAlgorithm: string, encryptionPasswordEnabled: boolean, encryptionPasswordSalt: string, passwordBinding: string, sqliteEncryption: boolean } | null} */
let activeEncryptionPolicy = null
let sealAfterWriteTimer = null
const storeBaselineSymbol = Symbol('phd-atlas-store-baseline')
const backupInfoCache = new Map()
let backupListCache = null
let backupListCacheDirectoryStamp = null
let backupListCacheGeneration = 0
let backupListScan = null
let activeDatabaseConfiguration = { type: 'sqlite', sqlitePath: databasePath }
let externalSyncTimer = null
let externalSyncPromise = null
let suppressExternalSync = false
const PUBLIC_SETUP_PENDING_STATE = 'pending-v1'
const PUBLIC_SETUP_COMPLETE_STATE = 'complete-v1'

function sqliteImageForMemory(image) {
  const normalized = Buffer.from(image)
  if (normalized.subarray(0, 16).toString('utf8') === 'SQLite format 3\0') {
    // Serialized WAL databases retain WAL read/write header flags. Anonymous
    // in-memory handles have no sidecar path, so switch the copy to rollback
    // semantics before opening it and then select MEMORY journal mode below.
    normalized[18] = 1
    normalized[19] = 1
  }
  return normalized
}

function invalidateSharedStoreCache() {
  sharedStoreCache = null
  sharedStoreDataVersion = null
}

const BACKUP_METADATA_SUFFIX = '.meta'
const BACKUP_SIDECAR_MIN_BYTES = 64 * 1024
const MIN_SESSION_MINUTES = 5
const MAX_SESSION_MINUTES = 43_200
const DEFAULT_USER_SESSION_MINUTES = 720
const DEFAULT_ADMIN_SESSION_MINUTES = 120
const DEFAULT_APPLICATION_QUOTA = 3
const DEFAULT_PRO_APPLICATION_QUOTA = 300
const MAX_APPLICATION_QUOTA = 10_000
const DEFAULT_FREE_STORAGE_QUOTA_MB = 5
const DEFAULT_PRO_STORAGE_QUOTA_MB = 100
const DEFAULT_FREE_SHARE_ACTIVE_QUOTA = 5
const DEFAULT_FREE_SHARE_CREATE_QUOTA = 5
const DEFAULT_PRO_SHARE_ACTIVE_QUOTA = 1000
const DEFAULT_PRO_SHARE_CREATE_QUOTA = 5000
const DEFAULT_SHARE_QUOTA = DEFAULT_FREE_SHARE_ACTIVE_QUOTA
const MAX_SHARE_QUOTA = 10_000
const DEFAULT_TRASH_RETENTION_DAYS = 30
const PLAN_QUOTA_VERSION = 2
const BACKUP_FREQUENCIES = new Set(['1m', '5m', '15m', '30m', '1h', '3h', '6h', '12h', 'daily', '3d', '7d'])
const LEGACY_BACKUP_FREQUENCIES = new Set(['weekly', 'monthly'])
const DEFAULT_BACKUP_FREQUENCY = '15m'
const DEFAULT_MAX_BACKUPS_PER_APP = 5
const DEFAULT_PRO_MAX_BACKUPS_PER_APP = 20
const DEFAULT_ADMIN_MAX_BACKUPS_PER_APP = 100
const MAX_BACKUPS_PER_APP_LIMIT = 100
const MIN_SYSTEM_BACKUP_LIMIT = 1
const MAX_SYSTEM_BACKUP_LIMIT = 20
const DEMO_TEAM_ID = 'team_demo_phd_atlas'
const DEMO_TEAM_SEAT_LIMIT = 12
const DEMO_TEAM_MEMBER_ACCOUNTS = [
  {
    key: 'teacher',
    id: 'user_demo_teacher',
    name: 'Dr. Mei Chen',
    email: 'teacher@phd-atlas.local',
    teamRole: 'admin',
  },
  {
    key: 'teacherB',
    id: 'user_demo_teacher_alex',
    name: 'Prof. Alex Rivera',
    email: 'teacher.alex@phd-atlas.local',
    teamRole: 'admin',
  },
  {
    key: 'studentA',
    id: 'user_demo_student_lina',
    name: 'Lina Zhao',
    email: 'student.lina@phd-atlas.local',
    teamRole: 'member',
  },
  {
    key: 'studentB',
    id: 'user_demo_student_omar',
    name: 'Omar Patel',
    email: 'student.omar@phd-atlas.local',
    teamRole: 'member',
  },
]

function normalizeBackupFrequency(value, fallback = DEFAULT_BACKUP_FREQUENCY) {
  if (BACKUP_FREQUENCIES.has(value)) return value
  if (value === 'weekly') return '7d'
  if (LEGACY_BACKUP_FREQUENCIES.has(value)) return 'daily'
  return BACKUP_FREQUENCIES.has(fallback) ? fallback : DEFAULT_BACKUP_FREQUENCY
}

function normalizeBackupLimit(value, fallback = DEFAULT_MAX_BACKUPS_PER_APP) {
  const limit = Number(value ?? fallback)
  if (!Number.isFinite(limit)) return fallback
  return Math.min(MAX_BACKUPS_PER_APP_LIMIT, Math.max(1, Math.round(limit)))
}

export function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 14)}`
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function nowStamp() {
  return new Date().toISOString()
}

function normalizeSessionMinutes(value, fallback = DEFAULT_USER_SESSION_MINUTES) {
  const minutes = Number(value ?? fallback)
  if (!Number.isFinite(minutes)) return fallback
  return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(minutes)))
}

function normalizeShareQuota(value) {
  const quota = Number(value ?? DEFAULT_SHARE_QUOTA)
  if (!Number.isFinite(quota)) return DEFAULT_SHARE_QUOTA
  return Math.min(MAX_SHARE_QUOTA, Math.max(1, Math.round(quota)))
}

function normalizeApplicationQuota(value) {
  const quota = Number(value ?? DEFAULT_APPLICATION_QUOTA)
  if (!Number.isFinite(quota)) return DEFAULT_APPLICATION_QUOTA
  return Math.min(MAX_APPLICATION_QUOTA, Math.max(1, Math.round(quota)))
}

function normalizeCreateCount(value, fallback = 0) {
  const count = Number(value ?? fallback)
  if (!Number.isFinite(count)) return fallback
  return Math.max(0, Math.round(count))
}

function normalizeTrashRetentionDays(value, role) {
  if (role === 'admin' && value === null) return null
  const days = Number(value ?? DEFAULT_TRASH_RETENTION_DAYS)
  if ([1, 5, 10, 30, 60].includes(days)) return days
  return DEFAULT_TRASH_RETENTION_DAYS
}

function normalizeMembershipPlan(value, role) {
  if (role === 'admin') return 'pro'
  if (value === 'team' || value === 'pro') return value
  return 'free'
}

function migrateStoredQuotaSettings(user) {
  const settings = user.settings ?? {}
  if (settings.planQuotaVersion === PLAN_QUOTA_VERSION) return settings

  const role = normalizeUserRole(user.role)
  const membershipPlan = normalizeMembershipPlan(settings.membershipPlan, role)
  const isAdmin = role === 'admin'
  const isPro = isAdmin || membershipPlan === 'pro' || membershipPlan === 'team'

  return {
    ...settings,
    planQuotaVersion: PLAN_QUOTA_VERSION,
    membershipPlan,
    autoBackup: isPro ? Boolean(settings.autoBackup) : false,
    applicationQuota: isAdmin ? MAX_APPLICATION_QUOTA : isPro ? DEFAULT_PRO_APPLICATION_QUOTA : DEFAULT_APPLICATION_QUOTA,
    applicationCreateQuota: isAdmin || isPro ? MAX_APPLICATION_QUOTA : DEFAULT_APPLICATION_QUOTA,
    storageQuotaMb: isAdmin || isPro ? DEFAULT_PRO_STORAGE_QUOTA_MB : DEFAULT_FREE_STORAGE_QUOTA_MB,
    shareQuota: isAdmin ? MAX_SHARE_QUOTA : isPro ? DEFAULT_PRO_SHARE_ACTIVE_QUOTA : DEFAULT_FREE_SHARE_ACTIVE_QUOTA,
    shareCreateQuota: isAdmin ? MAX_SHARE_QUOTA : isPro ? DEFAULT_PRO_SHARE_CREATE_QUOTA : DEFAULT_FREE_SHARE_CREATE_QUOTA,
    applicationCreatedCount: normalizeCreateCount(settings.applicationCreatedCount),
    shareCreatedCount: normalizeCreateCount(settings.shareCreatedCount),
    trashRetentionDays: settings.trashRetentionDays ?? (isAdmin ? null : DEFAULT_TRASH_RETENTION_DAYS),
  }
}

export function normalizeUserRole(role) {
  return role === 'admin' ? 'admin' : 'user'
}

export function publicUser(user) {
  if (!user) {
    return null
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeUserRole(user.role),
    disabledAt: user.disabledAt ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    settings: normalizeUserSettings(user),
  }
}

function normalizeUserSettings(user) {
  const settings = user.settings ?? {}
  const role = normalizeUserRole(user.role)
  const membershipPlan = normalizeMembershipPlan(settings.membershipPlan, role)
  const isAdmin = role === 'admin'
  const isPro = isAdmin || membershipPlan === 'pro' || membershipPlan === 'team'
  const receiveAt = settings.receiveAt || user.email
  const rawReceiveEmails = Array.isArray(settings.receiveEmails) && settings.receiveEmails.length > 0
    ? settings.receiveEmails
    : [{ address: receiveAt, isPrimary: true, notify: true, verified: true }]
  const receiveEmails = rawReceiveEmails.reduce((items, email) => {
    if (items.length >= 5) {
      return items
    }
    const address = String(email.address ?? '').trim().toLowerCase()
    if (!address || items.some((item) => item.address === address)) {
      return items
    }
    items.push({
      address,
      isPrimary: Boolean(email.isPrimary),
      notify: Boolean(email.notify),
      verified: email.verified ?? true,
      verificationSentAt: email.verificationSentAt,
    })
    return items
  }, [])
  const preferredPrimaryIndex = receiveEmails.findIndex((email) => email.isPrimary && email.verified)
  const firstVerifiedIndex = receiveEmails.findIndex((email) => email.verified)
  const resolvedPrimaryIndex = preferredPrimaryIndex >= 0 ? preferredPrimaryIndex : firstVerifiedIndex
  const normalizedReceiveEmails = receiveEmails.map((email, index) => ({
    ...email,
    isPrimary: index === resolvedPrimaryIndex,
  }))
  const primaryReceiveEmail = normalizedReceiveEmails.find((email) => email.isPrimary)
  const rawAiProfile = settings.aiProfile && typeof settings.aiProfile === 'object' ? settings.aiProfile : {}
  const aiProfile = Object.fromEntries([
    'preferredName', 'pronouns', 'location', 'timezone', 'citizenship', 'currentRole',
    'institution', 'degree', 'field', 'graduation', 'researchInterests', 'researchMethods',
    'achievements', 'goals', 'writingLanguage', 'writingTone', 'signature', 'boundaries',
  ].map((key) => [key, typeof rawAiProfile[key] === 'string' ? rawAiProfile[key] : '']))

  const normalizeContentLanguage = (value, fallback) => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(raw) ? raw : fallback
  }
  let contentLanguagePrimary = normalizeContentLanguage(settings.contentLanguagePrimary, 'en')
  let contentLanguageSecondary = normalizeContentLanguage(settings.contentLanguageSecondary, 'zh')
  if (contentLanguagePrimary === contentLanguageSecondary) {
    contentLanguageSecondary = contentLanguagePrimary === 'en' ? 'zh' : 'en'
  }

  return {
    language: settings.language ?? 'en',
    avatarDataUrl: typeof settings.avatarDataUrl === 'string' ? settings.avatarDataUrl : '',
    contentLanguagePrimary,
    contentLanguageSecondary,
    highContrast: Boolean(settings.highContrast),
    themeAccent: typeof settings.themeAccent === 'string' && settings.themeAccent.startsWith('#')
      ? settings.themeAccent
      : '#0071e3',
    sendFrom: settings.sendFrom,
    receiveAt: primaryReceiveEmail?.address ?? receiveAt,
    receiveEmails: normalizedReceiveEmails.length > 0
      ? normalizedReceiveEmails
      : [{ address: receiveAt, isPrimary: true, notify: true, verified: true }],
    // Existing accounts keep their established delivery behaviour until they
    // make an explicit choice in Settings.
    emailNotificationsEnabled: settings.emailNotificationsEnabled !== false,
    browserNotificationsEnabled: settings.browserNotificationsEnabled !== false,
    membershipPlan,
    personalMembershipPlan: isAdmin
      ? 'pro'
      : settings.personalMembershipPlan === 'pro'
        ? 'pro'
        : membershipPlan === 'team'
          ? 'free'
          : membershipPlan,
    autoBackup: isPro ? Boolean(settings.autoBackup) : false,
    backupFrequency: normalizeBackupFrequency(settings.backupFrequency),
    maxBackupsPerApp: normalizeBackupLimit(
      settings.maxBackupsPerApp,
      isAdmin ? DEFAULT_ADMIN_MAX_BACKUPS_PER_APP : isPro ? DEFAULT_PRO_MAX_BACKUPS_PER_APP : DEFAULT_MAX_BACKUPS_PER_APP,
    ),
    smtpHost: settings.smtpHost ?? '',
    smtpPort: Number(settings.smtpPort ?? 587),
    smtpUser: settings.smtpUser ?? '',
    // Real secrets never leave the server — the client only learns whether one is set.
    smtpPass: '',
    smtpPassSet: Boolean(settings.smtpPass),
    smtpTls: settings.smtpTls ?? true,
    // IMAP is the product default; only an explicit pop3 choice stays pop3.
    // Legacy unconfigured pop3 seeds are rewritten by withDefaultIncomingMailProtocol / ensureDemoUser.
    incomingProtocol: settings.incomingProtocol === 'pop3' ? 'pop3' : 'imap',
    incomingHost: settings.incomingHost ?? '',
    incomingPort: Number(settings.incomingPort ?? (settings.incomingProtocol === 'pop3' ? 995 : 993)),
    incomingUser: settings.incomingUser ?? '',
    incomingPass: '',
    incomingPassSet: Boolean(settings.incomingPass),
    incomingTls: settings.incomingTls ?? true,
    // Off by default: saving incoming-mail credentials should never silently start polling a mailbox.
    autoFetchMail: Boolean(settings.autoFetchMail),
    storageQuotaMb: Number(settings.storageQuotaMb ?? (isPro ? DEFAULT_PRO_STORAGE_QUOTA_MB : DEFAULT_FREE_STORAGE_QUOTA_MB)),
    applicationQuota: isAdmin
      ? MAX_APPLICATION_QUOTA
      : isPro
        ? Math.min(MAX_APPLICATION_QUOTA, normalizeApplicationQuota(settings.applicationQuota ?? DEFAULT_PRO_APPLICATION_QUOTA))
        : normalizeApplicationQuota(settings.applicationQuota ?? DEFAULT_APPLICATION_QUOTA),
    applicationCreateQuota: isAdmin || isPro
      ? MAX_APPLICATION_QUOTA
      : normalizeApplicationQuota(settings.applicationCreateQuota ?? DEFAULT_APPLICATION_QUOTA),
    applicationCreatedCount: normalizeCreateCount(settings.applicationCreatedCount),
    shareQuota: isAdmin
      ? MAX_SHARE_QUOTA
      : isPro
        ? Math.min(MAX_SHARE_QUOTA, normalizeShareQuota(settings.shareQuota ?? DEFAULT_PRO_SHARE_ACTIVE_QUOTA))
        : normalizeShareQuota(settings.shareQuota ?? DEFAULT_FREE_SHARE_ACTIVE_QUOTA),
    shareCreateQuota: isAdmin
      ? MAX_SHARE_QUOTA
      : isPro
        ? Math.min(MAX_SHARE_QUOTA, normalizeShareQuota(settings.shareCreateQuota ?? DEFAULT_PRO_SHARE_CREATE_QUOTA))
        : normalizeShareQuota(settings.shareCreateQuota ?? DEFAULT_FREE_SHARE_CREATE_QUOTA),
    shareCreatedCount: normalizeCreateCount(settings.shareCreatedCount),
    trashRetentionDays: normalizeTrashRetentionDays(settings.trashRetentionDays, role),
    sessionDurationMinutes: normalizeSessionMinutes(settings.sessionDurationMinutes),
    calendarToken: typeof settings.calendarToken === 'string' ? settings.calendarToken : undefined,
    snippetPhraseLeadZh: settings.snippetPhraseLeadZh ?? '',
    snippetPhraseTailZh: settings.snippetPhraseTailZh ?? '',
    snippetPhraseLeadEn: settings.snippetPhraseLeadEn ?? '',
    snippetPhraseTailEn: settings.snippetPhraseTailEn ?? '',
    aiProfile,
    profilePresets: Array.isArray(settings.profilePresets) ? settings.profilePresets : undefined,
  }
}

function toJson(value) {
  return JSON.stringify(value ?? {})
}

function fromJson(value, fallback = {}) {
  if (!value) {
    return fallback
  }
  return JSON.parse(value)
}

function encryptedSecretForWrite(existingCiphertext, plaintext) {
  if (!plaintext) return ''
  if (existingCiphertext && decryptSecret(existingCiphertext) === plaintext) {
    return existingCiphertext
  }
  return encryptSecret(plaintext)
}

function entityBaseline(items) {
  return new Map((items ?? []).map((item) => [item.id, toJson(item)]))
}

function captureStoreBaseline(store) {
  return {
    settings: toJson(store.settings),
    users: entityBaseline(store.users),
    applications: entityBaseline(store.applications),
    profileAssets: entityBaseline(store.profileAssets),
    systemEvents: entityBaseline(store.systemEvents),
  }
}

function attachStoreBaseline(store) {
  Object.defineProperty(store, storeBaselineSymbol, {
    configurable: true,
    enumerable: false,
    value: captureStoreBaseline(store),
  })
  return store
}

function mergeEntityChanges(latestItems, proposedItems, baselineItems) {
  const merged = new Map((latestItems ?? []).map((item) => [item.id, item]))
  const proposed = new Map((proposedItems ?? []).map((item) => [item.id, item]))

  for (const id of baselineItems.keys()) {
    if (!proposed.has(id)) merged.delete(id)
  }
  for (const item of proposed.values()) {
    const original = baselineItems.get(item.id)
    if (original === undefined || toJson(item) !== original) {
      merged.set(item.id, item)
    }
  }
  return Array.from(merged.values())
}

function mergeStoreChanges(latest, proposed, baseline) {
  return {
    ...latest,
    settings: toJson(proposed.settings) === baseline.settings ? latest.settings : proposed.settings,
    users: mergeEntityChanges(latest.users, proposed.users, baseline.users)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    applications: mergeEntityChanges(latest.applications, proposed.applications, baseline.applications)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline))),
    profileAssets: mergeEntityChanges(latest.profileAssets, proposed.profileAssets, baseline.profileAssets)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    systemEvents: mergeEntityChanges(latest.systemEvents, proposed.systemEvents, baseline.systemEvents)
      .sort((a, b) => String(b.time).localeCompare(String(a.time)))
      .slice(0, 500),
  }
}

function boolInt(value) {
  return value ? 1 : 0
}

function intBool(value) {
  return Boolean(value)
}

function backupFileError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function isBackupArchiveName(fileName) {
  return fileName.endsWith('.tar.gz') || fileName.endsWith('.json')
}

export function resolveBackupFile(fileName) {
  const normalized = path.basename(String(fileName ?? ''))
  if (!normalized || !isBackupArchiveName(normalized) || normalized.endsWith('.meta')) {
    throw backupFileError(400, 'INVALID_BACKUP_NAME', 'Backup file name is invalid.')
  }

  const root = path.resolve(backupRoot)
  const target = path.resolve(root, normalized)
  const rootPrefix = `${root}${path.sep}`.toLowerCase()
  if (!target.toLowerCase().startsWith(rootPrefix)) {
    throw backupFileError(400, 'INVALID_BACKUP_NAME', 'Backup file name is invalid.')
  }

  return { fileName: normalized, path: target }
}

function closeOpenDatabase() {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
  try {
    db.close()
  } catch {
    /* ignore */
  }
  db = null
  invalidateSharedStoreCache()
}

function setActiveSqlitePath(nextPath) {
  databasePath = path.resolve(nextPath || defaultSqlitePath)
  sealedDatabasePath = sealedPathFor(databasePath)
}

function currentDatabaseAdapter() {
  return activeDatabaseConfiguration?.type ?? 'sqlite'
}

export function getDatabaseConfiguration() {
  return publicDatabaseConfiguration(activeDatabaseConfiguration)
}

async function writeSnapshotFile(target, payload) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temporary, payload)
  await fs.rename(temporary, target)
}

async function removePlainSqliteArtifacts() {
  const targets = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
  await Promise.all(targets.map(async (target) => {
    try {
      await fs.rm(target, { force: true })
    } catch (error) {
      // Windows refuses unlink while an older server process still owns the
      // handle. The authenticated in-memory/sealed image is already complete;
      // leave the old file untouched and retry on the next write or restart.
      if (error?.code === 'EBUSY' || error?.code === 'EPERM') return
      throw error
    }
  }))
}

async function directoryHasRecoveryFile(directory, predicate = () => true) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .some((entry) => entry.isFile() && predicate(entry.name))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function hasWorkspaceRecoveryArtifacts() {
  const [uploads, backups, checkpoints, pushJournal] = await Promise.all([
    directoryHasRecoveryFile(uploadRoot),
    directoryHasRecoveryFile(backupRoot, (name) => name.endsWith('.tar.gz')),
    directoryHasRecoveryFile(path.join(storageRoot, 'discover-research-jobs'), (name) => name.endsWith('.json')),
    fs.stat(path.join(storageRoot, 'browser-push-batches.journal'))
      .then((stat) => stat.isFile() && stat.size > 0)
      .catch((error) => {
        if (error?.code === 'ENOENT') return false
        throw error
      }),
  ])
  return uploads || backups || checkpoints || pushJournal
}

export function shouldRefuseEmptyWorkspaceSeed({
  hadPlainDatabase = false,
  hadSealedDatabase = false,
  hasRecoveryArtifacts = false,
  validPublicSetupPending = false,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  if (nodeEnv === 'test') return false
  if (validPublicSetupPending) return false
  return Boolean(hadPlainDatabase || hadSealedDatabase || hasRecoveryArtifacts)
}

export function isValidPublicSetupPendingWorkspace({
  publicEdition = PUBLIC_EDITION,
  meta = null,
  userCount = 0,
  applicationCount = 0,
  profileAssetCount = 0,
  teamCount = 0,
  hasSystemSettings = false,
  hadSealedDatabase = false,
  hasRecoveryArtifacts = false,
} = {}) {
  return Boolean(
    publicEdition
    && meta?.publicSetupState === PUBLIC_SETUP_PENDING_STATE
    && Number(userCount) === 0
    && Number(applicationCount) === 0
    && Number(profileAssetCount) === 0
    && Number(teamCount) === 0
    && hasSystemSettings
    && !hadSealedDatabase
    && !hasRecoveryArtifacts
  )
}

export function markPublicSetupComplete(store) {
  store.meta = {
    ...(store.meta ?? {}),
    publicSetupState: PUBLIC_SETUP_COMPLETE_STATE,
  }
  return store
}

async function recoverOrCleanInterruptedSqliteSeals() {
  const directory = path.dirname(sealedDatabasePath)
  const prefixes = [
    `${path.basename(sealedDatabasePath)}.tmp-`,
    `${path.basename(sealedDatabasePath)}.previous-`,
  ]
  let candidates = []
  try {
    candidates = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && prefixes.some((prefix) => entry.name.startsWith(prefix)))
      .map((entry) => path.join(directory, entry.name))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (!candidates.length) return
  const hasSealedDatabase = await sealedSqliteExists(sealedDatabasePath)
  const sealedMtimeMs = hasSealedDatabase
    ? (await fs.stat(sealedDatabasePath)).mtimeMs
    : Number.NEGATIVE_INFINITY
  const newest = (await Promise.all(candidates.map(async (target) => ({
    target,
    mtimeMs: (await fs.stat(target)).mtimeMs,
  })))).sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const candidate of newest) {
    if (candidate.mtimeMs <= sealedMtimeMs) break
    try {
      const authenticatedImage = await unsealSqliteBuffer(candidate.target, deriveSqliteKey())
      await sealSqliteBuffer(
        authenticatedImage,
        sealedDatabasePath,
        deriveSqliteKey(),
        activeEncryptionPolicy.encryptionAlgorithm,
      )
      break
    } catch {
      // Try the next newer authenticated temporary snapshot.
    }
  }
  await Promise.all(candidates.map((target) => fs.rm(target, { force: true }).catch(() => undefined)))
}

export function encodeExternalStatePayload(payload, policy = activeEncryptionPolicy) {
  return encodeExternalEnvelope(payload, policy)
}

function encodeBackupPayload(payload, policy = activeEncryptionPolicy) {
  return encodeBackupEnvelope(payload, policy)
}

function backupEncryptionPolicyForSettings(settings) {
  return {
    encryptionAtRest: Boolean(settings?.encryptionAtRest),
    encryptionAlgorithm: normalizeAlgorithm(settings?.encryptionAlgorithm),
    passwordBinding: settings?.encryptionPasswordEnabled ? String(settings.encryptionPasswordHash || '') : '',
  }
}

async function rewriteBackupEncryption(policy) {
  await fs.mkdir(backupRoot, { recursive: true })
  const entries = await fs.readdir(backupRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !isBackupArchiveName(entry.name) || entry.name.endsWith('.meta')) continue
    const target = path.join(backupRoot, entry.name)
    const current = await fs.readFile(target)
    const { plain, encrypted, profile } = decodeBackupPayload(current)
    const wantsEncryption = Boolean(policy?.encryptionAtRest)
    if (!wantsEncryption && !encrypted) continue
    if (
      wantsEncryption
      && encrypted
      && profile?.algorithm === policy.encryptionAlgorithm
      && profile?.passwordBinding === String(policy.passwordBinding || '')
    ) continue
    const next = encodeBackupPayload(plain, policy)
    await writeSnapshotFile(target, next)
  }
  invalidateBackupListCache()
}

async function captureLocalDatabaseSnapshot() {
  if (databaseRunsInMemory && db) return db.serialize()
  await fs.mkdir(storageRoot, { recursive: true })
  const snapshotPath = path.join(storageRoot, `.database-snapshot-${process.pid}-${Date.now()}.sqlite`)
  try {
    await getDb().backup(snapshotPath)
    return await fs.readFile(snapshotPath)
  } finally {
    await fs.rm(snapshotPath, { force: true }).catch(() => undefined)
  }
}

async function synchronizeExternalDatabase({ force = false } = {}) {
  if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration) || suppressExternalSync) return null
  if (externalSyncPromise && !force) return externalSyncPromise
  const sync = (async () => {
    const payload = await captureLocalDatabaseSnapshot()
    const revision = Number(sharedStoreCache?.meta?.revision ?? 0)
    const durablePayload = encodeExternalStatePayload(payload)
    await writeExternalDatabaseState(activeDatabaseConfiguration, durablePayload, revision, nowStamp())
    return { bytes: durablePayload.length, revision }
  })()
  externalSyncPromise = sync
  try {
    return await sync
  } finally {
    if (externalSyncPromise === sync) externalSyncPromise = null
  }
}

function scheduleExternalDatabaseSync() {
  if (!storageInitialized || !isExternalDatabaseConfiguration(activeDatabaseConfiguration) || suppressExternalSync) return
  if (externalSyncTimer) return
  externalSyncTimer = setTimeout(() => {
    externalSyncTimer = null
    void synchronizeExternalDatabase().catch((error) => {
      console.error('[storage] Failed to synchronize the external database:', error)
    })
  }, 80)
  externalSyncTimer.unref?.()
}

async function prepareConfiguredDatabaseSource() {
  // Test workers must never open the live workspace database or its persisted
  // external-database configuration. Besides leaking fixtures between suites,
  // a route test could otherwise replace a real encrypted AI credential when
  // its seeded snapshot is written back.
  const persisted = process.env.NODE_ENV === 'test'
    ? null
    : await readPersistedDatabaseConfiguration()
  const next = persisted ?? { type: 'sqlite', sqlitePath: defaultSqlitePath }
  activeDatabaseConfiguration = next
  if (!isExternalDatabaseConfiguration(next)) {
    setActiveSqlitePath(next.sqlitePath)
    return
  }

  // The selected server is the durable source. A local SQLite file remains a
  // compatibility cache for the current SQL layer and is refreshed before the
  // cache is opened, so a restart never silently falls back to stale local data.
  setActiveSqlitePath(defaultSqlitePath)
  const remote = await readExternalDatabaseState(next)
  if (!remote?.payload?.length) {
    const error = new Error('The selected database does not contain PhD Atlas data yet.')
    error.code = 'DATABASE_STATE_MISSING'
    error.status = 409
    throw error
  }
  closeOpenDatabase()
  const encryptedRemote = remote.payload.subarray(0, EXTERNAL_STATE_MAGIC.length).equals(EXTERNAL_STATE_MAGIC)
  const remoteImage = decodeExternalStatePayload(remote.payload)
  if (encryptedRemote) {
    pendingDatabaseImage = sqliteImageForMemory(remoteImage)
    databaseRunsInMemory = true
    await removePlainSqliteArtifacts()
  } else {
    databaseRunsInMemory = false
    await writeSnapshotFile(databasePath, remoteImage)
  }
  await Promise.all([
    fs.rm(`${databasePath}-wal`, { force: true }),
    fs.rm(`${databasePath}-shm`, { force: true }),
  ])
  invalidateSharedStoreCache()
}

/** Validate a candidate without changing the active data source. */
export async function testDatabaseConfiguration(input, options = {}) {
  const persisted = await readPersistedDatabaseConfiguration()
  const candidate = { ...(input ?? {}) }
  if (
    isExternalDatabaseConfiguration(candidate)
    && !candidate.password
    && persisted?.type === candidate.type
    && persisted.host === candidate.host
    && String(persisted.port) === String(candidate.port ?? persisted.port)
    && persisted.database === candidate.database
    && persisted.username === candidate.username
  ) {
    candidate.password = persisted.password
  }
  const verified = await verifyDatabaseConnection(candidate, options)
  if (options.requireEmptyState && isExternalDatabaseConfiguration(candidate)) {
    await assertExternalDatabaseTargetEmpty(candidate)
  }
  return verified
}

/**
 * Migrate the current consistent workspace snapshot to the selected engine, then
 * persist the source selector. The selector is written only after the target has
 * accepted the snapshot, so a bad connection cannot strand an installation.
 */
export async function configureDatabaseConfiguration(input, options = {}) {
  await ensureStorage()
  const persisted = await readPersistedDatabaseConfiguration()
  const candidateInput = { ...(input ?? {}) }
  if (
    isExternalDatabaseConfiguration(candidateInput)
    && !candidateInput.password
    && persisted?.type === candidateInput.type
    && persisted.host === candidateInput.host
    && String(persisted.port) === String(candidateInput.port ?? persisted.port)
    && persisted.database === candidateInput.database
    && persisted.username === candidateInput.username
  ) {
    candidateInput.password = persisted.password
  }
  const candidate = await verifyDatabaseConnection(candidateInput)
  const normalized = candidateInput?.type === 'sqlite'
    ? { type: 'sqlite', sqlitePath: candidate.sqlitePath }
    : {
        ...candidateInput,
        type: candidate.type,
        host: candidate.host,
        port: candidate.port,
        database: candidate.database,
        username: candidate.username,
        ssl: candidate.ssl,
        schema: candidate.schema,
      }
  const currentSnapshot = await captureLocalDatabaseSnapshot()

  if (isExternalDatabaseConfiguration(normalized)) {
    const revision = Number(sharedStoreCache?.meta?.revision ?? 0)
    await writeExternalDatabaseState(
      normalized,
      encodeExternalStatePayload(currentSnapshot),
      revision,
      nowStamp(),
      { overwrite: options.allowExistingState !== false },
    )
    await persistDatabaseConfiguration(normalized)
    activeDatabaseConfiguration = await readPersistedDatabaseConfiguration()
    return getDatabaseConfiguration()
  }

  const targetPath = path.resolve(normalized.sqlitePath)
  closeOpenDatabase()
  await writeSnapshotFile(targetPath, currentSnapshot)
  await Promise.all([
    fs.rm(`${targetPath}-wal`, { force: true }),
    fs.rm(`${targetPath}-shm`, { force: true }),
  ])
  setActiveSqlitePath(targetPath)
  activeDatabaseConfiguration = normalized
  await persistDatabaseConfiguration(normalized)
  storageReadyPromise = null
  storageInitialized = false
  await ensureStorage()
  return getDatabaseConfiguration()
}

async function countFilesRecursive(dirPath) {
  let count = 0
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      count += await countFilesRecursive(fullPath)
    } else if (entry.isFile()) {
      count += 1
    }
  }
  return count
}

async function packDirectoryTarGz(sourceDir, targetPath) {
  await pipeline(
    tar.pack(sourceDir),
    createGzip({ level: 6 }),
    createWriteStream(targetPath),
  )
}

async function extractTarGz(archivePath, targetDir) {
  await fs.mkdir(targetDir, { recursive: true })
  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    tar.extract(targetDir),
  )
}

/**
 * Full system backup: SQLite database (hot backup) + uploads directory, packed as .tar.gz.
 */
async function createWorkspaceArchiveBackup(actorId, options = {}) {
  await ensureStorage()
  await fs.mkdir(backupRoot, { recursive: true })

  const stamp = nowStamp().replaceAll(':', '-').replaceAll('.', '-')
  const fileName = `phd-atlas-backup-${stamp}.tar.gz`
  const target = path.join(backupRoot, fileName)
  const stagingDir = path.join(backupRoot, `.staging-workspace-${process.pid}-${stamp}`)
  const createdAt = nowStamp()

  try {
    await fs.rm(stagingDir, { recursive: true, force: true })
    await fs.mkdir(stagingDir, { recursive: true })

    const sqliteTarget = path.join(stagingDir, 'phd-atlas.sqlite')
    const uploadsStaging = path.join(stagingDir, 'uploads')
    await fs.mkdir(uploadsStaging, { recursive: true })

    const sourceConfiguration = activeDatabaseConfiguration
    let externalState = null
    let databaseSqlFile = null
    if (isExternalDatabaseConfiguration(sourceConfiguration)) {
      // Flush the compatibility cache, then read back from the selected server.
      // The resulting archive is therefore a backup of the configured database,
      // rather than a local-cache-only snapshot.
      await synchronizeExternalDatabase({ force: true })
      externalState = await readExternalDatabaseState(sourceConfiguration)
      if (!externalState?.payload?.length) {
        throw backupFileError(502, 'DATABASE_BACKUP_FAILED', 'The configured database did not return a workspace snapshot.')
      }
      await fs.writeFile(sqliteTarget, decodeExternalStatePayload(externalState.payload))
      databaseSqlFile = `database-${sourceConfiguration.type}.sql`
      await fs.writeFile(
        path.join(stagingDir, databaseSqlFile),
        createExternalDatabaseSqlDump(sourceConfiguration, externalState),
        'utf8',
      )
    } else {
      const database = getDb()
      await database.backup(sqliteTarget)
    }

    let uploadCount = 0
    try {
      await fs.cp(uploadRoot, uploadsStaging, { recursive: true, force: true })
      uploadCount = await countFilesRecursive(uploadsStaging)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const metadata = {
      kind: 'workspace',
      format: isExternalDatabaseConfiguration(sourceConfiguration)
        ? `${sourceConfiguration.type}-state-sql-uploads-v1`
        : 'sqlite-uploads-v1',
      createdAt,
      actorId,
      databaseAdapter: sourceConfiguration.type,
      databaseFile: 'phd-atlas.sqlite',
      databaseSqlFile,
      databaseRevision: externalState?.revision ?? Number(sharedStoreCache?.meta?.revision ?? 0),
      uploadsDir: 'uploads',
      uploadCount,
      databasePath: isExternalDatabaseConfiguration(sourceConfiguration)
        ? sourceConfiguration.database
        : databasePath,
      uploadRoot,
    }
    await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(metadata, null, 2), 'utf8')

    await packDirectoryTarGz(stagingDir, target)
    const backupPolicy = options.encryptionPolicy ?? activeEncryptionPolicy
    if (backupPolicy?.encryptionAtRest) {
      await writeSnapshotFile(target, encodeBackupPayload(await fs.readFile(target), backupPolicy))
    }
    const stat = await fs.stat(target)
    await writeBackupMetadata(fileName, stat, metadata, null).catch(() => undefined)
    invalidateBackupListCache(fileName)

    return {
      fileName,
      path: target,
      size: stat.size,
      createdAt,
      actorId,
      applicationId: null,
      applicationName: undefined,
      kind: 'workspace',
      format: isExternalDatabaseConfiguration(sourceConfiguration)
        ? `${sourceConfiguration.type}-state-sql-uploads-v1`
        : 'sqlite-uploads-v1',
      uploadCount,
    }
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function restoreWorkspaceArchive(fileName, options = {}) {
  const backup = resolveBackupFile(fileName)
  if (!backup.fileName.endsWith('.tar.gz')) {
    throw backupFileError(400, 'INVALID_BACKUP_FORMAT', 'Workspace archive restore requires a .tar.gz backup.')
  }

  const extractDir = path.join(backupRoot, `.restore-workspace-${process.pid}-${Date.now()}`)
  const preRestoreDir = path.join(backupRoot, `.pre-restore-${process.pid}-${Date.now()}`)

  try {
    const archivePayload = decodeBackupPayload(await fs.readFile(backup.path)).plain
    const readableArchive = path.join(extractDir, '.workspace-backup.tar.gz')
    await fs.mkdir(extractDir, { recursive: true })
    await fs.writeFile(readableArchive, archivePayload)
    await extractTarGz(readableArchive, extractDir)

    const manifestPath = path.join(extractDir, 'manifest.json')
    let manifest = null
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    } catch {
      manifest = null
    }
    if (manifest?.kind && manifest.kind !== 'workspace') {
      throw backupFileError(400, 'INVALID_BACKUP_FORMAT', 'Only workspace archives can be restored this way.')
    }

    const sqliteSource = path.join(extractDir, manifest?.databaseFile || 'phd-atlas.sqlite')
    if (!(await pathExists(sqliteSource))) {
      throw backupFileError(400, 'INVALID_BACKUP_FORMAT', 'Workspace archive is missing the SQLite database file.')
    }

    const uploadsSource = path.join(extractDir, manifest?.uploadsDir || 'uploads')
    const archiveAdapter = manifest?.databaseAdapter ?? 'sqlite'
    if (archiveAdapter !== currentDatabaseAdapter()) {
      throw backupFileError(
        409,
        'DATABASE_ADAPTER_MISMATCH',
        'Select the same database engine that created this workspace backup before restoring it.',
      )
    }
    const liveSqlite = databasePath
    const liveWal = `${databasePath}-wal`
    const liveShm = `${databasePath}-shm`
    const preservedSqlite = path.join(preRestoreDir, 'phd-atlas.sqlite')
    const preservedUploads = path.join(preRestoreDir, 'uploads')

    await withWriteLock(async () => {
      await fs.mkdir(preRestoreDir, { recursive: true })
      closeOpenDatabase()

      try {
        if (await pathExists(liveSqlite)) {
          await fs.rename(liveSqlite, preservedSqlite)
        }
        await fs.rm(liveWal, { force: true }).catch(() => undefined)
        await fs.rm(liveShm, { force: true }).catch(() => undefined)
        await fs.copyFile(sqliteSource, liveSqlite)

        if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
          const snapshot = await fs.readFile(sqliteSource)
          await writeExternalDatabaseState(
            activeDatabaseConfiguration,
            encodeExternalStatePayload(snapshot),
            Number(manifest?.databaseRevision ?? 0),
            String(manifest?.createdAt ?? nowStamp()),
          )
        }

        if (await pathExists(uploadRoot)) {
          await fs.rename(uploadRoot, preservedUploads)
        }
        await fs.mkdir(uploadRoot, { recursive: true })
        if (await pathExists(uploadsSource)) {
          await fs.cp(uploadsSource, uploadRoot, { recursive: true, force: true })
        }

        storageReadyPromise = null
        await ensureStorage()
      } catch (error) {
        closeOpenDatabase()
        await fs.rm(liveSqlite, { force: true }).catch(() => undefined)
        await fs.rm(liveWal, { force: true }).catch(() => undefined)
        await fs.rm(liveShm, { force: true }).catch(() => undefined)
        if (await pathExists(preservedSqlite)) {
          await fs.rename(preservedSqlite, liveSqlite).catch(() => undefined)
        }
        await fs.rm(uploadRoot, { recursive: true, force: true }).catch(() => undefined)
        if (await pathExists(preservedUploads)) {
          await fs.rename(preservedUploads, uploadRoot).catch(() => undefined)
        }
        storageReadyPromise = null
        await ensureStorage().catch(() => undefined)
        throw error
      }
    })

    const store = await readStore()
    if (options.actorId) {
      logEvent(store, {
        actorId: options.actorId,
        scope: 'Backup',
        message: `Restored workspace archive ${backup.fileName}`,
        metadata: {
          fileName: backup.fileName,
          format: manifest?.format ?? 'sqlite-uploads-v1',
          uploadCount: manifest?.uploadCount,
        },
      })
      await writeStore(store)
    }
    return store
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(preRestoreDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function applyEncryptionPolicyFromSettings(settings) {
  const algorithm = normalizeAlgorithm(settings?.encryptionAlgorithm)
  const passwordEnabled = Boolean(settings?.encryptionPasswordEnabled)
  const passwordSalt = typeof settings?.encryptionPasswordSalt === 'string'
    ? settings.encryptionPasswordSalt
    : ''
  // Password itself is never persisted; only a salt + verifier. Runtime password
  // is supplied via setEncryptionPassword() after admin unlocks the session.
  setRuntimeCryptoConfig({
    algorithm,
    passwordBinding: passwordEnabled ? String(settings?.encryptionPasswordHash || '') : '',
  })
  activeEncryptionPolicy = {
    encryptionAtRest: Boolean(settings?.encryptionAtRest),
    encryptionAlgorithm: algorithm,
    encryptionPasswordEnabled: passwordEnabled,
    encryptionPasswordSalt: passwordSalt,
    passwordBinding: passwordEnabled ? String(settings?.encryptionPasswordHash || '') : '',
    sqliteEncryption: Boolean(settings?.sqliteEncryption && settings?.encryptionAtRest),
  }
  return activeEncryptionPolicy
}

/**
 * Kept for API compatibility — field sealing uses the server env key.
 * Password is only verified for admin re-key authorization.
 * @param {string} _password
 */
export function setEncryptionPassword(_password) {
  // no-op by design (see crypto.js)
}

export function getEncryptionPolicy() {
  if (!activeEncryptionPolicy) return getRuntimeCryptoConfig()
  const { passwordBinding: _passwordBinding, ...publicPolicy } = activeEncryptionPolicy
  return { ...publicPolicy, ...getRuntimeCryptoConfig() }
}

function encodePayloadForStorage(value) {
  const json = typeof value === 'string' ? value : toJson(value)
  if (!activeEncryptionPolicy?.encryptionAtRest) {
    // If a previously encrypted payload is written while encryption is off, decrypt first.
    if (isEncryptedPayload(json)) return decryptPayload(json)
    return json
  }
  if (isEncryptedPayload(json)) return json
  return encryptPayload(json)
}

function decodePayloadFromStorage(value) {
  if (!value) return {}
  const plain = isEncryptedPayload(value) ? decryptPayload(value) : value
  return fromJson(plain, {})
}

async function maybeUnsealDatabase() {
  await recoverOrCleanInterruptedSqliteSeals()
  const sealed = await sealedSqliteExists(sealedDatabasePath)
  if (!sealed) return
  // The authenticated image is opened directly in memory. No plaintext SQLite
  // file is materialized while whole-file encryption is enabled.
  const hexKey = deriveSqliteKey()
  pendingDatabaseImage = sqliteImageForMemory(await unsealSqliteBuffer(sealedDatabasePath, hexKey))
  databaseRunsInMemory = true
  await removePlainSqliteArtifacts()
}

async function maybeSealDatabase() {
  if (!activeEncryptionPolicy?.sqliteEncryption) return
  // Vitest starts multiple isolated API instances against the same fixture
  // directory. Persistence itself is covered by encryption-storage.test.js;
  // route tests must not race to replace the shared production seal.
  if (process.env.NODE_ENV === 'test') return
  try {
    const hexKey = deriveSqliteKey()
    if (databaseRunsInMemory && db) {
      await sealSqliteBuffer(
        db.serialize(),
        sealedDatabasePath,
        hexKey,
        activeEncryptionPolicy.encryptionAlgorithm,
      )
      return
    }
    if (!(await plainSqliteExists(databasePath))) return
    if (db) {
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
    }
    await sealSqliteFile(
      databasePath,
      sealedDatabasePath,
      hexKey,
      activeEncryptionPolicy.encryptionAlgorithm,
    )
  } catch (error) {
    console.error('[storage] Failed to seal SQLite database:', error)
  }
}

async function reconcileSqliteEncryptionMode() {
  const shouldUseMemory = Boolean(
    (activeEncryptionPolicy?.sqliteEncryption && !isExternalDatabaseConfiguration(activeDatabaseConfiguration))
    || (activeEncryptionPolicy?.encryptionAtRest && isExternalDatabaseConfiguration(activeDatabaseConfiguration)),
  )
  if (shouldUseMemory === databaseRunsInMemory) {
    if (shouldUseMemory) await maybeSealDatabase()
    return
  }

  if (shouldUseMemory) {
    const database = getDb()
    try { database.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
    const image = database.serialize()
    if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
      await sealSqliteBuffer(
        image,
        sealedDatabasePath,
        deriveSqliteKey(),
        activeEncryptionPolicy.encryptionAlgorithm,
      )
    }
    pendingDatabaseImage = sqliteImageForMemory(image)
    closeOpenDatabase()
    databaseRunsInMemory = true
    getDb()
    await removePlainSqliteArtifacts()
    return
  }

  const image = db?.serialize() ?? pendingDatabaseImage
  if (!image) throw new Error('Cannot disable SQLite encryption without a valid database image.')
  await writeSnapshotFile(databasePath, image)
  pendingDatabaseImage = null
  closeOpenDatabase()
  databaseRunsInMemory = false
  getDb()
  if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
    await fs.rm(sealedDatabasePath, { force: true })
  }
}

function scheduleSealDatabase() {
  if (!activeEncryptionPolicy?.sqliteEncryption) return
  if (sealAfterWriteTimer) clearTimeout(sealAfterWriteTimer)
  sealAfterWriteTimer = setTimeout(() => {
    sealAfterWriteTimer = null
    void maybeSealDatabase()
  }, 1500)
}

function getDb() {
  if (db) {
    return db
  }

  const initialImage = pendingDatabaseImage
  pendingDatabaseImage = null
  const rawDatabase = initialImage ? new Database(initialImage) : new Database(databasePath)
  // Most domain helpers issue focused SQL writes directly instead of going through
  // writeStore(). Track statement mutations here so the selected external engine
  // remains current even for passkeys, notifications, mail cursors, and teams.
  db = new Proxy(rawDatabase, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (...args) => {
          const statement = target.prepare(...args)
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              const value = Reflect.get(statementTarget, statementProperty, statementReceiver)
              if (statementProperty === 'run' || statementProperty === 'exec') {
                return (...statementArgs) => {
                  const result = value.apply(statementTarget, statementArgs)
                  scheduleExternalDatabaseSync()
                  scheduleSealDatabase()
                  return result
                }
              }
              return typeof value === 'function' ? value.bind(statementTarget) : value
            },
          })
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  db.pragma(databaseRunsInMemory ? 'journal_mode = MEMORY' : 'journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('busy_timeout = 5000')
  // Bound SQLite's hot-page cache and allow read-only pages to be served from
  // mmap. This reduces repeated filesystem reads during parallel workspace GETs
  // without weakening WAL durability semantics.
  db.pragma('cache_size = -32768')
  if (!databaseRunsInMemory) {
    db.pragma('mmap_size = 134217728')
    db.pragma('wal_autocheckpoint = 1000')
  }
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      allow_registration INTEGER NOT NULL,
      notification_mailbox TEXT NOT NULL,
      backup_frequency TEXT NOT NULL,
      max_backups_per_app_limit INTEGER NOT NULL DEFAULT 20,
      encryption_at_rest INTEGER NOT NULL,
      admin_session_duration_minutes INTEGER NOT NULL DEFAULT 120,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      disabled_at TEXT,
      settings_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      school_name TEXT NOT NULL,
      professor_name TEXT NOT NULL,
      program TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_applications_owner_deadline
      ON applications(owner_id, deadline);
    CREATE INDEX IF NOT EXISTS idx_applications_owner_status
      ON applications(owner_id, status);

    CREATE TABLE IF NOT EXISTS profile_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_events (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_system_events_time
      ON system_events(time DESC);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
      ON password_reset_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS webauthn_passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports_json TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL DEFAULT '',
      backed_up INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_webauthn_passkeys_user
      ON webauthn_passkeys(user_id);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      user_id TEXT,
      challenge_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
      ON webauthn_challenges(purpose, challenge_hash, used_at, expires_at);

    CREATE TABLE IF NOT EXISTS mail_fetch_state (
      user_id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL,
      account_key TEXT,
      uid_validity TEXT,
      last_uid INTEGER NOT NULL DEFAULT 0,
      folder_states_json TEXT NOT NULL DEFAULT '{}',
      last_fetched_at TEXT,
      last_history_sync_at TEXT,
      last_history_imported INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_at TEXT,
      sync_job_id TEXT,
      sync_job_mode TEXT,
      sync_job_status TEXT,
      sync_job_created_at TEXT,
      sync_job_started_at TEXT,
      sync_job_completed_at TEXT,
      sync_job_result_json TEXT NOT NULL DEFAULT '{}',
      sync_job_error_code TEXT,
      sync_job_error_message TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      application_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_messages_user_msgid
      ON processed_messages(user_id, message_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      application_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      trigger_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      archived_at TEXT,
      target_path TEXT,
      target_tab TEXT,
      target_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      emailed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
      ON notifications(user_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
      ON push_subscriptions(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS notification_groups (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      owner_id TEXT,
      team_id TEXT,
      name TEXT NOT NULL,
      member_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notification_groups_scope_owner
      ON notification_groups(scope, owner_id);
    CREATE INDEX IF NOT EXISTS idx_notification_groups_team
      ON notification_groups(team_id);

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      seat_limit INTEGER NOT NULL DEFAULT 5,
      logo_data_url TEXT NOT NULL DEFAULT '',
      profile_presets_json TEXT,
      teacher_groups_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT,
      invited_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL,
      relationship_json TEXT NOT NULL DEFAULT '{}',
      profile_json TEXT NOT NULL DEFAULT '{}',
      invite_token_hash TEXT,
      invite_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(invited_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_team_email
      ON team_members(team_id, invited_email);
    CREATE INDEX IF NOT EXISTS idx_team_members_team_created
      ON team_members(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_team_members_user
      ON team_members(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_invite_hash
      ON team_members(invite_token_hash);

    CREATE TABLE IF NOT EXISTS team_join_codes (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
      created_by TEXT NOT NULL,
      teacher_ids_json TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT NOT NULL,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_team_join_codes_team
      ON team_join_codes(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_team_join_codes_expiry
      ON team_join_codes(expires_at);

    -- API credentials are deliberately kept outside users.settings_json so they can
    -- never be included in a public user/settings response by accident.
    CREATE TABLE IF NOT EXISTS ai_api_keys (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      team_id TEXT,
      scope TEXT NOT NULL CHECK(scope IN ('personal', 'team')),
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      api_key_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      call_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      usage_reset_at TEXT,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_api_keys_owner
      ON ai_api_keys(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_api_keys_team
      ON ai_api_keys(team_id, created_at DESC);
  `)

  const systemColumns = new Set(
    db.prepare('PRAGMA table_info(system_settings)').all().map((column) => column.name),
  )
  const addSystemColumn = (name, definition) => {
    if (!systemColumns.has(name)) {
      db.prepare(`ALTER TABLE system_settings ADD COLUMN ${name} ${definition}`).run()
    }
  }
  addSystemColumn('smtp_host', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn('smtp_port', 'INTEGER NOT NULL DEFAULT 587')
  addSystemColumn('smtp_user', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn('smtp_pass', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn('smtp_tls', 'INTEGER NOT NULL DEFAULT 1')
  addSystemColumn('admin_session_duration_minutes', `INTEGER NOT NULL DEFAULT ${DEFAULT_ADMIN_SESSION_MINUTES}`)
  addSystemColumn('max_backups_per_app_limit', `INTEGER NOT NULL DEFAULT ${DEFAULT_PRO_MAX_BACKUPS_PER_APP}`)
  addSystemColumn('encryption_algorithm', "TEXT NOT NULL DEFAULT 'aes-256-gcm'")
  addSystemColumn('encryption_password_enabled', 'INTEGER NOT NULL DEFAULT 0')
  addSystemColumn('encryption_password_hash', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn('encryption_password_salt', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn('sqlite_encryption', 'INTEGER NOT NULL DEFAULT 0')

  const aiKeyColumns = new Set(
    db.prepare('PRAGMA table_info(ai_api_keys)').all().map((column) => column.name),
  )
  const addAiKeyColumn = (name, definition) => {
    if (!aiKeyColumns.has(name)) {
      db.prepare(`ALTER TABLE ai_api_keys ADD COLUMN ${name} ${definition}`).run()
    }
  }
  addAiKeyColumn('call_count', 'INTEGER NOT NULL DEFAULT 0')
  addAiKeyColumn('input_tokens', 'INTEGER NOT NULL DEFAULT 0')
  addAiKeyColumn('output_tokens', 'INTEGER NOT NULL DEFAULT 0')
  addAiKeyColumn('total_tokens', 'INTEGER NOT NULL DEFAULT 0')
  addAiKeyColumn('usage_reset_at', 'TEXT')

  const userColumns = new Set(
    db.prepare('PRAGMA table_info(users)').all().map((column) => column.name),
  )
  if (!userColumns.has('disabled_at')) {
    db.prepare('ALTER TABLE users ADD COLUMN disabled_at TEXT').run()
  }

  const applicationColumns = new Set(
    db.prepare('PRAGMA table_info(applications)').all().map((column) => column.name),
  )
  if (!applicationColumns.has('team_id')) {
    db.prepare('ALTER TABLE applications ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL').run()
  }
  const teamMemberColumns = new Set(
    db.prepare('PRAGMA table_info(team_members)').all().map((column) => column.name),
  )
  if (!teamMemberColumns.has('relationship_json')) {
    db.prepare("ALTER TABLE team_members ADD COLUMN relationship_json TEXT NOT NULL DEFAULT '{}'").run()
  }
  if (!teamMemberColumns.has('profile_json')) {
    db.prepare("ALTER TABLE team_members ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}'").run()
  }
  const teamColumns = new Set(
    db.prepare('PRAGMA table_info(teams)').all().map((column) => column.name),
  )
  if (!teamColumns.has('profile_presets_json')) {
    db.prepare('ALTER TABLE teams ADD COLUMN profile_presets_json TEXT').run()
  }
  if (!teamColumns.has('logo_data_url')) {
    db.prepare("ALTER TABLE teams ADD COLUMN logo_data_url TEXT NOT NULL DEFAULT ''").run()
  }
  if (!teamColumns.has('role_labels_json')) {
    db.prepare('ALTER TABLE teams ADD COLUMN role_labels_json TEXT').run()
  }
  if (!teamColumns.has('teacher_groups_json')) {
    db.prepare('ALTER TABLE teams ADD COLUMN teacher_groups_json TEXT').run()
  }
  const notificationColumns = new Set(
    db.prepare('PRAGMA table_info(notifications)').all().map((column) => column.name),
  )
  if (!notificationColumns.has('archived_at')) {
    db.prepare('ALTER TABLE notifications ADD COLUMN archived_at TEXT').run()
  }
  if (!notificationColumns.has('target_path')) {
    db.prepare('ALTER TABLE notifications ADD COLUMN target_path TEXT').run()
  }
  if (!notificationColumns.has('target_tab')) {
    db.prepare('ALTER TABLE notifications ADD COLUMN target_tab TEXT').run()
  }
  if (!notificationColumns.has('target_id')) {
    db.prepare('ALTER TABLE notifications ADD COLUMN target_id TEXT').run()
  }
  if (!notificationColumns.has('metadata_json')) {
    db.prepare("ALTER TABLE notifications ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'").run()
  }
  const mailFetchColumns = new Set(
    db.prepare('PRAGMA table_info(mail_fetch_state)').all().map((column) => column.name),
  )
  if (!mailFetchColumns.has('account_key')) {
    db.prepare('ALTER TABLE mail_fetch_state ADD COLUMN account_key TEXT').run()
  }
  if (!mailFetchColumns.has('folder_states_json')) {
    db.prepare("ALTER TABLE mail_fetch_state ADD COLUMN folder_states_json TEXT NOT NULL DEFAULT '{}'").run()
  }
  if (!mailFetchColumns.has('last_history_sync_at')) {
    db.prepare('ALTER TABLE mail_fetch_state ADD COLUMN last_history_sync_at TEXT').run()
  }
  if (!mailFetchColumns.has('last_history_imported')) {
    db.prepare('ALTER TABLE mail_fetch_state ADD COLUMN last_history_imported INTEGER NOT NULL DEFAULT 0').run()
  }
  const mailSyncJobColumns = [
    ['sync_job_id', 'TEXT'],
    ['sync_job_mode', 'TEXT'],
    ['sync_job_status', 'TEXT'],
    ['sync_job_created_at', 'TEXT'],
    ['sync_job_started_at', 'TEXT'],
    ['sync_job_completed_at', 'TEXT'],
    ['sync_job_result_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['sync_job_error_code', 'TEXT'],
    ['sync_job_error_message', 'TEXT'],
  ]
  for (const [column, definition] of mailSyncJobColumns) {
    if (!mailFetchColumns.has(column)) {
      db.prepare(`ALTER TABLE mail_fetch_state ADD COLUMN ${column} ${definition}`).run()
    }
  }
  // A process exit may interrupt an IMAP connection. Re-queue that durable job
  // so the server worker resumes it after restart instead of leaving it stuck.
  db.prepare(
    `UPDATE mail_fetch_state
     SET sync_job_status = 'queued', sync_job_started_at = NULL
     WHERE sync_job_status = 'running'`,
  ).run()
  db.prepare("UPDATE users SET role = 'user' WHERE role = 'owner'").run()
  db.prepare("UPDATE users SET role = 'user' WHERE email = ? AND role = 'admin'").run(DEFAULT_USER_EMAIL)
  db.prepare("UPDATE users SET role = 'user' WHERE role NOT IN ('admin', 'user')").run()

  return db
}

function settingsFromRow(row) {
  return {
    allowRegistration: intBool(row.allow_registration),
    notificationMailbox: row.notification_mailbox,
    backupFrequency: normalizeBackupFrequency(row.backup_frequency),
    maxBackupsPerAppLimit: Math.min(
      MAX_SYSTEM_BACKUP_LIMIT,
      Math.max(MIN_SYSTEM_BACKUP_LIMIT, normalizeBackupLimit(row.max_backups_per_app_limit, DEFAULT_PRO_MAX_BACKUPS_PER_APP)),
    ),
    encryptionAtRest: intBool(row.encryption_at_rest),
    encryptionAlgorithm: normalizeAlgorithm(row.encryption_algorithm),
    encryptionPasswordEnabled: intBool(row.encryption_password_enabled ?? 0),
    encryptionPasswordHash: row.encryption_password_hash ?? '',
    encryptionPasswordSalt: row.encryption_password_salt ?? '',
    sqliteEncryption: intBool(row.sqlite_encryption ?? 0),
    smtpHost: row.smtp_host ?? '',
    smtpPort: Number(row.smtp_port ?? 587),
    smtpUser: row.smtp_user ?? '',
    smtpPass: decryptSecret(row.smtp_pass ?? ''),
    smtpTls: intBool(row.smtp_tls ?? 1),
    adminSessionDurationMinutes: normalizeSessionMinutes(
      row.admin_session_duration_minutes,
      DEFAULT_ADMIN_SESSION_MINUTES,
    ),
  }
}

/** Masks the system SMTP secret before the settings object is sent to any client. */
export function publicSystemSettings(settings) {
  if (!settings) return settings
  return {
    ...settings,
    smtpPass: '',
    smtpPassSet: Boolean(settings.smtpPass),
    // Never return password material to the client.
    encryptionPasswordHash: '',
    encryptionPasswordSalt: settings.encryptionPasswordEnabled
      ? (settings.encryptionPasswordSalt ? 'set' : '')
      : '',
    encryptionPasswordSet: Boolean(settings.encryptionPasswordEnabled && settings.encryptionPasswordHash),
  }
}

function userFromRow(row) {
  const settings = fromJson(row.settings_json, {})
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeUserRole(row.role),
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at ?? null,
    settings: {
      ...settings,
      // Decrypted once on load so every in-process consumer (mailer, mail fetch) sees real values;
      // normalizeUserSettings() is the only place these get masked again for API responses.
      smtpPass: decryptSecret(settings.smtpPass ?? ''),
      incomingPass: decryptSecret(settings.incomingPass ?? ''),
    },
  }
  user.settings = migrateStoredQuotaSettings(user)
  return user
}

function applicationFromRow(row) {
  const payload = decodePayloadFromStorage(row.payload_json)
  return {
    ...payload,
    id: row.id,
    ownerId: row.owner_id,
    teamId: row.team_id ?? null,
    createdAt: payload.createdAt,
    updatedAt: row.updated_at,
  }
}

function profileAssetFromRow(row) {
  const payload = decodePayloadFromStorage(row.payload_json)
  // Legacy rows stored a single fileId/fileName/... directly on the asset; fold that into the
  // attachments array so older data keeps working without a migration script.
  const legacyAttachment = payload.fileId
    ? [{
        id: payload.fileId,
        fileId: payload.fileId,
        fileName: payload.fileName ?? '',
        fileSize: payload.fileSize,
        mimeType: payload.mimeType,
        storageName: payload.storageName,
      }]
    : []
  return {
    ...payload,
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind,
    description: payload.description ?? '',
    notes: payload.notes ?? '',
    customLabelZh: payload.customLabelZh ?? '',
    customLabelEn: payload.customLabelEn ?? '',
    attachments: payload.attachments ?? legacyAttachment,
    shares: payload.shares ?? [],
    updatedAt: row.updated_at,
  }
}

function eventFromRow(row) {
  return {
    id: row.id,
    time: row.time,
    scope: row.scope,
    actorId: row.actor_id,
    message: row.message,
    metadata: fromJson(row.metadata_json, {}),
  }
}

async function createSeedStore() {
  const passwordHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 12)
  const adminPasswordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12)
  const ownerId = createId('user')
  const adminId = createId('user')
  const now = nowStamp()

  const seedStore = {
    meta: {
      version: 1,
      createdAt: now,
      updatedAt: now,
      adapter: 'sqlite',
    },
    settings: {
      allowRegistration: true,
      notificationMailbox: PUBLIC_EDITION ? '' : 'admin-alerts@phd-atlas.local',
      backupFrequency: DEFAULT_BACKUP_FREQUENCY,
      maxBackupsPerAppLimit: DEFAULT_PRO_MAX_BACKUPS_PER_APP,
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
      encryptionPasswordEnabled: false,
      encryptionPasswordHash: '',
      encryptionPasswordSalt: '',
      sqliteEncryption: false,
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpTls: true,
      adminSessionDurationMinutes: DEFAULT_ADMIN_SESSION_MINUTES,
    },
    users: [
      {
        id: ownerId,
        name: 'Jasper',
        email: DEFAULT_USER_EMAIL,
        role: 'user',
        passwordHash,
        createdAt: now,
        lastLoginAt: null,
        disabledAt: null,
        settings: {
          language: 'en',
          highContrast: false,
          themeAccent: '#0071e3',
          sendFrom: 'alerts@phd-atlas.local',
          receiveAt: DEFAULT_USER_EMAIL,
          receiveEmails: [{ address: DEFAULT_USER_EMAIL, isPrimary: true, notify: true, verified: true }],
          planQuotaVersion: PLAN_QUOTA_VERSION,
          membershipPlan: 'free',
          autoBackup: false,
          backupFrequency: DEFAULT_BACKUP_FREQUENCY,
          maxBackupsPerApp: DEFAULT_MAX_BACKUPS_PER_APP,
          smtpHost: '',
          smtpPort: 587,
          smtpUser: '',
          smtpPass: '',
          smtpTls: true,
          incomingProtocol: 'imap',
          incomingHost: '',
          incomingPort: 993,
          incomingUser: '',
          incomingPass: '',
          incomingTls: true,
          storageQuotaMb: DEFAULT_FREE_STORAGE_QUOTA_MB,
          applicationQuota: DEFAULT_APPLICATION_QUOTA,
          applicationCreateQuota: DEFAULT_APPLICATION_QUOTA,
          applicationCreatedCount: 0,
          shareQuota: DEFAULT_FREE_SHARE_ACTIVE_QUOTA,
          shareCreateQuota: DEFAULT_FREE_SHARE_CREATE_QUOTA,
          shareCreatedCount: 0,
          trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
          sessionDurationMinutes: DEFAULT_USER_SESSION_MINUTES,
        },
      },
      {
        id: adminId,
        name: 'Administrator',
        email: DEFAULT_ADMIN_EMAIL,
        role: 'admin',
        passwordHash: adminPasswordHash,
        createdAt: now,
        lastLoginAt: null,
        disabledAt: null,
        settings: {
          language: 'en',
          highContrast: false,
          themeAccent: '#0071e3',
          sendFrom: 'admin-alerts@phd-atlas.local',
          receiveAt: DEFAULT_ADMIN_EMAIL,
          receiveEmails: [{ address: DEFAULT_ADMIN_EMAIL, isPrimary: true, notify: true, verified: true }],
          planQuotaVersion: PLAN_QUOTA_VERSION,
          membershipPlan: 'pro',
          autoBackup: false,
          backupFrequency: DEFAULT_BACKUP_FREQUENCY,
          maxBackupsPerApp: DEFAULT_ADMIN_MAX_BACKUPS_PER_APP,
          smtpHost: '',
          smtpPort: 587,
          smtpUser: '',
          smtpPass: '',
          smtpTls: true,
          incomingProtocol: 'imap',
          incomingHost: '',
          incomingPort: 993,
          incomingUser: '',
          incomingPass: '',
          incomingTls: true,
          storageQuotaMb: DEFAULT_PRO_STORAGE_QUOTA_MB,
          applicationQuota: MAX_APPLICATION_QUOTA,
          applicationCreateQuota: MAX_APPLICATION_QUOTA,
          applicationCreatedCount: 0,
          shareQuota: MAX_SHARE_QUOTA,
          shareCreateQuota: MAX_SHARE_QUOTA,
          shareCreatedCount: 0,
          trashRetentionDays: null,
          sessionDurationMinutes: DEFAULT_USER_SESSION_MINUTES,
        },
      },
    ],
    profileAssets: seedProfileAssets.map((asset) => ({
      ...asset,
      ownerId,
    })),
    applications: seedApplications.map((application) => ({
      ...application,
      ownerId,
      createdAt: now,
      updatedAt: now,
      shares: [],
      versions: application.materials.flatMap((material) => material.versions ?? []),
    })),
    systemEvents: [
      {
        id: createId('event'),
        time: now,
        scope: 'System bootstrap',
        actorId: ownerId,
        message: `Seeded SQLite workspace. Bootstrap user: ${DEFAULT_USER_EMAIL}`,
        metadata: {
          adapter: 'sqlite',
        },
      },
      {
        id: createId('event'),
        time: now,
        scope: 'System bootstrap',
        actorId: adminId,
        message: `Seeded default admin account: ${DEFAULT_ADMIN_EMAIL}`,
        metadata: {
          adapter: 'sqlite',
          role: 'admin',
        },
      },
    ],
  }

  if (PUBLIC_EDITION && process.env.NODE_ENV !== 'test') {
    seedStore.meta.publicSetupState = PUBLIC_SETUP_PENDING_STATE
    seedStore.users = []
    seedStore.profileAssets = []
    seedStore.applications = []
    seedStore.systemEvents = [{
      id: createId('event'),
      time: now,
      scope: 'System bootstrap',
      actorId: null,
      message: 'Initialized public workspace; administrator setup is pending',
      metadata: { adapter: 'sqlite', edition: 'public' },
    }]
  }

  return seedStore
}

async function ensureDefaultAdminUser(database) {
  const existing = database
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(DEFAULT_ADMIN_EMAIL)

  if (existing) {
    return
  }

  const now = nowStamp()
  const adminId = createId('user')
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12)
  database
    .prepare(
      `INSERT INTO users (
        id,
        name,
        email,
        role,
        password_hash,
        created_at,
        last_login_at,
        disabled_at,
        settings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      adminId,
      'Administrator',
      DEFAULT_ADMIN_EMAIL,
      'admin',
      passwordHash,
      now,
      null,
      null,
      toJson({
        language: 'en',
        highContrast: false,
        themeAccent: '#0071e3',
        sendFrom: 'admin-alerts@phd-atlas.local',
        receiveAt: DEFAULT_ADMIN_EMAIL,
        receiveEmails: [{ address: DEFAULT_ADMIN_EMAIL, isPrimary: true, notify: true, verified: true }],
        planQuotaVersion: PLAN_QUOTA_VERSION,
        membershipPlan: 'pro',
        autoBackup: false,
        backupFrequency: DEFAULT_BACKUP_FREQUENCY,
        maxBackupsPerApp: DEFAULT_ADMIN_MAX_BACKUPS_PER_APP,
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPass: '',
        smtpTls: true,
        incomingProtocol: 'imap',
        incomingHost: '',
        incomingPort: 993,
        incomingUser: '',
        incomingPass: '',
        incomingTls: true,
        storageQuotaMb: DEFAULT_PRO_STORAGE_QUOTA_MB,
        applicationQuota: MAX_APPLICATION_QUOTA,
        applicationCreateQuota: MAX_APPLICATION_QUOTA,
        applicationCreatedCount: 0,
        shareQuota: MAX_SHARE_QUOTA,
        shareCreateQuota: MAX_SHARE_QUOTA,
        shareCreatedCount: 0,
        trashRetentionDays: null,
        sessionDurationMinutes: DEFAULT_USER_SESSION_MINUTES,
      }),
    )

  database
    .prepare(
      `INSERT INTO system_events (
        id,
        time,
        scope,
        actor_id,
        message,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      createId('event'),
      now,
      'System bootstrap',
      adminId,
      `Seeded default admin account: ${DEFAULT_ADMIN_EMAIL}`,
      toJson({ adapter: 'sqlite', role: 'admin' }),
    )
}

function teamPlanSettings(settings = {}) {
  const personalMembershipPlan = settings.personalMembershipPlan === 'pro' ? 'pro' : 'free'
  const personalIsPro = personalMembershipPlan === 'pro'
  return {
    ...settings,
    planQuotaVersion: PLAN_QUOTA_VERSION,
    membershipPlan: 'team',
    personalMembershipPlan,
    autoBackup: personalIsPro && Boolean(settings.autoBackup),
    backupFrequency: normalizeBackupFrequency(settings.backupFrequency, DEFAULT_BACKUP_FREQUENCY),
    maxBackupsPerApp: normalizeBackupLimit(settings.maxBackupsPerApp, personalIsPro ? DEFAULT_PRO_MAX_BACKUPS_PER_APP : DEFAULT_MAX_BACKUPS_PER_APP),
    applicationQuota: personalIsPro ? DEFAULT_PRO_APPLICATION_QUOTA : DEFAULT_APPLICATION_QUOTA,
    applicationCreateQuota: personalIsPro ? MAX_APPLICATION_QUOTA : DEFAULT_APPLICATION_QUOTA,
    shareQuota: personalIsPro ? DEFAULT_PRO_SHARE_ACTIVE_QUOTA : DEFAULT_FREE_SHARE_ACTIVE_QUOTA,
    shareCreateQuota: personalIsPro ? DEFAULT_PRO_SHARE_CREATE_QUOTA : DEFAULT_FREE_SHARE_CREATE_QUOTA,
    storageQuotaMb: personalIsPro ? DEFAULT_PRO_STORAGE_QUOTA_MB : DEFAULT_FREE_STORAGE_QUOTA_MB,
  }
}

function demoMemberAccountSettings(settings = {}, teamRole = 'member') {
  const membershipPlan = teamRole === 'admin' ? 'pro' : 'free'
  const isPro = membershipPlan === 'pro'
  return {
    ...settings,
    planQuotaVersion: PLAN_QUOTA_VERSION,
    membershipPlan,
    personalMembershipPlan: membershipPlan,
    autoBackup: isPro && Boolean(settings.autoBackup),
    backupFrequency: normalizeBackupFrequency(settings.backupFrequency, DEFAULT_BACKUP_FREQUENCY),
    maxBackupsPerApp: normalizeBackupLimit(settings.maxBackupsPerApp, isPro ? DEFAULT_PRO_MAX_BACKUPS_PER_APP : DEFAULT_MAX_BACKUPS_PER_APP),
    applicationQuota: isPro ? DEFAULT_PRO_APPLICATION_QUOTA : DEFAULT_APPLICATION_QUOTA,
    applicationCreateQuota: isPro ? MAX_APPLICATION_QUOTA : DEFAULT_APPLICATION_QUOTA,
    shareQuota: isPro ? DEFAULT_PRO_SHARE_ACTIVE_QUOTA : DEFAULT_FREE_SHARE_ACTIVE_QUOTA,
    shareCreateQuota: isPro ? DEFAULT_PRO_SHARE_CREATE_QUOTA : DEFAULT_FREE_SHARE_CREATE_QUOTA,
    storageQuotaMb: isPro ? DEFAULT_PRO_STORAGE_QUOTA_MB : DEFAULT_FREE_STORAGE_QUOTA_MB,
  }
}

function demoUserSettings(email, language = 'zh', teamRole = 'member') {
  return demoMemberAccountSettings({
    language,
    highContrast: false,
    themeAccent: '#0071e3',
    sendFrom: email,
    receiveAt: email,
    receiveEmails: [{ address: email, isPrimary: true, notify: true, verified: true }],
    autoBackup: false,
    backupFrequency: DEFAULT_BACKUP_FREQUENCY,
    maxBackupsPerApp: DEFAULT_PRO_MAX_BACKUPS_PER_APP,
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpTls: true,
    // Incoming mail defaults to IMAP (sync/auto-fetch); POP3 remains available as an explicit choice.
    incomingProtocol: 'imap',
    incomingHost: '',
    incomingPort: 993,
    incomingUser: '',
    incomingPass: '',
    incomingTls: true,
    applicationCreatedCount: 0,
    shareCreatedCount: 0,
    trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
    sessionDurationMinutes: DEFAULT_USER_SESSION_MINUTES,
  }, teamRole)
}

/** Prefer IMAP when incoming mail has never been configured (legacy seed used pop3). */
function withDefaultIncomingMailProtocol(settings = {}) {
  const host = String(settings.incomingHost ?? '').trim()
  const rawPort = Number(settings.incomingPort)
  const explicitPop3 = settings.incomingProtocol === 'pop3' && (
    host.length > 0 || (Number.isFinite(rawPort) && rawPort > 0 && rawPort !== 995)
  )
  if (explicitPop3 || settings.incomingProtocol === 'imap') {
    return settings
  }
  return {
    ...settings,
    incomingProtocol: 'imap',
    incomingPort: Number.isFinite(rawPort) && rawPort > 0 && rawPort !== 995 ? rawPort : 993,
  }
}

function ensureDemoUser(database, account, passwordHash, now) {
  const existing = database.prepare('SELECT * FROM users WHERE email = ?').get(account.email)
  if (existing) {
    const settings = demoMemberAccountSettings(
      withDefaultIncomingMailProtocol(fromJson(existing.settings_json, {})),
      account.teamRole,
    )
    database
      .prepare('UPDATE users SET name = ?, role = ?, disabled_at = NULL, settings_json = ? WHERE id = ?')
      .run(account.name, existing.role === 'admin' ? 'admin' : 'user', toJson(settings), existing.id)
    return existing.id
  }

  const preferredIdTaken = database.prepare('SELECT id FROM users WHERE id = ?').get(account.id)
  const userId = preferredIdTaken ? createId('user') : account.id
  database
    .prepare(
      `INSERT INTO users (
        id,
        name,
        email,
        role,
        password_hash,
        created_at,
        last_login_at,
        disabled_at,
        settings_json
      )
      VALUES (?, ?, ?, 'user', ?, ?, NULL, NULL, ?)`,
    )
    .run(userId, account.name, account.email, passwordHash, now, toJson(demoUserSettings(account.email, 'zh', account.teamRole)))
  return userId
}

function ensureDemoTeamMember(database, { key, teamId, userId, email, role, invitedBy, now }) {
  const normalizedEmail = email.toLowerCase()
  let existing = database
    .prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId)
  if (!existing) {
    existing = database
      .prepare('SELECT * FROM team_members WHERE team_id = ? AND invited_email = ?')
      .get(teamId, normalizedEmail)
  }

  if (existing) {
    database
      .prepare(
        `UPDATE team_members
         SET user_id = ?, invited_email = ?, role = ?, status = 'active', invited_by = ?,
             invite_token_hash = NULL, invite_expires_at = NULL, removed_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(userId, normalizedEmail, role, invitedBy, now, existing.id)
    return existing.id
  }

  const preferredId = `tmem_demo_${key}`
  const preferredIdTaken = database.prepare('SELECT id FROM team_members WHERE id = ?').get(preferredId)
  const memberId = preferredIdTaken ? createId('tmem') : preferredId
  database
    .prepare(
      `INSERT INTO team_members (
        id,
        team_id,
        user_id,
        invited_email,
        role,
        status,
        invited_by,
        invite_token_hash,
        invite_expires_at,
        created_at,
        updated_at,
        removed_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, NULL)`,
    )
    .run(memberId, teamId, userId, normalizedEmail, role, invitedBy, now, now)
  return memberId
}

function demoTeamApplications(teamId, users, now) {
  const teacherId = users.teacher
  const secondTeacherId = users.teacherB
  return [
    {
      id: 'team-demo-lina-mit-robotics',
      ownerId: users.studentA,
      teamId,
      professor: {
        english: 'Prof. Daniel Kim',
        chinese: '',
        email: 'dkim@mit.edu',
        phone: '+1 617 555 0144',
        social: '@kim-robotics',
        homepage: 'https://robotics.mit.edu/kim',
        research: 'robot learning, embodied planning, and safe autonomy',
        lab: 'Robot Learning Group',
      },
      school: {
        name: 'MIT',
        country: 'United States',
        website: 'https://gradadmissions.mit.edu',
      },
      program: 'EECS PhD',
      deadline: '2026-11-15',
      status: 'Preparing',
      progress: 58,
      priority: 91,
      tags: ['robotics', 'teacher-review', 'funding'],
      nextReminder: '2026-07-12',
      result: 'Teacher review requested',
      materials: [
        { id: 'lina-mit-sop', name: 'Statement of Purpose', type: 'DOCX', status: 'Needs revision', version: 'v2', updatedAt: '2026-07-02', versions: [] },
        { id: 'lina-mit-cv', name: 'Academic CV', type: 'PDF', status: 'Submitted', version: 'v5', updatedAt: '2026-06-29', versions: [] },
        { id: 'lina-mit-letters', name: 'Recommendation Letters', type: 'Request', status: 'Missing', version: 'v0', updatedAt: '2026-07-01', versions: [] },
      ],
      communications: [
        {
          id: 'lina-mit-note',
          subject: 'Advisor feedback',
          channel: 'Note',
          date: '2026-07-02',
          summary: 'Teacher asked Lina to connect robot planning work to the target lab more directly.',
        },
      ],
      scholarships: [
        { id: 'lina-mit-ra', name: 'RA funding route', amount: 'TBD', startDate: '2027-09-01', endDate: '2031-08-31' },
      ],
      tasks: [
        { id: 'lina-mit-task-1', title: 'Rewrite research-fit paragraph', due: '2026-07-12', done: false },
        { id: 'lina-mit-task-2', title: 'Confirm recommender timeline', due: '2026-07-15', done: false },
      ],
      timeline: [
        { id: 'lina-mit-time-1', title: 'Shared with team', date: '2026-07-01', note: 'Student enabled team visibility for teacher review.' },
      ],
      versions: [],
      shares: [
        { id: 'share-lina-mit-demo', token: 'demo-lina-mit-review', createdAt: now, expiresAt: '2026-09-01T00:00:00.000Z', permission: 'view' },
      ],
      reviewComments: [
        {
          id: 'review-lina-mit-1',
          authorId: teacherId,
          authorName: 'Dr. Mei Chen',
          body: 'The research-fit paragraph is promising, but it needs one concrete example from the prior robot planning project.',
          createdAt: '2026-07-02T09:30:00.000Z',
          targetTab: 'dossier',
        },
        {
          id: 'review-lina-mit-2',
          authorId: secondTeacherId,
          authorName: 'Prof. Alex Rivera',
          body: 'Before submission, verify whether the proposal frames safety as an evaluation problem rather than only a deployment claim.',
          createdAt: '2026-07-03T14:15:00.000Z',
          targetTab: 'dossier',
        },
      ],
      createdAt: now,
      updatedAt: '2026-07-03T14:15:00.000Z',
    },
    {
      id: 'team-demo-lina-uw-hci',
      ownerId: users.studentA,
      teamId,
      professor: {
        english: 'Prof. Clara Nguyen',
        chinese: '',
        email: 'cnguyen@cs.washington.edu',
        phone: '+1 206 555 0181',
        social: '@nguyen-hci',
        homepage: 'https://homes.cs.washington.edu/~cnguyen',
        research: 'accessible learning interfaces and human-AI feedback',
        lab: 'Inclusive Interaction Lab',
      },
      school: {
        name: 'University of Washington',
        country: 'United States',
        website: 'https://grad.uw.edu/admissions',
      },
      program: 'Human Centered Design PhD',
      deadline: '2026-08-01',
      status: 'Draft',
      progress: 28,
      priority: 83,
      tags: ['HCI', 'urgent', 'materials'],
      nextReminder: '2026-07-09',
      result: 'Application shell created',
      materials: [
        { id: 'lina-uw-sop', name: 'Statement of Purpose', type: 'DOCX', status: 'Draft', version: 'v1', updatedAt: '2026-07-06', versions: [] },
        { id: 'lina-uw-portfolio', name: 'Portfolio', type: 'Link', status: 'Missing', version: 'v0', updatedAt: '2026-07-06', versions: [] },
      ],
      communications: [],
      scholarships: [],
      tasks: [
        { id: 'lina-uw-task-1', title: 'Add portfolio link', due: '2026-07-09', done: false },
        { id: 'lina-uw-task-2', title: 'Draft first email to professor', due: '2026-07-11', done: false },
      ],
      timeline: [
        { id: 'lina-uw-time-1', title: 'Program added', date: '2026-07-06', note: 'Needs teacher triage because deadline is close.' },
      ],
      versions: [],
      shares: [],
      reviewComments: [
        {
          id: 'review-lina-uw-1',
          authorId: teacherId,
          authorName: 'Dr. Mei Chen',
          body: 'This one is high risk: the portfolio and first email need to be finished before deeper essay work.',
          createdAt: '2026-07-06T16:20:00.000Z',
          targetTab: 'dossier',
        },
      ],
      createdAt: now,
      updatedAt: '2026-07-06T16:20:00.000Z',
    },
    {
      id: 'team-demo-omar-oxford-nlp',
      ownerId: users.studentB,
      teamId,
      professor: {
        english: 'Prof. Amelia Chen',
        chinese: '',
        email: 'amelia.chen@ox.ac.uk',
        phone: '+44 1865 555 013',
        social: '@amelia-nlp',
        homepage: 'https://www.cs.ox.ac.uk/people/amelia.chen',
        research: 'multilingual NLP, evaluation, and scientific discovery',
        lab: 'Language and Knowledge Lab',
      },
      school: {
        name: 'University of Oxford',
        country: 'United Kingdom',
        website: 'https://www.ox.ac.uk/admissions/graduate',
      },
      program: 'Computer Science DPhil',
      deadline: '2026-10-31',
      status: 'Submitted',
      progress: 76,
      priority: 87,
      tags: ['NLP', 'submitted', 'teacher-check'],
      nextReminder: '2026-07-20',
      result: 'Submitted for teacher check',
      materials: [
        { id: 'omar-oxford-sop', name: 'Statement of Purpose', type: 'PDF', status: 'Submitted', version: 'v4', updatedAt: '2026-07-01', versions: [] },
        { id: 'omar-oxford-proposal', name: 'Research Proposal', type: 'PDF', status: 'Submitted', version: 'v3', updatedAt: '2026-07-01', versions: [] },
      ],
      communications: [
        { id: 'omar-oxford-mail', subject: 'Portal confirmation', channel: 'Email', date: '2026-07-01', summary: 'Application received; department review starts later this month.' },
      ],
      scholarships: [
        { id: 'omar-oxford-clarendon', name: 'Clarendon Scholarship', amount: 'Full funding', startDate: '2027-10-01', endDate: '2031-09-30' },
      ],
      tasks: [
        { id: 'omar-oxford-task-1', title: 'Prepare teacher response note', due: '2026-07-20', done: false },
      ],
      timeline: [
        { id: 'omar-oxford-time-1', title: 'Internal check started', date: '2026-07-01', note: 'Teacher should check proposal clarity.' },
      ],
      versions: [],
      shares: [
        { id: 'share-omar-oxford-demo', token: 'demo-omar-oxford-review', createdAt: now, expiresAt: '2026-09-15T00:00:00.000Z', permission: 'view' },
      ],
      reviewComments: [
        {
          id: 'review-omar-oxford-1',
          authorId: secondTeacherId,
          authorName: 'Prof. Alex Rivera',
          body: 'The methods section is strong. Add a clearer failure-analysis paragraph before final institutional check.',
          createdAt: '2026-07-04T10:45:00.000Z',
          targetTab: 'dossier',
        },
      ],
      createdAt: now,
      updatedAt: '2026-07-04T10:45:00.000Z',
    },
    {
      id: 'team-demo-omar-toronto-vision',
      ownerId: users.studentB,
      teamId,
      professor: {
        english: 'Prof. Maya Patel',
        chinese: '',
        email: 'maya.patel@utoronto.ca',
        phone: '+1 416 555 0119',
        social: '@patel-vision',
        homepage: 'https://web.cs.toronto.edu/patel',
        research: '3D vision, semantic occupancy, and uncertainty estimation',
        lab: 'Visual Intelligence Lab',
      },
      school: {
        name: 'University of Toronto',
        country: 'Canada',
        website: 'https://www.sgs.utoronto.ca',
      },
      program: 'Computer Science PhD',
      deadline: '2026-07-28',
      status: 'Interview',
      progress: 82,
      priority: 94,
      tags: ['vision', 'interview', 'deadline'],
      nextReminder: '2026-07-14',
      result: 'Interview preparation',
      materials: [
        { id: 'omar-toronto-slides', name: 'Interview Slides', type: 'PDF', status: 'Draft', version: 'v2', updatedAt: '2026-07-05', versions: [] },
        { id: 'omar-toronto-cv', name: 'Academic CV', type: 'PDF', status: 'Submitted', version: 'v6', updatedAt: '2026-07-01', versions: [] },
      ],
      communications: [
        { id: 'omar-toronto-interview', subject: 'Interview invitation', channel: 'Email', date: '2026-07-03', summary: 'Panel interview scheduled for July 18.' },
      ],
      scholarships: [],
      tasks: [
        { id: 'omar-toronto-task-1', title: 'Run mock interview with teacher', due: '2026-07-14', done: false },
        { id: 'omar-toronto-task-2', title: 'Tighten uncertainty slide', due: '2026-07-16', done: false },
      ],
      timeline: [
        { id: 'omar-toronto-time-1', title: 'Interview invite received', date: '2026-07-03', note: 'Needs teacher pass on technical framing.' },
      ],
      versions: [],
      shares: [],
      reviewComments: [
        {
          id: 'review-omar-toronto-1',
          authorId: teacherId,
          authorName: 'Dr. Mei Chen',
          body: 'Mock interview should focus on how uncertainty estimates change downstream decisions.',
          createdAt: '2026-07-05T11:05:00.000Z',
          targetTab: 'dossier',
        },
      ],
      createdAt: now,
      updatedAt: '2026-07-05T11:05:00.000Z',
    },
  ]
}

function ensureDemoApplication(database, application) {
  const existing = database.prepare('SELECT id FROM applications WHERE id = ?').get(application.id)
  if (existing) {
    database
      .prepare('UPDATE applications SET team_id = ? WHERE id = ? AND (team_id IS NULL OR team_id = ?)')
      .run(application.teamId, application.id, application.teamId)
    return
  }
  database
    .prepare(
      `INSERT INTO applications (
        id,
        owner_id,
        school_name,
        professor_name,
        program,
        deadline,
        status,
        progress,
        priority,
        updated_at,
        payload_json,
        team_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      application.id,
      application.ownerId,
      application.school.name,
      application.professor.english,
      application.program,
      application.deadline,
      application.status,
      application.progress,
      application.priority,
      application.updatedAt,
      encodePayloadForStorage(application),
      application.teamId,
    )
}

async function ensureDemoTeamWorkspace(database) {
  const owner = database.prepare('SELECT * FROM users WHERE email = ?').get(DEFAULT_USER_EMAIL)
  if (!owner) return

  const missingDemoUser = DEMO_TEAM_MEMBER_ACCOUNTS.some((account) => (
    !database.prepare('SELECT id FROM users WHERE email = ?').get(account.email)
  ))
  const demoPasswordHash = missingDemoUser ? await bcrypt.hash(DEFAULT_USER_PASSWORD, 12) : null
  const now = nowStamp()

  const hydrateDemoTeam = database.transaction(() => {
    const ownerSettings = teamPlanSettings(fromJson(owner.settings_json, {}))
    database
      .prepare('UPDATE users SET settings_json = ? WHERE id = ?')
      .run(toJson(ownerSettings), owner.id)

    const users = { owner: owner.id }
    for (const account of DEMO_TEAM_MEMBER_ACCOUNTS) {
      users[account.key] = ensureDemoUser(database, account, demoPasswordHash, now)
    }

    let team = database.prepare('SELECT * FROM teams WHERE owner_id = ?').get(owner.id)
    if (!team) {
      const demoTeamIdTaken = database.prepare('SELECT id FROM teams WHERE id = ?').get(DEMO_TEAM_ID)
      const teamId = demoTeamIdTaken ? createId('team') : DEMO_TEAM_ID
      database
        .prepare(
          `INSERT INTO teams (id, name, owner_id, seat_limit, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(teamId, "Jasper's Team", owner.id, DEMO_TEAM_SEAT_LIMIT, now, now)
      team = database.prepare('SELECT * FROM teams WHERE id = ?').get(teamId)
    } else if (Number(team.seat_limit ?? 0) < DEMO_TEAM_SEAT_LIMIT) {
      database
        .prepare('UPDATE teams SET seat_limit = ?, updated_at = ? WHERE id = ?')
        .run(DEMO_TEAM_SEAT_LIMIT, now, team.id)
      team = { ...team, seat_limit: DEMO_TEAM_SEAT_LIMIT }
    }

    ensureDemoTeamMember(database, {
      key: 'owner',
      teamId: team.id,
      userId: owner.id,
      email: DEFAULT_USER_EMAIL,
      role: 'owner',
      invitedBy: owner.id,
      now,
    })
    for (const account of DEMO_TEAM_MEMBER_ACCOUNTS) {
      ensureDemoTeamMember(database, {
        key: account.key,
        teamId: team.id,
        userId: users[account.key],
        email: account.email,
        role: account.teamRole,
        invitedBy: account.teamRole === 'member' ? users.teacher : owner.id,
        now,
      })
    }

    const seedApplicationIds = seedApplications.map((application) => application.id)
    if (seedApplicationIds.length > 0) {
      const placeholders = seedApplicationIds.map(() => '?').join(', ')
      database
        .prepare(`UPDATE applications SET team_id = ? WHERE owner_id = ? AND team_id IS NULL AND id IN (${placeholders})`)
        .run(team.id, owner.id, ...seedApplicationIds)
    }

    for (const application of demoTeamApplications(team.id, users, now)) {
      ensureDemoApplication(database, application)
    }

    const eventExists = database
      .prepare("SELECT id FROM system_events WHERE message = 'Seeded demo team workspace' LIMIT 1")
      .get()
    if (!eventExists) {
      database
        .prepare(
          `INSERT INTO system_events (
            id,
            time,
            scope,
            actor_id,
            message,
            metadata_json
          )
          VALUES (?, ?, 'System bootstrap', ?, 'Seeded demo team workspace', ?)`,
        )
        .run(
          createId('event'),
          now,
          owner.id,
          toJson({
            adapter: 'sqlite',
            teamId: team.id,
            demoAccounts: [
              DEFAULT_USER_EMAIL,
              ...DEMO_TEAM_MEMBER_ACCOUNTS.map((account) => account.email),
            ],
          }),
        )
    }
  })

  hydrateDemoTeam()
  invalidateSharedStoreCache()
}

export function logEvent(store, event) {
  const context = auditContext.getStore()
  const rawActorId = event.actorId ?? null
  const shouldUseDelegatedActor = Boolean(
    context?.actorId &&
    context?.targetId &&
    rawActorId === context.targetId,
  )
  const actorId = shouldUseDelegatedActor ? context.actorId : rawActorId
  const metadata = event.metadata ?? {}
  const nextEvent = {
    id: createId('event'),
    time: nowStamp(),
    scope: event.scope,
    actorId,
    message: event.message,
    metadata: shouldUseDelegatedActor && context.impersonation
      ? { ...metadata, impersonation: context.impersonation }
      : metadata,
  }
  store.systemEvents.unshift(nextEvent)
  store.systemEvents = store.systemEvents.slice(0, 500)
  return nextEvent
}

async function initializeStorage() {
  storageInitialized = false
  await prepareConfiguredDatabaseSource()
  await fs.mkdir(uploadRoot, { recursive: true })
  await fs.mkdir(backupRoot, { recursive: true })
  const hadPlainDatabase = await plainSqliteExists(databasePath)
  const hadSealedDatabase = await sealedSqliteExists(sealedDatabasePath)
  const recoveryArtifactsPresent = await hasWorkspaceRecoveryArtifacts()
  // If a sealed DB exists (sqlite encryption previously enabled), restore it first.
  try {
    if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) await maybeUnsealDatabase()
  } catch (error) {
    console.error('[storage] Failed to unseal SQLite database:', error)
    throw error
  }
  let database = getDb()
  // Push tests are ephemeral transport checks. Older builds persisted them with
  // a random dedupe key, so every automated route-test run left another inbox
  // item behind for the default user. Remove that legacy-only notification type.
  database.prepare("DELETE FROM notifications WHERE type = 'push_test'").run()
  const count = database.prepare('SELECT COUNT(*) AS count FROM users').get().count
  const pendingMetaRow = count === 0
    ? database.prepare('SELECT value FROM app_meta WHERE key = ?').get('version')
    : null
  const validPublicSetupPending = count === 0 && isValidPublicSetupPendingWorkspace({
    meta: fromJson(pendingMetaRow?.value, null),
    userCount: count,
    applicationCount: database.prepare('SELECT COUNT(*) AS count FROM applications').get().count,
    profileAssetCount: database.prepare('SELECT COUNT(*) AS count FROM profile_assets').get().count,
    teamCount: database.prepare('SELECT COUNT(*) AS count FROM teams').get().count,
    hasSystemSettings: Boolean(database.prepare('SELECT 1 AS present FROM system_settings WHERE id = ?').get('global')),
    hadSealedDatabase,
    hasRecoveryArtifacts: recoveryArtifactsPresent,
  })

  if (count === 0) {
    if (shouldRefuseEmptyWorkspaceSeed({
      hadPlainDatabase,
      hadSealedDatabase,
      hasRecoveryArtifacts: recoveryArtifactsPresent,
      validPublicSetupPending,
    })) {
      closeOpenDatabase()
      if (!hadPlainDatabase && !hadSealedDatabase) {
        await Promise.all([
          fs.rm(databasePath, { force: true }).catch(() => undefined),
          fs.rm(`${databasePath}-wal`, { force: true }).catch(() => undefined),
          fs.rm(`${databasePath}-shm`, { force: true }).catch(() => undefined),
        ])
      }
      const error = new Error('Workspace database is empty while recovery artifacts exist. Automatic demo seeding was refused; restore a verified workspace backup instead.')
      error.code = 'DATABASE_STATE_MISSING'
      throw error
    }
    if (!validPublicSetupPending) {
      await writeStore(await createSeedStore())
      database = getDb()
    }
  } else if (!PUBLIC_EDITION) {
    await ensureDefaultAdminUser(database)
  }
  if (!PUBLIC_EDITION) {
    await ensureDemoTeamWorkspace(getDb())
  }

  // Load encryption policy so subsequent reads/writes use the configured cipher.
  database = getDb()
  const settingsRow = database.prepare('SELECT * FROM system_settings WHERE id = ?').get('global')
  if (settingsRow) {
    applyEncryptionPolicyFromSettings(settingsFromRow(settingsRow))
  } else {
    applyEncryptionPolicyFromSettings({ encryptionAtRest: true, encryptionAlgorithm: 'aes-256-gcm' })
  }
  await reconcileSqliteEncryptionMode()
  if (process.env.NODE_ENV !== 'test') await rewriteBackupEncryption(activeEncryptionPolicy)
  storageInitialized = true
}

export function ensureStorage() {
  if (!storageReadyPromise) {
    storageReadyPromise = initializeStorage().catch((error) => {
      storageReadyPromise = null
      storageInitialized = false
      throw error
    })
  }
  return storageReadyPromise
}

export async function shutdownStorage() {
  if (sealAfterWriteTimer) {
    clearTimeout(sealAfterWriteTimer)
    sealAfterWriteTimer = null
  }
  if (externalSyncTimer) {
    clearTimeout(externalSyncTimer)
    externalSyncTimer = null
  }
  if (activeEncryptionPolicy?.sqliteEncryption) await maybeSealDatabase()
  if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
    await synchronizeExternalDatabase({ force: true })
  }
  closeOpenDatabase()
}

function databaseDataVersion(database) {
  return Number(database.pragma('data_version', { simple: true }))
}

function teamsFromDatabase(database) {
  return database
    .prepare('SELECT * FROM teams ORDER BY created_at ASC')
    .all()
    .map(teamFromRow)
}

function readStoreFromDatabase(database) {
  const metaRows = database.prepare('SELECT key, value FROM app_meta').all()
  const meta = Object.fromEntries(metaRows.map((row) => [row.key, fromJson(row.value)]))
  const settingsRow = database
    .prepare('SELECT * FROM system_settings WHERE id = ?')
    .get('global')
  const users = database.prepare('SELECT * FROM users ORDER BY created_at ASC').all()
  const applications = database
    .prepare('SELECT * FROM applications ORDER BY deadline ASC')
    .all()
  const profileAssets = database
    .prepare('SELECT * FROM profile_assets ORDER BY updated_at DESC')
    .all()
  const systemEvents = database
    .prepare('SELECT * FROM system_events ORDER BY time DESC LIMIT 500')
    .all()

  return attachStoreBaseline({
    meta: {
      ...(meta.version ?? {}),
      adapter: currentDatabaseAdapter(),
      updatedAt: nowStamp(),
    },
    settings: settingsFromRow(settingsRow),
    users: users.map(userFromRow),
    teams: teamsFromDatabase(database),
    applications: applications.map(applicationFromRow),
    profileAssets: profileAssets.map(profileAssetFromRow),
    systemEvents: systemEvents.map(eventFromRow),
  })
}

export async function readStore(options = {}) {
  await ensureStorage()
  const database = getDb()
  if (!options.cache) {
    return readStoreFromDatabase(database)
  }

  const dataVersion = databaseDataVersion(database)
  if (sharedStoreCache && sharedStoreDataVersion === dataVersion) {
    return sharedStoreCache
  }

  const store = readStoreFromDatabase(database)
  sharedStoreCache = store
  sharedStoreDataVersion = dataVersion
  return store
}

export async function writeStore(store) {
  await fs.mkdir(storageRoot, { recursive: true })
  const database = getDb()
  const now = nowStamp()
  const nextMeta = {
    ...(store.meta ?? {}),
    adapter: currentDatabaseAdapter(),
    updatedAt: now,
    revision: Number(store.meta?.revision ?? 0) + 1,
  }
  const currentSystemSettings = database
    .prepare('SELECT smtp_pass FROM system_settings WHERE id = ?')
    .get('global')
  const currentUserSettings = new Map(
    database
      .prepare('SELECT id, settings_json FROM users')
      .all()
      .map((row) => [row.id, fromJson(row.settings_json)]),
  )

  const transaction = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO app_meta (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run('version', toJson(nextMeta))

    database
      .prepare(
        `INSERT INTO system_settings (
          id,
          allow_registration,
          notification_mailbox,
          backup_frequency,
          max_backups_per_app_limit,
          encryption_at_rest,
          encryption_algorithm,
          encryption_password_enabled,
          encryption_password_hash,
          encryption_password_salt,
          sqlite_encryption,
          smtp_host,
          smtp_port,
          smtp_user,
          smtp_pass,
          smtp_tls,
          admin_session_duration_minutes,
          updated_at
        )
        VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          allow_registration = excluded.allow_registration,
          notification_mailbox = excluded.notification_mailbox,
          backup_frequency = excluded.backup_frequency,
          max_backups_per_app_limit = excluded.max_backups_per_app_limit,
          encryption_at_rest = excluded.encryption_at_rest,
          encryption_algorithm = excluded.encryption_algorithm,
          encryption_password_enabled = excluded.encryption_password_enabled,
          encryption_password_hash = excluded.encryption_password_hash,
          encryption_password_salt = excluded.encryption_password_salt,
          sqlite_encryption = excluded.sqlite_encryption,
          smtp_host = excluded.smtp_host,
          smtp_port = excluded.smtp_port,
          smtp_user = excluded.smtp_user,
          smtp_pass = excluded.smtp_pass,
           smtp_tls = excluded.smtp_tls,
           admin_session_duration_minutes = excluded.admin_session_duration_minutes,
           updated_at = excluded.updated_at
         WHERE system_settings.allow_registration <> excluded.allow_registration
            OR system_settings.notification_mailbox <> excluded.notification_mailbox
            OR system_settings.backup_frequency <> excluded.backup_frequency
            OR system_settings.max_backups_per_app_limit <> excluded.max_backups_per_app_limit
            OR system_settings.encryption_at_rest <> excluded.encryption_at_rest
            OR system_settings.encryption_algorithm <> excluded.encryption_algorithm
            OR system_settings.encryption_password_enabled <> excluded.encryption_password_enabled
            OR system_settings.encryption_password_hash <> excluded.encryption_password_hash
            OR system_settings.encryption_password_salt <> excluded.encryption_password_salt
            OR system_settings.sqlite_encryption <> excluded.sqlite_encryption
            OR system_settings.smtp_host <> excluded.smtp_host
            OR system_settings.smtp_port <> excluded.smtp_port
            OR system_settings.smtp_user <> excluded.smtp_user
            OR system_settings.smtp_pass <> excluded.smtp_pass
            OR system_settings.smtp_tls <> excluded.smtp_tls
            OR system_settings.admin_session_duration_minutes <> excluded.admin_session_duration_minutes`,
      )
      .run(
        boolInt(store.settings.allowRegistration),
        store.settings.notificationMailbox,
        normalizeBackupFrequency(store.settings.backupFrequency),
        Math.min(
          MAX_SYSTEM_BACKUP_LIMIT,
          Math.max(MIN_SYSTEM_BACKUP_LIMIT, normalizeBackupLimit(store.settings.maxBackupsPerAppLimit, DEFAULT_PRO_MAX_BACKUPS_PER_APP)),
        ),
        boolInt(store.settings.encryptionAtRest),
        normalizeAlgorithm(store.settings.encryptionAlgorithm),
        boolInt(store.settings.encryptionPasswordEnabled),
        store.settings.encryptionPasswordHash ?? '',
        store.settings.encryptionPasswordSalt ?? '',
        boolInt(store.settings.sqliteEncryption && store.settings.encryptionAtRest),
        store.settings.smtpHost ?? '',
        Number(store.settings.smtpPort ?? 587),
        store.settings.smtpUser ?? '',
        encryptedSecretForWrite(currentSystemSettings?.smtp_pass, store.settings.smtpPass ?? ''),
        boolInt(store.settings.smtpTls ?? true),
        normalizeSessionMinutes(store.settings.adminSessionDurationMinutes, DEFAULT_ADMIN_SESSION_MINUTES),
        now,
      )

    const insertUser = database.prepare(
      `INSERT INTO users (
        id,
        name,
        email,
        role,
        password_hash,
        created_at,
        last_login_at,
        disabled_at,
        settings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        role = excluded.role,
        password_hash = excluded.password_hash,
        created_at = excluded.created_at,
         last_login_at = excluded.last_login_at,
         disabled_at = excluded.disabled_at,
         settings_json = excluded.settings_json
       WHERE users.name <> excluded.name
          OR users.email <> excluded.email
          OR users.role <> excluded.role
          OR users.password_hash <> excluded.password_hash
          OR users.created_at <> excluded.created_at
          OR users.last_login_at IS NOT excluded.last_login_at
          OR users.disabled_at IS NOT excluded.disabled_at
          OR users.settings_json <> excluded.settings_json`,
    )
    const storeUserIds = store.users.map((user) => user.id)
    for (const user of store.users) {
      // In-memory settings always hold plaintext secrets (decrypted on load in userFromRow);
      // encrypt only in the object we serialize, never mutate the in-memory copy other code still uses.
      const storedSettings = currentUserSettings.get(user.id) ?? {}
      const settingsForStorage = {
        ...user.settings,
        smtpPass: encryptedSecretForWrite(storedSettings.smtpPass, user.settings?.smtpPass ?? ''),
        incomingPass: encryptedSecretForWrite(storedSettings.incomingPass, user.settings?.incomingPass ?? ''),
      }
      insertUser.run(
        user.id,
        user.name,
        user.email,
        normalizeUserRole(user.role),
        user.passwordHash,
        user.createdAt,
        user.lastLoginAt,
        user.disabledAt ?? null,
        toJson(settingsForStorage),
      )
    }
    if (storeUserIds.length > 0) {
      const placeholders = storeUserIds.map(() => '?').join(', ')
      database.prepare(`DELETE FROM teams WHERE owner_id NOT IN (${placeholders})`).run(...storeUserIds)
      database.prepare(`UPDATE team_members SET user_id = NULL WHERE user_id IS NOT NULL AND user_id NOT IN (${placeholders})`).run(...storeUserIds)
      database.prepare(`DELETE FROM team_members WHERE invited_by NOT IN (${placeholders})`).run(...storeUserIds)
      database.prepare(`DELETE FROM users WHERE id NOT IN (${placeholders})`).run(...storeUserIds)
    } else {
      database.prepare('DELETE FROM team_members').run()
      database.prepare('DELETE FROM teams').run()
      database.prepare('DELETE FROM users').run()
    }

    const existingApplicationIds = new Set(
      database.prepare('SELECT id FROM applications').all().map((row) => row.id),
    )
    const upsertApplication = database.prepare(
      `INSERT INTO applications (
        id,
        owner_id,
        school_name,
        professor_name,
        program,
        deadline,
        status,
        progress,
        priority,
        updated_at,
        payload_json,
        team_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        school_name = excluded.school_name,
        professor_name = excluded.professor_name,
        program = excluded.program,
        deadline = excluded.deadline,
        status = excluded.status,
        progress = excluded.progress,
        priority = excluded.priority,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json,
        team_id = excluded.team_id
      WHERE applications.payload_json <> excluded.payload_json
         OR applications.owner_id <> excluded.owner_id
         OR applications.team_id IS NOT excluded.team_id`,
    )
    const nextApplicationIds = new Set()
    for (const application of store.applications) {
      const normalized = {
        ...application,
        updatedAt: application.updatedAt ?? now,
      }
      nextApplicationIds.add(normalized.id)
      upsertApplication.run(
        normalized.id,
        normalized.ownerId,
        normalized.school.name,
        normalized.professor.english,
        normalized.program,
        normalized.deadline,
        normalized.status,
        normalized.progress,
        normalized.priority,
        normalized.updatedAt,
        encodePayloadForStorage(normalized),
        normalized.teamId ?? null,
      )
    }
    const deleteApplication = database.prepare('DELETE FROM applications WHERE id = ?')
    for (const id of existingApplicationIds) {
      if (!nextApplicationIds.has(id)) deleteApplication.run(id)
    }

    const existingAssetIds = new Set(
      database.prepare('SELECT id FROM profile_assets').all().map((row) => row.id),
    )
    const upsertAsset = database.prepare(
      `INSERT INTO profile_assets (
        id,
        owner_id,
        name,
        kind,
        updated_at,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        name = excluded.name,
        kind = excluded.kind,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
      WHERE profile_assets.payload_json <> excluded.payload_json
         OR profile_assets.owner_id <> excluded.owner_id`,
    )
    const nextAssetIds = new Set()
    for (const asset of store.profileAssets) {
      nextAssetIds.add(asset.id)
      upsertAsset.run(
        asset.id,
        asset.ownerId,
        asset.name,
        asset.kind,
        asset.updatedAt ?? now,
        encodePayloadForStorage(asset),
      )
    }
    const deleteAsset = database.prepare('DELETE FROM profile_assets WHERE id = ?')
    for (const id of existingAssetIds) {
      if (!nextAssetIds.has(id)) deleteAsset.run(id)
    }

    const existingEventIds = new Set(
      database.prepare('SELECT id FROM system_events').all().map((row) => row.id),
    )
    const upsertEvent = database.prepare(
      `INSERT INTO system_events (
        id,
        time,
        scope,
        actor_id,
        message,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        time = excluded.time,
        scope = excluded.scope,
        actor_id = excluded.actor_id,
        message = excluded.message,
        metadata_json = excluded.metadata_json
      WHERE system_events.time <> excluded.time
         OR system_events.scope <> excluded.scope
         OR system_events.actor_id IS NOT excluded.actor_id
         OR system_events.message <> excluded.message
         OR system_events.metadata_json <> excluded.metadata_json`,
    )
    const nextEventIds = new Set()
    for (const event of store.systemEvents.slice(0, 500)) {
      nextEventIds.add(event.id)
      upsertEvent.run(
        event.id,
        event.time,
        event.scope,
        event.actorId ?? null,
        event.message,
        toJson(event.metadata ?? {}),
      )
    }
    const deleteEvent = database.prepare('DELETE FROM system_events WHERE id = ?')
    for (const id of existingEventIds) {
      if (!nextEventIds.has(id)) deleteEvent.run(id)
    }
  })

  transaction()
  // Authenticated GET requests share this immutable-by-convention snapshot. Every
  // full-store write replaces it, while SQLite data_version invalidates it when a
  // second process changes the database. This prevents parallel bootstrap requests
  // from reparsing every application payload on the Node.js main thread.
  store.meta = nextMeta
  store.teams = teamsFromDatabase(database)
  attachStoreBaseline(store)
  sharedStoreCache = store
  sharedStoreDataVersion = databaseDataVersion(database)
  applyEncryptionPolicyFromSettings(store.settings)
  await reconcileSqliteEncryptionMode()
  // Full-store writes are the primary synchronization boundary: wait for the
  // remote commit so successful API mutations are durable in the selected engine.
  await synchronizeExternalDatabase({ force: true })
}

/**
 * Re-encrypt every sealed secret and application/profile payloads with the
 * current runtime cipher profile. Call after the admin changes algorithm or
 * password so on-disk ciphertext stays consistent with the active key.
 *
 * @param {{ fromAlgorithm?: string, fromPasswordBinding?: string }} [fromProfile]
 * @param {object | null} [nextSettings]
 */
export async function reencryptAllEncryptionMaterial(fromProfile = {}, nextSettings = null) {
  await ensureStorage()
  const from = {
    algorithm: normalizeAlgorithm(fromProfile.fromAlgorithm),
    passwordBinding: fromProfile.fromPasswordBinding ?? '',
  }

  const recoverPlain = (ciphertext) => {
    if (!ciphertext) return ''
    const withFrom = decryptSecretWithProfile(ciphertext, from)
    if (withFrom) return withFrom
    return decryptSecret(ciphertext)
  }

  const rewrapSecret = (ciphertext) => {
    if (!ciphertext) return ''
    const plain = recoverPlain(ciphertext)
    if (!plain) return ciphertext
    return encryptSecret(plain)
  }

  const rewrapPayload = (payloadJson) => {
    if (!payloadJson) return payloadJson
    let plainText = payloadJson
    if (isEncryptedPayload(payloadJson)) {
      const body = payloadJson.slice('payload:'.length)
      plainText = recoverPlain(body) || decryptPayload(payloadJson)
      if (!plainText) return payloadJson
    }
    // encodePayloadForStorage encrypts when at-rest is on, otherwise stores plain JSON.
    try {
      const obj = typeof plainText === 'string' ? fromJson(plainText, null) : plainText
      if (obj && typeof obj === 'object') return encodePayloadForStorage(obj)
      return encodePayloadForStorage(plainText)
    } catch {
      return encodePayloadForStorage(plainText)
    }
  }

  return withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const system = database.prepare('SELECT smtp_pass FROM system_settings WHERE id = ?').get('global')
      if (system?.smtp_pass) {
        database.prepare('UPDATE system_settings SET smtp_pass = ? WHERE id = ?')
          .run(rewrapSecret(system.smtp_pass), 'global')
      }

      for (const row of database.prepare('SELECT id, settings_json FROM users').all()) {
        const settings = fromJson(row.settings_json, {})
        let changed = false
        if (settings.smtpPass) {
          settings.smtpPass = rewrapSecret(settings.smtpPass)
          changed = true
        }
        if (settings.incomingPass) {
          settings.incomingPass = rewrapSecret(settings.incomingPass)
          changed = true
        }
        if (changed) {
          database.prepare('UPDATE users SET settings_json = ? WHERE id = ?')
            .run(toJson(settings), row.id)
        }
      }

      for (const row of database.prepare('SELECT id, api_key_encrypted FROM ai_api_keys').all()) {
        if (!row.api_key_encrypted) continue
        database.prepare('UPDATE ai_api_keys SET api_key_encrypted = ? WHERE id = ?')
          .run(rewrapSecret(row.api_key_encrypted), row.id)
      }

      const pushRow = database.prepare('SELECT value FROM app_meta WHERE key = ?').get('webPushVapid')
      if (pushRow?.value) {
        try {
          const parsed = fromJson(pushRow.value, {})
          if (parsed.privateKey) {
            parsed.privateKey = rewrapSecret(parsed.privateKey)
            database.prepare('UPDATE app_meta SET value = ? WHERE key = ?')
              .run(toJson(parsed), 'webPushVapid')
          }
        } catch { /* ignore */ }
      }

      for (const row of database.prepare('SELECT id, payload_json FROM applications').all()) {
        database.prepare('UPDATE applications SET payload_json = ? WHERE id = ?')
          .run(rewrapPayload(row.payload_json), row.id)
      }
      for (const row of database.prepare('SELECT id, payload_json FROM profile_assets').all()) {
        database.prepare('UPDATE profile_assets SET payload_json = ? WHERE id = ?')
          .run(rewrapPayload(row.payload_json), row.id)
      }

      if (nextSettings) {
        database.prepare(
          `UPDATE system_settings SET
             encryption_at_rest = ?, encryption_algorithm = ?,
             encryption_password_enabled = ?, encryption_password_hash = ?,
             encryption_password_salt = ?, sqlite_encryption = ?, updated_at = ?
           WHERE id = 'global'`,
        ).run(
          boolInt(nextSettings.encryptionAtRest),
          normalizeAlgorithm(nextSettings.encryptionAlgorithm),
          boolInt(nextSettings.encryptionPasswordEnabled),
          nextSettings.encryptionPasswordHash || '',
          nextSettings.encryptionPasswordSalt || '',
          boolInt(nextSettings.sqliteEncryption && nextSettings.encryptionAtRest),
          nowStamp(),
        )
      }
    })

    transaction()
    if (nextSettings) applyEncryptionPolicyFromSettings(nextSettings)
    invalidateSharedStoreCache()
    await rewriteBackupEncryption(activeEncryptionPolicy)
    await reconcileSqliteEncryptionMode()
    return { ok: true, reencryptedAt: nowStamp() }
  })
}

function safeFileSegment(value) {
  return String(value ?? 'application')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'application'
}

function backupCreatedAt(metadata, stat) {
  return metadata?.createdAt ?? stat.birthtime.toISOString()
}

function backupMetadataPath(fileName) {
  return path.join(backupRoot, `${fileName}${BACKUP_METADATA_SUFFIX}`)
}

function invalidateBackupListCache(fileName) {
  backupListCacheGeneration += 1
  backupListCache = null
  backupListCacheDirectoryStamp = null
  if (fileName) backupInfoCache.delete(fileName)
}

function backupInfoFromMetadata(fileName, stat, metadata, applicationName) {
  return {
    fileName,
    size: stat.size,
    createdAt: backupCreatedAt(metadata, stat),
    actorId: metadata?.actorId ?? null,
    applicationId: metadata?.applicationId ?? null,
    applicationName,
    kind: metadata?.kind ?? (metadata?.applicationId ? 'application' : 'workspace'),
  }
}

async function writeBackupMetadata(fileName, stat, metadata, applicationName) {
  const payload = {
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    metadata,
    applicationName: applicationName ?? null,
  }
  await fs.writeFile(backupMetadataPath(fileName), JSON.stringify(payload), 'utf8')
}

async function readBackupInfo(entry) {
  const filePath = path.join(backupRoot, entry.name)
  const stat = await fs.stat(filePath)
  const cached = backupInfoCache.get(entry.name)
  if (cached?.sourceSize === stat.size && cached?.sourceMtimeMs === stat.mtimeMs) {
    return cached.info
  }

  let metadata = null
  let applicationName
  try {
    const sidecar = JSON.parse(await fs.readFile(backupMetadataPath(entry.name), 'utf8'))
    if (sidecar.sourceSize === stat.size && sidecar.sourceMtimeMs === stat.mtimeMs) {
      metadata = sidecar.metadata ?? null
      applicationName = sidecar.applicationName ?? undefined
    }
  } catch {
    // Legacy backups gain a compact sidecar after their first metadata read.
  }

  if (!metadata && entry.name.endsWith('.json')) {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      metadata = parsed?.backup ?? null
      applicationName = metadata?.applicationName ?? parsed?.application?.school?.name
      if (stat.size >= BACKUP_SIDECAR_MIN_BYTES) {
        await writeBackupMetadata(entry.name, stat, metadata, applicationName).catch(() => undefined)
      }
    } catch {
      metadata = null
    }
  }

  // .tar.gz workspace archives rely on the sidecar; without it treat as workspace.
  if (!metadata && entry.name.endsWith('.tar.gz')) {
    metadata = {
      kind: 'workspace',
      format: 'sqlite-uploads-v1',
      createdAt: backupCreatedAt(null, stat),
      actorId: 'system',
    }
  }

  const info = backupInfoFromMetadata(entry.name, stat, metadata, applicationName)
  backupInfoCache.set(entry.name, {
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    info,
  })
  return info
}

async function readBackupInfoIfPresent(entry) {
  try {
    return await readBackupInfo(entry)
  } catch (error) {
    // A cleanup/prune job (or another server process) can remove an archive
    // after readdir() has captured its name. Listing backups must remain a
    // best-effort read and never turn an otherwise valid login into a 500.
    if (error?.code === 'ENOENT') {
      backupInfoCache.delete(entry.name)
      return null
    }
    throw error
  }
}

export async function pruneApplicationBackups(actorId, applicationId, maxBackupsPerApp) {
  const [result] = await pruneApplicationBackupsBatch([{ actorId, applicationId, maxBackupsPerApp }])
  return result ?? { limit: normalizeBackupLimit(maxBackupsPerApp), deleted: 0, deletedFileNames: [] }
}

export async function pruneApplicationBackupsBatch(rules = []) {
  if (!Array.isArray(rules) || rules.length === 0) return []
  const normalizedRules = new Map()
  for (const rule of rules) {
    if (!rule?.actorId || !rule?.applicationId) continue
    normalizedRules.set(`${rule.actorId}\u0000${rule.applicationId}`, {
      actorId: rule.actorId,
      applicationId: rule.applicationId,
      limit: normalizeBackupLimit(rule.maxBackupsPerApp),
    })
  }
  if (normalizedRules.size === 0) return []

  const grouped = new Map(Array.from(normalizedRules.keys(), (key) => [key, []]))
  const backups = await listBackups()
  for (const backup of backups) {
    const key = `${backup.actorId}\u0000${backup.applicationId}`
    grouped.get(key)?.push(backup)
  }

  const results = []
  const staleBackups = []
  for (const [key, rule] of normalizedRules) {
    const stale = (grouped.get(key) ?? []).slice(rule.limit)
    staleBackups.push(...stale)
    results.push({
      actorId: rule.actorId,
      applicationId: rule.applicationId,
      limit: rule.limit,
      deleted: stale.length,
      deletedFileNames: stale.map((backup) => backup.fileName),
    })
  }
  await Promise.all(staleBackups.map((backup) => deleteBackup(backup.fileName).catch(() => null)))
  return results
}

export async function createBackup(store, actorId, application, maxBackupsPerApp = 10, options = {}) {
  const applicationId = application?.id
  // System / workspace backups package the live SQLite database + uploads directory.
  if (!applicationId) {
    return createWorkspaceArchiveBackup(actorId, {
      ...options,
      encryptionPolicy: backupEncryptionPolicyForSettings(store?.settings),
    })
  }

  const shouldPrune = options.prune !== false
  await fs.mkdir(backupRoot, { recursive: true })
  const stamp = nowStamp().replaceAll(':', '-').replaceAll('.', '-')
  const fileName = `phd-atlas-app-${safeFileSegment(applicationId)}-${stamp}.json`
  const target = path.join(backupRoot, fileName)
  const createdAt = nowStamp()
  const snapshot = {
    backup: {
      kind: 'application',
      createdAt,
      actorId,
      applicationId,
      applicationName: application.school?.name ?? application.program ?? applicationId,
      databaseAdapter: 'sqlite',
      databasePath,
    },
    application,
  }
  const snapshotPayload = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8')
  const backupPolicy = backupEncryptionPolicyForSettings(store?.settings)
  await writeSnapshotFile(target, encodeBackupPayload(snapshotPayload, backupPolicy))
  const stat = await fs.stat(target)
  if (backupPolicy.encryptionAtRest || stat.size >= BACKUP_SIDECAR_MIN_BYTES) {
    await writeBackupMetadata(
      fileName,
      stat,
      snapshot.backup,
      application?.school?.name ?? snapshot.backup?.applicationName,
    ).catch(() => undefined)
  }
  invalidateBackupListCache(fileName)
  if (shouldPrune) {
    await pruneApplicationBackups(actorId, applicationId, maxBackupsPerApp)
  }
  return {
    fileName,
    path: target,
    size: stat.size,
    createdAt,
    actorId,
    applicationId,
    applicationName: application?.school?.name,
    kind: 'application',
  }
}

export async function listBackups(filters = {}) {
  await fs.mkdir(backupRoot, { recursive: true })
  let backups
  while (!backups) {
    const directoryStat = await fs.stat(backupRoot)
    const directoryStamp = `${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`
    if (backupListCache && backupListCacheDirectoryStamp === directoryStamp) {
      backups = backupListCache
      break
    }

    const generation = backupListCacheGeneration
    let scan = backupListScan
    if (!scan || scan.generation !== generation) {
      const promise = (async () => {
        const entries = await fs.readdir(backupRoot, { withFileTypes: true })
        const nextBackups = (await Promise.all(
          entries
            .filter((entry) => entry.isFile() && isBackupArchiveName(entry.name) && !entry.name.endsWith('.meta'))
            .map(readBackupInfoIfPresent),
        ))
          .filter(Boolean)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        // Legacy large backups may gain sidecars during this scan, which changes
        // the directory timestamp. Cache the settled timestamp after all writes.
        const settledStat = await fs.stat(backupRoot)
        const settledDirectoryStamp = `${settledStat.mtimeMs}:${settledStat.ctimeMs}`
        return { backups: nextBackups, settledDirectoryStamp, generation }
      })()
      scan = { generation, promise }
      backupListScan = scan
    }

    let result
    try {
      result = await scan.promise
    } finally {
      if (backupListScan === scan) backupListScan = null
    }
    // A backup was created/deleted while the scan was in flight. Retry instead
    // of publishing a stale directory snapshot.
    if (result.generation !== backupListCacheGeneration) continue
    backupListCache = result.backups
    backupListCacheDirectoryStamp = result.settledDirectoryStamp
    backups = result.backups
  }

  return backups
    .filter((backup) => !filters.actorId || backup.actorId === filters.actorId)
    .filter((backup) => !filters.applicationId || backup.applicationId === filters.applicationId)
    .filter((backup) => !filters.kind || backup.kind === filters.kind)
}

export async function restoreBackup(fileName, options = {}) {
  const backup = resolveBackupFile(fileName)

  // Full workspace archives restore SQLite + uploads onto disk.
  if (backup.fileName.endsWith('.tar.gz')) {
    return restoreWorkspaceArchive(backup.fileName, options)
  }

  const raw = decodeBackupPayload(await fs.readFile(backup.path)).plain.toString('utf8')
  const restored = JSON.parse(raw)
  if (restored?.backup?.kind === 'application' || restored?.application) {
    const application = restored.application
    if (!options.store || !options.user || !application?.id) {
      throw backupFileError(400, 'APPLICATION_BACKUP_REQUIRES_CONTEXT', 'Application backup restore requires an active user context.')
    }
    if (restored.backup?.actorId && restored.backup.actorId !== options.user.id) {
      throw backupFileError(403, 'FORBIDDEN', 'You cannot restore another user backup.')
    }
    const index = options.store.applications.findIndex(
      (candidate) => candidate.id === application.id && candidate.ownerId === options.user.id,
    )
    if (index < 0) {
      throw backupFileError(404, 'NOT_FOUND', 'Application for this backup was not found.')
    }
    const restoredApplication = {
      ...application,
      ownerId: options.user.id,
      updatedAt: nowStamp(),
    }
    options.store.applications[index] = restoredApplication
    return {
      application: restoredApplication,
      backup: restored.backup,
    }
  }
  // Legacy JSON workspace snapshot (pre sqlite+uploads archive format).
  delete restored.backup
  return restored
}

export async function deleteBackup(fileName) {
  await fs.mkdir(backupRoot, { recursive: true })
  const backup = resolveBackupFile(fileName)
  try {
    await fs.unlink(backup.path)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw backupFileError(404, 'NOT_FOUND', 'Backup file not found.')
    }
    throw error
  }
  await fs.rm(backupMetadataPath(backup.fileName), { force: true }).catch(() => undefined)
  invalidateBackupListCache(backup.fileName)
  return { deleted: true, fileName: backup.fileName }
}

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createPasswordResetToken(userId, token, expiresAt) {
  await ensureStorage()
  getDb()
    .prepare(
      `INSERT INTO password_reset_tokens (
        id,
        user_id,
        token_hash,
        created_at,
        expires_at,
        used_at
      )
      VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(createId('reset'), userId, hashResetToken(token), nowStamp(), expiresAt)
}

export async function findPasswordResetToken(token) {
  await ensureStorage()
  const row = getDb()
    .prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?`,
    )
    .get(hashResetToken(token))

  if (!row) {
    return null
  }
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  }
}

export async function claimPasswordResetToken(token) {
  await ensureStorage()
  var hash = createHash('sha256').update(token).digest('hex')
  var row = getDb()
    .prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING id, user_id'
    )
    .get(nowStamp(), hash, nowStamp())
  return row ? { id: row.id, userId: row.user_id } : null
}

export async function markPasswordResetTokenUsed(token) {
  await ensureStorage()
  getDb()
    .prepare(
      `UPDATE password_reset_tokens
       SET used_at = ?
       WHERE token_hash = ?`,
    )
    .run(nowStamp(), hashResetToken(token))
}

function hashWebAuthnChallenge(challenge) {
  return createHash('sha256').update(String(challenge ?? '')).digest('hex')
}

function normalizePasskeyTransports(transports) {
  return Array.isArray(transports)
    ? transports
        .map((transport) => String(transport ?? '').trim())
        .filter(Boolean)
    : []
}

function passkeyFromRow(row, includeCredential = false) {
  if (!row) return null
  const transports = normalizePasskeyTransports(fromJson(row.transports_json, []))
  const passkey = {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    transports,
    deviceType: row.device_type || '',
    backedUp: intBool(row.backed_up),
    label: row.label || '',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
  if (!includeCredential) return passkey
  return {
    ...passkey,
    credential: {
      id: row.credential_id,
      publicKey: Buffer.from(row.public_key, 'base64url'),
      counter: Number(row.counter ?? 0),
      transports,
    },
  }
}

export async function listWebAuthnPasskeys(userId) {
  await ensureStorage()
  return getDb()
    .prepare(
      `SELECT *
       FROM webauthn_passkeys
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .all(userId)
    .map((row) => passkeyFromRow(row))
}

export async function findWebAuthnPasskeyByCredentialId(credentialId) {
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT * FROM webauthn_passkeys WHERE credential_id = ?')
    .get(String(credentialId ?? ''))
  return passkeyFromRow(row, true)
}

export async function createWebAuthnPasskey(input) {
  await ensureStorage()
  const now = nowStamp()
  const id = createId('passkey')
  const transports = normalizePasskeyTransports(input.transports)
  getDb()
    .prepare(
      `INSERT INTO webauthn_passkeys (
        id,
        user_id,
        credential_id,
        public_key,
        counter,
        transports_json,
        device_type,
        backed_up,
        label,
        created_at,
        last_used_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.userId,
      input.credentialId,
      Buffer.from(input.publicKey).toString('base64url'),
      Number(input.counter ?? 0),
      toJson(transports),
      input.deviceType ?? '',
      boolInt(input.backedUp),
      String(input.label ?? '').trim().slice(0, 80),
      now,
    )
  return passkeyFromRow(getDb().prepare('SELECT * FROM webauthn_passkeys WHERE id = ?').get(id))
}

export async function updateWebAuthnPasskeyAfterUse(credentialId, input = {}) {
  await ensureStorage()
  const now = nowStamp()
  const row = getDb()
    .prepare(
      `UPDATE webauthn_passkeys
       SET counter = ?,
           device_type = COALESCE(NULLIF(?, ''), device_type),
           backed_up = ?,
           last_used_at = ?
       WHERE credential_id = ?
       RETURNING *`,
    )
    .get(
      Number(input.counter ?? 0),
      input.deviceType ?? '',
      boolInt(input.backedUp),
      now,
      String(credentialId ?? ''),
    )
  return passkeyFromRow(row)
}

export async function updateWebAuthnPasskeyLabel(userId, passkeyId, label) {
  await ensureStorage()
  const nextLabel = String(label ?? '').trim().slice(0, 80)
  const row = getDb()
    .prepare(
      `UPDATE webauthn_passkeys
       SET label = ?
       WHERE user_id = ? AND id = ?
       RETURNING *`,
    )
    .get(nextLabel, userId, passkeyId)
  return passkeyFromRow(row)
}

export async function deleteWebAuthnPasskey(userId, passkeyId) {
  await ensureStorage()
  const row = getDb()
    .prepare('DELETE FROM webauthn_passkeys WHERE user_id = ? AND id = ? RETURNING id')
    .get(userId, passkeyId)
  return row ? { id: row.id } : null
}

export async function createWebAuthnChallenge(input) {
  await ensureStorage()
  const database = getDb()
  const now = nowStamp()
  database
    .prepare('DELETE FROM webauthn_challenges WHERE used_at IS NOT NULL OR expires_at <= ?')
    .run(now)
  database
    .prepare(
      `INSERT INTO webauthn_challenges (
        id,
        purpose,
        user_id,
        challenge_hash,
        created_at,
        expires_at,
        used_at,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      createId('challenge'),
      input.purpose,
      input.userId ?? null,
      hashWebAuthnChallenge(input.challenge),
      now,
      input.expiresAt,
      toJson(input.metadata ?? {}),
    )
}

export async function claimWebAuthnChallenge(input) {
  await ensureStorage()
  const now = nowStamp()
  const row = getDb()
    .prepare(
      `UPDATE webauthn_challenges
       SET used_at = ?
       WHERE purpose = ?
         AND challenge_hash = ?
         AND used_at IS NULL
         AND expires_at > ?
       RETURNING id, user_id, metadata_json`,
    )
    .get(
      now,
      input.purpose,
      hashWebAuthnChallenge(input.challenge),
      now,
    )
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    metadata: fromJson(row.metadata_json, {}),
  }
}

export async function getMailFetchState(userId) {
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT * FROM mail_fetch_state WHERE user_id = ?')
    .get(userId)
  if (!row) {
    return {
      userId,
      protocol: null,
      accountKey: null,
      uidValidity: null,
      lastUid: 0,
      folderStates: {},
      lastFetchedAt: null,
      lastHistorySyncAt: null,
      lastHistoryImported: 0,
      lastErrorCode: null,
      lastErrorAt: null,
      syncJob: null,
    }
  }
  const syncJob = row.sync_job_id
    ? {
        id: row.sync_job_id,
        mode: row.sync_job_mode === 'history' ? 'history' : 'incremental',
        status: row.sync_job_status ?? 'queued',
        createdAt: row.sync_job_created_at,
        startedAt: row.sync_job_started_at ?? null,
        completedAt: row.sync_job_completed_at ?? null,
        result: fromJson(row.sync_job_result_json, null),
        errorCode: row.sync_job_error_code ?? null,
        errorMessage: row.sync_job_error_message ?? null,
      }
    : null
  return {
    userId: row.user_id,
    protocol: row.protocol,
    accountKey: row.account_key ?? null,
    uidValidity: row.uid_validity,
    lastUid: Number(row.last_uid ?? 0),
    folderStates: fromJson(row.folder_states_json, {}),
    lastFetchedAt: row.last_fetched_at,
    lastHistorySyncAt: row.last_history_sync_at ?? null,
    lastHistoryImported: Number(row.last_history_imported ?? 0),
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    syncJob,
  }
}

function normalizedMailFolderStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [path, state] of Object.entries(value)) {
    if (!state || typeof state !== 'object') continue
    result[path] = {
      uidValidity: state.uidValidity ? String(state.uidValidity) : null,
      lastUid: Math.max(0, Number(state.lastUid ?? 0)),
    }
  }
  return result
}

export async function saveMailFetchState(userId, patch) {
  await ensureStorage()
  const current = await getMailFetchState(userId)
  const next = {
    ...current,
    ...patch,
    folderStates: patch.folderStates === undefined
      ? normalizedMailFolderStates(current.folderStates)
      : normalizedMailFolderStates(patch.folderStates),
  }
  const inboxState = next.folderStates.INBOX
    ?? Object.entries(next.folderStates).find(([path]) => path.toLowerCase() === 'inbox')?.[1]
    ?? null
  next.uidValidity = inboxState?.uidValidity ?? next.uidValidity ?? null
  next.lastUid = Number(inboxState?.lastUid ?? next.lastUid ?? 0)
  next.protocol = next.protocol ?? 'imap'
  getDb()
    .prepare(
      `INSERT INTO mail_fetch_state (
         user_id,
         protocol,
         account_key,
         uid_validity,
         last_uid,
         folder_states_json,
         last_fetched_at,
         last_history_sync_at,
         last_history_imported,
         last_error_code,
         last_error_at,
         sync_job_id,
         sync_job_mode,
         sync_job_status,
         sync_job_created_at,
         sync_job_started_at,
         sync_job_completed_at,
         sync_job_result_json,
         sync_job_error_code,
         sync_job_error_message
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         protocol = excluded.protocol,
         account_key = excluded.account_key,
         uid_validity = excluded.uid_validity,
         last_uid = excluded.last_uid,
         folder_states_json = excluded.folder_states_json,
         last_fetched_at = excluded.last_fetched_at,
         last_history_sync_at = excluded.last_history_sync_at,
         last_history_imported = excluded.last_history_imported,
         last_error_code = excluded.last_error_code,
         last_error_at = excluded.last_error_at,
         sync_job_id = excluded.sync_job_id,
         sync_job_mode = excluded.sync_job_mode,
         sync_job_status = excluded.sync_job_status,
         sync_job_created_at = excluded.sync_job_created_at,
         sync_job_started_at = excluded.sync_job_started_at,
         sync_job_completed_at = excluded.sync_job_completed_at,
         sync_job_result_json = excluded.sync_job_result_json,
         sync_job_error_code = excluded.sync_job_error_code,
         sync_job_error_message = excluded.sync_job_error_message`,
    )
    .run(
      userId,
      next.protocol,
      next.accountKey,
      next.uidValidity,
      next.lastUid,
      toJson(next.folderStates),
      next.lastFetchedAt,
      next.lastHistorySyncAt,
      Number(next.lastHistoryImported ?? 0),
      next.lastErrorCode,
      next.lastErrorAt,
      next.syncJob?.id ?? null,
      next.syncJob?.mode ?? null,
      next.syncJob?.status ?? null,
      next.syncJob?.createdAt ?? null,
      next.syncJob?.startedAt ?? null,
      next.syncJob?.completedAt ?? null,
      toJson(next.syncJob?.result ?? {}),
      next.syncJob?.errorCode ?? null,
      next.syncJob?.errorMessage ?? null,
    )
  return next
}

function mailSyncJobFromRow(row) {
  if (!row?.sync_job_id) return null
  return {
    id: row.sync_job_id,
    userId: row.user_id,
    mode: row.sync_job_mode === 'history' ? 'history' : 'incremental',
    status: row.sync_job_status ?? 'queued',
    createdAt: row.sync_job_created_at,
    startedAt: row.sync_job_started_at ?? null,
    completedAt: row.sync_job_completed_at ?? null,
    result: fromJson(row.sync_job_result_json, null),
    errorCode: row.sync_job_error_code ?? null,
    errorMessage: row.sync_job_error_message ?? null,
  }
}

/** Persist one browser-independent mail sync job per user, coalescing repeat clicks while active. */
export async function enqueueMailSyncJob(userId, mode) {
  await ensureStorage()
  const database = getDb()
  return database.transaction(() => {
    const current = database.prepare('SELECT * FROM mail_fetch_state WHERE user_id = ?').get(userId)
    const currentJob = mailSyncJobFromRow(current)
    if (currentJob && ['queued', 'running'].includes(currentJob.status)) {
      return { job: currentJob, alreadyQueued: true }
    }

    const job = {
      id: createId('mail-sync'),
      userId,
      mode: mode === 'history' ? 'history' : 'incremental',
      status: 'queued',
      createdAt: nowStamp(),
      startedAt: null,
      completedAt: null,
      result: null,
      errorCode: null,
      errorMessage: null,
    }
    database.prepare(
      `INSERT INTO mail_fetch_state (
         user_id, protocol, sync_job_id, sync_job_mode, sync_job_status,
         sync_job_created_at, sync_job_result_json
       ) VALUES (?, 'imap', ?, ?, 'queued', ?, '{}')
       ON CONFLICT(user_id) DO UPDATE SET
         sync_job_id = excluded.sync_job_id,
         sync_job_mode = excluded.sync_job_mode,
         sync_job_status = excluded.sync_job_status,
         sync_job_created_at = excluded.sync_job_created_at,
         sync_job_started_at = NULL,
         sync_job_completed_at = NULL,
         sync_job_result_json = '{}',
         sync_job_error_code = NULL,
         sync_job_error_message = NULL`,
    ).run(userId, job.id, job.mode, job.createdAt)
    return { job, alreadyQueued: false }
  })()
}

export async function claimNextMailSyncJob(jobId = null) {
  await ensureStorage()
  const database = getDb()
  return database.transaction(() => {
    const row = jobId
      ? database.prepare(
          `SELECT * FROM mail_fetch_state
           WHERE sync_job_status = 'queued' AND sync_job_id = ?
           LIMIT 1`,
        ).get(jobId)
      : database.prepare(
          `SELECT * FROM mail_fetch_state
           WHERE sync_job_status = 'queued'
           ORDER BY sync_job_created_at ASC
           LIMIT 1`,
        ).get()
    if (!row) return null
    const startedAt = nowStamp()
    const claimed = database.prepare(
      `UPDATE mail_fetch_state
       SET sync_job_status = 'running', sync_job_started_at = ?
       WHERE user_id = ? AND sync_job_id = ? AND sync_job_status = 'queued'`,
    ).run(startedAt, row.user_id, row.sync_job_id)
    if (claimed.changes === 0) return null
    return mailSyncJobFromRow({
      ...row,
      sync_job_status: 'running',
      sync_job_started_at: startedAt,
    })
  })()
}

export async function finishMailSyncJob(jobId, { status, result = null, errorCode = null, errorMessage = null }) {
  await ensureStorage()
  const database = getDb()
  const completedAt = nowStamp()
  const updated = database.prepare(
    `UPDATE mail_fetch_state
     SET sync_job_status = ?, sync_job_completed_at = ?, sync_job_result_json = ?,
         sync_job_error_code = ?, sync_job_error_message = ?
     WHERE sync_job_id = ? AND sync_job_status IN ('queued', 'running')`,
  ).run(status, completedAt, toJson(result ?? {}), errorCode, errorMessage, jobId)
  if (updated.changes === 0) return null
  return mailSyncJobFromRow(database.prepare('SELECT * FROM mail_fetch_state WHERE sync_job_id = ?').get(jobId))
}

export async function resetMailFetchState(userId) {
  await ensureStorage()
  const result = getDb().prepare('DELETE FROM mail_fetch_state WHERE user_id = ?').run(userId)
  return result.changes > 0
}

export async function hasProcessedMessage(userId, messageId) {
  if (!messageId) return false
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT 1 FROM processed_messages WHERE user_id = ? AND message_id = ?')
    .get(userId, messageId)
  return Boolean(row)
}

/** Returns true if newly recorded, false if this (user, messageId) pair was already processed. */
export async function markMessageProcessed(userId, messageId, applicationId = null) {
  if (!messageId) return false
  await ensureStorage()
  const result = getDb()
    .prepare(
      `INSERT INTO processed_messages (id, user_id, message_id, processed_at, application_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, message_id) DO NOTHING`,
    )
    .run(createId('msg'), userId, messageId, nowStamp(), applicationId)
  return result.changes > 0
}

function notificationFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    applicationId: row.application_id,
    title: row.title,
    body: row.body,
    triggerDate: row.trigger_date,
    createdAt: row.created_at,
    readAt: row.read_at,
    archivedAt: row.archived_at,
    targetPath: row.target_path,
    targetTab: row.target_tab,
    targetId: row.target_id,
    metadata: fromJson(row.metadata_json, {}),
    emailedAt: row.emailed_at,
  }
}

/** Inserts a notification unless one with the same (userId, dedupeKey) already exists. Returns the row if newly created, else null. */
export async function insertNotificationIfNew(userId, candidate) {
  await ensureStorage()
  const id = createId('notif')
  const createdAt = nowStamp()
  const result = getDb()
    .prepare(
      `INSERT INTO notifications (
        id, user_id, type, application_id, title, body, dedupe_key, trigger_date,
        created_at, target_path, target_tab, target_id, metadata_json
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, dedupe_key) DO NOTHING`,
    )
    .run(
      id,
      userId,
      candidate.type,
      candidate.applicationId ?? null,
      candidate.title,
      candidate.body,
      candidate.dedupeKey,
      candidate.triggerDate,
      createdAt,
      candidate.targetPath ?? null,
      candidate.targetTab ?? null,
      candidate.targetId ?? null,
      toJson(candidate.metadata ?? {}),
    )
  if (result.changes === 0) return null
  return notificationFromRow(getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(id))
}

export async function markNotificationEmailed(id) {
  await ensureStorage()
  getDb().prepare('UPDATE notifications SET emailed_at = ? WHERE id = ?').run(nowStamp(), id)
}

/** Returns undelivered notification-email candidates in chronological order for one digest. */
export async function listPendingNotificationEmails(userId, { since, limit = 100 } = {}) {
  await ensureStorage()
  const clauses = ['user_id = ?', 'emailed_at IS NULL', 'archived_at IS NULL']
  const params = [userId]
  if (since) {
    clauses.push('created_at >= ?')
    params.push(since)
  }
  const rows = getDb()
    .prepare(`SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC LIMIT ?`)
    .all(...params, Math.min(100, Math.max(1, Number(limit) || 100)))
  return rows.map(notificationFromRow)
}

/** Marks all notification rows included in a successfully accepted digest. */
export async function markNotificationsEmailed(notificationIds) {
  await ensureStorage()
  const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : [])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))]
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(', ')
  const result = getDb()
    .prepare(`UPDATE notifications SET emailed_at = ? WHERE emailed_at IS NULL AND id IN (${placeholders})`)
    .run(nowStamp(), ...ids)
  return result.changes
}

export async function listNotifications(userId, { unreadOnly = false, archivedOnly = false, includeArchived = false, before, limit = 50 } = {}) {
  await ensureStorage()
  const clauses = ['user_id = ?']
  const params = [userId]
  if (unreadOnly) clauses.push('read_at IS NULL')
  if (archivedOnly) {
    clauses.push('archived_at IS NOT NULL')
  } else if (!includeArchived) {
    clauses.push('archived_at IS NULL')
  }
  if (before) {
    clauses.push('created_at < ?')
    params.push(before)
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, Math.min(200, Math.max(1, Number(limit) || 50)))
  return rows.map(notificationFromRow)
}

export async function countUnreadNotifications(userId) {
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL')
    .get(userId)
  return Number(row?.count ?? 0)
}

export async function markNotificationRead(userId, notificationId) {
  await ensureStorage()
  const result = getDb()
    .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL AND archived_at IS NULL')
    .run(nowStamp(), notificationId, userId)
  if (result.changes > 0) return true
  return Boolean(getDb().prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ? AND archived_at IS NULL').get(notificationId, userId))
}

export async function markAllNotificationsRead(userId) {
  await ensureStorage()
  const result = getDb()
    .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL')
    .run(nowStamp(), userId)
  return result.changes
}

export async function markNotificationUnread(userId, notificationId) {
  await ensureStorage()
  const result = getDb()
    .prepare('UPDATE notifications SET read_at = NULL WHERE id = ? AND user_id = ? AND read_at IS NOT NULL AND archived_at IS NULL')
    .run(notificationId, userId)
  if (result.changes > 0) return true
  return Boolean(getDb().prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ? AND archived_at IS NULL').get(notificationId, userId))
}

export async function archiveNotification(userId, notificationId) {
  await ensureStorage()
  const stamp = nowStamp()
  const result = getDb()
    .prepare('UPDATE notifications SET archived_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ? AND archived_at IS NULL')
    .run(stamp, stamp, notificationId, userId)
  return result.changes > 0
}

export async function updateNotificationsBulk(userId, notificationIds, action) {
  await ensureStorage()
  const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : [])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))]
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(', ')
  const stamp = nowStamp()
  if (action === 'mark_read') {
    const result = getDb()
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND archived_at IS NULL AND read_at IS NULL AND id IN (${placeholders})`)
      .run(stamp, userId, ...ids)
    return result.changes
  }
  if (action === 'mark_unread') {
    const result = getDb()
      .prepare(`UPDATE notifications SET read_at = NULL WHERE user_id = ? AND archived_at IS NULL AND read_at IS NOT NULL AND id IN (${placeholders})`)
      .run(userId, ...ids)
    return result.changes
  }
  if (action === 'archive') {
    const result = getDb()
      .prepare(`UPDATE notifications SET archived_at = ?, read_at = COALESCE(read_at, ?) WHERE user_id = ? AND archived_at IS NULL AND id IN (${placeholders})`)
      .run(stamp, stamp, userId, ...ids)
    return result.changes
  }
  return 0
}

function pushSubscriptionFromRow(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Keeps one subscription per browser endpoint. Reassigning an endpoint on sign-in prevents
 * a shared device from delivering the previous account's notifications to the next account.
 */
export async function upsertPushSubscription(userId, subscription) {
  await ensureStorage()
  const stamp = nowStamp()
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         updated_at = excluded.updated_at`,
    )
    .run(
      subscription.endpoint,
      userId,
      subscription.keys.p256dh,
      subscription.keys.auth,
      stamp,
      stamp,
    )
  invalidateSharedStoreCache()
  return pushSubscriptionFromRow(
    getDb().prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint),
  )
}

export async function listPushSubscriptions(userId) {
  await ensureStorage()
  return getDb()
    .prepare('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map(pushSubscriptionFromRow)
}

export async function deletePushSubscription(userId, endpoint) {
  await ensureStorage()
  const result = getDb()
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint)
  invalidateSharedStoreCache()
  return result.changes > 0
}

/** Removes an expired browser endpoint without needing a still-valid session. */
export async function deletePushSubscriptionByEndpoint(endpoint) {
  await ensureStorage()
  const result = getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
  invalidateSharedStoreCache()
  return result.changes > 0
}

export async function getPushVapidKeys() {
  await ensureStorage()
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key = 'push_vapid_keys'").get()
  const encrypted = fromJson(row?.value, {})
  const publicKey = String(encrypted.publicKey ?? '')
  const privateKey = decryptSecret(String(encrypted.privateKey ?? ''))
  return publicKey && privateKey ? { publicKey, privateKey } : null
}

export async function savePushVapidKeys({ publicKey, privateKey }) {
  await ensureStorage()
  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value)
       VALUES ('push_vapid_keys', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(toJson({ publicKey, privateKey: encryptSecret(privateKey) }))
  invalidateSharedStoreCache()
}

function notificationGroupFromRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    ownerId: row.owner_id,
    teamId: row.team_id,
    name: row.name,
    memberIds: fromJson(row.member_ids_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listNotificationGroups({ scope, ownerId = null, teamId = null }) {
  await ensureStorage()
  if (scope === 'team') {
    const rows = getDb()
      .prepare('SELECT * FROM notification_groups WHERE scope = ? AND team_id = ? ORDER BY updated_at DESC')
      .all(scope, teamId)
    return rows.map(notificationGroupFromRow)
  }
  const rows = getDb()
    .prepare('SELECT * FROM notification_groups WHERE scope = ? AND owner_id = ? ORDER BY updated_at DESC')
    .all(scope, ownerId)
  return rows.map(notificationGroupFromRow)
}

export async function createNotificationGroup({ scope, ownerId = null, teamId = null, name, memberIds }) {
  await ensureStorage()
  const id = createId('ngrp')
  const now = nowStamp()
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : [])
    .map((memberId) => String(memberId ?? '').trim())
    .filter(Boolean))]
  getDb()
    .prepare(
      `INSERT INTO notification_groups (id, scope, owner_id, team_id, name, member_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, scope, ownerId, teamId, String(name ?? '').trim(), toJson(ids), now, now)
  return notificationGroupFromRow(getDb().prepare('SELECT * FROM notification_groups WHERE id = ?').get(id))
}

export async function updateNotificationGroup(groupId, { name, memberIds }) {
  await ensureStorage()
  const existing = getDb().prepare('SELECT * FROM notification_groups WHERE id = ?').get(groupId)
  if (!existing) return null
  const nextName = String(name ?? existing.name).trim()
  const ids = memberIds === undefined
    ? fromJson(existing.member_ids_json, [])
    : [...new Set((Array.isArray(memberIds) ? memberIds : [])
      .map((memberId) => String(memberId ?? '').trim())
      .filter(Boolean))]
  getDb()
    .prepare('UPDATE notification_groups SET name = ?, member_ids_json = ?, updated_at = ? WHERE id = ?')
    .run(nextName, toJson(ids), nowStamp(), groupId)
  return notificationGroupFromRow(getDb().prepare('SELECT * FROM notification_groups WHERE id = ?').get(groupId))
}

export async function deleteNotificationGroup(groupId) {
  await ensureStorage()
  const result = getDb().prepare('DELETE FROM notification_groups WHERE id = ?').run(groupId)
  return result.changes > 0
}

// `teamVisibleOwnerIds` is precomputed per-request in `hydrateUser` (server/index.js) -- it is
// NOT "every member of my team," it is scoped to the caller's actual role: an institution-admin
// (`owner`) sees every member's applications, but a teacher (`admin`) only sees the
// applications of students they personally invited, and a student (`member`) sees only their own
// (via the ownerId check below, with no team-wide grant). See `computeTeamVisibleOwnerIds`.
export function findUserApplication(store, user, id, teamVisibleOwnerIds = new Set()) {
  return store.applications.find((application) => {
    if (application.id !== id) return false
    if (application.ownerId === user.id) return true
    if (!application.teamId) return false
    return teamVisibleOwnerIds.has(application.ownerId)
  })
}

export function summarizeUserApplications(store, userId) {
  return store.applications.filter((application) => application.ownerId === userId)
}

function normalizeTeamRoleLabels(value) {
  if (!value || typeof value !== 'object') return undefined
  const admin = typeof value.admin === 'string' ? value.admin.trim().slice(0, 40) : ''
  const member = typeof value.member === 'string' ? value.member.trim().slice(0, 40) : ''
  if (!admin && !member) return undefined
  return {
    ...(admin ? { admin } : {}),
    ...(member ? { member } : {}),
  }
}

function teamFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    seatLimit: Number(row.seat_limit ?? 5),
    logoDataUrl: typeof row.logo_data_url === 'string' ? row.logo_data_url : '',
    profilePresets: fromJson(row.profile_presets_json, null),
    roleLabels: normalizeTeamRoleLabels(fromJson(row.role_labels_json, null)),
    teacherGroups: normalizeTeamTeacherGroups(fromJson(row.teacher_groups_json, [])),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function teamMemberFromRow(row) {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    invitedEmail: row.invited_email,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    relationships: fromJson(row.relationship_json, {}),
    contactProfile: fromJson(row.profile_json, {}),
    inviteExpiresAt: row.invite_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at,
  }
}

function hashInviteToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeJoinCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function hashJoinCode(code) {
  return createHash('sha256').update(normalizeJoinCode(code)).digest('hex')
}

function teamJoinCodeFromRow(row) {
  if (!row) return null
  const maxUses = row.max_uses === null || row.max_uses === undefined
    ? null
    : Number(row.max_uses)
  return {
    id: row.id,
    teamId: row.team_id,
    role: row.role,
    createdBy: row.created_by,
    teacherIds: fromJson(row.teacher_ids_json, []),
    expiresAt: row.expires_at,
    maxUses,
    useCount: Number(row.use_count ?? 0),
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createTeam(ownerId, name, seatLimit = 5) {
  await ensureStorage()
  const id = createId('team')
  const now = nowStamp()
  getDb()
    .prepare(
      `INSERT INTO teams (id, name, owner_id, seat_limit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, ownerId, seatLimit, now, now)
  getDb()
    .prepare(
      `INSERT INTO team_members (id, team_id, user_id, invited_email, role, status, invited_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, ?)`,
    )
    .run(createId('tmem'), id, ownerId, '', ownerId, now, now)
  invalidateSharedStoreCache()
  return teamFromRow(getDb().prepare('SELECT * FROM teams WHERE id = ?').get(id))
}

export async function getTeamById(teamId) {
  await ensureStorage()
  const row = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(teamId)
  return row ? teamFromRow(row) : null
}

export async function getTeamByOwnerId(ownerId) {
  await ensureStorage()
  const row = getDb().prepare('SELECT * FROM teams WHERE owner_id = ?').get(ownerId)
  return row ? teamFromRow(row) : null
}

export async function listTeams() {
  await ensureStorage()
  return getDb()
    .prepare('SELECT * FROM teams ORDER BY created_at DESC')
    .all()
    .map(teamFromRow)
}

export async function renameTeam(teamId, name) {
  await ensureStorage()
  getDb().prepare('UPDATE teams SET name = ?, updated_at = ? WHERE id = ?').run(name, nowStamp(), teamId)
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamLogo(teamId, logoDataUrl) {
  await ensureStorage()
  getDb()
    .prepare('UPDATE teams SET logo_data_url = ?, updated_at = ? WHERE id = ?')
    .run(logoDataUrl, nowStamp(), teamId)
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamSeatLimit(teamId, seatLimit) {
  await ensureStorage()
  getDb().prepare('UPDATE teams SET seat_limit = ?, updated_at = ? WHERE id = ?').run(seatLimit, nowStamp(), teamId)
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamProfilePresets(teamId, presets) {
  await ensureStorage()
  getDb()
    .prepare('UPDATE teams SET profile_presets_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(presets), nowStamp(), teamId)
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamRoleLabels(teamId, roleLabels) {
  await ensureStorage()
  const normalized = normalizeTeamRoleLabels(roleLabels) ?? {}
  getDb()
    .prepare('UPDATE teams SET role_labels_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(normalized), nowStamp(), teamId)
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamTeacherGroups(teamId, teacherGroups) {
  await ensureStorage()
  const normalized = normalizeTeamTeacherGroups(teacherGroups)
  getDb()
    .prepare('UPDATE teams SET teacher_groups_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(normalized), nowStamp(), teamId)
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function countSeatHoldingMembers(teamId) {
  await ensureStorage()
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM team_members
       WHERE team_id = ? AND status IN ('pending', 'active')`,
    )
    .get(teamId)
  return Number(row?.count ?? 0)
}

export async function listTeamMembers(teamId) {
  await ensureStorage()
  const rows = getDb()
    .prepare(
      `SELECT * FROM team_members WHERE team_id = ? AND status != 'removed' ORDER BY created_at ASC`,
    )
    .all(teamId)
  return rows.map(teamMemberFromRow)
}

export async function listTeamMembersForTeams(teamIds) {
  await ensureStorage()
  const ids = Array.from(new Set(
    (Array.isArray(teamIds) ? teamIds : [])
      .map((teamId) => String(teamId ?? '').trim())
      .filter(Boolean),
  ))
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(
      `SELECT * FROM team_members
       WHERE team_id IN (${placeholders}) AND status != 'removed'
       ORDER BY team_id ASC, created_at ASC`,
    )
    .all(...ids)
  return rows.map(teamMemberFromRow)
}

export async function findTeamMemberById(teamId, memberId) {
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT * FROM team_members WHERE id = ? AND team_id = ?')
    .get(memberId, teamId)
  return row ? teamMemberFromRow(row) : null
}

export async function findTeamMemberByEmail(teamId, email) {
  await ensureStorage()
  const row = getDb()
    .prepare(
      `SELECT * FROM team_members WHERE team_id = ? AND invited_email = ? AND status != 'removed'`,
    )
    .get(teamId, email.toLowerCase())
  return row ? teamMemberFromRow(row) : null
}

export async function findTeamMembershipForUser(teamId, userId) {
  await ensureStorage()
  const row = getDb()
    .prepare(
      `SELECT * FROM team_members WHERE team_id = ? AND user_id = ? AND status != 'removed'`,
    )
    .get(teamId, userId)
  return row ? teamMemberFromRow(row) : null
}

export async function listActiveTeamMembershipsForUser(userId) {
  await ensureStorage()
  const rows = getDb()
    .prepare(`SELECT * FROM team_members WHERE user_id = ? AND status = 'active'`)
    .all(userId)
  return rows.map(teamMemberFromRow)
}

/**
 * Which other users' applications `userId` may see through team membership, scoped to the
 * institution-admin/teacher/student hierarchy: an `owner` sees every active student member's applications;
 * `admin` (teacher) sees every student whose collaboration roster includes that teacher; a
 * `member` (student) gets nothing extra here.
 */
export async function computeTeamVisibleOwnerIds(userId, knownMemberships) {
  await ensureStorage()
  const memberships = Array.isArray(knownMemberships)
    ? knownMemberships
    : await listActiveTeamMembershipsForUser(userId)
  const managingMemberships = memberships.filter((membership) => membership.role !== 'member')
  const membershipsByTeamId = new Map(
    managingMemberships.map((membership) => [membership.teamId, membership]),
  )
  const teamMembers = await listTeamMembersForTeams(managingMemberships.map((membership) => membership.teamId))
  const visible = new Set()
  for (const member of teamMembers) {
    if (!member.userId || member.status !== 'active' || member.role !== 'member') continue
    const membership = membershipsByTeamId.get(member.teamId)
    if (membership?.role === 'owner') {
      visible.add(member.userId)
    } else if (membership?.role === 'admin' && isTeacherAssignedToStudent(member, userId)) {
      visible.add(member.userId)
    }
  }
  return visible
}

export async function createTeamInvite(
  teamId,
  { email, role, invitedBy, existingUserId, token, expiresAt, relationships = {} },
) {
  await ensureStorage()
  const id = createId('tmem')
  const now = nowStamp()
  getDb()
    .prepare(
      `INSERT INTO team_members (
        id, team_id, user_id, invited_email, role, status, invited_by,
        relationship_json, invite_token_hash, invite_expires_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      teamId,
      existingUserId ?? null,
      email.toLowerCase(),
      role,
      invitedBy,
      toJson(relationships ?? {}),
      hashInviteToken(token),
      expiresAt,
      now,
      now,
    )
  return teamMemberFromRow(getDb().prepare('SELECT * FROM team_members WHERE id = ?').get(id))
}

export async function findTeamInviteByToken(token) {
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT * FROM team_members WHERE invite_token_hash = ?')
    .get(hashInviteToken(token))
  return row ? teamMemberFromRow(row) : null
}

export async function createTeamJoinCode(
  teamId,
  { code, role, createdBy, teacherIds = [], expiresAt, maxUses = null },
) {
  await ensureStorage()
  const id = createId('tjoin')
  const now = nowStamp()
  const database = getDb()
  const createCredential = database.transaction(() => {
    if (role === 'owner') {
      database
        .prepare(
          `UPDATE team_join_codes
           SET revoked_at = ?, updated_at = ?
           WHERE team_id = ? AND role = 'owner' AND revoked_at IS NULL`,
        )
        .run(now, now, teamId)
    }
    database
      .prepare(
        `INSERT INTO team_join_codes (
          id, team_id, code_hash, role, created_by, teacher_ids_json,
          expires_at, max_uses, use_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        teamId,
        hashJoinCode(code),
        role,
        createdBy,
        toJson(Array.from(new Set(teacherIds))),
        expiresAt,
        maxUses,
        now,
        now,
      )
  })
  createCredential()
  return teamJoinCodeFromRow(
    database.prepare('SELECT * FROM team_join_codes WHERE id = ?').get(id),
  )
}

export async function findTeamJoinCodeByCode(code) {
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT * FROM team_join_codes WHERE code_hash = ?')
    .get(hashJoinCode(code))
  return teamJoinCodeFromRow(row)
}

export async function redeemTeamJoinCode(
  code,
  { userId, userEmail, teacherSeatLimit, studentSeatLimit },
) {
  await ensureStorage()
  const database = getDb()
  const now = nowStamp()
  const normalizedEmail = String(userEmail ?? '').trim().toLowerCase()

  const redeem = database.transaction(() => {
    const credentialRow = database
      .prepare('SELECT * FROM team_join_codes WHERE code_hash = ?')
      .get(hashJoinCode(code))
    if (!credentialRow) return { ok: false, reason: 'NOT_FOUND' }

    const credential = teamJoinCodeFromRow(credentialRow)
    if (
      credential.revokedAt
      || new Date(credential.expiresAt).getTime() <= Date.now()
      || (credential.maxUses !== null && credential.useCount >= credential.maxUses)
    ) {
      return { ok: false, reason: 'EXPIRED' }
    }

    const teamRow = database.prepare('SELECT * FROM teams WHERE id = ?').get(credential.teamId)
    if (!teamRow) return { ok: false, reason: 'NOT_FOUND' }

    const duplicate = database
      .prepare(
        `SELECT * FROM team_members
         WHERE team_id = ?
           AND (user_id = ? OR lower(invited_email) = ?)
           AND status IN ('pending', 'active')
         LIMIT 1`,
      )
      .get(credential.teamId, userId, normalizedEmail)
    if (duplicate) return { ok: false, reason: 'MEMBER_ALREADY_INVITED' }

    if (credential.role === 'owner') {
      const currentOwner = database.prepare('SELECT role FROM users WHERE id = ?').get(teamRow.owner_id)
      const hasInstitutionOwner = database
        .prepare(
          `SELECT 1 FROM team_members
           WHERE team_id = ? AND role = 'owner' AND status = 'active' AND user_id != ?
           LIMIT 1`,
        )
        .get(credential.teamId, teamRow.owner_id)
      if (
        teamRow.owner_id !== credential.createdBy
        || currentOwner?.role !== 'admin'
        || hasInstitutionOwner
      ) {
        return { ok: false, reason: 'TEAM_ROLE_FORBIDDEN' }
      }

      database
        .prepare(
          `DELETE FROM team_members
           WHERE team_id = ?
             AND status = 'removed'
             AND (user_id = ? OR lower(invited_email) = ?)`,
        )
        .run(credential.teamId, userId, normalizedEmail)
      const ownerMembership = database
        .prepare(
          `SELECT id FROM team_members
           WHERE team_id = ? AND role = 'owner' AND status = 'active' AND user_id = ?
           LIMIT 1`,
        )
        .get(credential.teamId, teamRow.owner_id)
      if (!ownerMembership) return { ok: false, reason: 'NOT_FOUND' }

      database
        .prepare(
          `UPDATE team_members
           SET user_id = ?, invited_email = ?, invited_by = ?, relationship_json = '{}',
               updated_at = ?
           WHERE id = ?`,
        )
        .run(userId, normalizedEmail, userId, now, ownerMembership.id)
      database
        .prepare('UPDATE teams SET owner_id = ?, updated_at = ? WHERE id = ?')
        .run(userId, now, credential.teamId)
    } else {
      const roleLimit = credential.role === 'admin' ? teacherSeatLimit : studentSeatLimit
      const roleCount = database
        .prepare(
          `SELECT COUNT(*) AS count FROM team_members
           WHERE team_id = ? AND role = ? AND status IN ('pending', 'active')`,
        )
        .get(credential.teamId, credential.role)
      if (Number(roleCount?.count ?? 0) >= roleLimit) {
        return { ok: false, reason: 'SEAT_LIMIT_REACHED' }
      }

      const teacherIds = credential.role === 'member'
        ? Array.from(new Set(credential.teacherIds))
        : []
      if (credential.role === 'member') {
        if (teacherIds.length === 0) return { ok: false, reason: 'VALIDATION_ERROR' }
        const placeholders = teacherIds.map(() => '?').join(', ')
        const teacherRows = database
          .prepare(
            `SELECT user_id FROM team_members
             WHERE team_id = ? AND status = 'active' AND role = 'admin'
               AND user_id IN (${placeholders})`,
          )
          .all(credential.teamId, ...teacherIds)
        if (teacherRows.length !== teacherIds.length) {
          return { ok: false, reason: 'VALIDATION_ERROR' }
        }
      }

      const removedRows = database
        .prepare(
          `SELECT id FROM team_members
           WHERE team_id = ?
             AND status = 'removed'
             AND (user_id = ? OR lower(invited_email) = ?)
           ORDER BY updated_at DESC`,
        )
        .all(credential.teamId, userId, normalizedEmail)
      const reusableRowId = removedRows[0]?.id ?? null
      for (const removedRow of removedRows.slice(1)) {
        database.prepare('DELETE FROM team_members WHERE id = ?').run(removedRow.id)
      }

      const relationships = credential.role === 'member' ? { teacherIds } : {}
      const invitedBy = teacherIds[0] ?? credential.createdBy
      if (reusableRowId) {
        database
          .prepare(
            `UPDATE team_members
             SET user_id = ?, invited_email = ?, role = ?, status = 'active',
                 invited_by = ?, relationship_json = ?, invite_token_hash = NULL,
                 invite_expires_at = NULL, removed_at = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            userId,
            normalizedEmail,
            credential.role,
            invitedBy,
            toJson(relationships),
            now,
            reusableRowId,
          )
      } else {
        database
          .prepare(
            `INSERT INTO team_members (
              id, team_id, user_id, invited_email, role, status, invited_by,
              relationship_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
          )
          .run(
            createId('tmem'),
            credential.teamId,
            userId,
            normalizedEmail,
            credential.role,
            invitedBy,
            toJson(relationships),
            now,
            now,
          )
      }
    }

    const nextUseCount = credential.useCount + 1
    const revokeAt = credential.maxUses !== null && nextUseCount >= credential.maxUses ? now : null
    database
      .prepare(
        `UPDATE team_join_codes
         SET use_count = ?, revoked_at = COALESCE(revoked_at, ?), updated_at = ?
         WHERE id = ?`,
      )
      .run(nextUseCount, revokeAt, now, credential.id)

    const membershipRow = database
      .prepare(
        `SELECT * FROM team_members
         WHERE team_id = ? AND user_id = ? AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(credential.teamId, userId)
    const updatedTeamRow = database.prepare('SELECT * FROM teams WHERE id = ?').get(credential.teamId)
    const updatedCredentialRow = database
      .prepare('SELECT * FROM team_join_codes WHERE id = ?')
      .get(credential.id)
    return {
      ok: true,
      team: teamFromRow(updatedTeamRow),
      membership: teamMemberFromRow(membershipRow),
      credential: teamJoinCodeFromRow(updatedCredentialRow),
    }
  })

  const result = redeem()
  if (result.ok) invalidateSharedStoreCache()
  return result
}

export async function updateTeamMemberRole(memberId, role) {
  await ensureStorage()
  getDb().prepare('UPDATE team_members SET role = ?, updated_at = ? WHERE id = ?').run(role, nowStamp(), memberId)
  const row = getDb().prepare('SELECT * FROM team_members WHERE id = ?').get(memberId)
  return row ? teamMemberFromRow(row) : null
}

export async function updateTeamMemberInvitedBy(memberId, invitedBy) {
  await ensureStorage()
  getDb().prepare('UPDATE team_members SET invited_by = ?, updated_at = ? WHERE id = ?').run(invitedBy, nowStamp(), memberId)
  const row = getDb().prepare('SELECT * FROM team_members WHERE id = ?').get(memberId)
  return row ? teamMemberFromRow(row) : null
}

export async function updateTeamMemberRelationships(memberId, relationships) {
  await ensureStorage()
  getDb()
    .prepare('UPDATE team_members SET relationship_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(relationships ?? {}), nowStamp(), memberId)
  const row = getDb().prepare('SELECT * FROM team_members WHERE id = ?').get(memberId)
  return row ? teamMemberFromRow(row) : null
}

export async function updateTeamMemberContactProfile(memberId, patch) {
  await ensureStorage()
  const database = getDb()
  const currentRow = database.prepare('SELECT * FROM team_members WHERE id = ?').get(memberId)
  if (!currentRow) return null
  const currentProfile = fromJson(currentRow.profile_json, {})
  const nextProfile = {
    ...currentProfile,
    ...patch,
  }
  database
    .prepare('UPDATE team_members SET profile_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(nextProfile), nowStamp(), memberId)
  invalidateSharedStoreCache()
  const row = database.prepare('SELECT * FROM team_members WHERE id = ?').get(memberId)
  return row ? teamMemberFromRow(row) : null
}

export async function removeTeamMember(memberId) {
  await ensureStorage()
  const now = nowStamp()
  getDb()
    .prepare(
      `UPDATE team_members SET status = 'removed', removed_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, memberId)
}

export async function acceptTeamInvite(memberId, userId) {
  await ensureStorage()
  const now = nowStamp()
  getDb()
    .prepare(
      `UPDATE team_members
       SET status = 'active', user_id = ?, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(userId, now, memberId)
  return teamMemberFromRow(getDb().prepare('SELECT * FROM team_members WHERE id = ?').get(memberId))
}

export async function declineTeamInvite(memberId) {
  await ensureStorage()
  const now = nowStamp()
  getDb()
    .prepare(
      `UPDATE team_members SET status = 'removed', removed_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, memberId)
}

export async function deleteTeam(teamId) {
  await ensureStorage()
  getDb().prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId)
  getDb().prepare('DELETE FROM teams WHERE id = ?').run(teamId)
  invalidateSharedStoreCache()
}

function aiKeyFromRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    teamId: row.team_id ?? null,
    scope: row.scope,
    provider: row.provider,
    label: row.label,
    model: row.model,
    baseUrl: row.base_url ?? '',
    apiKey: decryptSecret(row.api_key_encrypted ?? ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? null,
    usage: {
      calls: Number(row.call_count ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      resetAt: row.usage_reset_at ?? null,
    },
  }
}

/** Return credential metadata only. The encrypted secret is never exposed by this helper. */
export function publicAiKey(aiKey) {
  if (!aiKey) return aiKey
  const { apiKey: _apiKey, ...metadata } = aiKey
  return {
    ...metadata,
    secretSet: true,
  }
}

export async function listAiKeys({ ownerId, teamIds = [] } = {}) {
  await ensureStorage()
  const teamIdList = Array.from(new Set(teamIds.filter(Boolean)))
  const clauses = ['owner_id = ?']
  const values = [ownerId]
  if (teamIdList.length > 0) {
    clauses.push(`team_id IN (${teamIdList.map(() => '?').join(', ')})`)
    values.push(...teamIdList)
  }
  return getDb()
    .prepare(`SELECT * FROM ai_api_keys WHERE ${clauses.join(' OR ')} ORDER BY created_at DESC`)
    .all(...values)
    .map(aiKeyFromRow)
}

export async function getAiKeyById(id) {
  await ensureStorage()
  const row = getDb().prepare('SELECT * FROM ai_api_keys WHERE id = ?').get(id)
  return row ? aiKeyFromRow(row) : null
}

export async function createAiKey({ ownerId, teamId = null, scope, provider, label, model, baseUrl = '', apiKey }) {
  await ensureStorage()
  const id = createId('aikey')
  const now = nowStamp()
  await withWriteLock(async () => {
    getDb()
      .prepare(
        `INSERT INTO ai_api_keys (
          id, owner_id, team_id, scope, provider, label, model, base_url,
          api_key_encrypted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ownerId, teamId, scope, provider, label, model, baseUrl, encryptSecret(apiKey), now, now)
    invalidateSharedStoreCache()
  })
  return getAiKeyById(id)
}

export async function updateAiKey(id, patch = {}) {
  await ensureStorage()
  const current = await getAiKeyById(id)
  if (!current) return null
  const next = {
    label: patch.label ?? current.label,
    model: patch.model ?? current.model,
    baseUrl: patch.baseUrl ?? current.baseUrl,
    apiKey: typeof patch.apiKey === 'string' && patch.apiKey.trim() ? patch.apiKey : current.apiKey,
  }
  const now = nowStamp()
  await withWriteLock(async () => {
    getDb()
      .prepare(
        `UPDATE ai_api_keys
         SET label = ?, model = ?, base_url = ?, api_key_encrypted = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.label, next.model, next.baseUrl, encryptSecret(next.apiKey), now, id)
    invalidateSharedStoreCache()
  })
  return getAiKeyById(id)
}

export async function deleteAiKey(id) {
  await ensureStorage()
  await withWriteLock(async () => {
    getDb().prepare('DELETE FROM ai_api_keys WHERE id = ?').run(id)
    invalidateSharedStoreCache()
  })
}

export async function markAiKeyUsed(id) {
  await ensureStorage()
  getDb().prepare('UPDATE ai_api_keys SET last_used_at = ? WHERE id = ?').run(nowStamp(), id)
  invalidateSharedStoreCache()
}

export async function recordAiKeyUsage(id, usage = {}) {
  await ensureStorage()
  const inputTokens = Math.max(0, Math.round(Number(usage.inputTokens ?? 0) || 0))
  const outputTokens = Math.max(0, Math.round(Number(usage.outputTokens ?? 0) || 0))
  const totalTokens = Math.max(inputTokens + outputTokens, Math.round(Number(usage.totalTokens ?? 0) || 0))
  const usedAt = nowStamp()
  getDb()
    .prepare(
      `UPDATE ai_api_keys
       SET last_used_at = ?,
           call_count = call_count + 1,
           input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           total_tokens = total_tokens + ?
       WHERE id = ?`,
    )
    .run(usedAt, inputTokens, outputTokens, totalTokens, id)
  invalidateSharedStoreCache()
  return getAiKeyById(id)
}

export async function resetAiKeyUsage(id) {
  await ensureStorage()
  const resetAt = nowStamp()
  getDb()
    .prepare(
      `UPDATE ai_api_keys
       SET call_count = 0, input_tokens = 0, output_tokens = 0, total_tokens = 0, usage_reset_at = ?
       WHERE id = ?`,
    )
    .run(resetAt, id)
  invalidateSharedStoreCache()
  return getAiKeyById(id)
}
