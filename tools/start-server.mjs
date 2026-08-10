import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { availableParallelism, cpus } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimPendingUpdateBoot,
  confirmPendingUpdateBoot,
  recoverAbandonedPendingUpdateBoot,
  recoverAbandonedUpdateLock,
  releasePendingUpdateBootClaim,
  replayActiveUpdateIfNeeded,
  writeUpdateSafeShutdownMarker,
} from '../server/systemUpdate.js'
import {
  installProductionDependencies,
  writeWorkerFatalDiagnosticSync,
  waitForUpdateCompletion,
} from './container-entrypoint.mjs'
import {
  appendSystemUpdateLog,
  patchSystemUpdateStatus,
} from '../server/systemUpdateJournal.js'

const __filename = fileURLToPath(import.meta.url)
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000
const DEFAULT_STORAGE_SHUTDOWN_RETRY_MS = 40_000
const DEFAULT_STORAGE_SHUTDOWN_RETRY_BASE_MS = 250
const DEFAULT_STORAGE_SHUTDOWN_RETRY_MAX_MS = 5_000
const DEFAULT_WORKER_RESTART_MIN_MS = 750
const DEFAULT_WORKER_RESTART_MAX_MS = 15_000
const DEFAULT_WORKER_STABLE_MS = 30_000
const INTERNAL_SERVER_WORKER_ENV = 'PHD_ATLAS_INTERNAL_SERVER_WORKER'

export const WORKER_SHUTDOWN_REQUEST_EVENT = 'phd-atlas-shutdown-request'

export function installWorkerFatalDiagnostics(storageRoot, options = {}) {
  const processRef = options.processRef ?? process
  const writeDiagnostic = options.writeDiagnostic ?? writeWorkerFatalDiagnosticSync
  const onFatal = (_error, origin) => {
    try {
      writeDiagnostic(storageRoot, {
        fatalType: origin === 'unhandledRejection'
          ? 'unhandled_rejection'
          : 'uncaught_exception',
        pid: processRef.pid,
        code: Number.isSafeInteger(processRef.exitCode) && processRef.exitCode > 0
          ? processRef.exitCode
          : 1,
        signal: null,
      }, {
        processRef,
        cgroupRoot: options.cgroupRoot,
        platform: options.platform,
      })
    } catch {
      // Observation must not replace Node's normal fatal exception behavior.
    }
  }
  processRef.once('uncaughtExceptionMonitor', onFatal)
  return () => processRef.off('uncaughtExceptionMonitor', onFatal)
}

export function gracefulShutdownTimeoutMs(value = process.env.PHD_ATLAS_SHUTDOWN_TIMEOUT_MS) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_SHUTDOWN_TIMEOUT_MS
  // Storage durability gets a separate 40-second recovery window after this
  // cooperative drain. The inner supervisor therefore owns a 70-second final
  // ceiling and the outer service manager owns at least 75 seconds.
  return Math.min(DEFAULT_SHUTDOWN_TIMEOUT_MS, Math.max(5_000, parsed))
}

export function storageShutdownRetryWindowMs(
  value = process.env.PHD_ATLAS_STORAGE_SHUTDOWN_RETRY_MS,
) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_STORAGE_SHUTDOWN_RETRY_MS
  }
  return Math.min(DEFAULT_STORAGE_SHUTDOWN_RETRY_MS, Math.max(1_000, parsed))
}

function normalizedShutdownRequest(request) {
  const candidate = request && typeof request === 'object' ? request : {}
  const requestedCode = Number(candidate.expectedExitCode)
  return {
    expectedExitCode: Number.isSafeInteger(requestedCode)
      && requestedCode >= 0
      && requestedCode <= 255
      ? requestedCode
      : 0,
    reason: typeof candidate.reason === 'string' && candidate.reason.trim()
      ? candidate.reason.trim().slice(0, 80)
      : 'process-signal',
  }
}

export function installPersistentWorkerShutdownSignals(requestShutdown, options = {}) {
  if (typeof requestShutdown !== 'function') {
    throw new TypeError('A worker shutdown request handler is required.')
  }
  const processRef = options.processRef ?? process
  const eventName = options.eventName ?? WORKER_SHUTDOWN_REQUEST_EVENT
  const onShutdownRequest = (request) => { requestShutdown(request) }
  const onSigint = () => {
    requestShutdown({ expectedExitCode: 0, reason: 'SIGINT' })
  }
  const onSigterm = () => {
    requestShutdown({ expectedExitCode: 0, reason: 'SIGTERM' })
  }
  // Signal handlers must remain installed for the complete drain/durability
  // lifecycle. `once` would restore Node's default forced exit on a second
  // SIGTERM and let an impatient service manager bypass the durable boundary.
  processRef.on(eventName, onShutdownRequest)
  processRef.on('SIGINT', onSigint)
  processRef.on('SIGTERM', onSigterm)
  let removed = false
  return () => {
    if (removed) return
    removed = true
    processRef.off(eventName, onShutdownRequest)
    processRef.off('SIGINT', onSigint)
    processRef.off('SIGTERM', onSigterm)
  }
}

function storageFailureRetainedDurability(error) {
  const retained = error?.shutdownDurabilityRetained ?? error?.durabilityRetained
  return retained === false ? false : true
}

function resolvedStorageOutcomeIsDurable(value) {
  if (!value || typeof value !== 'object') return true
  if (value.durabilityPreserved === false) return false
  if (value.safeToExit === false) return false
  return value.shutdownDurabilityRetained !== true && value.durabilityRetained !== true
}

export function createBoundedGracefulShutdown({
  clearBootConfirmation = () => {},
  releasePendingBootClaim,
  stopServer,
  shutdownStorage,
  prepareSafeExit,
  removeFatalDiagnostics = () => {},
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  storageRetryWindowMs = DEFAULT_STORAGE_SHUTDOWN_RETRY_MS,
  storageRetryBaseMs = DEFAULT_STORAGE_SHUTDOWN_RETRY_BASE_MS,
  storageRetryMaxMs = DEFAULT_STORAGE_SHUTDOWN_RETRY_MAX_MS,
  processRef = process,
  timers = globalThis,
  now = Date.now,
  createExitHold,
  logError = (message, error) => console.error(message, error),
} = {}) {
  const deadlineMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_SHUTDOWN_TIMEOUT_MS
  const retryWindowMs = Number.isFinite(Number(storageRetryWindowMs))
    ? Math.min(DEFAULT_STORAGE_SHUTDOWN_RETRY_MS, Math.max(0, Number(storageRetryWindowMs)))
    : DEFAULT_STORAGE_SHUTDOWN_RETRY_MS
  const retryBaseMs = Number.isFinite(Number(storageRetryBaseMs))
    ? Math.max(1, Number(storageRetryBaseMs))
    : DEFAULT_STORAGE_SHUTDOWN_RETRY_BASE_MS
  const retryMaxMs = Number.isFinite(Number(storageRetryMaxMs))
    ? Math.max(retryBaseMs, Number(storageRetryMaxMs))
    : DEFAULT_STORAGE_SHUTDOWN_RETRY_MAX_MS
  let shutdownPromise = null
  let completionPromise = null
  let shutdownRequest = null
  let exitHoldRelease = null
  let exitFinalized = false

  const runStep = async (message, operation) => {
    try {
      return { ok: true, value: await operation?.() }
    } catch (error) {
      logError(message, error)
      return { ok: false, value: undefined, error }
    }
  }

  const acquireExitHold = () => {
    if (exitHoldRelease) return
    let hold
    if (typeof createExitHold === 'function') {
      hold = createExitHold()
    } else if (processRef === process && typeof timers.setInterval === 'function') {
      const handle = timers.setInterval(() => {}, 60_000)
      hold = () => timers.clearInterval?.(handle)
    }
    if (typeof hold === 'function') exitHoldRelease = hold
    else if (typeof hold?.release === 'function') exitHoldRelease = () => hold.release()
    else exitHoldRelease = () => {}
  }

  const releaseExitHold = () => {
    const release = exitHoldRelease
    exitHoldRelease = null
    try {
      release?.()
    } catch (error) {
      logError('[server] Failed to release the shutdown durability hold:', error)
    }
  }

  const waitForRetry = (delayMs) => new Promise((resolveRetry) => {
    // This delay is intentionally referenced. If storage owns the only
    // remaining durable lease, Node must not naturally exit between attempts.
    timers.setTimeout(resolveRetry, delayMs)
  })

  const retryStorageShutdown = async (retryDeadlineAt) => {
    let attempt = 0
    let recoveryWindowExceeded = false
    while (true) {
      const storageResult = await runStep(
        '[storage] Graceful shutdown flush failed; durability remains resident and will be retried:',
        shutdownStorage,
      )
      if (storageResult.ok && resolvedStorageOutcomeIsDurable(storageResult.value)) {
        return {
          ok: true,
          durabilityPreserved: true,
          attempts: attempt + 1,
          recoveryWindowExceeded,
        }
      }

      if (storageResult.ok) {
        const unsafeOutcomeError = new Error('STORAGE_SHUTDOWN_DURABILITY_RETAINED')
        unsafeOutcomeError.code = 'STORAGE_SHUTDOWN_DURABILITY_RETAINED'
        storageResult.error = unsafeOutcomeError
        logError(
          '[storage] Storage shutdown retained durability ownership and will be retried:',
          unsafeOutcomeError,
        )
      } else if (!storageFailureRetainedDurability(storageResult.error)) {
        // Storage reported an ancillary shutdown error only after its durable
        // owner was safely sealed and released. Preserve the historical
        // non-zero exit without pretending durability is at risk.
        return {
          ok: false,
          durabilityPreserved: true,
          attempts: attempt + 1,
          error: storageResult.error,
        }
      }

      const remainingMs = retryDeadlineAt - now()
      if (remainingMs <= 0 && !recoveryWindowExceeded) {
        recoveryWindowExceeded = true
        logError(
          '[storage] Primary shutdown durability window expired; continuing low-frequency resident retries until recovery:',
          storageResult.error ?? new Error('STORAGE_SHUTDOWN_RECOVERY_WINDOW_EXCEEDED'),
        )
      }
      const delayMs = recoveryWindowExceeded
        ? retryMaxMs
        : Math.min(
            retryMaxMs,
            retryBaseMs * (2 ** Math.min(attempt, 20)),
            remainingMs,
          )
      attempt += 1
      await waitForRetry(delayMs)
    }
  }

  const markUnsafe = () => {
    if (!exitFinalized) processRef.exitCode = 1
  }

  const finalizeSafeExit = (outcome) => {
    if (exitFinalized || !outcome.safeToExit || !outcome.durabilityPreserved) return
    exitFinalized = true
    const exitCode = outcome.ok ? shutdownRequest.expectedExitCode : 1
    processRef.exitCode = exitCode
    try {
      removeFatalDiagnostics()
    } catch (error) {
      logError('[server] Failed to remove fatal diagnostics listener:', error)
    }
    releaseExitHold()
    processRef.exit(exitCode)
  }

  return function shutdown(request = {}) {
    if (shutdownPromise) return shutdownPromise
    shutdownRequest = normalizedShutdownRequest(request)
    acquireExitHold()
    const shutdownStartedAt = now()
    shutdownPromise = (async () => {
      try {
        clearBootConfirmation()
      } catch (error) {
        logError('[server] Failed to clear the update boot confirmation timer:', error)
      }

      let deadlineExpired = false
      completionPromise = (async () => {
        const listenerResults = await Promise.all([
          runStep(
            '[system-update] Failed to release the pending boot claim:',
            releasePendingBootClaim,
          ),
          runStep('[server] Graceful listener shutdown failed:', stopServer),
        ])
        const releaseResult = listenerResults[0]
        const stopResult = listenerResults[1]
        const stopOutcome = stopResult.value
        const safeToShutdownStorage = stopResult.ok
          && stopOutcome?.safeToShutdownStorage === true

        if (!safeToShutdownStorage) {
          const pending = stopOutcome?.pending ?? []
          const drainError = new Error('GRACEFUL_DRAIN_TIMEOUT')
          drainError.code = 'GRACEFUL_DRAIN_TIMEOUT'
          drainError.pending = pending
          logError(
            '[server] Cooperative shutdown did not reach a storage-safe boundary:',
            drainError,
          )
          return {
            timedOut: Boolean(stopOutcome?.timedOut),
            ok: false,
            safeToShutdownStorage: false,
            drained: Boolean(stopOutcome?.drained),
            httpClosed: Boolean(stopOutcome?.httpClosed),
            pending,
            durabilityPreserved: false,
            safeToExit: false,
          }
        }

        const storageResult = await retryStorageShutdown(
          shutdownStartedAt + deadlineMs + retryWindowMs,
        )
        if (!storageResult.durabilityPreserved) {
          return {
            timedOut: false,
            ok: false,
            safeToShutdownStorage: true,
            durabilityPreserved: false,
            safeToExit: false,
            durabilityRetryTimedOut: Boolean(storageResult.retryTimedOut),
            storageAttempts: storageResult.attempts,
          }
        }
        const updateHandoffRequired = shutdownRequest.expectedExitCode === 75
          && shutdownRequest.reason === 'system-update'
        const priorStepsSucceeded = releaseResult.ok && stopResult.ok && storageResult.ok
        let exitPreparationResult = { ok: true, value: true }
        if (updateHandoffRequired) {
          if (!priorStepsSucceeded) {
            const prerequisiteError = new Error('UPDATE_SAFE_SHUTDOWN_PREREQUISITE_FAILED')
            prerequisiteError.code = 'UPDATE_SAFE_SHUTDOWN_PREREQUISITE_FAILED'
            logError(
              '[system-update] Refusing to publish a safe-exit handoff after an earlier shutdown failure:',
              prerequisiteError,
            )
            exitPreparationResult = { ok: false, value: false, error: prerequisiteError }
          } else if (typeof prepareSafeExit !== 'function') {
            const unavailableError = new Error('UPDATE_SAFE_SHUTDOWN_PREPARATION_UNAVAILABLE')
            unavailableError.code = 'UPDATE_SAFE_SHUTDOWN_PREPARATION_UNAVAILABLE'
            logError(
              '[system-update] Durable safe-exit handoff preparation is unavailable:',
              unavailableError,
            )
            exitPreparationResult = { ok: false, value: false, error: unavailableError }
          } else {
            exitPreparationResult = await runStep(
              '[system-update] Failed to publish the durable safe-exit handoff:',
              () => prepareSafeExit({
                expectedExitCode: shutdownRequest.expectedExitCode,
                reason: shutdownRequest.reason,
                durabilityPreserved: true,
                storageAttempts: storageResult.attempts,
              }),
            )
            if (exitPreparationResult.ok && exitPreparationResult.value !== true) {
              const acknowledgementError = new Error('UPDATE_SAFE_SHUTDOWN_NOT_ACKNOWLEDGED')
              acknowledgementError.code = 'UPDATE_SAFE_SHUTDOWN_NOT_ACKNOWLEDGED'
              logError(
                '[system-update] Durable safe-exit handoff was not explicitly acknowledged:',
                acknowledgementError,
              )
              exitPreparationResult = {
                ok: false,
                value: exitPreparationResult.value,
                error: acknowledgementError,
              }
            }
          }
        }
        return {
          timedOut: false,
          ok: releaseResult.ok
            && stopResult.ok
            && storageResult.ok
            && exitPreparationResult.ok,
          safeToShutdownStorage: true,
          durabilityPreserved: true,
          safeToExit: true,
          storageAttempts: storageResult.attempts,
          durabilityRecoveryWindowExceeded: storageResult.recoveryWindowExceeded,
          handoffPrepared: exitPreparationResult.ok && exitPreparationResult.value === true,
        }
      })()

      void completionPromise.then((outcome) => {
        if (outcome.safeToExit && outcome.durabilityPreserved) finalizeSafeExit(outcome)
        else markUnsafe()
      })

      let timeoutHandle
      const timeout = new Promise((resolveTimeout) => {
        timeoutHandle = timers.setTimeout(() => {
          deadlineExpired = true
          resolveTimeout({
            timedOut: true,
            ok: false,
            safeToShutdownStorage: false,
            durabilityPreserved: false,
            safeToExit: false,
          })
        }, deadlineMs)
        timeoutHandle?.unref?.()
      })
      const outcome = await Promise.race([completionPromise, timeout])
      if (!deadlineExpired && timeoutHandle !== undefined) timers.clearTimeout(timeoutHandle)
      if (deadlineExpired) {
        logError(
          `[server] Graceful shutdown exceeded ${deadlineMs}ms; retaining the durability hold and refusing voluntary exit.`,
          new Error('GRACEFUL_SHUTDOWN_TIMEOUT'),
        )
      }
      if (!outcome.safeToExit || !outcome.durabilityPreserved) markUnsafe()
      return outcome
    })()
    return shutdownPromise
  }
}

export async function runServerWorker() {
  const envFile = resolve(process.cwd(), '.env')
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile)
  }

  const projectRoot = process.cwd()
  const storageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
    ? resolve(process.env.PHD_ATLAS_STORAGE_ROOT)
    : resolve(projectRoot, 'storage')
  const removeWorkerFatalDiagnostics = installWorkerFatalDiagnostics(storageRoot)
  const startupController = new AbortController()
  let deferredShutdownRequest = null
  let dispatchShutdownRequest = null
  let deferredExitHold = null
  const requestWorkerShutdown = (request) => {
    if (dispatchShutdownRequest) return dispatchShutdownRequest(request)
    const candidate = normalizedShutdownRequest(request)
    if (deferredShutdownRequest) {
      return {
        accepted: deferredShutdownRequest.expectedExitCode === candidate.expectedExitCode
          && deferredShutdownRequest.reason === candidate.reason,
        expectedExitCode: deferredShutdownRequest.expectedExitCode,
        reason: deferredShutdownRequest.reason,
      }
    }
    deferredShutdownRequest = candidate
    deferredExitHold ??= setInterval(() => {}, 60_000)
    if (!startupController.signal.aborted) {
      const error = new Error(`Server shutdown requested: ${candidate.reason}.`)
      error.code = 'SERVER_SHUTDOWN_REQUESTED'
      startupController.abort(error)
    }
    return {
      accepted: true,
      expectedExitCode: candidate.expectedExitCode,
      reason: candidate.reason,
    }
  }
  const removeWorkerShutdownSignals = installPersistentWorkerShutdownSignals(
    requestWorkerShutdown,
  )
  const recordUnexpectedLifecycleStop = () => {
    try {
      writeWorkerFatalDiagnosticSync(storageRoot, {
        fatalType: 'uncaught_exception',
        pid: process.pid,
        code: 1,
        signal: null,
      })
    } catch {
      // Lifecycle recovery must not depend on best-effort diagnostics.
    }
  }
  const onBeforeExit = () => {
    const receipt = requestWorkerShutdown({
      expectedExitCode: 1,
      reason: 'unexpected-before-exit',
    })
    if (receipt.accepted) recordUnexpectedLifecycleStop()
  }
  // Own termination before update recovery, boot claim, dynamic imports, and
  // storage startup. Early requests are retained and replayed once the common
  // durability shutdown state machine is constructed.
  process.once('beforeExit', onBeforeExit)
  const installDependencies = (cwd, options = {}) => installProductionDependencies(cwd, options)
  const recoverPendingBoot = (signal = startupController.signal) => recoverAbandonedPendingUpdateBoot({
    projectRoot,
    storageRoot,
    installDependencies: (cwd) => installDependencies(cwd, { signal }),
    currentProcessId: process.pid,
    signal,
  })
  const recoverStaleLock = (signal = startupController.signal) => recoverAbandonedUpdateLock({
    projectRoot,
    storageRoot,
    installDependencies: (cwd) => installDependencies(cwd, { signal }),
    signal,
  })
  const runStartupStage = async (operation) => {
    startupController.signal.throwIfAborted()
    const result = await operation(startupController.signal)
    startupController.signal.throwIfAborted()
    return result
  }
  let pendingBoot = null
  let startupPreparationError = null
  try {
    await runStartupStage((signal) => waitForUpdateCompletion(storageRoot, {
      recoverAbandonedLock: () => recoverStaleLock(signal),
      signal,
    }))
    if (!deferredShutdownRequest) {
      const bootRecovery = await runStartupStage(recoverPendingBoot)
      if (bootRecovery?.rolledBack) {
        await runStartupStage(async () => {
          await patchSystemUpdateStatus(storageRoot, {
            phase: 'error',
            operationInFlight: false,
            restartPending: false,
            targetVersion: bootRecovery.result?.toVersion ?? bootRecovery.marker?.toVersion ?? null,
            errorCode: 'UPDATE_BOOT_ROLLED_BACK',
            errorMessage: `The updated server did not complete its first boot; ${bootRecovery.version} was restored.`,
          }).catch(() => undefined)
          await appendSystemUpdateLog(storageRoot, {
            level: 'error',
            phase: 'error',
            errorCode: 'UPDATE_BOOT_ROLLED_BACK',
            message: `The updated server did not complete its first boot; restored ${bootRecovery.version}.`,
          }).catch(() => undefined)
        })
      }
      await runStartupStage((signal) => replayActiveUpdateIfNeeded({
        projectRoot,
        storageRoot,
        installDependencies: (cwd) => installDependencies(cwd, { signal }),
        signal,
      }))
      pendingBoot = await runStartupStage((signal) => claimPendingUpdateBoot(
        storageRoot,
        process.pid,
        { signal },
      ))
    }
  } catch (error) {
    if (!deferredShutdownRequest) startupPreparationError = error
  }

  const { startServer, stopServer } = await import('../server/index.js')
  const {
    requestStorageTerminalShutdown,
    shutdownStorage,
  } = await import('../server/storage.js')
  let server = null
  let bootConfirmationTimer = null
  let serverStartSettled = Promise.resolve()
  let requestedShutdown = null
  let shutdownDispatchPromise = null
  const shutdown = createBoundedGracefulShutdown({
    clearBootConfirmation: () => {
      if (bootConfirmationTimer) clearTimeout(bootConfirmationTimer)
    },
    releasePendingBootClaim: () => releasePendingUpdateBootClaim(storageRoot, process.pid),
    stopServer: () => server
      ? stopServer(server)
      : Promise.resolve({
          drained: true,
          httpClosed: true,
          timedOut: false,
          pending: [],
          safeToShutdownStorage: true,
        }),
    shutdownStorage,
    removeFatalDiagnostics: () => {
      removeWorkerFatalDiagnostics()
      removeWorkerShutdownSignals()
      process.off('beforeExit', onBeforeExit)
    },
    createExitHold: () => {
      const handle = deferredExitHold ?? setInterval(() => {}, 60_000)
      deferredExitHold = null
      return () => clearInterval(handle)
    },
    timeoutMs: gracefulShutdownTimeoutMs(),
    storageRetryWindowMs: storageShutdownRetryWindowMs(),
    prepareSafeExit: async ({ expectedExitCode, reason }) => {
      if (expectedExitCode !== 75 || reason !== 'system-update') return undefined
      await writeUpdateSafeShutdownMarker(storageRoot, {
        previousPid: process.pid,
        expectedExitCode,
        reason,
      })
      return true
    },
  })
  dispatchShutdownRequest = (request) => {
    const candidate = normalizedShutdownRequest(request)
    if (requestedShutdown) {
      return {
        accepted: requestedShutdown.expectedExitCode === candidate.expectedExitCode
          && requestedShutdown.reason === candidate.reason,
        expectedExitCode: requestedShutdown.expectedExitCode,
        reason: requestedShutdown.reason,
      }
    }
    requestedShutdown = candidate
    // Existing in-flight work may finish against the initialized store, but a
    // late continuation must not reopen storage after this worker releases its
    // durable lease to the replacement process.
    requestStorageTerminalShutdown()
    if (!startupController.signal.aborted) {
      const error = new Error(`Server shutdown requested: ${requestedShutdown.reason}.`)
      error.code = 'SERVER_SHUTDOWN_REQUESTED'
      startupController.abort(error)
    }
    shutdownDispatchPromise ??= serverStartSettled
      .then(() => shutdown(requestedShutdown))
      .catch((error) => {
        console.error('[server] Graceful shutdown orchestration failed:', error)
      })
    return {
      accepted: true,
      expectedExitCode: requestedShutdown.expectedExitCode,
      reason: requestedShutdown.reason,
    }
  }
  if (deferredShutdownRequest) {
    dispatchShutdownRequest(deferredShutdownRequest)
    await shutdownDispatchPromise
    return null
  }
  if (startupPreparationError) {
    console.error(
      '[server] Startup preparation failed; entering the durable shutdown boundary:',
      startupPreparationError,
    )
    requestWorkerShutdown({ expectedExitCode: 1, reason: 'startup-failure' })
    await shutdownDispatchPromise
    return null
  }

  const onUnexpectedListenerClose = () => {
    if (requestedShutdown) return
    const receipt = requestWorkerShutdown({
      expectedExitCode: 1,
      reason: 'unexpected-listener-close',
    })
    if (receipt.accepted) recordUnexpectedLifecycleStop()
  }
  let settleServerStart
  serverStartSettled = new Promise((resolveStart) => { settleServerStart = resolveStart })
  const startingServer = startServer({
    signal: startupController.signal,
    onListener: (startedServer) => {
      server = startedServer
      server.once('close', onUnexpectedListenerClose)
    },
    appOptions: {
      // The update route receives an immediate acknowledgement. It must never
      // await the listener drain that includes its own HTTP response.
      requestGracefulShutdown: (request) => {
        const receipt = requestWorkerShutdown(request)
        if (!receipt.accepted) {
          throw Object.assign(new Error('Another worker shutdown request already owns the process.'), {
            code: 'WORKER_SHUTDOWN_CONFLICT',
          })
        }
        return receipt
      },
    },
  })
  void startingServer.then((startedServer) => {
    server = startedServer
    settleServerStart()
  }, () => { settleServerStart() })
  // Install signal ownership before awaiting startup. A signal aborts the
  // startup lifecycle, waits for its listener cleanup, then enters the exact
  // same durability-preserving shutdown path as a running worker.
  try {
    server = await startingServer
  } catch (error) {
    if (requestedShutdown) {
      await shutdownDispatchPromise
      return null
    }
    console.error('[server] Startup failed; entering the durable shutdown boundary:', error)
    requestWorkerShutdown({ expectedExitCode: 1, reason: 'startup-failure' })
    await shutdownDispatchPromise
    return null
  }
  const bootConfirmationDelay = Math.max(
    1_000,
    Number.parseInt(process.env.PHD_ATLAS_UPDATE_BOOT_CONFIRM_MS ?? '30000', 10) || 30_000,
  )
  bootConfirmationTimer = pendingBoot
    ? setTimeout(() => {
      void confirmPendingUpdateBoot(storageRoot, process.pid)
        .then(() => Promise.all([
          patchSystemUpdateStatus(storageRoot, {
            phase: 'ready',
            operationInFlight: false,
            restartPending: false,
            errorCode: null,
            errorMessage: null,
          }),
          appendSystemUpdateLog(storageRoot, {
            phase: 'ready',
            message: 'The updated runtime completed its first-boot confirmation window.',
          }),
        ]))
        .catch(async (error) => {
          console.error('[system-update] Failed to confirm the updated runtime boot:', error)
          await appendSystemUpdateLog(storageRoot, {
            level: 'error',
            phase: 'restarting',
            errorCode: error?.code ?? 'UPDATE_BOOT_CONFIRM_FAILED',
            message: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined)
        })
    }, bootConfirmationDelay)
    : null
  bootConfirmationTimer?.unref?.()
  return server
}

export function recommendedThreadPoolSize(parallelism = availableParallelism?.() ?? cpus().length) {
  const count = Math.max(1, Number(parallelism) || 1)
  return Math.min(32, Math.max(8, count * 2))
}

export function parsedThreadPoolSize(value = process.env.UV_THREADPOOL_SIZE) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 128
    ? parsed
    : null
}

export function shouldRestartServerWorker(
  { code = null, signal = null } = {},
  { shutdownRequested = false } = {},
) {
  if (shutdownRequested || code === 0 || code === 75) return false
  return code !== null || signal !== null
}

export function serverWorkerRestartDelayMs(attempt, random = Math.random) {
  const normalizedAttempt = Math.max(0, Math.min(20, Number(attempt) || 0))
  const base = Math.min(
    DEFAULT_WORKER_RESTART_MAX_MS,
    DEFAULT_WORKER_RESTART_MIN_MS * (2 ** normalizedAttempt),
  )
  let randomValue = 0.5
  try {
    const candidate = Number(random())
    if (Number.isFinite(candidate)) randomValue = Math.min(1, Math.max(0, candidate))
  } catch {
    // A diagnostics-only random source must never disable runtime recovery.
  }
  return Math.round(base * (0.85 + randomValue * 0.3))
}

async function runAsThreadPoolSupervisorIfNeeded() {
  if (process.env[INTERNAL_SERVER_WORKER_ENV] === '1') return false
  if (!process.argv[1] || resolve(process.argv[1]) !== __filename) return false

  const threadPoolSize = parsedThreadPoolSize() ?? recommendedThreadPoolSize()
  let child = null
  let shutdownSignal = null
  let wakeRestartDelay = null
  const forwardSignal = (signal) => {
    shutdownSignal ??= signal
    if (child) {
      try {
        child.kill(signal)
      } catch {
        // The child may already have exited.
      }
    }
    wakeRestartDelay?.()
  }
  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  let restartAttempt = 0
  try {
    while (true) {
      const startedAt = Date.now()
      child = spawn(process.execPath, [__filename, ...process.argv.slice(2)], {
        env: {
          ...process.env,
          UV_THREADPOOL_SIZE: String(threadPoolSize),
          [INTERNAL_SERVER_WORKER_ENV]: '1',
        },
        stdio: 'inherit',
        windowsHide: true,
      })

      const result = await new Promise((resolveExit) => {
        let settled = false
        const finish = (code, signal) => {
          if (settled) return
          settled = true
          resolveExit({
            code: Number.isSafeInteger(code) ? code : null,
            signal: typeof signal === 'string' ? signal : null,
          })
        }
        child.once('error', (error) => {
          console.error('[start-server] Failed to spawn the libuv-sized runtime:', error)
          finish(1, null)
        })
        child.once('exit', (code, signal) => finish(code, signal))
      })
      child = null

      if (!shouldRestartServerWorker(result, { shutdownRequested: shutdownSignal !== null })) {
        process.exitCode = result.code
          ?? (shutdownSignal === 'SIGINT' || result.signal === 'SIGINT' ? 130 : 1)
        return true
      }

      if (Date.now() - startedAt >= DEFAULT_WORKER_STABLE_MS) restartAttempt = 0
      const delayMs = serverWorkerRestartDelayMs(restartAttempt)
      restartAttempt += 1
      console.error(
        `[start-server] API worker stopped unexpectedly; retrying in ${delayMs}ms `
        + `(code=${result.code ?? 'none'}, signal=${result.signal ?? 'none'}).`,
      )

      const completedDelay = await new Promise((resolveDelay) => {
        let settled = false
        const finish = (completed) => {
          if (settled) return
          settled = true
          wakeRestartDelay = null
          clearTimeout(timer)
          resolveDelay(completed)
        }
        const timer = setTimeout(() => finish(true), delayMs)
        wakeRestartDelay = () => finish(false)
      })
      if (!completedDelay || shutdownSignal !== null) {
        process.exitCode = shutdownSignal === 'SIGINT' ? 130 : 1
        return true
      }
    }
  } finally {
    wakeRestartDelay = null
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  if (await runAsThreadPoolSupervisorIfNeeded()) process.exit()
  await runServerWorker()
}
