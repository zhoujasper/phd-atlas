import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  backupRoot,
  createTeam,
  deletePushSubscription,
  deleteBackup,
  deleteTeam,
  enqueueMailSyncJob,
  claimNextMailSyncJob,
  finishMailSyncJob,
  getMailFetchState,
  listPushSubscriptions,
  listBackups,
  lockedWriteStore,
  pruneApplicationBackups,
  readStore,
  resetMailFetchState,
  withWriteLock,
  renameTeam,
  upsertPushSubscription,
  writeStore,
} from './storage.js'

const createdFiles = []

async function writeTestBackup(fileName, backup = { actorId: 'user_test' }) {
  await fs.mkdir(backupRoot, { recursive: true })
  const target = path.join(backupRoot, fileName)
  await fs.writeFile(
    target,
    JSON.stringify({ backup, data: true }),
    'utf8',
  )
  createdFiles.push(fileName)
  return target
}

afterEach(async () => {
  await Promise.all(
    createdFiles.splice(0).map((fileName) =>
      fs.rm(path.join(backupRoot, fileName), { force: true }),
    ),
  )
})

describe('durable mail sync jobs', () => {
  it('coalesces active clicks and persists queue, running, and completion states', async () => {
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const userId = `user_mail_sync_${stamp}`
    await withWriteLock(async () => {
      const store = await readStore()
      const sourceUser = store.users[0]
      store.users.push({
        ...JSON.parse(JSON.stringify(sourceUser)),
        id: userId,
        email: `mail-sync-${stamp}@example.com`,
        // This test exercises durable-job storage only. Do not inherit the
        // developer mailbox or enable the production polling scheduler.
        settings: {
          incomingProtocol: 'imap',
          autoFetchMail: false,
        },
      })
      await writeStore(store)
    })

    try {
      const first = await enqueueMailSyncJob(userId, 'history')
      const duplicate = await enqueueMailSyncJob(userId, 'incremental')
      expect(first.alreadyQueued).toBe(false)
      expect(duplicate).toMatchObject({
        alreadyQueued: true,
        job: { id: first.job.id, mode: 'history', status: 'queued' },
      })

      const claimed = await claimNextMailSyncJob(first.job.id)
      expect(claimed).toMatchObject({ id: first.job.id, userId, status: 'running' })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({ id: first.job.id, status: 'running' })

      await finishMailSyncJob(first.job.id, {
        status: 'succeeded',
        result: {
          fetched: 3,
          filed: 2,
          incoming: 1,
          outgoing: 1,
          duplicates: 1,
          unmatched: 0,
          errorCode: null,
          mode: 'history',
          stateCommitted: true,
        },
      })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({
        id: first.job.id,
        status: 'succeeded',
        result: { filed: 2, stateCommitted: true },
      })

      const next = await enqueueMailSyncJob(userId, 'incremental')
      expect(next.alreadyQueued).toBe(false)
      expect(next.job.id).not.toBe(first.job.id)
    } finally {
      await withWriteLock(async () => {
        // Explicitly remove queued/running state as well. It protects older
        // databases that predate the foreign-key cascade on mail_fetch_state.
        await resetMailFetchState(userId)
        const latest = await readStore()
        latest.users = latest.users.filter((user) => user.id !== userId)
        latest.applications = latest.applications.filter((application) => application.ownerId !== userId)
        await writeStore(latest)
      })
    }
  })
})

describe('backup storage', () => {
  it('deletes the requested backup file from the backup list', async () => {
    const fileName = `phd-atlas-backup-vitest-${Date.now()}.json`
    const target = await writeTestBackup(fileName)

    await expect(fs.access(target)).resolves.toBeUndefined()

    const deleted = await deleteBackup(fileName)
    const cleanupIndex = createdFiles.indexOf(fileName)
    if (cleanupIndex >= 0) {
      createdFiles.splice(cleanupIndex, 1)
    }

    expect(deleted).toEqual({ deleted: true, fileName })
    await expect(fs.access(target)).rejects.toThrow()
    expect((await listBackups()).some((backup) => backup.fileName === fileName)).toBe(false)
  })

  it('prunes application backups down to the configured retention count', async () => {
    const stamp = Date.now()
    const actorId = `user_prune_${stamp}`
    const applicationId = `app_prune_${stamp}`
    const oldFile = `phd-atlas-app-${applicationId}-old-${stamp}.json`
    const middleFile = `phd-atlas-app-${applicationId}-middle-${stamp}.json`
    const newestFile = `phd-atlas-app-${applicationId}-newest-${stamp}.json`

    await writeTestBackup(oldFile, {
      kind: 'application',
      actorId,
      applicationId,
      applicationName: 'Prune Test',
      createdAt: '2026-07-02T01:00:00.000Z',
    })
    await writeTestBackup(middleFile, {
      kind: 'application',
      actorId,
      applicationId,
      applicationName: 'Prune Test',
      createdAt: '2026-07-02T02:00:00.000Z',
    })
    await writeTestBackup(newestFile, {
      kind: 'application',
      actorId,
      applicationId,
      applicationName: 'Prune Test',
      createdAt: '2026-07-02T03:00:00.000Z',
    })

    await expect(pruneApplicationBackups(actorId, applicationId, 2)).resolves.toMatchObject({
      limit: 2,
      deleted: 1,
      deletedFileNames: [oldFile],
    })

    const remaining = await listBackups({ actorId, applicationId })
    expect(remaining.map((backup) => backup.fileName)).toEqual([newestFile, middleFile])
    await expect(fs.access(path.join(backupRoot, oldFile))).rejects.toThrow()
  })

  it('rejects invalid or missing backup file names', async () => {
    await expect(deleteBackup('../not-a-backup.txt')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_BACKUP_NAME',
    })
    await expect(deleteBackup('missing-backup.json')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('coalesces concurrent directory scans after the backup list changes', async () => {
    await listBackups()
    const stamp = Date.now()
    const fileName = `phd-atlas-backup-vitest-coalesced-${stamp}.json`
    await writeTestBackup(fileName, {
      kind: 'workspace',
      actorId: `user_coalesced_${stamp}`,
      createdAt: new Date(stamp).toISOString(),
    })

    const originalReaddir = fs.readdir.bind(fs)
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return originalReaddir(...args)
    })
    try {
      const [first, second] = await Promise.all([listBackups(), listBackups()])
      expect(first.some((backup) => backup.fileName === fileName)).toBe(true)
      expect(second.some((backup) => backup.fileName === fileName)).toBe(true)
      expect(readdirSpy).toHaveBeenCalledTimes(1)
    } finally {
      readdirSpy.mockRestore()
    }
  })

  it('skips an archive removed after the directory scan starts', async () => {
    await listBackups()
    const fileName = `phd-atlas-backup-vitest-race-${Date.now()}.json`
    const target = await writeTestBackup(fileName, {
      kind: 'workspace',
      actorId: `user_race_${Date.now()}`,
      createdAt: new Date().toISOString(),
    })
    const originalStat = fs.stat.bind(fs)
    let simulateRemovedArchive = true
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (filePath, ...args) => {
      if (simulateRemovedArchive && path.resolve(String(filePath)) === path.resolve(target)) {
        simulateRemovedArchive = false
        const error = new Error('Archive disappeared during scan')
        error.code = 'ENOENT'
        throw error
      }
      return originalStat(filePath, ...args)
    })
    try {
      const backups = await listBackups()
      expect(backups.some((backup) => backup.fileName === fileName)).toBe(false)
    } finally {
      statSpy.mockRestore()
    }
  })
})

describe.sequential('concurrent store writes', () => {
  it('merges stale snapshots without deleting entities created by another request', async () => {
    const stamp = Date.now()
    const firstId = `app_concurrency_first_${stamp}`
    const secondId = `app_concurrency_second_${stamp}`
    const firstSnapshot = await readStore()
    const secondSnapshot = await readStore()
    const ownerId = firstSnapshot.users[0].id
    const application = (id, name) => ({
      id,
      ownerId,
      teamId: null,
      professor: { english: 'Concurrency Professor', chinese: '', email: '', phone: '', social: '', homepage: '', research: '', lab: '' },
      school: { name, country: 'UK', website: '' },
      program: 'Concurrency Safety',
      deadline: '2027-01-01',
      status: 'Draft',
      progress: 0,
      priority: 50,
      tags: [],
      materials: [],
      communications: [],
      scholarships: [],
      tasks: [],
      timeline: [],
      versions: [],
      shares: [],
      createdAt: new Date(stamp).toISOString(),
      updatedAt: new Date(stamp).toISOString(),
    })

    try {
      firstSnapshot.applications.push(application(firstId, 'First Concurrent University'))
      await lockedWriteStore(firstSnapshot)

      secondSnapshot.applications.push(application(secondId, 'Second Concurrent University'))
      await lockedWriteStore(secondSnapshot)

      const persisted = await readStore()
      expect(persisted.applications.some((item) => item.id === firstId)).toBe(true)
      expect(persisted.applications.some((item) => item.id === secondId)).toBe(true)
    } finally {
      const cleanup = await readStore()
      cleanup.applications = cleanup.applications.filter((item) => item.id !== firstId && item.id !== secondId)
      await lockedWriteStore(cleanup)
    }
  })

  it('keeps cached store team metadata current after direct team mutations', async () => {
    const initialStore = await readStore({ cache: true })
    const ownerId = initialStore.users[0].id
    const team = await createTeam(ownerId, `Cache Test Team ${Date.now()}`)
    const updatedName = `${team.name} renamed`
    let deleted = false

    try {
      const cachedAfterCreate = await readStore({ cache: true })
      expect(cachedAfterCreate.teams.some((item) => item.id === team.id)).toBe(true)

      await renameTeam(team.id, updatedName)
      const cachedAfterRename = await readStore({ cache: true })
      expect(cachedAfterRename.teams.find((item) => item.id === team.id)?.name).toBe(updatedName)

      await deleteTeam(team.id)
      deleted = true
      const cachedAfterDelete = await readStore({ cache: true })
      expect(cachedAfterDelete.teams.some((item) => item.id === team.id)).toBe(false)
    } finally {
      if (!deleted) await deleteTeam(team.id)
    }
  })
})

describe.sequential('push subscription storage', () => {
  it('stores one browser endpoint and safely reassigns it to the latest signed-in account', async () => {
    const stamp = Date.now()
    const endpoint = `https://push.example.test/subscriptions/${stamp}`
    const store = await readStore()
    const [firstUser, secondUser] = store.users
    const firstSubscription = {
      endpoint,
      keys: { p256dh: `key-${stamp}`, auth: `auth-${stamp}` },
    }

    try {
      await upsertPushSubscription(firstUser.id, firstSubscription)
      expect((await listPushSubscriptions(firstUser.id)).filter((item) => item.endpoint === endpoint)).toEqual([
        expect.objectContaining(firstSubscription),
      ])

      await upsertPushSubscription(secondUser.id, {
        endpoint,
        keys: { p256dh: `key-next-${stamp}`, auth: `auth-next-${stamp}` },
      })

      expect((await listPushSubscriptions(firstUser.id)).filter((item) => item.endpoint === endpoint)).toEqual([])
      expect((await listPushSubscriptions(secondUser.id)).filter((item) => item.endpoint === endpoint)).toEqual([
        expect.objectContaining({
          endpoint,
          keys: { p256dh: `key-next-${stamp}`, auth: `auth-next-${stamp}` },
        }),
      ])
    } finally {
      await deletePushSubscription(firstUser.id, endpoint)
      await deletePushSubscription(secondUser.id, endpoint)
    }
  })
})
