import { describe, expect, it, vi } from 'vitest'
import { createMemoryPressureGuard, MEMORY_WORK_CLASS } from './memoryPressure.js'
import { createMemoryReservationLedger } from './memoryReservationLedger.js'

const MEBIBYTE = 1024 * 1024

function guardAt(readRssBytes) {
  return createMemoryPressureGuard({
    budgetBytes: 512 * MEBIBYTE,
    readRssBytes,
    recoverySamples: 1,
  })
}

describe('shared process memory reservation ledger', () => {
  it('prevents concurrent work from spending the same hard-boundary headroom', () => {
    const guard = guardAt(() => 350 * MEBIBYTE)
    const ledger = createMemoryReservationLedger({ memoryPressureGuard: guard })
    const password = ledger.acquire(MEMORY_WORK_CLASS.STANDARD, 68 * MEBIBYTE)
    expect(password.allowed).toBe(true)

    const exportWork = ledger.acquire(MEMORY_WORK_CLASS.HEAVY, 32 * MEBIBYTE)
    expect(exportWork.allowed).toBe(false)
    expect(exportWork.decision).toMatchObject({
      code: 'MEMORY_PRESSURE_SOFT',
      level: 'soft',
    })

    password.release()
    expect(ledger.acquire(MEMORY_WORK_CLASS.HEAVY, 32 * MEBIBYTE).allowed).toBe(true)
  })

  it('keeps a reservation until its idempotent lease is explicitly released', () => {
    const guard = guardAt(() => 200 * MEBIBYTE)
    const ledger = createMemoryReservationLedger({ memoryPressureGuard: guard })
    const work = ledger.acquire(MEMORY_WORK_CLASS.HEAVY, 64 * MEBIBYTE)
    expect(ledger.snapshot()).toMatchObject({
      activeReservations: 1,
      reservedBytes: 64 * MEBIBYTE,
    })
    work.release()
    work.release()
    expect(ledger.snapshot()).toMatchObject({ activeReservations: 0, reservedBytes: 0 })
  })

  it('shrinks a live phase lease without requiring overlapping headroom', () => {
    const guard = guardAt(() => 340 * MEBIBYTE)
    const ledger = createMemoryReservationLedger({ memoryPressureGuard: guard })
    const phase = ledger.acquire(MEMORY_WORK_CLASS.HEAVY, 96 * MEBIBYTE)
    expect(phase.allowed).toBe(true)
    expect(ledger.acquire(MEMORY_WORK_CLASS.HEAVY, 16 * MEBIBYTE).allowed).toBe(false)

    expect(phase.shrink(24 * MEBIBYTE)).toBe(24 * MEBIBYTE)
    expect(phase.bytes).toBe(24 * MEBIBYTE)
    expect(ledger.snapshot()).toMatchObject({
      activeReservations: 1,
      reservedBytes: 24 * MEBIBYTE,
      peakReservedBytes: 96 * MEBIBYTE,
    })
    expect(phase.shrink(48 * MEBIBYTE)).toBe(24 * MEBIBYTE)
    phase.release()
    expect(ledger.snapshot()).toMatchObject({ activeReservations: 0, reservedBytes: 0 })
  })

  it('fails closed when memory telemetry fails', () => {
    const readRssBytes = vi.fn(() => { throw new Error('telemetry unavailable') })
    const ledger = createMemoryReservationLedger({
      memoryPressureGuard: guardAt(readRssBytes),
    })
    expect(ledger.acquire(MEMORY_WORK_CLASS.STANDARD, MEBIBYTE)).toMatchObject({
      allowed: false,
      decision: { level: 'hard' },
    })
  })

  it('admits only a capped completion lease inside the absolute process budget', () => {
    let rss = 490 * MEBIBYTE
    const guard = guardAt(() => rss)
    const ledger = createMemoryReservationLedger({ memoryPressureGuard: guard })

    const completion = ledger.acquireCompletion(2 * MEBIBYTE, { maxBytes: 8 * MEBIBYTE })
    expect(completion.allowed).toBe(true)
    expect(ledger.snapshot()).toMatchObject({
      activeReservations: 1,
      reservedBytes: 2 * MEBIBYTE,
    })
    expect(ledger.acquireCompletion(9 * MEBIBYTE, { maxBytes: 8 * MEBIBYTE })).toMatchObject({
      allowed: false,
      decision: { code: 'MEMORY_PRESSURE_HARD', level: 'hard' },
    })

    rss = 511 * MEBIBYTE
    expect(ledger.acquireCompletion(MEBIBYTE, { maxBytes: 8 * MEBIBYTE })).toMatchObject({
      allowed: false,
      decision: { code: 'MEMORY_PRESSURE_HARD', level: 'hard' },
    })
    completion.release()
    expect(ledger.snapshot()).toMatchObject({ activeReservations: 0, reservedBytes: 0 })
  })

})
