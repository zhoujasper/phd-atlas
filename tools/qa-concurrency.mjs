import { randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { request as nodeHttpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import jwt from 'jsonwebtoken'
import { WebSocket } from 'ws'
import { APPLICATION_MUTATION_ACK_PROTOCOL } from '../server/applicationMutationAck.js'
import { WORKER_FATAL_STATUS_RELATIVE_PATH } from './container-entrypoint.mjs'

const DEFAULTS = Object.freeze({
  virtualUsers: 100,
  healthIterations: 3,
  sseBatchSize: 20,
  writeUsers: 10,
  loginUsers: 100,
  sseObservers: 20,
  webSockets: 100,
  overloadWrites: 100,
  overloadRetries: 8,
  loginRetryBudgetMs: 75_000,
  requestTimeoutMs: 30_000,
  sseIsolationWindowMs: 2_000,
  enduranceEnabled: false,
  enduranceScenarios: [],
  enduranceDurationMs: 5 * 60_000,
  enduranceConnectionsDurationMs: 10 * 60_000,
  enduranceAutosaveUsers: 100,
  enduranceSseClients: 100,
  enduranceWebSockets: 100,
  enduranceRssSamples: 12,
  enduranceReadIntervalMs: 5_000,
  enduranceAutosaveIntervalMinMs: 3_000,
  enduranceAutosaveIntervalMaxMs: 8_000,
  enduranceBackgroundIntervalMinMs: 3_000,
  enduranceBackgroundIntervalMaxMs: 8_000,
})

const QUALIFICATION_MINIMUMS = Object.freeze({
  virtualUsers: 100,
  loginUsers: 100,
  sseConnections: 100,
  sseObservers: 99,
  webSockets: 100,
  overloadWrites: 100,
  overloadRetries: 24,
  mixedUsers: 100,
  mixedWrites: 10,
  mixedLogins: 20,
  mixedReads: 70,
  durabilityReadbacks: 100,
  bodyAdmissionActive: 8,
  bodyAdmissionQueued: 128,
  bodyAdmissionHolders: 136,
  loginRetryBudgetMs: 120_000,
  enduranceAutosaveUsers: 100,
  enduranceSseClients: 100,
  enduranceWebSockets: 100,
})

const DEFAULT_THRESHOLDS = Object.freeze({
  healthP95Ms: 500,
  readP95Ms: 1_500,
  writeP95Ms: 2_500,
  loginP95Ms: 4_000,
  overloadP95Ms: 8_000,
  mixedP95Ms: 3_000,
  eventLoopP99Ms: 200,
  enduranceRssSlopeKbPerMinute: 10_000,
  enduranceP95DegradationMs: 1_000,
})

const DEFAULT_DEADLINES = Object.freeze({
  overallTimeoutMs: 15 * 60_000,
  phaseTimeoutMs: 6 * 60_000,
  cleanupTimeoutMs: 60_000,
  progressIntervalMs: 15_000,
})

const ENDURANCE_SCENARIOS = Object.freeze([
  'autosave',
  'background',
  'connections',
  'liveness',
])

const QA_PROGRESS_TYPE = 'phd-atlas.qa-concurrency.progress'
const QA_LOOPBACK_PROXY_HEADERS = Object.freeze({
  host: '127.0.0.1',
  'x-forwarded-proto': 'https',
})
const QA_RUNTIME_MEMORY_BUDGET_BYTES = 2 * 1024 * 1024 * 1024
const QA_RUNTIME_MEMORY_HARD_RATIO = 0.875
const QA_WORKSPACE_STREAM_PROTOCOL = 'phd-atlas-workspace-sections-v1'
const QA_WORKSPACE_STREAM_MAX_LINE_CHARACTERS = 256 * 1024
export const QA_FAILURE_DIAGNOSTIC_LIMIT = 10
const SENSITIVE_DIAGNOSTIC_KEY = /(?:authorization|cookie|password|passphrase|secret|token|api[-_]?key|jwt|encryption[-_]?key)/iu

function redactDiagnosticText(value) {
  return String(value)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/giu, '$1[REDACTED]@')
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*[^\r\n]+/giu, '$1: [REDACTED]')
    .replace(/\b(set-cookie|cookie)\s*[:=]\s*[^\r\n]+/giu, '$1: [REDACTED]')
    .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/giu, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[REDACTED]')
    .replace(/\b(password|passphrase|secret|token|api[-_]?key|jwt|encryption[-_]?key)["']?\s*[:=]\s*["']?[^\s,;"']+/giu, '$1=[REDACTED]')
}

export function sanitizeQaDiagnostic(value, key = '', seen = new WeakSet()) {
  if (
    SENSITIVE_DIAGNOSTIC_KEY.test(String(key))
    && value !== null
    && value !== undefined
    && typeof value !== 'boolean'
  ) return '[REDACTED]'
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  let sanitized
  if (value instanceof Error) {
    sanitized = sanitizeQaDiagnostic({
      name: value.name,
      code: value.code,
      message: value.message,
      stack: value.stack,
      timeoutMs: value.timeoutMs,
      phase: value.phase,
      workerOutput: value.workerOutput,
      workerStartup: value.workerStartup,
      workerDiagnostics: value.workerDiagnostics,
      storageHandoff: value.storageHandoff,
    }, key, seen)
  } else if (Array.isArray(value)) {
    sanitized = value.map((entry) => sanitizeQaDiagnostic(entry, '', seen))
  } else {
    sanitized = Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeQaDiagnostic(entryValue, entryKey, seen),
    ]))
  }
  seen.delete(value)
  return sanitized
}

export function toQaFailureDiagnostic(error, context = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error))
  return sanitizeQaDiagnostic({
    code: normalized.code || context.code || 'QA_RUN_FAILED',
    phase: normalized.phase || context.phase || 'unclassified',
    name: normalized.name || 'Error',
    message: normalized.message || String(error),
    timeoutMs: normalized.timeoutMs,
    stack: normalized.stack,
    workerOutput: normalized.workerOutput,
    workerStartup: normalized.workerStartup,
    workerDiagnostics: normalized.workerDiagnostics,
    storageHandoff: normalized.storageHandoff,
  })
}

export function createQaProgressReporter({
  runId,
  write = (line) => process.stderr.write(line),
  now = () => new Date(),
  onEvent,
} = {}) {
  return (event, details = {}) => {
    const entry = sanitizeQaDiagnostic({
      type: QA_PROGRESS_TYPE,
      version: 1,
      runId: runId || 'unassigned',
      event,
      at: now().toISOString(),
      ...details,
    })
    try {
      onEvent?.(entry)
    } catch {
      // In-memory progress collection is best effort for the same reason.
    }
    try {
      write(`${JSON.stringify(entry)}\n`)
    } catch {
      // Progress output must never change the QA result or bypass cleanup.
    }
    return entry
  }
}

export class QaDeadlineError extends Error {
  constructor(scope, timeoutMs, phase) {
    const phaseLabel = phase || scope
    super(`${scope === 'overall' ? 'QA run' : `QA phase ${phaseLabel}`} exceeded its ${timeoutMs}ms deadline`)
    this.name = 'QaDeadlineError'
    this.code = scope === 'overall' ? 'QA_OVERALL_TIMEOUT' : 'QA_PHASE_TIMEOUT'
    this.phase = phaseLabel
    this.timeoutMs = timeoutMs
  }
}

function combinedAbortSignal(signals) {
  const activeSignals = signals.filter(Boolean)
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  return AbortSignal.any(activeSignals)
}

export class QaHttpTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`HTTP request exceeded its ${timeoutMs}ms deadline`)
    this.name = 'QaHttpTimeoutError'
    this.code = 'QA_HTTP_TIMEOUT'
    this.timeoutMs = timeoutMs
  }
}

export async function fetchWithQaTimeout(
  url,
  init = {},
  timeoutMs = DEFAULTS.requestTimeoutMs,
  consumeResponse = async (response) => response,
) {
  const controller = new AbortController()
  const timeoutError = new QaHttpTimeoutError(timeoutMs)
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
  const signal = combinedAbortSignal([init?.signal, controller.signal])
  try {
    const response = await fetch(url, { ...init, signal })
    return await consumeResponse(response)
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function runWithQaDeadline(phase, timeoutMs, task, { signal, code } = {}) {
  const startedAt = performance.now()
  const controller = new AbortController()
  const deadlineError = new QaDeadlineError(code === 'QA_OVERALL_TIMEOUT' ? 'overall' : 'phase', timeoutMs, phase)
  const activeSignal = combinedAbortSignal([signal, controller.signal])
  let timer
  let abortListener
  const abortPromise = new Promise((_, reject) => {
    const rejectFromSignal = () => reject(activeSignal?.reason instanceof Error
      ? activeSignal.reason
      : deadlineError)
    if (activeSignal?.aborted) rejectFromSignal()
    else if (activeSignal) {
      abortListener = rejectFromSignal
      activeSignal.addEventListener('abort', abortListener, { once: true })
    }
  })
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(deadlineError)
      reject(deadlineError)
    }, timeoutMs)
  })
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => task(activeSignal)),
      timeoutPromise,
      abortPromise,
    ])
    if (performance.now() - startedAt >= timeoutMs) {
      controller.abort(deadlineError)
      throw deadlineError
    }
    return result
  } finally {
    if (timer) clearTimeout(timer)
    if (abortListener && activeSignal) activeSignal.removeEventListener('abort', abortListener)
  }
}

export async function waitForQaListenerAddress(server, {
  timeoutMs = DEFAULTS.requestTimeoutMs,
  signal,
} = {}) {
  if (
    !server
    || typeof server.address !== 'function'
    || typeof server.once !== 'function'
    || typeof server.removeListener !== 'function'
  ) {
    const error = new TypeError('QA listener owner is not a compatible server')
    error.code = 'QA_LISTENER_INVALID'
    throw error
  }

  const readListeningAddress = () => {
    if (!server.listening) return null
    const address = server.address()
    if (address) return address
    const error = new Error('QA listener reported listening without an address')
    error.code = 'QA_LISTENER_ADDRESS_UNAVAILABLE'
    throw error
  }

  const existingAddress = readListeningAddress()
  if (existingAddress) return existingAddress

  return runWithQaDeadline('setup:listener-ready', timeoutMs, (activeSignal) => (
    new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        server.removeListener('listening', handleListening)
        server.removeListener('error', handleError)
        server.removeListener('close', handleClose)
        activeSignal?.removeEventListener('abort', handleAbort)
      }
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        cleanup()
        callback(value)
      }
      const handleListening = () => {
        try {
          const address = readListeningAddress()
          if (!address) {
            const error = new Error('QA listener emitted listening without an address')
            error.code = 'QA_LISTENER_ADDRESS_UNAVAILABLE'
            finish(reject, error)
            return
          }
          finish(resolve, address)
        } catch (error) {
          finish(reject, error)
        }
      }
      const handleError = (error) => finish(
        reject,
        error instanceof Error ? error : Object.assign(new Error(String(error)), {
          code: 'QA_LISTENER_BIND_FAILED',
        }),
      )
      const handleClose = () => {
        const error = new Error('QA listener closed before it started listening')
        error.code = 'QA_LISTENER_CLOSED'
        finish(reject, error)
      }
      const handleAbort = () => {
        const error = activeSignal?.reason instanceof Error
          ? activeSignal.reason
          : Object.assign(new Error('QA listener wait was aborted'), {
              code: 'QA_LISTENER_WAIT_ABORTED',
            })
        finish(reject, error)
      }

      server.once('listening', handleListening)
      server.once('error', handleError)
      server.once('close', handleClose)
      activeSignal?.addEventListener('abort', handleAbort, { once: true })

      if (activeSignal?.aborted) {
        handleAbort()
        return
      }
      try {
        if (readListeningAddress()) handleListening()
      } catch (error) {
        finish(reject, error)
      }
    })
  ), { signal })
}

export function createQaOperationTracker({ timeoutMs, signal } = {}) {
  const pending = new Set()
  return {
    get pendingCount() {
      return pending.size
    },
    async run(name, operation, { onSuccess, onLateSuccess } = {}) {
      const record = {
        name,
        promise: null,
        settled: false,
        deadlineFailed: false,
        lateSuccessHandled: false,
        value: undefined,
      }
      const handleLateSuccess = async () => {
        if (record.lateSuccessHandled || !record.settled || !record.deadlineFailed) return
        record.lateSuccessHandled = true
        await onLateSuccess?.(record.value)
      }
      const operationPromise = Promise.resolve()
        .then(operation)
        .then(async (value) => {
          record.settled = true
          record.value = value
          onSuccess?.(value)
          await handleLateSuccess()
          return value
        })
      record.promise = operationPromise.finally(() => pending.delete(record))
      pending.add(record)
      try {
        return await runWithQaDeadline(name, timeoutMs, () => record.promise, { signal })
      } catch (error) {
        record.deadlineFailed = true
        await handleLateSuccess()
        throw error
      }
    },
    async waitForPending() {
      const records = [...pending]
      if (records.length === 0) return []
      return Promise.allSettled(records.map((record) => record.promise))
    },
  }
}

export function createQaRunSupervisor({
  overallTimeoutMs = DEFAULT_DEADLINES.overallTimeoutMs,
  phaseTimeoutMs = DEFAULT_DEADLINES.phaseTimeoutMs,
  progressIntervalMs = DEFAULT_DEADLINES.progressIntervalMs,
  emit = () => {},
  now = () => performance.now(),
} = {}) {
  const overallController = new AbortController()
  const startedAt = now()
  let activePhase
  const overallTimer = setTimeout(() => {
    overallController.abort(new QaDeadlineError('overall', overallTimeoutMs, activePhase?.name || 'overall'))
  }, overallTimeoutMs)

  const overallDeadlineError = (phase = activePhase?.name || 'overall') => (
    new QaDeadlineError('overall', overallTimeoutMs, phase)
  )

  const enforceOverallDeadline = (phase = activePhase?.name || 'overall') => {
    if (!overallController.signal.aborted && now() - startedAt >= overallTimeoutMs) {
      overallController.abort(overallDeadlineError(phase))
    }
    overallController.signal.throwIfAborted()
  }

  const clearActive = () => {
    if (!activePhase) return
    clearTimeout(activePhase.timer)
    clearInterval(activePhase.progressTimer)
    activePhase = undefined
  }

  return {
    get activePhase() {
      return activePhase?.name
    },
    get signal() {
      return activePhase?.signal || overallController.signal
    },
    get abortReason() {
      const signal = activePhase?.signal || overallController.signal
      return signal.aborted && signal.reason instanceof Error ? signal.reason : undefined
    },
    abort(error) {
      const reason = error instanceof Error ? error : new Error(String(error || 'QA run aborted'))
      if (activePhase && !activePhase.controller.signal.aborted) activePhase.controller.abort(reason)
      if (!overallController.signal.aborted) overallController.abort(reason)
    },
    startPhase(name, timeoutMs = phaseTimeoutMs) {
      enforceOverallDeadline(name)
      if (activePhase) throw new Error(`QA phase ${activePhase.name} is still active`)
      const controller = new AbortController()
      const signal = combinedAbortSignal([overallController.signal, controller.signal])
      const phaseStartedAt = now()
      const timer = setTimeout(() => {
        controller.abort(new QaDeadlineError('phase', timeoutMs, name))
      }, timeoutMs)
      const progressTimer = setInterval(() => {
        const elapsedMs = Math.max(0, now() - phaseStartedAt)
        emit('phase-progress', {
          phase: name,
          status: 'running',
          elapsedMs,
          remainingMs: Math.max(0, timeoutMs - elapsedMs),
          runElapsedMs: Math.max(0, now() - startedAt),
        })
      }, progressIntervalMs)
      progressTimer.unref?.()
      activePhase = { name, timeoutMs, phaseStartedAt, controller, signal, timer, progressTimer }
      emit('phase-start', {
        phase: name,
        status: 'running',
        deadlineMs: timeoutMs,
        runElapsedMs: Math.max(0, now() - startedAt),
      })
      return signal
    },
    completePhase(details = {}) {
      if (!activePhase) throw new Error('No QA phase is active')
      const finished = activePhase
      if (!overallController.signal.aborted && now() - startedAt >= overallTimeoutMs) {
        overallController.abort(overallDeadlineError(finished.name))
      }
      if (!finished.controller.signal.aborted && now() - finished.phaseStartedAt >= finished.timeoutMs) {
        finished.controller.abort(new QaDeadlineError('phase', finished.timeoutMs, finished.name))
      }
      if (finished.signal.aborted) {
        const reason = finished.signal.reason instanceof Error
          ? finished.signal.reason
          : new QaDeadlineError('phase', finished.timeoutMs, finished.name)
        throw reason
      }
      clearActive()
      emit('phase-complete', {
        phase: finished.name,
        status: 'complete',
        elapsedMs: Math.max(0, now() - finished.phaseStartedAt),
        runElapsedMs: Math.max(0, now() - startedAt),
        ...details,
      })
    },
    failActive(error) {
      if (!activePhase) return
      const failed = activePhase
      const failure = failed.signal.aborted && failed.signal.reason instanceof Error
        ? failed.signal.reason
        : error
      if (!failed.signal.aborted) {
        failed.controller.abort(failure instanceof Error ? failure : new Error(String(failure)))
      }
      clearActive()
      emit('phase-fail', {
        phase: failed.name,
        status: 'fail',
        elapsedMs: Math.max(0, now() - failed.phaseStartedAt),
        runElapsedMs: Math.max(0, now() - startedAt),
        failure: toQaFailureDiagnostic(failure, { phase: failed.name }),
      })
    },
    close() {
      if (!overallController.signal.aborted) {
        const reason = new Error('QA run entered cleanup')
        reason.code = 'QA_RUN_CLEANUP'
        overallController.abort(reason)
      }
      clearTimeout(overallTimer)
      clearActive()
    },
  }
}

export async function runQaCleanupSteps(steps, {
  timeoutMs = DEFAULT_DEADLINES.cleanupTimeoutMs,
  emit = () => {},
  now = () => performance.now(),
} = {}) {
  const results = []
  const cleanupStartedAt = now()
  const totalWeight = Math.max(1, steps.reduce(
    (total, step) => total + Math.max(1, Number(step.weight) || 1),
    0,
  ))
  let carriedForwardMs = 0
  let unsettledBlockingStep = null
  let allFollowingBlocked = false
  for (const step of steps) {
    const weightedTimeoutMs = Math.max(
      1,
      Math.floor((timeoutMs * Math.max(1, Number(step.weight) || 1)) / totalWeight),
    )
    // Cleanup has one hard wall-clock budget. A fast resource owner must not
    // strand its unused share while a later Windows directory removal is still
    // walking or retrying transient EBUSY/EPERM handles. Carry only time that
    // was not consumed, and clamp every step to the same absolute deadline, so
    // this redistribution cannot extend the qualification's 60-second limit.
    const remainingCleanupMs = Math.max(1, Math.floor(
      timeoutMs - Math.max(0, now() - cleanupStartedAt),
    ))
    const stepTimeoutMs = Math.max(
      1,
      Math.floor(Math.min(remainingCleanupMs, weightedTimeoutMs + carriedForwardMs)),
    )
    if (unsettledBlockingStep && (allFollowingBlocked || step.safeAfterUnsettled !== true)) {
      const error = new Error(
        `Cleanup step ${step.name} was blocked because ${unsettledBlockingStep} did not settle after abort`,
      )
      error.code = 'QA_CLEANUP_PREVIOUS_OPERATION_ACTIVE'
      const result = {
        name: step.name,
        status: 'blocked',
        deadlineMs: stepTimeoutMs,
        operationSettled: false,
        elapsedMs: 0,
        failure: toQaFailureDiagnostic(error, { phase: `cleanup:${step.name}` }),
      }
      results.push(result)
      emit('cleanup-step-blocked', { phase: 'cleanup', step: step.name, ...result })
      carriedForwardMs = stepTimeoutMs
      continue
    }
    emit('cleanup-step-start', {
      phase: 'cleanup',
      step: step.name,
      status: 'running',
      deadlineMs: stepTimeoutMs,
    })
    const startedAt = now()
    let operationSettled = false
    let operationPromise
    try {
      await runWithQaDeadline(`cleanup:${step.name}`, stepTimeoutMs, (signal) => {
        operationPromise = Promise.resolve().then(() => step.run(signal))
        operationPromise.then(
          () => { operationSettled = true },
          () => { operationSettled = true },
        )
        return operationPromise
      })
      const result = {
        name: step.name,
        status: 'pass',
        deadlineMs: stepTimeoutMs,
        operationSettled,
        elapsedMs: rounded(now() - startedAt),
      }
      results.push(result)
      emit('cleanup-step-complete', { phase: 'cleanup', step: step.name, ...result })
    } catch (error) {
      await new Promise((resolve) => setImmediate(resolve))
      const result = {
        name: step.name,
        status: 'fail',
        deadlineMs: stepTimeoutMs,
        operationSettled,
        elapsedMs: rounded(now() - startedAt),
        failure: toQaFailureDiagnostic(error, { phase: `cleanup:${step.name}` }),
      }
      results.push(result)
      emit('cleanup-step-fail', { phase: 'cleanup', step: step.name, ...result })
      if (!operationSettled && step.blocksDependents !== false) {
        unsettledBlockingStep = step.name
        allFollowingBlocked ||= step.blocksAllFollowing === true
      }
    }
    carriedForwardMs = Math.max(0, stepTimeoutMs - Math.max(0, now() - startedAt))
  }
  return {
    ok: results.every((result) => result.status === 'pass'),
    steps: results,
    failures: results.filter((result) => result.status !== 'pass').map((result) => result.failure),
    elapsedMs: rounded(now() - cleanupStartedAt),
    deadlineMs: timeoutMs,
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

function numericOption(argv, name) {
  const prefix = `--${name}=`
  const argument = argv.find((value) => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : undefined
}

function stringOption(argv, name) {
  const prefix = `--${name}=`
  const argument = argv.find((value) => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length).trim() : undefined
}

function parseEnduranceScenarios(argv, env) {
  const raw = String(
    stringOption(argv, 'endurance-scenarios')
      ?? env.PHD_ATLAS_QA_ENDURANCE_SCENARIOS
      ?? '',
  )
  const scenarios = raw
    .split(',')
    .map((value) => String(value).trim().toLocaleLowerCase())
    .filter(Boolean)
  for (const scenario of scenarios) {
    if (!ENDURANCE_SCENARIOS.includes(scenario)) {
      const error = new Error(`Unsupported QA endurance scenario: ${scenario}`)
      error.code = 'QA_ENDURANCE_SCENARIO_INVALID'
      throw error
    }
  }
  return [...new Set(scenarios)]
}

function booleanOption(argv, name, envValue, fallback = false) {
  if (argv.includes(`--${name}`) && argv.includes(`--no-${name}`)) {
    const error = new Error(`Conflicting --${name} and --no-${name} options`)
    error.code = 'QA_BOOLEAN_OPTION_CONFLICT'
    throw error
  }
  if (argv.includes(`--no-${name}`)) return false
  if (argv.includes(`--${name}`)) return true
  if (envValue === undefined || envValue === null || String(envValue).trim() === '') return fallback
  return /^(?:1|true|yes|on)$/iu.test(String(envValue).trim())
}

function normalizedPath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export async function resolveQaPathThroughExistingAncestor(candidate) {
  let cursor = path.resolve(candidate)
  const missingSegments = []
  while (true) {
    try {
      const realAncestor = await fs.realpath(cursor)
      return path.resolve(realAncestor, ...missingSegments)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw error
      missingSegments.unshift(path.basename(cursor))
      cursor = parent
    }
  }
}

function pathsOverlap(left, right) {
  if (!left || !right) return false
  const normalizedLeft = normalizedPath(left)
  const normalizedRight = normalizedPath(right)
  const leftToRight = path.relative(normalizedLeft, normalizedRight)
  const rightToLeft = path.relative(normalizedRight, normalizedLeft)
  const contains = (relative) => relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  return contains(leftToRight) || contains(rightToLeft)
}

export function validateQaTemporaryParent(candidate, {
  projectRoot = process.cwd(),
  currentStorageRoot = process.env.PHD_ATLAS_STORAGE_ROOT,
  systemTemporaryRoot = os.tmpdir(),
} = {}) {
  if (!candidate || !String(candidate).trim()) {
    const error = new Error('An explicit temporary storage parent is required for the production-like QA profile')
    error.code = 'QA_TEMP_ROOT_REQUIRED'
    throw error
  }
  const resolved = path.resolve(String(candidate).trim())
  const temporaryRoot = path.resolve(systemTemporaryRoot)
  const relativeToTemporaryRoot = path.relative(temporaryRoot, resolved)
  const insideTemporaryRoot = relativeToTemporaryRoot === ''
    || (!relativeToTemporaryRoot.startsWith('..') && !path.isAbsolute(relativeToTemporaryRoot))
  if (!insideTemporaryRoot) {
    const error = new Error('QA temporary storage must be located under the operating-system temporary directory')
    error.code = 'QA_TEMP_ROOT_OUTSIDE_SYSTEM_TEMP'
    throw error
  }
  if (pathsOverlap(resolved, projectRoot)) {
    const error = new Error('QA temporary storage must not overlap the project workspace')
    error.code = 'QA_TEMP_ROOT_OVERLAPS_PROJECT'
    throw error
  }
  if (currentStorageRoot && pathsOverlap(resolved, currentStorageRoot)) {
    const error = new Error('QA temporary storage must not overlap the active application storage root')
    error.code = 'QA_TEMP_ROOT_OVERLAPS_ACTIVE_STORAGE'
    throw error
  }
  return resolved
}

export function resolveQaTemporaryParent(options = {}, context = {}) {
  const profile = options.profile || 'isolated'
  if (profile === 'production-like') {
    return validateQaTemporaryParent(options.temporaryParent, context)
  }
  if (options.temporaryParent) return validateQaTemporaryParent(options.temporaryParent, context)
  return path.resolve(context.systemTemporaryRoot || os.tmpdir())
}

export function parseQaConcurrencyArgs(argv = [], env = process.env) {
  const qualification = booleanOption(argv, 'qualification', env.PHD_ATLAS_QA_QUALIFICATION)
  const requestedEnduranceScenarios = parseEnduranceScenarios(argv, env)
  const enduranceEnabled = booleanOption(
    argv,
    'endurance',
    env.PHD_ATLAS_QA_ENDURANCE,
  ) || requestedEnduranceScenarios.length > 0
  const profile = String(
    stringOption(argv, 'profile') ?? env.PHD_ATLAS_QA_PROFILE ?? 'isolated',
  ).toLocaleLowerCase()
  if (!['isolated', 'production-like'].includes(profile)) {
    const error = new Error(`Unsupported QA concurrency profile: ${profile}`)
    error.code = 'QA_PROFILE_INVALID'
    throw error
  }
  const requestedVirtualUsers = boundedInteger(
    numericOption(argv, 'vus') ?? env.PHD_ATLAS_QA_VUS,
    DEFAULTS.virtualUsers,
    2,
    500,
  )
  const virtualUsers = qualification
    ? Math.max(QUALIFICATION_MINIMUMS.virtualUsers, requestedVirtualUsers)
    : requestedVirtualUsers
  const boundedThreshold = (optionName, environmentValue, fallback, maximum) => {
    const parsed = boundedInteger(
      numericOption(argv, optionName) ?? environmentValue,
      fallback,
      1,
      maximum,
    )
    // Qualification thresholds may be tightened by callers, never relaxed.
    return qualification ? Math.min(parsed, fallback) : parsed
  }
  const parsed = {
    profile,
    qualification,
    enduranceEnabled,
    enduranceScenarios: enduranceEnabled && requestedEnduranceScenarios.length === 0
      ? [...ENDURANCE_SCENARIOS]
      : requestedEnduranceScenarios,
    enduranceDurationMs: boundedInteger(
      numericOption(argv, 'endurance-duration-ms') ?? env.PHD_ATLAS_QA_ENDURANCE_DURATION_MS,
      DEFAULTS.enduranceDurationMs,
      5_000,
      60 * 60_000,
    ),
    enduranceConnectionsDurationMs: boundedInteger(
      numericOption(argv, 'endurance-connections-duration-ms')
        ?? env.PHD_ATLAS_QA_ENDURANCE_CONNECTIONS_DURATION_MS,
      DEFAULTS.enduranceConnectionsDurationMs,
      5_000,
      60 * 60_000,
    ),
    enduranceAutosaveUsers: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.enduranceAutosaveUsers, boundedInteger(
          numericOption(argv, 'endurance-autosave-users')
            ?? env.PHD_ATLAS_QA_ENDURANCE_AUTOSAVE_USERS,
          Math.min(DEFAULTS.enduranceAutosaveUsers, virtualUsers),
          1,
          virtualUsers,
        ))
      : boundedInteger(
          numericOption(argv, 'endurance-autosave-users')
            ?? env.PHD_ATLAS_QA_ENDURANCE_AUTOSAVE_USERS,
          Math.min(DEFAULTS.enduranceAutosaveUsers, virtualUsers),
          1,
          virtualUsers,
        ),
    enduranceSseClients: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.enduranceSseClients, boundedInteger(
          numericOption(argv, 'endurance-sse-clients')
            ?? env.PHD_ATLAS_QA_ENDURANCE_SSE_CLIENTS,
          DEFAULTS.enduranceSseClients,
          1,
          500,
        ))
      : boundedInteger(
          numericOption(argv, 'endurance-sse-clients')
            ?? env.PHD_ATLAS_QA_ENDURANCE_SSE_CLIENTS,
          DEFAULTS.enduranceSseClients,
          1,
          500,
        ),
    enduranceWebSockets: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.enduranceWebSockets, boundedInteger(
          numericOption(argv, 'endurance-websockets')
            ?? env.PHD_ATLAS_QA_ENDURANCE_WEBSOCKETS,
          DEFAULTS.enduranceWebSockets,
          1,
          500,
        ))
      : boundedInteger(
          numericOption(argv, 'endurance-websockets')
            ?? env.PHD_ATLAS_QA_ENDURANCE_WEBSOCKETS,
          DEFAULTS.enduranceWebSockets,
          1,
          500,
        ),
    enduranceRssSamples: boundedInteger(
      numericOption(argv, 'endurance-rss-samples') ?? env.PHD_ATLAS_QA_ENDURANCE_RSS_SAMPLES,
      DEFAULTS.enduranceRssSamples,
      3,
      120,
    ),
    enduranceReadIntervalMs: boundedInteger(
      numericOption(argv, 'endurance-read-interval-ms')
        ?? env.PHD_ATLAS_QA_ENDURANCE_READ_INTERVAL_MS,
      DEFAULTS.enduranceReadIntervalMs,
      1_000,
      60_000,
    ),
    enduranceAutosaveIntervalMinMs: boundedInteger(
      numericOption(argv, 'endurance-autosave-interval-min-ms')
        ?? env.PHD_ATLAS_QA_ENDURANCE_AUTOSAVE_INTERVAL_MIN_MS,
      DEFAULTS.enduranceAutosaveIntervalMinMs,
      500,
      30_000,
    ),
    enduranceAutosaveIntervalMaxMs: boundedInteger(
      numericOption(argv, 'endurance-autosave-interval-max-ms')
        ?? env.PHD_ATLAS_QA_ENDURANCE_AUTOSAVE_INTERVAL_MAX_MS,
      DEFAULTS.enduranceAutosaveIntervalMaxMs,
      500,
      60_000,
    ),
    enduranceBackgroundIntervalMinMs: boundedInteger(
      numericOption(argv, 'endurance-background-interval-min-ms')
        ?? env.PHD_ATLAS_QA_ENDURANCE_BACKGROUND_INTERVAL_MIN_MS,
      DEFAULTS.enduranceBackgroundIntervalMinMs,
      500,
      30_000,
    ),
    enduranceBackgroundIntervalMaxMs: boundedInteger(
      numericOption(argv, 'endurance-background-interval-max-ms')
        ?? env.PHD_ATLAS_QA_ENDURANCE_BACKGROUND_INTERVAL_MAX_MS,
      DEFAULTS.enduranceBackgroundIntervalMaxMs,
      500,
      60_000,
    ),
    temporaryParent: stringOption(argv, 'temp-root')
      ?? stringOption(argv, 'storage-root')
      ?? env.PHD_ATLAS_QA_TEMP_ROOT,
    virtualUsers,
    healthIterations: boundedInteger(
      numericOption(argv, 'health-iterations') ?? env.PHD_ATLAS_QA_HEALTH_ITERATIONS,
      DEFAULTS.healthIterations,
      1,
      20,
    ),
    sseBatchSize: boundedInteger(
      numericOption(argv, 'sse-batch') ?? env.PHD_ATLAS_QA_SSE_BATCH,
      DEFAULTS.sseBatchSize,
      1,
      virtualUsers,
    ),
    writeUsers: boundedInteger(
      numericOption(argv, 'write-users') ?? env.PHD_ATLAS_QA_WRITE_USERS,
      Math.min(DEFAULTS.writeUsers, virtualUsers),
      1,
      virtualUsers,
    ),
    loginUsers: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.loginUsers, boundedInteger(
          numericOption(argv, 'login-users') ?? env.PHD_ATLAS_QA_LOGIN_USERS,
          Math.min(DEFAULTS.loginUsers, virtualUsers),
          1,
          virtualUsers,
        ))
      : boundedInteger(
          numericOption(argv, 'login-users') ?? env.PHD_ATLAS_QA_LOGIN_USERS,
          Math.min(DEFAULTS.loginUsers, virtualUsers),
          1,
          virtualUsers,
        ),
    sseObservers: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.sseObservers, virtualUsers - 1)
      : boundedInteger(
          numericOption(argv, 'sse-observers') ?? env.PHD_ATLAS_QA_SSE_OBSERVERS,
          Math.min(DEFAULTS.sseObservers, Math.max(1, virtualUsers - 1)),
          1,
          Math.max(1, virtualUsers - 1),
        ),
    webSockets: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.webSockets, boundedInteger(
          numericOption(argv, 'websockets') ?? env.PHD_ATLAS_QA_WEBSOCKETS,
          DEFAULTS.webSockets,
          1,
          500,
        ))
      : boundedInteger(
          numericOption(argv, 'websockets') ?? env.PHD_ATLAS_QA_WEBSOCKETS,
          DEFAULTS.webSockets,
          1,
          500,
        ),
    overloadWrites: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.overloadWrites, boundedInteger(
          numericOption(argv, 'overload-writes') ?? env.PHD_ATLAS_QA_OVERLOAD_WRITES,
          Math.min(DEFAULTS.overloadWrites, virtualUsers),
          0,
          virtualUsers,
        ))
      : boundedInteger(
          numericOption(argv, 'overload-writes') ?? env.PHD_ATLAS_QA_OVERLOAD_WRITES,
          Math.min(DEFAULTS.overloadWrites, virtualUsers),
          0,
          virtualUsers,
        ),
    overloadRetries: qualification
      ? Math.max(QUALIFICATION_MINIMUMS.overloadRetries, boundedInteger(
          numericOption(argv, 'overload-retries') ?? env.PHD_ATLAS_QA_OVERLOAD_RETRIES,
          DEFAULTS.overloadRetries,
          0,
          32,
        ))
      : boundedInteger(
          numericOption(argv, 'overload-retries') ?? env.PHD_ATLAS_QA_OVERLOAD_RETRIES,
          DEFAULTS.overloadRetries,
          0,
          32,
        ),
    loginRetryBudgetMs: qualification
      ? QUALIFICATION_MINIMUMS.loginRetryBudgetMs
      : boundedInteger(
          numericOption(argv, 'login-retry-budget-ms') ?? env.PHD_ATLAS_QA_LOGIN_RETRY_BUDGET_MS,
          DEFAULTS.loginRetryBudgetMs,
          1_000,
          120_000,
        ),
    requestTimeoutMs: qualification
      ? Math.min(DEFAULTS.requestTimeoutMs, boundedInteger(
          numericOption(argv, 'request-timeout-ms') ?? env.PHD_ATLAS_QA_REQUEST_TIMEOUT_MS,
          DEFAULTS.requestTimeoutMs,
          1_000,
          120_000,
        ))
      : boundedInteger(
          numericOption(argv, 'request-timeout-ms') ?? env.PHD_ATLAS_QA_REQUEST_TIMEOUT_MS,
          DEFAULTS.requestTimeoutMs,
          1_000,
          120_000,
        ),
    sseIsolationWindowMs: qualification
      ? Math.max(DEFAULTS.sseIsolationWindowMs, boundedInteger(
          numericOption(argv, 'sse-isolation-window-ms') ?? env.PHD_ATLAS_QA_SSE_ISOLATION_WINDOW_MS,
          DEFAULTS.sseIsolationWindowMs,
          250,
          30_000,
        ))
      : boundedInteger(
          numericOption(argv, 'sse-isolation-window-ms') ?? env.PHD_ATLAS_QA_SSE_ISOLATION_WINDOW_MS,
          DEFAULTS.sseIsolationWindowMs,
          250,
          30_000,
        ),
    overallTimeoutMs: boundedInteger(
      numericOption(argv, 'overall-timeout-ms') ?? env.PHD_ATLAS_QA_OVERALL_TIMEOUT_MS,
      DEFAULT_DEADLINES.overallTimeoutMs,
      10_000,
      60 * 60_000,
    ),
    phaseTimeoutMs: boundedInteger(
      numericOption(argv, 'phase-timeout-ms') ?? env.PHD_ATLAS_QA_PHASE_TIMEOUT_MS,
      DEFAULT_DEADLINES.phaseTimeoutMs,
      5_000,
      30 * 60_000,
    ),
    cleanupTimeoutMs: qualification
      ? Math.max(DEFAULT_DEADLINES.cleanupTimeoutMs, boundedInteger(
          numericOption(argv, 'cleanup-timeout-ms') ?? env.PHD_ATLAS_QA_CLEANUP_TIMEOUT_MS,
          DEFAULT_DEADLINES.cleanupTimeoutMs,
          1_000,
          5 * 60_000,
        ))
      : boundedInteger(
          numericOption(argv, 'cleanup-timeout-ms') ?? env.PHD_ATLAS_QA_CLEANUP_TIMEOUT_MS,
          DEFAULT_DEADLINES.cleanupTimeoutMs,
          1_000,
          5 * 60_000,
        ),
    progressIntervalMs: boundedInteger(
      numericOption(argv, 'progress-interval-ms') ?? env.PHD_ATLAS_QA_PROGRESS_INTERVAL_MS,
      DEFAULT_DEADLINES.progressIntervalMs,
      1_000,
      60_000,
    ),
    thresholds: {
      healthP95Ms: boundedThreshold('max-health-p95-ms', env.PHD_ATLAS_QA_MAX_HEALTH_P95_MS, DEFAULT_THRESHOLDS.healthP95Ms, 120_000),
      readP95Ms: boundedThreshold('max-read-p95-ms', env.PHD_ATLAS_QA_MAX_READ_P95_MS, DEFAULT_THRESHOLDS.readP95Ms, 120_000),
      writeP95Ms: boundedThreshold('max-write-p95-ms', env.PHD_ATLAS_QA_MAX_WRITE_P95_MS, DEFAULT_THRESHOLDS.writeP95Ms, 120_000),
      loginP95Ms: boundedThreshold('max-login-p95-ms', env.PHD_ATLAS_QA_MAX_LOGIN_P95_MS, DEFAULT_THRESHOLDS.loginP95Ms, 180_000),
      overloadP95Ms: boundedThreshold('max-overload-p95-ms', env.PHD_ATLAS_QA_MAX_OVERLOAD_P95_MS, DEFAULT_THRESHOLDS.overloadP95Ms, 180_000),
      mixedP95Ms: boundedThreshold('max-mixed-p95-ms', env.PHD_ATLAS_QA_MAX_MIXED_P95_MS, DEFAULT_THRESHOLDS.mixedP95Ms, 180_000),
      eventLoopP99Ms: boundedThreshold('max-event-loop-p99-ms', env.PHD_ATLAS_QA_MAX_EVENT_LOOP_P99_MS, DEFAULT_THRESHOLDS.eventLoopP99Ms, 120_000),
      enduranceRssSlopeKbPerMinute: boundedThreshold(
        'max-endurance-rss-slope-kb-per-minute',
        env.PHD_ATLAS_QA_MAX_ENDURANCE_RSS_SLOPE_KB_PER_MINUTE,
        DEFAULT_THRESHOLDS.enduranceRssSlopeKbPerMinute,
        60 * 60_000,
      ),
      enduranceP95DegradationMs: boundedThreshold(
        'max-endurance-p95-degradation-ms',
        env.PHD_ATLAS_QA_MAX_ENDURANCE_P95_DEGRADATION_MS,
        DEFAULT_THRESHOLDS.enduranceP95DegradationMs,
        60_000,
      ),
    },
  }
  parsed.enduranceAutosaveIntervalMaxMs = Math.max(
    parsed.enduranceAutosaveIntervalMaxMs,
    parsed.enduranceAutosaveIntervalMinMs,
  )
  parsed.enduranceBackgroundIntervalMaxMs = Math.max(
    parsed.enduranceBackgroundIntervalMaxMs,
    parsed.enduranceBackgroundIntervalMinMs,
  )
  if (parsed.enduranceEnabled) {
    const enduranceWorkMs = Math.max(
      parsed.enduranceDurationMs,
      parsed.enduranceConnectionsDurationMs,
    )
    parsed.phaseTimeoutMs = Math.min(
      30 * 60_000,
      Math.max(
        parsed.phaseTimeoutMs,
        enduranceWorkMs + 2 * 60_000,
      ),
    )
    parsed.overallTimeoutMs = Math.min(
      60 * 60_000,
      Math.max(
        parsed.overallTimeoutMs,
        parsed.enduranceDurationMs + parsed.enduranceConnectionsDurationMs + 10 * 60_000,
      ),
    )
  }
  return parsed
}

export function normalizeQaQualificationOptions(options) {
  if (options?.qualification !== true) return options
  const virtualUsers = Math.max(QUALIFICATION_MINIMUMS.virtualUsers, Number(options.virtualUsers) || 0)
  return {
    ...options,
    virtualUsers,
    loginUsers: Math.min(
      virtualUsers,
      Math.max(QUALIFICATION_MINIMUMS.loginUsers, Number(options.loginUsers) || 0),
    ),
    sseObservers: Math.min(
      virtualUsers - 1,
      Math.max(QUALIFICATION_MINIMUMS.sseObservers, Number(options.sseObservers) || 0),
    ),
    webSockets: Math.max(QUALIFICATION_MINIMUMS.webSockets, Number(options.webSockets) || 0),
    overloadWrites: Math.min(
      virtualUsers,
      Math.max(QUALIFICATION_MINIMUMS.overloadWrites, Number(options.overloadWrites) || 0),
    ),
    overloadRetries: Math.max(
      QUALIFICATION_MINIMUMS.overloadRetries,
      Math.min(32, Number(options.overloadRetries) || 0),
    ),
    enduranceAutosaveUsers: Math.min(
      virtualUsers,
      Math.max(
        QUALIFICATION_MINIMUMS.enduranceAutosaveUsers,
        Number(options.enduranceAutosaveUsers) || 0,
      ),
    ),
    enduranceSseClients: Math.max(
      QUALIFICATION_MINIMUMS.enduranceSseClients,
      Number(options.enduranceSseClients) || 0,
    ),
    enduranceWebSockets: Math.max(
      QUALIFICATION_MINIMUMS.enduranceWebSockets,
      Number(options.enduranceWebSockets) || 0,
    ),
    loginRetryBudgetMs: QUALIFICATION_MINIMUMS.loginRetryBudgetMs,
    cleanupTimeoutMs: Math.max(
      DEFAULT_DEADLINES.cleanupTimeoutMs,
      Number(options.cleanupTimeoutMs) || 0,
    ),
    requestTimeoutMs: Math.min(DEFAULTS.requestTimeoutMs, Number(options.requestTimeoutMs) || DEFAULTS.requestTimeoutMs),
    sseIsolationWindowMs: Math.max(
      DEFAULTS.sseIsolationWindowMs,
      Number(options.sseIsolationWindowMs) || DEFAULTS.sseIsolationWindowMs,
    ),
    thresholds: Object.fromEntries(Object.entries({
      ...DEFAULT_THRESHOLDS,
      ...(options.thresholds ?? {}),
    }).map(([name, value]) => [
      name,
      Math.min(Number(value) || DEFAULT_THRESHOLDS[name], DEFAULT_THRESHOLDS[name]),
    ])),
  }
}

export function qaQualificationProfileMet(report) {
  if (report.profile?.qualification !== true) return true
  return report.profile?.apiWorkerProcessIsolated === true
    && report.profile?.runtimeMetricsOwner === 'api-worker'
    && report.runtime?.owner === 'api-worker'
    && Number(report.runtime?.processId ?? 0) === Number(report.phases?.processIsolation?.apiProcessId ?? -1)
    && report.phases?.processIsolation?.distinctProcesses === true
    && Number(report.profile?.virtualUsers ?? 0) >= QUALIFICATION_MINIMUMS.virtualUsers
    && Number(report.profile?.loginUsers ?? 0) >= QUALIFICATION_MINIMUMS.loginUsers
    && Number(report.profile?.sseObservers ?? 0) >= QUALIFICATION_MINIMUMS.sseObservers
    && Number(report.profile?.overloadRetries ?? 0) >= QUALIFICATION_MINIMUMS.overloadRetries
    && Number(report.phases?.concurrentLogin?.attempted ?? 0) >= QUALIFICATION_MINIMUMS.loginUsers
    && Number(report.phases?.sseConnections?.connected ?? 0) >= QUALIFICATION_MINIMUMS.sseConnections
    && Number(report.phases?.sseAccountScope?.observers ?? 0) >= QUALIFICATION_MINIMUMS.sseObservers
    && Number(report.phases?.healthWebSocketSameIp?.ready ?? 0) >= QUALIFICATION_MINIMUMS.webSockets
    && Number(report.phases?.bodyAdmissionBackpressure?.configuredActive ?? 0)
      === QUALIFICATION_MINIMUMS.bodyAdmissionActive
    && Number(report.phases?.bodyAdmissionBackpressure?.configuredQueued ?? 0)
      === QUALIFICATION_MINIMUMS.bodyAdmissionQueued
    && Number(report.phases?.bodyAdmissionBackpressure?.holders ?? 0)
      === QUALIFICATION_MINIMUMS.bodyAdmissionHolders
    && Number(report.phases?.bodyAdmissionBackpressure?.saturated?.active ?? 0)
      === QUALIFICATION_MINIMUMS.bodyAdmissionActive
    && Number(report.phases?.bodyAdmissionBackpressure?.saturated?.waiting ?? 0)
      === QUALIFICATION_MINIMUMS.bodyAdmissionQueued
    && Number(report.phases?.bodyAdmissionBackpressure?.rejectionCounterDelta ?? 0) === 1
    && Number(report.phases?.bodyAdmissionBackpressure?.perKeyRejectionCounterDelta ?? -1) === 0
    && report.phases?.bodyAdmissionBackpressure?.retryAfter === '1'
    && Number(report.phases?.bodyAdmissionBackpressure?.retryAfterMs ?? 0) === 1_000
    && Number(report.phases?.bodyAdmissionBackpressure?.released?.active ?? -1) === 0
    && Number(report.phases?.bodyAdmissionBackpressure?.released?.waiting ?? -1) === 0
    && Number(report.phases?.bodyAdmissionBackpressure?.released?.activeKeys ?? -1) === 0
    && Number(report.phases?.bodyAdmissionBackpressure?.released?.queuedKeys ?? -1) === 0
    && Number(report.phases?.bodyAdmissionBackpressure?.structuredServerBusy ?? 0) >= 1
    && Number(report.phases?.bodyAdmissionBackpressure?.successfulRetries ?? 0) >= 1
    && Number(report.phases?.bodyAdmissionBackpressure?.durableReadbacks ?? 0) >= 1
    && Number(report.phases?.overloadWrites?.attempted ?? 0) >= QUALIFICATION_MINIMUMS.overloadWrites
    && Number(report.phases?.mixedWorkload?.attempted ?? 0) >= QUALIFICATION_MINIMUMS.mixedUsers
    && Number(report.phases?.mixedWorkload?.writes ?? 0) >= QUALIFICATION_MINIMUMS.mixedWrites
    && Number(report.phases?.mixedWorkload?.logins ?? 0) >= QUALIFICATION_MINIMUMS.mixedLogins
    && Number(report.phases?.mixedWorkload?.freshLoginPrincipals ?? 0)
      >= QUALIFICATION_MINIMUMS.mixedLogins
    && Number(report.phases?.mixedWorkload?.reads ?? 0) >= QUALIFICATION_MINIMUMS.mixedReads
    && Number(report.phases?.mixedWorkload?.streamReads ?? 0) >= QUALIFICATION_MINIMUMS.mixedReads
    && Number(report.phases?.mixedWorkload?.completedStreamReads ?? 0) >= QUALIFICATION_MINIMUMS.mixedReads
    && Number(report.phases?.mixedWorkload?.isolatedStreamApplications ?? 0)
      >= QUALIFICATION_MINIMUMS.mixedReads
    && report.phases?.mixedWorkload?.streamRoute === '/api/workspace/bootstrap/stream'
    && Number(report.phases?.durabilityRestart?.attempted ?? 0) >= QUALIFICATION_MINIMUMS.durabilityReadbacks
    && report.phases?.durabilityRestart?.freshProcess === true
    && Number(report.phases?.durabilityRestart?.initialProcessId ?? 0)
      !== Number(report.phases?.durabilityRestart?.restartProcessId ?? 0)
    && Number(report.phases?.finalHealth?.workerDiagnostics?.memoryReservations?.reservedBytes ?? -1) === 0
    && Number(report.phases?.finalHealth?.workerDiagnostics?.memoryReservations?.activeReservations ?? -1) === 0
}

export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}

function rounded(value) {
  return Number(Number(value || 0).toFixed(1))
}

export function summarizeLatencies(values) {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 }
  }
  return {
    count: finite.length,
    minMs: rounded(Math.min(...finite)),
    p50Ms: rounded(percentile(finite, 0.5)),
    p95Ms: rounded(percentile(finite, 0.95)),
    p99Ms: rounded(percentile(finite, 0.99)),
    maxMs: rounded(Math.max(...finite)),
  }
}

export function assessSameEntityConflict({
  programStatus,
  tagStatus,
  programPreserved,
  tagPreserved,
}) {
  const programAccepted = programStatus >= 200 && programStatus < 300
  const tagAccepted = tagStatus >= 200 && tagStatus < 300
  const merged = programAccepted && tagAccepted && programPreserved && tagPreserved
  const explicitConflict = [programStatus, tagStatus].includes(409)
    && [programStatus, tagStatus].some((status) => status >= 200 && status < 300)
  const lostAcceptedFields = []
  if (programAccepted && !programPreserved) lostAcceptedFields.push('program')
  if (tagAccepted && !tagPreserved) lostAcceptedFields.push('tags')
  return {
    merged,
    explicitConflict,
    programAccepted,
    tagAccepted,
    lostAcceptedFields,
    silentLostUpdate: programAccepted && tagAccepted && !(programPreserved && tagPreserved),
    conflictSafe: merged || explicitConflict,
    acceptedWritesReadable: lostAcceptedFields.length === 0,
  }
}

function successfulHttpStatus(status) {
  return status >= 200 && status < 300
}

function sameStringSet(left = [], right = []) {
  const normalizedLeft = [...new Set(left.map(String))].sort()
  const normalizedRight = [...new Set(right.map(String))].sort()
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index])
}

const QA_APPLICATION_IGNORED_TOP_LEVEL_FIELDS = Object.freeze(new Set([
  // Identity/version lifecycle is owned by the server. Account ownership is
  // deliberately retained and compared because it is part of isolation.
  'createdAt',
  'updatedAt',
  'teamTransferRequest',
  // These controls are normalized/clamped against the current account and
  // system policy; their dedicated workflows have separate persistence tests.
  'backupSettings',
]))

function qaApplicationPersistenceProjection(application) {
  if (!application || typeof application !== 'object' || Array.isArray(application)) return application
  const projection = structuredClone(application)
  for (const field of QA_APPLICATION_IGNORED_TOP_LEVEL_FIELDS) delete projection[field]
  return projection
}

function qaPersistedSubsetMatches(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => qaPersistedSubsetMatches(actual[index], value))
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
    return Object.entries(expected).every(([key, value]) => (
      Object.hasOwn(actual, key) && qaPersistedSubsetMatches(actual[key], value)
    ))
  }
  return isDeepStrictEqual(actual, expected)
}

function qaApplicationMatchesExpected(actual, expected) {
  return qaPersistedSubsetMatches(
    qaApplicationPersistenceProjection(actual),
    qaApplicationPersistenceProjection(expected),
  )
}

/**
 * A successful mutation outcome in this harness is not a generic HTTP 2xx: the
 * caller's acceptance predicate has already required the server's verified
 * durable application acknowledgement. Advance the fresh-worker oracle from
 * that acknowledgement boundary, even when the immediately following GET is
 * temporarily unavailable. Otherwise a later restart can return the newer,
 * correctly persisted application and be compared with a stale pre-write
 * expectation, falsely reporting data loss. Return the next authoritative
 * write baseline with the server-owned updatedAt from that exact ACK so a
 * temporarily unavailable readback cannot make the next phase submit a stale
 * optimistic-concurrency token.
 */
export function advanceQaDurableApplicationExpectation({
  acknowledged,
  acknowledgement,
  applicationId,
  desiredApplication,
  expectedPrograms,
  expectedTags,
  expectedApplications,
}) {
  if (!acknowledged) return null
  const normalizedApplicationId = String(applicationId ?? '').trim()
  if (!normalizedApplicationId || !desiredApplication || typeof desiredApplication !== 'object') {
    throw new TypeError('A durable application expectation requires an application id and submitted application.')
  }
  const acknowledgedApplicationId = String(acknowledgement?.id ?? '').trim()
  const acknowledgedUpdatedAt = typeof acknowledgement?.updatedAt === 'string'
    ? acknowledgement.updatedAt.trim()
    : ''
  if (
    acknowledgedApplicationId !== normalizedApplicationId
    || !acknowledgedUpdatedAt
  ) {
    throw new TypeError('A durable application expectation requires the matching authoritative acknowledgement version.')
  }
  const authoritativeApplication = {
    ...structuredClone(desiredApplication),
    updatedAt: acknowledgedUpdatedAt,
  }
  expectedPrograms.set(normalizedApplicationId, authoritativeApplication.program)
  expectedTags.set(normalizedApplicationId, [...(authoritativeApplication.tags ?? [])])
  expectedApplications.set(normalizedApplicationId, structuredClone(authoritativeApplication))
  return authoritativeApplication
}

/**
 * Keep online readability separate from durability evidence. A structured 503
 * still fails the mixed availability phase, but it cannot prove that an
 * acknowledged write vanished; only a successful 200 read exposing different
 * application data is evidence of a missing accepted write.
 */
export function assessQaAcknowledgedApplicationReadback({
  acknowledged,
  readbackOutcome,
  readback,
  applicationId,
  desiredApplication,
}) {
  const responseMatches = readback?.status === 200
    && readback?.payload?.data?.id === applicationId
    && qaApplicationMatchesExpected(readback.payload.data, desiredApplication)
  return {
    acknowledged: acknowledged === true,
    readable: acknowledged === true
      && readbackOutcome === 'success'
      && responseMatches,
    dataLossProven: acknowledged === true
      && readback?.status === 200
      && !responseMatches,
  }
}

export function qaApplicationMutationAcknowledged(response, applicationId) {
  const acknowledgement = response?.payload?.data
  const digest = /^[A-Za-z0-9_-]{43}$/u
  return successfulHttpStatus(response?.status)
    && acknowledgement?.protocol === APPLICATION_MUTATION_ACK_PROTOCOL
    && acknowledgement?.id === applicationId
    && acknowledgement?.durable === true
    && typeof acknowledgement?.updatedAt === 'string'
    && acknowledgement.updatedAt.length > 0
    && Number.isSafeInteger(acknowledgement?.projectionVersion)
    && acknowledgement.projectionVersion > 0
    && Number.isSafeInteger(acknowledgement?.authorityProjectionVersion)
    && acknowledgement.authorityProjectionVersion > 0
    && Number.isSafeInteger(acknowledgement?.operationCount)
    && acknowledgement.operationCount >= 0
    && typeof acknowledgement?.authorityPurpose === 'string'
    && Array.isArray(acknowledgement?.patch)
    && digest.test(acknowledgement?.mutationHash ?? '')
    && digest.test(acknowledgement?.baselineHash ?? '')
    && digest.test(acknowledgement?.applicationHash ?? '')
    && digest.test(acknowledgement?.authorityHash ?? '')
    && digest.test(acknowledgement?.canonicalHash ?? '')
}

export function qaApplicationShapeDifferencePaths(actual, expected, limit = 20) {
  const differences = []
  const visit = (actualValue, expectedValue, pathPrefix) => {
    if (differences.length >= limit) return
    if (Array.isArray(actualValue) || Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue) || !Array.isArray(expectedValue)) {
        differences.push(pathPrefix || '$')
        return
      }
      if (actualValue.length !== expectedValue.length) {
        differences.push(`${pathPrefix || '$'}.length`)
      }
      for (let index = 0; index < Math.min(actualValue.length, expectedValue.length); index += 1) {
        visit(actualValue[index], expectedValue[index], `${pathPrefix}[${index}]`)
      }
      return
    }
    const actualObject = actualValue && typeof actualValue === 'object'
    const expectedObject = expectedValue && typeof expectedValue === 'object'
    if (actualObject || expectedObject) {
      if (!actualObject || !expectedObject) {
        differences.push(pathPrefix || '$')
        return
      }
      const keys = new Set([...Object.keys(actualValue), ...Object.keys(expectedValue)])
      for (const key of [...keys].sort()) {
        if (differences.length >= limit) return
        const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key
        if (!Object.hasOwn(actualValue, key) || !Object.hasOwn(expectedValue, key)) {
          differences.push(nextPath)
        } else {
          visit(actualValue[key], expectedValue[key], nextPath)
        }
      }
      return
    }
    if (!isDeepStrictEqual(actualValue, expectedValue)) differences.push(pathPrefix || '$')
  }
  visit(
    qaApplicationPersistenceProjection(actual),
    qaApplicationPersistenceProjection(expected),
    '',
  )
  return differences
}

export function assessQaDurableReadback({
  status,
  data,
  applicationId,
  expectedProgram,
  expectedTags,
  expectedApplication,
}) {
  const missingFields = []
  if (status !== 200 || data?.id !== applicationId) missingFields.push('record')
  if (data?.program !== expectedProgram) missingFields.push('program')
  if (!sameStringSet(data?.tags ?? [], expectedTags ?? [])) missingFields.push('tags')
  if (expectedApplication && !qaApplicationMatchesExpected(data, expectedApplication)) {
    missingFields.push('application')
  }
  return { applicationId, durable: missingFields.length === 0, missingFields }
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return 0
  const seconds = Number(normalized)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const deadline = Date.parse(normalized)
  return Number.isFinite(deadline) ? Math.max(0, deadline - now) : 0
}

export function overloadRetryDelayMs({ attempt, retryAfter, seed = 0 }) {
  const retryAfterMs = retryAfterMilliseconds(retryAfter)
  // Capacity rejections are expected to carry Retry-After. Cap the fallback
  // backoff so a large same-NAT cohort keeps making fairly distributed
  // progress inside the qualification latency budget instead of sleeping for
  // eight seconds in lockstep after the eighth attempt.
  const exponentialMs = Math.min(1_500, 250 * (2 ** Math.max(0, attempt - 1)))
  // A deterministic per-record jitter keeps the local probe repeatable while
  // still preventing every rejected request from returning on the same tick.
  const mixed = Math.imul((seed + 1) ^ (attempt * 0x45d9f3b), 0x27d4eb2d) >>> 0
  const jitterMs = mixed % 251
  return Math.max(retryAfterMs, exponentialMs) + jitterMs
}

function explicitRetryAfterMilliseconds(value) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined
}

function classifyStructuredCapacityResponse(result, { status, code }) {
  const payload = result?.payload
  const error = payload?.error
  const retryAfter = result?.headers?.retryAfter
  const retryAfterSeconds = Number(String(retryAfter ?? '').trim())
  const explicitRetryAfterMs = explicitRetryAfterMilliseconds(result?.headers?.retryAfterMs)
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
  const headerRequestId = typeof result?.headers?.requestId === 'string'
    ? result.headers.requestId.trim()
    : ''
  const memoryPressure = result?.headers?.memoryPressure
  const source = memoryPressure === undefined || memoryPressure === null || memoryPressure === ''
    ? 'admission-capacity'
    : ['soft', 'hard'].includes(String(memoryPressure).trim().toLowerCase())
      ? 'memory-pressure'
      : null
  const payloadKeys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).sort()
    : []
  const errorKeys = error && typeof error === 'object' && !Array.isArray(error)
    ? Object.keys(error).sort()
    : []
  const retryHeadersAgree = Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds > 0
    && Number.isSafeInteger(explicitRetryAfterMs)
    && explicitRetryAfterMs > 0
    && explicitRetryAfterMs <= retryAfterSeconds * 1_000
    && explicitRetryAfterMs > (retryAfterSeconds - 1) * 1_000

  if (
    result?.status !== status
    || payload?.ok !== false
    || error?.code !== code
    || typeof error?.message !== 'string'
    || !error.message.trim()
    || payloadKeys.join(',') !== 'error,ok,requestId'
    || errorKeys.join(',') !== 'code,message'
    || !requestId
    || !headerRequestId
    || headerRequestId !== requestId
    || !retryHeadersAgree
    || !source
  ) return null

  return {
    retryAfter: String(retryAfter),
    retryAfterMs: explicitRetryAfterMs,
    standardRetryAfterMs: retryAfterSeconds * 1_000,
    explicitRetryAfterMs,
    requestId,
    source,
  }
}

export function loginCapacityRetryDelayMs({ attempt, retryAfter, retryAfterMs, seed = 0 }) {
  const exponentialMs = Math.min(8_000, 500 * (2 ** Math.min(Math.max(0, attempt), 16)))
  const explicitMs = explicitRetryAfterMilliseconds(retryAfterMs)
  const headerMs = explicitMs ?? (retryAfter ? retryAfterMilliseconds(retryAfter) : undefined)
  const baseMs = headerMs === undefined ? exponentialMs : Math.max(exponentialMs, headerMs)
  const mixed = Math.imul((seed + 1) ^ ((attempt + 1) * 0x45d9f3b), 0x27d4eb2d) >>> 0
  const jitterRatio = (mixed % 1_001) / 10_000
  return Math.round(baseMs * (1 + jitterRatio))
}

export function classifyLoginResponse(result) {
  if (
    result?.status === 200
    && typeof result?.payload?.data?.token === 'string'
    && result.payload.data.token.length > 0
  ) {
    return { kind: 'success' }
  }
  const authCapacity = classifyStructuredCapacityResponse(result, {
    status: 429,
    code: 'AUTH_CAPACITY_EXCEEDED',
  })
  if (authCapacity) {
    return {
      kind: 'auth-capacity',
      ...authCapacity,
    }
  }
  const requestCapacity = classifyStructuredCapacityResponse(result, {
    status: 503,
    code: 'SERVER_BUSY',
  })
  if (requestCapacity) {
    return {
      kind: 'request-capacity',
      ...requestCapacity,
    }
  }
  return {
    kind: 'unexpected',
    status: result?.status ?? 0,
    errorCode: result?.payload?.error?.code,
  }
}

export function classifyOverloadWriteResponse(result) {
  if (successfulHttpStatus(result?.status)) return { kind: 'success' }
  const capacity = classifyStructuredCapacityResponse(result, {
    status: 503,
    code: 'SERVER_BUSY',
  })
  if (capacity) return { kind: 'server-busy', ...capacity }
  return {
    kind: 'unexpected',
    status: result?.status ?? 0,
    errorCode: result?.payload?.error?.code,
    retryAfter: result?.headers?.retryAfter,
  }
}

const STORE_WRITE_CONFLICT_CODES = new Set([
  'STORE_WRITE_CONFLICT',
  'APPLICATION_VERSION_CONFLICT',
  'APPLICATION_MUTATION_BASELINE_MISMATCH',
  'APPLICATION_DELTA_CANONICAL_MISMATCH',
  'APPLICATION_DURABILITY_UNVERIFIED',
])

export function isQaStoreWriteConflictResponse(result) {
  return STORE_WRITE_CONFLICT_CODES.has(result?.payload?.error?.code)
}

export function isQaServerUnavailableResponse(result) {
  const status = Number(result?.status ?? 0)
  const code = result?.payload?.error?.code
  return status === 502 || status === 503 || status === 504
    || code === 'SERVER_UNAVAILABLE'
    || code === 'SERVER_BUSY'
}

function qaHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Open an unsafe JSON request, but send only a prefix so the server must retain
 * its pre-parser body-admission slot until the caller explicitly releases it.
 * Transport failures resolve as status 0 so probe cleanup never creates an
 * unhandled rejection while sockets are deliberately destroyed.
 */
export function openQaPausedJsonRequest(url, {
  method = 'PUT',
  headers = {},
  body = '{}',
  prefixBytes = 1,
  signal,
} = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
  if (payload.byteLength < 2) {
    const error = new Error('A paused QA request body must contain at least two bytes')
    error.code = 'QA_BODY_ADMISSION_PROBE_BODY_TOO_SMALL'
    throw error
  }
  const prefixLength = Math.min(payload.byteLength - 1, Math.max(1, Number(prefixBytes) || 1))
  const started = performance.now()
  let clientRequest
  let abortListener
  let settled = false
  let settle
  const result = new Promise((resolve) => {
    settle = (value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abortListener)
      resolve(value)
    }
    clientRequest = nodeHttpRequest(url, {
      method,
      headers: {
        ...headers,
        connection: 'close',
        'content-type': headers['content-type'] ?? headers['Content-Type'] ?? 'application/json',
        'content-length': payload.byteLength,
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        let parsedBody = rawBody || null
        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : null
        } catch {
          // A non-JSON response remains observable and will fail classification.
        }
        settle({
          method,
          status: response.statusCode ?? 0,
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
          payload: parsedBody,
          headers: {
            retryAfter: qaHeaderValue(response.headers['retry-after']),
            retryAfterMs: qaHeaderValue(response.headers['x-phd-retry-after-ms']),
            requestId: qaHeaderValue(response.headers['x-request-id']),
            connection: qaHeaderValue(response.headers.connection),
            memoryPressure: qaHeaderValue(response.headers['x-phd-memory-pressure']),
          },
          ms: performance.now() - started,
        })
      })
    })
    clientRequest.once('error', (error) => settle({
      method,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: error?.code,
      headers: {},
      ms: performance.now() - started,
    }))
    clientRequest.once('socket', (socket) => socket.setNoDelay(true))
    abortListener = () => {
      const error = new Error('QA body-admission holder released')
      error.code = 'QA_BODY_ADMISSION_HOLDER_RELEASED'
      clientRequest.destroy(error)
    }
    signal?.addEventListener('abort', abortListener, { once: true })
    clientRequest.flushHeaders()
    clientRequest.write(payload.subarray(0, prefixLength))
    if (signal?.aborted) abortListener()
  })

  return {
    result,
    finish() {
      if (settled || clientRequest.destroyed || clientRequest.writableEnded) return
      clientRequest.end(payload.subarray(prefixLength))
    },
    abort() {
      if (settled || clientRequest.destroyed) return
      abortListener()
    },
  }
}

function compactQaAdmissionSnapshot(value = {}) {
  return Object.fromEntries([
    'active',
    'waiting',
    'queued',
    'maxActive',
    'maxQueued',
    'waitTimeoutMs',
    'maxActivePerKey',
    'maxQueuedPerKey',
    'activeKeys',
    'queuedKeys',
    'admitted',
    'rejected',
    'perKeyRejected',
    'timedOut',
    'cancelled',
    'maxObservedActive',
    'maxObservedQueued',
    'totalWaitMs',
  ].map((key) => [key, Number(value?.[key] ?? 0)]))
}

async function waitForQaAdmissionSnapshot({
  snapshot,
  predicate,
  timeoutMs,
  signal,
  wait,
  label,
}) {
  const started = performance.now()
  let current = compactQaAdmissionSnapshot(await snapshot())
  while (!predicate(current)) {
    signal?.throwIfAborted?.()
    if (performance.now() - started >= timeoutMs) {
      const error = new Error(`${label} timed out with admission state ${JSON.stringify(current)}`)
      error.code = 'QA_BODY_ADMISSION_STATE_TIMEOUT'
      error.timeoutMs = timeoutMs
      throw error
    }
    await wait(10, signal)
    current = compactQaAdmissionSnapshot(await snapshot())
  }
  return current
}

/**
 * Deterministically prove structured pre-parser backpressure without lowering
 * the server's configured capacity. Distinct signed principals fill every
 * global active and queued body slot with paused requests; one unused real
 * principal must then be rejected by that exact admission controller and
 * succeed after every holder is released.
 */
export async function probeQaRequestBodyBackpressure({
  baseUrl,
  pathname,
  holderTokens,
  probeToken,
  body,
  request,
  snapshot,
  signal,
  timeoutMs = 10_000,
  wait = sleep,
  openPausedRequest = openQaPausedJsonRequest,
  isRetryAccepted = (response) => successfulHttpStatus(response?.status),
  expectedMaxActive,
  expectedMaxQueued,
  seed = 0,
}) {
  if (typeof request !== 'function' || typeof snapshot !== 'function') {
    const error = new Error('The body-admission probe requires request and snapshot functions')
    error.code = 'QA_BODY_ADMISSION_PROBE_UNAVAILABLE'
    throw error
  }
  const targetUrl = `${String(baseUrl).replace(/\/$/u, '')}${pathname}`
  const requestBody = Buffer.isBuffer(body) ? body : String(body)
  const probeHeaders = authHeaders(probeToken, { 'content-type': 'application/json' })
  const before = await waitForQaAdmissionSnapshot({
    snapshot,
    predicate: (state) => state.active === 0 && state.waiting === 0,
    timeoutMs,
    signal,
    wait,
    label: 'body-admission baseline',
  })
  if (
    (expectedMaxActive !== undefined && before.maxActive !== expectedMaxActive)
    || (expectedMaxQueued !== undefined && before.maxQueued !== expectedMaxQueued)
  ) {
    const error = new Error(
      `Body-admission capacity is ${before.maxActive} active + ${before.maxQueued} queued; expected ${expectedMaxActive} + ${expectedMaxQueued}`,
    )
    error.code = 'QA_BODY_ADMISSION_CAPACITY_MISMATCH'
    throw error
  }
  const holderCount = before.maxActive + before.maxQueued
  if (!Number.isSafeInteger(holderCount) || holderCount < 2 || holderCount > 512) {
    const error = new Error(`Unsafe body-admission holder count ${holderCount}`)
    error.code = 'QA_BODY_ADMISSION_CAPACITY_INVALID'
    throw error
  }
  const normalizedHolderTokens = Array.isArray(holderTokens)
    ? holderTokens.slice(0, holderCount).map(String)
    : []
  const distinctCredentials = new Set([...normalizedHolderTokens, String(probeToken ?? '')])
  if (
    normalizedHolderTokens.length !== holderCount
    || normalizedHolderTokens.some((value) => !value)
    || !probeToken
    || distinctCredentials.size !== holderCount + 1
  ) {
    const error = new Error(`Global body-admission saturation requires ${holderCount} unique holder principals plus one unused probe principal`)
    error.code = 'QA_BODY_ADMISSION_PRINCIPALS_INSUFFICIENT'
    throw error
  }

  const holders = []
  let saturated
  let afterBusy
  let busyResponse
  let healthDuringSaturation
  let probeFailure
  try {
    for (let index = 0; index < before.maxActive; index += 1) {
      holders.push(openPausedRequest(targetUrl, {
        method: 'PUT',
        headers: {
          ...authHeaders(normalizedHolderTokens[index], { 'content-type': 'application/json' }),
          'x-phd-client-id': `qa-body-admission-holder-${index}`,
        },
        body: requestBody,
      }))
    }
    await waitForQaAdmissionSnapshot({
      snapshot,
      predicate: (state) => state.active === before.maxActive
        && state.waiting === 0
        && state.activeKeys === before.maxActive,
      timeoutMs,
      signal,
      wait,
      label: 'body-admission active saturation',
    })
    for (let index = before.maxActive; index < holderCount; index += 1) {
      holders.push(openPausedRequest(targetUrl, {
        method: 'PUT',
        headers: {
          ...authHeaders(normalizedHolderTokens[index], { 'content-type': 'application/json' }),
          'x-phd-client-id': `qa-body-admission-holder-${index}`,
        },
        body: requestBody,
      }))
    }
    saturated = await waitForQaAdmissionSnapshot({
      snapshot,
      predicate: (state) => state.active === before.maxActive
        && state.waiting === before.maxQueued
        && state.activeKeys === before.maxActive
        && state.queuedKeys === before.maxQueued,
      timeoutMs,
      signal,
      wait,
      label: 'body-admission global saturation',
    })
    if (
      saturated.rejected !== before.rejected
      || saturated.perKeyRejected !== before.perKeyRejected
      || saturated.timedOut !== before.timedOut
    ) {
      const error = new Error('Body-admission holders were rejected or timed out before global saturation')
      error.code = 'QA_BODY_ADMISSION_HOLDER_REJECTED'
      throw error
    }
    healthDuringSaturation = await request(
      `${String(baseUrl).replace(/\/$/u, '')}/api/health`,
      { headers: probeHeaders },
      { phase: 'bodyAdmissionBackpressure.healthDuring' },
    )
    if (healthDuringSaturation?.status !== 200 || healthDuringSaturation?.payload?.data?.status !== 'ok') {
      const error = new Error('Health endpoint stopped responding while body admission was saturated')
      error.code = 'QA_BODY_ADMISSION_HEALTH_DURING_FAILED'
      throw error
    }
    const busyAttempt = openPausedRequest(targetUrl, {
      method: 'PUT',
      headers: {
        ...probeHeaders,
        'x-phd-client-id': 'qa-body-admission-busy-attempt',
      },
      body: requestBody,
    })
    holders.push(busyAttempt)
    busyResponse = await runWithQaDeadline(
      'body-admission:structured-busy-response',
      timeoutMs,
      () => busyAttempt.result,
      { signal },
    )
    afterBusy = compactQaAdmissionSnapshot(await snapshot())
    const classification = classifyOverloadWriteResponse(busyResponse)
    const explicitRetryAfterMs = explicitRetryAfterMilliseconds(busyResponse?.headers?.retryAfterMs)
    if (
      classification.kind !== 'server-busy'
      || classification.retryAfter !== '1'
      || explicitRetryAfterMs !== 1_000
      || busyResponse?.payload?.ok !== false
      || typeof busyResponse?.payload?.requestId !== 'string'
      || !busyResponse.payload.requestId
      || busyResponse?.headers?.requestId !== busyResponse.payload.requestId
      || busyResponse?.headers?.connection !== 'close'
      || busyResponse?.headers?.memoryPressure
    ) {
      const error = new Error('Saturated request-body admission did not return structured SERVER_BUSY with Retry-After')
      error.code = 'QA_BODY_ADMISSION_BUSY_NOT_OBSERVED'
      throw error
    }
    if (
      afterBusy.rejected !== saturated.rejected + 1
      || afterBusy.perKeyRejected !== saturated.perKeyRejected
      || afterBusy.active !== saturated.active
      || afterBusy.waiting !== saturated.waiting
      || afterBusy.activeKeys !== saturated.activeKeys
      || afterBusy.queuedKeys !== saturated.queuedKeys
      || afterBusy.admitted !== saturated.admitted
      || afterBusy.timedOut !== saturated.timedOut
      || afterBusy.cancelled !== saturated.cancelled
      || afterBusy.maxActive !== saturated.maxActive
      || afterBusy.maxQueued !== saturated.maxQueued
      || afterBusy.maxActivePerKey !== saturated.maxActivePerKey
      || afterBusy.maxQueuedPerKey !== saturated.maxQueuedPerKey
    ) {
      const error = new Error('SERVER_BUSY was not attributed to the full global pre-parser request-body queue')
      error.code = 'QA_BODY_ADMISSION_REJECTION_NOT_PROVEN'
      throw error
    }
  } catch (error) {
    probeFailure = error
  } finally {
    for (const holder of holders) holder.abort()
    try {
      await runWithQaDeadline(
        'body-admission:release-client-holders',
        timeoutMs,
        () => Promise.allSettled(holders.map((holder) => holder.result)),
        { signal },
      )
    } catch (error) {
      probeFailure ||= error
    }
  }

  let released
  try {
    released = await waitForQaAdmissionSnapshot({
      snapshot,
      predicate: (state) => state.active === 0
        && state.waiting === 0
        && state.activeKeys === 0
        && state.queuedKeys === 0,
      timeoutMs,
      signal,
      wait,
      label: 'body-admission release',
    })
  } catch (error) {
    probeFailure ||= error
  }
  if (probeFailure) throw probeFailure
  if (released.timedOut !== before.timedOut) {
    const error = new Error('A paused body-admission holder timed out instead of being explicitly released')
    error.code = 'QA_BODY_ADMISSION_HOLDER_TIMEOUT'
    throw error
  }

  const busyClassification = classifyOverloadWriteResponse(busyResponse)
  const retryDelayMs = overloadRetryDelayMs({
    attempt: 1,
    retryAfter: busyClassification.retryAfter,
    seed,
  })
  await wait(retryDelayMs, signal)
  const retryResponse = await request(targetUrl, {
    method: 'PUT',
    headers: {
      ...probeHeaders,
      'x-phd-client-id': 'qa-body-admission-retry',
    },
    body: requestBody,
  }, { allowServerBusy: true, phase: 'bodyAdmissionBackpressure.retry' })
  if (!isRetryAccepted(retryResponse)) {
    const error = new Error('The request rejected by body admission did not succeed after capacity was released')
    error.code = 'QA_BODY_ADMISSION_RETRY_FAILED'
    throw error
  }
  const readbackResponse = await request(
    targetUrl,
    { headers: probeHeaders },
    { phase: 'bodyAdmissionBackpressure.readback' },
  )
  if (!isRetryAccepted(readbackResponse)) {
    const error = new Error('The recovered body-admission write was not durably readable')
    error.code = 'QA_BODY_ADMISSION_READBACK_FAILED'
    throw error
  }
  const healthResponse = await request(
    `${String(baseUrl).replace(/\/$/u, '')}/api/health`,
    { headers: probeHeaders },
    { phase: 'bodyAdmissionBackpressure.healthAfter' },
  )
  if (healthResponse?.status !== 200 || healthResponse?.payload?.data?.status !== 'ok') {
    const error = new Error('The server did not return to a healthy state after body-admission saturation')
    error.code = 'QA_BODY_ADMISSION_HEALTH_FAILED'
    throw error
  }
  const readinessResponse = await request(
    `${String(baseUrl).replace(/\/$/u, '')}/api/health/ready`,
    { headers: probeHeaders },
    { phase: 'bodyAdmissionBackpressure.readinessAfter' },
  )
  if (readinessResponse?.status !== 200 || readinessResponse?.payload?.data?.ready !== true) {
    const error = new Error('The server did not return to readiness after body-admission saturation')
    error.code = 'QA_BODY_ADMISSION_READINESS_FAILED'
    throw error
  }

  return {
    holderCount,
    retryDelayMs,
    before,
    saturated,
    afterBusy,
    released,
    healthDuringSaturation,
    busyResponse,
    retryResponse,
    readbackResponse,
    healthResponse,
    readinessResponse,
  }
}

function compactHttpResult(result) {
  return {
    phase: result.phase,
    method: result.method,
    status: result.status,
    ms: rounded(result.ms),
    responseBodyBytes: Number(result.responseBodyBytes ?? 0),
    transferBodyBytes: Number(result.transferBodyBytes ?? 0),
    error: result.error,
    parseError: result.parseError,
    errorCode: result.payload?.error?.code,
    requestId: result.headers?.requestId,
    retryAfter: result.headers?.retryAfter,
    retryAfterMs: result.headers?.retryAfterMs,
    memoryPressure: result.headers?.memoryPressure,
  }
}

function incrementQaCount(counts, value) {
  const key = String(value ?? '').trim()
  if (!key) return
  counts[key] = (counts[key] ?? 0) + 1
}

function sortedQaCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left.localeCompare(right)
  )))
}

export function summarizeQaRetriableCapacity(outcomes = []) {
  const normalized = Array.isArray(outcomes) ? outcomes : [outcomes]
  const sources = {}
  const statuses = {}
  const errorCodes = {}
  let attempts = 0
  let retries = 0
  let serverBusyResponses = 0
  for (const outcome of normalized) {
    if (!outcome || typeof outcome !== 'object') continue
    attempts += Math.max(0, Number(outcome.attempts) || 0)
    retries += Math.max(0, (Number(outcome.attempts) || 0) - 1)
    for (const entry of outcome.responses ?? []) {
      if (entry?.classification?.kind !== 'server-busy') continue
      serverBusyResponses += 1
      incrementQaCount(sources, entry.classification.source)
      incrementQaCount(statuses, entry.response?.status)
      incrementQaCount(errorCodes, entry.response?.payload?.error?.code)
    }
  }
  return {
    operations: normalized.filter((outcome) => outcome && typeof outcome === 'object').length,
    attempts,
    retries,
    serverBusyResponses,
    sources: sortedQaCounts(sources),
    statuses: sortedQaCounts(statuses),
    errorCodes: sortedQaCounts(errorCodes),
  }
}

export function mergeQaRetriableCapacitySummaries(summaries = []) {
  const merged = {
    operations: 0,
    attempts: 0,
    retries: 0,
    serverBusyResponses: 0,
    sources: {},
    statuses: {},
    errorCodes: {},
  }
  for (const summary of summaries) {
    if (!summary || typeof summary !== 'object') continue
    merged.operations += Math.max(0, Number(summary.operations) || 0)
    merged.attempts += Math.max(0, Number(summary.attempts) || 0)
    merged.retries += Math.max(0, Number(summary.retries) || 0)
    merged.serverBusyResponses += Math.max(0, Number(summary.serverBusyResponses) || 0)
    for (const field of ['sources', 'statuses', 'errorCodes']) {
      for (const [key, count] of Object.entries(summary[field] ?? {})) {
        const normalizedCount = Math.max(0, Number(count) || 0)
        if (normalizedCount > 0) merged[field][key] = (merged[field][key] ?? 0) + normalizedCount
      }
    }
  }
  merged.sources = sortedQaCounts(merged.sources)
  merged.statuses = sortedQaCounts(merged.statuses)
  merged.errorCodes = sortedQaCounts(merged.errorCodes)
  return merged
}

function qaRetriableOperationDiagnostic(outcome, notRunOutcome = 'not-run') {
  if (!outcome) {
    return {
      outcome: notRunOutcome,
      attempts: 0,
      finalClassification: null,
      finalResponse: null,
    }
  }
  const terminal = outcome.responses?.at(-1)
  return sanitizeQaDiagnostic({
    outcome: outcome.kind ?? 'unknown',
    attempts: Math.max(0, Number(outcome.attempts) || 0),
    finalClassification: terminal?.classification ?? null,
    finalResponse: compactHttpResult(terminal?.response ?? {}),
  })
}

function boundedQaFailureDiagnostics(failures, limit = QA_FAILURE_DIAGNOSTIC_LIMIT) {
  const safeLimit = Math.min(
    QA_FAILURE_DIAGNOSTIC_LIMIT,
    Math.max(0, Number.isSafeInteger(Number(limit)) ? Number(limit) : QA_FAILURE_DIAGNOSTIC_LIMIT),
  )
  return failures.slice(0, safeLimit).map((failure) => sanitizeQaDiagnostic(failure))
}

export function summarizeQaOverloadFailures(outcomes = [], limit = QA_FAILURE_DIAGNOSTIC_LIMIT) {
  const failures = outcomes.filter((outcome) => (
    outcome?.kind !== 'success' || outcome?.readbackOutcome?.kind !== 'success'
  )).map((outcome) => ({
    index: outcome?.index,
    applicationId: outcome?.applicationId,
    failureStage: outcome?.kind === 'success' ? 'readback' : 'write',
    write: qaRetriableOperationDiagnostic(outcome),
    readback: qaRetriableOperationDiagnostic(outcome?.readbackOutcome),
  }))
  return boundedQaFailureDiagnostics(failures, limit)
}

export function summarizeQaMixedFailures(results = [], limit = QA_FAILURE_DIAGNOSTIC_LIMIT) {
  const failures = results.filter((result) => !result?.ok).map((result) => ({
    index: result?.index,
    kind: result?.kind,
    outcome: result?.outcome,
    attempts: result?.attempts,
    failureStage: result?.failureStage,
    write: result?.writeDiagnostic,
    readback: result?.readbackDiagnostic,
    login: result?.loginDiagnostic,
    identity: result?.identityDiagnostic,
    stream: result?.streamDiagnostic,
    streamError: result?.streamError,
    finalClassification: result?.finalClassification,
    finalResponse: result?.finalResponse,
  }))
  return boundedQaFailureDiagnostics(failures, limit)
}

export function summarizeHttpTraffic(records = [], virtualUsers = 1) {
  const safeVirtualUsers = Math.max(1, Number(virtualUsers) || 1)
  const summarize = (entries) => {
    const totalResponseBodyBytes = entries.reduce(
      (total, entry) => total + Number(entry.responseBodyBytes ?? 0),
      0,
    )
    const totalTransferBodyBytes = entries.reduce(
      (total, entry) => total + Number(entry.transferBodyBytes ?? 0),
      0,
    )
    return {
      requests: entries.length,
      requestsPerVirtualUser: rounded(entries.length / safeVirtualUsers),
      totalResponseBodyBytes,
      totalTransferBodyBytes,
      averageResponseBodyBytes: entries.length === 0
        ? 0
        : rounded(totalResponseBodyBytes / entries.length),
    }
  }
  const byPhase = {}
  for (const record of records) {
    const phase = record.phase || 'unclassified'
    if (!byPhase[phase]) byPhase[phase] = []
    byPhase[phase].push(record)
  }
  return {
    ...summarize(records),
    byPhase: Object.fromEntries(
      Object.entries(byPhase).map(([phase, entries]) => [phase, summarize(entries)]),
    ),
  }
}

export function evaluateQaConcurrencyReport(report, thresholds = DEFAULT_THRESHOLDS) {
  const checks = report.checks ?? {}
  const qualification = report.profile?.qualification === true
  const requiredChecks = [
    'healthAllSuccessful',
    'accountReadsIsolated',
    'crossAccountReadsDenied',
    'crossAccountWritesDenied',
    'crossAccountDeletesDenied',
    'crossAccountMutationTargetsUnchanged',
    'allConditionalReadsNotModified',
    'allSseClientsConnected',
    'ownSseInvalidationsDelivered',
    'sseEventsStayedAccountScoped',
    'distinctWritesReadable',
    'sameEntityConflictSafe',
    'acceptedSameEntityWritesReadable',
    'allLoginsCompleted',
    'allLoginTokensVerified',
    'loginTokenReadsIsolated',
    'overloadResponsesStructured',
    'overloadWritesEventuallyReadable',
    'processHealthyAfterOverload',
    'allHealthWebSocketsReady',
    'processStillHealthy',
    'apiWorkerProcessIsolated',
    'workerReservationsReleased',
    'cleanupComplete',
  ]
  requiredChecks.push(...[
    'enduranceAutosaveStable',
    'enduranceBackgroundConcurrencyNoConflicts',
    'enduranceConnectionsStable',
    'enduranceConnectionsP95Stable',
    'enduranceLivenessStable',
  ].filter((name) => Object.hasOwn(checks, name)))
  if (qualification) {
    requiredChecks.push(
      'qualificationProfileMet',
      'overloadObservedStructuredBusy',
      'bodyAdmissionBackpressureObserved',
      'bodyAdmissionBackpressureRecovered',
      'overloadSseInvalidationsDelivered',
      'mixedWorkloadSuccessful',
      'mixedSseInvalidationsDelivered',
      'healthWebSocketsStayedOpenDuringMixed',
      'durableAfterRestart',
    )
  }
  const correctnessPassed = requiredChecks.every((name) => checks[name] === true)
    && Number(report.http?.unexpected5xx?.count ?? 0) === 0
    && Number(report.http?.storeWriteConflictCount ?? 0) === 0
    && Number(report.http?.serverUnavailableCount ?? 0) === 0
    && Number(report.http?.transportErrors?.length ?? 0) === 0
    && Number(report.dataLoss?.count ?? 0) === 0
    && Number(report.dataIsolationViolations ?? 0) === 0
    && (report.errors?.length ?? 0) === 0
  const performance = {
    healthP95: Number(report.phases?.health?.p95Ms ?? Number.POSITIVE_INFINITY) <= thresholds.healthP95Ms,
    readP95: Number(report.phases?.authenticatedReads?.all?.p95Ms ?? Number.POSITIVE_INFINITY) <= thresholds.readP95Ms,
    writeP95: Number(report.phases?.distinctAccountWrites?.p95Ms ?? Number.POSITIVE_INFINITY) <= thresholds.writeP95Ms,
    loginP95: Number(report.phases?.concurrentLogin?.p95Ms ?? Number.POSITIVE_INFINITY) <= thresholds.loginP95Ms,
    eventLoopP99: Number(report.runtime?.eventLoopDelay?.p99Ms ?? Number.POSITIVE_INFINITY) <= thresholds.eventLoopP99Ms,
  }
  if (qualification) {
    performance.overloadP95 = Number(
      report.phases?.overloadWrites?.endToEndLatency?.p95Ms ?? Number.POSITIVE_INFINITY,
    ) <= thresholds.overloadP95Ms
    performance.mixedP95 = Number(
      report.phases?.mixedWorkload?.p95Ms ?? Number.POSITIVE_INFINITY,
    ) <= thresholds.mixedP95Ms
    const rssPeakMb = Number(report.runtime?.rssPeakMb ?? Number.POSITIVE_INFINITY)
    const rssHardLimitMb = Number(report.profile?.runtimeMemoryHardLimitMb ?? Number.NaN)
    performance.rssBelowHardLimit = Number.isFinite(rssPeakMb)
      && Number.isFinite(rssHardLimitMb)
      && rssPeakMb < rssHardLimitMb
  }
  const status = correctnessPassed && Object.values(performance).every(Boolean) ? 'pass' : 'fail'
  return {
    status,
    correctnessPassed,
    performancePassed: Object.values(performance).every(Boolean),
    performance,
    failedChecks: requiredChecks.filter((name) => checks[name] !== true),
    qualification: {
      requested: qualification,
      profileMet: checks.qualificationProfileMet === true,
      passed: qualification && status === 'pass',
    },
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer
    const onAbort = () => {
      if (timer) clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('QA operation aborted'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function authHeaders(token, extra = {}) {
  return { ...QA_LOOPBACK_PROXY_HEADERS, authorization: `Bearer ${token}`, ...extra }
}

function createHttpClient(
  report,
  getSignal = () => undefined,
  requestTimeoutMs = DEFAULTS.requestTimeoutMs,
) {
  const records = []
  return {
    records,
    async request(url, init, policy = {}) {
      const started = performance.now()
      const phase = policy.phase || 'unclassified'
      const method = String(init?.method ?? 'GET').toUpperCase()
      let result
      try {
        const signal = combinedAbortSignal([init?.signal, getSignal()])
        const { response, rawBody } = await fetchWithQaTimeout(
          url,
          {
            ...init,
            headers: { ...QA_LOOPBACK_PROXY_HEADERS, ...(init?.headers ?? {}) },
            signal,
          },
          requestTimeoutMs,
          async (activeResponse) => ({
            response: activeResponse,
            rawBody: await activeResponse.text(),
          }),
        )
        const contentType = response.headers.get('content-type') ?? ''
        const responseBodyBytes = Buffer.byteLength(rawBody, 'utf8')
        const contentLengthHeader = response.headers.get('content-length')
        const contentLengthValue = contentLengthHeader === null
          ? Number.NaN
          : Number(contentLengthHeader)
        const contentLength = Number.isFinite(contentLengthValue) && contentLengthValue >= 0
          ? contentLengthValue
          : null
        let payload = rawBody || null
        let parseError
        if (rawBody && contentType.includes('application/json')) {
          try {
            payload = JSON.parse(rawBody)
          } catch (error) {
            parseError = error instanceof Error ? error.message : String(error)
          }
        }
        result = {
          phase,
          method,
          ok: response.ok,
          status: response.status,
          payload,
          parseError,
          responseBodyBytes,
          // Fetch exposes a decoded body. Content-Length is closer to on-wire body
          // bytes when present; a 304 never transfers a representation body.
          transferBodyBytes: response.status === 304
            ? 0
            : (contentLength ?? responseBodyBytes),
          headers: {
            etag: response.headers.get('etag'),
            contentEncoding: response.headers.get('content-encoding'),
            contentType,
            contentLength,
            requestId: response.headers.get('x-request-id'),
            retryAfter: response.headers.get('retry-after'),
            retryAfterMs: response.headers.get('x-phd-retry-after-ms'),
            memoryPressure: response.headers.get('x-phd-memory-pressure'),
            serverTiming: response.headers.get('server-timing'),
            workspaceStreamProtocol: response.headers.get('x-workspace-stream-protocol'),
            workspaceRevision: response.headers.get('x-workspace-revision'),
          },
          ms: performance.now() - started,
        }
      } catch (error) {
        result = {
          phase,
          method,
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error?.code,
          responseBodyBytes: 0,
          transferBodyBytes: 0,
          ms: performance.now() - started,
        }
      }
      records.push(compactHttpResult(result))
      const overload = classifyOverloadWriteResponse(result)
      const login = classifyLoginResponse(result)
      if (isQaStoreWriteConflictResponse(result)) {
        report.http.storeWriteConflictCount += 1
      }
      if (policy.allowServerBusy && overload.kind === 'server-busy') {
        report.http.expectedServerBusy.count += 1
        if (report.http.expectedServerBusy.examples.length < 10) {
          report.http.expectedServerBusy.examples.push(compactHttpResult(result))
        }
      } else if (result.status >= 500) {
        report.http.unexpected5xx.examples.push(compactHttpResult(result))
      }
      if (
        isQaServerUnavailableResponse(result)
        && !(policy.allowServerBusy && overload.kind === 'server-busy')
      ) {
        report.http.serverUnavailableCount += 1
      }
      if (policy.allowAuthCapacity && login.kind === 'auth-capacity') {
        report.http.expectedAuthCapacity.count += 1
        if (report.http.expectedAuthCapacity.examples.length < 10) {
          report.http.expectedAuthCapacity.examples.push(compactHttpResult(result))
        }
      }
      if (result.status === 0) {
        report.http.transportErrors.push(compactHttpResult(result))
      }
      return result
    },
  }
}

function qaWorkspaceStreamInteger(value, label) {
  const integer = Number(value)
  if (!Number.isSafeInteger(integer) || integer < 0) {
    const error = new Error(`Workspace stream ${label} is invalid`)
    error.code = 'QA_WORKSPACE_STREAM_INVALID'
    throw error
  }
  return integer
}

export function parseQaWorkspaceStreamResponse(response) {
  if (
    response?.status !== 200
    || response?.headers?.workspaceStreamProtocol !== QA_WORKSPACE_STREAM_PROTOCOL
    || !String(response?.headers?.contentType ?? '').toLowerCase().includes('application/x-ndjson')
    || typeof response?.payload !== 'string'
  ) {
    const error = new Error('Workspace stream response did not expose the production NDJSON protocol')
    error.code = 'QA_WORKSPACE_STREAM_UNAVAILABLE'
    throw error
  }
  const lines = response.payload.split(/\r?\n/u).filter((line) => line.trim())
  const result = Object.create(null)
  let revision = null
  let manifestSections = null
  let current = null
  let completedSections = 0
  let complete = false
  const requireRevision = (frame) => {
    const frameRevision = qaWorkspaceStreamInteger(frame.revision, 'revision')
    if (revision === null || frameRevision !== revision) {
      const error = new Error('Workspace stream revision changed during transfer')
      error.code = 'QA_WORKSPACE_STREAM_REVISION_CHANGED'
      throw error
    }
  }
  for (const line of lines) {
    if (line.length > QA_WORKSPACE_STREAM_MAX_LINE_CHARACTERS) {
      const error = new Error('Workspace stream frame exceeded the QA safety limit')
      error.code = 'QA_WORKSPACE_STREAM_FRAME_TOO_LARGE'
      throw error
    }
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      const error = new Error('Workspace stream frame was not valid JSON')
      error.code = 'QA_WORKSPACE_STREAM_INVALID'
      throw error
    }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || complete) {
      const error = new Error('Workspace stream frame ordering is invalid')
      error.code = 'QA_WORKSPACE_STREAM_INVALID'
      throw error
    }
    if (frame.kind === 'restart') {
      const error = new Error(`Workspace stream requested restart (${frame.code || 'unknown'})`)
      error.code = 'QA_WORKSPACE_STREAM_RESTART'
      error.restartCode = String(frame.code || 'WORKSPACE_STREAM_RETRY_REQUIRED')
      throw error
    }
    if (frame.kind === 'manifest') {
      if (manifestSections || current || completedSections !== 0 || frame.protocol !== QA_WORKSPACE_STREAM_PROTOCOL) {
        const error = new Error('Workspace stream manifest is invalid')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      const sections = Array.isArray(frame.sections) ? frame.sections.map(String) : []
      if (sections.length === 0 || new Set(sections).size !== sections.length || sections.some((name) => !name)) {
        const error = new Error('Workspace stream manifest sections are invalid')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      revision = qaWorkspaceStreamInteger(frame.revision, 'manifest revision')
      const headerRevision = response.headers?.workspaceRevision
      if (headerRevision !== null && headerRevision !== undefined) {
        if (qaWorkspaceStreamInteger(headerRevision, 'header revision') !== revision) {
          const error = new Error('Workspace stream header revision changed during transfer')
          error.code = 'QA_WORKSPACE_STREAM_REVISION_CHANGED'
          throw error
        }
      }
      manifestSections = sections
      continue
    }
    if (!manifestSections) {
      const error = new Error('Workspace stream manifest is missing')
      error.code = 'QA_WORKSPACE_STREAM_INVALID'
      throw error
    }
    requireRevision(frame)
    if (frame.kind === 'section-begin') {
      const section = String(frame.section ?? '')
      const shape = frame.shape === 'array' ? 'array' : frame.shape === 'value' ? 'value' : null
      const count = qaWorkspaceStreamInteger(frame.count, 'section count')
      if (
        current
        || section !== manifestSections[completedSections]
        || !shape
        || (shape === 'value' && count !== 1)
      ) {
        const error = new Error('Workspace stream section boundary is invalid')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      current = { section, shape, count, item: 0, chunks: [], characters: 0, values: [] }
      continue
    }
    if (frame.kind === 'complete') {
      const sectionCount = qaWorkspaceStreamInteger(frame.sections, 'completed section count')
      if (current || sectionCount !== manifestSections.length || completedSections !== manifestSections.length) {
        const error = new Error('Workspace stream completed before every section')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      complete = true
      continue
    }
    if (!current || frame.section !== current.section) {
      const error = new Error('Workspace stream data frame has no active section')
      error.code = 'QA_WORKSPACE_STREAM_INVALID'
      throw error
    }
    if (frame.kind === 'chunk') {
      const item = qaWorkspaceStreamInteger(frame.item, 'item index')
      const sequence = qaWorkspaceStreamInteger(frame.sequence, 'chunk sequence')
      if (
        item !== current.item
        || sequence !== current.chunks.length
        || typeof frame.data !== 'string'
        || frame.data.length > 128 * 1024
      ) {
        const error = new Error('Workspace stream chunk sequence is invalid')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      current.chunks.push(frame.data)
      current.characters += frame.data.length
      continue
    }
    if (frame.kind === 'item-complete') {
      const item = qaWorkspaceStreamInteger(frame.item, 'item index')
      const chunks = qaWorkspaceStreamInteger(frame.chunks, 'item chunk count')
      const characters = qaWorkspaceStreamInteger(frame.characters, 'item character count')
      if (
        item !== current.item
        || chunks !== current.chunks.length
        || characters !== current.characters
        || item >= current.count
      ) {
        const error = new Error('Workspace stream item boundary is invalid')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      try {
        current.values.push(JSON.parse(current.chunks.join('')))
      } catch {
        const error = new Error('Workspace stream item payload was invalid')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      current.item += 1
      current.chunks = []
      current.characters = 0
      continue
    }
    if (frame.kind === 'section-complete') {
      const items = qaWorkspaceStreamInteger(frame.items, 'completed item count')
      if (
        current.chunks.length !== 0
        || items !== current.item
        || items !== current.count
        || current.values.length !== current.count
      ) {
        const error = new Error('Workspace stream section is incomplete')
        error.code = 'QA_WORKSPACE_STREAM_INVALID'
        throw error
      }
      result[current.section] = current.shape === 'array' ? current.values : current.values[0]
      current = null
      completedSections += 1
      continue
    }
    const error = new Error('Workspace stream contained an unknown frame')
    error.code = 'QA_WORKSPACE_STREAM_INVALID'
    throw error
  }
  if (!complete || current || !manifestSections || completedSections !== manifestSections.length) {
    const error = new Error('Workspace stream ended before its atomic completion marker')
    error.code = 'QA_WORKSPACE_STREAM_INCOMPLETE'
    throw error
  }
  return {
    protocol: QA_WORKSPACE_STREAM_PROTOCOL,
    revision,
    manifestSections,
    sections: result,
    frameCount: lines.length,
    terminalFrame: 'complete',
  }
}

export async function executeRetriableServerBusyOperation({
  index,
  maxRetries,
  operation,
  isAccepted,
  signal,
  wait = sleep,
  classifyRetry = () => null,
}) {
  const started = performance.now()
  const responses = []
  const retryDelaysMs = []
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const response = await operation(attempt)
    const capacityClassification = classifyOverloadWriteResponse(response)
    const explicitRetryClassification = classifyRetry(response)
    let classification
    if (isAccepted(response)) classification = { kind: 'success' }
    else if (explicitRetryClassification?.kind === 'server-busy') {
      classification = explicitRetryClassification
    } else if (capacityClassification.kind === 'server-busy') classification = capacityClassification
    else {
      classification = {
        kind: 'unexpected',
        status: response?.status ?? 0,
        errorCode: response?.payload?.error?.code,
      }
    }
    responses.push({ response, classification })
    if (classification.kind === 'success') {
      return {
        kind: 'success',
        attempts: attempt,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
    if (classification.kind !== 'server-busy') {
      return {
        kind: 'unexpected',
        attempts: attempt,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
    if (attempt > maxRetries) {
      return {
        kind: 'exhausted',
        attempts: attempt,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
    const delayMs = overloadRetryDelayMs({
      attempt,
      retryAfter: classification.retryAfter,
      seed: index,
    })
    retryDelaysMs.push(delayMs)
    await wait(delayMs, signal)
  }
  throw new Error('SERVER_BUSY retry loop ended without a result')
}

async function executeRetriableOverloadWrite({
  index,
  maxRetries,
  write,
  signal,
  isAccepted = (response) => successfulHttpStatus(response?.status),
}) {
  return executeRetriableServerBusyOperation({
    index,
    maxRetries,
    operation: write,
    isAccepted,
    signal,
  })
}

async function executeRetriableLogin({ index, budgetMs, login, signal }) {
  const started = performance.now()
  const responses = []
  const retryDelaysMs = []
  let attempts = 0
  while (true) {
    attempts += 1
    const response = await login(attempts)
    const classification = classifyLoginResponse(response)
    responses.push({ response, classification })
    if (classification.kind === 'success') {
      return {
        kind: 'success',
        attempts,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
    if (classification.kind !== 'auth-capacity' && classification.kind !== 'request-capacity') {
      return {
        kind: 'unexpected',
        attempts,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
    const remainingMs = budgetMs - (performance.now() - started)
    if (remainingMs <= 0) {
      return {
        kind: 'exhausted',
        attempts,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
    const delayMs = loginCapacityRetryDelayMs({
      attempt: attempts - 1,
      retryAfter: classification.retryAfter,
      retryAfterMs: classification.explicitRetryAfterMs,
      seed: index,
    })
    const boundedDelayMs = Math.min(delayMs, remainingMs)
    retryDelaysMs.push(boundedDelayMs)
    await sleep(boundedDelayMs, signal)
    if (boundedDelayMs < delayMs) {
      return {
        kind: 'exhausted',
        attempts,
        responses,
        retryDelaysMs,
        elapsedMs: performance.now() - started,
      }
    }
  }
}

function sseTimeoutError(timeoutMs) {
  const error = new Error(`SSE observation window ended after ${timeoutMs}ms`)
  error.code = 'QA_SSE_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

function settleSseWaiter(waiter, method, value) {
  clearTimeout(waiter.timer)
  waiter.signal?.removeEventListener('abort', waiter.onAbort)
  waiter[method](value)
}

function publishSseEvent(client, event) {
  const waiter = client.waiters.shift()
  if (waiter) settleSseWaiter(waiter, 'resolve', event)
  else {
    client.events.push(event)
    if (client.events.length > 256) client.events.shift()
  }
}

function failSseClient(client, error) {
  if (client.failure) return
  client.failure = error instanceof Error ? error : new Error(String(error))
  for (const waiter of client.waiters.splice(0)) {
    settleSseWaiter(waiter, 'reject', client.failure)
  }
}

async function pumpSseClient(client) {
  try {
    while (true) {
      const { done, value } = await client.reader.read()
      if (done) throw new Error('SSE stream closed')
      client.buffer += client.decoder.decode(value, { stream: true })
      while (true) {
        const separator = client.buffer.search(/\r?\n\r?\n/)
        if (separator < 0) break
        const block = client.buffer.slice(0, separator)
        const boundary = client.buffer.slice(separator).match(/^\r?\n\r?\n/)?.[0]?.length ?? 2
        client.buffer = client.buffer.slice(separator + boundary)
        const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))
        if (data) publishSseEvent(client, JSON.parse(data.slice(5).trim()))
      }
    }
  } catch (error) {
    if (!client.closed) failSseClient(client, error)
  }
}

async function closeSseClient(client) {
  if (!client || client.closed) {
    await client?.pumpPromise
    return
  }
  client.closed = true
  const reason = new Error('QA SSE client closed')
  reason.code = 'QA_SSE_CLOSED'
  for (const waiter of client.waiters.splice(0)) {
    settleSseWaiter(waiter, 'reject', reason)
  }
  // The run supervisor may already have aborted the fetch. In that state
  // undici rejects reader.cancel() even though the socket/read is already
  // closed, so completion of the single owned pump is the cleanup invariant.
  const cancellation = client.reader.cancel(reason).catch(() => undefined)
  client.controller.abort(reason)
  await Promise.all([cancellation, client.pumpPromise])
  client.reader.releaseLock()
}

async function nextSseEvent(client, timeoutMs = 10_000, signal) {
  if (client.events.length > 0) return client.events.shift()
  if (client.failure) throw client.failure
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, signal, timer: null, onAbort: null }
    const remove = () => {
      const index = client.waiters.indexOf(waiter)
      if (index >= 0) client.waiters.splice(index, 1)
    }
    waiter.onAbort = () => {
      remove()
      settleSseWaiter(
        waiter,
        'reject',
        signal?.reason instanceof Error ? signal.reason : new Error('SSE read aborted'),
      )
    }
    waiter.timer = setTimeout(() => {
      remove()
      settleSseWaiter(waiter, 'reject', sseTimeoutError(timeoutMs))
    }, timeoutMs)
    if (signal?.aborted) waiter.onAbort()
    else {
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      client.waiters.push(waiter)
    }
  })
}

async function nextSseEventOfType(client, type, timeoutMs, signal) {
  const deadline = performance.now() + timeoutMs
  while (true) {
    const remainingMs = Math.max(1, deadline - performance.now())
    const event = await nextSseEvent(client, remainingMs, signal)
    if (event?.type === type) return event
  }
}

export async function prepareSseObservationWindow(clients, {
  settleMs = 100,
  signal,
} = {}) {
  await sleep(settleMs, signal)
  let discardedEvents = 0
  const baselines = clients.map((client, index) => {
    if (client.failure) throw client.failure
    if (client.waiters.length > 0) {
      const error = new Error(`SSE client ${index} still has an active observer at the phase boundary`)
      error.code = 'QA_SSE_WINDOW_BUSY'
      throw error
    }
    const queued = client.events.splice(0)
    discardedEvents += queued.length
    const revisions = [client.connectedEvent, ...queued]
      .map((event) => Number(event?.revision))
      .filter(Number.isFinite)
    const baselineRevision = Math.max(Number(client.observationRevision) || 0, ...revisions, 0)
    client.observationRevision = baselineRevision
    return baselineRevision
  })
  return { baselines, discardedEvents }
}

export async function nextSseInvalidationAfterRevision(
  client,
  baselineRevision,
  timeoutMs,
  signal,
) {
  const deadline = performance.now() + timeoutMs
  while (true) {
    const remainingMs = Math.max(1, deadline - performance.now())
    const event = await nextSseEvent(client, remainingMs, signal)
    const revision = Number(event?.revision)
    if (
      event?.type === 'invalidate'
      && Number.isFinite(revision)
      && revision > baselineRevision
      && event.scopes?.includes('applications')
    ) {
      client.observationRevision = Math.max(Number(client.observationRevision) || 0, revision)
      return event
    }
  }
}

async function observeSseQuiet(client, timeoutMs, signal) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      const event = await nextSseEvent(client, Math.max(1, deadline - performance.now()), signal)
      if (event?.type === 'invalidate') return { event }
      // Heartbeats are expected and must not shorten the isolation window.
    } catch (error) {
      if (error?.code === 'QA_SSE_TIMEOUT') return { quiet: true }
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { quiet: true }
}

export function assessQaSseIsolation({ mutationDurable, targetEvent, observerEvents = [] }) {
  const leakedObserverEvents = observerEvents.filter((result) => result.event?.type === 'invalidate')
  const quietObservers = observerEvents.filter((result) => result.quiet === true)
  const observerErrors = observerEvents.filter((result) => result.error)
  return {
    delivered: targetEvent?.type === 'invalidate',
    leakedObserverEvents,
    quietObservers,
    observerErrors,
    passed: mutationDurable === true
      && targetEvent?.type === 'invalidate'
      && leakedObserverEvents.length === 0
      && observerErrors.length === 0
      && quietObservers.length === observerEvents.length,
  }
}

async function openSseClient(baseUrl, token, index, signal, requestTimeoutMs) {
  const controller = new AbortController()
  const requestSignal = combinedAbortSignal([controller.signal, signal])
  const connectionTimeout = setTimeout(
    () => controller.abort(new QaHttpTimeoutError(requestTimeoutMs)),
    requestTimeoutMs,
  )
  let client
  try {
    const response = await fetch(`${baseUrl}/api/events`, {
      headers: authHeaders(token, {
        accept: 'text/event-stream',
        'x-phd-client-id': `qa-sse-${index}`,
      }),
      signal: requestSignal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`SSE client ${index} failed with HTTP ${response.status}`)
    }
    client = {
      controller,
      reader: response.body.getReader(),
      decoder: new TextDecoder(),
      buffer: '',
      status: response.status,
      events: [],
      waiters: [],
      failure: null,
      closed: false,
      pumpPromise: null,
    }
    client.pumpPromise = pumpSseClient(client)
    client.connectedEvent = await nextSseEventOfType(client, 'connected', requestTimeoutMs, signal)
    return client
  } catch (error) {
    controller.abort(error)
    await client?.reader?.cancel().catch(() => undefined)
    throw error
  } finally {
    clearTimeout(connectionTimeout)
  }
}

async function openHealthWebSockets(url, count, signal, options = {}) {
  const trackLifecycle = options.trackLifecycle === true
  const sockets = []
  const results = await Promise.all(Array.from({ length: count }, () => new Promise((resolve) => {
    const socket = new WebSocket(url, {
      headers: { ...QA_LOOPBACK_PROXY_HEADERS, Origin: 'http://localhost:5173' },
    })
    socket.lifecycle = []
    if (trackLifecycle) {
      socket.on('error', (error) => {
        socket.lifecycle.push({
          event: 'error',
          at: performance.now(),
          message: error?.message ? String(error.message).slice(0, 200) : 'WebSocket error',
        })
      })
      socket.on('close', (code, reason) => {
        socket.lifecycle.push({
          event: 'close',
          at: performance.now(),
          code,
          reason: String(reason ?? '').slice(0, 200),
        })
      })
    }
    sockets.push(socket)
    let settled = false
    const timeout = setTimeout(() => finish({ kind: 'timeout' }), 10_000)
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = () => {
      socket.terminate()
      finish({ kind: 'aborted', error: 'QA deadline reached' })
    }
    socket.once('message', (message) => {
      try {
        finish({ kind: 'ready', payload: JSON.parse(message.toString()) })
      } catch (error) {
        finish({ kind: 'invalid', error: error instanceof Error ? error.message : String(error) })
      }
    })
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      finish({ kind: 'rejected', status: response.statusCode })
    })
    socket.once('error', (error) => finish({ kind: 'error', error: error.message }))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })))
  return {
    results,
    openCount() {
      return sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length
    },
    lifecycle() {
      return sockets.map((socket, index) => ({
        index,
        readyState: socket.readyState,
        lifecycle: (socket.lifecycle ?? []).slice(),
      }))
    },
    close() {
      for (const socket of sockets) socket.terminate()
    },
  }
}

function loadUserFixtures(store, virtualUsers, runId, passwordHash) {
  const sourceUser = store.users.find((user) => user.email === 'jasper@example.com')
  const sourceApplication = store.applications.find((application) => application.ownerId === sourceUser?.id)
  if (!sourceUser || !sourceApplication) {
    throw new Error('The isolated seed workspace did not contain the expected demo fixture')
  }
  const users = []
  const applications = []
  const now = new Date().toISOString()
  for (let index = 0; index < virtualUsers; index += 1) {
    const userId = `user_qa_concurrency_${runId}_${index}`
    const user = {
      ...structuredClone(sourceUser),
      id: userId,
      email: `qa-concurrency-${runId}-${index}@example.test`,
      name: `QA concurrency user ${index}`,
      role: 'user',
      passwordHash,
      createdAt: now,
      lastLoginAt: null,
      settings: {
        ...structuredClone(sourceUser.settings),
        membershipPlan: 'pro',
        applicationQuota: 500,
        applicationCreateQuota: 500,
        storageQuotaMb: 500,
        shareQuota: 500,
        shareCreateQuota: 500,
      },
    }
    const application = {
      ...structuredClone(sourceApplication),
      id: `app_qa_concurrency_${runId}_${index}`,
      ownerId: userId,
      teamId: null,
      school: {
        ...structuredClone(sourceApplication.school),
        name: `QA concurrency university ${index}`,
      },
      program: `QA concurrency programme ${index}`,
      shares: [],
      createdAt: now,
      updatedAt: now,
    }
    users.push(user)
    applications.push(application)
  }
  return { users, applications }
}

function createSessionTokens(users, secret) {
  return users.map((user) => jwt.sign({
    sub: user.id,
    role: 'user',
    email: user.email,
    scope: 'app',
    mode: 'sliding',
    authVersion: Number(user.settings?.authVersion ?? 0),
  }, secret, {
    algorithm: 'HS256',
    issuer: 'phd-atlas',
    audience: 'phd-atlas-api',
    jwtid: randomUUID(),
    expiresIn: '1h',
  }))
}

const QA_RESTART_ENVIRONMENT_KEYS = Object.freeze([
  'NODE_ENV',
  'JWT_SECRET',
  'SETTINGS_ENCRYPTION_KEY',
  'BOOTSTRAP_USER_PASSWORD',
  'BOOTSTRAP_ADMIN_PASSWORD',
  'RATE_LIMIT_DISABLED',
  'PHD_ATLAS_STORAGE_ROOT',
  'PHD_ATLAS_SQLITE_PATH',
  'REQUEST_BODY_MAX_ACTIVE',
  'REQUEST_BODY_MAX_QUEUED',
  'REQUEST_BODY_WAIT_TIMEOUT_MS',
  'REQUEST_BODY_MAX_ACTIVE_PER_IP',
  'REQUEST_BODY_MAX_QUEUED_PER_IP',
  'REQUEST_BODY_DEADLINE_MS',
  'MUTATION_MAX_ACTIVE',
  'MUTATION_MAX_QUEUED',
  'MUTATION_WAIT_TIMEOUT_MS',
  'AUTH_PASSWORD_MAX_ACTIVE',
  'AUTH_PASSWORD_MAX_QUEUED',
  'AUTH_PASSWORD_WAIT_TIMEOUT_MS',
  'AUTH_REQUEST_BODY_MAX_ACTIVE',
  'AUTH_REQUEST_BODY_MAX_QUEUED',
  'AUTH_REQUEST_BODY_WAIT_TIMEOUT_MS',
  'SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE',
  'SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED',
  'SMALL_WORKSPACE_BOOTSTRAP_WAIT_TIMEOUT_MS',
  'SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE_PER_ACCOUNT',
  'SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED_PER_ACCOUNT',
  'ACCOUNT_SUMMARY_MAX_ACTIVE',
  'ACCOUNT_SUMMARY_MAX_QUEUED',
  'ACCOUNT_SUMMARY_WAIT_TIMEOUT_MS',
  'ACCOUNT_SUMMARY_MAX_ACTIVE_PER_ACCOUNT',
  'ACCOUNT_SUMMARY_MAX_QUEUED_PER_ACCOUNT',
  'APPLICATION_LIST_MAX_ACTIVE',
  'APPLICATION_LIST_MAX_QUEUED',
  'APPLICATION_LIST_WAIT_TIMEOUT_MS',
  'APPLICATION_LIST_MAX_ACTIVE_PER_ACCOUNT',
  'APPLICATION_LIST_MAX_QUEUED_PER_ACCOUNT',
  'PHD_ATLAS_CLUSTER_WORKERS',
  'PHD_ATLAS_CLUSTER_WORKER_THREADPOOL_SIZE',
  'UV_THREADPOOL_SIZE',
  'RUNTIME_MEMORY_BUDGET_BYTES',
  'RUNTIME_MEMORY_SOFT_RATIO',
  'RUNTIME_MEMORY_HARD_RATIO',
  'PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS_PER_IP',
  'PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS',
  'ALLOWED_HOSTS',
  'CORS_ORIGIN',
  'TRUST_PROXY',
  'PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST',
])

export function qaRestartWorkerEnvironment() {
  const environment = {}
  const operatingSystemKeys = process.platform === 'win32'
    ? ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR', 'TEMP', 'TMP']
    : ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']
  for (const key of [...operatingSystemKeys, ...QA_RESTART_ENVIRONMENT_KEYS]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }
  environment.PORT = '0'
  environment.PHD_ATLAS_LISTEN_HOST = '127.0.0.1'
  environment.PHD_ATLAS_DISABLE_UPDATE_RESTART = '1'
  environment.UV_THREADPOOL_SIZE ||= String(Math.min(
    32,
    Math.max(8, (os.availableParallelism?.() ?? os.cpus().length) * 2),
  ))
  return environment
}

export function assertQaStorageHandoffReady(stopOutcome, storageDiagnostics) {
  if (
    !stopOutcome
    || stopOutcome.safeToShutdownStorage !== true
    || stopOutcome.drained !== true
    || stopOutcome.httpClosed !== true
    || stopOutcome.timedOut === true
  ) {
    const error = new Error('The primary QA server did not reach a storage-safe restart boundary.')
    error.code = 'QA_RESTART_SERVER_DRAIN_UNSAFE'
    error.storageHandoff = sanitizeQaDiagnostic({ stopOutcome })
    throw error
  }
  const diagnostics = storageDiagnostics && typeof storageDiagnostics === 'object'
    ? storageDiagnostics
    : {}
  const safelyReleased = diagnostics.terminalShutdownRequested === true
    && diagnostics.initialized === false
    && diagnostics.initializing === false
    && diagnostics.shuttingDown === false
    && diagnostics.databaseOpen === false
    && diagnostics.databaseLeaseHeld === false
    && diagnostics.serviceLeaseHeld === false
  if (!safelyReleased) {
    const error = new Error('The primary QA process retained a storage owner before restart handoff.')
    error.code = 'QA_RESTART_STORAGE_OWNER_RETAINED'
    error.storageHandoff = sanitizeQaDiagnostic({ stopOutcome, storageDiagnostics: diagnostics })
    throw error
  }
  return diagnostics
}

export function startQaRestartWorker(projectRoot, { role = 'restart', fatalDiagnostics = true } = {}) {
  const output = []
  const startupProgress = []
  const environment = qaRestartWorkerEnvironment()
  environment.PHD_ATLAS_QA_WORKER_ROLE = String(role)
  if (fatalDiagnostics) {
    environment.PHD_ATLAS_QA_ENABLE_FATAL_DIAGNOSTICS = '1'
    const preload = pathToFileURL(
      path.join(projectRoot, 'tools', 'qa-endurance.mjs'),
    ).href
    const existingNodeOptions = environment.NODE_OPTIONS
    environment.NODE_OPTIONS = [
      ...(existingNodeOptions ? [existingNodeOptions] : []),
      `--import=${preload}`,
    ].join(' ')
  }
  const child = spawn(process.execPath, [path.join(projectRoot, 'tools', 'qa-concurrency-restart-worker.mjs')], {
    cwd: projectRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  const capture = (chunk) => {
    output.push(String(chunk))
    while (output.join('').length > 64 * 1024) output.shift()
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  let onMessage
  let onChildError
  let onChildExit
  const worker = {
    child,
    role: String(role),
    output,
    startupProgress,
    ready: null,
    shutdownReport: null,
    diagnosticsRequests: new Map(),
    requiresShutdownReport: true,
    settled: false,
    disposed: false,
    exit: null,
    spawnError: null,
    dispose() {
      if (worker.disposed) return
      worker.disposed = true
      if (onMessage) child.off('message', onMessage)
      if (onChildError) child.off('error', onChildError)
      if (onChildExit) child.off('exit', onChildExit)
      child.stdout?.off('data', capture)
      child.stderr?.off('data', capture)
      const error = Object.assign(new Error('QA API worker exited before returning diagnostics'), {
        code: 'QA_WORKER_DIAGNOSTICS_INTERRUPTED',
      })
      for (const request of worker.diagnosticsRequests.values()) request.reject(error)
      worker.diagnosticsRequests.clear()
    },
  }
  worker.exitPromise = new Promise((resolve) => {
    const settle = (outcome) => {
      if (worker.settled) return
      worker.settled = true
      worker.exit = outcome
      worker.dispose()
      resolve(outcome)
    }
    onChildError = (error) => {
      worker.spawnError = error
      settle({ kind: 'error', error })
    }
    onChildExit = (code, signal) => settle({ kind: 'exit', code, signal })
    child.once('error', onChildError)
    child.once('exit', onChildExit)
  })
  worker.readyPromise = new Promise((resolve, reject) => {
    let ready = false
    onMessage = (message) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'shutdown-complete') {
        worker.shutdownReport = message
        if (child.connected) {
          try {
            child.send({ type: 'shutdown-ack' }, () => undefined)
          } catch {
            // The worker also has a bounded acknowledgement fallback.
          }
        }
        return
      }
      if (message.type === 'diagnostics-response' && typeof message.requestId === 'string') {
        const request = worker.diagnosticsRequests.get(message.requestId)
        if (request) {
          worker.diagnosticsRequests.delete(message.requestId)
          request.resolve(message.diagnostics)
        }
        return
      }
      if (ready) return
      if (message.type === 'ready') {
        ready = true
        worker.ready = message
        resolve(message)
      } else if (message.type === 'startup-error') {
        const error = new Error(message.message || 'Restart worker startup failed')
        error.code = message.code || 'QA_RESTART_WORKER_START_FAILED'
        error.workerOutput = redactDiagnosticText(output.join(''))
        error.workerStartup = startupProgress.slice()
        reject(error)
      } else if (message.type === 'startup-progress') {
        startupProgress.push(sanitizeQaDiagnostic(message))
        if (startupProgress.length > 24) startupProgress.shift()
      }
    }
    child.on('message', onMessage)
    if (worker.disposed) child.off('message', onMessage)
    worker.exitPromise.then((outcome) => {
      if (ready) return
      const error = outcome.kind === 'error'
        ? outcome.error
        : new Error(`Restart worker exited before readiness with ${outcome.signal || `code ${outcome.code}`}`)
      error.code ||= 'QA_RESTART_WORKER_EXITED'
      error.workerOutput = redactDiagnosticText(output.join(''))
      error.workerStartup = startupProgress.slice()
      reject(error)
    })
  })
  return worker
}

export async function requestQaWorkerDiagnostics(worker, {
  timeoutMs = 2_000,
  signal,
  phase = 'worker-diagnostics',
} = {}) {
  if (!worker?.child || worker.settled || !worker.child.connected) {
    const error = new Error('The QA API worker is unavailable for diagnostics')
    error.code = 'QA_WORKER_DIAGNOSTICS_UNAVAILABLE'
    throw error
  }
  const requestId = randomUUID()
  const response = new Promise((resolve, reject) => {
    worker.diagnosticsRequests.set(requestId, { resolve, reject })
  })
  try {
    worker.child.send({ type: 'diagnostics-request', requestId }, (error) => {
      if (!error) return
      const request = worker.diagnosticsRequests.get(requestId)
      worker.diagnosticsRequests.delete(requestId)
      request?.reject(error)
    })
  } catch (error) {
    worker.diagnosticsRequests.delete(requestId)
    throw error
  }
  try {
    return await runWithQaDeadline(phase, timeoutMs, () => response, { signal })
  } finally {
    worker.diagnosticsRequests.delete(requestId)
  }
}

export async function waitForQaWorkerIdleDiagnostics(worker, {
  timeoutMs = 5_000,
  signal,
  wait = sleep,
} = {}) {
  const started = performance.now()
  let diagnostics
  for (;;) {
    diagnostics = await requestQaWorkerDiagnostics(worker, {
      timeoutMs: Math.min(2_000, timeoutMs),
      signal,
      phase: 'worker-idle-diagnostics',
    })
    const reservations = diagnostics?.memoryReservations
    const admissions = [
      diagnostics?.requestBodyAdmission,
      diagnostics?.credentialBodyAdmission,
      diagnostics?.mutationAdmission,
      diagnostics?.heavyWorkAdmission,
      diagnostics?.standardWorkAdmission,
      diagnostics?.accountSummaryAdmission,
      diagnostics?.applicationListAdmission,
      diagnostics?.workspaceBootstrapAdmission,
      diagnostics?.smallWorkspaceBootstrapAdmission,
    ].filter(Boolean)
    if (
      Number(reservations?.reservedBytes) === 0
      && Number(reservations?.activeReservations) === 0
      && admissions.every((entry) => (
        Number(entry?.active ?? 0) === 0 && Number(entry?.waiting ?? 0) === 0
      ))
    ) return diagnostics
    signal?.throwIfAborted?.()
    if (performance.now() - started >= timeoutMs) {
      const error = new Error('QA API worker retained reservations or admissions after the workload')
      error.code = 'QA_WORKER_RESERVATIONS_RETAINED'
      error.workerDiagnostics = sanitizeQaDiagnostic(diagnostics)
      throw error
    }
    await wait(20, signal)
  }
}

export function assertQaWorkerShutdownComplete(worker, shutdownReport = worker?.shutdownReport) {
  if (!shutdownReport || shutdownReport.type !== 'shutdown-complete') {
    const error = new Error('The QA API worker exited without an acknowledged shutdown report')
    error.code = 'QA_WORKER_SHUTDOWN_REPORT_MISSING'
    throw error
  }
  if (
    shutdownReport.exitCode !== 0
    || (Array.isArray(shutdownReport.failures) && shutdownReport.failures.length > 0)
  ) {
    const error = new Error('The QA API worker reported a failed shutdown')
    error.code = 'QA_WORKER_SHUTDOWN_FAILED'
    error.storageHandoff = sanitizeQaDiagnostic(shutdownReport)
    throw error
  }
  const expectedProcessId = Number(worker?.ready?.processId)
  if (
    !Number.isSafeInteger(shutdownReport.processId)
    || (Number.isSafeInteger(expectedProcessId) && shutdownReport.processId !== expectedProcessId)
  ) {
    const error = new Error('The QA API worker shutdown report came from a different process')
    error.code = 'QA_WORKER_PROCESS_ID_MISMATCH'
    throw error
  }
  const runtime = shutdownReport.runtime
  if (
    runtime?.owner !== 'api-worker'
    || runtime?.processId !== shutdownReport.processId
    || !Number.isFinite(runtime?.rssPeakMb)
    || !Number.isFinite(runtime?.cpuPeakPercent)
    || !Number.isFinite(runtime?.eventLoopDelay?.p99Ms)
  ) {
    const error = new Error('The QA API worker did not return complete process-local runtime metrics')
    error.code = 'QA_WORKER_RUNTIME_METRICS_INVALID'
    throw error
  }
  assertQaStorageHandoffReady(shutdownReport.stopOutcome, shutdownReport.storageDiagnostics)
  return shutdownReport
}

export async function waitForQaRestartWorker(worker, timeoutMs, signal) {
  let ready
  try {
    ready = await runWithQaDeadline(
      worker?.role === 'primary' ? 'setup:api-worker-ready' : 'durability-restart:worker-ready',
      timeoutMs,
      () => worker.readyPromise,
      { signal },
    )
  } catch (error) {
    error.workerOutput ||= redactDiagnosticText(worker?.output?.join('') ?? '')
    error.workerStartup ||= worker?.startupProgress?.slice() ?? []
    throw error
  }
  if (!Number.isSafeInteger(ready.port) || ready.port <= 0) {
    const error = new Error('Restart worker reported an invalid listener port')
    error.code = 'QA_RESTART_PORT_INVALID'
    throw error
  }
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(ready.address)) {
    const error = new Error(`Restart worker did not bind to loopback (${ready.address || 'unknown'})`)
    error.code = 'QA_RESTART_NOT_LOOPBACK'
    throw error
  }
  if (!Number.isSafeInteger(ready.processId) || ready.processId <= 0 || ready.runtimeOwner !== 'api-worker') {
    const error = new Error('QA API worker did not identify its process-local runtime owner')
    error.code = 'QA_WORKER_IDENTITY_INVALID'
    throw error
  }
  return ready
}

async function waitForQaWorkerExit(worker, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      worker.exitPromise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function stopQaRestartWorker(worker, {
  gracefulTimeoutMs = 8_000,
  killTimeoutMs = 4_000,
} = {}) {
  if (!worker?.child || worker.settled) return worker?.shutdownReport ?? null
  if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
    if (await waitForQaWorkerExit(worker, killTimeoutMs)) return worker.shutdownReport
    const error = new Error('Restart worker exit was observed but not confirmed by its lifecycle owner')
    error.code = 'QA_RESTART_EXIT_CONFIRMATION_TIMEOUT'
    throw error
  }
  let ipcShutdownRequested = false
  if (worker.child.connected && typeof worker.child.send === 'function') {
    ipcShutdownRequested = true
    try {
      worker.child.send({ type: 'shutdown' }, () => undefined)
    } catch {
      // Fall through to the bounded signal escalation below.
    }
    if (await waitForQaWorkerExit(worker, gracefulTimeoutMs)) return worker.shutdownReport
  }
  if (!worker.child.kill('SIGTERM') && !worker.settled) {
    const error = new Error('Restart worker rejected SIGTERM')
    error.code = 'QA_RESTART_TERMINATE_FAILED'
    throw error
  }
  if (await waitForQaWorkerExit(
    worker,
    ipcShutdownRequested ? killTimeoutMs : gracefulTimeoutMs,
  )) return worker.shutdownReport
  if (!worker.child.kill('SIGKILL') && !worker.settled) {
    const error = new Error('Restart worker rejected SIGKILL')
    error.code = 'QA_RESTART_KILL_FAILED'
    throw error
  }
  if (await waitForQaWorkerExit(worker, killTimeoutMs)) return worker.shutdownReport
  const error = new Error('Restart worker did not exit after SIGKILL')
  error.code = 'QA_RESTART_EXIT_TIMEOUT'
  throw error
}

function randomQaInteger(minimum, maximum) {
  const lower = Math.max(1, Math.ceil(Number(minimum) || 1))
  const upper = Math.max(lower, Math.floor(Number(maximum) || lower))
  if (lower === upper) return lower
  return lower + Math.floor(Math.random() * (upper - lower + 1))
}

export function qaRssLinearRegression(points = []) {
  const valid = points.filter((point) => (
    Number.isFinite(point?.xMs) && Number.isFinite(point?.yBytes)
  ))
  if (valid.length < 2) {
    return {
      samples: valid.length,
      slopeBytesPerMs: 0,
      slopeKbPerMinute: 0,
      correlation: 0,
      increasingPairs: 0,
      monotonicIncreasing: false,
    }
  }
  const meanX = valid.reduce((total, point) => total + point.xMs, 0) / valid.length
  const meanY = valid.reduce((total, point) => total + point.yBytes, 0) / valid.length
  let numerator = 0
  let denominator = 0
  let yVariance = 0
  for (const point of valid) {
    const xDelta = point.xMs - meanX
    const yDelta = point.yBytes - meanY
    numerator += xDelta * yDelta
    denominator += xDelta * xDelta
    yVariance += yDelta * yDelta
  }
  const slopeBytesPerMs = denominator === 0 ? 0 : numerator / denominator
  const correlation = denominator === 0 || yVariance === 0
    ? 0
    : numerator / Math.sqrt(denominator * yVariance)
  const increasingPairs = valid.slice(1).filter((point, index) => (
    point.yBytes > valid[index].yBytes
  )).length
  return {
    samples: valid.length,
    slopeBytesPerMs: rounded(slopeBytesPerMs),
    slopeKbPerMinute: rounded((slopeBytesPerMs * 60_000) / 1024),
    correlation: rounded(correlation),
    increasingPairs,
    monotonicIncreasing: increasingPairs === valid.length - 1,
  }
}

function summarizeQaRssSamples(samples) {
  const valid = samples.filter((sample) => Number.isFinite(sample?.rssBytes))
  if (valid.length === 0) {
    return {
      count: 0,
      startMb: 0,
      endMb: 0,
      minMb: 0,
      maxMb: 0,
      deltaMb: 0,
    }
  }
  const bytesToMb = (value) => rounded(value / 1024 / 1024)
  const values = valid.map((sample) => sample.rssBytes)
  const startMb = bytesToMb(values[0])
  const endMb = bytesToMb(values.at(-1))
  return {
    count: values.length,
    startMb,
    endMb,
    minMb: bytesToMb(Math.min(...values)),
    maxMb: bytesToMb(Math.max(...values)),
    deltaMb: rounded(endMb - startMb),
  }
}

export function createQaProcessLivenessMonitor({
  worker,
  storageRoot,
  expectedProcessId,
  sampleIntervalMs = 5_000,
  signal,
  phase = 'endurance-liveness',
}) {
  const fatalStatusPath = path.join(storageRoot, WORKER_FATAL_STATUS_RELATIVE_PATH)
  const samples = []
  let timer = null
  let stopped = false
  const sample = async () => {
    const at = Date.now()
    const elapsedMs = performance.now()
    try {
      const diagnostics = await requestQaWorkerDiagnostics(worker, {
        timeoutMs: Math.min(2_000, Math.max(500, sampleIntervalMs)),
        signal,
        phase: `${phase}:diagnostics`,
      })
      samples.push({
        at,
        elapsedMs,
        processId: diagnostics?.processId ?? null,
        rssBytes: diagnostics?.memory?.rss ?? null,
        error: null,
      })
    } catch (error) {
      samples.push({
        at,
        elapsedMs,
        processId: null,
        rssBytes: null,
        error: toQaFailureDiagnostic(error, { phase }),
      })
    }
  }
  const tick = async () => {
    if (stopped) return
    await sample()
    if (!stopped && !signal?.aborted) timer = setTimeout(tick, sampleIntervalMs)
  }
  return {
    start() {
      if (timer || stopped) return
      timer = setTimeout(tick, 0)
    },
    async stop() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await sample()
      let fatalStatusFileExists = false
      let fatalStatusDiagnostic = null
      let fatalStatusProbeError = null
      try {
        await fs.access(fatalStatusPath)
        fatalStatusFileExists = true
        try {
          fatalStatusDiagnostic = sanitizeQaDiagnostic(
            JSON.parse(await fs.readFile(fatalStatusPath, 'utf8')),
          )
        } catch (error) {
          fatalStatusDiagnostic = {
            parseError: error instanceof Error ? error.message : String(error),
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          fatalStatusProbeError = toQaFailureDiagnostic(error, {
            phase: `${phase}:fatal-status`,
          })
        }
      }
      const validRssSamples = samples.filter((sample) => Number.isFinite(sample.rssBytes))
      const processIdChanges = samples
        .filter((sample) => (
          Number.isFinite(sample.processId)
          && sample.processId !== expectedProcessId
        ))
        .map((sample) => ({
          at: sample.at,
          processId: sample.processId,
          expectedProcessId,
        }))
      return {
        phase,
        expectedProcessId,
        sampleIntervalMs,
        sampleCount: samples.length,
        validRssSamples: validRssSamples.length,
        rss: summarizeQaRssSamples(samples),
        regression: qaRssLinearRegression(
          validRssSamples.map((sample, index) => ({
            xMs: index * sampleIntervalMs,
            yBytes: sample.rssBytes,
          })),
        ),
        processIdStable: processIdChanges.length === 0,
        processIdChanges: processIdChanges.slice(0, 10),
        diagnosticsErrors: samples
          .filter((sample) => sample.error)
          .slice(0, 10)
          .map((sample) => sample.error),
        workerExit: worker?.exit
          ? {
              kind: worker.exit.kind,
              code: worker.exit.code ?? null,
              signal: worker.exit.signal ?? null,
            }
          : null,
        workerExitedUnexpectedly: Boolean(worker?.settled && !worker?.shutdownReport),
        fatalStatusFileExists,
        fatalStatusDiagnostic,
        fatalStatusProbeError,
      }
    },
  }
}

async function enduranceOrdinaryReadBatch({
  baseUrl,
  tokens,
  fixtures,
  http,
  phase,
}) {
  const results = await Promise.all(fixtures.users.map((user, index) => (
    http.request(
      `${baseUrl}/api/applications/${encodeURIComponent(fixtures.applications[index].id)}`,
      { headers: authHeaders(tokens[index]) },
      { allowServerBusy: true, phase },
    )
  )))
  return {
    latencies: results.map((result) => result.ms),
    failures: results
      .map((result, index) => ({
        index,
        userId: fixtures.users[index].id,
        applicationId: fixtures.applications[index].id,
        response: compactHttpResult(result),
        actualId: result.payload?.data?.id ?? null,
      }))
      .filter((failure, index) => (
        results[index].status !== 200
        || results[index].payload?.data?.id !== fixtures.applications[index].id
      ))
      .slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
  }
}

async function enduranceAutosaveWorker({
  index,
  application,
  token,
  baseUrl,
  http,
  runId,
  deadline,
  signal,
  options,
  phase,
}) {
  let currentApplication = structuredClone(application)
  const records = []
  let saveCount = 0
  const conflicts = []
  while (performance.now() < deadline) {
    const delayMs = randomQaInteger(
      options.enduranceAutosaveIntervalMinMs,
      options.enduranceAutosaveIntervalMaxMs,
    )
    if (performance.now() + delayMs >= deadline) break
    await sleep(delayMs, signal)
    saveCount += 1
    const marker = `${phase}-${runId}-${index}-${saveCount}`
    const desiredApplication = {
      ...structuredClone(currentApplication),
      program: marker,
    }
    const outcome = await executeRetriableOverloadWrite({
      index,
      maxRetries: options.overloadRetries,
      signal,
      isAccepted: (response) => qaApplicationMutationAcknowledged(
        response,
        currentApplication.id,
      ),
      write: (attempt) => http.request(
        `${baseUrl}/api/applications/${encodeURIComponent(currentApplication.id)}`,
        {
          method: 'PUT',
          headers: authHeaders(token, {
            'content-type': 'application/json',
            'x-phd-client-id': `${phase}-writer-${index}-${attempt}`,
          }),
          body: JSON.stringify(desiredApplication),
        },
        { allowServerBusy: true, phase: `${phase}.write` },
      ),
    })
    const response = outcome.responses.at(-1)?.response ?? {}
    const conflict = isQaStoreWriteConflictResponse(response)
    if (conflict) conflicts.push(compactHttpResult(response))
    const acknowledged = outcome.kind === 'success'
    const readbackOutcome = acknowledged
      ? await executeRetriableServerBusyOperation({
          index,
          maxRetries: options.overloadRetries,
          signal,
          isAccepted: (readback) => readback?.status === 200
            && readback?.payload?.data?.id === currentApplication.id
            && qaApplicationMatchesExpected(readback.payload.data, desiredApplication),
          operation: () => http.request(
            `${baseUrl}/api/applications/${encodeURIComponent(currentApplication.id)}`,
            { headers: authHeaders(token) },
            { allowServerBusy: true, phase: `${phase}.readback` },
          ),
        })
      : null
    const readback = readbackOutcome?.responses.at(-1)?.response ?? null
    const readable = Boolean(
      readbackOutcome?.kind === 'success'
      && qaApplicationMatchesExpected(readback.payload?.data, desiredApplication),
    )
    if (readable) {
      currentApplication = readback.payload.data
    } else if (acknowledged && response.payload?.data?.id === currentApplication.id) {
      currentApplication = {
        ...desiredApplication,
        updatedAt: response.payload.data.updatedAt,
      }
    }
    records.push({
      save: saveCount,
      marker,
      outcome: outcome.kind,
      attempts: outcome.attempts,
      acknowledged,
      readable,
      response: compactHttpResult(response),
      readback: compactHttpResult(readback),
    })
  }
  return {
    index,
    applicationId: currentApplication.id,
    saveCount,
    acknowledged: records.filter((record) => record.acknowledged).length,
    durableReadbacks: records.filter((record) => record.readable).length,
    records,
    conflicts,
    failures: records
      .filter((record) => !record.acknowledged || !record.readable)
      .slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
    currentApplication,
  }
}

async function runEnduranceAutosave({
  baseUrl,
  tokens,
  fixtures,
  ownedApplications,
  expectedApplications,
  expectedPrograms,
  expectedTags,
  report,
  http,
  runId,
  supervisor,
  options,
}) {
  supervisor.startPhase('endurance-autosave')
  const started = performance.now()
  const deadline = started + options.enduranceDurationMs
  const workers = await Promise.all(Array.from(
    { length: options.enduranceAutosaveUsers },
    (_, index) => enduranceAutosaveWorker({
      index,
      application: ownedApplications[index] ?? fixtures.applications[index],
      token: tokens[index],
      baseUrl,
      http,
      runId,
      deadline,
      signal: supervisor.signal,
      options,
      phase: 'endurance-autosave',
    }),
  ))
  const records = workers.flatMap((worker) => worker.failures)
  const conflicts = workers.flatMap((worker) => worker.conflicts)
  for (const worker of workers) {
    const application = worker.currentApplication
    if (application?.id) {
      ownedApplications[worker.index] = application
      expectedPrograms.set(application.id, application.program)
      expectedTags.set(application.id, [...(application.tags ?? [])])
      expectedApplications.set(application.id, structuredClone(application))
    }
  }
  report.phases.enduranceAutosave = {
    requestedUsers: options.enduranceAutosaveUsers,
    durationMs: options.enduranceDurationMs,
    intervalMinMs: options.enduranceAutosaveIntervalMinMs,
    intervalMaxMs: options.enduranceAutosaveIntervalMaxMs,
    savesAttempted: workers.reduce((total, worker) => total + worker.saveCount, 0),
    savesAcknowledged: workers.reduce((total, worker) => total + worker.acknowledged, 0),
    durableReadbacks: workers.reduce((total, worker) => total + worker.durableReadbacks, 0),
    conflictCount: conflicts.length,
    conflictExamples: conflicts.slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
    failureCount: records.length,
    failureEvidenceLimit: QA_FAILURE_DIAGNOSTIC_LIMIT,
    failuresTruncated: Math.max(0, records.length - QA_FAILURE_DIAGNOSTIC_LIMIT),
    failures: records.slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
  }
  report.checks.enduranceAutosaveStable = conflicts.length === 0
    && records.length === 0
    && report.phases.enduranceAutosave.savesAttempted > 0
    && report.phases.enduranceAutosave.savesAttempted
      === report.phases.enduranceAutosave.savesAcknowledged
    && report.phases.enduranceAutosave.durableReadbacks
      === report.phases.enduranceAutosave.savesAcknowledged
  supervisor.completePhase({
    users: options.enduranceAutosaveUsers,
    savesAttempted: report.phases.enduranceAutosave.savesAttempted,
    durableReadbacks: report.phases.enduranceAutosave.durableReadbacks,
    conflicts: conflicts.length,
  })
}

async function runEnduranceBackgroundConcurrency({
  baseUrl,
  tokens,
  fixtures,
  ownedApplications,
  expectedApplications,
  expectedPrograms,
  expectedTags,
  report,
  http,
  runId,
  supervisor,
  options,
}) {
  supervisor.startPhase('endurance-background-concurrency')
  const started = performance.now()
  const deadline = started + options.enduranceDurationMs
  const index = 0
  const token = tokens[index]
  const applicationId = ownedApplications[index]?.id ?? fixtures.applications[index].id
  const application = ownedApplications[index] ?? fixtures.applications[index]
  const setupResponse = await http.request(
    `${baseUrl}/api/settings`,
    {
      method: 'PATCH',
      headers: authHeaders(token, {
        'content-type': 'application/json',
        'X-PhD-Settings-Acknowledgement': 'v1',
        'X-PhD-Settings-Mutation-Id': `qa-concurrency:${runId}`,
      }),
      body: JSON.stringify({
        incomingProtocol: 'imap',
        incomingHost: 'imap.example.test',
        incomingPort: 993,
        incomingUser: 'qa-mail@example.test',
        incomingPass: `qa-background-pass-${runId}`,
      }),
    },
    { allowServerBusy: true, phase: 'enduranceBackground.settings' },
  )
  const saveWorkerPromise = enduranceAutosaveWorker({
    index,
    application,
    token,
    baseUrl,
    http,
    runId,
    deadline,
    signal: supervisor.signal,
    options,
    phase: 'endurance-background-save',
  })
  const backgroundRecords = []
  const backgroundLoop = async () => {
    let cycle = 0
    while (performance.now() < deadline) {
      const delayMs = randomQaInteger(
        options.enduranceBackgroundIntervalMinMs,
        options.enduranceBackgroundIntervalMaxMs,
      )
      if (performance.now() + delayMs >= deadline) break
      await sleep(delayMs, supervisor.signal)
      cycle += 1
      const endpoint = `https://push.example.test/sub/${runId}/${index}/${cycle}`
      const runBackgroundTask = (kind, phase, operation) => (
        executeRetriableServerBusyOperation({
          index: cycle * 4 + ['backup', 'mailSync', 'systemEvent', 'pushBatch'].indexOf(kind),
          maxRetries: options.overloadRetries,
          signal: supervisor.signal,
          isAccepted: (response) => response?.status >= 200 && response?.status < 300,
          operation: () => operation(),
        })
      )
      const taskResults = await Promise.all([
        runBackgroundTask(
          'backup',
          'enduranceBackground.backup',
          () => http.request(
            `${baseUrl}/api/backups`,
            {
              method: 'POST',
              headers: authHeaders(token, { 'content-type': 'application/json' }),
              body: JSON.stringify({ applicationId }),
            },
            { allowServerBusy: true, phase: 'enduranceBackground.backup' },
          ),
        ),
        runBackgroundTask(
          'mailSync',
          'enduranceBackground.mailSync',
          () => http.request(
            `${baseUrl}/api/settings/fetch-mail-now`,
            {
              method: 'POST',
              headers: authHeaders(token, { 'content-type': 'application/json' }),
              body: '{}',
            },
            { allowServerBusy: true, phase: 'enduranceBackground.mailSync' },
          ),
        ),
        runBackgroundTask(
          'systemEvent',
          'enduranceBackground.systemEvent',
          () => http.request(
            `${baseUrl}/api/notifications/read-all`,
            {
              method: 'POST',
              headers: authHeaders(token, { 'content-type': 'application/json' }),
              body: '{}',
            },
            { allowServerBusy: true, phase: 'enduranceBackground.systemEvent' },
          ),
        ),
        runBackgroundTask(
          'pushBatch',
          'enduranceBackground.pushBatch',
          () => http.request(
            `${baseUrl}/api/push/subscriptions`,
            {
              method: 'PUT',
              headers: authHeaders(token, { 'content-type': 'application/json' }),
              body: JSON.stringify({
                endpoint,
                keys: {
                  p256dh: 'A'.repeat(16),
                  auth: 'B'.repeat(8),
                },
              }),
            },
            { allowServerBusy: true, phase: 'enduranceBackground.pushBatch' },
          ),
        ),
      ])
      backgroundRecords.push(...taskResults.map((outcome, taskIndex) => {
        const response = outcome.responses.at(-1)?.response ?? {}
        return {
        cycle,
        kind: ['backup', 'mailSync', 'systemEvent', 'pushBatch'][taskIndex],
        status: response.status,
        conflict: isQaStoreWriteConflictResponse(response),
        http409: response.status === 409,
        attempts: outcome.attempts,
        response: compactHttpResult(response),
        }
      }))
    }
  }
  const [saveWorker] = await Promise.all([saveWorkerPromise, backgroundLoop()])
  if (saveWorker.currentApplication?.id) {
    ownedApplications[index] = saveWorker.currentApplication
    expectedPrograms.set(
      saveWorker.currentApplication.id,
      saveWorker.currentApplication.program,
    )
    expectedTags.set(
      saveWorker.currentApplication.id,
      [...(saveWorker.currentApplication.tags ?? [])],
    )
    expectedApplications.set(
      saveWorker.currentApplication.id,
      structuredClone(saveWorker.currentApplication),
    )
  }
  const failures = [
    ...(successfulHttpStatus(setupResponse.status) ? [] : [{
      stage: 'settings',
      response: compactHttpResult(setupResponse),
    }]),
    ...backgroundRecords
      .filter((record) => record.status < 200 || record.status >= 300)
      .map((record) => ({
        stage: record.kind,
        cycle: record.cycle,
        response: record.response,
      })),
    ...saveWorker.failures,
  ]
  const conflictRecords = [
    ...backgroundRecords.filter((record) => record.conflict || record.http409),
    ...saveWorker.conflicts.map((response) => ({
      cycle: null,
      kind: 'autosave',
      status: response.status,
      conflict: true,
      http409: response.status === 409,
      response,
    })),
  ]
  report.phases.enduranceBackgroundConcurrency = {
    userIndex: index,
    applicationId,
    durationMs: options.enduranceDurationMs,
    backgroundIntervalMinMs: options.enduranceBackgroundIntervalMinMs,
    backgroundIntervalMaxMs: options.enduranceBackgroundIntervalMaxMs,
    autosavesAttempted: saveWorker.saveCount,
    autosavesAcknowledged: saveWorker.acknowledged,
    autosaveDurableReadbacks: saveWorker.durableReadbacks,
    backgroundTasksAttempted: backgroundRecords.length,
    backgroundTasksAccepted: backgroundRecords.filter((record) => (
      record.status >= 200 && record.status < 300
    )).length,
    conflictCount: conflictRecords.length,
    http409Count: [
      ...backgroundRecords,
      ...saveWorker.records.filter((record) => record.response.status === 409).map(() => ({
        http409: true,
      })),
    ].filter((record) => record.http409).length,
    setupResponse: compactHttpResult(setupResponse),
    countsByKind: Object.fromEntries(['backup', 'mailSync', 'systemEvent', 'pushBatch'].map((kind) => [
      kind,
      backgroundRecords.filter((record) => record.kind === kind).length,
    ])),
    failures: failures.slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
    failureCount: failures.length,
    failureEvidenceLimit: QA_FAILURE_DIAGNOSTIC_LIMIT,
    failuresTruncated: Math.max(0, failures.length - QA_FAILURE_DIAGNOSTIC_LIMIT),
  }
  report.checks.enduranceBackgroundConcurrencyNoConflicts = conflictRecords.length === 0
    && failures.length === 0
    && saveWorker.saveCount > 0
    && saveWorker.acknowledged === saveWorker.saveCount
    && saveWorker.durableReadbacks === saveWorker.saveCount
  supervisor.completePhase({
    userIndex: index,
    autosaves: saveWorker.saveCount,
    backgroundTasks: backgroundRecords.length,
    conflicts: conflictRecords.length,
  })
}

async function runEnduranceConnections({
  baseUrl,
  tokens,
  fixtures,
  sseClients,
  report,
  http,
  supervisor,
  options,
}) {
  supervisor.startPhase('endurance-connections')
  const baselineBatch = await enduranceOrdinaryReadBatch({
    baseUrl,
    tokens,
    fixtures,
    http,
    phase: 'enduranceConnections.baseline',
  })
  if (sseClients.length > 0) {
    const closures = await Promise.allSettled(sseClients.splice(0).map(closeSseClient))
    const closureFailures = closures.filter((outcome) => outcome.status === 'rejected')
    if (closureFailures.length > 0) {
      const error = new Error(`${closureFailures.length} existing SSE client(s) failed to close`)
      error.code = 'QA_ENDURANCE_SSE_PRE_CLOSE_FAILED'
      throw error
    }
  }
  const enduranceSse = []
  let enduranceSockets = null
  const duringLatencies = []
  const readFailures = []
  const sseFailures = []
  const socketFailures = []
  let lastWebSocketsOpen = 0
  try {
    for (let offset = 0; offset < options.enduranceSseClients; offset += options.sseBatchSize) {
      const batch = tokens.slice(offset, offset + options.sseBatchSize)
      const clients = await Promise.all(batch.map((token, batchIndex) => (
        openSseClient(
          baseUrl,
          token,
          offset + batchIndex,
          supervisor.signal,
          options.requestTimeoutMs,
        )
      )))
      enduranceSse.push(...clients)
      if (offset + options.sseBatchSize < options.enduranceSseClients) {
        await sleep(25, supervisor.signal)
      }
    }
    enduranceSockets = await openHealthWebSockets(
      baseUrl.replace(/^http/, 'ws') + '/api/health/ws',
      options.enduranceWebSockets,
      supervisor.signal,
      { trackLifecycle: true },
    )
    const started = performance.now()
    const deadline = started + options.enduranceConnectionsDurationMs
    while (performance.now() < deadline) {
      const currentSseFailures = enduranceSse
        .map((client, index) => ({ index, client }))
        .filter((entry) => entry.client.failure || entry.client.closed)
        .map((entry) => ({
          index: entry.index,
          status: entry.client.status,
          failure: entry.client.failure
            ? toQaFailureDiagnostic(entry.client.failure, {
                phase: 'enduranceConnections.sse',
              })
            : 'SSE client closed',
        }))
      sseFailures.push(...currentSseFailures)
      const currentSocketLifecycle = enduranceSockets
        .lifecycle()
        .filter((entry) => entry.lifecycle.length > 0)
        .map((entry) => ({
          index: entry.index,
          readyState: entry.readyState,
          lifecycle: entry.lifecycle,
        }))
      socketFailures.push(...currentSocketLifecycle)
      lastWebSocketsOpen = enduranceSockets.openCount()
      const readBatch = await enduranceOrdinaryReadBatch({
        baseUrl,
        tokens,
        fixtures,
        http,
        phase: 'enduranceConnections.ordinary',
      })
      duringLatencies.push(...readBatch.latencies)
      readFailures.push(...readBatch.failures)
      const remainingMs = deadline - performance.now()
      if (remainingMs > 0) {
        await sleep(Math.min(options.enduranceReadIntervalMs, remainingMs), supervisor.signal)
      }
    }
  } finally {
    await Promise.allSettled(enduranceSse.map(closeSseClient))
    enduranceSockets?.close()
  }
  const baselineSummary = summarizeLatencies(baselineBatch.latencies)
  const duringSummary = summarizeLatencies(duringLatencies)
  const allowedDegradationMs = options.thresholds.enduranceP95DegradationMs
  const p95Stable = baselineBatch.failures.length === 0
    && readFailures.length === 0
    && duringSummary.p95Ms <= baselineSummary.p95Ms + allowedDegradationMs
  report.phases.enduranceConnections = {
    durationMs: options.enduranceConnectionsDurationMs,
    sseRequested: options.enduranceSseClients,
    sseConnected: enduranceSse.filter((client) => (
      client.status === 200 && client.connectedEvent?.type === 'connected'
    )).length,
    webSocketsRequested: options.enduranceWebSockets,
    webSocketsOpen: lastWebSocketsOpen,
    baselineReads: baselineBatch.latencies.length,
    baseline: baselineSummary,
    ordinaryReads: duringLatencies.length,
    ordinary: duringSummary,
    p95DegradationMs: rounded(duringSummary.p95Ms - baselineSummary.p95Ms),
    allowedP95DegradationMs: allowedDegradationMs,
    sseFailureCount: sseFailures.length,
    sseFailures: sseFailures.slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
    socketLifecycleEventCount: socketFailures.length,
    socketFailures: socketFailures.slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
    ordinaryReadFailureCount: readFailures.length,
    ordinaryReadFailures: readFailures.slice(0, QA_FAILURE_DIAGNOSTIC_LIMIT),
  }
  report.checks.enduranceConnectionsStable = report.phases.enduranceConnections.sseFailureCount === 0
    && report.phases.enduranceConnections.socketLifecycleEventCount === 0
    && report.phases.enduranceConnections.webSocketsOpen === options.enduranceWebSockets
    && report.phases.enduranceConnections.ordinaryReadFailureCount === 0
  report.checks.enduranceConnectionsP95Stable = p95Stable
  supervisor.completePhase({
    sse: options.enduranceSseClients,
    webSockets: options.enduranceWebSockets,
    ordinaryReads: duringLatencies.length,
    p95Ms: duringSummary.p95Ms,
  })
}

async function runEnduranceScenarios({
  baseUrl,
  tokens,
  fixtures,
  ownedApplications,
  expectedApplications,
  expectedPrograms,
  expectedTags,
  sseClients,
  report,
  http,
  runId,
  supervisor,
  primaryWorker,
  storageRoot,
  primaryWorkerReady,
  options,
}) {
  const scenarios = new Set(options.enduranceScenarios.length > 0
    ? options.enduranceScenarios
    : ENDURANCE_SCENARIOS)
  const activeDurations = []
  if (scenarios.has('autosave') || scenarios.has('background')) {
    activeDurations.push(options.enduranceDurationMs)
  }
  if (scenarios.has('connections')) {
    activeDurations.push(options.enduranceConnectionsDurationMs)
  }
  if (scenarios.has('liveness') && scenarios.size === 1) {
    activeDurations.push(options.enduranceDurationMs)
  }
  const longestDurationMs = Math.max(...activeDurations, 5_000)
  const rssSampleIntervalMs = Math.min(
    30_000,
    Math.max(1_000, Math.floor(longestDurationMs / options.enduranceRssSamples)),
  )
  const livenessMonitor = createQaProcessLivenessMonitor({
    worker: primaryWorker,
    storageRoot,
    expectedProcessId: primaryWorkerReady.processId,
    sampleIntervalMs: rssSampleIntervalMs,
    signal: supervisor.signal,
    phase: 'endurance-liveness',
  })
  livenessMonitor.start()
  try {
    if (scenarios.has('autosave')) {
      await runEnduranceAutosave({
        baseUrl,
        tokens,
        fixtures,
        ownedApplications,
        expectedApplications,
        expectedPrograms,
        expectedTags,
        report,
        http,
        runId,
        supervisor,
        options,
      })
    }
    if (scenarios.has('background')) {
      await runEnduranceBackgroundConcurrency({
        baseUrl,
        tokens,
        fixtures,
        ownedApplications,
        expectedApplications,
        expectedPrograms,
        expectedTags,
        report,
        http,
        runId,
        supervisor,
        options,
      })
    }
    if (scenarios.has('connections')) {
      await runEnduranceConnections({
        baseUrl,
        tokens,
        fixtures,
        sseClients,
        report,
        http,
        supervisor,
        options,
      })
    }
    if (scenarios.has('liveness') && scenarios.size === 1) {
      supervisor.startPhase('endurance-liveness')
      const deadline = performance.now() + options.enduranceDurationMs
      while (performance.now() < deadline) {
        await sleep(
          Math.min(options.enduranceReadIntervalMs, deadline - performance.now()),
          supervisor.signal,
        )
      }
      supervisor.completePhase({
        durationMs: options.enduranceDurationMs,
        monitoredProcessId: primaryWorkerReady.processId,
      })
    }
  } finally {
    const liveness = await livenessMonitor.stop()
    report.phases.enduranceLiveness = liveness
    report.checks.enduranceLivenessStable = liveness.processIdStable
      && !liveness.workerExitedUnexpectedly
      && !liveness.fatalStatusFileExists
      && liveness.validRssSamples >= 2
      && liveness.regression.slopeKbPerMinute
        <= options.thresholds.enduranceRssSlopeKbPerMinute
  }
}

export async function runQaConcurrency(options = parseQaConcurrencyArgs()) {
  const defaults = parseQaConcurrencyArgs([], {})
  options = {
    ...defaults,
    ...options,
    thresholds: { ...defaults.thresholds, ...(options.thresholds ?? {}) },
  }
  options = normalizeQaQualificationOptions(options)
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const progressEvents = []
  const emit = createQaProgressReporter({
    runId,
    onEvent: (event) => progressEvents.push(event),
  })
  const supervisor = createQaRunSupervisor({
    runId,
    overallTimeoutMs: options.overallTimeoutMs,
    phaseTimeoutMs: options.phaseTimeoutMs,
    progressIntervalMs: options.progressIntervalMs,
    emit,
  })
  const publicOptions = { ...options }
  delete publicOptions.temporaryParent
  delete publicOptions.profile
  const report = {
    status: 'running',
    runId,
    startedAt: new Date().toISOString(),
    profile: {
      name: options.profile,
      isolatedTemporaryStorage: true,
      explicitTemporaryParent: Boolean(options.temporaryParent),
      externalBaseUrlAllowed: false,
      runtimeMode: options.profile === 'production-like' ? 'production' : 'test',
      rateLimitDisabled: options.profile !== 'production-like',
      productionStartupPath: true,
      apiWorkerProcessIsolated: false,
      runtimeMetricsOwner: 'api-worker',
      runtimeMemoryHardLimitMb: rounded(
        (QA_RUNTIME_MEMORY_BUDGET_BYTES * QA_RUNTIME_MEMORY_HARD_RATIO) / 1024 / 1024,
      ),
      ...publicOptions,
    },
    phases: {},
    checks: {},
    dataLoss: { count: 0, acceptedWritesMissing: [] },
    dataIsolationViolations: 0,
    http: {
      requests: 0,
      storeWriteConflictCount: 0,
      serverUnavailableCount: 0,
      unexpected5xx: { count: 0, examples: [] },
      expectedServerBusy: { count: 0, examples: [] },
      expectedAuthCapacity: { count: 0, examples: [] },
      transportErrors: [],
    },
    runtime: {},
    progress: progressEvents,
    cleanup: { ok: false, steps: [] },
    errors: [],
  }
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY,
    BOOTSTRAP_USER_PASSWORD: process.env.BOOTSTRAP_USER_PASSWORD,
    BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    RATE_LIMIT_DISABLED: process.env.RATE_LIMIT_DISABLED,
    PHD_ATLAS_STORAGE_ROOT: process.env.PHD_ATLAS_STORAGE_ROOT,
    PHD_ATLAS_SQLITE_PATH: process.env.PHD_ATLAS_SQLITE_PATH,
    REQUEST_BODY_MAX_ACTIVE: process.env.REQUEST_BODY_MAX_ACTIVE,
    REQUEST_BODY_MAX_QUEUED: process.env.REQUEST_BODY_MAX_QUEUED,
    REQUEST_BODY_WAIT_TIMEOUT_MS: process.env.REQUEST_BODY_WAIT_TIMEOUT_MS,
    REQUEST_BODY_MAX_ACTIVE_PER_IP: process.env.REQUEST_BODY_MAX_ACTIVE_PER_IP,
    REQUEST_BODY_MAX_QUEUED_PER_IP: process.env.REQUEST_BODY_MAX_QUEUED_PER_IP,
    REQUEST_BODY_DEADLINE_MS: process.env.REQUEST_BODY_DEADLINE_MS,
    MUTATION_MAX_ACTIVE: process.env.MUTATION_MAX_ACTIVE,
    MUTATION_MAX_QUEUED: process.env.MUTATION_MAX_QUEUED,
    MUTATION_WAIT_TIMEOUT_MS: process.env.MUTATION_WAIT_TIMEOUT_MS,
    AUTH_PASSWORD_MAX_ACTIVE: process.env.AUTH_PASSWORD_MAX_ACTIVE,
    AUTH_PASSWORD_MAX_QUEUED: process.env.AUTH_PASSWORD_MAX_QUEUED,
    AUTH_PASSWORD_WAIT_TIMEOUT_MS: process.env.AUTH_PASSWORD_WAIT_TIMEOUT_MS,
    AUTH_REQUEST_BODY_MAX_ACTIVE: process.env.AUTH_REQUEST_BODY_MAX_ACTIVE,
    AUTH_REQUEST_BODY_MAX_QUEUED: process.env.AUTH_REQUEST_BODY_MAX_QUEUED,
    AUTH_REQUEST_BODY_WAIT_TIMEOUT_MS: process.env.AUTH_REQUEST_BODY_WAIT_TIMEOUT_MS,
    SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE: process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE,
    SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED: process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED,
    SMALL_WORKSPACE_BOOTSTRAP_WAIT_TIMEOUT_MS: process.env.SMALL_WORKSPACE_BOOTSTRAP_WAIT_TIMEOUT_MS,
    SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE_PER_ACCOUNT:
      process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE_PER_ACCOUNT,
    SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED_PER_ACCOUNT:
      process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED_PER_ACCOUNT,
    ACCOUNT_SUMMARY_MAX_ACTIVE: process.env.ACCOUNT_SUMMARY_MAX_ACTIVE,
    ACCOUNT_SUMMARY_MAX_QUEUED: process.env.ACCOUNT_SUMMARY_MAX_QUEUED,
    ACCOUNT_SUMMARY_WAIT_TIMEOUT_MS: process.env.ACCOUNT_SUMMARY_WAIT_TIMEOUT_MS,
    ACCOUNT_SUMMARY_MAX_ACTIVE_PER_ACCOUNT: process.env.ACCOUNT_SUMMARY_MAX_ACTIVE_PER_ACCOUNT,
    ACCOUNT_SUMMARY_MAX_QUEUED_PER_ACCOUNT: process.env.ACCOUNT_SUMMARY_MAX_QUEUED_PER_ACCOUNT,
    APPLICATION_LIST_MAX_ACTIVE: process.env.APPLICATION_LIST_MAX_ACTIVE,
    APPLICATION_LIST_MAX_QUEUED: process.env.APPLICATION_LIST_MAX_QUEUED,
    APPLICATION_LIST_WAIT_TIMEOUT_MS: process.env.APPLICATION_LIST_WAIT_TIMEOUT_MS,
    APPLICATION_LIST_MAX_ACTIVE_PER_ACCOUNT: process.env.APPLICATION_LIST_MAX_ACTIVE_PER_ACCOUNT,
    APPLICATION_LIST_MAX_QUEUED_PER_ACCOUNT: process.env.APPLICATION_LIST_MAX_QUEUED_PER_ACCOUNT,
    PHD_ATLAS_CLUSTER_WORKERS: process.env.PHD_ATLAS_CLUSTER_WORKERS,
    PHD_ATLAS_CLUSTER_WORKER_THREADPOOL_SIZE: process.env.PHD_ATLAS_CLUSTER_WORKER_THREADPOOL_SIZE,
    RUNTIME_MEMORY_BUDGET_BYTES: process.env.RUNTIME_MEMORY_BUDGET_BYTES,
    RUNTIME_MEMORY_SOFT_RATIO: process.env.RUNTIME_MEMORY_SOFT_RATIO,
    RUNTIME_MEMORY_HARD_RATIO: process.env.RUNTIME_MEMORY_HARD_RATIO,
    PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS_PER_IP: process.env.PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS_PER_IP,
    PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS: process.env.PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS,
    PHD_ATLAS_LISTEN_HOST: process.env.PHD_ATLAS_LISTEN_HOST,
    PHD_ATLAS_DISABLE_UPDATE_RESTART: process.env.PHD_ATLAS_DISABLE_UPDATE_RESTART,
    PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST: process.env.PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST,
    ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
    PORT: process.env.PORT,
  }
  const originalStdoutWrite = process.stdout.write
  const originalConsoleError = console.error

  let storageRoot
  let storage
  let primaryWorker
  let primaryWorkerReady
  let restartWorker
  let healthSockets
  let setupOperations
  let capturedServerOutputCount = 0
  const sseClients = []
  const http = createHttpClient(report, () => supervisor.signal, options.requestTimeoutMs)
  const terminationHandlers = new Map(['SIGINT', 'SIGTERM'].map((signalName) => [
    signalName,
    () => {
      const error = new Error(`QA run interrupted by ${signalName}`)
      error.code = 'QA_RUN_INTERRUPTED'
      supervisor.abort(error)
    },
  ]))
  for (const [signalName, handler] of terminationHandlers) process.once(signalName, handler)
  emit('run-start', {
    phase: 'run',
    status: 'running',
    overallDeadlineMs: options.overallTimeoutMs,
    phaseDeadlineMs: options.phaseTimeoutMs,
    cleanupDeadlineMs: options.cleanupTimeoutMs,
    progressIntervalMs: options.progressIntervalMs,
    profile: options.profile,
    virtualUsers: options.virtualUsers,
  })
  try {
    supervisor.startPhase('setup')
    setupOperations = createQaOperationTracker({
      timeoutMs: options.phaseTimeoutMs,
      signal: supervisor.signal,
    })
    const runSetupOperation = setupOperations.run.bind(setupOperations)
    const temporaryParent = resolveQaTemporaryParent(options, {
      projectRoot,
      currentStorageRoot: originalEnvironment.PHD_ATLAS_STORAGE_ROOT,
    })
    let verifiedTemporaryParent = temporaryParent
    if (options.temporaryParent) {
      const [realTemporaryParent, realProjectRoot, realSystemTemporaryRoot] = await Promise.all([
        runSetupOperation(
          'setup:resolve-temporary-parent',
          () => resolveQaPathThroughExistingAncestor(temporaryParent),
        ),
        runSetupOperation('setup:resolve-project-root', () => fs.realpath(projectRoot)),
        runSetupOperation('setup:resolve-system-temporary-root', () => fs.realpath(os.tmpdir())),
      ])
      let realCurrentStorageRoot = originalEnvironment.PHD_ATLAS_STORAGE_ROOT
      if (realCurrentStorageRoot) {
        realCurrentStorageRoot = await runSetupOperation(
          'setup:resolve-active-storage',
          () => fs.realpath(realCurrentStorageRoot),
        )
          .catch(() => path.resolve(realCurrentStorageRoot))
      }
      verifiedTemporaryParent = validateQaTemporaryParent(realTemporaryParent, {
        projectRoot: realProjectRoot,
        currentStorageRoot: realCurrentStorageRoot,
        systemTemporaryRoot: realSystemTemporaryRoot,
      })
    }
    await runSetupOperation(
      'setup:create-temporary-parent',
      () => fs.mkdir(verifiedTemporaryParent, { recursive: true }),
    )
    if (options.temporaryParent) {
      verifiedTemporaryParent = validateQaTemporaryParent(
        await runSetupOperation(
          'setup:verify-temporary-parent',
          () => fs.realpath(verifiedTemporaryParent),
        ),
        {
          projectRoot: await runSetupOperation('setup:verify-project-root', () => fs.realpath(projectRoot)),
          currentStorageRoot: originalEnvironment.PHD_ATLAS_STORAGE_ROOT,
          systemTemporaryRoot: await runSetupOperation('setup:verify-system-temp', () => fs.realpath(os.tmpdir())),
        },
      )
    }
    storageRoot = await runSetupOperation(
      'setup:create-run-storage',
      () => fs.mkdtemp(path.join(verifiedTemporaryParent, 'phd-atlas-qa-concurrency-')),
      {
        onSuccess: (value) => { storageRoot = value },
        onLateSuccess: async (value) => {
          await fs.rm(value, {
            recursive: true,
            force: true,
            maxRetries: process.platform === 'win32' ? 5 : 0,
            retryDelay: 100,
          })
          if (storageRoot === value) storageRoot = null
        },
      },
    )
    process.stdout.write = function captureQaServerStdout(chunk, encoding, callback) {
      const value = String(chunk)
      const done = typeof encoding === 'function' ? encoding : callback
      if (
        capturedServerOutputCount < 100
        && !/^(?:(?:\d{1,3}\.){3}\d{1,3}|::ffff:[^ ]+) - \[/.test(value)
        && value.trim()
      ) {
        capturedServerOutputCount += 1
        emit('server-output', {
          phase: supervisor.activePhase || 'server',
          status: 'info',
          stream: 'stdout',
          message: value.trim().slice(0, 2_000),
        })
      }
      queueMicrotask(() => done?.())
      return true
    }
    console.error = (...values) => {
      emit('server-output', {
        phase: supervisor.activePhase || 'server',
        status: 'error',
        stream: 'stderr',
        message: values.map((value) => (
          value instanceof Error ? `${value.name}: ${value.message}` : String(value)
        )).join(' ').slice(0, 2_000),
      })
    }
    process.env.NODE_ENV = options.profile === 'production-like' ? 'production' : 'test'
    process.env.JWT_SECRET = randomBytes(32).toString('base64url')
    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
    process.env.BOOTSTRAP_USER_PASSWORD = randomBytes(32).toString('base64url')
    process.env.BOOTSTRAP_ADMIN_PASSWORD = randomBytes(32).toString('base64url')
    if (options.profile === 'production-like') delete process.env.RATE_LIMIT_DISABLED
    else process.env.RATE_LIMIT_DISABLED = '1'
    process.env.PHD_ATLAS_STORAGE_ROOT = storageRoot
    process.env.PHD_ATLAS_SQLITE_PATH = path.join(storageRoot, 'phd-atlas-qa.sqlite')
    // Pin the documented defaults so an unrelated shell override cannot turn
    // this isolated, repeatable profile into a different capacity experiment.
    process.env.REQUEST_BODY_MAX_ACTIVE = '8'
    process.env.REQUEST_BODY_MAX_QUEUED = '128'
    process.env.REQUEST_BODY_WAIT_TIMEOUT_MS = '15000'
    process.env.REQUEST_BODY_MAX_ACTIVE_PER_IP = '2'
    process.env.REQUEST_BODY_MAX_QUEUED_PER_IP = '2'
    process.env.REQUEST_BODY_DEADLINE_MS = '60000'
    process.env.MUTATION_MAX_ACTIVE = '4'
    process.env.MUTATION_MAX_QUEUED = '64'
    process.env.MUTATION_WAIT_TIMEOUT_MS = '15000'
    process.env.AUTH_PASSWORD_MAX_ACTIVE = '16'
    process.env.AUTH_PASSWORD_MAX_QUEUED = '128'
    process.env.AUTH_PASSWORD_WAIT_TIMEOUT_MS = '15000'
    process.env.AUTH_REQUEST_BODY_MAX_ACTIVE = '4'
    process.env.AUTH_REQUEST_BODY_MAX_QUEUED = '512'
    process.env.AUTH_REQUEST_BODY_WAIT_TIMEOUT_MS = '15000'
    process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE = '8'
    process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED = '32'
    process.env.SMALL_WORKSPACE_BOOTSTRAP_WAIT_TIMEOUT_MS = '15000'
    process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_ACTIVE_PER_ACCOUNT = '2'
    process.env.SMALL_WORKSPACE_BOOTSTRAP_MAX_QUEUED_PER_ACCOUNT = '4'
    process.env.ACCOUNT_SUMMARY_MAX_ACTIVE = '32'
    process.env.ACCOUNT_SUMMARY_MAX_QUEUED = '512'
    process.env.ACCOUNT_SUMMARY_WAIT_TIMEOUT_MS = '15000'
    process.env.ACCOUNT_SUMMARY_MAX_ACTIVE_PER_ACCOUNT = '2'
    process.env.ACCOUNT_SUMMARY_MAX_QUEUED_PER_ACCOUNT = '16'
    process.env.APPLICATION_LIST_MAX_ACTIVE = '8'
    process.env.APPLICATION_LIST_MAX_QUEUED = '512'
    process.env.APPLICATION_LIST_WAIT_TIMEOUT_MS = '30000'
    process.env.APPLICATION_LIST_MAX_ACTIVE_PER_ACCOUNT = '2'
    process.env.APPLICATION_LIST_MAX_QUEUED_PER_ACCOUNT = '16'
    process.env.RUNTIME_MEMORY_BUDGET_BYTES = String(QA_RUNTIME_MEMORY_BUDGET_BYTES)
    process.env.RUNTIME_MEMORY_SOFT_RATIO = '0.75'
    process.env.RUNTIME_MEMORY_HARD_RATIO = String(QA_RUNTIME_MEMORY_HARD_RATIO)
    process.env.PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS_PER_IP = '512'
    process.env.PHD_ATLAS_HEALTH_WS_MAX_CONNECTIONS = '512'
    process.env.PHD_ATLAS_LISTEN_HOST = '127.0.0.1'
    process.env.PHD_ATLAS_DISABLE_UPDATE_RESTART = '1'
    process.env.PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST = '1'
    process.env.ALLOWED_HOSTS = '127.0.0.1,localhost'
    process.env.CORS_ORIGIN = 'http://127.0.0.1:5173,http://localhost:5173'
    process.env.TRUST_PROXY = 'loopback'
    process.env.PORT = '0'

    storage = await runSetupOperation(
      'setup:import-storage',
      () => import(pathToFileURL(path.join(projectRoot, 'server', 'storage.js')).href),
      {
        onSuccess: (value) => { storage = value },
        onLateSuccess: async (value) => {
          await value.shutdownStorage?.()
          if (storage === value) storage = null
        },
      },
    )
    const passwordSecurity = await runSetupOperation(
      'setup:import-password-security',
      () => import(pathToFileURL(path.join(projectRoot, 'server', 'passwordSecurity.js')).href),
    )
    const qaPassword = randomBytes(32).toString('base64url')
    const qaPasswordHash = await runSetupOperation(
      'setup:hash-run-password',
      () => passwordSecurity.hashAccountPassword(qaPassword),
    )
    const store = await runSetupOperation('setup:read-store', () => storage.readStore())
    const fixtures = loadUserFixtures(store, options.virtualUsers, runId, qaPasswordHash)
    // The mixed phase uses fresh principals so it measures concurrent sign-in
    // under load without clearing or weakening the real production credential
    // and abuse buckets exercised by the preceding 100-user login phase.
    const mixedLoginUsers = options.qualification
      ? loadUserFixtures(
          store,
          QUALIFICATION_MINIMUMS.mixedLogins,
          `${runId}-mixed-login`,
          qaPasswordHash,
        ).users
      : []
    store.users.push(...fixtures.users, ...mixedLoginUsers)
    store.applications.push(...fixtures.applications)
    await runSetupOperation('setup:write-store', () => storage.writeStore(store))
    const tokens = createSessionTokens(fixtures.users, process.env.JWT_SECRET)

    // Fixture creation belongs to the load-generator process only. Release
    // every storage owner before the independently measured API process starts.
    storage.requestStorageTerminalShutdown?.()
    await runSetupOperation(
      'setup:release-seed-storage',
      () => storage.shutdownStorage({ terminal: true }),
    )
    assertQaStorageHandoffReady({
      safeToShutdownStorage: true,
      drained: true,
      httpClosed: true,
      timedOut: false,
    }, storage.storageLifecycleDiagnostics?.())
    storage = null

    // The parent now owns only clients and report aggregation. The API,
    // process RSS guard, event-loop histogram and storage lease all live in a
    // separate worker, matching a real deployed Node process.
    primaryWorker = startQaRestartWorker(projectRoot, { role: 'primary' })
    primaryWorkerReady = await runSetupOperation(
      'setup:start-api-worker',
      () => waitForQaRestartWorker(
        primaryWorker,
        Math.min(options.phaseTimeoutMs, 90_000),
        supervisor.signal,
      ),
    )
    const baseUrl = `http://127.0.0.1:${primaryWorkerReady.port}`
    await http.request(`${baseUrl}/api/health/ready`, undefined, { phase: 'startupHealth' })
    await sleep(50, supervisor.signal)
    const initialWorkerDiagnostics = await requestQaWorkerDiagnostics(primaryWorker, {
      timeoutMs: Math.min(options.requestTimeoutMs, 5_000),
      signal: supervisor.signal,
      phase: 'setup:api-worker-diagnostics',
    })
    report.profile.apiWorkerProcessIsolated = primaryWorkerReady.processId !== process.pid
      && initialWorkerDiagnostics?.processId === primaryWorkerReady.processId
    report.phases.processIsolation = {
      loadGeneratorProcessId: process.pid,
      apiProcessId: primaryWorkerReady.processId,
      distinctProcesses: report.profile.apiWorkerProcessIsolated,
      runtimeOwner: primaryWorkerReady.runtimeOwner,
      diagnostics: {
        memory: Object.fromEntries([
          'rss',
          'heapTotal',
          'heapUsed',
          'external',
          'arrayBuffers',
        ].map((key) => [key, Number(initialWorkerDiagnostics?.memory?.[key] ?? 0)])),
        memoryPressure: Boolean(initialWorkerDiagnostics?.memoryPressure),
        memoryReservations: Boolean(initialWorkerDiagnostics?.memoryReservations),
        requestBodyAdmission: Boolean(initialWorkerDiagnostics?.requestBodyAdmission),
      },
    }
    report.checks.apiWorkerProcessIsolated = report.profile.apiWorkerProcessIsolated
      && Object.values(report.phases.processIsolation.diagnostics.memory).every((value) => (
        Number.isFinite(value) && value > 0
      ))
      && report.phases.processIsolation.diagnostics.memoryPressure
      && report.phases.processIsolation.diagnostics.memoryReservations
      && report.phases.processIsolation.diagnostics.requestBodyAdmission
    supervisor.completePhase({
      storage: 'isolated',
      server: 'ready',
      startupPath: 'tools/qa-concurrency-restart-worker.mjs',
      apiWorkerProcessIsolated: report.checks.apiWorkerProcessIsolated,
    })

    supervisor.startPhase('health')
    const healthResults = (await Promise.all(Array.from({ length: options.virtualUsers }, async (_, userIndex) => {
      const measurements = []
      for (let iteration = 0; iteration < options.healthIterations; iteration += 1) {
        measurements.push(await http.request(
          `${baseUrl}/api/health`,
          { headers: authHeaders(tokens[userIndex]) },
          { phase: 'health' },
        ))
      }
      return measurements
    }))).flat()
    report.phases.health = {
      ...summarizeLatencies(healthResults.map((result) => result.ms)),
      successes: healthResults.filter((result) => result.status === 200 && result.payload?.data?.status === 'ok').length,
      failures: healthResults.filter((result) => result.status !== 200).map(compactHttpResult),
    }
    report.checks.healthAllSuccessful = report.phases.health.successes === healthResults.length
    supervisor.completePhase({
      requests: healthResults.length,
      successes: report.phases.health.successes,
    })

    supervisor.startPhase('authenticated-reads')
    const ownedApplications = new Array(options.virtualUsers)
    const expectedApplications = new Map(fixtures.applications.map((application) => [
      application.id,
      structuredClone(application),
    ]))
    const readResults = await Promise.all(fixtures.users.map(async (user, index) => {
      const headers = authHeaders(tokens[index])
      const runRead = (seed, url, phase, isAccepted = (response) => response?.status === 200) => (
        executeRetriableServerBusyOperation({
          index: seed,
          maxRetries: options.overloadRetries,
          signal: supervisor.signal,
          isAccepted,
          operation: () => http.request(
            url,
            { headers },
            { allowServerBusy: true, phase },
          ),
        })
      )
      const meOutcome = await runRead(
        index * 4,
        `${baseUrl}/api/auth/me`,
        'authenticatedReads.me',
      )
      const applicationsOutcome = await runRead(
        index * 4 + 1,
        `${baseUrl}/api/applications`,
        'authenticatedReads.applications',
      )
      const bootstrapOutcome = await runRead(
        index * 4 + 2,
        `${baseUrl}/api/workspace/bootstrap`,
        'authenticatedReads.bootstrap',
      )
      const foreignIndex = (index + 1) % options.virtualUsers
      const foreignOutcome = await runRead(
        index * 4 + 3,
        `${baseUrl}/api/applications/${encodeURIComponent(fixtures.applications[foreignIndex].id)}`,
        'authenticatedReads.crossAccount',
        (response) => response?.status === 403 || response?.status === 404,
      )
      const me = meOutcome.responses.at(-1)?.response ?? {}
      const applications = applicationsOutcome.responses.at(-1)?.response ?? {}
      const bootstrap = bootstrapOutcome.responses.at(-1)?.response ?? {}
      const foreign = foreignOutcome.responses.at(-1)?.response ?? {}
      const applicationRows = applications.payload?.data ?? []
      const bootstrapRows = bootstrap.payload?.data?.applications ?? []
      ownedApplications[index] = applicationRows.find((application) => application.id === fixtures.applications[index].id)
      const ownResponsesAccepted = meOutcome.kind === 'success'
        && applicationsOutcome.kind === 'success'
        && bootstrapOutcome.kind === 'success'
      const isolated = ownResponsesAccepted
        && me.payload?.data?.user?.id === user.id
        && applicationRows.length === 1
        && applicationRows[0]?.id === fixtures.applications[index].id
        && applicationRows[0]?.ownerId === user.id
        && qaApplicationMatchesExpected(applicationRows[0], fixtures.applications[index])
        && bootstrap.payload?.data?.me?.user?.id === user.id
        && bootstrapRows.length === 1
        && bootstrapRows[0]?.id === fixtures.applications[index].id
        && bootstrapRows[0]?.ownerId === user.id
        && qaApplicationMatchesExpected(bootstrapRows[0], fixtures.applications[index])
      return {
        latencies: [
          meOutcome.elapsedMs,
          applicationsOutcome.elapsedMs,
          bootstrapOutcome.elapsedMs,
          foreignOutcome.elapsedMs,
        ],
        meMs: meOutcome.elapsedMs,
        applicationsMs: applicationsOutcome.elapsedMs,
        bootstrapMs: bootstrapOutcome.elapsedMs,
        crossMs: foreignOutcome.elapsedMs,
        applicationsEtag: applications.headers?.etag,
        applicationsResponseBodyBytes: applications.responseBodyBytes,
        applicationsTransferBodyBytes: applications.transferBodyBytes,
        canonicalShapeDifferences: qaApplicationShapeDifferencePaths(
          applicationRows[0],
          fixtures.applications[index],
          12,
        ),
        isolated,
        crossDenied: foreignOutcome.kind === 'success',
        // A final availability failure is not evidence of a privacy breach.
        // Count only an accepted own response with foreign/wrong data or a
        // successful response from the deliberately foreign endpoint.
        isolationViolation: (ownResponsesAccepted && !isolated)
          || successfulHttpStatus(foreign.status),
        outcomes: {
          me: meOutcome.kind,
          applications: applicationsOutcome.kind,
          bootstrap: bootstrapOutcome.kind,
          cross: foreignOutcome.kind,
        },
        attempts: {
          me: meOutcome.attempts,
          applications: applicationsOutcome.attempts,
          bootstrap: bootstrapOutcome.attempts,
          cross: foreignOutcome.attempts,
        },
        capacity: {
          me: summarizeQaRetriableCapacity(meOutcome),
          applications: summarizeQaRetriableCapacity(applicationsOutcome),
          bootstrap: summarizeQaRetriableCapacity(bootstrapOutcome),
          deniedCrossAccount: summarizeQaRetriableCapacity(foreignOutcome),
        },
        finalResponses: {
          me: compactHttpResult(me),
          applications: compactHttpResult(applications),
          bootstrap: compactHttpResult(bootstrap),
          cross: compactHttpResult(foreign),
        },
      }
    }))
    const expectedPrograms = new Map(fixtures.applications.map((application) => [
      application.id,
      application.program,
    ]))
    const expectedTags = new Map(fixtures.applications.map((application) => [
      application.id,
      [...(application.tags ?? [])],
    ]))
    report.phases.authenticatedReads = {
      all: summarizeLatencies(readResults.flatMap((result) => result.latencies)),
      me: summarizeLatencies(readResults.map((result) => result.meMs)),
      applications: summarizeLatencies(readResults.map((result) => result.applicationsMs)),
      bootstrap: summarizeLatencies(readResults.map((result) => result.bootstrapMs)),
      deniedCrossAccount: summarizeLatencies(readResults.map((result) => result.crossMs)),
      capacityRetries: readResults.reduce((total, result) => (
        total
          + result.attempts.me
          + result.attempts.applications
          + result.attempts.bootstrap
          + result.attempts.cross
          - 4
      ), 0),
      capacityByRoute: Object.fromEntries([
        'me',
        'applications',
        'bootstrap',
        'deniedCrossAccount',
      ].map((route) => [
        route,
        mergeQaRetriableCapacitySummaries(readResults.map((result) => result.capacity[route])),
      ])),
      exhausted: readResults.filter((result) => Object.values(result.outcomes).includes('exhausted')).length,
      unexpected: readResults.filter((result) => Object.values(result.outcomes).includes('unexpected')).length,
      canonicalNormalizationExamples: readResults
        .map((result, index) => ({ index, fields: result.canonicalShapeDifferences }))
        .filter((entry) => entry.fields.length > 0)
        .slice(0, 3),
      failures: readResults.filter((result) => !result.isolated || !result.crossDenied).slice(0, 10),
    }
    report.dataIsolationViolations = readResults.filter((result) => result.isolationViolation).length
    report.checks.accountReadsIsolated = readResults.every((result) => result.isolated)
    report.checks.crossAccountReadsDenied = readResults.every((result) => result.crossDenied)
    supervisor.completePhase({
      users: readResults.length,
      isolationViolations: report.dataIsolationViolations,
    })

    supervisor.startPhase('cross-account-mutations')
    const crossMutationResults = []
    // Keep these authorization probes serialized so admission pressure cannot
    // masquerade as a permission denial. Capacity is exercised separately.
    for (let actorIndex = 0; actorIndex < options.virtualUsers; actorIndex += 1) {
      const targetIndex = (actorIndex + 1) % options.virtualUsers
      const target = fixtures.applications[targetIndex]
      const targetExpected = expectedApplications.get(target.id) ?? target
      const unauthorizedMarker = `cross-account-forbidden-${runId}-${actorIndex}`
      const putOutcome = await executeRetriableServerBusyOperation({
        index: actorIndex * 3,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 403 || response?.status === 404,
        operation: () => http.request(
          `${baseUrl}/api/applications/${encodeURIComponent(target.id)}`,
          {
            method: 'PUT',
            headers: authHeaders(tokens[actorIndex], { 'content-type': 'application/json' }),
            body: JSON.stringify({ ...target, program: unauthorizedMarker }),
          },
          { allowServerBusy: true, phase: 'crossAccountMutations.put' },
        ),
      })
      const put = putOutcome.responses.at(-1)?.response
      const removeOutcome = await executeRetriableServerBusyOperation({
        index: actorIndex * 3 + 1,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 403 || response?.status === 404,
        operation: () => http.request(
          `${baseUrl}/api/applications/${encodeURIComponent(target.id)}`,
          { method: 'DELETE', headers: authHeaders(tokens[actorIndex]) },
          { allowServerBusy: true, phase: 'crossAccountMutations.delete' },
        ),
      })
      const remove = removeOutcome.responses.at(-1)?.response
      const ownerReadbackOutcome = await executeRetriableServerBusyOperation({
        index: actorIndex * 3 + 2,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 200,
        operation: () => http.request(
          `${baseUrl}/api/applications/${encodeURIComponent(target.id)}`,
          { headers: authHeaders(tokens[targetIndex]) },
          { allowServerBusy: true, phase: 'crossAccountMutations.readback' },
        ),
      })
      const ownerReadback = ownerReadbackOutcome.responses.at(-1)?.response
      crossMutationResults.push({
        actorIndex,
        targetIndex,
        putDenied: putOutcome.kind === 'success',
        deleteDenied: removeOutcome.kind === 'success',
        targetUnchanged: ownerReadbackOutcome.kind === 'success'
          && ownerReadback.payload?.data?.id === target.id
          && qaApplicationMatchesExpected(ownerReadback.payload?.data, targetExpected),
        isolationViolation: successfulHttpStatus(put?.status)
          || successfulHttpStatus(remove?.status)
          || (ownerReadbackOutcome.kind === 'success'
            && !qaApplicationMatchesExpected(ownerReadback.payload?.data, targetExpected)),
        attempts: {
          put: putOutcome.attempts,
          delete: removeOutcome.attempts,
          readback: ownerReadbackOutcome.attempts,
        },
        outcomes: {
          put: putOutcome.kind,
          delete: removeOutcome.kind,
          readback: ownerReadbackOutcome.kind,
        },
        put: compactHttpResult(put),
        remove: compactHttpResult(remove),
        ownerReadback: compactHttpResult(ownerReadback),
        expectedProgram: targetExpected.program,
        actualProgram: ownerReadback.payload?.data?.program,
      })
    }
    report.phases.crossAccountMutations = {
      attemptedActors: crossMutationResults.length,
      putDenied: crossMutationResults.filter((result) => result.putDenied).length,
      deleteDenied: crossMutationResults.filter((result) => result.deleteDenied).length,
      targetsUnchanged: crossMutationResults.filter((result) => result.targetUnchanged).length,
      capacityRetries: crossMutationResults.reduce((total, result) => (
        total + result.attempts.put + result.attempts.delete + result.attempts.readback - 3
      ), 0),
      exhausted: crossMutationResults.filter((result) => (
        result.outcomes.put === 'exhausted'
        || result.outcomes.delete === 'exhausted'
        || result.outcomes.readback === 'exhausted'
      )).length,
      failures: crossMutationResults.filter((result) => (
        !result.putDenied || !result.deleteDenied || !result.targetUnchanged
      )).slice(0, 10),
    }
    // A capacity retry exhaustion is a failed qualification, but it is not
    // evidence that one account crossed another account's authorization
    // boundary. Count only an accepted foreign mutation or a successful owner
    // readback that proves the target changed as an isolation violation.
    const crossMutationViolations = crossMutationResults.filter((result) => (
      result.isolationViolation
    )).length
    report.dataIsolationViolations += crossMutationViolations
    report.checks.crossAccountWritesDenied = crossMutationResults.every((result) => result.putDenied)
    report.checks.crossAccountDeletesDenied = crossMutationResults.every((result) => result.deleteDenied)
    report.checks.crossAccountMutationTargetsUnchanged = crossMutationResults.every(
      (result) => result.targetUnchanged,
    )
    supervisor.completePhase({
      actors: crossMutationResults.length,
      isolationViolations: crossMutationViolations,
    })

    supervisor.startPhase('conditional-reads')
    // Cross-account denial auditing may legitimately advance the global store
    // revision even though no application changed. Capture a fresh per-user
    // representation immediately before revalidation so this phase measures
    // ETag behaviour, not an intentionally stale validator from an earlier
    // security phase.
    const conditionalBaselineOutcomes = await Promise.all(tokens.map((token, index) => (
      executeRetriableServerBusyOperation({
        index,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 200
          && typeof response?.headers?.etag === 'string'
          && response.headers.etag.length > 0,
        operation: () => http.request(
          `${baseUrl}/api/applications`,
          { headers: authHeaders(token) },
          { allowServerBusy: true, phase: 'conditionalApplicationReads.baseline' },
        ),
      })
    )))
    const conditionalBaselines = conditionalBaselineOutcomes.map(
      (outcome) => outcome.responses.at(-1)?.response ?? {},
    )
    const conditionalApplicationReadOutcomes = await Promise.all(conditionalBaselines.map((baseline, index) => {
      const headers = authHeaders(tokens[index])
      if (baseline.headers?.etag) headers['if-none-match'] = baseline.headers.etag
      return executeRetriableServerBusyOperation({
        index,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 304,
        operation: () => http.request(
          `${baseUrl}/api/applications`,
          { headers },
          { allowServerBusy: true, phase: 'conditionalApplicationReads' },
        ),
      })
    }))
    const conditionalApplicationReads = conditionalApplicationReadOutcomes.map(
      (outcome) => outcome.responses.at(-1)?.response ?? {},
    )
    const baselineConditionalBytes = conditionalBaselines.reduce(
      (total, result) => total + Number(result.transferBodyBytes ?? 0),
      0,
    )
    const conditionalTransferBytes = conditionalApplicationReads.reduce(
      (total, result) => total + Number(result.transferBodyBytes ?? 0),
      0,
    )
    const estimatedBodyBytesSaved = Math.max(0, baselineConditionalBytes - conditionalTransferBytes)
    report.phases.conditionalApplicationReads = {
      ...summarizeLatencies(conditionalApplicationReadOutcomes.map((outcome) => outcome.elapsedMs)),
      attempted: options.virtualUsers,
      baselineSuccesses: conditionalBaselineOutcomes.filter((outcome) => outcome.kind === 'success').length,
      baselineEtags: conditionalBaselines.filter((baseline) => Boolean(baseline.headers?.etag)).length,
      baselineStatuses: conditionalBaselines.map((baseline) => baseline.status ?? 0),
      notModified304: conditionalApplicationReads.filter((result) => result.status === 304).length,
      revalidationStatuses: conditionalApplicationReads.map((result) => result.status ?? 0),
      capacityRetries: [...conditionalBaselineOutcomes, ...conditionalApplicationReadOutcomes].reduce(
        (total, outcome) => total + outcome.attempts - 1,
        0,
      ),
      baselineExhausted: conditionalBaselineOutcomes.filter((outcome) => outcome.kind === 'exhausted').length,
      baselineUnexpected: conditionalBaselineOutcomes.filter((outcome) => outcome.kind === 'unexpected').length,
      exhausted: conditionalApplicationReadOutcomes.filter((outcome) => outcome.kind === 'exhausted').length,
      unexpected: conditionalApplicationReadOutcomes.filter((outcome) => outcome.kind === 'unexpected').length,
      baselineTransferBodyBytes: baselineConditionalBytes,
      conditionalTransferBodyBytes: conditionalTransferBytes,
      estimatedBodyBytesSaved,
      estimatedSavingsPercent: baselineConditionalBytes > 0
        ? rounded((estimatedBodyBytesSaved / baselineConditionalBytes) * 100)
        : 0,
    }
    report.checks.allConditionalReadsNotModified = conditionalBaselineOutcomes.every(
      (outcome) => outcome.kind === 'success',
    ) && conditionalApplicationReadOutcomes.every((outcome) => outcome.kind === 'success')
    supervisor.completePhase({
      requests: conditionalBaselines.length + conditionalApplicationReads.length,
      notModified: report.phases.conditionalApplicationReads.notModified304,
      bytesSaved: estimatedBodyBytesSaved,
    })

    supervisor.startPhase('sse-connections')
    const sseStarted = performance.now()
    for (let offset = 0; offset < options.virtualUsers; offset += options.sseBatchSize) {
      const batch = tokens.slice(offset, offset + options.sseBatchSize)
      const clients = await Promise.all(batch.map((token, batchIndex) => (
        openSseClient(
          baseUrl,
          token,
          offset + batchIndex,
          supervisor.signal,
          options.requestTimeoutMs,
        )
      )))
      sseClients.push(...clients)
      if (offset + options.sseBatchSize < options.virtualUsers) await sleep(25, supervisor.signal)
    }
    report.phases.sseConnections = {
      requested: options.virtualUsers,
      connected: sseClients.filter((client) => (
        client.status === 200 && client.connectedEvent?.type === 'connected'
      )).length,
      batches: Math.ceil(options.virtualUsers / options.sseBatchSize),
      totalMs: rounded(performance.now() - sseStarted),
    }
    report.checks.allSseClientsConnected = report.phases.sseConnections.connected === options.virtualUsers
    supervisor.completePhase({
      requested: options.virtualUsers,
      connected: report.phases.sseConnections.connected,
    })

    supervisor.startPhase('distinct-account-writes')
    const distinctSseWindow = await prepareSseObservationWindow(
      sseClients.slice(0, options.writeUsers),
      { signal: supervisor.signal },
    )
    const writeResults = await Promise.all(Array.from({ length: options.writeUsers }, async (_, index) => {
      const application = ownedApplications[index]
      const marker = `different-account-write-${runId}-${index}`
      const desiredApplication = { ...application, program: marker }
      const watcherController = new AbortController()
      const writeEventPromise = nextSseInvalidationAfterRevision(
        sseClients[index],
        distinctSseWindow.baselines[index],
        30_000,
        combinedAbortSignal([supervisor.signal, watcherController.signal]),
      ).then(
        (event) => ({ event }),
        (error) => ({ error: toQaFailureDiagnostic(error, { phase: 'distinct-account-writes:sse' }) }),
      )
      const outcome = await executeRetriableOverloadWrite({
        index,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => qaApplicationMutationAcknowledged(response, application.id),
        write: (attempt) => http.request(
          `${baseUrl}/api/applications/${encodeURIComponent(application.id)}`,
          {
            method: 'PUT',
            headers: authHeaders(tokens[index], {
              'content-type': 'application/json',
              'x-phd-client-id': `qa-writer-${index}-${attempt}`,
            }),
            body: JSON.stringify(desiredApplication),
          },
          { allowServerBusy: true, phase: 'distinctAccountWrites.write' },
        ),
      })
      if (outcome.kind !== 'success') {
        watcherController.abort(new Error('Distinct write was not accepted'))
      }
      return {
        outcome,
        response: outcome.responses.at(-1)?.response,
        writeEventPromise,
        marker,
        applicationId: application.id,
        desiredApplication,
        index,
      }
    }))
    for (const write of writeResults) {
      write.canonicalMismatchFields = write.response?.status === 200
        ? qaApplicationShapeDifferencePaths(
            write.response.payload?.data,
            write.desiredApplication,
            20,
          )
        : []
    }
    const writeEvents = await Promise.all(writeResults.map((write) => write.writeEventPromise))
    const writeReadbacks = await Promise.all(writeResults.map(async (write) => ({
      ...write,
      readbackOutcome: write.outcome.kind === 'success'
        ? await executeRetriableServerBusyOperation({
            index: write.index,
            maxRetries: options.overloadRetries,
            signal: supervisor.signal,
            isAccepted: (response) => response?.status === 200
              && response?.payload?.data?.id === write.applicationId
              && qaApplicationMatchesExpected(response.payload.data, write.desiredApplication),
            operation: () => http.request(
              `${baseUrl}/api/applications/${encodeURIComponent(write.applicationId)}`,
              { headers: authHeaders(tokens[write.index]) },
              { allowServerBusy: true, phase: 'distinctAccountWrites.readback' },
            ),
          })
        : null,
      readback: null,
    })))
    for (const write of writeReadbacks) {
      write.readback = write.readbackOutcome?.responses.at(-1)?.response ?? null
    }
    for (const write of writeReadbacks) {
      const acknowledged = write.outcome.kind === 'success'
      const acknowledgedApplication = advanceQaDurableApplicationExpectation({
        acknowledged,
        acknowledgement: write.response?.payload?.data,
        applicationId: write.applicationId,
        desiredApplication: write.desiredApplication,
        expectedPrograms,
        expectedTags,
        expectedApplications,
      })
      if (acknowledgedApplication) {
        ownedApplications[write.index] = write.readbackOutcome?.kind === 'success'
          ? write.readback.payload.data
          : acknowledgedApplication
      }
    }
    const missingDistinctWrites = writeReadbacks.filter((write) => (
      write.outcome.kind === 'success'
      && write.readback?.status === 200
      && !qaApplicationMatchesExpected(write.readback?.payload?.data, write.desiredApplication)
    ))
    report.dataLoss.acceptedWritesMissing.push(...missingDistinctWrites.map((write) => ({
      phase: 'different-account-write',
      applicationId: write.applicationId,
      marker: write.marker,
    })))
    report.phases.distinctAccountWrites = {
      ...summarizeLatencies(writeResults.map((write) => write.outcome.elapsedMs)),
      attempted: options.writeUsers,
      successes: writeResults.filter((write) => write.outcome.kind === 'success').length,
      durableReadbacks: writeReadbacks.filter((write) => (
        write.readbackOutcome?.kind === 'success'
      )).length,
      sseInvalidations: writeEvents.filter((observation, index) => (
        writeResults[index].outcome.kind === 'success'
        && observation.event?.type === 'invalidate'
      )).length,
      capacityRetries: writeResults.reduce((total, write) => total + write.outcome.attempts - 1, 0),
      exhausted: writeResults.filter((write) => write.outcome.kind === 'exhausted').length,
      unexpected: writeResults.filter((write) => write.outcome.kind === 'unexpected').length,
      statuses: writeResults.map((write) => write.response.status),
      failures: writeResults.filter((write) => write.outcome.kind !== 'success').map((write) => ({
        ...compactHttpResult(write.response),
        canonicalMismatchFields: write.canonicalMismatchFields,
      })),
    }
    report.checks.distinctWritesReadable = missingDistinctWrites.length === 0
      && report.phases.distinctAccountWrites.successes === options.writeUsers
      && report.phases.distinctAccountWrites.durableReadbacks === options.writeUsers
    report.checks.ownSseInvalidationsDelivered = report.phases.distinctAccountWrites.sseInvalidations === options.writeUsers
    supervisor.completePhase({
      attempted: options.writeUsers,
      successes: report.phases.distinctAccountWrites.successes,
      durableReadbacks: report.phases.distinctAccountWrites.durableReadbacks,
    })

    supervisor.startPhase('sse-account-scope')
    const scopedBase = writeReadbacks[0]?.readbackOutcome?.kind === 'success'
      ? writeReadbacks[0].readback?.payload?.data
      : null
    if (!scopedBase?.id) {
      const error = new Error('SSE account-scope phase requires one accepted durable distinct-account write')
      error.code = 'QA_SSE_SCOPE_BASE_UNAVAILABLE'
      error.details = {
        writeOutcome: writeReadbacks[0]?.outcome?.kind ?? 'missing',
        readbackOutcome: writeReadbacks[0]?.readbackOutcome?.kind ?? 'missing',
        response: compactHttpResult(writeReadbacks[0]?.readback ?? writeReadbacks[0]?.response ?? {}),
      }
      throw error
    }
    const observerIndexes = Array.from(
      { length: Math.min(options.sseObservers, Math.max(0, options.virtualUsers - 1)) },
      (_, index) => index + 1,
    )
    const sseScopeWindow = await prepareSseObservationWindow(sseClients, {
      signal: supervisor.signal,
    })
    const targetSsePromise = nextSseInvalidationAfterRevision(
      sseClients[0],
      sseScopeWindow.baselines[0],
      15_000,
      supervisor.signal,
    )
    const observerWatches = observerIndexes.map((index) => observeSseQuiet(
      sseClients[index],
      options.sseIsolationWindowMs,
      supervisor.signal,
    ))
    const scopedMarker = `sse-scope-${runId}`
    const scopedWrite = await http.request(`${baseUrl}/api/applications/${encodeURIComponent(scopedBase.id)}`, {
      method: 'PUT',
      headers: authHeaders(tokens[0], {
        'content-type': 'application/json',
        'x-phd-client-id': 'qa-sse-scope-writer',
      }),
      body: JSON.stringify({ ...scopedBase, program: scopedMarker }),
    }, { phase: 'sseAccountScope' })
    const scopedReadback = await http.request(
      `${baseUrl}/api/applications/${encodeURIComponent(scopedBase.id)}`,
      { headers: authHeaders(tokens[0]) },
      { phase: 'sseAccountScope.readback' },
    )
    const scopedWriteDurable = scopedWrite.ok && scopedReadback.payload?.data?.program === scopedMarker
    if (scopedWriteDurable) {
      ownedApplications[0] = scopedReadback.payload.data
      expectedPrograms.set(scopedBase.id, scopedMarker)
      expectedTags.set(scopedBase.id, [...(scopedReadback.payload.data.tags ?? [])])
    } else if (scopedWrite.ok) {
      report.dataLoss.acceptedWritesMissing.push({
        phase: 'sse-account-scope',
        applicationId: scopedBase.id,
        marker: scopedMarker,
      })
    }
    const targetSseEvent = await targetSsePromise.catch((error) => ({ error: error.message }))
    const observerEvents = await Promise.all(observerWatches)
    const isolationAssessment = assessQaSseIsolation({
      mutationDurable: scopedWriteDurable,
      targetEvent: targetSseEvent,
      observerEvents,
    })
    const { leakedObserverEvents, quietObservers, observerErrors } = isolationAssessment
    report.phases.sseAccountScope = {
      targetMutationStatus: scopedWrite.status,
      targetMutationDurable: scopedWriteDurable,
      targetInvalidationDelivered: targetSseEvent?.type === 'invalidate',
      observers: observerIndexes.length,
      quietObservers: quietObservers.length,
      observerErrors: observerErrors.length,
      observationWindowMs: options.sseIsolationWindowMs,
      unexpectedObserverInvalidations: leakedObserverEvents.length,
      discardedPreexistingEvents: sseScopeWindow.discardedEvents,
    }
    report.checks.sseEventsStayedAccountScoped = isolationAssessment.passed
    supervisor.completePhase({
      observers: observerIndexes.length,
      quietObservers: quietObservers.length,
      observerErrors: observerErrors.length,
      unexpectedInvalidations: leakedObserverEvents.length,
    })

    supervisor.startPhase('concurrent-login')
    const loginOffset = Math.max(0, options.virtualUsers - options.loginUsers)
    const loginStarted = performance.now()
    const loginTokens = new Array(options.virtualUsers)
    const loginRecords = await Promise.all(fixtures.users.slice(loginOffset).map(async (user, index) => {
      const userIndex = loginOffset + index
      const outcome = await executeRetriableLogin({
        index: userIndex,
        budgetMs: options.loginRetryBudgetMs,
        signal: supervisor.signal,
        login: (attempt) => http.request(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-phd-client-id': `qa-login-${userIndex}-${attempt}`,
          },
          body: JSON.stringify({ email: user.email, password: qaPassword, scope: 'app' }),
        }, { allowAuthCapacity: true, allowServerBusy: true, phase: 'concurrentLogin' }),
      })
      if (outcome.kind !== 'success') return { userIndex, user, outcome }
      const token = outcome.responses.at(-1)?.response?.payload?.data?.token
      loginTokens[userIndex] = token
      // Verify each returned credential immediately. The read-isolation phase
      // above uses synthetic fixture JWTs intentionally; these requests ensure
      // real login issuance cannot swap accounts or reuse another user's token.
      const identityOutcome = await executeRetriableServerBusyOperation({
        index: userIndex * 2,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 200,
        operation: () => http.request(
          `${baseUrl}/api/auth/me`,
          { headers: authHeaders(token) },
          { allowServerBusy: true, phase: 'concurrentLogin.identity' },
        ),
      })
      const isolatedReadOutcome = await executeRetriableServerBusyOperation({
        index: userIndex * 2 + 1,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.status === 200,
        operation: () => http.request(
          `${baseUrl}/api/applications`,
          { headers: authHeaders(token) },
          { allowServerBusy: true, phase: 'concurrentLogin.isolatedRead' },
        ),
      })
      const identity = identityOutcome.responses.at(-1)?.response ?? {}
      const isolatedRead = isolatedReadOutcome.responses.at(-1)?.response ?? {}
      const rows = isolatedRead.payload?.data ?? []
      return {
        userIndex,
        user,
        outcome,
        identityOutcome,
        isolatedReadOutcome,
        identityVerified: identityOutcome.kind === 'success'
          && identity.payload?.data?.user?.id === user.id,
        isolatedReadVerified: isolatedReadOutcome.kind === 'success'
          && rows.length === 1
          && rows[0]?.id === fixtures.applications[userIndex].id,
      }
    }))
    const loginOutcomes = loginRecords.map((record) => record.outcome)
    const loginResponses = loginOutcomes.flatMap((outcome) => outcome.responses)
    const firstLoginResponses = loginOutcomes.map((outcome) => outcome.responses[0])
    const structuredCapacityResponses = loginResponses.filter((entry) => (
      entry.classification.kind === 'auth-capacity'
      || entry.classification.kind === 'request-capacity'
    ))
    const failedLogins = loginOutcomes.filter((outcome) => outcome.kind !== 'success')
    report.phases.concurrentLogin = {
      ...summarizeLatencies(loginOutcomes.map((outcome) => outcome.elapsedMs)),
      attempted: options.loginUsers,
      retryBudgetMs: options.loginRetryBudgetMs,
      totalMs: rounded(performance.now() - loginStarted),
      attempts: loginResponses.length,
      retryAttempts: loginOutcomes.reduce((total, outcome) => total + outcome.attempts - 1, 0),
      firstAttemptLatency: summarizeLatencies(
        firstLoginResponses.map((entry) => entry.response.ms),
      ),
      allAttemptLatency: summarizeLatencies(loginResponses.map((entry) => entry.response.ms)),
      retryDelay: summarizeLatencies(loginOutcomes.flatMap((outcome) => outcome.retryDelaysMs)),
      firstAttemptSuccesses: firstLoginResponses.filter(
        (entry) => entry.classification.kind === 'success',
      ).length,
      firstAttemptStructuredCapacity: firstLoginResponses.filter(
        (entry) => entry.classification.kind === 'auth-capacity'
          || entry.classification.kind === 'request-capacity',
      ).length,
      requestBodyCapacityResponses: loginResponses.filter(
        (entry) => entry.classification.kind === 'request-capacity',
      ).length,
      structuredCapacityResponses: structuredCapacityResponses.length,
      finalSuccesses: loginOutcomes.filter((outcome) => outcome.kind === 'success').length,
      identitiesVerified: loginRecords.filter((record) => record.identityVerified).length,
      isolatedReadsVerified: loginRecords.filter((record) => record.isolatedReadVerified).length,
      verificationCapacityRetries: loginRecords.reduce((total, record) => (
        total
          + Math.max(0, Number(record.identityOutcome?.attempts ?? 1) - 1)
          + Math.max(0, Number(record.isolatedReadOutcome?.attempts ?? 1) - 1)
      ), 0),
      verificationExhausted: loginRecords.filter((record) => (
        record.identityOutcome?.kind === 'exhausted'
        || record.isolatedReadOutcome?.kind === 'exhausted'
      )).length,
      exhausted: loginOutcomes.filter((outcome) => outcome.kind === 'exhausted').length,
      unexpected: loginOutcomes.filter((outcome) => outcome.kind === 'unexpected').length,
      failures: failedLogins.map((outcome) => ({
        kind: outcome.kind,
        attempts: outcome.attempts,
        lastResponse: compactHttpResult(outcome.responses.at(-1)?.response ?? {}),
      })),
    }
    report.checks.allLoginsCompleted = report.phases.concurrentLogin.finalSuccesses === options.loginUsers
      && failedLogins.length === 0
    report.checks.allLoginTokensVerified = report.phases.concurrentLogin.identitiesVerified === options.loginUsers
    report.checks.loginTokenReadsIsolated = report.phases.concurrentLogin.isolatedReadsVerified === options.loginUsers
    supervisor.completePhase({
      attempted: options.loginUsers,
      completed: report.phases.concurrentLogin.finalSuccesses,
      identitiesVerified: report.phases.concurrentLogin.identitiesVerified,
      retries: report.phases.concurrentLogin.retryAttempts,
    })

    supervisor.startPhase('same-entity-conflict')
    const conflictOwner = ownedApplications[0]
    if (!conflictOwner?.id) {
      const error = new Error('Same-entity conflict phase requires a durable owned application')
      error.code = 'QA_SAME_ENTITY_BASE_UNAVAILABLE'
      throw error
    }
    const conflictBaseOutcome = await executeRetriableServerBusyOperation({
      index: 0,
      maxRetries: options.overloadRetries,
      signal: supervisor.signal,
      isAccepted: (response) => response?.status === 200
        && response?.payload?.data?.id === conflictOwner.id,
      operation: () => http.request(
        `${baseUrl}/api/applications/${encodeURIComponent(conflictOwner.id)}`,
        { headers: authHeaders(tokens[0]) },
        { allowServerBusy: true, phase: 'sameEntityConflict.base' },
      ),
    })
    const conflictBaseResponse = conflictBaseOutcome.responses.at(-1)?.response ?? {}
    const conflictBase = conflictBaseOutcome.kind === 'success'
      ? conflictBaseResponse.payload?.data
      : null
    if (!conflictBase?.id) {
      const error = new Error('Same-entity conflict base could not be read durably')
      error.code = 'QA_SAME_ENTITY_BASE_UNAVAILABLE'
      error.details = {
        outcome: conflictBaseOutcome.kind,
        attempts: conflictBaseOutcome.attempts,
        response: compactHttpResult(conflictBaseResponse),
      }
      throw error
    }
    const programMarker = `same-entity-program-${runId}`
    const tagMarker = `same-entity-tag-${runId}`
    const [programWrite, tagWrite] = await Promise.all([
      http.request(`${baseUrl}/api/applications/${encodeURIComponent(conflictBase.id)}`, {
        method: 'PUT',
        headers: authHeaders(tokens[0], {
          'content-type': 'application/json',
          'x-phd-client-id': 'qa-same-entity-program',
        }),
        body: JSON.stringify({
          ...conflictBase,
          program: programMarker,
          clientBaseApplication: conflictBase,
        }),
      }, { phase: 'sameEntityConflict.write' }),
      http.request(`${baseUrl}/api/applications/${encodeURIComponent(conflictBase.id)}`, {
        method: 'PUT',
        headers: authHeaders(tokens[0], {
          'content-type': 'application/json',
          'x-phd-client-id': 'qa-same-entity-tag',
        }),
        body: JSON.stringify({
          ...conflictBase,
          tags: [...new Set([...(conflictBase.tags ?? []), tagMarker])],
          clientBaseApplication: conflictBase,
        }),
      }, { phase: 'sameEntityConflict.write' }),
    ])
    const conflictReadback = await http.request(
      `${baseUrl}/api/applications/${encodeURIComponent(conflictBase.id)}`,
      { headers: authHeaders(tokens[0]) },
      { phase: 'sameEntityConflict.readback' },
    )
    const finalApplication = conflictReadback.payload?.data
    const programPreserved = finalApplication?.program === programMarker
    const tagPreserved = finalApplication?.tags?.includes(tagMarker) === true
    const conflictAssessment = assessSameEntityConflict({
      programStatus: programWrite.status,
      tagStatus: tagWrite.status,
      programPreserved,
      tagPreserved,
    })
    const expectedConflictApplication = {
      ...conflictBase,
      ...(successfulHttpStatus(programWrite.status) ? { program: programMarker } : {}),
      ...(successfulHttpStatus(tagWrite.status)
        ? { tags: [...new Set([...(conflictBase.tags ?? []), tagMarker])] }
        : {}),
    }
    const fullApplicationPreserved = conflictReadback.status === 200
      && qaApplicationMatchesExpected(finalApplication, expectedConflictApplication)
    if (finalApplication?.id) {
      ownedApplications[0] = finalApplication
      expectedPrograms.set(finalApplication.id, expectedConflictApplication.program)
      expectedTags.set(finalApplication.id, [...(expectedConflictApplication.tags ?? [])])
      expectedApplications.set(finalApplication.id, structuredClone(expectedConflictApplication))
    }
    if (conflictAssessment.lostAcceptedFields.includes('program')) {
      report.dataLoss.acceptedWritesMissing.push({ phase: 'same-entity-write', field: 'program', marker: programMarker })
    }
    if (conflictAssessment.lostAcceptedFields.includes('tags')) {
      report.dataLoss.acceptedWritesMissing.push({ phase: 'same-entity-write', field: 'tags', marker: tagMarker })
    }
    if (
      (successfulHttpStatus(programWrite.status) || successfulHttpStatus(tagWrite.status))
      && !fullApplicationPreserved
    ) {
      report.dataLoss.acceptedWritesMissing.push({
        phase: 'same-entity-write',
        field: 'application',
        applicationId: conflictBase.id,
      })
    }
    report.phases.sameEntityConflict = {
      statuses: [programWrite.status, tagWrite.status],
      merged: conflictAssessment.merged,
      explicitConflict: conflictAssessment.explicitConflict,
      programPreserved,
      tagPreserved,
      fullApplicationPreserved,
      silentLostUpdate: conflictAssessment.silentLostUpdate,
    }
    report.checks.sameEntityConflictSafe = conflictAssessment.conflictSafe
    report.checks.acceptedSameEntityWritesReadable = conflictAssessment.acceptedWritesReadable
      && fullApplicationPreserved
    supervisor.completePhase({
      conflictSafe: conflictAssessment.conflictSafe,
      acceptedWritesReadable: conflictAssessment.acceptedWritesReadable,
    })

    supervisor.startPhase('overload-writes')
    let overloadSseObservations = []
    let overloadSseWindow
    let bodyAdmissionProbe = null
    report.phases.bodyAdmissionBackpressure = { skipped: !options.qualification }
    report.checks.bodyAdmissionBackpressureObserved = false
    report.checks.bodyAdmissionBackpressureRecovered = false
    if (options.qualification) {
      const probeApplication = ownedApplications[0]
      const admissionSnapshot = async () => {
        const diagnostics = await requestQaWorkerDiagnostics(primaryWorker, {
          timeoutMs: Math.min(options.requestTimeoutMs, 5_000),
          signal: supervisor.signal,
          phase: 'body-admission:worker-diagnostics',
        })
        return diagnostics?.requestBodyAdmission
      }
      if (!probeApplication?.id || !primaryWorker) {
        const error = new Error('Qualification cannot access its isolated request-body admission owner')
        error.code = 'QA_BODY_ADMISSION_PROBE_UNAVAILABLE'
        throw error
      }
      const probeMarker = `body-admission-recovery-${runId}`
      const probeExpectedBase = expectedApplications.get(probeApplication.id) ?? probeApplication
      const probeDesiredApplication = {
        ...structuredClone(probeExpectedBase),
        updatedAt: probeApplication.updatedAt,
        program: probeMarker,
      }
      const probeBody = JSON.stringify(probeDesiredApplication)
      const admissionCapacity = compactQaAdmissionSnapshot(await admissionSnapshot())
      const bodyAdmissionHolderCount = admissionCapacity.maxActive + admissionCapacity.maxQueued
      const bodyAdmissionHolderTokens = Array.from({ length: bodyAdmissionHolderCount }, (_, index) => (
        jwt.sign({
          sub: `qa-body-admission-holder-${runId}-${index}`,
          role: 'user',
          scope: 'app',
          authVersion: 0,
        }, process.env.JWT_SECRET, {
          algorithm: 'HS256',
          issuer: 'phd-atlas',
          audience: 'phd-atlas-api',
          jwtid: randomUUID(),
          expiresIn: '15m',
        })
      ))
      bodyAdmissionProbe = await probeQaRequestBodyBackpressure({
        baseUrl,
        pathname: `/api/applications/${encodeURIComponent(probeApplication.id)}`,
        holderTokens: bodyAdmissionHolderTokens,
        probeToken: tokens[0],
        body: probeBody,
        request: http.request,
        snapshot: admissionSnapshot,
        signal: supervisor.signal,
        timeoutMs: Math.min(options.phaseTimeoutMs, 15_000),
        expectedMaxActive: QUALIFICATION_MINIMUMS.bodyAdmissionActive,
        expectedMaxQueued: QUALIFICATION_MINIMUMS.bodyAdmissionQueued,
        seed: 0,
        isRetryAccepted: (response) => qaApplicationMutationAcknowledged(
          response,
          probeApplication.id,
        ) || (
          response?.status === 200
          && response?.payload?.data?.id === probeApplication.id
          && qaApplicationMatchesExpected(response.payload.data, probeDesiredApplication)
        ),
      })
      const recoveredApplication = bodyAdmissionProbe.readbackResponse.payload.data
      ownedApplications[0] = recoveredApplication
      expectedPrograms.set(recoveredApplication.id, recoveredApplication.program)
      expectedTags.set(recoveredApplication.id, [...(probeDesiredApplication.tags ?? [])])
      expectedApplications.set(recoveredApplication.id, structuredClone(probeDesiredApplication))
      const busyClassification = classifyOverloadWriteResponse(bodyAdmissionProbe.busyResponse)
      report.http.expectedServerBusy.count += 1
      if (report.http.expectedServerBusy.examples.length < 10) {
        report.http.expectedServerBusy.examples.push(compactHttpResult(bodyAdmissionProbe.busyResponse))
      }
      const rejectionCounterDelta = bodyAdmissionProbe.afterBusy.rejected
        - bodyAdmissionProbe.saturated.rejected
      report.phases.bodyAdmissionBackpressure = {
        attempted: 1,
        holders: bodyAdmissionProbe.holderCount,
        rawHttpRequests: bodyAdmissionProbe.holderCount + 1,
        admissionScope: 'global-active-and-queue',
        configuredActive: bodyAdmissionProbe.before.maxActive,
        configuredQueued: bodyAdmissionProbe.before.maxQueued,
        structuredServerBusy: busyClassification.kind === 'server-busy' ? 1 : 0,
        rejectionCounterDelta,
        perKeyRejectionCounterDelta: bodyAdmissionProbe.afterBusy.perKeyRejected
          - bodyAdmissionProbe.saturated.perKeyRejected,
        retryAfter: busyClassification.retryAfter,
        retryAfterMs: busyClassification.explicitRetryAfterMs,
        retryDelayMs: bodyAdmissionProbe.retryDelayMs,
        successfulRetries: 1,
        durableReadbacks: 1,
        healthyAfterRelease: true,
        before: bodyAdmissionProbe.before,
        saturated: bodyAdmissionProbe.saturated,
        afterBusy: bodyAdmissionProbe.afterBusy,
        released: bodyAdmissionProbe.released,
        busyResponse: compactHttpResult(bodyAdmissionProbe.busyResponse),
        healthDuringSaturation: compactHttpResult(bodyAdmissionProbe.healthDuringSaturation),
        retryResponse: compactHttpResult(bodyAdmissionProbe.retryResponse),
        readbackResponse: compactHttpResult(bodyAdmissionProbe.readbackResponse),
        healthAfter: compactHttpResult(bodyAdmissionProbe.healthResponse),
        readinessAfter: compactHttpResult(bodyAdmissionProbe.readinessResponse),
      }
      report.checks.bodyAdmissionBackpressureObserved = busyClassification.kind === 'server-busy'
        && rejectionCounterDelta === 1
        && bodyAdmissionProbe.afterBusy.perKeyRejected === bodyAdmissionProbe.saturated.perKeyRejected
      report.checks.bodyAdmissionBackpressureRecovered = qaApplicationMutationAcknowledged(
        bodyAdmissionProbe.retryResponse,
        probeApplication.id,
      )
        && qaApplicationMatchesExpected(recoveredApplication, probeDesiredApplication)
        && bodyAdmissionProbe.released.active === 0
        && bodyAdmissionProbe.released.waiting === 0
        && bodyAdmissionProbe.released.activeKeys === 0
        && bodyAdmissionProbe.released.queuedKeys === 0
        && qaApplicationMatchesExpected(
          bodyAdmissionProbe.readbackResponse.payload?.data,
          probeDesiredApplication,
        )
        && bodyAdmissionProbe.healthResponse.status === 200
        && bodyAdmissionProbe.readinessResponse.status === 200
    }
    if (options.overloadWrites > 0) {
      const overloadBases = await Promise.all(Array.from({ length: options.overloadWrites }, async (_, index) => {
        const applicationId = fixtures.applications[index].id
        const expectedBase = expectedApplications.get(applicationId)
        const outcome = await executeRetriableServerBusyOperation({
          index,
          maxRetries: options.overloadRetries,
          signal: supervisor.signal,
          isAccepted: (response) => response?.status === 200
            && response?.payload?.data?.id === applicationId
            && qaApplicationMatchesExpected(response.payload.data, expectedBase),
          operation: () => http.request(
            `${baseUrl}/api/applications/${encodeURIComponent(applicationId)}`,
            { headers: authHeaders(tokens[index]) },
            { allowServerBusy: true, phase: 'overloadWrites.base' },
          ),
        })
        const response = outcome.responses.at(-1)?.response ?? {}
        if (outcome.kind !== 'success' || !response.payload?.data?.id) {
          const error = new Error(`Could not load overload write base for virtual user ${index}`)
          error.code = 'QA_OVERLOAD_BASE_UNAVAILABLE'
          error.details = {
            outcome: outcome.kind,
            attempts: outcome.attempts,
            response: compactHttpResult(response),
          }
          throw error
        }
        return response.payload.data
      }))
      if (options.qualification) {
        overloadSseWindow = await prepareSseObservationWindow(sseClients, {
          signal: supervisor.signal,
        })
      }
      const overloadResults = await Promise.all(overloadBases.map(async (application, index) => {
        const marker = `overload-write-${runId}-${index}`
        const desiredApplication = {
          ...structuredClone(expectedApplications.get(application.id) ?? application),
          updatedAt: application.updatedAt,
          program: marker,
        }
        const outcome = await executeRetriableOverloadWrite({
          index,
          maxRetries: options.overloadRetries,
          signal: supervisor.signal,
          isAccepted: (response) => qaApplicationMutationAcknowledged(response, application.id),
          write: (attempt) => http.request(
            `${baseUrl}/api/applications/${encodeURIComponent(application.id)}`,
            {
              method: 'PUT',
              headers: authHeaders(tokens[index], {
                'content-type': 'application/json',
                'x-phd-client-id': `qa-overload-${index}-${attempt}`,
              }),
              body: JSON.stringify(desiredApplication),
            },
            { allowServerBusy: true, phase: 'overloadWrites.write' },
          ),
        })
        return {
          ...outcome,
          marker,
          applicationId: application.id,
          desiredApplication,
          index,
        }
      }))
      const overloadReadbacks = await Promise.all(overloadResults.map(async (outcome) => {
        const readbackOutcome = outcome.kind === 'success'
          ? await executeRetriableServerBusyOperation({
              index: outcome.index,
              maxRetries: options.overloadRetries,
              signal: supervisor.signal,
              isAccepted: (response) => response?.status === 200
                && response?.payload?.data?.id === outcome.applicationId
                && qaApplicationMatchesExpected(response.payload.data, outcome.desiredApplication),
              operation: () => http.request(
                `${baseUrl}/api/applications/${encodeURIComponent(outcome.applicationId)}`,
                { headers: authHeaders(tokens[outcome.index]) },
                { allowServerBusy: true, phase: 'overloadWrites.readback' },
              ),
            })
          : null
        return {
          ...outcome,
          readbackOutcome,
          readback: readbackOutcome?.responses.at(-1)?.response ?? null,
        }
      }))
      for (const outcome of overloadReadbacks) {
        const acknowledged = outcome.kind === 'success'
        const acknowledgedApplication = advanceQaDurableApplicationExpectation({
          acknowledged,
          acknowledgement: outcome.responses.at(-1)?.response?.payload?.data,
          applicationId: outcome.applicationId,
          desiredApplication: outcome.desiredApplication,
          expectedPrograms,
          expectedTags,
          expectedApplications,
        })
        if (acknowledgedApplication) {
          ownedApplications[outcome.index] = outcome.readbackOutcome?.kind === 'success'
            ? outcome.readback.payload.data
            : acknowledgedApplication
        }
      }
      const missingAcceptedOverloadWrites = overloadReadbacks.filter((outcome) => (
        outcome.kind === 'success'
        && outcome.readback?.status === 200
        && !qaApplicationMatchesExpected(outcome.readback?.payload?.data, outcome.desiredApplication)
      ))
      report.dataLoss.acceptedWritesMissing.push(...missingAcceptedOverloadWrites.map((outcome) => ({
        phase: 'overload-write',
        applicationId: outcome.applicationId,
        marker: outcome.marker,
      })))
      const overloadResponses = overloadResults.flatMap((outcome) => outcome.responses)
      const firstResponses = overloadResults.map((outcome) => outcome.responses[0])
      const structuredBusyResponses = overloadResponses.filter((entry) => (
        entry.classification.kind === 'server-busy'
      ))
      const overloadFailures = overloadReadbacks.filter((outcome) => (
        outcome.kind !== 'success' || outcome.readbackOutcome?.kind !== 'success'
      ))
      report.phases.overloadWrites = {
        attempted: options.overloadWrites,
        maximumRetries: options.overloadRetries,
        firstAttemptLatency: summarizeLatencies(firstResponses.map((entry) => entry.response.ms)),
        allAttemptLatency: summarizeLatencies(overloadResponses.map((entry) => entry.response.ms)),
        endToEndLatency: summarizeLatencies(overloadResults.map((outcome) => outcome.elapsedMs)),
        retryDelay: summarizeLatencies(overloadResults.flatMap((outcome) => outcome.retryDelaysMs)),
        firstAttemptSuccesses: firstResponses.filter((entry) => entry.classification.kind === 'success').length,
        firstAttemptServerBusy: firstResponses.filter((entry) => entry.classification.kind === 'server-busy').length,
        structuredServerBusy: structuredBusyResponses.length,
        retryAttempts: overloadResults.reduce((total, outcome) => total + outcome.attempts - 1, 0),
        finalSuccesses: overloadResults.filter((outcome) => outcome.kind === 'success').length,
        exhausted: overloadResults.filter((outcome) => outcome.kind === 'exhausted').length,
        unexpected: overloadResults.filter((outcome) => outcome.kind === 'unexpected').length,
        durableReadbacks: overloadReadbacks.filter((outcome) => (
          outcome.readbackOutcome?.kind === 'success'
        )).length,
        failureCount: overloadFailures.length,
        failureEvidenceLimit: QA_FAILURE_DIAGNOSTIC_LIMIT,
        failuresTruncated: Math.max(0, overloadFailures.length - QA_FAILURE_DIAGNOSTIC_LIMIT),
        failures: summarizeQaOverloadFailures(overloadReadbacks),
      }
      report.checks.overloadResponsesStructured = overloadResponses.every((entry) => (
        entry.classification.kind === 'success' || entry.classification.kind === 'server-busy'
      ))
      report.checks.overloadWritesEventuallyReadable = report.phases.overloadWrites.finalSuccesses === options.overloadWrites
        && report.phases.overloadWrites.durableReadbacks === options.overloadWrites
        && missingAcceptedOverloadWrites.length === 0
      report.checks.overloadObservedStructuredBusy = structuredBusyResponses.length > 0
        || report.checks.bodyAdmissionBackpressureObserved
    } else {
      report.phases.overloadWrites = { skipped: true, attempted: 0 }
      report.checks.overloadResponsesStructured = true
      report.checks.overloadWritesEventuallyReadable = true
      report.checks.overloadObservedStructuredBusy = report.checks.bodyAdmissionBackpressureObserved
    }
    if (options.qualification && options.overloadWrites > 0) {
      // Establish the revision boundary before the writes, but start the
      // delivery grace period only after every retried write and durable
      // readback has settled. SSE clients queue their bounded event stream, so
      // a deliberately overloaded phase cannot consume the observation timeout
      // before a late-but-successful mutation is even accepted.
      overloadSseObservations = sseClients
        .slice(0, options.overloadWrites)
        .map((client, index) => nextSseInvalidationAfterRevision(
          client,
          overloadSseWindow.baselines[index],
          Math.min(options.phaseTimeoutMs, Math.max(30_000, options.requestTimeoutMs)),
          supervisor.signal,
        ).then(
          (event) => ({ event }),
          (error) => ({ error: toQaFailureDiagnostic(error, { phase: 'overload-writes:sse' }) }),
        ))
      const overloadSseEvents = await Promise.all(overloadSseObservations)
      report.phases.overloadWrites.sseInvalidations = overloadSseEvents.filter((result) => result.event).length
      report.phases.overloadWrites.sseObservationErrors = overloadSseEvents.filter((result) => result.error).length
      report.phases.overloadWrites.discardedPreexistingEvents = overloadSseWindow.discardedEvents
      report.checks.overloadSseInvalidationsDelivered = report.phases.overloadWrites.sseInvalidations
        === options.overloadWrites
    } else {
      report.checks.overloadSseInvalidationsDelivered = !options.qualification
    }
    const postOverloadHealth = await http.request(
      `${baseUrl}/api/health`,
      { headers: authHeaders(tokens[0]) },
      { phase: 'overloadWrites.healthAfter' },
    )
    report.phases.overloadWrites.healthAfter = {
      ...compactHttpResult(postOverloadHealth),
      serviceStatus: postOverloadHealth.payload?.data?.status,
      ready: postOverloadHealth.payload?.data?.ready,
      memoryPressure: postOverloadHealth.payload?.data?.memoryPressure,
    }
    report.checks.processHealthyAfterOverload = postOverloadHealth.status === 200
      && postOverloadHealth.payload?.data?.status === 'ok'
    supervisor.completePhase({
      attempted: options.overloadWrites,
      finalSuccesses: report.phases.overloadWrites.finalSuccesses ?? 0,
      healthyAfter: report.checks.processHealthyAfterOverload,
    })

    supervisor.startPhase('health-websockets')
    const webSocketStarted = performance.now()
    healthSockets = await openHealthWebSockets(
      baseUrl.replace(/^http/, 'ws') + '/api/health/ws',
      options.webSockets,
      supervisor.signal,
    )
    const readySockets = healthSockets.results.filter((result) => (
      result.kind === 'ready' && result.payload?.type === 'ready' && result.payload?.ok === true
    )).length
    const rejectedSockets = healthSockets.results.filter((result) => (
      result.kind === 'rejected' && result.status === 429
    )).length
    const unexpectedSockets = healthSockets.results.length - readySockets - rejectedSockets
    report.phases.healthWebSocketSameIp = {
      attempted: options.webSockets,
      ready: readySockets,
      rejected429: rejectedSockets,
      unexpected: unexpectedSockets,
      unexpectedExamples: healthSockets.results.filter((result) => !(
        (result.kind === 'ready' && result.payload?.type === 'ready' && result.payload?.ok === true)
        || (result.kind === 'rejected' && result.status === 429)
      )).slice(0, 10),
      totalMs: rounded(performance.now() - webSocketStarted),
    }
    report.checks.allHealthWebSocketsReady = readySockets === options.webSockets
      && rejectedSockets === 0
      && unexpectedSockets === 0
    supervisor.completePhase({
      attempted: options.webSockets,
      ready: readySockets,
      rejected: rejectedSockets,
    })

    supervisor.startPhase('mixed-online-workload')
    const mixedUserCount = Math.min(
      options.virtualUsers,
      options.qualification ? QUALIFICATION_MINIMUMS.mixedUsers : options.virtualUsers,
    )
    const mixedWriteCount = Math.min(
      mixedUserCount,
      options.qualification ? 10 : Math.max(1, Math.min(options.writeUsers, Math.ceil(mixedUserCount * 0.1))),
    )
    const mixedLoginCount = Math.min(
      mixedUserCount - mixedWriteCount,
      options.qualification ? 20 : Math.max(0, Math.ceil(mixedUserCount * 0.2)),
    )
    const mixedWriterIndexes = Array.from({ length: mixedWriteCount }, (_, index) => index)
    const mixedSseWindow = await prepareSseObservationWindow(sseClients, {
      signal: supervisor.signal,
    })
    const mixedSseWatches = mixedWriterIndexes.map((index) => nextSseInvalidationAfterRevision(
      sseClients[index],
      mixedSseWindow.baselines[index],
      Math.min(options.phaseTimeoutMs, Math.max(30_000, options.thresholds.mixedP95Ms + 15_000)),
      supervisor.signal,
    ).then(
      (event) => ({ event }),
      (error) => ({ error: toQaFailureDiagnostic(error, { phase: 'mixed-workload:sse' }) }),
    ))
    const socketsOpenBeforeMixed = healthSockets.openCount()
    const mixedStarted = performance.now()
    const mixedResults = await Promise.all(Array.from({ length: mixedUserCount }, async (_, index) => {
      const operationStarted = performance.now()
      if (index < mixedWriteCount) {
        const application = ownedApplications[index]
        const marker = `mixed-write-${runId}-${index}`
        const desiredApplication = {
          ...structuredClone(expectedApplications.get(application.id) ?? application),
          updatedAt: application.updatedAt,
          program: marker,
        }
        const outcome = await executeRetriableOverloadWrite({
          index,
          maxRetries: options.overloadRetries,
          signal: supervisor.signal,
          isAccepted: (response) => qaApplicationMutationAcknowledged(response, application.id),
          write: (attempt) => http.request(
            `${baseUrl}/api/applications/${encodeURIComponent(application.id)}`,
            {
              method: 'PUT',
              headers: authHeaders(loginTokens[index] ?? tokens[index], {
                'content-type': 'application/json',
                'x-phd-client-id': `qa-mixed-write-${index}-${attempt}`,
              }),
              body: JSON.stringify(desiredApplication),
            },
            { allowServerBusy: true, phase: 'mixedWorkload.write' },
          ),
        })
        const readbackOutcome = outcome.kind === 'success'
          ? await executeRetriableServerBusyOperation({
              index: mixedUserCount + index,
              maxRetries: options.overloadRetries,
              signal: supervisor.signal,
              isAccepted: (response) => response?.status === 200
                && response?.payload?.data?.id === application.id
                && qaApplicationMatchesExpected(response.payload.data, desiredApplication),
              operation: () => http.request(
                `${baseUrl}/api/applications/${encodeURIComponent(application.id)}`,
                { headers: authHeaders(loginTokens[index] ?? tokens[index]) },
                { allowServerBusy: true, phase: 'mixedWorkload.writeReadback' },
              ),
            })
          : null
        const readback = readbackOutcome?.responses.at(-1)?.response ?? null
        const acknowledged = outcome.kind === 'success'
        const acknowledgedApplication = advanceQaDurableApplicationExpectation({
          acknowledged,
          acknowledgement: outcome.responses.at(-1)?.response?.payload?.data,
          applicationId: application.id,
          desiredApplication,
          expectedPrograms,
          expectedTags,
          expectedApplications,
        })
        const readbackAssessment = assessQaAcknowledgedApplicationReadback({
          acknowledged,
          readbackOutcome: readbackOutcome?.kind,
          readback,
          applicationId: application.id,
          desiredApplication,
        })
        const ok = readbackAssessment.readable
        if (acknowledgedApplication) {
          ownedApplications[index] = ok
            ? readback.payload.data
            : acknowledgedApplication
        }
        if (!ok && readbackAssessment.dataLossProven) {
          report.dataLoss.acceptedWritesMissing.push({
            phase: 'mixed-workload',
            applicationId: application.id,
            marker,
          })
        }
        return {
          index,
          kind: 'write',
          ok,
          failureStage: ok ? null : outcome.kind === 'success' ? 'readback' : 'write',
          writeDiagnostic: qaRetriableOperationDiagnostic(outcome),
          readbackDiagnostic: qaRetriableOperationDiagnostic(readbackOutcome),
          elapsedMs: performance.now() - operationStarted,
          outcome: outcome.kind,
          attempts: outcome.attempts + Math.max(0, Number(readbackOutcome?.attempts ?? 1) - 1),
          capacityRetries: outcome.attempts - 1
            + Math.max(0, Number(readbackOutcome?.attempts ?? 1) - 1),
          finalClassification: readbackOutcome?.responses.at(-1)?.classification
            ?? outcome.responses.at(-1)?.classification,
          finalResponse: compactHttpResult(readback ?? outcome.responses.at(-1)?.response ?? {}),
        }
      }

      if (index < mixedWriteCount + mixedLoginCount) {
        const mixedLoginIndex = index - mixedWriteCount
        const user = options.qualification
          ? mixedLoginUsers[mixedLoginIndex]
          : fixtures.users[index]
        if (!user) throw new Error(`Missing mixed-workload login fixture ${mixedLoginIndex}`)
        const outcome = await executeRetriableLogin({
          index,
          budgetMs: options.loginRetryBudgetMs,
          signal: supervisor.signal,
          login: (attempt) => http.request(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-phd-client-id': `qa-mixed-login-${index}-${attempt}`,
            },
            body: JSON.stringify({ email: user.email, password: qaPassword, scope: 'app' }),
          }, { allowAuthCapacity: true, allowServerBusy: true, phase: 'mixedWorkload.login' }),
        })
        const issuedToken = outcome.responses.at(-1)?.response?.payload?.data?.token
        const finalLogin = outcome.responses.at(-1)
        const identityOutcome = outcome.kind === 'success'
          ? await executeRetriableServerBusyOperation({
              index: mixedUserCount * 2 + index,
              maxRetries: options.overloadRetries,
              signal: supervisor.signal,
              isAccepted: (response) => response?.status === 200,
              operation: () => http.request(
                `${baseUrl}/api/auth/me`,
                { headers: authHeaders(issuedToken) },
                { allowServerBusy: true, phase: 'mixedWorkload.loginIdentity' },
              ),
            })
          : null
        const identity = identityOutcome?.responses.at(-1)?.response ?? null
        return {
          index,
          kind: 'login',
          ok: outcome.kind === 'success'
            && identityOutcome?.kind === 'success'
            && identity?.payload?.data?.user?.id === user.id,
          failureStage: outcome.kind === 'success' ? 'identity' : 'login',
          loginDiagnostic: qaRetriableOperationDiagnostic(outcome),
          identityDiagnostic: qaRetriableOperationDiagnostic(identityOutcome),
          elapsedMs: performance.now() - operationStarted,
          outcome: identityOutcome?.kind ?? outcome.kind,
          attempts: outcome.attempts + Math.max(0, Number(identityOutcome?.attempts ?? 1) - 1),
          capacityRetries: outcome.attempts - 1
            + Math.max(0, Number(identityOutcome?.attempts ?? 1) - 1),
          finalClassification: identityOutcome?.responses.at(-1)?.classification
            ?? finalLogin?.classification,
          finalResponse: compactHttpResult(identity ?? finalLogin?.response ?? {}),
        }
      }

      const token = loginTokens[index] ?? tokens[index]
      const readOutcome = await executeRetriableServerBusyOperation({
        index: mixedUserCount * 3 + index,
        maxRetries: options.overloadRetries,
        signal: supervisor.signal,
        isAccepted: (response) => response?.qaWorkspaceStream?.terminalFrame === 'complete',
        classifyRetry: (response) => (
          response?.qaWorkspaceStreamError?.code === 'QA_WORKSPACE_STREAM_RESTART'
            ? {
                kind: 'server-busy',
                retryAfter: null,
                streamRestartCode: response.qaWorkspaceStreamError.restartCode,
              }
            : null
        ),
        operation: async () => {
          const response = await http.request(
            `${baseUrl}/api/workspace/bootstrap/stream`,
            { headers: authHeaders(token, { accept: 'application/x-ndjson' }) },
            { allowServerBusy: true, phase: 'mixedWorkload.streamRead' },
          )
          if (response?.status === 200) {
            try {
              response.qaWorkspaceStream = parseQaWorkspaceStreamResponse(response)
            } catch (error) {
              response.qaWorkspaceStreamError = error
            }
          }
          return response
        },
      })
      const streamResponse = readOutcome.responses.at(-1)?.response ?? {}
      const stream = streamResponse.qaWorkspaceStream
      const streamError = streamResponse.qaWorkspaceStreamError
        ? toQaFailureDiagnostic(streamResponse.qaWorkspaceStreamError, {
            phase: 'mixedWorkload.streamRead',
          })
        : null
      const rows = stream?.sections?.applications ?? []
      return {
        index,
        kind: 'read',
        ok: readOutcome.kind === 'success'
          && !streamError
          && stream?.terminalFrame === 'complete'
          && stream?.sections?.me?.user?.id === fixtures.users[index].id
          && rows.length === 1
          && rows[0]?.id === fixtures.applications[index].id,
        failureStage: 'stream',
        streamDiagnostic: qaRetriableOperationDiagnostic(readOutcome),
        streamProtocol: stream?.protocol ?? null,
        terminalFrame: stream?.terminalFrame ?? null,
        manifestSections: stream?.manifestSections?.length ?? 0,
        frameCount: stream?.frameCount ?? 0,
        streamError,
        streamRestarts: readOutcome.responses.filter((entry) => (
          entry.classification?.streamRestartCode
        )).length,
        streamRestartCodes: readOutcome.responses.flatMap((entry) => (
          entry.classification?.streamRestartCode ? [entry.classification.streamRestartCode] : []
        )),
        elapsedMs: performance.now() - operationStarted,
        outcome: readOutcome.kind,
        attempts: readOutcome.attempts,
        capacityRetries: readOutcome.attempts - 1,
        finalClassification: readOutcome.responses.at(-1)?.classification,
        finalResponse: compactHttpResult(streamResponse),
      }
    }))
    const mixedSseEvents = await Promise.all(mixedSseWatches)
    const socketsOpenAfterMixed = healthSockets.openCount()
    const mixedFailures = mixedResults.filter((result) => !result.ok)
    report.phases.mixedWorkload = {
      ...summarizeLatencies(mixedResults.map((result) => result.elapsedMs)),
      attempted: mixedUserCount,
      totalMs: rounded(performance.now() - mixedStarted),
      reads: mixedResults.filter((result) => result.kind === 'read').length,
      streamReads: mixedResults.filter((result) => result.kind === 'read').length,
      completedStreamReads: mixedResults.filter((result) => (
        result.kind === 'read'
        && result.streamProtocol === QA_WORKSPACE_STREAM_PROTOCOL
        && result.terminalFrame === 'complete'
      )).length,
      streamRestarts: mixedResults.reduce(
        (total, result) => total + Number(result.streamRestarts ?? 0),
        0,
      ),
      streamRestartCodes: mixedResults.flatMap((result) => result.streamRestartCodes ?? []),
      isolatedStreamApplications: mixedResults.filter((result) => (
        result.kind === 'read' && result.ok
      )).length,
      streamRoute: '/api/workspace/bootstrap/stream',
      logins: mixedResults.filter((result) => result.kind === 'login').length,
      freshLoginPrincipals: options.qualification ? mixedLoginUsers.length : 0,
      writes: mixedResults.filter((result) => result.kind === 'write').length,
      successfulReads: mixedResults.filter((result) => result.kind === 'read' && result.ok).length,
      successfulLogins: mixedResults.filter((result) => result.kind === 'login' && result.ok).length,
      successfulWrites: mixedResults.filter((result) => result.kind === 'write' && result.ok).length,
      successes: mixedResults.filter((result) => result.ok).length,
      failureCount: mixedFailures.length,
      failureEvidenceLimit: QA_FAILURE_DIAGNOSTIC_LIMIT,
      failuresTruncated: Math.max(0, mixedFailures.length - QA_FAILURE_DIAGNOSTIC_LIMIT),
      capacityRetries: mixedResults.reduce(
        (total, result) => total + Number(result.capacityRetries ?? 0),
        0,
      ),
      failures: summarizeQaMixedFailures(mixedResults),
      sseInvalidations: mixedSseEvents.filter((result) => result.event).length,
      sseObservationErrors: mixedSseEvents.filter((result) => result.error).length,
      discardedPreexistingEvents: mixedSseWindow.discardedEvents,
      webSocketsOpenBefore: socketsOpenBeforeMixed,
      webSocketsOpenAfter: socketsOpenAfterMixed,
    }
    report.checks.mixedWorkloadSuccessful = report.phases.mixedWorkload.successes === mixedUserCount
    report.checks.mixedSseInvalidationsDelivered = report.phases.mixedWorkload.sseInvalidations === mixedWriteCount
    report.checks.healthWebSocketsStayedOpenDuringMixed = socketsOpenBeforeMixed >= Math.min(
      QUALIFICATION_MINIMUMS.webSockets,
      options.webSockets,
    ) && socketsOpenAfterMixed === socketsOpenBeforeMixed
    healthSockets.close()
    healthSockets = null
    supervisor.completePhase({
      users: mixedUserCount,
      successes: report.phases.mixedWorkload.successes,
      p95Ms: report.phases.mixedWorkload.p95Ms,
      webSocketsOpenAfter: socketsOpenAfterMixed,
    })

    if (options.enduranceEnabled) {
      await runEnduranceScenarios({
        baseUrl,
        tokens,
        fixtures,
        ownedApplications,
        expectedApplications,
        expectedPrograms,
        expectedTags,
        sseClients,
        report,
        http,
        runId,
        supervisor,
        primaryWorker,
        storageRoot,
        primaryWorkerReady,
        options,
      })
    }

    supervisor.startPhase('final-health')
    const finalHealth = await http.request(
      `${baseUrl}/api/health`,
      { headers: authHeaders(tokens[0]) },
      { phase: 'finalHealth' },
    )
    report.phases.finalHealth = {
      ...compactHttpResult(finalHealth),
      serviceStatus: finalHealth.payload?.data?.status,
      ready: finalHealth.payload?.data?.ready,
      memoryPressure: finalHealth.payload?.data?.memoryPressure,
    }
    report.checks.processStillHealthy = finalHealth.status === 200
      && finalHealth.payload?.data?.status === 'ok'
    const finalWorkerDiagnostics = await waitForQaWorkerIdleDiagnostics(primaryWorker, {
      timeoutMs: Math.min(options.requestTimeoutMs, 10_000),
      signal: supervisor.signal,
    })
    report.phases.finalHealth.workerDiagnostics = {
      processId: finalWorkerDiagnostics.processId,
      memoryPressure: finalWorkerDiagnostics.memoryPressure,
      memoryReservations: finalWorkerDiagnostics.memoryReservations,
      requestBodyAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.requestBodyAdmission),
      credentialBodyAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.credentialBodyAdmission),
      mutationAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.mutationAdmission),
      heavyWorkAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.heavyWorkAdmission),
      standardWorkAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.standardWorkAdmission),
      accountSummaryAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.accountSummaryAdmission),
      applicationListAdmission: compactQaAdmissionSnapshot(finalWorkerDiagnostics.applicationListAdmission),
      workspaceBootstrapAdmission: compactQaAdmissionSnapshot(
        finalWorkerDiagnostics.workspaceBootstrapAdmission,
      ),
      smallWorkspaceBootstrapAdmission: compactQaAdmissionSnapshot(
        finalWorkerDiagnostics.smallWorkspaceBootstrapAdmission,
      ),
    }
    report.checks.workerReservationsReleased = Number(
      finalWorkerDiagnostics.memoryReservations?.reservedBytes,
    ) === 0 && Number(finalWorkerDiagnostics.memoryReservations?.activeReservations) === 0
    supervisor.completePhase({
      healthy: report.checks.processStillHealthy,
      reservationsReleased: report.checks.workerReservationsReleased,
    })

    if (options.qualification) {
      supervisor.startPhase('durability-restart')
      const sseClosures = await Promise.allSettled(sseClients.splice(0).map(closeSseClient))
      const sseClosureFailures = sseClosures.filter((outcome) => outcome.status === 'rejected')
      if (sseClosureFailures.length > 0) {
        const error = new Error(`${sseClosureFailures.length} SSE client(s) failed to close before restart`)
        error.code = 'QA_SSE_RESTART_CLEANUP_FAILED'
        throw error
      }
      const primaryShutdownReport = await runWithQaDeadline(
        'durability-restart:stop-primary-worker',
        Math.min(options.phaseTimeoutMs, 60_000),
        () => stopQaRestartWorker(primaryWorker, {
          gracefulTimeoutMs: Math.min(options.phaseTimeoutMs, 45_000),
          killTimeoutMs: 5_000,
        }),
        { signal: supervisor.signal },
      )
      const verifiedPrimaryShutdown = assertQaWorkerShutdownComplete(
        primaryWorker,
        primaryShutdownReport,
      )
      Object.assign(report.runtime, verifiedPrimaryShutdown.runtime)
      const primaryProcessId = primaryWorkerReady.processId
      primaryWorker = null

      restartWorker = startQaRestartWorker(projectRoot, { role: 'restart' })
      const restartReady = await waitForQaRestartWorker(
        restartWorker,
        Math.min(options.phaseTimeoutMs, 90_000),
        supervisor.signal,
      )
      const restartBaseUrl = `http://127.0.0.1:${restartReady.port}`
      const restartHealth = await http.request(
        `${restartBaseUrl}/api/health/ready`,
        { headers: authHeaders(tokens[0]) },
        { phase: 'durabilityRestart.health' },
      )
      const restartReadbackOutcomes = await Promise.all(fixtures.applications.map((application, index) => (
        executeRetriableServerBusyOperation({
          index,
          maxRetries: options.overloadRetries,
          signal: supervisor.signal,
          isAccepted: (response) => response?.status === 200,
          operation: () => http.request(
            `${restartBaseUrl}/api/applications/${encodeURIComponent(application.id)}`,
            { headers: authHeaders(tokens[index]) },
            { allowServerBusy: true, phase: 'durabilityRestart.readback' },
          ),
        })
      )))
      const restartReadbacks = restartReadbackOutcomes.map(
        (outcome) => outcome.responses.at(-1)?.response ?? {},
      )
      const restartAssessments = restartReadbacks.map((readback, index) => {
        const applicationId = fixtures.applications[index].id
        return assessQaDurableReadback({
          status: readback.status,
          data: readback.payload?.data,
          applicationId,
          expectedProgram: expectedPrograms.get(applicationId),
          expectedTags: expectedTags.get(applicationId),
          expectedApplication: expectedApplications.get(applicationId),
        })
      })
      const durableReadbacks = restartAssessments.filter((assessment) => assessment.durable).length
      report.dataLoss.acceptedWritesMissing.push(...restartAssessments
        .map((assessment, index) => ({ assessment, outcome: restartReadbackOutcomes[index] }))
        // An unavailable readback fails durability qualification, but it is
        // not proof that an acknowledged write vanished. Record data loss only
        // when a successful post-restart read exposes missing persisted data.
        .filter(({ assessment, outcome }) => outcome.kind === 'success' && !assessment.durable)
        .map(({ assessment }) => ({
          phase: 'durability-restart',
          applicationId: assessment.applicationId,
          missingFields: assessment.missingFields,
        })))
      report.phases.durabilityRestart = {
        attempted: restartReadbacks.length,
        durableReadbacks,
        failedReadbacks: restartAssessments.filter((assessment) => !assessment.durable),
        capacityRetries: restartReadbackOutcomes.reduce(
          (total, outcome) => total + outcome.attempts - 1,
          0,
        ),
        exhausted: restartReadbackOutcomes.filter((outcome) => outcome.kind === 'exhausted').length,
        unexpected: restartReadbackOutcomes.filter((outcome) => outcome.kind === 'unexpected').length,
        healthReady: restartHealth.status === 200 && restartHealth.payload?.data?.ready === true,
        workerProcess: true,
        initialProcessId: primaryProcessId,
        restartProcessId: restartReady.processId,
        freshProcess: restartReady.processId !== primaryProcessId,
        listenerAddress: restartReady.address,
        startupPath: 'tools/qa-concurrency-restart-worker.mjs',
      }
      report.checks.durableAfterRestart = report.phases.durabilityRestart.healthReady
        && report.phases.durabilityRestart.freshProcess
        && durableReadbacks === restartReadbacks.length
      const restartShutdownReport = await stopQaRestartWorker(restartWorker)
      assertQaWorkerShutdownComplete(restartWorker, restartShutdownReport)
      restartWorker = null
      supervisor.completePhase({
        attempted: restartReadbacks.length,
        durableReadbacks,
        healthy: report.phases.durabilityRestart.healthReady,
      })
    } else {
      report.phases.durabilityRestart = {
        skipped: true,
        reason: 'Enable --qualification for a fresh-worker durability readback.',
      }
      report.checks.durableAfterRestart = true
    }
  } catch (error) {
    const activePhase = supervisor.activePhase || 'run'
    const failure = supervisor.abortReason ?? error
    supervisor.failActive(failure)
    report.errors.push(toQaFailureDiagnostic(failure, { phase: activePhase }))
  } finally {
    supervisor.close()
    emit('cleanup-start', { phase: 'cleanup', status: 'running' })
    try {
      const cleanupSteps = [
        ...(setupOperations?.pendingCount > 0 ? [{
          name: 'setup-operations',
          weight: 7,
          blocksAllFollowing: true,
          run: async () => {
            await setupOperations.waitForPending()
          },
        }] : []),
        {
          name: 'restart-worker',
          weight: restartWorker ? 7 : 1,
          run: async () => {
            if (!restartWorker) return
            const shutdownReport = await stopQaRestartWorker(restartWorker)
            assertQaWorkerShutdownComplete(restartWorker, shutdownReport)
            restartWorker = null
          },
        },
        {
          name: 'health-websockets',
          safeAfterUnsettled: true,
          blocksDependents: false,
          run: async () => {
            healthSockets?.close()
            healthSockets = null
          },
        },
        {
          name: 'sse-clients',
          safeAfterUnsettled: true,
          blocksDependents: false,
          run: async () => {
            const clients = sseClients.splice(0)
            const results = await Promise.allSettled(clients.map(closeSseClient))
            const failures = results.filter((result) => result.status === 'rejected')
            if (failures.length > 0) throw new Error(`${failures.length} SSE client(s) failed to close`)
          },
        },
        {
          name: 'primary-api-worker',
          weight: primaryWorker ? 7 : 1,
          safeAfterUnsettled: true,
          run: async () => {
            if (!primaryWorker) return
            const shutdownReport = await stopQaRestartWorker(primaryWorker)
            const verified = assertQaWorkerShutdownComplete(primaryWorker, shutdownReport)
            if (!report.runtime?.owner) Object.assign(report.runtime, verified.runtime)
            primaryWorker = null
          },
        },
        {
          name: 'storage',
          weight: 1,
          run: async () => {
            if (restartWorker || primaryWorker) {
              const error = new Error('Storage shutdown skipped because a listener owner is still active')
              error.code = 'QA_CLEANUP_OWNER_ACTIVE'
              throw error
            }
            if (storage) {
              const activeStorage = storage
              await activeStorage.shutdownStorage?.()
              if (storage === activeStorage) storage = null
            }
          },
        },
        {
          name: 'temporary-storage',
          weight: 1,
          run: async () => {
            if (restartWorker || primaryWorker || storage) {
              const error = new Error('Temporary storage retained because a resource owner did not stop safely')
              error.code = 'QA_CLEANUP_STORAGE_RETAINED'
              throw error
            }
            if (storageRoot) {
              await fs.rm(storageRoot, {
                recursive: true,
                force: true,
                maxRetries: process.platform === 'win32' ? 5 : 0,
                retryDelay: 100,
              })
              storageRoot = null
            }
          },
        },
      ]
      report.cleanup = await runQaCleanupSteps(cleanupSteps, {
        timeoutMs: options.cleanupTimeoutMs,
        emit,
      })
      if (storageRoot) report.cleanup.retainedTemporaryStorage = storageRoot
      report.errors.push(...report.cleanup.failures)
      report.checks.cleanupComplete = report.cleanup.ok
    } catch (error) {
      const failure = toQaFailureDiagnostic(error, { phase: 'cleanup' })
      report.errors.push(failure)
      report.cleanup = { ok: false, steps: report.cleanup?.steps ?? [], failures: [failure] }
      report.checks.cleanupComplete = false
    } finally {
      process.stdout.write = originalStdoutWrite
      console.error = originalConsoleError
      for (const [signalName, handler] of terminationHandlers) {
        process.removeListener(signalName, handler)
      }
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      emit('cleanup-complete', {
        phase: 'cleanup',
        status: report.cleanup.ok ? 'pass' : 'fail',
        steps: report.cleanup.steps.length,
        failures: report.cleanup.failures?.length ?? 0,
      })
    }
  }

  report.http.requests = http.records.length
  report.http.unexpected5xx.count = report.http.unexpected5xx.examples.length
  report.http.traffic = summarizeHttpTraffic(http.records, options.virtualUsers)
  report.dataLoss.count = report.dataLoss.acceptedWritesMissing.length
  report.runtime.peaks = {
    rssMb: Number(report.runtime.rssPeakMb ?? 0),
    cpuPercent: Number(report.runtime.cpuPeakPercent ?? 0),
    eventLoopDelayMs: Number(report.runtime.eventLoopDelay?.maxMs ?? 0),
  }
  report.checks.qualificationProfileMet = qaQualificationProfileMet(report)
  report.completedAt = new Date().toISOString()
  report.durationMs = Date.parse(report.completedAt) - Date.parse(report.startedAt)
  report.evaluation = evaluateQaConcurrencyReport(report, options.thresholds)
  report.status = report.evaluation.status
  report.failureDiagnostics = report.errors
  emit('run-complete', {
    phase: 'run',
    status: report.status,
    durationMs: report.durationMs,
    failedChecks: report.evaluation.failedChecks,
    failures: report.errors.length,
  })
  return report
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedFile === fileURLToPath(import.meta.url)) {
  let report
  try {
    report = await runQaConcurrency(parseQaConcurrencyArgs(process.argv.slice(2)))
  } catch (error) {
    const now = new Date().toISOString()
    report = {
      status: 'fail',
      startedAt: now,
      completedAt: now,
      errors: [toQaFailureDiagnostic(error, { phase: 'cli' })],
    }
  }
  process.stdout.write(`${JSON.stringify(sanitizeQaDiagnostic(report), null, 2)}\n`)
  if (report.status !== 'pass') process.exitCode = 1
}
