import { describe, expect, it, vi } from 'vitest'
import { MEMORY_WORK_CLASS } from './memoryPressure.js'
import {
  MailSyncExecutionDeferredError,
  MailSyncMemoryDeferredError,
  assertMailSyncHeavyAdmission,
  drainMailSyncJobsWithMemoryAdmission,
  isTerminalMailSyncFailure,
  mailSyncMemoryRetryAt,
  mailSyncRetryAt,
  runMailSyncUsersWithMemoryAdmission,
} from './mailSyncWorkerAdmission.js'

function dependencies(overrides = {}) {
  return {
    memoryPressureGuard: {
      admit: vi.fn(() => ({ allowed: true, level: 'normal' })),
      sample: vi.fn(() => ({ level: 'normal' })),
    },
    claimNextJob: vi.fn(async () => null),
    processJob: vi.fn(async () => ({ filed: 1 })),
    finishJob: vi.fn(async () => {}),
    retryJob: vi.fn(async () => {}),
    scheduleMemoryRetry: vi.fn(),
    ...overrides,
  }
}

describe('drainMailSyncJobsWithMemoryAdmission', () => {
  it('does not claim or lose a durable job at soft pressure and requests a delayed retry', async () => {
    const deps = dependencies()
    deps.memoryPressureGuard.admit.mockReturnValue({
      allowed: false,
      level: 'soft',
      retryAfterMs: 2_500,
    })

    await expect(drainMailSyncJobsWithMemoryAdmission(deps)).resolves.toEqual({
      processed: 0,
      deferred: true,
      retryAfterMs: 2_500,
      pressureLevel: 'soft',
    })
    expect(deps.memoryPressureGuard.admit).toHaveBeenCalledWith(MEMORY_WORK_CLASS.HEAVY)
    expect(deps.claimNextJob).not.toHaveBeenCalled()
    expect(deps.processJob).not.toHaveBeenCalled()
    expect(deps.finishJob).not.toHaveBeenCalled()
    expect(deps.retryJob).not.toHaveBeenCalled()
    expect(deps.scheduleMemoryRetry).toHaveBeenCalledWith(2_500)
  })

  it('admits and resamples every job before claiming the next one', async () => {
    const first = { id: 'mail-1' }
    const second = { id: 'mail-2' }
    const deps = dependencies()
    deps.claimNextJob
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(null)

    const result = await drainMailSyncJobsWithMemoryAdmission(deps)

    expect(result).toEqual({ processed: 2, deferred: false })
    expect(deps.memoryPressureGuard.admit).toHaveBeenCalledTimes(3)
    expect(deps.memoryPressureGuard.admit).toHaveBeenNthCalledWith(1, MEMORY_WORK_CLASS.HEAVY)
    expect(deps.memoryPressureGuard.sample).toHaveBeenCalledTimes(2)
    expect(deps.processJob).toHaveBeenNthCalledWith(1, first)
    expect(deps.processJob).toHaveBeenNthCalledWith(2, second)
    expect(deps.finishJob).toHaveBeenCalledTimes(2)
    expect(deps.retryJob).not.toHaveBeenCalled()
  })

  it('requeues a failed claimed job, samples, then defers before another claim', async () => {
    const job = { id: 'mail-1' }
    const failure = new Error('IMAP unavailable')
    const deps = dependencies()
    deps.memoryPressureGuard.admit
      .mockReturnValueOnce({ allowed: true, level: 'normal' })
      .mockReturnValueOnce({ allowed: false, level: 'soft', retryAfterMs: 900 })
    deps.claimNextJob.mockResolvedValueOnce(job)
    deps.processJob.mockRejectedValueOnce(failure)

    const result = await drainMailSyncJobsWithMemoryAdmission(deps)

    expect(result).toEqual({
      processed: 1,
      deferred: true,
      retryAfterMs: 900,
      pressureLevel: 'soft',
    })
    expect(deps.retryJob).toHaveBeenCalledWith(job, failure)
    expect(deps.finishJob).not.toHaveBeenCalled()
    expect(deps.memoryPressureGuard.sample).toHaveBeenCalledTimes(1)
    expect(deps.claimNextJob).toHaveBeenCalledTimes(1)
    expect(deps.scheduleMemoryRetry).toHaveBeenCalledWith(900)
  })

  it('requeues instead of finishing when NORMAL becomes SOFT between job batches', async () => {
    const job = { id: 'mail-1' }
    const deps = dependencies()
    deps.memoryPressureGuard.admit
      // Outer worker admission before the durable claim.
      .mockReturnValueOnce({ allowed: true, level: 'normal' })
      // First bounded IMAP batch.
      .mockReturnValueOnce({ allowed: true, level: 'normal' })
      // Second bounded IMAP batch is deferred.
      .mockReturnValueOnce({ allowed: false, level: 'soft', retryAfterMs: 1_200 })
      // The next pre-claim checkpoint remains soft and schedules the kick.
      .mockReturnValueOnce({ allowed: false, level: 'soft', retryAfterMs: 1_200 })
    deps.claimNextJob.mockResolvedValueOnce(job)
    deps.processJob.mockImplementationOnce(async () => {
      assertMailSyncHeavyAdmission(deps.memoryPressureGuard, { phase: 'batch' })
      assertMailSyncHeavyAdmission(deps.memoryPressureGuard, { phase: 'batch' })
    })

    const result = await drainMailSyncJobsWithMemoryAdmission(deps)

    expect(result).toEqual({
      processed: 1,
      deferred: true,
      retryAfterMs: 1_200,
      pressureLevel: 'soft',
    })
    expect(deps.finishJob).not.toHaveBeenCalled()
    expect(deps.retryJob).toHaveBeenCalledTimes(1)
    const deferred = deps.retryJob.mock.calls[0][1]
    expect(deferred).toBeInstanceOf(MailSyncMemoryDeferredError)
    expect(deferred.code).toBe('MAIL_SYNC_MEMORY_DEFERRED')
    expect(deps.claimNextJob).toHaveBeenCalledTimes(1)
    expect(deps.memoryPressureGuard.sample).toHaveBeenCalledTimes(1)
    expect(deps.scheduleMemoryRetry).toHaveBeenCalledWith(1_200)
  })

  it('finishes the current boundary by requeueing once shutdown is requested', async () => {
    const controller = new AbortController()
    const job = { id: 'mail-1' }
    const deps = dependencies()
    deps.claimNextJob.mockResolvedValueOnce(job)
    deps.processJob.mockImplementationOnce(async () => {
      controller.abort(new Error('shutdown'))
      assertMailSyncHeavyAdmission(deps.memoryPressureGuard, {
        phase: 'batch',
        signal: controller.signal,
      })
    })

    const result = await drainMailSyncJobsWithMemoryAdmission({
      ...deps,
      signal: controller.signal,
    })

    expect(result).toEqual({
      processed: 1,
      deferred: true,
      retryAfterMs: 1_000,
      pressureLevel: null,
    })
    expect(deps.finishJob).not.toHaveBeenCalled()
    expect(deps.retryJob).toHaveBeenCalledTimes(1)
    expect(deps.retryJob.mock.calls[0][1]).toBeInstanceOf(MailSyncExecutionDeferredError)
    expect(deps.retryJob.mock.calls[0][1].code).toBe('MAIL_SYNC_SHUTDOWN_DEFERRED')
    expect(deps.scheduleMemoryRetry).not.toHaveBeenCalled()
    expect(deps.memoryPressureGuard.sample).toHaveBeenCalledTimes(1)
  })

  it('does not claim another job when shutdown was already requested', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = dependencies()

    await expect(drainMailSyncJobsWithMemoryAdmission({
      ...deps,
      signal: controller.signal,
    })).resolves.toEqual({
      processed: 0,
      deferred: true,
      retryAfterMs: null,
      pressureLevel: null,
    })
    expect(deps.memoryPressureGuard.admit).not.toHaveBeenCalled()
    expect(deps.claimNextJob).not.toHaveBeenCalled()
    expect(deps.scheduleMemoryRetry).not.toHaveBeenCalled()
  })
})

describe('mail sync inner memory checkpoints', () => {
  it('classifies configuration and authentication failures as terminal', () => {
    for (const code of ['AUTH_FAILED', 'NOT_CONFIGURED', 'UNSUPPORTED_PROTOCOL']) {
      expect(isTerminalMailSyncFailure({ code })).toBe(true)
    }
    expect(isTerminalMailSyncFailure({ code: 'CONNECTION_FAILED' })).toBe(false)
    expect(isTerminalMailSyncFailure({ code: 'MAIL_SYNC_MEMORY_DEFERRED' })).toBe(false)
  })

  it('exposes a deterministic retry time for a deferred batch', () => {
    const guard = {
      admit: vi.fn(() => ({ allowed: false, level: 'soft', retryAfterMs: 2_500 })),
    }

    expect(() => assertMailSyncHeavyAdmission(guard, { phase: 'batch' })).toThrow(
      MailSyncMemoryDeferredError,
    )
    let deferred
    try {
      assertMailSyncHeavyAdmission(guard, { phase: 'batch' })
    } catch (error) {
      deferred = error
    }
    expect(deferred).toMatchObject({
      code: 'MAIL_SYNC_MEMORY_DEFERRED',
      status: 503,
      level: 'soft',
      phase: 'batch',
      retryAfterMs: 2_500,
      workClass: MEMORY_WORK_CLASS.HEAVY,
    })
    expect(mailSyncMemoryRetryAt(deferred, () => Date.parse('2026-08-02T12:00:00.000Z')))
      .toBe('2026-08-02T12:00:02.500Z')
  })

  it('defers before allocation when a batch reaches its execution deadline', () => {
    const guard = { admit: vi.fn(() => ({ allowed: true, level: 'normal' })) }
    let deferred
    try {
      assertMailSyncHeavyAdmission(guard, {
        phase: 'batch',
        deadlineAt: 5_000,
        now: () => 5_000,
        retryAfterMs: 750,
      })
    } catch (error) {
      deferred = error
    }

    expect(deferred).toBeInstanceOf(MailSyncExecutionDeferredError)
    expect(deferred).toMatchObject({
      code: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
      retryAfterMs: 750,
      phase: 'batch',
    })
    expect(guard.admit).not.toHaveBeenCalled()
    expect(mailSyncRetryAt(deferred, () => 10_000)).toBe(new Date(10_750).toISOString())
  })

  it('stops an auto-fetch pass before the next user when pressure turns soft', async () => {
    const guard = {
      admit: vi.fn()
        .mockReturnValueOnce({ allowed: true, level: 'normal' })
        .mockReturnValueOnce({ allowed: false, level: 'soft', retryAfterMs: 800 }),
    }
    const runUser = vi.fn(async () => {})
    const onUserError = vi.fn()

    const result = await runMailSyncUsersWithMemoryAdmission({
      userIds: ['user-1', 'user-2', 'user-3'],
      memoryPressureGuard: guard,
      runUser,
      onUserError,
    })

    expect(result).toEqual({
      completed: 1,
      failed: 0,
      deferred: true,
      deferredIndex: 1,
      retryAfterMs: 800,
      nextStartIndex: 1,
    })
    expect(runUser).toHaveBeenCalledTimes(1)
    expect(runUser).toHaveBeenCalledWith('user-1')
    expect(onUserError).not.toHaveBeenCalled()
  })

  it('keeps the durable cursor unchanged when a later batch is deferred', async () => {
    const guard = {
      admit: vi.fn()
        // Per-user checkpoint.
        .mockReturnValueOnce({ allowed: true, level: 'normal' })
        // First bounded batch checkpoint.
        .mockReturnValueOnce({ allowed: true, level: 'normal' })
        // Memory crosses SOFT before the second batch.
        .mockReturnValueOnce({ allowed: false, level: 'soft', retryAfterMs: 1_000 }),
    }
    const durableRows = []
    let durableCursor = 0
    let transientCursor = 0

    const result = await runMailSyncUsersWithMemoryAdmission({
      userIds: ['user-1'],
      memoryPressureGuard: guard,
      runUser: async () => {
        assertMailSyncHeavyAdmission(guard, { phase: 'batch' })
        durableRows.push('message-1')
        transientCursor = 50
        assertMailSyncHeavyAdmission(guard, { phase: 'batch' })
        durableCursor = transientCursor
      },
    })

    expect(result).toEqual({
      completed: 0,
      failed: 0,
      deferred: true,
      deferredIndex: 0,
      retryAfterMs: 1_000,
      nextStartIndex: 0,
    })
    expect(durableRows).toEqual(['message-1'])
    expect(transientCursor).toBe(50)
    expect(durableCursor).toBe(0)
  })

  it('rotates the next pass so tail users run before an already-served user repeats', async () => {
    const guard = {
      admit: vi.fn(() => ({ allowed: true, level: 'normal' })),
    }
    const runOrder = []
    const firstNow = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)

    const first = await runMailSyncUsersWithMemoryAdmission({
      userIds: ['user-1', 'user-2', 'user-3'],
      memoryPressureGuard: guard,
      deadlineAt: 10,
      now: firstNow,
      runUser: async (userId) => runOrder.push(userId),
    })
    const second = await runMailSyncUsersWithMemoryAdmission({
      userIds: ['user-1', 'user-2', 'user-3'],
      memoryPressureGuard: guard,
      startIndex: first.nextStartIndex,
      runUser: async (userId) => runOrder.push(userId),
    })

    expect(first).toMatchObject({
      completed: 1,
      deferred: true,
      deferredIndex: 1,
      nextStartIndex: 1,
    })
    expect(second).toMatchObject({ completed: 3, deferred: false, nextStartIndex: 2 })
    expect(runOrder).toEqual(['user-1', 'user-2', 'user-3', 'user-1'])
  })

  it('moves a user that consumed the slice behind untouched users', async () => {
    const guard = {
      admit: vi.fn(() => ({ allowed: true, level: 'normal' })),
    }
    const runOrder = []
    const first = await runMailSyncUsersWithMemoryAdmission({
      userIds: ['slow-user', 'tail-1', 'tail-2'],
      memoryPressureGuard: guard,
      runUser: async (userId) => {
        runOrder.push(userId)
        throw new MailSyncExecutionDeferredError(
          'MAIL_SYNC_TIME_SLICE_DEFERRED',
          'slice consumed',
        )
      },
    })
    await runMailSyncUsersWithMemoryAdmission({
      userIds: ['slow-user', 'tail-1', 'tail-2'],
      memoryPressureGuard: guard,
      startIndex: first.nextStartIndex,
      runUser: async (userId) => runOrder.push(userId),
    })

    expect(first.nextStartIndex).toBe(1)
    expect(runOrder).toEqual(['slow-user', 'tail-1', 'tail-2', 'slow-user'])
  })
})
