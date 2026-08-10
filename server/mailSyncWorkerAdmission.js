import { MEMORY_WORK_CLASS } from './memoryPressure.js'

const DEFAULT_RETRY_AFTER_MS = 1_000
const MAX_RETRY_AFTER_MS = 60_000
const TERMINAL_MAIL_SYNC_ERROR_CODES = new Set([
  'AUTH_FAILED',
  'NOT_CONFIGURED',
  'UNSUPPORTED_PROTOCOL',
])

function retryDelay(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETRY_AFTER_MS
  return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(parsed))
}

export class MailSyncMemoryDeferredError extends Error {
  constructor(decision, { phase = 'mail-sync' } = {}) {
    const level = String(decision?.level ?? 'unknown')
    super(`Mail sync ${phase} deferred because the server is under ${level} memory pressure.`)
    this.name = 'MailSyncMemoryDeferredError'
    this.code = 'MAIL_SYNC_MEMORY_DEFERRED'
    this.status = 503
    this.retryAfterMs = retryDelay(decision?.retryAfterMs)
    this.level = level
    this.phase = String(phase || 'mail-sync')
    this.workClass = MEMORY_WORK_CLASS.HEAVY
  }
}

export class MailSyncExecutionDeferredError extends Error {
  constructor(code, message, { phase = 'mail-sync', retryAfterMs = DEFAULT_RETRY_AFTER_MS } = {}) {
    super(message)
    this.name = 'MailSyncExecutionDeferredError'
    this.code = code
    this.status = 503
    this.retryAfterMs = retryDelay(retryAfterMs)
    this.phase = String(phase || 'mail-sync')
    this.workClass = MEMORY_WORK_CLASS.HEAVY
  }
}

export function isMailSyncMemoryDeferredError(error) {
  return error instanceof MailSyncMemoryDeferredError
    || error?.code === 'MAIL_SYNC_MEMORY_DEFERRED'
}

export function isMailSyncDeferredError(error) {
  return isMailSyncMemoryDeferredError(error)
    || ['MAIL_SYNC_SHUTDOWN_DEFERRED', 'MAIL_SYNC_TIME_SLICE_DEFERRED'].includes(error?.code)
}

export function isTerminalMailSyncFailure(error) {
  return TERMINAL_MAIL_SYNC_ERROR_CODES.has(String(error?.code ?? ''))
}

/**
 * Allocation-heavy mail work is long lived: one durable job can fetch many
 * bounded IMAP batches, and one recurring pass can visit many users. Call this
 * checkpoint immediately before every such unit, not only before the outer
 * worker/task begins.
 */
export function assertMailSyncHeavyAdmission(memoryPressureGuard, context = {}) {
  if (!memoryPressureGuard || typeof memoryPressureGuard.admit !== 'function') {
    throw new TypeError('memoryPressureGuard.admit is required.')
  }
  const phase = String(context.phase || 'mail-sync')
  if (context.signal?.aborted) {
    throw new MailSyncExecutionDeferredError(
      'MAIL_SYNC_SHUTDOWN_DEFERRED',
      `Mail sync ${phase} deferred because the server is stopping.`,
      { phase, retryAfterMs: context.retryAfterMs },
    )
  }
  const deadlineAt = Number(context.deadlineAt)
  if (Number.isFinite(deadlineAt)) {
    const current = Number(typeof context.now === 'function' ? context.now() : Date.now())
    if (!Number.isFinite(current)) throw new TypeError('context.now must return a finite timestamp.')
    if (current >= deadlineAt) {
      throw new MailSyncExecutionDeferredError(
        'MAIL_SYNC_TIME_SLICE_DEFERRED',
        `Mail sync ${phase} reached its bounded execution slice and will continue later.`,
        { phase, retryAfterMs: context.retryAfterMs },
      )
    }
  }
  const decision = memoryPressureGuard.admit(MEMORY_WORK_CLASS.HEAVY)
  if (!decision?.allowed) throw new MailSyncMemoryDeferredError(decision, context)
  return decision
}

export function mailSyncMemoryRetryAt(error, now = Date.now) {
  if (!isMailSyncMemoryDeferredError(error)) return null
  const current = Number(typeof now === 'function' ? now() : now)
  if (!Number.isFinite(current)) throw new TypeError('now must resolve to a finite timestamp.')
  return new Date(current + retryDelay(error?.retryAfterMs)).toISOString()
}

export function mailSyncRetryAt(error, now = Date.now) {
  if (!isMailSyncDeferredError(error)) return null
  const current = Number(typeof now === 'function' ? now() : now)
  if (!Number.isFinite(current)) throw new TypeError('now must resolve to a finite timestamp.')
  return new Date(current + retryDelay(error?.retryAfterMs)).toISOString()
}

/**
 * Visit auto-fetch users with a fresh HEAVY checkpoint per user. A memory
 * deferral stops the pass at the current user and returns a rotating cursor for
 * the next scheduled pass; ordinary mailbox failures remain isolated per user.
 * A deferral raised from inside `runUser` (for example before its second IMAP
 * batch) is treated identically and is never downgraded to an ordinary error.
 */
export async function runMailSyncUsersWithMemoryAdmission({
  userIds,
  memoryPressureGuard,
  runUser,
  onUserError = () => {},
  signal,
  deadlineAt,
  now,
  startIndex = 0,
}) {
  if (!userIds || typeof userIds[Symbol.iterator] !== 'function') {
    throw new TypeError('userIds must be iterable.')
  }
  if (typeof runUser !== 'function') throw new TypeError('runUser is required.')
  if (typeof onUserError !== 'function') throw new TypeError('onUserError must be a function.')

  const users = Array.isArray(userIds) ? userIds : [...userIds]
  if (users.length === 0) {
    return {
      completed: 0,
      failed: 0,
      deferred: false,
      deferredIndex: null,
      retryAfterMs: null,
      nextStartIndex: 0,
    }
  }
  const requestedStart = Number(startIndex)
  const normalizedStartIndex = Number.isSafeInteger(requestedStart)
    ? ((requestedStart % users.length) + users.length) % users.length
    : 0
  let completed = 0
  let failed = 0
  for (let offset = 0; offset < users.length; offset += 1) {
    const index = (normalizedStartIndex + offset) % users.length
    const userId = users[index]
    let userStarted = false
    try {
      assertMailSyncHeavyAdmission(memoryPressureGuard, {
        phase: 'user',
        signal,
        deadlineAt,
        now,
      })
      userStarted = true
      await runUser(userId)
      completed += 1
    } catch (error) {
      if (isMailSyncDeferredError(error)) {
        return {
          completed,
          failed,
          deferred: true,
          deferredIndex: index,
          retryAfterMs: retryDelay(error.retryAfterMs),
          // A user that consumed the remainder of the slice moves behind the
          // untouched tail on the next pass. If admission failed before it
          // started, retry that exact user first. Either way, a slow first
          // mailbox cannot permanently starve later configured accounts.
          nextStartIndex: userStarted ? (index + 1) % users.length : index,
        }
      }
      failed += 1
      await onUserError(error, userId)
    }
  }
  return {
    completed,
    failed,
    deferred: false,
    deferredIndex: null,
    retryAfterMs: null,
    nextStartIndex: (normalizedStartIndex + 1) % users.length,
  }
}

/**
 * Drain durable mail-sync jobs without claiming allocation-heavy work while
 * the process is under soft or hard memory pressure.
 *
 * Admission happens before every claim, so a refusal leaves the queued row
 * untouched. The caller owns one coalesced delayed kick; this module merely
 * requests it. Memory is sampled again after every completed/requeued job so
 * the next admission observes parser/attachment allocations from that job.
 */
export async function drainMailSyncJobsWithMemoryAdmission({
  memoryPressureGuard,
  claimNextJob,
  processJob,
  finishJob,
  retryJob,
  scheduleMemoryRetry,
  signal,
}) {
  if (!memoryPressureGuard || typeof memoryPressureGuard.admit !== 'function') {
    throw new TypeError('memoryPressureGuard.admit is required.')
  }
  if (typeof memoryPressureGuard.sample !== 'function') {
    throw new TypeError('memoryPressureGuard.sample is required.')
  }
  if (typeof claimNextJob !== 'function') throw new TypeError('claimNextJob is required.')
  if (typeof processJob !== 'function') throw new TypeError('processJob is required.')
  if (typeof finishJob !== 'function') throw new TypeError('finishJob is required.')
  if (typeof retryJob !== 'function') throw new TypeError('retryJob is required.')
  if (typeof scheduleMemoryRetry !== 'function') {
    throw new TypeError('scheduleMemoryRetry is required.')
  }

  let processed = 0
  while (true) {
    if (signal?.aborted) {
      return {
        processed,
        deferred: true,
        retryAfterMs: null,
        pressureLevel: null,
      }
    }
    const decision = memoryPressureGuard.admit(MEMORY_WORK_CLASS.HEAVY)
    if (!decision?.allowed) {
      const retryAfterMs = retryDelay(decision?.retryAfterMs)
      scheduleMemoryRetry(retryAfterMs)
      return {
        processed,
        deferred: true,
        retryAfterMs,
        pressureLevel: decision?.level ?? null,
      }
    }

    const job = await claimNextJob()
    if (!job) return { processed, deferred: false }

    try {
      const result = await processJob(job)
      await finishJob(job, result)
    } catch (error) {
      await retryJob(job, error)
      if (isMailSyncDeferredError(error)) {
        const retryAfterMs = retryDelay(error?.retryAfterMs)
        if (!signal?.aborted) scheduleMemoryRetry(retryAfterMs)
        return {
          processed: processed + 1,
          deferred: true,
          retryAfterMs,
          pressureLevel: error?.level ?? null,
        }
      }
    } finally {
      processed += 1
      memoryPressureGuard.sample()
    }
  }
}
