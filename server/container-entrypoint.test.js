import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCgroupMemoryExitEvidence,
  clearContainerRestartFuse,
  CONTAINER_RESTART_FUSE_RELATIVE_PATH,
  createImageRuntimeManifest,
  DEFAULT_WORKER_SHUTDOWN_GRACE_MS,
  persistWorkerExitDiagnostic,
  readContainerRestartFuse,
  readCgroupMemorySnapshot,
  resolveContainerStorageRoot,
  restartDelayMs,
  runContainerSupervisor,
  tripContainerRestartFuse,
  UPDATE_RESTART_EXIT_CODE,
  verifyImageRuntime,
  waitForUpdateCompletion,
  WORKER_EXIT_LOG_RELATIVE_PATH,
  WORKER_STATUS_RELATIVE_PATH,
} from '../tools/container-entrypoint.mjs'

class FakeWorker extends EventEmitter {
  exitCode = null
  signalCode = null
  kills = []
  pid

  constructor(pid = 10_000) {
    super()
    this.pid = pid
  }

  finish(code, signal = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }

  kill(signal) {
    this.kills.push(signal)
    this.finish(null, signal)
    return true
  }
}

const scratchRoots = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-entrypoint-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, { recursive: true, force: true })))
  scratchRoots.clear()
})

function quietLogger() {
  return {
    error: vi.fn(),
    info: vi.fn(),
  }
}

function isolatedSupervisorOptions(options) {
  return {
    readCgroupMemory: async () => null,
    recordWorkerExit: async () => {},
    readRestartFuse: async () => null,
    tripRestartFuse: async () => {},
    clearRestartFuse: async () => {},
    ...options,
  }
}

describe('container update supervisor', () => {
  it('pins durable container state to the project storage mount', () => {
    const projectRoot = path.resolve('/app')
    const expectedStorageRoot = path.resolve(projectRoot, 'storage')

    expect(resolveContainerStorageRoot(projectRoot, undefined)).toBe(expectedStorageRoot)
    expect(resolveContainerStorageRoot(projectRoot, expectedStorageRoot)).toBe(expectedStorageRoot)

    try {
      resolveContainerStorageRoot(projectRoot, path.resolve(projectRoot, 'other-storage'))
      throw new Error('Expected a mismatched container storage root to fail closed.')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CONTAINER_STORAGE_ROOT_MISMATCH',
        expectedStorageRoot,
      })
    }
  })

  it('keeps the container alive across exit 75 without killing the detached helper path', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(), new FakeWorker()]
    const sleeps = []
    const recorded = []
    let spawnCount = 0
    let prepareCount = 0
    let updateWaitCount = 0

    const resultPromise = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      recordWorkerExit: async (event) => recorded.push(event),
      prepareRuntime: async () => {
        prepareCount += 1
      },
      waitForUpdate: async () => {
        updateWaitCount += 1
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => {
          if (spawnCount === 1) worker.finish(UPDATE_RESTART_EXIT_CODE)
          else processRef.emit('SIGTERM')
        })
        return worker
      },
    }))

    await expect(resultPromise).resolves.toBe(0)
    expect(spawnCount).toBe(2)
    expect(prepareCount).toBe(2)
    expect(updateWaitCount).toBe(3)
    expect(sleeps).toEqual([restartDelayMs(1)])
    expect(workers[0].kills).toEqual([])
    expect(recorded.map(({ reason, rapidRestartCount }) => ({
      reason,
      rapidRestartCount,
    }))).toEqual([
      { reason: 'update_restart', rapidRestartCount: 0 },
      { reason: 'supervisor_shutdown', rapidRestartCount: 0 },
    ])
  })

  it('backs off runtime preparation failures instead of starting an old worker', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker()
    const recorded = []
    const sleeps = []
    let prepareCount = 0
    let spawnCount = 0

    const resultPromise = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      recordWorkerExit: async (event) => recorded.push(event),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {
        prepareCount += 1
        if (prepareCount < 3) throw new Error('active package replay failed')
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      spawnWorker: () => {
        spawnCount += 1
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    }))

    await expect(resultPromise).resolves.toBe(0)
    expect(prepareCount).toBe(3)
    expect(spawnCount).toBe(1)
    expect(sleeps).toEqual([restartDelayMs(1), restartDelayMs(2)])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      reason: 'supervisor_shutdown',
      rapidRestartCount: 0,
    })
  })

  it('hands persistent runtime preparation failures back after the shared rapid budget', async () => {
    const processRef = new EventEmitter()
    const recorded = []
    const sleeps = []
    const prepareRuntime = vi.fn(async () => {
      throw Object.assign(new Error('active package replay failed'), {
        code: 'ENOENT',
      })
    })
    const spawnWorker = vi.fn()

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      maxRapidWorkerRestarts: 2,
      recordWorkerExit: async (event) => recorded.push(event),
      waitForUpdate: async () => {},
      prepareRuntime,
      sleep: async (ms) => sleeps.push(ms),
      spawnWorker,
    }))).resolves.toBe(1)

    expect(prepareRuntime).toHaveBeenCalledTimes(2)
    expect(spawnWorker).not.toHaveBeenCalled()
    expect(sleeps).toEqual([restartDelayMs(1)])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      reason: 'runtime_preparation_restart_budget_exhausted',
      pid: null,
      code: null,
      signal: null,
      uptimeMs: 0,
      rapidRestartCount: 2,
      restartDelayMs: null,
      workerError: true,
      workerErrorCode: 'ENOENT',
    })
  })

  it('routes an invalid immutable manifest through the persistent restart budget', async () => {
    const processRef = new EventEmitter()
    const manifestRoot = await scratch('invalid-runtime-manifest')
    const manifestPath = path.join(manifestRoot, 'runtime-manifest.json')
    await fs.writeFile(manifestPath, '{invalid json', 'utf8')
    const tripRestartFuse = vi.fn(async () => {})
    const spawnWorker = vi.fn()

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      imageRuntimeManifestPath: manifestPath,
      maxRapidWorkerRestarts: 2,
      tripRestartFuse,
      waitForUpdate: async () => {},
      sleep: async () => {},
      spawnWorker,
    }))).resolves.toBe(1)

    expect(spawnWorker).not.toHaveBeenCalled()
    expect(tripRestartFuse).toHaveBeenCalledOnce()
    expect(tripRestartFuse).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'runtime_preparation_restart_budget_exhausted',
      rapidRestartCount: 2,
    }))
  })

  it('does not report preparation budget exhaustion when shutdown interrupts preparation', async () => {
    const processRef = new EventEmitter()
    const recordWorkerExit = vi.fn(async () => {})
    const sleep = vi.fn(async () => {})
    const spawnWorker = vi.fn()

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      maxRapidWorkerRestarts: 1,
      recordWorkerExit,
      waitForUpdate: async () => {},
      prepareRuntime: async () => {
        processRef.emit('SIGTERM')
        throw new Error('interrupted preparation')
      },
      sleep,
      spawnWorker,
    }))).resolves.toBe(0)

    expect(recordWorkerExit).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
    expect(spawnWorker).not.toHaveBeenCalled()
  })

  it('does not hang when the preparation-exhaustion diagnostic writer stalls', async () => {
    const processRef = new EventEmitter()
    let diagnosticCalls = 0
    let recordedEvent = null

    await expect(runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      maxRapidWorkerRestarts: 1,
      diagnosticWriteTimeoutMs: 5,
      readCgroupMemory: async () => null,
      recordWorkerExit: async (event) => {
        diagnosticCalls += 1
        recordedEvent = event
        await new Promise(() => {})
      },
      waitForUpdate: async () => {},
      prepareRuntime: async () => {
        throw Object.assign(new Error('runtime unavailable'), {
          code: 'NOT_SAFE_TO_PERSIST',
        })
      },
      spawnWorker: vi.fn(),
    })).resolves.toBe(1)

    expect(diagnosticCalls).toBe(1)
    expect(recordedEvent).toMatchObject({
      reason: 'runtime_preparation_restart_budget_exhausted',
      workerErrorCode: null,
    })
  })

  it('forwards termination signals to the current worker', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker()
    const resultPromise = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      spawnWorker: () => {
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    }))

    await expect(resultPromise).resolves.toBe(0)
    expect(worker.kills).toEqual(['SIGTERM'])
  })

  it('claims a pending boot before a broken launcher can exit and rolls it back once', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(61_001), new FakeWorker(61_002)]
    const claimPendingBoot = vi.fn(async () => ({}))
    const recoverPendingRuntime = vi.fn().mockResolvedValueOnce({
      rolledBack: true,
      version: '0.2.0-beta.2',
    })
    let spawnCount = 0

    const result = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot,
      recoverPendingRuntime,
      recordBootRollback: async () => {},
      sleep: async () => {},
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => {
          if (spawnCount === 1) worker.finish(1)
          else processRef.emit('SIGTERM')
        })
        return worker
      },
    }))

    await expect(result).resolves.toBe(0)
    expect(claimPendingBoot).toHaveBeenNthCalledWith(1, 61_001)
    expect(recoverPendingRuntime).toHaveBeenCalledOnce()
    expect(spawnCount).toBe(2)
  })

  it('fails closed without respawning when automatic first-boot rollback fails', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(62_001)
    const logger = quietLogger()
    const tripRestartFuse = vi.fn(async () => {})
    const spawnWorker = vi.fn(() => {
      queueMicrotask(() => worker.finish(1))
      return worker
    })

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger,
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => ({}),
      recoverPendingRuntime: async () => {
        throw new Error('rollback npm ci failed')
      },
      tripRestartFuse,
      spawnWorker,
    }))).resolves.toBe(1)

    expect(spawnWorker).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('automatic update rollback could not complete'),
      expect.any(Error),
    )
    expect(tripRestartFuse).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'recovery_failed',
      rapidRestartCount: 1,
    }))
  })

  it('records the worker termination when a pending boot claim fails closed', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(62_101)
    const recorded = []
    const tripRestartFuse = vi.fn(async () => {})

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      recordWorkerExit: async (event) => recorded.push(event),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => {
        throw new Error('claim failed')
      },
      tripRestartFuse,
      spawnWorker: () => worker,
    }))).resolves.toBe(1)

    expect(worker.kills).toEqual(['SIGTERM'])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      reason: 'boot_claim_failed',
      pid: 62_101,
      code: null,
      signal: 'SIGTERM',
      restartDelayMs: null,
      rapidRestartCount: 1,
    })
    expect(tripRestartFuse).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'boot_claim_failed',
      rapidRestartCount: 1,
    }))
  })

  it('releases a claimed trial boot on intentional supervisor termination', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(63_001)
    const releasePendingBoot = vi.fn(async () => true)

    const result = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => ({}),
      releasePendingBoot,
      spawnWorker: () => {
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    }))

    await expect(result).resolves.toBe(0)
    expect(releasePendingBoot).toHaveBeenCalledWith(63_001)
    expect(worker.kills).toEqual(['SIGTERM'])
  })

  it('records OOM clues and restarts both signal and isolated zero-code exits in place', async () => {
    const storageRoot = await scratch('signal-diagnostic')
    const processRef = new EventEmitter()
    const workers = [
      new FakeWorker(71_001),
      new FakeWorker(71_002),
      new FakeWorker(71_003),
    ]
    const samples = [
      {
        currentBytes: 700,
        maxBytes: 1_000,
        events: { oom: 3, oom_kill: 1, oom_group_kill: 0 },
      },
      {
        currentBytes: 990,
        maxBytes: 1_000,
        events: { oom: 4, oom_kill: 2, oom_group_kill: 0 },
      },
      {
        currentBytes: 300,
        maxBytes: 1_000,
        events: { oom: 4, oom_kill: 2, oom_group_kill: 0 },
      },
      {
        currentBytes: 320,
        maxBytes: 1_000,
        events: { oom: 4, oom_kill: 2, oom_group_kill: 0 },
      },
      {
        currentBytes: 310,
        maxBytes: 1_000,
        events: { oom: 4, oom_kill: 2, oom_group_kill: 0 },
      },
      {
        currentBytes: 315,
        maxBytes: 1_000,
        events: { oom: 4, oom_kill: 2, oom_group_kill: 0 },
      },
    ]
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_800)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_500)
    const sleeps = []
    let spawnCount = 0

    await expect(runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot,
      processRef,
      logger: quietLogger(),
      now,
      readCgroupMemory: async () => samples.shift(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => null,
      recoverPendingRuntime: async () => ({ rolledBack: false }),
      sleep: async (ms) => sleeps.push(ms),
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => {
          if (spawnCount === 1) worker.finish(null, 'SIGKILL')
          else if (spawnCount === 2) worker.finish(0)
          else processRef.emit('SIGTERM')
        })
        return worker
      },
    })).resolves.toBe(0)

    const logContents = await fs.readFile(
      path.join(storageRoot, WORKER_EXIT_LOG_RELATIVE_PATH),
      'utf8',
    )
    const entries = logContents.trim().split('\n').map((line) => JSON.parse(line))
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      reason: 'unexpected_exit',
      pid: 71_001,
      code: null,
      signal: 'SIGKILL',
      uptimeMs: 500,
      rapidRestartCount: 1,
      restartDelayMs: restartDelayMs(1),
      cgroupMemory: {
        currentBytes: 990,
        maxBytes: 1_000,
        events: { oom: 4, oom_kill: 2, oom_group_kill: 0 },
        eventDeltas: { oom: 1, oom_kill: 1, oom_group_kill: 0 },
        oomEventDeltaObserved: true,
        oomKillDeltaObserved: true,
      },
    })
    expect(entries[1]).toMatchObject({
      reason: 'unexpected_exit',
      pid: 71_002,
      code: 0,
      rapidRestartCount: 2,
      restartDelayMs: restartDelayMs(2),
    })
    expect(entries[2]).toMatchObject({
      reason: 'supervisor_shutdown',
      pid: 71_003,
      code: null,
      signal: 'SIGTERM',
    })
    expect(sleeps).toEqual([restartDelayMs(1), restartDelayMs(2)])

    const status = JSON.parse(await fs.readFile(
      path.join(storageRoot, WORKER_STATUS_RELATIVE_PATH),
      'utf8',
    ))
    expect(status.latest).toMatchObject({
      reason: 'supervisor_shutdown',
      pid: 71_003,
    })
  })

  it('reads only allowlisted cgroup v2 memory values and derives OOM deltas', async () => {
    const cgroupRoot = await scratch('cgroup-v2')
    await fs.writeFile(path.join(cgroupRoot, 'memory.current'), '2048\n')
    await fs.writeFile(path.join(cgroupRoot, 'memory.max'), 'max\n')
    await fs.writeFile(
      path.join(cgroupRoot, 'memory.events'),
      'low 1\nhigh 2\nmax 3\noom 4\noom_kill 5\noom_group_kill 0\nsecret 999\n',
    )

    const after = await readCgroupMemorySnapshot({ platform: 'linux', cgroupRoot })
    expect(after).toEqual({
      currentBytes: 2_048,
      maxBytes: 'max',
      events: {
        low: 1,
        high: 2,
        max: 3,
        oom: 4,
        oom_kill: 5,
        oom_group_kill: 0,
      },
    })
    expect(buildCgroupMemoryExitEvidence({
      currentBytes: 1_024,
      maxBytes: 'max',
      events: { oom: 3, oom_kill: 4 },
    }, after)).toMatchObject({
      eventDeltas: { oom: 1, oom_kill: 1 },
      oomEventDeltaObserved: true,
      oomKillDeltaObserved: true,
    })
    expect(buildCgroupMemoryExitEvidence(null, after)).toMatchObject({
      eventDeltas: null,
      oomEventDeltaObserved: null,
      oomKillDeltaObserved: null,
    })
  })

  it('atomically bounds the exit journal by entry count and bytes while stripping unknown data', async () => {
    const storageRoot = await scratch('bounded-diagnostic')
    const diagnosticDirectory = path.join(storageRoot, 'diagnostics')
    await fs.mkdir(diagnosticDirectory, { recursive: true })
    const staleTemporaryPath = path.join(
      diagnosticDirectory,
      `${path.basename(WORKER_EXIT_LOG_RELATIVE_PATH)}.tmp-stale`,
    )
    await fs.writeFile(staleTemporaryPath, 'partial')
    const staleTime = new Date(Date.now() - 10 * 60_000)
    await fs.utimes(staleTemporaryPath, staleTime, staleTime)
    for (let index = 0; index < 8; index += 1) {
      await persistWorkerExitDiagnostic(storageRoot, {
        recordedAtMs: Date.UTC(2026, 7, 2, 10, 0, index),
        reason: 'unexpected_exit',
        pid: 80_000 + index,
        code: 1,
        signal: null,
        uptimeMs: index,
        rapidRestartCount: index,
        restartDelayMs: restartDelayMs(index),
        secret: 'must-not-survive',
        cgroupMemory: {
          currentBytes: 100 + index,
          maxBytes: 1_000,
          events: { oom: index, unknown_secret_counter: 999 },
          eventDeltas: { oom: 0, unknown_secret_counter: 999 },
          oomEvidence: false,
          requestBody: 'must-not-survive',
        },
      }, { maxEntries: 3, maxBytes: 1_024 })
    }

    const logPath = path.join(storageRoot, WORKER_EXIT_LOG_RELATIVE_PATH)
    const logContents = await fs.readFile(logPath, 'utf8')
    const entries = logContents.trim().split('\n').map((line) => JSON.parse(line))
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.length).toBeLessThanOrEqual(3)
    expect(entries.at(-1)).toMatchObject({ pid: 80_007, uptimeMs: 7 })
    expect(Buffer.byteLength(logContents)).toBeLessThanOrEqual(1_024)
    expect(logContents).not.toContain('must-not-survive')
    expect(logContents).not.toContain('unknown_secret_counter')
    const diagnosticFiles = await fs.readdir(path.dirname(logPath))
    expect(diagnosticFiles.some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('keeps restarting when cgroup sampling and diagnostic writes fail', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(81_001), new FakeWorker(81_002)]
    const sleeps = []
    let spawnCount = 0

    await expect(runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      readCgroupMemory: async () => {
        throw new Error('read-only cgroup')
      },
      recordWorkerExit: async () => {
        throw new Error('read-only storage')
      },
      readRestartFuse: async () => null,
      tripRestartFuse: async () => {},
      clearRestartFuse: async () => {},
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => null,
      recoverPendingRuntime: async () => ({ rolledBack: false }),
      sleep: async (ms) => sleeps.push(ms),
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => {
          if (spawnCount === 1) worker.finish(1)
          else processRef.emit('SIGTERM')
        })
        return worker
      },
    })).resolves.toBe(0)

    expect(spawnCount).toBe(2)
    expect(sleeps).toEqual([restartDelayMs(1)])
  })

  it('backs off and recovers from a transient synchronous worker spawn failure', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(82_001)
    const sleeps = []
    let spawnCount = 0

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      recoverPendingRuntime: async () => ({ rolledBack: false }),
      sleep: async (ms) => sleeps.push(ms),
      spawnWorker: () => {
        spawnCount += 1
        if (spawnCount === 1) throw Object.assign(new Error('temporarily unavailable'), {
          code: 'EAGAIN',
        })
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    }))).resolves.toBe(0)

    expect(spawnCount).toBe(2)
    expect(sleeps).toEqual([restartDelayMs(1)])
  })

  it('hands a persistent rapid crash loop back to the container runtime', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(83_001), new FakeWorker(83_002)]
    const recorded = []
    const sleeps = []
    let spawnCount = 0

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      maxRapidWorkerRestarts: 2,
      recordWorkerExit: async (event) => recorded.push(event),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => null,
      recoverPendingRuntime: async () => ({ rolledBack: false }),
      sleep: async (ms) => sleeps.push(ms),
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => worker.finish(1))
        return worker
      },
    }))).resolves.toBe(1)

    expect(spawnCount).toBe(2)
    expect(sleeps).toEqual([restartDelayMs(1)])
    expect(recorded.map((event) => event.reason)).toEqual([
      'unexpected_exit',
      'restart_budget_exhausted',
    ])
    expect(recorded[1]).toMatchObject({
      rapidRestartCount: 2,
      restartDelayMs: null,
    })
  })

  it('does not let a hung diagnostic writer block worker recovery', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(84_001), new FakeWorker(84_002)]
    let spawnCount = 0
    let diagnosticCalls = 0

    await expect(runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      diagnosticWriteTimeoutMs: 5,
      readCgroupMemory: async () => null,
      recordWorkerExit: async () => {
        diagnosticCalls += 1
        await new Promise(() => {})
      },
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => null,
      recoverPendingRuntime: async () => ({ rolledBack: false }),
      sleep: async () => {},
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => {
          if (spawnCount === 1) worker.finish(1)
          else processRef.emit('SIGTERM')
        })
        return worker
      },
    })).resolves.toBe(0)

    expect(spawnCount).toBe(2)
    expect(diagnosticCalls).toBe(1)
  })

  it('interrupts crash backoff immediately when the supervisor is stopped', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(85_001)
    let notifySleepStarted = null
    const sleepStarted = new Promise((resolve) => {
      notifySleepStarted = resolve
    })
    let spawnCount = 0

    const result = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => null,
      recoverPendingRuntime: async () => ({ rolledBack: false }),
      sleep: async (ms) => {
        notifySleepStarted(ms)
        await new Promise(() => {})
      },
      spawnWorker: () => {
        spawnCount += 1
        queueMicrotask(() => worker.finish(1))
        return worker
      },
    }))

    await expect(sleepStarted).resolves.toBe(restartDelayMs(1))
    processRef.emit('SIGTERM')
    await expect(result).resolves.toBe(0)
    expect(spawnCount).toBe(1)
  })

  it('does not spawn a worker when shutdown arrives during the pre-spawn cgroup sample', async () => {
    const processRef = new EventEmitter()
    let releaseSample = null
    let notifySampleStarted = null
    const sampleStarted = new Promise((resolve) => {
      notifySampleStarted = resolve
    })
    const blockedSample = new Promise((resolve) => {
      releaseSample = resolve
    })
    const spawnWorker = vi.fn()

    const result = runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      readCgroupMemory: async () => {
        notifySampleStarted()
        return blockedSample
      },
      recordWorkerExit: async () => {},
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      spawnWorker,
    })

    await sampleStarted
    processRef.emit('SIGTERM')
    releaseSample(null)
    await expect(result).resolves.toBe(0)
    expect(spawnWorker).not.toHaveBeenCalled()
  })

  it('interrupts the default update-lock polling delay with an abort signal', async () => {
    const storageRoot = await scratch('abort-update-wait')
    await fs.writeFile(path.join(storageRoot, '.update-in-progress.json'), JSON.stringify({
      helperPid: 999_999,
      requestedAt: new Date().toISOString(),
    }))
    const controller = new AbortController()
    const wait = waitForUpdateCompletion(storageRoot, {
      timeoutMs: 60_000,
      pollMs: 60_000,
      processExists: async () => true,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 5)

    await expect(wait).resolves.toBeUndefined()
  })

  it('escalates an ignored graceful shutdown signal after the bounded grace period', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(86_001)
    worker.kill = function kill(signal) {
      this.kills.push(signal)
      if (signal === 'SIGKILL') this.finish(null, signal)
      return true
    }

    const result = runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      workerShutdownGraceMs: 5,
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => null,
      releasePendingBoot: async () => true,
      spawnWorker: () => {
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    }))

    await expect(result).resolves.toBe(0)
    expect(worker.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('allows the worker durability retry window to recover before the default SIGKILL ceiling', async () => {
    vi.useFakeTimers()
    try {
      expect(DEFAULT_WORKER_SHUTDOWN_GRACE_MS).toBe(70_000)
      const processRef = new EventEmitter()
      const worker = new FakeWorker(86_002)
      let notifySigterm = null
      const sigtermForwarded = new Promise((resolve) => { notifySigterm = resolve })
      worker.kill = function kill(signal) {
        this.kills.push(signal)
        if (signal === 'SIGTERM') {
          notifySigterm()
          setTimeout(() => this.finish(0), 60_000)
        } else if (signal === 'SIGKILL') {
          this.finish(null, signal)
        }
        return true
      }

      const result = runContainerSupervisor(isolatedSupervisorOptions({
        projectRoot: process.cwd(),
        storageRoot: process.cwd(),
        processRef,
        logger: quietLogger(),
        waitForUpdate: async () => {},
        prepareRuntime: async () => {},
        claimPendingBoot: async () => null,
        releasePendingBoot: async () => true,
        spawnWorker: () => {
          queueMicrotask(() => processRef.emit('SIGTERM'))
          return worker
        },
      }))

      await sigtermForwarded
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(result).resolves.toBe(0)
      expect(worker.kills).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses an immutable image manifest to distinguish clean and modified runtimes', async () => {
    const root = await scratch('image-manifest')
    for (const [relativePath, contents] of [
      ['dist/index.html', '<title>clean</title>'],
      ['server/index.js', 'export const clean = true\n'],
      ['tools/start-server.mjs', 'export const clean = true\n'],
      ['tools/apply-update.mjs', 'export const clean = true\n'],
      ['tools/container-entrypoint.mjs', 'export const clean = true\n'],
      ['package.json', '{"name":"phd-atlas","version":"0.2.0-beta.3","type":"module"}\n'],
      ['package-lock.json', '{"name":"phd-atlas","version":"0.2.0-beta.3","lockfileVersion":3,"packages":{"":{"name":"phd-atlas","version":"0.2.0-beta.3"}}}\n'],
    ]) {
      const target = path.join(root, ...relativePath.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, contents)
    }
    const manifestPath = path.join(await scratch('immutable-manifest'), 'runtime-manifest.json')
    const manifest = await createImageRuntimeManifest(root, manifestPath)
    const imageRuntime = { version: manifest.version, manifest }

    await expect(verifyImageRuntime(root, imageRuntime)).resolves.toBe(true)
    await fs.writeFile(path.join(root, 'server', 'index.js'), 'export const clean = false\n')
    await expect(verifyImageRuntime(root, imageRuntime)).resolves.toBe(false)
  })

  it('persists the restart fuse in storage so a replacement container honors it', async () => {
    const storageRoot = await scratch('persistent-restart-fuse')
    const trippedAtMs = Date.UTC(2026, 7, 3, 12, 0, 0)

    await expect(tripContainerRestartFuse(storageRoot, {
      recordedAtMs: trippedAtMs,
      reason: 'restart_budget_exhausted',
      rapidRestartCount: 8,
    }, { cooldownMs: 15 * 60_000 })).resolves.toMatchObject({
      trippedAtMs,
      retryAfterMs: trippedAtMs + 15 * 60_000,
      rapidRestartCount: 8,
    })
    await expect(readContainerRestartFuse(storageRoot)).resolves.toMatchObject({
      reason: 'restart_budget_exhausted',
      rapidRestartCount: 8,
    })
    await expect(fs.stat(path.join(storageRoot, CONTAINER_RESTART_FUSE_RELATIVE_PATH)))
      .resolves.toMatchObject({ size: expect.any(Number) })

    await clearContainerRestartFuse(storageRoot)
    await expect(readContainerRestartFuse(storageRoot)).resolves.toBeNull()
  })

  it('delays worker startup for an active fuse without blocking a shutdown signal', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(91_001)
    const sleeps = []
    const clearRestartFuse = vi.fn(async () => {})
    let spawnCount = 0

    await expect(runContainerSupervisor(isolatedSupervisorOptions({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      now: () => 10_000,
      readRestartFuse: async () => ({
        formatVersion: 1,
        trippedAtMs: 5_000,
        retryAfterMs: 25_000,
        reason: 'restart_budget_exhausted',
        rapidRestartCount: 8,
      }),
      clearRestartFuse,
      sleep: async (ms) => sleeps.push(ms),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      spawnWorker: () => {
        spawnCount += 1
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    }))).resolves.toBe(0)

    expect(sleeps).toEqual([15_000])
    expect(clearRestartFuse).toHaveBeenCalledOnce()
    expect(spawnCount).toBe(1)
  })
})
