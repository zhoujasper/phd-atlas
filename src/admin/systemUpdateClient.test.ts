import { describe, expect, it, vi } from 'vitest'
import { waitForInstalledVersion } from './systemUpdateClient'

describe('system update restart handoff', () => {
  it('finishes as soon as the restarted server reports the requested version', async () => {
    const readStatus = vi.fn().mockResolvedValue({
      phase: 'idle',
      source: null,
      bytes: 0,
      total: 0,
      targetVersion: null,
      errorCode: null,
      updatedAt: '2026-07-27T10:00:00.000Z',
      currentVersion: '0.2.0',
      operationInFlight: false,
      restartPending: false,
    })
    const onStatus = vi.fn()

    const status = await waitForInstalledVersion({
      expectedVersion: '0.2.0',
      readStatus,
      onStatus,
      timeoutMs: 50,
      intervalMs: 1,
    })

    expect(status.currentVersion).toBe('0.2.0')
    expect(readStatus).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenCalledWith(status)
  })
})
