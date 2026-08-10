import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeReloadMocks = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<boolean>>(),
  reload: vi.fn(),
}))

vi.mock('../safeReload', () => ({
  prepareForSafeReload: safeReloadMocks.prepare,
}))

vi.mock('../pageReload', () => ({
  reloadPage: safeReloadMocks.reload,
}))

import { reloadInstalledApplication } from './systemUpdateClient'

beforeEach(() => {
  safeReloadMocks.prepare.mockReset()
  safeReloadMocks.reload.mockReset()
})

describe('system update reload boundary', () => {
  it('does not reload when resident state cannot be prepared', async () => {
    safeReloadMocks.prepare.mockResolvedValue(false)

    await expect(reloadInstalledApplication()).resolves.toBe(false)

    expect(safeReloadMocks.prepare).toHaveBeenCalledWith({ reason: 'application-update' })
    expect(safeReloadMocks.reload).not.toHaveBeenCalled()
  })

  it('reloads only after safe preparation succeeds', async () => {
    safeReloadMocks.prepare.mockResolvedValue(true)

    await expect(reloadInstalledApplication()).resolves.toBe(true)

    expect(safeReloadMocks.reload).toHaveBeenCalledTimes(1)
  })
})
