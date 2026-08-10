import os from 'node:os'
import path from 'node:path'
import { promises as fs, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  advanceQaDurableApplicationExpectation,
  assessQaAcknowledgedApplicationReadback,
  assessQaDurableReadback,
  assessQaSseIsolation,
  assessSameEntityConflict,
  assertQaStorageHandoffReady,
  assertQaWorkerShutdownComplete,
  classifyLoginResponse,
  classifyOverloadWriteResponse,
  createQaOperationTracker,
  createQaProgressReporter,
  createQaRunSupervisor,
  evaluateQaConcurrencyReport,
  executeRetriableServerBusyOperation,
  fetchWithQaTimeout,
  isQaServerUnavailableResponse,
  isQaStoreWriteConflictResponse,
  loginCapacityRetryDelayMs,
  mergeQaRetriableCapacitySummaries,
  nextSseInvalidationAfterRevision,
  normalizeQaQualificationOptions,
  overloadRetryDelayMs,
  parseQaConcurrencyArgs,
  parseQaWorkspaceStreamResponse,
  prepareSseObservationWindow,
  probeQaRequestBodyBackpressure,
  QA_FAILURE_DIAGNOSTIC_LIMIT,
  qaApplicationMutationAcknowledged,
  qaApplicationShapeDifferencePaths,
  qaQualificationProfileMet,
  qaRestartWorkerEnvironment,
  requestQaWorkerDiagnostics,
  resolveQaPathThroughExistingAncestor,
  resolveQaTemporaryParent,
  retryAfterMilliseconds,
  runQaCleanupSteps,
  runWithQaDeadline,
  sanitizeQaDiagnostic,
  startQaRestartWorker,
  stopQaRestartWorker,
  summarizeQaMixedFailures,
  summarizeQaOverloadFailures,
  summarizeQaRetriableCapacity,
  summarizeHttpTraffic,
  summarizeLatencies,
  toQaFailureDiagnostic,
  validateQaTemporaryParent,
  waitForQaListenerAddress,
  waitForQaRestartWorker,
  waitForQaWorkerIdleDiagnostics,
} from '../tools/qa-concurrency.mjs'
import { qaEnduranceArgs } from '../tools/qa-endurance.mjs'

const thresholds = {
  healthP95Ms: 500,
  readP95Ms: 1_500,
  writeP95Ms: 2_500,
  loginP95Ms: 4_000,
  overloadP95Ms: 8_000,
  mixedP95Ms: 3_000,
  eventLoopP99Ms: 200,
}

function expectedProjectTemporaryBoundaryCode(projectRoot, systemTemporaryRoot) {
  const relative = path.relative(path.resolve(systemTemporaryRoot), path.resolve(projectRoot))
  const projectIsInsideTemporaryRoot = relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative))
  return projectIsInsideTemporaryRoot
    ? 'QA_TEMP_ROOT_OVERLAPS_PROJECT'
    : 'QA_TEMP_ROOT_OUTSIDE_SYSTEM_TEMP'
}

function passingReport() {
  return {
    checks: {
      healthAllSuccessful: true,
      accountReadsIsolated: true,
      crossAccountReadsDenied: true,
      crossAccountWritesDenied: true,
      crossAccountDeletesDenied: true,
      crossAccountMutationTargetsUnchanged: true,
      allConditionalReadsNotModified: true,
      allSseClientsConnected: true,
      ownSseInvalidationsDelivered: true,
      sseEventsStayedAccountScoped: true,
      distinctWritesReadable: true,
      sameEntityConflictSafe: true,
      acceptedSameEntityWritesReadable: true,
      allLoginsCompleted: true,
      allLoginTokensVerified: true,
      loginTokenReadsIsolated: true,
      overloadResponsesStructured: true,
      overloadWritesEventuallyReadable: true,
      processHealthyAfterOverload: true,
      allHealthWebSocketsReady: true,
      processStillHealthy: true,
      apiWorkerProcessIsolated: true,
      workerReservationsReleased: true,
      cleanupComplete: true,
    },
    profile: { qualification: false },
    phases: {
      health: { p95Ms: 100 },
      authenticatedReads: { all: { p95Ms: 200 } },
      distinctAccountWrites: { p95Ms: 300 },
      concurrentLogin: { p95Ms: 400 },
    },
    runtime: { eventLoopDelay: { p99Ms: 50 } },
    http: {
      unexpected5xx: { count: 0 },
      storeWriteConflictCount: 0,
      serverUnavailableCount: 0,
      expectedServerBusy: { count: 0 },
      expectedAuthCapacity: { count: 0 },
      transportErrors: [],
    },
    dataLoss: { count: 0 },
    dataIsolationViolations: 0,
    errors: [],
  }
}

function passingQualificationReport() {
  const report = passingReport()
  report.profile = {
    qualification: true,
    apiWorkerProcessIsolated: true,
    runtimeMetricsOwner: 'api-worker',
    virtualUsers: 100,
    loginUsers: 100,
    sseObservers: 99,
    webSockets: 100,
    overloadWrites: 100,
    overloadRetries: 24,
    runtimeMemoryHardLimitMb: 448,
  }
  Object.assign(report.checks, {
    qualificationProfileMet: true,
    overloadObservedStructuredBusy: true,
    bodyAdmissionBackpressureObserved: true,
    bodyAdmissionBackpressureRecovered: true,
    overloadSseInvalidationsDelivered: true,
    mixedWorkloadSuccessful: true,
    mixedSseInvalidationsDelivered: true,
    healthWebSocketsStayedOpenDuringMixed: true,
    durableAfterRestart: true,
  })
  report.phases.concurrentLogin.attempted = 100
  report.phases.sseConnections = { connected: 100 }
  report.phases.sseAccountScope = { observers: 99 }
  report.phases.healthWebSocketSameIp = { ready: 100 }
  report.phases.overloadWrites = {
    attempted: 100,
    endToEndLatency: { p95Ms: 2_000 },
  }
  report.phases.bodyAdmissionBackpressure = {
    configuredActive: 8,
    configuredQueued: 128,
    holders: 136,
    saturated: { active: 8, waiting: 128 },
    rejectionCounterDelta: 1,
    perKeyRejectionCounterDelta: 0,
    retryAfter: '1',
    retryAfterMs: 1_000,
    released: { active: 0, waiting: 0, activeKeys: 0, queuedKeys: 0 },
    structuredServerBusy: 1,
    successfulRetries: 1,
    durableReadbacks: 1,
  }
  report.phases.mixedWorkload = {
    attempted: 100,
    writes: 10,
    logins: 20,
    freshLoginPrincipals: 20,
    reads: 70,
    streamReads: 70,
    completedStreamReads: 70,
    isolatedStreamApplications: 70,
    streamRoute: '/api/workspace/bootstrap/stream',
    p95Ms: 1_000,
  }
  report.phases.processIsolation = {
    loadGeneratorProcessId: 99,
    apiProcessId: 100,
    distinctProcesses: true,
  }
  report.phases.finalHealth = {
    workerDiagnostics: {
      memoryReservations: { reservedBytes: 0, activeReservations: 0 },
    },
  }
  report.phases.durabilityRestart = {
    attempted: 100,
    durableReadbacks: 100,
    initialProcessId: 100,
    restartProcessId: 101,
    freshProcess: true,
  }
  report.runtime.owner = 'api-worker'
  report.runtime.processId = 100
  report.runtime.rssPeakMb = 400
  return report
}

function structuredCapacityResponse({
  status = 503,
  code = 'SERVER_BUSY',
  retryAfter = '1',
  retryAfterMs = '1000',
  requestId = 'qa-capacity-request',
  memoryPressure,
} = {}) {
  return {
    status,
    headers: {
      retryAfter,
      retryAfterMs,
      requestId,
      ...(memoryPressure ? { memoryPressure } : {}),
    },
    payload: {
      ok: false,
      error: { code, message: 'Please retry shortly.' },
      requestId,
    },
  }
}

describe('100-user concurrency QA tool', () => {
  it('defaults to an isolated 100-user profile and bounds overrides', () => {
    expect(parseQaConcurrencyArgs([], {})).toMatchObject({
      profile: 'isolated',
      qualification: false,
      virtualUsers: 100,
      healthIterations: 3,
      sseBatchSize: 20,
      writeUsers: 10,
      loginUsers: 100,
      webSockets: 100,
      overloadWrites: 100,
      overloadRetries: 8,
      loginRetryBudgetMs: 75_000,
      overallTimeoutMs: 900_000,
      phaseTimeoutMs: 360_000,
      cleanupTimeoutMs: 60_000,
      requestTimeoutMs: 30_000,
      progressIntervalMs: 15_000,
    })

    expect(parseQaConcurrencyArgs([
      '--vus=4',
      '--write-users=99',
      '--login-users=0',
      '--sse-batch=99',
      '--websockets=999',
      '--overload-retries=99',
      '--login-retry-budget-ms=1',
      '--overall-timeout-ms=1',
      '--phase-timeout-ms=99999999',
      '--cleanup-timeout-ms=1',
      '--progress-interval-ms=1',
    ], {})).toMatchObject({
      virtualUsers: 4,
      writeUsers: 4,
      loginUsers: 1,
      sseBatchSize: 4,
      webSockets: 500,
      overloadWrites: 4,
      overloadRetries: 32,
      loginRetryBudgetMs: 1_000,
      overallTimeoutMs: 10_000,
      phaseTimeoutMs: 1_800_000,
      cleanupTimeoutMs: 1_000,
      progressIntervalMs: 1_000,
    })
  })

  it('makes qualification an explicit, non-downgradable 100-user contract', () => {
    const parsed = parseQaConcurrencyArgs([
      '--qualification',
      '--vus=4',
      '--login-users=1',
      '--sse-observers=1',
      '--websockets=1',
      '--overload-writes=0',
      '--cleanup-timeout-ms=1',
      '--request-timeout-ms=120000',
      '--max-event-loop-p99-ms=120000',
      '--max-overload-p95-ms=180000',
      '--max-mixed-p95-ms=180000',
    ], {})

    expect(parsed).toMatchObject({
      qualification: true,
      virtualUsers: 100,
      loginUsers: 100,
      sseObservers: 99,
      webSockets: 100,
      overloadWrites: 100,
      overloadRetries: 24,
      loginRetryBudgetMs: 120_000,
      cleanupTimeoutMs: 60_000,
      requestTimeoutMs: 30_000,
      thresholds: {
        eventLoopP99Ms: 200,
        overloadP95Ms: 8_000,
        mixedP95Ms: 3_000,
      },
    })
    expect(normalizeQaQualificationOptions({
      qualification: true,
      virtualUsers: 2,
      loginUsers: 1,
      sseObservers: 1,
      webSockets: 1,
      overloadWrites: 0,
      cleanupTimeoutMs: 1,
      requestTimeoutMs: 120_000,
      thresholds: { eventLoopP99Ms: 120_000 },
    })).toMatchObject({
      virtualUsers: 100,
      loginUsers: 100,
      sseObservers: 99,
      webSockets: 100,
      overloadWrites: 100,
      overloadRetries: 24,
      cleanupTimeoutMs: 60_000,
      loginRetryBudgetMs: 120_000,
      requestTimeoutMs: 30_000,
      thresholds: { eventLoopP99Ms: 200 },
    })

    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(packageJson.scripts['qa:concurrency']).toContain('--qualification')
    expect(packageJson.scripts['qa:concurrency:production-like']).toContain('--qualification')
    expect(() => parseQaConcurrencyArgs([
      '--qualification',
      '--no-qualification',
    ], {})).toThrow(expect.objectContaining({ code: 'QA_BOOLEAN_OPTION_CONFLICT' }))
  })

  it('derives endurance supervisors before parsing the sequential qualification', () => {
    const parsed = parseQaConcurrencyArgs(qaEnduranceArgs(['--qualification']), {})

    expect(parsed).toMatchObject({
      enduranceEnabled: true,
      enduranceScenarios: ['autosave', 'background', 'connections', 'liveness'],
      enduranceDurationMs: 300_000,
      enduranceConnectionsDurationMs: 600_000,
      phaseTimeoutMs: 720_000,
      overallTimeoutMs: 1_500_000,
    })
  })

  it('emits line-delimited structured progress and redacts diagnostic secrets', () => {
    const lines = []
    const reporter = createQaProgressReporter({
      runId: 'qa-run-1',
      now: () => new Date('2026-08-02T12:00:00.000Z'),
      write: (line) => lines.push(line),
    })
    const event = reporter('phase-fail', {
      phase: 'login',
      status: 'fail',
      password: 'not-for-logs',
      failure: {
        message: [
          'authorization: Basic dXNlcjpwYXNzd29yZA==',
          'cookie: session=browser-secret',
          'apiKey=sk-1234567890abcdef postgres://user:database-pass@example.test/db',
        ].join('\n'),
      },
    })

    expect(event).toMatchObject({
      type: 'phd-atlas.qa-concurrency.progress',
      version: 1,
      runId: 'qa-run-1',
      event: 'phase-fail',
      phase: 'login',
      password: '[REDACTED]',
    })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual(event)
    expect(lines[0]).not.toContain('not-for-logs')
    expect(lines[0]).not.toContain('dXNlcjpwYXNzd29yZA==')
    expect(lines[0]).not.toContain('browser-secret')
    expect(lines[0]).not.toContain('sk-1234567890abcdef')
    expect(lines[0]).not.toContain('database-pass')
    expect(sanitizeQaDiagnostic({ token: 'hidden', password: 123456, safe: 'visible' })).toEqual({
      token: '[REDACTED]',
      password: '[REDACTED]',
      safe: 'visible',
    })
    expect(sanitizeQaDiagnostic({
      allLoginTokensVerified: true,
      loginTokenReadsIsolated: true,
    })).toEqual({
      allLoginTokensVerified: true,
      loginTokenReadsIsolated: true,
    })
    const workerFailure = new Error('restart failed')
    workerFailure.workerOutput = 'Authorization: Basic d29ya2VyLXNlY3JldA=='
    expect(toQaFailureDiagnostic(workerFailure)).toMatchObject({
      workerOutput: 'Authorization: [REDACTED]',
    })
  })

  it('enforces phase and overall deadlines with machine-readable progress failures', async () => {
    await expect(runWithQaDeadline('unit-hang', 15, () => new Promise(() => {}))).rejects.toMatchObject({
      code: 'QA_PHASE_TIMEOUT',
      phase: 'unit-hang',
      timeoutMs: 15,
    })
    await expect(runWithQaDeadline('event-loop-block', 10, () => {
      const deadline = performance.now() + 25
      while (performance.now() < deadline) {
        // Exercise the post-task monotonic deadline check while timers cannot run.
      }
      return 'late-success'
    })).rejects.toMatchObject({
      code: 'QA_PHASE_TIMEOUT',
      phase: 'event-loop-block',
      timeoutMs: 10,
    })

    const events = []
    const supervisor = createQaRunSupervisor({
      runId: 'deadline-run',
      overallTimeoutMs: 1_000,
      phaseTimeoutMs: 15,
      progressIntervalMs: 5,
      emit: (event, details) => events.push({ event, ...details }),
    })
    supervisor.startPhase('bounded-phase')
    await new Promise((resolve) => setTimeout(resolve, 25))
    let failure
    try {
      supervisor.completePhase()
    } catch (error) {
      failure = error
      supervisor.failActive(error)
    } finally {
      supervisor.close()
    }

    expect(failure).toMatchObject({
      code: 'QA_PHASE_TIMEOUT',
      phase: 'bounded-phase',
      timeoutMs: 15,
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'phase-start', phase: 'bounded-phase', status: 'running' }),
      expect.objectContaining({ event: 'phase-progress', phase: 'bounded-phase', status: 'running' }),
      expect.objectContaining({
        event: 'phase-fail',
        phase: 'bounded-phase',
        status: 'fail',
        failure: expect.objectContaining({ code: 'QA_PHASE_TIMEOUT' }),
      }),
    ]))

    const overallSupervisor = createQaRunSupervisor({
      overallTimeoutMs: 15,
      phaseTimeoutMs: 1_000,
    })
    overallSupervisor.startPhase('overall-boundary')
    await new Promise((resolve) => setTimeout(resolve, 25))
    let overallFailure
    try {
      overallSupervisor.completePhase()
    } catch (error) {
      overallFailure = error
      overallSupervisor.failActive(error)
    } finally {
      overallSupervisor.close()
    }
    expect(overallFailure).toMatchObject({
      code: 'QA_OVERALL_TIMEOUT',
      phase: 'overall-boundary',
      timeoutMs: 15,
    })
  })

  it('keeps a deadline alive in a standalone Node process', async () => {
    const toolUrl = pathToFileURL(path.join(process.cwd(), 'tools', 'qa-concurrency.mjs')).href
    const script = [
      `import { runWithQaDeadline } from ${JSON.stringify(toolUrl)}`,
      "try { await runWithQaDeadline('standalone', 20, () => new Promise(() => {})) }",
      "catch (error) { process.stdout.write(`${error.code}\\n`) }",
    ].join('\n')
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
    })
    expect(outcome).toEqual({
      code: 0,
      signal: null,
      stdout: 'QA_PHASE_TIMEOUT\n',
      stderr: '',
    })
  })

  it('waits for the listener to really bind before reading its address', async () => {
    class DelayedListener extends EventEmitter {
      listening = false

      boundAddress = null

      address() {
        return this.boundAddress
      }

      bind() {
        this.boundAddress = { address: '127.0.0.1', family: 'IPv4', port: 4317 }
        this.listening = true
        this.emit('listening')
      }
    }

    const listener = new DelayedListener()
    const wait = waitForQaListenerAddress(listener, { timeoutMs: 1_000 })
    await Promise.resolve()
    expect(listener.listenerCount('listening')).toBe(1)
    expect(listener.address()).toBeNull()
    setTimeout(() => listener.bind(), 5)

    await expect(wait).resolves.toEqual({
      address: '127.0.0.1',
      family: 'IPv4',
      port: 4317,
    })
    expect(listener.listenerCount('listening')).toBe(0)
    expect(listener.listenerCount('error')).toBe(0)
    expect(listener.listenerCount('close')).toBe(0)
  })

  it('surfaces a delayed listener bind failure and releases lifecycle listeners', async () => {
    const listener = new EventEmitter()
    listener.listening = false
    listener.address = () => null
    const wait = waitForQaListenerAddress(listener, { timeoutMs: 100 })
    const bindError = Object.assign(new Error('address unavailable'), { code: 'EADDRINUSE' })
    setTimeout(() => listener.emit('error', bindError), 5)

    await expect(wait).rejects.toBe(bindError)
    expect(listener.listenerCount('listening')).toBe(0)
    expect(listener.listenerCount('error')).toBe(0)
    expect(listener.listenerCount('close')).toBe(0)
  })

  it('keeps a hard deadline active through HTTP response-body consumption', async () => {
    const stalled = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write('partial')
    })
    await new Promise((resolve, reject) => {
      stalled.once('error', reject)
      stalled.listen(0, '127.0.0.1', resolve)
    })
    try {
      const url = `http://127.0.0.1:${stalled.address().port}/stalled`
      await expect(fetchWithQaTimeout(
        url,
        undefined,
        25,
        (response) => response.text(),
      )).rejects.toMatchObject({ code: 'QA_HTTP_TIMEOUT', timeoutMs: 25 })
    } finally {
      stalled.closeAllConnections()
      await new Promise((resolve) => stalled.close(resolve))
    }
  })

  it('attempts every bounded cleanup step and redacts cleanup failures', async () => {
    const calls = []
    const result = await runQaCleanupSteps([
      { name: 'first', run: async () => calls.push('first') },
      {
        name: 'failing',
        run: async () => {
          calls.push('failing')
          throw new Error('password=cleanup-secret')
        },
      },
      {
        name: 'timed-out',
        run: async (signal) => {
          calls.push('timed-out')
          await new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              calls.push('timed-out-aborted')
              resolve()
            }, { once: true })
          })
        },
      },
      { name: 'last', run: async () => calls.push('last') },
    ], { timeoutMs: 60 })

    expect(calls).toEqual(['first', 'failing', 'timed-out', 'timed-out-aborted', 'last'])
    expect(result.ok).toBe(false)
    expect(result.steps.map((step) => step.status)).toEqual(['pass', 'fail', 'fail', 'pass'])
    expect(result.steps.map((step) => step.operationSettled)).toEqual([true, true, true, true])
    expect(result.failures[0]).toMatchObject({ phase: 'cleanup:failing' })
    expect(result.failures[1]).toMatchObject({
      code: 'QA_PHASE_TIMEOUT',
      phase: 'cleanup:timed-out',
      timeoutMs: expect.any(Number),
    })
    expect(result.elapsedMs).toBeLessThan(120)
    expect(JSON.stringify(result)).not.toContain('cleanup-secret')
  })

  it('blocks dependent cleanup while a non-cooperative owner is still running', async () => {
    const calls = []
    const result = await runQaCleanupSteps([
      {
        name: 'non-cooperative-owner',
        run: async () => {
          calls.push('owner-started')
          await new Promise((resolve) => setTimeout(resolve, 60))
          calls.push('owner-finished')
        },
      },
      {
        name: 'destructive-dependent',
        run: async () => calls.push('dependent-started'),
      },
    ], { timeoutMs: 40 })

    expect(calls).toEqual(['owner-started'])
    expect(result.steps).toMatchObject([
      { name: 'non-cooperative-owner', status: 'fail', operationSettled: false },
      { name: 'destructive-dependent', status: 'blocked', operationSettled: false },
    ])
    expect(result.failures[1]).toMatchObject({ code: 'QA_CLEANUP_PREVIOUS_OPERATION_ACTIVE' })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toEqual(['owner-started', 'owner-finished'])
  })

  it('reserves a 20-second-plus cleanup share for active setup and restart owners', async () => {
    let now = 0
    const result = await runQaCleanupSteps([
      { name: 'setup-operations', weight: 7, run: async () => { now += 500 } },
      { name: 'restart-worker', weight: 7, run: async () => { now += 500 } },
      { name: 'health-websockets', weight: 1, run: async () => undefined },
      { name: 'sse-clients', weight: 1, run: async () => undefined },
      { name: 'server', weight: 2, run: async () => undefined },
      { name: 'storage', weight: 1, run: async () => undefined },
      { name: 'temporary-storage', weight: 1, run: async () => undefined },
    ], { timeoutMs: 60_000, now: () => now })

    expect(result.steps.slice(0, 2).map((step) => step.deadlineMs)).toEqual([21_000, 41_500])
    expect(result.steps.at(-1)).toMatchObject({
      name: 'temporary-storage',
      deadlineMs: 59_000,
      status: 'pass',
    })
    expect(result.elapsedMs).toBe(1_000)
  })

  it('never lets carried cleanup time exceed the original global deadline', async () => {
    let now = 0
    const result = await runQaCleanupSteps([
      { name: 'fast-owner', weight: 3, run: async () => { now += 100 } },
      { name: 'slow-removal', weight: 1, run: async () => { now += 900 } },
    ], { timeoutMs: 1_000, now: () => now })

    expect(result.steps).toMatchObject([
      { name: 'fast-owner', deadlineMs: 750, elapsedMs: 100 },
      { name: 'slow-removal', deadlineMs: 900, elapsedMs: 900 },
    ])
    expect(result.elapsedMs).toBe(1_000)
    expect(result.deadlineMs).toBe(1_000)
  })

  it('confirms restart-worker exit after escalating from SIGTERM to SIGKILL', async () => {
    let resolveExit
    let exitConfirmed = false
    const signals = []
    const worker = {
      settled: false,
      child: {
        exitCode: null,
        signalCode: null,
        kill(signal) {
          signals.push(signal)
          if (signal === 'SIGKILL') {
            setTimeout(() => {
              exitConfirmed = true
              worker.settled = true
              resolveExit({ kind: 'exit', code: null, signal: 'SIGKILL' })
            }, 5)
          }
          return true
        },
      },
      exitPromise: new Promise((resolve) => { resolveExit = resolve }),
    }

    await stopQaRestartWorker(worker, { gracefulTimeoutMs: 5, killTimeoutMs: 50 })

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(exitConfirmed).toBe(true)
    expect(worker.settled).toBe(true)
  })

  it('rejects an unsafe restart handoff and keeps worker timeout diagnostics', async () => {
    const safeStop = {
      drained: true,
      httpClosed: true,
      timedOut: false,
      pending: [],
      safeToShutdownStorage: true,
    }
    const safeStorage = {
      terminalShutdownRequested: true,
      initialized: false,
      initializing: false,
      shuttingDown: false,
      databaseOpen: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    }
    expect(assertQaStorageHandoffReady(safeStop, safeStorage)).toBe(safeStorage)
    expect(() => assertQaStorageHandoffReady(
      { ...safeStop, safeToShutdownStorage: false, pending: [{ name: 'request', count: 1 }] },
      safeStorage,
    )).toThrow(expect.objectContaining({ code: 'QA_RESTART_SERVER_DRAIN_UNSAFE' }))
    expect(() => assertQaStorageHandoffReady(
      safeStop,
      { ...safeStorage, serviceLeaseHeld: true },
    )).toThrow(expect.objectContaining({ code: 'QA_RESTART_STORAGE_OWNER_RETAINED' }))

    const worker = {
      readyPromise: new Promise(() => {}),
      output: ['listener opened\n'],
      startupProgress: [{ type: 'startup-progress', phase: 'storage-wait' }],
    }
    await expect(waitForQaRestartWorker(worker, 10)).rejects.toMatchObject({
      code: 'QA_PHASE_TIMEOUT',
      workerOutput: 'listener opened\n',
      workerStartup: [{ type: 'startup-progress', phase: 'storage-wait' }],
    })
  })

  it('tracks and safely harvests a setup resource that resolves after its deadline', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-qa-late-'))
    const tracker = createQaOperationTracker({ timeoutMs: 10 })
    let ownedPath
    try {
      await expect(tracker.run('late-mkdtemp', () => new Promise((resolve, reject) => {
        setTimeout(() => {
          fs.mkdtemp(path.join(temporaryRoot, 'run-')).then(resolve, reject)
        }, 30)
      }), {
        onSuccess: (value) => { ownedPath = value },
        onLateSuccess: async (value) => {
          await fs.rm(value, { recursive: true, force: true })
          if (ownedPath === value) ownedPath = null
        },
      })).rejects.toMatchObject({ code: 'QA_PHASE_TIMEOUT' })
      expect(tracker.pendingCount).toBe(1)
      await tracker.waitForPending()
      expect(tracker.pendingCount).toBe(0)
      expect(ownedPath).toBeNull()
      expect(await fs.readdir(temporaryRoot)).toEqual([])
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('starts each SSE assertion from a drained revision boundary', async () => {
    const client = {
      connectedEvent: { type: 'connected', revision: 1 },
      events: [
        { type: 'invalidate', revision: 2, scopes: ['applications'] },
        { type: 'invalidate', revision: 3, scopes: ['applications'] },
      ],
      waiters: [],
      failure: null,
      observationRevision: 0,
    }
    const window = await prepareSseObservationWindow([client], { settleMs: 1 })
    expect(window).toEqual({ baselines: [3], discardedEvents: 2 })
    expect(client.events).toEqual([])

    client.events.push(
      { type: 'invalidate', revision: 3, scopes: ['applications'] },
      { type: 'invalidate', revision: 4, scopes: ['profile'] },
      { type: 'invalidate', revision: 5, scopes: ['applications'] },
    )
    await expect(nextSseInvalidationAfterRevision(client, 3, 50)).resolves.toMatchObject({
      revision: 5,
      scopes: ['applications'],
    })

    await expect(prepareSseObservationWindow([{
      ...client,
      waiters: [{}],
    }], { settleMs: 1 })).rejects.toMatchObject({ code: 'QA_SSE_WINDOW_BUSY' })

    expect(assessQaSseIsolation({
      mutationDurable: true,
      targetEvent: { type: 'invalidate' },
      observerEvents: [{ quiet: true }, { error: 'stream disconnected' }],
    })).toMatchObject({
      passed: false,
      observerErrors: [{ error: 'stream disconnected' }],
    })
  })

  it('requires an explicit safe temporary parent for the production-like profile', () => {
    const systemTemporaryRoot = path.resolve(os.tmpdir())
    const safeParent = path.join(systemTemporaryRoot, 'phd-atlas-production-like-test')
    const projectRoot = path.join(process.cwd(), 'project-under-test')
    const currentStorageRoot = path.join(process.cwd(), 'active-storage')

    expect(validateQaTemporaryParent(safeParent, {
      projectRoot,
      currentStorageRoot,
      systemTemporaryRoot,
    })).toBe(path.resolve(safeParent))
    expect(() => resolveQaTemporaryParent({ profile: 'production-like' }, {
      projectRoot,
      currentStorageRoot,
      systemTemporaryRoot,
    })).toThrow(expect.objectContaining({ code: 'QA_TEMP_ROOT_REQUIRED' }))
    expect(() => validateQaTemporaryParent(projectRoot, {
      projectRoot,
      currentStorageRoot,
      systemTemporaryRoot,
    })).toThrow(expect.objectContaining({
      code: expectedProjectTemporaryBoundaryCode(projectRoot, systemTemporaryRoot),
    }))
    expect(() => validateQaTemporaryParent(currentStorageRoot, {
      projectRoot: path.join(process.cwd(), 'other-project'),
      currentStorageRoot,
      systemTemporaryRoot: process.cwd(),
    })).toThrow(expect.objectContaining({ code: 'QA_TEMP_ROOT_OVERLAPS_ACTIVE_STORAGE' }))

    expect(parseQaConcurrencyArgs([
      '--profile=production-like',
      `--temp-root=${safeParent}`,
    ], {})).toMatchObject({
      profile: 'production-like',
      temporaryParent: safeParent,
    })
  })

  it('resolves a linked temporary ancestor before creating any child directory', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-qa-path-'))
    const linkedParent = path.join(temporaryRoot, 'linked-workspace')
    const candidate = path.join(linkedParent, 'must-not-be-created')
    try {
      await fs.symlink(process.cwd(), linkedParent, process.platform === 'win32' ? 'junction' : 'dir')
      const resolved = await resolveQaPathThroughExistingAncestor(candidate)
      const realProjectRoot = await fs.realpath(process.cwd())
      const realSystemTemporaryRoot = await fs.realpath(os.tmpdir())
      expect(resolved).toBe(path.join(realProjectRoot, 'must-not-be-created'))
      expect(() => validateQaTemporaryParent(resolved, {
        projectRoot: realProjectRoot,
        systemTemporaryRoot: realSystemTemporaryRoot,
      })).toThrow(expect.objectContaining({
        code: expectedProjectTemporaryBoundaryCode(realProjectRoot, realSystemTemporaryRoot),
      }))
      await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('starts restart workers with a minimal secret-free environment and loopback contract', () => {
    const originalExternalKey = process.env.OPENAI_API_KEY
    const originalJwtSecret = process.env.JWT_SECRET
    const originalTrustProxy = process.env.TRUST_PROXY
    try {
      process.env.OPENAI_API_KEY = 'sk-must-not-reach-worker'
      process.env.JWT_SECRET = 'qa-jwt-secret'
      process.env.TRUST_PROXY = 'loopback'
      const environment = qaRestartWorkerEnvironment()
      expect(environment).toMatchObject({
        JWT_SECRET: 'qa-jwt-secret',
        PORT: '0',
        PHD_ATLAS_LISTEN_HOST: '127.0.0.1',
        TRUST_PROXY: 'loopback',
      })
      expect(environment).not.toHaveProperty('OPENAI_API_KEY')
      expect(JSON.stringify(environment)).not.toContain('sk-must-not-reach-worker')
    } finally {
      if (originalExternalKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalExternalKey
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = originalJwtSecret
      if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = originalTrustProxy
    }

    const toolSource = readFileSync(path.join(process.cwd(), 'tools', 'qa-concurrency.mjs'), 'utf8')
    const workerSource = readFileSync(
      path.join(process.cwd(), 'tools', 'qa-concurrency-restart-worker.mjs'),
      'utf8',
    )
    expect(toolSource).toContain("host: '127.0.0.1'")
    expect(toolSource).toContain('{ headers: authHeaders(tokens[userIndex]) }')
    expect(toolSource).toContain('{ headers: authHeaders(tokens[0]) }')
    expect(toolSource).toContain("startQaRestartWorker(projectRoot, { role: 'primary' })")
    expect(toolSource).toContain('primaryWorkerReady.processId !== process.pid')
    expect(toolSource).toContain('`${baseUrl}/api/workspace/bootstrap/stream`')
    expect(toolSource).not.toContain('runtimeSampler = createRuntimeSampler()')
    expect(workerSource).toContain("host: process.env.PHD_ATLAS_LISTEN_HOST || '127.0.0.1'")
    expect(workerSource).toContain("owner: 'api-worker'")
    expect(workerSource).toContain("type: 'diagnostics-response'")
  })

  it('starts a production-like loopback worker through trusted HTTPS proxy semantics and disposes it', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-qa-worker-'))
    const environmentKeys = [
      'NODE_ENV',
      'JWT_SECRET',
      'SETTINGS_ENCRYPTION_KEY',
      'BOOTSTRAP_USER_PASSWORD',
      'BOOTSTRAP_ADMIN_PASSWORD',
      'RATE_LIMIT_DISABLED',
      'PHD_ATLAS_STORAGE_ROOT',
      'PHD_ATLAS_SQLITE_PATH',
      'ALLOWED_HOSTS',
      'CORS_ORIGIN',
      'TRUST_PROXY',
      'PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST',
    ]
    const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]))
    let worker
    try {
      process.env.NODE_ENV = 'production'
      process.env.JWT_SECRET = 'qa-worker-jwt-secret-0123456789abcdef'
      process.env.SETTINGS_ENCRYPTION_KEY = 'qa-worker-encryption-key-0123456789'
      process.env.BOOTSTRAP_USER_PASSWORD = 'qa-worker-user-password-0123456789'
      process.env.BOOTSTRAP_ADMIN_PASSWORD = 'qa-worker-admin-password-0123456789'
      delete process.env.RATE_LIMIT_DISABLED
      process.env.PHD_ATLAS_STORAGE_ROOT = temporaryRoot
      process.env.PHD_ATLAS_SQLITE_PATH = path.join(temporaryRoot, 'worker.sqlite')
      process.env.ALLOWED_HOSTS = '127.0.0.1,localhost'
      process.env.CORS_ORIGIN = 'http://localhost:5173'
      process.env.TRUST_PROXY = 'loopback'
      process.env.PHD_ATLAS_QA_ALLOW_EPHEMERAL_LOOPBACK_HOST = '1'

      worker = startQaRestartWorker(process.cwd(), { role: 'primary' })
      let ready
      try {
        ready = await waitForQaRestartWorker(worker, 60_000)
      } catch (error) {
        throw new Error(`${error.message}\n${error.workerOutput || worker.output.join('')}`, { cause: error })
      }
      expect(ready).toMatchObject({
        type: 'ready',
        address: '127.0.0.1',
        role: 'primary',
        runtimeOwner: 'api-worker',
      })
      expect(ready.processId).not.toBe(process.pid)
      const plainHttp = await fetch(`http://127.0.0.1:${ready.port}/api/health/ready`, {
        redirect: 'manual',
      })
      expect([301, 400]).toContain(plainHttp.status)
      const health = await fetch(`http://127.0.0.1:${ready.port}/api/health/ready`, {
        headers: { host: '127.0.0.1', 'x-forwarded-proto': 'https' },
      })
      await expect(health.json()).resolves.toMatchObject({ data: { ready: true } })

      const diagnosticsBefore = await requestQaWorkerDiagnostics(worker, { timeoutMs: 5_000 })
      expect(diagnosticsBefore).toMatchObject({
        processId: ready.processId,
        role: 'primary',
        memory: {
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
          external: expect.any(Number),
          arrayBuffers: expect.any(Number),
        },
        memoryPressure: expect.any(Object),
        memoryReservations: expect.any(Object),
        requestBodyAdmission: expect.any(Object),
      })
      const parentArrayBuffersBefore = process.memoryUsage().arrayBuffers
      const parentOnlyAllocation = Buffer.alloc(32 * 1024 * 1024, 0x5a)
      expect(parentOnlyAllocation.at(-1)).toBe(0x5a)
      expect(process.memoryUsage().arrayBuffers - parentArrayBuffersBefore).toBeGreaterThanOrEqual(
        31 * 1024 * 1024,
      )
      const diagnosticsAfter = await requestQaWorkerDiagnostics(worker, { timeoutMs: 5_000 })
      expect(Math.max(
        0,
        diagnosticsAfter.memory.arrayBuffers - diagnosticsBefore.memory.arrayBuffers,
      )).toBeLessThan(8 * 1024 * 1024)
      expect(diagnosticsAfter.memoryPressure.budgetBytes).toBe(diagnosticsBefore.memoryPressure.budgetBytes)
      const idleDiagnostics = await waitForQaWorkerIdleDiagnostics(worker, { timeoutMs: 5_000 })
      expect(idleDiagnostics.memoryReservations).toMatchObject({
        reservedBytes: 0,
        activeReservations: 0,
      })

      const shutdownReport = await stopQaRestartWorker(
        worker,
        { gracefulTimeoutMs: 10_000, killTimeoutMs: 3_000 },
      )
      expect(assertQaWorkerShutdownComplete(worker, shutdownReport)).toBe(shutdownReport)
      expect(shutdownReport.runtime).toMatchObject({
        owner: 'api-worker',
        processId: ready.processId,
        role: 'primary',
        rssPeakMb: expect.any(Number),
        cpuPeakPercent: expect.any(Number),
        eventLoopDelay: { p99Ms: expect.any(Number) },
      })
      await worker.exitPromise
      expect(worker).toMatchObject({ settled: true, disposed: true })
      expect(worker.child.listenerCount('message')).toBe(0)
      expect(worker.child.listenerCount('error')).toBe(0)
      expect(worker.child.listenerCount('exit')).toBe(0)
      expect(worker.child.stdout?.listenerCount('data') ?? 0).toBe(0)
      expect(worker.child.stderr?.listenerCount('data') ?? 0).toBe(0)
    } finally {
      await stopQaRestartWorker(worker, { gracefulTimeoutMs: 1_000, killTimeoutMs: 1_000 })
        .catch(() => undefined)
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await fs.rm(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: process.platform === 'win32' ? 5 : 0,
        retryDelay: 100,
      })
    }
  }, 90_000)

  it('keeps CLI stdout to one parseable final report on safe preflight failure', async () => {
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        path.join(process.cwd(), 'tools', 'qa-concurrency.mjs'),
        '--profile=production-like',
      ], {
        cwd: process.cwd(),
        env: { ...process.env, PHD_ATLAS_QA_TEMP_ROOT: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
    })

    expect(outcome).toMatchObject({ code: 1, signal: null })
    const report = JSON.parse(outcome.stdout)
    expect(report).toMatchObject({
      status: 'fail',
      errors: [expect.objectContaining({ code: 'QA_TEMP_ROOT_REQUIRED' })],
    })
    const progress = outcome.stderr.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
    expect(progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'phd-atlas.qa-concurrency.progress', event: 'run-start' }),
      expect.objectContaining({ type: 'phd-atlas.qa-concurrency.progress', event: 'cleanup-complete' }),
    ]))
  })

  it('reports deterministic nearest-rank latency percentiles', () => {
    expect(summarizeLatencies([40, 10, 30, 20])).toEqual({
      count: 4,
      minMs: 10,
      p50Ms: 20,
      p95Ms: 40,
      p99Ms: 40,
      maxMs: 40,
    })
    expect(summarizeLatencies([])).toEqual({
      count: 0,
      minMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    })
  })

  it('fully reconstructs the production workspace NDJSON stream and requires its terminal frame', () => {
    const revision = 7
    const me = { user: { id: 'user-1' } }
    const application = { id: 'app-1', ownerId: 'user-1' }
    const frames = [
      { kind: 'manifest', protocol: 'phd-atlas-workspace-sections-v1', revision, sections: ['me', 'applications'] },
      { kind: 'section-begin', revision, section: 'me', shape: 'value', count: 1 },
      { kind: 'chunk', revision, section: 'me', item: 0, sequence: 0, data: JSON.stringify(me) },
      { kind: 'item-complete', revision, section: 'me', item: 0, chunks: 1, characters: JSON.stringify(me).length },
      { kind: 'section-complete', revision, section: 'me', items: 1 },
      { kind: 'section-begin', revision, section: 'applications', shape: 'array', count: 1 },
      { kind: 'chunk', revision, section: 'applications', item: 0, sequence: 0, data: JSON.stringify(application) },
      { kind: 'item-complete', revision, section: 'applications', item: 0, chunks: 1, characters: JSON.stringify(application).length },
      { kind: 'section-complete', revision, section: 'applications', items: 1 },
      { kind: 'complete', revision, sections: 2 },
    ]
    const response = {
      status: 200,
      headers: {
        contentType: 'application/x-ndjson; charset=utf-8',
        workspaceStreamProtocol: 'phd-atlas-workspace-sections-v1',
        workspaceRevision: String(revision),
      },
      payload: `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`,
    }

    expect(parseQaWorkspaceStreamResponse(response)).toMatchObject({
      revision,
      manifestSections: ['me', 'applications'],
      sections: { me, applications: [application] },
      terminalFrame: 'complete',
      frameCount: frames.length,
    })
    expect(() => parseQaWorkspaceStreamResponse({
      ...response,
      payload: `${frames.slice(0, -1).map((frame) => JSON.stringify(frame)).join('\n')}\n`,
    })).toThrow(expect.objectContaining({ code: 'QA_WORKSPACE_STREAM_INCOMPLETE' }))
  })

  it('accounts response-body traffic by phase and virtual user', () => {
    expect(summarizeHttpTraffic([
      { phase: 'reads', responseBodyBytes: 10, transferBodyBytes: 8 },
      { phase: 'reads', responseBodyBytes: 20, transferBodyBytes: 15 },
      { phase: 'conditional', responseBodyBytes: 0, transferBodyBytes: 0 },
    ], 2)).toEqual({
      requests: 3,
      requestsPerVirtualUser: 1.5,
      totalResponseBodyBytes: 30,
      totalTransferBodyBytes: 23,
      averageResponseBodyBytes: 10,
      byPhase: {
        reads: {
          requests: 2,
          requestsPerVirtualUser: 1,
          totalResponseBodyBytes: 30,
          totalTransferBodyBytes: 23,
          averageResponseBodyBytes: 15,
        },
        conditional: {
          requests: 1,
          requestsPerVirtualUser: 0.5,
          totalResponseBodyBytes: 0,
          totalTransferBodyBytes: 0,
          averageResponseBodyBytes: 0,
        },
      },
    })
  })

  it('accepts either a real field merge or one explicit 409 conflict', () => {
    expect(assessSameEntityConflict({
      programStatus: 200,
      tagStatus: 200,
      programPreserved: true,
      tagPreserved: true,
    })).toMatchObject({
      merged: true,
      conflictSafe: true,
      acceptedWritesReadable: true,
      silentLostUpdate: false,
    })

    expect(assessSameEntityConflict({
      programStatus: 200,
      tagStatus: 409,
      programPreserved: true,
      tagPreserved: false,
    })).toMatchObject({
      explicitConflict: true,
      conflictSafe: true,
      acceptedWritesReadable: true,
      silentLostUpdate: false,
    })
  })

  it('accepts only successful writes or structured SERVER_BUSY overload responses', () => {
    expect(classifyOverloadWriteResponse({ status: 204 })).toEqual({ kind: 'success' })
    expect(classifyOverloadWriteResponse(structuredCapacityResponse())).toMatchObject({
      kind: 'server-busy',
      retryAfter: '1',
      retryAfterMs: 1_000,
      explicitRetryAfterMs: 1_000,
      requestId: 'qa-capacity-request',
      source: 'admission-capacity',
    })

    expect(classifyOverloadWriteResponse({
      status: 503,
      headers: {},
      payload: { error: { code: 'SERVER_BUSY' } },
    })).toMatchObject({ kind: 'unexpected', status: 503 })
    expect(classifyOverloadWriteResponse({
      status: 502,
      headers: { retryAfter: '1' },
      payload: { error: { code: 'SERVER_BUSY' } },
    })).toMatchObject({ kind: 'unexpected', status: 502 })

    expect(classifyOverloadWriteResponse(structuredCapacityResponse({
      memoryPressure: 'hard',
    }))).toMatchObject({ kind: 'server-busy', source: 'memory-pressure' })
    const leakingBusy = structuredCapacityResponse()
    leakingBusy.payload.data = { privateWorkspace: true }
    expect(classifyOverloadWriteResponse(leakingBusy)).toMatchObject({ kind: 'unexpected', status: 503 })
    const mismatchedRequestId = structuredCapacityResponse()
    mismatchedRequestId.headers.requestId = 'different-request'
    expect(classifyOverloadWriteResponse(mismatchedRequestId)).toMatchObject({ kind: 'unexpected', status: 503 })
    expect(classifyOverloadWriteResponse(structuredCapacityResponse({
      memoryPressure: 'mystery',
    }))).toMatchObject({ kind: 'unexpected', status: 503 })
  })

  it('classifies store-write conflicts and terminal server-unavailable responses', () => {
    expect(isQaStoreWriteConflictResponse({
      status: 409,
      payload: { error: { code: 'APPLICATION_VERSION_CONFLICT' } },
    })).toBe(true)
    expect(isQaStoreWriteConflictResponse({
      status: 409,
      payload: { error: { code: 'VALIDATION_ERROR' } },
    })).toBe(false)
    expect(isQaServerUnavailableResponse({
      status: 503,
      payload: { error: { code: 'SERVER_BUSY' } },
    })).toBe(true)
    expect(isQaServerUnavailableResponse({
      status: 504,
      payload: { error: { code: 'SERVER_UNAVAILABLE' } },
    })).toBe(true)
    expect(isQaServerUnavailableResponse({
      status: 500,
      payload: { error: { code: 'INTERNAL_ERROR' } },
    })).toBe(false)
  })

  it('requires the durable mutation acknowledgement envelope before readback', () => {
    const digest = 'a'.repeat(43)
    const response = {
      status: 200,
      payload: {
        data: {
          protocol: 'phd-atlas-application-mutation-ack-v2',
          projectionVersion: 2,
          authorityProjectionVersion: 1,
          id: 'app-1',
          updatedAt: '2026-08-03T00:00:00.000Z',
          operationCount: 0,
          authorityPurpose: 'none',
          patch: [],
          mutationHash: digest,
          baselineHash: digest,
          applicationHash: digest,
          authorityHash: digest,
          canonicalHash: digest,
          durable: true,
        },
      },
    }
    expect(qaApplicationMutationAcknowledged(response, 'app-1')).toBe(true)
    expect(qaApplicationMutationAcknowledged({
      status: 200,
      payload: { data: { id: 'app-1', program: 'not an acknowledgement' } },
    }, 'app-1')).toBe(false)
    expect(qaApplicationMutationAcknowledged({
      ...response,
      payload: { data: { ...response.payload.data, id: 'app-2' } },
    }, 'app-1')).toBe(false)
    expect(qaApplicationMutationAcknowledged({
      ...response,
      payload: { data: { ...response.payload.data, canonicalHash: 'invalid' } },
    }, 'app-1')).toBe(false)
  })

  it('advances restart durability after an ACK while keeping an unavailable mixed readback failed', () => {
    const applicationId = 'app-mixed-ack'
    const previousApplication = {
      id: applicationId,
      ownerId: 'user-mixed-ack',
      program: 'overload-marker',
      tags: ['durable'],
      updatedAt: '2026-08-03T00:00:00.000Z',
    }
    const desiredApplication = {
      ...previousApplication,
      program: 'mixed-marker',
    }
    const expectedPrograms = new Map([[applicationId, previousApplication.program]])
    const expectedTags = new Map([[applicationId, previousApplication.tags]])
    const expectedApplications = new Map([[applicationId, previousApplication]])

    const acknowledgement = {
      id: applicationId,
      updatedAt: '2026-08-03T00:00:01.000Z',
    }
    const acknowledgedBaseline = advanceQaDurableApplicationExpectation({
      acknowledged: true,
      acknowledgement,
      applicationId,
      desiredApplication,
      expectedPrograms,
      expectedTags,
      expectedApplications,
    })
    expect(acknowledgedBaseline).toEqual({
      ...desiredApplication,
      updatedAt: acknowledgement.updatedAt,
    })
    expect(expectedApplications.get(applicationId)?.updatedAt).toBe(acknowledgement.updatedAt)

    const unavailableReadback = assessQaAcknowledgedApplicationReadback({
      acknowledged: true,
      readbackOutcome: 'exhausted',
      readback: structuredCapacityResponse(),
      applicationId,
      desiredApplication,
    })
    expect(unavailableReadback).toEqual({
      acknowledged: true,
      readable: false,
      dataLossProven: false,
    })

    expect(assessQaDurableReadback({
      status: 200,
      data: {
        ...desiredApplication,
        updatedAt: acknowledgement.updatedAt,
      },
      applicationId,
      expectedProgram: expectedPrograms.get(applicationId),
      expectedTags: expectedTags.get(applicationId),
      expectedApplication: expectedApplications.get(applicationId),
    })).toEqual({
      applicationId,
      durable: true,
      missingFields: [],
    })

    const report = passingQualificationReport()
    report.checks.mixedWorkloadSuccessful = unavailableReadback.readable
    report.dataLoss = {
      count: unavailableReadback.dataLossProven ? 1 : 0,
      acceptedWritesMissing: [],
    }
    const evaluation = evaluateQaConcurrencyReport(report, thresholds)
    expect(evaluation.status).toBe('fail')
    expect(evaluation.failedChecks).toContain('mixedWorkloadSuccessful')
    expect(report.checks.durableAfterRestart).toBe(true)
    expect(report.dataLoss.count).toBe(0)

    const nextDesiredApplication = {
      ...structuredClone(expectedApplications.get(applicationId)),
      updatedAt: acknowledgedBaseline.updatedAt,
      program: 'next-mixed-marker',
    }
    expect(nextDesiredApplication.updatedAt).toBe(acknowledgement.updatedAt)
    expect(nextDesiredApplication.updatedAt).not.toBe(previousApplication.updatedAt)
  })

  it('does not advance the write baseline or restart oracle without an ACK', () => {
    const applicationId = 'app-unacknowledged'
    const previousApplication = {
      id: applicationId,
      ownerId: 'user-unacknowledged',
      program: 'previous-marker',
      tags: ['previous'],
      updatedAt: '2026-08-03T00:00:00.000Z',
    }
    const expectedPrograms = new Map([[applicationId, previousApplication.program]])
    const expectedTags = new Map([[applicationId, previousApplication.tags]])
    const expectedApplications = new Map([[applicationId, structuredClone(previousApplication)]])

    expect(advanceQaDurableApplicationExpectation({
      acknowledged: false,
      acknowledgement: {
        id: applicationId,
        updatedAt: '2026-08-03T00:00:01.000Z',
      },
      applicationId,
      desiredApplication: {
        ...previousApplication,
        program: 'rejected-marker',
      },
      expectedPrograms,
      expectedTags,
      expectedApplications,
    })).toBeNull()
    expect(expectedPrograms.get(applicationId)).toBe(previousApplication.program)
    expect(expectedTags.get(applicationId)).toEqual(previousApplication.tags)
    expect(expectedApplications.get(applicationId)).toEqual(previousApplication)
  })

  it('fills the global active and queued body pool, proves queue-full, then retries after release', async () => {
    const state = {
      active: 0,
      waiting: 0,
      maxActive: 8,
      maxQueued: 128,
      maxActivePerKey: 2,
      maxQueuedPerKey: 2,
      activeKeys: 0,
      queuedKeys: 0,
      admitted: 0,
      rejected: 0,
      perKeyRejected: 0,
      timedOut: 0,
      cancelled: 0,
    }
    const waits = []
    const requestPhases = []
    const requestInitializers = []
    let writeAttempts = 0
    const openPausedRequest = () => {
      let resolve
      let released = false
      let owner = 'rejected'
      if (state.active < state.maxActive) {
        state.active += 1
        state.activeKeys += 1
        state.admitted += 1
        owner = 'active'
      } else if (state.waiting < state.maxQueued) {
        state.waiting += 1
        state.queuedKeys += 1
        owner = 'queued'
      } else {
        state.rejected += 1
      }
      const result = owner === 'rejected'
        ? Promise.resolve({
            ...structuredCapacityResponse({ requestId: 'qa-request-id' }),
            headers: {
              retryAfter: '1',
              retryAfterMs: '1000',
              requestId: 'qa-request-id',
              connection: 'close',
            },
          })
        : new Promise((settle) => { resolve = settle })
      return {
        result,
        abort() {
          if (released) return
          released = true
          if (owner === 'active') {
            state.active -= 1
            state.activeKeys -= 1
          } else if (owner === 'queued') {
            state.waiting -= 1
            state.queuedKeys -= 1
          }
          resolve?.({ status: 0, errorCode: 'QA_BODY_ADMISSION_HOLDER_RELEASED' })
        },
      }
    }
    const request = async (url, init, policy) => {
      requestPhases.push(policy.phase)
      requestInitializers.push(init)
      if (url.endsWith('/api/health/ready')) {
        return { status: 200, payload: { data: { ready: true } }, headers: {} }
      }
      if (url.endsWith('/api/health')) {
        return { status: 200, payload: { data: { status: 'ok' } }, headers: {} }
      }
      writeAttempts += 1
      return { status: 200, headers: {}, payload: { data: { id: 'app-1', program: 'recovered' } } }
    }

    const result = await probeQaRequestBodyBackpressure({
      baseUrl: 'http://127.0.0.1:4317',
      pathname: '/api/applications/app-1',
      holderTokens: Array.from({ length: 136 }, (_, index) => `holder-token-${index}`),
      probeToken: 'probe-token',
      body: JSON.stringify({ id: 'app-1', program: 'recovered' }),
      request,
      snapshot: () => ({ ...state }),
      openPausedRequest,
      wait: async (delayMs) => waits.push(delayMs),
      expectedMaxActive: 8,
      expectedMaxQueued: 128,
      isRetryAccepted: (response) => response?.payload?.data?.program === 'recovered',
    })

    expect(result).toMatchObject({
      holderCount: 136,
      saturated: { active: 8, waiting: 128, activeKeys: 8, queuedKeys: 128 },
      afterBusy: { rejected: 1, perKeyRejected: 0 },
      released: { active: 0, waiting: 0, activeKeys: 0, queuedKeys: 0 },
      busyResponse: { status: 503 },
      retryResponse: { status: 200 },
      healthResponse: { status: 200 },
    })
    expect(result.retryDelayMs).toBeGreaterThanOrEqual(1_000)
    expect(waits).toEqual([result.retryDelayMs])
    expect(requestPhases).toEqual([
      'bodyAdmissionBackpressure.healthDuring',
      'bodyAdmissionBackpressure.retry',
      'bodyAdmissionBackpressure.readback',
      'bodyAdmissionBackpressure.healthAfter',
      'bodyAdmissionBackpressure.readinessAfter',
    ])
    expect(requestInitializers.every((init) => (
      init?.headers?.authorization === 'Bearer probe-token'
    ))).toBe(true)
    expect(writeAttempts).toBe(2)
  })

  it('rejects a malformed or unattributed busy response and still releases every holder', async () => {
    const state = {
      active: 0,
      waiting: 0,
      maxActive: 8,
      maxQueued: 128,
      maxActivePerKey: 2,
      maxQueuedPerKey: 2,
      activeKeys: 0,
      queuedKeys: 0,
      admitted: 0,
      rejected: 0,
      perKeyRejected: 0,
      timedOut: 0,
      cancelled: 0,
    }
    let healthAttempts = 0
    const openPausedRequest = () => {
      let resolve
      let released = false
      let owner = 'rejected'
      if (state.active < state.maxActive) {
        state.active += 1
        state.activeKeys += 1
        owner = 'active'
      } else if (state.waiting < state.maxQueued) {
        state.waiting += 1
        state.queuedKeys += 1
        owner = 'queued'
      } else {
        state.rejected += 1
      }
      const result = owner === 'rejected'
        ? Promise.resolve({
            status: 503,
            headers: { connection: 'close' },
            payload: { ok: false, error: { code: 'SERVER_BUSY' }, requestId: 'qa-request-id' },
          })
        : new Promise((settle) => { resolve = settle })
      return {
        result,
        abort() {
          if (released) return
          released = true
          if (owner === 'active') {
            state.active -= 1
            state.activeKeys -= 1
          } else if (owner === 'queued') {
            state.waiting -= 1
            state.queuedKeys -= 1
          }
          resolve?.({ status: 0 })
        },
      }
    }

    await expect(probeQaRequestBodyBackpressure({
      baseUrl: 'http://127.0.0.1:4317',
      pathname: '/api/applications/app-1',
      holderTokens: Array.from({ length: 136 }, (_, index) => `holder-token-${index}`),
      probeToken: 'probe-token',
      body: JSON.stringify({ id: 'app-1' }),
      snapshot: () => ({ ...state }),
      openPausedRequest,
      wait: async () => undefined,
      expectedMaxActive: 8,
      expectedMaxQueued: 128,
      request: async (url) => {
        healthAttempts += 1
        expect(url).toMatch(/\/api\/health$/u)
        return { status: 200, payload: { data: { status: 'ok' } }, headers: {} }
      },
    })).rejects.toMatchObject({ code: 'QA_BODY_ADMISSION_BUSY_NOT_OBSERVED' })
    expect(healthAttempts).toBe(1)
    expect(state).toMatchObject({ active: 0, waiting: 0, activeKeys: 0, queuedKeys: 0 })
  })

  it('refuses a reshaped 136-slot body pool instead of treating it as the production default', async () => {
    await expect(probeQaRequestBodyBackpressure({
      baseUrl: 'http://127.0.0.1:4317',
      pathname: '/api/applications/app-1',
      holderTokens: Array.from({ length: 136 }, (_, index) => `holder-token-${index}`),
      probeToken: 'probe-token',
      body: '{}',
      request: async () => {
        throw new Error('capacity mismatch must fail before transport')
      },
      snapshot: () => ({
        active: 0,
        waiting: 0,
        maxActive: 7,
        maxQueued: 129,
      }),
      openPausedRequest: () => {
        throw new Error('capacity mismatch must fail before opening holders')
      },
      expectedMaxActive: 8,
      expectedMaxQueued: 128,
      wait: async () => undefined,
    })).rejects.toMatchObject({ code: 'QA_BODY_ADMISSION_CAPACITY_MISMATCH' })
  })

  it('retries only structured SERVER_BUSY and preserves the required terminal semantics', async () => {
    const waits = []
    const responses = [
      structuredCapacityResponse(),
      { status: 403, headers: {}, payload: { error: { code: 'FORBIDDEN' } } },
    ]
    const denied = await executeRetriableServerBusyOperation({
      index: 7,
      maxRetries: 3,
      operation: async () => responses.shift(),
      isAccepted: (response) => response.status === 403 || response.status === 404,
      wait: async (delayMs) => waits.push(delayMs),
    })
    expect(denied).toMatchObject({ kind: 'success', attempts: 2 })
    expect(denied.responses.map((entry) => entry.classification.kind)).toEqual([
      'server-busy',
      'success',
    ])
    expect(waits).toHaveLength(1)

    const unauthorizedSuccess = await executeRetriableServerBusyOperation({
      index: 0,
      maxRetries: 24,
      operation: async () => ({ status: 200, headers: {}, payload: { data: {} } }),
      isAccepted: (response) => response.status === 403 || response.status === 404,
      wait: async () => {
        throw new Error('An authorization success must never be retried')
      },
    })
    expect(unauthorizedSuccess).toMatchObject({
      kind: 'unexpected',
      attempts: 1,
      responses: [{ classification: { kind: 'unexpected', status: 200 } }],
    })

    const malformedBusy = await executeRetriableServerBusyOperation({
      index: 0,
      maxRetries: 24,
      operation: async () => ({
        status: 503,
        headers: {},
        payload: { error: { code: 'SERVER_BUSY' } },
      }),
      isAccepted: () => false,
      wait: async () => {
        throw new Error('Malformed capacity responses must never be retried')
      },
    })
    expect(malformedBusy).toMatchObject({ kind: 'unexpected', attempts: 1 })

    let streamAttempt = 0
    const streamRestart = await executeRetriableServerBusyOperation({
      index: 1,
      maxRetries: 3,
      operation: async () => {
        streamAttempt += 1
        return streamAttempt === 1
          ? { status: 200, streamRestartCode: 'SERVER_BUSY' }
          : { status: 200, streamComplete: true }
      },
      isAccepted: (response) => response.streamComplete === true,
      classifyRetry: (response) => response.streamRestartCode
        ? { kind: 'server-busy', retryAfter: null, streamRestartCode: response.streamRestartCode }
        : null,
      wait: async (delayMs) => waits.push(delayMs),
    })
    expect(streamRestart).toMatchObject({
      kind: 'success',
      attempts: 2,
      responses: [
        { classification: { kind: 'server-busy', streamRestartCode: 'SERVER_BUSY' } },
        { classification: { kind: 'success' } },
      ],
    })
  })

  it('attributes authenticated-read capacity retries by bounded route diagnostics', () => {
    const admissionResponse = structuredCapacityResponse()
    const pressureResponse = structuredCapacityResponse({
      requestId: 'qa-memory-pressure',
      memoryPressure: 'soft',
    })
    const admission = classifyOverloadWriteResponse(admissionResponse)
    const pressure = classifyOverloadWriteResponse(pressureResponse)
    const first = summarizeQaRetriableCapacity({
      attempts: 3,
      responses: [
        { response: admissionResponse, classification: admission },
        { response: pressureResponse, classification: pressure },
        { response: { status: 200 }, classification: { kind: 'success' } },
      ],
    })
    expect(first).toEqual({
      operations: 1,
      attempts: 3,
      retries: 2,
      serverBusyResponses: 2,
      sources: { 'admission-capacity': 1, 'memory-pressure': 1 },
      statuses: { 503: 2 },
      errorCodes: { SERVER_BUSY: 2 },
    })
    expect(mergeQaRetriableCapacitySummaries([
      first,
      summarizeQaRetriableCapacity({
        attempts: 1,
        responses: [{ response: { status: 200 }, classification: { kind: 'success' } }],
      }),
    ])).toEqual({
      operations: 2,
      attempts: 4,
      retries: 2,
      serverBusyResponses: 2,
      sources: { 'admission-capacity': 1, 'memory-pressure': 1 },
      statuses: { 503: 2 },
      errorCodes: { SERVER_BUSY: 2 },
    })
  })

  it('recognizes structured login capacity and mirrors bounded client retry jitter', () => {
    expect(classifyLoginResponse({
      status: 200,
      payload: { data: { token: 'session-token' } },
    })).toEqual({ kind: 'success' })
    expect(classifyLoginResponse({
      ...structuredCapacityResponse({
        status: 429,
        code: 'AUTH_CAPACITY_EXCEEDED',
        retryAfter: '2',
        retryAfterMs: '1250',
      }),
    })).toMatchObject({
      kind: 'auth-capacity',
      retryAfter: '2',
      retryAfterMs: 1_250,
      explicitRetryAfterMs: 1_250,
    })
    expect(classifyLoginResponse({
      ...structuredCapacityResponse(),
    })).toMatchObject({
      kind: 'request-capacity',
      retryAfter: '1',
      retryAfterMs: 1_000,
      explicitRetryAfterMs: 1_000,
    })
    expect(classifyLoginResponse({
      status: 429,
      headers: {},
      payload: { error: { code: 'AUTH_CAPACITY_EXCEEDED' } },
    })).toMatchObject({ kind: 'unexpected', status: 429 })

    const firstDelay = loginCapacityRetryDelayMs({ attempt: 0, seed: 4 })
    expect(firstDelay).toBe(loginCapacityRetryDelayMs({ attempt: 0, seed: 4 }))
    expect(firstDelay).toBeGreaterThanOrEqual(500)
    expect(firstDelay).toBeLessThanOrEqual(550)
    const headerDelay = loginCapacityRetryDelayMs({
      attempt: 0,
      retryAfter: '2',
      retryAfterMs: '1250',
      seed: 4,
    })
    expect(headerDelay).toBeGreaterThanOrEqual(1_250)
    expect(headerDelay).toBeLessThanOrEqual(1_375)
  })

  it('honors Retry-After while applying deterministic bounded retry jitter', () => {
    const now = Date.UTC(2026, 7, 2, 12, 0, 0)
    expect(retryAfterMilliseconds('2', now)).toBe(2_000)
    expect(retryAfterMilliseconds(new Date(now + 3_000).toUTCString(), now)).toBe(3_000)
    expect(retryAfterMilliseconds('invalid', now)).toBe(0)

    const firstDelay = overloadRetryDelayMs({ attempt: 1, retryAfter: '1', seed: 7 })
    expect(firstDelay).toBe(overloadRetryDelayMs({ attempt: 1, retryAfter: '1', seed: 7 }))
    expect(firstDelay).toBeGreaterThanOrEqual(1_000)
    expect(firstDelay).toBeLessThanOrEqual(1_250)

    const secondDelay = overloadRetryDelayMs({ attempt: 2, retryAfter: undefined, seed: 7 })
    expect(secondDelay).toBeGreaterThanOrEqual(500)
    expect(secondDelay).toBeLessThanOrEqual(750)

    const boundedLateDelay = overloadRetryDelayMs({ attempt: 24, retryAfter: '1', seed: 7 })
    expect(boundedLateDelay).toBeGreaterThanOrEqual(1_500)
    expect(boundedLateDelay).toBeLessThanOrEqual(1_750)
  })

  it('reports bounded redacted overload evidence with separate write and readback terminals', () => {
    const writeFailure = {
      index: 3,
      applicationId: 'app-3',
      kind: 'exhausted',
      attempts: 25,
      responses: [{
        classification: { kind: 'server-busy', retryAfter: '1', token: 'write-secret' },
        response: {
          ...structuredCapacityResponse(),
          phase: 'overloadWrites.write',
          method: 'PUT',
          ms: 12,
        },
      }],
      readbackOutcome: null,
    }
    const readbackFailure = {
      index: 4,
      applicationId: 'app-4',
      kind: 'success',
      attempts: 2,
      responses: [{
        classification: { kind: 'success' },
        response: { status: 200, phase: 'overloadWrites.write', method: 'PUT', ms: 8 },
      }],
      readbackOutcome: {
        kind: 'exhausted',
        attempts: 25,
        responses: [{
          classification: { kind: 'server-busy', retryAfter: '1', password: 'read-secret' },
          response: {
            ...structuredCapacityResponse({ memoryPressure: 'soft' }),
            phase: 'overloadWrites.readback',
            method: 'GET',
            ms: 17,
          },
        }],
      },
    }
    const evidence = summarizeQaOverloadFailures([writeFailure, readbackFailure])

    expect(evidence).toMatchObject([
      {
        index: 3,
        applicationId: 'app-3',
        failureStage: 'write',
        write: {
          outcome: 'exhausted',
          attempts: 25,
          finalClassification: { kind: 'server-busy', token: '[REDACTED]' },
          finalResponse: { status: 503, errorCode: 'SERVER_BUSY' },
        },
        readback: { outcome: 'not-run', attempts: 0, finalResponse: null },
      },
      {
        index: 4,
        failureStage: 'readback',
        write: { outcome: 'success', attempts: 2, finalResponse: { status: 200 } },
        readback: {
          outcome: 'exhausted',
          attempts: 25,
          finalClassification: { kind: 'server-busy', password: '[REDACTED]' },
          finalResponse: { status: 503, memoryPressure: 'soft' },
        },
      },
    ])
    expect(JSON.stringify(evidence)).not.toContain('write-secret')
    expect(JSON.stringify(evidence)).not.toContain('read-secret')
    expect(evidence[1].write.finalResponse).not.toHaveProperty('payload')

    const manyFailures = Array.from({ length: QA_FAILURE_DIAGNOSTIC_LIMIT + 4 }, (_, index) => ({
      ...writeFailure,
      index,
      applicationId: `app-${index}`,
    }))
    expect(summarizeQaOverloadFailures(manyFailures)).toHaveLength(QA_FAILURE_DIAGNOSTIC_LIMIT)
  })

  it('bounds and redacts mixed diagnostics without changing qualification evaluation', () => {
    const failedResults = Array.from({ length: QA_FAILURE_DIAGNOSTIC_LIMIT + 3 }, (_, index) => ({
      index,
      kind: 'write',
      ok: false,
      outcome: index === 0 ? 'success' : 'exhausted',
      attempts: 25,
      failureStage: index === 0 ? 'readback' : 'write',
      writeDiagnostic: {
        outcome: index === 0 ? 'success' : 'exhausted',
        attempts: 25,
        finalClassification: { kind: 'server-busy', authorization: 'Bearer mixed-secret' },
        finalResponse: { status: 503, errorCode: 'SERVER_BUSY' },
      },
      readbackDiagnostic: {
        outcome: index === 0 ? 'exhausted' : 'not-run',
        attempts: index === 0 ? 25 : 0,
        finalClassification: { kind: 'server-busy' },
        finalResponse: { status: 503, memoryPressure: 'soft' },
      },
      finalClassification: { kind: 'server-busy' },
      finalResponse: { status: 503, errorCode: 'SERVER_BUSY' },
    }))
    const evidence = summarizeQaMixedFailures([
      ...failedResults,
      { index: 99, kind: 'read', ok: true },
    ])

    expect(evidence).toHaveLength(QA_FAILURE_DIAGNOSTIC_LIMIT)
    expect(evidence[0]).toMatchObject({
      index: 0,
      kind: 'write',
      failureStage: 'readback',
      write: {
        outcome: 'success',
        finalClassification: { authorization: '[REDACTED]' },
      },
      readback: { outcome: 'exhausted', finalResponse: { memoryPressure: 'soft' } },
    })
    expect(JSON.stringify(evidence)).not.toContain('mixed-secret')

    const report = passingQualificationReport()
    report.phases.overloadWrites.failureCount = failedResults.length
    report.phases.overloadWrites.failureEvidenceLimit = QA_FAILURE_DIAGNOSTIC_LIMIT
    report.phases.overloadWrites.failuresTruncated = 3
    report.phases.overloadWrites.failures = evidence
    expect(evaluateQaConcurrencyReport(report, thresholds).status).toBe('pass')

    report.checks.overloadWritesEventuallyReadable = false
    expect(evaluateQaConcurrencyReport(report, thresholds)).toMatchObject({
      status: 'fail',
      failedChecks: expect.arrayContaining(['overloadWritesEventuallyReadable']),
    })
  })

  it('treats two successful stale writes with a missing field as data loss', () => {
    expect(assessSameEntityConflict({
      programStatus: 200,
      tagStatus: 200,
      programPreserved: false,
      tagPreserved: true,
    })).toMatchObject({
      conflictSafe: false,
      acceptedWritesReadable: false,
      lostAcceptedFields: ['program'],
      silentLostUpdate: true,
    })

    const report = passingReport()
    report.checks.sameEntityConflictSafe = false
    report.checks.acceptedSameEntityWritesReadable = false
    report.dataLoss.count = 1
    expect(evaluateQaConcurrencyReport(report, thresholds)).toMatchObject({
      status: 'fail',
      correctnessPassed: false,
      failedChecks: expect.arrayContaining([
        'sameEntityConflictSafe',
        'acceptedSameEntityWritesReadable',
      ]),
    })
  })

  it('fails unexpected 5xx responses and event-loop threshold regressions', () => {
    const report = passingReport()
    report.http.expectedServerBusy.count = 17
    expect(evaluateQaConcurrencyReport(report, thresholds)).toMatchObject({
      status: 'pass',
      correctnessPassed: true,
      performancePassed: true,
    })

    report.http.unexpected5xx.count = 1
    report.runtime.eventLoopDelay.p99Ms = 6_000
    expect(evaluateQaConcurrencyReport(report, thresholds)).toMatchObject({
      status: 'fail',
      correctnessPassed: false,
      performancePassed: false,
      performance: { eventLoopP99: false },
    })
  })

  it('refuses qualification passes with downgraded scale or unexercised overload rejection', () => {
    const passing = passingQualificationReport()
    expect(qaQualificationProfileMet(passing)).toBe(true)
    expect(evaluateQaConcurrencyReport(passing, thresholds)).toMatchObject({
      status: 'pass',
      qualification: { requested: true, profileMet: true, passed: true },
    })

    const downgraded = passingQualificationReport()
    downgraded.profile.virtualUsers = 2
    downgraded.profile.loginUsers = 1
    downgraded.profile.sseObservers = 1
    downgraded.phases.concurrentLogin.attempted = 1
    downgraded.phases.sseConnections.connected = 2
    downgraded.phases.sseAccountScope.observers = 1
    downgraded.phases.healthWebSocketSameIp.ready = 1
    downgraded.phases.overloadWrites.attempted = 0
    downgraded.phases.mixedWorkload.attempted = 2
    downgraded.checks.qualificationProfileMet = qaQualificationProfileMet(downgraded)
    expect(evaluateQaConcurrencyReport(downgraded, thresholds)).toMatchObject({
      status: 'fail',
      failedChecks: expect.arrayContaining(['qualificationProfileMet']),
      qualification: { requested: true, profileMet: false, passed: false },
    })

    const retryDowngraded = passingQualificationReport()
    retryDowngraded.profile.overloadRetries = 8
    expect(qaQualificationProfileMet(retryDowngraded)).toBe(false)

    const bodyAdmissionDowngraded = passingQualificationReport()
    bodyAdmissionDowngraded.phases.bodyAdmissionBackpressure.holders = 1
    bodyAdmissionDowngraded.checks.qualificationProfileMet = qaQualificationProfileMet(bodyAdmissionDowngraded)
    expect(bodyAdmissionDowngraded.checks.qualificationProfileMet).toBe(false)

    for (const [active, queued] of [[7, 129], [16, 120]]) {
      const reshapedAdmission = passingQualificationReport()
      Object.assign(reshapedAdmission.phases.bodyAdmissionBackpressure, {
        configuredActive: active,
        configuredQueued: queued,
        holders: active + queued,
        saturated: { active, waiting: queued },
      })
      expect(qaQualificationProfileMet(reshapedAdmission)).toBe(false)
    }

    const noBusyResponse = passingQualificationReport()
    noBusyResponse.checks.overloadObservedStructuredBusy = false
    expect(evaluateQaConcurrencyReport(noBusyResponse, thresholds)).toMatchObject({
      status: 'fail',
      failedChecks: expect.arrayContaining(['overloadObservedStructuredBusy']),
    })

    const noBodyAdmissionRecovery = passingQualificationReport()
    noBodyAdmissionRecovery.checks.bodyAdmissionBackpressureRecovered = false
    expect(evaluateQaConcurrencyReport(noBodyAdmissionRecovery, thresholds)).toMatchObject({
      status: 'fail',
      failedChecks: expect.arrayContaining(['bodyAdmissionBackpressureRecovered']),
    })

    const readsOnly = passingQualificationReport()
    Object.assign(readsOnly.phases.mixedWorkload, { writes: 0, logins: 0, reads: 100 })
    readsOnly.checks.qualificationProfileMet = qaQualificationProfileMet(readsOnly)
    expect(readsOnly.checks.qualificationProfileMet).toBe(false)

    const reusedLoginPrincipals = passingQualificationReport()
    reusedLoginPrincipals.phases.mixedWorkload.freshLoginPrincipals = 0
    reusedLoginPrincipals.checks.qualificationProfileMet = qaQualificationProfileMet(reusedLoginPrincipals)
    expect(reusedLoginPrincipals.checks.qualificationProfileMet).toBe(false)

    const inProcessServer = passingQualificationReport()
    inProcessServer.profile.apiWorkerProcessIsolated = false
    inProcessServer.phases.processIsolation.apiProcessId = 99
    inProcessServer.phases.processIsolation.distinctProcesses = false
    expect(qaQualificationProfileMet(inProcessServer)).toBe(false)

    const legacyMixedReads = passingQualificationReport()
    Object.assign(legacyMixedReads.phases.mixedWorkload, {
      streamReads: 0,
      completedStreamReads: 0,
      isolatedStreamApplications: 0,
      streamRoute: '/api/workspace/bootstrap',
    })
    expect(qaQualificationProfileMet(legacyMixedReads)).toBe(false)

    const reusedWorker = passingQualificationReport()
    reusedWorker.phases.durabilityRestart.restartProcessId = 100
    reusedWorker.phases.durabilityRestart.freshProcess = false
    expect(qaQualificationProfileMet(reusedWorker)).toBe(false)

    const leakedReservation = passingQualificationReport()
    leakedReservation.phases.finalHealth.workerDiagnostics.memoryReservations.reservedBytes = 1
    expect(qaQualificationProfileMet(leakedReservation)).toBe(false)
  })

  it('requires every accepted program and tag field after a fresh-worker restart', () => {
    const expectedApplication = {
      id: 'app-1',
      program: 'latest',
      tags: ['interview', 'priority'],
      updatedAt: '2026-08-02T10:00:00.000Z',
      notes: { statement: 'preserve this nested field' },
    }
    expect(assessQaDurableReadback({
      status: 200,
      data: { ...expectedApplication, updatedAt: '2026-08-02T10:00:01.000Z' },
      applicationId: 'app-1',
      expectedProgram: 'latest',
      expectedTags: ['priority', 'interview'],
      expectedApplication,
    })).toEqual({ applicationId: 'app-1', durable: true, missingFields: [] })

    expect(assessQaDurableReadback({
      status: 200,
      data: { id: 'app-1', program: 'latest', tags: ['priority'] },
      applicationId: 'app-1',
      expectedProgram: 'latest',
      expectedTags: ['priority', 'interview'],
    })).toEqual({ applicationId: 'app-1', durable: false, missingFields: ['tags'] })

    expect(assessQaDurableReadback({
      status: 200,
      data: { ...expectedApplication, notes: {} },
      applicationId: 'app-1',
      expectedProgram: 'latest',
      expectedTags: ['priority', 'interview'],
      expectedApplication,
    })).toEqual({ applicationId: 'app-1', durable: false, missingFields: ['application'] })
  })

  it('compares authored application fields while allowing explicit canonical defaults', () => {
    const expectedApplication = {
      id: 'app-1',
      ownerId: 'user-1',
      program: 'Computer Science PhD',
      tags: ['priority'],
      notes: { statement: 'keep this exact nested value' },
      tasks: [{ id: 'task-1', title: 'Submit', done: false }],
      backupSettings: { autoBackup: true, frequency: '5m', maxBackups: 99 },
      updatedAt: 'client-version',
    }
    const canonicalApplication = {
      ...expectedApplication,
      updatedAt: 'server-version',
      backupSettings: { autoBackup: true, frequency: '15m', maxBackups: 10 },
      tasks: [{
        ...expectedApplication.tasks[0],
        details: '',
        reminderEnabled: false,
        reminderOffsets: [],
        versions: [],
      }],
      communications: [],
      reviewComments: [],
      versions: [],
    }

    expect(assessQaDurableReadback({
      status: 200,
      data: canonicalApplication,
      applicationId: 'app-1',
      expectedProgram: expectedApplication.program,
      expectedTags: expectedApplication.tags,
      expectedApplication,
    })).toEqual({ applicationId: 'app-1', durable: true, missingFields: [] })
    expect(qaApplicationShapeDifferencePaths(canonicalApplication, expectedApplication)).toEqual([
      'communications',
      'reviewComments',
      'tasks[0].details',
      'tasks[0].reminderEnabled',
      'tasks[0].reminderOffsets',
      'tasks[0].versions',
      'versions',
    ])

    expect(assessQaDurableReadback({
      status: 200,
      data: {
        ...canonicalApplication,
        ownerId: 'user-2',
        notes: { statement: 'lost' },
      },
      applicationId: 'app-1',
      expectedProgram: expectedApplication.program,
      expectedTags: expectedApplication.tags,
      expectedApplication,
    })).toEqual({ applicationId: 'app-1', durable: false, missingFields: ['application'] })
  })

  it('fails qualification when mixed/overload latency or RSS crosses its hard budget', () => {
    const report = passingQualificationReport()
    report.phases.overloadWrites.endToEndLatency.p95Ms = 60_001
    report.phases.mixedWorkload.p95Ms = 30_001
    report.runtime.rssPeakMb = 448

    expect(evaluateQaConcurrencyReport(report, thresholds)).toMatchObject({
      status: 'fail',
      performancePassed: false,
      performance: {
        overloadP95: false,
        mixedP95: false,
        rssBelowHardLimit: false,
      },
    })
  })
})
