import { describe, expect, it } from 'vitest'
import {
  configuredThreadPoolSize,
  passwordAdmissionMaxActive,
} from './threadPool.js'

const MEBIBYTE = 1024 * 1024

describe('thread pool sizing', () => {
  it('uses the configured libuv size and falls back to Node default 4', () => {
    expect(configuredThreadPoolSize('8')).toBe(8)
    expect(configuredThreadPoolSize('0')).toBe(4)
    expect(configuredThreadPoolSize('invalid')).toBe(4)
  })

  it('aligns password admission with thread pool and memory budget', () => {
    expect(passwordAdmissionMaxActive({
      maxActive: 8,
      threadPoolSize: 4,
      budgetBytes: 1024 * MEBIBYTE,
    })).toBe(2)

    expect(passwordAdmissionMaxActive({
      maxActive: 8,
      threadPoolSize: 8,
      budgetBytes: 1024 * MEBIBYTE,
    })).toBe(6)

    expect(passwordAdmissionMaxActive({
      maxActive: 8,
      threadPoolSize: 16,
      budgetBytes: 512 * MEBIBYTE,
    })).toBe(6)

    expect(passwordAdmissionMaxActive({
      maxActive: 2,
      threadPoolSize: 16,
      budgetBytes: 1024 * MEBIBYTE,
    })).toBe(2)
  })
})
