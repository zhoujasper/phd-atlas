import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './index.js'
import { defaultDiscoverState } from './discover-catalog.js'
import { createMemoryPressureGuard, MEMORY_WORK_CLASS } from './memoryPressure.js'
import { createMemoryReservationLedger } from './memoryReservationLedger.js'

const MEBIBYTE = 1024 * 1024

const apps = []

const flushQueueMicrotasks = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const researchJob = (status = 'running', id = 'discover-job-1') => ({
  id,
  status,
  queuedAt: '2026-08-02T10:00:00.000Z',
  startedAt: status === 'running' ? '2026-08-02T10:00:01.000Z' : null,
  completedAt: null,
  message: status === 'running' ? 'Research is running.' : 'Research is queued.',
  errorCode: null,
  sourceCount: 0,
  keyIds: ['ai-key-1'],
  teamId: null,
  targetUserId: null,
  requestedByUserId: 'user-1',
  request: {
    useAi: true,
    acceptSuggestions: true,
    notify: false,
    keyIds: ['ai-key-1'],
  },
})

const recoveryStore = (job = researchJob()) => ({
  users: [{
    id: 'user-1',
    settings: {
      discover: {
        ...defaultDiscoverState(),
        researchJob: job,
      },
    },
  }],
  applications: [],
  teams: [],
})

const createRecoveryApp = ({
  readStore,
  runJob,
  memoryPressureGuard,
  memoryReservationLedger,
  queueHooks = {},
}) => {
  const app = createApp({
    testHooks: {
      ...(memoryPressureGuard ? { memoryPressureGuard } : {}),
      ...(memoryReservationLedger ? { memoryReservationLedger } : {}),
      discoverResearchQueue: { readStore, runJob, ...queueHooks },
    },
  })
  apps.push(app)
  return app
}

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.locals.discoverResearchQueue.stop()
    for (const { task } of app.locals.recurringTasks) task.stop()
  }
  vi.restoreAllMocks()
})

describe('Discover research durable recovery', () => {
  it.each(['soft', 'hard'])('keeps the durable head queued until %s memory pressure recovers', async (level) => {
    let recovered = false
    const memoryPressureGuard = {
      admit: vi.fn(() => recovered
        ? { allowed: true, level: 'normal' }
        : { allowed: false, level, retryAfterMs: 5 }),
      sample: vi.fn(),
      snapshot: vi.fn(() => ({ level })),
    }
    const runJob = vi.fn(async () => {})
    const store = recoveryStore(researchJob('queued'))
    const app = createRecoveryApp({
      readStore: vi.fn(async () => store),
      runJob,
      memoryPressureGuard,
    })
    const queue = app.locals.discoverResearchQueue

    expect(queue.enqueue({ userId: 'user-1', jobId: 'discover-job-1', input: { useAi: true } })).toBe(true)
    expect(memoryPressureGuard.admit).not.toHaveBeenCalled()
    await flushQueueMicrotasks()

    expect(runJob).not.toHaveBeenCalled()
    expect(queue.snapshot()).toMatchObject({
      queued: 1,
      active: 0,
      scheduled: 1,
      retryScheduled: true,
    })
    expect(queue.enqueue({ userId: 'user-1', jobId: 'discover-job-1', input: { useAi: true } })).toBe(false)
    expect(store.users[0].settings.discover.researchJob.status).toBe('queued')

    recovered = true
    await queue.whenIdle()
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(queue.snapshot()).toMatchObject({
      queued: 0,
      active: 0,
      scheduled: 0,
      retryScheduled: false,
    })
  })

  it('requeues one execution-slice deferral without overlapping the same job', async () => {
    const decisions = [
      { allowed: true, level: 'normal' },
      { allowed: true, level: 'normal' },
      { allowed: false, level: 'soft', retryAfterMs: 5 },
      { allowed: true, level: 'normal' },
      { allowed: true, level: 'normal' },
      { allowed: true, level: 'normal' },
    ]
    const memoryPressureGuard = {
      admit: vi.fn(() => decisions.shift() ?? { allowed: true, level: 'normal' }),
      sample: vi.fn(),
      snapshot: vi.fn(() => ({ level: 'normal' })),
    }
    let active = 0
    let peakActive = 0
    const runJob = vi.fn(async (_job, execution) => {
      active += 1
      peakActive = Math.max(peakActive, active)
      try {
        await execution.checkpoint('agent-batch')
      } finally {
        active -= 1
      }
    })
    const app = createRecoveryApp({
      readStore: vi.fn(async () => recoveryStore()),
      runJob,
      memoryPressureGuard,
    })
    const queue = app.locals.discoverResearchQueue

    queue.enqueue({ userId: 'user-1', jobId: 'discover-job-1', input: { useAi: true } })
    await queue.whenIdle()

    expect(runJob).toHaveBeenCalledTimes(2)
    expect(peakActive).toBe(1)
    expect(queue.snapshot()).toMatchObject({ queued: 0, active: 0, scheduled: 0 })
    expect(app.locals.memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
  })

  it('shares hard-boundary headroom with other process work before dequeue', async () => {
    const memoryPressureGuard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => 300 * MEBIBYTE,
      recoverySamples: 1,
    })
    const memoryReservationLedger = createMemoryReservationLedger({ memoryPressureGuard })
    const existingWork = memoryReservationLedger.acquire(
      MEMORY_WORK_CLASS.STANDARD,
      96 * MEBIBYTE,
    )
    expect(existingWork.allowed).toBe(true)
    const runJob = vi.fn(async () => {})
    const app = createRecoveryApp({
      readStore: vi.fn(async () => recoveryStore()),
      runJob,
      memoryPressureGuard,
      memoryReservationLedger,
      queueHooks: {
        setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 10)),
        clearTimeout,
      },
    })
    const queue = app.locals.discoverResearchQueue

    queue.enqueue({ userId: 'user-1', jobId: 'discover-job-ledger', input: { useAi: true } })
    await flushQueueMicrotasks()

    expect(runJob).not.toHaveBeenCalled()
    expect(queue.snapshot()).toMatchObject({ queued: 1, active: 0, retryScheduled: true })
    expect(memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 1,
      reservedBytes: 96 * MEBIBYTE,
    })

    existingWork.release()
    await queue.whenIdle()
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
      peakReservedBytes: 96 * MEBIBYTE,
    })
  })

  it('does not release the Discover lease merely because stop aborts the worker', async () => {
    const memoryPressureGuard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => 100 * MEBIBYTE,
      recoverySamples: 1,
    })
    const memoryReservationLedger = createMemoryReservationLedger({ memoryPressureGuard })
    let settle
    const runJob = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    const app = createRecoveryApp({
      readStore: vi.fn(async () => recoveryStore()),
      runJob,
      memoryPressureGuard,
      memoryReservationLedger,
    })
    const queue = app.locals.discoverResearchQueue

    queue.enqueue({ userId: 'user-1', jobId: 'discover-job-held-lease', input: { useAi: true } })
    await flushQueueMicrotasks()
    expect(memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 1,
      reservedBytes: 64 * MEBIBYTE,
    })

    queue.stop()
    expect(memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 1,
      reservedBytes: 64 * MEBIBYTE,
    })

    settle()
    await queue.whenIdle()
    expect(memoryReservationLedger.snapshot()).toMatchObject({
      activeReservations: 0,
      reservedBytes: 0,
    })
  })

  it('aborts a long execution at its deadline and clears every retry owner on stop', async () => {
    const memoryPressureGuard = {
      admit: vi.fn(() => ({ allowed: true, level: 'normal' })),
      sample: vi.fn(),
      snapshot: vi.fn(() => ({ level: 'normal' })),
    }
    let attempts = 0
    const runJob = vi.fn(async (_job, execution) => {
      attempts += 1
      if (attempts > 1) return
      await new Promise((_resolve, reject) => {
        const abort = () => reject(execution.signal.reason)
        execution.signal.addEventListener('abort', abort, { once: true })
        if (execution.signal.aborted) abort()
      })
    })
    const app = createRecoveryApp({
      readStore: vi.fn(async () => recoveryStore()),
      runJob,
      memoryPressureGuard,
      queueHooks: {
        timeSliceMs: 10,
        setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 10)),
        clearTimeout,
      },
    })
    const queue = app.locals.discoverResearchQueue

    queue.enqueue({ userId: 'user-1', jobId: 'discover-job-1', input: { useAi: true } })
    await queue.whenIdle()
    expect(runJob).toHaveBeenCalledTimes(2)
    expect(runJob.mock.calls[0][1].signal.aborted).toBe(true)

    memoryPressureGuard.admit.mockReturnValue({ allowed: false, level: 'soft', retryAfterMs: 5 })
    queue.enqueue({ userId: 'user-1', jobId: 'discover-job-2', input: { useAi: true } })
    await flushQueueMicrotasks()
    expect(queue.snapshot()).toMatchObject({ queued: 1, retryScheduled: true })
    queue.stop()
    expect(queue.snapshot()).toMatchObject({ queued: 0, active: 0, scheduled: 0, retryScheduled: false })
  })

  it('uses the startup-ready gate before scanning durable jobs', async () => {
    const readStore = vi.fn(async () => recoveryStore(researchJob('queued')))
    const runJob = vi.fn(async () => {})
    const app = createRecoveryApp({ readStore, runJob })
    const recoveryEntry = app.locals.recurringTasks.find(({ name }) => name === 'discover-research-recovery')

    app.locals.startupState = { status: 'starting' }
    await expect(recoveryEntry.run()).resolves.toEqual({ skipped: true, reason: 'SERVER_STARTING' })
    expect(readStore).not.toHaveBeenCalled()

    app.locals.startupState = { status: 'ready' }
    await recoveryEntry.run()
    await app.locals.discoverResearchQueue.whenIdle()

    expect(readStore).toHaveBeenCalledWith({ cache: true })
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('deduplicates repeated scans across queued and active work without rewriting running state', async () => {
    const store = recoveryStore(researchJob('running'))
    const originalStore = structuredClone(store)
    const readStore = vi.fn(async () => store)
    const releases = []
    const runJob = vi.fn(() => new Promise((resolve) => releases.push(resolve)))
    const app = createRecoveryApp({ readStore, runJob })
    const queue = app.locals.discoverResearchQueue

    await queue.recover()
    await flushQueueMicrotasks()
    await Promise.all(Array.from({ length: 12 }, () => queue.recover()))
    await flushQueueMicrotasks()

    expect(runJob).toHaveBeenCalledTimes(1)
    expect(queue.snapshot()).toMatchObject({ queued: 0, active: 1, scheduled: 1 })
    expect(store).toEqual(originalStore)

    releases.shift()()
    await queue.whenIdle()
    expect(queue.snapshot()).toMatchObject({ queued: 0, active: 0, scheduled: 0 })

    await queue.recover()
    await flushQueueMicrotasks()
    expect(runJob).toHaveBeenCalledTimes(2)
    releases.shift()()
    await queue.whenIdle()
  })

  it('allows the next recovery tick to retry after a transient read failure', async () => {
    const readStore = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary read failure'), { code: 'SQLITE_BUSY' }))
      .mockResolvedValue(recoveryStore(researchJob('queued')))
    const runJob = vi.fn(async () => {})
    const app = createRecoveryApp({ readStore, runJob })
    const queue = app.locals.discoverResearchQueue

    await expect(queue.recover()).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
    expect(queue.snapshot()).toMatchObject({ queued: 0, active: 0, scheduled: 0 })

    await expect(queue.recover()).resolves.toEqual({ skipped: false, enqueued: 1 })
    await queue.whenIdle()
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('stops accepting work and does not report idle before an active worker settles', async () => {
    let release
    const runJob = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const readStore = vi.fn(async () => recoveryStore())
    const app = createRecoveryApp({ readStore, runJob })
    const queue = app.locals.discoverResearchQueue
    const job = { userId: 'user-1', jobId: 'discover-job-1', input: { useAi: true } }

    expect(queue.enqueue(job)).toBe(true)
    await flushQueueMicrotasks()
    expect(queue.snapshot()).toMatchObject({ active: 1, scheduled: 1 })

    queue.stop()
    let idle = false
    const idlePromise = queue.whenIdle().then(() => { idle = true })
    await Promise.resolve()

    expect(idle).toBe(false)
    expect(queue.enqueue({ ...job, jobId: 'discover-job-2' })).toBe(false)
    await expect(queue.recover()).resolves.toEqual({ skipped: true, reason: 'STOPPED', enqueued: 0 })
    expect(readStore).not.toHaveBeenCalled()

    release()
    await idlePromise
    expect(queue.snapshot()).toMatchObject({ stopped: true, queued: 0, active: 0, scheduled: 0 })
  })
})
