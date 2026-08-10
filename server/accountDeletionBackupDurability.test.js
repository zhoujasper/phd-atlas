import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  backupRoot,
  createBackup,
  deleteBackup,
  drainWorkspaceBackupDeletions,
  lockedWriteStore,
  planBackupsForAccountDeletion,
  readStore,
  recoverWorkspaceBackupLifecycleAtStartup,
} from './storage.js'

const testUserIds = new Set()
const testBackupNames = new Set()

function testApplication(id, ownerId, stamp) {
  return {
    id,
    ownerId,
    teamId: null,
    professor: { english: 'Deletion Professor', chinese: '', email: '', phone: '', social: '', homepage: '', research: '', lab: '' },
    school: { name: 'Deletion Durability University', country: 'UK', website: '' },
    program: 'Durable cleanup',
    deadline: '2027-01-01',
    status: 'Draft',
    progress: 0,
    priority: 50,
    tags: [],
    materials: [],
    communications: [],
    scholarships: [],
    fees: [],
    tasks: [],
    timeline: [],
    versions: [],
    shares: [],
    createdAt: new Date(stamp).toISOString(),
    updatedAt: new Date(stamp).toISOString(),
  }
}

async function createAccountWithBackup(label) {
  const stamp = Date.now() + Math.floor(Math.random() * 100_000)
  const userId = `user_delete_outbox_${label}_${stamp}`
  const applicationId = `app_delete_outbox_${label}_${stamp}`
  const store = await readStore()
  const sourceUser = store.users[0]
  const user = structuredClone(sourceUser)
  user.id = userId
  user.name = `Delete ${label}`
  user.email = `delete-${label}-${stamp}@example.com`
  user.role = 'member'
  user.settings = {
    ...(user.settings ?? {}),
    applicationTrash: [],
    profileRecommenders: [],
  }
  const application = testApplication(applicationId, userId, stamp)
  store.users.push(user)
  store.applications.push(application)
  await lockedWriteStore(store)
  const backup = await createBackup(store, userId, application, 20, { prune: false })
  testUserIds.add(userId)
  testBackupNames.add(backup.fileName)
  return { userId, applicationId, backup }
}

async function removeTestAccount(userId) {
  const store = await readStore()
  if (!store.users.some((user) => user.id === userId)) return
  store.users = store.users.filter((user) => user.id !== userId)
  store.applications = store.applications.filter((application) => application.ownerId !== userId)
  store.profileAssets = store.profileAssets.filter((asset) => asset.ownerId !== userId)
  await lockedWriteStore(store)
}

afterEach(async () => {
  for (const fileName of testBackupNames) {
    await deleteBackup(fileName).catch(() => undefined)
  }
  testBackupNames.clear()
  for (const userId of testUserIds) {
    await removeTestAccount(userId).catch(() => undefined)
  }
  testUserIds.clear()
  await drainWorkspaceBackupDeletions(512).catch(() => undefined)
})

describe('account deletion backup outbox', () => {
  it('commits logical deletion and backup intent together, then resumes cleanup at startup', async () => {
    const { userId, applicationId, backup } = await createAccountWithBackup('startup')
    const plan = await planBackupsForAccountDeletion(userId)
    // Simulate a backup that commits after the lock-free legacy scan. Its
    // canonical quota source must still be captured by the delete transaction.
    const latest = await readStore()
    const lateBackup = await createBackup(
      latest,
      userId,
      latest.applications.find((application) => application.id === applicationId),
      20,
      { prune: false },
    )
    testBackupNames.add(lateBackup.fileName)
    const deleting = await readStore()
    deleting.users = deleting.users.filter((user) => user.id !== userId)
    deleting.applications = deleting.applications.filter((application) => application.ownerId !== userId)
    deleting.profileAssets = deleting.profileAssets.filter((asset) => asset.ownerId !== userId)

    const receipt = await lockedWriteStore(deleting, { backupDeletionPlans: [plan] })
    expect(receipt.backupDeletions).toMatchObject({
      queued: 2,
      actorCounts: { [userId]: 2 },
    })
    expect((await readStore()).users.some((user) => user.id === userId)).toBe(false)
    await expect(fs.access(backup.path)).resolves.toBeUndefined()
    await expect(fs.access(lateBackup.path)).resolves.toBeUndefined()

    await recoverWorkspaceBackupLifecycleAtStartup()
    await expect(fs.access(backup.path)).rejects.toThrow()
    await expect(fs.access(lateBackup.path)).rejects.toThrow()
    testBackupNames.delete(backup.fileName)
    testBackupNames.delete(lateBackup.fileName)
  })

  it('leaves the account and backup untouched when a stale deletion loses its CAS race', async () => {
    const { userId, backup } = await createAccountWithBackup('conflict')
    const stale = await readStore()
    const plan = await planBackupsForAccountDeletion(userId)
    const concurrent = await readStore()
    concurrent.users.find((user) => user.id === userId).name = 'Concurrent winner'
    await lockedWriteStore(concurrent)

    stale.users = stale.users.filter((user) => user.id !== userId)
    stale.applications = stale.applications.filter((application) => application.ownerId !== userId)
    stale.profileAssets = stale.profileAssets.filter((asset) => asset.ownerId !== userId)
    await expect(lockedWriteStore(stale, { backupDeletionPlans: [plan] }))
      .rejects.toMatchObject({ code: 'STORE_WRITE_CONFLICT' })

    expect((await readStore()).users.find((user) => user.id === userId)?.name)
      .toBe('Concurrent winner')
    await expect(fs.access(backup.path)).resolves.toBeUndefined()
  })

  it('keeps a partial physical failure retryable and never overstates completion', async () => {
    const fileName = `phd-atlas-app-partial-${Date.now()}.json`
    const intent = { file_name: fileName, actor_id: 'user_partial', file_bytes: 0, source_version: 0 }
    const next = vi.fn().mockResolvedValueOnce(intent)
    const remove = vi.fn().mockRejectedValueOnce(Object.assign(new Error('disk busy'), { code: 'EBUSY' }))
    const finish = vi.fn().mockResolvedValue(true)
    const options = {
      next,
      inspect: vi.fn().mockResolvedValue({ actorId: 'user_partial' }),
      referenced: vi.fn().mockResolvedValue(false),
      remove,
      finish,
    }

    await expect(drainWorkspaceBackupDeletions(8, options))
      .resolves.toEqual({ deleted: 0, cancelled: 0, deferred: 1 })
    expect(finish).not.toHaveBeenCalled()

    next.mockReset().mockResolvedValueOnce(intent).mockResolvedValueOnce(null)
    remove.mockReset().mockResolvedValue(undefined)
    await expect(drainWorkspaceBackupDeletions(8, options))
      .resolves.toEqual({ deleted: 1, cancelled: 0, deferred: 0 })
    expect(remove).toHaveBeenCalledTimes(4)
    expect(finish).toHaveBeenCalledWith(fileName, 'user_partial', { cancelled: false })
  })

  it('fails closed for an unsafe path or a backup now owned by another account', async () => {
    const remove = vi.fn()
    const finish = vi.fn()
    await expect(drainWorkspaceBackupDeletions(1, {
      next: vi.fn().mockResolvedValue({
        file_name: '../outside.json',
        actor_id: 'user_a',
      }),
      referenced: vi.fn().mockResolvedValue(false),
      remove,
      finish,
    })).resolves.toEqual({ deleted: 0, cancelled: 0, deferred: 1 })
    expect(remove).not.toHaveBeenCalled()

    const fileName = `phd-atlas-app-owner-conflict-${Date.now()}.json`
    await expect(drainWorkspaceBackupDeletions(1, {
      next: vi.fn().mockResolvedValue({ file_name: fileName, actor_id: 'user_a' }),
      inspect: vi.fn().mockResolvedValue({ actorId: 'user_b' }),
      referenced: vi.fn().mockResolvedValue(false),
      remove,
      finish,
    })).resolves.toEqual({ deleted: 0, cancelled: 0, deferred: 1 })
    expect(remove).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()

    for (const calledPath of remove.mock.calls.flat()) {
      expect(path.resolve(calledPath).startsWith(path.resolve(backupRoot))).toBe(true)
    }
  })
})
