import { MEMORY_WORK_CLASS } from './memoryPressure.js'

const DEFAULT_RETRY_AFTER_MS = 1_000
const MAX_RETRY_AFTER_MS = 60_000

function retryDelay(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETRY_AFTER_MS
  return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(parsed))
}

function deferredResult(applicationBackups, kind, decision) {
  return {
    applicationBackups,
    workspaceBackup: null,
    completed: false,
    deferred: true,
    deferredKind: kind,
    retryAfterMs: retryDelay(decision?.retryAfterMs),
    pressureLevel: decision?.level ?? null,
  }
}

function assertDependencies(options) {
  if (!options.memoryPressureGuard || typeof options.memoryPressureGuard.admit !== 'function') {
    throw new TypeError('memoryPressureGuard.admit is required.')
  }
  if (!options.applicationCandidates
    || typeof options.applicationCandidates[Symbol.iterator] !== 'function'
      && typeof options.applicationCandidates[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('applicationCandidates must be iterable.')
  }
  if (typeof options.prepareApplicationBackup !== 'function') {
    throw new TypeError('prepareApplicationBackup is required.')
  }
  if (typeof options.createApplicationBackup !== 'function') {
    throw new TypeError('createApplicationBackup is required.')
  }
  if (typeof options.prepareWorkspaceBackup !== 'function') {
    throw new TypeError('prepareWorkspaceBackup is required.')
  }
  if (typeof options.createWorkspaceBackup !== 'function') {
    throw new TypeError('createWorkspaceBackup is required.')
  }
}

/**
 * Runs one automatic-backup pass with a fresh HEAVY memory admission directly
 * before every backup allocation.
 *
 * Preparation must be side-effect free: it may decide whether a candidate is
 * due and build the small immutable input for `createBackup`, but it must not
 * advance `lastAutoBackupAt` or consume durable due state. If admission is
 * refused, this function returns the successfully created prefix and marks the
 * pass incomplete. The caller must commit that prefix while leaving the
 * refused and unvisited candidates untouched for the next recurring pass.
 *
 * Application candidates retain their input order. The workspace candidate is
 * prepared and run only after every due application candidate has completed.
 */
export async function runAutomaticBackupPassWithMemoryAdmission(options = {}) {
  assertDependencies(options)
  const {
    memoryPressureGuard,
    memoryReservationLedger = null,
    applicationCandidates,
    prepareApplicationBackup,
    createApplicationBackup,
    prepareWorkspaceBackup,
    createWorkspaceBackup,
    applicationReservationBytes = () => 64 * 1024 * 1024,
    workspaceReservationBytes = () => 64 * 1024 * 1024,
    workspaceOwnsMemoryAdmission = false,
    onApplicationBackup = null,
    collectApplicationBackups = true,
    maxApplicationBackups = null,
  } = options
  const applicationBackups = []
  const maxBackups = Number.isSafeInteger(maxApplicationBackups)
    ? Math.max(0, maxApplicationBackups)
    : Number.POSITIVE_INFINITY
  let createdApplicationBackupCount = 0

  for await (const candidate of applicationCandidates) {
    if (createdApplicationBackupCount >= maxBackups) break
    const prepared = await prepareApplicationBackup(candidate)
    if (prepared === null || prepared === undefined || prepared === false) continue

    // `admit` performs a fresh RSS sample. Keep this call adjacent to the
    // allocation-heavy create callback: outer recurring-task admission is only
    // a coarse first gate and cannot protect a long multi-user traversal.
    const decision = memoryPressureGuard.admit(MEMORY_WORK_CLASS.HEAVY)
    if (!decision?.allowed) {
      return deferredResult(applicationBackups, 'application', decision)
    }

    const reservation = memoryReservationLedger
      ? memoryReservationLedger.acquire(
          MEMORY_WORK_CLASS.HEAVY,
          applicationReservationBytes(prepared),
        )
      : null
    if (reservation && !reservation.allowed) {
      return deferredResult(applicationBackups, 'application', reservation.decision)
    }
    let backup
    try {
      backup = await createApplicationBackup(prepared)
    } finally {
      reservation?.release?.()
    }
    if (backup !== null && backup !== undefined) {
      createdApplicationBackupCount += 1
      await onApplicationBackup?.(backup)
      if (collectApplicationBackups) applicationBackups.push(backup)
    }
  }

  const workspaceCandidate = await prepareWorkspaceBackup()
  if (workspaceCandidate !== null
    && workspaceCandidate !== undefined
    && workspaceCandidate !== false) {
    const decision = memoryPressureGuard.admit(MEMORY_WORK_CLASS.HEAVY)
    if (!decision?.allowed) {
      return deferredResult(applicationBackups, 'workspace', decision)
    }

    // Workspace archive creation can own a phase-specific reservation: local
    // SQLite hot backup needs only a small fixed I/O allowance, while external
    // adapters reserve their one remote payload. In that mode an outer
    // snapshot-sized HEAVY lease would double-count the same work and can make
    // every near-threshold backup defer permanently.
    const reservation = memoryReservationLedger && !workspaceOwnsMemoryAdmission
      ? memoryReservationLedger.acquire(
          MEMORY_WORK_CLASS.HEAVY,
          workspaceReservationBytes(workspaceCandidate),
        )
      : null
    if (reservation && !reservation.allowed) {
      return deferredResult(applicationBackups, 'workspace', reservation.decision)
    }
    let workspaceBackup
    try {
      workspaceBackup = await createWorkspaceBackup(workspaceCandidate)
    } finally {
      reservation?.release?.()
    }
    return {
      applicationBackups,
      workspaceBackup: workspaceBackup ?? null,
      completed: true,
      deferred: false,
      deferredKind: null,
      retryAfterMs: null,
      pressureLevel: null,
    }
  }

  return {
    applicationBackups,
    workspaceBackup: null,
    completed: true,
    deferred: false,
    deferredKind: null,
    retryAfterMs: null,
    pressureLevel: null,
  }
}
