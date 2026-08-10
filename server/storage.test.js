import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  backupIndexDiagnostics,
  backupRoot,
  configureBackupRestoreMemoryAdmission,
  createBackup,
  createTeam,
  deletePushSubscription,
  deleteBackup,
  deleteTeam,
  enqueueMailSyncJob,
  enqueueMailSyncJobs,
  claimNextMailSyncJob,
  finishMailSyncJob,
  retryMailSyncJob,
  saveMailSyncJobContinuation,
  saveMailFetchState,
  enqueueSystemMailJob,
  claimNextSystemMailJob,
  markSystemMailJobDispatching,
  finishSystemMailJob,
  findUserApplication,
  getSystemMailJob,
  getBackupInfo,
  retrySystemMailJob,
  deleteSystemMailJob,
  getMailFetchState,
  insertNotificationIfNew,
  listPendingNotificationPushes,
  listAutoMailSyncUserIds,
  markNotificationsPushEnqueued,
  archiveNotification,
  listPushSubscriptions,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  listBackups,
  lockedWriteStore,
  normalizeSystemLogRetentionDays,
  pruneApplicationBackups,
  readSchoolLogoAsset,
  readMailSyncStore,
  readMailSyncUser,
  readWorkspaceQuotaUsage,
  readStore,
  recoverWorkspaceBackupLifecycleAtStartup,
  restoreApplicationBackup,
  resetMailFetchState,
  takeBackupRestoreMemoryLease,
  withWriteLock,
  renameTeam,
  teamApplicationVisibilityKey,
  upsertPushSubscription,
  writeStore,
  configureStoreHydrationMemoryAdmission,
  takeStoreMemoryLease,
  decodePayloadFromStorage,
  encodePayloadForStorage,
  encodePayloadForStorageAsync,
} from './storage.js'
import { schoolLogoWebsiteCacheKey } from './schoolLogoCacheKey.js'
import { payloadWorkerPool } from './payloadWorkerPool.mjs'

const createdFiles = []

function makeConcurrencyApplication(id, ownerId, name, stamp = Date.now()) {
  return {
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
    fees: [],
    tasks: [],
    timeline: [],
    versions: [],
    shares: [],
    createdAt: new Date(stamp).toISOString(),
    updatedAt: new Date(stamp).toISOString(),
  }
}

describe('system log retention settings', () => {
  it('uses null for unlimited retention and bounds finite cleanup windows', () => {
    expect(normalizeSystemLogRetentionDays(null)).toBeNull()
    expect(normalizeSystemLogRetentionDays(0)).toBeNull()
    expect(normalizeSystemLogRetentionDays(90)).toBe(90)
    expect(normalizeSystemLogRetentionDays(99_999)).toBe(3650)
  })
})

describe('team application visibility keys', () => {
  it('binds delegated student access to the specific Team', () => {
    const applications = [
      { id: 'app_team_a', ownerId: 'student_shared', teamId: 'team_a' },
      { id: 'app_team_b', ownerId: 'student_shared', teamId: 'team_b' },
    ]
    const visibilityKeys = new Set([
      teamApplicationVisibilityKey('team_a', 'student_shared'),
    ])

    expect(findUserApplication(
      { applications },
      { id: 'teacher_a' },
      'app_team_a',
      visibilityKeys,
    )).toBe(applications[0])
    expect(findUserApplication(
      { applications },
      { id: 'teacher_a' },
      'app_team_b',
      visibilityKeys,
    )).toBeUndefined()
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

async function writeIndexedTestBackup(fileName, backup) {
  const target = await writeTestBackup(fileName, backup)
  const stat = await fs.stat(target)
  await fs.writeFile(
    `${target}.meta`,
    JSON.stringify({
      sourceSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      metadata: backup,
      applicationName: backup.applicationName ?? null,
    }),
    'utf8',
  )
  return target
}

afterEach(async () => {
  const pending = createdFiles.splice(0)
  for (let offset = 0; offset < pending.length; offset += 32) {
    await Promise.all(pending.slice(offset, offset + 32).flatMap((fileName) => [
      fs.rm(path.join(backupRoot, fileName), { force: true }),
      fs.rm(path.join(backupRoot, `${fileName}.meta`), { force: true }),
    ]))
  }
})

async function withMailSyncTestUser(label, test) {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const userId = `user_mail_sync_${label}_${stamp}`
  await withWriteLock(async () => {
    const store = await readStore()
    const sourceUser = store.users[0]
    store.users.push({
      ...JSON.parse(JSON.stringify(sourceUser)),
      id: userId,
      email: `mail-sync-${label}-${stamp}@example.com`,
      settings: {
        incomingProtocol: 'imap',
        autoFetchMail: false,
      },
    })
    await writeStore(store)
  })

  try {
    return await test(userId)
  } finally {
    await withWriteLock(async () => {
      await resetMailFetchState(userId)
      const latest = await readStore()
      latest.users = latest.users.filter((user) => user.id !== userId)
      latest.applications = latest.applications.filter((application) => application.ownerId !== userId)
      latest.profileAssets = latest.profileAssets.filter((asset) => asset.ownerId !== userId)
      await writeStore(latest)
    })
  }
}

function mailSyncContinuation(lastUid, mode = 'history') {
  return {
    accountKey: 'imap.example.com:993:user@example.com',
    mode,
    mailSyncGeneration: '2026-08-02T12:00:00.000Z',
    whitelistDigest: 'whitelist-digest',
    folderStates: { INBOX: { uidValidity: '77', lastUid } },
    totals: { fetched: lastUid, filed: lastUid, incoming: lastUid },
  }
}

describe('durable mail sync jobs', () => {
  it('upgrades a queued incremental job to history without duplicating it', async () => {
    await withMailSyncTestUser('queued-upgrade', async (userId) => {
      const incremental = await enqueueMailSyncJob(userId, 'incremental')
      const upgraded = await enqueueMailSyncJob(userId, 'history')
      const duplicateHistory = await enqueueMailSyncJob(userId, 'history')

      expect(upgraded).toMatchObject({
        alreadyQueued: true,
        job: { id: incremental.job.id, mode: 'history', status: 'queued' },
      })
      expect(duplicateHistory).toMatchObject({
        alreadyQueued: true,
        job: { id: incremental.job.id, mode: 'history', status: 'queued' },
      })
      await expect(claimNextMailSyncJob(incremental.job.id)).resolves.toMatchObject({
        id: incremental.job.id,
        userId,
        mode: 'history',
        status: 'running',
      })
    })
  })

  it('persists one history successor while an incremental job is running', async () => {
    await withMailSyncTestUser('running-successor', async (userId) => {
      const incremental = await enqueueMailSyncJob(userId, 'incremental')
      await expect(claimNextMailSyncJob(incremental.job.id)).resolves.toMatchObject({
        id: incremental.job.id,
        mode: 'incremental',
        status: 'running',
      })
      await saveMailSyncJobContinuation(
        incremental.job.id,
        userId,
        mailSyncContinuation(4, 'incremental'),
      )

      const historyRequests = await Promise.all([
        enqueueMailSyncJob(userId, 'history'),
        enqueueMailSyncJob(userId, 'history'),
      ])
      const history = historyRequests.find((request) => !request.alreadyQueued)
      const duplicateHistory = historyRequests.find((request) => request.alreadyQueued)
      expect(history).toBeDefined()
      expect(duplicateHistory).toBeDefined()
      expect(history).toMatchObject({
        alreadyQueued: false,
        job: { mode: 'history', status: 'queued' },
      })
      expect(history.job.id).not.toBe(incremental.job.id)
      expect(duplicateHistory).toMatchObject({
        alreadyQueued: true,
        job: { id: history.job.id, mode: 'history', status: 'queued' },
      })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({
        id: incremental.job.id,
        mode: 'incremental',
        status: 'running',
      })

      await finishMailSyncJob(incremental.job.id, {
        status: 'succeeded',
        result: { mode: 'incremental', stateCommitted: true },
      })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({
        id: history.job.id,
        mode: 'history',
        status: 'queued',
        attemptCount: 0,
      })
      await expect(claimNextMailSyncJob(history.job.id)).resolves.toMatchObject({
        id: history.job.id,
        mode: 'history',
        status: 'running',
        attemptCount: 1,
        continuation: {},
      })
    })
  })

  it('persists a private continuation across retries so bounded claims make monotonic progress', async () => {
    await withMailSyncTestUser('durable-continuation', async (userId) => {
      const queued = await enqueueMailSyncJob(userId, 'history')
      const importedUids = []

      for (let expectedUid = 1; expectedUid <= 3; expectedUid += 1) {
        const claimed = await claimNextMailSyncJob(queued.job.id)
        expect(claimed).toMatchObject({
          id: queued.job.id,
          status: 'running',
          continuation: expectedUid === 1
            ? {}
            : { folderStates: { INBOX: { uidValidity: '77', lastUid: expectedUid - 1 } } },
        })
        importedUids.push(Number(claimed.continuation.folderStates?.INBOX?.lastUid ?? 0) + 1)

        if (expectedUid < 3) {
          await expect(saveMailSyncJobContinuation(
            'not-the-active-job', userId, mailSyncContinuation(expectedUid),
          )).resolves.toBeNull()
          await expect(saveMailSyncJobContinuation(
            queued.job.id, userId, mailSyncContinuation(expectedUid),
          )).resolves.toMatchObject({
            version: 1,
            folderStates: { INBOX: { uidValidity: '77', lastUid: expectedUid } },
            totals: { filed: expectedUid },
          })
          expect((await getMailFetchState(userId)).syncJob).not.toHaveProperty('continuation')
          await retryMailSyncJob(queued.job.id, {
            nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
            errorCode: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
            errorMessage: 'bounded slice complete',
          })
          await enqueueMailSyncJob(userId, 'history')
        } else {
          await finishMailSyncJob(queued.job.id, {
            status: 'succeeded',
            result: { filed: 3, stateCommitted: true },
          })
        }
      }

      expect(importedUids).toEqual([1, 2, 3])
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({
        id: queued.job.id,
        status: 'succeeded',
        attemptCount: 3,
      })
      const next = await enqueueMailSyncJob(userId, 'incremental')
      await expect(claimNextMailSyncJob(next.job.id)).resolves.toMatchObject({ continuation: {} })
    })
  })

  it('clears an incompatible incremental continuation when a queued job upgrades to history', async () => {
    await withMailSyncTestUser('continuation-upgrade', async (userId) => {
      const incremental = await enqueueMailSyncJob(userId, 'incremental')
      await claimNextMailSyncJob(incremental.job.id)
      await saveMailSyncJobContinuation(
        incremental.job.id, userId, mailSyncContinuation(8, 'incremental'),
      )
      await retryMailSyncJob(incremental.job.id, {
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        errorCode: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
        errorMessage: 'bounded slice complete',
      })

      await enqueueMailSyncJob(userId, 'history')
      await expect(claimNextMailSyncJob(incremental.job.id)).resolves.toMatchObject({
        mode: 'history',
        continuation: {},
      })
    })
  })

  it('round-trips __proto__ and worst-case escaped paths inside the bounded continuation', async () => {
    await withMailSyncTestUser('continuation-paths', async (userId) => {
      const queued = await enqueueMailSyncJob(userId, 'history')
      await claimNextMailSyncJob(queued.job.id)
      const folderStates = Object.create(null)
      folderStates.INBOX = { uidValidity: '80', lastUid: 1 }
      folderStates.__proto__ = { uidValidity: '81', lastUid: 2 }
      const escapedName = '\\"'.repeat(360)
      for (let index = 0; index < 254; index += 1) {
        folderStates[`Q${String(index).padStart(3, '0')}-${escapedName}`] = {
          uidValidity: String(100 + index),
          lastUid: index + 3,
        }
      }

      await expect(saveMailSyncJobContinuation(queued.job.id, userId, {
        ...mailSyncContinuation(1),
        folderStates,
      })).resolves.toMatchObject({ version: 1 })
      await retryMailSyncJob(queued.job.id, {
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        errorCode: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
        errorMessage: 'bounded slice complete',
      })
      const reclaimed = await claimNextMailSyncJob(queued.job.id)

      expect(Object.keys(reclaimed.continuation.folderStates)).toHaveLength(256)
      expect(Object.hasOwn(reclaimed.continuation.folderStates, '__proto__')).toBe(true)
      expect(reclaimed.continuation.folderStates.__proto__).toEqual({
        uidValidity: '81',
        lastUid: 2,
      })
    })
  })

  it('retains final-batch totals when recovery happens after state commit but before job finish', async () => {
    await withMailSyncTestUser('final-before-finish', async (userId) => {
      const queued = await enqueueMailSyncJob(userId, 'history')
      await claimNextMailSyncJob(queued.job.id)
      const finalContinuation = mailSyncContinuation(3)
      finalContinuation.totals = {
        ...finalContinuation.totals,
        duplicates: 1,
        scannedUids: 3,
      }
      await saveMailSyncJobContinuation(queued.job.id, userId, finalContinuation)
      await saveMailFetchState(userId, {
        protocol: 'imap',
        accountKey: finalContinuation.accountKey,
        folderStates: finalContinuation.folderStates,
        lastFetchedAt: '2026-08-02T12:00:00.000Z',
        lastHistorySyncAt: '2026-08-02T12:00:00.000Z',
        lastHistoryImported: 3,
      })

      // A startup recovery changes running back to queued without discarding
      // its private resume JSON. retryMailSyncJob exercises the same durable
      // transition without reinitializing the process-wide test database.
      await retryMailSyncJob(queued.job.id, {
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        errorCode: 'MAIL_SYNC_SHUTDOWN_DEFERRED',
        errorMessage: 'server restarted before finish',
      })
      const reclaimed = await claimNextMailSyncJob(queued.job.id)
      expect(reclaimed.continuation).toMatchObject({
        folderStates: { INBOX: { uidValidity: '77', lastUid: 3 } },
        totals: { filed: 3, incoming: 3, duplicates: 1, scannedUids: 3 },
      })

      await finishMailSyncJob(queued.job.id, {
        status: 'succeeded',
        result: { filed: reclaimed.continuation.totals.filed, stateCommitted: true },
      })
      expect(await getMailFetchState(userId)).toMatchObject({
        lastHistoryImported: 3,
        syncJob: {
          id: queued.job.id,
          status: 'succeeded',
          result: { filed: 3, stateCommitted: true },
        },
      })
    })
  })

  it('moves a retry to the FIFO tail once without starving it behind later fresh jobs', async () => {
    await withMailSyncTestUser('fairness-first', async (firstUserId) => {
      await withMailSyncTestUser('fairness-tail', async (tailUserId) => {
        await withMailSyncTestUser('fairness-fresh', async (freshUserId) => {
          const first = await enqueueMailSyncJob(firstUserId, 'incremental')
          const tail = await enqueueMailSyncJob(tailUserId, 'incremental')
          await expect(claimNextMailSyncJob(first.job.id)).resolves.toMatchObject({
            id: first.job.id,
            attemptCount: 1,
          })
          await retryMailSyncJob(first.job.id, {
            nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
            errorCode: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
            errorMessage: 'bounded slice complete',
          })
          const fresh = await enqueueMailSyncJob(freshUserId, 'incremental')

          const claimedTail = await claimNextMailSyncJob()
          expect(claimedTail).toMatchObject({
            id: tail.job.id,
            userId: tailUserId,
            attemptCount: 1,
          })
          await finishMailSyncJob(claimedTail.id, { status: 'succeeded' })

          // A fresh attempt-0 job arrived after the retry. Durable FIFO order
          // still gives the older retried slice its bounded next turn.
          await expect(claimNextMailSyncJob()).resolves.toMatchObject({
            id: first.job.id,
            userId: firstUserId,
            attemptCount: 2,
          })
          await expect(claimNextMailSyncJob(fresh.job.id)).resolves.toMatchObject({
            id: fresh.job.id,
            userId: freshUserId,
            attemptCount: 1,
          })
        })
      })
    })
  })

  it('keeps automatic scheduler ticks from waking a queued retry before its backoff', async () => {
    await withMailSyncTestUser('auto-backoff', async (userId) => {
      const queued = await enqueueMailSyncJob(userId, 'incremental')
      await claimNextMailSyncJob(queued.job.id)
      const nextAttemptAt = new Date(Date.now() + 60_000).toISOString()
      await retryMailSyncJob(queued.job.id, {
        nextAttemptAt,
        errorCode: 'CONNECTION_FAILED',
        errorMessage: 'temporary outage',
      })

      await enqueueMailSyncJobs([userId], 'incremental', { preserveRetryDelay: true })
      expect((await getMailFetchState(userId)).syncJob).toMatchObject({
        id: queued.job.id,
        status: 'queued',
        nextAttemptAt,
        errorCode: 'CONNECTION_FAILED',
      })
      await expect(claimNextMailSyncJob(queued.job.id)).resolves.toBeNull()

      // A deliberate user action still expedites the same durable work.
      await enqueueMailSyncJob(userId, 'incremental')
      await expect(claimNextMailSyncJob(queued.job.id)).resolves.toMatchObject({
        id: queued.job.id,
        attemptCount: 2,
      })
    })
  })

  it('commits business data and its continuation atomically and rolls both back on invalid input', async () => {
    await withMailSyncTestUser('atomic-checkpoint', async (userId) => {
      const queued = await enqueueMailSyncJob(userId, 'history')
      await claimNextMailSyncJob(queued.job.id)
      const continuation = mailSyncContinuation(17)
      const marker = `atomic-${Date.now()}`

      await withWriteLock(async () => {
        const store = await readMailSyncStore(userId)
        const release = takeStoreMemoryLease(store)
        try {
          store.users[0].settings.atomicMailCheckpoint = marker
          await writeStore(store, {
            mailSyncContinuation: { jobId: queued.job.id, userId, value: continuation },
          })
        } finally {
          release?.()
        }
      })
      expect((await readMailSyncStore(userId)).users[0].settings.atomicMailCheckpoint).toBe(marker)
      await retryMailSyncJob(queued.job.id, {
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        errorCode: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
        errorMessage: 'simulate worker restart',
      })
      await expect(claimNextMailSyncJob(queued.job.id)).resolves.toMatchObject({
        continuation: { folderStates: continuation.folderStates, totals: continuation.totals },
      })

      await expect(withWriteLock(async () => {
        const store = await readMailSyncStore(userId)
        const release = takeStoreMemoryLease(store)
        try {
          store.users[0].settings.atomicMailCheckpoint = 'must-roll-back'
          await writeStore(store, {
            mailSyncContinuation: { jobId: queued.job.id, userId, value: {} },
          })
        } finally {
          release?.()
        }
      })).rejects.toBeInstanceOf(TypeError)
      expect((await readMailSyncStore(userId)).users[0].settings.atomicMailCheckpoint).toBe(marker)
    })
  })

  it('hydrates only the mailbox owner and owner applications in a large multi-tenant store', async () => {
    await withMailSyncTestUser('scoped-loader', async (userId) => {
      const unrelatedId = `app_unrelated_mail_scope_${Date.now()}`
      const ownedId = `app_owned_mail_scope_${Date.now()}`
      const reservationBytes = []
      try {
        await withWriteLock(async () => {
          const store = await readStore()
          const unrelatedOwner = store.users.find((user) => user.id !== userId)
          store.applications.push(
            {
              ...makeConcurrencyApplication(unrelatedId, unrelatedOwner.id, 'Unrelated large tenant'),
              programNotes: 'x'.repeat(4 * 1024 * 1024),
            },
            makeConcurrencyApplication(ownedId, userId, 'Owned mail application'),
          )
          await writeStore(store)
        })
        const rejectedBeforeHydration = new Error('mail scope memory threshold')
        configureStoreHydrationMemoryAdmission(() => {
          throw rejectedBeforeHydration
        })
        await expect(readMailSyncStore(userId)).rejects.toBe(rejectedBeforeHydration)
        configureStoreHydrationMemoryAdmission((bytes) => {
          reservationBytes.push(bytes)
          return () => {}
        })
        const scoped = await readMailSyncStore(userId)
        const release = takeStoreMemoryLease(scoped)
        expect(scoped.users.map((user) => user.id)).toEqual([userId])
        expect(scoped.applications.map((application) => application.id)).toEqual([ownedId])
        expect(scoped.profileAssets).toEqual([])
        expect(scoped.teams).toEqual([])
        expect(reservationBytes.at(-1)).toBeLessThan(96 * 1024 * 1024)
        release?.()
      } finally {
        configureStoreHydrationMemoryAdmission(null)
        await withWriteLock(async () => {
          const store = await readStore()
          store.applications = store.applications.filter((application) => (
            application.id !== unrelatedId && application.id !== ownedId
          ))
          await writeStore(store)
        })
      }
    })
  })

  it('revalidates only compact mailbox fields even when account settings are large', async () => {
    await withMailSyncTestUser('compact-user', async (userId) => {
      await withWriteLock(async () => {
        const store = await readStore()
        const user = store.users.find((candidate) => candidate.id === userId)
        user.settings = {
          ...user.settings,
          incomingProtocol: 'imap',
          incomingHost: 'imap.compact.example',
          incomingPort: 1993,
          incomingUser: 'compact@example.com',
          incomingPass: 'compact-secret',
          incomingTls: false,
          autoFetchMail: true,
          autoFetchMailEnabledAt: '2026-08-02T18:00:00.000Z',
          applicationTrash: [{
            id: 'large-trash-settings',
            application: {
              ...makeConcurrencyApplication('large-trash-app', userId, 'Large trash'),
              programNotes: 'x'.repeat(2 * 1024 * 1024),
            },
          }],
        }
        await writeStore(store)
      })

      configureStoreHydrationMemoryAdmission(() => {
        throw new Error('compact mailbox projection must not hydrate the settings document')
      })
      try {
        await expect(readMailSyncUser(userId)).resolves.toMatchObject({
          id: userId,
          disabledAt: null,
          settings: {
            incomingProtocol: 'imap',
            incomingHost: 'imap.compact.example',
            incomingPort: 1993,
            incomingUser: 'compact@example.com',
            incomingPass: 'compact-secret',
            incomingTls: false,
            autoFetchMailEnabledAt: '2026-08-02T18:00:00.000Z',
          },
        })
        expect((await readMailSyncUser(userId)).settings.applicationTrash).toBeUndefined()
        await expect(listAutoMailSyncUserIds()).resolves.toContain(userId)
      } finally {
        configureStoreHydrationMemoryAdmission(null)
      }
    })
  })

  it('keeps indexed personal and Team quota totals equal to canonical JSON and deduped uploads', async () => {
    await withMailSyncTestUser('quota-index', async (userId) => {
      const team = await createTeam(userId, `Quota index ${Date.now()}`)
      const stamp = Date.now()
      const personalApplication = makeConcurrencyApplication(
        `quota-personal-${stamp}`,
        userId,
        'Personal quota',
        stamp,
      )
      personalApplication.communications = [{
        id: `comm-personal-${stamp}`,
        attachments: [{
          storageName: `quota-personal-shared-${stamp}.bin`,
          fileSize: 101,
          source: 'upload',
        }],
      }]
      const personalTrashApplication = makeConcurrencyApplication(
        `quota-personal-trash-${stamp}`,
        userId,
        'Personal trash quota',
        stamp,
      )
      personalTrashApplication.communications = [{
        id: `comm-personal-trash-${stamp}`,
        attachments: [{
          storageName: `quota-personal-shared-${stamp}.bin`,
          fileSize: 101,
          source: 'upload',
        }],
      }]
      const personalTrashItem = {
        id: `trash-personal-${stamp}`,
        deletedAt: '2026-08-02T18:00:00.000Z',
        expiresAt: '2026-09-01T18:00:00.000Z',
        application: personalTrashApplication,
      }
      const profileAsset = {
        id: `quota-profile-${stamp}`,
        ownerId: userId,
        teamId: null,
        name: 'Personally billed profile',
        kind: 'document',
        updatedAt: '2026-08-02T18:00:00.000Z',
        attachments: [
          {
            storageName: `quota-personal-shared-${stamp}.bin`,
            fileSize: 101,
            source: 'upload',
          },
          {
            storageName: `quota-profile-only-${stamp}.bin`,
            fileSize: 53,
            source: 'upload',
          },
        ],
      }
      const teamApplication = {
        ...makeConcurrencyApplication(`quota-team-${stamp}`, userId, 'Team quota', stamp),
        teamId: team.id,
      }
      teamApplication.communications = [{
        id: `comm-team-${stamp}`,
        attachments: [{
          storageName: `quota-team-shared-${stamp}.bin`,
          fileSize: 211,
          source: 'upload',
        }],
      }]
      const teamTrashApplication = {
        ...makeConcurrencyApplication(`quota-team-trash-${stamp}`, userId, 'Team trash quota', stamp),
        teamId: team.id,
        communications: [{
          id: `comm-team-trash-${stamp}`,
          attachments: [{
            storageName: `quota-team-shared-${stamp}.bin`,
            fileSize: 211,
            source: 'upload',
          }],
        }],
      }
      const teamTrashItem = {
        id: `trash-team-${stamp}`,
        deletedAt: '2026-08-02T18:00:00.000Z',
        expiresAt: '2026-09-01T18:00:00.000Z',
        application: teamTrashApplication,
      }

      try {
        const before = await readWorkspaceQuotaUsage(userId, [team.id])
        await withWriteLock(async () => {
          const store = await readStore()
          const user = store.users.find((candidate) => candidate.id === userId)
          user.settings.applicationTrash = [personalTrashItem, teamTrashItem]
          store.applications.push(personalApplication, teamApplication)
          store.profileAssets.push(profileAsset)
          await writeStore(store)
        })
        const after = await readWorkspaceQuotaUsage(userId, [team.id])
        const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')
        expect(after.personalBytes - before.personalBytes).toBe(
          jsonBytes(personalApplication)
          + jsonBytes(personalTrashItem)
          + jsonBytes(profileAsset)
          + 101
          + 53,
        )
        expect(after.teamBytes[team.id] - before.teamBytes[team.id]).toBe(
          jsonBytes(teamApplication)
          + jsonBytes(teamTrashApplication)
          + 211,
        )
      } finally {
        await deleteTeam(team.id)
      }
    })
  })

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
      const prematureFinish = await finishSystemMailJob(first.job.id, {
        messageId: first.job.messageId,
      })
      expect(prematureFinish).toMatchObject({
        status: 'sending',
        dispatchStartedAt: null,
        lastErrorCode: 'TEMPORARY_FAILURE',
      })
      const dispatching = await markSystemMailJobDispatching(first.job.id)
      expect(dispatching).toMatchObject({
        status: 'sending',
        dispatchStartedAt: expect.any(String),
        lastErrorCode: 'SMTP_OUTCOME_UNKNOWN',
      })
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
  it('restores one actor-owned application through the focused durable row path', async () => {
    const stamp = Date.now()
    const applicationId = `app_focused_restore_${stamp}`
    const setup = await readStore()
    const actorId = setup.users[0].id
    const source = makeConcurrencyApplication(
      applicationId,
      actorId,
      'Focused Restore University',
      stamp,
    )
    source.program = 'Backed-up programme'
    setup.applications.push(source)
    await lockedWriteStore(setup)

    const backup = await createBackup(setup, actorId, source, 5, { prune: false })
    createdFiles.push(backup.fileName)
    const acquired = []
    let releases = 0
    configureBackupRestoreMemoryAdmission((bytes) => {
      acquired.push(bytes)
      return () => { releases += 1 }
    })

    try {
      const changed = await readStore()
      const current = changed.applications.find((application) => application.id === applicationId)
      current.program = 'Newer programme to replace'
      current.updatedAt = new Date(stamp + 1000).toISOString()
      await lockedWriteStore(changed)

      await expect(restoreApplicationBackup(backup.fileName, {
        actorId: `${actorId}_other`,
      })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })

      const restored = await restoreApplicationBackup(backup.fileName, { actorId })
      expect(restored.application).toMatchObject({
        id: applicationId,
        ownerId: actorId,
        program: 'Backed-up programme',
      })
      expect(acquired).toHaveLength(1)
      expect(acquired[0]).toBeGreaterThanOrEqual(32 * 1024 * 1024)
      expect(releases).toBe(0)
      takeBackupRestoreMemoryLease(restored)?.()
      expect(releases).toBe(1)

      const persisted = (await readStore()).applications.find(
        (application) => application.id === applicationId,
      )
      expect(persisted).toMatchObject({
        ownerId: actorId,
        program: 'Backed-up programme',
      })
    } finally {
      configureBackupRestoreMemoryAdmission(null)
      const cleanup = await readStore()
      cleanup.applications = cleanup.applications.filter(
        (application) => application.id !== applicationId,
      )
      await lockedWriteStore(cleanup)
    }
  })

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

  it('promotes an acknowledged backup stage after a crash before the final rename', async () => {
    const snapshot = await readStore()
    const actorId = snapshot.users[0].id
    const application = snapshot.applications[0]
    const originalRename = fs.rename.bind(fs)
    let stagedPath = null
    let finalPath = null
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (
        path.basename(String(source)).startsWith('.backup-stage-v1-')
        && String(target).endsWith('.json')
      ) {
        stagedPath = String(source)
        finalPath = String(target)
        throw Object.assign(new Error('simulated process exit before publish'), { code: 'EACCES' })
      }
      return originalRename(source, target)
    })

    try {
      await expect(createBackup(snapshot, actorId, application, 10, { prune: false }))
        .rejects.toMatchObject({ code: 'EACCES', preserveBackupStage: true })
    } finally {
      renameSpy.mockRestore()
    }
    expect(stagedPath).toBeTruthy()
    expect(finalPath).toBeTruthy()
    await expect(fs.access(stagedPath)).resolves.toBeUndefined()
    await expect(fs.access(finalPath)).rejects.toThrow()

    await recoverWorkspaceBackupLifecycleAtStartup()
    await expect(fs.access(finalPath)).resolves.toBeUndefined()
    await expect(fs.access(stagedPath)).rejects.toThrow()
    const fileName = path.basename(finalPath)
    await expect(getBackupInfo(fileName)).resolves.toMatchObject({ fileName, actorId })
    await deleteBackup(fileName)
  })

  it('finishes a durable backup deletion after a crash before physical unlink', async () => {
    const snapshot = await readStore()
    const actorId = snapshot.users[0].id
    const application = snapshot.applications[0]
    const backup = await createBackup(snapshot, actorId, application, 10, { prune: false })
    const originalRm = fs.rm.bind(fs)
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (path.resolve(String(target)) === path.resolve(backup.path)) {
        throw Object.assign(new Error('simulated process exit before unlink'), { code: 'EIO' })
      }
      return originalRm(target, options)
    })
    try {
      await expect(deleteBackup(backup.fileName)).rejects.toMatchObject({ code: 'EIO' })
    } finally {
      rmSpy.mockRestore()
    }
    await expect(fs.access(backup.path)).resolves.toBeUndefined()

    await recoverWorkspaceBackupLifecycleAtStartup()
    await expect(fs.access(backup.path)).rejects.toThrow()
    expect((await listBackups({ actorId }))
      .some((candidate) => candidate.fileName === backup.fileName)).toBe(false)
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

    const originalOpendir = fs.opendir.bind(fs)
    const originalStat = fs.stat.bind(fs)
    const backupRootPath = path.resolve(backupRoot)
    const opendirSpy = vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return originalOpendir(...args)
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
      // One coalesced reconciliation performs a streaming inventory, a bounded
      // index pass, and a final membership verification. Concurrent callers do
      // not duplicate those three passes.
      expect(opendirSpy).toHaveBeenCalledTimes(3)
    } finally {
      statSpy.mockRestore()
      opendirSpy.mockRestore()
    }
  })

  it('reindexes an in-place archive replacement even when the directory timestamp is frozen', async () => {
    const stamp = Date.now()
    const fileName = `phd-atlas-app-vitest-replaced-${stamp}.json`
    const target = await writeTestBackup(fileName, {
      kind: 'application',
      actorId: `user_before_${stamp}`,
      applicationId: `app_replaced_${stamp}`,
      createdAt: new Date(stamp).toISOString(),
    })
    await listBackups({ actorId: `user_before_${stamp}` })
    const frozenDirectoryStat = await fs.stat(backupRoot)
    await fs.writeFile(target, JSON.stringify({
      backup: {
        kind: 'application',
        actorId: `user_after_${stamp}`,
        applicationId: `app_replaced_${stamp}`,
        createdAt: new Date(stamp + 1).toISOString(),
      },
      data: true,
    }), 'utf8')
    const replacementTime = new Date(stamp + 5_000)
    await fs.utimes(target, replacementTime, replacementTime)

    const originalStat = fs.stat.bind(fs)
    const backupRootPath = path.resolve(backupRoot)
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (filePath, ...args) => {
      if (path.resolve(String(filePath)) === backupRootPath) return frozenDirectoryStat
      return originalStat(filePath, ...args)
    })
    try {
      const replaced = await listBackups({ actorId: `user_after_${stamp}` })
      expect(replaced.some((backup) => backup.fileName === fileName)).toBe(true)
      expect((await listBackups({ actorId: `user_before_${stamp}` }))
        .some((backup) => backup.fileName === fileName)).toBe(false)
    } finally {
      statSpy.mockRestore()
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
        await fs.rm(target, { force: true })
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

  it('uses the durable index for high-cardinality filtered pages with a bounded hot cache', async () => {
    const stamp = Date.now()
    const actorId = `user_index_scale_${stamp}`
    const applicationId = `app_index_scale_${stamp}`
    const expected = []
    for (let offset = 0; offset < 384; offset += 24) {
      await Promise.all(Array.from({ length: Math.min(24, 384 - offset) }, async (_, batchIndex) => {
        const index = offset + batchIndex
        const createdAt = new Date(stamp + index).toISOString()
        const selectedApplicationId = index % 3 === 1 ? applicationId : `${applicationId}_other`
        const fileName = `phd-atlas-app-index-scale-${stamp}-${String(index).padStart(4, '0')}.json`
        await writeIndexedTestBackup(fileName, {
          kind: 'application',
          actorId,
          applicationId: selectedApplicationId,
          applicationName: `Scale ${index}`,
          createdAt,
        })
        if (selectedApplicationId === applicationId) expected.push({ fileName, createdAt })
      }))
    }

    const page = await listBackups({
      actorId,
      applicationId,
      kind: 'application',
      offset: 9,
      limit: 17,
    })
    const ordered = expected.sort((left, right) => (
      right.createdAt.localeCompare(left.createdAt) || right.fileName.localeCompare(left.fileName)
    ))
    expect(page.map(({ fileName }) => fileName)).toEqual(
      ordered.slice(9, 26).map(({ fileName }) => fileName),
    )
    const diagnostics = await backupIndexDiagnostics()
    expect(diagnostics.indexedEntries).toBeGreaterThanOrEqual(384)
    expect(diagnostics.infoCacheEntries).toBeLessThanOrEqual(diagnostics.infoCacheLimit)
    expect(diagnostics.infoCacheLimit).toBe(256)
    expect(diagnostics.maximumPageSize).toBe(10_000)
  })

  it('backfills sidecarless legacy JSON in bounded batches without whole-file reads', async () => {
    const stamp = Date.now()
    const actorId = `user_legacy_index_${stamp}`
    const prefix = `phd-atlas-app-legacy-index-${stamp}-`
    const total = 72
    for (let offset = 0; offset < total; offset += 24) {
      await Promise.all(Array.from({ length: Math.min(24, total - offset) }, (_, batchIndex) => {
        const index = offset + batchIndex
        return writeTestBackup(`${prefix}${String(index).padStart(3, '0')}.json`, {
          kind: 'application',
          actorId,
          applicationId: `app_legacy_index_${stamp}`,
          applicationName: `Legacy ${index}`,
          createdAt: new Date(stamp + index).toISOString(),
        })
      }))
    }

    const originalOpen = fs.open.bind(fs)
    const originalReadFile = fs.readFile.bind(fs)
    let activeArchiveOpens = 0
    let archiveOpenCount = 0
    let maximumArchiveOpens = 0
    const openSpy = vi.spyOn(fs, 'open').mockImplementation(async (filePath, ...args) => {
      const target = String(filePath)
      if (!target.includes(prefix) || !target.endsWith('.json')) return originalOpen(filePath, ...args)
      archiveOpenCount += 1
      activeArchiveOpens += 1
      maximumArchiveOpens = Math.max(maximumArchiveOpens, activeArchiveOpens)
      try {
        await new Promise((resolve) => setTimeout(resolve, 2))
        return await originalOpen(filePath, ...args)
      } finally {
        activeArchiveOpens -= 1
      }
    })
    const readFileSpy = vi.spyOn(fs, 'readFile').mockImplementation((filePath, ...args) => (
      originalReadFile(filePath, ...args)
    ))
    try {
      await listBackups({ kind: 'application', limit: total })
      expect(archiveOpenCount).toBeLessThanOrEqual(32)
      expect(maximumArchiveOpens).toBeLessThanOrEqual(8)
      expect(readFileSpy.mock.calls.some(([filePath]) => (
        String(filePath).includes(prefix) && String(filePath).endsWith('.json')
      ))).toBe(false)
      expect((await backupIndexDiagnostics()).pendingLegacyEntries).toBeGreaterThanOrEqual(total - 32)

      archiveOpenCount = 0
      maximumArchiveOpens = 0
      const migrated = await listBackups({ actorId, limit: total })
      expect(migrated).toHaveLength(total)
      expect(archiveOpenCount).toBeLessThanOrEqual(total - 32)
      expect(maximumArchiveOpens).toBeLessThanOrEqual(8)
      expect((await backupIndexDiagnostics()).infoCacheEntries).toBeLessThanOrEqual(256)
    } finally {
      readFileSpy.mockRestore()
      openSpy.mockRestore()
    }
  })
})

describe.sequential('concurrent store writes', () => {
  it('retains fixed-size content fingerprints instead of full entity JSON in baselines', async () => {
    const snapshot = await readStore()
    const baselineSymbol = Object.getOwnPropertySymbols(snapshot)
      .find((symbol) => symbol.description === 'phd-atlas-store-baseline')
    const baseline = snapshot[baselineSymbol]
    const application = snapshot.applications[0]

    expect(baselineSymbol).toBeDefined()
    expect(baseline.settings).toMatch(/^[a-f0-9]{64}$/)
    expect(baseline.users.get(snapshot.users[0].id)).toMatch(/^[a-f0-9]{64}$/)
    expect(baseline.applications.get(application.id)).toMatch(/^[a-f0-9]{64}$/)
    expect(baseline.applications.get(application.id)).not.toContain(application.school.name)
  })

  it('merges stale snapshots without deleting entities created by another request', async () => {
    const stamp = Date.now()
    const firstId = `app_concurrency_first_${stamp}`
    const secondId = `app_concurrency_second_${stamp}`
    const firstSnapshot = await readStore()
    const secondSnapshot = await readStore()
    const ownerId = firstSnapshot.users[0].id

    try {
      firstSnapshot.applications.push(makeConcurrencyApplication(firstId, ownerId, 'First Concurrent University', stamp))
      await lockedWriteStore(firstSnapshot)

      secondSnapshot.applications.push(makeConcurrencyApplication(secondId, ownerId, 'Second Concurrent University', stamp))
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

  it('rejects divergent writes to the same entity instead of silently losing one', async () => {
    const stamp = Date.now()
    const applicationId = `app_concurrency_conflict_${stamp}`
    const setup = await readStore()
    const ownerId = setup.users[0].id
    setup.applications.push(makeConcurrencyApplication(applicationId, ownerId, 'Conflict University', stamp))
    await lockedWriteStore(setup)

    try {
      const taskSnapshot = await readStore()
      const feeSnapshot = await readStore()
      const taskApplication = taskSnapshot.applications.find((item) => item.id === applicationId)
      const feeApplication = feeSnapshot.applications.find((item) => item.id === applicationId)
      taskApplication.tasks.push({ id: `task_${stamp}`, title: 'Keep task', done: false })
      taskApplication.updatedAt = new Date(stamp + 1).toISOString()
      feeApplication.fees.push({ id: `fee_${stamp}`, amount: 42, currency: 'GBP' })
      feeApplication.updatedAt = new Date(stamp + 2).toISOString()

      const results = await Promise.allSettled([
        lockedWriteStore(taskSnapshot),
        lockedWriteStore(feeSnapshot),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected')
      expect(rejected.reason).toMatchObject({
        status: 409,
        code: 'STORE_WRITE_CONFLICT',
        entityType: 'application',
        entityId: applicationId,
      })

      const persisted = (await readStore()).applications.find((item) => item.id === applicationId)
      expect(Boolean(persisted.tasks.some((task) => task.id === `task_${stamp}`)))
        .not.toBe(Boolean(persisted.fees.some((fee) => fee.id === `fee_${stamp}`)))
    } finally {
      const cleanup = await readStore()
      cleanup.applications = cleanup.applications.filter((item) => item.id !== applicationId)
      await lockedWriteStore(cleanup)
    }
  })

  it('rejects a stale update after the same entity was deleted', async () => {
    const stamp = Date.now()
    const applicationId = `app_concurrency_deleted_${stamp}`
    const setup = await readStore()
    const ownerId = setup.users[0].id
    setup.applications.push(makeConcurrencyApplication(applicationId, ownerId, 'Deleted University', stamp))
    await lockedWriteStore(setup)

    const deleteSnapshot = await readStore()
    const staleUpdateSnapshot = await readStore()
    deleteSnapshot.applications = deleteSnapshot.applications.filter((item) => item.id !== applicationId)
    const staleApplication = staleUpdateSnapshot.applications.find((item) => item.id === applicationId)
    staleApplication.program = 'Must not revive'
    staleApplication.updatedAt = new Date(stamp + 1).toISOString()

    await lockedWriteStore(deleteSnapshot)
    await expect(lockedWriteStore(staleUpdateSnapshot)).rejects.toMatchObject({
      status: 409,
      code: 'STORE_WRITE_CONFLICT',
      entityId: applicationId,
    })
    expect((await readStore()).applications.some((item) => item.id === applicationId)).toBe(false)
  })

  it('creates unique application backups when timestamps are identical', async () => {
    const snapshot = await readStore()
    const application = snapshot.applications[0]
    const actorId = snapshot.users[0].id
    let backups = []
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
    try {
      backups = await Promise.all(Array.from({ length: 8 }, () => (
        createBackup(snapshot, actorId, application, 20, { prune: false })
      )))
    } finally {
      vi.useRealTimers()
    }
    createdFiles.push(...backups.map((backup) => backup.fileName))

    expect(new Set(backups.map((backup) => backup.fileName)).size).toBe(8)
    await expect(Promise.all(backups.map((backup) => fs.stat(backup.path)))).resolves.toHaveLength(8)
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

describe.sequential('phase 17 payload encoding handoff', () => {
  it('produces interchangeable async and sync payload encodings and reads them back', async () => {
    await readStore()
    const value = {
      id: 'app_phase17_encoding_equivalence',
      body: 'x'.repeat(80 * 1024),
      nested: {
        marker: 'phase17',
        values: Array.from({ length: 100 }, (_unused, index) => index),
      },
    }

    const sync = encodePayloadForStorage(value)
    const asyncEncoded = await encodePayloadForStorageAsync(value)

    expect(decodePayloadFromStorage(asyncEncoded)).toEqual(value)
    expect(decodePayloadFromStorage(sync)).toEqual(value)
  })

  it('falls back to the synchronous encoder when the worker returns null', async () => {
    await readStore()
    const value = { id: 'app_phase17_worker_fallback', body: 'y'.repeat(80 * 1024) }
    const spy = vi.spyOn(payloadWorkerPool, 'encode').mockResolvedValue(null)
    try {
      const encoded = await encodePayloadForStorageAsync(value)
      expect(decodePayloadFromStorage(encoded)).toEqual(value)
      expect(decodePayloadFromStorage(encodePayloadForStorage(value))).toEqual(value)
    } finally {
      spy.mockRestore()
    }
  })
})
