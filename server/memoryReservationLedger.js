import {
  MEMORY_PRESSURE_LEVEL,
  MEMORY_WORK_CLASS,
} from './memoryPressure.js'

const DEFAULT_RETRY_AFTER_MS = 1_000

function reservationBytes(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function hardBoundaryDecision(decision, snapshot) {
  return {
    ...decision,
    allowed: false,
    code: 'MEMORY_PRESSURE_SOFT',
    retryAfterMs: Number(decision?.retryAfterMs) || DEFAULT_RETRY_AFTER_MS,
    level: snapshot?.level === MEMORY_PRESSURE_LEVEL.HARD
      ? MEMORY_PRESSURE_LEVEL.HARD
      : MEMORY_PRESSURE_LEVEL.SOFT,
  }
}

function absoluteBudgetDecision(decision, snapshot) {
  return {
    ...decision,
    allowed: false,
    code: 'MEMORY_PRESSURE_HARD',
    retryAfterMs: Number(decision?.retryAfterMs) || DEFAULT_RETRY_AFTER_MS,
    level: MEMORY_PRESSURE_LEVEL.HARD,
    budgetBytes: Number(snapshot?.budgetBytes) || Number(decision?.budgetBytes) || null,
    rssBytes: Number(snapshot?.lastRssBytes) || Number(decision?.rssBytes) || null,
  }
}

/**
 * One process-local ledger for memory which active native/background/response
 * work has promised but which may not have appeared in RSS yet.
 *
 * Point-in-time RSS gates alone are racy: Argon2, exports and SMTP can all pass
 * while the process is NORMAL and then allocate concurrently. Every caller
 * therefore reserves its worst-case incremental work set before starting and
 * keeps the returned lease until the actual work/response settles.
 */
export function createMemoryReservationLedger({ memoryPressureGuard } = {}) {
  if (!memoryPressureGuard || typeof memoryPressureGuard.admit !== 'function') {
    throw new TypeError('memoryPressureGuard.admit is required.')
  }
  if (typeof memoryPressureGuard.snapshot !== 'function') {
    throw new TypeError('memoryPressureGuard.snapshot is required.')
  }

  let reservedBytes = 0
  let activeReservations = 0
  let peakReservedBytes = 0
  const counters = {
    admitted: 0,
    rejected: 0,
    released: 0,
  }

  const decide = (workClass, requestedBytes = 0) => {
    const bytes = reservationBytes(requestedBytes)
    const decision = memoryPressureGuard.admit(workClass)
    if (!decision?.allowed || workClass === MEMORY_WORK_CLASS.HEALTH) return decision

    const snapshot = memoryPressureGuard.snapshot()
    const hardThresholdBytes = Number(snapshot?.hardThresholdBytes)
      || Math.floor(Number(decision?.budgetBytes) * 0.875)
    const rssBytes = Number(decision?.rssBytes ?? snapshot?.lastRssBytes)
    if (
      Number.isFinite(hardThresholdBytes)
      && Number.isFinite(rssBytes)
      && rssBytes + reservedBytes + bytes >= hardThresholdBytes
    ) {
      return hardBoundaryDecision(decision, snapshot)
    }
    return decision
  }

  const admit = (workClass, options = {}) => {
    const decision = decide(workClass, options.requiredHeadroomBytes)
    if (decision?.allowed) counters.admitted += 1
    else counters.rejected += 1
    return decision
  }

  const acquire = (workClass, requestedBytes) => {
    const bytes = reservationBytes(requestedBytes)
    if (bytes <= 0) throw new TypeError('A positive memory reservation is required.')
    const decision = decide(workClass, bytes)
    if (!decision?.allowed) {
      counters.rejected += 1
      return { allowed: false, decision, bytes, release: null }
    }

    reservedBytes += bytes
    activeReservations += 1
    peakReservedBytes = Math.max(peakReservedBytes, reservedBytes)
    counters.admitted += 1
    let released = false
    let leaseBytes = bytes
    const lease = {
      allowed: true,
      decision,
      bytes,
      /**
       * Reduce a live reservation after a bounded allocation phase has shed
       * its worst-case buffers. This is intentionally shrink-only: callers
       * must pass admission again before growing their working set.
       */
      shrink(nextBytes) {
        if (released) return 0
        const targetBytes = Math.min(leaseBytes, reservationBytes(nextBytes))
        if (targetBytes === leaseBytes) return leaseBytes
        reservedBytes = Math.max(0, reservedBytes - (leaseBytes - targetBytes))
        leaseBytes = targetBytes
        lease.bytes = targetBytes
        if (targetBytes === 0) lease.release()
        return targetBytes
      },
      release: () => {
        if (released) return
        released = true
        reservedBytes = Math.max(0, reservedBytes - leaseBytes)
        leaseBytes = 0
        lease.bytes = 0
        activeReservations = Math.max(0, activeReservations - 1)
        counters.released += 1
      },
    }
    return lease
  }

  /**
   * Reserve one small, completion-critical projection inside the absolute
   * process budget even when the ordinary hard watermark is active. This is
   * intentionally narrower than HEALTH admission: callers must provide a
   * non-configurable maximum, the reservation is still recorded, and the
   * synchronous check includes both observed RSS and every existing lease.
   * It exists so an already-admitted response can revalidate authorization
   * and terminate cleanly instead of being forced into an endless restart
   * loop after its large body legitimately consumes the safety reserve.
   */
  const acquireCompletion = (requestedBytes, { maxBytes } = {}) => {
    const bytes = reservationBytes(requestedBytes)
    const maximum = reservationBytes(maxBytes)
    const decision = memoryPressureGuard.admit(MEMORY_WORK_CLASS.HEALTH)
    const pressure = memoryPressureGuard.snapshot()
    const budgetBytes = Number(pressure?.budgetBytes ?? decision?.budgetBytes)
    const rssBytes = Number(pressure?.lastRssBytes ?? decision?.rssBytes)
    if (
      bytes <= 0
      || maximum <= 0
      || bytes > maximum
      || !decision?.allowed
      || !Number.isFinite(budgetBytes)
      || !Number.isFinite(rssBytes)
      || rssBytes + reservedBytes + bytes >= budgetBytes
    ) {
      counters.rejected += 1
      return {
        allowed: false,
        decision: absoluteBudgetDecision(decision, pressure),
        bytes,
        release: null,
      }
    }

    reservedBytes += bytes
    activeReservations += 1
    peakReservedBytes = Math.max(peakReservedBytes, reservedBytes)
    counters.admitted += 1
    let released = false
    return {
      allowed: true,
      decision,
      bytes,
      release: () => {
        if (released) return
        released = true
        reservedBytes = Math.max(0, reservedBytes - bytes)
        activeReservations = Math.max(0, activeReservations - 1)
        counters.released += 1
      },
    }
  }

  const snapshot = () => ({
    reservedBytes,
    activeReservations,
    peakReservedBytes,
    counters: { ...counters },
  })

  return { acquire, acquireCompletion, admit, snapshot }
}
