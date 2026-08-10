import { describe, expect, it, vi } from 'vitest'
import {
  acquireDiscoverResearchMemoryReservation,
  assertDiscoverResearchHeavyAdmission,
  createDiscoverResearchTimeSliceDeferredError,
  DISCOVER_RESEARCH_MEMORY_RESERVATION_BYTES,
  discoverResearchDeferredErrorFor,
  discoverResearchRetryDelayMs,
  isDiscoverResearchDeferredError,
} from './discoverResearchWorkerAdmission.js'
import { MEMORY_WORK_CLASS } from './memoryPressure.js'

const guard = (decision) => ({ admit: vi.fn(() => decision) })

describe('Discover research execution admission', () => {
  it('samples HEAVY immediately at the execution checkpoint', () => {
    const memoryPressureGuard = guard({ allowed: true, level: 'normal' })

    expect(assertDiscoverResearchHeavyAdmission(memoryPressureGuard, { phase: 'dequeue' }))
      .toMatchObject({ allowed: true })
    expect(memoryPressureGuard.admit).toHaveBeenCalledWith(MEMORY_WORK_CLASS.HEAVY)
  })

  it('acquires one 64 MiB HEAVY lease from the supplied shared ledger', () => {
    const release = vi.fn()
    const memoryReservationLedger = {
      acquire: vi.fn(() => ({ allowed: true, release })),
    }

    const reservation = acquireDiscoverResearchMemoryReservation(memoryReservationLedger)

    expect(memoryReservationLedger.acquire).toHaveBeenCalledWith(
      MEMORY_WORK_CLASS.HEAVY,
      64 * 1024 * 1024,
    )
    expect(DISCOVER_RESEARCH_MEMORY_RESERVATION_BYTES).toBe(64 * 1024 * 1024)
    reservation.release()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('turns a shared-ledger headroom rejection into the durable deferral contract', () => {
    const memoryReservationLedger = {
      acquire: vi.fn(() => ({
        allowed: false,
        decision: { level: 'soft', retryAfterMs: 2_500 },
      })),
    }

    expect(() => acquireDiscoverResearchMemoryReservation(memoryReservationLedger))
      .toThrowError(expect.objectContaining({
        code: 'DISCOVER_RESEARCH_MEMORY_DEFERRED',
        level: 'soft',
        retryAfterMs: 2_500,
      }))
  })

  it.each(['soft', 'hard'])('defers %s pressure with a bounded retry contract', (level) => {
    const memoryPressureGuard = guard({ allowed: false, level, retryAfterMs: 95_000 })

    expect(() => assertDiscoverResearchHeavyAdmission(memoryPressureGuard, { phase: 'agent-batch' }))
      .toThrowError(expect.objectContaining({
        code: 'DISCOVER_RESEARCH_MEMORY_DEFERRED',
        phase: 'agent-batch',
        level,
        retryAfterMs: 60_000,
      }))
  })

  it('checks shutdown and the time slice before sampling RSS', () => {
    const memoryPressureGuard = guard({ allowed: true, level: 'normal' })
    const controller = new AbortController()
    controller.abort(new Error('stopping'))

    expect(() => assertDiscoverResearchHeavyAdmission(memoryPressureGuard, {
      phase: 'crawl',
      signal: controller.signal,
    })).toThrowError(expect.objectContaining({ code: 'DISCOVER_RESEARCH_SHUTDOWN_DEFERRED' }))
    expect(() => assertDiscoverResearchHeavyAdmission(memoryPressureGuard, {
      phase: 'verify',
      deadlineAt: 100,
      now: () => 100,
    })).toThrowError(expect.objectContaining({ code: 'DISCOVER_RESEARCH_TIME_SLICE_DEFERRED' }))
    expect(memoryPressureGuard.admit).not.toHaveBeenCalled()
  })

  it('recovers a queue-owned deferral after a provider wraps the abort', () => {
    const controller = new AbortController()
    const deferred = createDiscoverResearchTimeSliceDeferredError({ phase: 'planner' })
    controller.abort(deferred)

    const normalized = discoverResearchDeferredErrorFor(
      Object.assign(new Error('provider timeout'), { code: 'PROVIDER_TIMEOUT' }),
      { signal: controller.signal },
    )

    expect(normalized).toBe(deferred)
    expect(isDiscoverResearchDeferredError(normalized)).toBe(true)
    expect(discoverResearchRetryDelayMs(normalized)).toBe(1_000)
  })
})
