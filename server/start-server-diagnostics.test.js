import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKER_FATAL_STATUS_RELATIVE_PATH,
  writeWorkerFatalDiagnosticSync,
} from '../tools/container-entrypoint.mjs'
import {
  createBoundedGracefulShutdown,
  gracefulShutdownTimeoutMs,
  installWorkerFatalDiagnostics,
  serverWorkerRestartDelayMs,
  shouldRestartServerWorker,
  storageShutdownRetryWindowMs,
} from '../tools/start-server.mjs'

const scratchRoots = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-worker-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })))
  scratchRoots.clear()
})

describe('server worker fatal diagnostics', () => {
  it('observes fatal origin without forwarding the error, stack, or rejection data', () => {
    const processRef = new EventEmitter()
    processRef.pid = 91_001
    processRef.exitCode = null
    const writeDiagnostic = vi.fn()
    const remove = installWorkerFatalDiagnostics('ignored-storage', {
      processRef,
      writeDiagnostic,
    })

    processRef.emit(
      'uncaughtExceptionMonitor',
      new Error('database password must never be persisted'),
      'unhandledRejection',
    )

    expect(writeDiagnostic).toHaveBeenCalledOnce()
    expect(writeDiagnostic.mock.calls[0][1]).toEqual({
      fatalType: 'unhandled_rejection',
      pid: 91_001,
      code: 1,
      signal: null,
    })
    expect(JSON.stringify(writeDiagnostic.mock.calls[0][1])).not.toContain('password')
    remove()
    expect(processRef.listenerCount('uncaughtExceptionMonitor')).toBe(0)
  })

  it('does not interfere with Node fatal behavior when diagnostic storage fails', () => {
    const processRef = new EventEmitter()
    processRef.pid = 91_002
    processRef.exitCode = 7
    installWorkerFatalDiagnostics('read-only-storage', {
      processRef,
      writeDiagnostic: () => {
        throw new Error('read only')
      },
    })

    expect(() => processRef.emit(
      'uncaughtExceptionMonitor',
      new Error('fatal'),
      'uncaughtException',
    )).not.toThrow()
  })

  it('atomically writes only allowlisted fatal and resource fields', async () => {
    const storageRoot = await scratch('fatal-status')
    const processRef = {
      pid: 91_003,
      memoryUsage: () => ({
        rss: 1_000,
        heapTotal: 900,
        heapUsed: 800,
        external: 100,
        arrayBuffers: 50,
        secret: 'must-not-survive',
      }),
      resourceUsage: () => ({
        userCPUTime: 11,
        systemCPUTime: 12,
        maxRSS: 13,
        fsRead: 14,
        fsWrite: 15,
        involuntaryContextSwitches: 16,
        commandLine: '--password secret',
      }),
    }

    expect(writeWorkerFatalDiagnosticSync(storageRoot, {
      fatalType: 'uncaught_exception',
      pid: processRef.pid,
      code: 1,
      signal: null,
      stack: 'secret stack',
      requestBody: 'secret request',
    }, {
      processRef,
      cgroupMemory: {
        currentBytes: 950,
        maxBytes: 1_000,
        events: { oom: 1, oom_kill: 1, secret: 999 },
        environment: 'secret env',
      },
    })).toBe(true)

    const contents = await fs.readFile(
      path.join(storageRoot, WORKER_FATAL_STATUS_RELATIVE_PATH),
      'utf8',
    )
    expect(JSON.parse(contents)).toMatchObject({
      type: 'worker_fatal',
      fatalType: 'uncaught_exception',
      pid: 91_003,
      code: 1,
      signal: null,
      processMemory: { rssBytes: 1_000, heapUsedBytes: 800 },
      processResources: { maxRssKb: 13, fsRead: 14, fsWrite: 15 },
      cgroupMemory: {
        currentBytes: 950,
        maxBytes: 1_000,
        events: { oom: 1, oom_kill: 1 },
      },
    })
    expect(contents).not.toContain('secret')
    const files = await fs.readdir(path.dirname(
      path.join(storageRoot, WORKER_FATAL_STATUS_RELATIVE_PATH),
    ))
    expect(files.some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('preserves the real Node fatal exit while writing a redacted status file', async () => {
    const storageRoot = await scratch('fatal-subprocess')
    const scriptPath = path.join(storageRoot, 'fatal-child.mjs')
    const startServerUrl = pathToFileURL(path.resolve(
      process.cwd(),
      'tools',
      'start-server.mjs',
    )).href
    await fs.writeFile(scriptPath, [
      `import { installWorkerFatalDiagnostics } from ${JSON.stringify(startServerUrl)}`,
      `installWorkerFatalDiagnostics(${JSON.stringify(storageRoot)})`,
      "setImmediate(() => { throw new Error('credential-secret-must-not-be-persisted') })",
      '',
    ].join('\n'))

    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      stdio: 'ignore',
      windowsHide: true,
    })
    const [code, signal] = await once(child, 'exit')

    expect(signal).toBeNull()
    expect(code).not.toBe(0)
    const contents = await fs.readFile(
      path.join(storageRoot, WORKER_FATAL_STATUS_RELATIVE_PATH),
      'utf8',
    )
    expect(JSON.parse(contents)).toMatchObject({
      type: 'worker_fatal',
      fatalType: 'uncaught_exception',
      code: 1,
    })
    expect(contents).not.toContain('credential-secret')
  })
})

describe('server worker supervision', () => {
  it('restarts unexpected exits but preserves deliberate shutdown and update handoff codes', () => {
    expect(shouldRestartServerWorker({ code: 1, signal: null })).toBe(true)
    expect(shouldRestartServerWorker({ code: null, signal: 'SIGKILL' })).toBe(true)
    expect(shouldRestartServerWorker({ code: 0, signal: null })).toBe(false)
    expect(shouldRestartServerWorker({ code: 75, signal: null })).toBe(false)
    expect(shouldRestartServerWorker(
      { code: 1, signal: null },
      { shutdownRequested: true },
    )).toBe(false)
  })

  it('uses bounded exponential restart backoff with deterministic jitter', () => {
    expect(serverWorkerRestartDelayMs(0, () => 0.5)).toBe(750)
    expect(serverWorkerRestartDelayMs(1, () => 0.5)).toBe(1_500)
    expect(serverWorkerRestartDelayMs(20, () => 0.5)).toBe(15_000)
    expect(serverWorkerRestartDelayMs(0, () => 0)).toBe(638)
    expect(serverWorkerRestartDelayMs(0, () => 1)).toBe(862)
    expect(serverWorkerRestartDelayMs(0, () => { throw new Error('no entropy') })).toBe(750)
  })
})

describe('bounded graceful worker shutdown', () => {
  it('drains the listener before flushing storage and exits successfully', async () => {
    const events = []
    const processRef = { exit: vi.fn(), exitCode: null }
    const timeoutHandle = { unref: vi.fn() }
    const timers = {
      setTimeout: vi.fn(() => timeoutHandle),
      clearTimeout: vi.fn(),
    }
    const shutdown = createBoundedGracefulShutdown({
      clearBootConfirmation: () => events.push('clear-boot'),
      releasePendingBootClaim: async () => { events.push('release-claim') },
      stopServer: async () => {
        events.push('stop-server')
        return { safeToShutdownStorage: true }
      },
      shutdownStorage: async () => { events.push('flush-storage') },
      removeFatalDiagnostics: () => events.push('remove-diagnostics'),
      timeoutMs: 50,
      processRef,
      timers,
    })

    await expect(shutdown()).resolves.toEqual({
      timedOut: false,
      ok: true,
      safeToShutdownStorage: true,
      durabilityPreserved: true,
      safeToExit: true,
      storageAttempts: 1,
      durabilityRecoveryWindowExceeded: false,
      handoffPrepared: true,
    })
    expect(events).toEqual([
      'clear-boot',
      'release-claim',
      'stop-server',
      'flush-storage',
      'remove-diagnostics',
    ])
    expect(timeoutHandle.unref).toHaveBeenCalledOnce()
    expect(timers.clearTimeout).toHaveBeenCalledWith(timeoutHandle)
    expect(processRef.exitCode).toBe(0)
    expect(processRef.exit).toHaveBeenCalledWith(0)
  })

  it('leaves storage open for supervisor termination when draining exceeds the deadline', async () => {
    const never = new Promise(() => {})
    const processRef = { exit: vi.fn(), exitCode: null }
    const logError = vi.fn()
    const releaseExitHold = vi.fn()
    const removeFatalDiagnostics = vi.fn()
    const releasePendingBootClaim = vi.fn().mockResolvedValue(undefined)
    const stopServer = vi.fn(() => never)
    const shutdownStorage = vi.fn()
    const timers = {
      setTimeout: vi.fn((callback) => {
        queueMicrotask(callback)
        return { unref: vi.fn() }
      }),
      clearTimeout: vi.fn(),
    }
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim,
      stopServer,
      shutdownStorage,
      timeoutMs: 25,
      processRef,
      timers,
      logError,
      createExitHold: () => releaseExitHold,
      removeFatalDiagnostics,
    })

    const first = shutdown()
    expect(shutdown()).toBe(first)
    await expect(first).resolves.toEqual({
      timedOut: true,
      ok: false,
      safeToShutdownStorage: false,
      durabilityPreserved: false,
      safeToExit: false,
    })
    expect(releasePendingBootClaim).toHaveBeenCalledOnce()
    expect(stopServer).toHaveBeenCalledOnce()
    expect(shutdownStorage).not.toHaveBeenCalled()
    expect(logError.mock.calls[0][0]).toContain('exceeded 25ms')
    expect(processRef.exitCode).toBe(1)
    expect(processRef.exit).not.toHaveBeenCalled()
    expect(releaseExitHold).not.toHaveBeenCalled()
    expect(removeFatalDiagnostics).not.toHaveBeenCalled()
  })

  it('contains a late drain rejection after the outer deadline without touching storage', async () => {
    let rejectStop
    const lateStop = new Promise((_resolve, reject) => { rejectStop = reject })
    const processRef = { exit: vi.fn(), exitCode: null }
    const shutdownStorage = vi.fn()
    const logError = vi.fn()
    const timers = {
      setTimeout: vi.fn((callback) => {
        queueMicrotask(callback)
        return { unref: vi.fn() }
      }),
      clearTimeout: vi.fn(),
    }
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn(() => lateStop),
      shutdownStorage,
      timeoutMs: 25,
      processRef,
      timers,
      logError,
    })

    await shutdown()
    rejectStop(new Error('late listener failure'))
    await Promise.resolve()
    await Promise.resolve()

    expect(shutdownStorage).not.toHaveBeenCalled()
    expect(processRef.exit).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      '[server] Graceful listener shutdown failed:',
      expect.objectContaining({ message: 'late listener failure' }),
    )
  })

  it('does not close storage or exit while a structured drain result is unsafe', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const shutdownStorage = vi.fn()
    const pending = ['notification-email-digest', 'mail-fetch']
    const logError = vi.fn()
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue({
        safeToShutdownStorage: false,
        drained: false,
        httpClosed: true,
        timedOut: true,
        pending,
      }),
      shutdownStorage,
      timeoutMs: 25,
      processRef,
      logError,
    })

    await expect(shutdown()).resolves.toEqual({
      timedOut: true,
      ok: false,
      safeToShutdownStorage: false,
      drained: false,
      httpClosed: true,
      pending,
      durabilityPreserved: false,
      safeToExit: false,
    })
    expect(shutdownStorage).not.toHaveBeenCalled()
    expect(processRef.exitCode).toBe(1)
    expect(processRef.exit).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('storage-safe boundary'),
      expect.objectContaining({
        code: 'GRACEFUL_DRAIN_TIMEOUT',
        pending,
      }),
    )
  })

  it('fails closed when listener shutdown omits its explicit storage-safe receipt', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const shutdownStorage = vi.fn().mockResolvedValue(undefined)
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue(undefined),
      shutdownStorage,
      timeoutMs: 25,
      processRef,
    })

    await expect(shutdown()).resolves.toMatchObject({
      timedOut: false,
      ok: false,
      safeToShutdownStorage: false,
      durabilityPreserved: false,
      safeToExit: false,
    })
    expect(shutdownStorage).not.toHaveBeenCalled()
    expect(processRef.exit).not.toHaveBeenCalled()
  })

  it('clamps the configurable shutdown window to a safe bounded range', () => {
    expect(gracefulShutdownTimeoutMs('invalid')).toBe(20_000)
    expect(gracefulShutdownTimeoutMs('1')).toBe(5_000)
    expect(gracefulShutdownTimeoutMs('9999999')).toBe(20_000)
    expect(storageShutdownRetryWindowMs('invalid')).toBe(40_000)
    expect(storageShutdownRetryWindowMs('1')).toBe(1_000)
    expect(storageShutdownRetryWindowMs('9999999')).toBe(40_000)
  })

  it('keeps a referenced hold and retries retained durability before exiting', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const releaseExitHold = vi.fn()
    const deadlineHandle = { unref: vi.fn() }
    const retryHandle = { unref: vi.fn() }
    let retryCallback = null
    const timers = {
      setTimeout: vi.fn((callback, delayMs) => {
        if (delayMs === 50) return deadlineHandle
        retryCallback = callback
        return retryHandle
      }),
      clearTimeout: vi.fn(),
    }
    const retained = new Error('source of truth temporarily unavailable')
    retained.shutdownDurabilityRetained = true
    const shutdownStorage = vi.fn()
      .mockRejectedValueOnce(retained)
      .mockResolvedValueOnce(undefined)
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue({ safeToShutdownStorage: true }),
      shutdownStorage,
      timeoutMs: 50,
      storageRetryWindowMs: 100,
      storageRetryBaseMs: 5,
      storageRetryMaxMs: 5,
      processRef,
      timers,
      createExitHold: () => releaseExitHold,
      logError: vi.fn(),
    })

    const result = shutdown()
    for (let turn = 0; turn < 12 && !retryCallback; turn += 1) {
      await Promise.resolve()
    }

    expect(shutdownStorage).toHaveBeenCalledOnce()
    expect(processRef.exit).not.toHaveBeenCalled()
    expect(releaseExitHold).not.toHaveBeenCalled()
    expect(retryHandle.unref).not.toHaveBeenCalled()
    expect(retryCallback).toBeTypeOf('function')

    retryCallback()
    await expect(result).resolves.toMatchObject({
      ok: true,
      safeToExit: true,
      durabilityPreserved: true,
      storageAttempts: 2,
    })
    expect(shutdownStorage).toHaveBeenCalledTimes(2)
    expect(releaseExitHold).toHaveBeenCalledOnce()
    expect(processRef.exit).toHaveBeenCalledWith(0)
  })

  it('continues referenced low-frequency retries after the soft durability window and later recovers', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const releaseExitHold = vi.fn()
    const removeFatalDiagnostics = vi.fn()
    const deadlineHandle = { unref: vi.fn() }
    const retryCallbacks = []
    let nowMs = 0
    let timeoutCalls = 0
    const timers = {
      setTimeout: vi.fn((callback) => {
        timeoutCalls += 1
        if (timeoutCalls === 1) return deadlineHandle
        retryCallbacks.push(callback)
        return { unref: vi.fn() }
      }),
      clearTimeout: vi.fn(),
    }
    const retained = new AggregateError([new Error('external sync failed')], 'durability')
    retained.durabilityRetained = true
    const shutdownStorage = vi.fn()
      .mockRejectedValueOnce(retained)
      .mockRejectedValueOnce(retained)
      .mockResolvedValueOnce(undefined)
    const logError = vi.fn()
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue({ safeToShutdownStorage: true }),
      shutdownStorage,
      timeoutMs: 1,
      storageRetryWindowMs: 1,
      storageRetryBaseMs: 1,
      storageRetryMaxMs: 1,
      now: () => nowMs,
      processRef,
      timers,
      createExitHold: () => releaseExitHold,
      removeFatalDiagnostics,
      logError,
    })

    const result = shutdown()
    for (let turn = 0; turn < 12 && retryCallbacks.length === 0; turn += 1) {
      await Promise.resolve()
    }
    expect(retryCallbacks).toHaveLength(1)
    nowMs = 2
    retryCallbacks.shift()()
    for (let turn = 0; turn < 12 && retryCallbacks.length === 0; turn += 1) {
      await Promise.resolve()
    }

    expect(shutdownStorage).toHaveBeenCalledTimes(2)
    expect(retryCallbacks).toHaveLength(1)
    expect(processRef.exit).not.toHaveBeenCalled()
    expect(releaseExitHold).not.toHaveBeenCalled()
    expect(removeFatalDiagnostics).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('continuing low-frequency resident retries'),
      retained,
    )

    retryCallbacks.shift()()

    await expect(result).resolves.toMatchObject({
      ok: true,
      safeToShutdownStorage: true,
      durabilityPreserved: true,
      safeToExit: true,
      durabilityRecoveryWindowExceeded: true,
      storageAttempts: 3,
    })
    expect(processRef.exitCode).toBe(0)
    expect(processRef.exit).toHaveBeenCalledWith(0)
    expect(releaseExitHold).toHaveBeenCalledOnce()
    expect(removeFatalDiagnostics).toHaveBeenCalledOnce()
  })

  it('uses the requested update exit code only after storage is durable', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const prepareSafeExit = vi.fn().mockResolvedValue(true)
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue({ safeToShutdownStorage: true }),
      shutdownStorage: vi.fn().mockResolvedValue(undefined),
      prepareSafeExit,
      processRef,
    })

    const updateShutdown = shutdown({
      expectedExitCode: 75,
      reason: 'system-update',
    })
    expect(shutdown({
      expectedExitCode: 0,
      reason: 'SIGTERM',
    })).toBe(updateShutdown)
    await expect(updateShutdown).resolves.toMatchObject({
      ok: true,
      durabilityPreserved: true,
      safeToExit: true,
    })
    expect(prepareSafeExit).toHaveBeenCalledWith(expect.objectContaining({
      expectedExitCode: 75,
      reason: 'system-update',
      durabilityPreserved: true,
    }))
    expect(processRef.exitCode).toBe(75)
    expect(processRef.exit).toHaveBeenCalledWith(75)
  })

  it('refuses the update exit code when the durable handoff marker cannot be published', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const markerError = new Error('safe-exit marker fsync failed')
    const prepareSafeExit = vi.fn().mockRejectedValue(markerError)
    const logError = vi.fn()
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue({ safeToShutdownStorage: true }),
      shutdownStorage: vi.fn().mockResolvedValue(undefined),
      prepareSafeExit,
      processRef,
      logError,
    })

    await expect(shutdown({
      expectedExitCode: 75,
      reason: 'system-update',
    })).resolves.toMatchObject({
      ok: false,
      durabilityPreserved: true,
      safeToExit: true,
      handoffPrepared: false,
    })
    expect(prepareSafeExit).toHaveBeenCalledWith(expect.objectContaining({
      expectedExitCode: 75,
      reason: 'system-update',
      durabilityPreserved: true,
    }))
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('durable safe-exit handoff'),
      markerError,
    )
    expect(processRef.exitCode).toBe(1)
    expect(processRef.exit).toHaveBeenCalledWith(1)
    expect(processRef.exit).not.toHaveBeenCalledWith(75)
  })

  it('preserves a non-zero failure exit after storage explicitly reports durability released', async () => {
    const processRef = { exit: vi.fn(), exitCode: null }
    const ancillaryError = new Error('auxiliary cleanup failed')
    ancillaryError.shutdownDurabilityRetained = false
    const shutdown = createBoundedGracefulShutdown({
      releasePendingBootClaim: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue({ safeToShutdownStorage: true }),
      shutdownStorage: vi.fn().mockRejectedValue(ancillaryError),
      processRef,
      logError: vi.fn(),
    })

    await expect(shutdown()).resolves.toMatchObject({
      ok: false,
      durabilityPreserved: true,
      safeToExit: true,
      storageAttempts: 1,
    })
    expect(processRef.exitCode).toBe(1)
    expect(processRef.exit).toHaveBeenCalledWith(1)
  })
})
