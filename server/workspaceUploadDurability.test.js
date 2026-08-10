import { describe, expect, it, vi } from 'vitest'
import {
  drainWorkspaceUploadDeletions,
  promoteReferencedUploadStages,
} from './index.js'

describe('workspace upload durability boundary', () => {
  it('reconciles startup stages only after checking the canonical reference', async () => {
    const stages = [
      { stageName: '.upload-stage-v1-referenced', storageName: 'referenced.pdf' },
      { stageName: '.upload-stage-v1-orphan', storageName: 'orphan.pdf' },
    ]
    const order = []
    const vault = {
      listUploadStages: vi.fn().mockResolvedValue(stages),
      promoteUploadStage: vi.fn(async (stageName, storageName) => {
        order.push(`promote:${stageName}:${storageName}`)
      }),
      remove: vi.fn(async (stageName) => {
        order.push(`remove:${stageName}`)
      }),
    }

    await expect(promoteReferencedUploadStages({
      startup: true,
      vault,
      isReferenced: async (storageName) => {
        order.push(`reference:${storageName}`)
        return storageName === 'referenced.pdf'
      },
    })).resolves.toEqual({ promoted: 1, discarded: 1, deferred: 0 })

    expect(order).toEqual([
      'reference:referenced.pdf',
      'promote:.upload-stage-v1-referenced:referenced.pdf',
      'reference:orphan.pdf',
      'remove:.upload-stage-v1-orphan',
    ])
  })

  it('keeps an acknowledged stage retryable when promotion is interrupted', async () => {
    const pendingStages = new Map([
      ['.upload-stage-v1-retry', 'retry.pdf'],
    ])
    const vault = {
      promoteUploadStage: vi.fn()
        .mockRejectedValueOnce(new Error('simulated crash before rename'))
        .mockResolvedValueOnce({ created: true }),
    }
    const options = {
      vault,
      pendingStages,
      isReferenced: async () => true,
    }

    await expect(promoteReferencedUploadStages(options))
      .resolves.toEqual({ promoted: 0, discarded: 0, deferred: 1 })
    expect(pendingStages.get('.upload-stage-v1-retry')).toBe('retry.pdf')

    await expect(promoteReferencedUploadStages(options))
      .resolves.toEqual({ promoted: 1, discarded: 0, deferred: 0 })
    expect(pendingStages.size).toBe(0)
  })

  it('releases a failed deletion claim and completes it on the next drain', async () => {
    const claim = { token: 'claim-token', storageName: 'delete-me.pdf' }
    const claimNext = vi.fn()
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(null)
    const vault = {
      remove: vi.fn()
        .mockRejectedValueOnce(new Error('simulated crash before unlink'))
        .mockResolvedValueOnce(undefined),
    }
    const finish = vi.fn().mockResolvedValue(undefined)
    const options = { vault, claimNext, finish }

    await expect(drainWorkspaceUploadDeletions(8, options))
      .resolves.toEqual({ deleted: 0, deferred: 1 })
    expect(finish).toHaveBeenNthCalledWith(
      1,
      claim.token,
      claim.storageName,
      { deleted: false },
    )

    await expect(drainWorkspaceUploadDeletions(8, options))
      .resolves.toEqual({ deleted: 1, deferred: 0 })
    expect(finish).toHaveBeenNthCalledWith(
      2,
      claim.token,
      claim.storageName,
      { deleted: true },
    )
  })

  it('never unlinks a file without first owning a durable deletion claim', async () => {
    const vault = { remove: vi.fn() }
    await expect(drainWorkspaceUploadDeletions(8, {
      vault,
      claimNext: vi.fn().mockResolvedValue(null),
      finish: vi.fn(),
    })).resolves.toEqual({ deleted: 0, deferred: 0 })
    expect(vault.remove).not.toHaveBeenCalled()
  })
})
