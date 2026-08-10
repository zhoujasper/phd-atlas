const MEBIBYTE = 1024 * 1024

export const DEFAULT_MEMORY_BUDGET_BYTES = 1024 * MEBIBYTE
export const DEFAULT_MEMORY_SOFT_RATIO = 0.75
export const DEFAULT_MEMORY_HARD_RATIO = 0.875
export const DEFAULT_MEMORY_HYSTERESIS_RATIO = 0.05
export const DEFAULT_MEMORY_RECOVERY_SAMPLES = 2

export const MEMORY_PRESSURE_LEVEL = Object.freeze({
  NORMAL: 'normal',
  SOFT: 'soft',
  HARD: 'hard',
})

export const MEMORY_WORK_CLASS = Object.freeze({
  HEALTH: 'health',
  STANDARD: 'standard',
  HEAVY: 'heavy',
})

function positiveSafeInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function readProcessConstrainedMemory() {
  return typeof process.constrainedMemory === 'function'
    ? process.constrainedMemory()
    : undefined
}

export function readProcessRssBytes({
  memoryUsage = () => process.memoryUsage(),
  resourceUsage = () => process.resourceUsage(),
} = {}) {
  try {
    const currentRssBytes = positiveSafeInteger(memoryUsage()?.rss)
    if (currentRssBytes) return currentRssBytes
  } catch {
    // Fall through to the conservative peak-RSS reading below. Some emulated
    // Linux runtimes return zero or throw even though getrusage remains valid.
  }

  try {
    // Node reports resourceUsage().maxRSS in KiB. A peak is deliberately more
    // conservative than a current sample and is used only when current RSS is
    // unavailable, preserving fail-closed admission without a false startup
    // outage under cross-architecture container emulation.
    const peakRssKib = positiveSafeInteger(resourceUsage()?.maxRSS)
    const peakRssBytes = positiveSafeInteger(peakRssKib === null ? null : peakRssKib * 1024)
    if (peakRssBytes) return peakRssBytes
  } catch {
    // The caller's sampling boundary converts the final failure into hard
    // pressure while leaving liveness diagnostics available.
  }

  throw new TypeError('Process RSS is unavailable.')
}

/**
 * Resolves one stable process budget. A deliberately configured budget wins;
 * otherwise Node's cgroup/job-object-aware constraint is preferred to the
 * conservative 1024 MiB standalone default.
 */
export function resolveMemoryBudget(options = {}) {
  const {
    budgetBytes,
    constrainedMemory = readProcessConstrainedMemory,
    fallbackBytes = DEFAULT_MEMORY_BUDGET_BYTES,
  } = options
  if (budgetBytes !== undefined) {
    const configured = positiveSafeInteger(budgetBytes)
    if (!configured) throw new TypeError('budgetBytes must be a positive safe integer.')
    return { bytes: configured, source: 'configured' }
  }

  let constrained = null
  try {
    constrained = positiveSafeInteger(
      typeof constrainedMemory === 'function' ? constrainedMemory() : constrainedMemory,
    )
  } catch {
    // Runtime constraint discovery is optional. Fall back to the known-safe
    // low-resource profile when Node or the host cannot report it.
  }
  if (constrained) return { bytes: constrained, source: 'constrained' }

  return {
    bytes: positiveSafeInteger(fallbackBytes) ?? DEFAULT_MEMORY_BUDGET_BYTES,
    source: 'default',
  }
}

function normalizeWorkClass(value) {
  const normalized = String(value ?? MEMORY_WORK_CLASS.HEAVY).trim().toLowerCase()
  if (normalized === 'health' || normalized === 'liveness') return MEMORY_WORK_CLASS.HEALTH
  if (normalized === 'standard' || normalized === 'light') return MEMORY_WORK_CLASS.STANDARD
  if (normalized === MEMORY_WORK_CLASS.HEAVY) return MEMORY_WORK_CLASS.HEAVY
  throw new TypeError(`Unknown memory-pressure work class: ${normalized || '<empty>'}`)
}

export class MemoryPressureError extends Error {
  constructor(decision) {
    const level = decision?.level ?? MEMORY_PRESSURE_LEVEL.HARD
    super(`The server is under ${level} memory pressure. Please retry shortly.`)
    this.name = 'MemoryPressureError'
    this.code = decision?.code ?? 'MEMORY_PRESSURE_HARD'
    this.status = 503
    this.retryAfterMs = decision?.retryAfterMs ?? 1_000
    this.level = level
    this.workClass = decision?.workClass ?? MEMORY_WORK_CLASS.HEAVY
    this.rssBytes = decision?.rssBytes ?? null
    this.budgetBytes = decision?.budgetBytes ?? null
  }
}

/**
 * Process-local RSS pressure gate.
 *
 * Upward transitions are immediate. Recovery requires both a five-percentage-
 * point hysteresis margin and consecutive low samples, preventing GC/RSS noise
 * from repeatedly opening and closing expensive work. The guard never exits or
 * kills the process; callers decide how to return/retry rejected work. An
 * admission is a point-in-time decision, not a memory reservation: queued work
 * must check again after receiving its concurrency slot and immediately before
 * it starts parsing, buffering, or other expensive allocation.
 */
export function createMemoryPressureGuard({
  budgetBytes,
  constrainedMemory = readProcessConstrainedMemory,
  readRssBytes = readProcessRssBytes,
  softRatio = DEFAULT_MEMORY_SOFT_RATIO,
  hardRatio = DEFAULT_MEMORY_HARD_RATIO,
  hysteresisRatio = DEFAULT_MEMORY_HYSTERESIS_RATIO,
  recoverySamples = DEFAULT_MEMORY_RECOVERY_SAMPLES,
  retryAfterMs = 1_000,
  now = () => Date.now(),
} = {}) {
  const budget = resolveMemoryBudget({ budgetBytes, constrainedMemory })
  const soft = Number(softRatio)
  const hard = Number(hardRatio)
  const hysteresis = Number(hysteresisRatio)
  if (!Number.isFinite(soft) || soft <= 0 || soft >= 1) {
    throw new TypeError('softRatio must be between 0 and 1.')
  }
  if (!Number.isFinite(hard) || hard <= 0 || hard >= 1) {
    throw new TypeError('hardRatio must be between 0 and 1.')
  }
  if (hard <= soft) throw new TypeError('hardRatio must be greater than softRatio.')
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= soft) {
    throw new TypeError('hysteresisRatio must be non-negative and smaller than softRatio.')
  }
  if (typeof readRssBytes !== 'function') throw new TypeError('readRssBytes must be a function.')
  if (typeof now !== 'function') throw new TypeError('now must be a function.')

  const samplesToRecover = positiveSafeInteger(recoverySamples)
  const retryDelay = positiveSafeInteger(retryAfterMs)
  if (!samplesToRecover) throw new TypeError('recoverySamples must be a positive safe integer.')
  if (!retryDelay) throw new TypeError('retryAfterMs must be a positive safe integer.')
  const softThresholdBytes = Math.floor(budget.bytes * soft)
  const hardThresholdBytes = Math.floor(budget.bytes * hard)
  const softRecoveryBytes = Math.floor(budget.bytes * Math.max(0, soft - hysteresis))
  const hardRecoveryBytes = Math.floor(
    budget.bytes * Math.max(soft, hard - hysteresis),
  )

  let level = MEMORY_PRESSURE_LEVEL.NORMAL
  let pendingRecoveryLevel = null
  let pendingRecoverySamples = 0
  let lastRssBytes = null
  let lastValidRssBytes = null
  let peakRssBytes = 0
  let lastSampleAt = null
  let lastTransitionAt = null
  let lastSampleFailed = false
  let initialized = false
  const counters = {
    samples: 0,
    admitted: 0,
    rejected: 0,
    softRejections: 0,
    hardRejections: 0,
    healthBypasses: 0,
    samplingErrors: 0,
    transitions: 0,
    enteredSoft: 0,
    enteredHard: 0,
    recoveries: 0,
    hardToSoft: 0,
    hardToNormal: 0,
    softToNormal: 0,
  }

  const clearPendingRecovery = () => {
    pendingRecoveryLevel = null
    pendingRecoverySamples = 0
  }

  const transition = (nextLevel, sampledAt) => {
    if (nextLevel === level) return
    const previousLevel = level
    level = nextLevel
    lastTransitionAt = sampledAt
    counters.transitions += 1
    if (nextLevel === MEMORY_PRESSURE_LEVEL.SOFT) counters.enteredSoft += 1
    else if (nextLevel === MEMORY_PRESSURE_LEVEL.HARD) counters.enteredHard += 1
    else counters.recoveries += 1
    if (previousLevel === MEMORY_PRESSURE_LEVEL.HARD && nextLevel === MEMORY_PRESSURE_LEVEL.SOFT) {
      counters.hardToSoft += 1
    } else if (previousLevel === MEMORY_PRESSURE_LEVEL.HARD && nextLevel === MEMORY_PRESSURE_LEVEL.NORMAL) {
      counters.hardToNormal += 1
    } else if (previousLevel === MEMORY_PRESSURE_LEVEL.SOFT && nextLevel === MEMORY_PRESSURE_LEVEL.NORMAL) {
      counters.softToNormal += 1
    }
    clearPendingRecovery()
  }

  const recoverToward = (nextLevel, sampledAt) => {
    if (pendingRecoveryLevel !== nextLevel) {
      pendingRecoveryLevel = nextLevel
      pendingRecoverySamples = 1
    } else {
      pendingRecoverySamples += 1
    }
    if (pendingRecoverySamples >= samplesToRecover) transition(nextLevel, sampledAt)
  }

  const updateLevel = (rssBytes, sampledAt) => {
    if (rssBytes >= hardThresholdBytes) {
      clearPendingRecovery()
      transition(MEMORY_PRESSURE_LEVEL.HARD, sampledAt)
      return
    }

    if (level === MEMORY_PRESSURE_LEVEL.NORMAL) {
      clearPendingRecovery()
      if (rssBytes >= softThresholdBytes) transition(MEMORY_PRESSURE_LEVEL.SOFT, sampledAt)
      return
    }

    if (level === MEMORY_PRESSURE_LEVEL.SOFT) {
      if (rssBytes < softRecoveryBytes) {
        recoverToward(MEMORY_PRESSURE_LEVEL.NORMAL, sampledAt)
      } else {
        clearPendingRecovery()
      }
      return
    }

    if (rssBytes >= hardRecoveryBytes) {
      clearPendingRecovery()
      return
    }
    const recoveryLevel = rssBytes < softRecoveryBytes
      ? MEMORY_PRESSURE_LEVEL.NORMAL
      : MEMORY_PRESSURE_LEVEL.SOFT
    recoverToward(recoveryLevel, sampledAt)
  }

  const sampleInternal = () => {
    initialized = true
    counters.samples += 1
    try {
      const sampledAt = Number(now())
      if (!Number.isFinite(sampledAt)) throw new TypeError('now must return a finite timestamp.')
      lastSampleAt = sampledAt
      const rssBytes = positiveSafeInteger(readRssBytes())
      if (!rssBytes) throw new TypeError('RSS must be a positive safe integer.')
      lastRssBytes = rssBytes
      lastValidRssBytes = rssBytes
      lastSampleFailed = false
      peakRssBytes = Math.max(peakRssBytes, rssBytes)
      updateLevel(rssBytes, lastSampleAt)
    } catch {
      // Memory telemetry is a safety boundary. Fail closed for new work while
      // still allowing the liveness endpoint to report the degraded condition.
      lastRssBytes = null
      lastSampleAt = Date.now()
      lastSampleFailed = true
      counters.samplingErrors += 1
      clearPendingRecovery()
      transition(MEMORY_PRESSURE_LEVEL.HARD, lastSampleAt)
    }
  }

  const snapshot = () => ({
    initialized,
    level,
    budgetBytes: budget.bytes,
    budgetSource: budget.source,
    softThresholdBytes,
    hardThresholdBytes,
    softRecoveryBytes,
    hardRecoveryBytes,
    softRatio: soft,
    hardRatio: hard,
    hysteresisRatio: hysteresis,
    recoverySamples: samplesToRecover,
    pendingRecoveryLevel,
    pendingRecoverySamples,
    lastRssBytes,
    lastValidRssBytes,
    peakRssBytes,
    pressureRatio: lastRssBytes === null ? null : lastRssBytes / budget.bytes,
    lastSampleAt,
    lastTransitionAt,
    lastSampleFailed,
    counters: { ...counters },
  })

  const sample = () => {
    sampleInternal()
    return snapshot()
  }

  const admit = (requestedClass = MEMORY_WORK_CLASS.HEAVY) => {
    const workClass = normalizeWorkClass(requestedClass)
    sampleInternal()
    const allowed = workClass === MEMORY_WORK_CLASS.HEALTH
      || level === MEMORY_PRESSURE_LEVEL.NORMAL
      || (level === MEMORY_PRESSURE_LEVEL.SOFT && workClass === MEMORY_WORK_CLASS.STANDARD)
    if (allowed) {
      counters.admitted += 1
      if (workClass === MEMORY_WORK_CLASS.HEALTH && level !== MEMORY_PRESSURE_LEVEL.NORMAL) {
        counters.healthBypasses += 1
      }
    } else {
      counters.rejected += 1
      if (level === MEMORY_PRESSURE_LEVEL.SOFT) counters.softRejections += 1
      else counters.hardRejections += 1
    }
    return {
      allowed,
      workClass,
      level,
      code: allowed ? null : `MEMORY_PRESSURE_${level.toUpperCase()}`,
      retryAfterMs: allowed ? null : retryDelay,
      rssBytes: lastRssBytes,
      budgetBytes: budget.bytes,
    }
  }

  const assertAllowed = (workClass) => {
    const decision = admit(workClass)
    if (!decision.allowed) throw new MemoryPressureError(decision)
    return decision
  }

  return { admit, assertAllowed, sample, snapshot }
}
