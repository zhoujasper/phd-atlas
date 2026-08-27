import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import tar from 'tar-fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, statfsSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { hostname } from 'node:os'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import {
  AI_KEY_MAX_CONCURRENCY,
  normalizeAiKeyMaxConcurrency,
} from './shared/aiConcurrency.js'
import {
  AI_KEY_MAX_WEIGHT,
  AI_KEY_MIN_WEIGHT,
  aiKeyIsEnabled,
  normalizeAiKeyRequestMode,
  normalizeAiKeyWeight,
} from './shared/aiKeyRouting.js'
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
  decodeBackupFile,
  decodeExternalStatePayload,
  decodeExternalStatePayloadToFile,
  encodeBackupFile,
  encodeExternalStatePayload as encodeExternalEnvelope,
  encodeExternalStateFileStreaming,
  encodeExternalStatePayloadStreaming,
  inspectBackupFile,
  rewrapBackupFile,
} from './durableEnvelope.js'
import {
  plainSqliteExists,
  promoteSealedSqliteFile,
  replaceFileAtomic,
  sealSqliteFile,
  sealSqliteBuffer,
  sealedPathFor,
  sealedSqliteExists,
  unsealSqliteBuffer,
  verifySealedSqliteFile,
} from './sqliteSeal.js'
import {
  acquireEncryptedSqliteProcessLease,
  canonicalSqliteDatabasePath,
} from './sqliteProcessLease.js'
import {
  assertNoSecretValues,
  focusedSessionSettingsColumnsSql,
  focusedSessionSettingsFromRow,
  userSettingsBlankOnShedKeys,
  userSettingsShedKeys,
} from './userSettingsRegistry.js'
import {
  DEFAULT_ADMIN_MAX_BACKUPS_PER_APP,
  DEFAULT_BACKUP_FREQUENCY,
  DEFAULT_MAX_BACKUPS_PER_APP,
  DEFAULT_PRO_MAX_BACKUPS_PER_APP,
  MAX_SYSTEM_BACKUP_LIMIT,
  MIN_SYSTEM_BACKUP_LIMIT,
  normalizeBackupFrequency,
} from './sharedConstants.js'
import {
  createBatchedKeysetReader,
  DEFAULT_SCOPED_KEYSET_BATCH_SIZE,
} from './scopedKeysetReader.js'
import {
  assertExternalDatabaseTargetEmpty,
  createExternalDatabaseSqlDump,
  defaultSqlitePath,
  runtimeStorageRoot,
  isExternalDatabaseConfiguration,
  persistDatabaseConfiguration,
  publicDatabaseConfiguration,
  readExternalDatabaseState,
  readPersistedDatabaseConfiguration,
  verifyDatabaseConnection,
  writeExternalDatabaseState,
} from './databaseConnection.js'
import {
  normalizeStudentPermissions,
  normalizeTeamMemberRelationships,
  normalizeTeamPermissionDefaults,
  normalizeTeacherPermissions,
} from './teamPermissions.js'
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_USER_EMAIL,
  DEFAULT_USER_PASSWORD,
  seedApplications,
  seedProfileAssets,
} from './seed-data.js'
import { PUBLIC_DISTRIBUTION, PUBLIC_EDITION } from './edition.js'
import { ProfileRecommenderListSchema } from './validation.js'
import {
  isTeacherAssignedToStudent,
  normalizeTeamTeacherGroups,
} from './teamRelationships.js'
import {
  CODEX_AUTHORIZATION_EXPIRY_DAYS,
  CODEX_AUTHORIZATION_SCOPES,
  CODEX_AUTHORIZATION_SCOPE_VERSION,
} from './codexAuthorization.js'
import {
  DEFAULT_SYSTEM_LOG_RETENTION_DAYS,
  automaticBackupEventIdentity,
  compactLegacyAutomaticBackupEvents,
  configureSystemEventMaintenance,
  installStoragePerformanceIndexes,
  isAutomaticBackupEventId,
  normalizeExternalSyncDebounceMs,
  normalizeSqliteBusyTimeoutMs,
  normalizeStartupVacuumMaxBytes,
  normalizeSystemEventHardLimit,
  readMaintainedSystemEventCount,
  shouldVacuumAfterSystemEventCompaction,
} from './storagePerformance.js'
import {
  applySqliteSnapshotPageLimit,
  assertExternalSnapshotPayloadAdmission,
  assertSnapshotCapacityPlan,
  assertSqliteSealedPayloadAdmission,
  externalEncryptedPayloadMaxBytes,
  normalizeSnapshotDatabaseMaxBytes,
  normalizeSqliteFullAsSnapshotCapacity,
  resolveSnapshotCapacityPlan,
  snapshotCapacityError,
  sqliteSealedPayloadMaxBytes,
  sqliteSnapshotMetrics,
} from './snapshotStorageCapacity.js'
import { resolveMemoryBudget } from './memoryPressure.js'
import { payloadWorkerPool } from './payloadWorkerPool.mjs'
import {
  OUTGOING_MAIL_STALE_CLAIM_MS,
  outgoingDeliveryMessageId,
} from './outgoingMailQueue.js'
import { reconcileMailClassificationFingerprints } from './mailClassificationContext.js'
import { DISCOVER_SOURCE_INDEX_MAX_BYTES } from './discover-catalog.js'
import {
  APPLICATION_MUTATION_AUTHORITY_PATHS,
  canonicalApplicationAuthorityReceiptChunks,
  canonicalApplicationUserEditableChunks,
} from './shared/applicationPersistenceProtocol.js'
import {
  accountAuthProjection,
  accountAuthProjectionFromRow,
  commitPasswordResetTransaction,
  completeRegistrationTransaction,
  issuePasswordResetTransaction,
  normalizeAccountAuthVersion,
  readPasswordResetCandidateRecord,
  readRegistrationGateRecord,
  verifyRegistrationChallengeTransaction,
} from './accountAuthTransactions.js'
import {
  commitWebAuthnAuthenticationTransaction,
  commitWebAuthnRegistrationTransaction,
  deleteWebAuthnPasskeyTransaction,
  readWebAuthnChallengeRecord,
  renameWebAuthnPasskeyTransaction,
} from './passkeyAuthTransactions.js'

// ---- Write lock ----
// Serialises every readStore() -> modify -> writeStore() cycle so that
// concurrent callers (HTTP handlers, timers) cannot silently overwrite
// each other's changes.
const auditContext = new AsyncLocalStorage()
const writeLockContext = new AsyncLocalStorage()
const writeLaneLabelContext = new AsyncLocalStorage()
const deferredTelemetryPersistenceContext = new AsyncLocalStorage()
const activeWriteLanes = new Set()
const writeLaneWaiters = []

// Lane contention is the one thing that can serialise every write for a tenant,
// and until now it left no trace: a request that queued behind a slow lane was
// indistinguishable from a slow request. These counters are pure observation —
// nothing here may influence admission — and are surfaced on /api/health so a
// stall can be attributed instead of guessed at.
const WRITE_LANE_WAIT_WARN_MS = 2_000
const WRITE_LANE_HOLD_WARN_MS = 10_000
const writeLaneStats = {
  granted: 0,
  contended: 0,
  globalGranted: 0,
  slowWaits: 0,
  slowHolds: 0,
  totalWaitMs: 0,
  maxWaitMs: 0,
  maxQueueDepth: 0,
  maxActiveLanes: 0,
}
const writeLaneGrantedByLabel = new Map()

export function writeLaneSnapshot() {
  return {
    activeLanes: activeWriteLanes.size,
    queueDepth: writeLaneWaiters.length,
    granted: writeLaneStats.granted,
    contended: writeLaneStats.contended,
    globalGranted: writeLaneStats.globalGranted,
    slowWaits: writeLaneStats.slowWaits,
    slowHolds: writeLaneStats.slowHolds,
    maxWaitMs: Math.round(writeLaneStats.maxWaitMs),
    maxQueueDepth: writeLaneStats.maxQueueDepth,
    maxActiveLanes: writeLaneStats.maxActiveLanes,
    averageWaitMs: writeLaneStats.granted > 0
      ? Math.round(writeLaneStats.totalWaitMs / writeLaneStats.granted)
      : 0,
    grantedByLabel: Object.fromEntries(
      [...writeLaneGrantedByLabel.entries()]
        .sort(([, left], [, right]) => right - left)
        .slice(0, 16),
    ),
  }
}

/** Test seam: the counters are process-wide and would otherwise leak between cases. */
export function resetWriteLaneStatsForTests() {
  for (const key of Object.keys(writeLaneStats)) writeLaneStats[key] = 0
  writeLaneGrantedByLabel.clear()
}

function normalizeWriteLaneLabel(value) {
  const label = String(value ?? '').trim()
  return /^[a-z0-9:_-]{1,80}$/iu.test(label) ? label : null
}

/** Attach a bounded diagnostic owner to write-lane grants in this async task. */
export function runWithWriteLaneLabel(label, fn) {
  if (typeof fn !== 'function') throw new TypeError('A write-lane diagnostic task is required.')
  return writeLaneLabelContext.run(normalizeWriteLaneLabel(label) ?? 'unclassified', fn)
}

function reportSlowWriteLane(kind, owner, elapsedMs) {
  const lanes = owner.global ? 'global' : [...owner.tenantKeys].join(',')
  console.warn(
    `[storage] write lane ${kind} exceeded ${Math.round(elapsedMs)}ms`,
    { label: owner.label, lanes, queueDepth: writeLaneWaiters.length, activeLanes: activeWriteLanes.size },
  )
}

function canStartWriteOperation(owner) {
  for (const active of activeWriteLanes) {
    if (active.global || owner.global) return false
    for (const tenantKey of owner.tenantKeys) {
      if (active.tenantKeys.has(tenantKey)) return false
    }
  }
  return true
}

function drainWriteLaneWaiters() {
  for (let index = 0; index < writeLaneWaiters.length; index += 1) {
    const waiter = writeLaneWaiters[index]
    if (!canStartWriteOperation(waiter.owner)) {
      // A global waiter needs every lane to drain. Admitting tenant waiters
      // queued behind it would refill the lanes indefinitely, so a blocked
      // global request becomes a barrier: nothing after it may overtake.
      if (waiter.owner.global) return
      continue
    }
    writeLaneWaiters.splice(index, 1)
    index -= 1
    activeWriteLanes.add(waiter.owner)
    waiter.resolve()
  }
}

function releaseWriteLane(owner) {
  activeWriteLanes.delete(owner)
  drainWriteLaneWaiters()
}

/**
 * Lanes this store may commit into. An empty result means "global": the
 * caller gets exclusive access to every lane.
 *
 * A store without a differential baseline is a full reconcile — it rewrites
 * every user, application, and profile asset — so it must take the global
 * lane rather than the narrow settings lane its fingerprint would suggest.
 */
function databaseShouldRunInMemory(settings = activeEncryptionPolicy) {
  const encryptionAtRest = Boolean(settings?.encryptionAtRest)
  const sqliteEncryption = Boolean(settings?.sqliteEncryption && encryptionAtRest)
  return Boolean(
    (sqliteEncryption && !isExternalDatabaseConfiguration(activeDatabaseConfiguration))
    || (encryptionAtRest && isExternalDatabaseConfiguration(activeDatabaseConfiguration)),
  )
}

function tenantKeysForWriteStore(store) {
  const baseline = store?.[storeBaselineSymbol]
  if (!baseline) return []
  const writePlan = createStoreWritePlan(store)
  // Global settings can change the authoritative SQLite representation. Keep
  // all settings writes exclusive, and also globalize any later write that
  // must finish a previously failed disk/memory handoff.
  if (
    writePlan.settingsChanged
    || databaseShouldRunInMemory() !== databaseRunsInMemory
  ) return []
  const tenantKeys = new Set(writePlan.tenantKeys)
  // Audit rows are append-only INSERT OR IGNORE mutations inside the same
  // SQLite transaction as the authored entity write. Giving every audited
  // save the shared settings lane serializes unrelated accounts before their
  // payload preparation even starts. Keep an audited entity mutation on its
  // owning tenant lane; a standalone audit-only write still falls through to
  // the narrow settings lane below.
  // A differential store that touches nothing still must not be mistaken for
  // a global reconcile; give it the settings lane so it stays narrowly scoped.
  if (tenantKeys.size === 0) tenantKeys.add(tenantKeyForSettings())
  return [...tenantKeys]
}

export async function withWriteLock(fn, options = {}) {
  // Re-entrancy is established by AsyncLocalStorage alone. A module-level
  // "current owner" would be wrong now that independent tenant lanes run
  // concurrently: a second tenant acquiring a lane would overwrite it and
  // make an inner call re-acquire a lane its own caller already holds, which
  // deadlocks. The context store is per-async-scope and cannot be clobbered.
  const inheritedOwner = writeLockContext.getStore()
  if (inheritedOwner?.active) return fn()
  const rawTenantKeys = Array.isArray(options?.tenantKeys) ? options.tenantKeys : []
  const tenantKeys = new Set(rawTenantKeys.map((key) => String(key ?? '').trim()).filter(Boolean))
  const owner = {
    active: true,
    global: tenantKeys.size === 0,
    tenantKeys,
    label: normalizeWriteLaneLabel(options?.label)
      ?? normalizeWriteLaneLabel(writeLaneLabelContext.getStore())
      ?? (tenantKeys.size === 0 ? 'unclassified-global' : 'unclassified-tenant'),
  }
  const queuedAt = performance.now()
  let waitWarning = setTimeout(() => {
    waitWarning = null
    writeLaneStats.slowWaits += 1
    reportSlowWriteLane('wait', owner, performance.now() - queuedAt)
  }, WRITE_LANE_WAIT_WARN_MS)
  waitWarning.unref?.()
  await new Promise((resolve) => {
    writeLaneWaiters.push({ owner, resolve })
    writeLaneStats.maxQueueDepth = Math.max(writeLaneStats.maxQueueDepth, writeLaneWaiters.length)
    drainWriteLaneWaiters()
  })
  if (waitWarning) clearTimeout(waitWarning)
  const waitedMs = performance.now() - queuedAt
  writeLaneStats.granted += 1
  writeLaneStats.totalWaitMs += waitedMs
  writeLaneStats.maxWaitMs = Math.max(writeLaneStats.maxWaitMs, waitedMs)
  writeLaneStats.maxActiveLanes = Math.max(writeLaneStats.maxActiveLanes, activeWriteLanes.size)
  if (owner.global) writeLaneStats.globalGranted += 1
  writeLaneGrantedByLabel.set(owner.label, (writeLaneGrantedByLabel.get(owner.label) ?? 0) + 1)
  // A grant that was not immediate had to queue behind another lane.
  if (waitedMs >= 1) writeLaneStats.contended += 1
  let holdWarning = setTimeout(() => {
    holdWarning = null
    writeLaneStats.slowHolds += 1
    reportSlowWriteLane('hold', owner, WRITE_LANE_HOLD_WARN_MS)
  }, WRITE_LANE_HOLD_WARN_MS)
  holdWarning.unref?.()
  try {
    return await writeLockContext.run(owner, fn)
  } finally {
    if (holdWarning) clearTimeout(holdWarning)
    owner.active = false
    releaseWriteLane(owner)
  }
}

function runWithDeferredTelemetryPersistence(fn) {
  return deferredTelemetryPersistenceContext.run(true, fn)
}

function shouldDeferTelemetryPersistence() {
  return deferredTelemetryPersistenceContext.getStore() === true
}

/**
 * Convenience wrapper: acquire the write lock, call writeStore, release.
 * Use this for simple fire-and-forget HTTP paths that already hold a fresh
 * store snapshot. For callers that need to guard an entire read-modify-write
 * cycle, use withWriteLock(fn) directly.
 */
export function lockedWriteStore(store, afterWriteOrOptions) {
  const afterWrite = typeof afterWriteOrOptions === 'function'
    ? afterWriteOrOptions
    : afterWriteOrOptions?.afterWrite
  const writeOptions = typeof afterWriteOrOptions === 'function'
    ? {}
    : (afterWriteOrOptions ?? {})
  // The lane below is scoped to the same tenants the inner writeStore commits
  // (see the tenantKeys option on this call's closing brace), so two accounts
  // saving at once do not queue behind each other. Both the outer and inner
  // acquisition name the same lane, which is why withWriteLock must treat an
  // inherited context as re-entrant rather than trying to acquire twice.
  return withWriteLock(async () => {
    await ensureStorage()
    const baseline = store?.[storeBaselineSymbol]
    if (!baseline) {
      const result = await writeStore(store, writeOptions)
      await afterWrite?.(store)
      return result
    }

    // The overwhelmingly common path owns a snapshot from the current durable
    // revision. Avoid hydrating and decrypting the complete workspace again;
    // writeStoreUnlocked repeats this comparison after BEGIN IMMEDIATE so a
    // second process can never slip a write between this check and the commit.
    const expectedTenantRevisions = baseline.tenantRevisions
    const tenantRevisionsUnchanged = expectedTenantRevisions instanceof Map
      ? durableTenantRevisionsMatch(getDb(), expectedTenantRevisions)
      : null
    if (
      tenantRevisionsUnchanged === true
      || (tenantRevisionsUnchanged === null
        && readDurableWorkspaceRevision(getDb()) === baseline.revision)
    ) {
      const result = await writeStore(store, writeOptions)
      await afterWrite?.(store)
      return result
    }

    const scope = store?.[storeScopeSymbol]
    const latest = scope?.userId
      ? (scope.kind === 'mail-sync'
          ? await readMailSyncStore(scope.userId, { retainMemoryReservation: false })
          : await readScopedStore(scope.userId, {
              ...(scope.selector ?? {}),
              actorId: scope.actorId,
              retainMemoryReservation: false,
            }))
      : await readStore()
    const latestBaseline = latest?.[storeBaselineSymbol]
    const merged = mergeStoreChanges(latest, store, baseline)
    attachStoreBaseline(merged, latestBaseline)
    if (scope) attachStoreScope(merged, scope)
    const result = await writeStore(merged, writeOptions)
    Object.assign(store, merged)
    attachStoreBaseline(store, merged[storeBaselineSymbol])
    await afterWrite?.(store)
    return result
  }, { tenantKeys: tenantKeysForWriteStore(store), label: 'store-write' })
}

export function runWithAuditContext(context, fn) {
  return auditContext.run(context, fn)
}

// databaseConnection owns the default test runtime root so SQLite, backups,
// uploads, and persisted adapter configuration are isolated together. An
// explicit operator-provided storage root remains authoritative.
export const storageRoot = runtimeStorageRoot
export const uploadRoot = path.join(storageRoot, 'uploads')
export const backupRoot = path.join(storageRoot, 'backups')
const storageServiceLeaseTarget = path.join(storageRoot, '.phd-atlas-runtime-owner')
export let databasePath = defaultSqlitePath
export let sealedDatabasePath = sealedPathFor(databasePath)

let db
let databaseHandleGeneration = 0
let pendingDatabaseImage = null
let pendingDatabaseImageReleaseMemory = null
let databaseRunsInMemory = false
let storageReadyPromise = null
let storageInitialized = false
let storageShuttingDown = false
let storageShutdownPromise = null
let storageInitializationAbortController = null
let storageShutdownDurabilityFailed = false
const activeLocalDatabaseSnapshots = new Set()
// A real worker shutdown is terminal: once its durable owners are released,
// late request/background continuations must not silently initialize storage
// again and steal the process lease from the replacement worker. Ordinary
// test/maintenance shutdowns remain reopenable unless this latch is requested.
let storageTerminalShutdownRequested = false
let sharedStoreCache = null
let sharedStoreDataVersion = null
let sharedStoreCacheHydrations = 0
let scopedStoreHydrations = 0
let acquireStoreHydrationMemory = null
let acquireBackupRestoreMemory = null
const workspaceQuotaProcessInstanceId = randomUUID()
const workspaceQuotaHostName = hostname()
const WORKSPACE_QUOTA_HEARTBEAT_INTERVAL_MS = 15_000
const WORKSPACE_QUOTA_HEARTBEAT_LEASE_MS = 120_000
const WORKSPACE_QUOTA_RESERVATION_TTL_MS = 15 * 60_000
const WORKSPACE_QUOTA_MAX_ACTIVE_PER_DOMAIN = 64
const WORKSPACE_QUOTA_MAX_ACTIVE_GLOBAL = 4096
let workspaceQuotaHeartbeatTimer = null
const activeWorkspaceQuotaReservations = new Set()
const workspaceQuotaBackupActorsSynchronized = new Set()
/** @type {{ encryptionAtRest: boolean, encryptionAlgorithm: string, encryptionPasswordEnabled: boolean, encryptionPasswordSalt: string, passwordBinding: string, sqliteEncryption: boolean } | null} */
let activeEncryptionPolicy = null
let sealAfterWriteTimer = null
let sealInFlightPromise = null
let sealRequestedGeneration = 0
let sealCompletedGeneration = 0
let encryptedSqliteProcessLease = null
let storageServiceProcessLease = null
const focusedTeamProfileRecommenderCache = new Map()
const focusedTeamProfileRecommenderInFlight = new Map()
let focusedTeamProfileRecommenderCacheBytes = 0
let focusedTeamProfileRecommenderReadFailpoint = null
let focusedTeamProfileRecommenderCacheGeneration = 0
let focusedTeamProfileRecommenderPreparedStatements = null
const FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES = 768 * 1024
const FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_ENTRIES = 256
const FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_BYTES = 8 * 1024 * 1024
const FOCUSED_TEAM_RECOMMENDER_MAX_CAS_ATTEMPTS = 3
const FOCUSED_TEAM_RECOMMENDER_RETRY_AFTER_MS = 1_000
const focusedTeamProfileRecommenderCounters = {
  scalarReads: 0,
  cacheHits: 0,
  cacheMisses: 0,
  sliceReads: 0,
  parses: 0,
  casRetries: 0,
  cacheEvictions: 0,
  versionEvictions: 0,
  inFlightJoins: 0,
  inFlightRejected: 0,
  peakInFlight: 0,
}
function clearFocusedTeamProfileRecommenderCache({ resetCounters = false } = {}) {
  focusedTeamProfileRecommenderCacheGeneration += 1
  focusedTeamProfileRecommenderCache.clear()
  focusedTeamProfileRecommenderInFlight.clear()
  focusedTeamProfileRecommenderCacheBytes = 0
  focusedTeamProfileRecommenderPreparedStatements = null
  if (resetCounters) {
    for (const key of Object.keys(focusedTeamProfileRecommenderCounters)) {
      focusedTeamProfileRecommenderCounters[key] = 0
    }
  }
}
const storageShutdownContext = new AsyncLocalStorage()
const storeBaselineSymbol = Symbol('phd-atlas-store-baseline')
const storeTenantRevisionsSymbol = Symbol('phd-atlas-store-tenant-revisions')
const storeScopeSymbol = Symbol('phd-atlas-store-scope')
const storeMemoryLeaseSymbol = Symbol('phd-atlas-store-memory-lease')
// Enumerable Symbols survive ordinary object spreads while JSON/publicUser
// ignore them. This brands a bounded response projection so legacy write
// paths cannot mistake it for the account's complete durable settings row.
const focusedSessionProjectionSymbol = Symbol('phd-atlas-focused-session-projection')
const applicationPayloadVersionSymbol = Symbol('phd-atlas-application-payload-version')
const backupRestoreMemoryLeaseSymbol = Symbol('phd-atlas-backup-restore-memory-lease')
const backupInfoCache = new Map()
let backupListCacheGeneration = 0
let backupIndexDatabase = null
let backupIndexScan = null
let workspaceBackupDeletionDrain = Promise.resolve()
let activeDatabaseConfiguration = { type: 'sqlite', sqlitePath: databasePath }
let externalSyncTimer = null
let externalSyncPromise = null
let externalSyncFollowUpRequested = false
let lastExternalSyncedRevision = -1
let pendingExternalSyncPayload = null
let externalSyncConflict = null
let suppressExternalSync = false
let pendingDatabaseRevisionFloor = 0
let durableRevisionRequiresExternalFlush = false
let databaseConfigurationGeneration = 0
let externalSyncPromiseGeneration = -1
let externalSyncRetryAttempt = 0
let externalSyncNextRetryAt = null
let externalSyncLastSuccessAt = null
let externalSyncLastError = null
let externalSyncStatus = 'disabled'
let databaseHandleReplacementGate = null
const databaseHandleReplacementContext = new AsyncLocalStorage()
let databaseMaintenanceActive = false
let databaseMaintenanceGeneration = 0
const databaseMaintenanceContext = new AsyncLocalStorage()
const EXTERNAL_SYNC_RETRY_BASE_MS = 250
const EXTERNAL_SYNC_RETRY_MAX_MS = 30_000
const EXTERNAL_SYNC_DEBOUNCE_MS = normalizeExternalSyncDebounceMs()
const EXTERNAL_SQL_DUMP_IN_MEMORY_LIMIT_BYTES = 4 * 1024 * 1024
const SNAPSHOT_DATABASE_CONFIGURED_MAX_BYTES = normalizeSnapshotDatabaseMaxBytes()
const SNAPSHOT_RUNTIME_MEMORY_BUDGET_BYTES = resolveMemoryBudget({
  budgetBytes: process.env.RUNTIME_MEMORY_BUDGET_BYTES === undefined
    ? (process.env.NODE_ENV === 'test' ? 2 * 1024 * 1024 * 1024 : undefined)
    : Number(process.env.RUNTIME_MEMORY_BUDGET_BYTES),
}).bytes
const PUBLIC_SETUP_PENDING_STATE = 'pending-v1'
const PUBLIC_SETUP_COMPLETE_STATE = 'complete-v1'

function clearPendingExternalSyncPayload() {
  pendingExternalSyncPayload?.releaseMemory?.()
  pendingExternalSyncPayload = null
}

function clearPendingDatabaseImage({ release = true } = {}) {
  const image = pendingDatabaseImage
  const releaseMemory = pendingDatabaseImageReleaseMemory
  pendingDatabaseImage = null
  pendingDatabaseImageReleaseMemory = null
  if (release) releaseMemory?.()
  return { image, releaseMemory }
}

function sqliteImageForMemory(image) {
  // All call sites hand ownership of a freshly serialized/decrypted image to
  // the in-memory database. Mutating its two SQLite header bytes in place
  // avoids retaining a second whole-database copy during boot and re-key.
  const normalized = Buffer.isBuffer(image) ? image : Buffer.from(image)
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

export function sharedStoreCacheDiagnostics() {
  return {
    hydratedSnapshots: sharedStoreCacheHydrations,
    populated: Boolean(sharedStoreCache),
  }
}

export function scopedStoreHydrationDiagnostics() {
  return { hydratedSnapshots: scopedStoreHydrations }
}

export function configureStoreHydrationMemoryAdmission(acquire) {
  if (acquire !== null && typeof acquire !== 'function') {
    throw new TypeError('Store hydration memory admission must be a function or null.')
  }
  acquireStoreHydrationMemory = acquire
}

export function configureBackupRestoreMemoryAdmission(acquire) {
  if (acquire !== null && typeof acquire !== 'function') {
    throw new TypeError('Backup restore memory admission must be a function or null.')
  }
  acquireBackupRestoreMemory = acquire
}

const BACKUP_METADATA_SUFFIX = '.meta'
const BACKUP_STAGE_PREFIX = '.backup-stage-v1-'
const BACKUP_INDEX_FILE_NAME = '.backup-metadata-index.sqlite'
const BACKUP_INDEX_INFO_CACHE_LIMIT = 256
const BACKUP_INDEX_IO_CONCURRENCY = 8
const BACKUP_INDEX_SCAN_IO_CONCURRENCY = 32
const BACKUP_INDEX_LEGACY_BACKFILL_BATCH = 32
const BACKUP_INDEX_LEGACY_PREFIX_BYTES = 128 * 1024
export const BACKUP_LIST_DEFAULT_PAGE_SIZE = 10_000
export const BACKUP_LIST_MAX_PAGE_SIZE = 10_000
export const MAX_JSON_BACKUP_RESTORE_BYTES = 512 * 1024 * 1024
const MAX_ENCODED_JSON_BACKUP_RESTORE_BYTES = MAX_JSON_BACKUP_RESTORE_BYTES * 2
const BACKUP_RESTORE_MEMORY_MULTIPLIER = 6
const BACKUP_RESTORE_MEMORY_FIXED_BYTES = 16 * 1024 * 1024
const BACKUP_RESTORE_WITHOUT_ADMISSION_MAX_BYTES = 16 * 1024 * 1024
const WORKSPACE_BACKUP_LOCAL_IO_RESERVATION_BYTES = 16 * 1024 * 1024
const MIN_SESSION_MINUTES = 5
const MAX_SESSION_MINUTES = 43_200
const DEFAULT_USER_SESSION_MINUTES = 720
const DEFAULT_ADMIN_SESSION_MINUTES = 120
const DEFAULT_APPLICATION_QUOTA = 3
const DEFAULT_PRO_APPLICATION_QUOTA = 300
const MAX_APPLICATION_QUOTA = 10_000
const UNLIMITED_QUOTA_VALUE = -1
const DEFAULT_FREE_STORAGE_QUOTA_MB = 5
const DEFAULT_PRO_STORAGE_QUOTA_MB = 100
const MAX_STORAGE_QUOTA_MB = 102400
const configuredTeamStorageQuotaBytes = Number(process.env.PHD_ATLAS_TEAM_STORAGE_QUOTA_BYTES)
export const TEAM_STORAGE_QUOTA_BYTES = Number.isSafeInteger(configuredTeamStorageQuotaBytes)
  && configuredTeamStorageQuotaBytes >= 1024 * 1024
  && configuredTeamStorageQuotaBytes <= 1024 * 1024 * 1024 * 1024
  ? configuredTeamStorageQuotaBytes
  : 1024 * 1024 * 1024
const DEFAULT_FREE_SHARE_ACTIVE_QUOTA = 5
const DEFAULT_FREE_SHARE_CREATE_QUOTA = 5
const DEFAULT_PRO_SHARE_ACTIVE_QUOTA = 1000
const DEFAULT_PRO_SHARE_CREATE_QUOTA = 5000
const DEFAULT_SHARE_QUOTA = DEFAULT_FREE_SHARE_ACTIVE_QUOTA
const MAX_SCHOOL_LOGO_CACHE_ENTRIES = 512
const MAX_SCHOOL_LOGO_CACHE_DATA_URL_LENGTH = 1_400_000
// Stay below SQLite's historical 999-variable limit across supported builds.
export const SCHOOL_LOGO_ASSET_QUERY_BATCH_SIZE = 500
const SYSTEM_EVENT_WORKING_SET_LIMIT = 500
const MAX_SYSTEM_LOG_RETENTION_DAYS = 3650
const INTERVIEW_STORAGE_MAX_TOP_LEVEL_BYTES = 256 * 1024
const INTERVIEW_STORAGE_MAX_CHILD_BYTES = 1024 * 1024
const INTERVIEW_STORAGE_MAX_EVENTS = 500
const INTERVIEW_STORAGE_MAX_QUESTIONS = 5_000
const INTERVIEW_STORAGE_MAX_SESSIONS = 1_000
const INTERVIEW_STORAGE_MAX_FEEDBACK = 10_000
const INTERVIEW_STORAGE_ID_MAX_LENGTH = 128
export const MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER = 20
export const MAX_PENDING_CODEX_DEVICE_AUTHORIZATIONS = 2_000
export const CODEX_AUTHORIZATION_LAST_USED_INTERVAL_MS = 45 * 60 * 1000
export const CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS = 180 * 24 * 60 * 60 * 1000
export const CODEX_TELEMETRY_PERSIST_INTERVAL_MS = Math.min(
  60 * 60 * 1000,
  Math.max(
    5 * 60 * 1000,
    Math.floor(Number(process.env.CODEX_TELEMETRY_PERSIST_INTERVAL_MINUTES) || 15) * 60 * 1000,
  ),
)
const CODEX_AUTHORIZATION_LAST_USED_FLUSH_DELAY_MS = CODEX_TELEMETRY_PERSIST_INTERVAL_MS
const CODEX_AUTHORIZATION_LAST_USED_MAX_PENDING = Math.min(
  20_000,
  Math.max(
    256,
    Math.floor(Number(process.env.CODEX_AUTHORIZATION_LAST_USED_MAX_PENDING) || 4_096),
  ),
)
const CODEX_AUTHORIZATION_LAST_USED_FLUSH_BATCH_SIZE = 256
const pendingCodexAuthorizationLastUsed = new Map()
let codexAuthorizationLastUsedFlushTimer = null
let codexAuthorizationLastUsedFlushPromise = null
let codexTelemetryPersistPromise = null
let codexTelemetryDirty = false
let codexTelemetryMutationGeneration = 0
let securityDurableMutationGeneration = 0
let securityDurableAcknowledgedGeneration = 0
let securityDurableAckPromise = null
const durableStorageAckCounters = { attempts: 0, successes: 0, failures: 0 }
let durableStorageAcknowledgementFailpoint = null
let storageShutdownDurabilityFailpoint = null
let databaseConfigurationSealFailpoint = null
let storageInitializationFailpoint = null
let databaseHandleReplacementFailpoint = null
const codexAuthorizationLastUsedCounters = {
  queued: 0,
  coalesced: 0,
  flushes: 0,
  batches: 0,
  persisted: 0,
  discarded: 0,
  failures: 0,
}
export const CODEX_AUTHORIZATION_EXPIRY_DAY_OPTIONS = CODEX_AUTHORIZATION_EXPIRY_DAYS
const CODEX_AUTHORIZATION_SCOPE_SET = new Set(CODEX_AUTHORIZATION_SCOPES)
const CODEX_AUTHORIZATION_SCOPE_ORDER = new Map(
  CODEX_AUTHORIZATION_SCOPES.map((scope, index) => [scope, index]),
)
const MAX_CODEX_DEVICE_AUTHORIZATION_ROWS = 10_000
const CODEX_DEVICE_AUTHORIZATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const CODEX_AUTHORIZATION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS codex_authorizations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_selector TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    client_name TEXT NOT NULL DEFAULT '',
    client_version TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    scopes_json TEXT NOT NULL DEFAULT '[]',
    scope_version INTEGER NOT NULL DEFAULT 2 CHECK(scope_version IN (1, 2)),
    issued_auth_version INTEGER NOT NULL DEFAULT 0 CHECK(issued_auth_version >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    last_used_at TEXT,
    revoked_at TEXT,
    revoked_reason TEXT,
    disabled_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_codex_authorizations_user
    ON codex_authorizations(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_codex_authorizations_active
    ON codex_authorizations(user_id, revoked_at, expires_at);

  CREATE TABLE IF NOT EXISTS codex_device_authorizations (
    id TEXT PRIMARY KEY,
    device_code_hash TEXT NOT NULL UNIQUE,
    user_code_hash TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL DEFAULT '',
    client_version TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    requested_scopes_json TEXT NOT NULL DEFAULT '[]',
    requested_expires_in_days INTEGER NOT NULL DEFAULT 365
      CHECK(requested_expires_in_days IN (30, 90, 180, 365)),
    approved_scopes_json TEXT,
    approved_expires_in_days INTEGER
      CHECK(approved_expires_in_days IS NULL OR approved_expires_in_days IN (30, 90, 180, 365)),
    approved_name TEXT,
    scope_version INTEGER NOT NULL DEFAULT 2 CHECK(scope_version IN (1, 2)),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    poll_interval_seconds INTEGER NOT NULL DEFAULT 5
      CHECK(poll_interval_seconds >= 1 AND poll_interval_seconds <= 60),
    last_polled_at TEXT,
    poll_count INTEGER NOT NULL DEFAULT 0 CHECK(poll_count >= 0),
    approved_user_id TEXT,
    approved_auth_version INTEGER,
    approved_at TEXT,
    denied_by_user_id TEXT,
    denied_at TEXT,
    denial_reason TEXT,
    consumed_at TEXT,
    authorization_id TEXT,
    FOREIGN KEY(approved_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(denied_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(authorization_id) REFERENCES codex_authorizations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_codex_device_authorizations_expiry
    ON codex_device_authorizations(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_codex_device_authorizations_approved_user
    ON codex_device_authorizations(approved_user_id, created_at DESC);
`

function codexScopeVersionTableSql(database, tableName) {
  return database.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'table' AND name = ?`,
  ).get(tableName)?.sql ?? ''
}

function migrateCodexAuthorizationScopeVersionSchema(database) {
  const authorizationSql = codexScopeVersionTableSql(database, 'codex_authorizations')
  const deviceSql = codexScopeVersionTableSql(database, 'codex_device_authorizations')
  if (
    !authorizationSql
    || !deviceSql
    || !/\bCHECK\s*\(\s*scope_version\s*=\s*1\s*\)/i.test(authorizationSql + deviceSql)
  ) {
    return
  }
  const previousForeignKeys = Boolean(
    database.pragma('foreign_keys', { simple: true }),
  )
  database.pragma('foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.exec(`
        DROP INDEX IF EXISTS idx_codex_authorizations_user;
        DROP INDEX IF EXISTS idx_codex_authorizations_active;
        DROP INDEX IF EXISTS idx_codex_device_authorizations_expiry;
        DROP INDEX IF EXISTS idx_codex_device_authorizations_approved_user;
        ALTER TABLE codex_authorizations RENAME TO codex_authorizations_scope_v1;
        ALTER TABLE codex_device_authorizations RENAME TO codex_device_authorizations_scope_v1;
        ${CODEX_AUTHORIZATION_SCHEMA_SQL}
        INSERT INTO codex_authorizations (
          id, user_id, token_selector, token_hash, token_hint, name,
          client_name, client_version, device_name, scopes_json, scope_version,
          issued_auth_version, created_at, updated_at, expires_at,
          last_used_at, revoked_at, revoked_reason
        )
        SELECT
          id, user_id, token_selector, token_hash, token_hint, name,
          client_name, client_version, device_name, scopes_json, scope_version,
          issued_auth_version, created_at, updated_at, expires_at,
          last_used_at, revoked_at, revoked_reason
        FROM codex_authorizations_scope_v1;
        INSERT INTO codex_device_authorizations (
          id, device_code_hash, user_code_hash, client_name, client_version,
          device_name, requested_scopes_json, requested_expires_in_days,
          approved_scopes_json, approved_expires_in_days, approved_name,
          scope_version, status, created_at, expires_at, poll_interval_seconds,
          last_polled_at, poll_count, approved_user_id, approved_auth_version,
          approved_at, denied_by_user_id, denied_at, denial_reason,
          consumed_at, authorization_id
        )
        SELECT
          id, device_code_hash, user_code_hash, client_name, client_version,
          device_name, requested_scopes_json, requested_expires_in_days,
          approved_scopes_json, approved_expires_in_days, approved_name,
          scope_version, status, created_at, expires_at, poll_interval_seconds,
          last_polled_at, poll_count, approved_user_id, approved_auth_version,
          approved_at, denied_by_user_id, denied_at, denial_reason,
          consumed_at, authorization_id
        FROM codex_device_authorizations_scope_v1;
        DROP TABLE codex_authorizations_scope_v1;
        DROP TABLE codex_device_authorizations_scope_v1;
      `)
    })()
  } finally {
    database.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`)
  }
}

function migrateAiKeyConcurrencySchema(database) {
  const tableSql = codexScopeVersionTableSql(database, 'ai_api_keys')
  const limitMatch = tableSql.match(
    /\bCHECK\s*\(\s*max_concurrency\s+BETWEEN\s+1\s+AND\s+(\d+)\s*\)/i,
  )
  if (!limitMatch || Number(limitMatch[1]) >= AI_KEY_MAX_CONCURRENCY) return

  const previousForeignKeys = Boolean(database.pragma('foreign_keys', { simple: true }))
  database.pragma('foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE ai_api_keys_concurrency_v2500 (
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
          max_concurrency INTEGER NOT NULL DEFAULT 4
            CHECK(max_concurrency BETWEEN 1 AND ${AI_KEY_MAX_CONCURRENCY}),
          request_mode TEXT NOT NULL DEFAULT 'auto'
            CHECK(request_mode IN ('auto', 'responses', 'chat_completions')),
          selection_weight INTEGER NOT NULL DEFAULT 50
            CHECK(selection_weight BETWEEN ${AI_KEY_MIN_WEIGHT} AND ${AI_KEY_MAX_WEIGHT}),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
        INSERT INTO ai_api_keys_concurrency_v2500 (
          id, owner_id, team_id, scope, provider, label, model, base_url,
          api_key_encrypted, created_at, updated_at, last_used_at, call_count,
          input_tokens, output_tokens, total_tokens, usage_reset_at, max_concurrency,
          request_mode, selection_weight, enabled
        )
        SELECT
          id, owner_id, team_id, scope, provider, label, model, base_url,
          api_key_encrypted, created_at, updated_at, last_used_at, call_count,
          input_tokens, output_tokens, total_tokens, usage_reset_at, max_concurrency,
          request_mode, selection_weight, enabled
        FROM ai_api_keys;
        DROP TABLE ai_api_keys;
        ALTER TABLE ai_api_keys_concurrency_v2500 RENAME TO ai_api_keys;
        CREATE INDEX idx_ai_api_keys_owner ON ai_api_keys(owner_id, created_at DESC);
        CREATE INDEX idx_ai_api_keys_team ON ai_api_keys(team_id, created_at DESC);
      `)
    })()
  } finally {
    database.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`)
  }
}

const MAX_SHARE_QUOTA = 10_000
const DEFAULT_TRASH_RETENTION_DAYS = 30
const PLAN_QUOTA_VERSION = 2
const MAX_BACKUPS_PER_APP_LIMIT = 100
const DEMO_TEAM_ID = 'team_demo_phd_atlas'
const DEMO_TEAM_SEAT_LIMIT = 16
const DEMO_TEAM_MEMBER_ACCOUNTS = [
  {
    key: 'teacher',
    id: 'user_demo_teacher',
    name: 'Dr. Mei Chen',
    email: 'teacher@phd-atlas.local',
    teamRole: 'admin',
    contactProfile: {
      title: 'Director of Graduate Research',
      department: 'Department of Computer Science',
      phone: '+44 20 7946 0808',
      website: 'https://example.edu/mei-chen',
      office: 'Research Building 5.02',
      availability: 'Monday 13:00–15:00 · Application strategy, research statements, and supervisor outreach',
      bio: 'Leads graduate mentoring across trustworthy AI, robotics, and interdisciplinary computing.',
    },
  },
  {
    key: 'teacherB',
    id: 'user_demo_teacher_alex',
    name: 'Prof. Alex Rivera',
    email: 'teacher.alex@phd-atlas.local',
    teamRole: 'admin',
    contactProfile: {
      title: 'Professor of Human-Centred AI',
      department: 'School of Computing',
      phone: '+44 20 7946 0821',
      website: 'https://example.edu/alex-rivera',
      office: 'Innovation Building 4.18',
      availability: 'Tuesday 14:00–16:00 · Research-fit reviews, HCI portfolios, and interview preparation',
      bio: 'Works on human-AI collaboration, accessible systems, and responsible evaluation.',
    },
  },
  {
    key: 'teacherC',
    id: 'user_demo_teacher_sofia',
    name: 'Dr. Sofia Berg',
    email: 'teacher.sofia@phd-atlas.local',
    teamRole: 'admin',
    contactProfile: {
      title: 'Associate Professor of Computational Biology',
      department: 'Department of Life Sciences',
      phone: '+44 20 7946 0834',
      website: 'https://example.edu/sofia-berg',
      office: 'Bioinformatics Centre 2.11',
      availability: 'Wednesday 10:00–12:00 · Research proposals, methods design, and fellowship strategy',
      bio: 'Supervises interdisciplinary work in single-cell modelling, causal inference, and scientific machine learning.',
    },
  },
  {
    key: 'teacherD',
    id: 'user_demo_teacher_kwame',
    name: 'Dr. Kwame Mensah',
    email: 'teacher.kwame@phd-atlas.local',
    teamRole: 'admin',
    contactProfile: {
      title: 'Senior Lecturer in Sustainable Systems',
      department: 'Department of Engineering',
      phone: '+44 20 7946 0860',
      website: 'https://example.edu/kwame-mensah',
      office: 'Energy Lab 3.06',
      availability: 'Friday 09:30–11:30 · Funding plans, quantitative methods, and mock interviews',
      bio: 'Researches energy systems, climate adaptation, and decision-making under uncertainty.',
    },
  },
  {
    key: 'studentA',
    id: 'user_demo_student_lina',
    name: 'Lina Zhao',
    email: 'student.lina@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacher', 'teacherB'],
  },
  {
    key: 'studentB',
    id: 'user_demo_student_omar',
    name: 'Omar Patel',
    email: 'student.omar@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacher'],
  },
  {
    key: 'studentC',
    id: 'user_demo_student_hana',
    name: 'Hana Suzuki',
    email: 'student.hana@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacherB', 'teacherC'],
  },
  {
    key: 'studentD',
    id: 'user_demo_student_diego',
    name: 'Diego Morales',
    email: 'student.diego@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacher', 'teacherD'],
  },
  {
    key: 'studentE',
    id: 'user_demo_student_amina',
    name: 'Amina Okafor',
    email: 'student.amina@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacherC'],
  },
  {
    key: 'studentF',
    id: 'user_demo_student_minseo',
    name: 'Minseo Park',
    email: 'student.minseo@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacherB', 'teacherD'],
  },
  {
    key: 'studentG',
    id: 'user_demo_student_eva',
    name: 'Eva Müller',
    email: 'student.eva@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: ['teacher', 'teacherB', 'teacherC'],
  },
  {
    key: 'studentH',
    id: 'user_demo_student_noah',
    name: 'Noah Williams',
    email: 'student.noah@phd-atlas.local',
    teamRole: 'member',
    teacherKeys: [],
  },
]

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
  if (quota === UNLIMITED_QUOTA_VALUE) return UNLIMITED_QUOTA_VALUE
  return Math.min(MAX_SHARE_QUOTA, Math.max(1, Math.round(quota)))
}

function normalizeApplicationQuota(value) {
  const quota = Number(value ?? DEFAULT_APPLICATION_QUOTA)
  if (!Number.isFinite(quota)) return DEFAULT_APPLICATION_QUOTA
  if (quota === UNLIMITED_QUOTA_VALUE) return UNLIMITED_QUOTA_VALUE
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

const BUILT_IN_APPLICATION_STATUS_KEYS = new Set([
  'draft',
  'preparing',
  'submitted',
  'interview',
  'accepted',
  'rejected',
  'waitlist',
])

const BUILT_IN_CHECKLIST_STATUS_KEYS = new Set([
  'missing',
  'not started',
  'draft',
  'requested',
  'in progress',
  'waiting',
  'needs review',
  'ready',
  'needs revision',
  'submitted',
  'open',
  'done',
])

const BUILT_IN_CHECKLIST_MATERIAL_FORMAT_KEYS = new Set([
  'pdf',
  'docx',
  'spreadsheet',
  'presentation',
  'image',
  'online form',
  'link',
  'request',
  'other',
])

// Kept in step with src/mailClassification.ts and server/validation.js, which
// own the same limits for the request schema.
const CUSTOM_MAIL_CATEGORY_PREFIX = 'custom:'
const MAX_CUSTOM_MAIL_CATEGORIES = 24
const MAX_CUSTOM_MAIL_CATEGORY_ID_LENGTH = 64
const MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH = 40
const CUSTOM_MAIL_CATEGORY_TONES = new Set([
  'neutral', 'info', 'warning', 'success', 'danger', 'accent', 'purple',
])

function normalizeCustomApplicationStatuses(value) {
  if (!Array.isArray(value)) return []
  const statuses = []
  const seen = new Set()
  for (const candidate of value) {
    if (statuses.length >= 30) break
    if (typeof candidate !== 'string') continue
    const status = candidate.trim().replace(/\s+/g, ' ')
    const key = status.toLocaleLowerCase()
    if (
      !status
      || status.length > 64
      || BUILT_IN_APPLICATION_STATUS_KEYS.has(key)
      || seen.has(key)
    ) continue
    seen.add(key)
    statuses.push(status)
  }
  return statuses
}

function normalizeCustomChecklistStatuses(value) {
  if (!Array.isArray(value)) return []
  const statuses = []
  const seen = new Set()
  for (const candidate of value) {
    if (statuses.length >= 30) break
    if (typeof candidate !== 'string') continue
    const status = candidate.trim().replace(/\s+/g, ' ')
    const key = status.toLocaleLowerCase()
    if (
      !status
      || status.length > 64
      || BUILT_IN_CHECKLIST_STATUS_KEYS.has(key)
      || seen.has(key)
    ) continue
    seen.add(key)
    statuses.push(status)
  }
  return statuses
}

function normalizeCustomChecklistMaterialFormats(value) {
  if (!Array.isArray(value)) return []
  const formats = []
  const seen = new Set()
  for (const candidate of value) {
    if (formats.length >= 30) break
    if (typeof candidate !== 'string') continue
    const format = candidate.trim().replace(/\s+/g, ' ')
    const key = format.toLocaleLowerCase()
    if (
      !format
      || format.length > 64
      || BUILT_IN_CHECKLIST_MATERIAL_FORMAT_KEYS.has(key)
      || seen.has(key)
    ) continue
    seen.add(key)
    formats.push(format)
  }
  return formats
}

/**
 * This account's own correspondence categories. Ids are minted once from the
 * label and then frozen, so the projection must return them verbatim — never
 * re-derive one here.
 */
function normalizeCustomMailCategories(value) {
  if (!Array.isArray(value)) return []
  const categories = []
  const seenIds = new Set()
  const seenLabels = new Set()
  for (const candidate of value) {
    if (categories.length >= MAX_CUSTOM_MAIL_CATEGORIES) break
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
    const labelKey = label.toLocaleLowerCase()
    if (
      !id
      || !label
      || !id.startsWith(CUSTOM_MAIL_CATEGORY_PREFIX)
      || id.length > MAX_CUSTOM_MAIL_CATEGORY_ID_LENGTH
      || label.length > MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH
      || seenIds.has(id)
      || seenLabels.has(labelKey)
    ) continue
    seenIds.add(id)
    seenLabels.add(labelKey)
    categories.push({
      id,
      label,
      tone: CUSTOM_MAIL_CATEGORY_TONES.has(candidate.tone) ? candidate.tone : 'neutral',
    })
  }
  return categories
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

function normalizeStoredTeamProfileRecommenders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized = {}
  for (const [teamId, profiles] of Object.entries(value)) {
    const key = String(teamId ?? '').trim()
    if (!key || key.length > 160 || !Array.isArray(profiles)) continue
    // The authenticated Team endpoints apply the complete profile schema.
    // Storage only owns the internal namespace boundary and must not flatten
    // this map into the account's personal profileRecommenders collection.
    normalized[key] = profiles.slice(0, 100)
  }
  return normalized
}

export function normalizeUserRole(role) {
  return role === 'admin' ? 'admin' : 'user'
}

export function publicUser(user) {
  if (!user) {
    return null
  }

  const settings = normalizeUserSettings(user)
  // Every authenticated response carrying an account goes through here, so this
  // is the one place worth spending a check: a stored credential must never
  // leave the process. Masking used to depend on remembering to write it into
  // the projection by hand, which is the kind of thing that is correct until
  // someone adds the next secret.
  assertNoSecretValues(settings)
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeUserRole(user.role),
    disabledAt: user.disabledAt ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    settingsVersion: Math.max(0, Number(user.settingsVersion) || 0),
    settings,
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
    customApplicationStatuses: normalizeCustomApplicationStatuses(settings.customApplicationStatuses),
    customChecklistStatuses: normalizeCustomChecklistStatuses(settings.customChecklistStatuses),
    customChecklistMaterialFormats: normalizeCustomChecklistMaterialFormats(settings.customChecklistMaterialFormats),
    customMailCategories: normalizeCustomMailCategories(settings.customMailCategories),
    aiProfile,
    profilePresets: Array.isArray(settings.profilePresets) ? settings.profilePresets : undefined,
    profileRecommenders: Array.isArray(settings.profileRecommenders) ? settings.profileRecommenders : undefined,
  }
}

function toJson(value) {
  return JSON.stringify(value ?? {})
}

function contentFingerprint(value) {
  return createHash('sha256').update(toJson(value)).digest('hex')
}

function interviewStorageError(code, message, status = 400, details = {}) {
  const error = new Error(message)
  error.name = 'InterviewStorageError'
  error.code = code
  error.status = status
  Object.assign(error, details)
  return error
}

function normalizeInterviewStorageId(value, field, { nullable = false } = {}) {
  if ((value === undefined || value === null || value === '') && nullable) return null
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  if (
    !normalized
    || normalized.length > INTERVIEW_STORAGE_ID_MAX_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(normalized)
  ) {
    throw interviewStorageError(
      'INTERVIEW_WORKSPACE_INVALID',
      `${field} must be a safe, non-empty identifier.`,
      400,
      { field },
    )
  }
  return normalized
}

function normalizeInterviewStorageRevision(value, field = 'expectedRevision') {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw interviewStorageError(
      'INTERVIEW_WORKSPACE_INVALID',
      `${field} must be a non-negative safe integer.`,
      400,
      { field },
    )
  }
  return normalized
}

function canonicalInterviewStorageValue(value, seen = new WeakSet()) {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw interviewStorageError('INTERVIEW_WORKSPACE_INVALID', 'Interview content contains a non-finite number.')
    }
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw interviewStorageError('INTERVIEW_WORKSPACE_INVALID', 'Interview content cannot be circular.')
    }
    seen.add(value)
    const normalized = value.map((entry) => (
      entry === undefined ? null : canonicalInterviewStorageValue(entry, seen)
    ))
    seen.delete(value)
    return normalized
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw interviewStorageError('INTERVIEW_WORKSPACE_INVALID', 'Interview content must be JSON-compatible.')
  }
  if (seen.has(value)) {
    throw interviewStorageError('INTERVIEW_WORKSPACE_INVALID', 'Interview content cannot be circular.')
  }
  seen.add(value)
  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) normalized[key] = canonicalInterviewStorageValue(value[key], seen)
  }
  seen.delete(value)
  return normalized
}

function interviewStorageJson(value, maximumBytes, field) {
  const normalized = canonicalInterviewStorageValue(value)
  const json = JSON.stringify(normalized)
  if (Buffer.byteLength(json, 'utf8') > maximumBytes) {
    throw interviewStorageError(
      'INTERVIEW_WORKSPACE_TOO_LARGE',
      `${field} exceeds its encrypted storage limit.`,
      413,
      { field },
    )
  }
  return { normalized, json }
}

function interviewStorageTimestamp(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback
}

function interviewWorkspaceScope({ subjectUserId, teamId }) {
  const subject = normalizeInterviewStorageId(subjectUserId, 'subjectUserId')
  const team = normalizeInterviewStorageId(teamId, 'teamId', { nullable: true })
  const digest = createHash('sha256')
    .update(team ? `team\0${team}\0${subject}` : `personal\0${subject}`)
    .digest('hex')
  return { subjectUserId: subject, teamId: team, scopeKey: `interview:${digest}` }
}

function normalizeInterviewWorkspaceCollection(value, field, maximum, validate) {
  if (value === undefined || value === null) value = []
  if (!Array.isArray(value)) {
    throw interviewStorageError(
      'INTERVIEW_WORKSPACE_INVALID',
      `${field} must be an array.`,
      400,
      { field },
    )
  }
  if (value.length > maximum) {
    throw interviewStorageError(
      'INTERVIEW_WORKSPACE_TOO_LARGE',
      `${field} contains too many records.`,
      413,
      { field },
    )
  }
  const ids = new Set()
  return value.map((entry, position) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw interviewStorageError(
        'INTERVIEW_WORKSPACE_INVALID',
        `${field}[${position}] must be an object.`,
        400,
        { field: `${field}[${position}]` },
      )
    }
    const id = normalizeInterviewStorageId(entry.id, `${field}[${position}].id`)
    if (ids.has(id)) {
      throw interviewStorageError(
        'INTERVIEW_WORKSPACE_INVALID',
        `${field} contains duplicate identifier ${id}.`,
        400,
        { field },
      )
    }
    ids.add(id)
    const checked = validate ? validate(entry, position, id) : entry
    const payload = interviewStorageJson(checked, INTERVIEW_STORAGE_MAX_CHILD_BYTES, `${field}[${position}]`)
    return {
      id,
      position,
      value: payload.normalized,
      payloadJson: payload.json,
      createdAt: interviewStorageTimestamp(checked.createdAt, '1970-01-01T00:00:00.000Z'),
      updatedAt: interviewStorageTimestamp(checked.updatedAt, '1970-01-01T00:00:00.000Z'),
    }
  })
}

function normalizeInterviewWorkspaceForStorage(workspace, scope) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw interviewStorageError('INTERVIEW_WORKSPACE_INVALID', 'workspace must be an object.')
  }
  if (
    workspace.subjectUserId !== undefined
    && normalizeInterviewStorageId(workspace.subjectUserId, 'workspace.subjectUserId') !== scope.subjectUserId
  ) {
    throw interviewStorageError(
      'INTERVIEW_WORKSPACE_SCOPE_MISMATCH',
      'The workspace subject does not match the requested scope.',
      400,
    )
  }
  if (workspace.teamId !== undefined) {
    const workspaceTeamId = normalizeInterviewStorageId(workspace.teamId, 'workspace.teamId', { nullable: true })
    if (workspaceTeamId !== scope.teamId) {
      throw interviewStorageError(
        'INTERVIEW_WORKSPACE_SCOPE_MISMATCH',
        'The workspace team does not match the requested scope.',
        400,
      )
    }
  }

  const events = normalizeInterviewWorkspaceCollection(
    workspace.interviews,
    'workspace.interviews',
    INTERVIEW_STORAGE_MAX_EVENTS,
    (entry, position) => {
      if (
        entry.ownerUserId !== undefined
        && normalizeInterviewStorageId(entry.ownerUserId, `workspace.interviews[${position}].ownerUserId`) !== scope.subjectUserId
      ) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_SCOPE_MISMATCH',
          'An interview event belongs to a different subject.',
          400,
        )
      }
      if (entry.teamId !== undefined) {
        const eventTeamId = normalizeInterviewStorageId(
          entry.teamId,
          `workspace.interviews[${position}].teamId`,
          { nullable: true },
        )
        if (eventTeamId !== scope.teamId) {
          throw interviewStorageError(
            'INTERVIEW_WORKSPACE_SCOPE_MISMATCH',
            'An interview event belongs to a different team.',
            400,
          )
        }
      }
      return { ...entry, ownerUserId: scope.subjectUserId, teamId: scope.teamId }
    },
  )
  const eventIds = new Set(events.map((entry) => entry.id))

  const questions = normalizeInterviewWorkspaceCollection(
    workspace.questions,
    'workspace.questions',
    INTERVIEW_STORAGE_MAX_QUESTIONS,
    (entry, position) => {
      const interviewId = normalizeInterviewStorageId(
        entry.interviewId,
        `workspace.questions[${position}].interviewId`,
      )
      if (!eventIds.has(interviewId)) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_RELATION_INVALID',
          'An interview question references an unknown interview event.',
          400,
        )
      }
      return entry
    },
  )
  const questionIds = new Set(questions.map((entry) => entry.id))

  const sessions = normalizeInterviewWorkspaceCollection(
    workspace.mockSessions,
    'workspace.mockSessions',
    INTERVIEW_STORAGE_MAX_SESSIONS,
    (entry, position) => {
      const interviewId = normalizeInterviewStorageId(
        entry.interviewId,
        `workspace.mockSessions[${position}].interviewId`,
      )
      if (!eventIds.has(interviewId)) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_RELATION_INVALID',
          'A mock session references an unknown interview event.',
          400,
        )
      }
      if (Array.isArray(entry.questionIds)) {
        for (const [index, rawQuestionId] of entry.questionIds.entries()) {
          const questionId = normalizeInterviewStorageId(
            rawQuestionId,
            `workspace.mockSessions[${position}].questionIds[${index}]`,
          )
          if (!questionIds.has(questionId)) {
            throw interviewStorageError(
              'INTERVIEW_WORKSPACE_RELATION_INVALID',
              'A mock session references an unknown interview question.',
              400,
            )
          }
        }
      }
      if (
        entry.ownerUserId !== undefined
        && normalizeInterviewStorageId(entry.ownerUserId, `workspace.mockSessions[${position}].ownerUserId`) !== scope.subjectUserId
      ) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_SCOPE_MISMATCH',
          'A mock session belongs to a different subject.',
          400,
        )
      }
      return { ...entry, ownerUserId: scope.subjectUserId }
    },
  )
  const sessionIds = new Set(sessions.map((entry) => entry.id))

  const feedback = normalizeInterviewWorkspaceCollection(
    workspace.feedback,
    'workspace.feedback',
    INTERVIEW_STORAGE_MAX_FEEDBACK,
    (entry, position) => {
      const interviewId = normalizeInterviewStorageId(
        entry.interviewId,
        `workspace.feedback[${position}].interviewId`,
      )
      if (!eventIds.has(interviewId)) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_RELATION_INVALID',
          'Interview feedback references an unknown interview event.',
          400,
        )
      }
      const sessionId = normalizeInterviewStorageId(
        entry.sessionId,
        `workspace.feedback[${position}].sessionId`,
        { nullable: true },
      )
      const questionId = normalizeInterviewStorageId(
        entry.questionId,
        `workspace.feedback[${position}].questionId`,
        { nullable: true },
      )
      if (sessionId && !sessionIds.has(sessionId)) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_RELATION_INVALID',
          'Interview feedback references an unknown mock session.',
          400,
        )
      }
      if (questionId && !questionIds.has(questionId)) {
        throw interviewStorageError(
          'INTERVIEW_WORKSPACE_RELATION_INVALID',
          'Interview feedback references an unknown interview question.',
          400,
        )
      }
      return entry
    },
  )

  const {
    interviews: _interviews,
    questions: _questions,
    mockSessions: _mockSessions,
    feedback: _feedback,
    revision: _revision,
    updatedAt: _updatedAt,
    subjectUserId: _subjectUserId,
    teamId: _teamId,
    ...authoredMetadata
  } = workspace
  const metadata = interviewStorageJson(
    authoredMetadata,
    INTERVIEW_STORAGE_MAX_TOP_LEVEL_BYTES,
    'workspace metadata',
  )
  const fingerprintSource = {
    metadata: metadata.normalized,
    interviews: events.map((entry) => entry.value),
    questions: questions.map((entry) => entry.value),
    mockSessions: sessions.map((entry) => entry.value),
    feedback: feedback.map((entry) => entry.value),
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalInterviewStorageValue(fingerprintSource)))
    .digest('hex')
  return { metadata, events, questions, sessions, feedback, fingerprint }
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
  return new Map((items ?? []).map((item) => [item.id, contentFingerprint(item)]))
}

function objectFieldBaseline(value) {
  return new Map(Object.entries(value ?? {}).map(([key, fieldValue]) => [
    key,
    contentFingerprint(fieldValue),
  ]))
}

function userMergeBaselines(users) {
  return new Map((users ?? []).map((user) => [user.id, {
    fields: objectFieldBaseline(user),
    settings: objectFieldBaseline(user.settings),
  }]))
}

function captureStoreBaseline(store) {
  return {
    revision: normalizeWorkspaceRevision(store.meta?.revision),
    meta: contentFingerprint(authoredStoreMeta(store.meta)),
    tenantRevisions: new Map(storeTenantRevisions(store)),
    settings: contentFingerprint(store.settings),
    users: entityBaseline(store.users),
    userMerge: userMergeBaselines(store.users),
    applications: entityBaseline(store.applications),
    profileAssets: entityBaseline(store.profileAssets),
    systemEvents: entityBaseline(store.systemEvents),
  }
}

function attachStoreBaseline(store, baseline = null) {
  Object.defineProperty(store, storeBaselineSymbol, {
    configurable: true,
    enumerable: false,
    value: baseline ?? captureStoreBaseline(store),
  })
  return store
}

function authoredStoreMeta(meta) {
  const {
    adapter: _adapter,
    revision: _revision,
    updatedAt: _updatedAt,
    ...authored
  } = meta ?? {}
  return authored
}

function attachStoreTenantRevisions(store, revisions) {
  Object.defineProperty(store, storeTenantRevisionsSymbol, {
    configurable: true,
    enumerable: false,
    value: revisions instanceof Map ? revisions : new Map(),
  })
  return store
}

function storeTenantRevisions(store) {
  return store?.[storeTenantRevisionsSymbol] instanceof Map
    ? store[storeTenantRevisionsSymbol]
    : new Map()
}

function attachStoreScope(store, scope, releaseMemory = null) {
  Object.defineProperty(store, storeScopeSymbol, {
    configurable: true,
    enumerable: false,
    value: scope,
  })
  if (typeof releaseMemory === 'function') {
    Object.defineProperty(store, storeMemoryLeaseSymbol, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: releaseMemory,
    })
  }
  return store
}

export function takeStoreMemoryLease(store) {
  const release = store?.[storeMemoryLeaseSymbol]
  if (store && typeof release === 'function') {
    store[storeMemoryLeaseSymbol] = null
  }
  return typeof release === 'function' ? release : null
}

function attachBackupRestoreMemoryLease(result, release) {
  if (!result || typeof result !== 'object' || typeof release !== 'function') return result
  const safetyTimer = setTimeout(release, 5 * 60_000)
  safetyTimer.unref?.()
  let settled = false
  Object.defineProperty(result, backupRestoreMemoryLeaseSymbol, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: () => {
      if (settled) return
      settled = true
      clearTimeout(safetyTimer)
      release()
    },
  })
  return result
}

export function takeBackupRestoreMemoryLease(result) {
  const release = result?.[backupRestoreMemoryLeaseSymbol]
  if (result && typeof release === 'function') result[backupRestoreMemoryLeaseSymbol] = null
  return typeof release === 'function' ? release : null
}

function entityWritePlan(items, baselineItems = null) {
  const fullReconcile = !(baselineItems instanceof Map)
  const previous = fullReconcile ? new Map() : baselineItems
  const nextFingerprints = fullReconcile ? new Map() : new Map(previous)
  const currentIds = new Set()
  const upserts = []

  for (const item of items ?? []) {
    const id = item?.id
    currentIds.add(id)
    const fingerprint = contentFingerprint(item)
    if (fullReconcile || previous.get(id) !== fingerprint) {
      upserts.push(item)
      nextFingerprints.set(id, fingerprint)
    }
  }

  const deletedIds = []
  if (!fullReconcile) {
    for (const id of previous.keys()) {
      if (currentIds.has(id)) continue
      deletedIds.push(id)
      nextFingerprints.delete(id)
    }
  }

  return { upserts, deletedIds, nextFingerprints }
}

function createStoreWritePlan(store) {
  const baseline = store?.[storeBaselineSymbol]
  const scopedStore = Boolean(store?.[storeScopeSymbol])
  const metaFingerprint = contentFingerprint(authoredStoreMeta(store.meta))
  const metaChanged = !baseline || baseline.meta !== metaFingerprint
  const settingsChanged = !baseline || contentFingerprint(store.settings) !== baseline.settings
  const differentialUsers = entityWritePlan(store.users, baseline?.users)
  // User removal has broad legacy Team/invitation/FK semantics. Keep that rare
  // administrator path on the established full reconcile until it can be
  // migrated independently; ordinary user updates and additions remain diffed.
  const fullReconcile = !baseline || (!scopedStore && differentialUsers.deletedIds.length > 0)
  const settingsFingerprint = contentFingerprint(store.settings)
  const users = fullReconcile ? entityWritePlan(store.users) : differentialUsers
  const applications = entityWritePlan(store.applications, fullReconcile ? null : baseline.applications)
  const profileAssets = entityWritePlan(store.profileAssets, fullReconcile ? null : baseline.profileAssets)
  const systemEvents = entityWritePlan(
    (store.systemEvents ?? []).slice(0, SYSTEM_EVENT_WORKING_SET_LIMIT),
    fullReconcile ? null : baseline.systemEvents,
  )
  const tenantKeys = new Set()
  const expectedTenantRevisions = new Map()
  const trackTenantKey = (entity, entityType) => {
    const tenantKey = tenantKeyForEntity(entity, entityType)
    if (tenantKey) tenantKeys.add(tenantKey)
  }
  if (fullReconcile) {
    for (const user of store.users ?? []) trackTenantKey(user, 'user')
    for (const team of store.teams ?? []) trackTenantKey(team, 'team')
    for (const application of store.applications ?? []) {
      trackTenantKey(application, 'application')
    }
    for (const profileAsset of store.profileAssets ?? []) {
      trackTenantKey(profileAsset, 'profileAsset')
    }
  } else {
    for (const user of users.upserts) trackTenantKey(user, 'user')
    for (const id of users.deletedIds) trackTenantKey({ id }, 'user')
    for (const application of applications.upserts) {
      trackTenantKey(application, 'application')
    }
    for (const profileAsset of profileAssets.upserts) {
      trackTenantKey(profileAsset, 'profileAsset')
    }
  }
  if (settingsChanged) tenantKeys.add(tenantKeyForSettings())
  for (const tenantKey of tenantKeys) {
    if (baseline?.tenantRevisions?.has(tenantKey)) {
      expectedTenantRevisions.set(tenantKey, baseline.tenantRevisions.get(tenantKey))
    }
  }

  return {
    fullReconcile,
    expectedRevision: baseline ? normalizeWorkspaceRevision(baseline.revision) : null,
    expectedTenantRevisions,
    tenantKeys,
    metaChanged,
    settingsChanged,
    users,
    applications,
    profileAssets,
    systemEvents,
    nextBaseline: {
      revision: fullReconcile ? 0 : normalizeWorkspaceRevision(baseline.revision),
      meta: metaFingerprint,
      tenantRevisions: new Map(baseline?.tenantRevisions ?? []),
      settings: settingsFingerprint,
      users: users.nextFingerprints,
      userMerge: userMergeBaselines(store.users),
      applications: applications.nextFingerprints,
      profileAssets: profileAssets.nextFingerprints,
      systemEvents: systemEvents.nextFingerprints,
    },
  }
}

function storeWritePlanHasChanges(writePlan) {
  if (writePlan.fullReconcile || writePlan.metaChanged || writePlan.settingsChanged) return true
  return [
    writePlan.users,
    writePlan.applications,
    writePlan.profileAssets,
    writePlan.systemEvents,
  ].some((plan) => plan.upserts.length > 0 || plan.deletedIds.length > 0)
}

function assertStoreDoesNotWriteFocusedSessionProjection(store, writePlan) {
  const storeScope = store?.[storeScopeSymbol]
  const compactWorkspaceUsers = storeScope?.selector?.compactWorkspaceUsers === true
  const changedFocusedUsers = writePlan.users.upserts.filter(
    (user) => user?.[focusedSessionProjectionSymbol] === true,
  )
  const changesCompactAccountState = compactWorkspaceUsers && (
    writePlan.settingsChanged
    || writePlan.users.upserts.length > 0
    || writePlan.users.deletedIds.length > 0
  )
  if (!changesCompactAccountState && changedFocusedUsers.length === 0) return

  const error = new Error(
    'A focused session projection cannot be written as complete account or system settings.',
  )
  error.status = 500
  error.code = 'FOCUSED_SESSION_PROJECTION_WRITE_FORBIDDEN'
  throw error
}

function extendWritePlanTenantKeysForDeletes(database, writePlan) {
  const tenantKeys = writePlan.tenantKeys
  const expectedTenantRevisions = writePlan.expectedTenantRevisions
  const addTenantKey = (tenantKey) => {
    if (!tenantKey) return
    tenantKeys.add(tenantKey)
    if (!expectedTenantRevisions.has(tenantKey)) {
      expectedTenantRevisions.set(tenantKey, readDurableTenantRevision(database, tenantKey))
    }
  }
  const applicationRows = writePlan.fullReconcile
    ? database.prepare('SELECT id, owner_id, team_id FROM applications').all()
    : writePlan.applications.deletedIds.map((id) => (
        database.prepare('SELECT id, owner_id, team_id FROM applications WHERE id = ?').get(id)
      )).filter(Boolean)
  for (const row of applicationRows) {
    addTenantKey(row.team_id ? `team:${row.team_id}` : row.owner_id ? `user:${row.owner_id}` : null)
  }
  const profileRows = writePlan.fullReconcile
    ? database.prepare('SELECT id, owner_id, team_id FROM profile_assets').all()
    : writePlan.profileAssets.deletedIds.map((id) => (
        database.prepare('SELECT id, owner_id, team_id FROM profile_assets WHERE id = ?').get(id)
      )).filter(Boolean)
  for (const row of profileRows) {
    addTenantKey(row.team_id ? `team:${row.team_id}` : row.owner_id ? `user:${row.owner_id}` : null)
  }
}

function storeWriteConflict(entityType, entityId = null) {
  const target = entityId ? `${entityType} ${entityId}` : entityType
  const error = new Error(`The ${target} changed while this request was being processed.`)
  error.status = 409
  error.code = 'STORE_WRITE_CONFLICT'
  error.entityType = entityType
  error.entityId = entityId
  return error
}

function storeRevisionConflict(expectedRevision, currentRevision, tenantKey = null) {
  const error = storeWriteConflict(tenantKey ? `workspace tenant revision ${tenantKey}` : 'workspace revision')
  error.expectedRevision = expectedRevision
  error.currentRevision = currentRevision
  if (tenantKey) error.tenantKey = tenantKey
  return error
}

function mergeEntityChanges(entityType, latestItems, proposedItems, baselineItems) {
  const merged = new Map((latestItems ?? []).map((item) => [item.id, item]))
  const latest = new Map((latestItems ?? []).map((item) => [item.id, item]))
  const proposed = new Map((proposedItems ?? []).map((item) => [item.id, item]))

  for (const [id, baselineFingerprint] of baselineItems) {
    const latestItem = latest.get(id)
    const proposedItem = proposed.get(id)
    const latestFingerprint = latestItem === undefined ? null : contentFingerprint(latestItem)
    const proposedFingerprint = proposedItem === undefined ? null : contentFingerprint(proposedItem)
    const latestChanged = latestFingerprint !== baselineFingerprint
    const proposedChanged = proposedFingerprint !== baselineFingerprint

    // A request may only apply its stale entity when the durable copy still
    // matches the baseline it read. Identical concurrent outcomes are already
    // converged; divergent updates, including update-vs-delete, must be retried.
    if (latestChanged && proposedChanged) {
      if (latestFingerprint === proposedFingerprint) continue
      throw storeWriteConflict(entityType, id)
    }
    if (!proposedChanged) continue
    if (proposedItem === undefined) merged.delete(id)
    else merged.set(id, proposedItem)
  }

  for (const [id, item] of proposed) {
    if (baselineItems.has(id)) continue
    if (latest.has(id)) {
      if (contentFingerprint(latest.get(id)) === contentFingerprint(item)) continue
      throw storeWriteConflict(entityType, id)
    }
    merged.set(id, item)
  }
  return Array.from(merged.values())
}

function mergeObjectFields({
  entityType,
  entityId,
  latest,
  proposed,
  baselineFields,
  preferredProposedKeys = new Set(),
  mergeField = null,
}) {
  if (!(baselineFields instanceof Map)) throw storeWriteConflict(entityType, entityId)
  const merged = { ...latest }
  const keys = new Set([
    ...baselineFields.keys(),
    ...Object.keys(latest ?? {}),
    ...Object.keys(proposed ?? {}),
  ])
  for (const key of keys) {
    const baselineFingerprint = baselineFields.get(key) ?? null
    const latestHas = Object.hasOwn(latest ?? {}, key)
    const proposedHas = Object.hasOwn(proposed ?? {}, key)
    const latestFingerprint = latestHas ? contentFingerprint(latest[key]) : null
    const proposedFingerprint = proposedHas ? contentFingerprint(proposed[key]) : null
    const latestChanged = latestFingerprint !== baselineFingerprint
    const proposedChanged = proposedFingerprint !== baselineFingerprint
    if (latestChanged && proposedChanged && latestFingerprint !== proposedFingerprint) {
      if (typeof mergeField === 'function') {
        const fieldResult = mergeField(key, latest[key], proposed[key])
        if (fieldResult?.handled) {
          if (fieldResult.present === false) delete merged[key]
          else merged[key] = fieldResult.value
          continue
        }
      }
      if (!preferredProposedKeys.has(key)) throw storeWriteConflict(entityType, entityId)
    }
    if (!proposedChanged) continue
    if (proposedHas) merged[key] = proposed[key]
    else delete merged[key]
  }
  return merged
}

function mergeUserChanges(latestItems, proposedItems, baselineItems, baselineUserMerge) {
  if (!(baselineUserMerge instanceof Map)) {
    return mergeEntityChanges('user', latestItems, proposedItems, baselineItems)
  }
  const merged = new Map((latestItems ?? []).map((item) => [item.id, item]))
  const latest = new Map((latestItems ?? []).map((item) => [item.id, item]))
  const proposed = new Map((proposedItems ?? []).map((item) => [item.id, item]))

  for (const [id, baselineFingerprint] of baselineItems) {
    const latestItem = latest.get(id)
    const proposedItem = proposed.get(id)
    const latestFingerprint = latestItem === undefined ? null : contentFingerprint(latestItem)
    const proposedFingerprint = proposedItem === undefined ? null : contentFingerprint(proposedItem)
    const latestChanged = latestFingerprint !== baselineFingerprint
    const proposedChanged = proposedFingerprint !== baselineFingerprint
    if (latestChanged && proposedChanged && latestFingerprint !== proposedFingerprint) {
      if (!latestItem || !proposedItem) throw storeWriteConflict('user', id)
      const baseline = baselineUserMerge.get(id)
      const mergedUser = mergeObjectFields({
        entityType: 'user',
        entityId: id,
        latest: latestItem,
        proposed: proposedItem,
        baselineFields: baseline?.fields,
        mergeField: (key, latestValue, proposedValue) => {
          if (key !== 'settings') return null
          return {
            handled: true,
            present: true,
            value: mergeObjectFields({
              entityType: 'user settings',
              entityId: id,
              latest: latestValue,
              proposed: proposedValue,
              baselineFields: baseline?.settings,
              // This nonce is a server-issued receipt for the mutation which
              // currently owns the write lock, not authored account state.
              // A later disjoint PATCH must publish its own receipt after
              // retaining the earlier committed fields.
              preferredProposedKeys: new Set(['settingsMutationNonce']),
            }),
          }
        },
      })
      merged.set(id, mergedUser)
      continue
    }
    if (!proposedChanged) continue
    if (proposedItem === undefined) merged.delete(id)
    else merged.set(id, proposedItem)
  }

  for (const [id, item] of proposed) {
    if (baselineItems.has(id)) continue
    if (latest.has(id)) {
      if (contentFingerprint(latest.get(id)) === contentFingerprint(item)) continue
      throw storeWriteConflict('user', id)
    }
    merged.set(id, item)
  }
  return Array.from(merged.values())
}

function mergeSettingsChanges(latestSettings, proposedSettings, baselineFingerprint) {
  const proposedFingerprint = contentFingerprint(proposedSettings)
  const proposedChanged = proposedFingerprint !== baselineFingerprint
  if (!proposedChanged) return latestSettings
  const latestFingerprint = contentFingerprint(latestSettings)
  if (latestFingerprint !== baselineFingerprint && latestFingerprint !== proposedFingerprint) {
    throw storeWriteConflict('settings')
  }
  return proposedSettings
}

function mergeSystemEventChanges(latestItems, proposedItems) {
  const merged = new Map((latestItems ?? []).map((item) => [item.id, item]))
  for (const item of proposedItems ?? []) {
    if (!merged.has(item.id)) merged.set(item.id, item)
  }
  return Array.from(merged.values())
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, SYSTEM_EVENT_WORKING_SET_LIMIT)
}

function appendSystemEventsUnlocked(database, events) {
  const insertEvent = database.prepare(
    `INSERT OR IGNORE INTO system_events (
      id,
      time,
      scope,
      actor_id,
      message,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const event of events ?? []) {
    insertEvent.run(
      event.id,
      event.time,
      event.scope,
      event.actorId ?? null,
      event.message,
      toJson(event.metadata ?? {}),
    )
  }
}

function mergeStoreChanges(latest, proposed, baseline) {
  return {
    ...latest,
    settings: mergeSettingsChanges(latest.settings, proposed.settings, baseline.settings),
    users: mergeUserChanges(
      latest.users,
      proposed.users,
      baseline.users,
      baseline.userMerge,
    )
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    applications: mergeEntityChanges('application', latest.applications, proposed.applications, baseline.applications)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline))),
    profileAssets: mergeEntityChanges('profile asset', latest.profileAssets, proposed.profileAssets, baseline.profileAssets)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    systemEvents: mergeSystemEventChanges(latest.systemEvents, proposed.systemEvents),
  }
}

function boolInt(value) {
  return value ? 1 : 0
}

function intBool(value) {
  return Boolean(value)
}

export function normalizeSystemLogRetentionDays(value) {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return null
  const numeric = Number(value)
  if (!Number.isInteger(numeric)) return null
  return Math.min(MAX_SYSTEM_LOG_RETENTION_DAYS, Math.max(1, numeric))
}

function systemLogRetentionCutoff(value, now = Date.now()) {
  const days = normalizeSystemLogRetentionDays(value)
  if (days === null) return null
  return new Date(now - (days * 24 * 60 * 60 * 1000)).toISOString()
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
  const requested = String(fileName ?? '')
  const normalized = path.basename(requested)
  if (
    !normalized
    || normalized !== requested
    || !isBackupArchiveName(normalized)
    || normalized.endsWith('.meta')
  ) {
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

function backupStagePath(fileName) {
  const backup = resolveBackupFile(fileName)
  const digest = createHash('sha256').update(backup.fileName, 'utf8').digest('hex')
  return path.join(backupRoot, `${BACKUP_STAGE_PREFIX}${digest}`)
}

function backupStageMetadataPath(fileName) {
  return `${backupStagePath(fileName)}${BACKUP_METADATA_SUFFIX}`
}

function isBackupStageEntry(fileName) {
  return typeof fileName === 'string'
    && fileName.startsWith(BACKUP_STAGE_PREFIX)
    && /^[a-f0-9]{64}$/u.test(fileName.slice(BACKUP_STAGE_PREFIX.length))
}

function isBackupStageMetadataEntry(fileName) {
  return fileName.endsWith(BACKUP_METADATA_SUFFIX)
    && isBackupStageEntry(fileName.slice(0, -BACKUP_METADATA_SUFFIX.length))
}

function closeOpenDatabase() {
  // A database handle defines the authority boundary for every version-bound
  // focused slice. Clear that state even when the resident handle is already
  // absent: archive restore, encryption-mode handoff, and failed startup can
  // replace the underlying source with identical user/team/version keys.
  clearFocusedTeamProfileRecommenderCache()
  if (!db) return
  databaseHandleGeneration += 1
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

function configuredSnapshotStorageMode(settings = activeEncryptionPolicy) {
  if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
    return 'external-whole-snapshot'
  }
  if (settings?.sqliteEncryption && settings?.encryptionAtRest) {
    return 'encrypted-sqlite-whole-snapshot'
  }
  return 'plain-local-sqlite'
}

function residentSnapshotStorageMode() {
  const configured = configuredSnapshotStorageMode()
  if (configured !== 'plain-local-sqlite') return configured
  // During startup and the one-time disable transition the settings policy may
  // not yet describe the already-open anonymous SQLite image. Keep its cap in
  // place until that image has been durably materialized as ordinary SQLite.
  return databaseRunsInMemory
    ? 'encrypted-sqlite-whole-snapshot'
    : configured
}

function snapshotModeEnabled(mode) {
  return mode !== 'plain-local-sqlite'
}

function snapshotCapacityPlan(
  mode = residentSnapshotStorageMode(),
  settings = activeEncryptionPolicy,
) {
  return resolveSnapshotCapacityPlan({
    mode,
    encrypted: mode === 'external-whole-snapshot' && Boolean(settings?.encryptionAtRest),
    configuredLimitBytes: SNAPSHOT_DATABASE_CONFIGURED_MAX_BYTES,
    runtimeMemoryBudgetBytes: SNAPSHOT_RUNTIME_MEMORY_BUDGET_BYTES,
  })
}

function applySnapshotStoragePageLimit(
  database,
  mode = residentSnapshotStorageMode(),
  settings = activeEncryptionPolicy,
) {
  const plan = snapshotCapacityPlan(mode, settings)
  assertSnapshotCapacityPlan(plan)
  return applySqliteSnapshotPageLimit(database, {
    mode,
    enabled: snapshotModeEnabled(mode),
    limitBytes: plan.effectiveLimitBytes ?? SNAPSHOT_DATABASE_CONFIGURED_MAX_BYTES,
  })
}

function assertDatabaseSnapshotCapacity(
  database,
  mode = residentSnapshotStorageMode(),
  settings = activeEncryptionPolicy,
) {
  const metrics = sqliteSnapshotMetrics(database)
  const plan = snapshotCapacityPlan(mode, settings)
  assertSnapshotCapacityPlan(plan)
  if (!snapshotModeEnabled(mode) || metrics.currentBytes <= plan.effectiveLimitBytes) {
    return metrics
  }
  throw snapshotCapacityError({
    mode,
    limitBytes: plan.effectiveLimitBytes,
    currentBytes: metrics.currentBytes,
  })
}

function snapshotStorageDiagnostics() {
  const mode = residentSnapshotStorageMode()
  const enabled = snapshotModeEnabled(mode)
  let metrics = null
  let maxPageCount = null
  if (db) {
    try {
      metrics = sqliteSnapshotMetrics(db)
      maxPageCount = Number(db.pragma('max_page_count', { simple: true }))
    } catch {
      // Startup diagnostics remain available even if schema/opening failed.
    }
  }
  const encryptedExternal = mode === 'external-whole-snapshot'
    && Boolean(activeEncryptionPolicy?.encryptionAtRest)
  const plan = snapshotCapacityPlan(mode, activeEncryptionPolicy)
  const effectiveLimitBytes = enabled && metrics?.pageSize
    ? Math.floor(plan.effectiveLimitBytes / metrics.pageSize) * metrics.pageSize
    : plan.effectiveLimitBytes
  return {
    mode,
    strategy: enabled ? 'whole-database-snapshot' : 'incremental-local-sqlite',
    enabled,
    configuredLimitBytes: enabled ? plan.configuredLimitBytes : null,
    limitBytes: enabled ? effectiveLimitBytes : null,
    effectiveLimitBytes: enabled ? effectiveLimitBytes : null,
    currentBytes: metrics?.currentBytes ?? null,
    pageCount: metrics?.pageCount ?? null,
    pageSize: metrics?.pageSize ?? null,
    maxPageCount,
    payloadLimitBytes: mode === 'external-whole-snapshot'
      ? (encryptedExternal
          ? externalEncryptedPayloadMaxBytes(effectiveLimitBytes)
          : effectiveLimitBytes)
      : mode === 'encrypted-sqlite-whole-snapshot'
        ? sqliteSealedPayloadMaxBytes(effectiveLimitBytes)
        : null,
    memoryBudgetBytes: plan.memoryBudgetBytes,
    safeMemoryBytes: plan.safeMemoryBytes,
    requiredMemoryBytes: plan.requiredMemoryBytes,
    effectiveRequiredMemoryBytes: plan.effectiveRequiredMemoryBytes,
    memoryMultiplier: plan.memoryMultiplier,
    memoryConstrained: plan.memoryConstrained,
    minimumRequiredMemoryBytes: plan.minimumRequiredMemoryBytes,
    supported: plan.supported,
    highScaleRecommended: !enabled,
  }
}

function activateDatabaseConfiguration(configuration, { lastSyncedRevision = -1 } = {}) {
  clearFocusedTeamProfileRecommenderCache()
  activeDatabaseConfiguration = configuration
  databaseConfigurationGeneration += 1
  lastExternalSyncedRevision = normalizeWorkspaceRevision(lastSyncedRevision)
  if (lastSyncedRevision < 0) lastExternalSyncedRevision = -1
  clearPendingExternalSyncPayload()
  externalSyncConflict = null
  externalSyncFollowUpRequested = false
  externalSyncRetryAttempt = 0
  externalSyncNextRetryAt = null
  externalSyncLastSuccessAt = null
  externalSyncLastError = null
  externalSyncStatus = isExternalDatabaseConfiguration(configuration) ? 'idle' : 'disabled'
}

function databaseMaintenanceError() {
  const error = new Error('The workspace database is switching or being restored. Retry this operation shortly.')
  error.code = 'DATABASE_MAINTENANCE'
  error.status = 503
  error.retryAfterSeconds = 1
  return error
}

function storageLifecycleError(
  message = 'The workspace storage is stopping. Retry after the server has restarted.',
  code = 'STORAGE_SHUTTING_DOWN',
) {
  const error = new Error(message)
  error.code = code
  error.status = 503
  error.retryAfterSeconds = 1
  return error
}

function assertDatabaseMutationAllowed() {
  const shutdownOwner = storageShutdownContext.getStore() === true
  if (storageShuttingDown && !shutdownOwner) throw storageLifecycleError()
  if (!storageReadyPromise && !shutdownOwner) {
    throw storageLifecycleError('The workspace storage has been shut down.', 'STORAGE_SHUTDOWN')
  }
  if (!storageServiceProcessLease?.valid) {
    const error = new Error('The storage service lease is not held; this worker can no longer write.')
    error.code = 'STORAGE_SERVICE_LEASE_LOST'
    error.status = 503
    throw error
  }
  if (!encryptedSqliteProcessLease?.valid) {
    const error = new Error('The SQLite process lease is not held; this worker can no longer write.')
    error.code = 'SQLITE_PROCESS_LEASE_LOST'
    error.status = 503
    throw error
  }
  const owner = databaseMaintenanceContext.getStore()
  const maintenanceOwner = owner?.generation === databaseMaintenanceGeneration
  if (externalSyncConflict && isExternalDatabaseConfiguration(activeDatabaseConfiguration) && !maintenanceOwner) {
    const error = new Error('External database synchronization is quarantined. Resolve or switch the database before writing.')
    error.code = 'DATABASE_EXTERNAL_SYNC_QUARANTINED'
    error.status = 503
    error.causeCode = externalSyncConflict.code
    throw error
  }
  if (!databaseMaintenanceActive || maintenanceOwner) return
  throw databaseMaintenanceError()
}

function assertDatabaseAccessAllowed() {
  const shutdownOwner = storageShutdownContext.getStore() === true
  if (storageShuttingDown && !shutdownOwner) throw storageLifecycleError()
  if (!storageReadyPromise && !shutdownOwner) {
    throw storageLifecycleError('The workspace storage has been shut down.', 'STORAGE_SHUTDOWN')
  }
  if (!storageServiceProcessLease?.valid) {
    const error = new Error('The storage service lease is not held; this worker is no longer authoritative.')
    error.code = 'STORAGE_SERVICE_LEASE_LOST'
    error.status = 503
    throw error
  }
  if (!encryptedSqliteProcessLease?.valid) {
    const error = new Error('The SQLite process lease is not held; this worker is no longer authoritative.')
    error.code = 'SQLITE_PROCESS_LEASE_LOST'
    error.status = 503
    throw error
  }
}

export function externalDatabaseSyncDiagnostics() {
  return {
    generation: databaseConfigurationGeneration,
    inFlightGeneration: externalSyncPromise ? externalSyncPromiseGeneration : null,
    adapter: currentDatabaseAdapter(),
    status: externalSyncStatus,
    debounceMs: EXTERNAL_SYNC_DEBOUNCE_MS,
    lastSyncedRevision: lastExternalSyncedRevision,
    pendingRevision: pendingExternalSyncPayload?.revision ?? null,
    retryAttempt: externalSyncRetryAttempt,
    nextRetryAt: externalSyncNextRetryAt,
    lastSuccessAt: externalSyncLastSuccessAt,
    lastError: externalSyncLastError ? { ...externalSyncLastError } : null,
    quarantined: Boolean(externalSyncConflict),
    maintenance: databaseMaintenanceActive,
    snapshotStorage: snapshotStorageDiagnostics(),
  }
}

export function getDatabaseConfiguration() {
  return publicDatabaseConfiguration(activeDatabaseConfiguration)
}

async function writeSnapshotFile(target, payload) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
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

export async function recoverOrCleanInterruptedSqliteSeals({
  targetPath = sealedDatabasePath,
  hexKey = deriveSqliteKey(),
} = {}) {
  const directory = path.dirname(targetPath)
  const prefixes = [
    `${path.basename(targetPath)}.tmp-`,
    `${path.basename(targetPath)}.previous-`,
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
  const hasSealedDatabase = await sealedSqliteExists(targetPath)
  const sealedMtimeMs = hasSealedDatabase
    ? (await fs.stat(targetPath)).mtimeMs
    : Number.NEGATIVE_INFINITY
  let targetAuthenticated = false
  if (hasSealedDatabase) {
    try {
      await verifySealedSqliteFile(targetPath, hexKey)
      targetAuthenticated = true
    } catch {
      // A valid recovery candidate may still replace an interrupted target.
    }
  }
  const newest = (await Promise.all(candidates.map(async (target) => ({
    target,
    mtimeMs: (await fs.stat(target)).mtimeMs,
  })))).sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const candidate of newest) {
    if (targetAuthenticated && candidate.mtimeMs <= sealedMtimeMs) break
    try {
      await verifySealedSqliteFile(candidate.target, hexKey)
    } catch {
      // Try the next authenticated recovery snapshot.
      continue
    }
    try {
      await promoteSealedSqliteFile(candidate.target, targetPath, hexKey)
      targetAuthenticated = true
      break
    } catch {
      // Preserve every candidate when promotion itself fails. A later restart
      // can retry without losing the only authenticated database image.
      return
    }
  }
  if (!targetAuthenticated) return
  await Promise.all(candidates.map((target) => fs.rm(target, { force: true }).catch(() => undefined)))
}

export function encodeExternalStatePayload(payload, policy = activeEncryptionPolicy) {
  return encodeExternalEnvelope(payload, policy)
}

function backupEncryptionPolicyForSettings(settings) {
  return {
    encryptionAtRest: Boolean(settings?.encryptionAtRest),
    encryptionAlgorithm: normalizeAlgorithm(settings?.encryptionAlgorithm),
    passwordBinding: settings?.encryptionPasswordEnabled ? String(settings.encryptionPasswordHash || '') : '',
  }
}

export async function rewriteBackupEncryption(policy, { fileNames = null } = {}) {
  await fs.mkdir(backupRoot, { recursive: true })
  const requestedFiles = Array.isArray(fileNames)
    ? new Set(fileNames.map((fileName) => resolveBackupFile(fileName).fileName))
    : null
  const pendingDeletions = new Set(getDb().prepare(
    'SELECT file_name FROM workspace_backup_deletions',
  ).all().map((row) => row.file_name))
  const quotaUpdates = []
  const entries = await fs.readdir(backupRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !isBackupArchiveName(entry.name) || entry.name.endsWith('.meta')) continue
    if (requestedFiles && !requestedFiles.has(entry.name)) continue
    // Account/ordinary deletion owns this exact archive identity. Rewriting it
    // would change size/mtime after the durable intent and could make cleanup
    // permanently fail its identity check. The write lock serializes new
    // intents with settings re-encryption; startup has no request concurrency.
    if (pendingDeletions.has(entry.name)) continue
    const target = path.join(backupRoot, entry.name)
    const inspection = await inspectBackupFile(target)
    const wantsEncryption = Boolean(policy?.encryptionAtRest)
    const beforeStat = await fs.stat(target)
    let sidecar = null
    try {
      sidecar = JSON.parse(await fs.readFile(backupMetadataPath(entry.name), 'utf8'))
    } catch {
      // Legacy plaintext application backups did not always have sidecars.
    }
    if (!sidecar && entry.name.endsWith('.json') && !inspection.encrypted) {
      try {
        const parsed = JSON.parse(await fs.readFile(target, 'utf8'))
        sidecar = {
          metadata: parsed?.backup ?? null,
          applicationName: parsed?.backup?.applicationName ?? parsed?.application?.school?.name ?? null,
        }
      } catch {
        // Invalid legacy files remain untouched by metadata repair.
      }
    }

    const alreadyDesired = (!wantsEncryption && !inspection.encrypted) || (
      wantsEncryption
      && inspection.encrypted
      && inspection.profile?.algorithm === policy.encryptionAlgorithm
      && inspection.profile?.passwordBinding === String(policy.passwordBinding || '')
    )
    if (alreadyDesired) {
      if (
        sidecar?.metadata
        && (sidecar.sourceSize !== beforeStat.size || sidecar.sourceMtimeMs !== beforeStat.mtimeMs)
      ) {
        await writeBackupMetadata(entry.name, beforeStat, sidecar.metadata, sidecar.applicationName)
        invalidateBackupListCache(entry.name)
      }
      if (sidecar?.metadata?.actorId) {
        quotaUpdates.push(backupInfoFromMetadata(
          entry.name,
          beforeStat,
          sidecar.metadata,
          sidecar.applicationName,
        ))
      }
      continue
    }

    const result = await rewrapBackupFile(target, policy)
    if (!result.changed) continue
    const stat = await fs.stat(target)
    if (sidecar?.metadata) {
      await writeBackupMetadata(entry.name, stat, sidecar.metadata, sidecar.applicationName)
      if (sidecar.metadata.actorId) {
        quotaUpdates.push(backupInfoFromMetadata(
          entry.name,
          stat,
          sidecar.metadata,
          sidecar.applicationName,
        ))
      }
    }
    invalidateBackupListCache(entry.name)
  }
  if (quotaUpdates.length > 0) {
    const database = getDb()
    const sourceExists = database.prepare(
      `SELECT 1 FROM workspace_quota_sources
        WHERE source_kind = 'backup' AND source_id = ? LIMIT 1`,
    )
    database.transaction(() => {
      for (const backup of quotaUpdates) {
        if (sourceExists.get(backup.fileName)) syncWorkspaceQuotaBackup(database, backup)
      }
    }).immediate()
  }
  invalidateBackupListCache()
}

const INTERRUPTED_BACKUP_ARTIFACT_STALE_MS = 15 * 60 * 1000
const INTERRUPTED_BACKUP_FILE_PATTERNS = [
  /^phd-atlas-(?:backup|app)-.+\.(?:tar\.gz|json)(?:\.meta)?\.tmp-\d+-(?:\d+(?:-[a-f0-9]+)?|[a-f0-9]{8}-[a-f0-9-]{27})$/i,
  /^phd-atlas-(?:backup|app)-.+\.(?:tar\.gz|json)(?:\.meta)?\.previous-\d+-\d+$/i,
  /^\.workspace-archive-\d+-\d+-[a-f0-9-]+\.tar\.gz$/i,
  /^\.durable-rewrap\.(?:plain|tmp)-\d+-\d+-[a-f0-9]+$/i,
  /^\.restore-application-\d+-\d+-[a-f0-9-]+\.json$/i,
]
const INTERRUPTED_BACKUP_DIRECTORY_PATTERNS = [
  /^\.staging-workspace-\d+-.+$/,
  /^\.restore-workspace-\d+-\d+$/,
  /^\.pre-restore-\d+-\d+$/,
]

function backupArtifactOwnerPid(fileName) {
  const match = fileName.match(/(?:\.tmp-|\.plain-|\.previous-|archive-|workspace-|restore-application-)(\d+)-/)
  return match ? Number(match[1]) : null
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Remove only old, strictly named unpublished artifacts inside backupRoot. */
export async function cleanupInterruptedBackupArtifacts({
  now = Date.now(),
  staleAfterMs = INTERRUPTED_BACKUP_ARTIFACT_STALE_MS,
  rootPath,
} = {}) {
  const root = process.env.NODE_ENV === 'test' && rootPath
    ? path.resolve(rootPath)
    : path.resolve(backupRoot)
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  let removed = 0
  for (const entry of entries) {
    const matches = entry.isDirectory()
      ? INTERRUPTED_BACKUP_DIRECTORY_PATTERNS.some((pattern) => pattern.test(entry.name))
      : entry.isFile() && INTERRUPTED_BACKUP_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))
    if (!matches) continue
    if (processIsAlive(backupArtifactOwnerPid(entry.name))) continue
    const target = path.resolve(root, entry.name)
    if (path.dirname(target) !== root) continue
    let stat
    try {
      stat = await fs.stat(target)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (now - stat.mtimeMs < staleAfterMs) continue
    const previousMatch = entry.isFile() && entry.name.match(/^(.*)\.previous-\d+-\d+$/)
    if (previousMatch) {
      const original = path.resolve(root, previousMatch[1])
      if (path.dirname(original) !== root) continue
      if (await pathExists(original)) {
        await fs.rm(target, { force: true })
      } else {
        await fs.rename(target, original)
      }
      removed += 1
      continue
    }
    await fs.rm(target, { recursive: entry.isDirectory(), force: true })
    removed += 1
  }
  return removed
}

const WORKSPACE_REVISION_TABLE = 'workspace_revision'
const WORKSPACE_REVISION_ROW_ID = 1
const WORKSPACE_TENANT_REVISION_TABLE = 'workspace_tenant_revisions'
const MAX_WORKSPACE_REVISION = Number.MAX_SAFE_INTEGER

function normalizeWorkspaceRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

function normalizeWorkspaceTenantRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

export function tenantKeyForUser(user) {
  return user?.id ? `user:${user.id}` : null
}

export function tenantKeyForTeam(team) {
  return team?.id ? `team:${team.id}` : null
}

export function tenantKeyForApplication(application) {
  if (!application?.id) return null
  if (application.teamId) return `team:${application.teamId}`
  return application.ownerId ? `user:${application.ownerId}` : null
}

export function tenantKeyForProfileAsset(profileAsset) {
  if (!profileAsset?.id) return null
  if (profileAsset.teamId) return `team:${profileAsset.teamId}`
  return profileAsset.ownerId ? `user:${profileAsset.ownerId}` : null
}

export function tenantKeyForSettings() {
  return 'system'
}

export function tenantKeyForEntity(entity, entityType = null) {
  if (!entity || typeof entity !== 'object') return null
  switch (entityType) {
    case 'user': return tenantKeyForUser(entity)
    case 'team': return tenantKeyForTeam(entity)
    case 'application': return tenantKeyForApplication(entity)
    case 'profileAsset': return tenantKeyForProfileAsset(entity)
    case 'settings': return tenantKeyForSettings()
    default: {
      if (
        Object.hasOwn(entity, 'passwordHash')
        || Object.hasOwn(entity, 'canonicalEmail')
        || Object.hasOwn(entity, 'email')
      ) {
        return tenantKeyForUser(entity)
      }
      if (entity.teamId) return `team:${entity.teamId}`
      if (entity.seatLimit || Object.hasOwn(entity, 'teacherGroups')) {
        return tenantKeyForTeam(entity)
      }
      if (entity.ownerId) return `user:${entity.ownerId}`
      return null
    }
  }
}

function readDurableTenantRevision(database, tenantKey) {
  const row = database
    .prepare(`SELECT revision FROM ${WORKSPACE_TENANT_REVISION_TABLE} WHERE tenant_key = ?`)
    .get(tenantKey)
  return row ? normalizeWorkspaceTenantRevision(row.revision) : 0
}

function readDurableTenantRevisions(database, tenantKeys) {
  const revisions = new Map()
  for (const tenantKey of tenantKeys ?? []) {
    revisions.set(tenantKey, readDurableTenantRevision(database, tenantKey))
  }
  return revisions
}

function durableTenantRevisionsMatch(database, expectedRevisions) {
  for (const [tenantKey, expectedRevision] of expectedRevisions) {
    if (readDurableTenantRevision(database, tenantKey) !== expectedRevision) return false
  }
  return true
}

export async function readDurableTenantRevisionsForKeys(tenantKeys) {
  await ensureStorage()
  return readDurableTenantRevisions(getDb(), tenantKeys)
}

function bumpDurableTenantRevision(database, tenantKey) {
  if (readDurableTenantRevision(database, tenantKey) >= MAX_WORKSPACE_REVISION) {
    throw new Error(`The durable tenant revision for ${tenantKey} has reached its safe integer limit.`)
  }
  database
    .prepare(
      `INSERT INTO ${WORKSPACE_TENANT_REVISION_TABLE} (tenant_key, revision)
       VALUES (?, 1)
       ON CONFLICT(tenant_key) DO UPDATE SET revision = revision + 1`,
    )
    .run(tenantKey)
  return readDurableTenantRevision(database, tenantKey)
}

const durableWorkspaceRevisionStatements = new WeakMap()
const legacyWorkspaceRevisionStatements = new WeakMap()

function legacyWorkspaceRevision(database) {
  try {
    let statement = legacyWorkspaceRevisionStatements.get(database)
    if (!statement) {
      statement = database.prepare('SELECT value FROM app_meta WHERE key = ?')
      legacyWorkspaceRevisionStatements.set(database, statement)
    }
    const row = statement.get('version')
    return normalizeWorkspaceRevision(fromJson(row?.value, null)?.revision)
  } catch {
    return 0
  }
}

function readDurableWorkspaceRevision(database) {
  try {
    let statement = durableWorkspaceRevisionStatements.get(database)
    if (!statement) {
      statement = database.prepare(`SELECT revision FROM ${WORKSPACE_REVISION_TABLE} WHERE id = ?`)
      durableWorkspaceRevisionStatements.set(database, statement)
    }
    const row = statement.get(WORKSPACE_REVISION_ROW_ID)
    if (row) return normalizeWorkspaceRevision(row.revision)
  } catch {
    // Legacy snapshots do not have the dedicated clock until getDb() migrates
    // them. Keep the previous app_meta value as the one-time floor.
  }
  return legacyWorkspaceRevision(database)
}

export async function readWorkspaceRevision() {
  await ensureStorage()
  return readDurableWorkspaceRevision(getDb())
}

function workspaceTenantRevisionFingerprint(revisions) {
  return contentFingerprint(
    [...(revisions instanceof Map ? revisions : new Map())]
      .map(([tenantKey, revision]) => [
        String(tenantKey ?? ''),
        normalizeWorkspaceTenantRevision(revision),
      ])
      .filter(([tenantKey]) => Boolean(tenantKey))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

/**
 * Revision identity for the workspace projection visible to this scoped store.
 *
 * The database-wide revision also moves for operational journals such as mail
 * delivery, notification handoff, and quota reservations. Those rows are not
 * part of a workspace bootstrap and must never invalidate a multi-megabyte
 * stream. Tenant revisions move only with authored user, Team, settings,
 * application, and profile changes, which is the exact boundary the stream
 * needs to validate.
 */
export function workspaceStoreRevisionFingerprint(store) {
  return workspaceTenantRevisionFingerprint(storeTenantRevisions(store))
}

/** Re-read the same scoped tenant clocks without hydrating any workspace row. */
export async function readCurrentWorkspaceStoreRevisionFingerprint(store) {
  await ensureStorage()
  const tenantKeys = [...storeTenantRevisions(store).keys()]
  return workspaceTenantRevisionFingerprint(readDurableTenantRevisions(getDb(), tenantKeys))
}

function bumpDurableWorkspaceRevision(database) {
  if (readDurableWorkspaceRevision(database) >= MAX_WORKSPACE_REVISION) {
    throw new Error('The durable workspace revision has reached its safe integer limit.')
  }
  const result = database
    .prepare(`UPDATE ${WORKSPACE_REVISION_TABLE} SET revision = revision + 1 WHERE id = ?`)
    .run(WORKSPACE_REVISION_ROW_ID)
  if (Number(result.changes ?? 0) !== 1) {
    throw new Error('The durable workspace revision row is missing.')
  }
  return readDurableWorkspaceRevision(database)
}

function advanceDurableWorkspaceRevisionPast(database, revisionFloor) {
  const transaction = database.transaction(() => {
    const current = readDurableWorkspaceRevision(database)
    if (Math.max(current, normalizeWorkspaceRevision(revisionFloor)) >= MAX_WORKSPACE_REVISION) {
      throw new Error('The durable workspace revision has reached its safe integer limit.')
    }
    const next = Math.max(current, normalizeWorkspaceRevision(revisionFloor)) + 1
    const result = database
      .prepare(`UPDATE ${WORKSPACE_REVISION_TABLE} SET revision = ? WHERE id = ?`)
      .run(next, WORKSPACE_REVISION_ROW_ID)
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error('The durable workspace revision row is missing.')
    }
    return next
  })
  return transaction()
}

function mirrorWorkspaceRevisionInMeta(database, revision, updatedAt = nowStamp()) {
  const row = database.prepare('SELECT value FROM app_meta WHERE key = ?').get('version')
  const meta = {
    ...fromJson(row?.value, {}),
    adapter: currentDatabaseAdapter(),
    revision,
    updatedAt,
  }
  database
    .prepare(
      `INSERT INTO app_meta (key, value)
       VALUES ('version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(toJson(meta))
  return meta
}

function prepareRestoredWorkspaceDatabase(sqlitePath, revisionFloor, securityContext = {}) {
  const restored = new Database(sqlitePath)
  let capacityDiagnostics = null
  try {
    capacityDiagnostics = applySnapshotStoragePageLimit(restored)
    restored.pragma('foreign_keys = ON')
    const schemaVersion = Number(restored.pragma('schema_version', { simple: true }))
    // A backup can predate Codex authorization support. Install the isolated
    // credential tables in the staged image before it is ever published to the
    // live file or an external database, then invalidate every restorable
    // bearer credential. This closes the rollback window where an old backup
    // could otherwise resurrect a token that was revoked after the backup.
    restored.exec(CODEX_AUTHORIZATION_SCHEMA_SQL)
    migrateCodexAuthorizationScopeVersionSchema(restored)
    initializeDurableWorkspaceRevision(restored, schemaVersion, revisionFloor)
    const revokedAt = nowStamp()
    const resetSecurityState = restored.transaction(() => {
      const revoked = restored.prepare(
        `UPDATE codex_authorizations
         SET revoked_at = ?, revoked_reason = 'workspace_restore', updated_at = ?
         WHERE revoked_at IS NULL`,
      ).run(revokedAt, revokedAt)
      const discarded = restored.prepare(
        `DELETE FROM codex_device_authorizations
         WHERE status IN ('pending', 'approved')`,
      ).run()
      restored.prepare(
        `INSERT INTO system_events (
          id, time, scope, actor_id, message, metadata_json
        ) VALUES (?, ?, 'Codex authorization', ?, 'Revoked Codex authorizations after workspace restore', ?)
        ON CONFLICT(id) DO UPDATE SET
          time = excluded.time,
          actor_id = excluded.actor_id,
          metadata_json = excluded.metadata_json`,
      ).run(
        securityContext.eventId ?? createId('event'),
        revokedAt,
        securityContext.actorId ?? null,
        toJson({
          reason: 'workspace_restore',
          backupFileName: securityContext.fileName ?? null,
          revokedCount: Number(revoked.changes ?? 0),
          discardedDeviceAuthorizationCount: Number(discarded.changes ?? 0),
        }),
      )
    })
    resetSecurityState.immediate()
    const revision = advanceDurableWorkspaceRevisionPast(restored, revisionFloor)
    mirrorWorkspaceRevisionInMeta(restored, revision)
    try { restored.pragma('wal_checkpoint(TRUNCATE)') } catch { /* rollback journal has no WAL */ }
    return revision
  } catch (error) {
    throw normalizeSqliteFullAsSnapshotCapacity(error, capacityDiagnostics)
  } finally {
    restored.close()
  }
}

function quoteSqliteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function installWorkspaceRevisionTriggers(database) {
  // Audit log rows and automatic-backup bookkeeping are maintenance output,
  // not workspace data. Bumping the global workspace revision for every
  // logged event or internal state row made background schedulers invalidate
  // every connected workspace snapshot, so a single-user instance with active
  // automatic backups could never finish a bootstrap stream.
  const revisionTriggerExcludedTables = new Set([
    'system_events',
    'system_event_maintenance',
    'automatic_backup_state',
    WORKSPACE_REVISION_TABLE,
    WORKSPACE_TENANT_REVISION_TABLE,
  ])
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
  const statements = []
  for (const { name } of tables) {
    if (revisionTriggerExcludedTables.has(name)) {
      // A database that already installed triggers for these tables must drop
      // them; CREATE TRIGGER IF NOT EXISTS alone cannot remove the old ones.
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        statements.push(
          `DROP TRIGGER IF EXISTS ${quoteSqliteIdentifier(
            `phd_atlas_revision_${name}_${operation.toLowerCase()}_v1`,
          )};`,
        )
      }
      continue
    }
    const table = quoteSqliteIdentifier(name)
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const rowAlias = operation === 'DELETE' ? 'OLD' : 'NEW'
      const when = name === 'app_meta'
        ? operation === 'UPDATE'
          ? "WHEN OLD.key <> 'version' OR NEW.key <> 'version'"
          : `WHEN ${rowAlias}.key <> 'version'`
        : ''
      const trigger = quoteSqliteIdentifier(`phd_atlas_revision_${name}_${operation.toLowerCase()}_v1`)
      statements.push(
        `CREATE TRIGGER IF NOT EXISTS ${trigger}
         AFTER ${operation} ON ${table}
         ${when}
         BEGIN
           UPDATE ${WORKSPACE_REVISION_TABLE}
           SET revision = revision + 1
           WHERE id = ${WORKSPACE_REVISION_ROW_ID};
         END;`,
      )
    }
  }
  if (statements.length) database.exec(statements.join('\n'))
}

function initializeDurableWorkspaceRevision(database, schemaVersionBefore, revisionFloor = 0) {
  const floor = Math.max(legacyWorkspaceRevision(database), normalizeWorkspaceRevision(revisionFloor))
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${WORKSPACE_REVISION_TABLE} (
       id INTEGER PRIMARY KEY CHECK (id = ${WORKSPACE_REVISION_ROW_ID}),
       revision INTEGER NOT NULL CHECK (revision >= 0 AND revision <= ${MAX_WORKSPACE_REVISION})
     );`,
  )
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${WORKSPACE_TENANT_REVISION_TABLE} (
       tenant_key TEXT PRIMARY KEY,
       revision INTEGER NOT NULL DEFAULT 0
         CHECK (revision >= 0 AND revision <= ${MAX_WORKSPACE_REVISION})
     );`,
  )
  const existing = database
    .prepare(`SELECT revision FROM ${WORKSPACE_REVISION_TABLE} WHERE id = ?`)
    .get(WORKSPACE_REVISION_ROW_ID)
  let revisionStateChanged = false
  if (!existing) {
    database
      .prepare(`INSERT INTO ${WORKSPACE_REVISION_TABLE} (id, revision) VALUES (?, ?)`)
      .run(WORKSPACE_REVISION_ROW_ID, floor)
    revisionStateChanged = true
  } else if (normalizeWorkspaceRevision(existing.revision) < floor) {
    database
      .prepare(`UPDATE ${WORKSPACE_REVISION_TABLE} SET revision = ? WHERE id = ?`)
      .run(floor, WORKSPACE_REVISION_ROW_ID)
    revisionStateChanged = true
  }
  installWorkspaceRevisionTriggers(database)
  const schemaVersionAfter = Number(database.pragma('schema_version', { simple: true }))
  if (revisionStateChanged || schemaVersionAfter !== schemaVersionBefore) {
    return { revision: bumpDurableWorkspaceRevision(database), changed: true }
  }
  return { revision: readDurableWorkspaceRevision(database), changed: false }
}

async function captureLocalDatabaseSnapshotUntracked() {
  if (databaseRunsInMemory && db) {
    assertDatabaseSnapshotCapacity(db)
    const revision = readDurableWorkspaceRevision(db)
    const releaseMemory = acquireStoreSnapshotMemory(db)
    try {
      const payload = db.serialize()
      return { payload, revision, releaseMemory }
    } catch (error) {
      releaseMemory?.()
      throw error
    }
  }
  await fs.mkdir(storageRoot, { recursive: true })
  const snapshotPath = path.join(storageRoot, `.database-snapshot-${process.pid}-${Date.now()}.sqlite`)
  try {
    const liveDatabase = getDb()
    assertDatabaseSnapshotCapacity(liveDatabase)
    const snapshotHandleGeneration = databaseHandleGeneration
    try {
      await liveDatabase.backup(snapshotPath)
    } catch (error) {
      if (databaseHandleGeneration !== snapshotHandleGeneration || !liveDatabase.open) {
        error.code = 'DATABASE_HANDLE_SUPERSEDED'
      }
      throw error
    }
    const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true })
    let revision
    let releaseMemory
    try {
      revision = readDurableWorkspaceRevision(snapshot)
      releaseMemory = acquireStoreSnapshotMemory(snapshot)
    } finally {
      snapshot.close()
    }
    try {
      const payload = await fs.readFile(snapshotPath)
      return { payload, revision, releaseMemory }
    } catch (error) {
      releaseMemory?.()
      throw error
    }
  } finally {
    await fs.rm(snapshotPath, { force: true }).catch(() => undefined)
  }
}

async function captureLocalDatabaseSnapshot() {
  const snapshot = captureLocalDatabaseSnapshotUntracked()
  activeLocalDatabaseSnapshots.add(snapshot)
  try {
    return await snapshot
  } finally {
    activeLocalDatabaseSnapshots.delete(snapshot)
  }
}

async function drainLocalDatabaseSnapshots() {
  while (activeLocalDatabaseSnapshots.size > 0) {
    await Promise.allSettled([...activeLocalDatabaseSnapshots])
  }
}

async function synchronizeExternalDatabase(_options = {}) {
  const replacementGate = databaseHandleReplacementGate
  if (
    replacementGate
    && databaseHandleReplacementContext.getStore() !== replacementGate
  ) {
    if (databaseHandleReplacementFailpoint) {
      await databaseHandleReplacementFailpoint({ stage: 'external-sync-waiting' })
    }
    await replacementGate.promise
    return synchronizeExternalDatabase(_options)
  }
  if (
    !isExternalDatabaseConfiguration(activeDatabaseConfiguration)
    || suppressExternalSync
    || (databaseMaintenanceActive && !_options.force)
    || (!storageInitialized && !_options.force)
    || (storageShuttingDown && !_options.force)
  ) return null
  if (externalSyncConflict) throw externalSyncConflict
  if (_options.force && externalSyncTimer) {
    clearTimeout(externalSyncTimer)
    externalSyncTimer = null
    externalSyncNextRetryAt = null
  }
  if (externalSyncPromise) {
    // A mutation or forced flush that arrives while a snapshot is in flight
    // must cause one more capture. Returning only the older promise can leave
    // the newest durable revision stranded until another unrelated write.
    externalSyncFollowUpRequested = true
    return externalSyncPromise
  }
  const syncGeneration = databaseConfigurationGeneration
  const syncConfiguration = { ...activeDatabaseConfiguration }
  externalSyncStatus = 'syncing'
  const sync = (async () => {
    let result = null
    do {
      externalSyncFollowUpRequested = false
      if (databaseConfigurationGeneration !== syncGeneration) {
        const error = new Error('The database configuration changed before synchronization completed.')
        error.code = 'DATABASE_CONFIGURATION_SUPERSEDED'
        throw error
      }
      if (!pendingExternalSyncPayload) {
        const snapshot = await captureLocalDatabaseSnapshot()
        if (snapshot.revision <= lastExternalSyncedRevision) {
          snapshot.releaseMemory?.()
          result = { bytes: 0, revision: snapshot.revision, skipped: true }
          continue
        }
        // Keep the exact encrypted bytes until acknowledgement. The durable
        // envelope uses a random IV, so re-encoding after an uncertain commit
        // would look like divergent content at the same revision.
        try {
          pendingExternalSyncPayload = {
            generation: syncGeneration,
            revision: snapshot.revision,
            payload: await encodeExternalStatePayloadStreaming(snapshot.payload, activeEncryptionPolicy),
            updatedAt: nowStamp(),
            releaseMemory: snapshot.releaseMemory,
          }
        } catch (error) {
          snapshot.releaseMemory?.()
          throw error
        }
      }
      const pending = pendingExternalSyncPayload
      if (pending.generation !== syncGeneration || databaseConfigurationGeneration !== syncGeneration) {
        const error = new Error('The database configuration changed before synchronization completed.')
        error.code = 'DATABASE_CONFIGURATION_SUPERSEDED'
        throw error
      }
      let writeResult
      try {
        writeResult = await writeExternalDatabaseState(
          syncConfiguration,
          pending.payload,
          pending.revision,
          pending.updatedAt,
        )
      } catch (error) {
        if (error?.code === 'DATABASE_REVISION_CONFLICT') externalSyncConflict = error
        throw error
      }
      if (writeResult?.outcome === 'stale') {
        const error = new Error(
          `The external database advanced beyond local revision ${pending.revision}; the local snapshot was not written.`,
        )
        error.code = 'DATABASE_EXTERNAL_REVISION_STALE'
        error.status = 409
        error.localRevision = pending.revision
        // Quarantine this local fork. Treating the observed remote revision as
        // a local acknowledgement would eventually let unrelated local writes
        // overtake and replace data that this process never merged.
        externalSyncConflict = error
        externalSyncStatus = 'quarantined'
        externalSyncLastError = {
          code: error.code,
          message: error.message,
          at: nowStamp(),
        }
        // The stale CAS result is already authoritative. Fetch the remote
        // revision only to enrich diagnostics, and never leave the write gate
        // open while that secondary network request is pending or failing.
        try {
          const remote = await readExternalDatabaseStateWithMemoryAdmission(syncConfiguration)
          try {
            error.remoteRevision = normalizeWorkspaceRevision(remote?.revision)
          } finally {
            remote?.releaseMemory?.()
          }
        } catch (diagnosticError) {
          error.remoteRevision = null
          error.remoteRevisionError = String(
            diagnosticError?.message ?? 'Unable to read the remote revision.',
          )
        }
        throw error
      }
      if (databaseConfigurationGeneration !== syncGeneration) return result
      lastExternalSyncedRevision = pending.revision
      clearPendingExternalSyncPayload()
      durableRevisionRequiresExternalFlush = false
      result = { bytes: pending.payload.length, revision: pending.revision }
      if (readDurableWorkspaceRevision(getDb()) > lastExternalSyncedRevision) {
        externalSyncFollowUpRequested = true
      }
    } while (externalSyncFollowUpRequested)
    return result
  })()
  externalSyncPromise = sync
  externalSyncPromiseGeneration = syncGeneration
  try {
    const result = await sync
    if (databaseConfigurationGeneration === syncGeneration) {
      externalSyncRetryAttempt = 0
      externalSyncNextRetryAt = null
      externalSyncLastError = null
      externalSyncLastSuccessAt = nowStamp()
      externalSyncStatus = 'healthy'
    }
    return result
  } catch (error) {
    if (databaseConfigurationGeneration === syncGeneration) {
      externalSyncLastError = {
        code: String(error?.code ?? 'DATABASE_SYNC_FAILED'),
        message: String(error?.message ?? 'External database synchronization failed.'),
        at: nowStamp(),
      }
      if (externalSyncConflict) {
        externalSyncStatus = 'quarantined'
      } else if (
        error?.code !== 'DATABASE_CONFIGURATION_SUPERSEDED'
        && error?.code !== 'DATABASE_HANDLE_SUPERSEDED'
      ) {
        externalSyncRetryAttempt += 1
        externalSyncStatus = 'retrying'
        scheduleExternalDatabaseSync({ retry: true })
      }
    }
    throw error
  } finally {
    if (externalSyncPromise === sync) {
      externalSyncPromise = null
      externalSyncPromiseGeneration = -1
    }
  }
}

function scheduleExternalDatabaseSync({ retry = false } = {}) {
  if (
    !storageInitialized
    || storageShuttingDown
    || databaseMaintenanceActive
    || !isExternalDatabaseConfiguration(activeDatabaseConfiguration)
    || suppressExternalSync
    || externalSyncConflict
  ) return
  if (externalSyncTimer) return
  const delay = retry
    ? Math.min(EXTERNAL_SYNC_RETRY_MAX_MS, EXTERNAL_SYNC_RETRY_BASE_MS * (2 ** Math.max(0, externalSyncRetryAttempt - 1)))
    : EXTERNAL_SYNC_DEBOUNCE_MS
  const scheduledGeneration = databaseConfigurationGeneration
  externalSyncNextRetryAt = retry ? new Date(Date.now() + delay).toISOString() : null
  externalSyncTimer = setTimeout(() => {
    externalSyncTimer = null
    externalSyncNextRetryAt = null
    if (
      !storageInitialized
      || storageShuttingDown
      || databaseMaintenanceActive
      || scheduledGeneration !== databaseConfigurationGeneration
    ) return
    void synchronizeExternalDatabase().catch((error) => {
      // A timer callback can already be queued when shutdown cancels its
      // handle. If teardown owns the database by the time an asynchronous
      // backup step rejects, this is an expected lifecycle cancellation, not
      // an external-database outage that an operator can act on.
      if (!storageInitialized || storageShuttingDown) return
      if (error?.code === 'DATABASE_HANDLE_SUPERSEDED') return
      console.error('[storage] Failed to synchronize the external database:', error)
    })
  }, delay)
  externalSyncTimer.unref?.()
}

async function drainExternalDatabaseSyncForMaintenance({
  allowRevisionConflict = false,
  allowFailure = false,
} = {}) {
  if (externalSyncTimer) {
    clearTimeout(externalSyncTimer)
    externalSyncTimer = null
    externalSyncNextRetryAt = null
  }
  if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) return
  try {
    if (externalSyncPromise) await externalSyncPromise
    await synchronizeExternalDatabase({ force: true })
  } catch (error) {
    if (allowFailure) return
    const revisionConflict = error?.code === 'DATABASE_REVISION_CONFLICT'
      || error?.code === 'DATABASE_EXTERNAL_REVISION_STALE'
    if (!allowRevisionConflict || !revisionConflict) throw error
  }
}

async function drainDatabaseActivityBeforeHandleReplacement() {
  // External synchronization owns a tracked better-sqlite3 backup of the
  // current handle. Flush the exact final revision first, then wait for every
  // remaining local snapshot before replacing that handle. Closing it while a
  // backup is between Immediate callbacks rejects the durable write with
  // DATABASE_HANDLE_SUPERSEDED and can leave the external target stale.
  if (databaseHandleReplacementFailpoint) {
    await databaseHandleReplacementFailpoint({ stage: 'before-drain' })
  }
  if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
    await drainExternalDatabaseSyncForMaintenance()
  }
  await drainLocalDatabaseSnapshots()
  if (databaseHandleReplacementFailpoint) {
    await databaseHandleReplacementFailpoint({ stage: 'after-drain' })
  }
}

async function withDatabaseHandleReplacement(fn) {
  const inheritedGate = databaseHandleReplacementContext.getStore()
  if (inheritedGate && inheritedGate === databaseHandleReplacementGate) return fn()
  while (databaseHandleReplacementGate) {
    const pendingGate = databaseHandleReplacementGate
    if (databaseHandleReplacementFailpoint) {
      await databaseHandleReplacementFailpoint({ stage: 'database-source-gate-waiting' })
    }
    await pendingGate.promise
  }
  let releaseGate
  const gate = {
    promise: new Promise((resolve) => { releaseGate = resolve }),
  }
  databaseHandleReplacementGate = gate
  try {
    return await databaseHandleReplacementContext.run(gate, fn)
  } finally {
    if (databaseHandleReplacementGate === gate) databaseHandleReplacementGate = null
    releaseGate()
  }
}

async function withDatabaseMaintenance(fn, options = {}) {
  return withWriteLock(async () => {
    databaseMaintenanceActive = true
    databaseMaintenanceGeneration += 1
    const generation = databaseMaintenanceGeneration
    try {
      return await databaseMaintenanceContext.run(
        { generation },
        () => withDatabaseHandleReplacement(async () => {
          await drainExternalDatabaseSyncForMaintenance(options)
          return fn()
        }),
      )
    } finally {
      databaseMaintenanceActive = false
    }
  })
}

async function prepareConfiguredDatabaseSource({ signal } = {}) {
  // Test workers must never open the live workspace database or its persisted
  // external-database configuration. Besides leaking fixtures between suites,
  // a route test could otherwise replace a real encrypted AI credential when
  // its seeded snapshot is written back.
  const persisted = process.env.NODE_ENV === 'test'
    ? null
    : await readPersistedDatabaseConfiguration()
  const next = persisted ?? { type: 'sqlite', sqlitePath: defaultSqlitePath }
  if (!isExternalDatabaseConfiguration(next)) {
    pendingDatabaseRevisionFloor = 0
    durableRevisionRequiresExternalFlush = false
    setActiveSqlitePath(next.sqlitePath)
    const processLease = await ensureEncryptedSqliteProcessLease({ signal })
    const canonicalPath = await convergeActiveSqlitePathToLease(next.sqlitePath, processLease)
    const canonicalConfiguration = { ...next, sqlitePath: canonicalPath }
    activateDatabaseConfiguration(canonicalConfiguration)
    if (process.env.NODE_ENV !== 'test' && path.resolve(next.sqlitePath) !== canonicalPath) {
      await persistDatabaseConfiguration(canonicalConfiguration)
    }
    return
  }

  activateDatabaseConfiguration(next)

  // The selected server is the durable source. A local SQLite file remains a
  // compatibility cache for the current SQL layer and is refreshed before the
  // cache is opened, so a restart never silently falls back to stale local data.
  setActiveSqlitePath(defaultSqlitePath)
  const processLease = await ensureEncryptedSqliteProcessLease({ signal })
  await convergeActiveSqlitePathToLease(defaultSqlitePath, processLease)
  const remote = await readExternalDatabaseStateWithMemoryAdmission(next, { signal })
  try {
    if (!remote?.payload?.length) {
      const error = new Error('The selected database does not contain PhD Atlas data yet.')
      error.code = 'DATABASE_STATE_MISSING'
      error.status = 409
      throw error
    }
    pendingDatabaseRevisionFloor = normalizeWorkspaceRevision(remote.revision)
    lastExternalSyncedRevision = pendingDatabaseRevisionFloor
    clearPendingExternalSyncPayload()
    externalSyncConflict = null
    closeOpenDatabase()
    clearPendingDatabaseImage()
    const encryptedRemote = remote.payload.subarray(0, EXTERNAL_STATE_MAGIC.length).equals(EXTERNAL_STATE_MAGIC)
    const remoteImage = decodeExternalStatePayload(remote.payload)
    const remoteCapacity = snapshotCapacityPlan('external-whole-snapshot', {
      encryptionAtRest: encryptedRemote,
    })
    assertSnapshotCapacityPlan(remoteCapacity)
    if (remoteImage.length > remoteCapacity.effectiveLimitBytes) {
      throw snapshotCapacityError({
        mode: 'external-whole-snapshot',
        limitBytes: remoteCapacity.effectiveLimitBytes,
        currentBytes: remoteImage.length,
      })
    }
    if (encryptedRemote) {
      pendingDatabaseImage = sqliteImageForMemory(remoteImage)
      pendingDatabaseImageReleaseMemory = remote.releaseMemory ?? null
      remote.releaseMemory = null
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
  } finally {
    remote?.releaseMemory?.()
  }
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
    await assertExternalDatabaseTargetEmpty(candidate, options)
  }
  return verified
}

/**
 * Migrate the current consistent workspace snapshot to the selected engine, then
 * persist the source selector. The selector is written only after the target has
 * accepted the snapshot, so a bad connection cannot strand an installation.
 */
async function configureDatabaseConfigurationDuringMaintenance(input, options = {}) {
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
  const candidate = await verifyDatabaseConnection(candidateInput, options)
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
  if (isExternalDatabaseConfiguration(normalized)) {
    const previousSnapshotMode = residentSnapshotStorageMode()
    applySnapshotStoragePageLimit(getDb(), 'external-whole-snapshot')
    let migrationActivated = false
    try {
      const allowExistingState = options.allowExistingState !== false
      const maxAttempts = allowExistingState ? 3 : 1
      let acceptedSnapshotRevision = null
      let migrationError = null
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (allowExistingState) {
        const existing = await readExternalDatabaseStateWithMemoryAdmission(normalized, options)
        try {
          if (existing?.payload?.length) {
            const previousSuppression = suppressExternalSync
            suppressExternalSync = true
            try {
              advanceDurableWorkspaceRevisionPast(getDb(), existing.revision)
              invalidateSharedStoreCache()
            } finally {
              suppressExternalSync = previousSuppression
            }
          }
        } finally {
          existing?.releaseMemory?.()
        }
      }
      const currentSnapshot = await captureLocalDatabaseSnapshot()
      try {
        const writeResult = await writeExternalDatabaseState(
          normalized,
          await encodeExternalStatePayloadStreaming(currentSnapshot.payload, activeEncryptionPolicy),
          currentSnapshot.revision,
          nowStamp(),
          { ...options, overwrite: allowExistingState },
        )
        if (writeResult?.outcome !== 'stale') {
          migrationError = null
          acceptedSnapshotRevision = currentSnapshot.revision
          break
        }
        migrationError = Object.assign(new Error('The target database advanced during migration.'), {
          code: 'DATABASE_EXTERNAL_REVISION_STALE',
          status: 409,
        })
      } catch (error) {
        if (!allowExistingState || error?.code !== 'DATABASE_REVISION_CONFLICT') throw error
        migrationError = error
      } finally {
        currentSnapshot.releaseMemory?.()
      }
      }
      if (migrationError) throw migrationError
      if (acceptedSnapshotRevision === null) {
        throw new Error('The external workspace migration did not produce an acknowledged snapshot.')
      }
      await persistDatabaseConfiguration(normalized)
      activateDatabaseConfiguration(
        await readPersistedDatabaseConfiguration() ?? normalized,
        { lastSyncedRevision: acceptedSnapshotRevision },
      )
      migrationActivated = true
      return getDatabaseConfiguration()
    } finally {
      if (!migrationActivated && db) applySnapshotStoragePageLimit(db, previousSnapshotMode)
    }
  }

  const currentSnapshot = await captureLocalDatabaseSnapshot()
  const previousConfiguration = activeDatabaseConfiguration
  const previousDatabasePath = databasePath
  const previousLease = encryptedSqliteProcessLease
  let targetLease = null
  let targetLeaseAcquired = false
  let targetActivated = false
  try {
    const requestedTargetPath = path.resolve(normalized.sqlitePath)
    const acquiredTarget = await acquireSqliteProcessLeaseForPath(normalized.sqlitePath)
    targetLease = acquiredTarget.lease
    targetLeaseAcquired = acquiredTarget.acquired
    const targetPath = targetLease.databasePath
    const canonicalConfiguration = { ...normalized, sqlitePath: targetPath }
    await drainSqliteSealBeforeStorageTransition()
    const targetSealedPath = sealedPathFor(targetPath)
    const targetUsesSqliteEncryption = Boolean(activeEncryptionPolicy?.sqliteEncryption)
    // Encrypted workspaces run from a resident in-memory SQLite image. Keep
    // that authoritative image open until its replacement seal is atomically
    // published; otherwise a failed same-canonical/alias switch could reopen
    // the previous seal and silently roll back the latest acknowledged writes.
    if (targetLease === previousLease && !targetUsesSqliteEncryption) closeOpenDatabase()
    if (targetUsesSqliteEncryption) {
      await databaseConfigurationSealFailpoint?.({
        requestedPath: requestedTargetPath,
        targetPath,
      })
      await sealSqliteBuffer(
        currentSnapshot.payload,
        targetSealedPath,
        deriveSqliteKey(),
        activeEncryptionPolicy.encryptionAlgorithm,
      )
    } else {
      await writeSnapshotFile(targetPath, currentSnapshot.payload)
    }
    await Promise.all([
      fs.rm(`${targetPath}-wal`, { force: true }),
      fs.rm(`${targetPath}-shm`, { force: true }),
      ...(targetUsesSqliteEncryption ? [fs.rm(targetPath, { force: true })] : []),
    ])
    await removeSqliteSealArtifacts(targetSealedPath, {
      removeTarget: !targetUsesSqliteEncryption,
    })
    if (requestedTargetPath !== targetPath) {
      const requestedSealedPath = sealedPathFor(requestedTargetPath)
      if (!await sqlitePathsShareCanonicalTarget(requestedSealedPath, targetSealedPath)) {
        await removeSqliteSealArtifacts(requestedSealedPath, { removeTarget: true })
      }
      if (targetUsesSqliteEncryption) {
        try {
          const aliasStat = await fs.lstat(requestedTargetPath)
          if (aliasStat.isSymbolicLink()) await fs.rm(requestedTargetPath, { force: true })
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
    }
    closeOpenDatabase()
    setActiveSqlitePath(targetPath)
    encryptedSqliteProcessLease = targetLease
    activateDatabaseConfiguration(canonicalConfiguration)
    await persistDatabaseConfiguration(canonicalConfiguration)
    storageReadyPromise = null
    storageInitialized = false
    await ensureStorage()
    targetActivated = true
    if (previousLease && previousLease !== targetLease) {
      await releaseEncryptedSqliteProcessLease(previousLease)
    }
    return getDatabaseConfiguration()
  } catch (error) {
    if (!targetActivated) {
      const residentDatabaseStillAuthoritative = Boolean(
        db?.open
        && previousLease?.valid
        && encryptedSqliteProcessLease === previousLease,
      )
      if (!residentDatabaseStillAuthoritative) {
        closeOpenDatabase()
        clearPendingDatabaseImage()
      }
      setActiveSqlitePath(previousDatabasePath)
      encryptedSqliteProcessLease = previousLease?.valid ? previousLease : null
      activateDatabaseConfiguration(previousConfiguration)
      await persistDatabaseConfiguration(previousConfiguration).catch(() => undefined)
      if (targetLeaseAcquired && targetLease && targetLease !== previousLease && targetLease.valid) {
        await releaseEncryptedSqliteProcessLease(targetLease).catch(() => undefined)
      }
      if (previousLease?.valid) encryptedSqliteProcessLease = previousLease
      if (!residentDatabaseStillAuthoritative) {
        storageReadyPromise = null
        storageInitialized = false
        await ensureStorage().catch((restoreError) => {
          error.restoreError = restoreError
        })
      }
    }
    throw error
  } finally {
    currentSnapshot.releaseMemory?.()
  }
}

export async function configureDatabaseConfiguration(input, options = {}) {
  await ensureStorage()
  return withDatabaseMaintenance(
    () => configureDatabaseConfigurationDuringMaintenance(input, options),
    { allowFailure: true },
  )
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
    createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
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
  const backupId = randomUUID()
  const fileName = `phd-atlas-backup-${stamp}-${backupId}.tar.gz`
  const target = path.join(backupRoot, fileName)
  const stagingDir = path.join(backupRoot, `.staging-workspace-${process.pid}-${stamp}-${backupId}`)
  const plainArchive = path.join(backupRoot, `.workspace-archive-${process.pid}-${Date.now()}-${backupId}.tar.gz`)
  const createdAt = nowStamp()
  let externalState = null
  let releaseLocalIoMemory = null

  try {
    await fs.rm(stagingDir, { recursive: true, force: true })
    await fs.mkdir(stagingDir, { recursive: true, mode: 0o700 })

    const sqliteTarget = path.join(stagingDir, 'phd-atlas.sqlite')
    const uploadsStaging = path.join(stagingDir, 'uploads')
    await fs.mkdir(uploadsStaging, { recursive: true })

    let sourceConfiguration = null
    let sourceDatabaseRevision = null
    let databaseSqlFile = null
    let workspaceBackupFormat = 'sqlite-uploads-v1'
    await withDatabaseHandleReplacement(async () => {
      sourceConfiguration = { ...activeDatabaseConfiguration }
      if (isExternalDatabaseConfiguration(sourceConfiguration)) {
        // Flush the compatibility cache, then read back from the selected server.
        // The resulting archive is therefore a backup of the configured database,
        // rather than a local-cache-only snapshot.
        await synchronizeExternalDatabase({ force: true })
        externalState = await readExternalDatabaseStateWithMemoryAdmission(sourceConfiguration)
        if (!externalState?.payload?.length) {
          throw backupFileError(502, 'DATABASE_BACKUP_FAILED', 'The configured database did not return a workspace snapshot.')
        }
        await decodeExternalStatePayloadToFile(externalState.payload, sqliteTarget)
        sourceDatabaseRevision = externalState.revision
        if (externalState.payload.length <= EXTERNAL_SQL_DUMP_IN_MEMORY_LIMIT_BYTES) {
          databaseSqlFile = `database-${sourceConfiguration.type}.sql`
          await fs.writeFile(
            path.join(stagingDir, databaseSqlFile),
            createExternalDatabaseSqlDump(sourceConfiguration, externalState),
            { encoding: 'utf8', mode: 0o600 },
          )
          workspaceBackupFormat = `${sourceConfiguration.type}-state-sql-uploads-v1`
        } else {
          // The SQLite compatibility image is the canonical, portable restore
          // source. Avoid constructing a second base64/hex SQL string (up to 2x
          // the BLOB) for large external workspaces.
          workspaceBackupFormat = `${sourceConfiguration.type}-state-uploads-v2`
        }
      } else {
        const database = getDb()
        // better-sqlite3's hot backup streams pages to disk. It does not need a
        // reservation proportional to the complete workspace snapshot, but the
        // SQLite/page-cache and gzip pipeline still need one small bounded I/O
        // allowance. External adapters already own their single payload-sized
        // lease through readExternalDatabaseStateWithMemoryAdmission().
        releaseLocalIoMemory = acquireStoreHydrationMemory?.(
          WORKSPACE_BACKUP_LOCAL_IO_RESERVATION_BYTES,
        ) ?? null
        await database.backup(sqliteTarget)
        const snapshot = new Database(sqliteTarget, { readonly: true, fileMustExist: true })
        try {
          sourceDatabaseRevision = readDurableWorkspaceRevision(snapshot)
        } finally {
          snapshot.close()
        }
      }
    })

    let uploadCount = 0
    try {
      await fs.cp(uploadRoot, uploadsStaging, { recursive: true, force: true })
      uploadCount = await countFilesRecursive(uploadsStaging)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const metadata = {
      kind: 'workspace',
      format: workspaceBackupFormat,
      createdAt,
      actorId,
      databaseAdapter: sourceConfiguration.type,
      databaseFile: 'phd-atlas.sqlite',
      databaseSqlFile,
      databaseRevision: sourceDatabaseRevision,
      uploadsDir: 'uploads',
      uploadCount,
      databasePath: isExternalDatabaseConfiguration(sourceConfiguration)
        ? sourceConfiguration.database
        : sourceConfiguration.sqlitePath,
      uploadRoot,
    }
    await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(metadata, null, 2), 'utf8')

    // Never publish the plaintext archive under its final, listable name. The
    // active policy is read at the actual persistence boundary so a queued
    // backup cannot race an administrator enabling encryption at rest.
    await packDirectoryTarGz(stagingDir, plainArchive)
    const backupPolicy = activeEncryptionPolicy ?? options.encryptionPolicy
    await encodeBackupFile(plainArchive, target, backupPolicy)
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
      format: workspaceBackupFormat,
      uploadCount,
    }
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined)
    throw error
  } finally {
    releaseLocalIoMemory?.()
    externalState?.releaseMemory?.()
    await fs.rm(plainArchive, { force: true }).catch(() => undefined)
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
    const readableArchive = path.join(extractDir, '.workspace-backup.tar.gz')
    await fs.mkdir(extractDir, { recursive: true, mode: 0o700 })
    const inspection = await inspectBackupFile(backup.path)
    if (inspection.encrypted) {
      await decodeBackupFile(backup.path, readableArchive)
      await extractTarGz(readableArchive, extractDir)
      await fs.rm(readableArchive, { force: true })
    } else {
      await extractTarGz(backup.path, extractDir)
    }

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
    const restoredSqliteStat = await fs.stat(sqliteSource)
    const restoreSnapshotMode = residentSnapshotStorageMode()
    const restoreSnapshotCapacity = snapshotCapacityPlan(restoreSnapshotMode)
    assertSnapshotCapacityPlan(restoreSnapshotCapacity)
    if (
      snapshotModeEnabled(restoreSnapshotMode)
      && restoredSqliteStat.size > restoreSnapshotCapacity.effectiveLimitBytes
    ) {
      throw snapshotCapacityError({
        mode: restoreSnapshotMode,
        limitBytes: restoreSnapshotCapacity.effectiveLimitBytes,
        currentBytes: restoredSqliteStat.size,
      })
    }

    const uploadsSource = path.join(extractDir, manifest?.uploadsDir || 'uploads')
    const restoreSecurityContext = {
      actorId: options.actorId ?? null,
      eventId: createId('event'),
      fileName: backup.fileName,
    }
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

    await withDatabaseMaintenance(async () => {
      await fs.mkdir(preRestoreDir, { recursive: true, mode: 0o700 })

      try {
        const manifestRevision = normalizeWorkspaceRevision(manifest?.databaseRevision)
        const localRevision = readDurableWorkspaceRevision(getDb())
        let restoredRevision

        if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
          // Restore is an explicit replacement, but it must still advance the
          // same durable clock as ordinary writes. Publish the staged database
          // first so a stale/conflicting remote write can never be reported as
          // a successful local restore.
          let revisionFloor = Math.max(localRevision, manifestRevision)
          let restoreError = null
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const remote = await readExternalDatabaseStateWithMemoryAdmission(activeDatabaseConfiguration)
            try {
              revisionFloor = Math.max(revisionFloor, normalizeWorkspaceRevision(remote?.revision))
            } finally {
              remote?.releaseMemory?.()
            }
            restoredRevision = prepareRestoredWorkspaceDatabase(
              sqliteSource,
              revisionFloor,
              restoreSecurityContext,
            )
            try {
              const writeResult = await writeExternalDatabaseState(
                activeDatabaseConfiguration,
                await encodeExternalStateFileStreaming(sqliteSource, activeEncryptionPolicy),
                restoredRevision,
                nowStamp(),
              )
              if (writeResult?.outcome !== 'stale') {
                restoreError = null
                break
              }
              restoreError = backupFileError(
                409,
                'DATABASE_EXTERNAL_REVISION_STALE',
                'The external database advanced while the workspace archive was being restored.',
              )
            } catch (error) {
              if (error?.code !== 'DATABASE_REVISION_CONFLICT') throw error
              restoreError = error
            }
          }
          if (restoreError) throw restoreError
          lastExternalSyncedRevision = restoredRevision
          clearPendingExternalSyncPayload()
          externalSyncConflict = null
          durableRevisionRequiresExternalFlush = false
        } else {
          restoredRevision = prepareRestoredWorkspaceDatabase(
            sqliteSource,
            Math.max(localRevision, manifestRevision),
            restoreSecurityContext,
          )
        }

        closeOpenDatabase()
        if (await pathExists(liveSqlite)) {
          await fs.rename(liveSqlite, preservedSqlite)
        }
        await fs.rm(liveWal, { force: true }).catch(() => undefined)
        await fs.rm(liveShm, { force: true }).catch(() => undefined)
        await fs.copyFile(sqliteSource, liveSqlite)

        if (await pathExists(uploadRoot)) {
          await fs.rename(uploadRoot, preservedUploads)
        }
        await fs.mkdir(uploadRoot, { recursive: true })
        if (await pathExists(uploadsSource)) {
          await fs.cp(uploadsSource, uploadRoot, { recursive: true, force: true })
        }

        storageReadyPromise = null
        await ensureStorage()
        if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
          // The staged image already contains the revocation. Force the
          // selected external store through the normal acknowledgement path
          // before leaving the maintenance boundary.
          await synchronizeExternalDatabase({ force: true })
        }
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
    }, { allowRevisionConflict: true })

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

function estimateJsonUtf8Bytes(value) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  let total = 0
  const seen = new WeakSet()
  const visit = (node) => {
    if (total > 64 * 1024) return false
    if (node === null || node === undefined) {
      total += 4
      return true
    }
    if (typeof node === 'string') {
      total += Buffer.byteLength(node, 'utf8') + 2
      return true
    }
    if (typeof node === 'number') {
      total += 24
      return true
    }
    if (typeof node === 'boolean') {
      total += 6
      return true
    }
    if (typeof node !== 'object') {
      total += 16
      return true
    }
    if (seen.has(node)) {
      total += 16
      return true
    }
    seen.add(node)
    if (Array.isArray(node)) {
      total += 2
      for (const item of node) {
        total += 1
        if (!visit(item)) return false
      }
      return true
    }
    total += 2
    for (const key of Object.keys(node)) {
      total += Buffer.byteLength(key, 'utf8') + 4
      if (!visit(node[key])) return false
    }
    return true
  }
  visit(value)
  return total
}

function encodePayloadForStorageJson(json) {
  if (!activeEncryptionPolicy?.encryptionAtRest) {
    // If a previously encrypted payload is written while encryption is off, decrypt first.
    if (isEncryptedPayload(json)) return decryptPayload(json)
    return json
  }
  if (isEncryptedPayload(json)) return json
  return encryptPayload(json)
}

export function encodePayloadForStorage(value) {
  const json = typeof value === 'string' ? value : toJson(value)
  return encodePayloadForStorageJson(json)
}

export function decodePayloadFromStorage(value) {
  if (!value) return {}
  const plain = isEncryptedPayload(value) ? decryptPayload(value) : value
  return fromJson(plain, {})
}

function payloadWorkerPolicy() {
  return activeEncryptionPolicy
    ? {
        encryptionAtRest: activeEncryptionPolicy.encryptionAtRest,
        algorithm: activeEncryptionPolicy.encryptionAlgorithm,
        passwordBinding: activeEncryptionPolicy.passwordBinding,
      }
    : { encryptionAtRest: false, algorithm: 'aes-256-gcm', passwordBinding: '' }
}

/**
 * Worker-offloaded twin of encodePayloadForStorage. Nothing in the write path
 * calls it, and that is the correct state -- do not wire it in.
 *
 * Moving the encode to a worker was measured against the synchronous path at
 * the sizes this threshold actually fires at, and it lost everywhere:
 *
 *   payload    sync block   worker block   worker total
 *   128 KiB       0.4ms        16.4ms         74.2ms
 *   512 KiB       1.0ms         2.0ms          5.3ms
 *     2 MiB       4.2ms         7.0ms         16.4ms
 *     8 MiB      17.9ms        33.0ms         68.5ms
 *
 * postMessage structure-clones the object on the calling thread before the
 * worker can begin, so the hop costs more main-thread time than the encode it
 * was meant to move. The function and its equivalence tests stay because they
 * pin that the two encoders produce interchangeable output, which is what
 * makes this comparison meaningful rather than an assertion.
 */
export async function encodePayloadForStorageAsync(value) {
  const bytes = estimateJsonUtf8Bytes(value)
  if (bytes > 64 * 1024) {
    const encoded = await payloadWorkerPool.encode(value, {
      policy: payloadWorkerPolicy(),
      forceWorker: true,
      skipSizeCheck: true,
    })
    if (typeof encoded === 'string') return encoded
  }
  return encodePayloadForStorage(value)
}

async function decodePayloadFromStorageAsync(value) {
  const bytes = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0
  if (bytes > 8 * 1024 * 1024) {
    // At this size, sending ciphertext to a worker and cloning the decoded
    // object back creates two additional multi-megabyte cross-isolate images.
    // One bounded main-isolate decode uses less RSS; the sectional stream still
    // serializes rows one at a time and applies backpressure to the socket.
    return decodePayloadFromStorage(value)
  }
  if (bytes > 64 * 1024) {
    const decoded = await payloadWorkerPool.decode(value)
    if (decoded !== null && typeof decoded === 'object') return decoded
  }
  return decodePayloadFromStorage(value)
}

async function ensureStorageServiceProcessLease({ signal } = {}) {
  if (storageServiceProcessLease?.valid) return storageServiceProcessLease
  storageServiceProcessLease = await acquireEncryptedSqliteProcessLease(
    storageServiceLeaseTarget,
    { signal },
  )
  return storageServiceProcessLease
}

async function releaseStorageServiceProcessLease() {
  const lease = storageServiceProcessLease
  if (!lease) return
  try {
    await lease.release()
  } finally {
    // A release implementation may close the OS lock successfully and then
    // surface a cleanup error. Never retain an invalid handle as if this
    // worker still owned the service, while a genuinely live handle remains
    // fail-closed for a later shutdown retry.
    if (storageServiceProcessLease === lease && !lease.valid) {
      storageServiceProcessLease = null
    }
  }
}

async function removeSqliteSealArtifacts(targetSealedPath, { removeTarget = false } = {}) {
  const directory = path.dirname(targetSealedPath)
  const prefixes = [
    `${path.basename(targetSealedPath)}.tmp-`,
    `${path.basename(targetSealedPath)}.previous-`,
  ]
  let entries = []
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await Promise.all([
    ...(removeTarget ? [fs.rm(targetSealedPath, { force: true })] : []),
    ...entries
      .filter((entry) => entry.isFile() && prefixes.some((prefix) => entry.name.startsWith(prefix)))
      .map((entry) => fs.rm(path.join(directory, entry.name), { force: true })),
  ])
}

async function sqlitePathsShareCanonicalTarget(leftPath, rightPath) {
  const [leftCanonical, rightCanonical] = await Promise.all([
    canonicalSqliteDatabasePath(leftPath),
    canonicalSqliteDatabasePath(rightPath),
  ])
  return leftCanonical === rightCanonical
}

function aliasedSqliteRecoveryError(message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = 'SQLITE_ALIASED_WAL_RECOVERY_FAILED'
  error.status = 503
  return error
}

async function inspectAliasedSqliteCompanion(companionPath) {
  try {
    const entry = await fs.lstat(companionPath)
    if (!entry.isFile() || entry.isSymbolicLink() || Number(entry.nlink) !== 1) {
      throw aliasedSqliteRecoveryError(
        'An aliased SQLite recovery companion is not a private regular file.',
      )
    }
    return entry
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function recoverDistinctAliasedSqliteWal(requestedPath, canonicalPath) {
  const aliasWalPath = `${requestedPath}-wal`
  const aliasShmPath = `${requestedPath}-shm`
  const canonicalWalPath = `${canonicalPath}-wal`
  const canonicalShmPath = `${canonicalPath}-shm`
  const [walIsCanonical, shmIsCanonical] = await Promise.all([
    sqlitePathsShareCanonicalTarget(aliasWalPath, canonicalWalPath),
    sqlitePathsShareCanonicalTarget(aliasShmPath, canonicalShmPath),
  ])
  if (walIsCanonical && shmIsCanonical) return

  const [aliasWal, aliasShm] = await Promise.all([
    walIsCanonical ? null : inspectAliasedSqliteCompanion(aliasWalPath),
    shmIsCanonical ? null : inspectAliasedSqliteCompanion(aliasShmPath),
  ])
  if (!aliasWal && !aliasShm) return

  let targetBefore
  try {
    targetBefore = await fs.realpath(requestedPath)
  } catch (error) {
    throw aliasedSqliteRecoveryError('The aliased SQLite database target is unavailable.', error)
  }
  if (path.resolve(targetBefore) !== canonicalPath) {
    throw aliasedSqliteRecoveryError('The aliased SQLite database target changed before WAL recovery.')
  }

  let recoveryDatabase = null
  let recoveryError = null
  try {
    recoveryDatabase = new Database(requestedPath, { fileMustExist: true, timeout: 0 })
    recoveryDatabase.pragma('busy_timeout = 0')
    const checkpoint = recoveryDatabase.pragma('wal_checkpoint(TRUNCATE)')?.[0]
    if (Number(checkpoint?.busy ?? 0) !== 0) {
      throw aliasedSqliteRecoveryError('The aliased SQLite WAL is still owned by another process.')
    }
  } catch (error) {
    recoveryError = error?.code === 'SQLITE_ALIASED_WAL_RECOVERY_FAILED'
      ? error
      : aliasedSqliteRecoveryError('The aliased SQLite WAL could not be checkpointed.', error)
  } finally {
    try {
      recoveryDatabase?.close()
    } catch (error) {
      recoveryError ??= aliasedSqliteRecoveryError(
        'The aliased SQLite recovery database could not be closed.',
        error,
      )
    }
  }
  if (recoveryError) throw recoveryError

  const targetAfter = await fs.realpath(requestedPath).catch((error) => {
    throw aliasedSqliteRecoveryError('The aliased SQLite target disappeared after WAL recovery.', error)
  })
  if (path.resolve(targetAfter) !== canonicalPath) {
    throw aliasedSqliteRecoveryError('The aliased SQLite database target changed during WAL recovery.')
  }
  const remainingWal = walIsCanonical
    ? null
    : await inspectAliasedSqliteCompanion(aliasWalPath)
  if (remainingWal?.size > 0) {
    throw aliasedSqliteRecoveryError('The aliased SQLite WAL remained non-empty after checkpointing.')
  }
  await Promise.all([
    ...(!walIsCanonical ? [fs.rm(aliasWalPath, { force: true })] : []),
    ...(!shmIsCanonical ? [fs.rm(aliasShmPath, { force: true })] : []),
  ])
}

async function convergeActiveSqlitePathToLease(requestedPath, lease) {
  const requested = path.resolve(requestedPath)
  const canonical = lease.databasePath
  if (requested === canonical) {
    setActiveSqlitePath(canonical)
    return canonical
  }

  await recoverDistinctAliasedSqliteWal(requested, canonical)

  const aliasSealedPath = sealedPathFor(requested)
  const canonicalSealedPath = sealedPathFor(canonical)
  const aliasSealIsCanonical = await sqlitePathsShareCanonicalTarget(
    aliasSealedPath,
    canonicalSealedPath,
  )
  const aliasSealed = !aliasSealIsCanonical && await sealedSqliteExists(aliasSealedPath)
  if (aliasSealed) {
    let aliasValid = false
    let canonicalValid = false
    try {
      await verifySealedSqliteFile(aliasSealedPath, deriveSqliteKey())
      aliasValid = true
    } catch {
      // An invalid alias is removed only after a valid canonical image exists.
    }
    if (await sealedSqliteExists(canonicalSealedPath)) {
      try {
        await verifySealedSqliteFile(canonicalSealedPath, deriveSqliteKey())
        canonicalValid = true
      } catch {
        // A valid alias may recover an interrupted canonical target.
      }
    }
    if (aliasValid) {
      const aliasMtime = (await fs.stat(aliasSealedPath)).mtimeMs
      const canonicalMtime = canonicalValid
        ? (await fs.stat(canonicalSealedPath)).mtimeMs
        : Number.NEGATIVE_INFINITY
      if (!canonicalValid || aliasMtime > canonicalMtime) {
        await promoteSealedSqliteFile(aliasSealedPath, canonicalSealedPath, deriveSqliteKey())
        canonicalValid = true
      }
    }
    if (!canonicalValid) {
      const error = new Error('Neither the canonical nor aliased sealed SQLite image is valid.')
      error.code = 'SQLITE_SEALED_ALIAS_INVALID'
      error.status = 503
      throw error
    }
    await removeSqliteSealArtifacts(aliasSealedPath, { removeTarget: true })
  }
  setActiveSqlitePath(canonical)
  return canonical
}

async function acquireSqliteProcessLeaseForPath(targetPath = databasePath, { signal } = {}) {
  const canonicalTargetPath = await canonicalSqliteDatabasePath(targetPath)
  if (canonicalTargetPath === storageServiceProcessLease?.databasePath) {
    const error = new Error('The configured SQLite path is reserved for the storage service owner.')
    error.code = 'SQLITE_PATH_RESERVED_FOR_STORAGE_SERVICE'
    error.status = 400
    throw error
  }
  if (
    encryptedSqliteProcessLease?.valid
    && encryptedSqliteProcessLease.databasePath === canonicalTargetPath
  ) return { lease: encryptedSqliteProcessLease, acquired: false }
  return {
    lease: await acquireEncryptedSqliteProcessLease(canonicalTargetPath, { signal }),
    acquired: true,
  }
}

async function ensureEncryptedSqliteProcessLease({ signal } = {}) {
  const acquired = await acquireSqliteProcessLeaseForPath(databasePath, { signal })
  if (encryptedSqliteProcessLease && encryptedSqliteProcessLease !== acquired.lease) {
    if (acquired.acquired) await acquired.lease.release().catch(() => undefined)
    const error = new Error('A different SQLite workspace lease is active during a database switch.')
    error.code = 'SQLITE_PROCESS_LEASE_SWITCH_REQUIRED'
    error.status = 503
    throw error
  }
  encryptedSqliteProcessLease = acquired.lease
  return acquired.lease
}

async function drainSqliteSealBeforeStorageTransition() {
  if (sealAfterWriteTimer) {
    clearTimeout(sealAfterWriteTimer)
    sealAfterWriteTimer = null
  }
  // Seal execution never calls a storage transition or lease release. Capturing
  // the current owner before awaiting prevents a later seal from being confused
  // with the old path whose globals are about to change.
  const inFlight = sealInFlightPromise
  if (inFlight) await inFlight
}

async function releaseEncryptedSqliteProcessLease(lease = encryptedSqliteProcessLease) {
  if (!lease) return
  if (lease === encryptedSqliteProcessLease) await drainSqliteSealBeforeStorageTransition()
  try {
    await lease.release()
  } finally {
    if (encryptedSqliteProcessLease === lease && !lease.valid) {
      encryptedSqliteProcessLease = null
    }
  }
}

async function maybeUnsealDatabase() {
  await recoverOrCleanInterruptedSqliteSeals()
  const sealed = await sealedSqliteExists(sealedDatabasePath)
  if (!sealed) return
  // The authenticated image is opened directly in memory. No plaintext SQLite
  // file is materialized while whole-file encryption is enabled.
  const hexKey = deriveSqliteKey()
  const sealedStat = await fs.stat(sealedDatabasePath)
  const sealedCapacity = snapshotCapacityPlan('encrypted-sqlite-whole-snapshot')
  assertSnapshotCapacityPlan(sealedCapacity)
  assertSqliteSealedPayloadAdmission(sealedStat.size, sealedCapacity.effectiveLimitBytes)
  const releaseMemory = acquireStoreHydrationMemory?.(
    sqliteUnsealReservationBytes(sealedStat.size),
  ) ?? null
  try {
    clearPendingDatabaseImage()
    pendingDatabaseImage = sqliteImageForMemory(await unsealSqliteBuffer(sealedDatabasePath, hexKey))
    pendingDatabaseImageReleaseMemory = releaseMemory
    databaseRunsInMemory = true
    await removePlainSqliteArtifacts()
  } catch (error) {
    clearPendingDatabaseImage()
    releaseMemory?.()
    throw error
  }
}

async function assertActiveSqliteProcessLeaseOwned() {
  const lease = encryptedSqliteProcessLease
  if (!lease) {
    const error = new Error('The SQLite process lease is not held; sealing is refused.')
    error.code = 'SQLITE_PROCESS_LEASE_LOST'
    error.status = 503
    throw error
  }
  await lease.assertOwned()
  return lease
}

async function performSqliteSeal() {
  // Vitest starts multiple isolated API instances against the same fixture
  // directory. Persistence itself is covered by encryption-storage.test.js;
  // route tests must not race to replace the shared production seal.
  if (
    process.env.NODE_ENV === 'test'
    && process.env.PHD_ATLAS_FORCE_SQLITE_SEAL_TEST !== '1'
  ) return
  const processLease = await assertActiveSqliteProcessLeaseOwned()
  const hexKey = deriveSqliteKey()
  if (databaseRunsInMemory && db) {
    // serialize() is the one unavoidable plaintext image retained by
    // better-sqlite3. sealSqliteBuffer consumes it in 64 KiB slices and writes
    // ciphertext directly, avoiding the former encrypted+payload full copies.
    assertDatabaseSnapshotCapacity(db, 'encrypted-sqlite-whole-snapshot')
    const releaseMemory = acquireStoreSnapshotMemory(db)
    try {
      const image = db.serialize()
      await processLease.assertOwned()
      await sealSqliteBuffer(
        image,
        sealedDatabasePath,
        hexKey,
        activeEncryptionPolicy.encryptionAlgorithm,
      )
    } finally {
      releaseMemory?.()
    }
    return
  }
  if (!(await plainSqliteExists(databasePath))) return
  assertDatabaseSnapshotCapacity(getDb(), 'encrypted-sqlite-whole-snapshot')
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
  }
  await sealSqliteFile(
    databasePath,
    sealedDatabasePath,
    hexKey,
    activeEncryptionPolicy.encryptionAlgorithm,
  )
}

async function maybeSealDatabase() {
  if (
    !activeEncryptionPolicy?.sqliteEncryption
    || isExternalDatabaseConfiguration(activeDatabaseConfiguration)
    || (
      process.env.NODE_ENV === 'test'
      && process.env.PHD_ATLAS_FORCE_SQLITE_SEAL_TEST !== '1'
    )
  ) return
  sealRequestedGeneration += 1
  if (sealInFlightPromise) return sealInFlightPromise
  const seal = (async () => {
    while (sealCompletedGeneration < sealRequestedGeneration) {
      const generation = sealRequestedGeneration
      if (!activeEncryptionPolicy?.sqliteEncryption) {
        sealCompletedGeneration = generation
        break
      }
      try {
        await performSqliteSeal()
      } catch (cause) {
        const error = new Error('The encrypted SQLite snapshot could not be persisted.')
        error.code = 'SQLITE_SEAL_FAILED'
        error.status = 503
        error.retryable = true
        error.cause = cause
        throw error
      }
      sealCompletedGeneration = generation
    }
  })()
  sealInFlightPromise = seal
  try {
    await seal
  } finally {
    if (sealInFlightPromise === seal) sealInFlightPromise = null
  }
}

/**
 * Resolve only after the mutation is recoverable from the configured source of
 * truth. External engines acknowledge the exact revision snapshot; encrypted
 * local SQLite acknowledges the sealed image. Plain local SQLite transactions
 * are already the durable boundary.
 */
async function acknowledgeDurableStorageMutation() {
  durableStorageAckCounters.attempts += 1
  if (durableStorageAcknowledgementFailpoint) {
    try {
      await durableStorageAcknowledgementFailpoint()
    } catch (error) {
      durableStorageAckCounters.failures += 1
      throw error
    }
  }
  if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
    try {
      await synchronizeExternalDatabase({ force: true })
      durableStorageAckCounters.successes += 1
    } catch (error) {
      durableStorageAckCounters.failures += 1
      throw error
    }
    return
  }
  if (!activeEncryptionPolicy?.sqliteEncryption) {
    durableStorageAckCounters.successes += 1
    return
  }
  if (sealAfterWriteTimer) {
    clearTimeout(sealAfterWriteTimer)
    sealAfterWriteTimer = null
  }
  try {
    await maybeSealDatabase()
    durableStorageAckCounters.successes += 1
  } catch (error) {
    durableStorageAckCounters.failures += 1
    throw error
  }
}

export function durableStorageAckDiagnostics() {
  return { ...durableStorageAckCounters }
}

export function configureDurableStorageAcknowledgementFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Durable storage acknowledgement failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Durable storage acknowledgement failpoints are available only in tests.')
  }
  durableStorageAcknowledgementFailpoint = failpoint
}

export function configureStorageShutdownDurabilityFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Storage shutdown durability failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Storage shutdown durability failpoints are available only in tests.')
  }
  storageShutdownDurabilityFailpoint = failpoint
}

export function configureDatabaseConfigurationSealFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Database configuration seal failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Database configuration seal failpoints are available only in tests.')
  }
  databaseConfigurationSealFailpoint = failpoint
}

export function configureStorageInitializationFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Storage initialization failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Storage initialization failpoints are available only in tests.')
  }
  storageInitializationFailpoint = failpoint
}

export function configureDatabaseHandleReplacementFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Database handle replacement failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Database handle replacement failpoints are available only in tests.')
  }
  databaseHandleReplacementFailpoint = failpoint
}

async function acknowledgeSecurityStorageMutation(mutated = true) {
  if (mutated) securityDurableMutationGeneration += 1
  if (securityDurableAckPromise) {
    await securityDurableAckPromise
    return acknowledgeSecurityStorageMutation(false)
  }
  if (securityDurableAcknowledgedGeneration >= securityDurableMutationGeneration) return

  const acknowledgement = (async () => {
    do {
      // Apply resident last-used overlays before capturing the security
      // snapshot. One seal/sync then acknowledges both security and telemetry.
      await flushCodexAuthorizationLastUsed()
      const securityGeneration = securityDurableMutationGeneration
      const telemetryGeneration = codexTelemetryMutationGeneration
      clearCodexAuthorizationLastUsedFlushTimer()
      await acknowledgeDurableStorageMutation()
      securityDurableAcknowledgedGeneration = Math.max(
        securityDurableAcknowledgedGeneration,
        securityGeneration,
      )
      if (codexTelemetryMutationGeneration === telemetryGeneration) codexTelemetryDirty = false
    } while (securityDurableAcknowledgedGeneration < securityDurableMutationGeneration)
  })()
  securityDurableAckPromise = acknowledgement
  try {
    await acknowledgement
  } finally {
    if (securityDurableAckPromise === acknowledgement) securityDurableAckPromise = null
    if (pendingCodexAuthorizationLastUsed.size > 0 || codexTelemetryDirty) {
      scheduleCodexAuthorizationLastUsedFlush()
    }
  }
}

export async function flushDurableStorage() {
  await ensureStorage()
  await acknowledgeDurableStorageMutation()
}

async function reconcileSqliteEncryptionMode() {
  await ensureEncryptedSqliteProcessLease()
  const shouldUseMemory = databaseShouldRunInMemory()
  if (shouldUseMemory === databaseRunsInMemory) {
    if (shouldUseMemory) await maybeSealDatabase()
    return
  }

  return withDatabaseHandleReplacement(async () => {
    const targetUsesMemory = databaseShouldRunInMemory()
    if (targetUsesMemory === databaseRunsInMemory) return
    await drainDatabaseActivityBeforeHandleReplacement()

    if (targetUsesMemory) {
      const database = getDb()
      applySnapshotStoragePageLimit(database, configuredSnapshotStorageMode())
      assertDatabaseSnapshotCapacity(database, configuredSnapshotStorageMode())
      try { database.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
      const releaseMemory = acquireStoreSnapshotMemory(database)
      try {
        const image = database.serialize()
        if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
          await sealSqliteBuffer(
            image,
            sealedDatabasePath,
            deriveSqliteKey(),
            activeEncryptionPolicy.encryptionAlgorithm,
          )
        }
        clearPendingDatabaseImage()
        pendingDatabaseImage = sqliteImageForMemory(image)
        closeOpenDatabase()
        databaseRunsInMemory = true
        getDb()
        await removePlainSqliteArtifacts()
      } finally {
        releaseMemory?.()
      }
      return
    }

    await drainSqliteSealBeforeStorageTransition()
    const snapshotDatabase = db
    const releaseMemory = snapshotDatabase ? acquireStoreSnapshotMemory(snapshotDatabase) : null
    const pendingImage = snapshotDatabase
      ? { image: null, releaseMemory: null }
      : clearPendingDatabaseImage({ release: false })
    try {
      const image = snapshotDatabase?.serialize() ?? pendingImage.image
      if (!image) throw new Error('Cannot disable SQLite encryption without a valid database image.')
      await writeSnapshotFile(databasePath, image)
      closeOpenDatabase()
      databaseRunsInMemory = false
      getDb()
      if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
        await fs.rm(sealedDatabasePath, { force: true })
      }
    } finally {
      releaseMemory?.()
      pendingImage.releaseMemory?.()
    }
  })
}

function scheduleSealDatabase() {
  if (
    !activeEncryptionPolicy?.sqliteEncryption
    || isExternalDatabaseConfiguration(activeDatabaseConfiguration)
  ) return
  if (sealAfterWriteTimer) clearTimeout(sealAfterWriteTimer)
  sealAfterWriteTimer = setTimeout(() => {
    sealAfterWriteTimer = null
    void maybeSealDatabase().catch((error) => {
      console.error('[storage] Failed to seal SQLite database:', error)
    })
  }, 1500)
}

function getDb() {
  assertDatabaseAccessAllowed()
  if (db) {
    return db
  }

  const pendingImage = clearPendingDatabaseImage({ release: false })
  let initialImage = pendingImage.image
  let rawDatabase
  try {
    rawDatabase = initialImage ? new Database(initialImage) : new Database(databasePath)
  } finally {
    initialImage = null
    pendingImage.releaseMemory?.()
  }
  const schemaVersionBefore = Number(rawDatabase.pragma('schema_version', { simple: true }))
  // New databases opt into bounded incremental page reclamation before the
  // first table is created. Existing installations keep their on-disk format;
  // converting them would require a blocking full VACUUM and extra disk space.
  if (!databaseRunsInMemory && schemaVersionBefore === 0) {
    rawDatabase.pragma('auto_vacuum = INCREMENTAL')
  }
  // Most domain helpers issue focused SQL writes directly instead of going through
  // writeStore(). Track statement mutations here so the selected external engine
  // remains current even for passkeys, notifications, mail cursors, and teams.
  db = new Proxy(rawDatabase, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (...args) => {
          const statement = target.prepare(...args)
          const transientWorkspaceStatement = /\bworkspace_dedup_[a-f0-9]+\b/iu.test(String(args[0] ?? ''))
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              const value = Reflect.get(statementTarget, statementProperty, statementReceiver)
              if (
                statementTarget.readonly === false
                && !transientWorkspaceStatement
                && (statementProperty === 'run' || statementProperty === 'get' || statementProperty === 'all')
              ) {
                return (...statementArgs) => {
                  assertDatabaseMutationAllowed()
                  try {
                    const result = value.apply(statementTarget, statementArgs)
                    if (!shouldDeferTelemetryPersistence()) {
                      scheduleExternalDatabaseSync()
                      scheduleSealDatabase()
                    }
                    return result
                  } catch (error) {
                    throw normalizeSqliteFullAsSnapshotCapacity(
                      error,
                      snapshotStorageDiagnostics(),
                    )
                  }
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
  // Production aggregate/de-duplication work can legitimately exceed the
  // resident heap even when every entity is hydrated one at a time. Keep TEMP
  // pages file-backed for durable databases; isolated in-memory tests retain
  // their expected zero-filesystem behavior.
  db.pragma(databaseRunsInMemory ? 'temp_store = MEMORY' : 'temp_store = FILE')
  db.pragma(`busy_timeout = ${normalizeSqliteBusyTimeoutMs()}`)
  // Bound SQLite's hot-page cache and allow read-only pages to be served from
  // mmap. This reduces repeated filesystem reads during parallel workspace GETs
  // without weakening WAL durability semantics.
  db.pragma('cache_size = -32768')
  if (!databaseRunsInMemory) {
    db.pragma('mmap_size = 134217728')
    db.pragma('wal_autocheckpoint = 1000')
    db.pragma('journal_size_limit = 16777216')
  }
  db.pragma('foreign_keys = ON')
  applySnapshotStoragePageLimit(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      allow_registration INTEGER NOT NULL,
      admin_entry_hidden INTEGER NOT NULL DEFAULT 0,
      admin_entry_code_hash TEXT NOT NULL DEFAULT '',
      admin_entry_code_salt TEXT NOT NULL DEFAULT '',
      notification_mailbox TEXT NOT NULL,
      system_log_retention_days INTEGER NOT NULL DEFAULT ${DEFAULT_SYSTEM_LOG_RETENTION_DAYS},
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
      canonical_email TEXT NOT NULL DEFAULT '',
      recovery_email TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'en',
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      auth_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      disabled_at TEXT,
      settings_version INTEGER NOT NULL DEFAULT 0,
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
      payload_version INTEGER NOT NULL DEFAULT 0,
      authored_hash TEXT NOT NULL DEFAULT '',
      authority_hash TEXT NOT NULL DEFAULT '',
      transfer_request_id TEXT,
      transfer_team_id TEXT,
      transfer_direction TEXT,
      transfer_status TEXT,
      transfer_requested_by TEXT,
      transfer_requested_at TEXT,
      transfer_incoming_bytes INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_applications_owner_deadline
      ON applications(owner_id, deadline);
    CREATE INDEX IF NOT EXISTS idx_applications_owner_status
      ON applications(owner_id, status);

    CREATE TABLE IF NOT EXISTS school_logo_cache (
      cache_key TEXT PRIMARY KEY,
      website_url TEXT NOT NULL,
      data_url TEXT,
      source_url TEXT,
      candidate_kind TEXT,
      found INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_logo_assets (
      asset_key TEXT PRIMARY KEY,
      data_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      team_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_version INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discover_source_indexes (
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'personal',
      payload_json TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_discover_source_indexes_user_updated
      ON discover_source_indexes(user_id, updated_at DESC);

    -- The last admission-signal lookup for one application, so reopening the
    -- tab shows the previous answer instead of an empty panel and a button.
    -- Deliberately its own table rather than a field on the application: the
    -- report is large, is rewritten wholesale, and is read only by the one tab
    -- that displays it, so it must never join the record every list request
    -- and every offline snapshot has to carry.
    CREATE TABLE IF NOT EXISTS admission_signal_reports (
      user_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, application_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_admission_signal_reports_user_updated
      ON admission_signal_reports(user_id, updated_at DESC);

    -- 招生数据历史记录表（用于趋势图）
    CREATE TABLE IF NOT EXISTS admission_signal_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      query_date TEXT NOT NULL,
      accepted_count INTEGER DEFAULT 0,
      rejected_count INTEGER DEFAULT 0,
      waitlisted_count INTEGER DEFAULT 0,
      interview_count INTEGER DEFAULT 0,
      total_count INTEGER DEFAULT 0,
      accepted_share REAL DEFAULT 0,
      has_public_award INTEGER DEFAULT 0,
      award_count INTEGER DEFAULT 0,
      program_name TEXT,
      school_name TEXT,
      advisor_name TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, application_id, query_date)
    );
    CREATE INDEX IF NOT EXISTS idx_admission_history_app_date
      ON admission_signal_history(application_id, query_date DESC);

    -- 招生数据收藏表
    CREATE TABLE IF NOT EXISTS admission_bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      bookmark_type TEXT NOT NULL CHECK(bookmark_type IN ('outcome', 'funding', 'discussion')),
      title TEXT NOT NULL,
      data_json TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_admission_bookmarks_user_app
      ON admission_bookmarks(user_id, application_id);

    -- 招生数据通知订阅表
    CREATE TABLE IF NOT EXISTS admission_notification_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      email_enabled INTEGER DEFAULT 1,
      desktop_enabled INTEGER DEFAULT 0,
      last_check_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- File downloads resolve through this compact authorization descriptor
    -- instead of decrypting every application and Profile asset in the
    -- workspace. Payload writers replace the owning source's rows in the same
    -- transaction as the canonical JSON update.
    CREATE TABLE IF NOT EXISTS workspace_file_references (
      file_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('application', 'profile')),
      source_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      team_id TEXT,
      storage_name TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0 CHECK(file_size >= 0),
      reference_kind TEXT NOT NULL,
      source_version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(source_kind, source_id, file_id, storage_name)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_file_references_file
      ON workspace_file_references(file_id, source_kind, source_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_file_references_source
      ON workspace_file_references(source_kind, source_id);

    -- Public capability tokens are indexed only by a domain-separated digest.
    -- Raw share/calendar values remain inside their canonical encrypted or
    -- settings payload and are revalidated after the one target is hydrated.
    CREATE TABLE IF NOT EXISTS workspace_public_grants (
      grant_kind TEXT NOT NULL CHECK(grant_kind IN ('application-share', 'profile-share', 'calendar')),
      token_hash TEXT NOT NULL,
      source_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      team_id TEXT,
      grant_id TEXT NOT NULL,
      expires_at TEXT,
      source_version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(grant_kind, token_hash, source_id, grant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_public_grants_token
      ON workspace_public_grants(grant_kind, token_hash);
    CREATE INDEX IF NOT EXISTS idx_workspace_public_grants_source
      ON workspace_public_grants(grant_kind, source_id);

    -- A derived, transactionally maintained quota index keeps background mail
    -- sync away from arbitrary tenant payloads. Each logical source contributes
    -- JSON bytes to exactly one or more billing domains; upload references are
    -- normalized separately so one physical file is charged only once per
    -- domain even when several applications reference it.
    CREATE TABLE IF NOT EXISTS workspace_quota_sources (
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      domain_kind TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      source_version INTEGER NOT NULL DEFAULT 0,
      data_bytes INTEGER NOT NULL DEFAULT 0 CHECK(data_bytes >= 0),
      PRIMARY KEY(source_kind, source_id, domain_kind, domain_id)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_quota_sources_domain
      ON workspace_quota_sources(domain_kind, domain_id);

    CREATE TABLE IF NOT EXISTS workspace_quota_uploads (
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      domain_kind TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      storage_name TEXT NOT NULL,
      file_bytes INTEGER NOT NULL DEFAULT 0 CHECK(file_bytes >= 0),
      PRIMARY KEY(source_kind, source_id, domain_kind, domain_id, storage_name)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_quota_uploads_domain
      ON workspace_quota_uploads(domain_kind, domain_id, storage_name);

    CREATE TABLE IF NOT EXISTS workspace_quota_processes (
      instance_id TEXT PRIMARY KEY,
      host_name TEXT NOT NULL,
      process_id INTEGER NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_quota_reservations (
      token_hash TEXT PRIMARY KEY,
      token_encrypted TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      domain_kind TEXT NOT NULL CHECK(domain_kind IN ('personal', 'team')),
      domain_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('user', 'application', 'profile', 'backup')),
      source_id TEXT NOT NULL,
      expected_source_version INTEGER NOT NULL DEFAULT 0,
      request_id TEXT NOT NULL,
      process_instance_id TEXT NOT NULL,
      observed_files_json TEXT NOT NULL DEFAULT '[]',
      reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes >= 0),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE(request_id, source_kind, source_id),
      FOREIGN KEY(process_instance_id) REFERENCES workspace_quota_processes(instance_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_quota_reservations_domain
      ON workspace_quota_reservations(domain_kind, domain_id, expires_at);

    CREATE TABLE IF NOT EXISTS workspace_upload_deletions (
      storage_name TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      claim_token_hash TEXT,
      claimed_by TEXT,
      claim_expires_at TEXT,
      FOREIGN KEY(claimed_by) REFERENCES workspace_quota_processes(instance_id) ON DELETE SET NULL
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS workspace_backup_deletions (
      file_name TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      file_bytes INTEGER NOT NULL CHECK(file_bytes >= 0),
      source_version INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS system_events (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_event_maintenance (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count >= 0),
      hard_limit INTEGER NOT NULL CHECK(hard_limit >= 1),
      last_pruned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS automatic_backup_state (
      actor_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      last_auto_backup_at TEXT NOT NULL,
      frequency TEXT NOT NULL,
      max_backups INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (actor_id, application_id)
    ) WITHOUT ROWID;

    ${CODEX_AUTHORIZATION_SCHEMA_SQL}

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

    CREATE TABLE IF NOT EXISTS security_challenges (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      subject_hash TEXT NOT NULL DEFAULT '',
      context_hash TEXT NOT NULL DEFAULT '',
      verifier_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL,
      not_before_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_security_challenges_expiry
      ON security_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS security_rate_limits (
      key_hash TEXT PRIMARY KEY,
      bucket_name TEXT NOT NULL,
      window_started_at INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_security_rate_limits_updated
      ON security_rate_limits(updated_at);

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
      sync_job_terminal_status TEXT,
      sync_job_created_at TEXT,
      sync_job_started_at TEXT,
      sync_job_completed_at TEXT,
      sync_job_result_json TEXT NOT NULL DEFAULT '{}',
      sync_job_error_code TEXT,
      sync_job_error_message TEXT,
      sync_job_attempt_count INTEGER NOT NULL DEFAULT 0,
      sync_job_schedule_sequence INTEGER NOT NULL DEFAULT 0,
      sync_job_next_attempt_at TEXT,
      sync_job_resume_json TEXT NOT NULL DEFAULT '{}',
      sync_successor_job_id TEXT,
      sync_successor_job_mode TEXT,
      sync_successor_job_created_at TEXT,
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
      push_enqueued_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
      ON notifications(user_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS system_mail_jobs (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_encrypted TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      expires_at TEXT,
      started_at TEXT,
      dispatch_started_at TEXT,
      completed_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      last_error_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_system_mail_jobs_claim
      ON system_mail_jobs(status, next_attempt_at, available_at, created_at);

    -- User-composed SMTP delivery has a narrow durable owner separate from the
    -- application aggregate. The accepted state is the irreversible boundary: once
    -- SMTP acknowledges a message, recovery may finish the application row but
    -- must never claim the communication for network delivery again.
    CREATE TABLE IF NOT EXISTS outgoing_mail_deliveries (
      communication_id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL UNIQUE,
      application_id TEXT NOT NULL,
      delivery_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'sending', 'accepted', 'sent', 'cancelled')),
      communication_encrypted TEXT NOT NULL,
      message_id TEXT NOT NULL,
      smtp_message_id TEXT,
      source_message_key TEXT,
      created_at TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      started_at TEXT,
      dispatch_started_at TEXT,
      accepted_at TEXT,
      completed_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      next_attempt_at TEXT,
      last_error_code TEXT,
      last_error_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_outgoing_mail_deliveries_claim
      ON outgoing_mail_deliveries(status, next_attempt_at, scheduled_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_outgoing_mail_deliveries_application
      ON outgoing_mail_deliveries(application_id, updated_at DESC);

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

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      seat_limit INTEGER NOT NULL DEFAULT 5,
      logo_data_url TEXT NOT NULL DEFAULT '',
      profile_presets_json TEXT,
      teacher_groups_json TEXT,
      permission_defaults_json TEXT NOT NULL DEFAULT '{}',
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_invite_hash
      ON team_members(invite_token_hash);

    -- Invite capability material lives in a compact state machine. Only the
    -- SHA-256 digest is persisted: public preview and terminal transitions can
    -- probe this primary-key index without hydrating a member profile or any
    -- application payload. Keeping terminal rows also makes concurrent/replayed
    -- transitions observable without retaining the bearer token itself.
    CREATE TABLE IF NOT EXISTS team_invites (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL UNIQUE,
      team_id TEXT NOT NULL,
      invited_email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      invited_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'accepted', 'declined', 'revoked')),
      accepted_by TEXT,
      terminal_at TEXT,
      state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(member_id) REFERENCES team_members(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(invited_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(accepted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_team_invites_member_status
      ON team_invites(member_id, status);
    CREATE INDEX IF NOT EXISTS idx_team_invites_team_status_expiry
      ON team_invites(team_id, status, expires_at);

    INSERT OR IGNORE INTO team_invites (
      token_hash, member_id, team_id, invited_email, role, invited_by,
      expires_at, status, accepted_by, terminal_at, state_version,
      created_at, updated_at
    )
    SELECT invite_token_hash, id, team_id, lower(invited_email), role, invited_by,
           invite_expires_at, 'pending', NULL, NULL, 0, created_at, updated_at
      FROM team_members
     WHERE invite_token_hash IS NOT NULL
       AND invite_token_hash <> ''
       AND invite_expires_at IS NOT NULL
       AND status = 'pending'
       AND role IN ('admin', 'member');

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
      max_concurrency INTEGER NOT NULL DEFAULT 4 CHECK(max_concurrency BETWEEN 1 AND ${AI_KEY_MAX_CONCURRENCY}),
      request_mode TEXT NOT NULL DEFAULT 'auto' CHECK(request_mode IN ('auto', 'responses', 'chat_completions')),
      selection_weight INTEGER NOT NULL DEFAULT 50 CHECK(selection_weight BETWEEN ${AI_KEY_MIN_WEIGHT} AND ${AI_KEY_MAX_WEIGHT}),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_api_keys_owner
      ON ai_api_keys(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_api_keys_team
      ON ai_api_keys(team_id, created_at DESC);

    -- Interview preparation is intentionally kept outside users.settings_json.
    -- Every authored payload in this aggregate is always application-encrypted,
    -- even when the workspace-wide at-rest switch is disabled.
    CREATE TABLE IF NOT EXISTS interview_workspaces (
      scope_key TEXT PRIMARY KEY,
      subject_user_id TEXT NOT NULL,
      team_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
      fingerprint TEXT NOT NULL,
      payload_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_workspaces_subject_scope
      ON interview_workspaces(subject_user_id, COALESCE(team_id, ''));
    CREATE INDEX IF NOT EXISTS idx_interview_workspaces_subject_team_updated
      ON interview_workspaces(subject_user_id, team_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interview_workspaces_team_updated
      ON interview_workspaces(team_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS interview_events (
      workspace_scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      payload_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_scope_key, id),
      FOREIGN KEY(workspace_scope_key) REFERENCES interview_workspaces(scope_key) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interview_events_workspace_position
      ON interview_events(workspace_scope_key, position);
    CREATE INDEX IF NOT EXISTS idx_interview_events_workspace_updated
      ON interview_events(workspace_scope_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS interview_questions (
      workspace_scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      interview_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      payload_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_scope_key, id),
      FOREIGN KEY(workspace_scope_key) REFERENCES interview_workspaces(scope_key) ON DELETE CASCADE,
      FOREIGN KEY(workspace_scope_key, interview_id)
        REFERENCES interview_events(workspace_scope_key, id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interview_questions_event_position
      ON interview_questions(workspace_scope_key, interview_id, position);
    CREATE INDEX IF NOT EXISTS idx_interview_questions_workspace_updated
      ON interview_questions(workspace_scope_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS interview_sessions (
      workspace_scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      interview_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      payload_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_scope_key, id),
      FOREIGN KEY(workspace_scope_key) REFERENCES interview_workspaces(scope_key) ON DELETE CASCADE,
      FOREIGN KEY(workspace_scope_key, interview_id)
        REFERENCES interview_events(workspace_scope_key, id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interview_sessions_event_position
      ON interview_sessions(workspace_scope_key, interview_id, position);
    CREATE INDEX IF NOT EXISTS idx_interview_sessions_workspace_updated
      ON interview_sessions(workspace_scope_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS interview_feedback (
      workspace_scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      interview_id TEXT NOT NULL,
      session_id TEXT,
      question_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      payload_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_scope_key, id),
      FOREIGN KEY(workspace_scope_key) REFERENCES interview_workspaces(scope_key) ON DELETE CASCADE,
      FOREIGN KEY(workspace_scope_key, interview_id)
        REFERENCES interview_events(workspace_scope_key, id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_scope_key, session_id)
        REFERENCES interview_sessions(workspace_scope_key, id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_scope_key, question_id)
        REFERENCES interview_questions(workspace_scope_key, id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interview_feedback_event_updated
      ON interview_feedback(workspace_scope_key, interview_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interview_feedback_session
      ON interview_feedback(workspace_scope_key, session_id);
    CREATE INDEX IF NOT EXISTS idx_interview_feedback_question
      ON interview_feedback(workspace_scope_key, question_id);

    CREATE TABLE IF NOT EXISTS interview_workspace_requests (
      workspace_scope_key TEXT NOT NULL,
      request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result_revision INTEGER NOT NULL CHECK(result_revision >= 1),
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(workspace_scope_key, request_id),
      FOREIGN KEY(workspace_scope_key) REFERENCES interview_workspaces(scope_key) ON DELETE CASCADE,
      FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interview_workspace_requests_created
      ON interview_workspace_requests(workspace_scope_key, created_at DESC);
  `)

  migrateCodexAuthorizationScopeVersionSchema(db)

  // Install the durable clock before any data migrations below. Existing and
  // newly-created tables then bump revision inside the same SQLite statement
  // that changes their rows, including startup recovery updates.
  const revisionInitialization = initializeDurableWorkspaceRevision(
    rawDatabase,
    schemaVersionBefore,
    pendingDatabaseRevisionFloor,
  )
  const revisionTriggerSchemaVersion = Number(rawDatabase.pragma('schema_version', { simple: true }))

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
  addSystemColumn('admin_entry_hidden', 'INTEGER NOT NULL DEFAULT 0')
  addSystemColumn('admin_entry_code_hash', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn('admin_entry_code_salt', "TEXT NOT NULL DEFAULT ''")
  addSystemColumn(
    'system_log_retention_days',
    `INTEGER NOT NULL DEFAULT ${DEFAULT_SYSTEM_LOG_RETENTION_DAYS}`,
  )

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
  addAiKeyColumn('max_concurrency', 'INTEGER NOT NULL DEFAULT 4')
  addAiKeyColumn('request_mode', "TEXT NOT NULL DEFAULT 'auto'")
  addAiKeyColumn('selection_weight', 'INTEGER NOT NULL DEFAULT 50')
  addAiKeyColumn('enabled', 'INTEGER NOT NULL DEFAULT 1')
  migrateAiKeyConcurrencySchema(rawDatabase)

  const codexDeviceAuthorizationColumns = new Set(
    db.prepare('PRAGMA table_info(codex_device_authorizations)').all().map((column) => column.name),
  )
  const addCodexDeviceAuthorizationColumn = (name, definition) => {
    if (!codexDeviceAuthorizationColumns.has(name)) {
      db.prepare(`ALTER TABLE codex_device_authorizations ADD COLUMN ${name} ${definition}`).run()
    }
  }
  addCodexDeviceAuthorizationColumn('requested_expires_in_days', 'INTEGER NOT NULL DEFAULT 365')
  addCodexDeviceAuthorizationColumn('approved_expires_in_days', 'INTEGER')
  addCodexDeviceAuthorizationColumn('approved_name', 'TEXT')

  const codexAuthorizationColumns = new Set(
    db.prepare('PRAGMA table_info(codex_authorizations)').all().map((column) => column.name),
  )
  // Pausing is deliberately its own column rather than a revocation reason:
  // clearing `revoked_at` to resume would make a genuinely revoked credential
  // resurrectable, which a reversible pause must never be able to do.
  if (!codexAuthorizationColumns.has('disabled_at')) {
    db.prepare('ALTER TABLE codex_authorizations ADD COLUMN disabled_at TEXT').run()
  }

  const userColumns = new Set(
    db.prepare('PRAGMA table_info(users)').all().map((column) => column.name),
  )
  const authVersionColumnAdded = !userColumns.has('auth_version')
  if (!userColumns.has('disabled_at')) {
    db.prepare('ALTER TABLE users ADD COLUMN disabled_at TEXT').run()
  }
  if (!userColumns.has('settings_version')) {
    db.prepare('ALTER TABLE users ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 0').run()
  }
  if (!userColumns.has('canonical_email')) {
    db.prepare("ALTER TABLE users ADD COLUMN canonical_email TEXT NOT NULL DEFAULT ''").run()
  }
  if (!userColumns.has('recovery_email')) {
    db.prepare("ALTER TABLE users ADD COLUMN recovery_email TEXT NOT NULL DEFAULT ''").run()
  }
  if (!userColumns.has('language')) {
    db.prepare("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'").run()
  }
  if (authVersionColumnAdded) {
    db.prepare('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0').run()
  }
  const updateAccountAuthProjection = db.prepare(
    `UPDATE users
        SET canonical_email = ?, recovery_email = ?, language = ?, auth_version = ?
      WHERE id = ?`,
  )
  const selectAccountAuthProjectionBatch = db.prepare(
    `SELECT rowid AS storage_rowid, id, email, settings_json, auth_version,
            canonical_email, recovery_email, language
       FROM users
      WHERE rowid > ?
        AND (canonical_email = '' OR recovery_email = '' OR language = '' OR ? = 1)
      ORDER BY rowid ASC
      LIMIT ?`,
  )
  let accountAuthProjectionCursor = 0
  while (true) {
    // Materialize one bounded page before updating on the same connection.
    // better-sqlite3 intentionally rejects a write while an .iterate() query
    // still owns the connection, and an unbounded .all() would scale with the
    // entire tenant rather than this fixed migration budget.
    const rows = selectAccountAuthProjectionBatch.all(
      accountAuthProjectionCursor,
      authVersionColumnAdded ? 1 : 0,
      256,
    )
    if (rows.length === 0) break
    for (const row of rows) {
      const projection = accountAuthProjectionFromRow(row)
      updateAccountAuthProjection.run(
        projection.canonicalEmail,
        projection.recoveryEmail,
        projection.language,
        projection.authVersion,
        row.id,
      )
    }
    accountAuthProjectionCursor = rows.at(-1).storage_rowid
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_canonical_email
      ON users(canonical_email);
    CREATE INDEX IF NOT EXISTS idx_users_recovery_email_created
      ON users(recovery_email, created_at, id);
  `)

  const applicationColumns = new Set(
    db.prepare('PRAGMA table_info(applications)').all().map((column) => column.name),
  )
  if (!applicationColumns.has('team_id')) {
    db.prepare('ALTER TABLE applications ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL').run()
  }
  if (!applicationColumns.has('payload_version')) {
    db.prepare('ALTER TABLE applications ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 0').run()
  }
  if (!applicationColumns.has('authored_hash')) {
    db.prepare("ALTER TABLE applications ADD COLUMN authored_hash TEXT NOT NULL DEFAULT ''").run()
  }
  if (!applicationColumns.has('authority_hash')) {
    db.prepare("ALTER TABLE applications ADD COLUMN authority_hash TEXT NOT NULL DEFAULT ''").run()
  }
  if (!applicationColumns.has('transfer_request_id')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_request_id TEXT').run()
  }
  if (!applicationColumns.has('transfer_team_id')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_team_id TEXT').run()
  }
  if (!applicationColumns.has('transfer_direction')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_direction TEXT').run()
  }
  if (!applicationColumns.has('transfer_status')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_status TEXT').run()
  }
  if (!applicationColumns.has('transfer_requested_by')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_requested_by TEXT').run()
  }
  if (!applicationColumns.has('transfer_requested_at')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_requested_at TEXT').run()
  }
  if (!applicationColumns.has('transfer_incoming_bytes')) {
    db.prepare('ALTER TABLE applications ADD COLUMN transfer_incoming_bytes INTEGER NOT NULL DEFAULT 0').run()
  }
  const profileAssetColumns = new Set(
    db.prepare('PRAGMA table_info(profile_assets)').all().map((column) => column.name),
  )
  if (!profileAssetColumns.has('payload_version')) {
    db.prepare('ALTER TABLE profile_assets ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 0').run()
  }
  if (!profileAssetColumns.has('team_id')) {
    db.prepare('ALTER TABLE profile_assets ADD COLUMN team_id TEXT').run()
    const updateTeamId = db.prepare('UPDATE profile_assets SET team_id = ? WHERE id = ?')
    // Materialize before mutating the same table. better-sqlite3 correctly
    // refuses UPDATE while the SELECT iterator still owns the connection.
    for (const row of db.prepare('SELECT id, payload_json FROM profile_assets').all()) {
      const payload = decodePayloadFromStorage(row.payload_json)
      updateTeamId.run(String(payload.teamId ?? '').trim() || null, row.id)
    }
  }
  // Section streams advance by the visible sort key. Include the stable id
  // tie-breaker in the same index so a high-cardinality cursor does not sort
  // or rescan an ever-growing prefix for every LIMIT 1 step.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_applications_owner_deadline_id
      ON applications(owner_id, deadline, id);
    CREATE INDEX IF NOT EXISTS idx_applications_team_deadline_id
      ON applications(team_id, deadline, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_transfer_request_id
      ON applications(transfer_request_id)
      WHERE transfer_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_applications_transfer_team_status
      ON applications(transfer_team_id, transfer_status, updated_at, id);
    CREATE INDEX IF NOT EXISTS idx_profile_assets_owner_updated_id
      ON profile_assets(owner_id, updated_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_profile_assets_team_updated_id
      ON profile_assets(team_id, updated_at DESC, id);
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS users_settings_version_after_update
    AFTER UPDATE OF settings_json ON users
    WHEN OLD.settings_json IS NOT NEW.settings_json
    BEGIN
      UPDATE users
         SET settings_version = OLD.settings_version + 1
       WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS applications_payload_version_after_update
    AFTER UPDATE OF payload_json ON applications
    WHEN OLD.payload_json IS NOT NEW.payload_json
    BEGIN
      UPDATE applications
         SET payload_version = OLD.payload_version + 1
       WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS profile_assets_payload_version_after_update
    AFTER UPDATE OF payload_json ON profile_assets
    WHEN OLD.payload_json IS NOT NEW.payload_json
    BEGIN
      UPDATE profile_assets
         SET payload_version = OLD.payload_version + 1
       WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS applications_file_references_after_identity_update
    AFTER UPDATE OF owner_id, team_id ON applications
    BEGIN
      UPDATE workspace_file_references
         SET owner_id = NEW.owner_id,
             team_id = NEW.team_id
       WHERE source_kind = 'application' AND source_id = NEW.id;
      UPDATE workspace_public_grants
         SET owner_id = NEW.owner_id,
             team_id = NEW.team_id
       WHERE grant_kind = 'application-share' AND source_id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS applications_file_references_after_delete
    AFTER DELETE ON applications
    BEGIN
      DELETE FROM workspace_file_references
       WHERE source_kind = 'application' AND source_id = OLD.id;
      DELETE FROM workspace_public_grants
       WHERE grant_kind = 'application-share' AND source_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS profile_assets_file_references_after_identity_update
    AFTER UPDATE OF owner_id, team_id ON profile_assets
    BEGIN
      UPDATE workspace_file_references
         SET owner_id = NEW.owner_id,
             team_id = NEW.team_id
       WHERE source_kind = 'profile' AND source_id = NEW.id;
      UPDATE workspace_public_grants
         SET owner_id = NEW.owner_id,
             team_id = NEW.team_id
       WHERE grant_kind = 'profile-share' AND source_id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS profile_assets_file_references_after_delete
    AFTER DELETE ON profile_assets
    BEGIN
      DELETE FROM workspace_file_references
       WHERE source_kind = 'profile' AND source_id = OLD.id;
      DELETE FROM workspace_public_grants
       WHERE grant_kind = 'profile-share' AND source_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS users_public_grants_after_delete
    AFTER DELETE ON users
    BEGIN
      DELETE FROM workspace_public_grants
       WHERE grant_kind = 'calendar' AND source_id = OLD.id;
    END;
  `)
  ensureWorkspaceFileReferenceIndex(db)
  ensureWorkspacePublicGrantIndex(db)
  ensureTeamTransferRequestIndex(db)
  const systemMailJobColumns = new Set(
    db.prepare('PRAGMA table_info(system_mail_jobs)').all().map((column) => column.name),
  )
  if (!systemMailJobColumns.has('dispatch_started_at')) {
    db.prepare('ALTER TABLE system_mail_jobs ADD COLUMN dispatch_started_at TEXT').run()
  }
  const outgoingMailDeliveryColumns = new Set(
    db.prepare('PRAGMA table_info(outgoing_mail_deliveries)').all().map((column) => column.name),
  )
  if (!outgoingMailDeliveryColumns.has('smtp_message_id')) {
    db.prepare('ALTER TABLE outgoing_mail_deliveries ADD COLUMN smtp_message_id TEXT').run()
  }
  if (!outgoingMailDeliveryColumns.has('source_message_key')) {
    db.prepare('ALTER TABLE outgoing_mail_deliveries ADD COLUMN source_message_key TEXT').run()
  }
  if (!outgoingMailDeliveryColumns.has('dispatch_started_at')) {
    db.prepare('ALTER TABLE outgoing_mail_deliveries ADD COLUMN dispatch_started_at TEXT').run()
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
  if (!teamColumns.has('permission_defaults_json')) {
    db.prepare("ALTER TABLE teams ADD COLUMN permission_defaults_json TEXT NOT NULL DEFAULT '{}'").run()
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
  if (!notificationColumns.has('push_enqueued_at')) {
    db.prepare('ALTER TABLE notifications ADD COLUMN push_enqueued_at TEXT').run()
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
    ['sync_job_terminal_status', 'TEXT'],
    ['sync_job_created_at', 'TEXT'],
    ['sync_job_started_at', 'TEXT'],
    ['sync_job_completed_at', 'TEXT'],
    ['sync_job_result_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['sync_job_error_code', 'TEXT'],
    ['sync_job_error_message', 'TEXT'],
    ['sync_job_attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['sync_job_schedule_sequence', 'INTEGER NOT NULL DEFAULT 0'],
    ['sync_job_next_attempt_at', 'TEXT'],
    ['sync_job_resume_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['sync_successor_job_id', 'TEXT'],
    ['sync_successor_job_mode', 'TEXT'],
    ['sync_successor_job_created_at', 'TEXT'],
  ]
  for (const [column, definition] of mailSyncJobColumns) {
    if (!mailFetchColumns.has(column)) {
      db.prepare(`ALTER TABLE mail_fetch_state ADD COLUMN ${column} ${definition}`).run()
    }
  }
  // `committing` is a durable terminal intent. The selected database or
  // encrypted snapshot acknowledged the complete result before the process
  // exposed success locally; a restart can therefore finish it without
  // replaying or losing already-filed mail.
  db.prepare(
    `UPDATE mail_fetch_state
     SET sync_job_status = CASE
           WHEN sync_job_terminal_status IN ('succeeded', 'failed', 'cancelled')
             THEN sync_job_terminal_status
           ELSE 'failed'
         END,
         sync_job_terminal_status = NULL
     WHERE sync_job_status = 'committing'`,
  ).run()
  // A process exit may interrupt an IMAP connection. When an explicit history
  // request arrived during that run, promote the durable successor because it
  // subsumes the interrupted incremental job. Otherwise resume the same job.
  db.prepare(
    `UPDATE mail_fetch_state
     SET sync_job_id = COALESCE(sync_successor_job_id, sync_job_id),
         sync_job_mode = CASE
           WHEN sync_successor_job_id IS NOT NULL THEN
             CASE WHEN sync_successor_job_mode = 'history' THEN 'history' ELSE 'incremental' END
           ELSE sync_job_mode
         END,
         sync_job_status = 'queued',
         sync_job_terminal_status = NULL,
         sync_job_created_at = COALESCE(sync_successor_job_created_at, sync_job_created_at),
         sync_job_started_at = NULL,
         sync_job_completed_at = CASE
           WHEN sync_successor_job_id IS NOT NULL THEN NULL
           ELSE sync_job_completed_at
         END,
         sync_job_result_json = CASE
           WHEN sync_successor_job_id IS NOT NULL THEN '{}'
           ELSE sync_job_result_json
         END,
         sync_job_error_code = CASE
           WHEN sync_successor_job_id IS NOT NULL THEN NULL
           ELSE sync_job_error_code
         END,
         sync_job_error_message = CASE
           WHEN sync_successor_job_id IS NOT NULL THEN NULL
           ELSE sync_job_error_message
         END,
         sync_job_attempt_count = CASE
           WHEN sync_successor_job_id IS NOT NULL THEN 0
           ELSE sync_job_attempt_count
         END,
         sync_job_schedule_sequence = 0,
         sync_job_next_attempt_at = NULL,
         sync_job_resume_json = CASE WHEN sync_successor_job_id IS NOT NULL THEN '{}' ELSE sync_job_resume_json END,
         sync_successor_job_id = NULL,
         sync_successor_job_mode = NULL,
         sync_successor_job_created_at = NULL
     WHERE sync_job_status = 'running'`,
  ).run()
  // Upgrade legacy queued jobs and recovered in-flight jobs to a persistent
  // FIFO position. Existing positive positions remain stable; recovered work
  // joins the tail so it cannot repeatedly jump ahead after process restarts.
  const backfillMailSyncSchedule = db.transaction(() => {
    const queuedRows = db.prepare(
      `SELECT user_id
       FROM mail_fetch_state
       WHERE sync_job_status = 'queued' AND sync_job_schedule_sequence <= 0
       ORDER BY COALESCE(sync_job_created_at, '') ASC, user_id ASC`,
    ).all()
    const setSequence = db.prepare(
      `UPDATE mail_fetch_state
       SET sync_job_schedule_sequence = ?
       WHERE user_id = ? AND sync_job_status = 'queued'
         AND sync_job_schedule_sequence <= 0`,
    )
    for (const queuedRow of queuedRows) {
      setSequence.run(nextMailSyncScheduleSequence(db), queuedRow.user_id)
    }
  })
  backfillMailSyncSchedule.immediate()
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_mail_fetch_sync_queue
     ON mail_fetch_state(sync_job_status, sync_job_next_attempt_at, sync_job_schedule_sequence)`,
  ).run()
  // MAX(sequence) is used for single retries/enqueues. Keep it logarithmic;
  // automatic bulk enqueue allocates once and then increments in memory.
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_mail_fetch_sync_schedule_sequence
     ON mail_fetch_state(sync_job_schedule_sequence DESC)`,
  ).run()
  db.prepare("UPDATE users SET role = 'user' WHERE role = 'owner'").run()
  db.prepare("UPDATE users SET role = 'user' WHERE email = ? AND role = 'admin'").run(DEFAULT_USER_EMAIL)
  db.prepare("UPDATE users SET role = 'user' WHERE role NOT IN ('admin', 'user')").run()
  // The Phase 19 before-benchmark deliberately keeps a legacy settings index in
  // its isolated test database so the same user can be measured before and
  // after migration. Production and ordinary tests always run the migration.
  const preserveLegacyDiscoverIndexForBenchmark = process.env.NODE_ENV === 'test'
    && process.env.PHD_ATLAS_BENCHMARK_PRESERVE_LEGACY_DISCOVER_INDEX === '1'
  if (!preserveLegacyDiscoverIndexForBenchmark) {
    migrateLegacyDiscoverSourceIndexes(rawDatabase)
  }

  const automaticBackupCompaction = compactLegacyAutomaticBackupEvents(rawDatabase)
  configureSystemEventMaintenance(rawDatabase, {
    hardLimit: normalizeSystemEventHardLimit(),
  })
  const systemEventRetention = rawDatabase
    .prepare('SELECT system_log_retention_days FROM system_settings WHERE id = ?')
    .get('global')
  const retentionCutoff = systemLogRetentionCutoff(systemEventRetention?.system_log_retention_days)
  if (retentionCutoff) {
    rawDatabase.prepare('DELETE FROM system_events WHERE time < ?').run(retentionCutoff)
  }
  if (!databaseRunsInMemory && automaticBackupCompaction.compactedRows > 0) {
    try {
      const fileStat = statSync(databasePath)
      const fileSystem = statfsSync(path.dirname(databasePath))
      const pageCount = Number(rawDatabase.pragma('page_count', { simple: true }))
      const freePages = Number(rawDatabase.pragma('freelist_count', { simple: true }))
      if (shouldVacuumAfterSystemEventCompaction({
        compactedRows: automaticBackupCompaction.compactedRows,
        pageCount,
        freePages,
        fileBytes: fileStat.size,
        availableBytes: Number(fileSystem.bavail) * Number(fileSystem.bsize),
        maxFileBytes: normalizeStartupVacuumMaxBytes(),
      })) {
        rawDatabase.exec('VACUUM')
      }
    } catch (error) {
      // Compaction is already committed and preserves aggregate evidence. A
      // failed best-effort VACUUM leaves reusable free pages, never partial data.
      console.warn('[storage] Skipped post-compaction SQLite VACUUM:', error?.message ?? error)
    }
  }
  // Replace legacy single-column/redundant indexes only after their covering
  // successors exist. Building them after compaction avoids indexing rows that
  // are about to be rolled into one operational audit heartbeat.
  installStoragePerformanceIndexes(rawDatabase)
  if (!databaseRunsInMemory && Number(rawDatabase.pragma('auto_vacuum', { simple: true })) === 2) {
    rawDatabase.pragma('incremental_vacuum(2048)')
  }
  rawDatabase.pragma('optimize = 0x10002')

  let revisionChanged = revisionInitialization.changed
  if (Number(rawDatabase.pragma('schema_version', { simple: true })) !== revisionTriggerSchemaVersion) {
    bumpDurableWorkspaceRevision(rawDatabase)
    revisionChanged = true
  }
  const initializedRevision = readDurableWorkspaceRevision(rawDatabase)
  if (initializedRevision !== revisionInitialization.revision) revisionChanged = true
  if (
    isExternalDatabaseConfiguration(activeDatabaseConfiguration)
    && (revisionChanged || initializedRevision > pendingDatabaseRevisionFloor)
  ) {
    durableRevisionRequiresExternalFlush = true
  }
  pendingDatabaseRevisionFloor = 0
  databaseHandleGeneration += 1

  return db
}

function settingsFromRow(row) {
  return {
    allowRegistration: intBool(row.allow_registration),
    adminEntryHidden: intBool(row.admin_entry_hidden ?? 0),
    adminEntryCodeHash: row.admin_entry_code_hash ?? '',
    adminEntryCodeSalt: row.admin_entry_code_salt ?? '',
    notificationMailbox: row.notification_mailbox,
    systemLogRetentionDays: normalizeSystemLogRetentionDays(row.system_log_retention_days),
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
  const {
    adminEntryCodeHash: _adminEntryCodeHash,
    adminEntryCodeSalt: _adminEntryCodeSalt,
    ...publicSettings
  } = settings
  return {
    ...publicSettings,
    adminEntryCodeSet: Boolean(settings.adminEntryCodeHash && settings.adminEntryCodeSalt),
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
  const authVersion = Math.max(
    normalizeAccountAuthVersion(row.auth_version),
    normalizeAccountAuthVersion(settings.authVersion),
  )
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeUserRole(row.role),
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at ?? null,
    settingsVersion: Math.max(0, Number(row.settings_version) || 0),
    settings: {
      ...settings,
      authVersion,
      teamProfileRecommenders: normalizeStoredTeamProfileRecommenders(settings.teamProfileRecommenders),
      // Decrypted once on load so every in-process consumer (mailer, mail fetch) sees real values;
      // normalizeUserSettings() is the only place these get masked again for API responses.
      smtpPass: decryptSecret(settings.smtpPass ?? ''),
      incomingPass: decryptSecret(settings.incomingPass ?? ''),
    },
  }
  user.settings = migrateStoredQuotaSettings(user)
  return user
}

/**
 * Reads the atomic settings revision and the exact mutation nonce from the
 * durable user row. Callers use this after writeStore while its write lock is
 * still held, so a nominal HTTP success is bound to the committed request.
 */
export async function readUserSettingsPersistenceState(userId) {
  await ensureStorage()
  const row = getDb().prepare(
    'SELECT settings_version, settings_json FROM users WHERE id = ? LIMIT 1',
  ).get(userId)
  if (!row) return null
  const settings = fromJson(row.settings_json, {})
  return {
    settingsVersion: Math.max(0, Number(row.settings_version) || 0),
    mutationNonce: typeof settings.settingsMutationNonce === 'string'
      ? settings.settingsMutationNonce
      : '',
    smtpPassSet: Boolean(settings.smtpPass),
    incomingPassSet: Boolean(settings.incomingPass),
  }
}

const FOCUSED_SESSION_SETTINGS_BUDGET_BYTES = 860 * 1024
/**
 * Shed in size order when a legacy account exceeds the session budget. The
 * large libraries come from the registry so this can never name a field that
 * has been renamed away; `discoverSourceIndex` is a pre-migration remnant that
 * no longer has a declaration.
 */
const FOCUSED_SESSION_OPTIONAL_SETTINGS = Object.freeze([
  ...userSettingsShedKeys(),
  'avatarDataUrl',
  'discoverSourceIndex',
])

function focusedSessionJsonRaw(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch {
    return fallback
  }
}


function boundedFocusedSessionSettings(user) {
  const smtpPassConfigured = Boolean(user.settings?.smtpPass)
  const incomingPassConfigured = Boolean(user.settings?.incomingPass)
  const settings = normalizeUserSettings(user)
  const withAuthVersion = {
    ...settings,
    // These are non-secret internal markers. publicUser() masks them back to
    // empty strings while preserving the configured booleans.
    smtpPass: smtpPassConfigured ? '__configured__' : '',
    incomingPass: incomingPassConfigured ? '__configured__' : '',
    authVersion: normalizeAccountAuthVersion(user.settings?.authVersion),
  }
  if (Buffer.byteLength(JSON.stringify(withAuthVersion), 'utf8') <= FOCUSED_SESSION_SETTINGS_BUDGET_BYTES) {
    return withAuthVersion
  }

  // Valid current settings normally fit the standard authenticated response.
  // Legacy installs can contain multi-megabyte values written before those
  // schemas existed. Keep the durable row untouched and omit only the largest
  // optional session copies until the bounded login projection fits.
  const bounded = { ...withAuthVersion }
  const blankOnShed = new Set(userSettingsBlankOnShedKeys())
  const optionalBySize = FOCUSED_SESSION_OPTIONAL_SETTINGS
    .map((key) => ({
      key,
      bytes: Buffer.byteLength(JSON.stringify(bounded[key] ?? null), 'utf8'),
    }))
    .sort((left, right) => right.bytes - left.bytes)
  for (const { key } of optionalBySize) {
    // A field the session still needs is emptied; the rest are removed. Which
    // is which comes from the registry rather than a name checked inline.
    if (blankOnShed.has(key)) bounded[key] = ''
    else delete bounded[key]
    if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= FOCUSED_SESSION_SETTINGS_BUDGET_BYTES) break
  }
  return bounded
}

/*
 * Build one bounded, public-session settings projection inside SQLite. The
 * source settings JSON never crosses into the JS heap and secret values are
 * reduced to presence markers. json_valid() keeps a corrupt legacy row from
 * breaking authentication; account identity/authVersion remain authoritative
 * scalar columns.
 */
const FOCUSED_SESSION_ACCOUNT_SQL = `
  WITH account AS MATERIALIZED (
    SELECT id, name, email, language, role, created_at, last_login_at,
           disabled_at, auth_version, settings_version,
           CASE WHEN json_valid(settings_json) THEN settings_json ELSE '{}' END AS settings
      FROM users
     WHERE id = ?
     LIMIT 1
  )
  SELECT id, name, email, role, created_at, last_login_at, disabled_at, auth_version,
         settings_version,
         COALESCE(NULLIF(language, ''), 'en') AS account_language,
${focusedSessionSettingsColumnsSql()}
    FROM account`


function focusedSessionAccountFromRow(row) {
  if (!row) return null
  // Decoded by the same declarations that generated the columns above, so a
  // setting can never be selected without being read back, or vice versa.
  const settings = {
    language: row.account_language || 'en',
    ...focusedSessionSettingsFromRow(row, (value) => focusedSessionJsonRaw(value, undefined)),
    authVersion: normalizeAccountAuthVersion(row.auth_version),
  }
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeUserRole(row.role),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at ?? null,
    settingsVersion: Math.max(0, Number(row.settings_version) || 0),
    settings,
  }
  user.settings = boundedFocusedSessionSettings(user)
  Object.defineProperty(user, focusedSessionProjectionSymbol, {
    configurable: false,
    enumerable: true,
    value: true,
  })
  return user
}

const focusedSessionAccountStatements = new WeakMap()

function readFocusedSessionAccountFromDatabase(database, userId) {
  let statement = focusedSessionAccountStatements.get(database)
  if (!statement) {
    statement = database.prepare(FOCUSED_SESSION_ACCOUNT_SQL)
    focusedSessionAccountStatements.set(database, statement)
  }
  return focusedSessionAccountFromRow(statement.get(userId))
}

export async function readFocusedSessionAccount(userId) {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  return normalizedId ? readFocusedSessionAccountFromDatabase(getDb(), normalizedId) : null
}

const FOCUSED_TEAM_RECOMMENDER_ACCOUNT_SQL = `
  SELECT id, name, email, role, created_at, last_login_at, disabled_at,
         auth_version, settings_version
    FROM users
   WHERE id = ?
   LIMIT 1`

function focusedAccountIdentityFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeUserRole(row.role),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at ?? null,
    settingsVersion: Math.max(0, Number(row.settings_version) || 0),
    settings: { authVersion: normalizeAccountAuthVersion(row.auth_version) },
  }
}

const FOCUSED_APPLICATION_LIST_ACCOUNT_SQL = `
  SELECT id, name, email, role, created_at, last_login_at, disabled_at,
         auth_version, settings_version,
         CASE WHEN json_valid(settings_json)
           THEN json_extract(settings_json, '$.membershipPlan') END AS membership_plan,
         CASE WHEN json_valid(settings_json)
           THEN json_extract(settings_json, '$.personalMembershipPlan') END AS personal_membership_plan,
         CASE WHEN json_valid(settings_json)
           THEN json_extract(settings_json, '$.backupFrequency') END AS backup_frequency,
         CASE WHEN json_valid(settings_json)
           THEN json_extract(settings_json, '$.maxBackupsPerApp') END AS max_backups_per_app,
         CASE WHEN json_valid(settings_json)
           THEN json_extract(settings_json, '$.autoBackup') END AS auto_backup,
         CASE WHEN json_valid(settings_json)
           THEN json_extract(settings_json, '$.sessionDurationMinutes') END AS session_duration_minutes
    FROM users
   WHERE id = ?
   LIMIT 1`

function focusedApplicationListAccountFromRow(row) {
  const account = focusedAccountIdentityFromRow(row)
  if (!account) return null
  account.settings = {
    authVersion: normalizeAccountAuthVersion(row.auth_version),
    membershipPlan: row.membership_plan,
    personalMembershipPlan: row.personal_membership_plan,
    backupFrequency: normalizeBackupFrequency(row.backup_frequency),
    maxBackupsPerApp: normalizeBackupLimit(
      row.max_backups_per_app,
      DEFAULT_MAX_BACKUPS_PER_APP,
    ),
    autoBackup: intBool(row.auto_backup),
    sessionDurationMinutes: Number(row.session_duration_minutes) || undefined,
  }
  Object.defineProperty(account, focusedSessionProjectionSymbol, {
    configurable: false,
    enumerable: true,
    value: true,
  })
  return account
}

const focusedApplicationListAccountStatements = new WeakMap()

function readFocusedApplicationListAccountFromDatabase(database, userId) {
  let statement = focusedApplicationListAccountStatements.get(database)
  if (!statement) {
    statement = database.prepare(FOCUSED_APPLICATION_LIST_ACCOUNT_SQL)
    focusedApplicationListAccountStatements.set(database, statement)
  }
  return focusedApplicationListAccountFromRow(
    statement.get(userId),
  )
}

/**
 * Minimal read-only request context for the personal application cursor. It
 * deliberately skips scoped-store baselines, tenant revision maps, collection
 * arrays, and hydration leases: the route writes nothing and its application
 * payload memory is owned by the separate row cursor.
 */
export async function readApplicationListHydrationStore(userId, { actorId = '' } = {}) {
  await ensureStorage()
  const subjectId = String(userId ?? '').trim()
  const normalizedActorId = String(actorId ?? '').trim()
  const principalIds = [...new Set([subjectId, normalizedActorId].filter(Boolean))]
  if (!subjectId) return null
  const database = getDb()
  return database.transaction(() => ({
    meta: {
      adapter: currentDatabaseAdapter(),
      revision: readDurableWorkspaceRevision(database),
      updatedAt: nowStamp(),
    },
    settings: focusedSystemSettingsFromDatabase(database),
    users: principalIds
      .map((id) => readFocusedApplicationListAccountFromDatabase(database, id))
      .filter(Boolean),
    teams: [],
    applications: [],
    profileAssets: [],
    systemEvents: [],
  })).deferred()
}

/**
 * Direct read-only context for /api/auth/me. Unlike the generic scoped store it
 * does not scan Team reachability, allocate differential baselines, or hydrate
 * unrelated collections; the route consumes only this bounded account/session
 * projection and focused scalar counters.
 */
export async function readAccountSummaryHydrationStore(userId, { actorId = '' } = {}) {
  await ensureStorage()
  const subjectId = String(userId ?? '').trim()
  const normalizedActorId = String(actorId ?? '').trim()
  const principalIds = [...new Set([subjectId, normalizedActorId].filter(Boolean))]
  if (!subjectId) return null
  const database = getDb()
  return database.transaction(() => ({
    meta: {
      adapter: currentDatabaseAdapter(),
      revision: readDurableWorkspaceRevision(database),
      updatedAt: nowStamp(),
    },
    settings: focusedSystemSettingsFromDatabase(database),
    users: principalIds
      .map((id) => readFocusedSessionAccountFromDatabase(database, id))
      .filter(Boolean),
    teams: [],
    applications: [],
    profileAssets: [],
    systemEvents: [],
  })).deferred()
}

/**
 * Read only the scalar identity needed for a fresh authorization decision.
 * Account settings JSON is deliberately not selected or parsed here.
 */
export async function readFocusedAccountIdentity(userId) {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  if (!normalizedId || normalizedId.length > 160) return null
  return focusedAccountIdentityFromRow(
    focusedTeamProfileRecommenderStatements(getDb()).account.get(normalizedId),
  )
}

const FOCUSED_TEAM_RECOMMENDER_LIBRARY_SQL = `
  WITH account AS MATERIALIZED (
    SELECT settings_version,
           json_valid(settings_json) AS settings_valid,
           CASE WHEN json_valid(settings_json) THEN settings_json ELSE '{}' END AS settings
      FROM users
     WHERE id = ? AND settings_version = ?
     LIMIT 1
  )
  SELECT account.settings_version,
         account.settings_valid,
         json_type(account.settings, '$') AS settings_type,
         json_type(account.settings, '$.teamProfileRecommenders') AS directory_type,
         COUNT(library.key) AS entry_count,
         MAX(library.type) AS entry_type,
         MAX(
           CASE WHEN library.value IS NULL THEN 0
             ELSE LENGTH(CAST(library.value AS BLOB)) END
         ) AS entry_bytes,
         MAX(
           CASE WHEN library.type = 'array'
                  AND LENGTH(CAST(library.value AS BLOB)) <= ?
             THEN library.value ELSE NULL END
         ) AS entry_json
    FROM account
    LEFT JOIN json_each(account.settings, '$.teamProfileRecommenders') AS library
      ON library.key = ?
   GROUP BY account.settings_version, account.settings_valid`

function focusedTeamProfileRecommenderStatements(database) {
  if (focusedTeamProfileRecommenderPreparedStatements?.database === database) {
    return focusedTeamProfileRecommenderPreparedStatements
  }
  focusedTeamProfileRecommenderPreparedStatements = {
    database,
    account: database.prepare(FOCUSED_TEAM_RECOMMENDER_ACCOUNT_SQL),
    library: database.prepare(FOCUSED_TEAM_RECOMMENDER_LIBRARY_SQL),
  }
  return focusedTeamProfileRecommenderPreparedStatements
}

function focusedTeamProfileRecommenderError(code, message, status = 500, details = {}) {
  const error = new Error(message)
  error.name = 'FocusedTeamProfileRecommenderError'
  error.code = code
  error.status = status
  Object.assign(error, details)
  return error
}

function focusedTeamProfileRecommenderCacheKey(userId, teamId, settingsVersion) {
  return JSON.stringify([userId, teamId, settingsVersion])
}

function cloneFocusedTeamProfileRecommenders(profiles) {
  return structuredClone(profiles)
}

function removeFocusedTeamProfileRecommenderCacheEntry(key, { versionEviction = false } = {}) {
  const entry = focusedTeamProfileRecommenderCache.get(key)
  if (!entry) return false
  focusedTeamProfileRecommenderCache.delete(key)
  focusedTeamProfileRecommenderCacheBytes = Math.max(
    0,
    focusedTeamProfileRecommenderCacheBytes - entry.bytes,
  )
  focusedTeamProfileRecommenderCounters.cacheEvictions += 1
  if (versionEviction) focusedTeamProfileRecommenderCounters.versionEvictions += 1
  return true
}

function evictStaleFocusedTeamProfileRecommenderVersions(userId, teamId, settingsVersion) {
  for (const [key, entry] of focusedTeamProfileRecommenderCache) {
    if (
      entry.userId === userId
      && entry.teamId === teamId
      && entry.settingsVersion !== settingsVersion
    ) {
      removeFocusedTeamProfileRecommenderCacheEntry(key, { versionEviction: true })
    }
  }
}

function getFocusedTeamProfileRecommenderCache(userId, teamId, settingsVersion) {
  evictStaleFocusedTeamProfileRecommenderVersions(userId, teamId, settingsVersion)
  const key = focusedTeamProfileRecommenderCacheKey(userId, teamId, settingsVersion)
  const entry = focusedTeamProfileRecommenderCache.get(key)
  if (!entry) {
    focusedTeamProfileRecommenderCounters.cacheMisses += 1
    return null
  }
  focusedTeamProfileRecommenderCache.delete(key)
  focusedTeamProfileRecommenderCache.set(key, entry)
  focusedTeamProfileRecommenderCounters.cacheHits += 1
  return cloneFocusedTeamProfileRecommenders(entry.profiles)
}

function setFocusedTeamProfileRecommenderCache(
  userId,
  teamId,
  settingsVersion,
  profiles,
  profileBytes,
) {
  const key = focusedTeamProfileRecommenderCacheKey(userId, teamId, settingsVersion)
  const bytes = Math.max(0, Number(profileBytes) || 0)
    + Buffer.byteLength(key, 'utf8')
    + 64
  if (bytes > FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_BYTES) return
  removeFocusedTeamProfileRecommenderCacheEntry(key)
  const entry = {
    userId,
    teamId,
    settingsVersion,
    profiles: cloneFocusedTeamProfileRecommenders(profiles),
    bytes,
  }
  focusedTeamProfileRecommenderCache.set(key, entry)
  focusedTeamProfileRecommenderCacheBytes += bytes
  while (
    focusedTeamProfileRecommenderCache.size > FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_ENTRIES
    || focusedTeamProfileRecommenderCacheBytes > FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_BYTES
  ) {
    const oldestKey = focusedTeamProfileRecommenderCache.keys().next().value
    if (oldestKey === undefined) break
    removeFocusedTeamProfileRecommenderCacheEntry(oldestKey)
  }
}

function normalizeFocusedTeamProfileRecommenderLibrary(entryJson) {
  focusedTeamProfileRecommenderCounters.parses += 1
  let parsed
  try {
    parsed = JSON.parse(entryJson)
  } catch (cause) {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_INVALID',
      'The stored Team recommender directory is not valid JSON.',
      500,
      { cause },
    )
  }
  const normalized = ProfileRecommenderListSchema.safeParse(parsed)
  if (!normalized.success) {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_INVALID',
      'The stored Team recommender directory does not match the supported schema.',
      500,
    )
  }
  const normalizedBytes = Buffer.byteLength(JSON.stringify(normalized.data), 'utf8')
  if (normalizedBytes > FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES) {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_OVERSIZED',
      'The stored Team recommender directory exceeds the focused read limit.',
      413,
      {
        limitBytes: FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES,
        actualBytes: normalizedBytes,
      },
    )
  }
  return { profiles: normalized.data, bytes: normalizedBytes }
}

function focusedTeamProfileRecommenderAccountFromRow(row, teamId, profiles) {
  const account = {
    ...focusedAccountIdentityFromRow(row),
    settings: {
      authVersion: normalizeAccountAuthVersion(row.auth_version),
      teamProfileRecommenders: {
        [teamId]: cloneFocusedTeamProfileRecommenders(profiles),
      },
    },
  }
  Object.defineProperty(account, focusedSessionProjectionSymbol, {
    configurable: false,
    enumerable: true,
    value: true,
  })
  return account
}

async function loadFocusedTeamProfileRecommenderLibrary(
  database,
  userId,
  teamId,
  settingsVersion,
  attempt,
) {
  if (focusedTeamProfileRecommenderReadFailpoint) {
    await focusedTeamProfileRecommenderReadFailpoint({
      stage: 'before-library-query',
      userId,
      teamId,
      settingsVersion,
      attempt,
    })
  }
  focusedTeamProfileRecommenderCounters.sliceReads += 1
  const row = focusedTeamProfileRecommenderStatements(database).library.get(
    userId,
    settingsVersion,
    FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES,
    teamId,
  )
  if (!row) {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_VERSION_CHANGED',
      'The account settings changed during the focused Team directory read.',
      409,
    )
  }
  if (!Number(row.settings_valid) || row.settings_type !== 'object') {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_SETTINGS_INVALID',
      'The stored account settings are not a valid JSON object.',
      500,
    )
  }
  if (row.directory_type !== null && row.directory_type !== 'object') {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_INVALID',
      'The stored Team recommender directory map is invalid.',
      500,
    )
  }
  const entryCount = Math.max(0, Number(row.entry_count) || 0)
  if (entryCount === 0) return { profiles: [], bytes: 2 }
  if (entryCount !== 1 || row.entry_type !== 'array') {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_INVALID',
      'The requested Team recommender directory is invalid or ambiguous.',
      500,
    )
  }
  const entryBytes = Math.max(0, Number(row.entry_bytes) || 0)
  if (entryBytes > FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES) {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_OVERSIZED',
      'The stored Team recommender directory exceeds the focused read limit.',
      413,
      {
        limitBytes: FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES,
        actualBytes: entryBytes,
      },
    )
  }
  if (typeof row.entry_json !== 'string') {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_DIRECTORY_INVALID',
      'The requested Team recommender directory could not be decoded.',
      500,
    )
  }
  return normalizeFocusedTeamProfileRecommenderLibrary(row.entry_json)
}

async function focusedTeamProfileRecommenderSingleFlight(key, loader) {
  const existing = focusedTeamProfileRecommenderInFlight.get(key)
  if (existing) {
    focusedTeamProfileRecommenderCounters.inFlightJoins += 1
    return existing
  }
  if (focusedTeamProfileRecommenderInFlight.size >= FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_ENTRIES) {
    focusedTeamProfileRecommenderCounters.inFlightRejected += 1
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_READ_BUSY',
      'Too many focused Team recommender directories are being loaded.',
      503,
      {
        retryable: true,
        retryAfterMs: FOCUSED_TEAM_RECOMMENDER_RETRY_AFTER_MS,
      },
    )
  }
  const operation = Promise.resolve().then(loader)
  focusedTeamProfileRecommenderInFlight.set(key, operation)
  focusedTeamProfileRecommenderCounters.peakInFlight = Math.max(
    focusedTeamProfileRecommenderCounters.peakInFlight,
    focusedTeamProfileRecommenderInFlight.size,
  )
  try {
    return await operation
  } finally {
    if (focusedTeamProfileRecommenderInFlight.get(key) === operation) {
      focusedTeamProfileRecommenderInFlight.delete(key)
    }
  }
}

/**
 * Read one Team-scoped recommender directory without hydrating the account's
 * complete settings JSON or any other workspace entity. Account identity is a
 * fresh scalar read on every attempt; only the version-bound directory slice
 * participates in the bounded LRU/single-flight cache.
 */
export async function readFocusedTeamProfileRecommenderAccount(userId, teamId) {
  await ensureStorage()
  const normalizedUserId = String(userId ?? '').trim()
  const normalizedTeamId = String(teamId ?? '').trim()
  if (!normalizedUserId || !normalizedTeamId) return null
  if (normalizedUserId.length > 160 || normalizedTeamId.length > 160) {
    throw focusedTeamProfileRecommenderError(
      'TEAM_PROFILE_RECOMMENDER_TARGET_INVALID',
      'The focused Team recommender target is invalid.',
      400,
    )
  }

  for (let attempt = 1; attempt <= FOCUSED_TEAM_RECOMMENDER_MAX_CAS_ATTEMPTS; attempt += 1) {
    const database = getDb()
    const cacheGeneration = focusedTeamProfileRecommenderCacheGeneration
    focusedTeamProfileRecommenderCounters.scalarReads += 1
    const accountRow = focusedTeamProfileRecommenderStatements(database).account.get(normalizedUserId)
    if (!accountRow) return null
    const settingsVersion = Math.max(0, Number(accountRow.settings_version) || 0)
    const cached = getFocusedTeamProfileRecommenderCache(
      normalizedUserId,
      normalizedTeamId,
      settingsVersion,
    )
    if (cached) {
      return focusedTeamProfileRecommenderAccountFromRow(accountRow, normalizedTeamId, cached)
    }

    const key = focusedTeamProfileRecommenderCacheKey(
      normalizedUserId,
      normalizedTeamId,
      settingsVersion,
    )
    try {
      const loaded = await focusedTeamProfileRecommenderSingleFlight(key, async () => {
        const result = await loadFocusedTeamProfileRecommenderLibrary(
          database,
          normalizedUserId,
          normalizedTeamId,
          settingsVersion,
          attempt,
        )
        if (focusedTeamProfileRecommenderCacheGeneration === cacheGeneration) {
          setFocusedTeamProfileRecommenderCache(
            normalizedUserId,
            normalizedTeamId,
            settingsVersion,
            result.profiles,
            result.bytes,
          )
        }
        return result
      })
      if (
        focusedTeamProfileRecommenderCacheGeneration !== cacheGeneration
        || db !== database
      ) {
        throw focusedTeamProfileRecommenderError(
          'TEAM_PROFILE_RECOMMENDER_VERSION_CHANGED',
          'The workspace database changed during the focused Team directory read.',
          409,
        )
      }
      return focusedTeamProfileRecommenderAccountFromRow(
        accountRow,
        normalizedTeamId,
        loaded.profiles,
      )
    } catch (error) {
      const databaseChanged = (
        focusedTeamProfileRecommenderCacheGeneration !== cacheGeneration
        || db !== database
      )
      if (!databaseChanged && error?.code !== 'TEAM_PROFILE_RECOMMENDER_VERSION_CHANGED') throw error
      focusedTeamProfileRecommenderCounters.casRetries += 1
    }
  }
  throw focusedTeamProfileRecommenderError(
    'TEAM_PROFILE_RECOMMENDER_VERSION_CONFLICT',
    'The account settings changed repeatedly during the focused Team directory read.',
    503,
    {
      retryable: true,
      retryAfterMs: FOCUSED_TEAM_RECOMMENDER_RETRY_AFTER_MS,
    },
  )
}

export function focusedTeamProfileRecommenderCacheDiagnostics() {
  return {
    generation: focusedTeamProfileRecommenderCacheGeneration,
    entries: focusedTeamProfileRecommenderCache.size,
    aggregateBytes: focusedTeamProfileRecommenderCacheBytes,
    maxEntries: FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_ENTRIES,
    maxAggregateBytes: FOCUSED_TEAM_RECOMMENDER_CACHE_MAX_BYTES,
    maxLibraryBytes: FOCUSED_TEAM_RECOMMENDER_LIBRARY_MAX_BYTES,
    inFlight: focusedTeamProfileRecommenderInFlight.size,
    ...focusedTeamProfileRecommenderCounters,
  }
}

export function configureFocusedTeamProfileRecommenderReadFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Focused Team recommender read failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Focused Team recommender read failpoints are available only in tests.')
  }
  focusedTeamProfileRecommenderReadFailpoint = failpoint
}

export function resetFocusedTeamProfileRecommenderCacheForTests() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Focused Team recommender cache reset is available only in tests.')
  }
  focusedTeamProfileRecommenderReadFailpoint = null
  clearFocusedTeamProfileRecommenderCache({ resetCounters: true })
}

const focusedSystemSettingsStatements = new WeakMap()

function focusedSystemSettingsFromDatabase(database) {
  let statement = focusedSystemSettingsStatements.get(database)
  if (!statement) {
    statement = database.prepare(
      `SELECT allow_registration, admin_entry_hidden,
            CASE WHEN admin_entry_code_hash <> '' THEN 1 ELSE 0 END AS admin_entry_hash_set,
            CASE WHEN admin_entry_code_salt <> '' THEN 1 ELSE 0 END AS admin_entry_salt_set,
            CASE WHEN LENGTH(CAST(notification_mailbox AS BLOB)) <= 1024
              THEN notification_mailbox ELSE '' END AS notification_mailbox,
            system_log_retention_days, backup_frequency, max_backups_per_app_limit,
            encryption_at_rest, encryption_algorithm, encryption_password_enabled,
            CASE WHEN encryption_password_hash <> '' THEN 1 ELSE 0 END AS encryption_password_hash_set,
            CASE WHEN encryption_password_salt <> '' THEN 1 ELSE 0 END AS encryption_password_salt_set,
            sqlite_encryption,
            CASE WHEN LENGTH(CAST(smtp_host AS BLOB)) <= 1024 THEN smtp_host ELSE '' END AS smtp_host,
            smtp_port,
            CASE WHEN LENGTH(CAST(smtp_user AS BLOB)) <= 1024 THEN smtp_user ELSE '' END AS smtp_user,
            CASE WHEN smtp_pass <> '' THEN 1 ELSE 0 END AS smtp_pass_set,
            smtp_tls, admin_session_duration_minutes
       FROM system_settings WHERE id = 'global'`,
    )
    focusedSystemSettingsStatements.set(database, statement)
  }
  const row = statement.get()
  if (!row) return null
  return {
    allowRegistration: intBool(row.allow_registration),
    adminEntryHidden: intBool(row.admin_entry_hidden),
    adminEntryCodeHash: row.admin_entry_hash_set ? '__configured__' : '',
    adminEntryCodeSalt: row.admin_entry_salt_set ? '__configured__' : '',
    notificationMailbox: row.notification_mailbox,
    systemLogRetentionDays: normalizeSystemLogRetentionDays(row.system_log_retention_days),
    backupFrequency: normalizeBackupFrequency(row.backup_frequency),
    maxBackupsPerAppLimit: Math.min(
      MAX_SYSTEM_BACKUP_LIMIT,
      Math.max(MIN_SYSTEM_BACKUP_LIMIT, normalizeBackupLimit(row.max_backups_per_app_limit, DEFAULT_PRO_MAX_BACKUPS_PER_APP)),
    ),
    encryptionAtRest: intBool(row.encryption_at_rest),
    encryptionAlgorithm: normalizeAlgorithm(row.encryption_algorithm),
    encryptionPasswordEnabled: intBool(row.encryption_password_enabled),
    encryptionPasswordHash: row.encryption_password_hash_set ? '__configured__' : '',
    encryptionPasswordSalt: row.encryption_password_salt_set ? '__configured__' : '',
    sqliteEncryption: intBool(row.sqlite_encryption),
    smtpHost: row.smtp_host,
    smtpPort: Number(row.smtp_port ?? 587),
    smtpUser: row.smtp_user,
    smtpPass: row.smtp_pass_set ? '__configured__' : '',
    smtpTls: intBool(row.smtp_tls ?? 1),
    adminSessionDurationMinutes: normalizeSessionMinutes(
      row.admin_session_duration_minutes,
      DEFAULT_ADMIN_SESSION_MINUTES,
    ),
  }
}

export async function readFocusedPublicSystemSettings() {
  await ensureStorage()
  return publicSystemSettings(focusedSystemSettingsFromDatabase(getDb()))
}

const personalWorkspaceAdmissionFootprintStatements = new WeakMap()

/**
 * Cheap, fail-closed size preflight for the legacy aggregate workspace route.
 * The quota ledger retains the unabridged JSON size (including extracted
 * school-logo data) without decrypting payloads. A missing or stale source
 * makes the result ineligible for the small-workspace lane.
 */
export async function readPersonalWorkspaceAdmissionFootprint(userId) {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  if (!normalizedId) return { dataBytes: 0, complete: false, staleSources: 1 }
  const database = getDb()
  let statement = personalWorkspaceAdmissionFootprintStatements.get(database)
  if (!statement) {
    statement = database.prepare(
      `SELECT
         COALESCE((
           SELECT SUM(source.data_bytes)
             FROM workspace_quota_sources source
            WHERE source.domain_kind = 'personal'
              AND source.domain_id = ?
              AND source.source_kind IN ('user', 'application', 'profile')
         ), 0) AS data_bytes,
         (
           SELECT COUNT(*)
             FROM users account
             LEFT JOIN workspace_quota_sources source
               ON source.source_kind = 'user'
              AND source.source_id = account.id
              AND source.domain_kind = 'personal'
              AND source.domain_id = account.id
            WHERE account.id = ?
              AND (source.source_id IS NULL OR source.source_version <> account.settings_version)
         ) + (
           SELECT COUNT(*)
             FROM applications application
             LEFT JOIN workspace_quota_sources source
               ON source.source_kind = 'application'
              AND source.source_id = application.id
              AND source.domain_kind = 'personal'
              AND source.domain_id = application.owner_id
            WHERE application.owner_id = ?
              AND application.team_id IS NULL
              AND (source.source_id IS NULL OR source.source_version <> application.payload_version)
         ) + (
           SELECT COUNT(*)
             FROM profile_assets asset
             LEFT JOIN workspace_quota_sources source
               ON source.source_kind = 'profile'
              AND source.source_id = asset.id
              AND source.domain_kind = 'personal'
              AND source.domain_id = asset.owner_id
            WHERE asset.owner_id = ?
              AND (source.source_id IS NULL OR source.source_version <> asset.payload_version)
         ) AS stale_sources`,
    )
    personalWorkspaceAdmissionFootprintStatements.set(database, statement)
  }
  const row = statement.get(normalizedId, normalizedId, normalizedId, normalizedId)
  const dataBytes = Math.max(0, Number(row?.data_bytes) || 0)
  const staleSources = Math.max(0, Number(row?.stale_sources) || 0)
  return { dataBytes, complete: staleSources === 0, staleSources }
}

const focusedAccountUsageStatements = new WeakMap()

export async function readFocusedAccountUsage(userId, { includePersonalTrash = true } = {}) {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  if (!normalizedId) return null
  const database = getDb()
  const now = nowStamp()
  let statement = focusedAccountUsageStatements.get(database)
  if (!statement) {
    statement = database.prepare(
      `SELECT
       (SELECT COUNT(*) FROM applications
         WHERE owner_id = ? AND team_id IS NULL) AS personal_application_count,
       (SELECT COUNT(*) FROM applications
         WHERE owner_id = ? AND team_id IS NOT NULL) AS team_application_count,
       (SELECT COUNT(*) FROM applications
         WHERE owner_id = ?
           AND json_valid(payload_json)
           AND json_extract(payload_json, '$.teamTransferRequest.status') = 'pending') AS pending_team_transfer_count,
       (SELECT COUNT(*) FROM workspace_public_grants
         WHERE owner_id = ? AND team_id IS NULL
           AND grant_kind IN ('application-share', 'profile-share')
           AND (expires_at IS NULL OR expires_at > ?)) AS active_share_count,
       (SELECT COUNT(*) FROM (
          SELECT 1
            FROM users account,
                 json_each(
                   CASE WHEN json_valid(account.settings_json)
                     THEN account.settings_json ELSE '{"applicationTrash":[]}' END,
                   '$.applicationTrash'
                 ) trash
           WHERE account.id = ?
             AND json_extract(trash.value, '$.id') IS NOT NULL
             AND json_extract(trash.value, '$.application.id') IS NOT NULL
             AND (json_extract(trash.value, '$.expiresAt') IS NULL
               OR json_extract(trash.value, '$.expiresAt') > ?)
             AND (? = 1 OR json_extract(trash.value, '$.application.teamId') IS NOT NULL)
           LIMIT 100
         )) AS trash_count`,
    )
    focusedAccountUsageStatements.set(database, statement)
  }
  const counters = statement.get(
    normalizedId,
    normalizedId,
    normalizedId,
    normalizedId,
    now,
    normalizedId,
    now,
    includePersonalTrash ? 1 : 0,
  )
  const quota = await readWorkspaceQuotaUsage(normalizedId)
  return {
    storageUsedBytes: Math.max(0, Number(quota.personalBytes) || 0),
    personalApplicationCount: Math.max(0, Number(counters?.personal_application_count) || 0),
    teamApplicationCount: Math.max(0, Number(counters?.team_application_count) || 0),
    pendingTeamTransferCount: Math.max(0, Number(counters?.pending_team_transfer_count) || 0),
    activeShareCount: Math.max(0, Number(counters?.active_share_count) || 0),
    trashCount: Math.max(0, Number(counters?.trash_count) || 0),
    revision: quota.revision,
  }
}

const focusedTrackedProfessorAddressCountStatements = new WeakMap()

export async function readFocusedTrackedProfessorAddressCount(userId) {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  if (!normalizedId) return 0
  const database = getDb()
  let statement = focusedTrackedProfessorAddressCountStatements.get(database)
  if (!statement) {
    statement = database.prepare(
      `WITH owned AS MATERIALIZED (
       SELECT CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS payload
         FROM applications WHERE owner_id = ?
     ), addresses(address) AS (
       SELECT LOWER(TRIM(json_extract(payload, '$.professor.email'))) FROM owned
       UNION
       SELECT LOWER(TRIM(CAST(extra.value AS TEXT)))
         FROM owned, json_each(owned.payload, '$.professor.correspondenceEmails') extra
     )
     SELECT COUNT(*) AS count FROM addresses WHERE address <> ''`,
    )
    focusedTrackedProfessorAddressCountStatements.set(database, statement)
  }
  const row = statement.get(normalizedId)
  return Math.max(0, Number(row?.count) || 0)
}

/**
 * Reads only the account row needed for password authentication. Keeping this
 * lookup independent from readStore() prevents a login burst from repeatedly
 * decoding every application and profile asset in the workspace.
 */
export async function readPasswordLoginCandidateByEmail(email) {
  await ensureStorage()
  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  if (!normalizedEmail) return null
  const row = getDb().prepare(
    `SELECT id, name, email, role, password_hash, auth_version,
            created_at, last_login_at, disabled_at
       FROM users WHERE email = ? LIMIT 1`,
  ).get(normalizedEmail)
  if (!row) return null
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: normalizeUserRole(row.role),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      disabledAt: row.disabled_at ?? null,
      settings: { authVersion: normalizeAccountAuthVersion(row.auth_version) },
    },
    guard: {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      authVersion: normalizeAccountAuthVersion(row.auth_version),
    },
  }
}

/**
 * Commits a successful password login as one narrow, guarded transaction.
 * The authorization fields are checked again after password verification so
 * an older login cannot overwrite a concurrent disable, password reset,
 * session revocation, or role change.
 */
export async function commitSuccessfulPasswordLogin({
  guard,
  scope = 'app',
  lastLoginAt = nowStamp(),
  nextPasswordHash = null,
  signal,
}) {
  await ensureStorage()
  if (signal?.aborted) return { ok: false, reason: 'CANCELLED' }
  if (!guard?.id || !guard?.email || !guard?.passwordHash) {
    return { ok: false, reason: 'INVALID_GUARD' }
  }

  const passwordHashChanged = typeof nextPasswordHash === 'string'
    && nextPasswordHash
    && nextPasswordHash !== guard.passwordHash
  let outcome = { ok: false, reason: 'AUTH_CHANGED' }
  await withWriteLock(async () => {
    if (signal?.aborted) {
      outcome = { ok: false, reason: 'CANCELLED' }
      return
    }
    const database = getDb()
    const commit = database.transaction(() => {
      const row = database.prepare(
        `SELECT id, name, email, role, password_hash, auth_version,
                created_at, last_login_at, disabled_at
           FROM users WHERE id = ? AND email = ? LIMIT 1`,
      )
        .get(guard.id, guard.email)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      if (row.disabled_at) return { ok: false, reason: 'DISABLED' }
      if (row.password_hash !== guard.passwordHash) return { ok: false, reason: 'PASSWORD_CHANGED' }
      if (row.role !== guard.role) return { ok: false, reason: 'ROLE_CHANGED' }
      if (normalizeAccountAuthVersion(row.auth_version) !== guard.authVersion) {
        return { ok: false, reason: 'AUTH_VERSION_CHANGED' }
      }
      if (scope === 'admin' && normalizeUserRole(row.role) !== 'admin') {
        return { ok: false, reason: 'SCOPE_FORBIDDEN' }
      }

      const passwordHash = typeof nextPasswordHash === 'string' && nextPasswordHash
        ? nextPasswordHash
        : guard.passwordHash
      const updated = database.prepare(
        `UPDATE users
         SET last_login_at = ?, password_hash = ?
         WHERE id = ?
           AND email = ?
           AND password_hash = ?
           AND disabled_at IS NULL
           AND role = ?
           AND auth_version = ?`,
      ).run(
        lastLoginAt,
        passwordHash,
        guard.id,
        guard.email,
        guard.passwordHash,
        guard.role,
        normalizeAccountAuthVersion(row.auth_version),
      )
      if (updated.changes !== 1) return { ok: false, reason: 'AUTH_CHANGED' }

      const event = {
        id: createId('event'),
        time: lastLoginAt,
        scope: 'Authentication',
        actorId: guard.id,
        message: 'User signed in',
        metadata: { scope: scope === 'admin' ? 'admin' : 'app' },
      }
      database.prepare(
        `INSERT INTO system_events (
          id, time, scope, actor_id, message, metadata_json
        ) VALUES (?, ?, 'Authentication', ?, 'User signed in', ?)`,
      ).run(
        event.id,
        lastLoginAt,
        guard.id,
        toJson(event.metadata),
      )
      return {
        ok: true,
        user: readFocusedSessionAccountFromDatabase(database, guard.id),
        event,
      }
    })
    outcome = commit.immediate()
    // A focused login result intentionally does not replace a fully hydrated
    // cached user. Invalidate the snapshot after commit; the login response
    // itself remains independent from sharedStore hydration.
    if (outcome.ok) {
      invalidateSharedStoreCache()
    }
  })
  if (outcome.ok) await acknowledgeSecurityStorageMutation(Boolean(passwordHashChanged))
  return outcome
}

function codexAuthorizationError(status, code, message, details = {}) {
  const error = new Error(message)
  error.status = status
  error.code = code
  Object.assign(error, details)
  return error
}

function normalizeCodexText(value, maxLength, fallback = '') {
  const normalized = String(value ?? fallback).trim().replace(/\s+/g, ' ')
  return normalized.slice(0, maxLength)
}

function requireCodexOpaqueMaterial(value, field, minLength = 16, maxLength = 256) {
  const normalized = String(value ?? '').trim()
  if (
    normalized.length < minLength
    || normalized.length > maxLength
    || /\s/.test(normalized)
  ) {
    throw codexAuthorizationError(
      400,
      'INVALID_CODEX_AUTHORIZATION_MATERIAL',
      `A valid ${field} is required.`,
    )
  }
  return normalized
}

function normalizeCodexScopes(value, field = 'scopes') {
  if (!Array.isArray(value)) {
    throw codexAuthorizationError(400, 'INVALID_CODEX_AUTHORIZATION_SCOPES', `${field} must be an array.`)
  }
  if (value.length < 1 || value.length > CODEX_AUTHORIZATION_SCOPES.length) {
    throw codexAuthorizationError(
      400,
      'INVALID_CODEX_AUTHORIZATION_SCOPES',
      `${field} must contain between 1 and ${CODEX_AUTHORIZATION_SCOPES.length} values.`,
    )
  }
  const normalized = []
  const seen = new Set()
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      throw codexAuthorizationError(400, 'INVALID_CODEX_AUTHORIZATION_SCOPES', `${field} contains an invalid value.`)
    }
    const scope = candidate.trim()
    if (!CODEX_AUTHORIZATION_SCOPE_SET.has(scope)) {
      throw codexAuthorizationError(400, 'INVALID_CODEX_AUTHORIZATION_SCOPES', `${field} contains an invalid value.`)
    }
    if (seen.has(scope)) continue
    seen.add(scope)
    normalized.push(scope)
  }
  return normalized.sort(
    (left, right) => CODEX_AUTHORIZATION_SCOPE_ORDER.get(left) - CODEX_AUTHORIZATION_SCOPE_ORDER.get(right),
  )
}

function storedCodexScopes(value) {
  const scopes = fromJson(value, [])
  if (
    !Array.isArray(scopes)
    || scopes.length < 1
    || scopes.length > CODEX_AUTHORIZATION_SCOPES.length
  ) {
    return { scopes: [], valid: false }
  }
  const normalized = []
  const seen = new Set()
  for (const candidate of scopes) {
    if (typeof candidate !== 'string') return { scopes: [], valid: false }
    const scope = candidate.trim()
    if (
      scope !== candidate
      || !CODEX_AUTHORIZATION_SCOPE_SET.has(scope)
      || seen.has(scope)
    ) {
      return { scopes: [], valid: false }
    }
    seen.add(scope)
    normalized.push(scope)
  }
  normalized.sort(
    (left, right) => CODEX_AUTHORIZATION_SCOPE_ORDER.get(left) - CODEX_AUTHORIZATION_SCOPE_ORDER.get(right),
  )
  return { scopes: normalized, valid: true }
}

function codexScopesFromJson(value) {
  return storedCodexScopes(value).scopes
}

function normalizeCodexScopeVersion(value) {
  const version = Number(value ?? CODEX_AUTHORIZATION_SCOPE_VERSION)
  if (version !== CODEX_AUTHORIZATION_SCOPE_VERSION) {
    throw codexAuthorizationError(
      400,
      'INVALID_CODEX_SCOPE_VERSION',
      `Only Codex scope version ${CODEX_AUTHORIZATION_SCOPE_VERSION} is supported.`,
    )
  }
  return version
}

function normalizeCodexAuthVersion(value) {
  const version = Number(value ?? 0)
  if (!Number.isSafeInteger(version) || version < 0) {
    throw codexAuthorizationError(400, 'INVALID_CODEX_AUTH_VERSION', 'A valid authentication version is required.')
  }
  return version
}

function normalizeCodexTimestamp(value, field, { nullable = false, after = null } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) {
    throw codexAuthorizationError(400, 'INVALID_CODEX_AUTHORIZATION_TIME', `A valid ${field} is required.`)
  }
  if (after !== null && timestamp.getTime() <= after) {
    throw codexAuthorizationError(400, 'INVALID_CODEX_AUTHORIZATION_TIME', `${field} must be in the future.`)
  }
  return timestamp.toISOString()
}

function laterCodexTimestamp(left, right) {
  const leftMs = new Date(left ?? '').getTime()
  const rightMs = new Date(right ?? '').getTime()
  if (!Number.isFinite(leftMs)) return Number.isFinite(rightMs) ? right : null
  if (!Number.isFinite(rightMs)) return left
  return rightMs > leftMs ? right : left
}

function effectiveCodexAuthorizationLastUsedAt(row) {
  if (!row) return null
  return laterCodexTimestamp(
    row.last_used_at ?? null,
    pendingCodexAuthorizationLastUsed.get(row.id)?.at ?? null,
  )
}

function effectiveCodexAuthorizationUpdatedAt(row) {
  return laterCodexTimestamp(row?.updated_at ?? null, effectiveCodexAuthorizationLastUsedAt(row))
    ?? row?.updated_at
    ?? null
}

function codexAuthorizationStatus(row, at = nowStamp()) {
  if (!row) return 'missing'
  if (row.revoked_at) return 'revoked'
  // Paused is reported ahead of the time-based states so the owner always sees
  // the state they chose; every non-active status refuses requests identically.
  if (row.disabled_at) return 'disabled'
  const nowMs = new Date(at).getTime()
  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : Number.POSITIVE_INFINITY
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) return 'expired'
  const activityAtMs = new Date(effectiveCodexAuthorizationLastUsedAt(row) ?? row.created_at).getTime()
  if (!Number.isFinite(activityAtMs)) return 'invalidated'
  if (activityAtMs + CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS <= nowMs) return 'idle_expired'
  if (row.account_disabled_at || !row.account_id) return 'invalidated'
  if (
    Number(row.scope_version) !== CODEX_AUTHORIZATION_SCOPE_VERSION
    || !storedCodexScopes(row.scopes_json).valid
  ) {
    return 'invalidated'
  }
  if (
    row.account_auth_version !== undefined
    && Number(row.issued_auth_version ?? 0)
      !== normalizeAccountAuthVersion(row.account_auth_version)
  ) {
    return 'invalidated'
  }
  return 'active'
}

export function publicCodexAuthorization(row, { at = nowStamp() } = {}) {
  if (!row) return null
  const scopes = codexScopesFromJson(row.scopes_json)
  const status = codexAuthorizationStatus(row, at)
  const clientName = row.client_name || ''
  const clientVersion = row.client_version || ''
  const deviceName = row.device_name || ''
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || '',
    tokenHint: row.token_hint || '',
    scopes,
    grantedScopes: scopes,
    scopeVersion: Number(row.scope_version ?? 1),
    clientName,
    clientVersion,
    deviceName,
    client: { name: clientName, version: clientVersion },
    device: { name: deviceName },
    createdAt: row.created_at,
    updatedAt: effectiveCodexAuthorizationUpdatedAt(row),
    lastUsedAt: effectiveCodexAuthorizationLastUsedAt(row),
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    revokedReason: row.revoked_reason ?? null,
    disabledAt: row.disabled_at ?? null,
    status,
    active: status === 'active',
  }
}

function codexDeviceAuthorizationStatus(row, at = nowStamp()) {
  if (!row) return 'missing'
  const requested = storedCodexScopes(row.requested_scopes_json)
  const approved = row.approved_scopes_json === null
    ? null
    : storedCodexScopes(row.approved_scopes_json)
  if (
    Number(row.scope_version) !== CODEX_AUTHORIZATION_SCOPE_VERSION
    || !requested.valid
    || (
      (row.status === 'approved' || row.status === 'consumed')
      && !approved?.valid
    )
  ) {
    return 'invalidated'
  }
  if (
    (row.status === 'pending' || row.status === 'approved')
    && new Date(row.expires_at).getTime() <= new Date(at).getTime()
  ) {
    return 'expired'
  }
  return row.status
}

export function publicCodexDeviceAuthorization(row, { at = nowStamp() } = {}) {
  if (!row) return null
  const requestedScopes = codexScopesFromJson(row.requested_scopes_json)
  const approvedScopes = row.approved_scopes_json === null
    ? null
    : codexScopesFromJson(row.approved_scopes_json)
  const clientName = row.client_name || ''
  const clientVersion = row.client_version || ''
  const deviceName = row.device_name || ''
  const status = codexDeviceAuthorizationStatus(row, at)
  return {
    id: row.id,
    status,
    requestedScopes,
    approvedScopes,
    requestedExpiresInDays: Number(row.requested_expires_in_days ?? 365),
    approvedExpiresInDays: row.approved_expires_in_days === null
      || row.approved_expires_in_days === undefined
      ? null
      : Number(row.approved_expires_in_days),
    approvedName: row.approved_name ?? null,
    scopeVersion: Number(row.scope_version ?? 1),
    clientName,
    clientVersion,
    deviceName,
    client: { name: clientName, version: clientVersion },
    device: { name: deviceName },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    pollIntervalSeconds: Number(row.poll_interval_seconds ?? 5),
    lastPolledAt: row.last_polled_at ?? null,
    pollCount: Number(row.poll_count ?? 0),
    approvedUserId: row.approved_user_id ?? null,
    approvedAt: row.approved_at ?? null,
    approved: row.approved_at
      ? { userId: row.approved_user_id, scopes: approvedScopes ?? [], at: row.approved_at }
      : null,
    deniedByUserId: row.denied_by_user_id ?? null,
    deniedAt: row.denied_at ?? null,
    denialReason: row.denial_reason ?? null,
    denied: row.denied_at
      ? { userId: row.denied_by_user_id ?? null, reason: row.denial_reason ?? null, at: row.denied_at }
      : null,
    consumedAt: row.consumed_at ?? null,
    authorizationId: row.authorization_id ?? null,
  }
}

function codexAuthorizationSelect(database, where, ...values) {
  return database.prepare(
    `SELECT
       authorization.*,
       account.id AS account_id,
       account.name AS account_name,
       account.email AS account_email,
       account.role AS account_role,
       account.disabled_at AS account_disabled_at,
       account.auth_version AS account_auth_version
     FROM codex_authorizations authorization
     LEFT JOIN users account ON account.id = authorization.user_id
     WHERE ${where}`,
  ).get(...values)
}

function clearCodexAuthorizationLastUsedFlushTimer() {
  if (codexAuthorizationLastUsedFlushTimer === null) return
  clearTimeout(codexAuthorizationLastUsedFlushTimer)
  codexAuthorizationLastUsedFlushTimer = null
}

function markCodexTelemetryDirty() {
  codexTelemetryDirty = true
  codexTelemetryMutationGeneration += 1
  scheduleCodexAuthorizationLastUsedFlush()
}

function scheduleCodexAuthorizationLastUsedFlush() {
  if (
    (pendingCodexAuthorizationLastUsed.size === 0 && !codexTelemetryDirty)
    || codexAuthorizationLastUsedFlushTimer !== null
    || codexAuthorizationLastUsedFlushPromise
    || codexTelemetryPersistPromise
  ) return
  codexAuthorizationLastUsedFlushTimer = setTimeout(() => {
    codexAuthorizationLastUsedFlushTimer = null
    void flushCodexTelemetryPersistence().catch((error) => {
      console.error('[storage] Failed to persist coalesced Codex telemetry:', error)
    })
  }, CODEX_AUTHORIZATION_LAST_USED_FLUSH_DELAY_MS)
  codexAuthorizationLastUsedFlushTimer.unref?.()
}

function takePendingCodexAuthorizationLastUsedBatch() {
  const batch = []
  for (const [authorizationId, pending] of pendingCodexAuthorizationLastUsed) {
    batch.push({ authorizationId, ...pending })
    if (batch.length >= CODEX_AUTHORIZATION_LAST_USED_FLUSH_BATCH_SIZE) break
  }
  return batch
}

function settlePendingCodexAuthorizationLastUsedBatch(batch) {
  for (const pending of batch) {
    const current = pendingCodexAuthorizationLastUsed.get(pending.authorizationId)
    if (!current) continue
    if (laterCodexTimestamp(pending.at, current.at) === pending.at) {
      pendingCodexAuthorizationLastUsed.delete(pending.authorizationId)
    }
  }
}

async function persistCodexAuthorizationLastUsedBatch(batch) {
  if (batch.length === 0) return 0
  let persisted = 0
  await withWriteLock(async () => {
    const database = getDb()
    const values = batch.map(() => '(?, ?)').join(', ')
    const parameters = batch.flatMap((pending) => [pending.authorizationId, pending.at])
    const transaction = database.transaction(() => database.prepare(
      `WITH pending(authorization_id, touched_at) AS (VALUES ${values})
       UPDATE codex_authorizations AS authorization
          SET last_used_at = (
                SELECT touched_at
                  FROM pending
                 WHERE authorization_id = authorization.id
              ),
              updated_at = (
                SELECT touched_at
                  FROM pending
                 WHERE authorization_id = authorization.id
              )
        WHERE authorization.id IN (SELECT authorization_id FROM pending)
          AND authorization.revoked_at IS NULL
          AND (
            authorization.expires_at IS NULL
            OR authorization.expires_at > (
              SELECT touched_at
                FROM pending
               WHERE authorization_id = authorization.id
            )
          )
          AND (
            authorization.last_used_at IS NULL
            OR authorization.last_used_at < (
              SELECT touched_at
                FROM pending
               WHERE authorization_id = authorization.id
            )
          )
          AND EXISTS (
            SELECT 1
              FROM users account
             WHERE account.id = authorization.user_id
               AND account.disabled_at IS NULL
               AND account.auth_version = authorization.issued_auth_version
          )`,
    ).run(...parameters))
    persisted = Number(runWithDeferredTelemetryPersistence(() => transaction.immediate()).changes ?? 0)
  })
  if (persisted > 0) markCodexTelemetryDirty()
  return persisted
}

export async function flushCodexAuthorizationLastUsed() {
  await ensureStorage()
  if (codexAuthorizationLastUsedFlushPromise) {
    const current = await codexAuthorizationLastUsedFlushPromise
    if (pendingCodexAuthorizationLastUsed.size > 0) {
      const followUp = await flushCodexAuthorizationLastUsed()
      return {
        batches: current.batches + followUp.batches,
        persisted: current.persisted + followUp.persisted,
        discarded: current.discarded + followUp.discarded,
      }
    }
    return current
  }

  const flush = (async () => {
    codexAuthorizationLastUsedCounters.flushes += 1
    let batches = 0
    let persisted = 0
    let discarded = 0
    const maximumBatches = Math.ceil(
      CODEX_AUTHORIZATION_LAST_USED_MAX_PENDING
      / CODEX_AUTHORIZATION_LAST_USED_FLUSH_BATCH_SIZE,
    ) + 1
    for (let index = 0; index < maximumBatches; index += 1) {
      const batch = takePendingCodexAuthorizationLastUsedBatch()
      if (batch.length === 0) break
      try {
        const changed = await persistCodexAuthorizationLastUsedBatch(batch)
        settlePendingCodexAuthorizationLastUsedBatch(batch)
        batches += 1
        persisted += changed
        discarded += Math.max(0, batch.length - changed)
      } catch (error) {
        codexAuthorizationLastUsedCounters.failures += 1
        throw error
      }
    }
    codexAuthorizationLastUsedCounters.batches += batches
    codexAuthorizationLastUsedCounters.persisted += persisted
    codexAuthorizationLastUsedCounters.discarded += discarded
    return { batches, persisted, discarded }
  })()
  codexAuthorizationLastUsedFlushPromise = flush
  try {
    return await flush
  } finally {
    if (codexAuthorizationLastUsedFlushPromise === flush) {
      codexAuthorizationLastUsedFlushPromise = null
    }
    if (pendingCodexAuthorizationLastUsed.size > 0 || codexTelemetryDirty) {
      scheduleCodexAuthorizationLastUsedFlush()
    }
  }
}

export async function flushCodexTelemetryPersistence() {
  await ensureStorage()
  if (codexTelemetryPersistPromise) return codexTelemetryPersistPromise
  clearCodexAuthorizationLastUsedFlushTimer()
  const persistence = (async () => {
    await flushCodexAuthorizationLastUsed()
    if (!codexTelemetryDirty) return { persisted: false }
    const generation = codexTelemetryMutationGeneration
    await acknowledgeDurableStorageMutation()
    if (codexTelemetryMutationGeneration === generation) codexTelemetryDirty = false
    return { persisted: true, generation }
  })()
  codexTelemetryPersistPromise = persistence
  try {
    return await persistence
  } finally {
    if (codexTelemetryPersistPromise === persistence) codexTelemetryPersistPromise = null
    if (pendingCodexAuthorizationLastUsed.size > 0 || codexTelemetryDirty) {
      scheduleCodexAuthorizationLastUsedFlush()
    }
  }
}

async function queueCodexAuthorizationLastUsed({ authorizationId, userId, at }) {
  while (
    !pendingCodexAuthorizationLastUsed.has(authorizationId)
    && pendingCodexAuthorizationLastUsed.size >= CODEX_AUTHORIZATION_LAST_USED_MAX_PENDING
  ) {
    // Capacity is strict: make one bounded batch durable before accepting a
    // new key. A database failure propagates to authentication instead of
    // silently dropping activity and allowing a live token to idle-expire.
    await flushCodexAuthorizationLastUsed()
  }
  const latest = pendingCodexAuthorizationLastUsed.get(authorizationId)
  if (!latest && pendingCodexAuthorizationLastUsed.size >= CODEX_AUTHORIZATION_LAST_USED_MAX_PENDING) {
    // Continuous traffic can refill the bounded map while the capacity caller
    // awaits its flush. Preserve the hard memory bound with a one-row
    // write-through fallback; ordinary traffic never takes this global lock.
    const persisted = await persistCodexAuthorizationLastUsedBatch([{
      authorizationId,
      userId,
      at,
    }])
    codexAuthorizationLastUsedCounters.batches += 1
    codexAuthorizationLastUsedCounters.persisted += persisted
    codexAuthorizationLastUsedCounters.discarded += persisted === 1 ? 0 : 1
    return persisted === 1
  }
  const effectiveAt = laterCodexTimestamp(latest?.at ?? null, at)
  if (latest && effectiveAt === latest.at) {
    codexAuthorizationLastUsedCounters.coalesced += 1
    return false
  }
  pendingCodexAuthorizationLastUsed.set(authorizationId, {
    userId: latest?.userId || userId,
    at: effectiveAt,
  })
  codexAuthorizationLastUsedCounters.queued += 1
  scheduleCodexAuthorizationLastUsedFlush()
  return true
}

function discardPendingCodexAuthorizationLastUsed(authorizationId) {
  const discarded = pendingCodexAuthorizationLastUsed.delete(authorizationId)
  if (pendingCodexAuthorizationLastUsed.size === 0 && !codexTelemetryDirty) {
    clearCodexAuthorizationLastUsedFlushTimer()
  }
  return discarded
}

function discardPendingCodexAuthorizationLastUsedForUser(userId) {
  let discarded = 0
  for (const [authorizationId, pending] of pendingCodexAuthorizationLastUsed) {
    if (pending.userId !== userId) continue
    pendingCodexAuthorizationLastUsed.delete(authorizationId)
    discarded += 1
  }
  if (pendingCodexAuthorizationLastUsed.size === 0 && !codexTelemetryDirty) {
    clearCodexAuthorizationLastUsedFlushTimer()
  }
  return discarded
}

export function codexAuthorizationLastUsedDiagnostics() {
  return {
    pending: pendingCodexAuthorizationLastUsed.size,
    timerScheduled: codexAuthorizationLastUsedFlushTimer !== null,
    flushing: Boolean(codexAuthorizationLastUsedFlushPromise),
    maxPending: CODEX_AUTHORIZATION_LAST_USED_MAX_PENDING,
    batchSize: CODEX_AUTHORIZATION_LAST_USED_FLUSH_BATCH_SIZE,
    flushDelayMs: CODEX_AUTHORIZATION_LAST_USED_FLUSH_DELAY_MS,
    persistIntervalMs: CODEX_TELEMETRY_PERSIST_INTERVAL_MS,
    telemetryDirty: codexTelemetryDirty,
    telemetryGeneration: codexTelemetryMutationGeneration,
    securityMutationGeneration: securityDurableMutationGeneration,
    securityAcknowledgedGeneration: securityDurableAcknowledgedGeneration,
    ...codexAuthorizationLastUsedCounters,
  }
}

function insertCodexAuthorizationAuditEvent(database, {
  actorId = null,
  message,
  metadata = {},
  at = nowStamp(),
}) {
  database.prepare(
    `INSERT INTO system_events (
      id, time, scope, actor_id, message, metadata_json
    ) VALUES (?, ?, 'Codex authorization', ?, ?, ?)`,
  ).run(
    createId('event'),
    at,
    actorId,
    normalizeCodexText(message, 500),
    toJson(metadata),
  )
}

async function finalizeCodexSecurityMutation(mutated = true) {
  if (mutated) invalidateSharedStoreCache()
  // Authorization creation, scope changes, revocation, approval, denial and
  // exchange are security boundaries. A successful return must mean the
  // configured source of truth can recover the mutation after an immediate
  // worker crash; a debounced whole-snapshot write is not an acknowledgement.
  await acknowledgeSecurityStorageMutation(mutated)
}

function finalizeCodexTelemetryMutation() {
  // Poll cadence is operational telemetry, not an authorization grant. Keep
  // it on one global persistence cadence; forcing a whole-database snapshot
  // every five seconds would amplify healthy device polling into an incident.
  markCodexTelemetryDirty()
}

function activeCodexAuthorizationCount(database, userId, issuedAuthVersion, at) {
  const idleCutoff = new Date(
    new Date(at).getTime() - CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS,
  ).toISOString()
  return Number(
    database.prepare(
      `SELECT COUNT(*) AS count
       FROM codex_authorizations
       WHERE user_id = ?
         AND issued_auth_version = ?
         AND revoked_at IS NULL
         AND scope_version = ?
         AND (expires_at IS NULL OR expires_at > ?)
         AND COALESCE(last_used_at, created_at) > ?`,
    ).get(userId, issuedAuthVersion, CODEX_AUTHORIZATION_SCOPE_VERSION, at, idleCutoff)?.count ?? 0,
  )
}

export async function createCodexAuthorization(input) {
  await ensureStorage()
  const createdAt = normalizeCodexTimestamp(input?.createdAt ?? nowStamp(), 'createdAt')
  const createdAtMs = new Date(createdAt).getTime()
  const userId = normalizeCodexText(input?.userId, 160)
  const tokenSelector = requireCodexOpaqueMaterial(input?.tokenSelector, 'token selector', 8, 160)
  const tokenHash = requireCodexOpaqueMaterial(input?.tokenHash, 'token hash', 32, 256)
  const tokenHint = normalizeCodexText(input?.tokenHint, 80)
  const name = normalizeCodexText(input?.name, 120, 'Codex')
  const clientName = normalizeCodexText(input?.clientName, 120)
  const clientVersion = normalizeCodexText(input?.clientVersion, 64)
  const deviceName = normalizeCodexText(input?.deviceName, 120)
  const scopes = normalizeCodexScopes(input?.grantedScopes ?? input?.scopes ?? [])
  const scopeVersion = normalizeCodexScopeVersion(input?.scopeVersion)
  const expiresAt = normalizeCodexTimestamp(
    input?.expiresAt,
    'expiresAt',
    { nullable: true, after: createdAtMs },
  )
  if (!userId) {
    throw codexAuthorizationError(400, 'INVALID_CODEX_AUTHORIZATION_USER', 'A user is required.')
  }

  let authorization = null
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const user = database.prepare(
        'SELECT id, disabled_at, auth_version FROM users WHERE id = ? LIMIT 1',
      ).get(userId)
      if (!user) {
        throw codexAuthorizationError(404, 'CODEX_AUTHORIZATION_USER_NOT_FOUND', 'The user was not found.')
      }
      if (user.disabled_at) {
        throw codexAuthorizationError(409, 'CODEX_AUTHORIZATION_USER_DISABLED', 'The user is disabled.')
      }
      const currentAuthVersion = normalizeAccountAuthVersion(user.auth_version)
      const issuedAuthVersion = input?.issuedAuthVersion === undefined
        ? currentAuthVersion
        : normalizeCodexAuthVersion(input.issuedAuthVersion)
      if (issuedAuthVersion !== currentAuthVersion) {
        throw codexAuthorizationError(
          409,
          'CODEX_AUTHORIZATION_AUTH_VERSION_CHANGED',
          'The user authentication state changed before authorization was created.',
        )
      }
      if (
        activeCodexAuthorizationCount(database, userId, issuedAuthVersion, createdAt)
        >= MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER
      ) {
        throw codexAuthorizationError(
          409,
          'CODEX_AUTHORIZATION_LIMIT',
          'The account has reached its active Codex authorization limit.',
          { limit: MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER },
        )
      }
      const id = createId('codexauth')
      database.prepare(
        `INSERT INTO codex_authorizations (
          id, user_id, token_selector, token_hash, token_hint, name,
          client_name, client_version, device_name, scopes_json, scope_version,
          issued_auth_version, created_at, updated_at, expires_at,
          last_used_at, revoked_at, revoked_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      ).run(
        id,
        userId,
        tokenSelector,
        tokenHash,
        tokenHint,
        name,
        clientName,
        clientVersion,
        deviceName,
        toJson(scopes),
        scopeVersion,
        issuedAuthVersion,
        createdAt,
        createdAt,
        expiresAt,
      )
      insertCodexAuthorizationAuditEvent(database, {
        actorId: input?.actorId ?? userId,
        at: createdAt,
        message: 'Created Codex authorization',
        metadata: {
          authorizationId: id,
          clientName,
          clientVersion,
          deviceName,
          scopes,
          scopeVersion,
          expiresAt,
        },
      })
      return codexAuthorizationSelect(database, 'authorization.id = ?', id)
    })
    authorization = publicCodexAuthorization(transaction.immediate(), { at: createdAt })
  })
  await finalizeCodexSecurityMutation()
  return authorization
}

export async function listCodexAuthorizations(userId, { at = nowStamp() } = {}) {
  await ensureStorage()
  return getDb().prepare(
    `SELECT
       authorization.*,
       account.id AS account_id,
       account.disabled_at AS account_disabled_at,
       account.auth_version AS account_auth_version
     FROM codex_authorizations authorization
     LEFT JOIN users account ON account.id = authorization.user_id
     WHERE authorization.user_id = ?
     ORDER BY authorization.created_at DESC, authorization.id DESC`,
  ).all(userId).map((row) => publicCodexAuthorization(row, { at }))
}

export async function getCodexAuthorizationById(userId, authorizationId, { at = nowStamp() } = {}) {
  await ensureStorage()
  return publicCodexAuthorization(
    codexAuthorizationSelect(
      getDb(),
      'authorization.user_id = ? AND authorization.id = ?',
      userId,
      authorizationId,
    ),
    { at },
  )
}

export async function findCodexAuthorizationBySelector(tokenSelector, { at = nowStamp() } = {}) {
  await ensureStorage()
  const selector = requireCodexOpaqueMaterial(tokenSelector, 'token selector', 8, 160)
  const row = codexAuthorizationSelect(getDb(), 'authorization.token_selector = ?', selector)
  if (!row) return null
  const authorization = publicCodexAuthorization(row, { at })
  return {
    ...authorization,
    tokenSelector: row.token_selector,
    tokenHash: row.token_hash,
    tokenHint: row.token_hint || '',
    issuedAuthVersion: Number(row.issued_auth_version ?? 0),
    account: {
      id: row.user_id,
      name: row.account_name || '',
      email: row.account_email || '',
      role: row.account_role || 'user',
      authVersion: normalizeAccountAuthVersion(row.account_auth_version),
    },
  }
}

export async function findCurrentCodexAuthorizationBySelector(tokenSelector, options = {}) {
  const authorization = await findCodexAuthorizationBySelector(tokenSelector, options)
  if (!authorization || authorization.status !== 'active') {
    if (authorization?.id) discardPendingCodexAuthorizationLastUsed(authorization.id)
    return null
  }
  return authorization
}

export async function touchCodexAuthorizationLastUsed(
  authorizationId,
  {
    at = nowStamp(),
    minIntervalMs = CODEX_AUTHORIZATION_LAST_USED_INTERVAL_MS,
  } = {},
) {
  await ensureStorage()
  const touchedAt = normalizeCodexTimestamp(at, 'lastUsedAt')
  const intervalMs = Math.max(
    60_000,
    Math.min(24 * 60 * 60 * 1000, Number(minIntervalMs) || CODEX_AUTHORIZATION_LAST_USED_INTERVAL_MS),
  )
  const current = codexAuthorizationSelect(getDb(), 'authorization.id = ?', authorizationId)
  if (!current || codexAuthorizationStatus(current, touchedAt) !== 'active') {
    discardPendingCodexAuthorizationLastUsed(authorizationId)
    return { authorization: null, touched: false }
  }
  const lastUsedMs = new Date(effectiveCodexAuthorizationLastUsedAt(current) ?? '').getTime()
  if (Number.isFinite(lastUsedMs) && new Date(touchedAt).getTime() - lastUsedMs < intervalMs) {
    codexAuthorizationLastUsedCounters.coalesced += 1
    return {
      authorization: publicCodexAuthorization(current, { at: touchedAt }),
      touched: false,
    }
  }

  const touched = await queueCodexAuthorizationLastUsed({
    authorizationId,
    userId: current.user_id,
    at: touchedAt,
  })
  // Queue-capacity recovery can await one batch. Re-read the security scalars
  // before returning so a concurrent revoke, disable, or auth-version bump is
  // authoritative and a pending activity stamp can never mask it.
  const latest = codexAuthorizationSelect(getDb(), 'authorization.id = ?', authorizationId)
  if (!latest || codexAuthorizationStatus(latest, touchedAt) !== 'active') {
    discardPendingCodexAuthorizationLastUsed(authorizationId)
    return { authorization: null, touched: false }
  }
  return {
    authorization: publicCodexAuthorization(latest, { at: touchedAt }),
    touched,
  }
}

export async function updateCodexAuthorization(
  userId,
  authorizationId,
  patch = {},
  { actorId = userId, at = nowStamp() } = {},
) {
  await ensureStorage()
  const updatedAt = normalizeCodexTimestamp(at, 'updatedAt')
  let authorization = null
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const current = codexAuthorizationSelect(
        database,
        'authorization.user_id = ? AND authorization.id = ?',
        userId,
        authorizationId,
      )
      if (!current) return null
      const currentScopes = codexScopesFromJson(current.scopes_json)
      const requestedScopes = Object.hasOwn(patch, 'grantedScopes')
        ? patch.grantedScopes
        : Object.hasOwn(patch, 'scopes')
          ? patch.scopes
          : currentScopes
      const nextScopes = normalizeCodexScopes(requestedScopes)
      const currentScopeSet = new Set(currentScopes)
      if (nextScopes.some((scope) => !currentScopeSet.has(scope))) {
        throw codexAuthorizationError(
          409,
          'CODEX_SCOPE_EXPANSION_REQUIRES_APPROVAL',
          'Adding Codex authorization scopes requires a new interactive approval.',
        )
      }
      const nextName = Object.hasOwn(patch, 'name')
        ? normalizeCodexText(patch.name, 120)
        : current.name
      let nextExpiresAt = current.expires_at
      if (Object.hasOwn(patch, 'expiresAt')) {
        nextExpiresAt = normalizeCodexTimestamp(
          patch.expiresAt,
          'expiresAt',
          { nullable: true, after: new Date(updatedAt).getTime() },
        )
        if (
          (current.expires_at && nextExpiresAt === null)
          || (
            current.expires_at
            && nextExpiresAt
            && new Date(nextExpiresAt).getTime() > new Date(current.expires_at).getTime()
          )
        ) {
          throw codexAuthorizationError(
            409,
            'CODEX_AUTHORIZATION_EXTENSION_REQUIRES_APPROVAL',
            'Extending a Codex authorization requires a new interactive approval.',
          )
        }
      }
      const scopesChanged = toJson(nextScopes) !== toJson(currentScopes)
      const changed = nextName !== current.name || nextExpiresAt !== current.expires_at || scopesChanged
      if (!changed) return current
      database.prepare(
        `UPDATE codex_authorizations
         SET name = ?, scopes_json = ?, expires_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(nextName, toJson(nextScopes), nextExpiresAt, updatedAt, authorizationId, userId)
      insertCodexAuthorizationAuditEvent(database, {
        actorId,
        at: updatedAt,
        message: 'Updated Codex authorization',
        metadata: {
          authorizationId,
          nameChanged: nextName !== current.name,
          scopesReduced: scopesChanged,
          expiresAt: nextExpiresAt,
        },
      })
      mutated = true
      return codexAuthorizationSelect(database, 'authorization.id = ?', authorizationId)
    })
    authorization = publicCodexAuthorization(transaction.immediate(), { at: updatedAt })
  })
  await finalizeCodexSecurityMutation(mutated)
  return authorization
}

export async function revokeCodexAuthorization(
  userId,
  authorizationId,
  { reason = 'user_revoked', actorId = userId, at = nowStamp() } = {},
) {
  await ensureStorage()
  const revokedAt = normalizeCodexTimestamp(at, 'revokedAt')
  const revokedReason = normalizeCodexText(reason, 80, 'user_revoked') || 'user_revoked'
  let authorization = null
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const current = codexAuthorizationSelect(
        database,
        'authorization.user_id = ? AND authorization.id = ?',
        userId,
        authorizationId,
      )
      if (!current) return null
      if (current.revoked_at) return current
      const updated = database.prepare(
        `UPDATE codex_authorizations
         SET revoked_at = ?, revoked_reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      ).run(revokedAt, revokedReason, revokedAt, authorizationId, userId)
      if (updated.changes !== 1) {
        return codexAuthorizationSelect(database, 'authorization.id = ?', authorizationId)
      }
      insertCodexAuthorizationAuditEvent(database, {
        actorId,
        at: revokedAt,
        message: 'Revoked Codex authorization',
        metadata: { authorizationId, reason: revokedReason },
      })
      mutated = true
      return codexAuthorizationSelect(database, 'authorization.id = ?', authorizationId)
    })
    authorization = publicCodexAuthorization(transaction.immediate(), { at: revokedAt })
  })
  if (authorization?.userId === userId) {
    discardPendingCodexAuthorizationLastUsed(authorizationId)
  }
  await finalizeCodexSecurityMutation(mutated)
  return authorization
}

export function revokeCurrentCodexAuthorization(
  authorizationId,
  userId,
  options = {},
) {
  return revokeCodexAuthorization(userId, authorizationId, {
    reason: 'client_logout',
    ...options,
  })
}

/**
 * Reversible pause. A revoked credential stays revoked: resuming only clears
 * the pause, so this can never bring a withdrawn token back to life.
 */
export async function setCodexAuthorizationDisabled(
  userId,
  authorizationId,
  disabled,
  { actorId = userId, at = nowStamp() } = {},
) {
  await ensureStorage()
  const updatedAt = normalizeCodexTimestamp(at, 'updatedAt')
  const nextDisabledAt = disabled ? updatedAt : null
  let authorization = null
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const current = codexAuthorizationSelect(
        database,
        'authorization.user_id = ? AND authorization.id = ?',
        userId,
        authorizationId,
      )
      if (!current) return null
      if (current.revoked_at) {
        throw codexAuthorizationError(
          409,
          'CODEX_AUTHORIZATION_REVOKED',
          'A revoked Codex authorization cannot be resumed.',
        )
      }
      if (Boolean(current.disabled_at) === Boolean(disabled)) return current
      database.prepare(
        `UPDATE codex_authorizations
         SET disabled_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      ).run(nextDisabledAt, updatedAt, authorizationId, userId)
      insertCodexAuthorizationAuditEvent(database, {
        actorId,
        at: updatedAt,
        message: disabled ? 'Paused Codex authorization' : 'Resumed Codex authorization',
        metadata: { authorizationId, disabled: Boolean(disabled) },
      })
      mutated = true
      return codexAuthorizationSelect(database, 'authorization.id = ?', authorizationId)
    })
    authorization = publicCodexAuthorization(transaction.immediate(), { at: updatedAt })
  })
  if (disabled && authorization?.userId === userId) {
    discardPendingCodexAuthorizationLastUsed(authorizationId)
  }
  await finalizeCodexSecurityMutation(mutated)
  return authorization
}

/**
 * Removes the credential outright. Stronger than revoking: the selector no
 * longer resolves at all. The audit event lives in `system_events`, so the
 * history of the grant survives the row.
 */
export async function deleteCodexAuthorization(
  userId,
  authorizationId,
  { actorId = userId, at = nowStamp() } = {},
) {
  await ensureStorage()
  const deletedAt = normalizeCodexTimestamp(at, 'deletedAt')
  let authorization = null
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const current = codexAuthorizationSelect(
        database,
        'authorization.user_id = ? AND authorization.id = ?',
        userId,
        authorizationId,
      )
      if (!current) return null
      const removed = database.prepare(
        'DELETE FROM codex_authorizations WHERE id = ? AND user_id = ?',
      ).run(authorizationId, userId)
      if (removed.changes !== 1) return current
      insertCodexAuthorizationAuditEvent(database, {
        actorId,
        at: deletedAt,
        message: 'Deleted Codex authorization',
        metadata: { authorizationId, name: current.name || '' },
      })
      mutated = true
      return current
    })
    authorization = publicCodexAuthorization(transaction.immediate(), { at: deletedAt })
  })
  if (mutated) discardPendingCodexAuthorizationLastUsed(authorizationId)
  await finalizeCodexSecurityMutation(mutated)
  return authorization ? { ...authorization, deleted: mutated } : null
}

export async function revokeAllCodexAuthorizations(
  userId,
  { reason = 'user_revoked_all', actorId = userId, at = nowStamp() } = {},
) {
  await ensureStorage()
  const revokedAt = normalizeCodexTimestamp(at, 'revokedAt')
  const revokedReason = normalizeCodexText(reason, 80, 'user_revoked_all') || 'user_revoked_all'
  let outcome = { revokedCount: 0, authorizations: [] }
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      const updated = database.prepare(
        `UPDATE codex_authorizations
         SET revoked_at = ?, revoked_reason = ?, updated_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      ).run(revokedAt, revokedReason, revokedAt, userId)
      const revokedCount = Number(updated.changes ?? 0)
      if (revokedCount > 0) {
        insertCodexAuthorizationAuditEvent(database, {
          actorId,
          at: revokedAt,
          message: 'Revoked all Codex authorizations',
          metadata: { reason: revokedReason, revokedCount },
        })
      }
      const rows = database.prepare(
        `SELECT
           authorization.*,
           account.id AS account_id,
           account.disabled_at AS account_disabled_at,
           account.auth_version AS account_auth_version
         FROM codex_authorizations authorization
         LEFT JOIN users account ON account.id = authorization.user_id
         WHERE authorization.user_id = ?
         ORDER BY authorization.created_at DESC, authorization.id DESC`,
      ).all(userId)
      return {
        revokedCount,
        authorizations: rows.map((row) => publicCodexAuthorization(row, { at: revokedAt })),
      }
    })
    outcome = transaction.immediate()
  })
  discardPendingCodexAuthorizationLastUsedForUser(userId)
  await finalizeCodexSecurityMutation(outcome.revokedCount > 0)
  return outcome
}

function normalizeCodexPollInterval(value) {
  const interval = Number(value ?? 5)
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 60) {
    throw codexAuthorizationError(
      400,
      'INVALID_CODEX_DEVICE_POLL_INTERVAL',
      'The device polling interval must be between 1 and 60 seconds.',
    )
  }
  return interval
}

function normalizeCodexAuthorizationExpiryDays(value, fallback = 365) {
  const days = Number(value ?? fallback)
  if (!CODEX_AUTHORIZATION_EXPIRY_DAY_OPTIONS.includes(days)) {
    throw codexAuthorizationError(
      400,
      'INVALID_CODEX_AUTHORIZATION_EXPIRY',
      `Authorization duration must be one of: ${CODEX_AUTHORIZATION_EXPIRY_DAY_OPTIONS.join(', ')} days.`,
    )
  }
  return days
}

function codexDevicePollReason(status) {
  if (status === 'pending') return 'AUTHORIZATION_PENDING'
  if (status === 'approved') return 'AUTHORIZED'
  if (status === 'denied') return 'ACCESS_DENIED'
  if (status === 'consumed') return 'ALREADY_CONSUMED'
  if (status === 'expired') return 'EXPIRED'
  if (status === 'invalidated') return 'AUTHORIZATION_INVALIDATED'
  return 'NOT_FOUND'
}

function expireCodexDeviceAuthorization(database, row, at) {
  if (codexDeviceAuthorizationStatus(row, at) !== 'expired' || row.status === 'expired') return row
  database.prepare(
    `UPDATE codex_device_authorizations
     SET status = 'expired'
     WHERE id = ? AND status IN ('pending', 'approved')`,
  ).run(row.id)
  return database.prepare('SELECT * FROM codex_device_authorizations WHERE id = ?').get(row.id)
}

export async function createCodexDeviceAuthorization(input) {
  await ensureStorage()
  const createdAt = normalizeCodexTimestamp(input?.createdAt ?? nowStamp(), 'createdAt')
  const createdAtMs = new Date(createdAt).getTime()
  const expiresAt = normalizeCodexTimestamp(
    input?.expiresAt,
    'expiresAt',
    { after: createdAtMs },
  )
  const deviceCodeHash = requireCodexOpaqueMaterial(input?.deviceCodeHash, 'device code hash', 32, 256)
  const userCodeHash = requireCodexOpaqueMaterial(input?.userCodeHash, 'user code hash', 32, 256)
  const requestedScopes = normalizeCodexScopes(input?.requestedScopes ?? [])
  const requestedExpiresInDays = normalizeCodexAuthorizationExpiryDays(
    input?.requestedExpiresInDays,
  )
  const scopeVersion = normalizeCodexScopeVersion(input?.scopeVersion)
  const clientName = normalizeCodexText(input?.clientName, 120)
  const clientVersion = normalizeCodexText(input?.clientVersion, 64)
  const deviceName = normalizeCodexText(input?.deviceName, 120)
  const pollIntervalSeconds = normalizeCodexPollInterval(input?.pollIntervalSeconds)
  let deviceAuthorization = null
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      database.prepare(
        `UPDATE codex_device_authorizations
         SET status = 'expired'
         WHERE status IN ('pending', 'approved') AND expires_at <= ?`,
      ).run(createdAt)
      const retentionCutoff = new Date(
        createdAtMs - CODEX_DEVICE_AUTHORIZATION_RETENTION_MS,
      ).toISOString()
      database.prepare(
        `DELETE FROM codex_device_authorizations
         WHERE status IN ('denied', 'consumed', 'expired')
           AND COALESCE(consumed_at, denied_at, expires_at) < ?`,
      ).run(retentionCutoff)
      const pendingCount = Number(
        database.prepare(
          `SELECT COUNT(*) AS count
           FROM codex_device_authorizations
           WHERE status IN ('pending', 'approved') AND expires_at > ?`,
        ).get(createdAt)?.count ?? 0,
      )
      if (pendingCount >= MAX_PENDING_CODEX_DEVICE_AUTHORIZATIONS) {
        throw codexAuthorizationError(
          503,
          'CODEX_DEVICE_AUTHORIZATION_CAPACITY',
          'Too many device authorizations are pending. Retry later.',
          { retryAfterSeconds: 60 },
        )
      }
      let rowCount = Number(
        database.prepare('SELECT COUNT(*) AS count FROM codex_device_authorizations').get()?.count ?? 0,
      )
      if (rowCount >= MAX_CODEX_DEVICE_AUTHORIZATION_ROWS) {
        database.prepare(
          `DELETE FROM codex_device_authorizations
           WHERE id IN (
             SELECT id
             FROM codex_device_authorizations
             WHERE status IN ('denied', 'consumed', 'expired')
             ORDER BY COALESCE(consumed_at, denied_at, expires_at) ASC, id ASC
             LIMIT ?
           )`,
        ).run(rowCount - MAX_CODEX_DEVICE_AUTHORIZATION_ROWS + 1)
        rowCount = Number(
          database.prepare('SELECT COUNT(*) AS count FROM codex_device_authorizations').get()?.count ?? 0,
        )
      }
      if (rowCount >= MAX_CODEX_DEVICE_AUTHORIZATION_ROWS) {
        throw codexAuthorizationError(
          503,
          'CODEX_DEVICE_AUTHORIZATION_CAPACITY',
          'Device authorization storage is at capacity. Retry later.',
          { retryAfterSeconds: 60 },
        )
      }
      const id = createId('codexdevice')
      database.prepare(
        `INSERT INTO codex_device_authorizations (
          id, device_code_hash, user_code_hash, client_name, client_version,
          device_name, requested_scopes_json, requested_expires_in_days,
          approved_scopes_json, approved_expires_in_days, approved_name,
          scope_version, status, created_at, expires_at,
          poll_interval_seconds, last_polled_at, poll_count,
          approved_user_id, approved_auth_version, approved_at,
          denied_by_user_id, denied_at, denial_reason,
          consumed_at, authorization_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 'pending', ?, ?, ?, NULL, 0,
                  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ).run(
        id,
        deviceCodeHash,
        userCodeHash,
        clientName,
        clientVersion,
        deviceName,
        toJson(requestedScopes),
        requestedExpiresInDays,
        scopeVersion,
        createdAt,
        expiresAt,
        pollIntervalSeconds,
      )
      return database.prepare('SELECT * FROM codex_device_authorizations WHERE id = ?').get(id)
    })
    deviceAuthorization = publicCodexDeviceAuthorization(transaction.immediate(), { at: createdAt })
  })
  await finalizeCodexSecurityMutation()
  return deviceAuthorization
}

export async function getCodexDeviceAuthorizationByUserCodeHash(
  userCodeHash,
  { at = nowStamp() } = {},
) {
  await ensureStorage()
  const hash = requireCodexOpaqueMaterial(userCodeHash, 'user code hash', 32, 256)
  return publicCodexDeviceAuthorization(
    getDb().prepare(
      'SELECT * FROM codex_device_authorizations WHERE user_code_hash = ? LIMIT 1',
    ).get(hash),
    { at },
  )
}

export async function getCodexDeviceAuthorizationById(id, { at = nowStamp() } = {}) {
  await ensureStorage()
  return publicCodexDeviceAuthorization(
    getDb().prepare('SELECT * FROM codex_device_authorizations WHERE id = ? LIMIT 1').get(id),
    { at },
  )
}

export async function approveCodexDeviceAuthorization(
  userCodeHash,
  {
    userId,
    approvedScopes,
    approvedExpiresInDays,
    name,
    authorizationName,
    approvedAuthVersion,
    at = nowStamp(),
  } = {},
) {
  await ensureStorage()
  const hash = requireCodexOpaqueMaterial(userCodeHash, 'user code hash', 32, 256)
  const approvedAt = normalizeCodexTimestamp(at, 'approvedAt')
  const scopes = normalizeCodexScopes(approvedScopes ?? [])
  let outcome = { ok: false, reason: 'NOT_FOUND', deviceAuthorization: null }
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      let row = database.prepare(
        'SELECT * FROM codex_device_authorizations WHERE user_code_hash = ? LIMIT 1',
      ).get(hash)
      if (!row) return outcome
      const statusBeforeExpiry = row.status
      row = expireCodexDeviceAuthorization(database, row, approvedAt)
      mutated = row.status !== statusBeforeExpiry
      if (codexDeviceAuthorizationStatus(row, approvedAt) === 'invalidated') {
        return {
          ok: false,
          reason: 'AUTHORIZATION_INVALIDATED',
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: approvedAt }),
        }
      }
      if (row.status === 'expired') {
        return {
          ok: false,
          reason: 'EXPIRED',
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: approvedAt }),
        }
      }
      if (row.status === 'approved') {
        const alreadyApproved = row.approved_user_id === userId
        return {
          ok: alreadyApproved,
          reason: alreadyApproved ? undefined : 'ALREADY_APPROVED',
          alreadyApproved,
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: approvedAt }),
        }
      }
      if (row.status !== 'pending') {
        return {
          ok: false,
          reason: codexDevicePollReason(row.status),
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: approvedAt }),
        }
      }
      const user = database.prepare(
        'SELECT id, disabled_at, auth_version FROM users WHERE id = ? LIMIT 1',
      ).get(userId)
      if (!user) {
        throw codexAuthorizationError(404, 'CODEX_AUTHORIZATION_USER_NOT_FOUND', 'The user was not found.')
      }
      if (user.disabled_at) {
        throw codexAuthorizationError(409, 'CODEX_AUTHORIZATION_USER_DISABLED', 'The user is disabled.')
      }
      const currentAuthVersion = normalizeAccountAuthVersion(user.auth_version)
      if (
        approvedAuthVersion !== undefined
        && normalizeCodexAuthVersion(approvedAuthVersion) !== currentAuthVersion
      ) {
        throw codexAuthorizationError(
          409,
          'CODEX_AUTHORIZATION_AUTH_VERSION_CHANGED',
          'The user authentication state changed before approval.',
        )
      }
      const requestedScopeSet = new Set(codexScopesFromJson(row.requested_scopes_json))
      if (scopes.some((scope) => !requestedScopeSet.has(scope))) {
        throw codexAuthorizationError(
          409,
          'CODEX_SCOPE_EXPANSION_REQUIRES_APPROVAL',
          'Approved scopes must be a subset of the requested scopes.',
        )
      }
      const requestedDuration = normalizeCodexAuthorizationExpiryDays(
        row.requested_expires_in_days,
      )
      const approvedDuration = normalizeCodexAuthorizationExpiryDays(
        approvedExpiresInDays,
        requestedDuration,
      )
      if (approvedDuration > requestedDuration) {
        throw codexAuthorizationError(
          409,
          'CODEX_AUTHORIZATION_DURATION_EXPANSION_REQUIRES_APPROVAL',
          'Approved duration must not exceed the duration requested by the device.',
        )
      }
      const approvedName = normalizeCodexText(
        authorizationName ?? name,
        120,
        row.device_name || row.client_name || 'Codex',
      )
      const updated = database.prepare(
        `UPDATE codex_device_authorizations
         SET status = 'approved', approved_scopes_json = ?,
             approved_expires_in_days = ?, approved_name = ?,
             approved_user_id = ?, approved_auth_version = ?, approved_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).run(
        toJson(scopes),
        approvedDuration,
        approvedName,
        userId,
        currentAuthVersion,
        approvedAt,
        row.id,
      )
      if (updated.changes !== 1) {
        throw codexAuthorizationError(
          409,
          'CODEX_DEVICE_AUTHORIZATION_CHANGED',
          'The device authorization changed before approval.',
        )
      }
      insertCodexAuthorizationAuditEvent(database, {
        actorId: userId,
        at: approvedAt,
        message: 'Approved Codex device authorization',
        metadata: {
          deviceAuthorizationId: row.id,
          clientName: row.client_name || '',
          deviceName: row.device_name || '',
          scopes,
          scopeVersion: Number(row.scope_version ?? 1),
          expiresInDays: approvedDuration,
          name: approvedName,
        },
      })
      mutated = true
      row = database.prepare('SELECT * FROM codex_device_authorizations WHERE id = ?').get(row.id)
      return {
        ok: true,
        deviceAuthorization: publicCodexDeviceAuthorization(row, { at: approvedAt }),
      }
    })
    outcome = transaction.immediate()
  })
  await finalizeCodexSecurityMutation(mutated)
  return outcome
}

export async function denyCodexDeviceAuthorization(
  userCodeHash,
  { userId, reason = 'user_denied', at = nowStamp() } = {},
) {
  await ensureStorage()
  const hash = requireCodexOpaqueMaterial(userCodeHash, 'user code hash', 32, 256)
  const deniedAt = normalizeCodexTimestamp(at, 'deniedAt')
  const denialReason = normalizeCodexText(reason, 80, 'user_denied') || 'user_denied'
  let outcome = { ok: false, reason: 'NOT_FOUND', deviceAuthorization: null }
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      let row = database.prepare(
        'SELECT * FROM codex_device_authorizations WHERE user_code_hash = ? LIMIT 1',
      ).get(hash)
      if (!row) return outcome
      const statusBeforeExpiry = row.status
      row = expireCodexDeviceAuthorization(database, row, deniedAt)
      mutated = row.status !== statusBeforeExpiry
      if (row.status === 'expired') {
        return {
          ok: false,
          reason: 'EXPIRED',
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: deniedAt }),
        }
      }
      if (row.status === 'denied') {
        return {
          ok: row.denied_by_user_id === userId,
          reason: 'ACCESS_DENIED',
          alreadyDenied: true,
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: deniedAt }),
        }
      }
      if (row.status === 'consumed') {
        return {
          ok: false,
          reason: 'ALREADY_CONSUMED',
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: deniedAt }),
        }
      }
      if (row.status === 'approved' && row.approved_user_id !== userId) {
        throw codexAuthorizationError(
          403,
          'CODEX_DEVICE_AUTHORIZATION_OWNER_MISMATCH',
          'This device authorization was approved by another account.',
        )
      }
      const user = database.prepare(
        'SELECT id, disabled_at FROM users WHERE id = ? LIMIT 1',
      ).get(userId)
      if (!user || user.disabled_at) {
        throw codexAuthorizationError(
          403,
          'CODEX_DEVICE_AUTHORIZATION_DENIAL_FORBIDDEN',
          'The current account cannot deny this authorization.',
        )
      }
      const updated = database.prepare(
        `UPDATE codex_device_authorizations
         SET status = 'denied', denied_by_user_id = ?, denied_at = ?, denial_reason = ?
         WHERE id = ? AND status IN ('pending', 'approved')`,
      ).run(userId, deniedAt, denialReason, row.id)
      if (updated.changes !== 1) {
        throw codexAuthorizationError(
          409,
          'CODEX_DEVICE_AUTHORIZATION_CHANGED',
          'The device authorization changed before it was denied.',
        )
      }
      insertCodexAuthorizationAuditEvent(database, {
        actorId: userId,
        at: deniedAt,
        message: 'Denied Codex device authorization',
        metadata: { deviceAuthorizationId: row.id, reason: denialReason },
      })
      mutated = true
      row = database.prepare('SELECT * FROM codex_device_authorizations WHERE id = ?').get(row.id)
      return {
        ok: true,
        reason: 'ACCESS_DENIED',
        deviceAuthorization: publicCodexDeviceAuthorization(row, { at: deniedAt }),
      }
    })
    outcome = transaction.immediate()
  })
  await finalizeCodexSecurityMutation(mutated)
  return outcome
}

export async function pollCodexDeviceAuthorization(
  deviceCodeHash,
  { at = nowStamp() } = {},
) {
  await ensureStorage()
  const hash = requireCodexOpaqueMaterial(deviceCodeHash, 'device code hash', 32, 256)
  const polledAt = normalizeCodexTimestamp(at, 'polledAt')
  const polledAtMs = new Date(polledAt).getTime()
  let outcome = {
    status: 'invalid',
    reason: 'NOT_FOUND',
    retryAfterSeconds: 0,
    deviceAuthorization: null,
  }
  let mutated = false
  let securityMutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      let row = database.prepare(
        'SELECT * FROM codex_device_authorizations WHERE device_code_hash = ? LIMIT 1',
      ).get(hash)
      if (!row) return outcome
      const statusBeforeExpiry = row.status
      row = expireCodexDeviceAuthorization(database, row, polledAt)
      if (row.status !== statusBeforeExpiry) {
        mutated = true
        securityMutated = true
      }
      const projectedStatus = codexDeviceAuthorizationStatus(row, polledAt)
      if (projectedStatus === 'invalidated') {
        return {
          status: projectedStatus,
          reason: 'AUTHORIZATION_INVALIDATED',
          retryAfterSeconds: 0,
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: polledAt }),
        }
      }
      if (row.status === 'expired') {
        return {
          status: 'expired',
          reason: 'EXPIRED',
          retryAfterSeconds: 0,
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: polledAt }),
        }
      }
      if (row.status !== 'pending' && row.status !== 'approved') {
        // Terminal device grants are immutable protocol outcomes. Return them
        // before applying polling cadence so a retry after denial or a
        // successful exchange can never be misreported as slow_down.
        return {
          status: row.status,
          reason: codexDevicePollReason(row.status),
          retryAfterSeconds: 0,
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: polledAt }),
        }
      }
      const intervalSeconds = normalizeCodexPollInterval(row.poll_interval_seconds)
      const lastPolledAtMs = row.last_polled_at
        ? new Date(row.last_polled_at).getTime()
        : Number.NEGATIVE_INFINITY
      if (
        Number.isFinite(lastPolledAtMs)
        && polledAtMs < lastPolledAtMs + intervalSeconds * 1000
      ) {
        const nextIntervalSeconds = Math.min(60, intervalSeconds + 5)
        database.prepare(
          `UPDATE codex_device_authorizations
           SET last_polled_at = ?, poll_count = poll_count + 1,
               poll_interval_seconds = ?
           WHERE id = ?`,
        ).run(polledAt, nextIntervalSeconds, row.id)
        mutated = true
        row = database.prepare('SELECT * FROM codex_device_authorizations WHERE id = ?').get(row.id)
        return {
          status: 'slow_down',
          reason: 'SLOW_DOWN',
          retryAfterSeconds: nextIntervalSeconds,
          deviceAuthorization: publicCodexDeviceAuthorization(row, { at: polledAt }),
        }
      }
      database.prepare(
        `UPDATE codex_device_authorizations
         SET last_polled_at = ?, poll_count = poll_count + 1
         WHERE id = ?`,
      ).run(polledAt, row.id)
      mutated = true
      row = database.prepare('SELECT * FROM codex_device_authorizations WHERE id = ?').get(row.id)
      return {
        status: row.status,
        reason: codexDevicePollReason(row.status),
        retryAfterSeconds: row.status === 'pending'
          ? Number(row.poll_interval_seconds ?? intervalSeconds)
          : 0,
        deviceAuthorization: publicCodexDeviceAuthorization(row, { at: polledAt }),
      }
    })
    outcome = runWithDeferredTelemetryPersistence(() => transaction.immediate())
  })
  await finalizeCodexSecurityMutation(securityMutated)
  if (mutated && !securityMutated) finalizeCodexTelemetryMutation()
  return outcome
}

export async function exchangeCodexDeviceAuthorization(
  deviceCodeHash,
  input = {},
) {
  await ensureStorage()
  const hash = requireCodexOpaqueMaterial(deviceCodeHash, 'device code hash', 32, 256)
  const exchangedAt = normalizeCodexTimestamp(input.at ?? nowStamp(), 'exchangedAt')
  const exchangedAtMs = new Date(exchangedAt).getTime()
  const tokenSelector = requireCodexOpaqueMaterial(input.tokenSelector, 'token selector', 8, 160)
  const tokenHash = requireCodexOpaqueMaterial(input.tokenHash, 'token hash', 32, 256)
  const tokenHint = normalizeCodexText(input.tokenHint, 80)
  let outcome = { ok: false, reason: 'NOT_FOUND', deviceAuthorization: null }
  let mutated = false
  await withWriteLock(async () => {
    const database = getDb()
    const transaction = database.transaction(() => {
      let deviceRow = database.prepare(
        'SELECT * FROM codex_device_authorizations WHERE device_code_hash = ? LIMIT 1',
      ).get(hash)
      if (!deviceRow) return outcome
      const statusBeforeExpiry = deviceRow.status
      deviceRow = expireCodexDeviceAuthorization(database, deviceRow, exchangedAt)
      if (deviceRow.status !== statusBeforeExpiry) mutated = true
      if (codexDeviceAuthorizationStatus(deviceRow, exchangedAt) === 'invalidated') {
        return {
          ok: false,
          reason: 'AUTHORIZATION_INVALIDATED',
          deviceAuthorization: publicCodexDeviceAuthorization(deviceRow, { at: exchangedAt }),
        }
      }
      if (deviceRow.status !== 'approved') {
        return {
          ok: false,
          reason: codexDevicePollReason(deviceRow.status),
          deviceAuthorization: publicCodexDeviceAuthorization(deviceRow, { at: exchangedAt }),
        }
      }
      const user = database.prepare(
        'SELECT id, disabled_at, auth_version FROM users WHERE id = ? LIMIT 1',
      )
        .get(deviceRow.approved_user_id)
      const currentAuthVersion = user
        ? normalizeAccountAuthVersion(user.auth_version)
        : -1
      if (
        !user
        || user.disabled_at
        || currentAuthVersion !== Number(deviceRow.approved_auth_version ?? -1)
      ) {
        database.prepare(
          `UPDATE codex_device_authorizations
           SET status = 'denied', denied_by_user_id = approved_user_id,
               denied_at = ?, denial_reason = 'authorization_invalidated'
           WHERE id = ? AND status = 'approved'`,
        ).run(exchangedAt, deviceRow.id)
        insertCodexAuthorizationAuditEvent(database, {
          actorId: deviceRow.approved_user_id ?? null,
          at: exchangedAt,
          message: 'Invalidated Codex device authorization before exchange',
          metadata: {
            deviceAuthorizationId: deviceRow.id,
            reason: 'authorization_invalidated',
          },
        })
        mutated = true
        deviceRow = database.prepare(
          'SELECT * FROM codex_device_authorizations WHERE id = ?',
        ).get(deviceRow.id)
        return {
          ok: false,
          reason: 'AUTHORIZATION_INVALIDATED',
          deviceAuthorization: publicCodexDeviceAuthorization(deviceRow, { at: exchangedAt }),
        }
      }
      if (
        activeCodexAuthorizationCount(
          database,
          user.id,
          currentAuthVersion,
          exchangedAt,
        ) >= MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER
      ) {
        throw codexAuthorizationError(
          409,
          'CODEX_AUTHORIZATION_LIMIT',
          'The account has reached its active Codex authorization limit.',
          { limit: MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER },
        )
      }
      const scopes = codexScopesFromJson(deviceRow.approved_scopes_json)
      const expiresInDays = normalizeCodexAuthorizationExpiryDays(
        deviceRow.approved_expires_in_days,
        normalizeCodexAuthorizationExpiryDays(deviceRow.requested_expires_in_days),
      )
      const expiresAt = new Date(
        exchangedAtMs + expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString()
      const authorizationId = createId('codexauth')
      const name = normalizeCodexText(
        deviceRow.approved_name,
        120,
        deviceRow.device_name || deviceRow.client_name || 'Codex',
      )
      database.prepare(
        `INSERT INTO codex_authorizations (
          id, user_id, token_selector, token_hash, token_hint, name,
          client_name, client_version, device_name, scopes_json, scope_version,
          issued_auth_version, created_at, updated_at, expires_at,
          last_used_at, revoked_at, revoked_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      ).run(
        authorizationId,
        user.id,
        tokenSelector,
        tokenHash,
        tokenHint,
        name,
        deviceRow.client_name || '',
        deviceRow.client_version || '',
        deviceRow.device_name || '',
        toJson(scopes),
        Number(deviceRow.scope_version ?? 1),
        currentAuthVersion,
        exchangedAt,
        exchangedAt,
        expiresAt,
      )
      const consumed = database.prepare(
        `UPDATE codex_device_authorizations
         SET status = 'consumed', consumed_at = ?, authorization_id = ?
         WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
      ).run(exchangedAt, authorizationId, deviceRow.id)
      if (consumed.changes !== 1) {
        throw codexAuthorizationError(
          409,
          'CODEX_DEVICE_AUTHORIZATION_CHANGED',
          'The device authorization was already exchanged.',
        )
      }
      insertCodexAuthorizationAuditEvent(database, {
        actorId: user.id,
        at: exchangedAt,
        message: 'Created Codex authorization',
        metadata: {
          authorizationId,
          deviceAuthorizationId: deviceRow.id,
          clientName: deviceRow.client_name || '',
          clientVersion: deviceRow.client_version || '',
          deviceName: deviceRow.device_name || '',
          scopes,
          scopeVersion: Number(deviceRow.scope_version ?? 1),
          expiresAt,
          expiresInDays,
        },
      })
      mutated = true
      deviceRow = database.prepare(
        'SELECT * FROM codex_device_authorizations WHERE id = ?',
      ).get(deviceRow.id)
      return {
        ok: true,
        authorization: publicCodexAuthorization(
          codexAuthorizationSelect(database, 'authorization.id = ?', authorizationId),
          { at: exchangedAt },
        ),
        deviceAuthorization: publicCodexDeviceAuthorization(deviceRow, { at: exchangedAt }),
      }
    })
    outcome = transaction.immediate()
  })
  await finalizeCodexSecurityMutation(mutated)
  return outcome
}

function schoolLogoCacheEntryFromRow(row) {
  if (!row) return null
  return {
    cacheKey: row.cache_key,
    websiteUrl: row.website_url,
    dataUrl: row.data_url || undefined,
    sourceUrl: row.source_url || undefined,
    candidateKind: row.candidate_kind || undefined,
    found: Boolean(row.found),
    updatedAt: row.updated_at,
  }
}

export function hydrateApplicationSchoolLogo(payload, schoolLogoAssets = new Map()) {
  const storedLogo = payload.school?.logo
  const cachedDataUrl = storedLogo?.assetKey
    ? schoolLogoAssets.get(storedLogo.assetKey)
    : null
  return storedLogo?.assetKey && !storedLogo.dataUrl && cachedDataUrl
    ? {
        ...payload,
        school: {
          ...payload.school,
          logo: {
            ...storedLogo,
            dataUrl: cachedDataUrl,
          },
        },
      }
    : payload
}

export function referencedSchoolLogoAssetKeys(applicationPayloads) {
  const assetKeys = new Set()
  for (const payload of applicationPayloads) {
    const storedLogo = payload?.school?.logo
    if (
      typeof storedLogo?.assetKey === 'string'
      && storedLogo.assetKey
      && !storedLogo.dataUrl
    ) {
      assetKeys.add(storedLogo.assetKey)
    }
  }
  return [...assetKeys]
}

export function readReferencedSchoolLogoAssets(database, applicationPayloads) {
  const assetKeys = referencedSchoolLogoAssetKeys(applicationPayloads)
  const assets = new Map()
  for (let offset = 0; offset < assetKeys.length; offset += SCHOOL_LOGO_ASSET_QUERY_BATCH_SIZE) {
    const batch = assetKeys.slice(offset, offset + SCHOOL_LOGO_ASSET_QUERY_BATCH_SIZE)
    const placeholders = batch.map(() => '?').join(', ')
    const rows = database
      .prepare(`SELECT asset_key, data_url FROM school_logo_assets WHERE asset_key IN (${placeholders})`)
      .all(...batch)
    for (const row of rows) assets.set(row.asset_key, row.data_url)
  }
  return assets
}

function applicationFromRow(row, schoolLogoAssets = new Map(), decodedPayload) {
  const payload = decodedPayload ?? decodePayloadFromStorage(row.payload_json)
  const hydratedPayload = hydrateApplicationSchoolLogo(payload, schoolLogoAssets)
  const application = {
    ...hydratedPayload,
    id: row.id,
    ownerId: row.owner_id,
    teamId: row.team_id ?? null,
    createdAt: hydratedPayload.createdAt,
    updatedAt: row.updated_at,
  }
  Object.defineProperty(application, applicationPayloadVersionSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Number(row.payload_version ?? 0),
  })
  return application
}

/** Exact row revision captured in the same SQLite snapshot as the decoded payload. */
export function applicationPayloadVersion(application) {
  const value = Number(application?.[applicationPayloadVersionSymbol])
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function applicationAuthoredContentHash(application) {
  const hash = createHash('sha256')
  for (const chunk of canonicalApplicationUserEditableChunks(application)) {
    hash.update(chunk, 'utf8')
  }
  return hash.digest('base64url')
}

function applicationAuthorityContentHashes(application) {
  const hashes = {}
  for (const authorityPurpose of Object.keys(APPLICATION_MUTATION_AUTHORITY_PATHS)) {
    const hash = createHash('sha256')
    for (const chunk of canonicalApplicationAuthorityReceiptChunks(application, authorityPurpose)) {
      hash.update(chunk, 'utf8')
    }
    hashes[authorityPurpose] = hash.digest('base64url')
  }
  return hashes
}

const OUTGOING_MAIL_JOURNAL_BACKFILL_KEY = 'outgoing-mail-deliveries-v1'
const OUTGOING_DELIVERY_STATUS_RANK = Object.freeze({
  queued: 1,
  sending: 2,
  accepted: 3,
  sent: 4,
  cancelled: 5,
})

function outgoingDeliveryStatusForCommunication(communication) {
  if (communication?.deliveryStatus === 'sent') return 'sent'
  if (communication?.deliveryStatus === 'sending') return 'sending'
  return 'queued'
}

function outgoingMailCommunicationPayload(value) {
  const plain = isEncryptedPayload(value) ? decryptPayload(value) : value
  return fromJson(plain, {})
}

function outgoingMailDeliveryFromRow(row) {
  if (!row) return null
  let communication = null
  let payloadError = null
  try {
    communication = outgoingMailCommunicationPayload(row.communication_encrypted)
  } catch (error) {
    payloadError = error instanceof Error
      ? error.message
      : 'The outgoing email payload could not be decrypted.'
  }
  return {
    communicationId: row.communication_id,
    deliveryId: row.delivery_id,
    applicationId: row.application_id,
    deliveryUserId: row.delivery_user_id,
    status: row.status,
    communication,
    payloadError,
    messageId: row.message_id,
    smtpMessageId: row.smtp_message_id ?? null,
    sourceMessageKey: row.source_message_key ?? null,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? null,
    dispatchStartedAt: row.dispatch_started_at ?? null,
    acceptedAt: row.accepted_at ?? null,
    completedAt: row.completed_at ?? null,
    attemptCount: Math.max(0, Number(row.attempt_count) || 0),
    nextAttemptAt: row.next_attempt_at ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorAt: row.last_error_at ?? null,
    updatedAt: row.updated_at,
  }
}

function canonicalOutgoingCommunication(delivery, current = null) {
  const communication = {
    ...(delivery.communication ?? {}),
    ...(current ?? {}),
    id: delivery.communicationId,
    deliveryId: delivery.deliveryId,
    deliveryUserId: delivery.deliveryUserId,
    scheduledAt: delivery.scheduledAt,
    deliveryAttemptCount: delivery.attemptCount,
  }
  if (delivery.status === 'queued') {
    communication.deliveryStatus = 'queued'
    delete communication.deliveryStartedAt
    if (delivery.nextAttemptAt) communication.nextDeliveryAttemptAt = delivery.nextAttemptAt
    else delete communication.nextDeliveryAttemptAt
    if (delivery.lastErrorCode) {
      communication.deliveryLastErrorCode = delivery.lastErrorCode
      communication.deliveryLastErrorAt = delivery.lastErrorAt
    }
    return communication
  }
  if (delivery.status === 'sending') {
    communication.deliveryStatus = 'sending'
    communication.deliveryStartedAt = delivery.startedAt
    delete communication.nextDeliveryAttemptAt
    if (delivery.dispatchStartedAt) {
      communication.deliveryLastErrorCode = 'SMTP_OUTCOME_UNKNOWN'
      communication.deliveryLastErrorAt = delivery.dispatchStartedAt
    }
    return communication
  }
  if (delivery.status === 'accepted' || delivery.status === 'sent') {
    const acceptedAt = delivery.acceptedAt ?? delivery.completedAt ?? delivery.updatedAt
    communication.deliveryStatus = 'sent'
    communication.sentAt = acceptedAt
    communication.date = acceptedAt.slice(0, 10)
    communication.time = acceptedAt.slice(11, 16)
    communication.messageType = 'outgoing-email'
    communication.sourceMessageKey = delivery.sourceMessageKey
      ?? communication.sourceMessageKey
    communication.sourceMailbox = 'smtp'
    delete communication.deliveryStartedAt
    delete communication.nextDeliveryAttemptAt
    delete communication.deliveryLastErrorCode
    delete communication.deliveryLastErrorAt
  }
  return communication
}

function reconcileApplicationWithOutgoingDeliveryJournalRows(application, rows) {
  if (rows.length === 0) return application

  const communications = Array.isArray(application.communications)
    ? [...application.communications]
    : []
  let changed = false
  for (const row of rows) {
    const delivery = outgoingMailDeliveryFromRow(row)
    if (!delivery?.communication || delivery.payloadError) continue
    const residentDelivery = delivery.status === 'accepted'
      ? { ...delivery, status: 'sending', startedAt: null }
      : delivery
    const index = communications.findIndex((communication) => (
      communication.id === delivery.communicationId
    ))
    // A successfully delivered row can subsequently be removed by an explicit
    // user action. Active and accepted work, however, must survive stale whole-
    // application writes until the journal has been projected to `sent`.
    if (index < 0) {
      if (delivery.status !== 'sent') {
        communications.unshift(canonicalOutgoingCommunication(residentDelivery))
        changed = true
      }
      continue
    }
    const currentRank = OUTGOING_DELIVERY_STATUS_RANK[
      outgoingDeliveryStatusForCommunication(communications[index])
    ] ?? 0
    const journalRank = OUTGOING_DELIVERY_STATUS_RANK[delivery.status] ?? 0
    if (journalRank < currentRank) continue
    const canonical = canonicalOutgoingCommunication(residentDelivery, communications[index])
    if (toJson(canonical) !== toJson(communications[index])) {
      communications[index] = canonical
      changed = true
    }
  }
  if (!changed) return application
  const nextApplication = { ...application, communications }
  reconcileMailClassificationFingerprints(nextApplication)
  return nextApplication
}

function outgoingDeliveryRowsFingerprint(rows) {
  const hash = createHash('sha256')
  for (const row of rows ?? []) {
    for (const key of Object.keys(row).sort()) {
      hash.update(key, 'utf8')
      hash.update('\0', 'utf8')
      const value = row[key]
      hash.update(value === null || value === undefined ? '\0' : String(value), 'utf8')
      hash.update('\0', 'utf8')
    }
    hash.update('\n', 'utf8')
  }
  return hash.digest('hex')
}

function prepareOutgoingMailDeliverySyncStatements(database) {
  return {
    selectExisting: database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ),
    insertDelivery: database.prepare(
      `INSERT INTO outgoing_mail_deliveries (
         communication_id, delivery_id, application_id, delivery_user_id,
         status, communication_encrypted, message_id, smtp_message_id,
         source_message_key, created_at, scheduled_at, started_at, accepted_at,
         dispatch_started_at, completed_at, attempt_count, next_attempt_at, last_error_code,
         last_error_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateDelivery: database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET status = ?, communication_encrypted = ?, scheduled_at = ?,
           started_at = ?, accepted_at = ?, dispatch_started_at = ?, completed_at = ?,
           attempt_count = ?, next_attempt_at = ?, last_error_code = ?,
           last_error_at = ?, smtp_message_id = COALESCE(?, smtp_message_id),
           source_message_key = COALESCE(?, source_message_key), updated_at = ?
       WHERE communication_id = ?`,
    ),
    listCancellable: database.prepare(
      `SELECT communication_id FROM outgoing_mail_deliveries
       WHERE application_id = ?
         AND (status = 'queued' OR (status = 'sending' AND dispatch_started_at IS NULL))`,
    ),
    cancelDelivery: database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET status = 'cancelled', started_at = NULL, next_attempt_at = NULL,
           last_error_code = 'COMMUNICATION_REMOVED', last_error_at = ?,
           updated_at = ?
       WHERE communication_id = ?
         AND (status = 'queued' OR (status = 'sending' AND dispatch_started_at IS NULL))`,
    ),
  }
}

function syncOutgoingMailDeliveriesForApplication(
  database,
  application,
  at = nowStamp(),
  preparedStatements = null,
) {
  const {
    selectExisting,
    insertDelivery,
    updateDelivery,
    listCancellable,
    cancelDelivery,
  } = preparedStatements ?? prepareOutgoingMailDeliverySyncStatements(database)

  const residentCommunicationIds = new Set()
  for (const communication of application.communications ?? []) {
    if (
      !communication?.id
      || !communication.deliveryId
      || !communication.deliveryUserId
      || !['queued', 'sending', 'sent'].includes(communication.deliveryStatus)
    ) continue
    residentCommunicationIds.add(communication.id)
    const existing = selectExisting.get(communication.id)
    const candidateStatus = outgoingDeliveryStatusForCommunication(communication)
    const createdAt = communication.enqueuedAt
      ?? application.createdAt
      ?? at
    const scheduledAt = communication.scheduledAt ?? createdAt
    const acceptedAt = candidateStatus === 'sent'
      ? (communication.sentAt ?? at)
      : null
    const attemptCount = Math.max(0, Number(communication.deliveryAttemptCount) || 0)
    if (!existing) {
      const payloadEncrypted = encryptPayload(toJson(communication))
      insertDelivery.run(
        communication.id,
        communication.deliveryId,
        application.id,
        communication.deliveryUserId,
        candidateStatus,
        payloadEncrypted,
        outgoingDeliveryMessageId(communication.deliveryId),
        null,
        communication.sourceMessageKey ?? null,
        createdAt,
        scheduledAt,
        communication.deliveryStartedAt ?? null,
        acceptedAt,
        null,
        candidateStatus === 'sent' ? acceptedAt : null,
        attemptCount,
        communication.nextDeliveryAttemptAt ?? null,
        communication.deliveryLastErrorCode ?? null,
        communication.deliveryLastErrorAt ?? null,
        at,
      )
      continue
    }
    // Communication identity and its initial authored payload become immutable
    // after the first SMTP claim. A scheduled row may still be edited before
    // that claim, so refresh only an untouched queued snapshot.
    if (existing.delivery_id !== communication.deliveryId) continue
    const existingRank = OUTGOING_DELIVERY_STATUS_RANK[existing.status] ?? 0
    const candidateRank = OUTGOING_DELIVERY_STATUS_RANK[candidateStatus] ?? 0
    const nextStatus = candidateRank > existingRank ? candidateStatus : existing.status
    const mayRefreshPayload = existing.status === 'queued'
      && Number(existing.attempt_count ?? 0) === 0
      && candidateStatus === 'queued'
    const communicationJson = mayRefreshPayload ? toJson(communication) : null
    const payloadChanged = mayRefreshPayload
      && toJson(outgoingMailCommunicationPayload(existing.communication_encrypted)) !== communicationJson
    const refreshedPayload = payloadChanged
      ? encryptPayload(communicationJson)
      : existing.communication_encrypted
    const nextScheduledAt = mayRefreshPayload ? scheduledAt : existing.scheduled_at
    const nextStartedAt = nextStatus === 'sending'
      ? (communication.deliveryStartedAt ?? existing.started_at)
      : null
    const nextAcceptedAt = nextStatus === 'sent'
      ? (existing.accepted_at ?? acceptedAt ?? at)
      : existing.accepted_at
    const nextDispatchStartedAt = existing.dispatch_started_at ?? null
    const nextCompletedAt = nextStatus === 'sent'
      ? (existing.completed_at ?? acceptedAt ?? at)
      : existing.completed_at
    const nextAttemptCount = Math.max(Number(existing.attempt_count ?? 0), attemptCount)
    const nextAttemptAt = nextStatus === 'queued'
      ? (communication.nextDeliveryAttemptAt ?? existing.next_attempt_at)
      : null
    const nextErrorCode = nextStatus === 'queued'
      ? (communication.deliveryLastErrorCode ?? existing.last_error_code)
      : null
    const nextErrorAt = nextStatus === 'queued'
      ? (communication.deliveryLastErrorAt ?? existing.last_error_at)
      : null
    const nextSourceMessageKey = communication.sourceMessageKey ?? existing.source_message_key
    if (
      !payloadChanged
      && nextStatus === existing.status
      && nextScheduledAt === existing.scheduled_at
      && nextStartedAt === existing.started_at
      && nextAcceptedAt === existing.accepted_at
      && nextDispatchStartedAt === (existing.dispatch_started_at ?? null)
      && nextCompletedAt === existing.completed_at
      && nextAttemptCount === Number(existing.attempt_count ?? 0)
      && nextAttemptAt === existing.next_attempt_at
      && nextErrorCode === existing.last_error_code
      && nextErrorAt === existing.last_error_at
      && nextSourceMessageKey === existing.source_message_key
    ) continue
    updateDelivery.run(
      nextStatus,
      refreshedPayload,
      nextScheduledAt,
      nextStartedAt,
      nextAcceptedAt,
      nextDispatchStartedAt,
      nextCompletedAt,
      nextAttemptCount,
      nextAttemptAt,
      nextErrorCode,
      nextErrorAt,
      existing.smtp_message_id,
      nextSourceMessageKey,
      at,
      communication.id,
    )
  }
  for (const row of listCancellable.all(application.id)) {
    if (residentCommunicationIds.has(row.communication_id)) continue
    cancelDelivery.run(at, at, row.communication_id)
  }
}

function backfillOutgoingMailDeliveryJournal(database) {
  if (database.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(OUTGOING_MAIL_JOURNAL_BACKFILL_KEY)) {
    return
  }
  const transaction = database.transaction(() => {
    const preparedStatements = prepareOutgoingMailDeliverySyncStatements(database)
    let cursor = ''
    for (;;) {
      const preflight = database.prepare(
        `SELECT id, payload_version,
                LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
           FROM applications WHERE id > ? ORDER BY id ASC LIMIT 1`,
      ).get(cursor)
      if (!preflight) break
      cursor = preflight.id
      const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
      try {
        const row = database.prepare(
          `SELECT id, owner_id, team_id, updated_at, payload_version, payload_json
             FROM applications WHERE id = ?`,
        ).get(preflight.id)
        if (!row || Number(row.payload_version ?? 0) !== Number(preflight.payload_version ?? 0)) {
          continue
        }
        const payload = decodePayloadFromStorage(row.payload_json)
        syncOutgoingMailDeliveriesForApplication(database, {
          ...payload,
          id: row.id,
          ownerId: row.owner_id,
          teamId: row.team_id ?? null,
          createdAt: payload.createdAt ?? row.updated_at,
        }, row.updated_at ?? nowStamp(), preparedStatements)
      } finally {
        releaseMemory?.()
      }
    }
    database.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(OUTGOING_MAIL_JOURNAL_BACKFILL_KEY, toJson({ completedAt: nowStamp() }))
  })
  transaction.immediate()
}

function validSchoolLogoCacheKey(value) {
  return /^[a-f0-9]{64}$/u.test(String(value || ''))
}

function schoolLogoAssetForStorage(application) {
  const logo = application.school?.logo
  if (logo?.source !== 'website' || !logo.dataUrl) return null
  const assetKey = createHash('sha256').update(logo.dataUrl).digest('hex')
  const { dataUrl: _dataUrl, ...storedLogo } = logo
  return {
    logoAsset: {
      assetKey,
      dataUrl: logo.dataUrl,
      updatedAt: logo.updatedAt ?? nowStamp(),
    },
    application: {
      ...application,
      school: {
        ...application.school,
        logo: {
          ...storedLogo,
          assetKey,
        },
      },
    },
  }
}

function schoolLogoApplicationForStorage(application, assetStatement) {
  const staged = schoolLogoAssetForStorage(application)
  if (!staged) return application
  assetStatement.run(
    staged.logoAsset.assetKey,
    staged.logoAsset.dataUrl,
    staged.logoAsset.updatedAt,
  )
  return staged.application
}

function profileAssetFromRow(row) {
  const payload = decodePayloadFromStorage(row.payload_json)
  row.payload_json = ''
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
      adminEntryHidden: false,
      adminEntryCodeHash: '',
      adminEntryCodeSalt: '',
      notificationMailbox: PUBLIC_DISTRIBUTION ? '' : 'admin-alerts@phd-atlas.local',
      systemLogRetentionDays: DEFAULT_SYSTEM_LOG_RETENTION_DAYS,
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

  // The published Docker/runtime always uses production and must start with a
  // blank administrator setup. Test and development processes retain seeded
  // fixtures so Team permission coverage remains deterministic.
  if (PUBLIC_DISTRIBUTION && process.env.NODE_ENV === 'production') {
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
        canonical_email,
        recovery_email,
        language,
        role,
        password_hash,
        auth_version,
        created_at,
        last_login_at,
        disabled_at,
        settings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      adminId,
      'Administrator',
      DEFAULT_ADMIN_EMAIL,
      DEFAULT_ADMIN_EMAIL,
      DEFAULT_ADMIN_EMAIL,
      'en',
      'admin',
      passwordHash,
      0,
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
    const projection = accountAuthProjection({
      id: existing.id,
      email: account.email,
      settings,
      authVersion: existing.auth_version,
    })
    database
      .prepare(
        `UPDATE users
            SET name = ?, canonical_email = ?, recovery_email = ?, language = ?,
                auth_version = ?, role = ?, disabled_at = NULL, settings_json = ?
          WHERE id = ?`,
      )
      .run(
        account.name,
        projection.canonicalEmail,
        projection.recoveryEmail,
        projection.language,
        projection.authVersion,
        existing.role === 'admin' ? 'admin' : 'user',
        toJson({ ...settings, authVersion: projection.authVersion }),
        existing.id,
      )
    return existing.id
  }

  const preferredIdTaken = database.prepare('SELECT id FROM users WHERE id = ?').get(account.id)
  const userId = preferredIdTaken ? createId('user') : account.id
  const settings = demoUserSettings(account.email, 'zh', account.teamRole)
  const projection = accountAuthProjection({ id: userId, email: account.email, settings })
  database
    .prepare(
      `INSERT INTO users (
        id,
        name,
        email,
        canonical_email,
        recovery_email,
        language,
        role,
        password_hash,
        auth_version,
        created_at,
        last_login_at,
        disabled_at,
        settings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, NULL, NULL, ?)`,
    )
    .run(
      userId,
      account.name,
      account.email,
      projection.canonicalEmail,
      projection.recoveryEmail,
      projection.language,
      passwordHash,
      projection.authVersion,
      now,
      toJson({ ...settings, authVersion: projection.authVersion }),
    )
  return userId
}

function ensureDemoTeamMember(database, {
  key,
  teamId,
  userId,
  email,
  role,
  invitedBy,
  relationships = {},
  contactProfile = {},
  now,
}) {
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
             invite_token_hash = NULL, invite_expires_at = NULL, relationship_json = ?,
             profile_json = ?, removed_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        userId,
        normalizedEmail,
        role,
        invitedBy,
        toJson(relationships),
        toJson(contactProfile),
        now,
        existing.id,
      )
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
        relationship_json,
        profile_json,
        created_at,
        updated_at,
        removed_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, ?, ?, NULL)`,
    )
    .run(
      memberId,
      teamId,
      userId,
      normalizedEmail,
      role,
      invitedBy,
      toJson(relationships),
      toJson(contactProfile),
      now,
      now,
    )
  return memberId
}

function demoTeamApplications(teamId, users, now) {
  const teacherId = users.teacher
  const secondTeacherId = users.teacherB
  const compactApplication = ({
    id,
    ownerId,
    school,
    country,
    website,
    program,
    professor,
    email,
    research,
    deadline,
    status,
    progress,
    priority,
    teacher,
    task,
  }) => ({
    id,
    ownerId,
    teamId,
    professor: {
      english: professor,
      chinese: '',
      email,
      phone: '',
      social: '',
      homepage: website,
      research,
      lab: `${research.split(',')[0]} Lab`,
    },
    school: { name: school, country, website },
    program,
    deadline,
    status,
    progress,
    priority,
    tags: [research.split(',')[0], status.toLowerCase(), 'team-review'],
    nextReminder: '2026-08-05',
    result: 'Team review in progress',
    materials: [
      { id: `${id}-sop`, name: 'Statement of Purpose', type: 'DOCX', status: progress > 60 ? 'Submitted' : 'Draft', version: 'v2', updatedAt: '2026-07-24', versions: [] },
      { id: `${id}-proposal`, name: 'Research Proposal', type: 'PDF', status: progress > 70 ? 'Submitted' : 'Needs revision', version: 'v3', updatedAt: '2026-07-23', versions: [] },
      { id: `${id}-cv`, name: 'Academic CV', type: 'PDF', status: 'Submitted', version: 'v4', updatedAt: '2026-07-20', versions: [] },
    ],
    communications: [
      { id: `${id}-mail`, subject: 'Supervisor discussion', channel: 'Email', date: '2026-07-22', summary: 'The prospective supervisor requested a sharper methods and contribution statement.' },
    ],
    scholarships: [],
    tasks: [
      { id: `${id}-task`, title: task, due: '2026-08-05', done: false },
    ],
    timeline: [
      { id: `${id}-timeline`, title: 'Collaborative review started', date: '2026-07-22', note: 'The student shared the application with the organization mentoring team.' },
    ],
    versions: [],
    shares: [],
    reviewComments: [
      {
        id: `${id}-review`,
        authorId: teacher,
        authorName: teacher === users.teacherC ? 'Dr. Sofia Berg' : teacher === users.teacherD ? 'Dr. Kwame Mensah' : 'Prof. Alex Rivera',
        body: 'Please connect the proposed method to one concrete evaluation milestone and explain the fallback plan.',
        createdAt: '2026-07-24T10:00:00.000Z',
        targetTab: 'dossier',
      },
    ],
    createdAt: now,
    updatedAt: '2026-07-24T10:00:00.000Z',
  })
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
    compactApplication({
      id: 'team-demo-hana-eth-bioai',
      ownerId: users.studentC,
      school: 'ETH Zürich',
      country: 'Switzerland',
      website: 'https://ethz.ch/en/doctorate.html',
      program: 'Computational Biology PhD',
      professor: 'Prof. Elena Rossi',
      email: 'elena.rossi@ethz.ch',
      research: 'single-cell modelling, causal representation learning',
      deadline: '2026-12-01',
      status: 'Preparing',
      progress: 47,
      priority: 88,
      teacher: users.teacherC,
      task: 'Strengthen the biological validation plan',
    }),
    compactApplication({
      id: 'team-demo-diego-imperial-energy',
      ownerId: users.studentD,
      school: 'Imperial College London',
      country: 'United Kingdom',
      website: 'https://www.imperial.ac.uk/study/courses/postgraduate-taught/',
      program: 'Sustainable Energy Futures PhD',
      professor: 'Dr. Priya Nair',
      email: 'priya.nair@imperial.ac.uk',
      research: 'energy systems, robust optimisation',
      deadline: '2026-09-30',
      status: 'Draft',
      progress: 39,
      priority: 79,
      teacher: users.teacherD,
      task: 'Add the uncertainty-aware policy experiment',
    }),
    compactApplication({
      id: 'team-demo-amina-cambridge-genomics',
      ownerId: users.studentE,
      school: 'University of Cambridge',
      country: 'United Kingdom',
      website: 'https://www.postgraduate.study.cam.ac.uk/',
      program: 'Genomic Medicine PhD',
      professor: 'Prof. Alice Morgan',
      email: 'alice.morgan@cam.ac.uk',
      research: 'population genomics, equitable clinical prediction',
      deadline: '2026-10-15',
      status: 'Submitted',
      progress: 84,
      priority: 93,
      teacher: users.teacherC,
      task: 'Prepare responses for the methods interview',
    }),
    compactApplication({
      id: 'team-demo-eva-stanford-hai',
      ownerId: users.studentG,
      school: 'Stanford University',
      country: 'United States',
      website: 'https://gradadmissions.stanford.edu/',
      program: 'Computer Science PhD',
      professor: 'Prof. Jordan Lee',
      email: 'jordan.lee@stanford.edu',
      research: 'human-AI decision making, evaluation science',
      deadline: '2026-11-30',
      status: 'Interview',
      progress: 72,
      priority: 96,
      teacher: users.teacherB,
      task: 'Run a cross-disciplinary mock interview',
    }),
  ]
}

function ensureDemoApplication(database, application) {
  const existing = database.prepare(
    'SELECT id, owner_id, team_id, payload_version, payload_json FROM applications WHERE id = ?',
  ).get(application.id)
  if (existing) {
    database
      .prepare('UPDATE applications SET team_id = ? WHERE id = ? AND (team_id IS NULL OR team_id = ?)')
      .run(application.teamId, application.id, application.teamId)
    const payload = decodePayloadFromStorage(existing.payload_json)
    replaceWorkspacePublicGrants(database, 'application', {
      ...(payload && typeof payload === 'object' ? payload : {}),
      id: existing.id,
      ownerId: existing.owner_id,
      teamId: application.teamId ?? existing.team_id ?? null,
    }, existing.payload_version)
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
      // Startup demo seeding is intentionally synchronous: demo entity ids are
      // created inside this bootstrap transaction and the payloads are small,
      // so there is no async-safe pre-encode point without widening the
      // transaction boundary.
      encodePayloadForStorage(application),
      application.teamId,
    )
  replaceWorkspacePublicGrants(database, 'application', application, 0)
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

    const demoMemberIds = {}
    demoMemberIds.owner = ensureDemoTeamMember(database, {
      key: 'owner',
      teamId: team.id,
      userId: owner.id,
      email: DEFAULT_USER_EMAIL,
      role: 'owner',
      invitedBy: owner.id,
      now,
    })
    for (const account of DEMO_TEAM_MEMBER_ACCOUNTS) {
      const teacherUserIds = account.teamRole === 'member'
        ? (account.teacherKeys ?? ['teacher']).map((key) => users[key]).filter(Boolean)
        : []
      demoMemberIds[account.key] = ensureDemoTeamMember(database, {
        key: account.key,
        teamId: team.id,
        userId: users[account.key],
        email: account.email,
        role: account.teamRole,
        invitedBy: account.teamRole === 'member' ? (teacherUserIds[0] ?? users.teacher) : owner.id,
        relationships: account.teamRole === 'member' ? { teacherIds: teacherUserIds } : {},
        contactProfile: account.contactProfile ?? {},
        now,
      })
    }

    const storedTeacherGroups = normalizeTeamTeacherGroups(fromJson(team.teacher_groups_json, []))
    const demoTeacherGroups = [
      {
        id: 'tgroup_demo_writing',
        name: 'Writing & Research Statements',
        memberIds: [demoMemberIds.teacher, demoMemberIds.teacherB],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tgroup_demo_methods',
        name: 'Methods & Data',
        memberIds: [demoMemberIds.teacherB, demoMemberIds.teacherC],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tgroup_demo_funding',
        name: 'Funding & Interviews',
        memberIds: [demoMemberIds.teacher, demoMemberIds.teacherD],
        createdAt: now,
        updatedAt: now,
      },
    ]
    const mergedTeacherGroups = [
      ...storedTeacherGroups,
      ...demoTeacherGroups.filter((group) => !storedTeacherGroups.some((existing) => existing.id === group.id)),
    ]
    database
      .prepare('UPDATE teams SET teacher_groups_json = ?, updated_at = ? WHERE id = ?')
      .run(toJson(mergedTeacherGroups), now, team.id)

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
  const codexContext = context?.codexAuthorization
  const credentialId = normalizeCodexText(
    codexContext?.credentialId ?? codexContext?.id,
    180,
  )
  const grantedScopes = Array.isArray(codexContext?.grantedScopes ?? codexContext?.scopes)
    ? Array.from(new Set(
        (codexContext.grantedScopes ?? codexContext.scopes)
          .filter((scope) => typeof scope === 'string')
          .map((scope) => scope.trim())
          .filter((scope) => CODEX_AUTHORIZATION_SCOPE_SET.has(scope))
          .slice(0, CODEX_AUTHORIZATION_SCOPES.length),
      )).sort(
        (left, right) => CODEX_AUTHORIZATION_SCOPE_ORDER.get(left) - CODEX_AUTHORIZATION_SCOPE_ORDER.get(right),
      )
    : []
  let enrichedMetadata = shouldUseDelegatedActor && context.impersonation
    ? { ...metadata, impersonation: context.impersonation }
    : metadata
  if (credentialId) {
    // Deliberately enumerate safe attribution fields. Never spread the
    // credential context: it may also carry the bearer token, selector, or
    // verifier hash required by authentication.
    enrichedMetadata = {
      ...enrichedMetadata,
      codexAuthorization: {
        credentialId,
        name: normalizeCodexText(codexContext?.name, 120),
        grantedScopes,
        scopeVersion: Number(codexContext?.scopeVersion) === CODEX_AUTHORIZATION_SCOPE_VERSION
          ? CODEX_AUTHORIZATION_SCOPE_VERSION
          : null,
        clientName: normalizeCodexText(
          codexContext?.clientName ?? codexContext?.client?.name,
          120,
        ),
        deviceName: normalizeCodexText(
          codexContext?.deviceName ?? codexContext?.device?.name,
          120,
        ),
      },
    }
  }
  const eventTime = nowStamp()
  const automaticBackupIdentity = automaticBackupEventIdentity({
    actorId,
    scope: event.scope,
    message: event.message,
    metadata: enrichedMetadata,
  })
  if (automaticBackupIdentity) {
    const previousIndex = store.systemEvents.findIndex(
      (candidate) => candidate.id === automaticBackupIdentity.id,
    )
    const previous = previousIndex >= 0 ? store.systemEvents[previousIndex] : null
    if (previousIndex >= 0) store.systemEvents.splice(previousIndex, 1)
    const previousOccurrences = Number(previous?.metadata?.occurrences)
    enrichedMetadata = {
      ...enrichedMetadata,
      occurrences: Number.isSafeInteger(previousOccurrences) && previousOccurrences > 0
        ? previousOccurrences + 1
        : 1,
      firstCreatedAt: previous?.metadata?.firstCreatedAt ?? previous?.time ?? eventTime,
      lastCreatedAt: eventTime,
    }
  }
  const nextEvent = {
    id: automaticBackupIdentity?.id ?? createId('event'),
    time: eventTime,
    scope: event.scope,
    actorId,
    message: event.message,
    metadata: enrichedMetadata,
  }
  store.systemEvents.unshift(nextEvent)
  store.systemEvents = store.systemEvents.slice(0, SYSTEM_EVENT_WORKING_SET_LIMIT)
  return nextEvent
}

function migrateLegacyDiscoverSourceIndexes(database) {
  const batchSize = 32
  const selectLegacy = database.prepare(
    `SELECT id, settings_json
       FROM users
      WHERE json_type(settings_json, '$.discoverSourceIndex') IS NOT NULL
        AND id > ?
      ORDER BY id ASC
      LIMIT ?`,
  )
  const upsert = database.prepare(
    `INSERT INTO discover_source_indexes (
       user_id,
       scope,
       payload_json,
       payload_bytes,
       updated_at
     ) VALUES (?, 'personal', ?, ?, ?)
     ON CONFLICT(user_id, scope) DO UPDATE SET
       payload_json = excluded.payload_json,
       payload_bytes = excluded.payload_bytes,
       updated_at = excluded.updated_at`,
  )
  const updateSettings = database.prepare(
    'UPDATE users SET settings_json = ? WHERE id = ?',
  )
  let cursor = ''
  while (true) {
    const rows = selectLegacy.all(cursor, batchSize)
    if (rows.length === 0) break
    for (const row of rows) {
      cursor = row.id
      const settings = fromJson(row.settings_json, {})
      if (!Object.hasOwn(settings, 'discoverSourceIndex')) continue
      const index = settings.discoverSourceIndex
      if (index && typeof index === 'object' && !Array.isArray(index)) {
        const payloadJson = toJson(index)
        upsert.run(
          row.id,
          payloadJson,
          Buffer.byteLength(payloadJson, 'utf8'),
          nowStamp(),
        )
      }
      delete settings.discoverSourceIndex
      updateSettings.run(toJson(settings), row.id)
    }
  }
}

async function initializeStorage(options = {}) {
  storageInitialized = false
  // Public artifacts intentionally start empty only when they are running as a
  // deployed production service. Keeping the test/development fixture seeded
  // preserves deterministic Team permission coverage in the public repository.
  const publicProductionSetup = PUBLIC_DISTRIBUTION && process.env.NODE_ENV === 'production'
  await fs.mkdir(uploadRoot, { recursive: true })
  await fs.mkdir(backupRoot, { recursive: true })
  await ensureStorageServiceProcessLease({ signal: options.signal })
  await prepareConfiguredDatabaseSource({ signal: options.signal })
  await storageInitializationFailpoint?.({
    stage: 'configured-source-ready',
    signal: options.signal,
  })
  await cleanupInterruptedBackupArtifacts()
  const hadPlainDatabase = await plainSqliteExists(databasePath)
  const hadSealedDatabase = await sealedSqliteExists(sealedDatabasePath)
  const recoveryArtifactsPresent = await hasWorkspaceRecoveryArtifacts()
  // If a sealed DB exists (sqlite encryption previously enabled), restore it first.
  try {
    if (!isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
      if (hadSealedDatabase) {
        await ensureEncryptedSqliteProcessLease({ sealedStartup: true, signal: options.signal })
      }
      await maybeUnsealDatabase()
    }
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
  } else if (!publicProductionSetup) {
    await ensureDefaultAdminUser(database)
  }
  if (!publicProductionSetup && !PUBLIC_EDITION) {
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
  // Legacy application payloads may be bound to the configured encryption
  // password. Backfill only after that runtime profile is active; otherwise a
  // freshly sealed journal snapshot could become undecryptable moments later.
  backfillOutgoingMailDeliveryJournal(database)
  await reconcileSqliteEncryptionMode()
  if (process.env.NODE_ENV !== 'test') await rewriteBackupEncryption(activeEncryptionPolicy)
  await recoverWorkspaceBackupLifecycleAtStartup()
  if (
    isExternalDatabaseConfiguration(activeDatabaseConfiguration)
    && readDurableWorkspaceRevision(getDb()) > lastExternalSyncedRevision
  ) {
    // Startup repair/normalization helpers run while scheduled synchronization
    // is intentionally disabled. Detect their trigger-driven revision bumps at
    // the final boundary so a restart cannot leave them only in the local cache.
    durableRevisionRequiresExternalFlush = true
  }
  storageInitialized = true
  if (durableRevisionRequiresExternalFlush) {
    await synchronizeExternalDatabase({ force: true })
  }
}

export function ensureStorage(attemptOrOptions = null, options = {}) {
  // Only the server startup coordinator owns cancellation of the one global
  // initialization promise. Ordinary request callers must not be able to
  // abort storage initialization for every other request.
  const signal = typeof attemptOrOptions === 'number' && Number.isFinite(attemptOrOptions)
    ? options.signal
    : undefined
  if (storageShuttingDown && storageShutdownContext.getStore() !== true) {
    return Promise.reject(storageLifecycleError())
  }
  if (
    storageTerminalShutdownRequested
    && !storageReadyPromise
    && storageShutdownContext.getStore() !== true
  ) {
    return Promise.reject(storageLifecycleError(
      'The workspace storage owner has terminated and cannot be reopened in this process.',
      'STORAGE_TERMINATED',
    ))
  }
  if (
    storageInitialized
    && (!storageServiceProcessLease?.valid || !encryptedSqliteProcessLease?.valid)
    && storageShutdownContext.getStore() !== true
  ) {
    const error = new Error('A storage process lease was lost; this worker is no longer authoritative.')
    error.code = 'STORAGE_PROCESS_LEASE_LOST'
    error.status = 503
    return Promise.reject(error)
  }
  if (!storageReadyPromise) {
    const initializationController = new AbortController()
    storageInitializationAbortController = initializationController
    const initializationSignal = signal
      ? AbortSignal.any([signal, initializationController.signal])
      : initializationController.signal
    const initialization = initializeStorage({ signal: initializationSignal })
    let guardedInitialization
    guardedInitialization = initialization.catch(async (error) => {
      storageInitialized = false
      try {
        if (sealInFlightPromise) await sealInFlightPromise.catch(() => undefined)
        closeOpenDatabase()
        clearPendingDatabaseImage()
        await releaseEncryptedSqliteProcessLease().catch((releaseError) => {
          console.error('[storage] Failed to release SQLite startup lease:', releaseError)
        })
        if (!encryptedSqliteProcessLease?.valid) {
          await releaseStorageServiceProcessLease().catch((releaseError) => {
            console.error('[storage] Failed to release storage service startup lease:', releaseError)
          })
        }
      } finally {
        if (storageReadyPromise === guardedInitialization) storageReadyPromise = null
      }
      throw error
    }).finally(() => {
      if (storageInitializationAbortController === initializationController) {
        storageInitializationAbortController = null
      }
    })
    storageReadyPromise = guardedInitialization
  }
  return storageReadyPromise
}

async function performStorageShutdown() {
  await payloadWorkerPool.close().catch(() => undefined)
  if (
    !storageInitialized
    && !db
    && !encryptedSqliteProcessLease
    && !storageServiceProcessLease
    && !storageReadyPromise
    && pendingCodexAuthorizationLastUsed.size === 0
    && !codexTelemetryDirty
    && securityDurableAcknowledgedGeneration >= securityDurableMutationGeneration
  ) {
    storageShutdownDurabilityFailed = false
    return
  }
  const errors = []
  storageShutdownDurabilityFailed = false
  const attempt = async (label, operation) => {
    try {
      return await operation()
    } catch (error) {
      errors.push({ label, error })
      return undefined
    }
  }

  clearCodexAuthorizationLastUsedFlushTimer()
  storageInitializationAbortController?.abort(storageLifecycleError())
  if (storageReadyPromise && !storageInitialized) {
    await storageReadyPromise.catch(() => undefined)
  }
  if (!storageInitialized) {
    closeOpenDatabase()
    clearPendingDatabaseImage()
    await attempt('incomplete initialization SQLite lease release', () => (
      releaseEncryptedSqliteProcessLease()
    ))
    if (!encryptedSqliteProcessLease?.valid) {
      await attempt('incomplete initialization service lease release', () => (
        releaseStorageServiceProcessLease()
      ))
    }
    storageReadyPromise = null
    if (encryptedSqliteProcessLease?.valid || storageServiceProcessLease?.valid) {
      storageShutdownDurabilityFailed = true
      const error = new Error('Storage initialization stopped, but a process lease could not be released.')
      error.code = 'STORAGE_INITIALIZATION_SHUTDOWN_FAILED'
      error.shutdownDurabilityRetained = true
      throw error
    }
    storageShutdownDurabilityFailed = false
    return
  }
  if (securityDurableAckPromise) {
    await attempt('security durability acknowledgement', () => securityDurableAckPromise)
  }
  if (codexTelemetryPersistPromise) {
    await attempt('Codex telemetry persistence', () => codexTelemetryPersistPromise)
  }
  if (codexAuthorizationLastUsedFlushPromise) {
    await attempt('Codex authorization activity flush', () => codexAuthorizationLastUsedFlushPromise)
  }
  if (pendingCodexAuthorizationLastUsed.size > 0 || codexTelemetryDirty) {
    await attempt('final Codex telemetry flush', () => flushCodexTelemetryPersistence())
  }

  try {
    await withWriteLock(() => withDatabaseHandleReplacement(async () => {
      // A better-sqlite3 backup advances across asynchronous Immediate
      // callbacks. Own the source gate before draining so a new workspace
      // backup cannot start between this barrier and closeOpenDatabase().
      await drainLocalDatabaseSnapshots()
      if (workspaceQuotaHeartbeatTimer) {
        clearInterval(workspaceQuotaHeartbeatTimer)
        workspaceQuotaHeartbeatTimer = null
      }
      if (db) {
        try {
          getDb().prepare('DELETE FROM workspace_quota_processes WHERE instance_id = ?')
            .run(workspaceQuotaProcessInstanceId)
          activeWorkspaceQuotaReservations.clear()
          workspaceQuotaBackupActorsSynchronized.clear()
        } catch {
          // Schema initialization may have failed before the heartbeat tables exist.
        }
      }
      if (sealAfterWriteTimer) {
        clearTimeout(sealAfterWriteTimer)
        sealAfterWriteTimer = null
      }
      if (externalSyncTimer) {
        clearTimeout(externalSyncTimer)
        externalSyncTimer = null
      }

      let finalDurabilityError = null
      for (let retry = 0; retry < 3; retry += 1) {
        try {
          await storageShutdownDurabilityFailpoint?.({ attempt: retry + 1 })
          if (activeEncryptionPolicy?.sqliteEncryption) await maybeSealDatabase()
          if (isExternalDatabaseConfiguration(activeDatabaseConfiguration)) {
            await synchronizeExternalDatabase({ force: true })
          }
          finalDurabilityError = null
          break
        } catch (error) {
          finalDurabilityError = error
          if (retry < 2) {
            await new Promise((resolve) => setTimeout(resolve, 50 * (2 ** retry)))
          }
        }
      }
      if (finalDurabilityError) {
        storageShutdownDurabilityFailed = true
        errors.push({ label: 'configured source-of-truth final durability', error: finalDurabilityError })
        return
      }
      if (pendingCodexAuthorizationLastUsed.size > 0) {
        const error = new Error('Codex authorization activity remained resident after the final flush.')
        error.code = 'STORAGE_SHUTDOWN_TELEMETRY_PENDING'
        storageShutdownDurabilityFailed = true
        errors.push({ label: 'resident Codex authorization activity', error })
        return
      }
      // The final configured-source snapshot supersedes an earlier
      // acknowledgement error for SQL mutations already committed locally.
      securityDurableAcknowledgedGeneration = Math.max(
        securityDurableAcknowledgedGeneration,
        securityDurableMutationGeneration,
      )
      codexTelemetryDirty = false

      if (backupIndexDatabase) {
        try {
          backupIndexDatabase.pragma('wal_checkpoint(TRUNCATE)')
        } catch {
          // The index is reconstructible from sidecars and bounded legacy probes.
        }
        try {
          backupIndexDatabase.close()
        } catch {
          // Ignore an already-closed auxiliary index.
        }
        backupIndexDatabase = null
      }
      backupIndexScan = null
      backupInfoCache.clear()
      closeOpenDatabase()
      clearPendingDatabaseImage()
      const databaseLeaseReleaseErrorCount = errors.length
      await attempt('SQLite process lease release', () => releaseEncryptedSqliteProcessLease())
      const databaseLeaseReleaseSucceeded = (
        errors.length === databaseLeaseReleaseErrorCount
        && !encryptedSqliteProcessLease?.valid
      )
      // The workspace lock is the narrower owner. Release the process-wide
      // service lock only after that owner is conclusively gone, so no second
      // worker can enter through a different configured/cache path while the
      // first worker still owns its database.
      let serviceLeaseReleaseSucceeded = false
      if (databaseLeaseReleaseSucceeded) {
        const serviceLeaseReleaseErrorCount = errors.length
        await attempt('storage service process lease release', () => (
          releaseStorageServiceProcessLease()
        ))
        serviceLeaseReleaseSucceeded = (
          errors.length === serviceLeaseReleaseErrorCount
          && !storageServiceProcessLease?.valid
        )
      }
      if (!databaseLeaseReleaseSucceeded || !serviceLeaseReleaseSucceeded) {
        storageShutdownDurabilityFailed = true
      }
    }))
  } catch (error) {
    storageShutdownDurabilityFailed = true
    errors.push({ label: 'final storage close', error })
  }

  if (!storageShutdownDurabilityFailed) {
    storageInitialized = false
    storageReadyPromise = null
  }

  if (errors.length === 1) {
    errors[0].error.shutdownDurabilityRetained = storageShutdownDurabilityFailed
    throw errors[0].error
  }
  if (errors.length > 1) {
    const aggregate = new AggregateError(
      errors.map((entry) => entry.error),
      `Storage shutdown completed with ${errors.length} errors.`,
    )
    aggregate.code = 'STORAGE_SHUTDOWN_FAILED'
    aggregate.steps = errors.map((entry) => entry.label)
    aggregate.durabilityRetained = storageShutdownDurabilityFailed
    throw aggregate
  }
}

export function requestStorageTerminalShutdown() {
  storageTerminalShutdownRequested = true
}

export function shutdownStorage(options = {}) {
  if (options?.terminal === true) requestStorageTerminalShutdown()
  if (storageShutdownPromise) return storageShutdownPromise
  storageShuttingDown = true
  const operation = storageShutdownContext.run(true, performStorageShutdown)
  let guardedShutdown
  guardedShutdown = operation.finally(() => {
    if (!storageShutdownDurabilityFailed) {
      storageInitialized = false
      storageReadyPromise = null
      storageShuttingDown = false
    }
    if (storageShutdownPromise === guardedShutdown) storageShutdownPromise = null
  })
  storageShutdownPromise = guardedShutdown
  return guardedShutdown
}

export function storageLifecycleDiagnostics() {
  return {
    initialized: storageInitialized,
    initializing: Boolean(storageReadyPromise && !storageInitialized),
    shuttingDown: storageShuttingDown,
    terminalShutdownRequested: storageTerminalShutdownRequested,
    shutdownDurabilityFailed: storageShutdownDurabilityFailed,
    databaseOpen: Boolean(db?.open),
    leaseHeld: Boolean(encryptedSqliteProcessLease?.valid),
    leasePath: encryptedSqliteProcessLease?.path ?? null,
    databaseLeaseHeld: Boolean(encryptedSqliteProcessLease?.valid),
    databaseLeasePath: encryptedSqliteProcessLease?.path ?? null,
    serviceLeaseHeld: Boolean(storageServiceProcessLease?.valid),
    serviceLeasePath: storageServiceProcessLease?.path ?? null,
  }
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

function teamsFromDatabaseByIds(database, teamIds) {
  const rows = []
  for (const batch of boundedSqlBatches(teamIds)) {
    const placeholders = batch.map(() => '?').join(', ')
    rows.push(...database.prepare(`SELECT * FROM teams WHERE id IN (${placeholders})`).all(...batch))
  }
  return rows
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
    .map(teamFromRow)
}

function durableTenantRevisionsForStore(database, store) {
  const tenantKeys = new Set()
  if (store.settings) tenantKeys.add(tenantKeyForSettings())
  for (const user of store.users ?? []) {
    const tenantKey = tenantKeyForUser(user)
    if (tenantKey) tenantKeys.add(tenantKey)
  }
  for (const team of store.teams ?? []) {
    const tenantKey = tenantKeyForTeam(team)
    if (tenantKey) tenantKeys.add(tenantKey)
  }
  for (const application of store.applications ?? []) {
    const tenantKey = tenantKeyForApplication(application)
    if (tenantKey) tenantKeys.add(tenantKey)
  }
  for (const profileAsset of store.profileAssets ?? []) {
    const tenantKey = tenantKeyForProfileAsset(profileAsset)
    if (tenantKey) tenantKeys.add(tenantKey)
  }
  return readDurableTenantRevisions(database, tenantKeys)
}

async function readStoreFromDatabase(database) {
  const snapshot = () => {
    const metaRows = database.prepare('SELECT key, value FROM app_meta').all()
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, fromJson(row.value)]))
    const settingsRow = database
      .prepare('SELECT * FROM system_settings WHERE id = ?')
      .get('global')
    const users = database.prepare('SELECT * FROM users ORDER BY created_at ASC').all()
    const applicationRows = database
      .prepare('SELECT * FROM applications ORDER BY deadline ASC')
      .all()
    const teamRows = database.prepare('SELECT * FROM teams ORDER BY created_at ASC').all()
    const profileAssets = database
      .prepare('SELECT * FROM profile_assets ORDER BY updated_at DESC')
      .all()
    const systemEvents = database
      .prepare('SELECT * FROM system_events ORDER BY time DESC, id DESC LIMIT ?')
      .all(SYSTEM_EVENT_WORKING_SET_LIMIT)
    const revision = readDurableWorkspaceRevision(database)
    const tenantKeys = new Set()
    if (settingsRow) tenantKeys.add(tenantKeyForSettings())
    for (const user of users) {
      const tenantKey = tenantKeyForUser(user)
      if (tenantKey) tenantKeys.add(tenantKey)
    }
    for (const team of teamRows) {
      const tenantKey = tenantKeyForTeam(team)
      if (tenantKey) tenantKeys.add(tenantKey)
    }
    for (const application of applicationRows) {
      const tenantKey = tenantKeyForApplication({
        ownerId: application.owner_id,
        teamId: application.team_id ?? null,
      })
      if (tenantKey) tenantKeys.add(tenantKey)
    }
    for (const asset of profileAssets) {
      const tenantKey = tenantKeyForProfileAsset({
        ownerId: asset.owner_id,
        teamId: asset.team_id ?? null,
      })
      if (tenantKey) tenantKeys.add(tenantKey)
    }
    return {
      meta,
      settingsRow,
      users,
      applicationRows,
      teamRows,
      profileAssets,
      systemEvents,
      revision,
      tenantRevisions: readDurableTenantRevisions(database, tenantKeys),
    }
  }

  const hydrate = async (data, { useWorker = true } = {}) => {
    const decodedApplications = []
    for (const row of data.applicationRows) {
      decodedApplications.push({
        row,
        payload: useWorker
          ? await decodePayloadFromStorageAsync(row.payload_json)
          : decodePayloadFromStorage(row.payload_json),
      })
    }
    const schoolLogoAssets = readReferencedSchoolLogoAssets(
      database,
      decodedApplications.map(({ payload }) => payload),
    )

    const store = {
      meta: {
        ...(data.meta.version ?? {}),
        adapter: currentDatabaseAdapter(),
        updatedAt: nowStamp(),
        revision: data.revision,
      },
      settings: settingsFromRow(data.settingsRow),
      users: data.users.map(userFromRow),
      teams: data.teamRows.map(teamFromRow),
      applications: decodedApplications.map(({ row, payload }) => (
        applicationFromRow(row, schoolLogoAssets, payload)
      )),
      profileAssets: data.profileAssets.map(profileAssetFromRow),
      systemEvents: data.systemEvents.map(eventFromRow),
    }
    attachStoreTenantRevisions(store, data.tenantRevisions)
    return attachStoreBaseline(store)
  }

  // Every entity collection and the baseline revision must come from one
  // SQLite snapshot. Otherwise a second process can commit between SELECTs and
  // make a torn workspace look authoritative at the newer revision.
  if (database.inTransaction) {
    return hydrate(snapshot(), { useWorker: false })
  }
  return hydrate(database.transaction(snapshot).deferred())
}

function storeHydrationReservationBytes(database) {
  const pageCount = Math.max(0, Number(database.pragma('page_count', { simple: true })) || 0)
  const pageSize = Math.max(0, Number(database.pragma('page_size', { simple: true })) || 0)
  const durableBytes = Math.min(Number.MAX_SAFE_INTEGER, pageCount * pageSize)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(16 * 1024 * 1024, (durableBytes * 4) + (16 * 1024 * 1024)),
  )
}

function storeSnapshotReservationBytes(database) {
  const pageCount = Math.max(0, Number(database.pragma('page_count', { simple: true })) || 0)
  const pageSize = Math.max(0, Number(database.pragma('page_size', { simple: true })) || 0)
  const durableBytes = Math.min(Number.MAX_SAFE_INTEGER, pageCount * pageSize)
  // better-sqlite3 serialize() creates one plaintext image. The sealing path
  // consumes 64 KiB views and streams ciphertext to disk, so reserving four
  // full JSON-hydration copies made otherwise safe encrypted databases
  // impossible to persist under normal memory limits.
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(16 * 1024 * 1024, durableBytes + (16 * 1024 * 1024)),
  )
}

function acquireStoreSnapshotMemory(database) {
  return acquireStoreHydrationMemory?.(storeSnapshotReservationBytes(database)) ?? null
}

function sqliteUnsealReservationBytes(payloadBytes) {
  const bytes = Math.max(0, Number(payloadBytes) || 0)
  // During open, one authenticated plaintext Buffer and one SQLite-owned
  // in-memory image can coexist briefly; encrypted input itself is read in a
  // fixed 64 KiB slab.
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(16 * 1024 * 1024, (bytes * 2) + (16 * 1024 * 1024)),
  )
}

function externalStateReservationBytes(payloadBytes) {
  const bytes = Math.max(0, Number(payloadBytes) || 0)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(16 * 1024 * 1024, (bytes * 4) + (16 * 1024 * 1024)),
  )
}

async function readExternalDatabaseStateWithMemoryAdmission(configuration, options = {}) {
  return readExternalDatabaseState(configuration, {
    ...options,
    acquirePayloadMemory: (payloadBytes, metadata = {}) => {
      // All external drivers fetch this bounded prefix and byte count first.
      // Reject an oversized state before the SQL client allocates the BLOB and
      // before the legacy envelope can allocate/decrypt a plaintext image.
      const encrypted = Buffer.from(metadata.payloadPrefix ?? '')
        .subarray(0, EXTERNAL_STATE_MAGIC.length)
        .equals(EXTERNAL_STATE_MAGIC)
      const capacity = snapshotCapacityPlan('external-whole-snapshot', {
        encryptionAtRest: encrypted,
      })
      assertSnapshotCapacityPlan(capacity)
      assertExternalSnapshotPayloadAdmission({
        payloadBytes,
        payloadPrefix: metadata.payloadPrefix,
        encryptedMagic: EXTERNAL_STATE_MAGIC,
        databaseLimitBytes: capacity.effectiveLimitBytes,
      })
      return acquireStoreHydrationMemory?.(externalStateReservationBytes(payloadBytes)) ?? null
    },
  })
}

async function hydrateStoreWithMemoryAdmission(database, { retainMemoryReservation = false } = {}) {
  const release = acquireStoreHydrationMemory?.(storeHydrationReservationBytes(database)) ?? null
  try {
    const store = await readStoreFromDatabase(database)
    if (retainMemoryReservation && typeof release === 'function') {
      Object.defineProperty(store, storeMemoryLeaseSymbol, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: release,
      })
      return store
    }
    release?.()
    return store
  } catch (error) {
    release?.()
    throw error
  }
}

export async function readStore(options = {}) {
  await ensureStorage()
  const database = getDb()
  if (options.retainMemoryReservation) {
    return hydrateStoreWithMemoryAdmission(database, { retainMemoryReservation: true })
  }
  if (!options.cache) {
    return hydrateStoreWithMemoryAdmission(database)
  }

  const dataVersion = databaseDataVersion(database)
  if (sharedStoreCache && sharedStoreDataVersion === dataVersion) {
    return sharedStoreCache
  }

  const store = await hydrateStoreWithMemoryAdmission(database)
  sharedStoreCacheHydrations += 1
  sharedStoreCache = store
  sharedStoreDataVersion = dataVersion
  return store
}

/**
 * Mail sync never needs Team peers, profile libraries, or another owner's
 * applications. Keeping this projection deliberately narrow prevents a single
 * mailbox batch from hydrating the complete multi-tenant workspace merely to
 * classify and append correspondence.
 */
export async function readMailSyncStore(userId, options = {}) {
  await ensureStorage()
  const database = getDb()
  const subjectId = String(userId ?? '').trim()
  if (!subjectId) return null

  let releaseMemory = null
  const hydrate = () => {
    // Admission must happen before SELECT * materializes encrypted payload
    // strings. Size-only aggregate rows remain tiny even for a 100 MiB owner.
    const userSize = database.prepare(
      `SELECT COALESCE(LENGTH(settings_json) + LENGTH(name) + LENGTH(email) + 4096, 4096) AS bytes
       FROM users WHERE id = ?`,
    ).get(subjectId)
    const applicationSize = database.prepare(
      `SELECT COALESCE(SUM(LENGTH(payload_json) + 1024), 0) AS bytes
       FROM applications WHERE owner_id = ?`,
    ).get(subjectId)
    const durableBytes = Number(userSize?.bytes ?? 4096) + Number(applicationSize?.bytes ?? 0)
    releaseMemory = acquireStoreHydrationMemory?.(scopedStoreReservationBytes(durableBytes)) ?? null

    const userRow = database.prepare('SELECT * FROM users WHERE id = ?').get(subjectId)
    const applicationRows = database
      .prepare('SELECT * FROM applications WHERE owner_id = ? ORDER BY deadline ASC')
      .all(subjectId)

    const decodedApplications = applicationRows.map((row) => ({
      row,
      payload: decodePayloadFromStorage(row.payload_json),
    }))
    const schoolLogoAssets = readReferencedSchoolLogoAssets(
      database,
      decodedApplications.map(({ payload }) => payload),
    )
    const metaRows = database.prepare('SELECT key, value FROM app_meta').all()
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, fromJson(row.value)]))
    const settingsRow = database.prepare('SELECT * FROM system_settings WHERE id = ?').get('global')
    const eventRows = database.prepare(
      `SELECT * FROM system_events
       WHERE actor_id = ?
       ORDER BY time DESC, id DESC LIMIT ?`,
    ).all(subjectId, SYSTEM_EVENT_WORKING_SET_LIMIT)
    const store = {
      meta: {
        ...(meta.version ?? {}),
        adapter: currentDatabaseAdapter(),
        updatedAt: nowStamp(),
        revision: readDurableWorkspaceRevision(database),
      },
      settings: settingsFromRow(settingsRow),
      users: userRow ? [userFromRow(userRow)] : [],
      teams: [],
      applications: decodedApplications.map(({ row, payload }) => (
        applicationFromRow(row, schoolLogoAssets, payload)
      )),
      profileAssets: [],
      systemEvents: eventRows.map(eventFromRow),
    }
    attachStoreTenantRevisions(store, durableTenantRevisionsForStore(database, store))
    attachStoreBaseline(store)
    attachStoreScope(
      store,
      { kind: 'mail-sync', userId: subjectId, actorId: subjectId, teamIds: [] },
      options.retainMemoryReservation !== false ? releaseMemory : null,
    )
    if (options.retainMemoryReservation !== false) releaseMemory = null
    return store
  }

  try {
    return database.inTransaction ? hydrate() : database.transaction(hydrate).deferred()
  } finally {
    releaseMemory?.()
  }
}

/** Lightweight revocation/configuration recheck between IMAP and vault I/O. */
export async function readMailSyncUser(userId) {
  await ensureStorage()
  const subjectId = String(userId ?? '').trim()
  if (!subjectId) return null
  // A mailbox revalidation runs after every network batch. Project only its
  // revocation and IMAP fields so a large trash/profile settings document is
  // never copied into JavaScript merely to compare the account generation.
  const row = getDb().prepare(
    `SELECT id, email, disabled_at,
            json_extract(settings_json, '$.incomingProtocol') AS incoming_protocol,
            json_extract(settings_json, '$.incomingHost') AS incoming_host,
            json_extract(settings_json, '$.incomingPort') AS incoming_port,
            json_extract(settings_json, '$.incomingUser') AS incoming_user,
            json_extract(settings_json, '$.incomingPass') AS incoming_pass,
            json_extract(settings_json, '$.incomingTls') AS incoming_tls,
            json_extract(settings_json, '$.autoFetchMailEnabledAt') AS auto_fetch_enabled_at
       FROM users
      WHERE id = ?`,
  ).get(subjectId)
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    disabledAt: row.disabled_at ?? null,
    settings: {
      incomingProtocol: row.incoming_protocol ?? 'imap',
      incomingHost: row.incoming_host ?? '',
      incomingPort: Number(row.incoming_port ?? 993),
      incomingUser: row.incoming_user ?? '',
      incomingPass: decryptSecret(row.incoming_pass ?? ''),
      incomingTls: row.incoming_tls === null || row.incoming_tls === undefined
        ? true
        : Boolean(row.incoming_tls),
      autoFetchMailEnabledAt: row.auto_fetch_enabled_at ?? null,
    },
  }
}

const WORKSPACE_FILE_REFERENCE_INDEX_VERSION = '1'
const MAX_WORKSPACE_FILE_REFERENCE_MATCHES = 32

function normalizedWorkspaceFileReference(candidate, {
  fileId = candidate?.fileId,
  storageName = candidate?.storageName,
  fileName = candidate?.fileName ?? candidate?.file ?? candidate?.name,
  mimeType = candidate?.mimeType ?? candidate?.type,
  fileSize = candidate?.fileSize ?? candidate?.size,
  referenceKind,
} = {}) {
  const normalizedFileId = String(fileId ?? '').trim()
  const rawStorageName = String(storageName ?? '').trim()
  if (!normalizedFileId || !rawStorageName) return null
  return {
    fileId: normalizedFileId,
    storageName: path.basename(rawStorageName),
    fileName: String(fileName ?? '').trim(),
    mimeType: String(mimeType ?? '').trim(),
    fileSize: Math.max(0, Math.trunc(Number(fileSize) || 0)),
    referenceKind: String(referenceKind ?? 'file'),
  }
}

function collectWorkspaceFileReferencesForApplication(application) {
  const references = new Map()
  const add = (candidate, options) => {
    const reference = normalizedWorkspaceFileReference(candidate, options)
    if (!reference) return
    references.set(`${reference.fileId}\u0000${reference.storageName}`, reference)
  }
  for (const material of application?.materials ?? []) {
    add(material, { referenceKind: 'material' })
    for (const version of material.versions ?? []) {
      add(version, {
        storageName: version.storageName ?? material.storageName,
        fileName: version.file ?? version.fileName ?? material.fileName,
        mimeType: version.mimeType ?? material.mimeType,
        fileSize: version.size ?? version.fileSize ?? material.fileSize,
        referenceKind: 'material-version',
      })
    }
  }
  for (const task of application?.tasks ?? []) {
    add(task, { referenceKind: 'task' })
    for (const version of task.versions ?? []) {
      add(version, {
        storageName: version.storageName ?? task.storageName,
        fileName: version.file ?? version.fileName ?? task.fileName,
        mimeType: version.mimeType ?? task.mimeType,
        fileSize: version.size ?? version.fileSize ?? task.fileSize,
        referenceKind: 'task-version',
      })
    }
  }
  for (const communication of application?.communications ?? []) {
    for (const attachment of communication.attachments ?? []) {
      add(attachment, {
        fileName: attachment.fileName || communication.subject || 'attachment',
        referenceKind: 'communication-attachment',
      })
    }
  }
  return [...references.values()]
}

function collectWorkspaceFileReferencesForProfileAsset(asset) {
  const references = new Map()
  const add = (candidate, options) => {
    const reference = normalizedWorkspaceFileReference(candidate, options)
    if (!reference) return
    references.set(`${reference.fileId}\u0000${reference.storageName}`, reference)
  }
  add(asset, { referenceKind: 'profile-asset' })
  for (const attachment of asset?.attachments ?? []) {
    add(attachment, {
      fileName: attachment.fileName || asset.name,
      referenceKind: 'profile-attachment',
    })
  }
  return [...references.values()]
}

function clearWorkspaceFileReferences(database, sourceKind, sourceId) {
  database.prepare(
    'DELETE FROM workspace_file_references WHERE source_kind = ? AND source_id = ?',
  ).run(sourceKind, sourceId)
}

function replaceWorkspaceFileReferences(database, sourceKind, source, sourceVersion) {
  clearWorkspaceFileReferences(database, sourceKind, source.id)
  const references = sourceKind === 'application'
    ? collectWorkspaceFileReferencesForApplication(source)
    : collectWorkspaceFileReferencesForProfileAsset(source)
  if (references.length === 0) return
  const insert = database.prepare(
    `INSERT INTO workspace_file_references (
       file_id, source_kind, source_id, owner_id, team_id, storage_name,
       file_name, mime_type, file_size, reference_kind, source_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const reference of references) {
    insert.run(
      reference.fileId,
      sourceKind,
      source.id,
      source.ownerId,
      source.teamId ?? null,
      reference.storageName,
      reference.fileName,
      reference.mimeType,
      reference.fileSize,
      reference.referenceKind,
      Math.max(0, Number(sourceVersion) || 0),
    )
  }
}

function ensureWorkspaceFileReferenceIndex(database) {
  const currentVersion = database.prepare(
    'SELECT value FROM app_meta WHERE key = ?',
  ).get('workspace_file_reference_index_version')?.value
  if (currentVersion === WORKSPACE_FILE_REFERENCE_INDEX_VERSION) return
  database.transaction(() => {
    database.prepare('DELETE FROM workspace_file_references').run()
    let cursor = ''
    while (true) {
      const row = database.prepare(
        `SELECT id, owner_id, team_id, payload_version, payload_json
           FROM applications WHERE id > ? ORDER BY id LIMIT 1`,
      ).get(cursor)
      if (!row) break
      const payload = decodePayloadFromStorage(row.payload_json)
      replaceWorkspaceFileReferences(database, 'application', {
        ...(payload && typeof payload === 'object' ? payload : {}),
        id: row.id,
        ownerId: row.owner_id,
        teamId: row.team_id ?? null,
      }, row.payload_version)
      cursor = row.id
    }
    cursor = ''
    while (true) {
      const row = database.prepare(
        `SELECT id, owner_id, team_id, payload_version, payload_json
           FROM profile_assets WHERE id > ? ORDER BY id LIMIT 1`,
      ).get(cursor)
      if (!row) break
      const payload = decodePayloadFromStorage(row.payload_json)
      replaceWorkspaceFileReferences(database, 'profile', {
        ...(payload && typeof payload === 'object' ? payload : {}),
        id: row.id,
        ownerId: row.owner_id,
        teamId: row.team_id ?? null,
      }, row.payload_version)
      cursor = row.id
    }
    database.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('workspace_file_reference_index_version', WORKSPACE_FILE_REFERENCE_INDEX_VERSION)
  }).immediate()
}

export async function listWorkspaceFileReferences(fileId, { limit = MAX_WORKSPACE_FILE_REFERENCE_MATCHES + 1 } = {}) {
  await ensureStorage()
  const normalizedFileId = String(fileId ?? '').trim()
  if (!normalizedFileId || Buffer.byteLength(normalizedFileId, 'utf8') > 512) return []
  const boundedLimit = Math.max(1, Math.min(MAX_WORKSPACE_FILE_REFERENCE_MATCHES + 1, Number(limit) || 1))
  return getDb().prepare(
    `SELECT file_id, source_kind, source_id, owner_id, team_id, storage_name,
            file_name, mime_type, file_size, reference_kind, source_version
       FROM workspace_file_references
      WHERE file_id = ?
      ORDER BY source_kind, source_id, storage_name
      LIMIT ?`,
  ).all(normalizedFileId, boundedLimit).map((row) => ({
    fileId: row.file_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    ownerId: row.owner_id,
    teamId: row.team_id ?? null,
    storageName: row.storage_name,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size ?? 0),
    referenceKind: row.reference_kind,
    sourceVersion: Number(row.source_version ?? 0),
  }))
}

const WORKSPACE_PUBLIC_GRANT_INDEX_VERSION = '1'
const WORKSPACE_PUBLIC_GRANT_KINDS = new Set(['application-share', 'profile-share', 'calendar'])
const TEAM_TRANSFER_REQUEST_INDEX_VERSION = '1'
const MAX_TEAM_TRANSFER_REQUEST_RESULTS = 2_000

function pendingTeamTransferIndexFields(application) {
  const transfer = application?.teamTransferRequest
  const requestId = String(transfer?.id ?? '').trim()
  const teamId = String(transfer?.teamId ?? '').trim()
  const direction = transfer?.direction
  if (
    transfer?.status !== 'pending'
    || !requestId
    || !teamId
    || !['join', 'leave'].includes(direction)
  ) {
    return {
      requestId: null,
      teamId: null,
      direction: null,
      status: null,
      requestedBy: null,
      requestedAt: null,
      incomingBytes: 0,
    }
  }
  const quotaEntry = [...mailQuotaEntriesForApplication(application).values()][0]
  const incomingBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, Number(quotaEntry?.dataBytes) || 0)
      + [...(quotaEntry?.uploads?.values?.() ?? [])]
        .reduce((total, bytes) => total + Math.max(0, Number(bytes) || 0), 0),
  )
  return {
    requestId,
    teamId,
    direction,
    status: 'pending',
    requestedBy: String(transfer.requestedBy ?? '').trim() || null,
    requestedAt: String(transfer.requestedAt ?? '').trim() || null,
    incomingBytes,
  }
}

function ensureTeamTransferRequestIndex(database) {
  const currentVersion = database.prepare(
    'SELECT value FROM app_meta WHERE key = ?',
  ).get('team_transfer_request_index_version')?.value
  if (currentVersion === TEAM_TRANSFER_REQUEST_INDEX_VERSION) return
  database.transaction(() => {
    const update = database.prepare(
      `UPDATE applications
          SET transfer_request_id = ?, transfer_team_id = ?,
              transfer_direction = ?, transfer_status = ?,
              transfer_requested_by = ?, transfer_requested_at = ?,
              transfer_incoming_bytes = ?
        WHERE id = ?`,
    )
    let cursor = ''
    for (;;) {
      const preflight = database.prepare(
        `SELECT id, payload_version, LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
           FROM applications WHERE id > ? ORDER BY id LIMIT 1`,
      ).get(cursor)
      if (!preflight) break
      cursor = preflight.id
      const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
      try {
        const row = database.prepare('SELECT * FROM applications WHERE id = ?').get(preflight.id)
        if (!row || Number(row.payload_version ?? 0) !== Number(preflight.payload_version ?? 0)) {
          throw storeWriteConflict('application', preflight.id)
        }
        const payload = decodePayloadFromStorage(row.payload_json)
        const logos = readReferencedSchoolLogoAssets(database, [payload])
        const application = applicationFromRow(row, logos, payload)
        const transfer = pendingTeamTransferIndexFields(application)
        update.run(
          transfer.requestId,
          transfer.teamId,
          transfer.direction,
          transfer.status,
          transfer.requestedBy,
          transfer.requestedAt,
          transfer.incomingBytes,
          row.id,
        )
      } finally {
        releaseMemory?.()
      }
    }
    database.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('team_transfer_request_index_version', TEAM_TRANSFER_REQUEST_INDEX_VERSION)
  }).immediate()
}

function publicPendingTeamTransferDescriptor(row) {
  return {
    application: {
      id: row.id,
      ownerId: row.owner_id,
      teamId: row.team_id ?? null,
      school: { name: row.school_name },
      program: row.program,
    },
    transfer: {
      id: row.transfer_request_id,
      teamId: row.transfer_team_id,
      direction: row.transfer_direction,
      status: row.transfer_status,
      requestedBy: row.transfer_requested_by,
      requestedAt: row.transfer_requested_at,
    },
    incomingBytes: Math.max(0, Number(row.transfer_incoming_bytes) || 0),
  }
}

export async function listPendingTeamTransferDescriptors(teamId) {
  await ensureStorage()
  const normalizedTeamId = String(teamId ?? '').trim()
  if (!normalizedTeamId) return []
  const rows = getDb().prepare(
    `SELECT id, owner_id, team_id, school_name, program,
            transfer_request_id, transfer_team_id, transfer_direction,
            transfer_status, transfer_requested_by, transfer_requested_at,
            transfer_incoming_bytes
       FROM applications
      WHERE transfer_team_id = ? AND transfer_status = 'pending'
      ORDER BY updated_at ASC, id ASC
      LIMIT ?`,
  ).all(normalizedTeamId, MAX_TEAM_TRANSFER_REQUEST_RESULTS + 1)
  if (rows.length > MAX_TEAM_TRANSFER_REQUEST_RESULTS) {
    const error = new Error('The Team transfer queue exceeds its safe result bound.')
    error.code = 'TEAM_TRANSFER_QUEUE_LIMIT_EXCEEDED'
    error.status = 503
    throw error
  }
  return rows.map(publicPendingTeamTransferDescriptor)
}

export async function countPendingTeamTransfersForTeams(teamIds) {
  await ensureStorage()
  const normalizedTeamIds = Array.from(new Set((teamIds ?? [])
    .map((teamId) => String(teamId ?? '').trim())
    .filter(Boolean)))
  const counts = new Map(normalizedTeamIds.map((teamId) => [teamId, 0]))
  const database = getDb()
  // Keep parameter counts comfortably below SQLite's deployment-dependent
  // variable limit while avoiding an N+1 query for system administrators.
  for (let offset = 0; offset < normalizedTeamIds.length; offset += 250) {
    const batch = normalizedTeamIds.slice(offset, offset + 250)
    const placeholders = batch.map(() => '?').join(', ')
    const rows = database.prepare(
      `SELECT transfer_team_id AS team_id, COUNT(*) AS pending_count
         FROM applications
        WHERE transfer_status = 'pending'
          AND transfer_team_id IN (${placeholders})
        GROUP BY transfer_team_id`,
    ).all(...batch)
    for (const row of rows) {
      counts.set(row.team_id, Math.max(0, Number(row.pending_count) || 0))
    }
  }
  return counts
}

export async function readPendingTeamTransferApplication(teamId, requestId) {
  await ensureStorage()
  const normalizedTeamId = String(teamId ?? '').trim()
  const normalizedRequestId = String(requestId ?? '').trim()
  if (!normalizedTeamId || !normalizedRequestId) return null
  const database = getDb()
  const preflight = database.prepare(
    `SELECT id, payload_version, LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
       FROM applications
      WHERE transfer_request_id = ? AND transfer_team_id = ?
        AND transfer_status = 'pending'
      LIMIT 1`,
  ).get(normalizedRequestId, normalizedTeamId)
  if (!preflight) return null
  const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
  try {
    const row = database.prepare('SELECT * FROM applications WHERE id = ?').get(preflight.id)
    if (
      !row
      || Number(row.payload_version ?? 0) !== Number(preflight.payload_version ?? 0)
      || row.transfer_request_id !== normalizedRequestId
      || row.transfer_team_id !== normalizedTeamId
      || row.transfer_status !== 'pending'
    ) return null
    const payload = decodePayloadFromStorage(row.payload_json)
    const logos = readReferencedSchoolLogoAssets(database, [payload])
    const application = applicationFromRow(row, logos, payload)
    if (
      application.teamTransferRequest?.id !== normalizedRequestId
      || application.teamTransferRequest?.teamId !== normalizedTeamId
      || application.teamTransferRequest?.status !== 'pending'
    ) return null
    return application
  } finally {
    releaseMemory?.()
  }
}

function workspacePublicGrantTokenHash(grantKind, token) {
  const normalizedToken = String(token ?? '')
  if (!WORKSPACE_PUBLIC_GRANT_KINDS.has(grantKind) || !normalizedToken) return ''
  return createHash('sha256')
    .update(`phd-atlas-public-grant\u0000${grantKind}\u0000`, 'utf8')
    .update(normalizedToken, 'utf8')
    .digest('base64url')
}

function publicGrantKindForSource(sourceKind) {
  if (sourceKind === 'application') return 'application-share'
  if (sourceKind === 'profile') return 'profile-share'
  if (sourceKind === 'user') return 'calendar'
  return null
}

function replaceWorkspacePublicGrants(database, sourceKind, source, sourceVersion) {
  const grantKind = publicGrantKindForSource(sourceKind)
  if (!grantKind || !source?.id) return
  database.prepare(
    'DELETE FROM workspace_public_grants WHERE grant_kind = ? AND source_id = ?',
  ).run(grantKind, source.id)
  const insert = database.prepare(
    `INSERT INTO workspace_public_grants (
       grant_kind, token_hash, source_id, owner_id, team_id, grant_id,
       expires_at, source_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const append = ({ token, grantId, expiresAt = null, ownerId, teamId = null }) => {
    const tokenHash = workspacePublicGrantTokenHash(grantKind, token)
    if (!tokenHash) return
    insert.run(
      grantKind,
      tokenHash,
      source.id,
      ownerId,
      teamId,
      grantId,
      expiresAt || null,
      Math.max(0, Number(sourceVersion) || 0),
    )
  }
  if (grantKind === 'calendar') {
    append({
      token: source.settings?.calendarToken,
      grantId: 'calendar',
      ownerId: source.id,
    })
    return
  }
  for (const [index, share] of (source.shares ?? []).entries()) {
    append({
      token: share?.token,
      grantId: String(share?.id ?? '').trim() || `legacy_${index}`,
      expiresAt: share?.expiresAt ?? null,
      ownerId: source.ownerId,
      teamId: source.teamId ?? null,
    })
  }
}

function ensureWorkspacePublicGrantIndex(database) {
  const currentVersion = database.prepare(
    'SELECT value FROM app_meta WHERE key = ?',
  ).get('workspace_public_grant_index_version')?.value
  if (currentVersion === WORKSPACE_PUBLIC_GRANT_INDEX_VERSION) return
  database.transaction(() => {
    database.prepare('DELETE FROM workspace_public_grants').run()
    let cursor = ''
    while (true) {
      const row = database.prepare(
        `SELECT id, owner_id, team_id, payload_version, payload_json
           FROM applications WHERE id > ? ORDER BY id LIMIT 1`,
      ).get(cursor)
      if (!row) break
      const payload = decodePayloadFromStorage(row.payload_json)
      replaceWorkspacePublicGrants(database, 'application', {
        ...(payload && typeof payload === 'object' ? payload : {}),
        id: row.id,
        ownerId: row.owner_id,
        teamId: row.team_id ?? null,
      }, row.payload_version)
      cursor = row.id
    }
    cursor = ''
    while (true) {
      const row = database.prepare(
        `SELECT id, owner_id, team_id, payload_version, payload_json
           FROM profile_assets WHERE id > ? ORDER BY id LIMIT 1`,
      ).get(cursor)
      if (!row) break
      const payload = decodePayloadFromStorage(row.payload_json)
      replaceWorkspacePublicGrants(database, 'profile', {
        ...(payload && typeof payload === 'object' ? payload : {}),
        id: row.id,
        ownerId: row.owner_id,
        teamId: row.team_id ?? null,
      }, row.payload_version)
      cursor = row.id
    }
    cursor = ''
    while (true) {
      const row = database.prepare(
        `SELECT id, settings_version, settings_json
           FROM users WHERE id > ? ORDER BY id LIMIT 1`,
      ).get(cursor)
      if (!row) break
      replaceWorkspacePublicGrants(database, 'user', {
        id: row.id,
        settings: fromJson(row.settings_json, {}),
      }, row.settings_version)
      cursor = row.id
    }
    database.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('workspace_public_grant_index_version', WORKSPACE_PUBLIC_GRANT_INDEX_VERSION)
  }).immediate()
}

function workspacePublicGrantSourceVersion(database, row) {
  if (row.grant_kind === 'application-share') {
    const source = database.prepare(
      'SELECT owner_id, team_id, payload_version AS source_version FROM applications WHERE id = ?',
    ).get(row.source_id)
    return source ? { ...source, source_version: Number(source.source_version ?? 0) } : null
  }
  if (row.grant_kind === 'profile-share') {
    const source = database.prepare(
      'SELECT owner_id, team_id, payload_version AS source_version FROM profile_assets WHERE id = ?',
    ).get(row.source_id)
    return source ? { ...source, source_version: Number(source.source_version ?? 0) } : null
  }
  const source = database.prepare(
    `SELECT id AS owner_id,
            NULL AS team_id,
            name AS owner_name,
            json_extract(settings_json, '$.calendarToken') AS calendar_token,
            settings_version AS source_version
       FROM users WHERE id = ?`,
  ).get(row.source_id)
  return source ? { ...source, source_version: Number(source.source_version ?? 0) } : null
}

export async function findWorkspacePublicGrant(grantKind, token) {
  await ensureStorage()
  const normalizedToken = String(token ?? '')
  if (!WORKSPACE_PUBLIC_GRANT_KINDS.has(grantKind)) return null
  if (!normalizedToken || Buffer.byteLength(normalizedToken, 'utf8') > 4096) return null
  const tokenHash = workspacePublicGrantTokenHash(grantKind, normalizedToken)
  const database = getDb()
  const rows = database.prepare(
    `SELECT grant_kind, token_hash, source_id, owner_id, team_id, grant_id,
            expires_at, source_version
       FROM workspace_public_grants
      WHERE grant_kind = ? AND token_hash = ?
      ORDER BY source_id, grant_id
      LIMIT 2`,
  ).all(grantKind, tokenHash)
  if (rows.length !== 1) return null
  const row = rows[0]
  const source = workspacePublicGrantSourceVersion(database, row)
  if (!source) return null
  if (
    grantKind === 'calendar'
    && workspacePublicGrantTokenHash('calendar', source.calendar_token) !== tokenHash
  ) return null
  return {
    grantKind: row.grant_kind,
    tokenHash: row.token_hash,
    sourceId: row.source_id,
    ownerId: source.owner_id,
    teamId: source.team_id ?? null,
    grantId: row.grant_id,
    expiresAt: row.expires_at ?? null,
    sourceVersion: source.source_version,
    ownerName: source.owner_name ?? null,
  }
}

function normalizeWorkspacePublicGrantCas(value) {
  if (!value || !WORKSPACE_PUBLIC_GRANT_KINDS.has(value.grantKind)) return null
  const tokenHash = String(value.tokenHash ?? '').trim()
  const sourceId = String(value.sourceId ?? '').trim()
  const grantId = String(value.grantId ?? '').trim()
  const sourceVersion = Number(value.sourceVersion)
  if (!tokenHash || !sourceId || !grantId || !Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
    return null
  }
  return { grantKind: value.grantKind, tokenHash, sourceId, grantId, sourceVersion }
}

function assertWorkspacePublicGrantCas(database, value) {
  const grant = normalizeWorkspacePublicGrantCas(value)
  if (!grant) return
  const rows = database.prepare(
    `SELECT grant_kind, token_hash, source_id, grant_id
       FROM workspace_public_grants
      WHERE grant_kind = ? AND token_hash = ?
      LIMIT 2`,
  ).all(grant.grantKind, grant.tokenHash)
  const row = rows.length === 1 ? rows[0] : null
  const source = row ? workspacePublicGrantSourceVersion(database, row) : null
  if (
    !row
    || row.source_id !== grant.sourceId
    || row.grant_id !== grant.grantId
    || Number(source?.source_version ?? -1) !== grant.sourceVersion
  ) {
    const error = new Error('The public grant changed before the shared update could be saved.')
    error.code = 'PUBLIC_GRANT_CONFLICT'
    error.status = 409
    throw error
  }
}

function recordMailQuotaUpload(uploadSizes, storageName, size) {
  if (!storageName) return
  const key = path.basename(String(storageName))
  const bytes = Math.max(0, Number(size) || 0)
  uploadSizes.set(key, Math.max(Number(uploadSizes.get(key) ?? 0), bytes))
}

function recordApplicationMailQuotaUploads(application, uploadSizes) {
  for (const material of application?.materials ?? []) {
    recordMailQuotaUpload(uploadSizes, material.storageName, material.fileSize)
    for (const version of material.versions ?? []) {
      recordMailQuotaUpload(uploadSizes, version.storageName, version.size)
    }
  }
  for (const task of application?.tasks ?? []) {
    recordMailQuotaUpload(uploadSizes, task.storageName, task.fileSize)
    for (const version of task.versions ?? []) {
      recordMailQuotaUpload(uploadSizes, version.storageName, version.size)
    }
  }
  for (const communication of application?.communications ?? []) {
    for (const attachment of communication.attachments ?? []) {
      if (attachment.source === 'upload' || attachment.source === 'mail') {
        recordMailQuotaUpload(uploadSizes, attachment.storageName, attachment.fileSize)
      }
    }
  }
}

function mailQuotaJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
}

function quotaEntry(entries, domainKind, domainId) {
  const key = `${domainKind}\u0000${domainId}`
  let entry = entries.get(key)
  if (!entry) {
    entry = { domainKind, domainId, dataBytes: 0, uploads: new Map() }
    entries.set(key, entry)
  }
  return entry
}

function mailQuotaEntriesForUser(user) {
  const entries = new Map()
  const personal = quotaEntry(entries, 'personal', user.id)
  personal.dataBytes += mailQuotaJsonBytes(publicUser(user))
  for (const item of user.settings?.applicationTrash ?? []) {
    const application = item?.application
    if (!application) continue
    if (application.teamId) {
      const team = quotaEntry(entries, 'team', application.teamId)
      team.dataBytes += mailQuotaJsonBytes(application)
      recordApplicationMailQuotaUploads(application, team.uploads)
    } else {
      personal.dataBytes += mailQuotaJsonBytes(item)
      recordApplicationMailQuotaUploads(application, personal.uploads)
    }
  }
  return entries
}

function mailQuotaEntriesForApplication(application) {
  const entries = new Map()
  const domainKind = application.teamId ? 'team' : 'personal'
  const domainId = application.teamId || application.ownerId
  const entry = quotaEntry(entries, domainKind, domainId)
  entry.dataBytes = mailQuotaJsonBytes(application)
  recordApplicationMailQuotaUploads(application, entry.uploads)
  return entries
}

function mailQuotaEntriesForProfileAsset(asset) {
  // Existing quota semantics intentionally bill every Profile asset to its
  // owner, even when that asset is visible in a Team workspace.
  const entries = new Map()
  const entry = quotaEntry(entries, 'personal', asset.ownerId)
  entry.dataBytes = mailQuotaJsonBytes(asset)
  for (const attachment of asset.attachments ?? []) {
    recordMailQuotaUpload(entry.uploads, attachment.storageName, attachment.fileSize)
  }
  return entries
}

function workspaceQuotaEntryForBackup(backup) {
  const entries = new Map()
  const actorId = String(backup?.actorId ?? '').trim()
  if (!actorId) return entries
  const entry = quotaEntry(entries, 'personal', actorId)
  entry.dataBytes = Math.max(0, Number(backup?.size) || 0)
  return entries
}

function clearWorkspaceQuotaSource(database, sourceKind, sourceId) {
  database.prepare(
    'DELETE FROM workspace_quota_uploads WHERE source_kind = ? AND source_id = ?',
  ).run(sourceKind, sourceId)
  database.prepare(
    'DELETE FROM workspace_quota_sources WHERE source_kind = ? AND source_id = ?',
  ).run(sourceKind, sourceId)
}

function pruneWorkspaceQuotaSources(database) {
  for (const [sourceKind, table] of [
    ['user', 'users'],
    ['application', 'applications'],
    ['profile', 'profile_assets'],
  ]) {
    database.prepare(
      `DELETE FROM workspace_quota_sources
        WHERE source_kind = ?
          AND NOT EXISTS (
            SELECT 1 FROM ${table} source
             WHERE source.id = workspace_quota_sources.source_id
          )`,
    ).run(sourceKind)
  }
  database.prepare(
    `DELETE FROM workspace_quota_uploads
      WHERE NOT EXISTS (
        SELECT 1 FROM workspace_quota_sources q
         WHERE q.source_kind = workspace_quota_uploads.source_kind
           AND q.source_id = workspace_quota_uploads.source_id
           AND q.domain_kind = workspace_quota_uploads.domain_kind
           AND q.domain_id = workspace_quota_uploads.domain_id
      )`,
  ).run()
}

function replaceWorkspaceQuotaSource(database, sourceKind, sourceId, sourceVersion, entries) {
  clearWorkspaceQuotaSource(database, sourceKind, sourceId)
  const insertSource = database.prepare(
    `INSERT INTO workspace_quota_sources (
       source_kind, source_id, domain_kind, domain_id, source_version, data_bytes
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertUpload = database.prepare(
    `INSERT INTO workspace_quota_uploads (
       source_kind, source_id, domain_kind, domain_id, storage_name, file_bytes
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_kind, source_id, domain_kind, domain_id, storage_name)
     DO UPDATE SET file_bytes = MAX(workspace_quota_uploads.file_bytes, excluded.file_bytes)`,
  )
  for (const entry of entries.values()) {
    insertSource.run(
      sourceKind,
      sourceId,
      entry.domainKind,
      entry.domainId,
      Math.max(0, Number(sourceVersion) || 0),
      Math.max(0, Number(entry.dataBytes) || 0),
    )
    for (const [storageName, fileBytes] of entry.uploads) {
      insertUpload.run(
        sourceKind,
        sourceId,
        entry.domainKind,
        entry.domainId,
        path.basename(storageName),
        Math.max(0, Number(fileBytes) || 0),
      )
    }
  }
}

function syncWorkspaceQuotaUser(database, user, sourceVersion) {
  replaceWorkspaceQuotaSource(database, 'user', user.id, sourceVersion, mailQuotaEntriesForUser(user))
}

function syncWorkspaceQuotaApplication(database, application, sourceVersion) {
  replaceWorkspaceQuotaSource(
    database,
    'application',
    application.id,
    sourceVersion,
    mailQuotaEntriesForApplication(application),
  )
}

function syncWorkspaceQuotaProfileAsset(database, asset, sourceVersion) {
  replaceWorkspaceQuotaSource(
    database,
    'profile',
    asset.id,
    sourceVersion,
    mailQuotaEntriesForProfileAsset(asset),
  )
}

function backupSourceVersion(backup) {
  return Math.max(0, Math.floor(Number(backup?.sourceMtimeMs) || 0))
}

function syncWorkspaceQuotaBackup(database, backup) {
  const actorId = String(backup?.actorId ?? '').trim()
  const bytes = Math.max(0, Number(backup?.size) || 0)
  const sourceVersion = backupSourceVersion(backup)
  const existing = database.prepare(
    `SELECT domain_kind, domain_id, source_version, data_bytes
       FROM workspace_quota_sources
      WHERE source_kind = 'backup' AND source_id = ?`,
  ).all(backup.fileName)
  const uploadCount = Number(database.prepare(
    `SELECT COUNT(*) AS count FROM workspace_quota_uploads
      WHERE source_kind = 'backup' AND source_id = ?`,
  ).get(backup.fileName)?.count ?? 0)
  if (
    actorId
    && existing.length === 1
    && existing[0].domain_kind === 'personal'
    && existing[0].domain_id === actorId
    && Number(existing[0].source_version) === sourceVersion
    && Number(existing[0].data_bytes) === bytes
    && uploadCount === 0
  ) return false
  replaceWorkspaceQuotaSource(
    database,
    'backup',
    backup.fileName,
    sourceVersion,
    workspaceQuotaEntryForBackup(backup),
  )
  return true
}

async function synchronizeWorkspaceBackupQuotaActor(actorId, { force = false } = {}) {
  const normalizedActorId = String(actorId ?? '').trim()
  if (!normalizedActorId) return
  if (!force && workspaceQuotaBackupActorsSynchronized.has(normalizedActorId)) return false
  const backups = await listBackups({ actorId: normalizedActorId })
  const database = getDb()
  let changed = false
  database.transaction(() => {
    // A backup remains on disk between the durable delete intent and the
    // physical unlink. Never let the reconstructible backup index resurrect
    // its quota source during that crash-safe interval.
    const deleting = new Set(database.prepare(
      'SELECT file_name FROM workspace_backup_deletions WHERE actor_id = ?',
    ).all(normalizedActorId).map((row) => row.file_name))
    const activeBackups = backups.filter((backup) => !deleting.has(backup.fileName))
    const names = new Set(activeBackups.map((backup) => backup.fileName))
    const existing = database.prepare(
      `SELECT source_id FROM workspace_quota_sources
        WHERE source_kind = 'backup' AND domain_kind = 'personal' AND domain_id = ?`,
    ).all(normalizedActorId)
    for (const row of existing) {
      if (!names.has(row.source_id)) {
        clearWorkspaceQuotaSource(database, 'backup', row.source_id)
        changed = true
      }
    }
    for (const backup of activeBackups) {
      if (syncWorkspaceQuotaBackup(database, backup)) changed = true
    }
  }).immediate()
  workspaceQuotaBackupActorsSynchronized.add(normalizedActorId)
  return changed
}

function normalizeAccountBackupDeletionPlans(plans = []) {
  const byFileName = new Map()
  for (const plan of Array.isArray(plans) ? plans : []) {
    const actorId = String(plan?.actorId ?? '').trim()
    if (!actorId) {
      throw backupFileError(400, 'INVALID_BACKUP_ACTOR', 'A backup deletion owner is required.')
    }
    for (const candidate of Array.isArray(plan?.backups) ? plan.backups : []) {
      const { fileName } = resolveBackupFile(candidate?.fileName)
      const existing = byFileName.get(fileName)
      if (existing && existing.actorId !== actorId) {
        const error = new Error('One backup deletion plan cannot target multiple accounts.')
        error.status = 409
        error.code = 'BACKUP_DELETION_OWNER_CONFLICT'
        throw error
      }
      byFileName.set(fileName, {
        actorId,
        fileName,
        fileBytes: Math.max(0, Math.floor(Number(candidate?.size) || 0)),
        sourceVersion: backupSourceVersion(candidate),
      })
    }
  }
  return [...byFileName.values()]
}

function queueDeletedAccountBackupDeletions(database, deletedUserIds, plannedBackups) {
  const deleted = new Set([...deletedUserIds].map((value) => String(value ?? '').trim()).filter(Boolean))
  if (deleted.size === 0) return { queued: 0, actorCounts: {} }

  const candidates = new Map()
  const quotaRowsForActor = database.prepare(
    `SELECT source_id, domain_id, data_bytes, source_version
       FROM workspace_quota_sources
      WHERE source_kind = 'backup' AND domain_kind = 'personal' AND domain_id = ?`,
  )
  for (const actorId of deleted) {
    for (const row of quotaRowsForActor.all(actorId)) {
      const { fileName } = resolveBackupFile(row.source_id)
      candidates.set(fileName, {
        actorId: row.domain_id,
        fileName,
        fileBytes: Math.max(0, Number(row.data_bytes) || 0),
        sourceVersion: Math.max(0, Number(row.source_version) || 0),
      })
    }
  }
  for (const candidate of plannedBackups) {
    if (!deleted.has(candidate.actorId)) {
      const error = new Error('A backup deletion plan is not bound to an account deleted by this commit.')
      error.status = 409
      error.code = 'BACKUP_DELETION_OWNER_CONFLICT'
      throw error
    }
    const existing = candidates.get(candidate.fileName)
    if (existing && existing.actorId !== candidate.actorId) {
      const error = new Error('A backup belongs to a different account than the deletion plan.')
      error.status = 409
      error.code = 'BACKUP_DELETION_OWNER_CONFLICT'
      throw error
    }
    // A current quota row was committed under the same SQLite write order as
    // this account deletion and is authoritative over the lock-free legacy
    // scan. In particular, never replace its post-re-encryption size/version
    // with an older non-zero filesystem snapshot.
    if (!existing) candidates.set(candidate.fileName, candidate)
  }

  const sourceOwner = database.prepare(
    `SELECT domain_kind, domain_id FROM workspace_quota_sources
      WHERE source_kind = 'backup' AND source_id = ? LIMIT 1`,
  )
  const enqueue = database.prepare(
    `INSERT INTO workspace_backup_deletions (
       file_name, actor_id, file_bytes, source_version, requested_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(file_name) DO UPDATE SET
       actor_id = excluded.actor_id,
       file_bytes = excluded.file_bytes,
       source_version = excluded.source_version`,
  )
  const clearSource = database.prepare(
    `DELETE FROM workspace_quota_sources
      WHERE source_kind = 'backup' AND source_id = ?
        AND domain_kind = 'personal' AND domain_id = ?`,
  )
  const actorCounts = {}
  const requestedAt = nowStamp()
  for (const candidate of candidates.values()) {
    const currentSource = sourceOwner.get(candidate.fileName)
    if (
      currentSource
      && (
        currentSource.domain_kind !== 'personal'
        || currentSource.domain_id !== candidate.actorId
      )
    ) {
      const error = new Error('A backup became owned by another account before deletion committed.')
      error.status = 409
      error.code = 'BACKUP_DELETION_OWNER_CONFLICT'
      throw error
    }
    enqueue.run(
      candidate.fileName,
      candidate.actorId,
      candidate.fileBytes,
      candidate.sourceVersion,
      requestedAt,
    )
    clearSource.run(candidate.fileName, candidate.actorId)
    actorCounts[candidate.actorId] = (actorCounts[candidate.actorId] ?? 0) + 1
  }
  return { queued: candidates.size, actorCounts }
}

export async function recoverWorkspaceBackupLifecycleAtStartup() {
  await fs.mkdir(backupRoot, { recursive: true })
  const database = getDb()
  const referenced = database.prepare(
    `SELECT source_id FROM workspace_quota_sources WHERE source_kind = 'backup'`,
  ).all().map((row) => row.source_id)
  const deletions = database.prepare(
    'SELECT file_name FROM workspace_backup_deletions ORDER BY requested_at ASC',
  ).all().map((row) => row.file_name)
  const deleting = new Set(deletions)
  const expectedStages = new Set()

  for (const fileName of referenced) {
    if (deleting.has(fileName)) continue
    const stagePath = backupStagePath(fileName)
    const stageMetadataPath = backupStageMetadataPath(fileName)
    expectedStages.add(path.basename(stagePath))
    expectedStages.add(path.basename(stageMetadataPath))
    let hasStage = true
    try { await fs.access(stagePath) } catch { hasStage = false }
    const finalPath = resolveBackupFile(fileName).path
    let hasFinal = true
    try { await fs.access(finalPath) } catch { hasFinal = false }
    if (hasStage && hasFinal) {
      await fs.rm(stagePath, { force: true })
    } else if (hasStage) {
      await fs.rename(stagePath, finalPath)
      hasFinal = true
    }
    let hasStageMetadata = true
    try { await fs.access(stageMetadataPath) } catch { hasStageMetadata = false }
    if (hasStageMetadata && hasFinal) {
      const finalMetadataPath = backupMetadataPath(fileName)
      let hasFinalMetadata = true
      try { await fs.access(finalMetadataPath) } catch { hasFinalMetadata = false }
      if (hasFinalMetadata) await fs.rm(stageMetadataPath, { force: true })
      else await fs.rename(stageMetadataPath, finalMetadataPath)
      invalidateBackupListCache(fileName)
    } else if (hasStageMetadata && !hasFinal) {
      await fs.rm(stageMetadataPath, { force: true })
    }
  }

  // Stages without a durable quota source were never acknowledged. They are
  // safe to remove; a source-backed stage above is promoted before cleanup.
  const entries = await fs.readdir(backupRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (
      !entry.isFile()
      || (!isBackupStageEntry(entry.name) && !isBackupStageMetadataEntry(entry.name))
      || expectedStages.has(entry.name)
    ) continue
    await fs.rm(path.join(backupRoot, entry.name), { force: true })
  }

  // Account and ordinary backup deletion intents are durable before any file
  // unlink. Startup performs only a bounded amount of slow filesystem work;
  // later successful writes continue draining the same idempotent outbox.
  await drainWorkspaceBackupDeletions(128)
}

function workspaceQuotaPersonalIdsForWrite(database, writePlan, store) {
  const ids = new Set()
  const baseline = store?.[storeBaselineSymbol] ?? null
  const changedFromBaseline = (collection, value) => (
    !baseline || contentFingerprint(value) !== baseline[collection]?.get(value.id)
  )
  const userExists = database.prepare('SELECT 1 FROM users WHERE id = ? LIMIT 1')
  for (const user of writePlan.users.upserts) {
    // A newly created account cannot own a legacy backup. Full-reconcile user
    // deletion rewrites every surviving user; skip those unchanged snapshots.
    if (userExists.get(user.id) && changedFromBaseline('users', user)) ids.add(user.id)
  }
  for (const application of writePlan.applications.upserts) {
    if (
      !application.teamId
      && application.ownerId
      && changedFromBaseline('applications', application)
    ) ids.add(application.ownerId)
  }
  for (const asset of writePlan.profileAssets.upserts) {
    if (asset.ownerId && changedFromBaseline('profileAssets', asset)) ids.add(asset.ownerId)
  }
  // Deleted or moved-away sources can only reduce an old personal domain, so
  // they do not need legacy backup hydration for this monotonic final gate.
  return [...ids].filter(Boolean).sort((left, right) => left.localeCompare(right))
}

function quotaRowMemoryLease(payloadBytes) {
  return acquireStoreHydrationMemory?.(
    scopedStoreReservationBytes(Math.max(0, Number(payloadBytes) || 0) + 4096),
  ) ?? null
}

function refreshQuotaUser(database, preflight) {
  const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
  try {
    const row = database.prepare('SELECT * FROM users WHERE id = ?').get(preflight.id)
    if (!row || Number(row.settings_version ?? 0) !== Number(preflight.source_version ?? 0)) return false
    const user = userFromRow(row)
    return database.transaction(() => {
      const current = database.prepare('SELECT settings_version FROM users WHERE id = ?').get(preflight.id)
      if (!current || Number(current.settings_version ?? 0) !== Number(preflight.source_version ?? 0)) {
        return false
      }
      syncWorkspaceQuotaUser(database, user, current.settings_version)
      return true
    }).immediate()
  } finally {
    releaseMemory?.()
  }
}

function refreshQuotaApplication(database, preflight) {
  const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
  try {
    const row = database.prepare('SELECT * FROM applications WHERE id = ?').get(preflight.id)
    if (!row || Number(row.payload_version ?? 0) !== Number(preflight.source_version ?? 0)) return false
    const payload = decodePayloadFromStorage(row.payload_json)
    const logos = readReferencedSchoolLogoAssets(database, [payload])
    const application = applicationFromRow(row, logos, payload)
    return database.transaction(() => {
      const current = database.prepare(
        'SELECT payload_version, owner_id, team_id FROM applications WHERE id = ?',
      ).get(preflight.id)
      if (
        !current
        || Number(current.payload_version ?? 0) !== Number(preflight.source_version ?? 0)
        || current.owner_id !== preflight.owner_id
        || (current.team_id ?? null) !== (preflight.team_id ?? null)
      ) return false
      syncWorkspaceQuotaApplication(database, application, current.payload_version)
      return true
    }).immediate()
  } finally {
    releaseMemory?.()
  }
}

function refreshQuotaProfileAsset(database, preflight) {
  const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
  try {
    const row = database.prepare('SELECT * FROM profile_assets WHERE id = ?').get(preflight.id)
    if (!row || Number(row.payload_version ?? 0) !== Number(preflight.source_version ?? 0)) return false
    const asset = profileAssetFromRow(row)
    return database.transaction(() => {
      const current = database.prepare(
        'SELECT payload_version, owner_id FROM profile_assets WHERE id = ?',
      ).get(preflight.id)
      if (
        !current
        || Number(current.payload_version ?? 0) !== Number(preflight.source_version ?? 0)
        || current.owner_id !== preflight.owner_id
      ) return false
      syncWorkspaceQuotaProfileAsset(database, asset, current.payload_version)
      return true
    }).immediate()
  } finally {
    releaseMemory?.()
  }
}

function refreshQuotaSourceUntilStable(database, readPreflight, refresh) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const preflight = readPreflight()
    if (!preflight || refresh(database, preflight)) return
  }
  const error = new Error('Workspace quota accounting changed repeatedly during hydration.')
  error.code = 'WORKSPACE_REVISION_CONFLICT'
  error.status = 409
  throw error
}

function refreshStaleQuotaRows(database, subjectId, requestedTeamIds) {
  const staleUser = database.prepare(
    `SELECT u.id,
            u.settings_version AS source_version,
            LENGTH(CAST(u.settings_json AS BLOB)) AS payload_bytes
       FROM users u
      WHERE u.id > ?
        AND (? = 1 OR u.id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM workspace_quota_sources q
           WHERE q.source_kind = 'user'
             AND q.source_id = u.id
             AND q.domain_kind = 'personal'
             AND q.domain_id = u.id
             AND q.source_version = u.settings_version
        )
      ORDER BY u.id ASC
      LIMIT 1`,
  )
  const refreshAllUsers = requestedTeamIds.length ? 1 : 0
  let userCursor = ''
  while (true) {
    const preflight = staleUser.get(userCursor, refreshAllUsers, subjectId)
    if (!preflight) break
    userCursor = preflight.id
    refreshQuotaSourceUntilStable(
      database,
      () => database.prepare(
        `SELECT id, settings_version AS source_version,
                LENGTH(CAST(settings_json AS BLOB)) AS payload_bytes
           FROM users WHERE id = ?`,
      ).get(preflight.id),
      refreshQuotaUser,
    )
  }

  const refreshApplications = (where, values) => {
    const stale = database.prepare(
      `SELECT a.id, a.owner_id, a.team_id,
              a.payload_version AS source_version,
              LENGTH(CAST(a.payload_json AS BLOB)) AS payload_bytes
         FROM applications a
        WHERE ${where}
          AND a.id > ?
          AND NOT EXISTS (
            SELECT 1 FROM workspace_quota_sources q
             WHERE q.source_kind = 'application'
               AND q.source_id = a.id
               AND q.domain_kind = CASE WHEN a.team_id IS NULL THEN 'personal' ELSE 'team' END
               AND q.domain_id = COALESCE(a.team_id, a.owner_id)
               AND q.source_version = a.payload_version
          )
        ORDER BY a.id ASC
        LIMIT 1`,
    )
    let cursor = ''
    while (true) {
      const preflight = stale.get(...values, cursor)
      if (!preflight) break
      cursor = preflight.id
      refreshQuotaSourceUntilStable(
        database,
        () => database.prepare(
          `SELECT id, owner_id, team_id, payload_version AS source_version,
                  LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
             FROM applications WHERE id = ?`,
        ).get(preflight.id),
        refreshQuotaApplication,
      )
    }
  }
  refreshApplications('a.owner_id = ? AND a.team_id IS NULL', [subjectId])
  if (requestedTeamIds.length) {
    refreshApplications(
      'a.team_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))',
      [JSON.stringify(requestedTeamIds)],
    )
  }

  const staleProfile = database.prepare(
    `SELECT p.id, p.owner_id, p.payload_version AS source_version,
            LENGTH(CAST(p.payload_json AS BLOB)) AS payload_bytes
       FROM profile_assets p
      WHERE p.owner_id = ?
        AND p.id > ?
        AND NOT EXISTS (
          SELECT 1 FROM workspace_quota_sources q
           WHERE q.source_kind = 'profile'
             AND q.source_id = p.id
             AND q.domain_kind = 'personal'
             AND q.domain_id = p.owner_id
             AND q.source_version = p.payload_version
        )
      ORDER BY p.id ASC
      LIMIT 1`,
  )
  let profileCursor = ''
  while (true) {
    const preflight = staleProfile.get(subjectId, profileCursor)
    if (!preflight) break
    profileCursor = preflight.id
    refreshQuotaSourceUntilStable(
      database,
      () => database.prepare(
        `SELECT id, owner_id, payload_version AS source_version,
                LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
           FROM profile_assets WHERE id = ?`,
      ).get(preflight.id),
      refreshQuotaProfileAsset,
    )
  }

  // Main writeStore transactions remove their derived rows eagerly. These
  // narrow anti-joins cover legacy/focused SQL deletes and domain moves.
  database.prepare(
    `DELETE FROM workspace_quota_sources
      WHERE domain_kind = 'personal' AND domain_id = ?
        AND (
          (source_kind = 'user' AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.id = workspace_quota_sources.source_id
          ))
          OR (source_kind = 'application' AND NOT EXISTS (
            SELECT 1 FROM applications a
             WHERE a.id = workspace_quota_sources.source_id
               AND a.owner_id = ? AND a.team_id IS NULL
          ))
          OR (source_kind = 'profile' AND NOT EXISTS (
            SELECT 1 FROM profile_assets p
             WHERE p.id = workspace_quota_sources.source_id AND p.owner_id = ?
          ))
        )`,
  ).run(subjectId, subjectId, subjectId)
  for (const teamId of requestedTeamIds) {
    database.prepare(
      `DELETE FROM workspace_quota_sources
        WHERE domain_kind = 'team' AND domain_id = ?
          AND (
            (source_kind = 'user' AND NOT EXISTS (
              SELECT 1 FROM users u WHERE u.id = workspace_quota_sources.source_id
            ))
            OR (source_kind = 'application' AND NOT EXISTS (
              SELECT 1 FROM applications a
               WHERE a.id = workspace_quota_sources.source_id AND a.team_id = ?
            ))
          )`,
    ).run(teamId, teamId)
  }
  database.prepare(
    `DELETE FROM workspace_quota_uploads
      WHERE NOT EXISTS (
        SELECT 1 FROM workspace_quota_sources q
         WHERE q.source_kind = workspace_quota_uploads.source_kind
           AND q.source_id = workspace_quota_uploads.source_id
           AND q.domain_kind = workspace_quota_uploads.domain_kind
           AND q.domain_id = workspace_quota_uploads.domain_id
      )`,
  ).run()
}

const indexedQuotaDomainStatements = new WeakMap()

function indexedQuotaDomainBytes(database, domainKind, domainId) {
  let statements = indexedQuotaDomainStatements.get(database)
  if (!statements) {
    statements = {
      data: database.prepare(
        `SELECT COALESCE(SUM(data_bytes), 0) AS bytes
       FROM workspace_quota_sources
      WHERE domain_kind = ? AND domain_id = ?`,
      ),
      uploads: database.prepare(
        `SELECT COALESCE(SUM(file_bytes), 0) AS bytes
       FROM (
         SELECT storage_name, MAX(file_bytes) AS file_bytes
           FROM workspace_quota_uploads
          WHERE domain_kind = ? AND domain_id = ?
          GROUP BY storage_name
       )`,
      ),
    }
    indexedQuotaDomainStatements.set(database, statements)
  }
  const data = statements.data.get(domainKind, domainId)
  const uploads = statements.uploads.get(domainKind, domainId)
  return Number(data?.bytes ?? 0) + Number(uploads?.bytes ?? 0)
}

function workspaceQuotaDomainKey(domainKind, domainId) {
  return `${domainKind}\u0000${domainId}`
}

function addWorkspaceQuotaDomain(domains, domainKind, domainId) {
  const kind = domainKind === 'team' ? 'team' : 'personal'
  const id = String(domainId ?? '').trim()
  if (!id) return
  domains.set(workspaceQuotaDomainKey(kind, id), { domainKind: kind, domainId: id })
}

function addWorkspaceQuotaEntryDomains(domains, entries) {
  for (const entry of entries.values()) {
    addWorkspaceQuotaDomain(domains, entry.domainKind, entry.domainId)
  }
}

function workspaceQuotaMutationSources(writePlan) {
  return [
    ...writePlan.users.upserts.map((value) => ({ sourceKind: 'user', sourceId: value.id })),
    ...writePlan.users.deletedIds.map((sourceId) => ({ sourceKind: 'user', sourceId })),
    ...writePlan.applications.upserts.map((value) => ({ sourceKind: 'application', sourceId: value.id })),
    ...writePlan.applications.deletedIds.map((sourceId) => ({ sourceKind: 'application', sourceId })),
    ...writePlan.profileAssets.upserts.map((value) => ({ sourceKind: 'profile', sourceId: value.id })),
    ...writePlan.profileAssets.deletedIds.map((sourceId) => ({ sourceKind: 'profile', sourceId })),
  ]
}

/** Capture only quota domains that this write can change. */
function prepareWorkspaceQuotaMutationGuard(database, writePlan, reservations = []) {
  const domains = new Map()
  const deletionCandidates = new Set()
  const selectExistingDomains = database.prepare(
    `SELECT domain_kind, domain_id
       FROM workspace_quota_sources
      WHERE source_kind = ? AND source_id = ?`,
  )
  for (const source of workspaceQuotaMutationSources(writePlan)) {
    for (const row of selectExistingDomains.all(source.sourceKind, source.sourceId)) {
      addWorkspaceQuotaDomain(domains, row.domain_kind, row.domain_id)
    }
    for (const row of database.prepare(
      `SELECT storage_name FROM workspace_quota_uploads
        WHERE source_kind = ? AND source_id = ?`,
    ).all(source.sourceKind, source.sourceId)) {
      deletionCandidates.add(row.storage_name)
    }
  }
  for (const user of writePlan.users.upserts) {
    addWorkspaceQuotaEntryDomains(domains, mailQuotaEntriesForUser(user))
  }
  for (const application of writePlan.applications.upserts) {
    addWorkspaceQuotaEntryDomains(domains, mailQuotaEntriesForApplication(application))
  }
  for (const asset of writePlan.profileAssets.upserts) {
    addWorkspaceQuotaEntryDomains(domains, mailQuotaEntriesForProfileAsset(asset))
  }
  for (const reservation of reservations) {
    addWorkspaceQuotaDomain(domains, reservation.domain_kind, reservation.domain_id)
  }
  if (writePlan.fullReconcile) {
    for (const row of database.prepare(
      'SELECT DISTINCT domain_kind, domain_id FROM workspace_quota_sources',
    ).all()) {
      addWorkspaceQuotaDomain(domains, row.domain_kind, row.domain_id)
    }
    for (const row of database.prepare('SELECT DISTINCT storage_name FROM workspace_quota_uploads').all()) {
      deletionCandidates.add(row.storage_name)
    }
  }

  // Repair only possibly affected legacy sources while BEGIN IMMEDIATE keeps
  // another process from creating a stale row between repair and comparison.
  const personalIds = []
  const teamIds = []
  for (const domain of domains.values()) {
    if (domain.domainKind === 'team') teamIds.push(domain.domainId)
    else personalIds.push(domain.domainId)
  }
  for (const personalId of personalIds) refreshStaleQuotaRows(database, personalId, [])
  if (teamIds.length) refreshStaleQuotaRows(database, personalIds[0] ?? '', teamIds)

  return {
    domains,
    deletionCandidates,
    beforeBytes: new Map([...domains].map(([key, domain]) => [
      key,
      indexedQuotaDomainBytes(database, domain.domainKind, domain.domainId),
    ])),
  }
}

function queueUnreferencedWorkspaceUploadDeletions(database, candidates) {
  const referenced = database.prepare(
    'SELECT 1 FROM workspace_quota_uploads WHERE storage_name = ? LIMIT 1',
  )
  const enqueue = database.prepare(
    `INSERT INTO workspace_upload_deletions (storage_name, requested_at)
     VALUES (?, ?)
     ON CONFLICT(storage_name) DO NOTHING`,
  )
  const cancel = database.prepare(
    `DELETE FROM workspace_upload_deletions
      WHERE storage_name = ? AND claim_token_hash IS NULL`,
  )
  for (const storageName of candidates) {
    if (referenced.get(storageName)) {
      const claimed = database.prepare(
        `SELECT 1 FROM workspace_upload_deletions
          WHERE storage_name = ? AND claim_token_hash IS NOT NULL`,
      ).get(storageName)
      if (claimed) {
        const error = new Error('A referenced upload is being durably deleted. Retry the mutation.')
        error.code = 'WORKSPACE_UPLOAD_DELETION_CONFLICT'
        error.status = 409
        throw error
      }
      cancel.run(storageName)
    }
    else enqueue.run(storageName, nowStamp())
  }
  const claimedReference = database.prepare(
    `SELECT d.storage_name
       FROM workspace_upload_deletions d
      WHERE d.claim_token_hash IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM workspace_quota_uploads q
           WHERE q.storage_name = d.storage_name
        )
      LIMIT 1`,
  ).get()
  if (claimedReference) {
    const error = new Error('A referenced upload is being durably deleted. Retry the mutation.')
    error.code = 'WORKSPACE_UPLOAD_DELETION_CONFLICT'
    error.status = 409
    throw error
  }
  // A newly added reference can race a deletion queued by an earlier durable
  // mutation. Cancel it in the same transaction that publishes the reference.
  database.prepare(
    `DELETE FROM workspace_upload_deletions
      WHERE claim_token_hash IS NULL
        AND EXISTS (
        SELECT 1 FROM workspace_quota_uploads q
         WHERE q.storage_name = workspace_upload_deletions.storage_name
      )`,
  ).run()
}

function durablePersonalStorageQuotaBytes(database, userId) {
  const row = database.prepare(
    `SELECT role,
            json_extract(settings_json, '$.membershipPlan') AS membership_plan,
            json_extract(settings_json, '$.personalMembershipPlan') AS personal_membership_plan,
            json_extract(settings_json, '$.storageQuotaMb') AS storage_quota_mb
       FROM users WHERE id = ?`,
  ).get(userId)
  if (!row) return 0
  if (normalizeUserRole(row.role) === 'admin') return Infinity
  const proLike = row.membership_plan === 'pro'
    || row.membership_plan === 'team'
    || row.personal_membership_plan === 'pro'
  const configuredMb = Number(row.storage_quota_mb)
  if (configuredMb === UNLIMITED_QUOTA_VALUE || configuredMb >= 1_000_000_000) return Infinity
  const fallbackMb = proLike ? DEFAULT_PRO_STORAGE_QUOTA_MB : DEFAULT_FREE_STORAGE_QUOTA_MB
  const quotaMb = Number.isFinite(configuredMb)
    ? Math.min(MAX_STORAGE_QUOTA_MB, Math.max(1, Math.round(configuredMb)))
    : fallbackMb
  return quotaMb * 1024 * 1024
}

function workspaceQuotaExceededError(domain, usedBytes, quotaBytes) {
  const team = domain.domainKind === 'team'
  const error = new Error(team
    ? 'Team storage quota exceeded. Ask an administrator to increase the team quota or move files out first.'
    : 'Storage quota exceeded. Remove stored files or increase the account storage limit.')
  error.code = team ? 'TEAM_STORAGE_QUOTA_EXCEEDED' : 'STORAGE_QUOTA_EXCEEDED'
  error.status = 413
  error.domainKind = domain.domainKind
  error.domainId = domain.domainId
  error.usedBytes = usedBytes
  error.quotaBytes = quotaBytes
  return error
}

/** Final canonical quota gate; an exception rolls back business and index rows. */
function assertWorkspaceQuotaMutation(database, guard, consumedReservationHashes = []) {
  for (const [key, domain] of guard.domains) {
    const beforeBytes = Number(guard.beforeBytes.get(key) ?? 0)
    const afterBytes = indexedQuotaDomainBytes(database, domain.domainKind, domain.domainId)
    if (afterBytes <= beforeBytes) continue
    const effectiveAfterBytes = afterBytes + activeWorkspaceQuotaReservationBytes(
      database,
      domain.domainKind,
      domain.domainId,
      consumedReservationHashes,
    )
    const quotaBytes = domain.domainKind === 'team'
      ? TEAM_STORAGE_QUOTA_BYTES
      : durablePersonalStorageQuotaBytes(database, domain.domainId)
    if (effectiveAfterBytes > quotaBytes) {
      throw workspaceQuotaExceededError(domain, effectiveAfterBytes, quotaBytes)
    }
  }
}

function workspaceQuotaReservationHash(token) {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex')
}

function workspaceQuotaIsoAfter(milliseconds) {
  return new Date(Date.now() + milliseconds).toISOString()
}

function workspaceQuotaProcessIsAlive(row) {
  if (!row || row.host_name !== workspaceQuotaHostName) return false
  if (row.instance_id === workspaceQuotaProcessInstanceId) return true
  try {
    process.kill(Number(row.process_id), 0)
    return true
  } catch {
    return false
  }
}

function stopWorkspaceQuotaHeartbeatIfIdle() {
  if (activeWorkspaceQuotaReservations.size !== 0 || !workspaceQuotaHeartbeatTimer) return
  clearInterval(workspaceQuotaHeartbeatTimer)
  workspaceQuotaHeartbeatTimer = null
}

function forgetActiveWorkspaceQuotaReservation(tokenHash) {
  activeWorkspaceQuotaReservations.delete(tokenHash)
  stopWorkspaceQuotaHeartbeatIfIdle()
}

function cleanupExpiredWorkspaceQuotaReservations(database, at = nowStamp()) {
  // A live process lease proves only that the worker is alive; it must not
  // extend the reservation's independent content/byte lease. Delete this
  // instance's expired rows atomically and mirror the exact removals into the
  // resident ownership set so quota and heartbeat capacity cannot leak.
  const expiredCurrentReservations = database.prepare(
    `DELETE FROM workspace_quota_reservations
      WHERE process_instance_id = ? AND expires_at <= ?
      RETURNING token_hash`,
  ).all(workspaceQuotaProcessInstanceId, at)
  for (const row of expiredCurrentReservations) {
    forgetActiveWorkspaceQuotaReservation(row.token_hash)
  }

  const expiredProcesses = database.prepare(
    `SELECT * FROM workspace_quota_processes
      WHERE instance_id <> ? AND expires_at <= ?`,
  ).all(workspaceQuotaProcessInstanceId, at)
  const removeProcess = database.prepare(
    'DELETE FROM workspace_quota_processes WHERE instance_id = ? AND expires_at <= ?',
  )
  for (const row of expiredProcesses) {
    if (workspaceQuotaProcessIsAlive(row)) continue
    removeProcess.run(row.instance_id, at)
  }
  database.prepare(
    `DELETE FROM workspace_quota_reservations
      WHERE expires_at <= ?
        AND process_instance_id NOT IN (
          SELECT instance_id FROM workspace_quota_processes WHERE expires_at > ?
        )`,
  ).run(at, at)
}

function heartbeatWorkspaceQuotaProcess(database) {
  const at = nowStamp()
  // A previous module generation cannot still own the same OS pid. Clear it
  // before registering the new opaque process instance so PID reuse never
  // pins abandoned reservations forever.
  database.prepare(
    `DELETE FROM workspace_quota_processes
      WHERE host_name = ? AND process_id = ? AND instance_id <> ?`,
  ).run(workspaceQuotaHostName, process.pid, workspaceQuotaProcessInstanceId)
  database.prepare(
    `INSERT INTO workspace_quota_processes (
       instance_id, host_name, process_id, heartbeat_at, expires_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(instance_id) DO UPDATE SET
       heartbeat_at = excluded.heartbeat_at,
       expires_at = excluded.expires_at`,
  ).run(
    workspaceQuotaProcessInstanceId,
    workspaceQuotaHostName,
    process.pid,
    at,
    workspaceQuotaIsoAfter(WORKSPACE_QUOTA_HEARTBEAT_LEASE_MS),
  )
  cleanupExpiredWorkspaceQuotaReservations(database, at)
}

function ensureWorkspaceQuotaHeartbeat() {
  const database = getDb()
  heartbeatWorkspaceQuotaProcess(database)
  if (workspaceQuotaHeartbeatTimer) return
  workspaceQuotaHeartbeatTimer = setInterval(() => {
    if (!storageInitialized) {
      clearInterval(workspaceQuotaHeartbeatTimer)
      workspaceQuotaHeartbeatTimer = null
      return
    }
    if (activeWorkspaceQuotaReservations.size === 0) {
      stopWorkspaceQuotaHeartbeatIfIdle()
      return
    }
    try {
      heartbeatWorkspaceQuotaProcess(getDb())
    } catch {
      // The reservation itself remains conservative. A later API call retries
      // the heartbeat; another process also checks same-host PID liveness.
    }
  }, WORKSPACE_QUOTA_HEARTBEAT_INTERVAL_MS)
  workspaceQuotaHeartbeatTimer.unref?.()
}

function normalizedWorkspaceQuotaObservedFiles(files) {
  const normalized = new Map()
  for (const file of files ?? []) {
    const storageName = path.basename(String(file?.storageName ?? ''))
    const bytes = Math.max(0, Number(file?.size) || 0)
    const digest = String(file?.digest ?? '').toLowerCase()
    if (!storageName || storageName !== String(file?.storageName ?? '')) {
      throw new TypeError('A canonical staged upload name is required.')
    }
    if (!Number.isSafeInteger(bytes) || !/^[a-f0-9]{64}$/u.test(digest)) {
      throw new TypeError('A verified staged upload size and SHA-256 digest are required.')
    }
    const current = normalized.get(storageName)
    if (!current || bytes > current.size) normalized.set(storageName, { storageName, size: bytes, digest })
    else if (bytes === current.size && digest !== current.digest) {
      throw new TypeError('One staged upload name cannot represent different content.')
    }
  }
  return [...normalized.values()].sort((left, right) => left.storageName.localeCompare(right.storageName))
}

function workspaceQuotaSourceVersion(database, sourceKind, sourceId) {
  if (sourceKind === 'user') {
    return Number(database.prepare('SELECT settings_version AS version FROM users WHERE id = ?').get(sourceId)?.version ?? -1)
  }
  if (sourceKind === 'application') {
    return Number(database.prepare('SELECT payload_version AS version FROM applications WHERE id = ?').get(sourceId)?.version ?? -1)
  }
  if (sourceKind === 'profile') {
    return Number(database.prepare('SELECT payload_version AS version FROM profile_assets WHERE id = ?').get(sourceId)?.version ?? -1)
  }
  if (sourceKind === 'backup') return 0
  return -1
}

export async function readWorkspaceQuotaSourceVersion(sourceKind, sourceId) {
  await ensureStorage()
  return workspaceQuotaSourceVersion(getDb(), String(sourceKind ?? ''), String(sourceId ?? ''))
}

function activeWorkspaceQuotaReservationBytes(database, domainKind, domainId, excludedHashes = []) {
  const excluded = new Set(excludedHashes)
  return database.prepare(
    `SELECT token_hash, reserved_bytes
       FROM workspace_quota_reservations
      WHERE domain_kind = ? AND domain_id = ?`,
  ).all(domainKind, domainId).reduce((total, row) => (
    excluded.has(row.token_hash) ? total : total + Number(row.reserved_bytes ?? 0)
  ), 0)
}

function stagedUploadReservationBytes(database, domainKind, domainId, files) {
  const currentUpload = database.prepare(
    `SELECT MAX(file_bytes) AS bytes
       FROM workspace_quota_uploads
      WHERE domain_kind = ? AND domain_id = ? AND storage_name = ?`,
  )
  return files.reduce((total, file) => {
    const current = Number(currentUpload.get(domainKind, domainId, file.storageName)?.bytes ?? 0)
    return total + Math.max(0, file.size - current)
  }, 0)
}

export async function reserveWorkspaceQuota({
  domainKind,
  domainId,
  sourceKind,
  sourceId,
  expectedSourceVersion,
  requestId,
  observedFiles = [],
  reserveBytes = 0,
  actorId = '',
  ttlMs = WORKSPACE_QUOTA_RESERVATION_TTL_MS,
} = {}) {
  await ensureStorage()
  const kind = domainKind === 'team' ? 'team' : 'personal'
  const normalizedDomainId = String(domainId ?? '').trim()
  const normalizedSourceKind = String(sourceKind ?? '').trim()
  const normalizedSourceId = String(sourceId ?? '').trim()
  const normalizedRequestId = String(requestId ?? '').trim()
  if (
    !normalizedDomainId
    || !['user', 'application', 'profile', 'backup'].includes(normalizedSourceKind)
    || !normalizedSourceId
    || !normalizedRequestId
  ) throw new TypeError('A quota domain, source, and request id are required.')
  const files = normalizedWorkspaceQuotaObservedFiles(observedFiles)
  const requestedVersion = Math.max(0, Number(expectedSourceVersion) || 0)
  const requestedReserveBytes = Math.max(0, Number(reserveBytes) || 0)
  if (!Number.isSafeInteger(requestedReserveBytes)) throw new TypeError('Reserved bytes must be a safe integer.')
  const fingerprint = createHash('sha256').update(JSON.stringify({
    kind,
    domainId: normalizedDomainId,
    sourceKind: normalizedSourceKind,
    sourceId: normalizedSourceId,
    expectedSourceVersion: requestedVersion,
    files,
    reserveBytes: requestedReserveBytes,
  }), 'utf8').digest('hex')
  const database = getDb()
  let result
  database.transaction(() => {
    heartbeatWorkspaceQuotaProcess(database)
    if (kind === 'team') refreshStaleQuotaRows(database, String(actorId ?? ''), [normalizedDomainId])
    else refreshStaleQuotaRows(database, normalizedDomainId, [])
    const existing = database.prepare(
      `SELECT * FROM workspace_quota_reservations
        WHERE request_id = ? AND source_kind = ? AND source_id = ?`,
    ).get(normalizedRequestId, normalizedSourceKind, normalizedSourceId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        const error = new Error('This quota reservation key was already used for different content.')
        error.code = 'WORKSPACE_QUOTA_RESERVATION_CONFLICT'
        error.status = 409
        throw error
      }
      const token = decryptSecret(existing.token_encrypted)
      if (!token) throw new Error('The quota reservation token could not be recovered.')
      result = { token, reservedBytes: Number(existing.reserved_bytes), replayed: true }
      return
    }
    const currentVersion = workspaceQuotaSourceVersion(database, normalizedSourceKind, normalizedSourceId)
    if (normalizedSourceKind !== 'backup' && currentVersion !== requestedVersion) {
      const error = new Error('The quota source changed before its upload could be reserved.')
      error.code = 'WORKSPACE_REVISION_CONFLICT'
      error.status = 409
      throw error
    }
    const domainCount = Number(database.prepare(
      'SELECT COUNT(*) AS count FROM workspace_quota_reservations WHERE domain_kind = ? AND domain_id = ?',
    ).get(kind, normalizedDomainId)?.count ?? 0)
    const globalCount = Number(database.prepare(
      'SELECT COUNT(*) AS count FROM workspace_quota_reservations',
    ).get()?.count ?? 0)
    if (domainCount >= WORKSPACE_QUOTA_MAX_ACTIVE_PER_DOMAIN || globalCount >= WORKSPACE_QUOTA_MAX_ACTIVE_GLOBAL) {
      const error = new Error('Too many storage writes are already in progress. Please retry shortly.')
      error.code = 'WORKSPACE_QUOTA_RESERVATION_BUSY'
      error.status = 503
      error.retryAfterSeconds = 1
      throw error
    }
    const fileBytes = stagedUploadReservationBytes(database, kind, normalizedDomainId, files)
    const reservedBytes = Math.max(fileBytes, requestedReserveBytes)
    const usedBytes = indexedQuotaDomainBytes(database, kind, normalizedDomainId)
    const outstandingBytes = activeWorkspaceQuotaReservationBytes(database, kind, normalizedDomainId)
    const quotaBytes = kind === 'team'
      ? TEAM_STORAGE_QUOTA_BYTES
      : durablePersonalStorageQuotaBytes(database, normalizedDomainId)
    if (usedBytes + outstandingBytes + reservedBytes > quotaBytes) {
      throw workspaceQuotaExceededError(
        { domainKind: kind, domainId: normalizedDomainId },
        usedBytes + outstandingBytes + reservedBytes,
        quotaBytes,
      )
    }
    const token = `phda_qr_v1_${randomBytes(32).toString('base64url')}`
    const tokenHash = workspaceQuotaReservationHash(token)
    const at = nowStamp()
    database.prepare(
      `INSERT INTO workspace_quota_reservations (
         token_hash, token_encrypted, fingerprint, domain_kind, domain_id,
         source_kind, source_id, expected_source_version, request_id,
         process_instance_id, observed_files_json, reserved_bytes,
         created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tokenHash,
      encryptSecret(token),
      fingerprint,
      kind,
      normalizedDomainId,
      normalizedSourceKind,
      normalizedSourceId,
      requestedVersion,
      normalizedRequestId,
      workspaceQuotaProcessInstanceId,
      toJson(files),
      reservedBytes,
      at,
      new Date(Date.now() + Math.min(60 * 60_000, Math.max(30_000, Number(ttlMs) || WORKSPACE_QUOTA_RESERVATION_TTL_MS))).toISOString(),
    )
    activeWorkspaceQuotaReservations.add(tokenHash)
    result = { token, reservedBytes, replayed: false }
  }).immediate()
  ensureWorkspaceQuotaHeartbeat()
  return result
}

export async function releaseWorkspaceQuotaReservation(token) {
  await ensureStorage()
  const tokenHash = workspaceQuotaReservationHash(token)
  const removed = getDb().prepare(
    `DELETE FROM workspace_quota_reservations
      WHERE token_hash = ? AND process_instance_id = ?`,
  ).run(tokenHash, workspaceQuotaProcessInstanceId)
  forgetActiveWorkspaceQuotaReservation(tokenHash)
  return Number(removed.changes ?? 0) > 0
}

function loadWorkspaceQuotaReservationsForCommit(database, tokens, writePlan) {
  const hashes = [...new Set((tokens ?? []).map(workspaceQuotaReservationHash))]
  if (hashes.length === 0) return []
  const touchedSources = new Set(workspaceQuotaMutationSources(writePlan).map((source) => (
    `${source.sourceKind}\u0000${source.sourceId}`
  )))
  const select = database.prepare(
    'SELECT * FROM workspace_quota_reservations WHERE token_hash = ?',
  )
  return hashes.map((tokenHash) => {
    const row = select.get(tokenHash)
    if (!row) {
      const error = new Error('The storage reservation expired or was already consumed.')
      error.code = 'WORKSPACE_QUOTA_RESERVATION_INVALID'
      error.status = 409
      throw error
    }
    if (
      row.source_kind !== 'backup'
      && !touchedSources.has(`${row.source_kind}\u0000${row.source_id}`)
    ) {
      const error = new Error('The storage reservation does not belong to this mutation.')
      error.code = 'WORKSPACE_QUOTA_RESERVATION_MISMATCH'
      error.status = 409
      throw error
    }
    const currentVersion = workspaceQuotaSourceVersion(database, row.source_kind, row.source_id)
    if (row.source_kind !== 'backup' && currentVersion !== Number(row.expected_source_version)) {
      const error = new Error('The reserved storage source changed before commit.')
      error.code = 'WORKSPACE_REVISION_CONFLICT'
      error.status = 409
      throw error
    }
    return row
  })
}

function verifyCommittedWorkspaceQuotaReservations(database, reservations) {
  const selectUpload = database.prepare(
    `SELECT file_bytes FROM workspace_quota_uploads
      WHERE source_kind = ? AND source_id = ?
        AND domain_kind = ? AND domain_id = ? AND storage_name = ?`,
  )
  for (const reservation of reservations) {
    if (reservation.source_kind === 'backup') continue
    const files = fromJson(reservation.observed_files_json, [])
    for (const file of files) {
      const row = selectUpload.get(
        reservation.source_kind,
        reservation.source_id,
        reservation.domain_kind,
        reservation.domain_id,
        file.storageName,
      )
      if (!row || Number(row.file_bytes) !== Number(file.size)) {
        const error = new Error('The committed storage reference does not match its verified staged file.')
        error.code = 'WORKSPACE_QUOTA_RESERVATION_MISMATCH'
        error.status = 409
        throw error
      }
    }
  }
}

function consumeWorkspaceQuotaReservations(database, reservations) {
  const remove = database.prepare('DELETE FROM workspace_quota_reservations WHERE token_hash = ?')
  for (const reservation of reservations) {
    if (Number(remove.run(reservation.token_hash).changes ?? 0) !== 1) {
      const error = new Error('The storage reservation was consumed concurrently.')
      error.code = 'WORKSPACE_QUOTA_RESERVATION_INVALID'
      error.status = 409
      throw error
    }
  }
}

/**
 * Return the authoritative quota baseline without decoding peer workspaces.
 * Normal writes maintain the index in their business transaction. Legacy or
 * focused direct-SQL rows are repaired lazily by source version, one admitted
 * row at a time; Team trash is scanned once for all requested Teams.
 */
export async function readWorkspaceQuotaUsage(userId, teamIds = []) {
  await ensureStorage()
  const database = getDb()
  const subjectId = String(userId ?? '').trim()
  const requestedTeamIds = [...new Set(
    (teamIds ?? []).map((value) => String(value ?? '').trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right))
  if (!subjectId) {
    return { personalBytes: 0, teamBytes: {}, revision: readDurableWorkspaceRevision(database) }
  }

  // Backup discovery is a one-time legacy repair per account and process. The
  // former implementation acquired the process-global write lane for every
  // quota read even after the actor was already synchronized. /api/auth/me is
  // intentionally refreshable, so several open tabs turned this read-only
  // endpoint into a continuous global-lock stream.
  if (!workspaceQuotaBackupActorsSynchronized.has(subjectId)) {
    await withWriteLock(
      () => synchronizeWorkspaceBackupQuotaActor(subjectId),
      { tenantKeys: [tenantKeyForUser({ id: subjectId })], label: 'quota-legacy-repair' },
    )
  }

  let indexed = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeRevision = readDurableWorkspaceRevision(database)
    // Normal writes maintain this ledger transactionally. Keep the common
    // quota read purely read-only; enter narrow tenant lanes only when a
    // legacy/direct-SQL row is actually stale.
    if (!workspaceQuotaScopeIsFresh(database, subjectId, requestedTeamIds)) {
      await withWriteLock(
        () => refreshStaleQuotaRows(database, subjectId, requestedTeamIds),
        {
          tenantKeys: [
            tenantKeyForUser({ id: subjectId }),
            ...requestedTeamIds.map((id) => tenantKeyForTeam({ id })),
          ],
          label: 'quota-ledger-repair',
        },
      )
    }
    indexed = database.transaction(() => ({
      personalBytes: indexedQuotaDomainBytes(database, 'personal', subjectId),
      teamBytes: Object.fromEntries(requestedTeamIds.map((teamId) => [
        teamId,
        indexedQuotaDomainBytes(database, 'team', teamId),
      ])),
      revision: readDurableWorkspaceRevision(database),
    })).deferred()
    if (indexed.revision === beforeRevision) break
    indexed = null
  }
  if (!indexed) {
    const error = new Error('Workspace quota accounting changed repeatedly during aggregation.')
    error.code = 'WORKSPACE_REVISION_CONFLICT'
    error.status = 409
    throw error
  }
  return indexed
}

/** Mail-specific compatibility name; both callers consume the same ledger. */
export async function readMailSyncQuotaUsage(userId, teamIds = []) {
  return readWorkspaceQuotaUsage(userId, teamIds)
}

const workspaceQuotaFreshnessStatements = new WeakMap()

function workspaceQuotaFreshnessStatementsFor(database) {
  let statements = workspaceQuotaFreshnessStatements.get(database)
  if (statements) return statements
  statements = {
    user: database.prepare(
      `SELECT 1
         FROM users u
        WHERE (? = 1 OR u.id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM workspace_quota_sources q
             WHERE q.source_kind = 'user'
               AND q.source_id = u.id
               AND q.domain_kind = 'personal'
               AND q.domain_id = u.id
               AND q.source_version = u.settings_version
          )
        LIMIT 1`,
    ),
    personalApplication: database.prepare(
      `SELECT 1 FROM applications a
        WHERE a.owner_id = ? AND a.team_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM workspace_quota_sources q
             WHERE q.source_kind = 'application' AND q.source_id = a.id
               AND q.domain_kind = 'personal' AND q.domain_id = a.owner_id
               AND q.source_version = a.payload_version
          )
        LIMIT 1`,
    ),
    profile: database.prepare(
      `SELECT 1 FROM profile_assets p
        WHERE p.owner_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM workspace_quota_sources q
             WHERE q.source_kind = 'profile' AND q.source_id = p.id
               AND q.domain_kind = 'personal' AND q.domain_id = p.owner_id
               AND q.source_version = p.payload_version
          )
        LIMIT 1`,
    ),
    teamApplication: database.prepare(
      `SELECT 1 FROM applications a
        WHERE a.team_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          AND NOT EXISTS (
            SELECT 1 FROM workspace_quota_sources q
             WHERE q.source_kind = 'application' AND q.source_id = a.id
               AND q.domain_kind = 'team' AND q.domain_id = a.team_id
               AND q.source_version = a.payload_version
          )
        LIMIT 1`,
    ),
  }
  workspaceQuotaFreshnessStatements.set(database, statements)
  return statements
}

function workspaceQuotaScopeIsFresh(database, subjectId, requestedTeamIds) {
  const scanAllUsers = requestedTeamIds.length ? 1 : 0
  const statements = workspaceQuotaFreshnessStatementsFor(database)
  const staleUser = statements.user.get(scanAllUsers, subjectId)
  if (staleUser) return false
  const stalePersonalApplication = statements.personalApplication.get(subjectId)
  if (stalePersonalApplication) return false
  const staleProfile = statements.profile.get(subjectId)
  if (staleProfile) return false
  if (requestedTeamIds.length) {
    const staleTeamApplication = statements.teamApplication.get(JSON.stringify(requestedTeamIds))
    if (staleTeamApplication) return false
  }
  return true
}

/**
 * Short, non-hydrating compare-and-set guard for an already repaired quota
 * snapshot. It is safe to call while holding the mutation lock: stale legacy
 * rows cause a retry outside the lock instead of decoding a peer payload here.
 */
export async function validateWorkspaceQuotaUsageSnapshot(snapshot, userId, teamIds = []) {
  await ensureStorage()
  const database = getDb()
  const subjectId = String(userId ?? '').trim()
  const requestedTeamIds = [...new Set(
    (teamIds ?? []).map((value) => String(value ?? '').trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right))
  if (!subjectId) return false
  const indexed = database.transaction(() => {
    if (!workspaceQuotaScopeIsFresh(database, subjectId, requestedTeamIds)) return null
    return {
      personalBytes: indexedQuotaDomainBytes(database, 'personal', subjectId),
      teamBytes: Object.fromEntries(requestedTeamIds.map((teamId) => [
        teamId,
        indexedQuotaDomainBytes(database, 'team', teamId),
      ])),
    }
  }).deferred()
  if (!indexed) return false
  if (Number(indexed.personalBytes) !== Number(snapshot?.personalBytes)) return false
  const snapshotTeams = snapshot?.teamBytes ?? {}
  const snapshotTeamIds = Object.keys(snapshotTeams).sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(snapshotTeamIds) !== JSON.stringify(requestedTeamIds)) return false
  return requestedTeamIds.every((teamId) => (
    Number(indexed.teamBytes[teamId]) === Number(snapshotTeams[teamId])
  ))
}

/** Tiny recovery lookup for crash-safe mail attachment staging. */
export async function isWorkspaceUploadReferenced(storageName) {
  await ensureStorage()
  const normalized = path.basename(String(storageName ?? ''))
  if (!normalized) return false
  return Boolean(getDb().prepare(
    'SELECT 1 FROM workspace_quota_uploads WHERE storage_name = ? LIMIT 1',
  ).get(normalized))
}

export async function claimNextWorkspaceUploadDeletion() {
  await ensureStorage()
  const database = getDb()
  let claim = null
  database.transaction(() => {
    heartbeatWorkspaceQuotaProcess(database)
    const at = nowStamp()
    database.prepare(
      `DELETE FROM workspace_upload_deletions
        WHERE EXISTS (
          SELECT 1 FROM workspace_quota_uploads q
           WHERE q.storage_name = workspace_upload_deletions.storage_name
        )
        AND claim_token_hash IS NULL`,
    ).run()
    const candidate = database.prepare(
      `SELECT storage_name FROM workspace_upload_deletions
        WHERE claim_token_hash IS NULL OR claim_expires_at <= ?
        ORDER BY requested_at ASC, storage_name ASC
        LIMIT 1`,
    ).get(at)
    if (!candidate) return
    const token = `phda_ud_v1_${randomBytes(32).toString('base64url')}`
    const tokenHash = workspaceQuotaReservationHash(token)
    const updated = database.prepare(
      `UPDATE workspace_upload_deletions
          SET claim_token_hash = ?, claimed_by = ?, claim_expires_at = ?
        WHERE storage_name = ?
          AND (claim_token_hash IS NULL OR claim_expires_at <= ?)
          AND NOT EXISTS (
            SELECT 1 FROM workspace_quota_uploads q
             WHERE q.storage_name = workspace_upload_deletions.storage_name
          )`,
    ).run(
      tokenHash,
      workspaceQuotaProcessInstanceId,
      workspaceQuotaIsoAfter(WORKSPACE_QUOTA_HEARTBEAT_LEASE_MS),
      candidate.storage_name,
      at,
    )
    if (Number(updated.changes ?? 0) === 1) {
      claim = { token, storageName: candidate.storage_name }
    }
  }).immediate()
  if (claim) ensureWorkspaceQuotaHeartbeat()
  return claim
}

export async function finishWorkspaceUploadDeletion(token, storageName, { deleted } = {}) {
  await ensureStorage()
  const normalized = path.basename(String(storageName ?? ''))
  const tokenHash = workspaceQuotaReservationHash(token)
  const database = getDb()
  const changed = database.transaction(() => {
    const row = database.prepare(
      `SELECT 1 FROM workspace_upload_deletions
        WHERE storage_name = ? AND claim_token_hash = ?`,
    ).get(normalized, tokenHash)
    if (!row) return false
    if (deleted) {
      if (database.prepare(
        'SELECT 1 FROM workspace_quota_uploads WHERE storage_name = ? LIMIT 1',
      ).get(normalized)) {
        const error = new Error('The upload became referenced before physical deletion completed.')
        error.code = 'WORKSPACE_UPLOAD_DELETION_CONFLICT'
        error.status = 409
        throw error
      }
      database.prepare(
        'DELETE FROM workspace_upload_deletions WHERE storage_name = ? AND claim_token_hash = ?',
      ).run(normalized, tokenHash)
    } else {
      database.prepare(
        `UPDATE workspace_upload_deletions
            SET claim_token_hash = NULL, claimed_by = NULL, claim_expires_at = NULL
          WHERE storage_name = ? AND claim_token_hash = ?`,
      ).run(normalized, tokenHash)
    }
    return true
  }).immediate()
  if (changed && deleted) await acknowledgeDurableStorageMutation()
  return changed
}

function boundedSqlBatches(values, size = 400) {
  const unique = [...new Set((values ?? []).filter(Boolean))]
  const batches = []
  for (let offset = 0; offset < unique.length; offset += size) {
    batches.push(unique.slice(offset, offset + size))
  }
  return batches
}

function scopedStoreReservationBytes(payloadBytes) {
  const bytes = Math.max(0, Number(payloadBytes) || 0)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    // Stored encrypted JSON is already ~4/3 of plaintext. Two stored-image
    // equivalents plus a fixed parser/index allowance covers the resident
    // object and one copy-on-write mutation without making a legal 100 MiB Pro
    // workspace mathematically impossible under the default 512 MiB budget.
    Math.max(16 * 1024 * 1024, (bytes * 2) + (32 * 1024 * 1024)),
  )
}

export function focusedApplicationReadReservationBytes(payloadBytes) {
  const bytes = Math.max(0, Number(payloadBytes) || 0)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    // A focused GET never owns a copy-on-write store image. It holds the one
    // decoded application plus JSON response projection, with an 8 MiB bounded
    // decrypt/parser allowance. The 16 MiB floor keeps native/V8 transients
    // represented without stacking the generic 32 MiB mutation allowance.
    Math.max(16 * 1024 * 1024, (bytes * 2) + (8 * 1024 * 1024)),
  )
}

function compactScopedStoreReservationBytes(payloadBytes) {
  const bytes = Math.max(0, Number(payloadBytes) || 0)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    // Focused auth-only reads materialize compact principals and, when asked,
    // only reachable Team authorization metadata—never application, Profile,
    // or event collections. Keep enough room for the measured projection
    // without charging every revalidation the ordinary 16 MiB floor.
    Math.max(256 * 1024, (bytes * 2) + (256 * 1024)),
  )
}

export function scopedReadOnlyStreamReservationBytes(payloadBytes) {
  const bytes = Math.max(0, Number(payloadBytes) || 0)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    // A pre-header section cursor owns one immutable SQLite payload until its
    // consumer has incrementally serialized that row. It never creates the
    // copy-on-write image charged by scopedStoreReservationBytes(). Reserve
    // the complete durable row plus a bounded decrypt/parser allowance; the
    // process-wide 64 MiB hard-to-budget margin remains available for native
    // crypto and V8 transients, and the 512 MiB qualification measures RSS.
    Math.max(16 * 1024 * 1024, bytes + (8 * 1024 * 1024)),
  )
}

/**
 * Read only the constant-size receipt written beside an application payload.
 * The authored and route-authority hashes are stored in the same SQLite
 * transaction as payload_json, so acknowledgement never hydrates a second
 * copy of a large dossier after commit. Empty legacy hashes never verify.
 */
export async function readApplicationMutationReceipt(applicationId) {
  await ensureStorage()
  const id = String(applicationId ?? '').trim()
  if (!id) return null
  const row = getDb().prepare(
    'SELECT id, updated_at, authored_hash, authority_hash FROM applications WHERE id = ?',
  ).get(id)
  if (!row) return null
  let authorityHashes = {}
  try {
    const parsed = JSON.parse(row.authority_hash || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      authorityHashes = Object.fromEntries(
        Object.entries(parsed).filter(([purpose, digest]) => (
          Object.hasOwn(APPLICATION_MUTATION_AUTHORITY_PATHS, purpose)
          && typeof digest === 'string'
          && /^[A-Za-z0-9_-]{43}$/u.test(digest)
        )),
      )
    }
  } catch {
    // Legacy/partial receipts fail verification and are repaired by the next
    // real application write; never infer durability from an invalid digest.
  }
  return {
    id: row.id,
    updatedAt: row.updated_at,
    authoredHash: row.authored_hash,
    authorityHashes,
  }
}

/**
 * Hydrate only the account and Team workspaces reachable by one authenticated
 * subject. Ordinary mutations use this projection so one user's save never
 * parses every other tenant's applications. Its differential baseline contains
 * only selected rows; writeStore therefore cannot delete unseen tenant data.
 */
export async function readScopedStore(userId, options = {}) {
  await ensureStorage()
  const database = getDb()
  const subjectId = String(userId ?? '').trim()
  const actorId = String(options.actorId ?? '').trim()
  const principalIds = [...new Set([subjectId, actorId].filter(Boolean))]
  const requestedApplicationIds = [...new Set(
    (Array.isArray(options.applicationIds) ? options.applicationIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  )]
  const requestedProfileAssetIds = [...new Set(
    (Array.isArray(options.profileAssetIds) ? options.profileAssetIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  )]
  const requestedTeamIds = [...new Set(
    (Array.isArray(options.teamIds) ? options.teamIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  )]
  const includeAllApplications = options.includeApplications !== false
  const includeAllProfileAssets = options.includeProfileAssets !== false
  const compactWorkspaceUsers = options.compactWorkspaceUsers === true
  const includeAllTeams = options.includeTeams !== false
  const includeTeamPeers = options.includeTeamPeers !== false
  const includeSystemEvents = options.includeSystemEvents !== false
  const allowAdminApplicationTargets = options.allowAdminApplicationTargets === true
  const readOnlyFocusedApplication = options.readOnlyFocusedApplication === true
    && !includeAllApplications
    && !includeAllProfileAssets
    && requestedApplicationIds.length === 1
    && requestedProfileAssetIds.length === 0
  const publicGrant = normalizeWorkspacePublicGrantCas(options.publicGrant)
  if (options.publicGrant && !publicGrant) {
    throw new TypeError('A valid public grant compare-and-swap descriptor is required.')
  }
  if (publicGrant) assertWorkspacePublicGrantCas(database, publicGrant)
  const subjectIsSystemAdmin = allowAdminApplicationTargets && normalizeUserRole(
    database.prepare('SELECT role FROM users WHERE id = ?').get(subjectId)?.role,
  ) === 'admin'
  const compactMemoryReservation = options.compactMemoryReservation === true
    && compactWorkspaceUsers
    && !includeAllApplications
    && !includeAllProfileAssets
    && requestedApplicationIds.length === 0
    && requestedProfileAssetIds.length === 0
  const completionCriticalMemoryReservation = options.completionCriticalMemoryReservation === true
    && compactMemoryReservation
  if (!principalIds.length) return null

  let releaseMemory = null
  const hydrate = () => {
    scopedStoreHydrations += 1
    const principalPlaceholders = principalIds.map(() => '?').join(', ')
    const teamIdRows = database.prepare(
      `SELECT DISTINCT teams.id
       FROM teams
       LEFT JOIN team_members
         ON team_members.team_id = teams.id
        AND team_members.status = 'active'
        AND team_members.removed_at IS NULL
       WHERE teams.owner_id IN (${principalPlaceholders})
          OR team_members.user_id IN (${principalPlaceholders})
       ORDER BY teams.created_at ASC`,
    ).all(...principalIds, ...principalIds)
    const teamIds = teamIdRows.map((row) => row.id)
    const teamIdSet = new Set(teamIds)
    const peerIds = new Set(principalIds)
    if (includeTeamPeers || requestedProfileAssetIds.length > 0) {
      for (const batch of boundedSqlBatches(teamIds)) {
        const placeholders = batch.map(() => '?').join(', ')
        const peerRows = database.prepare(
          `SELECT DISTINCT id FROM users WHERE id IN (
             SELECT owner_id FROM teams WHERE id IN (${placeholders})
             UNION
             SELECT user_id FROM team_members
              WHERE team_id IN (${placeholders})
                AND user_id IS NOT NULL
                AND status = 'active'
                AND removed_at IS NULL
           )`,
        ).all(...batch, ...batch)
        for (const row of peerRows) peerIds.add(row.id)
      }
    }

    // Reachability and hydration are deliberately separate. The complete id
    // sets remain available for authorization, while a focused request only
    // materializes its principals, target owners, and target Team metadata.
    const hydratedUserIds = includeTeamPeers ? new Set(peerIds) : new Set(principalIds)
    const hydratedTeamIds = includeAllTeams
      ? new Set(teamIds)
      : new Set(requestedTeamIds.filter((id) => teamIdSet.has(id)))
    const focusedApplicationMetadata = new Map()
    if (!includeAllApplications) {
      for (const batch of boundedSqlBatches(requestedApplicationIds)) {
        const placeholders = batch.map(() => '?').join(', ')
        const rows = database.prepare(
          `SELECT id, owner_id, team_id, LENGTH(payload_json) AS payload_bytes
           FROM applications WHERE id IN (${placeholders})`,
        ).all(...batch)
        for (const row of rows) {
          if (
            row.owner_id !== subjectId
            && (!row.team_id || !teamIdSet.has(row.team_id))
            && !subjectIsSystemAdmin
          ) continue
          focusedApplicationMetadata.set(row.id, row)
          hydratedUserIds.add(row.owner_id)
          if (row.team_id) hydratedTeamIds.add(row.team_id)
        }
      }
    }
    const focusedProfileMetadata = new Map()
    if (!includeAllProfileAssets) {
      for (const batch of boundedSqlBatches(requestedProfileAssetIds)) {
        const placeholders = batch.map(() => '?').join(', ')
        const rows = database.prepare(
          `SELECT id, owner_id, team_id, LENGTH(payload_json) AS payload_bytes
           FROM profile_assets WHERE id IN (${placeholders})`,
        ).all(...batch)
        for (const row of rows) {
          if (!peerIds.has(row.owner_id)) continue
          focusedProfileMetadata.set(row.id, row)
          hydratedUserIds.add(row.owner_id)
          if (row.team_id && teamIdSet.has(row.team_id)) hydratedTeamIds.add(row.team_id)
        }
      }
    }
    for (const batch of boundedSqlBatches([...hydratedTeamIds])) {
      const placeholders = batch.map(() => '?').join(', ')
      const rows = database.prepare(`SELECT owner_id FROM teams WHERE id IN (${placeholders})`).all(...batch)
      for (const row of rows) hydratedUserIds.add(row.owner_id)
    }

    let durableBytes = 0
    const addDurableBytes = (value) => {
      durableBytes = Math.min(Number.MAX_SAFE_INTEGER, durableBytes + Math.max(0, Number(value) || 0))
    }
    for (const batch of boundedSqlBatches([...hydratedUserIds])) {
      const placeholders = batch.map(() => '?').join(', ')
      const principalPlaceholdersForSize = principalIds.map(() => '?').join(', ')
      const userSize = compactWorkspaceUsers
        ? database.prepare(
          `SELECT COALESCE(SUM(
             CASE WHEN id IN (${principalPlaceholdersForSize})
               THEN ${FOCUSED_SESSION_SETTINGS_BUDGET_BYTES}
               ELSE CASE WHEN json_valid(settings_json)
                 THEN MIN(COALESCE(LENGTH(CAST(json_extract(settings_json, '$.avatarDataUrl') AS BLOB)), 0), 600000) + 2048
                 ELSE 2048
               END
             END
             + LENGTH(name) + LENGTH(email) + 1024
           ), 0) AS bytes
           FROM users WHERE id IN (${placeholders})`,
        ).get(...principalIds, ...batch)
        : database.prepare(
          `SELECT COALESCE(SUM(LENGTH(settings_json) + LENGTH(name) + LENGTH(email) + 1024), 0) AS bytes
           FROM users WHERE id IN (${placeholders})`,
        ).get(...batch)
      addDurableBytes(userSize?.bytes)
      if (includeAllProfileAssets) {
        const profileSize = database.prepare(
          `SELECT COALESCE(SUM(LENGTH(payload_json) + LENGTH(name) + 1024), 0) AS bytes
           FROM profile_assets WHERE owner_id IN (${placeholders})`,
        ).get(...batch)
        addDurableBytes(profileSize?.bytes)
      }
    }
    if (includeAllApplications) {
      addDurableBytes(database.prepare(
        `SELECT COALESCE(SUM(LENGTH(payload_json) + 1024), 0) AS bytes
         FROM applications WHERE owner_id = ?`,
      ).get(subjectId)?.bytes)
    }
    for (const batch of boundedSqlBatches([...hydratedTeamIds])) {
      const placeholders = batch.map(() => '?').join(', ')
      const teamSize = database.prepare(
        `SELECT COALESCE(SUM(
           LENGTH(name) + LENGTH(logo_data_url) + COALESCE(LENGTH(profile_presets_json), 0)
           + COALESCE(LENGTH(teacher_groups_json), 0)
           + COALESCE(LENGTH(permission_defaults_json), 0) + 1024
         ), 0) AS bytes FROM teams WHERE id IN (${placeholders})`,
      ).get(...batch)
      addDurableBytes(teamSize?.bytes)
      if (includeAllApplications) {
        const applicationSize = database.prepare(
          `SELECT COALESCE(SUM(LENGTH(payload_json) + 1024), 0) AS bytes
           FROM applications WHERE team_id IN (${placeholders})`,
        ).get(...batch)
        addDurableBytes(applicationSize?.bytes)
      }
    }
    if (includeSystemEvents) {
      const eventSize = database.prepare(
        `SELECT COALESCE(SUM(
           LENGTH(id) + LENGTH(time) + LENGTH(scope) + COALESCE(LENGTH(actor_id), 0)
           + LENGTH(message) + LENGTH(metadata_json) + 512
         ), 0) AS bytes
         FROM (
           SELECT id, time, scope, actor_id, message, metadata_json
             FROM system_events
            WHERE actor_id IS NULL OR actor_id IN (${principalPlaceholders})
            ORDER BY time DESC, id DESC LIMIT ?
         )`,
      ).get(...principalIds, SYSTEM_EVENT_WORKING_SET_LIMIT)
      addDurableBytes(eventSize?.bytes)
    }
    if (!includeAllApplications) {
      for (const row of focusedApplicationMetadata.values()) {
        addDurableBytes(Number(row.payload_bytes) + 1024)
      }
    }
    if (!includeAllProfileAssets) {
      for (const row of focusedProfileMetadata.values()) {
        addDurableBytes(Number(row.payload_bytes) + 1024)
      }
    }
    const reservationBytes = compactMemoryReservation
      ? compactScopedStoreReservationBytes(durableBytes)
      : readOnlyFocusedApplication
        ? focusedApplicationReadReservationBytes(durableBytes)
        : scopedStoreReservationBytes(durableBytes)
    releaseMemory = acquireStoreHydrationMemory?.(reservationBytes, {
      completionCritical: completionCriticalMemoryReservation,
    }) ?? null

    const teamRowsById = new Map()
    for (const batch of boundedSqlBatches([...hydratedTeamIds])) {
      const placeholders = batch.map(() => '?').join(', ')
      for (const row of database.prepare(`SELECT * FROM teams WHERE id IN (${placeholders})`).all(...batch)) {
        teamRowsById.set(row.id, row)
      }
    }
    const teamRows = [...teamRowsById.values()]
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))

    const userRowsById = new Map()
    const focusedUsersById = new Map()
    const compactPeerSettingsSql = `json_object(
      'avatarDataUrl', COALESCE(json_extract(settings_json, '$.avatarDataUrl'), ''),
      'membershipPlan', json_extract(settings_json, '$.membershipPlan'),
      'personalMembershipPlan', json_extract(settings_json, '$.personalMembershipPlan'),
      'applicationQuota', json_extract(settings_json, '$.applicationQuota'),
      'applicationCreatedCount', json_extract(settings_json, '$.applicationCreatedCount'),
      'applicationCreateQuota', json_extract(settings_json, '$.applicationCreateQuota'),
      'storageQuotaMb', json_extract(settings_json, '$.storageQuotaMb'),
      'shareQuota', json_extract(settings_json, '$.shareQuota'),
      'shareCreatedCount', json_extract(settings_json, '$.shareCreatedCount'),
      'shareCreateQuota', json_extract(settings_json, '$.shareCreateQuota'),
      'trashRetentionDays', json_extract(settings_json, '$.trashRetentionDays'),
      'authVersion', auth_version
    )`
    const principalIdSet = new Set(principalIds)
    for (const batch of boundedSqlBatches([...hydratedUserIds])) {
      const placeholders = batch.map(() => '?').join(', ')
      if (!compactWorkspaceUsers) {
        for (const row of database.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...batch)) {
          userRowsById.set(row.id, row)
        }
        continue
      }
      for (const id of batch) {
        if (!principalIdSet.has(id)) continue
        const focused = readFocusedSessionAccountFromDatabase(database, id)
        if (focused) focusedUsersById.set(id, focused)
      }
      const peerIdsInBatch = batch.filter((id) => !principalIdSet.has(id))
      if (peerIdsInBatch.length > 0) {
        const peerPlaceholders = peerIdsInBatch.map(() => '?').join(', ')
        const rows = database.prepare(
          `SELECT id, name, email, role, '' AS password_hash, created_at, last_login_at,
                  disabled_at, settings_version, auth_version,
                  CASE WHEN json_valid(settings_json)
                    THEN ${compactPeerSettingsSql}
                    ELSE json_object('authVersion', auth_version)
                  END AS settings_json
             FROM users WHERE id IN (${peerPlaceholders})`,
        ).all(...peerIdsInBatch)
        for (const row of rows) userRowsById.set(row.id, row)
      }
    }

    const applicationRowsById = new Map()
    if (includeAllApplications) {
      const personalRows = database
        .prepare('SELECT * FROM applications WHERE owner_id = ? ORDER BY deadline ASC')
        .all(subjectId)
      for (const row of personalRows) applicationRowsById.set(row.id, row)
      for (const batch of boundedSqlBatches(teamIds)) {
        const placeholders = batch.map(() => '?').join(', ')
        const rows = database
          .prepare(`SELECT * FROM applications WHERE team_id IN (${placeholders}) ORDER BY deadline ASC`)
          .all(...batch)
        for (const row of rows) applicationRowsById.set(row.id, row)
      }
    } else {
      for (const batch of boundedSqlBatches(requestedApplicationIds)) {
        const placeholders = batch.map(() => '?').join(', ')
        const rows = database.prepare(`SELECT * FROM applications WHERE id IN (${placeholders})`).all(...batch)
        for (const row of rows) {
          if (
            row.owner_id === subjectId
            || (row.team_id && teamIdSet.has(row.team_id))
            || subjectIsSystemAdmin
          ) {
            applicationRowsById.set(row.id, row)
          }
        }
      }
    }

    const profileRowsById = new Map()
    if (includeAllProfileAssets) {
      for (const batch of boundedSqlBatches([...peerIds])) {
        const placeholders = batch.map(() => '?').join(', ')
        const rows = database
          .prepare(`SELECT * FROM profile_assets WHERE owner_id IN (${placeholders}) ORDER BY updated_at DESC`)
          .all(...batch)
        for (const row of rows) profileRowsById.set(row.id, row)
      }
    } else {
      for (const batch of boundedSqlBatches(requestedProfileAssetIds)) {
        const placeholders = batch.map(() => '?').join(', ')
        const rows = database.prepare(`SELECT * FROM profile_assets WHERE id IN (${placeholders})`).all(...batch)
        for (const row of rows) {
          if (peerIds.has(row.owner_id)) profileRowsById.set(row.id, row)
        }
      }
    }

    const applicationRows = [...applicationRowsById.values()]
      .sort((left, right) => String(left.deadline).localeCompare(String(right.deadline)))
    const profileRows = [...profileRowsById.values()]
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))

    const decodedApplications = applicationRows.map((row) => ({
      row,
      payload: decodePayloadFromStorage(row.payload_json),
    }))
    const schoolLogoAssets = readReferencedSchoolLogoAssets(
      database,
      decodedApplications.map(({ payload }) => payload),
    )
    const metaRows = database.prepare('SELECT key, value FROM app_meta').all()
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, fromJson(row.value)]))
    const settingsRow = compactWorkspaceUsers
      ? null
      : database.prepare('SELECT * FROM system_settings WHERE id = ?').get('global')
    const systemEvents = includeSystemEvents
      ? database.prepare(
        `SELECT * FROM system_events
         WHERE actor_id IS NULL OR actor_id IN (${principalPlaceholders})
         ORDER BY time DESC, id DESC LIMIT ?`,
      ).all(...principalIds, SYSTEM_EVENT_WORKING_SET_LIMIT)
      : []
    const store = {
      meta: {
        ...(meta.version ?? {}),
        adapter: currentDatabaseAdapter(),
        updatedAt: nowStamp(),
        revision: readDurableWorkspaceRevision(database),
      },
      settings: compactWorkspaceUsers
        ? focusedSystemSettingsFromDatabase(database)
        : settingsFromRow(settingsRow),
      users: [
        ...[...userRowsById.values()].map(userFromRow),
        ...focusedUsersById.values(),
      ].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
      teams: teamRows.map(teamFromRow),
      applications: decodedApplications.map(({ row, payload }) => (
        applicationFromRow(row, schoolLogoAssets, payload)
      )),
      profileAssets: profileRows.map(profileAssetFromRow),
      systemEvents: systemEvents.map(eventFromRow),
    }
    attachStoreTenantRevisions(store, durableTenantRevisionsForStore(database, store))
    attachStoreBaseline(store)
    attachStoreScope(
      store,
      {
        userId: subjectId,
        actorId: actorId || null,
        teamIds,
        selector: {
          applicationIds: requestedApplicationIds,
          profileAssetIds: requestedProfileAssetIds,
          teamIds: requestedTeamIds,
          includeApplications: includeAllApplications,
          includeProfileAssets: includeAllProfileAssets,
          compactWorkspaceUsers,
          compactMemoryReservation,
          allowAdminApplicationTargets,
          includeTeams: includeAllTeams,
          includeTeamPeers,
          includeSystemEvents,
          publicGrant,
        },
      },
      options.retainMemoryReservation !== false ? releaseMemory : null,
    )
    if (options.retainMemoryReservation !== false) {
      releaseMemory = null
    }
    return store
  }

  try {
    return database.inTransaction ? hydrate() : database.transaction(hydrate).deferred()
  } finally {
    releaseMemory?.()
  }
}

function scopedSectionChanged(section) {
  const error = new Error(`The ${section} section changed while it was being streamed.`)
  error.code = 'WORKSPACE_REVISION_CHANGED'
  error.status = 409
  error.retryable = true
  return error
}

function updateScopedSectionHash(hash, value) {
  const text = String(value ?? '')
  hash.update(String(Buffer.byteLength(text, 'utf8')))
  hash.update(':')
  hash.update(text)
  hash.update(';')
}

function scopedSectionRowFingerprint(section, row) {
  const hash = createHash('sha256')
  updateScopedSectionHash(hash, 'phd-atlas-scoped-section-row-v2')
  updateScopedSectionHash(hash, section)
  for (const value of row.fingerprintValues) updateScopedSectionHash(hash, value)
  updateScopedSectionHash(hash, row.payloadJson)
  return hash.digest('base64url')
}

function createScopedSectionDigest(section, scopeIdentity) {
  const hash = createHash('sha256')
  updateScopedSectionHash(hash, 'phd-atlas-scoped-section-v3')
  updateScopedSectionHash(hash, section)
  updateScopedSectionHash(hash, scopeIdentity)
  let count = 0
  let finished = false
  return {
    add(rowFingerprint) {
      if (finished) throw new Error('A scoped section digest cannot be updated after completion.')
      updateScopedSectionHash(hash, rowFingerprint)
      count += 1
    },
    finish() {
      if (finished) throw new Error('A scoped section digest can only be completed once.')
      finished = true
      updateScopedSectionHash(hash, count)
      return { count, fingerprint: hash.digest('base64url') }
    },
  }
}

function normalizedScopeValues(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}

function applicationSectionSelection({
  userId,
  mode = 'personal',
  teamId = null,
  visibleOwnerIds = [],
  excludedTeamIds = [],
  personalOnly = false,
} = {}) {
  const normalizedMode = mode === 'team'
    ? 'team'
    : mode === 'team-all'
      ? 'team-all'
      : mode === 'owners'
        ? 'owners'
        : 'personal'
  const clauses = []
  const values = []
  if (normalizedMode === 'team-all') {
    const normalizedTeamId = String(teamId ?? '').trim()
    const scopeIdentity = JSON.stringify({ mode: normalizedMode, teamId: normalizedTeamId })
    if (!normalizedTeamId) return { where: 'WHERE 0 = 1', values: [], scopeIdentity, mode: normalizedMode }
    return { where: 'WHERE team_id = ?', values: [normalizedTeamId], scopeIdentity, mode: normalizedMode }
  } else if (normalizedMode === 'team') {
    const normalizedTeamId = String(teamId ?? '').trim()
    const owners = normalizedScopeValues(visibleOwnerIds)
    const scopeIdentity = JSON.stringify({
      mode: normalizedMode,
      teamId: normalizedTeamId,
      visibleOwnerIds: owners,
    })
    if (!normalizedTeamId || !owners.length) {
      return { where: 'WHERE 0 = 1', values: [], scopeIdentity, mode: normalizedMode }
    }
    clauses.push('team_id = ?')
    values.push(normalizedTeamId)
    // JSON1 is already required by the storage schema's retention queries. One
    // bound JSON array keeps a large Team directory below SQLite's parameter
    // ceiling without interpolating any authorization value into SQL.
    clauses.push('owner_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))')
    values.push(JSON.stringify(owners))
    return { where: `WHERE ${clauses.join(' AND ')}`, values, scopeIdentity, mode: normalizedMode }
  } else if (normalizedMode === 'owners') {
    const owners = normalizedScopeValues(visibleOwnerIds)
    const scopeIdentity = JSON.stringify({ mode: normalizedMode, visibleOwnerIds: owners })
    if (!owners.length) return { where: 'WHERE 0 = 1', values: [], scopeIdentity, mode: normalizedMode }
    clauses.push('owner_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))')
    values.push(JSON.stringify(owners))
    return { where: `WHERE ${clauses.join(' AND ')}`, values, scopeIdentity, mode: normalizedMode }
  } else {
    const normalizedUserId = String(userId ?? '').trim()
    const excluded = normalizedScopeValues(excludedTeamIds)
    const scopeIdentity = JSON.stringify({
      mode: normalizedMode,
      userId: normalizedUserId,
      personalOnly: Boolean(personalOnly),
      excludedTeamIds: excluded,
    })
    if (!normalizedUserId) return { where: 'WHERE 0 = 1', values: [], scopeIdentity, mode: normalizedMode }
    clauses.push('owner_id = ?')
    values.push(normalizedUserId)
    if (personalOnly) {
      clauses.push('team_id IS NULL')
    } else {
      if (excluded.length) {
        clauses.push(`(
          team_id IS NULL
          OR team_id NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        )`)
        values.push(JSON.stringify(excluded))
      }
    }
    return { where: `WHERE ${clauses.join(' AND ')}`, values, scopeIdentity, mode: normalizedMode }
  }
}

const applicationSectionMetadataColumns = `
  id, owner_id, team_id, deadline, updated_at, payload_version,
  LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
`

function applicationSectionFingerprintValues(row) {
  return [
    row.id,
    row.owner_id,
    row.team_id,
    row.deadline,
    row.updated_at,
    row.payload_version,
    row.payload_bytes,
  ]
}

function profileAssetSectionFingerprintValues(row) {
  return [
    row.id,
    row.owner_id,
    row.name,
    row.kind,
    row.updated_at,
    row.payload_version,
    row.payload_bytes,
  ]
}

function currentApplicationRowFingerprint(row) {
  return scopedSectionRowFingerprint('applications', {
    fingerprintValues: applicationSectionFingerprintValues(row),
    payloadJson: '',
  })
}

function scopedSectionMetadataMatches(metadata, row, fingerprintValues) {
  const expectedValues = fingerprintValues(metadata)
  const currentValues = fingerprintValues(row)
  return expectedValues.length === currentValues.length
    && expectedValues.every((value, index) => String(value ?? '') === String(currentValues[index] ?? ''))
}

// Statement objects own native SQLite allocations until V8 finalization. A
// burst of empty cursor requests used to prepare the same three statements in
// snapshot, transfer, and validation phases for every request, leaving hundreds
// of dead native handles resident after the responses had completed. Cache only
// immutable SQL shapes per live database; each reader retains its own keyset
// cursor, so concurrent request position is never shared.
const applicationSectionStatementsByDatabase = new WeakMap()
const profileAssetSectionStatementsByDatabase = new WeakMap()

function cachedSectionStatements(cacheByDatabase, database, key, create) {
  let databaseCache = cacheByDatabase.get(database)
  if (!databaseCache) {
    databaseCache = new Map()
    cacheByDatabase.set(database, databaseCache)
  }
  let statements = databaseCache.get(key)
  if (!statements) {
    statements = create()
    databaseCache.set(key, statements)
  }
  return statements
}

function applicationSectionMetadataReader(
  database,
  selection,
  { batchSize = DEFAULT_SCOPED_KEYSET_BATCH_SIZE } = {},
) {
  const orderByOwner = selection.mode === 'owners'
  const orderBy = orderByOwner
    ? 'owner_id ASC, deadline ASC, id ASC'
    : 'deadline ASC, id ASC'
  const { first, next, nextAfterNullDeadline } = cachedSectionStatements(
    applicationSectionStatementsByDatabase,
    database,
    `${orderByOwner ? 'owners' : 'single'}\u0000${selection.where}`,
    () => ({
      first: database.prepare(
        `SELECT ${applicationSectionMetadataColumns}
         FROM applications ${selection.where}
         ORDER BY ${orderBy}
         LIMIT ?`,
      ),
      next: orderByOwner
        ? database.prepare(
          `SELECT ${applicationSectionMetadataColumns}
           FROM applications ${selection.where}
             AND (
               owner_id > ?
               OR (owner_id = ? AND (deadline > ? OR (deadline = ? AND id > ?)))
           )
           ORDER BY ${orderBy}
           LIMIT ?`,
        )
        : database.prepare(
          `SELECT ${applicationSectionMetadataColumns}
           FROM applications ${selection.where}
             AND (deadline > ? OR (deadline = ? AND id > ?))
           ORDER BY ${orderBy}
           LIMIT ?`,
        ),
      nextAfterNullDeadline: orderByOwner
        ? database.prepare(
          `SELECT ${applicationSectionMetadataColumns}
           FROM applications ${selection.where}
             AND (
               owner_id > ?
               OR (
                 owner_id = ?
                 AND ((deadline IS NULL AND id > ?) OR deadline IS NOT NULL)
               )
           )
           ORDER BY ${orderBy}
           LIMIT ?`,
        )
        : database.prepare(
          `SELECT ${applicationSectionMetadataColumns}
           FROM applications ${selection.where}
             AND ((deadline IS NULL AND id > ?) OR deadline IS NOT NULL)
           ORDER BY ${orderBy}
           LIMIT ?`,
        ),
    }),
  )
  return createBatchedKeysetReader({
    batchSize,
    loadBatch: (cursor, batchSize) => {
      if (!cursor) return first.all(...selection.values, batchSize)
      if (cursor.deadline === null) {
        return orderByOwner
          ? nextAfterNullDeadline.all(
              ...selection.values,
              cursor.ownerId,
              cursor.ownerId,
              cursor.id,
              batchSize,
            )
          : nextAfterNullDeadline.all(...selection.values, cursor.id, batchSize)
      }
      return orderByOwner
        ? next.all(
            ...selection.values,
            cursor.ownerId,
            cursor.ownerId,
            cursor.deadline,
            cursor.deadline,
            cursor.id,
            batchSize,
          )
        : next.all(...selection.values, cursor.deadline, cursor.deadline, cursor.id, batchSize)
    },
    cursorFromRow: (row) => ({
      ownerId: row.owner_id,
      deadline: row.deadline,
      id: row.id,
    }),
  })
}

function profileAssetSectionSelection({ userId, ownerIds = [], teamId = null } = {}) {
  const owners = normalizedScopeValues([
    userId,
    ...(Array.isArray(ownerIds) ? ownerIds : []),
  ])
  const normalizedTeamId = String(teamId ?? '').trim()
  const scopeIdentity = JSON.stringify({ owners, teamId: normalizedTeamId || null })
  const orderByOwner = owners.length > 1 && !normalizedTeamId
  if (!owners.length) return { where: 'WHERE 0 = 1', values: [], scopeIdentity, orderByOwner }
  const clauses = ['owner_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))']
  const values = [JSON.stringify(owners)]
  if (normalizedTeamId) {
    clauses.push('team_id = ?')
    values.push(normalizedTeamId)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, values, scopeIdentity, orderByOwner }
}

function profileAssetSectionMetadataReader(
  database,
  selection,
  { batchSize = DEFAULT_SCOPED_KEYSET_BATCH_SIZE } = {},
) {
  const columns = `id, owner_id, team_id, name, kind, updated_at, payload_version,
                   LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes`
  const orderBy = selection.orderByOwner
    ? 'owner_id ASC, updated_at DESC, id ASC'
    : 'updated_at DESC, id ASC'
  const { first, next } = cachedSectionStatements(
    profileAssetSectionStatementsByDatabase,
    database,
    `${selection.orderByOwner ? 'owners' : 'single'}\u0000${selection.where}`,
    () => ({
      first: database.prepare(
        `SELECT ${columns}
         FROM profile_assets
         ${selection.where}
         ORDER BY ${orderBy}
         LIMIT ?`,
      ),
      next: selection.orderByOwner
        ? database.prepare(
          `SELECT ${columns}
           FROM profile_assets
           ${selection.where}
             AND (
               owner_id > ?
               OR (owner_id = ? AND (updated_at < ? OR (updated_at = ? AND id > ?)))
           )
           ORDER BY ${orderBy}
           LIMIT ?`,
        )
        : database.prepare(
          `SELECT ${columns}
           FROM profile_assets
           ${selection.where}
             AND (updated_at < ? OR (updated_at = ? AND id > ?))
           ORDER BY ${orderBy}
           LIMIT ?`,
        ),
    }),
  )
  return createBatchedKeysetReader({
    batchSize,
    loadBatch: (cursor, batchSize) => {
      if (!cursor) return first.all(...selection.values, batchSize)
      return selection.orderByOwner
        ? next.all(
            ...selection.values,
            cursor.ownerId,
            cursor.ownerId,
            cursor.updatedAt,
            cursor.updatedAt,
            cursor.id,
            batchSize,
          )
        : next.all(...selection.values, cursor.updatedAt, cursor.updatedAt, cursor.id, batchSize)
    },
    cursorFromRow: (row) => ({
      ownerId: row.owner_id,
      updatedAt: row.updated_at,
      id: row.id,
    }),
  })
}

function scopedSectionScanAborted(signal) {
  if (!signal?.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('Workspace section scan was cancelled.')
  error.code ??= 'CLIENT_DISCONNECTED'
  throw error
}

/**
 * Disk-backed exact de-duplication for sectional workspace aggregates. Large
 * Teams can reference hundreds of thousands of distinct upload names or mail
 * addresses; retaining those strings in JavaScript Sets would make metadata
 * generation grow with the entire workspace. SQLite's TEMP table keeps only a
 * small page cache resident and is dropped on every success, abort, or error.
 */
export async function createScopedWorkspaceDedupAccumulator() {
  await ensureStorage()
  const database = getDb()
  const table = `workspace_dedup_${randomUUID().replaceAll('-', '')}`
  database.exec(`CREATE TEMP TABLE ${table} (
    scope TEXT NOT NULL,
    item_key TEXT NOT NULL,
    numeric_value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, item_key)
  ) WITHOUT ROWID`)
  const upsert = database.prepare(
    `INSERT INTO ${table} (scope, item_key, numeric_value)
     VALUES (?, ?, ?)
     ON CONFLICT(scope, item_key) DO UPDATE SET
       numeric_value = MAX(${table}.numeric_value, excluded.numeric_value)`,
  )
  const sum = database.prepare(
    `SELECT COALESCE(SUM(numeric_value), 0) AS total FROM ${table} WHERE scope = ?`,
  )
  const count = database.prepare(
    `SELECT COUNT(*) AS total FROM ${table} WHERE scope = ?`,
  )
  const has = database.prepare(
    `SELECT 1 AS present FROM ${table} WHERE scope = ? AND item_key = ? LIMIT 1`,
  )
  let closed = false
  const assertOpen = () => {
    if (closed) throw new Error('Workspace de-duplication accumulator is closed.')
  }
  return {
    add(scope, itemKey, numericValue = 0) {
      assertOpen()
      const normalizedScope = String(scope ?? '')
      const normalizedKey = String(itemKey ?? '')
      if (!normalizedScope || !normalizedKey) return
      upsert.run(normalizedScope, normalizedKey, Math.max(0, Math.round(Number(numericValue) || 0)))
    },
    total(scope) {
      assertOpen()
      return Math.max(0, Number(sum.get(String(scope ?? ''))?.total) || 0)
    },
    count(scope) {
      assertOpen()
      return Math.max(0, Number(count.get(String(scope ?? ''))?.total) || 0)
    },
    has(scope, itemKey) {
      assertOpen()
      return Boolean(has.get(String(scope ?? ''), String(itemKey ?? '')))
    },
    close() {
      if (closed) return
      closed = true
      database.exec(`DROP TABLE IF EXISTS ${table}`)
    },
  }
}

async function yieldScopedSectionScan(state, metadata, { signal, onProgress } = {}) {
  scopedSectionScanAborted(signal)
  state.rows += 1
  state.bytes += Math.max(0, Number(metadata?.payload_bytes) || 0)
  if (state.rows < 8 && state.bytes < 1024 * 1024) return
  state.rows = 0
  state.bytes = 0
  onProgress?.()
  await new Promise((resolve) => setImmediate(resolve))
  scopedSectionScanAborted(signal)
}

async function captureScopedSectionSnapshot({
  database,
  section,
  scopeIdentity,
  createMetadataReader,
  rowFingerprint,
  signal,
  onProgress,
}) {
  const digest = createScopedSectionDigest(section, scopeIdentity)
  const nextMetadata = createMetadataReader(database)
  const yieldState = { rows: 0, bytes: 0 }
  let payloadBytes = 0
  let maxPayloadBytes = 0
  for (;;) {
    const metadata = nextMetadata()
    if (!metadata) break
    digest.add(rowFingerprint(metadata))
    const rowPayloadBytes = Math.max(0, Number(metadata.payload_bytes) || 0)
    payloadBytes = Math.min(
      Number.MAX_SAFE_INTEGER,
      payloadBytes + rowPayloadBytes,
    )
    maxPayloadBytes = Math.max(maxPayloadBytes, rowPayloadBytes)
    await yieldScopedSectionScan(yieldState, metadata, { signal, onProgress })
  }
  // The keyset reader and each SELECT are completed before this function
  // returns. No SQLite iterator, transaction, row payload, or lease is retained.
  return { ...digest.finish(), payloadBytes, maxPayloadBytes }
}

function scopedCursorPayloadReservation(snapshot, enabled) {
  if (!enabled || snapshot.maxPayloadBytes <= 0) return null
  return acquireStoreHydrationMemory?.(
    scopedReadOnlyStreamReservationBytes(snapshot.maxPayloadBytes + 1024),
  ) ?? null
}

function scopedCursorHasSharedPayloadReservation(sharedReservation) {
  if (sharedReservation === null || sharedReservation === undefined) return false
  if (typeof sharedReservation.isActive !== 'function') {
    throw new TypeError('A shared scoped-cursor reservation must expose isActive().')
  }
  return sharedReservation.isActive() === true
}

function currentProfileAssetRowFingerprint(row) {
  return scopedSectionRowFingerprint('profile assets', {
    fingerprintValues: profileAssetSectionFingerprintValues(row),
    payloadJson: '',
  })
}

/**
 * Snapshot only row identities, then hydrate one application at a time. The
 * generator holds each row's memory lease until its consumer has serialized
 * that item and verifies the scoped fingerprint before completing.
 */
export async function createScopedApplicationSectionCursor(options = {}) {
  await ensureStorage()
  const selection = applicationSectionSelection(options)
  const database = getDb()
  const scanOptions = { signal: options.signal, onProgress: options.onProgress }
  const snapshot = await captureScopedSectionSnapshot({
    database,
    section: 'applications',
    scopeIdentity: selection.scopeIdentity,
    createMetadataReader: (target) => applicationSectionMetadataReader(target, selection),
    rowFingerprint: currentApplicationRowFingerprint,
    ...scanOptions,
  })
  let releaseReservedPayloadMemory = scopedCursorPayloadReservation(
    snapshot,
    options.reservePayloadMemory === true,
  )
  const sharedPayloadMemoryReservation = options.sharedPayloadMemoryReservation ?? null
  const release = () => {
    releaseReservedPayloadMemory?.()
    releaseReservedPayloadMemory = null
  }

  async function validate() {
    const latest = await captureScopedSectionSnapshot({
      database: getDb(),
      section: 'applications',
      scopeIdentity: selection.scopeIdentity,
      createMetadataReader: (target) => applicationSectionMetadataReader(target, selection),
      rowFingerprint: currentApplicationRowFingerprint,
      ...scanOptions,
    })
    if (latest.count !== snapshot.count || latest.fingerprint !== snapshot.fingerprint) {
      throw scopedSectionChanged('applications')
    }
  }

  async function * values() {
    const streamDatabase = getDb()
    // The live transfer intentionally fetches one metadata row at a time. A
    // concurrent same-scope mutation must be allowed to yield its latest row
    // before the terminal fingerprint requests a restart; prefetching future
    // rows here would turn that established handoff into an early rejection.
    const nextMetadata = applicationSectionMetadataReader(streamDatabase, selection, { batchSize: 1 })
    const readApplication = streamDatabase.prepare(
      `SELECT id, owner_id, team_id, deadline, updated_at, payload_version,
              payload_json, LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
       FROM applications WHERE id = ?`,
    )
    const digest = createScopedSectionDigest('applications', selection.scopeIdentity)
    const yieldState = { rows: 0, bytes: 0 }
    let yielded = 0
    try {
      for (;;) {
        const metadata = nextMetadata()
        if (!metadata) break
        const releaseMemory = releaseReservedPayloadMemory
          || scopedCursorHasSharedPayloadReservation(sharedPayloadMemoryReservation)
          ? null
          : acquireStoreHydrationMemory?.(
              scopedStoreReservationBytes(Number(metadata.payload_bytes) + 1024),
            ) ?? null
        try {
          const row = readApplication.get(metadata.id)
          if (!row || !scopedSectionMetadataMatches(metadata, row, applicationSectionFingerprintValues)) {
            throw scopedSectionChanged('applications')
          }
          if (yielded >= snapshot.count) throw scopedSectionChanged('applications')
          digest.add(currentApplicationRowFingerprint(metadata))
          const payload = await decodePayloadFromStorageAsync(row.payload_json)
          // The SQLite ciphertext is no longer needed once the immutable
          // application has been decoded. Clear the row's only reference
          // before yielding so serialization does not retain both images.
          row.payload_json = ''
          const logos = readReferencedSchoolLogoAssets(getDb(), [payload])
          yielded += 1
          yield applicationFromRow(row, logos, payload)
        } finally {
          releaseMemory?.()
        }
        await yieldScopedSectionScan(yieldState, metadata, scanOptions)
      }
      const streamed = digest.finish()
      if (streamed.count !== snapshot.count || streamed.fingerprint !== snapshot.fingerprint) {
        throw scopedSectionChanged('applications')
      }
      await validate()
    } finally {
      release()
    }
  }

  return {
    count: snapshot.count,
    fingerprint: snapshot.fingerprint,
    payloadBytes: snapshot.payloadBytes,
    maxPayloadBytes: snapshot.maxPayloadBytes,
    values: values(),
    validate,
    release,
  }
}

export async function createScopedProfileAssetSectionCursor({
  userId,
  ownerIds = [],
  teamId = null,
  signal,
  onProgress,
  reservePayloadMemory = false,
  sharedPayloadMemoryReservation = null,
} = {}) {
  await ensureStorage()
  const selection = profileAssetSectionSelection({ userId, ownerIds, teamId })
  const database = getDb()
  const scanOptions = { signal, onProgress }
  const snapshot = await captureScopedSectionSnapshot({
    database,
    section: 'profile assets',
    scopeIdentity: selection.scopeIdentity,
    createMetadataReader: (target) => profileAssetSectionMetadataReader(target, selection),
    rowFingerprint: currentProfileAssetRowFingerprint,
    ...scanOptions,
  })
  let releaseReservedPayloadMemory = scopedCursorPayloadReservation(snapshot, reservePayloadMemory)
  const release = () => {
    releaseReservedPayloadMemory?.()
    releaseReservedPayloadMemory = null
  }

  async function validate() {
    const latest = await captureScopedSectionSnapshot({
      database: getDb(),
      section: 'profile assets',
      scopeIdentity: selection.scopeIdentity,
      createMetadataReader: (target) => profileAssetSectionMetadataReader(target, selection),
      rowFingerprint: currentProfileAssetRowFingerprint,
      ...scanOptions,
    })
    if (latest.count !== snapshot.count || latest.fingerprint !== snapshot.fingerprint) {
      throw scopedSectionChanged('profile assets')
    }
  }

  async function * values() {
    const streamDatabase = getDb()
    const nextMetadata = profileAssetSectionMetadataReader(streamDatabase, selection, { batchSize: 1 })
    const readProfileAsset = streamDatabase.prepare(
      `SELECT *, LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
       FROM profile_assets WHERE id = ?`,
    )
    const digest = createScopedSectionDigest('profile assets', selection.scopeIdentity)
    const yieldState = { rows: 0, bytes: 0 }
    let yielded = 0
    try {
      for (;;) {
        const metadata = nextMetadata()
        if (!metadata) break
        const releaseMemory = releaseReservedPayloadMemory
          || scopedCursorHasSharedPayloadReservation(sharedPayloadMemoryReservation)
          ? null
          : acquireStoreHydrationMemory?.(
              scopedStoreReservationBytes(Number(metadata.payload_bytes) + 1024),
            ) ?? null
        try {
          const row = readProfileAsset.get(metadata.id)
          if (!row || !scopedSectionMetadataMatches(metadata, row, profileAssetSectionFingerprintValues)) {
            throw scopedSectionChanged('profile assets')
          }
          if (yielded >= snapshot.count) throw scopedSectionChanged('profile assets')
          digest.add(currentProfileAssetRowFingerprint(metadata))
          yielded += 1
          yield profileAssetFromRow(row)
        } finally {
          releaseMemory?.()
        }
        await yieldScopedSectionScan(yieldState, metadata, scanOptions)
      }
      const streamed = digest.finish()
      if (streamed.count !== snapshot.count || streamed.fingerprint !== snapshot.fingerprint) {
        throw scopedSectionChanged('profile assets')
      }
      await validate()
    } finally {
      release()
    }
  }

  return {
    count: snapshot.count,
    fingerprint: snapshot.fingerprint,
    payloadBytes: snapshot.payloadBytes,
    maxPayloadBytes: snapshot.maxPayloadBytes,
    values: values(),
    validate,
    release,
  }
}

function applicationTrashSectionSelection({
  userId,
  ownerIds = [],
  teamId = null,
  retained = false,
  pro = true,
  nowMs = Date.now(),
  limit = 100,
} = {}) {
  const owners = normalizedScopeValues([
    userId,
    ...(Array.isArray(ownerIds) ? ownerIds : []),
  ])
  const normalizedTeamId = String(teamId ?? '').trim()
  const retainedLimit = Math.max(1, Math.min(1000, Math.round(Number(limit) || 100)))
  const nowIso = new Date(Number(nowMs) || Date.now()).toISOString()
  const scopeIdentity = JSON.stringify({
    owners,
    teamId: normalizedTeamId || null,
    retained: Boolean(retained),
    pro: Boolean(pro),
    limit: retained ? retainedLimit : null,
  })
  if (!owners.length) {
    return { where: 'WHERE 0 = 1', values: [], owners, scopeIdentity }
  }
  const clauses = [
    'users.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))',
    "json_type(trash.value) = 'object'",
    "json_extract(trash.value, '$.id') IS NOT NULL",
    "json_type(trash.value, '$.application') = 'object'",
  ]
  const values = [JSON.stringify(owners)]
  if (normalizedTeamId) {
    clauses.push("CAST(json_extract(trash.value, '$.application.teamId') AS TEXT) = ?")
    values.push(normalizedTeamId)
  }
  if (retained) {
    if (!pro) {
      clauses.push("COALESCE(CAST(json_extract(trash.value, '$.application.teamId') AS TEXT), '') <> ''")
    }
    clauses.push(`(
      COALESCE(CAST(json_extract(trash.value, '$.expiresAt') AS TEXT), '') = ''
      OR julianday(json_extract(trash.value, '$.expiresAt')) > julianday(?)
    )`)
    values.push(nowIso)
  }
  return {
    where: `WHERE ${clauses.join(' AND ')}`,
    values,
    owners,
    scopeIdentity,
    retained: Boolean(retained),
    limit: retainedLimit,
  }
}

const applicationTrashMetadataColumns = `
  users.id AS owner_id,
  users.settings_version AS settings_version,
  CAST(trash.key AS INTEGER) AS ordinal,
  CAST(json_extract(trash.value, '$.id') AS TEXT) AS id,
  CAST(json_extract(trash.value, '$.deletedAt') AS TEXT) AS deleted_at,
  CAST(json_extract(trash.value, '$.expiresAt') AS TEXT) AS expires_at,
  CAST(json_extract(trash.value, '$.application.teamId') AS TEXT) AS team_id,
  LENGTH(CAST(trash.value AS BLOB)) AS payload_bytes
`

/**
 * Identity of one trashed application, and nothing else.
 *
 * `settings_version` used to be part of this. It is the version of the whole
 * settings row, so *any* unrelated settings write — a theme colour, a toggle,
 * the mutation nonce a save stamps — changed this fingerprint and invalidated
 * the workspace stream mid-transfer. The client then discarded the partial
 * payload and re-downloaded the entire workspace, which is why an ordinary
 * sign-in could transfer it two or three times over.
 *
 * The remaining columns are sufficient: a trash entry is written once when an
 * application is deleted and removed when it is restored or purged, so it is
 * never edited in place. Every mutation of the list changes an id, an ordinal,
 * the count, or the expiry that a retention change rewrites — all captured
 * here.
 */
function applicationTrashFingerprintValues(row) {
  return [
    row.owner_id,
    row.ordinal,
    row.id,
    row.deleted_at,
    row.expires_at,
    row.team_id,
    row.payload_bytes,
  ]
}

function currentApplicationTrashFingerprint(row) {
  return scopedSectionRowFingerprint('application trash', {
    fingerprintValues: applicationTrashFingerprintValues(row),
    payloadJson: '',
  })
}

function applicationTrashMetadataReader(database, selection) {
  const from = `FROM users
    JOIN json_each(users.settings_json, '$.applicationTrash') AS trash`
  const deletedAtExpression = "COALESCE(CAST(json_extract(trash.value, '$.deletedAt') AS TEXT), '')"
  const first = database.prepare(selection.retained
    ? `SELECT ${applicationTrashMetadataColumns}
         ${from}
         ${selection.where}
        ORDER BY ${deletedAtExpression} DESC, CAST(trash.key AS INTEGER) ASC
        LIMIT 1`
    : `SELECT ${applicationTrashMetadataColumns}
         ${from}
         ${selection.where}
        ORDER BY users.id ASC, CAST(trash.key AS INTEGER) ASC
        LIMIT 1`)
  const next = database.prepare(selection.retained
    ? `SELECT ${applicationTrashMetadataColumns}
         ${from}
         ${selection.where}
          AND (${deletedAtExpression} < ? OR (
            ${deletedAtExpression} = ? AND CAST(trash.key AS INTEGER) > ?
          ))
        ORDER BY ${deletedAtExpression} DESC, CAST(trash.key AS INTEGER) ASC
        LIMIT 1`
    : `SELECT ${applicationTrashMetadataColumns}
         ${from}
         ${selection.where}
          AND (users.id > ? OR (users.id = ? AND CAST(trash.key AS INTEGER) > ?))
        ORDER BY users.id ASC, CAST(trash.key AS INTEGER) ASC
        LIMIT 1`)
  let cursor = null
  let emitted = 0
  return () => {
    if (selection.retained && emitted >= selection.limit) return null
    const row = cursor
      ? selection.retained
        ? next.get(...selection.values, cursor.deletedAt, cursor.deletedAt, cursor.ordinal)
        : next.get(...selection.values, cursor.ownerId, cursor.ownerId, cursor.ordinal)
      : first.get(...selection.values)
    if (row) {
      emitted += 1
      cursor = {
        ownerId: row.owner_id,
        ordinal: Number(row.ordinal),
        deletedAt: String(row.deleted_at ?? ''),
      }
    }
    return row ?? null
  }
}

/**
 * Iterate application-trash entries without decoding each owning user's whole
 * settings document in JavaScript. JSON1 exposes one array element at a time.
 * The restart boundary is each entry's own identity — see
 * `applicationTrashFingerprintValues` for why it is deliberately not the
 * settings row version.
 */
export async function createScopedApplicationTrashSectionCursor(options = {}) {
  await ensureStorage()
  const selection = applicationTrashSectionSelection(options)
  const scanOptions = { signal: options.signal, onProgress: options.onProgress }
  const snapshot = await captureScopedSectionSnapshot({
    database: getDb(),
    section: 'application trash',
    scopeIdentity: selection.scopeIdentity,
    createMetadataReader: (target) => applicationTrashMetadataReader(target, selection),
    rowFingerprint: currentApplicationTrashFingerprint,
    ...scanOptions,
  })
  let releaseReservedPayloadMemory = scopedCursorPayloadReservation(
    snapshot,
    options.reservePayloadMemory === true,
  )
  const sharedPayloadMemoryReservation = options.sharedPayloadMemoryReservation ?? null
  const release = () => {
    releaseReservedPayloadMemory?.()
    releaseReservedPayloadMemory = null
  }

  async function validate() {
    const latest = await captureScopedSectionSnapshot({
      database: getDb(),
      section: 'application trash',
      scopeIdentity: selection.scopeIdentity,
      createMetadataReader: (target) => applicationTrashMetadataReader(target, selection),
      rowFingerprint: currentApplicationTrashFingerprint,
      ...scanOptions,
    })
    if (latest.count !== snapshot.count || latest.fingerprint !== snapshot.fingerprint) {
      throw scopedSectionChanged('application trash')
    }
  }

  async function * values() {
    const database = getDb()
    const nextMetadata = applicationTrashMetadataReader(database, selection)
    const readItem = database.prepare(
      `SELECT ${applicationTrashMetadataColumns}, trash.value AS payload_json
         FROM users
         JOIN json_each(users.settings_json, '$.applicationTrash') AS trash
        WHERE users.id = ? AND CAST(trash.key AS INTEGER) = ?
        LIMIT 1`,
    )
    const digest = createScopedSectionDigest('application trash', selection.scopeIdentity)
    const yieldState = { rows: 0, bytes: 0 }
    let yielded = 0
    try {
      for (;;) {
        const metadata = nextMetadata()
        if (!metadata) break
        const releaseMemory = releaseReservedPayloadMemory
          || scopedCursorHasSharedPayloadReservation(sharedPayloadMemoryReservation)
          ? null
          : acquireStoreHydrationMemory?.(
              scopedStoreReservationBytes(Number(metadata.payload_bytes) + 1024),
            ) ?? null
        try {
          const row = readItem.get(metadata.owner_id, metadata.ordinal)
          if (!row || !scopedSectionMetadataMatches(metadata, row, applicationTrashFingerprintValues)) {
            throw scopedSectionChanged('application trash')
          }
          if (yielded >= snapshot.count) throw scopedSectionChanged('application trash')
          digest.add(currentApplicationTrashFingerprint(metadata))
          const item = fromJson(row.payload_json, null)
          row.payload_json = ''
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw scopedSectionChanged('application trash')
          }
          yielded += 1
          yield { ownerId: metadata.owner_id, ordinal: Number(metadata.ordinal), item }
        } finally {
          releaseMemory?.()
        }
        await yieldScopedSectionScan(yieldState, metadata, scanOptions)
      }
      const streamed = digest.finish()
      if (streamed.count !== snapshot.count || streamed.fingerprint !== snapshot.fingerprint) {
        throw scopedSectionChanged('application trash')
      }
      await validate()
    } finally {
      release()
    }
  }

  return {
    count: snapshot.count,
    fingerprint: snapshot.fingerprint,
    payloadBytes: snapshot.payloadBytes,
    maxPayloadBytes: snapshot.maxPayloadBytes,
    values: values(),
    validate,
    release,
  }
}

export async function querySystemEvents(options = {}) {
  await ensureStorage()
  const database = getDb()
  const page = Math.max(0, Math.floor(Number(options.page) || 0))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options.pageSize) || 10)))
  const search = String(options.search ?? '').trim().toLowerCase()
  const scope = String(options.scope ?? '').trim()
  const actor = options.actor === 'admin' || options.actor === 'system' ? options.actor : 'all'
  const sortColumns = {
    time: 'time',
    scope: 'scope',
    message: 'message',
    actorId: 'actor_id',
  }
  const sortField = Object.hasOwn(sortColumns, options.sortField) ? options.sortField : 'time'
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC'
  const clauses = []
  const values = []

  if (scope && scope !== 'all') {
    clauses.push('scope = ?')
    values.push(scope)
  }
  if (actor === 'admin') clauses.push('actor_id IS NOT NULL')
  if (actor === 'system') clauses.push('actor_id IS NULL')
  if (search) {
    clauses.push(
      `LOWER(
        id || ' ' || time || ' ' || scope || ' ' ||
        COALESCE(actor_id, '') || ' ' || message || ' ' || metadata_json
      ) LIKE ?`,
    )
    values.push(`%${search}%`)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const retainedTotal = readMaintainedSystemEventCount(database)
  const total = where
    ? Number(database.prepare(`SELECT COUNT(*) AS count FROM system_events ${where}`).get(...values)?.count ?? 0)
    : retainedTotal
  const rows = database
    .prepare(
      `SELECT * FROM system_events
       ${where}
       ORDER BY ${sortColumns[sortField]} ${direction}, id ${direction}
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, page * pageSize)
  const scopes = database
    .prepare('SELECT DISTINCT scope FROM system_events WHERE scope <> ? ORDER BY scope ASC')
    .all('')
    .map((row) => row.scope)

  return {
    items: rows.map(eventFromRow),
    total,
    retainedTotal,
    page,
    pageSize,
    scopes,
  }
}

export async function iterateSystemEvents() {
  await ensureStorage()
  const rows = getDb()
    .prepare('SELECT * FROM system_events ORDER BY time DESC, id DESC')
    .iterate()
  return (function * mapSystemEventRows() {
    for (const row of rows) yield eventFromRow(row)
  })()
}

export async function countSystemEvents() {
  await ensureStorage()
  return readMaintainedSystemEventCount(getDb())
}

export async function clearSystemEvents() {
  await ensureStorage()
  return withWriteLock(async () => {
    const deleted = Number(getDb().prepare('DELETE FROM system_events').run().changes ?? 0)
    invalidateSharedStoreCache()
    await synchronizeExternalDatabase({ force: true })
    return deleted
  })
}

async function prepareWriteStorePayloadEncodings(database, writePlan, now) {
  const selectApplicationOutgoingDeliveries = database.prepare(
    `SELECT * FROM outgoing_mail_deliveries
     WHERE application_id = ? AND status IN ('sending', 'accepted', 'sent')`,
  )
  const applications = new Map()
  for (const application of writePlan.applications.upserts) {
    const normalized = { ...application, updatedAt: application.updatedAt ?? now }
    const staged = schoolLogoAssetForStorage(normalized)
    const rows = selectApplicationOutgoingDeliveries.all(normalized.id)
    const storageApplication = reconcileApplicationWithOutgoingDeliveryJournalRows(
      staged?.application ?? normalized,
      rows,
    )
    if (storageApplication.communications !== normalized.communications) {
      application.communications = storageApplication.communications
      normalized.communications = storageApplication.communications
      writePlan.nextBaseline.applications.set(application.id, contentFingerprint(application))
    }
    applications.set(application.id, {
      application,
      normalized,
      logoApplication: staged?.application ?? normalized,
      logoAsset: staged?.logoAsset ?? null,
      storageApplication,
      // Encoded here rather than inside the transaction so the write lock is
      // held only for the SQLite work. Deliberately the synchronous encoder:
      // routing this through the payload worker was measured and is slower at
      // every size that matters, because postMessage structure-clones the
      // object on this same thread before the worker sees it.
      //
      //   payload    sync block   worker block   worker total
      //   128 KiB       0.4ms        16.4ms         74.2ms
      //   512 KiB       1.0ms         2.0ms          5.3ms
      //     2 MiB       4.2ms         7.0ms         16.4ms
      //     8 MiB      17.9ms        33.0ms         68.5ms
      encodedPayload: encodePayloadForStorage(storageApplication),
      deliveryFingerprint: outgoingDeliveryRowsFingerprint(rows),
    })
  }
  const profileAssets = new Map()
  for (const asset of writePlan.profileAssets.upserts) {
    profileAssets.set(asset.id, {
      asset,
      encodedPayload: encodePayloadForStorage(asset),
    })
  }
  return { applications, profileAssets, selectApplicationOutgoingDeliveries }
}

function preparedApplicationInWriteTransaction({
  prepared,
  writePlan,
  upsertSchoolLogoAsset,
  selectApplicationOutgoingDeliveries,
}) {
  if (prepared.logoAsset) {
    upsertSchoolLogoAsset.run(
      prepared.logoAsset.assetKey,
      prepared.logoAsset.dataUrl,
      prepared.logoAsset.updatedAt,
    )
  }
  const rows = selectApplicationOutgoingDeliveries.all(prepared.normalized.id)
  if (outgoingDeliveryRowsFingerprint(rows) === prepared.deliveryFingerprint) {
    return {
      normalized: prepared.normalized,
      storageApplication: prepared.storageApplication,
      encodedPayload: prepared.encodedPayload,
    }
  }
  // A journal row changed after the async encoding snapshot. The transaction
  // cannot await a worker at this point, so re-encode synchronously from the
  // transaction-current row set instead of writing a stale payload.
  const storageApplication = reconcileApplicationWithOutgoingDeliveryJournalRows(
    prepared.logoApplication,
    rows,
  )
  if (storageApplication.communications !== prepared.normalized.communications) {
    prepared.application.communications = storageApplication.communications
    prepared.normalized.communications = storageApplication.communications
    writePlan.nextBaseline.applications.set(
      prepared.application.id,
      contentFingerprint(prepared.application),
    )
  }
  return {
    normalized: prepared.normalized,
    storageApplication,
    encodedPayload: encodePayloadForStorage(storageApplication),
  }
}

export async function readSchoolLogoCache(cacheKey) {
  if (!validSchoolLogoCacheKey(cacheKey)) return null
  await ensureStorage()
  const row = getDb()
    .prepare('SELECT * FROM school_logo_cache WHERE cache_key = ?')
    .get(cacheKey)
  return schoolLogoCacheEntryFromRow(row)
}

export async function readSchoolLogoAsset(assetKey) {
  if (!validSchoolLogoCacheKey(assetKey)) return null
  await ensureStorage()
  return getDb()
    .prepare('SELECT asset_key, data_url, updated_at FROM school_logo_assets WHERE asset_key = ?')
    .get(assetKey) ?? null
}

export function normalizeDiscoverSourceIndexScope(value) {
  const normalized = String(value ?? '').trim().slice(0, 160)
  return normalized || 'personal'
}

function normalizeDiscoverSourceIndexStorageEntry(entry, updatedAt = nowStamp()) {
  const userId = String(entry?.userId ?? '').trim()
  const scope = normalizeDiscoverSourceIndexScope(entry?.scope)
  if (!userId) return null
  if (entry?.delete === true) return { userId, scope, delete: true }
  const index = entry?.index
  if (!index || typeof index !== 'object' || Array.isArray(index)) return null
  const payloadJson = toJson(index)
  const payloadBytes = Buffer.byteLength(payloadJson, 'utf8')
  if (payloadBytes > DISCOVER_SOURCE_INDEX_MAX_BYTES) {
    const error = new Error(
      `Discover source index is ${payloadBytes} bytes; the limit is ${DISCOVER_SOURCE_INDEX_MAX_BYTES}.`,
    )
    error.code = 'DISCOVER_SOURCE_INDEX_TOO_LARGE'
    error.status = 413
    error.limitBytes = DISCOVER_SOURCE_INDEX_MAX_BYTES
    throw error
  }
  return {
    userId,
    scope,
    payloadJson,
    payloadBytes,
    updatedAt,
  }
}

export async function readDiscoverSourceIndex(userId, scope = 'personal') {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  if (!normalizedId) return null
  const row = getDb()
    .prepare(
      `SELECT payload_json
         FROM discover_source_indexes
        WHERE user_id = ? AND scope = ?`,
    )
    .get(normalizedId, normalizeDiscoverSourceIndexScope(scope))
  if (!row) return null
  try {
    const parsed = fromJson(row.payload_json, null)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function deleteDiscoverSourceIndex(userId, scope = 'personal') {
  await ensureStorage()
  const normalizedId = String(userId ?? '').trim()
  const normalizedScope = normalizeDiscoverSourceIndexScope(scope)
  if (!normalizedId) return null
  return withWriteLock(async () => {
    const result = getDb()
      .prepare('DELETE FROM discover_source_indexes WHERE user_id = ? AND scope = ?')
      .run(normalizedId, normalizedScope)
    invalidateSharedStoreCache()
    return Number(result.changes ?? 0)
  })
}

/**
 * The last admission-signal lookup for one application.
 *
 * Two megabytes is far more than the bounded collectors can produce, so
 * reaching it means something upstream stopped bounding. The write is refused
 * rather than allowed to grow a row nobody trims -- which is how the Discover
 * source index reached 8.7 MB inside a blob read on every login.
 */
const ADMISSION_SIGNAL_REPORT_MAX_BYTES = 2 * 1024 * 1024

export async function readAdmissionSignalReport(userId, applicationId) {
  await ensureStorage()
  const normalizedUserId = String(userId ?? '').trim()
  const normalizedApplicationId = String(applicationId ?? '').trim()
  if (!normalizedUserId || !normalizedApplicationId) return null
  const row = getDb()
    .prepare(
      `SELECT payload_json, updated_at
         FROM admission_signal_reports
        WHERE user_id = ? AND application_id = ?`,
    )
    .get(normalizedUserId, normalizedApplicationId)
  if (!row) return null
  const parsed = fromJson(row.payload_json, null)
  if (!parsed || typeof parsed !== 'object') return null
  return { ...parsed, savedAt: row.updated_at }
}

export async function writeAdmissionSignalReport(userId, applicationId, report) {
  await ensureStorage()
  const normalizedUserId = String(userId ?? '').trim()
  const normalizedApplicationId = String(applicationId ?? '').trim()
  if (!normalizedUserId || !normalizedApplicationId || !report) return null
  const payloadJson = toJson(report)
  const payloadBytes = Buffer.byteLength(payloadJson, 'utf8')
  if (payloadBytes > ADMISSION_SIGNAL_REPORT_MAX_BYTES) {
    const error = new Error('The admission signal report is too large to store.')
    error.code = 'ADMISSION_SIGNAL_REPORT_TOO_LARGE'
    error.status = 413
    throw error
  }
  const updatedAt = nowStamp()
  return withWriteLock(async () => {
    getDb()
      .prepare(
        `INSERT INTO admission_signal_reports (
           user_id, application_id, payload_json, payload_bytes, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, application_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           payload_bytes = excluded.payload_bytes,
           updated_at = excluded.updated_at`,
      )
      .run(normalizedUserId, normalizedApplicationId, payloadJson, payloadBytes, updatedAt)
    return { ...report, savedAt: updatedAt }
  }, { tenantKeys: [normalizedUserId] })
}

export async function deleteAdmissionSignalReport(userId, applicationId) {
  await ensureStorage()
  const normalizedUserId = String(userId ?? '').trim()
  const normalizedApplicationId = String(applicationId ?? '').trim()
  if (!normalizedUserId || !normalizedApplicationId) return 0
  return withWriteLock(async () => {
    const result = getDb()
      .prepare('DELETE FROM admission_signal_reports WHERE user_id = ? AND application_id = ?')
      .run(normalizedUserId, normalizedApplicationId)
    return Number(result.changes ?? 0)
  }, { tenantKeys: [normalizedUserId] })
}

/**
 * Keep the smaller admission-history/bookmark/settings tables behind the same
 * storage lifecycle and write serialization as the main report table. The
 * callback is intentionally scoped to this feature; HTTP routes must never
 * reach for an unowned SQLite handle.
 */
export async function withAdmissionSignalRead(callback) {
  await ensureStorage()
  if (typeof callback !== 'function') {
    throw new TypeError('Admission signal read callback is required.')
  }
  return callback(getDb())
}

export async function withAdmissionSignalWrite(userId, callback) {
  await ensureStorage()
  if (typeof callback !== 'function') {
    throw new TypeError('Admission signal write callback is required.')
  }
  const normalizedUserId = String(userId ?? '').trim()
  if (!normalizedUserId) {
    throw new TypeError('Admission signal write user id is required.')
  }
  return withWriteLock(
    async () => callback(getDb()),
    { tenantKeys: [normalizedUserId] },
  )
}

export async function writeSchoolLogoCache(entry) {
  if (!validSchoolLogoCacheKey(entry?.cacheKey) || !entry?.websiteUrl) return null
  if (
    entry.dataUrl
    && String(entry.dataUrl).length > MAX_SCHOOL_LOGO_CACHE_DATA_URL_LENGTH
  ) return null
  await ensureStorage()
  return withWriteLock(async () => {
    const updatedAt = entry.updatedAt ?? nowStamp()
    const database = getDb()
    database.prepare(
      `INSERT INTO school_logo_cache (
        cache_key,
        website_url,
        data_url,
        source_url,
        candidate_kind,
        found,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        website_url = excluded.website_url,
        data_url = excluded.data_url,
        source_url = excluded.source_url,
        candidate_kind = excluded.candidate_kind,
        found = excluded.found,
        updated_at = excluded.updated_at`,
    ).run(
      entry.cacheKey,
      entry.websiteUrl,
      entry.dataUrl ?? null,
      entry.sourceUrl ?? null,
      entry.candidateKind ?? null,
      entry.found ? 1 : 0,
      updatedAt,
    )
    database.prepare(
      `DELETE FROM school_logo_cache
       WHERE cache_key NOT IN (
         SELECT cache_key
         FROM school_logo_cache
         ORDER BY updated_at DESC
         LIMIT ?
       )`,
    ).run(MAX_SCHOOL_LOGO_CACHE_ENTRIES)
    invalidateSharedStoreCache()
    return { ...entry, updatedAt }
  })
}

async function writeStoreUnlocked(store, {
  systemMailJobs = [],
  notifications = [],
  deferExternalDatabaseSync = false,
  mailSyncContinuation = null,
  quotaReservationTokens = [],
  backupDeletionPlans = [],
  discoverSourceIndexes = [],
} = {}) {
  await fs.mkdir(storageRoot, { recursive: true })
  const database = getDb()
  const residentModeBeforeWrite = residentSnapshotStorageMode()
  const requestedMode = configuredSnapshotStorageMode(store.settings)
  // Enabling a snapshot mode must lower SQLite's page ceiling before any
  // helper or BEGIN IMMEDIATE write. Disabling keeps the old ceiling through
  // the final materialization so that transition itself cannot create an
  // oversized image, then getDb() restores SQLite's normal limit.
  const precommitSnapshotMode = snapshotModeEnabled(residentModeBeforeWrite)
    ? residentModeBeforeWrite
    : requestedMode
  const precommitSnapshotSettings = precommitSnapshotMode === 'external-whole-snapshot'
    && (
      activeEncryptionPolicy?.encryptionAtRest
      || store.settings?.encryptionAtRest
    )
    ? { encryptionAtRest: true }
    : activeEncryptionPolicy
  const snapshotCapacityBeforeWrite = applySnapshotStoragePageLimit(
    database,
    precommitSnapshotMode,
    precommitSnapshotSettings,
  )
  const now = nowStamp()
  const nextMeta = {
    ...(store.meta ?? {}),
    adapter: currentDatabaseAdapter(),
    updatedAt: now,
  }
  const writePlan = createStoreWritePlan(store)
  extendWritePlanTenantKeysForDeletes(database, writePlan)
  for (const tenantKey of writePlan.tenantKeys) {
    if (!writePlan.expectedTenantRevisions.has(tenantKey)) {
      writePlan.expectedTenantRevisions.set(tenantKey, readDurableTenantRevision(database, tenantKey))
    }
  }
  const normalizedBackupDeletionPlans = normalizeAccountBackupDeletionPlans(backupDeletionPlans)
  // Focused session/system projections deliberately omit durable settings.
  // Fail before quota repair or BEGIN IMMEDIATE if a legacy mutation attempts
  // to write one back as though it were a complete account snapshot.
  assertStoreDoesNotWriteFocusedSessionProjection(store, writePlan)
  const preparedPayloads = await prepareWriteStorePayloadEncodings(database, writePlan, now)
  for (const actorId of workspaceQuotaPersonalIdsForWrite(database, writePlan, store)) {
    await synchronizeWorkspaceBackupQuotaActor(actorId)
  }
  const storeScope = store?.[storeScopeSymbol] ?? null
  const createdNotifications = []
  let committedMailSyncContinuation = null
  const normalizedMailSyncContinuation = mailSyncContinuation
    ? normalizeMailSyncJobContinuation(mailSyncContinuation.value, { stamp: true })
    : null
  if (mailSyncContinuation && Object.keys(normalizedMailSyncContinuation).length === 0) {
    throw new TypeError('A valid mail sync continuation is required.')
  }
  const retentionCutoff = systemLogRetentionCutoff(store.settings.systemLogRetentionDays)
  const hasExpiredSystemEvents = Boolean(
    retentionCutoff
    && database.prepare('SELECT 1 FROM system_events WHERE time < ? LIMIT 1').get(retentionCutoff),
  )
  const hasOptionMutation = systemMailJobs.length > 0
    || notifications.length > 0
    || Boolean(normalizedMailSyncContinuation)
    || quotaReservationTokens.length > 0
    || normalizedBackupDeletionPlans.length > 0
    || discoverSourceIndexes.length > 0
  if (!storeWritePlanHasChanges(writePlan) && !hasOptionMutation && !hasExpiredSystemEvents) {
    return {
      createdNotifications: [],
      mailSyncContinuation: null,
      backupDeletions: { queued: 0, actorCounts: {} },
      unchanged: true,
    }
  }
  const automaticBackupEventIds = new Set(
    writePlan.systemEvents.upserts
      .map((event) => event.id)
      .filter(isAutomaticBackupEventId),
  )
  let committedTeams = null
  let committedQuotaReservationHashes = []
  let committedBackupDeletions = { queued: 0, actorCounts: {} }

  const transaction = database.transaction(() => {
    const baseRevision = readDurableWorkspaceRevision(database)
    for (const [tenantKey, expectedRevision] of writePlan.expectedTenantRevisions) {
      const currentRevision = readDurableTenantRevision(database, tenantKey)
      if (currentRevision !== expectedRevision) {
        throw storeRevisionConflict(expectedRevision, currentRevision, tenantKey)
      }
    }
    const existingUserIdsBeforeWrite = new Set(
      database.prepare('SELECT id FROM users').all().map((row) => row.id),
    )
    if (baseRevision >= MAX_WORKSPACE_REVISION) {
      throw new Error('The durable workspace revision has reached its safe integer limit.')
    }
    assertWorkspacePublicGrantCas(database, storeScope?.selector?.publicGrant)
    const quotaReservations = loadWorkspaceQuotaReservationsForCommit(
      database,
      quotaReservationTokens,
      writePlan,
    )
    const workspaceQuotaGuard = prepareWorkspaceQuotaMutationGuard(
      database,
      writePlan,
      quotaReservations,
    )

    if (writePlan.settingsChanged) {
      const currentSystemSettings = database
        .prepare('SELECT smtp_pass FROM system_settings WHERE id = ?')
        .get('global')
      database
      .prepare(
        `INSERT INTO system_settings (
          id,
          allow_registration,
          admin_entry_hidden,
          admin_entry_code_hash,
          admin_entry_code_salt,
          notification_mailbox,
          system_log_retention_days,
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
        VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          allow_registration = excluded.allow_registration,
          admin_entry_hidden = excluded.admin_entry_hidden,
          admin_entry_code_hash = excluded.admin_entry_code_hash,
          admin_entry_code_salt = excluded.admin_entry_code_salt,
          notification_mailbox = excluded.notification_mailbox,
          system_log_retention_days = excluded.system_log_retention_days,
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
            OR system_settings.admin_entry_hidden <> excluded.admin_entry_hidden
            OR system_settings.admin_entry_code_hash <> excluded.admin_entry_code_hash
            OR system_settings.admin_entry_code_salt <> excluded.admin_entry_code_salt
            OR system_settings.notification_mailbox <> excluded.notification_mailbox
            OR system_settings.system_log_retention_days <> excluded.system_log_retention_days
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
        boolInt(store.settings.adminEntryHidden),
        store.settings.adminEntryCodeHash ?? '',
        store.settings.adminEntryCodeSalt ?? '',
        store.settings.notificationMailbox,
        normalizeSystemLogRetentionDays(store.settings.systemLogRetentionDays) ?? 0,
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
    }

    const insertUser = database.prepare(
      `INSERT INTO users (
        id,
        name,
        email,
        canonical_email,
        recovery_email,
        language,
        role,
        password_hash,
        auth_version,
        created_at,
        last_login_at,
        disabled_at,
        settings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        canonical_email = excluded.canonical_email,
        recovery_email = excluded.recovery_email,
        language = excluded.language,
        role = excluded.role,
        password_hash = excluded.password_hash,
        auth_version = excluded.auth_version,
        created_at = excluded.created_at,
         last_login_at = excluded.last_login_at,
         disabled_at = excluded.disabled_at,
         settings_json = excluded.settings_json
       WHERE users.name <> excluded.name
          OR users.email <> excluded.email
          OR users.canonical_email <> excluded.canonical_email
          OR users.recovery_email <> excluded.recovery_email
          OR users.language <> excluded.language
          OR users.role <> excluded.role
          OR users.password_hash <> excluded.password_hash
          OR users.auth_version <> excluded.auth_version
          OR users.created_at <> excluded.created_at
          OR users.last_login_at IS NOT excluded.last_login_at
          OR users.disabled_at IS NOT excluded.disabled_at
          OR users.settings_json <> excluded.settings_json`,
    )
    const currentUserSettings = writePlan.fullReconcile
      ? new Map(
        database
          .prepare('SELECT id, settings_json FROM users')
          .all()
          .map((row) => [row.id, fromJson(row.settings_json)]),
      )
      : null
    const selectUserSettings = writePlan.fullReconcile
      ? null
      : database.prepare('SELECT settings_json FROM users WHERE id = ?')
    const storeUserIds = store.users.map((user) => user.id)
    for (const user of writePlan.users.upserts) {
      // In-memory settings always hold plaintext secrets (decrypted on load in userFromRow);
      // encrypt only in the object we serialize, never mutate the in-memory copy other code still uses.
      const storedSettings = writePlan.fullReconcile
        ? currentUserSettings.get(user.id) ?? {}
        : fromJson(selectUserSettings.get(user.id)?.settings_json)
      const projection = accountAuthProjection(user)
      const settingsForStorage = {
        ...user.settings,
        authVersion: projection.authVersion,
        smtpPass: encryptedSecretForWrite(storedSettings.smtpPass, user.settings?.smtpPass ?? ''),
        incomingPass: encryptedSecretForWrite(storedSettings.incomingPass, user.settings?.incomingPass ?? ''),
      }
      delete settingsForStorage.discoverSourceIndex
      insertUser.run(
        user.id,
        user.name,
        user.email,
        projection.canonicalEmail,
        projection.recoveryEmail,
        projection.language,
        normalizeUserRole(user.role),
        user.passwordHash,
        projection.authVersion,
        user.createdAt,
        user.lastLoginAt,
        user.disabledAt ?? null,
        toJson(settingsForStorage),
      )
      const quotaUserVersion = database.prepare(
        'SELECT settings_version FROM users WHERE id = ?',
      ).get(user.id)?.settings_version ?? 0
      syncWorkspaceQuotaUser(database, user, quotaUserVersion)
      replaceWorkspacePublicGrants(database, 'user', user, quotaUserVersion)
    }
    const upsertDiscoverSourceIndex = database.prepare(
      `INSERT INTO discover_source_indexes (
         user_id,
         scope,
         payload_json,
         payload_bytes,
         updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, scope) DO UPDATE SET
         payload_json = excluded.payload_json,
         payload_bytes = excluded.payload_bytes,
         updated_at = excluded.updated_at`,
    )
    const deleteDiscoverSourceIndexRow = database.prepare(
      'DELETE FROM discover_source_indexes WHERE user_id = ? AND scope = ?',
    )
    for (const entry of discoverSourceIndexes) {
      const normalized = normalizeDiscoverSourceIndexStorageEntry(entry)
      if (!normalized) continue
      if (normalized.delete) {
        deleteDiscoverSourceIndexRow.run(normalized.userId, normalized.scope)
      } else {
        upsertDiscoverSourceIndex.run(
          normalized.userId,
          normalized.scope,
          normalized.payloadJson,
          normalized.payloadBytes,
          normalized.updatedAt,
        )
      }
    }
    if (writePlan.fullReconcile) {
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
    } else {
      const deleteOwnedTeams = database.prepare('DELETE FROM teams WHERE owner_id = ?')
      const detachMembership = database.prepare('UPDATE team_members SET user_id = NULL WHERE user_id = ?')
      const deleteInvitations = database.prepare('DELETE FROM team_members WHERE invited_by = ?')
      const deleteUser = database.prepare('DELETE FROM users WHERE id = ?')
      for (const id of writePlan.users.deletedIds) {
        // Preserve the historical full-reconcile order and semantics: teams
        // owned by the deleted user disappear, memberships become invitations,
        // and invitations created by the deleted user are removed.
        deleteOwnedTeams.run(id)
        detachMembership.run(id)
        deleteInvitations.run(id)
        deleteUser.run(id)
        clearWorkspaceQuotaSource(database, 'user', id)
      }
    }
    const survivingUserIds = new Set(storeUserIds)
    const deletedUserIds = writePlan.fullReconcile
      ? [...existingUserIdsBeforeWrite].filter((id) => !survivingUserIds.has(id))
      : writePlan.users.deletedIds
    committedBackupDeletions = queueDeletedAccountBackupDeletions(
      database,
      deletedUserIds,
      normalizedBackupDeletionPlans,
    )

    const existingApplicationIds = writePlan.fullReconcile
      ? new Set(database.prepare('SELECT id FROM applications').all().map((row) => row.id))
      : null
    const upsertSchoolLogoAsset = database.prepare(
      `INSERT INTO school_logo_assets (
        asset_key,
        data_url,
        updated_at
      )
      VALUES (?, ?, ?)
      ON CONFLICT(asset_key) DO UPDATE SET
        updated_at = excluded.updated_at`,
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
        authored_hash,
        authority_hash,
        transfer_request_id,
        transfer_team_id,
        transfer_direction,
        transfer_status,
        transfer_requested_by,
        transfer_requested_at,
        transfer_incoming_bytes,
        payload_json,
        team_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        authored_hash = excluded.authored_hash,
        authority_hash = excluded.authority_hash,
        transfer_request_id = excluded.transfer_request_id,
        transfer_team_id = excluded.transfer_team_id,
        transfer_direction = excluded.transfer_direction,
        transfer_status = excluded.transfer_status,
        transfer_requested_by = excluded.transfer_requested_by,
        transfer_requested_at = excluded.transfer_requested_at,
        transfer_incoming_bytes = excluded.transfer_incoming_bytes,
        payload_json = excluded.payload_json,
        team_id = excluded.team_id
      WHERE applications.payload_json <> excluded.payload_json
         OR applications.authored_hash <> excluded.authored_hash
         OR applications.authority_hash <> excluded.authority_hash
         OR applications.transfer_request_id IS NOT excluded.transfer_request_id
         OR applications.transfer_team_id IS NOT excluded.transfer_team_id
         OR applications.transfer_direction IS NOT excluded.transfer_direction
         OR applications.transfer_status IS NOT excluded.transfer_status
         OR applications.transfer_requested_by IS NOT excluded.transfer_requested_by
         OR applications.transfer_requested_at IS NOT excluded.transfer_requested_at
         OR applications.transfer_incoming_bytes <> excluded.transfer_incoming_bytes
         OR applications.owner_id <> excluded.owner_id
         OR applications.team_id IS NOT excluded.team_id`,
    )
    const outgoingMailSyncStatements = prepareOutgoingMailDeliverySyncStatements(database)
    const nextApplicationIds = writePlan.fullReconcile ? new Set() : null
    for (const application of writePlan.applications.upserts) {
      const preparedApplication = preparedPayloads.applications.get(application.id)
      if (!preparedApplication) throw new Error('Prepared application payload is missing.')
      const { normalized, storageApplication, encodedPayload } = preparedApplicationInWriteTransaction({
        prepared: preparedApplication,
        writePlan,
        upsertSchoolLogoAsset,
        selectApplicationOutgoingDeliveries: preparedPayloads.selectApplicationOutgoingDeliveries,
      })
      nextApplicationIds?.add(normalized.id)
      const transferIndex = pendingTeamTransferIndexFields(storageApplication)
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
        applicationAuthoredContentHash(storageApplication),
        JSON.stringify(applicationAuthorityContentHashes(normalized)),
        transferIndex.requestId,
        transferIndex.teamId,
        transferIndex.direction,
        transferIndex.status,
        transferIndex.requestedBy,
        transferIndex.requestedAt,
        transferIndex.incomingBytes,
        encodedPayload,
        normalized.teamId ?? null,
      )
      const quotaApplicationVersion = database.prepare(
        'SELECT payload_version FROM applications WHERE id = ?',
      ).get(normalized.id)?.payload_version ?? 0
      syncWorkspaceQuotaApplication(database, storageApplication, quotaApplicationVersion)
      replaceWorkspaceFileReferences(
        database,
        'application',
        storageApplication,
        quotaApplicationVersion,
      )
      replaceWorkspacePublicGrants(
        database,
        'application',
        storageApplication,
        quotaApplicationVersion,
      )
      syncOutgoingMailDeliveriesForApplication(
        database,
        storageApplication,
        now,
        outgoingMailSyncStatements,
      )
    }
    const deleteApplication = database.prepare('DELETE FROM applications WHERE id = ?')
    if (writePlan.fullReconcile) {
      for (const id of existingApplicationIds) {
        if (!nextApplicationIds.has(id)) {
          deleteApplication.run(id)
          clearWorkspaceQuotaSource(database, 'application', id)
        }
      }
    } else {
      for (const id of writePlan.applications.deletedIds) {
        deleteApplication.run(id)
        clearWorkspaceQuotaSource(database, 'application', id)
      }
    }

    const existingAssetIds = writePlan.fullReconcile
      ? new Set(database.prepare('SELECT id FROM profile_assets').all().map((row) => row.id))
      : null
    const upsertAsset = database.prepare(
      `INSERT INTO profile_assets (
        id,
        owner_id,
        team_id,
        name,
        kind,
        updated_at,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        team_id = excluded.team_id,
        name = excluded.name,
        kind = excluded.kind,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
      WHERE profile_assets.payload_json <> excluded.payload_json
         OR profile_assets.owner_id <> excluded.owner_id
         OR COALESCE(profile_assets.team_id, '') <> COALESCE(excluded.team_id, '')`,
    )
    const nextAssetIds = writePlan.fullReconcile ? new Set() : null
    for (const asset of writePlan.profileAssets.upserts) {
      const preparedAsset = preparedPayloads.profileAssets.get(asset.id)
      if (!preparedAsset) throw new Error('Prepared profile asset payload is missing.')
      nextAssetIds?.add(asset.id)
      upsertAsset.run(
        asset.id,
        asset.ownerId,
        asset.teamId ?? null,
        asset.name,
        asset.kind,
        asset.updatedAt ?? now,
        preparedAsset.encodedPayload,
      )
      const quotaProfileVersion = database.prepare(
        'SELECT payload_version FROM profile_assets WHERE id = ?',
      ).get(asset.id)?.payload_version ?? 0
      syncWorkspaceQuotaProfileAsset(database, asset, quotaProfileVersion)
      replaceWorkspaceFileReferences(database, 'profile', asset, quotaProfileVersion)
      replaceWorkspacePublicGrants(database, 'profile', asset, quotaProfileVersion)
    }
    const deleteAsset = database.prepare('DELETE FROM profile_assets WHERE id = ?')
    if (writePlan.fullReconcile) {
      for (const id of existingAssetIds) {
        if (!nextAssetIds.has(id)) {
          deleteAsset.run(id)
          clearWorkspaceQuotaSource(database, 'profile', id)
        }
      }
    } else {
      for (const id of writePlan.profileAssets.deletedIds) {
        deleteAsset.run(id)
        clearWorkspaceQuotaSource(database, 'profile', id)
      }
    }

    appendSystemEventsUnlocked(database, writePlan.systemEvents.upserts)
    if (retentionCutoff) {
      database.prepare('DELETE FROM system_events WHERE time < ?').run(retentionCutoff)
    }
    for (const job of systemMailJobs) {
      insertSystemMailJob(database, job)
    }
    for (const notification of notifications) {
      const created = insertNotificationRow(
        database,
        notification.userId,
        notification.candidate,
      )
      if (created) createdNotifications.push(created)
    }
    if (normalizedMailSyncContinuation) {
      const updated = database.prepare(
        `UPDATE mail_fetch_state
         SET sync_job_resume_json = ?
         WHERE user_id = ? AND sync_job_id = ? AND sync_job_status = 'running'`,
      ).run(
        toJson(normalizedMailSyncContinuation),
        mailSyncContinuation.userId,
        mailSyncContinuation.jobId,
      )
      if (updated.changes > 0) committedMailSyncContinuation = normalizedMailSyncContinuation
    }
    pruneWorkspaceQuotaSources(database)
    queueUnreferencedWorkspaceUploadDeletions(
      database,
      workspaceQuotaGuard.deletionCandidates,
    )
    verifyCommittedWorkspaceQuotaReservations(database, quotaReservations)
    const reservationHashes = quotaReservations.map((reservation) => reservation.token_hash)
    assertWorkspaceQuotaMutation(database, workspaceQuotaGuard, reservationHashes)
    consumeWorkspaceQuotaReservations(database, quotaReservations)
    committedQuotaReservationHashes = reservationHashes
    for (const tenantKey of writePlan.tenantKeys) {
      writePlan.nextBaseline.tenantRevisions.set(
        tenantKey,
        bumpDurableTenantRevision(database, tenantKey),
      )
    }
    // Row triggers remain authoritative for focused SQL helpers, but a single
    // full-store transaction is one logical mutation regardless of how many
    // entity rows it touched. Normalize their intermediate increments back to
    // exactly base + 1 before publishing app_meta or an external snapshot.
    nextMeta.revision = baseRevision + 1
    const revisionUpdate = database
      .prepare(`UPDATE ${WORKSPACE_REVISION_TABLE} SET revision = ? WHERE id = ?`)
      .run(nextMeta.revision, WORKSPACE_REVISION_ROW_ID)
    if (Number(revisionUpdate.changes ?? 0) !== 1) {
      throw new Error('The durable workspace revision row is missing.')
    }
    database
      .prepare(
        `INSERT INTO app_meta (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run('version', toJson(nextMeta))
    committedTeams = storeScope
      ? teamsFromDatabaseByIds(database, storeScope.teamIds)
      : teamsFromDatabase(database)
  })

  // BEGIN IMMEDIATE acquires SQLite's write reservation before the revision
  // check. A cross-process writer therefore either commits first (and yields a
  // structured stale-baseline 409) or waits until this transaction completes.
  try {
    transaction.immediate()
  } catch (error) {
    if (precommitSnapshotMode !== residentModeBeforeWrite) {
      applySnapshotStoragePageLimit(database, residentModeBeforeWrite)
    }
    throw normalizeSqliteFullAsSnapshotCapacity(error, snapshotCapacityBeforeWrite)
  }
  for (const tokenHash of committedQuotaReservationHashes) {
    forgetActiveWorkspaceQuotaReservation(tokenHash)
  }
  // A workspace with more automatic-backup streams than the 500-row resident
  // audit window can legitimately update a deterministic event that was not in
  // memory. Rehydrate just those rows so the cache/baseline acknowledges the
  // database-side occurrence roll-up exactly.
  for (const id of automaticBackupEventIds) {
    const canonicalRow = database.prepare('SELECT * FROM system_events WHERE id = ?').get(id)
    if (!canonicalRow) continue
    const canonicalEvent = eventFromRow(canonicalRow)
    const index = store.systemEvents.findIndex((event) => event.id === id)
    if (index >= 0) store.systemEvents[index] = canonicalEvent
    writePlan.nextBaseline.systemEvents.set(id, contentFingerprint(canonicalEvent))
  }
  // Authenticated GET requests share this immutable-by-convention snapshot. Every
  // full-store write replaces it, while SQLite data_version invalidates it when a
  // second process changes the database. This prevents parallel bootstrap requests
  // from reparsing every application payload on the Node.js main thread.
  store.meta = nextMeta
  store.teams = committedTeams ?? teamsFromDatabase(database)
  store.systemEvents = (store.systemEvents ?? []).slice(0, SYSTEM_EVENT_WORKING_SET_LIMIT)
  if (retentionCutoff) {
    store.systemEvents = store.systemEvents.filter((event) => event.time >= retentionCutoff)
  }
  const retainedEventIds = new Set(store.systemEvents.map((event) => event.id))
  for (const id of writePlan.nextBaseline.systemEvents.keys()) {
    if (!retainedEventIds.has(id)) writePlan.nextBaseline.systemEvents.delete(id)
  }
  writePlan.nextBaseline.revision = nextMeta.revision
  attachStoreBaseline(store, writePlan.nextBaseline)
  // Sample data_version before the durable revision. If another process
  // committed before either read, the revision mismatch prevents publication;
  // if it commits afterwards, the next cache lookup observes a newer
  // data_version and invalidates this snapshot.
  const committedDataVersion = databaseDataVersion(database)
  if (storeScope) {
    invalidateSharedStoreCache()
  } else if (readDurableWorkspaceRevision(database) === nextMeta.revision) {
    sharedStoreCache = store
    sharedStoreDataVersion = committedDataVersion
  } else {
    invalidateSharedStoreCache()
  }
  // A tenant-scoped write may have been created before a queued global
  // settings transition. Its stale projection must not roll the process-wide
  // encryption policy back when the write plan does not own system settings.
  if (writePlan.settingsChanged) applyEncryptionPolicyFromSettings(store.settings)
  const shouldUseMemory = databaseShouldRunInMemory()
  // Mail batches release their parser/source reservation before the explicit
  // lock-free flush. Mode transitions are still immediate; a stable encrypted
  // mode defers only the expensive seal/snapshot itself.
  if (!deferExternalDatabaseSync || shouldUseMemory !== databaseRunsInMemory) {
    await reconcileSqliteEncryptionMode()
  }
  // Full-store writes are the primary synchronization boundary: wait for the
  // remote commit so successful API mutations are durable in the selected
  // engine. The mail worker may defer only this external snapshot to its
  // immediately following continuation write, which acknowledges business
  // data and checkpoint together and avoids transmitting the full DB twice.
  if (!deferExternalDatabaseSync) {
    await synchronizeExternalDatabase({ force: true })
  }
  return {
    createdNotifications,
    mailSyncContinuation: committedMailSyncContinuation,
    backupDeletions: committedBackupDeletions,
  }
}

export async function writeStore(store, options = {}) {
  assertDatabaseAccessAllowed()
  return writeStoreWithRetry(store, options, 0)
}

const MAX_STORE_WRITE_RETRIES = 3

function retryableStoreWriteConflict(error) {
  if (error?.code !== 'STORE_WRITE_CONFLICT') return false
  return Boolean(error?.tenantKey)
    || String(error?.entityType ?? '').includes('tenant revision')
    || error?.entityType === 'workspace revision'
}

function storeWriteRetryDelayMs(attempt) {
  const baseMs = 5 * (2 ** attempt)
  return baseMs / 2 + Math.floor(Math.random() * baseMs)
}

async function readLatestStoreForWrite(store) {
  const scope = store?.[storeScopeSymbol]
  if (scope?.kind === 'mail-sync') {
    return readMailSyncStore(scope.userId, { retainMemoryReservation: false })
  }
  if (scope?.userId) {
    return readScopedStore(scope.userId, {
      ...(scope.selector ?? {}),
      actorId: scope.actorId,
      retainMemoryReservation: false,
    })
  }
  return readStore()
}

async function writeStoreWithRetry(store, options, attempt) {
  const baseline = store?.[storeBaselineSymbol]
  const scope = store?.[storeScopeSymbol]
  try {
    return await withWriteLock(
      () => writeStoreUnlocked(store, options),
      { tenantKeys: tenantKeysForWriteStore(store) },
    )
  } catch (error) {
    if (!retryableStoreWriteConflict(error) || attempt >= MAX_STORE_WRITE_RETRIES) throw error
    await sleep(storeWriteRetryDelayMs(attempt))
    const latest = await readLatestStoreForWrite(store)
    const latestBaseline = latest?.[storeBaselineSymbol]
    const merged = mergeStoreChanges(latest, store, baseline)
    attachStoreBaseline(merged, latestBaseline)
    if (scope) attachStoreScope(merged, scope)
    const result = await writeStoreWithRetry(merged, options, attempt + 1)
    Object.assign(store, merged)
    attachStoreBaseline(store, merged[storeBaselineSymbol])
    if (scope) attachStoreScope(store, scope)
    return result
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  const rewrapPayloadAsync = async (payloadJson) => {
    if (!payloadJson) return payloadJson
    let plainText = payloadJson
    if (isEncryptedPayload(payloadJson)) {
      const body = payloadJson.slice('payload:'.length)
      plainText = recoverPlain(body) || decryptPayload(payloadJson)
      if (!plainText) return payloadJson
    }
    // Rewrapping runs ahead of the transaction so the write lock covers only
    // SQLite. The encoder stays synchronous for the reason recorded above the
    // application encode: the worker hop costs more than the work it moves.
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
    const residentModeBeforeWrite = residentSnapshotStorageMode()
    const requestedMode = nextSettings
      ? configuredSnapshotStorageMode(nextSettings)
      : residentModeBeforeWrite
    const precommitSnapshotMode = snapshotModeEnabled(residentModeBeforeWrite)
      ? residentModeBeforeWrite
      : requestedMode
    const precommitSnapshotSettings = precommitSnapshotMode === 'external-whole-snapshot'
      && (
        activeEncryptionPolicy?.encryptionAtRest
        || nextSettings?.encryptionAtRest
      )
      ? { encryptionAtRest: true }
      : activeEncryptionPolicy
    const snapshotCapacityBeforeWrite = applySnapshotStoragePageLimit(
      database,
      precommitSnapshotMode,
      precommitSnapshotSettings,
    )
    const applicationPayloadRows = database.prepare(
      'SELECT id, payload_json FROM applications',
    ).all()
    const profileAssetPayloadRows = database.prepare(
      'SELECT id, payload_json FROM profile_assets',
    ).all()
    const preparedApplicationPayloads = new Map()
    for (const row of applicationPayloadRows) {
      preparedApplicationPayloads.set(row.id, {
        before: row.payload_json,
        after: await rewrapPayloadAsync(row.payload_json),
      })
    }
    const preparedProfileAssetPayloads = new Map()
    for (const row of profileAssetPayloadRows) {
      preparedProfileAssetPayloads.set(row.id, {
        before: row.payload_json,
        after: await rewrapPayloadAsync(row.payload_json),
      })
    }
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

      for (const [id, prepared] of preparedApplicationPayloads) {
        const current = database.prepare('SELECT payload_json FROM applications WHERE id = ?')
          .get(id)?.payload_json
        if (current === undefined) continue
        const encoded = current === prepared.before
          ? prepared.after
          : rewrapPayload(current)
        database.prepare('UPDATE applications SET payload_json = ? WHERE id = ?')
          .run(encoded, id)
      }
      for (const [id, prepared] of preparedProfileAssetPayloads) {
        const current = database.prepare('SELECT payload_json FROM profile_assets WHERE id = ?')
          .get(id)?.payload_json
        if (current === undefined) continue
        const encoded = current === prepared.before
          ? prepared.after
          : rewrapPayload(current)
        database.prepare('UPDATE profile_assets SET payload_json = ? WHERE id = ?')
          .run(encoded, id)
      }
      for (const row of database.prepare('SELECT id, payload_encrypted FROM system_mail_jobs').all()) {
        if (!row.payload_encrypted) continue
        let plainText = row.payload_encrypted
        if (isEncryptedPayload(row.payload_encrypted)) {
          const body = row.payload_encrypted.slice('payload:'.length)
          plainText = recoverPlain(body) || decryptPayload(row.payload_encrypted)
        }
        database.prepare('UPDATE system_mail_jobs SET payload_encrypted = ? WHERE id = ?')
          .run(encryptPayload(plainText), row.id)
      }
      for (const row of database.prepare(
        'SELECT communication_id, communication_encrypted FROM outgoing_mail_deliveries',
      ).all()) {
        if (!row.communication_encrypted) continue
        let plainText = row.communication_encrypted
        if (isEncryptedPayload(row.communication_encrypted)) {
          const body = row.communication_encrypted.slice('payload:'.length)
          plainText = recoverPlain(body) || decryptPayload(row.communication_encrypted)
        }
        database.prepare(
          `UPDATE outgoing_mail_deliveries
           SET communication_encrypted = ? WHERE communication_id = ?`,
        ).run(encryptPayload(plainText), row.communication_id)
      }

      // Interview preparation text is always payload-encrypted independently
      // of the global at-rest preference. Re-wrap every aggregate payload under
      // the already-activated runtime profile so an algorithm/password rotation
      // cannot strand interview drafts under the previous key.
      for (const table of [
        'interview_workspaces',
        'interview_events',
        'interview_questions',
        'interview_sessions',
        'interview_feedback',
      ]) {
        for (const row of database.prepare(`SELECT rowid, payload_encrypted FROM ${table}`).all()) {
          if (!row.payload_encrypted) continue
          let plainText = row.payload_encrypted
          if (isEncryptedPayload(row.payload_encrypted)) {
            const body = row.payload_encrypted.slice('payload:'.length)
            plainText = recoverPlain(body) || decryptPayload(row.payload_encrypted)
          }
          if (!plainText || isEncryptedPayload(plainText)) {
            throw interviewStorageError(
              'INTERVIEW_STORAGE_DECRYPT_FAILED',
              'Interview preparation data could not be re-encrypted.',
              500,
            )
          }
          database.prepare(`UPDATE ${table} SET payload_encrypted = ? WHERE rowid = ?`)
            .run(encryptPayload(plainText), row.rowid)
        }
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

    try {
      transaction()
    } catch (error) {
      if (precommitSnapshotMode !== residentModeBeforeWrite) {
        applySnapshotStoragePageLimit(database, residentModeBeforeWrite)
      }
      throw normalizeSqliteFullAsSnapshotCapacity(error, snapshotCapacityBeforeWrite)
    }
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
  const candidate = typeof metadata?.createdAt === 'string' ? metadata.createdAt.trim() : ''
  if (candidate && Number.isFinite(new Date(candidate).getTime())) return candidate
  const fallback = Number(stat.birthtimeMs) > 0 ? stat.birthtime : stat.mtime
  return fallback.toISOString()
}

function backupMetadataPath(fileName) {
  return path.join(backupRoot, `${fileName}${BACKUP_METADATA_SUFFIX}`)
}

function invalidateBackupListCache(fileName) {
  backupListCacheGeneration += 1
  if (fileName) {
    backupInfoCache.delete(fileName)
  } else {
    backupInfoCache.clear()
  }
}

function setBackupInfoCache(fileName, value) {
  backupInfoCache.delete(fileName)
  backupInfoCache.set(fileName, value)
  while (backupInfoCache.size > BACKUP_INDEX_INFO_CACHE_LIMIT) {
    const oldest = backupInfoCache.keys().next().value
    if (oldest === undefined) break
    backupInfoCache.delete(oldest)
  }
}

function getCachedBackupInfo(fileName, stat, { readLegacy = false } = {}) {
  const cached = backupInfoCache.get(fileName)
  if (
    !cached
    || cached.sourceSize !== stat.size
    || cached.sourceMtimeMs !== stat.mtimeMs
    || (readLegacy && cached.metadataState === 'pending')
  ) return null
  // Map insertion order provides a zero-dependency LRU without retaining an
  // unbounded second list of backup names.
  backupInfoCache.delete(fileName)
  backupInfoCache.set(fileName, cached)
  return cached
}

function backupInfoFromMetadata(fileName, stat, metadata, applicationName) {
  return {
    fileName,
    size: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    createdAt: backupCreatedAt(metadata, stat),
    actorId: metadata?.actorId ?? null,
    applicationId: metadata?.applicationId ?? null,
    applicationName,
    kind: metadata?.kind ?? (metadata?.applicationId ? 'application' : 'workspace'),
  }
}

function backupInfoFromIndexRow(row) {
  return {
    fileName: row.file_name,
    size: Number(row.source_size),
    sourceMtimeMs: Number(row.source_mtime_ms),
    createdAt: row.created_at,
    actorId: row.actor_id ?? null,
    applicationId: row.application_id ?? null,
    applicationName: row.application_name ?? undefined,
    kind: row.kind,
  }
}

function getBackupIndexDatabase() {
  if (backupIndexDatabase) return backupIndexDatabase
  const indexPath = path.join(backupRoot, BACKUP_INDEX_FILE_NAME)
  const database = new Database(indexPath)
  try {
    database.pragma('busy_timeout = 5000')
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = NORMAL')
    database.exec(`
      CREATE TABLE IF NOT EXISTS backup_metadata_index (
        file_name TEXT PRIMARY KEY,
        source_size INTEGER NOT NULL,
        source_mtime_ms REAL NOT NULL,
        created_at TEXT NOT NULL,
        actor_id TEXT,
        application_id TEXT,
        application_name TEXT,
        kind TEXT NOT NULL,
        metadata_state TEXT NOT NULL DEFAULT 'complete',
        indexed_at TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_backup_metadata_actor_created
        ON backup_metadata_index(actor_id, created_at DESC, file_name DESC);
      CREATE INDEX IF NOT EXISTS idx_backup_metadata_application_created
        ON backup_metadata_index(actor_id, application_id, created_at DESC, file_name DESC);
      CREATE INDEX IF NOT EXISTS idx_backup_metadata_kind_created
        ON backup_metadata_index(kind, created_at DESC, file_name DESC);
      CREATE INDEX IF NOT EXISTS idx_backup_metadata_state_created
        ON backup_metadata_index(metadata_state, created_at DESC, file_name DESC);

      CREATE TABLE IF NOT EXISTS backup_index_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS backup_index_scan_entries (
        scan_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        PRIMARY KEY (scan_id, file_name)
      ) WITHOUT ROWID;
    `)
    database.prepare('DELETE FROM backup_index_scan_entries WHERE started_at < ?')
      .run(new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString())
  } catch (error) {
    try {
      database.close()
    } catch {
      // Preserve the original schema/open error.
    }
    throw error
  }
  backupIndexDatabase = database
  void fs.chmod(indexPath, 0o600).catch(() => undefined)
  return database
}

function upsertBackupIndexInfo(database, stat, info, metadataState = 'complete') {
  database.prepare(`
    INSERT INTO backup_metadata_index (
      file_name, source_size, source_mtime_ms, created_at, actor_id,
      application_id, application_name, kind, metadata_state, indexed_at
    ) VALUES (
      @fileName, @sourceSize, @sourceMtimeMs, @createdAt, @actorId,
      @applicationId, @applicationName, @kind, @metadataState, @indexedAt
    )
    ON CONFLICT(file_name) DO UPDATE SET
      source_size = excluded.source_size,
      source_mtime_ms = excluded.source_mtime_ms,
      created_at = excluded.created_at,
      actor_id = excluded.actor_id,
      application_id = excluded.application_id,
      application_name = excluded.application_name,
      kind = excluded.kind,
      metadata_state = excluded.metadata_state,
      indexed_at = excluded.indexed_at
  `).run({
    fileName: info.fileName,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    createdAt: String(info.createdAt),
    actorId: info.actorId ?? null,
    applicationId: info.applicationId ?? null,
    applicationName: info.applicationName ?? null,
    kind: String(info.kind || 'workspace'),
    metadataState,
    indexedAt: nowStamp(),
  })
}

function deleteBackupIndexInfo(fileName) {
  if (!backupIndexDatabase) return
  backupIndexDatabase.prepare('DELETE FROM backup_metadata_index WHERE file_name = ?').run(fileName)
}

async function readFilePrefix(filePath, maximumBytes) {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const capacity = Math.max(1, Math.min(maximumBytes + 1, stat.size + 1))
    const buffer = Buffer.allocUnsafe(capacity)
    let offset = 0
    while (offset < capacity) {
      const { bytesRead } = await handle.read(buffer, offset, capacity - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return {
      text: buffer.subarray(0, Math.min(offset, maximumBytes)).toString('utf8'),
      truncated: stat.size > maximumBytes || offset > maximumBytes,
      size: stat.size,
    }
  } finally {
    await handle.close()
  }
}

async function readBoundedJsonFile(filePath, maximumBytes) {
  const prefix = await readFilePrefix(filePath, maximumBytes)
  if (prefix.truncated) {
    const error = new Error('Backup metadata sidecar exceeds its bounded read limit.')
    error.code = 'BACKUP_METADATA_TOO_LARGE'
    throw error
  }
  return JSON.parse(prefix.text.replace(/^\uFEFF/, ''))
}

function extractLeadingBackupMetadata(text) {
  const match = /^\uFEFF?\s*\{\s*"backup"\s*:\s*\{/u.exec(text)
  if (!match) return null
  const objectStart = match.index + match[0].lastIndexOf('{')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = objectStart; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character !== '}') continue
    depth -= 1
    if (depth !== 0) continue
    try {
      return JSON.parse(text.slice(objectStart, index + 1))
    } catch {
      return null
    }
  }
  return null
}

async function readLegacyBackupMetadata(filePath) {
  const prefix = await readFilePrefix(filePath, BACKUP_INDEX_LEGACY_PREFIX_BYTES)
  if (!prefix.truncated) {
    const parsed = JSON.parse(prefix.text.replace(/^\uFEFF/, ''))
    return {
      metadata: parsed?.backup ?? null,
      applicationName: parsed?.backup?.applicationName ?? parsed?.application?.school?.name,
    }
  }
  const metadata = extractLeadingBackupMetadata(prefix.text)
  return {
    metadata,
    applicationName: metadata?.applicationName,
  }
}

async function readBackupSidecar(fileName, stat) {
  try {
    const sidecar = await readBoundedJsonFile(
      backupMetadataPath(fileName),
      BACKUP_INDEX_LEGACY_PREFIX_BYTES,
    )
    if (sidecar.sourceSize !== stat.size || sidecar.sourceMtimeMs !== stat.mtimeMs) return null
    if (!sidecar.metadata || typeof sidecar.metadata !== 'object') return null
    return {
      metadata: sidecar.metadata,
      applicationName: sidecar.applicationName ?? undefined,
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'BACKUP_METADATA_TOO_LARGE') return null
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function fallbackBackupMetadata(fileName, stat) {
  const application = fileName.endsWith('.json') && fileName.startsWith('phd-atlas-app-')
  return {
    metadata: {
      kind: application ? 'application' : 'workspace',
      createdAt: backupCreatedAt(null, stat),
      actorId: application ? null : 'system',
      applicationId: null,
    },
    applicationName: undefined,
  }
}

async function writeBackupStageMetadata(fileName, stat, metadata, applicationName) {
  const target = backupStageMetadataPath(fileName)
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
  const payload = {
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    metadata,
    applicationName: applicationName ?? null,
  }
  try {
    await fs.writeFile(temporary, JSON.stringify(payload), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    await replaceFileAtomic(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function writeBackupMetadata(fileName, stat, metadata, applicationName) {
  const payload = {
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    metadata,
    applicationName: applicationName ?? null,
  }
  const target = backupMetadataPath(fileName)
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await replaceFileAtomic(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  const info = backupInfoFromMetadata(fileName, stat, metadata, applicationName)
  upsertBackupIndexInfo(getBackupIndexDatabase(), stat, info, 'complete')
  setBackupInfoCache(fileName, {
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    metadataState: 'complete',
    info,
  })
}

async function readBackupInfo(entry, options = {}) {
  const fileName = typeof entry === 'string' ? entry : entry.name
  const filePath = path.join(backupRoot, fileName)
  const stat = options.stat ?? await fs.stat(filePath)
  const cached = getCachedBackupInfo(fileName, stat, options)
  if (cached) return { info: cached.info, stat, metadataState: cached.metadataState }

  let resolved = await readBackupSidecar(fileName, stat)
  let metadataState = resolved ? 'complete' : 'fallback'
  if (!resolved && fileName.endsWith('.json')) {
    if (options.readLegacy) {
      try {
        resolved = await readLegacyBackupMetadata(filePath)
        metadataState = resolved?.metadata ? 'complete' : 'unavailable'
        if (resolved?.metadata) {
          await writeBackupMetadata(
            fileName,
            stat,
            resolved.metadata,
            resolved.applicationName,
          ).catch(() => undefined)
        }
      } catch {
        resolved = null
        metadataState = 'unavailable'
      }
    } else {
      metadataState = 'pending'
    }
  }
  resolved ??= fallbackBackupMetadata(fileName, stat)

  const info = backupInfoFromMetadata(fileName, stat, resolved.metadata, resolved.applicationName)
  setBackupInfoCache(fileName, {
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    metadataState,
    info,
  })
  return { info, stat, metadataState }
}

async function readBackupInfoIfPresent(entry, options = {}) {
  try {
    return await readBackupInfo(entry, options)
  } catch (error) {
    // A cleanup/prune job (or another server process) can remove an archive
    // after readdir() has captured its name. Listing backups must remain a
    // best-effort read and never turn an otherwise valid login into a 500.
    if (error?.code === 'ENOENT') {
      backupInfoCache.delete(typeof entry === 'string' ? entry : entry.name)
      return null
    }
    throw error
  }
}

async function backupDirectoryStamp() {
  const directoryStat = await fs.stat(backupRoot)
  return `${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`
}

async function backupDirectoryInventory() {
  const aggregate = Buffer.alloc(32)
  let count = 0
  const include = async (entries) => {
    const rows = await Promise.all(entries.map(async (entry) => {
      try {
        const stat = await fs.stat(path.join(backupRoot, entry.name))
        return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs }
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    }))
    for (const row of rows) {
      if (!row) continue
      const digest = createHash('sha256')
        .update(row.name, 'utf8')
        .update('\0', 'utf8')
        .update(String(row.size), 'utf8')
        .update('\0', 'utf8')
        .update(String(row.mtimeMs), 'utf8')
        .digest()
      for (let index = 0; index < aggregate.length; index += 1) aggregate[index] ^= digest[index]
      count += 1
    }
  }
  const directory = await fs.opendir(backupRoot)
  let batch = []
  for await (const entry of directory) {
    if (!entry.isFile() || !isBackupArchiveName(entry.name) || entry.name.endsWith('.meta')) continue
    batch.push(entry)
    if (batch.length < BACKUP_INDEX_SCAN_IO_CONCURRENCY) continue
    await include(batch)
    batch = []
  }
  if (batch.length) await include(batch)
  return {
    count,
    archiveSignature: createHash('sha256')
      .update(`backup-index-v1:${count}:`, 'utf8')
      .update(aggregate)
      .digest('hex'),
    directoryStamp: await backupDirectoryStamp(),
  }
}

function backupIndexState(database) {
  const rows = database.prepare('SELECT key, value FROM backup_index_state').all()
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

async function processBackupIndexBatch(database, scanId, startedAt, entries) {
  const indexed = await Promise.all(entries.map(async (entry) => {
    try {
      const stat = await fs.stat(path.join(backupRoot, entry.name))
      const existing = database.prepare(`
        SELECT * FROM backup_metadata_index WHERE file_name = ?
      `).get(entry.name)
      if (
        existing
        && Number(existing.source_size) === stat.size
        && Number(existing.source_mtime_ms) === stat.mtimeMs
      ) {
        return { fileName: entry.name, record: null }
      }
      const record = await readBackupInfoIfPresent(entry, { stat, readLegacy: false })
      return record ? { fileName: entry.name, record } : null
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }))
  const persist = database.transaction(() => {
    const insertScanEntry = database.prepare(`
      INSERT OR IGNORE INTO backup_index_scan_entries (scan_id, file_name, started_at)
      VALUES (?, ?, ?)
    `)
    for (const candidate of indexed) {
      if (!candidate) continue
      insertScanEntry.run(scanId, candidate.fileName, startedAt)
      if (candidate.record) {
        upsertBackupIndexInfo(
          database,
          candidate.record.stat,
          candidate.record.info,
          candidate.record.metadataState,
        )
      }
    }
  })
  persist()
}

async function rebuildBackupIndex(database, inventory) {
  const scanId = randomUUID()
  const startedAt = nowStamp()
  try {
    const directory = await fs.opendir(backupRoot)
    let batch = []
    for await (const entry of directory) {
      if (!entry.isFile() || !isBackupArchiveName(entry.name) || entry.name.endsWith('.meta')) continue
      batch.push(entry)
      if (batch.length < BACKUP_INDEX_SCAN_IO_CONCURRENCY) continue
      await processBackupIndexBatch(database, scanId, startedAt, batch)
      batch = []
    }
    if (batch.length) await processBackupIndexBatch(database, scanId, startedAt, batch)

    const settled = await backupDirectoryInventory()
    if (settled.archiveSignature !== inventory.archiveSignature) return false
    database.transaction(() => {
      database.prepare(`
        DELETE FROM backup_metadata_index
        WHERE NOT EXISTS (
          SELECT 1 FROM backup_index_scan_entries seen
          WHERE seen.scan_id = ? AND seen.file_name = backup_metadata_index.file_name
        )
      `).run(scanId)
      const upsertState = database.prepare(`
        INSERT INTO backup_index_state (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      upsertState.run('archiveSignature', settled.archiveSignature)
      upsertState.run('directoryStamp', settled.directoryStamp)
      upsertState.run('archiveCount', String(settled.count))
      database.prepare('DELETE FROM backup_index_scan_entries WHERE scan_id = ?').run(scanId)
    })()
    return true
  } finally {
    database.prepare('DELETE FROM backup_index_scan_entries WHERE scan_id = ?').run(scanId)
  }
}

async function ensureBackupIndexCurrent() {
  await fs.mkdir(backupRoot, { recursive: true })
  const database = getBackupIndexDatabase()
  while (true) {
    const generation = backupListCacheGeneration
    let scan = backupIndexScan
    if (!scan || scan.generation !== generation) {
      const promise = (async () => {
        const inventory = await backupDirectoryInventory()
        const state = backupIndexState(database)
        if (
          state.archiveSignature === inventory.archiveSignature
          && state.directoryStamp === inventory.directoryStamp
        ) return true
        return rebuildBackupIndex(database, inventory)
      })()
      scan = { generation, promise }
      backupIndexScan = scan
    }
    let settled
    try {
      settled = await scan.promise
    } finally {
      if (backupIndexScan === scan) backupIndexScan = null
    }
    if (generation !== backupListCacheGeneration || !settled) continue
    return database
  }
}

async function backfillLegacyBackupMetadata(database) {
  const pending = database.prepare(`
    SELECT file_name FROM backup_metadata_index
    WHERE metadata_state = 'pending'
    ORDER BY created_at DESC, file_name DESC
    LIMIT ?
  `).all(BACKUP_INDEX_LEGACY_BACKFILL_BATCH)
  for (let offset = 0; offset < pending.length; offset += BACKUP_INDEX_IO_CONCURRENCY) {
    const batch = pending.slice(offset, offset + BACKUP_INDEX_IO_CONCURRENCY)
    const resolved = await Promise.all(batch.map(async ({ file_name: fileName }) => {
      const record = await readBackupInfoIfPresent(fileName, { readLegacy: true })
      return { fileName, record }
    }))
    database.transaction(() => {
      for (const candidate of resolved) {
        if (!candidate.record) {
          database.prepare('DELETE FROM backup_metadata_index WHERE file_name = ?')
            .run(candidate.fileName)
          continue
        }
        upsertBackupIndexInfo(
          database,
          candidate.record.stat,
          candidate.record.info,
          candidate.record.metadataState,
        )
      }
    })()
  }
  return pending.length
}

async function drainLegacyBackupMetadata(database) {
  while (await backfillLegacyBackupMetadata(database) === BACKUP_INDEX_LEGACY_BACKFILL_BATCH) {
    // Each durable page is committed before the next one starts. A crash or
    // restart resumes from metadata_state='pending' without replaying the
    // completed prefix or retaining the whole migration set in memory.
  }
}

function normalizedBackupPageSize(value) {
  if (value === undefined || value === null || value === '') return BACKUP_LIST_DEFAULT_PAGE_SIZE
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return BACKUP_LIST_DEFAULT_PAGE_SIZE
  return Math.min(BACKUP_LIST_MAX_PAGE_SIZE, Math.max(1, parsed))
}

function normalizedBackupOffset(value) {
  const parsed = Math.floor(Number(value))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function encodeBackupCursor(backup) {
  return Buffer.from(JSON.stringify([backup.createdAt, backup.fileName]), 'utf8').toString('base64url')
}

function decodeBackupCursor(value) {
  if (value === undefined || value === null || value === '') return null
  try {
    const encoded = String(value)
    if (encoded.length > 1024) throw new Error('cursor too long')
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || typeof decoded[0] !== 'string'
      || typeof decoded[1] !== 'string'
      || !decoded[0]
      || !decoded[1]
    ) throw new Error('invalid cursor')
    return { createdAt: decoded[0], fileName: decoded[1] }
  } catch {
    throw backupFileError(400, 'INVALID_BACKUP_CURSOR', 'Backup pagination cursor is invalid.')
  }
}

function queryBackupIndex(database, filters = {}, paging = {}) {
  const clauses = []
  const values = []
  for (const [filter, column] of [
    ['fileName', 'file_name'],
    ['actorId', 'actor_id'],
    ['applicationId', 'application_id'],
    ['kind', 'kind'],
  ]) {
    if (!filters[filter]) continue
    clauses.push(`${column} = ?`)
    values.push(String(filters[filter]))
  }
  const limit = normalizedBackupPageSize(paging.limit ?? filters.limit)
  const cursor = decodeBackupCursor(paging.cursor ?? filters.cursor)
  if (cursor) {
    clauses.push('(created_at < ? OR (created_at = ? AND file_name < ?))')
    values.push(cursor.createdAt, cursor.createdAt, cursor.fileName)
  }
  const offset = cursor ? 0 : normalizedBackupOffset(paging.offset ?? filters.offset)
  const queryLimit = paging.probeForNext ? limit + 1 : limit
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return database.prepare(`
    SELECT file_name, source_size, source_mtime_ms, created_at, actor_id, application_id, application_name, kind
    FROM backup_metadata_index
    ${where}
    ORDER BY created_at DESC, file_name DESC
    LIMIT ? OFFSET ?
  `).all(...values, queryLimit, offset).map(backupInfoFromIndexRow)
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

  const database = await ensureBackupIndexCurrent()
  await drainLegacyBackupMetadata(database)
  const results = []
  for (const rule of normalizedRules.values()) {
    const deletedFileNames = []
    while (true) {
      const stale = queryBackupIndex(
        database,
        { actorId: rule.actorId, applicationId: rule.applicationId },
        { offset: rule.limit, limit: 128 },
      )
      if (stale.length === 0) break
      const deletedBeforeBatch = deletedFileNames.length
      for (let offset = 0; offset < stale.length; offset += BACKUP_INDEX_IO_CONCURRENCY) {
        const batch = stale.slice(offset, offset + BACKUP_INDEX_IO_CONCURRENCY)
        const deleted = await Promise.all(batch.map(async (backup) => {
          try {
            await deleteBackup(backup.fileName)
            return backup.fileName
          } catch {
            return null
          }
        }))
        deletedFileNames.push(...deleted.filter(Boolean))
      }
      if (deletedFileNames.length === deletedBeforeBatch) break
      if (stale.length < 128) break
    }
    results.push({
      actorId: rule.actorId,
      applicationId: rule.applicationId,
      limit: rule.limit,
      deleted: deletedFileNames.length,
      deletedFileNames,
    })
  }
  return results
}

function backupQuotaReservationMismatch(message) {
  const error = new Error(message)
  error.code = 'WORKSPACE_QUOTA_RESERVATION_MISMATCH'
  error.status = 409
  return error
}

async function commitStagedApplicationBackup({ reservationToken, backupInfo, stagePath, targetPath }) {
  return withWriteLock(async () => {
    const database = getDb()
    const tokenHash = workspaceQuotaReservationHash(reservationToken)
    let quotaSourceCommitted = false
    try {
      // Repair legacy backup rows before capturing the final before/after
      // values. The new stage is intentionally invisible to listBackups.
      await synchronizeWorkspaceBackupQuotaActor(backupInfo.actorId)
      database.transaction(() => {
        heartbeatWorkspaceQuotaProcess(database)
        const reservation = database.prepare(
          'SELECT * FROM workspace_quota_reservations WHERE token_hash = ?',
        ).get(tokenHash)
        if (!reservation) {
          const error = new Error('The storage reservation expired or was already consumed.')
          error.code = 'WORKSPACE_QUOTA_RESERVATION_INVALID'
          error.status = 409
          throw error
        }
        if (
          reservation.domain_kind !== 'personal'
          || reservation.domain_id !== backupInfo.actorId
          || reservation.source_kind !== 'backup'
          || reservation.source_id !== backupInfo.fileName
        ) {
          throw backupQuotaReservationMismatch('The storage reservation does not belong to this backup.')
        }
        if (String(reservation.expires_at) <= nowStamp()) {
          const error = new Error('The storage reservation expired before the backup was committed.')
          error.code = 'WORKSPACE_QUOTA_RESERVATION_INVALID'
          error.status = 409
          throw error
        }
        if (Number(backupInfo.size) > Number(reservation.reserved_bytes)) {
          throw backupQuotaReservationMismatch('The encoded backup exceeded its reserved byte budget.')
        }
        if (database.prepare(
          `SELECT 1 FROM workspace_quota_sources
            WHERE source_kind = 'backup' AND source_id = ? LIMIT 1`,
        ).get(backupInfo.fileName)) {
          const error = new Error('This backup storage identity was already committed.')
          error.code = 'WORKSPACE_REVISION_CONFLICT'
          error.status = 409
          throw error
        }

        refreshStaleQuotaRows(database, backupInfo.actorId, [])
        const domains = new Map()
        addWorkspaceQuotaDomain(domains, 'personal', backupInfo.actorId)
        const key = workspaceQuotaDomainKey('personal', backupInfo.actorId)
        const guard = {
          domains,
          deletionCandidates: new Set(),
          beforeBytes: new Map([[key, indexedQuotaDomainBytes(
            database,
            'personal',
            backupInfo.actorId,
          )]]),
        }
        syncWorkspaceQuotaBackup(database, backupInfo)
        assertWorkspaceQuotaMutation(database, guard, [tokenHash])
        consumeWorkspaceQuotaReservations(database, [reservation])
      }).immediate()
      quotaSourceCommitted = true
      forgetActiveWorkspaceQuotaReservation(tokenHash)

      try {
        // Persist the source row and consumed reservation before publishing the
        // visible backup file.
        await acknowledgeDurableStorageMutation()
      } catch (error) {
        // A failed external acknowledgement can be ambiguous. Publish a newer
        // compensating removal locally and retain the stage for startup
        // reconciliation against whichever snapshot is authoritative.
        database.transaction(() => {
          clearWorkspaceQuotaSource(database, 'backup', backupInfo.fileName)
          database.prepare(
            'DELETE FROM workspace_quota_reservations WHERE token_hash = ?',
          ).run(tokenHash)
        }).immediate()
        await acknowledgeDurableStorageMutation().catch(() => undefined)
        error.preserveBackupStage = true
        throw error
      }

      try {
        await fs.rename(stagePath, targetPath)
      } catch (error) {
        // The acknowledged source makes this stage authoritative. Startup
        // recovery promotes it, so cleanup must not discard recoverable data.
        error.preserveBackupStage = true
        throw error
      }
    } catch (error) {
      if (!quotaSourceCommitted) forgetActiveWorkspaceQuotaReservation(tokenHash)
      throw error
    }
  })
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
  const normalizedActorId = String(actorId ?? '').trim()
  if (!normalizedActorId) {
    throw backupFileError(400, 'INVALID_BACKUP_ACTOR', 'An application backup requires an account owner.')
  }
  const stamp = nowStamp().replaceAll(':', '-').replaceAll('.', '-')
  const fileName = `phd-atlas-app-${safeFileSegment(applicationId)}-${stamp}-${randomUUID()}.json`
  const target = path.join(backupRoot, fileName)
  const stagePath = backupStagePath(fileName)
  const createdAt = nowStamp()
  const snapshot = {
    backup: {
      kind: 'application',
      createdAt,
      actorId: normalizedActorId,
      applicationId,
      applicationName: application.school?.name ?? application.program ?? applicationId,
      databaseAdapter: 'sqlite',
      databasePath,
    },
    application,
  }
  const snapshotPayload = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8')
  const backupPolicy = activeEncryptionPolicy ?? backupEncryptionPolicyForSettings(store?.settings)
  const reservation = await reserveWorkspaceQuota({
    domainKind: 'personal',
    domainId: normalizedActorId,
    sourceKind: 'backup',
    sourceId: fileName,
    expectedSourceVersion: 0,
    requestId: String(options.quotaRequestId ?? `backup:${normalizedActorId}:${fileName}`),
    // Binary durable envelopes add only a bounded header, IV, and auth tag.
    // Keep the reservation conservative without multiplying concurrent small
    // backups into a false quota rejection.
    reserveBytes: Math.min(Number.MAX_SAFE_INTEGER, snapshotPayload.length + (64 * 1024)),
    actorId: normalizedActorId,
  })
  let stat
  try {
    await fs.rm(stagePath, { force: true })
    await fs.rm(backupStageMetadataPath(fileName), { force: true })
    await encodeBackupFile(snapshotPayload, stagePath, backupPolicy)
    stat = await fs.stat(stagePath)
    await writeBackupStageMetadata(
      fileName,
      stat,
      snapshot.backup,
      application?.school?.name ?? snapshot.backup?.applicationName,
    )
    await commitStagedApplicationBackup({
      reservationToken: reservation.token,
      backupInfo: {
        fileName,
        size: stat.size,
        sourceMtimeMs: stat.mtimeMs,
        createdAt,
        actorId: normalizedActorId,
        applicationId,
        applicationName: application?.school?.name,
        kind: 'application',
      },
      stagePath,
      targetPath: target,
    })
  } catch (error) {
    await releaseWorkspaceQuotaReservation(reservation.token).catch(() => undefined)
    if (!error?.preserveBackupStage) {
      await fs.rm(stagePath, { force: true }).catch(() => undefined)
      await fs.rm(backupStageMetadataPath(fileName), { force: true }).catch(() => undefined)
    }
    throw error
  }
  await writeBackupMetadata(
    fileName,
    stat,
    snapshot.backup,
    application?.school?.name ?? snapshot.backup?.applicationName,
  ).catch(() => undefined)
  try {
    await fs.access(backupMetadataPath(fileName))
    await fs.rm(backupStageMetadataPath(fileName), { force: true })
  } catch {
    // Keep the hidden metadata stage when sidecar publication failed. Startup
    // recovery can pair it with the already acknowledged archive.
  }
  invalidateBackupListCache(fileName)
  if (shouldPrune) {
    await pruneApplicationBackups(normalizedActorId, applicationId, maxBackupsPerApp)
  }
  return {
    fileName,
    path: target,
    size: stat.size,
    createdAt,
    actorId: normalizedActorId,
    applicationId,
    applicationName: application?.school?.name,
    kind: 'application',
  }
}

export async function listBackups(filters = {}) {
  const database = await ensureBackupIndexCurrent()
  if (filters.actorId || filters.applicationId || filters.fileName) {
    await drainLegacyBackupMetadata(database)
  } else {
    await backfillLegacyBackupMetadata(database)
  }
  return queryBackupIndex(database, filters)
}

export async function listBackupsPage(filters = {}) {
  const database = await ensureBackupIndexCurrent()
  if (filters.actorId || filters.applicationId || filters.fileName) {
    await drainLegacyBackupMetadata(database)
  } else {
    await backfillLegacyBackupMetadata(database)
  }
  const limit = normalizedBackupPageSize(filters.limit)
  const candidates = queryBackupIndex(database, filters, { limit, probeForNext: true })
  const hasMore = candidates.length > limit
  const backups = hasMore ? candidates.slice(0, limit) : candidates
  return {
    backups,
    nextCursor: hasMore && backups.length ? encodeBackupCursor(backups.at(-1)) : null,
  }
}

export async function getBackupInfo(fileName, filters = {}) {
  await fs.mkdir(backupRoot, { recursive: true })
  const backup = resolveBackupFile(fileName)
  const database = await ensureBackupIndexCurrent()
  let record
  try {
    record = await readBackupInfo(backup.fileName, { readLegacy: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    deleteBackupIndexInfo(backup.fileName)
    return null
  }
  upsertBackupIndexInfo(database, record.stat, record.info, record.metadataState)
  for (const field of ['actorId', 'applicationId', 'kind']) {
    if (filters[field] && record.info[field] !== filters[field]) return null
  }
  return record.info
}

export async function backupStorageSummary(filters = {}) {
  const database = await ensureBackupIndexCurrent()
  if (filters.actorId || filters.applicationId) {
    await drainLegacyBackupMetadata(database)
  } else {
    await backfillLegacyBackupMetadata(database)
  }
  const clauses = []
  const values = []
  for (const [filter, column] of [
    ['actorId', 'actor_id'],
    ['applicationId', 'application_id'],
    ['kind', 'kind'],
  ]) {
    if (!filters[filter]) continue
    clauses.push(`${column} = ?`)
    values.push(String(filters[filter]))
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const row = database.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(source_size), 0) AS bytes
    FROM backup_metadata_index ${where}
  `).get(...values)
  return { count: Number(row.count ?? 0), bytes: Number(row.bytes ?? 0) }
}

export async function groupBackupStorageByActor({ limit = 1000, cursor = '' } = {}) {
  const database = await ensureBackupIndexCurrent()
  await drainLegacyBackupMetadata(database)
  const pageSize = Math.min(10_000, Math.max(1, Math.floor(Number(limit)) || 1000))
  const actorCursor = String(cursor ?? '')
  const rows = database.prepare(`
    SELECT actor_id, COUNT(*) AS count, COALESCE(SUM(source_size), 0) AS bytes
    FROM backup_metadata_index
    WHERE actor_id IS NOT NULL AND actor_id > ?
    GROUP BY actor_id
    ORDER BY actor_id ASC
    LIMIT ?
  `).all(actorCursor, pageSize + 1)
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  return {
    actors: page.map((row) => ({
      actorId: row.actor_id,
      count: Number(row.count ?? 0),
      bytes: Number(row.bytes ?? 0),
    })),
    nextCursor: hasMore ? page.at(-1)?.actor_id ?? null : null,
  }
}

export async function deleteBackupsForActor(actorId) {
  if (!actorId) return { deleted: 0, deletedFileNames: [] }
  const database = await ensureBackupIndexCurrent()
  await drainLegacyBackupMetadata(database)
  const deletedFileNames = []
  while (true) {
    const batch = queryBackupIndex(database, { actorId }, { limit: 128 })
    if (batch.length === 0) break
    const before = deletedFileNames.length
    for (let offset = 0; offset < batch.length; offset += BACKUP_INDEX_IO_CONCURRENCY) {
      const deleted = await Promise.all(batch
        .slice(offset, offset + BACKUP_INDEX_IO_CONCURRENCY)
        .map(async (backup) => {
          try {
            await deleteBackup(backup.fileName)
            return backup.fileName
          } catch {
            return null
          }
        }))
      deletedFileNames.push(...deleted.filter(Boolean))
    }
    if (deletedFileNames.length === before) break
  }
  return { deleted: deletedFileNames.length, deletedFileNames }
}

/**
 * Enumerate legacy actor-owned backups before an account mutation. Current
 * backups are also represented in workspace_quota_sources and are selected
 * again inside the account-delete transaction, so a backup created after this
 * lock-free scan cannot escape the durable deletion outbox.
 */
export async function planBackupsForAccountDeletion(actorId) {
  const normalizedActorId = String(actorId ?? '').trim()
  if (!normalizedActorId) {
    throw backupFileError(400, 'INVALID_BACKUP_ACTOR', 'A backup deletion owner is required.')
  }
  const backups = await listBackups({ actorId: normalizedActorId })
  return {
    actorId: normalizedActorId,
    backups: backups.map((backup) => ({
      fileName: backup.fileName,
      size: Math.max(0, Number(backup.size) || 0),
      sourceMtimeMs: Math.max(0, Number(backup.sourceMtimeMs) || 0),
    })),
  }
}

async function nextWorkspaceBackupDeletion(cursor = null) {
  const requestedAt = String(cursor?.requestedAt ?? '')
  const fileName = String(cursor?.fileName ?? '')
  if (requestedAt && fileName) {
    return getDb().prepare(
      `SELECT file_name, actor_id, file_bytes, source_version, requested_at
         FROM workspace_backup_deletions
        WHERE requested_at > ? OR (requested_at = ? AND file_name > ?)
        ORDER BY requested_at ASC, file_name ASC
        LIMIT 1`,
    ).get(requestedAt, requestedAt, fileName) ?? null
  }
  return getDb().prepare(
    `SELECT file_name, actor_id, file_bytes, source_version, requested_at
       FROM workspace_backup_deletions
      ORDER BY requested_at ASC, file_name ASC
      LIMIT 1`,
  ).get() ?? null
}

async function isWorkspaceBackupReferenced(fileName) {
  return Boolean(getDb().prepare(
    `SELECT 1 FROM workspace_quota_sources
      WHERE source_kind = 'backup' AND source_id = ? LIMIT 1`,
  ).get(fileName))
}

async function finishWorkspaceBackupDeletion(fileName, actorId, { cancelled = false } = {}) {
  let changed = false
  await withWriteLock(async () => {
    const database = getDb()
    changed = database.transaction(() => {
      const intent = database.prepare(
        `SELECT actor_id FROM workspace_backup_deletions
          WHERE file_name = ?`,
      ).get(fileName)
      if (!intent || intent.actor_id !== actorId) return false
      const source = database.prepare(
        `SELECT domain_kind, domain_id FROM workspace_quota_sources
          WHERE source_kind = 'backup' AND source_id = ? LIMIT 1`,
      ).get(fileName)
      if (!cancelled && source) return false
      database.prepare(
        `DELETE FROM workspace_backup_deletions
          WHERE file_name = ? AND actor_id = ?`,
      ).run(fileName, actorId)
      return true
    }).immediate()
  })
  if (changed) {
    // The account/business deletion was acknowledged before physical cleanup.
    // Persisting this housekeeping row removal may be slow for an external
    // database, so keep that I/O outside the process write lock. A failed ACK
    // merely leaves the remote intent retryable and unlink remains idempotent.
    await acknowledgeDurableStorageMutation()
  }
  return changed
}

function backupDeletionDeferredError(code, message, cause = null) {
  const error = new Error(message)
  error.code = code
  error.status = 503
  error.retryable = true
  if (cause) error.cause = cause
  return error
}

async function processWorkspaceBackupDeletionIntent(intent, {
  inspect = getBackupInfo,
  remove = (target) => fs.rm(target, { force: true }),
  finish = finishWorkspaceBackupDeletion,
  referenced = isWorkspaceBackupReferenced,
} = {}) {
  const requestedFileName = String(intent?.file_name ?? intent?.fileName ?? '')
  const actorId = String(intent?.actor_id ?? intent?.actorId ?? '')
  let backup
  try {
    backup = resolveBackupFile(requestedFileName)
  } catch (error) {
    return { status: 'deferred', error }
  }

  try {
    if (await referenced(backup.fileName)) {
      const completed = await finish(backup.fileName, actorId, { cancelled: true })
      if (!completed) {
        throw backupDeletionDeferredError(
          'BACKUP_DELETION_FINISH_CONFLICT',
          'The referenced backup deletion intent changed before cancellation.',
        )
      }
      return { status: 'cancelled', fileName: backup.fileName }
    }

    const info = await inspect(backup.fileName)
    if (info?.actorId && String(info.actorId) !== actorId) {
      throw backupDeletionDeferredError(
        'BACKUP_DELETION_OWNER_CONFLICT',
        'The backup is now owned by a different account.',
      )
    }
    const expectedBytes = Math.max(0, Number(intent.file_bytes ?? intent.fileBytes) || 0)
    const expectedVersion = Math.max(0, Number(intent.source_version ?? intent.sourceVersion) || 0)
    if (
      info
      && (
        (expectedBytes > 0 && Number(info.size) !== expectedBytes)
        || (expectedVersion > 0 && backupSourceVersion(info) !== expectedVersion)
      )
    ) {
      throw backupDeletionDeferredError(
        'BACKUP_DELETION_IDENTITY_CONFLICT',
        'The backup changed after its durable deletion intent was recorded.',
      )
    }

    // All four exact artifacts are part of one retryable physical cleanup.
    // force=true ignores only absence; permission/device errors still retain
    // the outbox row and the next pass safely repeats the whole sequence.
    await remove(backup.path)
    await remove(backupStagePath(backup.fileName))
    await remove(backupStageMetadataPath(backup.fileName))
    await remove(backupMetadataPath(backup.fileName))
    deleteBackupIndexInfo(backup.fileName)
    invalidateBackupListCache(backup.fileName)
    const completed = await finish(backup.fileName, actorId, { cancelled: false })
    if (!completed) {
      throw backupDeletionDeferredError(
        'BACKUP_DELETION_FINISH_CONFLICT',
        'The backup deletion intent changed before completion.',
      )
    }
    return { status: 'deleted', fileName: backup.fileName }
  } catch (error) {
    return {
      status: 'deferred',
      error: error?.retryable
        ? error
        : backupDeletionDeferredError(
            String(error?.code || 'BACKUP_DELETION_IO_FAILED'),
            'The backup cleanup could not complete and remains queued.',
            error,
          ),
    }
  }
}

async function drainWorkspaceBackupDeletionsUnlocked(limit, options = {}) {
  const next = options.next ?? nextWorkspaceBackupDeletion
  const maximum = Math.min(512, Math.max(1, Math.floor(Number(limit)) || 64))
  let deleted = 0
  let cancelled = 0
  let deferred = 0
  let cursor = null
  const seen = new Set()
  for (let index = 0; index < maximum; index += 1) {
    let intent
    try {
      intent = await next(cursor)
    } catch {
      deferred += 1
      break
    }
    if (!intent) break
    const fileName = String(intent.file_name ?? intent.fileName ?? '')
    const requestedAt = String(intent.requested_at ?? intent.requestedAt ?? '')
    const identity = JSON.stringify([requestedAt, fileName])
    if (seen.has(identity)) break
    seen.add(identity)
    cursor = { requestedAt, fileName }

    const outcome = await processWorkspaceBackupDeletionIntent(intent, options)
    if (outcome.status === 'deleted') deleted += 1
    else if (outcome.status === 'cancelled') cancelled += 1
    else deferred += 1
  }
  return { deleted, cancelled, deferred }
}

async function withWorkspaceBackupDeletionDrainLock(fn) {
  const previous = workspaceBackupDeletionDrain
  let release
  workspaceBackupDeletionDrain = new Promise((resolve) => { release = resolve })
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

export async function drainWorkspaceBackupDeletions(limit = 64, options = {}) {
  return withWorkspaceBackupDeletionDrainLock(
    () => drainWorkspaceBackupDeletionsUnlocked(limit, options),
  )
}

export async function backupIndexDiagnostics() {
  await fs.mkdir(backupRoot, { recursive: true })
  const database = getBackupIndexDatabase()
  const counts = database.prepare(`
    SELECT
      COUNT(*) AS indexed,
      SUM(CASE WHEN metadata_state = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN metadata_state = 'unavailable' THEN 1 ELSE 0 END) AS unavailable
    FROM backup_metadata_index
  `).get()
  return {
    indexedEntries: Number(counts.indexed ?? 0),
    pendingLegacyEntries: Number(counts.pending ?? 0),
    unavailableLegacyEntries: Number(counts.unavailable ?? 0),
    infoCacheEntries: backupInfoCache.size,
    infoCacheLimit: BACKUP_INDEX_INFO_CACHE_LIMIT,
    defaultPageSize: BACKUP_LIST_DEFAULT_PAGE_SIZE,
    maximumPageSize: BACKUP_LIST_MAX_PAGE_SIZE,
  }
}

function automaticBackupUserFingerprint(row) {
  return createHash('sha256')
    .update(String(row?.role ?? ''), 'utf8')
    .update('\0', 'utf8')
    .update(String(row?.disabled_at ?? ''), 'utf8')
    .update('\0', 'utf8')
    .update(String(row?.settings_json ?? ''), 'utf8')
    .digest('hex')
}

function automaticBackupEligibleUser(user) {
  const plan = normalizeUserRole(user?.role) === 'admin'
    ? 'admin'
    : user?.settings?.membershipPlan === 'team'
      ? 'team'
      : user?.settings?.membershipPlan === 'pro'
        ? 'pro'
        : 'free'
  return !user?.disabledAt && plan !== 'free' && Boolean(user?.settings?.autoBackup)
}

/**
 * Streams only small automatic-backup references in stable owner/id order.
 * Application payloads are deliberately excluded; the scheduler acquires its
 * per-application HEAVY lease before readAutomaticBackupCandidate() decodes a
 * single row.
 */
export async function * iterateAutomaticBackupCandidateRefs(options = {}) {
  await ensureStorage()
  const database = getDb()
  const batchSize = Math.min(256, Math.max(1, Math.floor(Number(options.batchSize)) || 64))
  let afterOwnerId = ''
  let afterApplicationId = ''
  let afterLastBackupAt = ''
  let hasCursor = false
  let cachedOwnerId = null
  let cachedUser = null
  let cachedUserFingerprint = null

  for (;;) {
    const rows = database.prepare(
      `SELECT application.id, application.owner_id, application.updated_at,
              LENGTH(application.payload_json) AS payload_bytes,
              COALESCE(state.last_auto_backup_at, '') AS last_auto_backup_at
       FROM applications AS application
       LEFT JOIN automatic_backup_state AS state
         ON state.actor_id = application.owner_id
        AND state.application_id = application.id
       WHERE (state.last_auto_backup_at IS NULL
              OR application.updated_at > state.last_auto_backup_at)
         AND (
           ? = 0
           OR COALESCE(state.last_auto_backup_at, '') > ?
           OR (
             COALESCE(state.last_auto_backup_at, '') = ?
             AND (
               application.owner_id > ?
               OR (application.owner_id = ? AND application.id > ?)
             )
           )
         )
       ORDER BY COALESCE(state.last_auto_backup_at, '') ASC,
                application.owner_id ASC, application.id ASC
       LIMIT ?`,
    ).all(
      hasCursor ? 1 : 0,
      afterLastBackupAt,
      afterLastBackupAt,
      afterOwnerId,
      afterOwnerId,
      afterApplicationId,
      batchSize,
    )
    if (rows.length === 0) return

    for (const row of rows) {
      hasCursor = true
      afterLastBackupAt = String(row.last_auto_backup_at ?? '')
      afterOwnerId = row.owner_id
      afterApplicationId = row.id
      if (cachedOwnerId !== row.owner_id) {
        const userRow = database.prepare('SELECT * FROM users WHERE id = ?').get(row.owner_id)
        cachedOwnerId = row.owner_id
        cachedUser = userRow ? userFromRow(userRow) : null
        cachedUserFingerprint = userRow ? automaticBackupUserFingerprint(userRow) : null
      }
      if (!automaticBackupEligibleUser(cachedUser)) continue
      yield {
        applicationId: row.id,
        ownerId: row.owner_id,
        sourceUpdatedAt: row.updated_at,
        payloadBytes: Math.max(0, Number(row.payload_bytes) || 0),
        user: cachedUser,
        userFingerprint: cachedUserFingerprint,
      }
    }
  }
}

/** Decode exactly one candidate after the scheduler owns its payload-sized lease. */
export async function readAutomaticBackupCandidate(reference) {
  await ensureStorage()
  if (!reference?.applicationId || !reference?.ownerId || !reference?.userFingerprint) return null
  const database = getDb()
  const read = database.transaction(() => {
    const userRow = database.prepare('SELECT * FROM users WHERE id = ?').get(reference.ownerId)
    if (
      !userRow
      || automaticBackupUserFingerprint(userRow) !== reference.userFingerprint
    ) return null
    const user = userFromRow(userRow)
    if (!automaticBackupEligibleUser(user)) return null

    const metadata = database.prepare(
      `SELECT id, owner_id, updated_at, LENGTH(payload_json) AS payload_bytes
       FROM applications WHERE id = ? AND owner_id = ?`,
    ).get(reference.applicationId, reference.ownerId)
    if (!metadata || Number(metadata.payload_bytes) > Number(reference.payloadBytes)) return null
    const row = database.prepare('SELECT * FROM applications WHERE id = ? AND owner_id = ?')
      .get(reference.applicationId, reference.ownerId)
    if (!row) return null
    const payload = decodePayloadFromStorage(row.payload_json)
    const schoolLogoAssets = readReferencedSchoolLogoAssets(database, [payload])
    const state = database.prepare(
      `SELECT last_auto_backup_at FROM automatic_backup_state
       WHERE actor_id = ? AND application_id = ?`,
    ).get(reference.ownerId, reference.applicationId)
    const legacyLastAutoBackupAt = String(
      payload?.backupSettings?.lastAutoBackupAt ?? '',
    )
    return {
      user,
      application: applicationFromRow(row, schoolLogoAssets, payload),
      lastAutoBackupAt: String(state?.last_auto_backup_at ?? '')
        || legacyLastAutoBackupAt
        || null,
    }
  })
  return read.deferred()
}

export async function readAutomaticBackupSettings() {
  await ensureStorage()
  return settingsFromRow(getDb().prepare('SELECT * FROM system_settings WHERE id = ?').get('global'))
}

/**
 * Reads the durable automatic-backup state for one application. The value is
 * kept outside the application payload so scheduled backups never mutate the
 * data a workspace stream is validating.
 */
export async function readAutomaticBackupState(actorId, applicationId) {
  await ensureStorage()
  if (!actorId || !applicationId) return null
  const row = getDb().prepare(
    `SELECT last_auto_backup_at, frequency, max_backups
     FROM automatic_backup_state
     WHERE actor_id = ? AND application_id = ?`,
  ).get(actorId, applicationId)
  return row ?? null
}

/**
 * Overlays the current automatic-backup state onto application objects for
 * display-only projections (exports, admin reports). The payload copy can be
 * stale because scheduled backups no longer rewrite application rows.
 */
export async function hydrateAutomaticBackupState(applications) {
  if (!Array.isArray(applications) || applications.length === 0) return applications
  await ensureStorage()
  const database = getDb()
  const byKey = new Map()
  const seen = new Set()
  for (const application of applications) {
    if (!application?.id || !application?.ownerId) continue
    const key = `${application.ownerId}\u0000${application.id}`
    if (seen.has(key)) continue
    seen.add(key)
    byKey.set(key, application)
  }
  if (byKey.size === 0) return applications
  const keys = [...byKey.keys()]
  for (let offset = 0; offset < keys.length; offset += 200) {
    const batch = keys.slice(offset, offset + 200)
    const placeholders = batch.map(() => '(?, ?)').join(', ')
    const params = batch.flatMap((key) => {
      const [actorId, applicationId] = key.split('\u0000')
      return [actorId, applicationId]
    })
    const rows = database.prepare(
      `SELECT actor_id, application_id, last_auto_backup_at
       FROM automatic_backup_state
       WHERE (actor_id, application_id) IN (${placeholders})`,
    ).all(...params)
    for (const row of rows) {
      const application = byKey.get(`${row.actor_id}\u0000${row.application_id}`)
      if (!application) continue
      application.backupSettings = {
        ...(application.backupSettings ?? {}),
        lastAutoBackupAt: String(row.last_auto_backup_at ?? '') || undefined,
      }
    }
  }
  return applications
}

/**
 * Applies one automatic-backup acknowledgement to a compact durable state
 * row. The application payload itself is deliberately NOT rewritten: bumping
 * `updated_at` and re-encoding the whole encrypted payload for every
 * scheduled backup made background maintenance mutate the data a workspace
 * stream was validating, so a busy single-user account could never finish a
 * bootstrap and interactive saves queued behind the acknowledgement flood.
 *
 * The backup file plus the backup metadata index remain the audit trail; the
 * state row only records when the next pass may create the next snapshot.
 */
export async function acknowledgeAutomaticApplicationBackup(backup) {
  await ensureStorage()
  if (!backup?.actorId || !backup?.applicationId || !backup?.fileName) return false
  const createdAt = String(backup.createdAt ?? nowStamp())
  const frequency = normalizeBackupFrequency(backup.frequency)
  const maxBackups = Math.max(
    1,
    Number.isSafeInteger(backup.maxBackups) ? backup.maxBackups : 1,
  )
  return withWriteLock(async () => {
    const database = getDb()
    const existing = database.prepare(
      `SELECT last_auto_backup_at
       FROM automatic_backup_state
       WHERE actor_id = ? AND application_id = ?`,
    ).get(backup.actorId, backup.applicationId)
    const previousBackupAt = String(existing?.last_auto_backup_at ?? '')
    const lastAutoBackupAt = previousBackupAt > createdAt ? previousBackupAt : createdAt
    const changed = database.prepare(
      `INSERT INTO automatic_backup_state (
         actor_id, application_id, last_auto_backup_at, frequency,
         max_backups, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(actor_id, application_id) DO UPDATE SET
         last_auto_backup_at = excluded.last_auto_backup_at,
         frequency = excluded.frequency,
         max_backups = excluded.max_backups,
         updated_at = excluded.updated_at`,
    ).run(
      backup.actorId,
      backup.applicationId,
      lastAutoBackupAt,
      frequency,
      maxBackups,
      nowStamp(),
    )
    if (Number(changed.changes ?? 0) !== 1) {
      throw storeWriteConflict('automatic-backup-state', backup.applicationId)
    }
    scheduleExternalDatabaseSync()
    return true
  })
}

export async function recordAutomaticWorkspaceBackup(backup, settings = {}) {
  await ensureStorage()
  if (!backup?.fileName) return false
  return withWriteLock(async () => {
    getDb().prepare(
      `INSERT INTO system_events (
         id, time, scope, actor_id, message, metadata_json
       ) VALUES (?, ?, 'Backup', NULL, 'Created automatic workspace backup', ?)`,
    ).run(
      createId('event'),
      nowStamp(),
      toJson({
        fileName: backup.fileName,
        frequency: settings.frequency,
        retention: settings.retention,
      }),
    )
    invalidateSharedStoreCache()
    scheduleExternalDatabaseSync()
    return true
  })
}

export async function pruneWorkspaceBackups(retention) {
  const limit = Math.max(1, normalizeBackupLimit(retention, 1))
  const database = await ensureBackupIndexCurrent()
  await drainLegacyBackupMetadata(database)
  const deletedFileNames = []
  for (;;) {
    const stale = queryBackupIndex(database, { kind: 'workspace' }, { offset: limit, limit: 128 })
    if (stale.length === 0) break
    const before = deletedFileNames.length
    for (let offset = 0; offset < stale.length; offset += BACKUP_INDEX_IO_CONCURRENCY) {
      const deleted = await Promise.all(stale
        .slice(offset, offset + BACKUP_INDEX_IO_CONCURRENCY)
        .map(async (candidate) => {
          try {
            await deleteBackup(candidate.fileName)
            return candidate.fileName
          } catch {
            return null
          }
        }))
      deletedFileNames.push(...deleted.filter(Boolean))
    }
    if (deletedFileNames.length === before) break
  }
  return { limit, deleted: deletedFileNames.length, deletedFileNames }
}

function throwIfBackupRestoreAborted(signal) {
  if (!signal?.aborted) return
  const error = backupFileError(499, 'BACKUP_RESTORE_ABORTED', 'Backup restore was cancelled before it could be applied.')
  error.cause = signal.reason
  throw error
}

function backupRestoreReservationBytes(sourceBytes) {
  const bytes = Math.max(0, Number(sourceBytes) || 0)
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(
      32 * 1024 * 1024,
      (bytes * BACKUP_RESTORE_MEMORY_MULTIPLIER) + BACKUP_RESTORE_MEMORY_FIXED_BYTES,
    ),
  )
}

function acquireBackupRestoreMemoryLease(sourceBytes) {
  if (!acquireBackupRestoreMemory) {
    if (sourceBytes > BACKUP_RESTORE_WITHOUT_ADMISSION_MAX_BYTES) {
      throw backupFileError(
        503,
        'BACKUP_RESTORE_MEMORY_ADMISSION_UNAVAILABLE',
        'Large legacy JSON restores require the server memory-admission boundary.',
      )
    }
    return null
  }
  const release = acquireBackupRestoreMemory(backupRestoreReservationBytes(sourceBytes))
  if (release !== null && release !== undefined && typeof release !== 'function') {
    throw new TypeError('Backup restore memory admission must return a release function or null.')
  }
  return release ?? null
}

async function readBoundedBackupJson(filePath, signal) {
  throwIfBackupRestoreAborted(signal)
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_JSON_BACKUP_RESTORE_BYTES) {
    throw backupFileError(
      413,
      'BACKUP_RESTORE_TOO_LARGE',
      'This legacy JSON backup exceeds the safe restore limit. Use a current workspace archive instead.',
    )
  }
  const payload = await readFilePrefix(filePath, MAX_JSON_BACKUP_RESTORE_BYTES)
  throwIfBackupRestoreAborted(signal)
  if (payload.truncated) {
    throw backupFileError(
      413,
      'BACKUP_RESTORE_TOO_LARGE',
      'This legacy JSON backup exceeds the safe restore limit. Use a current workspace archive instead.',
    )
  }
  return payload.text.replace(/^\uFEFF/, '')
}

export async function restoreBackup(fileName, options = {}) {
  const backup = resolveBackupFile(fileName)

  // Full workspace archives restore SQLite + uploads onto disk.
  if (backup.fileName.endsWith('.tar.gz')) {
    return restoreWorkspaceArchive(backup.fileName, options)
  }

  let releaseMemory = null
  try {
    throwIfBackupRestoreAborted(options.signal)
    const sourceStat = await fs.stat(backup.path)
    const inspection = await inspectBackupFile(backup.path)
    if (sourceStat.size > (
      inspection.encrypted
        ? MAX_ENCODED_JSON_BACKUP_RESTORE_BYTES
        : MAX_JSON_BACKUP_RESTORE_BYTES
    )) {
      throw backupFileError(
        413,
        'BACKUP_RESTORE_TOO_LARGE',
        'This legacy JSON backup exceeds the safe restore limit. Convert it to a current workspace archive first.',
      )
    }

    let raw
    if (inspection.encrypted) {
      const readable = path.join(
        backupRoot,
        `.restore-application-${process.pid}-${Date.now()}-${randomUUID()}.json`,
      )
      try {
        await decodeBackupFile(backup.path, readable)
        const decodedStat = await fs.stat(readable)
        if (decodedStat.size > MAX_JSON_BACKUP_RESTORE_BYTES) {
          throw backupFileError(
            413,
            'BACKUP_RESTORE_TOO_LARGE',
            'This legacy JSON backup exceeds the safe restore limit. Convert it to a current workspace archive first.',
          )
        }
        releaseMemory = acquireBackupRestoreMemoryLease(decodedStat.size)
        raw = await readBoundedBackupJson(readable, options.signal)
      } finally {
        await fs.rm(readable, { force: true }).catch(() => undefined)
      }
    } else {
      releaseMemory = acquireBackupRestoreMemoryLease(sourceStat.size)
      raw = await readBoundedBackupJson(backup.path, options.signal)
    }
    throwIfBackupRestoreAborted(options.signal)
    const restored = JSON.parse(raw)
    throwIfBackupRestoreAborted(options.signal)
    let result
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
      result = {
        application: restoredApplication,
        backup: restored.backup,
      }
    } else {
      // Legacy JSON workspace snapshot (pre sqlite+uploads archive format).
      delete restored.backup
      result = restored
    }
    const leasedResult = attachBackupRestoreMemoryLease(result, releaseMemory)
    releaseMemory = null
    return leasedResult
  } catch (error) {
    releaseMemory?.()
    throw error
  }
}

/**
 * Restores one personal application without hydrating or rewriting the full
 * workspace. Exact backup metadata and the decoded payload are both bound to
 * the actor, then the durable row is replaced under BEGIN IMMEDIATE so another
 * process cannot interleave a write between the ownership check and update.
 *
 * The JSON parsing lease remains attached to the returned result. HTTP callers
 * must takeBackupRestoreMemoryLease(result) and release it after serializing the
 * acknowledgement, just as they do for restoreBackup().
 */
export async function restoreApplicationBackup(fileName, options = {}) {
  const actorId = String(options.actorId ?? '').trim()
  if (!actorId) {
    throw backupFileError(
      400,
      'APPLICATION_BACKUP_REQUIRES_CONTEXT',
      'Application backup restore requires an active user context.',
    )
  }

  const info = await getBackupInfo(fileName, { actorId, kind: 'application' })
  if (!info) {
    throw backupFileError(404, 'NOT_FOUND', 'Backup file not found.')
  }
  if (!info.applicationId) {
    throw backupFileError(
      400,
      'APPLICATION_BACKUP_REQUIRES_CONTEXT',
      'Application backup metadata does not identify an application.',
    )
  }

  await ensureStorage()
  const restored = await restoreBackup(info.fileName, {
    signal: options.signal,
    store: {
      applications: [{ id: info.applicationId, ownerId: actorId }],
    },
    user: { id: actorId },
  })

  try {
    const source = restored?.application
    if (
      !source
      || source.id !== info.applicationId
      || !source.school
      || !source.professor
      || typeof source.school.name !== 'string'
      || typeof source.professor.english !== 'string'
    ) {
      throw backupFileError(
        400,
        'INVALID_APPLICATION_BACKUP',
        'Application backup payload is incomplete or does not match its metadata.',
      )
    }

    const application = {
      ...source,
      ownerId: actorId,
      updatedAt: nowStamp(),
    }
    const revision = await withWriteLock(async () => {
      throwIfBackupRestoreAborted(options.signal)
      const database = getDb()
      let committedRevision = null
      const replace = database.transaction(() => {
        const current = database.prepare(
          'SELECT id FROM applications WHERE id = ? AND owner_id = ?',
        ).get(application.id, actorId)
        if (!current) {
          throw backupFileError(404, 'NOT_FOUND', 'Application for this backup was not found.')
        }

        const upsertSchoolLogoAsset = database.prepare(
          `INSERT INTO school_logo_assets (asset_key, data_url, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(asset_key) DO UPDATE SET updated_at = excluded.updated_at`,
        )
        const storageApplication = schoolLogoApplicationForStorage(
          application,
          upsertSchoolLogoAsset,
        )
        const changed = database.prepare(
          `UPDATE applications
           SET school_name = ?,
               professor_name = ?,
               program = ?,
               deadline = ?,
               status = ?,
               progress = ?,
               priority = ?,
               updated_at = ?,
               authored_hash = ?,
               authority_hash = ?,
               payload_json = ?,
               team_id = ?
           WHERE id = ? AND owner_id = ?`,
        ).run(
          application.school.name,
          application.professor.english,
          String(application.program ?? ''),
          String(application.deadline ?? ''),
          String(application.status ?? ''),
          Number(application.progress ?? 0),
          Number(application.priority ?? 0),
          application.updatedAt,
          applicationAuthoredContentHash(storageApplication),
          JSON.stringify(applicationAuthorityContentHashes(application)),
          encodePayloadForStorage(storageApplication),
          application.teamId ?? null,
          application.id,
          actorId,
        )
        if (Number(changed.changes ?? 0) !== 1) {
          throw storeWriteConflict('application', application.id)
        }
        const restoredPayloadVersion = database.prepare(
          'SELECT payload_version FROM applications WHERE id = ?',
        ).get(application.id)?.payload_version ?? 0
        replaceWorkspaceFileReferences(
          database,
          'application',
          storageApplication,
          restoredPayloadVersion,
        )
        replaceWorkspacePublicGrants(
          database,
          'application',
          storageApplication,
          restoredPayloadVersion,
        )

        const eventTime = nowStamp()
        database.prepare(
          `INSERT INTO system_events (
             id, time, scope, actor_id, message, metadata_json
           ) VALUES (?, ?, 'Backup', ?, ?, ?)`,
        ).run(
          createId('event'),
          eventTime,
          actorId,
          `Restored backup ${info.fileName}`,
          toJson({ fileName: info.fileName, applicationId: application.id }),
        )
        committedRevision = readDurableWorkspaceRevision(database)
      })
      replace.immediate()
      invalidateSharedStoreCache()
      await synchronizeExternalDatabase({ force: true })
      return committedRevision
    })

    restored.application = application
    restored.backup = restored.backup ?? info
    restored.revision = revision
    return restored
  } catch (error) {
    takeBackupRestoreMemoryLease(restored)?.()
    throw error
  }
}

async function commitBackupDeletionIntent(backupInfo) {
  return withWriteLock(async () => {
    const database = getDb()
    if (backupInfo.actorId) await synchronizeWorkspaceBackupQuotaActor(backupInfo.actorId)
    const intent = {
      file_name: backupInfo.fileName,
      actor_id: String(backupInfo.actorId ?? ''),
      file_bytes: Math.max(0, Number(backupInfo.size) || 0),
      source_version: backupSourceVersion(backupInfo),
      requested_at: nowStamp(),
    }
    database.transaction(() => {
      clearWorkspaceQuotaSource(database, 'backup', backupInfo.fileName)
      database.prepare(
        `INSERT INTO workspace_backup_deletions (
           file_name, actor_id, file_bytes, source_version, requested_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file_name) DO UPDATE SET
           actor_id = excluded.actor_id,
           file_bytes = excluded.file_bytes,
           source_version = excluded.source_version`,
      ).run(
        intent.file_name,
        intent.actor_id,
        intent.file_bytes,
        intent.source_version,
        intent.requested_at,
      )
    }).immediate()
    try {
      // The durable source removal owns the delete before any file bytes are
      // unlinked. A crash after this point is completed by startup recovery.
      await acknowledgeDurableStorageMutation()
    } catch (error) {
      // Preserve the visible backup when the delete intent was not confirmed.
      database.transaction(() => {
        database.prepare(
          'DELETE FROM workspace_backup_deletions WHERE file_name = ?',
        ).run(backupInfo.fileName)
        if (backupInfo.actorId) syncWorkspaceQuotaBackup(database, backupInfo)
      }).immediate()
      await acknowledgeDurableStorageMutation().catch(() => undefined)
      throw error
    }
    return intent
  })
}

export async function deleteBackup(fileName) {
  await fs.mkdir(backupRoot, { recursive: true })
  const backup = resolveBackupFile(fileName)
  const backupInfo = await getBackupInfo(backup.fileName)
  if (!backupInfo) throw backupFileError(404, 'NOT_FOUND', 'Backup file not found.')

  const intent = await commitBackupDeletionIntent(backupInfo)
  const outcome = await withWorkspaceBackupDeletionDrainLock(
    () => processWorkspaceBackupDeletionIntent(intent),
  )
  if (outcome.status !== 'deleted') {
    throw outcome.error ?? backupDeletionDeferredError(
      'BACKUP_DELETION_DEFERRED',
      'The backup cleanup remains queued for retry.',
    )
  }
  return { deleted: true, fileName: backup.fileName }
}

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-size registration gate; never hydrates an account or workspace payload. */
export async function readRegistrationGate(canonicalEmail) {
  await ensureStorage()
  return readRegistrationGateRecord(getDb(), canonicalEmail)
}

/** Verify without consuming; the final transaction reclaims the same challenge. */
export async function verifyRegistrationChallenge(challenge) {
  await ensureStorage()
  let mutated = false
  const result = await withWriteLock(() => {
    const database = getDb()
    const changesBefore = Number(database.prepare('SELECT total_changes() AS count').get()?.count ?? 0)
    const outcome = verifyRegistrationChallengeTransaction(database, challenge)
    const changesAfter = Number(database.prepare('SELECT total_changes() AS count').get()?.count ?? 0)
    mutated = changesAfter > changesBefore
    return outcome
  })
  // Invalid verification attempts can consume the challenge. Persist that
  // lockout before reporting the result so a crash cannot restore attempts.
  await acknowledgeSecurityStorageMutation(mutated)
  return result
}

export async function completeRegistrationAccount(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const database = getDb()
    const projection = accountAuthProjection(input.user)
    const event = {
      id: input.event?.id ?? createId('event'),
      time: input.event?.time ?? nowStamp(),
      scope: input.event?.scope ?? 'Authentication',
      actorId: input.user.id,
      message: input.event?.message ?? 'New user registered',
      metadataJson: toJson(input.event?.metadata ?? {}),
    }
    const result = completeRegistrationTransaction(database, {
      challenge: input.challenge,
      user: {
        ...input.user,
        canonicalEmail: projection.canonicalEmail,
        recoveryEmail: projection.recoveryEmail,
        language: projection.language,
        role: normalizeUserRole(input.user.role),
        authVersion: projection.authVersion,
        settingsJson: toJson({
          ...(input.user.settings ?? {}),
          authVersion: projection.authVersion,
        }),
      },
      event,
      mailJob: input.mailJob,
    }, {
      insertSystemMailJob,
      onStage: options.onStage,
    })
    if (!result.ok) return result
    invalidateSharedStoreCache()
    return {
      ...result,
      eventId: event.id,
      mailJob: result.mail?.job ?? null,
      user: userFromRow(database.prepare('SELECT * FROM users WHERE id = ?').get(input.user.id)),
      settings: settingsFromRow(database.prepare("SELECT * FROM system_settings WHERE id = 'global'").get()),
    }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
}

/** Indexed recovery lookup preserving the legacy oldest-account tie-break. */
export async function readPasswordResetRequestCandidate(recoveryEmail) {
  await ensureStorage()
  const row = readPasswordResetCandidateRecord(getDb(), recoveryEmail)
  return row
    ? { id: row.id, recoveryEmail: row.recovery_email, language: row.language || 'en' }
    : null
}

export async function issuePasswordResetAtomic(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const database = getDb()
    const createdAt = input.createdAt ?? nowStamp()
    const event = {
      id: input.event?.id ?? createId('event'),
      time: input.event?.time ?? createdAt,
      scope: input.event?.scope ?? 'Account recovery',
      actorId: input.userId,
      message: input.event?.message ?? 'Password reset link generated',
      metadataJson: toJson(input.event?.metadata ?? { expiresAt: input.expiresAt }),
    }
    const result = issuePasswordResetTransaction(database, {
      userId: input.userId,
      recoveryEmail: input.recoveryEmail,
      tokenId: input.tokenId ?? createId('reset'),
      tokenHash: hashResetToken(input.token),
      createdAt,
      expiresAt: input.expiresAt,
      event,
      mailJob: input.mailJob,
    }, {
      insertSystemMailJob,
      onStage: options.onStage,
    })
    if (!result.ok) return result
    invalidateSharedStoreCache()
    return {
      ...result,
      eventId: event.id,
      mailJob: result.mail?.job ?? null,
    }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
}

export async function commitPasswordResetAtomic(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const completedAt = input.completedAt ?? nowStamp()
    const event = {
      id: input.event?.id ?? createId('event'),
      time: input.event?.time ?? completedAt,
      scope: input.event?.scope ?? 'Account recovery',
      message: input.event?.message ?? 'Password reset completed',
      metadataJson: toJson(input.event?.metadata ?? {}),
    }
    const result = commitPasswordResetTransaction(getDb(), {
      tokenHash: hashResetToken(input.token),
      passwordHash: input.passwordHash,
      completedAt,
      event,
    }, { onStage: options.onStage })
    if (result.ok) {
      invalidateSharedStoreCache()
    }
    return { ...result, eventId: result.ok ? event.id : null }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
}

export async function createPasswordResetToken(
  userId,
  token,
  expiresAt,
  { systemMailJobs = [] } = {},
) {
  await ensureStorage()
  const database = getDb()
  database.transaction(() => {
    database.prepare(
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
    for (const job of systemMailJobs) {
      insertSystemMailJob(database, job)
    }
  })()
  await acknowledgeSecurityStorageMutation(true)
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
  await acknowledgeSecurityStorageMutation(Boolean(row))
  return row ? { id: row.id, userId: row.user_id } : null
}

export async function markPasswordResetTokenUsed(token) {
  await ensureStorage()
  const result = getDb()
    .prepare(
      `UPDATE password_reset_tokens
       SET used_at = ?
       WHERE token_hash = ?`,
    )
    .run(nowStamp(), hashResetToken(token))
  await acknowledgeSecurityStorageMutation(Number(result.changes ?? 0) > 0)
}

export async function createSecurityChallenge(challenge, { systemMailJobs = [] } = {}) {
  await ensureStorage()
  const database = getDb()
  const now = Date.now()
  const transaction = database.transaction(() => {
    database.prepare(
      `INSERT INTO security_challenges (
        id,
        kind,
        token_hash,
        subject_hash,
        context_hash,
        verifier_hash,
        attempts,
        max_attempts,
        created_at,
        not_before_at,
        expires_at,
        consumed_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      challenge.id,
      challenge.kind,
      challenge.tokenHash,
      challenge.subjectHash || '',
      challenge.contextHash || '',
      challenge.verifierHash,
      Math.max(1, Number(challenge.maxAttempts ?? 5)),
      new Date(challenge.createdAtMs ?? now).toISOString(),
      new Date(challenge.notBeforeAtMs ?? now).toISOString(),
      new Date(challenge.expiresAtMs).toISOString(),
      toJson(challenge.metadata ?? {}),
    )
    database.prepare(
      `DELETE FROM security_challenges
       WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    ).run(
      new Date(now - 60_000).toISOString(),
      new Date(now - 60 * 60_000).toISOString(),
    )
    for (const job of systemMailJobs) {
      insertSystemMailJob(database, job)
    }
  })
  transaction()
  await acknowledgeSecurityStorageMutation(true)
}

export async function claimSecurityChallenge(input) {
  await ensureStorage()
  const database = getDb()
  const nowMs = Number(input.nowMs ?? Date.now())
  const now = new Date(nowMs).toISOString()
  let mutated = false
  const transaction = database.transaction(() => {
    const row = database.prepare(
      `SELECT *
       FROM security_challenges
       WHERE token_hash = ? AND kind = ?`,
    ).get(input.tokenHash, input.kind)

    if (!row || row.consumed_at || row.expires_at <= now || row.not_before_at > now) {
      return { ok: false, reason: 'invalid' }
    }

    const digestMatches = (left, right) => {
      const leftBuffer = Buffer.from(String(left ?? ''))
      const rightBuffer = Buffer.from(String(right ?? ''))
      return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
    }
    const identityMatches = digestMatches(row.subject_hash, input.subjectHash)
      && digestMatches(row.context_hash, input.contextHash)
    const verifierMatches = digestMatches(row.verifier_hash, input.verifierHash)
    if (!identityMatches || !verifierMatches) {
      const attempts = Number(row.attempts ?? 0) + 1
      const consumedAt = attempts >= Number(row.max_attempts) ? now : null
      const updated = database.prepare(
        `UPDATE security_challenges
         SET attempts = ?, consumed_at = COALESCE(consumed_at, ?)
         WHERE id = ?`,
      ).run(attempts, consumedAt, row.id)
      mutated = Number(updated.changes ?? 0) > 0
      return { ok: false, reason: 'invalid' }
    }

    const claimed = database.prepare(
      `UPDATE security_challenges
       SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL
       RETURNING id`,
    ).get(now, row.id)
    mutated = Boolean(claimed)
    return claimed ? { ok: true, id: claimed.id } : { ok: false, reason: 'invalid' }
  })
  const result = transaction()
  await acknowledgeSecurityStorageMutation(mutated)
  return result
}

const INITIAL_BOOTSTRAP_CLAIM_KIND = 'initial-setup-bootstrap-access'

function constantTimeDigestMatches(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * Atomically binds first-run setup to one browser client. Only digests are
 * stored; the out-of-band operator token and short-lived access token never
 * enter the workspace snapshot, logs, or database in plaintext.
 */
export async function acquireInitialBootstrapClaim(input) {
  await ensureStorage()
  const database = getDb()
  const nowMs = Number(input.nowMs ?? Date.now())
  const now = new Date(nowMs).toISOString()
  const expiresAtMs = Math.max(nowMs + 60_000, Number(input.expiresAtMs ?? nowMs + 2 * 60 * 60_000))
  const expiresAt = new Date(expiresAtMs).toISOString()
  const transaction = database.transaction(() => {
    database.prepare(
      `DELETE FROM security_challenges
       WHERE kind = ? AND (consumed_at IS NOT NULL OR expires_at <= ?)`,
    ).run(INITIAL_BOOTSTRAP_CLAIM_KIND, now)
    const existing = database.prepare(
      `SELECT id, token_hash, subject_hash, context_hash, expires_at
       FROM security_challenges
       WHERE kind = ? AND consumed_at IS NULL AND expires_at > ?
       ORDER BY created_at ASC
       LIMIT 1`,
    ).get(INITIAL_BOOTSTRAP_CLAIM_KIND, now)
    if (existing) {
      const sameOperatorToken = constantTimeDigestMatches(existing.subject_hash, input.subjectHash)
      const sameClaimant = sameOperatorToken
        && constantTimeDigestMatches(existing.token_hash, input.tokenHash)
        && constantTimeDigestMatches(existing.context_hash, input.contextHash)
      if (sameClaimant) return { ok: true, resumed: true, expiresAt: existing.expires_at }
      if (sameOperatorToken) return { ok: false, reason: 'claimed' }
      // Rotating the operator-controlled environment token is the explicit
      // recovery mechanism for a lost browser claim. Retire the old binding
      // atomically before inserting the replacement below.
      database.prepare(
        `UPDATE security_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
      ).run(now, existing.id)
    }
    database.prepare(
      `INSERT INTO security_challenges (
        id, kind, token_hash, subject_hash, context_hash, verifier_hash,
        attempts, max_attempts, created_at, not_before_at, expires_at,
        consumed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, '', 0, 1, ?, ?, ?, NULL, '{}')`,
    ).run(
      `bootstrap_${randomUUID()}`,
      INITIAL_BOOTSTRAP_CLAIM_KIND,
      input.tokenHash,
      input.subjectHash,
      input.contextHash,
      now,
      now,
      expiresAt,
    )
    return { ok: true, resumed: false, expiresAt }
  })
  const result = transaction()
  await acknowledgeSecurityStorageMutation(result.ok && !result.resumed)
  return result
}

export async function verifyInitialBootstrapClaim(input) {
  await ensureStorage()
  const now = new Date(Number(input.nowMs ?? Date.now())).toISOString()
  const row = getDb().prepare(
    `SELECT token_hash, subject_hash, context_hash, expires_at
     FROM security_challenges
     WHERE kind = ? AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at ASC
     LIMIT 1`,
  ).get(INITIAL_BOOTSTRAP_CLAIM_KIND, now)
  if (!row) return { ok: false, reason: 'invalid' }
  const ok = constantTimeDigestMatches(row.token_hash, input.tokenHash)
    && constantTimeDigestMatches(row.subject_hash, input.subjectHash)
    && constantTimeDigestMatches(row.context_hash, input.contextHash)
  return ok
    ? { ok: true, expiresAt: row.expires_at }
    : { ok: false, reason: 'invalid' }
}

export async function consumeInitialBootstrapClaim(input) {
  await ensureStorage()
  const now = nowStamp()
  const row = getDb().prepare(
    `SELECT id, token_hash, context_hash
     FROM security_challenges
     WHERE kind = ? AND consumed_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
  ).get(INITIAL_BOOTSTRAP_CLAIM_KIND)
  if (
    !row
    || !constantTimeDigestMatches(row.token_hash, input.tokenHash)
    || !constantTimeDigestMatches(row.context_hash, input.contextHash)
  ) return false
  const consumed = Number(getDb().prepare(
    `UPDATE security_challenges
     SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL`,
  ).run(now, row.id).changes ?? 0) === 1
  await acknowledgeSecurityStorageMutation(consumed)
  return consumed
}

function normalizeSecurityRateLimitEntry(entry) {
  return {
    keyHash: String(entry.keyHash),
    bucketName: String(entry.bucketName),
    windowMs: Math.max(1_000, Number(entry.windowMs)),
    max: Math.max(1, Number(entry.max)),
    blockMs: Math.max(1_000, Number(entry.blockMs ?? entry.windowMs)),
  }
}

const MAX_SECURITY_RATE_LIMIT_ROWS = 100_000
const SECURITY_RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60_000

export async function consumeSecurityRateLimits(entries, options = {}) {
  await ensureStorage()
  const database = getDb()
  const nowMs = Number(options.nowMs ?? Date.now())
  const increment = options.increment !== false
  const normalized = entries.map(normalizeSecurityRateLimitEntry)
  const transaction = database.transaction(() => {
    const rows = normalized.map((entry) => {
      const existing = database.prepare(
        `SELECT key_hash, window_started_at, count, blocked_until
         FROM security_rate_limits
         WHERE key_hash = ?`,
      ).get(entry.keyHash)
      const windowExpired = !existing || nowMs - Number(existing.window_started_at) >= entry.windowMs
      return {
        entry,
        windowExpired,
        count: windowExpired ? 0 : Number(existing.count),
        windowStartedAt: windowExpired ? nowMs : Number(existing.window_started_at),
        blockedUntil: windowExpired ? 0 : Number(existing.blocked_until),
      }
    })
    const denied = rows.find(({ entry, count, blockedUntil }) => blockedUntil > nowMs || count >= entry.max)
    if (denied) {
      const retryAt = Math.max(
        denied.blockedUntil,
        denied.windowStartedAt + denied.entry.windowMs,
      )
      return {
        allowed: false,
        bucketName: denied.entry.bucketName,
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - nowMs) / 1000)),
      }
    }

    if (increment) {
      const statement = database.prepare(
        `INSERT INTO security_rate_limits (
          key_hash,
          bucket_name,
          window_started_at,
          count,
          blocked_until,
          updated_at
        ) VALUES (?, ?, ?, 1, 0, ?)
        ON CONFLICT(key_hash) DO UPDATE SET
          bucket_name = excluded.bucket_name,
          window_started_at = excluded.window_started_at,
          count = security_rate_limits.count + 1,
          blocked_until = CASE
            WHEN security_rate_limits.count + 1 >= ?
              THEN MAX(security_rate_limits.blocked_until, ?)
            ELSE security_rate_limits.blocked_until
          END,
          updated_at = excluded.updated_at`,
      )
      for (const row of rows) {
        if (row.windowExpired) {
          database.prepare('DELETE FROM security_rate_limits WHERE key_hash = ?').run(row.entry.keyHash)
        }
        statement.run(
          row.entry.keyHash,
          row.entry.bucketName,
          row.windowStartedAt,
          nowMs,
          row.entry.max,
          nowMs + row.entry.blockMs,
        )
      }
      database.prepare(
        'DELETE FROM security_rate_limits WHERE updated_at < ?',
      ).run(nowMs - SECURITY_RATE_LIMIT_RETENTION_MS)
      const rowCount = Number(
        database.prepare('SELECT COUNT(*) AS count FROM security_rate_limits').get()?.count ?? 0,
      )
      if (rowCount > MAX_SECURITY_RATE_LIMIT_ROWS) {
        database.prepare(
          `DELETE FROM security_rate_limits
           WHERE key_hash IN (
             SELECT key_hash
             FROM security_rate_limits
             ORDER BY updated_at ASC, key_hash ASC
             LIMIT ?
           )`,
        ).run(rowCount - MAX_SECURITY_RATE_LIMIT_ROWS)
      }
    }
    return { allowed: true }
  })
  return transaction()
}

export async function clearSecurityRateLimits(keyHashes) {
  await ensureStorage()
  const normalized = [...new Set(keyHashes.map((value) => String(value)).filter(Boolean))]
  if (normalized.length === 0) return
  const database = getDb()
  const statement = database.prepare('DELETE FROM security_rate_limits WHERE key_hash = ?')
  database.transaction(() => {
    for (const keyHash of normalized) statement.run(keyHash)
  })()
}

export async function recordSecurityEvent(message, metadata = {}) {
  await ensureStorage()
  const database = getDb()
  database.prepare(
    `INSERT INTO system_events (
      id,
      time,
      scope,
      actor_id,
      message,
      metadata_json
    ) VALUES (?, ?, 'Security', NULL, ?, ?)`,
  ).run(createId('event'), nowStamp(), String(message).slice(0, 500), toJson(metadata))
  const retention = database
    .prepare('SELECT system_log_retention_days FROM system_settings WHERE id = ?')
    .get('global')
  const retentionCutoff = systemLogRetentionCutoff(retention?.system_log_retention_days)
  if (retentionCutoff) {
    database.prepare('DELETE FROM system_events WHERE time < ?').run(retentionCutoff)
  }
  invalidateSharedStoreCache()
  scheduleExternalDatabaseSync()
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

/** Indexed account hint used by passkey options; never hydrates a workspace. */
export async function readWebAuthnLoginOptionsAccount(email, scope = 'app') {
  await ensureStorage()
  const row = getDb().prepare(
    `SELECT id, email, role, disabled_at
       FROM users WHERE canonical_email = ? LIMIT 1`,
  ).get(String(email ?? '').trim().toLowerCase())
  if (
    !row
    || row.disabled_at
    || (scope === 'admin' && normalizeUserRole(row.role) !== 'admin')
  ) return null
  return {
    id: row.id,
    email: row.email,
    role: normalizeUserRole(row.role),
  }
}

/** Credential plus the constant-size account guard needed before signature verification. */
export async function readWebAuthnAuthenticationCandidate(credentialId) {
  await ensureStorage()
  const row = getDb().prepare(
    `SELECT passkey.*,
            account.name AS account_name,
            account.email AS account_email,
            account.role AS account_role,
            account.disabled_at AS account_disabled_at,
            account.created_at AS account_created_at,
            account.last_login_at AS account_last_login_at,
            account.language AS account_language,
            account.auth_version AS account_auth_version
       FROM webauthn_passkeys passkey
       JOIN users account ON account.id = passkey.user_id
      WHERE passkey.credential_id = ?
      LIMIT 1`,
  ).get(String(credentialId ?? ''))
  if (!row) return null
  return {
    passkey: passkeyFromRow(row, true),
    credentialGuard: {
      id: row.id,
      userId: row.user_id,
      credentialId: row.credential_id,
      publicKey: row.public_key,
      counter: Number(row.counter ?? 0),
    },
    user: {
      id: row.user_id,
      name: row.account_name,
      email: row.account_email,
      role: normalizeUserRole(row.account_role),
      disabledAt: row.account_disabled_at,
      createdAt: row.account_created_at,
      lastLoginAt: row.account_last_login_at,
      settings: {
        language: row.account_language || 'en',
        authVersion: normalizeAccountAuthVersion(row.account_auth_version),
      },
    },
    userGuard: {
      id: row.user_id,
      role: row.account_role,
      authVersion: normalizeAccountAuthVersion(row.account_auth_version),
    },
  }
}

/** Reads a valid challenge without consuming it; commit performs the final CAS. */
export async function readWebAuthnChallengeCandidate(input) {
  await ensureStorage()
  return readWebAuthnChallengeRecord(getDb(), {
    purpose: input.purpose,
    challengeHash: hashWebAuthnChallenge(input.challenge),
    at: input.at ?? nowStamp(),
  })
}

function passkeyAuditEvent({ actorId, message, metadata = {}, at = nowStamp() }) {
  return {
    id: createId('event'),
    time: at,
    scope: 'Authentication',
    actorId,
    message,
    metadataJson: toJson(metadata),
  }
}

export async function commitWebAuthnAuthentication(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const database = getDb()
    const completedAt = input.completedAt ?? nowStamp()
    const event = passkeyAuditEvent({
      actorId: input.user.id,
      message: 'User signed in with passkey',
      metadata: { scope: input.scope === 'admin' ? 'admin' : 'app' },
      at: completedAt,
    })
    const result = commitWebAuthnAuthenticationTransaction(database, {
      challenge: {
        id: input.challenge.id,
        purpose: 'authentication',
        challengeHash: input.challenge.challengeHash,
        at: completedAt,
        expectedMetadata: input.challenge.expectedMetadata,
      },
      credential: input.credential,
      user: input.user,
      scope: input.scope === 'admin' ? 'admin' : 'app',
      passkeyUpdate: input.passkeyUpdate,
      completedAt,
      event,
    }, { onStage: options.onStage })
    if (!result.ok) return result
    invalidateSharedStoreCache()
    return {
      ...result,
      eventId: event.id,
      user: readFocusedSessionAccountFromDatabase(database, result.userId),
      passkey: passkeyFromRow(database.prepare(
        'SELECT * FROM webauthn_passkeys WHERE id = ?',
      ).get(result.passkeyId)),
    }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
}

export async function commitWebAuthnRegistration(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const database = getDb()
    const createdAt = input.createdAt ?? nowStamp()
    const passkeyId = input.passkey.id ?? createId('passkey')
    const event = passkeyAuditEvent({
      actorId: input.user.id,
      message: 'Passkey added',
      metadata: { passkeyId },
      at: createdAt,
    })
    const result = commitWebAuthnRegistrationTransaction(database, {
      challenge: {
        id: input.challenge.id,
        purpose: 'registration',
        challengeHash: input.challenge.challengeHash,
        at: createdAt,
        expectedMetadata: input.challenge.expectedMetadata,
      },
      user: input.user,
      passkey: {
        ...input.passkey,
        id: passkeyId,
        publicKey: Buffer.from(input.passkey.publicKey).toString('base64url'),
        transportsJson: toJson(normalizePasskeyTransports(input.passkey.transports)),
      },
      createdAt,
      event,
    }, { onStage: options.onStage })
    if (!result.ok) return result
    invalidateSharedStoreCache()
    return {
      ...result,
      eventId: event.id,
      passkey: passkeyFromRow(database.prepare(
        'SELECT * FROM webauthn_passkeys WHERE id = ?',
      ).get(result.passkeyId)),
    }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
}

export async function renameWebAuthnPasskeyAtomic(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const database = getDb()
    const event = passkeyAuditEvent({
      actorId: input.user.id,
      message: 'Passkey renamed',
      metadata: { passkeyId: input.passkeyId, label: input.label },
    })
    const result = renameWebAuthnPasskeyTransaction(database, {
      user: input.user,
      passkeyId: input.passkeyId,
      label: input.label,
      event,
    }, { onStage: options.onStage })
    if (!result.ok) return result
    invalidateSharedStoreCache()
    return {
      ...result,
      eventId: event.id,
      passkey: passkeyFromRow(database.prepare(
        'SELECT * FROM webauthn_passkeys WHERE id = ?',
      ).get(result.passkeyId)),
    }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
}

export async function deleteWebAuthnPasskeyAtomic(input, options = {}) {
  await ensureStorage()
  const result = await withWriteLock(async () => {
    const event = passkeyAuditEvent({
      actorId: input.user.id,
      message: 'Passkey removed',
      metadata: { passkeyId: input.passkeyId },
    })
    const result = deleteWebAuthnPasskeyTransaction(getDb(), {
      user: input.user,
      passkeyId: input.passkeyId,
      event,
    }, { onStage: options.onStage })
    if (!result.ok) return result
    invalidateSharedStoreCache()
    return { ...result, eventId: event.id, id: result.passkeyId }
  })
  await acknowledgeSecurityStorageMutation(result.ok)
  return result
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
  const passkey = passkeyFromRow(getDb().prepare('SELECT * FROM webauthn_passkeys WHERE id = ?').get(id))
  await acknowledgeSecurityStorageMutation(true)
  return passkey
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
  await acknowledgeSecurityStorageMutation(Boolean(row))
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
  await acknowledgeSecurityStorageMutation(Boolean(row))
  return passkeyFromRow(row)
}

export async function deleteWebAuthnPasskey(userId, passkeyId) {
  await ensureStorage()
  const row = getDb()
    .prepare('DELETE FROM webauthn_passkeys WHERE user_id = ? AND id = ? RETURNING id')
    .get(userId, passkeyId)
  await acknowledgeSecurityStorageMutation(Boolean(row))
  return row ? { id: row.id } : null
}

export async function createWebAuthnChallenge(input) {
  await ensureStorage()
  const database = getDb()
  const now = nowStamp()
  const createChallenge = database.transaction(() => {
    database
      .prepare('DELETE FROM webauthn_challenges WHERE used_at IS NOT NULL OR expires_at <= ?')
      .run(now)
    database.prepare(
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
  })
  createChallenge.immediate()
  await acknowledgeSecurityStorageMutation(true)
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
  await acknowledgeSecurityStorageMutation(Boolean(row))
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    metadata: fromJson(row.metadata_json, {}),
  }
}

const mailFetchStateStatements = new WeakMap()

export async function getMailFetchState(userId) {
  await ensureStorage()
  const database = getDb()
  let statement = mailFetchStateStatements.get(database)
  if (!statement) {
    statement = database.prepare('SELECT * FROM mail_fetch_state WHERE user_id = ?')
    mailFetchStateStatements.set(database, statement)
  }
  const row = statement.get(userId)
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
        status: row.sync_job_status === 'committing' ? 'running' : row.sync_job_status ?? 'queued',
        createdAt: row.sync_job_created_at,
        startedAt: row.sync_job_started_at ?? null,
        completedAt: row.sync_job_status === 'committing' ? null : row.sync_job_completed_at ?? null,
        result: row.sync_job_status === 'committing' ? null : fromJson(row.sync_job_result_json, null),
        errorCode: row.sync_job_status === 'committing' ? null : row.sync_job_error_code ?? null,
        errorMessage: row.sync_job_status === 'committing' ? null : row.sync_job_error_message ?? null,
        attemptCount: Number(row.sync_job_attempt_count ?? 0),
        nextAttemptAt: row.sync_job_next_attempt_at ?? null,
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null)
  const result = Object.create(null)
  for (const [path, state] of Object.entries(value).slice(0, 256)) {
    if (!state || typeof state !== 'object') continue
    const lastUid = Number(state.lastUid ?? 0)
    result[path] = {
      uidValidity: state.uidValidity ? String(state.uidValidity).slice(0, 128) : null,
      lastUid: Number.isSafeInteger(lastUid) && lastUid > 0 ? lastUid : 0,
    }
  }
  return result
}

const MAX_MAIL_SYNC_CONTINUATION_BYTES = 512 * 1024
const MAIL_SYNC_CONTINUATION_TOTAL_FIELDS = [
  'fetched',
  'filed',
  'incoming',
  'outgoing',
  'caution',
  'danger',
  'duplicates',
  'ignored',
  'skippedOversized',
  'scannedUids',
]

function normalizeMailSyncJobContinuation(value, { stamp = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const folderStates = normalizedMailFolderStates(value.folderStates)
  const mode = value.mode === 'history' ? 'history' : value.mode === 'incremental' ? 'incremental' : null
  const accountKey = String(value.accountKey ?? '').slice(0, 512)
  const mailSyncGeneration = String(value.mailSyncGeneration ?? '').slice(0, 512)
  const whitelistDigest = String(value.whitelistDigest ?? '').slice(0, 256)
  if (!mode || !accountKey || Object.keys(folderStates).length === 0) return {}
  const totals = {}
  for (const field of MAIL_SYNC_CONTINUATION_TOTAL_FIELDS) {
    const count = Number(value.totals?.[field] ?? 0)
    totals[field] = Number.isSafeInteger(count) && count > 0 ? count : 0
  }
  const continuation = {
    version: 1,
    accountKey,
    mode,
    mailSyncGeneration,
    whitelistDigest,
    folderStates,
    totals,
    updatedAt: stamp ? nowStamp() : String(value.updatedAt ?? '').slice(0, 64) || null,
  }
  if (Buffer.byteLength(toJson(continuation), 'utf8') > MAX_MAIL_SYNC_CONTINUATION_BYTES) {
    throw new RangeError('Mail sync continuation exceeds the bounded storage size.')
  }
  return continuation
}

export async function saveMailFetchState(userId, patch, options = {}) {
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
         sync_job_error_message,
         sync_job_attempt_count,
         sync_job_next_attempt_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         sync_job_error_message = excluded.sync_job_error_message,
         sync_job_attempt_count = excluded.sync_job_attempt_count,
         sync_job_next_attempt_at = excluded.sync_job_next_attempt_at`,
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
      Number(next.syncJob?.attemptCount ?? 0),
      next.syncJob?.nextAttemptAt ?? null,
    )
  if (!options.deferDurableAck) await acknowledgeDurableStorageMutation()
  return next
}

function mailSyncJobFromRow(row, { includeContinuation = false } = {}) {
  if (!row?.sync_job_id) return null
  const committing = row.sync_job_status === 'committing'
  return {
    id: row.sync_job_id,
    userId: row.user_id,
    mode: row.sync_job_mode === 'history' ? 'history' : 'incremental',
    status: committing ? 'running' : row.sync_job_status ?? 'queued',
    createdAt: row.sync_job_created_at,
    startedAt: row.sync_job_started_at ?? null,
    completedAt: committing ? null : row.sync_job_completed_at ?? null,
    result: committing ? null : fromJson(row.sync_job_result_json, null),
    errorCode: committing ? null : row.sync_job_error_code ?? null,
    errorMessage: committing ? null : row.sync_job_error_message ?? null,
    attemptCount: Number(row.sync_job_attempt_count ?? 0),
    nextAttemptAt: row.sync_job_next_attempt_at ?? null,
    ...(includeContinuation
      ? { continuation: normalizeMailSyncJobContinuation(fromJson(row.sync_job_resume_json, {})) }
      : {}),
  }
}

function mailSyncSuccessorJobFromRow(row) {
  if (!row?.sync_successor_job_id) return null
  return {
    id: row.sync_successor_job_id,
    userId: row.user_id,
    mode: row.sync_successor_job_mode === 'history' ? 'history' : 'incremental',
    status: 'queued',
    createdAt: row.sync_successor_job_created_at,
    startedAt: null,
    completedAt: null,
    result: null,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    nextAttemptAt: null,
  }
}

function createQueuedMailSyncJob(userId, mode) {
  return {
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
    attemptCount: 0,
    nextAttemptAt: null,
  }
}

/**
 * Allocate a durable FIFO position for a runnable mail-sync job. Callers hold
 * an IMMEDIATE transaction, so MAX + 1 is serialized across concurrent
 * enqueues and retries. Retried work receives a fresh position at the tail;
 * its original createdAt remains untouched for audit/UI purposes.
 */
function nextMailSyncScheduleSequence(database) {
  const row = database.prepare(
    'SELECT COALESCE(MAX(sync_job_schedule_sequence), 0) AS value FROM mail_fetch_state',
  ).get()
  const current = Number(row?.value ?? 0)
  if (Number.isSafeInteger(current) && current >= 0 && current < Number.MAX_SAFE_INTEGER - 1) {
    return current + 1
  }

  // This is only an integer-exhaustion/corrupt-value recovery path. Preserve
  // every existing relative schedule position before allocating the new tail.
  const scheduledRows = database.prepare(
    `SELECT user_id
     FROM mail_fetch_state
     ORDER BY CASE WHEN sync_job_schedule_sequence > 0 THEN 0 ELSE 1 END,
              sync_job_schedule_sequence ASC,
              COALESCE(sync_job_created_at, '') ASC,
              user_id ASC`,
  ).all()
  const resequence = database.prepare(
    'UPDATE mail_fetch_state SET sync_job_schedule_sequence = ? WHERE user_id = ?',
  )
  let sequence = 0
  for (const scheduledRow of scheduledRows) {
    sequence += 1
    resequence.run(sequence, scheduledRow.user_id)
  }
  return sequence + 1
}

function promoteMailSyncSuccessor(database, row) {
  const successor = mailSyncSuccessorJobFromRow(row)
  if (!successor) return null
  const scheduleSequence = nextMailSyncScheduleSequence(database)
  const promoted = database.prepare(
    `UPDATE mail_fetch_state
     SET sync_job_id = sync_successor_job_id,
         sync_job_mode = sync_successor_job_mode,
         sync_job_status = 'queued',
         sync_job_terminal_status = NULL,
         sync_job_created_at = sync_successor_job_created_at,
         sync_job_started_at = NULL,
         sync_job_completed_at = NULL,
         sync_job_result_json = '{}',
         sync_job_error_code = NULL,
         sync_job_error_message = NULL,
         sync_job_attempt_count = 0,
         sync_job_schedule_sequence = ?,
         sync_job_next_attempt_at = NULL,
         sync_job_resume_json = '{}',
         sync_successor_job_id = NULL,
         sync_successor_job_mode = NULL,
         sync_successor_job_created_at = NULL
     WHERE user_id = ? AND sync_job_id = ?
       AND sync_job_status IN ('queued', 'running')
       AND sync_successor_job_id = ?`,
  ).run(scheduleSequence, row.user_id, row.sync_job_id, successor.id)
  return promoted.changes > 0 ? successor : null
}

/**
 * Persist browser-independent mail sync work per user. A queued incremental
 * request can be upgraded in place; a running incremental request receives one
 * durable, coalesced history successor so the stronger request is never lost.
 */
function enqueueMailSyncJobInTransaction(
  database,
  userId,
  requestedMode,
  allocateScheduleSequence,
  { preserveRetryDelay = false } = {},
) {
    const current = database.prepare('SELECT * FROM mail_fetch_state WHERE user_id = ?').get(userId)
    const currentJob = mailSyncJobFromRow(current)
    const currentStatus = current?.sync_job_status
    if (currentJob && ['queued', 'running', 'committing'].includes(currentStatus)) {
      if (currentStatus === 'queued') {
        const upgradedMode = requestedMode === 'history' ? 'history' : currentJob.mode
        const modeUpgraded = upgradedMode !== currentJob.mode
        if ((currentJob.nextAttemptAt && !preserveRetryDelay) || modeUpgraded) {
          database.prepare(
            `UPDATE mail_fetch_state
             SET sync_job_resume_json = CASE WHEN sync_job_mode <> ? THEN '{}' ELSE sync_job_resume_json END,
                 sync_job_mode = ?,
                 sync_job_next_attempt_at = CASE WHEN ? THEN sync_job_next_attempt_at ELSE NULL END,
                 sync_job_error_code = CASE WHEN ? THEN sync_job_error_code ELSE NULL END,
                 sync_job_error_message = CASE WHEN ? THEN sync_job_error_message ELSE NULL END
             WHERE user_id = ? AND sync_job_id = ? AND sync_job_status = 'queued'`,
          ).run(
            upgradedMode,
            upgradedMode,
            preserveRetryDelay && !modeUpgraded ? 1 : 0,
            preserveRetryDelay && !modeUpgraded ? 1 : 0,
            preserveRetryDelay && !modeUpgraded ? 1 : 0,
            userId,
            currentJob.id,
          )
          currentJob.mode = upgradedMode
          if (!preserveRetryDelay || modeUpgraded) {
            currentJob.nextAttemptAt = null
            currentJob.errorCode = null
            currentJob.errorMessage = null
          }
        }
        return { job: currentJob, alreadyQueued: true }
      }

      if (currentStatus === 'running' && requestedMode === 'history' && currentJob.mode === 'incremental') {
        const existingSuccessor = mailSyncSuccessorJobFromRow(current)
        if (existingSuccessor) return { job: existingSuccessor, alreadyQueued: true }

        const successor = createQueuedMailSyncJob(userId, 'history')
        database.prepare(
          `UPDATE mail_fetch_state
           SET sync_successor_job_id = ?,
               sync_successor_job_mode = ?,
               sync_successor_job_created_at = ?
           WHERE user_id = ? AND sync_job_id = ? AND sync_job_status = 'running'
             AND sync_successor_job_id IS NULL`,
        ).run(successor.id, successor.mode, successor.createdAt, userId, currentJob.id)
        return { job: successor, alreadyQueued: false }
      }

      return { job: currentJob, alreadyQueued: true }
    }

    const job = createQueuedMailSyncJob(userId, requestedMode)
    const scheduleSequence = allocateScheduleSequence()
    database.prepare(
      `INSERT INTO mail_fetch_state (
         user_id, protocol, sync_job_id, sync_job_mode, sync_job_status,
         sync_job_created_at, sync_job_result_json, sync_job_schedule_sequence
       ) VALUES (?, 'imap', ?, ?, 'queued', ?, '{}', ?)
       ON CONFLICT(user_id) DO UPDATE SET
         sync_job_id = excluded.sync_job_id,
         sync_job_mode = excluded.sync_job_mode,
         sync_job_status = excluded.sync_job_status,
         sync_job_terminal_status = NULL,
         sync_job_created_at = excluded.sync_job_created_at,
         sync_job_started_at = NULL,
         sync_job_completed_at = NULL,
         sync_job_result_json = '{}',
         sync_job_error_code = NULL,
         sync_job_error_message = NULL,
         sync_job_attempt_count = 0,
         sync_job_schedule_sequence = excluded.sync_job_schedule_sequence,
         sync_job_next_attempt_at = NULL,
         sync_job_resume_json = '{}',
         sync_successor_job_id = NULL,
         sync_successor_job_mode = NULL,
         sync_successor_job_created_at = NULL`,
    ).run(userId, job.id, job.mode, job.createdAt, scheduleSequence)
    return { job, alreadyQueued: false }
}

export async function enqueueMailSyncJob(userId, mode) {
  await ensureStorage()
  const database = getDb()
  const requestedMode = mode === 'history' ? 'history' : 'incremental'
  const enqueue = database.transaction(() => enqueueMailSyncJobInTransaction(
    database,
    userId,
    requestedMode,
    () => nextMailSyncScheduleSequence(database),
  ))
  const result = enqueue.immediate()
  await acknowledgeDurableStorageMutation()
  return result
}

export async function listAutoMailSyncUserIds() {
  await ensureStorage()
  // Keep the recurring scheduler's JS working set proportional to enabled
  // account ids, not to every account's potentially large trash/settings JSON.
  // SQLite evaluates the scalar predicate row-by-row and returns only ids.
  return getDb().prepare(
    `SELECT id
       FROM users
      WHERE disabled_at IS NULL
        AND COALESCE(CAST(json_extract(settings_json, '$.autoFetchMail') AS INTEGER), 0) <> 0
      ORDER BY created_at ASC, id ASC`,
  ).all().map((row) => row.id)
}

export async function enqueueMailSyncJobs(userIds, mode = 'incremental', options = {}) {
  await ensureStorage()
  const database = getDb()
  const requestedMode = mode === 'history' ? 'history' : 'incremental'
  const uniqueUserIds = [...new Set((userIds ?? []).map((value) => String(value ?? '')).filter(Boolean))]
  if (uniqueUserIds.length === 0) return []
  const enqueue = database.transaction(() => {
    let nextSequence = nextMailSyncScheduleSequence(database)
    const allocateScheduleSequence = () => nextSequence++
    return uniqueUserIds.map((userId) => enqueueMailSyncJobInTransaction(
      database,
      userId,
      requestedMode,
      allocateScheduleSequence,
      options,
    ))
  })
  const results = enqueue.immediate()
  await acknowledgeDurableStorageMutation()
  return results
}

export async function claimNextMailSyncJob(jobId = null) {
  await ensureStorage()
  const database = getDb()
  const claim = database.transaction(() => {
    const row = jobId
      ? database.prepare(
          `SELECT * FROM mail_fetch_state
           WHERE sync_job_status = 'queued' AND sync_job_id = ?
             AND (sync_job_next_attempt_at IS NULL OR sync_job_next_attempt_at <= ?)
           LIMIT 1`,
        ).get(jobId, nowStamp())
      : database.prepare(
          `SELECT * FROM mail_fetch_state
           WHERE sync_job_status = 'queued'
             AND (sync_job_next_attempt_at IS NULL OR sync_job_next_attempt_at <= ?)
           ORDER BY sync_job_schedule_sequence ASC,
                    sync_job_created_at ASC,
                    user_id ASC
           LIMIT 1`,
        ).get(nowStamp())
    if (!row) return null
    const startedAt = nowStamp()
    const claimed = database.prepare(
      `UPDATE mail_fetch_state
       SET sync_job_status = 'running', sync_job_started_at = ?,
           sync_job_terminal_status = NULL,
           sync_job_attempt_count = sync_job_attempt_count + 1,
           sync_job_next_attempt_at = NULL
       WHERE user_id = ? AND sync_job_id = ? AND sync_job_status = 'queued'`,
    ).run(startedAt, row.user_id, row.sync_job_id)
    if (claimed.changes === 0) return null
    return mailSyncJobFromRow({
      ...row,
      sync_job_status: 'running',
      sync_job_started_at: startedAt,
      sync_job_attempt_count: Number(row.sync_job_attempt_count ?? 0) + 1,
      sync_job_next_attempt_at: null,
    }, { includeContinuation: true })
  })
  return claim.immediate()
}

/**
 * Persist a job-private continuation only while the same durable claim is
 * still running. This is deliberately separate from authoritative
 * folder_states_json: partial progress must survive a time-slice retry without
 * changing first-sync or completed-history semantics exposed to the user.
 */
export async function saveMailSyncJobContinuation(jobId, userId, value, options = {}) {
  await ensureStorage()
  const continuation = normalizeMailSyncJobContinuation(value, { stamp: true })
  if (Object.keys(continuation).length === 0) {
    throw new TypeError('A valid mail sync continuation is required.')
  }
  const updated = getDb().prepare(
    `UPDATE mail_fetch_state
     SET sync_job_resume_json = ?
     WHERE user_id = ? AND sync_job_id = ? AND sync_job_status = 'running'`,
  ).run(toJson(continuation), userId, jobId)
  // Even a superseded/no-op continuation must flush a preceding deferred
  // business-store write. This closes the duplicate-replay hole after an
  // uncertain external commit: the local message and its checkpoint advance
  // together, or neither is acknowledged to the worker.
  if (!options.deferDurableAck) {
    await acknowledgeDurableStorageMutation()
  }
  return updated.changes > 0 ? continuation : null
}

export async function finishMailSyncJob(jobId, { status, result = null, errorCode = null, errorMessage = null }) {
  await ensureStorage()
  const database = getDb()
  const completedAt = nowStamp()
  const terminalStatus = ['succeeded', 'failed', 'cancelled'].includes(status) ? status : 'failed'
  const finish = database.transaction(() => {
    const row = database.prepare(
      `SELECT * FROM mail_fetch_state
       WHERE sync_job_id = ? AND sync_job_status IN ('queued', 'running', 'committing')`,
    ).get(jobId)
    if (!row) return null

    if (row.sync_job_status === 'committing') {
      const pendingTerminalStatus = ['succeeded', 'failed', 'cancelled'].includes(row.sync_job_terminal_status)
        ? row.sync_job_terminal_status
        : 'failed'
      return {
        completedJob: mailSyncJobFromRow({
          ...row,
          sync_job_status: pendingTerminalStatus,
        }),
        requiresFinalize: true,
      }
    }

    const completedJob = mailSyncJobFromRow({
      ...row,
      sync_job_status: terminalStatus,
      sync_job_completed_at: completedAt,
      sync_job_result_json: toJson(result ?? {}),
      sync_job_error_code: errorCode,
      sync_job_error_message: errorMessage,
      sync_job_next_attempt_at: null,
    })
    if (promoteMailSyncSuccessor(database, row)) {
      return { completedJob, requiresFinalize: false }
    }

    const updated = database.prepare(
      `UPDATE mail_fetch_state
       SET sync_job_status = 'committing', sync_job_terminal_status = ?,
           sync_job_completed_at = ?, sync_job_result_json = ?,
           sync_job_error_code = ?, sync_job_error_message = ?,
           sync_job_next_attempt_at = NULL,
           sync_job_resume_json = '{}'
       WHERE sync_job_id = ? AND sync_job_status IN ('queued', 'running')`,
    ).run(terminalStatus, completedAt, toJson(result ?? {}), errorCode, errorMessage, jobId)
    return updated.changes > 0 ? { completedJob, requiresFinalize: true } : null
  })
  const pending = finish.immediate()
  if (!pending) return null

  // The recoverable source first records terminal intent plus the complete
  // result. Only after that acknowledgement may this process expose success.
  await acknowledgeDurableStorageMutation()
  if (pending.requiresFinalize) {
    const finalize = database.transaction(() => database.prepare(
      `UPDATE mail_fetch_state
       SET sync_job_status = CASE
             WHEN sync_job_terminal_status IN ('succeeded', 'failed', 'cancelled')
               THEN sync_job_terminal_status
             ELSE 'failed'
           END,
           sync_job_terminal_status = NULL
       WHERE sync_job_id = ? AND sync_job_status = 'committing'`,
    ).run(jobId))
    finalize.immediate()
  }
  return pending.completedJob
}

export async function retryMailSyncJob(jobId, {
  nextAttemptAt,
  errorCode = null,
  errorMessage = null,
}) {
  await ensureStorage()
  const database = getDb()
  const retry = database.transaction(() => {
    const row = database.prepare(
      `SELECT * FROM mail_fetch_state
       WHERE sync_job_id = ? AND sync_job_status IN ('running', 'committing')`,
    ).get(jobId)
    if (!row) return null

    const successor = row.sync_job_status === 'running'
      ? promoteMailSyncSuccessor(database, row)
      : null
    if (successor) return successor

    const scheduleSequence = nextMailSyncScheduleSequence(database)
    const updated = database.prepare(
      `UPDATE mail_fetch_state
       SET sync_job_status = 'queued',
           sync_job_terminal_status = NULL,
           sync_job_started_at = NULL,
           sync_job_completed_at = NULL,
           sync_job_result_json = '{}',
           sync_job_schedule_sequence = ?,
           sync_job_next_attempt_at = ?,
           sync_job_error_code = ?,
           sync_job_error_message = ?
       WHERE sync_job_id = ? AND sync_job_status IN ('running', 'committing')`,
    ).run(scheduleSequence, nextAttemptAt, errorCode, errorMessage, jobId)
    if (updated.changes === 0) return null
    return mailSyncJobFromRow(
      database.prepare('SELECT * FROM mail_fetch_state WHERE sync_job_id = ?').get(jobId),
    )
  })
  const result = retry.immediate()
  await acknowledgeDurableStorageMutation()
  return result
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

const SYSTEM_MAIL_STALE_CLAIM_MS = 2 * 60_000

function systemMailJobFromRow(row) {
  if (!row) return null
  let payload = {}
  let payloadError = null
  try {
    const plain = isEncryptedPayload(row.payload_encrypted)
      ? decryptPayload(row.payload_encrypted)
      : row.payload_encrypted
    payload = fromJson(plain, {})
  } catch (error) {
    payloadError = error instanceof Error ? error.message : 'System mail payload could not be decrypted.'
  }
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    kind: row.kind,
    status: row.status,
    payload,
    payloadError,
    messageId: row.message_id,
    createdAt: row.created_at,
    availableAt: row.available_at,
    expiresAt: row.expires_at ?? null,
    startedAt: row.started_at ?? null,
    dispatchStartedAt: row.dispatch_started_at ?? null,
    completedAt: row.completed_at ?? null,
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: row.next_attempt_at ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    lastErrorAt: row.last_error_at ?? null,
  }
}

/**
 * Persists product-generated email before delivery. Payloads are always sealed,
 * even when optional application payload encryption is disabled, because they
 * may contain one-time verification codes or reset links.
 */
function insertSystemMailJob(database, {
  dedupeKey,
  kind,
  to,
  subject,
  text,
  html,
  scope,
  metadata = {},
  availableAt = nowStamp(),
  expiresAt = null,
}) {
  const normalizedDedupeKey = String(dedupeKey ?? '').trim()
  const normalizedRecipient = String(to ?? '').trim().toLowerCase()
  if (!normalizedDedupeKey || !normalizedRecipient || !String(subject ?? '').trim()) {
    throw new Error('System mail jobs require a dedupe key, recipient, and subject.')
  }
  const id = createId('system-mail')
  const createdAt = nowStamp()
  const messageId = `<phd-atlas.system.${createHash('sha256')
    .update(normalizedDedupeKey)
    .digest('hex')
    .slice(0, 40)}@mail.local>`
  const payloadEncrypted = encryptPayload(toJson({
    to: normalizedRecipient,
    subject: String(subject),
    text: String(text ?? ''),
    html: typeof html === 'string' ? html : undefined,
    scope: String(scope ?? 'System mail'),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  }))
  const inserted = database.prepare(
    `INSERT INTO system_mail_jobs (
       id, dedupe_key, kind, status, payload_encrypted, message_id,
       created_at, available_at, expires_at
     ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
  ).run(
    id,
    normalizedDedupeKey,
    String(kind ?? 'system-mail'),
    payloadEncrypted,
    messageId,
    createdAt,
    availableAt,
    expiresAt,
  )
  const row = database.prepare('SELECT * FROM system_mail_jobs WHERE dedupe_key = ?')
    .get(normalizedDedupeKey)
  return {
    job: systemMailJobFromRow(row),
    alreadyQueued: inserted.changes === 0,
  }
}

export async function enqueueSystemMailJob(input) {
  await ensureStorage()
  return insertSystemMailJob(getDb(), input)
}

export async function getSystemMailJob(jobId) {
  await ensureStorage()
  return systemMailJobFromRow(
    getDb().prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId),
  )
}

export async function getSystemMailJobByDedupeKey(dedupeKey) {
  await ensureStorage()
  return systemMailJobFromRow(
    getDb().prepare('SELECT * FROM system_mail_jobs WHERE dedupe_key = ?')
      .get(String(dedupeKey ?? '').trim()),
  )
}

/** Reads only the administrator SMTP transport needed by the system outbox. */
export async function readSystemMailDeliverySettings() {
  await ensureStorage()
  const row = getDb().prepare(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_tls,
            notification_mailbox
       FROM system_settings WHERE id = 'global'`,
  ).get()
  if (!row) return null
  return {
    smtpHost: row.smtp_host ?? '',
    smtpPort: Number(row.smtp_port ?? 587),
    smtpUser: row.smtp_user ?? '',
    smtpPass: decryptSecret(row.smtp_pass ?? ''),
    smtpTls: intBool(row.smtp_tls ?? 1),
    notificationMailbox: row.notification_mailbox ?? '',
  }
}

/**
 * Claims a due job or a pre-dispatch claim whose process disappeared. Once the
 * durable dispatch boundary is present, generic SMTP cannot prove non-delivery
 * and this worker deliberately refuses to reclaim the job.
 */
export async function claimNextSystemMailJob(jobId = null, {
  at = nowStamp(),
  staleAfterMs = SYSTEM_MAIL_STALE_CLAIM_MS,
} = {}) {
  await ensureStorage()
  const database = getDb()
  const staleBefore = new Date(
    Date.parse(at) - Math.max(1_000, Number(staleAfterMs) || SYSTEM_MAIL_STALE_CLAIM_MS),
  ).toISOString()
  return database.transaction(() => {
    database.prepare(
      `UPDATE system_mail_jobs
       SET status = 'expired', completed_at = ?,
           last_error_code = COALESCE(last_error_code, 'EXPIRED'),
           last_error_message = COALESCE(last_error_message, 'The system email expired before delivery.'),
           last_error_at = ?
       WHERE (status = 'queued' OR (status = 'sending' AND dispatch_started_at IS NULL))
         AND expires_at IS NOT NULL AND expires_at <= ?`,
    ).run(at, at, at)

    const dueClause = `(
      (status = 'queued'
        AND available_at <= ?
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
      OR
      (status = 'sending' AND dispatch_started_at IS NULL
        AND started_at IS NOT NULL AND started_at <= ?)
    )`
    const row = jobId
      ? database.prepare(
          `SELECT * FROM system_mail_jobs
           WHERE id = ? AND ${dueClause}
             AND (expires_at IS NULL OR expires_at > ?)
           LIMIT 1`,
        ).get(jobId, at, at, staleBefore, at)
      : database.prepare(
          `SELECT * FROM system_mail_jobs
           WHERE ${dueClause}
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY available_at ASC, created_at ASC
           LIMIT 1`,
        ).get(at, at, staleBefore, at)
    if (!row) return null

    const claimed = database.prepare(
      `UPDATE system_mail_jobs
       SET status = 'sending', started_at = ?, completed_at = NULL,
           attempt_count = attempt_count + 1, next_attempt_at = NULL
       WHERE id = ? AND (
         status = 'queued'
         OR (status = 'sending' AND dispatch_started_at IS NULL
           AND started_at IS NOT NULL AND started_at <= ?)
       )`,
    ).run(at, row.id, staleBefore)
    if (claimed.changes === 0) return null
    return systemMailJobFromRow({
      ...row,
      status: 'sending',
      started_at: at,
      dispatch_started_at: null,
      completed_at: null,
      attempt_count: Number(row.attempt_count ?? 0) + 1,
      next_attempt_at: null,
    })
  })()
}

function insertSystemMailJobAuditEvent(database, row, message, at, extraMetadata = {}) {
  const job = systemMailJobFromRow(row)
  if (!job) return
  database.prepare(
    `INSERT INTO system_events (
       id, time, scope, actor_id, message, metadata_json
     ) VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(
    createId('event'),
    at,
    job.payload?.scope || 'System mail',
    message,
    toJson({
      ...(job.payload?.metadata ?? {}),
      systemMailJobId: job.id,
      kind: job.kind,
      attemptCount: job.attemptCount,
      ...extraMetadata,
    }),
  )
}

export async function markSystemMailJobDispatching(jobId, { at = nowStamp() } = {}) {
  await ensureStorage()
  const database = getDb()
  const transaction = database.transaction(() => {
    const current = database.prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId)
    if (!current) return null
    if (current.status === 'sent' || current.dispatch_started_at) {
      return systemMailJobFromRow(current)
    }
    if (current.status !== 'sending') return null
    const updated = database.prepare(
      `UPDATE system_mail_jobs
       SET dispatch_started_at = ?, last_error_code = 'SMTP_OUTCOME_UNKNOWN',
           last_error_message = 'SMTP delivery began, but its final outcome has not been reconciled.',
           last_error_at = ?
       WHERE id = ? AND status = 'sending' AND dispatch_started_at IS NULL`,
    ).run(at, at, jobId)
    if (updated.changes !== 1) return null
    return systemMailJobFromRow(
      database.prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId),
    )
  })
  const dispatching = transaction.immediate()
  if (dispatching) await acknowledgeDurableStorageMutation()
  return dispatching
}

export async function finishSystemMailJob(jobId, { messageId = null, at = nowStamp() } = {}) {
  await ensureStorage()
  const database = getDb()
  const updated = database.prepare(
    `UPDATE system_mail_jobs
     SET status = 'sent', completed_at = ?, started_at = NULL,
         next_attempt_at = NULL, last_error_code = NULL,
         last_error_message = NULL, last_error_at = NULL,
         message_id = COALESCE(?, message_id)
     WHERE id = ? AND status = 'sending' AND dispatch_started_at IS NOT NULL`,
  ).run(at, messageId, jobId)
  if (updated.changes === 0) return getSystemMailJob(jobId)
  const completed = systemMailJobFromRow(
    database.prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId),
  )
  insertSystemMailJobAuditEvent(
    database,
    database.prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId),
    'Durable system email accepted by SMTP',
    at,
    { delivery: 'sent', messageId: completed?.messageId },
  )
  await acknowledgeDurableStorageMutation()
  return completed
}

export async function retrySystemMailJob(jobId, {
  nextAttemptAt,
  errorCode = null,
  errorMessage = null,
  at = nowStamp(),
  confirmedNotDispatched = false,
} = {}) {
  await ensureStorage()
  const database = getDb()
  return database.transaction(() => {
    const current = database.prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId)
    if (!current) return null
    if (current.dispatch_started_at && !confirmedNotDispatched) {
      return systemMailJobFromRow(current)
    }
    if (current.expires_at && current.expires_at <= at) {
      database.prepare(
        `UPDATE system_mail_jobs
         SET status = 'expired', completed_at = ?, started_at = NULL,
             dispatch_started_at = NULL,
             next_attempt_at = NULL, last_error_code = ?,
             last_error_message = ?, last_error_at = ?
         WHERE id = ? AND status = 'sending'`,
      ).run(at, errorCode ?? 'EXPIRED', errorMessage ?? 'The system email expired before delivery.', at, jobId)
    } else {
      database.prepare(
        `UPDATE system_mail_jobs
         SET status = 'queued', started_at = NULL, dispatch_started_at = NULL,
             completed_at = NULL,
             next_attempt_at = ?, last_error_code = ?,
             last_error_message = ?, last_error_at = ?
         WHERE id = ? AND status = 'sending'`,
      ).run(nextAttemptAt ?? at, errorCode, errorMessage, at, jobId)
    }
    const row = database.prepare('SELECT * FROM system_mail_jobs WHERE id = ?').get(jobId)
    const retry = systemMailJobFromRow(row)
    insertSystemMailJobAuditEvent(
      database,
      row,
      retry?.status === 'expired'
        ? 'Durable system email expired before delivery'
        : 'Durable system email retained for retry',
      at,
      { errorCode, nextAttemptAt: retry?.nextAttemptAt },
    )
    return retry
  })()
}

export async function deleteSystemMailJob(jobId) {
  await ensureStorage()
  return getDb().prepare('DELETE FROM system_mail_jobs WHERE id = ?').run(jobId).changes > 0
}

function outgoingDeliveryTime(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

function outgoingDeliveryIsClaimable(row, at, staleAfterMs) {
  const atMs = outgoingDeliveryTime(at) ?? Date.now()
  if (row.status === 'queued') {
    const scheduledAt = outgoingDeliveryTime(row.scheduled_at)
    const nextAttemptAt = outgoingDeliveryTime(row.next_attempt_at)
    return (scheduledAt === null || scheduledAt <= atMs)
      && (nextAttemptAt === null || nextAttemptAt <= atMs)
  }
  if (row.status !== 'sending' || row.dispatch_started_at) return false
  const startedAt = outgoingDeliveryTime(row.started_at)
  return startedAt === null
    || startedAt <= atMs - Math.max(1_000, Number(staleAfterMs) || OUTGOING_MAIL_STALE_CLAIM_MS)
}

function updateApplicationOutgoingCommunication(database, delivery, at) {
  // Reserve against the exact row size before SELECT * materializes its JSON.
  // Projection happens after SMTP, so this lease cannot stack with the mail lease.
  const preflight = database.prepare(
    `SELECT LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes, payload_version
       FROM applications WHERE id = ?`,
  ).get(delivery.applicationId)
  if (!preflight) return null
  const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
  try {
    const row = database.prepare('SELECT * FROM applications WHERE id = ?')
      .get(delivery.applicationId)
    if (!row || Number(row.payload_version ?? 0) !== Number(preflight.payload_version ?? 0)) {
      return null
    }
    const payload = decodePayloadFromStorage(row.payload_json)
    const communications = Array.isArray(payload.communications)
      ? [...payload.communications]
      : []
    const index = communications.findIndex((communication) => (
      communication.id === delivery.communicationId
    ))
    const current = index >= 0 ? communications[index] : null
    const canonical = canonicalOutgoingCommunication(delivery, current)
    if (index >= 0) communications[index] = canonical
    else communications.unshift(canonical)
    const nextPayload = {
      ...payload,
      communications,
      updatedAt: at,
    }
    reconcileMailClassificationFingerprints(nextPayload)
    const encodedPayload = encodePayloadForStorage(nextPayload)
    const changed = database.prepare(
      `UPDATE applications SET payload_json = ?, updated_at = ?
       WHERE id = ? AND payload_version = ?`,
    ).run(encodedPayload, at, row.id, preflight.payload_version)
    if (Number(changed.changes ?? 0) !== 1) return null
    const nextPayloadVersion = database.prepare(
      'SELECT payload_version FROM applications WHERE id = ?',
    ).get(row.id)?.payload_version ?? 0
    replaceWorkspaceFileReferences(database, 'application', {
      ...nextPayload,
      id: row.id,
      ownerId: row.owner_id,
      teamId: row.team_id ?? null,
    }, nextPayloadVersion)
    return { communication: canonical }
  } finally {
    releaseMemory?.()
  }
}

function insertOutgoingMailAuditEvent(database, {
  at,
  actorId,
  message,
  applicationId,
  communicationId,
  deliveryId,
  attemptCount,
  messageId = null,
  errorCode = null,
  nextAttemptAt = null,
}) {
  database.prepare(
    `INSERT INTO system_events (
       id, time, scope, actor_id, message, metadata_json
     ) VALUES (?, ?, 'Correspondence', ?, ?, ?)`,
  ).run(
    createId('event'),
    at,
    actorId,
    message,
    toJson({
      applicationId,
      communicationId,
      deliveryId,
      attemptCount,
      ...(messageId ? { messageId } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(nextAttemptAt ? { nextAttemptAt } : {}),
    }),
  )
}

function outgoingMailDeliveryResult(database, row) {
  const delivery = outgoingMailDeliveryFromRow(row)
  if (!delivery) return null
  const applicationRow = database.prepare(
    'SELECT id, owner_id, team_id FROM applications WHERE id = ?',
  )
    .get(delivery.applicationId)
  const communication = delivery.communication
    ? canonicalOutgoingCommunication(delivery)
    : null
  const accepted = delivery.status === 'accepted' || delivery.status === 'sent'
  const outcomeUnknown = delivery.status === 'sending' && Boolean(delivery.dispatchStartedAt)
  return {
    applicationId: delivery.applicationId,
    teamId: applicationRow?.team_id ?? null,
    ownerId: applicationRow?.owner_id ?? null,
    deliveryUserId: delivery.deliveryUserId,
    communication,
    journalStatus: delivery.status,
    delivery: accepted
      ? {
          sent: true,
          delivery: 'smtp',
          messageId: delivery.smtpMessageId ?? delivery.messageId,
          ...(delivery.status === 'accepted' ? { pendingFinalize: true } : {}),
        }
      : outcomeUnknown
        ? {
            sent: false,
            delivery: 'ambiguous',
            errorCode: 'SMTP_OUTCOME_UNKNOWN',
            outcomeUnknown: true,
            requiresReconciliation: true,
          }
        : {
          sent: false,
          delivery: 'queued',
          errorCode: delivery.lastErrorCode,
          nextAttemptAt: delivery.nextAttemptAt,
        },
  }
}

/**
 * Claims only one outgoing-delivery row and its containing application row.
 * Accepted SMTP results are returned as recovery work and are never changed
 * back to `sending`, which makes a post-SMTP restart network-idempotent.
 */
export async function claimOutgoingMailDelivery(communicationId, {
  at = nowStamp(),
  staleAfterMs = OUTGOING_MAIL_STALE_CLAIM_MS,
} = {}) {
  await ensureStorage()
  const database = getDb()
  const transaction = database.transaction(() => {
    const current = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(String(communicationId ?? ''))
    if (!current) return null
    if (current.status === 'accepted' || current.status === 'sent') {
      return outgoingMailDeliveryFromRow(current)
    }
    if (current.status === 'sending' && current.dispatch_started_at) {
      // SMTP may already have accepted this message. Generic SMTP provides no
      // lookup/idempotency contract, so an ambiguous dispatch is never reclaimed.
      return outgoingMailDeliveryFromRow(current)
    }
    if (!outgoingDeliveryIsClaimable(current, at, staleAfterMs)) return null
    const deliveryUser = database.prepare(
      'SELECT id FROM users WHERE id = ? AND disabled_at IS NULL',
    ).get(current.delivery_user_id)
    if (!deliveryUser) return null
    const updated = database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET status = 'sending', started_at = ?, completed_at = NULL,
           attempt_count = attempt_count + 1, next_attempt_at = NULL,
           updated_at = ?
       WHERE communication_id = ? AND status IN ('queued', 'sending')`,
    ).run(at, at, current.communication_id)
    if (updated.changes !== 1) return null
    const claimedRow = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(current.communication_id)
    return outgoingMailDeliveryFromRow(claimedRow)
  })
  const claimed = transaction.immediate()
  if (claimed) invalidateSharedStoreCache()
  return claimed
}

/** Reads only the journal row and the SMTP account that owns the delivery. */
export async function readOutgoingMailDeliveryContext(communicationId) {
  await ensureStorage()
  const database = getDb()
  const row = database.prepare(
    'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
  ).get(String(communicationId ?? ''))
  const delivery = outgoingMailDeliveryFromRow(row)
  if (!delivery) return null
  const userRow = database.prepare(
    `SELECT id, email, disabled_at,
            json_extract(settings_json, '$.smtpHost') AS smtp_host,
            json_extract(settings_json, '$.smtpPort') AS smtp_port,
            json_extract(settings_json, '$.smtpUser') AS smtp_user,
            json_extract(settings_json, '$.smtpPass') AS smtp_pass,
            json_extract(settings_json, '$.smtpTls') AS smtp_tls,
            json_extract(settings_json, '$.sendFrom') AS send_from,
            json_extract(settings_json, '$.notificationMailbox') AS notification_mailbox
       FROM users
      WHERE id = ? AND disabled_at IS NULL`,
  )
    .get(delivery.deliveryUserId)
  if (!userRow) return { delivery, user: null, application: null }
  const applicationRow = database.prepare(
    'SELECT id, owner_id, team_id FROM applications WHERE id = ?',
  ).get(delivery.applicationId)
  return {
    delivery,
    user: {
      id: userRow.id,
      email: userRow.email,
      disabledAt: userRow.disabled_at ?? null,
      settings: {
        smtpHost: userRow.smtp_host ?? '',
        smtpPort: Number(userRow.smtp_port ?? 587),
        smtpUser: userRow.smtp_user ?? '',
        smtpPass: decryptSecret(userRow.smtp_pass ?? ''),
        smtpTls: userRow.smtp_tls === null || userRow.smtp_tls === undefined
          ? true
          : Boolean(userRow.smtp_tls),
        sendFrom: userRow.send_from ?? '',
        notificationMailbox: userRow.notification_mailbox ?? '',
      },
    },
    application: applicationRow
      ? {
          id: applicationRow.id,
          ownerId: applicationRow.owner_id,
          teamId: applicationRow.team_id ?? null,
        }
      : null,
  }
}

/**
 * Persists the ambiguity boundary before any SMTP socket is opened. If the
 * process disappears after this commit, recovery reports an unknown outcome
 * and never calls SMTP again without an explicit human/provider decision.
 */
export async function markOutgoingMailDispatching(communicationId, { at = nowStamp() } = {}) {
  await ensureStorage()
  const database = getDb()
  const transaction = database.transaction(() => {
    const current = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(String(communicationId ?? ''))
    if (!current) return null
    if (current.status === 'accepted' || current.status === 'sent' || current.dispatch_started_at) {
      return outgoingMailDeliveryFromRow(current)
    }
    if (current.status !== 'sending') return null
    const updated = database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET dispatch_started_at = ?, last_error_code = 'SMTP_OUTCOME_UNKNOWN',
           last_error_at = ?, updated_at = ?
       WHERE communication_id = ? AND status = 'sending'
         AND dispatch_started_at IS NULL`,
    ).run(at, at, at, current.communication_id)
    if (updated.changes !== 1) return null
    return outgoingMailDeliveryFromRow(database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(current.communication_id))
  })
  const dispatching = transaction.immediate()
  if (dispatching) {
    invalidateSharedStoreCache()
    await acknowledgeDurableStorageMutation()
  }
  return dispatching
}

/**
 * Records SMTP acceptance before application projection or audit work. This is
 * deliberately a tiny BEGIN IMMEDIATE transaction with no store hydration or
 * memory-admission dependency.
 */
export async function recordOutgoingMailAccepted(communicationId, {
  smtpMessageId = null,
  sourceMessageKey = null,
  at = nowStamp(),
} = {}) {
  await ensureStorage()
  const database = getDb()
  const transaction = database.transaction(() => {
    const current = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(String(communicationId ?? ''))
    if (!current) return null
    if (current.status === 'accepted' || current.status === 'sent') {
      return outgoingMailDeliveryFromRow(current)
    }
    if (current.status !== 'sending') return null
    const updated = database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET status = 'accepted', accepted_at = ?, started_at = NULL,
           next_attempt_at = NULL, last_error_code = NULL,
           last_error_at = NULL, smtp_message_id = COALESCE(?, message_id),
           source_message_key = ?, updated_at = ?
       WHERE communication_id = ? AND status = 'sending'`,
    ).run(at, smtpMessageId, sourceMessageKey, at, current.communication_id)
    if (updated.changes !== 1) return null
    return outgoingMailDeliveryFromRow(database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(current.communication_id))
  })
  const accepted = transaction.immediate()
  if (accepted) {
    invalidateSharedStoreCache()
    // Plain SQLite commits are already durable; encrypted SQLite and external
    // adapters must acknowledge this exact accepted revision before SMTP
    // success is allowed to proceed to the fallible application projection.
    await acknowledgeDurableStorageMutation()
  }
  return accepted
}

export async function retryOutgoingMailDelivery(communicationId, {
  nextAttemptAt,
  errorCode = 'SEND_FAILED',
  at = nowStamp(),
  confirmedNotDispatched = false,
} = {}) {
  await ensureStorage()
  const database = getDb()
  const transaction = database.transaction(() => {
    const current = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(String(communicationId ?? ''))
    if (!current) return null
    if (current.status === 'accepted' || current.status === 'sent') {
      return outgoingMailDeliveryResult(database, current)
    }
    if (current.status !== 'sending') return outgoingMailDeliveryResult(database, current)
    if (current.dispatch_started_at && !confirmedNotDispatched) {
      return outgoingMailDeliveryResult(database, current)
    }
    const normalizedErrorCode = String(errorCode || 'SEND_FAILED').slice(0, 80)
    database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET status = 'queued', started_at = NULL, dispatch_started_at = NULL,
           completed_at = NULL,
           next_attempt_at = ?, last_error_code = ?, last_error_at = ?,
           updated_at = ?
       WHERE communication_id = ? AND status = 'sending'`,
    ).run(nextAttemptAt ?? at, normalizedErrorCode, at, at, current.communication_id)
    const retryRow = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(current.communication_id)
    const retry = outgoingMailDeliveryFromRow(retryRow)
    updateApplicationOutgoingCommunication(database, retry, at)
    insertOutgoingMailAuditEvent(database, {
      at,
      actorId: retry.deliveryUserId,
      message: 'Durable outgoing email retained for retry',
      applicationId: retry.applicationId,
      communicationId: retry.communicationId,
      deliveryId: retry.deliveryId,
      attemptCount: retry.attemptCount,
      errorCode: normalizedErrorCode,
      nextAttemptAt: retry.nextAttemptAt,
    })
    return outgoingMailDeliveryResult(database, retryRow)
  })
  const result = transaction.immediate()
  if (result) invalidateSharedStoreCache()
  return result
}

/** Projects a previously accepted SMTP result without touching the network. */
export async function finalizeOutgoingMailDelivery(communicationId, { at = nowStamp() } = {}) {
  await ensureStorage()
  const database = getDb()
  const transaction = database.transaction(() => {
    const current = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(String(communicationId ?? ''))
    if (!current) return null
    if (current.status === 'sent') return outgoingMailDeliveryResult(database, current)
    if (current.status !== 'accepted') return outgoingMailDeliveryResult(database, current)
    const accepted = outgoingMailDeliveryFromRow(current)
    const projected = updateApplicationOutgoingCommunication(database, accepted, at)
    if (!projected) return outgoingMailDeliveryResult(database, current)
    const completedAt = accepted.acceptedAt ?? at
    database.prepare(
      `UPDATE outgoing_mail_deliveries
       SET status = 'sent', communication_encrypted = ?, completed_at = ?, updated_at = ?
       WHERE communication_id = ? AND status = 'accepted'`,
    ).run(
      encryptPayload(toJson(projected.communication)),
      completedAt,
      at,
      accepted.communicationId,
    )
    insertOutgoingMailAuditEvent(database, {
      at,
      actorId: accepted.deliveryUserId,
      message: 'Durable outgoing email accepted by SMTP',
      applicationId: accepted.applicationId,
      communicationId: accepted.communicationId,
      deliveryId: accepted.deliveryId,
      attemptCount: accepted.attemptCount,
      messageId: accepted.smtpMessageId ?? accepted.messageId,
    })
    const sentRow = database.prepare(
      'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
    ).get(accepted.communicationId)
    return outgoingMailDeliveryResult(database, sentRow)
  })
  const result = transaction.immediate()
  if (result) invalidateSharedStoreCache()
  return result
}

export async function getOutgoingMailDeliveryResult(communicationId) {
  await ensureStorage()
  const database = getDb()
  const row = database.prepare(
    'SELECT * FROM outgoing_mail_deliveries WHERE communication_id = ?',
  ).get(String(communicationId ?? ''))
  return outgoingMailDeliveryResult(database, row)
}

export async function listDueOutgoingMailDeliveryIds({
  limit = 25,
  at = nowStamp(),
  staleAfterMs = OUTGOING_MAIL_STALE_CLAIM_MS,
} = {}) {
  await ensureStorage()
  const atMs = outgoingDeliveryTime(at) ?? Date.now()
  const staleBefore = new Date(
    atMs - Math.max(1_000, Number(staleAfterMs) || OUTGOING_MAIL_STALE_CLAIM_MS),
  ).toISOString()
  const boundedLimit = Math.min(100, Math.max(1, Number(limit) || 25))
  return getDb().prepare(
    `SELECT delivery.communication_id
     FROM outgoing_mail_deliveries AS delivery
     WHERE delivery.status = 'accepted'
        OR (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = delivery.delivery_user_id
              AND users.disabled_at IS NULL
          )
          AND (
            (delivery.status = 'queued'
              AND delivery.scheduled_at <= ?
              AND (delivery.next_attempt_at IS NULL OR delivery.next_attempt_at <= ?))
            OR
            (delivery.status = 'sending'
              AND delivery.dispatch_started_at IS NULL
              AND (delivery.started_at IS NULL OR delivery.started_at <= ?))
          )
        )
     ORDER BY CASE delivery.status WHEN 'accepted' THEN 0 ELSE 1 END,
              delivery.scheduled_at ASC, delivery.created_at ASC
     LIMIT ?`,
  ).all(at, at, staleBefore, boundedLimit).map((row) => row.communication_id)
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
    pushEnqueuedAt: row.push_enqueued_at,
  }
}

function insertNotificationRow(database, userId, candidate) {
  const id = createId('notif')
  const createdAt = nowStamp()
  const result = database
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
  return notificationFromRow(database.prepare('SELECT * FROM notifications WHERE id = ?').get(id))
}

/** Inserts a notification unless one with the same (userId, dedupeKey) already exists. Returns the row if newly created, else null. */
export async function insertNotificationIfNew(userId, candidate) {
  await ensureStorage()
  return insertNotificationRow(getDb(), userId, candidate)
}

export async function markNotificationEmailed(id) {
  await ensureStorage()
  getDb().prepare('UPDATE notifications SET emailed_at = ? WHERE id = ?').run(nowStamp(), id)
}

function notificationTypeExclusion(excludedTypes) {
  const params = [...new Set((Array.isArray(excludedTypes) ? excludedTypes : [])
    .map((type) => String(type ?? '').trim())
    .filter(Boolean))]
  return {
    clause: params.length > 0 ? `type NOT IN (${params.map(() => '?').join(', ')})` : '',
    params,
  }
}

/** Returns undelivered notification-email candidates in chronological order for one digest. */
export async function listPendingNotificationEmails(userId, { since, limit = 100, excludedTypes = [] } = {}) {
  await ensureStorage()
  const clauses = ['user_id = ?', 'emailed_at IS NULL', 'archived_at IS NULL']
  const params = [userId]
  const typeExclusion = notificationTypeExclusion(excludedTypes)
  if (typeExclusion.clause) {
    clauses.push(typeExclusion.clause)
    params.push(...typeExclusion.params)
  }
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

/** Returns notification rows not yet handed to the encrypted browser-push journal. */
export async function listPendingNotificationPushes({ limit = 200 } = {}) {
  await ensureStorage()
  const rows = getDb()
    .prepare(
      `SELECT * FROM notifications
       WHERE push_enqueued_at IS NULL AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(Math.min(500, Math.max(1, Number(limit) || 200)))
  return rows.map(notificationFromRow)
}

/** Marks rows only after the durable browser-push journal accepted or deliberately skipped them. */
export async function markNotificationsPushEnqueued(notificationIds) {
  await ensureStorage()
  const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : [])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))]
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(', ')
  const result = getDb()
    .prepare(
      `UPDATE notifications
       SET push_enqueued_at = ?
       WHERE push_enqueued_at IS NULL AND id IN (${placeholders})`,
    )
    .run(nowStamp(), ...ids)
  return result.changes
}

export async function listNotifications(userId, { unreadOnly = false, archivedOnly = false, includeArchived = false, before, limit = 50, excludedTypes = [] } = {}) {
  await ensureStorage()
  const clauses = ['user_id = ?']
  const params = [userId]
  const typeExclusion = notificationTypeExclusion(excludedTypes)
  if (typeExclusion.clause) {
    clauses.push(typeExclusion.clause)
    params.push(...typeExclusion.params)
  }
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

export async function countUnreadNotifications(userId, { excludedTypes = [] } = {}) {
  await ensureStorage()
  const typeExclusion = notificationTypeExclusion(excludedTypes)
  const exclusionClause = typeExclusion.clause ? ` AND ${typeExclusion.clause}` : ''
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL${exclusionClause}`)
    .get(userId, ...typeExclusion.params)
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

export async function markAllNotificationsRead(userId, { excludedTypes = [] } = {}) {
  await ensureStorage()
  const typeExclusion = notificationTypeExclusion(excludedTypes)
  const exclusionClause = typeExclusion.clause ? ` AND ${typeExclusion.clause}` : ''
  const result = getDb()
    .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL${exclusionClause}`)
    .run(nowStamp(), userId, ...typeExclusion.params)
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

export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20

/**
 * Keeps one subscription per browser endpoint. Reassigning an endpoint on sign-in prevents
 * a shared device from delivering the previous account's notifications to the next account.
 * The per-user cap also prevents forged endpoints from creating an unbounded push fan-out.
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
  getDb()
    .prepare(
      `DELETE FROM push_subscriptions
       WHERE user_id = ?
         AND endpoint <> ?
         AND endpoint NOT IN (
           SELECT endpoint
           FROM push_subscriptions
           WHERE user_id = ? AND endpoint <> ?
           ORDER BY updated_at DESC, endpoint DESC
           LIMIT ?
         )`,
    )
    .run(
      userId,
      subscription.endpoint,
      userId,
      subscription.endpoint,
      MAX_PUSH_SUBSCRIPTIONS_PER_USER - 1,
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

const MAIL_CLASSIFICATION_TASK_LEASE_MS = 10 * 60_000
const MAIL_CLASSIFICATION_TASK_RETENTION_MS = 7 * 24 * 60 * 60_000
const MAIL_CLASSIFICATION_TASK_ABANDONED_MS = 24 * 60 * 60_000
const MAIL_CLASSIFICATION_TASK_MAX_ROWS = 10_000
const MAIL_CLASSIFICATION_TASK_MAX_PAYLOAD_BYTES = 512 * 1024

function mailClassificationStorageError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status })
}

function ensureMailClassificationTaskSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mail_classification_tasks (
      idempotency_key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('manual', 'ai')),
      status TEXT NOT NULL CHECK(status IN ('running', 'prepared', 'committed')),
      lease_token TEXT,
      lease_expires_at TEXT,
      updates_encrypted TEXT,
      result_encrypted TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mail_classification_tasks_retention
      ON mail_classification_tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_mail_classification_tasks_application
      ON mail_classification_tasks(application_id, updated_at);
  `)
}

function normalizeMailClassificationTaskIdentity(input = {}) {
  const idempotencyKey = String(input.idempotencyKey ?? '').trim()
  const fingerprint = String(input.fingerprint ?? '').trim()
  const actorId = String(input.actorId ?? '').trim()
  const applicationId = String(input.applicationId ?? '').trim()
  const operation = input.operation === 'manual' ? 'manual' : 'ai'
  if (!/^mail_classification_[a-f0-9]{64}$/u.test(idempotencyKey)) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_IDEMPOTENCY_INVALID',
      'The email-classification idempotency key is invalid.',
      400,
    )
  }
  if (!/^[a-f0-9]{64}$/u.test(fingerprint) || !actorId || !applicationId) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_IDEMPOTENCY_INVALID',
      'The email-classification idempotency identity is incomplete.',
      400,
    )
  }
  return { idempotencyKey, fingerprint, actorId, applicationId, operation }
}

function encodeMailClassificationTaskPayload(value) {
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') > MAIL_CLASSIFICATION_TASK_MAX_PAYLOAD_BYTES) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_TASK_TOO_LARGE',
      'The email-classification task exceeded its durable size limit.',
      413,
    )
  }
  return encodePayloadForStorage(value)
}

function decodeMailClassificationTaskPayload(value, fallback = null) {
  if (!value) return fallback
  const decoded = decodePayloadFromStorage(value)
  return decoded && typeof decoded === 'object' ? decoded : fallback
}

function assertMatchingMailClassificationTask(row, identity) {
  if (
    row.fingerprint !== identity.fingerprint
    || row.actor_id !== identity.actorId
    || row.application_id !== identity.applicationId
    || row.operation !== identity.operation
  ) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
      'This idempotency key was already used for a different email-classification request.',
      409,
    )
  }
}

function pruneMailClassificationTasks(database, at = Date.now()) {
  const committedBefore = new Date(at - MAIL_CLASSIFICATION_TASK_RETENTION_MS).toISOString()
  const abandonedBefore = new Date(at - MAIL_CLASSIFICATION_TASK_ABANDONED_MS).toISOString()
  database.prepare(
    `DELETE FROM mail_classification_tasks
      WHERE (status = 'committed' AND updated_at < ?)
         OR (status <> 'committed' AND updated_at < ?)`,
  ).run(committedBefore, abandonedBefore)
}

/**
 * Durable, cross-process admission before an AI provider is invoked. A
 * prepared row owns already-paid bounded updates; a committed row owns the
 * exact bounded acknowledgement returned after the application transaction.
 */
export async function claimMailClassificationTask(input) {
  const identity = normalizeMailClassificationTaskIdentity(input)
  await ensureStorage()
  return withWriteLock(async () => {
    const database = getDb()
    ensureMailClassificationTaskSchema(database)
    const atMs = Date.now()
    const at = new Date(atMs).toISOString()
    const leaseToken = createId('mail_classification_lease')
    const leaseExpiresAt = new Date(atMs + MAIL_CLASSIFICATION_TASK_LEASE_MS).toISOString()
    let claimed
    database.transaction(() => {
      pruneMailClassificationTasks(database, atMs)
      let row = database.prepare(
        'SELECT * FROM mail_classification_tasks WHERE idempotency_key = ?',
      ).get(identity.idempotencyKey)
      if (!row) {
        const count = Number(database.prepare(
          'SELECT COUNT(*) AS count FROM mail_classification_tasks',
        ).get()?.count ?? 0)
        if (count >= MAIL_CLASSIFICATION_TASK_MAX_ROWS) {
          throw mailClassificationStorageError(
            'MAIL_CLASSIFICATION_TASK_CAPACITY',
            'The email-classification task journal is full. Retry shortly.',
            429,
          )
        }
        database.prepare(
          `INSERT INTO mail_classification_tasks (
             idempotency_key, fingerprint, actor_id, application_id, operation,
             status, lease_token, lease_expires_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
        ).run(
          identity.idempotencyKey,
          identity.fingerprint,
          identity.actorId,
          identity.applicationId,
          identity.operation,
          leaseToken,
          leaseExpiresAt,
          at,
          at,
        )
        row = database.prepare(
          'SELECT * FROM mail_classification_tasks WHERE idempotency_key = ?',
        ).get(identity.idempotencyKey)
        claimed = { state: 'claimed', leaseToken, leaseExpiresAt }
        return
      }

      assertMatchingMailClassificationTask(row, identity)
      if (row.status === 'committed') {
        claimed = { state: 'committed', result: decodeMailClassificationTaskPayload(row.result_encrypted) }
        return
      }
      const leaseActive = row.lease_token
        && Date.parse(String(row.lease_expires_at ?? '')) > atMs
      if (leaseActive) {
        throw mailClassificationStorageError(
          'MAIL_CLASSIFICATION_IN_PROGRESS',
          'This email-classification request is already running.',
          409,
        )
      }
      database.prepare(
        `UPDATE mail_classification_tasks
            SET lease_token = ?, lease_expires_at = ?, updated_at = ?
          WHERE idempotency_key = ?`,
      ).run(leaseToken, leaseExpiresAt, at, identity.idempotencyKey)
      claimed = row.status === 'prepared'
        ? {
            state: 'prepared',
            leaseToken,
            leaseExpiresAt,
            updates: decodeMailClassificationTaskPayload(row.updates_encrypted)?.updates ?? [],
          }
        : { state: 'claimed', leaseToken, leaseExpiresAt }
    }).immediate()
    await synchronizeExternalDatabase({ force: true })
    return claimed
  })
}

export async function saveMailClassificationTaskProgress(input) {
  const identity = normalizeMailClassificationTaskIdentity(input)
  const leaseToken = String(input.leaseToken ?? '').trim()
  if (!leaseToken) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_TASK_LEASE_LOST',
      'The email-classification task lease is unavailable.',
      409,
    )
  }
  const encrypted = encodeMailClassificationTaskPayload({ updates: input.updates ?? [] })
  await ensureStorage()
  return withWriteLock(async () => {
    const database = getDb()
    ensureMailClassificationTaskSchema(database)
    const at = nowStamp()
    const result = database.transaction(() => {
      const row = database.prepare(
        'SELECT * FROM mail_classification_tasks WHERE idempotency_key = ?',
      ).get(identity.idempotencyKey)
      if (!row) {
        throw mailClassificationStorageError(
          'MAIL_CLASSIFICATION_TASK_LEASE_LOST',
          'The email-classification task no longer exists.',
          409,
        )
      }
      assertMatchingMailClassificationTask(row, identity)
      if (row.status === 'committed') {
        return { state: 'committed', result: decodeMailClassificationTaskPayload(row.result_encrypted) }
      }
      if (row.status !== 'running' || row.lease_token !== leaseToken) {
        throw mailClassificationStorageError(
          'MAIL_CLASSIFICATION_TASK_LEASE_LOST',
          'The email-classification task lease changed before progress was saved.',
          409,
        )
      }
      database.prepare(
        `UPDATE mail_classification_tasks
            SET status = 'prepared', updates_encrypted = ?, updated_at = ?
          WHERE idempotency_key = ? AND lease_token = ?`,
      ).run(encrypted, at, identity.idempotencyKey, leaseToken)
      return { state: 'prepared' }
    }).immediate()
    await synchronizeExternalDatabase({ force: true })
    return result
  })
}

/** Release a failed owner immediately; paid prepared results remain replayable. */
export async function releaseMailClassificationTask(input) {
  const identity = normalizeMailClassificationTaskIdentity(input)
  const leaseToken = String(input.leaseToken ?? '').trim()
  if (!leaseToken) return false
  await ensureStorage()
  return withWriteLock(async () => {
    const database = getDb()
    ensureMailClassificationTaskSchema(database)
    const changed = database.transaction(() => {
      const row = database.prepare(
        'SELECT * FROM mail_classification_tasks WHERE idempotency_key = ?',
      ).get(identity.idempotencyKey)
      if (!row) return 0
      assertMatchingMailClassificationTask(row, identity)
      if (row.status === 'committed' || row.lease_token !== leaseToken) return 0
      if (row.status === 'prepared') {
        return database.prepare(
          `UPDATE mail_classification_tasks
              SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
            WHERE idempotency_key = ? AND lease_token = ?`,
        ).run(nowStamp(), identity.idempotencyKey, leaseToken).changes
      }
      return database.prepare(
        `DELETE FROM mail_classification_tasks
          WHERE idempotency_key = ? AND lease_token = ? AND status = 'running'`,
      ).run(identity.idempotencyKey, leaseToken).changes
    }).immediate()
    if (changed) await synchronizeExternalDatabase({ force: true })
    return Boolean(changed)
  })
}

function mailClassificationCommunicationDelta(communication) {
  return {
    id: String(communication.id),
    mailCategories: Array.isArray(communication.mailCategories)
      ? structuredClone(communication.mailCategories)
      : null,
    mailCategoryOverride: communication.mailCategoryOverride ?? null,
    mailClassification: communication.mailClassification
      ? structuredClone(communication.mailClassification)
      : null,
  }
}

function applyMailClassificationUpdates(application, updates) {
  const byId = new Map((application.communications ?? []).map((communication) => [
    String(communication?.id ?? ''),
    communication,
  ]))
  for (const update of updates) {
    const communication = byId.get(String(update?.id ?? ''))
    if (!communication) {
      throw mailClassificationStorageError(
        'REVISION_CONFLICT',
        'A selected email changed before the classification could be saved.',
        409,
      )
    }
    if (Object.hasOwn(update, 'mailCategoryOverride')) {
      if (update.mailCategoryOverride === null) delete communication.mailCategoryOverride
      else communication.mailCategoryOverride = update.mailCategoryOverride
    }
    if (Object.hasOwn(update, 'mailCategories')) {
      if (update.mailCategories === null) delete communication.mailCategories
      else communication.mailCategories = structuredClone(update.mailCategories)
    }
    if (update.mailClassification) {
      communication.mailClassification = structuredClone(update.mailClassification)
    }
  }
  return byId
}

function assertMailClassificationCommitAuthorization(database, input) {
  const actorId = String(input.actorId ?? '').trim()
  const ownerId = String(input.ownerId ?? '').trim()
  const teamId = input.teamId == null ? null : String(input.teamId)
  const lockedTeamId = input.lockedTeamId == null ? null : String(input.lockedTeamId)
  const expectedAuthVersion = Number(input.expectedAuthVersion)
  const actorRow = database.prepare(
    'SELECT id, role, disabled_at, auth_version FROM users WHERE id = ?',
  ).get(actorId)
  if (
    !actorRow
    || actorRow.disabled_at
    || !Number.isSafeInteger(expectedAuthVersion)
    || Number(actorRow.auth_version ?? 0) !== expectedAuthVersion
  ) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_SESSION_INVALID',
      'The signed-in session is no longer valid.',
      401,
    )
  }
  if (lockedTeamId && lockedTeamId !== teamId) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_FORBIDDEN',
      'The active Team session cannot edit this application.',
      403,
    )
  }
  if (normalizeUserRole(actorRow.role) === 'admin') return
  if (!teamId) {
    if (actorId === ownerId) return
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_FORBIDDEN',
      'Your permissions no longer allow editing this application.',
      403,
    )
  }

  const teamRow = database.prepare('SELECT * FROM teams WHERE id = ?').get(teamId)
  if (!teamRow) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_FORBIDDEN',
      'The Team is no longer available.',
      403,
    )
  }
  const team = teamFromRow(teamRow)
  if (team.ownerId === actorId) return
  const actorMemberRow = database.prepare(
    `SELECT * FROM team_members
      WHERE team_id = ? AND user_id = ? AND status = 'active' AND removed_at IS NULL`,
  ).get(teamId, actorId)
  const actorMember = actorMemberRow ? teamMemberFromRow(actorMemberRow) : null
  if (actorMember?.role === 'member' && actorId === ownerId) {
    const permissions = normalizeStudentPermissions(
      actorMember.relationships?.studentPermissions,
      team.permissionDefaults.student,
    )
    if (permissions.editApplications) return
  } else if (actorMember?.role === 'admin') {
    const ownerMemberRow = database.prepare(
      `SELECT * FROM team_members
        WHERE team_id = ? AND user_id = ? AND role = 'member'
          AND status = 'active' AND removed_at IS NULL`,
    ).get(teamId, ownerId)
    const ownerMember = ownerMemberRow ? teamMemberFromRow(ownerMemberRow) : null
    const permissions = normalizeTeacherPermissions(
      actorMember.relationships?.teacherPermissions,
      team.permissionDefaults.teacher,
    )
    if (permissions.editStudentApplications && isTeacherAssignedToStudent(ownerMember, actorId)) return
  }
  throw mailClassificationStorageError(
    'MAIL_CLASSIFICATION_FORBIDDEN',
    'Your Team assignment or edit permission was revoked before the classification was saved.',
    403,
  )
}

/**
 * One-row payload_version CAS plus task acknowledgement in the same SQLite
 * transaction. No peer application, Team workspace, or global store is read.
 */
export async function commitMailClassificationUpdates(input) {
  const identity = input.idempotencyKey
    ? normalizeMailClassificationTaskIdentity(input)
    : null
  const applicationId = String(input.applicationId ?? '').trim()
  const actorId = String(input.actorId ?? '').trim()
  const expectedOwnerId = String(input.expectedOwnerId ?? '').trim()
  const expectedTeamId = input.expectedTeamId == null ? null : String(input.expectedTeamId)
  const expectedRevision = Number(input.expectedRevision)
  const leaseToken = String(input.leaseToken ?? '').trim()
  const updates = Array.isArray(input.updates) ? structuredClone(input.updates) : []
  const selectedIds = [...new Set(
    (Array.isArray(input.selectedCommunicationIds) ? input.selectedCommunicationIds : updates.map((item) => item?.id))
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )]
  if (!applicationId || !actorId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw mailClassificationStorageError(
      'MAIL_CLASSIFICATION_COMMIT_INVALID',
      'The email-classification commit identity is invalid.',
      400,
    )
  }

  await ensureStorage()
  return withWriteLock(async () => {
    const database = getDb()
    ensureMailClassificationTaskSchema(database)
    const preflight = database.prepare(
      `SELECT id, owner_id, team_id, payload_version,
              LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
         FROM applications WHERE id = ?`,
    ).get(applicationId)
    if (!preflight) {
      throw mailClassificationStorageError('REVISION_CONFLICT', 'Application not found.', 409)
    }
    const releaseMemory = quotaRowMemoryLease(preflight.payload_bytes)
    try {
      let committed
      database.transaction(() => {
        let taskRow = null
        if (identity) {
          taskRow = database.prepare(
            'SELECT * FROM mail_classification_tasks WHERE idempotency_key = ?',
          ).get(identity.idempotencyKey)
          if (!taskRow) {
            throw mailClassificationStorageError(
              'MAIL_CLASSIFICATION_TASK_LEASE_LOST',
              'The email-classification task no longer exists.',
              409,
            )
          }
          assertMatchingMailClassificationTask(taskRow, identity)
          if (taskRow.status === 'committed') {
            committed = decodeMailClassificationTaskPayload(taskRow.result_encrypted)
            return
          }
          if (!leaseToken || taskRow.lease_token !== leaseToken) {
            throw mailClassificationStorageError(
              'MAIL_CLASSIFICATION_TASK_LEASE_LOST',
              'The email-classification task lease changed before commit.',
              409,
            )
          }
          const prepared = decodeMailClassificationTaskPayload(taskRow.updates_encrypted, null)
          if (
            taskRow.status === 'prepared'
            && JSON.stringify(prepared?.updates ?? null) !== JSON.stringify(updates)
          ) {
            throw mailClassificationStorageError(
              'MAIL_CLASSIFICATION_TASK_PROGRESS_CONFLICT',
              'The prepared email-classification result does not match this commit.',
              409,
            )
          }
        }

        const row = database.prepare('SELECT * FROM applications WHERE id = ?').get(applicationId)
        if (
          !row
          || Number(row.payload_version ?? 0) !== expectedRevision
          || row.owner_id !== expectedOwnerId
          || (row.team_id ?? null) !== expectedTeamId
        ) {
          throw mailClassificationStorageError(
            'REVISION_CONFLICT',
            'The application changed before the email classification could be saved.',
            409,
          )
        }
        assertMailClassificationCommitAuthorization(database, {
          actorId,
          ownerId: expectedOwnerId,
          teamId: expectedTeamId,
          lockedTeamId: input.lockedTeamId,
          expectedAuthVersion: input.expectedAuthVersion,
        })
        const payload = decodePayloadFromStorage(row.payload_json)
        const application = {
          ...payload,
          id: row.id,
          ownerId: row.owner_id,
          teamId: row.team_id ?? null,
          updatedAt: row.updated_at,
        }
        const communicationById = applyMailClassificationUpdates(application, updates)
        if (selectedIds.some((id) => !communicationById.has(id))) {
          throw mailClassificationStorageError(
            'REVISION_CONFLICT',
            'A selected email changed before the classification could be saved.',
            409,
          )
        }
        application.updatedAt = nowStamp()
        const writePlan = {
          fullReconcile: false,
          users: { upserts: [], deletedIds: [] },
          applications: { upserts: [application], deletedIds: [] },
          profileAssets: { upserts: [], deletedIds: [] },
        }
        const quotaGuard = prepareWorkspaceQuotaMutationGuard(database, writePlan)
        const encoded = encodePayloadForStorage(application)
        const changed = database.prepare(
          `UPDATE applications
              SET updated_at = ?, authored_hash = ?, authority_hash = ?, payload_json = ?
            WHERE id = ? AND payload_version = ? AND owner_id = ?
              AND team_id IS ?`,
        ).run(
          application.updatedAt,
          applicationAuthoredContentHash(application),
          JSON.stringify(applicationAuthorityContentHashes(application)),
          encoded,
          applicationId,
          expectedRevision,
          expectedOwnerId,
          expectedTeamId,
        )
        if (Number(changed.changes ?? 0) !== 1) {
          throw mailClassificationStorageError(
            'REVISION_CONFLICT',
            'The application changed before the email classification could be saved.',
            409,
          )
        }
        const revision = Number(database.prepare(
          'SELECT payload_version FROM applications WHERE id = ?',
        ).get(applicationId)?.payload_version ?? -1)
        syncWorkspaceQuotaApplication(database, application, revision)
        assertWorkspaceQuotaMutation(database, quotaGuard)
        database.prepare(
          `INSERT INTO system_events (
             id, time, scope, actor_id, message, metadata_json
           ) VALUES (?, ?, 'Communication', ?, ?, ?)`,
        ).run(
          createId('event'),
          application.updatedAt,
          actorId,
          updates.some((update) => update.mailClassification)
            ? `Classified ${updates.length} email${updates.length === 1 ? '' : 's'} with AI`
            : `Updated categories for ${updates.length} email${updates.length === 1 ? '' : 's'}`,
          toJson({
            applicationId,
            teamId: expectedTeamId,
            ownerId: expectedOwnerId,
            communicationIds: updates.map((update) => update.id),
          }),
        )
        committed = {
          communications: selectedIds.map((id) => (
            mailClassificationCommunicationDelta(communicationById.get(id))
          )),
          revision,
          durable: true,
          ...(input.resultMetadata && typeof input.resultMetadata === 'object'
            ? structuredClone(input.resultMetadata)
            : {}),
        }
        if (identity) {
          database.prepare(
            `UPDATE mail_classification_tasks
                SET status = 'committed', result_encrypted = ?, updates_encrypted = NULL,
                    lease_token = NULL, lease_expires_at = NULL, updated_at = ?
              WHERE idempotency_key = ? AND lease_token = ?`,
          ).run(
            encodeMailClassificationTaskPayload(committed),
            application.updatedAt,
            identity.idempotencyKey,
            leaseToken,
          )
        }
      }).immediate()
      invalidateSharedStoreCache()
      await synchronizeExternalDatabase({ force: true })
      return committed
    } finally {
      releaseMemory?.()
    }
  })
}

export async function mailClassificationTaskDiagnostics() {
  await ensureStorage()
  const database = getDb()
  ensureMailClassificationTaskSchema(database)
  const rows = database.prepare(
    `SELECT status, COUNT(*) AS count
       FROM mail_classification_tasks GROUP BY status`,
  ).all()
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.count ?? 0)]))
  return {
    running: counts.running ?? 0,
    prepared: counts.prepared ?? 0,
    committed: counts.committed ?? 0,
    active: (counts.running ?? 0) + (counts.prepared ?? 0),
  }
}

export function teamApplicationVisibilityKey(teamId, ownerId) {
  if (!teamId || !ownerId) return ''
  // JSON tuple encoding keeps the two authorization dimensions unambiguous even
  // when externally supplied ids contain punctuation or delimiter characters.
  return JSON.stringify([String(teamId), String(ownerId)])
}

// `teamVisibleApplicationKeys` is precomputed per request in `hydrateUser`
// (server/index.js). Each grant is bound to both the organization and student;
// authorization for a student in Team A must never expose that student's Team B
// application. See `computeTeamVisibleApplicationKeys`.
export function findUserApplication(store, user, id, teamVisibleApplicationKeys = new Set()) {
  return store.applications.find((application) => {
    if (application.id !== id) return false
    if (application.ownerId === user.id) return true
    if (!application.teamId) return false
    return teamVisibleApplicationKeys.has(
      teamApplicationVisibilityKey(application.teamId, application.ownerId),
    )
  })
}

export function summarizeUserApplications(store, userId) {
  return store.applications.filter((application) => (
    application.ownerId === userId
    && (!PUBLIC_EDITION || !application.teamId)
  ))
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
    permissionDefaults: normalizeTeamPermissionDefaults(fromJson(row.permission_defaults_json, {})),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function teamMemberFromRow(row) {
  const storedRelationships = fromJson(row.relationship_json, {})
  const rawRelationships = storedRelationships && typeof storedRelationships === 'object'
    ? storedRelationships
    : {}
  const relationships = normalizeTeamMemberRelationships(rawRelationships, row.role)
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    invitedEmail: row.invited_email,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    relationships,
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

let teamInviteTransitionFailpoint = null

export function configureTeamInviteTransitionFailpointForTests(failpoint) {
  if (failpoint !== null && typeof failpoint !== 'function') {
    throw new TypeError('Team invite transition failpoint must be a function or null.')
  }
  if (failpoint && process.env.NODE_ENV !== 'test') {
    throw new Error('Team invite transition failpoints are available only in tests.')
  }
  teamInviteTransitionFailpoint = failpoint
}

function runTeamInviteTransitionFailpoint(stage, context) {
  teamInviteTransitionFailpoint?.(stage, Object.freeze({ ...context }))
}

function normalizeTeamInviteEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function teamInviteTokenHash(token) {
  const normalized = String(token ?? '')
  if (normalized.length < 16 || normalized.length > 512) return ''
  return hashInviteToken(normalized)
}

function teamInviteStateFromRow(row) {
  if (!row) return null
  return {
    tokenHash: row.token_hash,
    memberId: row.member_id,
    teamId: row.team_id,
    invitedEmail: row.invited_email,
    role: row.role,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    status: row.status,
    acceptedBy: row.accepted_by ?? null,
    terminalAt: row.terminal_at ?? null,
    stateVersion: Number(row.state_version ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function selectTeamInviteState(database, tokenHash) {
  if (!tokenHash) return null
  return database.prepare(
    `SELECT token_hash, member_id, team_id, invited_email, role, invited_by,
            expires_at, status, accepted_by, terminal_at, state_version,
            created_at, updated_at
       FROM team_invites
      WHERE token_hash = ?`,
  ).get(tokenHash)
}

function teamInviteIsExpired(invite, at) {
  const expiresAt = Date.parse(invite?.expiresAt ?? invite?.expires_at ?? '')
  const comparedAt = Date.parse(at)
  return !Number.isFinite(expiresAt) || expiresAt <= comparedAt
}

function insertTeamInviteAuditEvent(database, {
  at,
  actorId = null,
  message,
  teamId,
  memberId,
  action,
  role,
}) {
  database.prepare(
    `INSERT INTO system_events (id, time, scope, actor_id, message, metadata_json)
     VALUES (?, ?, 'Team invite', ?, ?, ?)`,
  ).run(
    createId('event'),
    at,
    actorId,
    message,
    toJson({ teamId, memberId, action, role }),
  )
}

function activeTeamInviteIssuer(database, invite, teamRow) {
  const inviterUser = database.prepare(
    'SELECT id, role, disabled_at FROM users WHERE id = ?',
  ).get(invite.invited_by)
  if (!inviterUser || inviterUser.disabled_at) return false
  if (normalizeUserRole(inviterUser.role) === 'admin') return true
  const membership = database.prepare(
    `SELECT role, status, relationship_json
       FROM team_members
      WHERE team_id = ? AND user_id = ? AND status = 'active'
      LIMIT 1`,
  ).get(invite.team_id, invite.invited_by)
  if (!membership) return false
  if (membership.role === 'owner') return teamRow.owner_id === invite.invited_by
  if (invite.role !== 'member' || membership.role !== 'admin') return false
  const relationships = normalizeTeamMemberRelationships(
    fromJson(membership.relationship_json, {}),
    membership.role,
  )
  const defaults = normalizeTeamPermissionDefaults(
    fromJson(teamRow.permission_defaults_json, {}),
  )
  return relationships.teacherPermissions?.inviteStudents
    ?? defaults.teacher.inviteStudents
}

function teamInviteSeatUsage(database, teamId, role, at) {
  const row = database.prepare(
    `SELECT
       COUNT(*) AS total_count,
       SUM(CASE WHEN member.role = ? THEN 1 ELSE 0 END) AS role_count
     FROM team_members AS member
     LEFT JOIN team_invites AS invite ON invite.member_id = member.id
     WHERE member.team_id = ?
       AND (
         member.status = 'active'
         OR (
           member.status = 'pending'
           AND invite.status = 'pending'
           AND invite.expires_at > ?
         )
       )`,
  ).get(role, teamId, at)
  return {
    total: Number(row?.total_count ?? 0),
    role: Number(row?.role_count ?? 0),
  }
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
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id }))
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
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamLogo(teamId, logoDataUrl) {
  await ensureStorage()
  getDb()
    .prepare('UPDATE teams SET logo_data_url = ?, updated_at = ? WHERE id = ?')
    .run(logoDataUrl, nowStamp(), teamId)
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamSeatLimit(teamId, seatLimit) {
  await ensureStorage()
  getDb().prepare('UPDATE teams SET seat_limit = ?, updated_at = ? WHERE id = ?').run(seatLimit, nowStamp(), teamId)
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamProfilePresets(teamId, presets) {
  await ensureStorage()
  getDb()
    .prepare('UPDATE teams SET profile_presets_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(presets), nowStamp(), teamId)
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamRoleLabels(teamId, roleLabels) {
  await ensureStorage()
  const normalized = normalizeTeamRoleLabels(roleLabels) ?? {}
  getDb()
    .prepare('UPDATE teams SET role_labels_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(normalized), nowStamp(), teamId)
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamPermissionDefaults(teamId, patch) {
  await ensureStorage()
  const currentRow = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(teamId)
  if (!currentRow) return null
  const current = normalizeTeamPermissionDefaults(fromJson(currentRow.permission_defaults_json, {}))
  const next = normalizeTeamPermissionDefaults({
    student: {
      ...current.student,
      ...(patch?.student ?? {}),
    },
    teacher: {
      ...current.teacher,
      ...(patch?.teacher ?? {}),
    },
  })
  getDb()
    .prepare('UPDATE teams SET permission_defaults_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(next), nowStamp(), teamId)
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
  invalidateSharedStoreCache()
  return getTeamById(teamId)
}

export async function updateTeamTeacherGroups(teamId, teacherGroups) {
  await ensureStorage()
  const normalized = normalizeTeamTeacherGroups(teacherGroups)
  getDb()
    .prepare('UPDATE teams SET teacher_groups_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(normalized), nowStamp(), teamId)
  bumpDurableTenantRevision(getDb(), tenantKeyForTeam({ id: teamId }))
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
 * Which team-scoped applications `userId` may see through team membership, scoped to the
 * institution-admin/teacher/student hierarchy: an `owner` sees every active student member's applications;
 * `admin` (teacher) sees every student whose collaboration roster includes that teacher; a
 * `member` (student) gets nothing extra here.
 */
export async function computeTeamVisibleApplicationKeys(userId, knownMemberships) {
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
      visible.add(teamApplicationVisibilityKey(member.teamId, member.userId))
    } else if (membership?.role === 'admin' && isTeacherAssignedToStudent(member, userId)) {
      visible.add(teamApplicationVisibilityKey(member.teamId, member.userId))
    }
  }
  return visible
}

export async function createTeamInvite(
  teamId,
  {
    id: requestedId,
    email,
    role,
    invitedBy,
    existingUserId,
    token,
    expiresAt,
    relationships = {},
  },
  { systemMailJobs = [], notification = null } = {},
) {
  await ensureStorage()
  const id = requestedId || createId('tmem')
  const now = nowStamp()
  const database = getDb()
  const tokenHash = teamInviteTokenHash(token)
  const normalizedEmail = normalizeTeamInviteEmail(email)
  if (!tokenHash || !normalizedEmail || !['admin', 'member'].includes(role)) {
    throw new Error('Team invitation capability is invalid.')
  }
  let createdNotification = null
  const createInvite = database.transaction(() => {
    database.prepare(
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
      normalizedEmail,
      role,
      invitedBy,
      toJson(relationships ?? {}),
      null,
      expiresAt,
      now,
      now,
    )
    database.prepare(
      `INSERT INTO team_invites (
         token_hash, member_id, team_id, invited_email, role, invited_by,
         expires_at, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      tokenHash,
      id,
      teamId,
      normalizedEmail,
      role,
      invitedBy,
      expiresAt,
      now,
      now,
    )
    for (const job of systemMailJobs) {
      insertSystemMailJob(database, job)
    }
    if (notification?.userId && notification?.candidate) {
      createdNotification = insertNotificationRow(
        database,
        notification.userId,
        notification.candidate,
      )
    }
  })
  createInvite.immediate()
  invalidateSharedStoreCache()
  return {
    member: teamMemberFromRow(database.prepare('SELECT * FROM team_members WHERE id = ?').get(id)),
    notification: createdNotification,
  }
}

export async function findTeamInviteByToken(token) {
  await ensureStorage()
  const invite = teamInviteStateFromRow(
    selectTeamInviteState(getDb(), teamInviteTokenHash(token)),
  )
  if (!invite) return null
  return {
    id: invite.memberId,
    teamId: invite.teamId,
    invitedEmail: invite.invitedEmail,
    role: invite.role,
    status: invite.status === 'pending' ? 'pending' : 'removed',
    invitedBy: invite.invitedBy,
    inviteExpiresAt: invite.expiresAt,
    acceptedBy: invite.acceptedBy,
    inviteStatus: invite.status,
    inviteStateVersion: invite.stateVersion,
    createdAt: invite.createdAt,
    updatedAt: invite.updatedAt,
    removedAt: invite.terminalAt,
  }
}

export async function readTeamInvitePreviewByToken(token, { at = nowStamp() } = {}) {
  await ensureStorage()
  const tokenHash = teamInviteTokenHash(token)
  if (!tokenHash) return null
  const row = getDb().prepare(
    `SELECT invite.member_id, invite.team_id, invite.role, invite.expires_at,
            invite.invited_email, team.name AS team_name,
            COALESCE(inviter.name, '') AS inviter_name,
            EXISTS(
              SELECT 1 FROM users AS candidate
               WHERE candidate.disabled_at IS NULL
                 AND lower(COALESCE(candidate.canonical_email, candidate.email)) = invite.invited_email
            ) AS existing_user
       FROM team_invites AS invite
       JOIN teams AS team ON team.id = invite.team_id
       LEFT JOIN users AS inviter ON inviter.id = invite.invited_by
      WHERE invite.token_hash = ?
        AND invite.status = 'pending'
        AND invite.expires_at > ?
      LIMIT 1`,
  ).get(tokenHash, at)
  if (!row) return null
  const [local = '', domain = ''] = row.invited_email.split('@')
  const maskedEmail = domain
    ? `${local.slice(0, Math.min(2, local.length))}***@${domain}`
    : '***'
  return {
    teamName: row.team_name,
    inviterName: row.inviter_name,
    role: row.role,
    invitedEmail: maskedEmail,
    requiresRegistration: !row.existing_user,
    expiresAt: row.expires_at,
  }
}

export async function acceptTeamInviteByToken(token, {
  userId,
  userEmail,
  teacherSeatLimit,
  studentSeatLimit,
  at = nowStamp(),
} = {}) {
  await ensureStorage()
  const database = getDb()
  const tokenHash = teamInviteTokenHash(token)
  const normalizedClaimedEmail = normalizeTeamInviteEmail(userEmail)
  if (!tokenHash || !userId || !normalizedClaimedEmail) return { ok: false, reason: 'NOT_FOUND' }
  const transition = database.transaction(() => {
    const inviteRow = selectTeamInviteState(database, tokenHash)
    if (!inviteRow || inviteRow.status !== 'pending') return { ok: false, reason: 'NOT_FOUND' }
    const invite = teamInviteStateFromRow(inviteRow)
    if (teamInviteIsExpired(invite, at)) return { ok: false, reason: 'EXPIRED' }

    const userRow = database.prepare(
      `SELECT id, email, canonical_email, role, disabled_at, settings_version, settings_json
         FROM users WHERE id = ?`,
    ).get(String(userId))
    if (!userRow || userRow.disabled_at) return { ok: false, reason: 'ACCOUNT_DISABLED' }
    const canonicalEmail = normalizeTeamInviteEmail(userRow.canonical_email || userRow.email)
    if (
      canonicalEmail !== normalizedClaimedEmail
      || canonicalEmail !== invite.invitedEmail
    ) return { ok: false, reason: 'EMAIL_MISMATCH' }

    const teamRow = database.prepare(
      `SELECT id, name, owner_id, seat_limit, permission_defaults_json,
              created_at, updated_at, logo_data_url, profile_presets_json,
              role_labels_json, teacher_groups_json
         FROM teams WHERE id = ?`,
    ).get(invite.teamId)
    if (!teamRow) return { ok: false, reason: 'NOT_FOUND' }
    if (!activeTeamInviteIssuer(database, inviteRow, teamRow)) {
      return { ok: false, reason: 'INVITER_FORBIDDEN' }
    }

    const memberRow = database.prepare(
      `SELECT id, team_id, user_id, invited_email, role, status, invited_by,
              relationship_json, profile_json, invite_expires_at,
              created_at, updated_at, removed_at
         FROM team_members WHERE id = ? AND team_id = ?`,
    ).get(invite.memberId, invite.teamId)
    if (
      !memberRow
      || memberRow.status !== 'pending'
      || memberRow.role !== invite.role
      || normalizeTeamInviteEmail(memberRow.invited_email) !== invite.invitedEmail
      || (memberRow.user_id && memberRow.user_id !== userId)
    ) return { ok: false, reason: 'STATE_CONFLICT' }

    const duplicate = database.prepare(
      `SELECT id FROM team_members
        WHERE team_id = ? AND id <> ? AND status IN ('pending', 'active')
          AND (user_id = ? OR lower(invited_email) = ?)
        LIMIT 1`,
    ).get(invite.teamId, invite.memberId, userId, canonicalEmail)
    if (duplicate) return { ok: false, reason: 'MEMBER_ALREADY_INVITED' }

    const limits = {
      admin: Math.max(0, Number(teacherSeatLimit) || 0),
      member: Math.max(0, Number(studentSeatLimit) || 0),
    }
    const usage = teamInviteSeatUsage(database, invite.teamId, invite.role, at)
    const teamSeatLimit = Math.max(0, Number(teamRow.seat_limit) || 0)
    if (
      usage.total > teamSeatLimit
      || usage.role > limits[invite.role]
    ) return { ok: false, reason: 'SEAT_LIMIT_REACHED' }

    const claimed = database.prepare(
      `UPDATE team_invites
          SET status = 'accepted', accepted_by = ?, terminal_at = ?,
              state_version = state_version + 1, updated_at = ?
        WHERE token_hash = ? AND status = 'pending' AND state_version = ?`,
    ).run(userId, at, at, tokenHash, invite.stateVersion)
    if (Number(claimed.changes ?? 0) !== 1) return { ok: false, reason: 'STATE_CONFLICT' }
    runTeamInviteTransitionFailpoint('after-invite-cas', { action: 'accept', memberId: invite.memberId })

    const activated = database.prepare(
      `UPDATE team_members
          SET status = 'active', user_id = ?, invite_token_hash = NULL,
              invite_expires_at = NULL, removed_at = NULL, updated_at = ?
        WHERE id = ? AND team_id = ? AND status = 'pending'`,
    ).run(userId, at, invite.memberId, invite.teamId)
    if (Number(activated.changes ?? 0) !== 1) throw new Error('Team invite membership CAS failed.')
    runTeamInviteTransitionFailpoint('after-membership', { action: 'accept', memberId: invite.memberId })

    if (normalizeUserRole(userRow.role) !== 'admin') {
      const nextSettings = teamPlanSettings(fromJson(userRow.settings_json, {}))
      const quotaUser = { id: userId, settings: nextSettings }
      const quotaGuard = prepareWorkspaceQuotaMutationGuard(database, {
        fullReconcile: false,
        users: { upserts: [quotaUser], deletedIds: [] },
        applications: { upserts: [], deletedIds: [] },
        profileAssets: { upserts: [], deletedIds: [] },
      })
      const updatedUser = database.prepare(
        'UPDATE users SET settings_json = ? WHERE id = ? AND settings_version = ?',
      ).run(toJson(nextSettings), userId, Number(userRow.settings_version ?? 0))
      if (Number(updatedUser.changes ?? 0) !== 1) throw new Error('Team invite plan CAS failed.')
      const settingsVersion = Number(database.prepare(
        'SELECT settings_version FROM users WHERE id = ?',
      ).get(userId)?.settings_version ?? -1)
      syncWorkspaceQuotaUser(database, quotaUser, settingsVersion)
      replaceWorkspacePublicGrants(
        database,
        'user',
        quotaUser,
        settingsVersion,
      )
      assertWorkspaceQuotaMutation(database, quotaGuard)
    }
    runTeamInviteTransitionFailpoint('after-plan', { action: 'accept', memberId: invite.memberId })

    insertTeamInviteAuditEvent(database, {
      at,
      actorId: userId,
      message: `${canonicalEmail} accepted a Team invitation`,
      teamId: invite.teamId,
      memberId: invite.memberId,
      action: 'accepted',
      role: invite.role,
    })
    runTeamInviteTransitionFailpoint('after-audit', { action: 'accept', memberId: invite.memberId })

    const acceptedMember = database.prepare('SELECT * FROM team_members WHERE id = ?').get(invite.memberId)
    const acceptedTeam = database.prepare('SELECT * FROM teams WHERE id = ?').get(invite.teamId)
    return {
      ok: true,
      membership: teamMemberFromRow(acceptedMember),
      team: teamFromRow(acceptedTeam),
    }
  })
  const result = transition.immediate()
  if (result.ok) invalidateSharedStoreCache()
  await acknowledgeSecurityStorageMutation(Boolean(result.ok))
  return result
}

export async function declineTeamInviteByToken(token, { at = nowStamp() } = {}) {
  await ensureStorage()
  const database = getDb()
  const tokenHash = teamInviteTokenHash(token)
  if (!tokenHash) return { ok: false, reason: 'NOT_FOUND' }
  const transition = database.transaction(() => {
    const inviteRow = selectTeamInviteState(database, tokenHash)
    if (!inviteRow || inviteRow.status !== 'pending') return { ok: false, reason: 'NOT_FOUND' }
    const invite = teamInviteStateFromRow(inviteRow)
    if (teamInviteIsExpired(invite, at)) return { ok: false, reason: 'EXPIRED' }
    const claimed = database.prepare(
      `UPDATE team_invites
          SET status = 'declined', terminal_at = ?, state_version = state_version + 1, updated_at = ?
        WHERE token_hash = ? AND status = 'pending' AND state_version = ?`,
    ).run(at, at, tokenHash, invite.stateVersion)
    if (Number(claimed.changes ?? 0) !== 1) return { ok: false, reason: 'STATE_CONFLICT' }
    runTeamInviteTransitionFailpoint('after-invite-cas', { action: 'decline', memberId: invite.memberId })
    const removed = database.prepare(
      `UPDATE team_members
          SET status = 'removed', invite_token_hash = NULL, invite_expires_at = NULL,
              removed_at = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND status = 'pending'`,
    ).run(at, at, invite.memberId, invite.teamId)
    if (Number(removed.changes ?? 0) !== 1) throw new Error('Team invite decline membership CAS failed.')
    runTeamInviteTransitionFailpoint('after-membership', { action: 'decline', memberId: invite.memberId })
    insertTeamInviteAuditEvent(database, {
      at,
      message: `${invite.invitedEmail} declined a Team invitation`,
      teamId: invite.teamId,
      memberId: invite.memberId,
      action: 'declined',
      role: invite.role,
    })
    runTeamInviteTransitionFailpoint('after-audit', { action: 'decline', memberId: invite.memberId })
    return { ok: true, id: invite.memberId, declined: true }
  })
  const result = transition.immediate()
  if (result.ok) invalidateSharedStoreCache()
  await acknowledgeSecurityStorageMutation(Boolean(result.ok))
  return result
}

export async function revokeTeamInvite(memberId, {
  actorUserId,
  at = nowStamp(),
} = {}) {
  await ensureStorage()
  const database = getDb()
  if (!memberId || !actorUserId) return { ok: false, reason: 'NOT_FOUND' }
  const transition = database.transaction(() => {
    const inviteRow = database.prepare(
      `SELECT token_hash, member_id, team_id, invited_email, role, invited_by,
              expires_at, status, accepted_by, terminal_at, state_version,
              created_at, updated_at
         FROM team_invites WHERE member_id = ?`,
    ).get(String(memberId))
    if (!inviteRow || inviteRow.status !== 'pending') return { ok: false, reason: 'NOT_FOUND' }
    const invite = teamInviteStateFromRow(inviteRow)
    const teamRow = database.prepare(
      'SELECT id, owner_id, permission_defaults_json FROM teams WHERE id = ?',
    ).get(invite.teamId)
    const actor = database.prepare(
      'SELECT id, role, disabled_at FROM users WHERE id = ?',
    ).get(String(actorUserId))
    if (!teamRow || !actor || actor.disabled_at) return { ok: false, reason: 'FORBIDDEN' }

    let allowed = normalizeUserRole(actor.role) === 'admin' || teamRow.owner_id === actor.id
    if (!allowed && invite.role === 'member') {
      const actorMembership = database.prepare(
        `SELECT role, status, relationship_json FROM team_members
          WHERE team_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
      ).get(invite.teamId, actor.id)
      const pendingMember = database.prepare(
        'SELECT relationship_json FROM team_members WHERE id = ? AND team_id = ?',
      ).get(invite.memberId, invite.teamId)
      if (actorMembership?.role === 'admin' && pendingMember) {
        const actorRelationships = normalizeTeamMemberRelationships(
          fromJson(actorMembership.relationship_json, {}),
          'admin',
        )
        const pendingRelationships = normalizeTeamMemberRelationships(
          fromJson(pendingMember.relationship_json, {}),
          'member',
        )
        const defaults = normalizeTeamPermissionDefaults(
          fromJson(teamRow.permission_defaults_json, {}),
        )
        const canManage = actorRelationships.teacherPermissions?.manageStudentPermissions
          ?? defaults.teacher.manageStudentPermissions
        allowed = Boolean(
          canManage
          && Array.isArray(pendingRelationships.teacherIds)
          && pendingRelationships.teacherIds.includes(actor.id),
        )
      }
    }
    if (!allowed) return { ok: false, reason: 'FORBIDDEN' }

    const claimed = database.prepare(
      `UPDATE team_invites
          SET status = 'revoked', terminal_at = ?, state_version = state_version + 1, updated_at = ?
        WHERE member_id = ? AND status = 'pending' AND state_version = ?`,
    ).run(at, at, invite.memberId, invite.stateVersion)
    if (Number(claimed.changes ?? 0) !== 1) return { ok: false, reason: 'STATE_CONFLICT' }
    runTeamInviteTransitionFailpoint('after-invite-cas', { action: 'revoke', memberId: invite.memberId })
    const removed = database.prepare(
      `UPDATE team_members
          SET status = 'removed', invite_token_hash = NULL, invite_expires_at = NULL,
              removed_at = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND status = 'pending'`,
    ).run(at, at, invite.memberId, invite.teamId)
    if (Number(removed.changes ?? 0) !== 1) throw new Error('Team invite revoke membership CAS failed.')
    runTeamInviteTransitionFailpoint('after-membership', { action: 'revoke', memberId: invite.memberId })
    insertTeamInviteAuditEvent(database, {
      at,
      actorId: actor.id,
      message: `${actor.id} revoked a Team invitation`,
      teamId: invite.teamId,
      memberId: invite.memberId,
      action: 'revoked',
      role: invite.role,
    })
    runTeamInviteTransitionFailpoint('after-audit', { action: 'revoke', memberId: invite.memberId })
    return { ok: true, id: invite.memberId, revoked: true }
  })
  const result = transition.immediate()
  if (result.ok) invalidateSharedStoreCache()
  await acknowledgeSecurityStorageMutation(Boolean(result.ok))
  return result
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

export async function readTeamJoinCodePreviewByCode(code, { at = nowStamp() } = {}) {
  await ensureStorage()
  const normalized = normalizeJoinCode(code)
  if (normalized.length < 8 || normalized.length > 64) return null
  const database = getDb()
  const row = database.prepare(
    `SELECT credential.id, credential.team_id, credential.role,
            credential.teacher_ids_json, credential.expires_at,
            credential.max_uses, credential.use_count, team.name AS team_name
       FROM team_join_codes AS credential
       JOIN teams AS team ON team.id = credential.team_id
      WHERE credential.code_hash = ?
        AND credential.revoked_at IS NULL
        AND credential.expires_at > ?
        AND (credential.max_uses IS NULL OR credential.use_count < credential.max_uses)
      LIMIT 1`,
  ).get(hashJoinCode(normalized), at)
  if (!row) return null
  const teacherIds = Array.from(new Set(fromJson(row.teacher_ids_json, [])))
    .map((id) => String(id ?? '').trim())
    .filter(Boolean)
  let managerNames = []
  if (teacherIds.length > 0) {
    const placeholders = teacherIds.map(() => '?').join(', ')
    const namesById = new Map(database.prepare(
      `SELECT id, name FROM users
        WHERE id IN (${placeholders}) AND disabled_at IS NULL`,
    ).all(...teacherIds).map((candidate) => [candidate.id, candidate.name]))
    managerNames = teacherIds.map((id) => namesById.get(id)).filter(Boolean)
  }
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    role: row.role,
    expiresAt: row.expires_at,
    reusable: row.max_uses === null,
    managerNames,
  }
}

export async function redeemTeamJoinCode(
  code,
  { userId, userEmail, teacherSeatLimit, studentSeatLimit, at = nowStamp() },
) {
  await ensureStorage()
  const database = getDb()
  const now = at
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

    const userRow = database.prepare(
      `SELECT id, email, canonical_email, role, disabled_at, settings_version, settings_json
         FROM users WHERE id = ?`,
    ).get(String(userId ?? ''))
    if (!userRow || userRow.disabled_at) return { ok: false, reason: 'ACCOUNT_DISABLED' }
    const canonicalEmail = normalizeTeamInviteEmail(userRow.canonical_email || userRow.email)
    if (!canonicalEmail || canonicalEmail !== normalizedEmail) {
      return { ok: false, reason: 'EMAIL_MISMATCH' }
    }
    if (!activeTeamInviteIssuer(database, {
      invited_by: credential.createdBy,
      team_id: credential.teamId,
      role: credential.role,
    }, teamRow)) {
      return { ok: false, reason: 'TEAM_ROLE_FORBIDDEN' }
    }

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
      bumpDurableTenantRevision(database, tenantKeyForTeam({ id: credential.teamId }))
    } else {
      const roleLimit = credential.role === 'admin' ? teacherSeatLimit : studentSeatLimit
      const totalCount = database.prepare(
        `SELECT COUNT(*) AS count FROM team_members
          WHERE team_id = ? AND status IN ('pending', 'active')`,
      ).get(credential.teamId)
      if (Number(totalCount?.count ?? 0) >= Math.max(0, Number(teamRow.seat_limit) || 0)) {
        return { ok: false, reason: 'SEAT_LIMIT_REACHED' }
      }
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
    const consumed = database.prepare(
      `UPDATE team_join_codes
          SET use_count = ?, revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE id = ? AND use_count = ? AND revoked_at IS NULL
          AND expires_at > ?
          AND (max_uses IS NULL OR use_count < max_uses)`,
    ).run(nextUseCount, revokeAt, now, credential.id, credential.useCount, now)
    if (Number(consumed.changes ?? 0) !== 1) return { ok: false, reason: 'STATE_CONFLICT' }
    runTeamInviteTransitionFailpoint('after-credential-cas', {
      action: 'join',
      credentialId: credential.id,
    })

    if (normalizeUserRole(userRow.role) !== 'admin') {
      const nextSettings = teamPlanSettings(fromJson(userRow.settings_json, {}))
      const quotaUser = { id: userId, settings: nextSettings }
      const quotaGuard = prepareWorkspaceQuotaMutationGuard(database, {
        fullReconcile: false,
        users: { upserts: [quotaUser], deletedIds: [] },
        applications: { upserts: [], deletedIds: [] },
        profileAssets: { upserts: [], deletedIds: [] },
      })
      const updatedUser = database.prepare(
        'UPDATE users SET settings_json = ? WHERE id = ? AND settings_version = ?',
      ).run(toJson(nextSettings), userId, Number(userRow.settings_version ?? 0))
      if (Number(updatedUser.changes ?? 0) !== 1) throw new Error('Team join plan CAS failed.')
      const settingsVersion = Number(database.prepare(
        'SELECT settings_version FROM users WHERE id = ?',
      ).get(userId)?.settings_version ?? -1)
      syncWorkspaceQuotaUser(database, quotaUser, settingsVersion)
      replaceWorkspacePublicGrants(database, 'user', quotaUser, settingsVersion)
      assertWorkspaceQuotaMutation(database, quotaGuard)
    }
    runTeamInviteTransitionFailpoint('after-plan', {
      action: 'join',
      credentialId: credential.id,
    })

    const membershipRow = database
      .prepare(
        `SELECT * FROM team_members
         WHERE team_id = ? AND user_id = ? AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(credential.teamId, userId)
    if (!membershipRow) throw new Error('Team join membership was not persisted.')
    database.prepare(
      `INSERT INTO system_events (id, time, scope, actor_id, message, metadata_json)
       VALUES (?, ?, 'Team invite', ?, ?, ?)`,
    ).run(
      createId('event'),
      now,
      userId,
      `${canonicalEmail} joined a Team with a ${credential.role} join code`,
      toJson({
        teamId: credential.teamId,
        memberId: membershipRow.id,
        credentialId: credential.id,
        role: credential.role,
        action: 'joined',
      }),
    )
    runTeamInviteTransitionFailpoint('after-audit', {
      action: 'join',
      credentialId: credential.id,
      memberId: membershipRow.id,
    })
    const updatedTeamRow = database.prepare('SELECT * FROM teams WHERE id = ?').get(credential.teamId)
    const updatedCredentialRow = database
      .prepare('SELECT * FROM team_join_codes WHERE id = ?')
      .get(credential.id)
    return {
      ok: true,
      team: teamFromRow(updatedTeamRow),
      membership: teamMemberFromRow(membershipRow),
      credential: teamJoinCodeFromRow(updatedCredentialRow),
      provisioning: normalizeUserRole(database.prepare(
        'SELECT role FROM users WHERE id = ?',
      ).get(updatedTeamRow.owner_id)?.role) === 'admin',
    }
  })

  const result = redeem.immediate()
  if (result.ok) invalidateSharedStoreCache()
  await acknowledgeSecurityStorageMutation(Boolean(result.ok))
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
  const database = getDb()
  const acceptLegacyFixture = database.transaction(() => {
    database.prepare(
      `UPDATE team_members
       SET status = 'active', user_id = ?, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(userId, now, memberId)
    database.prepare(
      `UPDATE team_invites
          SET status = 'accepted', accepted_by = ?, terminal_at = ?,
              state_version = state_version + 1, updated_at = ?
        WHERE member_id = ? AND status = 'pending'`,
    ).run(userId, now, now, memberId)
    return teamMemberFromRow(database.prepare('SELECT * FROM team_members WHERE id = ?').get(memberId))
  })
  const member = acceptLegacyFixture.immediate()
  invalidateSharedStoreCache()
  return member
}

export async function declineTeamInvite(memberId) {
  await ensureStorage()
  const now = nowStamp()
  const database = getDb()
  database.transaction(() => {
    database.prepare(
      `UPDATE team_members
          SET status = 'removed', invite_token_hash = NULL, invite_expires_at = NULL,
              removed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    ).run(now, now, memberId)
    database.prepare(
      `UPDATE team_invites
          SET status = 'declined', terminal_at = ?, state_version = state_version + 1, updated_at = ?
        WHERE member_id = ? AND status = 'pending'`,
    ).run(now, now, memberId)
  }).immediate()
  invalidateSharedStoreCache()
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
    maxConcurrency: normalizeAiKeyMaxConcurrency(row.max_concurrency),
    requestMode: normalizeAiKeyRequestMode(row.request_mode, row.provider),
    weight: normalizeAiKeyWeight(row.selection_weight),
    enabled: aiKeyIsEnabled(row.enabled),
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

export async function createAiKey({
  ownerId,
  teamId = null,
  scope,
  provider,
  label,
  model,
  baseUrl = '',
  apiKey,
  maxConcurrency = 4,
  requestMode = 'auto',
  weight = 50,
  enabled = true,
}) {
  await ensureStorage()
  const id = createId('aikey')
  const now = nowStamp()
  await withWriteLock(async () => {
    getDb()
      .prepare(
        `INSERT INTO ai_api_keys (
          id, owner_id, team_id, scope, provider, label, model, base_url,
          api_key_encrypted, max_concurrency, request_mode, selection_weight,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        ownerId,
        teamId,
        scope,
        provider,
        label,
        model,
        baseUrl,
        encryptSecret(apiKey),
        normalizeAiKeyMaxConcurrency(maxConcurrency),
        normalizeAiKeyRequestMode(requestMode, provider),
        normalizeAiKeyWeight(weight),
        enabled ? 1 : 0,
        now,
        now,
      )
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
    maxConcurrency: patch.maxConcurrency ?? current.maxConcurrency,
    requestMode: patch.requestMode ?? current.requestMode,
    weight: patch.weight ?? current.weight,
    enabled: patch.enabled ?? current.enabled,
  }
  const now = nowStamp()
  await withWriteLock(async () => {
    getDb()
      .prepare(
        `UPDATE ai_api_keys
         SET label = ?, model = ?, base_url = ?, api_key_encrypted = ?, max_concurrency = ?,
             request_mode = ?, selection_weight = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.label,
        next.model,
        next.baseUrl,
        encryptSecret(next.apiKey),
        normalizeAiKeyMaxConcurrency(next.maxConcurrency),
        normalizeAiKeyRequestMode(next.requestMode, current.provider),
        normalizeAiKeyWeight(next.weight),
        next.enabled ? 1 : 0,
        now,
        id,
      )
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

function decryptInterviewStoragePayload(value, field) {
  if (!isEncryptedPayload(value)) {
    throw interviewStorageError(
      'INTERVIEW_STORAGE_CORRUPT',
      `Encrypted ${field} payload is missing.`,
      500,
    )
  }
  const plain = decryptPayload(value)
  if (!plain || plain === value || isEncryptedPayload(plain)) {
    throw interviewStorageError(
      'INTERVIEW_STORAGE_DECRYPT_FAILED',
      `Encrypted ${field} payload could not be opened.`,
      500,
    )
  }
  try {
    return JSON.parse(plain)
  } catch {
    throw interviewStorageError(
      'INTERVIEW_STORAGE_CORRUPT',
      `Encrypted ${field} payload is not valid JSON.`,
      500,
    )
  }
}

function interviewWorkspaceFromDatabase(database, scope) {
  const row = database
    .prepare(
      `SELECT * FROM interview_workspaces
       WHERE scope_key = ? AND subject_user_id = ? AND team_id IS ?
       LIMIT 1`,
    )
    .get(scope.scopeKey, scope.subjectUserId, scope.teamId)
  if (!row) return null

  const readChildren = (table, field) => database
    .prepare(
      `SELECT payload_encrypted FROM ${table}
       WHERE workspace_scope_key = ?
       ORDER BY position ASC, id ASC`,
    )
    .all(scope.scopeKey)
    .map((child) => decryptInterviewStoragePayload(child.payload_encrypted, field))

  const metadata = decryptInterviewStoragePayload(row.payload_encrypted, 'workspace')
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw interviewStorageError(
      'INTERVIEW_STORAGE_CORRUPT',
      'Encrypted interview workspace metadata is invalid.',
      500,
    )
  }
  return {
    ...metadata,
    subjectUserId: row.subject_user_id,
    revision: Number(row.revision),
    interviews: readChildren('interview_events', 'interview event'),
    questions: readChildren('interview_questions', 'interview question'),
    mockSessions: readChildren('interview_sessions', 'interview session'),
    feedback: readChildren('interview_feedback', 'interview feedback'),
    updatedAt: row.updated_at,
  }
}

function interviewAuthorizationVersionFromDatabase(database, input) {
  const actorId = normalizeInterviewStorageId(input.actorId, 'actorId')
  const scope = interviewWorkspaceScope(input)
  const userIds = [...new Set([actorId, scope.subjectUserId])].sort()
  const users = userIds.map((userId) => database
    .prepare(
      `SELECT id, role, disabled_at, auth_version
       FROM users WHERE id = ? LIMIT 1`,
    )
    .get(userId) ?? null)
  const actor = users.find((user) => user?.id === actorId) ?? null
  const subject = users.find((user) => user?.id === scope.subjectUserId) ?? null
  const expectedActorRole = input.expectedActorRole == null
    ? null
    : normalizeUserRole(input.expectedActorRole)
  const expectedActorAuthVersion = input.expectedActorAuthVersion == null
    ? null
    : Number(input.expectedActorAuthVersion)
  if (
    !actor
    || actor.disabled_at
    || !subject
    || subject.disabled_at
    || (expectedActorRole !== null && normalizeUserRole(actor.role) !== expectedActorRole)
    || (
      expectedActorAuthVersion !== null
      && (
        !Number.isSafeInteger(expectedActorAuthVersion)
        || expectedActorAuthVersion < 0
        || Number(actor.auth_version ?? 0) !== expectedActorAuthVersion
      )
    )
  ) {
    throw interviewStorageError(
      'INTERVIEW_ACCESS_REVOKED',
      'Interview Prep access changed before the operation could continue.',
      403,
    )
  }
  const team = scope.teamId
    ? database
        .prepare(
          `SELECT id, owner_id, permission_defaults_json, updated_at
           FROM teams WHERE id = ? LIMIT 1`,
        )
        .get(scope.teamId) ?? null
    : null
  const memberships = scope.teamId
    ? database
        .prepare(
          `SELECT id, team_id, user_id, role, status, invited_by,
                  relationship_json, updated_at, removed_at
           FROM team_members
           WHERE team_id = ? AND user_id IN (?, ?)
           ORDER BY id ASC`,
        )
        .all(scope.teamId, actorId, scope.subjectUserId)
    : []
  return createHash('sha256').update(toJson({
    actorId,
    subjectUserId: scope.subjectUserId,
    teamId: scope.teamId,
    users,
    team,
    memberships,
  })).digest('hex')
}

function normalizeInterviewAuthorizationVersion(value) {
  if (value === undefined || value === null || value === '') return null
  const normalized = String(value).trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw interviewStorageError(
      'INTERVIEW_AUTHORIZATION_VERSION_INVALID',
      'Interview authorization version is invalid.',
      400,
    )
  }
  return normalized
}

export async function getInterviewPrepAuthorizationVersion({
  actorId,
  subjectUserId,
  teamId = null,
  expectedActorRole = null,
  expectedActorAuthVersion = null,
}) {
  await ensureStorage()
  return interviewAuthorizationVersionFromDatabase(getDb(), {
    actorId,
    subjectUserId,
    teamId,
    expectedActorRole,
    expectedActorAuthVersion,
  })
}

export async function getInterviewPrepWorkspaceRecord({ subjectUserId, teamId = null }) {
  await ensureStorage()
  const scope = interviewWorkspaceScope({ subjectUserId, teamId })
  return interviewWorkspaceFromDatabase(getDb(), scope)
}

function throwInterviewRevisionConflict(scope, expectedRevision, currentRevision) {
  throw interviewStorageError(
    'INTERVIEW_REVISION_CONFLICT',
    'The interview preparation workspace changed before this save completed.',
    409,
    {
      subjectUserId: scope.subjectUserId,
      teamId: scope.teamId,
      expectedRevision,
      currentRevision,
    },
  )
}

function throwInterviewIdempotencyConflict(scope, requestId, stale = false) {
  throw interviewStorageError(
    stale ? 'INTERVIEW_IDEMPOTENCY_REPLAY_STALE' : 'INTERVIEW_IDEMPOTENCY_CONFLICT',
    stale
      ? 'This interview save request was already applied, but the workspace has since changed.'
      : 'This interview save request identifier was already used for different content.',
    409,
    { subjectUserId: scope.subjectUserId, teamId: scope.teamId, requestId },
  )
}

export async function saveInterviewPrepWorkspaceRecord({
  subjectUserId,
  teamId = null,
  workspace,
  expectedRevision,
  actorId,
  requestId,
  authorizationVersion = null,
}) {
  await ensureStorage()
  const scope = interviewWorkspaceScope({ subjectUserId, teamId })
  const expected = normalizeInterviewStorageRevision(expectedRevision)
  const actor = normalizeInterviewStorageId(actorId, 'actorId')
  const request = normalizeInterviewStorageId(requestId, 'requestId')
  const expectedAuthorizationVersion = normalizeInterviewAuthorizationVersion(authorizationVersion)
  const candidate = normalizeInterviewWorkspaceForStorage(workspace, scope)

  return withWriteLock(async () => {
    const database = getDb()
    const save = database.transaction(() => {
      if (
        expectedAuthorizationVersion
        && interviewAuthorizationVersionFromDatabase(database, {
          actorId: actor,
          subjectUserId: scope.subjectUserId,
          teamId: scope.teamId,
        }) !== expectedAuthorizationVersion
      ) {
        throw interviewStorageError(
          'INTERVIEW_ACCESS_REVOKED',
          'Interview Prep access changed before the save could commit.',
          403,
        )
      }
      const current = database
        .prepare('SELECT revision, fingerprint FROM interview_workspaces WHERE scope_key = ?')
        .get(scope.scopeKey)
      const currentRevision = Number(current?.revision ?? 0)
      const previousRequest = database
        .prepare(
          `SELECT fingerprint, result_revision FROM interview_workspace_requests
           WHERE workspace_scope_key = ? AND request_id = ?`,
        )
        .get(scope.scopeKey, request)

      if (previousRequest) {
        if (previousRequest.fingerprint !== candidate.fingerprint) {
          throwInterviewIdempotencyConflict(scope, request)
        }
        if (current?.fingerprint !== candidate.fingerprint) {
          throwInterviewIdempotencyConflict(scope, request, true)
        }
        return interviewWorkspaceFromDatabase(database, scope)
      }

      if (current?.fingerprint === candidate.fingerprint) {
        database
          .prepare(
            `INSERT INTO interview_workspace_requests (
               workspace_scope_key, request_id, fingerprint, result_revision, actor_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(scope.scopeKey, request, candidate.fingerprint, currentRevision, actor, nowStamp())
        return interviewWorkspaceFromDatabase(database, scope)
      }

      if (expected !== currentRevision) {
        throwInterviewRevisionConflict(scope, expected, currentRevision)
      }

      const savedAt = nowStamp()
      const nextRevision = currentRevision + 1
      if (current) {
        const updated = database
          .prepare(
            `UPDATE interview_workspaces
             SET fingerprint = ?, payload_encrypted = ?, revision = ?, updated_at = ?
             WHERE scope_key = ? AND revision = ?`,
          )
          .run(
            candidate.fingerprint,
            encryptPayload(candidate.metadata.json),
            nextRevision,
            savedAt,
            scope.scopeKey,
            currentRevision,
          )
        if (Number(updated.changes ?? 0) !== 1) {
          const latest = database
            .prepare('SELECT revision FROM interview_workspaces WHERE scope_key = ?')
            .get(scope.scopeKey)
          throwInterviewRevisionConflict(scope, expected, Number(latest?.revision ?? 0))
        }
      } else {
        database
          .prepare(
            `INSERT INTO interview_workspaces (
               scope_key, subject_user_id, team_id, revision, fingerprint,
               payload_encrypted, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            scope.scopeKey,
            scope.subjectUserId,
            scope.teamId,
            nextRevision,
            candidate.fingerprint,
            encryptPayload(candidate.metadata.json),
            savedAt,
            savedAt,
          )
      }

      // Feedback carries optional references to sessions and questions, so it
      // must be removed before the referenced rows. The full aggregate is then
      // rebuilt in dependency order inside this single immediate transaction.
      database.prepare('DELETE FROM interview_feedback WHERE workspace_scope_key = ?').run(scope.scopeKey)
      database.prepare('DELETE FROM interview_sessions WHERE workspace_scope_key = ?').run(scope.scopeKey)
      database.prepare('DELETE FROM interview_questions WHERE workspace_scope_key = ?').run(scope.scopeKey)
      database.prepare('DELETE FROM interview_events WHERE workspace_scope_key = ?').run(scope.scopeKey)

      const insertEvent = database.prepare(
        `INSERT INTO interview_events (
           workspace_scope_key, id, position, payload_encrypted, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const event of candidate.events) {
        insertEvent.run(
          scope.scopeKey,
          event.id,
          event.position,
          encryptPayload(event.payloadJson),
          event.createdAt === '1970-01-01T00:00:00.000Z' ? savedAt : event.createdAt,
          event.updatedAt === '1970-01-01T00:00:00.000Z' ? savedAt : event.updatedAt,
        )
      }

      const insertQuestion = database.prepare(
        `INSERT INTO interview_questions (
           workspace_scope_key, id, interview_id, position, payload_encrypted, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const question of candidate.questions) {
        insertQuestion.run(
          scope.scopeKey,
          question.id,
          question.value.interviewId,
          question.position,
          encryptPayload(question.payloadJson),
          question.createdAt === '1970-01-01T00:00:00.000Z' ? savedAt : question.createdAt,
          question.updatedAt === '1970-01-01T00:00:00.000Z' ? savedAt : question.updatedAt,
        )
      }

      const insertSession = database.prepare(
        `INSERT INTO interview_sessions (
           workspace_scope_key, id, interview_id, position, payload_encrypted, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const session of candidate.sessions) {
        insertSession.run(
          scope.scopeKey,
          session.id,
          session.value.interviewId,
          session.position,
          encryptPayload(session.payloadJson),
          session.createdAt === '1970-01-01T00:00:00.000Z' ? savedAt : session.createdAt,
          session.updatedAt === '1970-01-01T00:00:00.000Z' ? savedAt : session.updatedAt,
        )
      }

      const insertFeedback = database.prepare(
        `INSERT INTO interview_feedback (
           workspace_scope_key, id, interview_id, session_id, question_id,
           position, payload_encrypted, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const feedback of candidate.feedback) {
        insertFeedback.run(
          scope.scopeKey,
          feedback.id,
          feedback.value.interviewId,
          feedback.value.sessionId ?? null,
          feedback.value.questionId ?? null,
          feedback.position,
          encryptPayload(feedback.payloadJson),
          feedback.createdAt === '1970-01-01T00:00:00.000Z' ? savedAt : feedback.createdAt,
          feedback.updatedAt === '1970-01-01T00:00:00.000Z' ? savedAt : feedback.updatedAt,
        )
      }

      database
        .prepare(
          `INSERT INTO interview_workspace_requests (
             workspace_scope_key, request_id, fingerprint, result_revision, actor_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(scope.scopeKey, request, candidate.fingerprint, nextRevision, actor, savedAt)

      return interviewWorkspaceFromDatabase(database, scope)
    })

    const saved = save.immediate()
    invalidateSharedStoreCache()
    scheduleExternalDatabaseSync()
    return saved
  })
}

export async function deleteInterviewPrepWorkspaceRecord({
  subjectUserId,
  teamId = null,
  expectedRevision,
}) {
  await ensureStorage()
  const scope = interviewWorkspaceScope({ subjectUserId, teamId })
  const expected = normalizeInterviewStorageRevision(expectedRevision)
  return withWriteLock(async () => {
    const database = getDb()
    const remove = database.transaction(() => {
      const current = database
        .prepare('SELECT revision FROM interview_workspaces WHERE scope_key = ?')
        .get(scope.scopeKey)
      const currentRevision = Number(current?.revision ?? 0)
      if (!current) return false
      if (currentRevision !== expected) throwInterviewRevisionConflict(scope, expected, currentRevision)
      database.prepare('DELETE FROM interview_workspaces WHERE scope_key = ?').run(scope.scopeKey)
      return true
    })
    const deleted = remove.immediate()
    if (deleted) {
      invalidateSharedStoreCache()
      scheduleExternalDatabaseSync()
    }
    return deleted
  })
}
