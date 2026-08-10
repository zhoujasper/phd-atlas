const MIB = 1024 * 1024

export const DEFAULT_SNAPSHOT_DATABASE_MAX_BYTES = 64 * MIB
export const MIN_SNAPSHOT_DATABASE_MAX_BYTES = 8 * MIB
export const MAX_SNAPSHOT_DATABASE_MAX_BYTES = 1024 * MIB
export const SQLITE_NORMAL_MAX_PAGE_COUNT = 4_294_967_294
export const SNAPSHOT_MEMORY_SAFE_RATIO = 0.70
export const SNAPSHOT_MEMORY_FIXED_BYTES = 64 * MIB

const SNAPSHOT_MEMORY_MULTIPLIERS = Object.freeze({
  'encrypted-sqlite-whole-snapshot': 2.25,
  'external-whole-snapshot:plain': 2.5,
  // The rollback-compatible external v1 envelope holds a double-base64 BLOB
  // and transient JS strings while authenticating it. This deliberately
  // conservative factor prevents an operator-provided cap from defeating the
  // runtime RSS guard before that guard can sample the allocation.
  'external-whole-snapshot:encrypted': 9,
})

// External encrypted snapshots currently retain the rollback-compatible v1
// envelope. It base64-encodes the SQLite image before encryption and then
// base64-encodes the ciphertext once more. Keep a bounded allowance for the
// authenticated profile/header without treating that transport expansion as
// additional database capacity.
const EXTERNAL_ENVELOPE_MAX_HEADER_BYTES = 256 * 1024
const SQLITE_SEAL_MAX_OVERHEAD_BYTES = 4 * 1024

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)))
}

export function normalizeSnapshotDatabaseMaxBytes(
  value = process.env.PHD_ATLAS_SNAPSHOT_MAX_BYTES,
) {
  return boundedInteger(
    value,
    DEFAULT_SNAPSHOT_DATABASE_MAX_BYTES,
    MIN_SNAPSHOT_DATABASE_MAX_BYTES,
    MAX_SNAPSHOT_DATABASE_MAX_BYTES,
  )
}

function positiveMemoryBudget(value) {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new TypeError('Runtime memory budget must be a positive safe integer.')
  }
  return numeric
}

function snapshotMemoryMultiplier(mode, encrypted) {
  if (mode === 'encrypted-sqlite-whole-snapshot') {
    return SNAPSHOT_MEMORY_MULTIPLIERS[mode]
  }
  if (mode === 'external-whole-snapshot') {
    return SNAPSHOT_MEMORY_MULTIPLIERS[`${mode}:${encrypted ? 'encrypted' : 'plain'}`]
  }
  return 0
}

export function snapshotMemoryBudgetError(plan) {
  const error = new Error(
    `The ${plan.mode} storage mode needs at least ${plan.minimumRequiredMemoryBytes} bytes `
      + `of runtime memory, but only ${plan.safeMemoryBytes} bytes are reserved for safe snapshot work. `
      + 'Use plain local SQLite or raise RUNTIME_MEMORY_BUDGET_BYTES.',
  )
  error.code = 'DATABASE_SNAPSHOT_MEMORY_BUDGET_TOO_LOW'
  error.status = 503
  error.mode = plan.mode
  error.memoryBudgetBytes = plan.memoryBudgetBytes
  error.safeMemoryBytes = plan.safeMemoryBytes
  error.minimumRequiredMemoryBytes = plan.minimumRequiredMemoryBytes
  return error
}

export function resolveSnapshotCapacityPlan({
  mode = 'plain-local-sqlite',
  encrypted = false,
  configuredLimitBytes = normalizeSnapshotDatabaseMaxBytes(),
  runtimeMemoryBudgetBytes = 512 * MIB,
} = {}) {
  const configuredBytes = normalizeSnapshotDatabaseMaxBytes(configuredLimitBytes)
  const memoryBudgetBytes = positiveMemoryBudget(runtimeMemoryBudgetBytes)
  const multiplier = snapshotMemoryMultiplier(mode, encrypted)
  if (multiplier === 0) {
    return {
      mode,
      encrypted: false,
      configuredLimitBytes: configuredBytes,
      effectiveLimitBytes: null,
      memoryBudgetBytes,
      safeMemoryBytes: Math.floor(memoryBudgetBytes * SNAPSHOT_MEMORY_SAFE_RATIO),
      fixedMemoryBytes: 0,
      memoryMultiplier: 0,
      requiredMemoryBytes: null,
      effectiveRequiredMemoryBytes: null,
      minimumRequiredMemoryBytes: null,
      memoryConstrained: false,
      supported: true,
    }
  }
  const safeMemoryBytes = Math.floor(memoryBudgetBytes * SNAPSHOT_MEMORY_SAFE_RATIO)
  const availableVariableBytes = Math.max(0, safeMemoryBytes - SNAPSHOT_MEMORY_FIXED_BYTES)
  const memoryLimitedBytes = Math.floor(availableVariableBytes / multiplier)
  const effectiveLimitBytes = Math.min(configuredBytes, memoryLimitedBytes)
  const requiredMemoryBytes = Math.ceil(
    SNAPSHOT_MEMORY_FIXED_BYTES + (configuredBytes * multiplier),
  )
  const effectiveRequiredMemoryBytes = Math.ceil(
    SNAPSHOT_MEMORY_FIXED_BYTES + (effectiveLimitBytes * multiplier),
  )
  const minimumRequiredMemoryBytes = Math.ceil(
    SNAPSHOT_MEMORY_FIXED_BYTES + (MIN_SNAPSHOT_DATABASE_MAX_BYTES * multiplier),
  )
  const plan = {
    mode,
    encrypted: Boolean(encrypted),
    configuredLimitBytes: configuredBytes,
    effectiveLimitBytes,
    memoryBudgetBytes,
    safeMemoryBytes,
    fixedMemoryBytes: SNAPSHOT_MEMORY_FIXED_BYTES,
    memoryMultiplier: multiplier,
    requiredMemoryBytes,
    effectiveRequiredMemoryBytes,
    minimumRequiredMemoryBytes,
    memoryConstrained: effectiveLimitBytes < configuredBytes,
    supported: effectiveLimitBytes >= MIN_SNAPSHOT_DATABASE_MAX_BYTES,
  }
  return plan
}

export function assertSnapshotCapacityPlan(plan) {
  if (!plan?.supported) throw snapshotMemoryBudgetError(plan)
  return plan
}

export function snapshotCapacityError({
  mode,
  limitBytes,
  currentBytes,
  requestedBytes = null,
} = {}) {
  const error = new Error(
    `The ${mode || 'whole-database snapshot'} storage mode is limited to ${limitBytes} bytes; `
      + `the workspace requires ${requestedBytes ?? currentBytes} bytes. Use plain local SQLite `
      + 'for high-scale incremental storage, or raise PHD_ATLAS_SNAPSHOT_MAX_BYTES only after sizing memory and transport capacity.',
  )
  error.code = 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED'
  error.status = 413
  error.mode = mode ?? 'snapshot'
  error.limitBytes = limitBytes
  error.currentBytes = currentBytes
  error.requestedBytes = requestedBytes
  return error
}

function positiveSqliteMetric(value, label) {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`SQLite returned an invalid ${label}.`)
  }
  return numeric
}

export function sqliteSnapshotMetrics(database) {
  const pageCount = positiveSqliteMetric(
    database.pragma('page_count', { simple: true }),
    'page count',
  )
  const pageSize = positiveSqliteMetric(
    database.pragma('page_size', { simple: true }),
    'page size',
  )
  const currentBytes = pageCount * pageSize
  if (!Number.isSafeInteger(currentBytes)) {
    throw new Error('SQLite database size exceeds the supported integer range.')
  }
  return { pageCount, pageSize, currentBytes }
}

export function applySqliteSnapshotPageLimit(database, {
  mode,
  enabled,
  limitBytes = normalizeSnapshotDatabaseMaxBytes(),
} = {}) {
  const normalizedLimit = normalizeSnapshotDatabaseMaxBytes(limitBytes)
  const metrics = sqliteSnapshotMetrics(database)
  if (!enabled) {
    const appliedMaxPageCount = Number(database.pragma(
      `max_page_count = ${SQLITE_NORMAL_MAX_PAGE_COUNT}`,
      { simple: true },
    ))
    return {
      ...metrics,
      mode: mode ?? 'plain-local-sqlite',
      enabled: false,
      limitBytes: null,
      maxPageCount: appliedMaxPageCount,
    }
  }

  const maxPageCount = Math.max(1, Math.floor(normalizedLimit / metrics.pageSize))
  const effectiveLimitBytes = maxPageCount * metrics.pageSize
  if (metrics.pageCount > maxPageCount) {
    throw snapshotCapacityError({
      mode,
      limitBytes: effectiveLimitBytes,
      currentBytes: metrics.currentBytes,
    })
  }
  const appliedMaxPageCount = Number(database.pragma(
    `max_page_count = ${maxPageCount}`,
    { simple: true },
  ))
  if (!Number.isSafeInteger(appliedMaxPageCount) || appliedMaxPageCount > maxPageCount) {
    throw new Error('SQLite did not acknowledge the configured snapshot page limit.')
  }
  return {
    ...metrics,
    mode: mode ?? 'snapshot',
    enabled: true,
    limitBytes: effectiveLimitBytes,
    maxPageCount: appliedMaxPageCount,
  }
}

export function normalizeSqliteFullAsSnapshotCapacity(error, diagnostics) {
  if (error?.code !== 'SQLITE_FULL' || !diagnostics?.enabled) return error
  return snapshotCapacityError({
    mode: diagnostics.mode,
    limitBytes: diagnostics.limitBytes,
    currentBytes: diagnostics.currentBytes,
    requestedBytes: diagnostics.limitBytes + diagnostics.pageSize,
  })
}

export function externalEncryptedPayloadMaxBytes(
  databaseLimitBytes = normalizeSnapshotDatabaseMaxBytes(),
) {
  const normalizedLimit = normalizeSnapshotDatabaseMaxBytes(databaseLimitBytes)
  const innerBase64Bytes = 4 * Math.ceil(normalizedLimit / 3)
  const outerBase64Bytes = 4 * Math.ceil(innerBase64Bytes / 3)
  return outerBase64Bytes + EXTERNAL_ENVELOPE_MAX_HEADER_BYTES
}

export function sqliteSealedPayloadMaxBytes(
  databaseLimitBytes = normalizeSnapshotDatabaseMaxBytes(),
) {
  return normalizeSnapshotDatabaseMaxBytes(databaseLimitBytes) + SQLITE_SEAL_MAX_OVERHEAD_BYTES
}

function prefixMatches(prefix, magic) {
  if (!prefix || !magic) return false
  const candidate = Buffer.isBuffer(prefix) ? prefix : Buffer.from(prefix)
  return candidate.length >= magic.length && candidate.subarray(0, magic.length).equals(magic)
}

export function assertExternalSnapshotPayloadAdmission({
  payloadBytes,
  payloadPrefix,
  encryptedMagic,
  databaseLimitBytes = normalizeSnapshotDatabaseMaxBytes(),
} = {}) {
  const bytes = Number(payloadBytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('The external database returned an invalid workspace payload length.')
  }
  const encrypted = prefixMatches(payloadPrefix, encryptedMagic)
  const limitBytes = encrypted
    ? externalEncryptedPayloadMaxBytes(databaseLimitBytes)
    : normalizeSnapshotDatabaseMaxBytes(databaseLimitBytes)
  if (bytes > limitBytes) {
    throw snapshotCapacityError({
      mode: 'external-whole-snapshot',
      limitBytes,
      currentBytes: bytes,
    })
  }
  return { encrypted, limitBytes, payloadBytes: bytes }
}

export function assertSqliteSealedPayloadAdmission(
  payloadBytes,
  databaseLimitBytes = normalizeSnapshotDatabaseMaxBytes(),
) {
  const bytes = Number(payloadBytes)
  const limitBytes = sqliteSealedPayloadMaxBytes(databaseLimitBytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('The sealed SQLite snapshot has an invalid length.')
  }
  if (bytes > limitBytes) {
    throw snapshotCapacityError({
      mode: 'encrypted-sqlite-whole-snapshot',
      limitBytes,
      currentBytes: bytes,
    })
  }
  return { limitBytes, payloadBytes: bytes }
}
