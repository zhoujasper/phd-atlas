import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  finalizeStagedMailAttachmentsAfterDurableFlush,
  recoverStagedMailAttachments,
  stageFetchedMailAttachmentBuffers,
} from './index.js'

describe('mail attachment durability boundary', () => {
  it('aborts the batch when encrypted staging fails instead of silently dropping the file', async () => {
    const storageError = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    const vault = {
      exists: vi.fn().mockResolvedValue(false),
      stageMailBuffer: vi.fn().mockRejectedValue(storageError),
      remove: vi.fn(),
    }
    const messages = [{
      key: 'mail-stage-failure',
      attachments: [{
        fileName: 'evidence.txt',
        fileSize: 8,
        mimeType: 'text/plain',
        content: Buffer.from('evidence'),
      }],
    }]

    await expect(stageFetchedMailAttachmentBuffers(
      messages,
      { id: 'mail-user', settings: {} },
      { vault },
    )).rejects.toBe(storageError)
    expect(vault.stageMailBuffer).toHaveBeenCalledOnce()
    expect(messages[0].attachments[0].content).toBeUndefined()
  })

  it('never consumes a stage when the external/encrypted database flush fails', async () => {
    const stage = { stageName: '.mail-stage-v1-test', storageName: 'mail-final.pdf' }
    const flushError = Object.assign(new Error('external snapshot rejected'), {
      code: 'EXTERNAL_DATABASE_SYNC_FAILED',
    })
    const vault = { promoteMailStage: vi.fn() }

    await expect(finalizeStagedMailAttachmentsAfterDurableFlush(
      [stage],
      { flush: vi.fn().mockRejectedValue(flushError), vault },
    )).rejects.toBe(flushError)
    expect(vault.promoteMailStage).not.toHaveBeenCalled()
  })

  it('promotes stages only after the durable acknowledgement returns', async () => {
    const order = []
    const stages = [
      { stageName: '.mail-stage-v1-one', storageName: 'mail-one.pdf' },
      { stageName: '.mail-stage-v1-two', storageName: 'mail-two.pdf' },
    ]
    await finalizeStagedMailAttachmentsAfterDurableFlush(stages, {
      flush: async () => { order.push('flush') },
      vault: {
        promoteMailStage: async (_stageName, storageName) => { order.push(`promote:${storageName}`) },
      },
    })
    expect(order).toEqual(['flush', 'promote:mail-one.pdf', 'promote:mail-two.pdf'])
  })

  it('on restart promotes referenced stages and removes pre-commit stages', async () => {
    const stages = [
      { stageName: '.mail-stage-v1-referenced', storageName: 'mail-referenced.pdf' },
      { stageName: '.mail-stage-v1-orphan', storageName: 'mail-orphan.pdf' },
    ]
    const listMailStages = vi.fn()
      .mockResolvedValueOnce(stages)
      .mockResolvedValueOnce([])
    const vault = {
      listMailStages,
      promoteMailStage: vi.fn().mockResolvedValue({ created: true }),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    await expect(recoverStagedMailAttachments({
      vault,
      isReferenced: async (storageName) => storageName === 'mail-referenced.pdf',
    })).resolves.toEqual({ recovered: 1, discarded: 1 })
    expect(vault.promoteMailStage).toHaveBeenCalledWith(
      '.mail-stage-v1-referenced',
      'mail-referenced.pdf',
    )
    expect(vault.remove).toHaveBeenCalledWith('.mail-stage-v1-orphan')
  })

  it('does not promote an unacknowledged stage from the ordinary same-process retry path', async () => {
    const source = await readFile(path.join(process.cwd(), 'server', 'index.js'), 'utf8')
    const start = source.indexOf('async function performMailSyncForUser')
    const end = source.indexOf('\nfunction runMailFetchForUser', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).not.toContain('recoverStagedMailAttachments(')

    const stage = { stageName: '.mail-stage-v1-unacknowledged', storageName: 'mail-old.pdf' }
    const vault = {
      listMailStages: vi.fn().mockResolvedValueOnce([stage]).mockResolvedValueOnce([]),
      promoteMailStage: vi.fn(),
      remove: vi.fn(),
    }
    await expect(finalizeStagedMailAttachmentsAfterDurableFlush([stage], {
      flush: vi.fn().mockRejectedValue(new Error('external store unavailable')),
      vault,
    })).rejects.toThrow('external store unavailable')
    expect(vault.promoteMailStage).not.toHaveBeenCalled()

    // A restart restores the authoritative older database image first. Its
    // missing reference makes the leftover stage disposable, never promotable.
    await recoverStagedMailAttachments({ vault, isReferenced: async () => false })
    expect(vault.promoteMailStage).not.toHaveBeenCalled()
    expect(vault.remove).toHaveBeenCalledWith(stage.stageName)
  })
})
