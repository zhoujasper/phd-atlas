import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
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
  retryMailSyncJob,
  enqueueSystemMailJob,
  claimNextSystemMailJob,
  finishSystemMailJob,
  getSystemMailJob,
  retrySystemMailJob,
  deleteSystemMailJob,
  getMailFetchState,
  insertNotificationIfNew,
  listPendingNotificationPushes,
  markNotificationsPushEnqueued,
  archiveNotification,
  listPushSubscriptions,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  listBackups,
  lockedWriteStore,
  normalizeSystemLogRetentionDays,
  pruneApplicationBackups,
  readSchoolLogoAsset,
  readStore,
  resetMailFetchState,
  withWriteLock,
  renameTeam,
  upsertPushSubscription,
  writeStore,
} from './storage.js'
import { schoolLogoWebsiteCacheKey } from './schoolLogoCacheKey.js'

const createdFiles = []

describe('system log retention settings', () => {
  it('uses null for unlimited retention and bounds finite cleanup windows', () => {
    expect(normalizeSystemLogRetentionDays(null)).toBeNull()
    expect(normalizeSystemLogRetentionDays(0)).toBeNull()
    expect(normalizeSystemLogRetentionDays(90)).toBe(90)
    expect(normalizeSystemLogRetentionDays(99_999)).toBe(3650)
  })
})

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
      expect(claimed).toMatchObject({
        id: first.job.id,
        userId,
        status: 'running',
        attemptCount: 1,
      })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({ id: first.job.id, status: 'running' })

      const nextAttemptAt = new Date(Date.now() + 60_000).toISOString()
      await retryMailSyncJob(first.job.id, {
        nextAttemptAt,
        errorCode: 'CONNECTION_FAILED',
        errorMessage: 'Temporary network failure',
      })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({
        id: first.job.id,
        status: 'queued',
        attemptCount: 1,
        nextAttemptAt,
        errorCode: 'CONNECTION_FAILED',
      })
      await expect(claimNextMailSyncJob(first.job.id)).resolves.toBeNull()

      const expedited = await enqueueMailSyncJob(userId, 'history')
      expect(expedited).toMatchObject({
        alreadyQueued: true,
        job: { id: first.job.id, nextAttemptAt: null },
      })
      const reclaimed = await claimNextMailSyncJob(first.job.id)
      expect(reclaimed).toMatchObject({ status: 'running', attemptCount: 2 })

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

describe('durable system mail outbox', () => {
  it('deduplicates, reclaims, retries, expires, and completes sealed system email jobs', async () => {
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const dedupeKey = `storage-system-mail:${stamp}`
    const first = await enqueueSystemMailJob({
      dedupeKey,
      kind: 'verification',
      to: `mail-${stamp}@example.com`,
      subject: 'Verification',
      text: 'Secret one-time code: 123456',
      scope: 'Storage test',
      metadata: { codeKind: 'test' },
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    const duplicate = await enqueueSystemMailJob({
      dedupeKey,
      kind: 'verification',
      to: `mail-${stamp}@example.com`,
      subject: 'A duplicate must not replace the original',
      text: 'replacement',
      scope: 'Storage test',
    })

    try {
      expect(first.alreadyQueued).toBe(false)
      expect(first.job).toMatchObject({
        status: 'queued',
        payload: {
          subject: 'Verification',
          text: 'Secret one-time code: 123456',
          metadata: { codeKind: 'test' },
        },
      })
      expect(first.job.messageId).toMatch(/^<phd-atlas\.system\.[a-f0-9]{40}@mail\.local>$/)
      expect(duplicate).toMatchObject({
        alreadyQueued: true,
        job: {
          id: first.job.id,
          messageId: first.job.messageId,
          payload: { subject: 'Verification' },
        },
      })

      const claimedAt = new Date().toISOString()
      const claimed = await claimNextSystemMailJob(first.job.id, { at: claimedAt })
      expect(claimed).toMatchObject({ status: 'sending', attemptCount: 1 })

      const staleAt = new Date(Date.parse(claimedAt) + 3 * 60_000).toISOString()
      const reclaimed = await claimNextSystemMailJob(first.job.id, { at: staleAt })
      expect(reclaimed).toMatchObject({ status: 'sending', attemptCount: 2 })

      const nextAttemptAt = new Date(Date.parse(staleAt) + 60_000).toISOString()
      const retry = await retrySystemMailJob(first.job.id, {
        at: staleAt,
        nextAttemptAt,
        errorCode: 'TEMPORARY_FAILURE',
        errorMessage: 'Retry later',
      })
      expect(retry).toMatchObject({
        status: 'queued',
        attemptCount: 2,
        nextAttemptAt,
        lastErrorCode: 'TEMPORARY_FAILURE',
      })
      await expect(
        claimNextSystemMailJob(first.job.id, { at: staleAt }),
      ).resolves.toBeNull()

      const finalClaim = await claimNextSystemMailJob(first.job.id, {
        at: new Date(Date.parse(nextAttemptAt) + 1_000).toISOString(),
      })
      expect(finalClaim).toMatchObject({ status: 'sending', attemptCount: 3 })
      const sent = await finishSystemMailJob(first.job.id, {
        messageId: first.job.messageId,
      })
      expect(sent).toMatchObject({
        status: 'sent',
        attemptCount: 3,
        lastErrorCode: null,
      })
    } finally {
      await deleteSystemMailJob(first.job.id)
    }

    const expired = await enqueueSystemMailJob({
      dedupeKey: `${dedupeKey}:expired`,
      kind: 'verification',
      to: `mail-${stamp}@example.com`,
      subject: 'Expired',
      text: 'expired',
      scope: 'Storage test',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    try {
      await expect(claimNextSystemMailJob(expired.job.id)).resolves.toBeNull()
      await expect(getSystemMailJob(expired.job.id)).resolves.toMatchObject({
        status: 'expired',
        lastErrorCode: 'EXPIRED',
      })
    } finally {
      await deleteSystemMailJob(expired.job.id)
    }
  })
})

describe('durable notification push handoff', () => {
  it('keeps a notification pending until the encrypted push journal accepts it', async () => {
    const store = await readStore()
    const user = store.users[0]
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const created = await insertNotificationIfNew(user.id, {
      type: 'test_push_handoff',
      applicationId: null,
      title: 'Push handoff',
      body: 'Durable notification',
      dedupeKey: `push-handoff-${stamp}`,
      triggerDate: '2026-07-29',
    })
    expect(created).toBeTruthy()

    try {
      expect((await listPendingNotificationPushes({ limit: 500 }))
        .some((notification) => notification.id === created.id)).toBe(true)
      await markNotificationsPushEnqueued([created.id])
      expect((await listPendingNotificationPushes({ limit: 500 }))
        .some((notification) => notification.id === created.id)).toBe(false)
    } finally {
      await archiveNotification(user.id, created.id)
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

  it('detects external changes with a frozen directory timestamp and coalesces the scan', async () => {
    await listBackups()
    const frozenDirectoryStat = await fs.stat(backupRoot)
    const stamp = Date.now()
    const fileName = `phd-atlas-backup-vitest-coalesced-${stamp}.json`
    await writeTestBackup(fileName, {
      kind: 'workspace',
      actorId: `user_coalesced_${stamp}`,
      createdAt: new Date(stamp).toISOString(),
    })

    const originalReaddir = fs.readdir.bind(fs)
    const originalStat = fs.stat.bind(fs)
    const backupRootPath = path.resolve(backupRoot)
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return originalReaddir(...args)
    })
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (filePath, ...args) => {
      if (path.resolve(String(filePath)) === backupRootPath) {
        return frozenDirectoryStat
      }
      return originalStat(filePath, ...args)
    })
    try {
      const [first, second] = await Promise.all([listBackups(), listBackups()])
      expect(first.some((backup) => backup.fileName === fileName)).toBe(true)
      expect(second.some((backup) => backup.fileName === fileName)).toBe(true)
      expect(readdirSpy).toHaveBeenCalledTimes(1)
    } finally {
      statSpy.mockRestore()
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

describe.sequential('shared school logo storage', () => {
  it('hydrates the same cached website logo across applications owned by different users', async () => {
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const firstId = `app_logo_cache_first_${stamp}`
    const secondId = `app_logo_cache_second_${stamp}`
    const websiteUrl = 'https://www.cam.ac.uk/'
    const cacheKey = schoolLogoWebsiteCacheKey(websiteUrl)
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

    try {
      const store = await readStore()
      const source = store.applications[0]
      const owners = store.users.filter((user) => user.role !== 'admin')
      const makeApplication = (id, ownerId) => ({
        ...JSON.parse(JSON.stringify(source)),
        id,
        ownerId,
        teamId: null,
        school: {
          ...source.school,
          name: 'University of Cambridge',
          website: websiteUrl,
          logo: {
            dataUrl,
            source: 'website',
            sourceUrl: 'https://www.cam.ac.uk/themes/custom/fresh/images/interface/cambridge_university2.svg',
            websiteUrl,
            cacheKey,
            candidateKind: 'page-logo',
            updatedAt: new Date().toISOString(),
          },
        },
      })
      store.applications.push(
        makeApplication(firstId, owners[0].id),
        makeApplication(secondId, (owners[1] ?? owners[0]).id),
      )
      await lockedWriteStore(store)

      const assetKey = createHash('sha256').update(dataUrl).digest('hex')
      const [persisted, asset] = await Promise.all([
        readStore(),
        readSchoolLogoAsset(assetKey),
      ])
      expect(asset).toMatchObject({
        asset_key: assetKey,
        data_url: dataUrl,
      })
      expect(persisted.applications.find((application) => application.id === firstId)?.school.logo?.dataUrl)
        .toBe(dataUrl)
      expect(persisted.applications.find((application) => application.id === secondId)?.school.logo?.dataUrl)
        .toBe(dataUrl)
    } finally {
      const cleanup = await readStore()
      cleanup.applications = cleanup.applications.filter(
        (application) => application.id !== firstId && application.id !== secondId,
      )
      await lockedWriteStore(cleanup)
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

  it('bounds forged endpoint fan-out while retaining the newest browser subscription', async () => {
    const store = await readStore()
    const user = store.users[0]
    const prefix = `https://push.example.test/bounded/${Date.now()}`
    const endpoints = Array.from(
      { length: MAX_PUSH_SUBSCRIPTIONS_PER_USER + 3 },
      (_value, index) => `${prefix}/${String(index).padStart(2, '0')}`,
    )
    try {
      for (const [index, endpoint] of endpoints.entries()) {
        await upsertPushSubscription(user.id, {
          endpoint,
          keys: { p256dh: `bounded-key-${index}`, auth: `bounded-auth-${index}` },
        })
      }
      const retained = await listPushSubscriptions(user.id)
      const bounded = retained.filter((subscription) => subscription.endpoint.startsWith(prefix))
      expect(retained.length).toBeLessThanOrEqual(MAX_PUSH_SUBSCRIPTIONS_PER_USER)
      expect(bounded.some((subscription) => subscription.endpoint === endpoints.at(-1))).toBe(true)
    } finally {
      await Promise.all(endpoints.map((endpoint) => deletePushSubscription(user.id, endpoint)))
    }
  })
})
