import { MEMORY_WORK_CLASS } from './memoryPressure.js'

const DEFAULT_RETRY_AFTER_MS = 1_000
const MAX_RETRY_AFTER_MS = 60_000
const MEBIBYTE = 1024 * 1024

export const DISCOVER_RESEARCH_MEMORY_RESERVATION_BYTES = 64 * MEBIBYTE

function boundedRetryDelay(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETRY_AFTER_MS
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(1, Math.ceil(parsed)))
}

export class DiscoverResearchDeferredError extends Error {
  constructor(code, message, {
    phase = 'discover-research',
    retryAfterMs = DEFAULT_RETRY_AFTER_MS,
    level = null,
  } = {}) {
    super(message)
    this.name = 'DiscoverResearchDeferredError'
    this.code = code
    this.status = 503
    this.retryAfterMs = boundedRetryDelay(retryAfterMs)
    this.phase = String(phase || 'discover-research')
    this.level = level == null ? null : String(level)
    this.workClass = MEMORY_WORK_CLASS.HEAVY
  }
}

export function isDiscoverResearchDeferredError(error) {
  return error instanceof DiscoverResearchDeferredError
    || [
      'DISCOVER_RESEARCH_MEMORY_DEFERRED',
      'DISCOVER_RESEARCH_SHUTDOWN_DEFERRED',
      'DISCOVER_RESEARCH_TIME_SLICE_DEFERRED',
    ].includes(error?.code)
}

export function discoverResearchRetryDelayMs(error) {
  return boundedRetryDelay(error?.retryAfterMs)
}

export function createDiscoverResearchShutdownDeferredError({
  phase = 'discover-research',
  retryAfterMs,
} = {}) {
  return new DiscoverResearchDeferredError(
    'DISCOVER_RESEARCH_SHUTDOWN_DEFERRED',
    `Discover research ${phase} was paused because the server is stopping.`,
    { phase, retryAfterMs },
  )
}

export function createDiscoverResearchTimeSliceDeferredError({
  phase = 'discover-research',
  retryAfterMs,
} = {}) {
  return new DiscoverResearchDeferredError(
    'DISCOVER_RESEARCH_TIME_SLICE_DEFERRED',
    `Discover research ${phase} reached its bounded execution slice and will continue from its durable checkpoint.`,
    { phase, retryAfterMs },
  )
}

function discoverResearchMemoryDeferredError(decision, phase) {
  const level = String(decision?.level ?? 'unknown')
  return new DiscoverResearchDeferredError(
    'DISCOVER_RESEARCH_MEMORY_DEFERRED',
    `Discover research ${phase} was deferred because the server is under ${level} memory pressure.`,
    {
      phase,
      retryAfterMs: decision?.retryAfterMs,
      level,
    },
  )
}

/**
 * Reserve Discover's bounded incremental work set in the process-wide ledger.
 * The caller owns the returned idempotent lease until the actual worker
 * promise—including checkpoint flushing and failure settlement—has finished.
 */
export function acquireDiscoverResearchMemoryReservation(memoryReservationLedger, {
  phase = 'dequeue-reservation',
} = {}) {
  if (!memoryReservationLedger || typeof memoryReservationLedger.acquire !== 'function') {
    throw new TypeError('memoryReservationLedger.acquire is required.')
  }
  const reservation = memoryReservationLedger.acquire(
    MEMORY_WORK_CLASS.HEAVY,
    DISCOVER_RESEARCH_MEMORY_RESERVATION_BYTES,
  )
  if (!reservation?.allowed || typeof reservation.release !== 'function') {
    throw discoverResearchMemoryDeferredError(reservation?.decision, phase)
  }
  return reservation
}

/**
 * Discover research is a durable, allocation-heavy background pipeline. This
 * checkpoint must run after a queue slot is selected and again between long
 * crawl/agent phases. Enqueueing is intentionally not an admission decision:
 * RSS may change before the durable job reaches the head of the queue.
 */
export function assertDiscoverResearchHeavyAdmission(memoryPressureGuard, {
  phase = 'discover-research',
  signal,
  deadlineAt,
  now = Date.now,
  retryAfterMs,
} = {}) {
  if (!memoryPressureGuard || typeof memoryPressureGuard.admit !== 'function') {
    throw new TypeError('memoryPressureGuard.admit is required.')
  }
  if (signal?.aborted) {
    if (isDiscoverResearchDeferredError(signal.reason)) throw signal.reason
    throw createDiscoverResearchShutdownDeferredError({ phase, retryAfterMs })
  }

  const deadline = Number(deadlineAt)
  if (Number.isFinite(deadline)) {
    const current = Number(typeof now === 'function' ? now() : now)
    if (!Number.isFinite(current)) throw new TypeError('now must resolve to a finite timestamp.')
    if (current >= deadline) {
      throw createDiscoverResearchTimeSliceDeferredError({ phase, retryAfterMs })
    }
  }

  const decision = memoryPressureGuard.admit(MEMORY_WORK_CLASS.HEAVY)
  if (!decision?.allowed) {
    throw discoverResearchMemoryDeferredError(decision, phase)
  }
  return decision
}

/** Normalize provider/fetch abort wrappers back to the queue-owned deferral. */
export function discoverResearchDeferredErrorFor(error, {
  signal,
  phase = 'discover-research',
  retryAfterMs,
} = {}) {
  if (isDiscoverResearchDeferredError(error)) return error
  if (!signal?.aborted) return null
  if (isDiscoverResearchDeferredError(signal.reason)) return signal.reason
  return createDiscoverResearchShutdownDeferredError({ phase, retryAfterMs })
}
