import { describe, expect, it } from 'vitest'
import {
  createMemoryPressureGuard,
  DEFAULT_MEMORY_BUDGET_BYTES,
  MEMORY_PRESSURE_LEVEL,
  MEMORY_WORK_CLASS,
  MemoryPressureError,
  readProcessRssBytes,
  resolveMemoryBudget,
} from './memoryPressure.js'

const MEBIBYTE = 1024 * 1024

describe('memory budget resolution', () => {
  it('prefers an explicit budget, then a valid runtime constraint, then 1024 MiB', () => {
    expect(resolveMemoryBudget({
      budgetBytes: 640 * MEBIBYTE,
      constrainedMemory: () => 256 * MEBIBYTE,
    })).toEqual({ bytes: 640 * MEBIBYTE, source: 'configured' })

    expect(resolveMemoryBudget({
      constrainedMemory: () => 256 * MEBIBYTE,
    })).toEqual({ bytes: 256 * MEBIBYTE, source: 'constrained' })

    expect(resolveMemoryBudget({
      constrainedMemory: () => 0,
    })).toEqual({ bytes: DEFAULT_MEMORY_BUDGET_BYTES, source: 'default' })
    expect(resolveMemoryBudget({
      constrainedMemory: () => { throw new Error('unsupported') },
    })).toEqual({ bytes: DEFAULT_MEMORY_BUDGET_BYTES, source: 'default' })
    expect(() => resolveMemoryBudget({
      budgetBytes: 0,
      constrainedMemory: () => 4 * 1024 * MEBIBYTE,
    })).toThrow('budgetBytes must be a positive safe integer')
  })
})

describe('RSS memory pressure guard', () => {
  it('uses conservative peak RSS when an emulated runtime reports zero current RSS', () => {
    expect(readProcessRssBytes({
      memoryUsage: () => ({ rss: 128 * MEBIBYTE }),
      resourceUsage: () => ({ maxRSS: 512 * 1024 }),
    })).toBe(128 * MEBIBYTE)

    expect(readProcessRssBytes({
      memoryUsage: () => ({ rss: 0 }),
      resourceUsage: () => ({ maxRSS: 96 * 1024 }),
    })).toBe(96 * MEBIBYTE)

    expect(() => readProcessRssBytes({
      memoryUsage: () => { throw new Error('unsupported') },
      resourceUsage: () => ({ maxRSS: 0 }),
    })).toThrow('Process RSS is unavailable')
  })

  it('uses the exact 768 MiB soft and 896 MiB hard defaults', () => {
    const guard = createMemoryPressureGuard({
      constrainedMemory: () => 0,
      readRssBytes: () => 128 * MEBIBYTE,
    })

    expect(guard.snapshot()).toMatchObject({
      initialized: false,
      budgetBytes: 1024 * MEBIBYTE,
      budgetSource: 'default',
      softThresholdBytes: 768 * MEBIBYTE,
      hardThresholdBytes: 896 * MEBIBYTE,
      level: MEMORY_PRESSURE_LEVEL.NORMAL,
    })
  })

  it('rejects only heavy work at soft pressure and all non-health work at hard pressure', () => {
    let rss = 200 * MEBIBYTE
    const guard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => rss,
    })

    expect(guard.admit(MEMORY_WORK_CLASS.HEAVY)).toMatchObject({
      allowed: true,
      level: 'normal',
    })

    rss = 384 * MEBIBYTE
    expect(guard.admit('heavy')).toMatchObject({
      allowed: false,
      level: 'soft',
      code: 'MEMORY_PRESSURE_SOFT',
      retryAfterMs: 1_000,
    })
    expect(guard.admit('standard')).toMatchObject({ allowed: true, level: 'soft' })

    rss = 448 * MEBIBYTE
    expect(guard.admit('light')).toMatchObject({
      allowed: false,
      level: 'hard',
      code: 'MEMORY_PRESSURE_HARD',
    })
    expect(guard.admit('liveness')).toMatchObject({
      allowed: true,
      workClass: 'health',
      level: 'hard',
    })
    expect(guard.snapshot().counters).toMatchObject({
      admitted: 3,
      rejected: 2,
      softRejections: 1,
      hardRejections: 1,
      healthBypasses: 1,
    })
  })

  it('enters pressure immediately but requires hysteresis and consecutive samples to recover', () => {
    let rss = 448 * MEBIBYTE
    let clock = 1
    const guard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => rss,
      now: () => clock++,
    })

    expect(guard.sample().level).toBe('hard')

    // 430 MiB is below the hard entry threshold but above its hysteresis exit.
    rss = 430 * MEBIBYTE
    expect(guard.sample()).toMatchObject({ level: 'hard', pendingRecoverySamples: 0 })

    // Below the 422.4 MiB hard exit, two stable samples are required.
    rss = 410 * MEBIBYTE
    expect(guard.sample()).toMatchObject({
      level: 'hard',
      pendingRecoveryLevel: 'soft',
      pendingRecoverySamples: 1,
    })
    expect(guard.sample().level).toBe('soft')

    // Soft remains latched until RSS is below its 358.4 MiB recovery edge.
    rss = 370 * MEBIBYTE
    expect(guard.sample()).toMatchObject({ level: 'soft', pendingRecoverySamples: 0 })
    rss = 350 * MEBIBYTE
    expect(guard.sample()).toMatchObject({ level: 'soft', pendingRecoverySamples: 1 })
    expect(guard.sample().level).toBe('normal')

    expect(guard.snapshot()).toMatchObject({
      lastTransitionAt: 7,
      pendingRecoveryLevel: null,
      pendingRecoverySamples: 0,
      counters: {
        transitions: 3,
        enteredHard: 1,
        enteredSoft: 1,
        recoveries: 1,
        hardToSoft: 1,
        softToNormal: 1,
      },
    })
  })

  it('fails closed when RSS sampling fails while keeping health available', () => {
    let fail = true
    const guard = createMemoryPressureGuard({
      budgetBytes: 256 * MEBIBYTE,
      readRssBytes: () => {
        if (fail) throw new Error('rss unavailable')
        return 100 * MEBIBYTE
      },
    })

    expect(guard.admit('standard')).toMatchObject({
      allowed: false,
      level: 'hard',
      rssBytes: null,
    })
    expect(guard.admit('health')).toMatchObject({ allowed: true, level: 'hard' })
    expect(guard.snapshot()).toMatchObject({
      lastSampleFailed: true,
      lastValidRssBytes: null,
      counters: { samplingErrors: 2, healthBypasses: 1 },
    })

    fail = false
    expect(guard.sample()).toMatchObject({ level: 'hard', pendingRecoverySamples: 1 })
    expect(guard.sample()).toMatchObject({
      level: 'normal',
      lastRssBytes: 100 * MEBIBYTE,
      lastSampleFailed: false,
    })
  })

  it('fails closed on a broken clock and exposes side-effect-free snapshots', () => {
    let clockFails = true
    const guard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => 100 * MEBIBYTE,
      now: () => {
        if (clockFails) throw new Error('clock unavailable')
        return 10
      },
    })

    const initial = guard.snapshot()
    expect(initial).toMatchObject({ initialized: false, level: 'normal' })
    expect(initial.counters.samples).toBe(0)
    expect(guard.sample()).toMatchObject({
      initialized: true,
      level: 'hard',
      lastSampleFailed: true,
      counters: { samples: 1, samplingErrors: 1 },
    })
    expect(guard.snapshot().counters.samples).toBe(1)

    clockFails = false
    expect(guard.sample()).toMatchObject({ level: 'hard', pendingRecoverySamples: 1 })
    expect(guard.sample()).toMatchObject({ level: 'normal', lastSampleAt: 10 })
  })

  it('validates threshold and recovery configuration instead of silently disabling protection', () => {
    const common = {
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => 100 * MEBIBYTE,
    }
    expect(() => createMemoryPressureGuard({ ...common, softRatio: 1 })).toThrow('softRatio')
    expect(() => createMemoryPressureGuard({ ...common, hardRatio: 0.5 })).toThrow('hardRatio')
    expect(() => createMemoryPressureGuard({ ...common, hysteresisRatio: Number.POSITIVE_INFINITY })).toThrow('hysteresisRatio')
    expect(() => createMemoryPressureGuard({ ...common, recoverySamples: 0 })).toThrow('recoverySamples')
    expect(() => createMemoryPressureGuard({ ...common, retryAfterMs: 0 })).toThrow('retryAfterMs')
  })

  it('throws a structured retryable error and treats omitted work as heavy', () => {
    const guard = createMemoryPressureGuard({
      budgetBytes: 512 * MEBIBYTE,
      readRssBytes: () => 400 * MEBIBYTE,
      retryAfterMs: 2_500,
    })

    expect(() => guard.assertAllowed()).toThrow(MemoryPressureError)
    try {
      guard.assertAllowed()
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MEMORY_PRESSURE_SOFT',
        status: 503,
        retryAfterMs: 2_500,
        level: 'soft',
        workClass: 'heavy',
        rssBytes: 400 * MEBIBYTE,
        budgetBytes: 512 * MEBIBYTE,
      })
    }
    expect(() => guard.admit('typo')).toThrow(TypeError)
  })
})
