import { describe, expect, it, vi } from 'vitest'
import {
  PREVIOUS_PROCESS_WAIT_TIMEOUT_MS,
  waitForPreviousProcess,
} from '../tools/apply-update.mjs'

describe('detached update helper process handoff', () => {
  it('allows a durability-safe old worker to exit at the 60-second recovery boundary', async () => {
    let nowMs = 0
    const processExists = vi.fn(async () => nowMs < 60_000)
    const sleep = vi.fn(async (delayMs) => { nowMs += delayMs })

    await expect(waitForPreviousProcess(91_001, {
      now: () => nowMs,
      processExists,
      sleep,
    })).resolves.toBeUndefined()

    expect(PREVIOUS_PROCESS_WAIT_TIMEOUT_MS).toBe(65_000)
    expect(nowMs).toBe(60_000)
    expect(processExists).toHaveBeenLastCalledWith(91_001)
    expect(sleep).toHaveBeenLastCalledWith(250)
  })

  it('fails before the earliest forced-kill boundary when the old worker remains alive', async () => {
    let nowMs = 0
    const processExists = vi.fn().mockResolvedValue(true)
    const sleep = vi.fn(async (delayMs) => { nowMs += delayMs })

    await expect(waitForPreviousProcess(91_002, {
      now: () => nowMs,
      processExists,
      sleep,
    })).rejects.toMatchObject({
      code: 'UPDATE_PREVIOUS_PROCESS_TIMEOUT',
      message: 'The previous server process did not stop in time.',
    })

    expect(nowMs).toBe(65_000)
    expect(60_000).toBeLessThan(PREVIOUS_PROCESS_WAIT_TIMEOUT_MS)
    expect(PREVIOUS_PROCESS_WAIT_TIMEOUT_MS).toBeLessThan(70_000)
    expect(70_000).toBeLessThan(75_000)
    expect(processExists).toHaveBeenLastCalledWith(91_002)
    expect(sleep).toHaveBeenLastCalledWith(250)
  })
})
