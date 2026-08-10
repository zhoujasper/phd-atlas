import { describe, expect, it, vi } from 'vitest'
import { commitApplicationTrashRetention } from './retentionMaintenance.js'

describe('retention maintenance commit ownership', () => {
  it('does not return a stale scan removal after the user restored the item', async () => {
    const writeStore = vi.fn()
    const restoredStore = {
      users: [{ id: 'user-1', settings: { applicationTrash: [] } }],
    }

    const removed = await commitApplicationTrashRetention({
      userId: 'user-1',
      readStore: async () => restoredStore,
      writeStore,
      retentionPlan: (user) => ({
        changed: user.settings.applicationTrash.length > 0,
        kept: user.settings.applicationTrash,
        removed: [],
      }),
    })

    expect(removed).toEqual([])
    expect(writeStore).not.toHaveBeenCalled()
  })

  it('exposes binary removals only after their metadata deletion is durable', async () => {
    let releaseWrite
    const writeGate = new Promise((resolve) => { releaseWrite = resolve })
    const application = { id: 'expired-application' }
    const store = {
      users: [{
        id: 'user-1',
        settings: {
          applicationTrash: [{ id: 'trash-1', application }],
        },
      }],
    }
    const writeStore = vi.fn(async () => writeGate)
    let settled = false

    const committing = commitApplicationTrashRetention({
      userId: 'user-1',
      readStore: async () => store,
      writeStore,
      retentionPlan: () => ({
        changed: true,
        kept: [],
        removed: [{ id: 'trash-1', application }],
      }),
    }).then((removed) => {
      settled = true
      return removed
    })

    await Promise.resolve()
    expect(writeStore).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    releaseWrite()
    await expect(committing).resolves.toEqual([application])
    expect(store.users[0].settings.applicationTrash).toEqual([])
  })
})
