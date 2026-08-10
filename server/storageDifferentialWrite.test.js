import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

let storage
let testRoot
let sqlitePath

function clone(value) {
  return structuredClone(value)
}

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function applicationFrom(source, { id, ownerId, schoolName }) {
  const application = clone(source)
  application.id = id
  application.ownerId = ownerId
  application.teamId = null
  application.school = {
    ...application.school,
    name: schoolName,
    logo: undefined,
  }
  application.createdAt = new Date().toISOString()
  application.updatedAt = application.createdAt
  return application
}

function profileAssetFrom(source, { id, ownerId }) {
  const asset = clone(source)
  asset.id = id
  asset.ownerId = ownerId
  asset.name = `Differential asset ${id}`
  asset.notes = 'This payload must not be re-encrypted by an unrelated application write.'
  asset.updatedAt = new Date().toISOString()
  return asset
}

function userFrom(source, { id, email }) {
  const user = clone(source)
  user.id = id
  user.name = `Differential user ${id}`
  user.email = email
  user.createdAt = new Date().toISOString()
  user.lastLoginAt = null
  user.settings = {
    ...user.settings,
    smtpPass: `smtp-secret-${id}`,
    incomingPass: `incoming-secret-${id}`,
  }
  return user
}

function rawWorkspaceValue(query, ...parameters) {
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  try {
    return database.prepare(query).get(...parameters)
  } finally {
    database.close()
  }
}

function rawWorkspaceRows({ applicationIds = [], assetIds = [] } = {}) {
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  try {
    const applications = new Map(applicationIds.map((id) => [
      id,
      database.prepare('SELECT payload_json FROM applications WHERE id = ?').get(id)?.payload_json,
    ]))
    const profileAssets = new Map(assetIds.map((id) => [
      id,
      database.prepare('SELECT payload_json FROM profile_assets WHERE id = ?').get(id)?.payload_json,
    ]))
    const revision = Number(database.prepare(
      'SELECT revision FROM workspace_revision WHERE id = 1',
    ).get()?.revision)
    return { applications, profileAssets, revision }
  } finally {
    database.close()
  }
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-differential-write-'))
  sqlitePath = path.join(testRoot, 'workspace.sqlite')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'differential-write-test-server-key')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'differential-write-test-encryption-key')
})

beforeEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true })
  await fs.mkdir(testRoot, { recursive: true })
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
})

afterEach(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  vi.resetModules()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await fs.rm(testRoot, { recursive: true, force: true })
})

describe.sequential('differential full-store writes', () => {
  it('does not advance the durable revision for a true no-op write', async () => {
    const snapshot = await storage.readStore()
    const revisionBefore = snapshot.meta.revision

    const result = await storage.lockedWriteStore(snapshot)

    expect(result).toMatchObject({ unchanged: true })
    expect((await storage.readStore()).meta.revision).toBe(revisionBefore)
  })

  it('keeps operational notification clocks outside the scoped workspace revision', async () => {
    const snapshot = await storage.readStore()
    const userId = snapshot.users[0].id
    const workspaceFingerprint = storage.workspaceStoreRevisionFingerprint(snapshot)
    const databaseRevision = await storage.readWorkspaceRevision()
    const created = await storage.insertNotificationIfNew(userId, {
      type: 'revision_boundary_test',
      applicationId: null,
      title: 'Revision boundary',
      body: 'Operational notification state',
      dedupeKey: uniqueId('notification_revision_boundary'),
      triggerDate: '2026-08-09',
    })

    expect(created).toBeTruthy()
    expect(await storage.readWorkspaceRevision()).toBeGreaterThan(databaseRevision)
    expect(await storage.readCurrentWorkspaceStoreRevisionFingerprint(snapshot))
      .toBe(workspaceFingerprint)

    await storage.markNotificationsPushEnqueued([created.id])
    expect(await storage.readCurrentWorkspaceStoreRevisionFingerprint(snapshot))
      .toBe(workspaceFingerprint)
  })

  it('keeps a warm quota aggregation out of every write lane', async () => {
    const snapshot = await storage.readStore()
    const userId = snapshot.users[0].id
    await storage.readWorkspaceQuotaUsage(userId)
    storage.resetWriteLaneStatsForTests()

    await storage.readWorkspaceQuotaUsage(userId)

    expect(storage.writeLaneSnapshot()).toMatchObject({
      granted: 0,
      globalGranted: 0,
      queueDepth: 0,
    })
  })

  it('fails the small-workspace footprint closed when its quota ledger is stale', async () => {
    const snapshot = await storage.readStore()
    const userId = snapshot.users[0].id
    const application = snapshot.applications.find(({ ownerId, teamId }) => (
      ownerId === userId && !teamId
    ))
    expect(application).toBeTruthy()

    const current = await storage.readPersonalWorkspaceAdmissionFootprint(userId)
    expect(current.complete).toBe(true)
    expect(current.staleSources).toBe(0)
    expect(current.dataBytes).toBeGreaterThan(0)

    const database = new Database(sqlitePath)
    try {
      database.prepare(
        'UPDATE applications SET payload_version = payload_version + 1 WHERE id = ?',
      ).run(application.id)
    } finally {
      database.close()
    }

    const stale = await storage.readPersonalWorkspaceAdmissionFootprint(userId)
    expect(stale.complete).toBe(false)
    expect(stale.staleSources).toBeGreaterThanOrEqual(1)
  })

  it('does not schedule another automatic backup until the application changes', async () => {
    const setup = await storage.readStore()
    const user = setup.users[0]
    const application = setup.applications.find(({ ownerId }) => ownerId === user.id)
      ?? setup.applications[0]
    user.settings.autoBackup = true
    user.settings.membershipPlan = 'pro'
    application.ownerId = user.id
    application.updatedAt = '2026-08-09T01:00:00.000Z'
    await storage.lockedWriteStore(setup)
    await storage.acknowledgeAutomaticApplicationBackup({
      actorId: user.id,
      applicationId: application.id,
      fileName: uniqueId('automatic_backup_candidate'),
      createdAt: '2026-08-09T02:00:00.000Z',
      frequency: '1m',
      maxBackups: 3,
    })

    const unchangedCandidates = []
    for await (const candidate of storage.iterateAutomaticBackupCandidateRefs({ batchSize: 16 })) {
      unchangedCandidates.push(candidate.applicationId)
    }
    expect(unchangedCandidates).not.toContain(application.id)

    const edited = await storage.readStore()
    edited.applications.find(({ id }) => id === application.id).updatedAt = '2026-08-09T03:00:00.000Z'
    await storage.lockedWriteStore(edited)
    const changedCandidates = []
    for await (const candidate of storage.iterateAutomaticBackupCandidateRefs({ batchSize: 16 })) {
      changedCandidates.push(candidate.applicationId)
    }
    expect(changedCandidates).toContain(application.id)
  })

  it('preserves untouched encrypted payload bytes and commits one logical revision', async () => {
    const setup = await storage.readStore()
    const ownerId = setup.users[0].id
    const changedId = uniqueId('app_differential_changed')
    const untouchedId = uniqueId('app_differential_untouched')
    const assetId = uniqueId('asset_differential_untouched')
    setup.settings.encryptionAtRest = true
    setup.settings.sqliteEncryption = false
    setup.applications.push(
      applicationFrom(setup.applications[0], {
        id: changedId,
        ownerId,
        schoolName: 'Changed Payload University',
      }),
      applicationFrom(setup.applications[0], {
        id: untouchedId,
        ownerId,
        schoolName: 'Untouched Payload University',
      }),
    )
    setup.profileAssets.push(profileAssetFrom(setup.profileAssets[0], { id: assetId, ownerId }))
    await storage.lockedWriteStore(setup)

    const mutation = await storage.readStore()
    const before = rawWorkspaceRows({
      applicationIds: [changedId, untouchedId],
      assetIds: [assetId],
    })
    expect(before.applications.get(changedId)).toMatch(/^payload:v3:/)
    expect(before.applications.get(untouchedId)).toMatch(/^payload:v3:/)
    expect(before.profileAssets.get(assetId)).toMatch(/^payload:v3:/)

    const changed = mutation.applications.find((application) => application.id === changedId)
    changed.program = 'Differentially persisted program'
    changed.updatedAt = new Date(Date.now() + 1_000).toISOString()
    await storage.lockedWriteStore(mutation)

    const after = rawWorkspaceRows({
      applicationIds: [changedId, untouchedId],
      assetIds: [assetId],
    })
    expect(after.applications.get(changedId)).not.toBe(before.applications.get(changedId))
    expect.soft(
      after.applications.get(untouchedId) === before.applications.get(untouchedId),
      'an unrelated application write must preserve the untouched application ciphertext byte-for-byte',
    ).toBe(true)
    expect.soft(
      after.profileAssets.get(assetId) === before.profileAssets.get(assetId),
      'an unrelated application write must preserve the untouched profile asset ciphertext byte-for-byte',
    ).toBe(true)
    expect(after.revision).toBe(before.revision + 1)

    const persisted = await storage.readStore()
    expect(persisted.applications.find((application) => application.id === changedId)?.program)
      .toBe('Differentially persisted program')
    expect(persisted.meta.revision).toBe(after.revision)
  })

  it('persists additions and deletions without rewriting retained entities', async () => {
    const setup = await storage.readStore()
    const ownerId = setup.users[0].id
    const removedId = uniqueId('app_differential_removed')
    const retainedId = uniqueId('app_differential_retained')
    const addedId = uniqueId('app_differential_added')
    setup.applications.push(
      applicationFrom(setup.applications[0], {
        id: removedId,
        ownerId,
        schoolName: 'Removed University',
      }),
      applicationFrom(setup.applications[0], {
        id: retainedId,
        ownerId,
        schoolName: 'Retained University',
      }),
    )
    await storage.lockedWriteStore(setup)

    const mutation = await storage.readStore()
    const before = rawWorkspaceRows({ applicationIds: [removedId, retainedId] })
    mutation.applications = mutation.applications.filter((application) => application.id !== removedId)
    mutation.applications.push(applicationFrom(mutation.applications[0], {
      id: addedId,
      ownerId,
      schoolName: 'New University',
    }))
    await storage.lockedWriteStore(mutation)

    const after = rawWorkspaceRows({ applicationIds: [removedId, retainedId, addedId] })
    expect(after.applications.get(removedId)).toBeUndefined()
    expect(after.applications.get(addedId)).toMatch(/^payload:v3:/)
    expect(
      after.applications.get(retainedId) === before.applications.get(retainedId),
      'adding and deleting applications must not re-encrypt a retained application',
    ).toBe(true)
    expect(after.revision).toBe(before.revision + 1)

    const persistedIds = new Set((await storage.readStore()).applications.map(({ id }) => id))
    expect(persistedIds.has(removedId)).toBe(false)
    expect(persistedIds.has(retainedId)).toBe(true)
    expect(persistedIds.has(addedId)).toBe(true)
  })

  it('keeps three-way merging concurrent changes to different entities', async () => {
    const setup = await storage.readStore()
    const ownerId = setup.users[0].id
    const firstId = uniqueId('app_differential_merge_first')
    const secondId = uniqueId('app_differential_merge_second')
    setup.applications.push(
      applicationFrom(setup.applications[0], {
        id: firstId,
        ownerId,
        schoolName: 'First Merge University',
      }),
      applicationFrom(setup.applications[0], {
        id: secondId,
        ownerId,
        schoolName: 'Second Merge University',
      }),
    )
    await storage.lockedWriteStore(setup)

    const firstSnapshot = await storage.readStore()
    const secondSnapshot = await storage.readStore()
    const beforeRevision = firstSnapshot.meta.revision
    firstSnapshot.applications.find(({ id }) => id === firstId).program = 'First concurrent program'
    secondSnapshot.applications.find(({ id }) => id === secondId).program = 'Second concurrent program'

    await Promise.all([
      storage.lockedWriteStore(firstSnapshot),
      storage.lockedWriteStore(secondSnapshot),
    ])

    const persisted = await storage.readStore()
    expect(persisted.applications.find(({ id }) => id === firstId)?.program)
      .toBe('First concurrent program')
    expect(persisted.applications.find(({ id }) => id === secondId)?.program)
      .toBe('Second concurrent program')
    expect(persisted.meta.revision).toBe(beforeRevision + 2)
  })

  it('updates only changed users and preserves stored secret ciphertext', async () => {
    const setup = await storage.readStore()
    const untouchedUser = setup.users[0]
    const changedUserId = uniqueId('user_differential_changed')
    const changedEmail = `${changedUserId}@example.test`
    setup.users.push(userFrom(untouchedUser, { id: changedUserId, email: changedEmail }))
    await storage.lockedWriteStore(setup)

    const mutation = await storage.readStore()
    const beforeUntouched = rawWorkspaceValue(
      'SELECT settings_json FROM users WHERE id = ?',
      untouchedUser.id,
    ).settings_json
    const beforeChanged = JSON.parse(rawWorkspaceValue(
      'SELECT settings_json FROM users WHERE id = ?',
      changedUserId,
    ).settings_json)
    const revisionBefore = mutation.meta.revision
    const changedUser = mutation.users.find(({ id }) => id === changedUserId)
    changedUser.name = 'Differentially updated user'
    changedUser.settings.language = changedUser.settings.language === 'en' ? 'zh' : 'en'
    await storage.lockedWriteStore(mutation)

    const afterUntouched = rawWorkspaceValue(
      'SELECT settings_json FROM users WHERE id = ?',
      untouchedUser.id,
    ).settings_json
    const afterChanged = JSON.parse(rawWorkspaceValue(
      'SELECT settings_json FROM users WHERE id = ?',
      changedUserId,
    ).settings_json)
    expect(afterUntouched).toBe(beforeUntouched)
    expect(afterChanged.smtpPass).toBe(beforeChanged.smtpPass)
    expect(afterChanged.incomingPass).toBe(beforeChanged.incomingPass)
    expect(afterChanged.language).not.toBe(beforeChanged.language)

    const persisted = await storage.readStore()
    const persistedUser = persisted.users.find(({ id }) => id === changedUserId)
    expect(persistedUser).toMatchObject({
      name: 'Differentially updated user',
      email: changedEmail,
    })
    expect(persistedUser.settings.smtpPass).toBe(`smtp-secret-${changedUserId}`)
    expect(persistedUser.settings.incomingPass).toBe(`incoming-secret-${changedUserId}`)
    expect(persisted.meta.revision).toBe(revisionBefore + 1)
  })

  it('does not touch system settings during an unrelated entity write', async () => {
    const setup = await storage.readStore()
    setup.settings.smtpPass = 'differential-system-smtp-secret'
    setup.settings.notificationMailbox = 'before-differential@example.test'
    await storage.lockedWriteStore(setup)

    const mutation = await storage.readStore()
    const before = rawWorkspaceValue(
      'SELECT smtp_pass, notification_mailbox, updated_at FROM system_settings WHERE id = ?',
      'global',
    )
    const application = mutation.applications[0]
    application.program = `Settings-independent ${uniqueId('program')}`
    application.updatedAt = new Date().toISOString()
    await storage.lockedWriteStore(mutation)

    const unchanged = rawWorkspaceValue(
      'SELECT smtp_pass, notification_mailbox, updated_at FROM system_settings WHERE id = ?',
      'global',
    )
    expect(unchanged).toEqual(before)

    const settingsMutation = await storage.readStore()
    settingsMutation.settings.notificationMailbox = 'after-differential@example.test'
    await storage.lockedWriteStore(settingsMutation)
    const changed = rawWorkspaceValue(
      'SELECT smtp_pass, notification_mailbox FROM system_settings WHERE id = ?',
      'global',
    )
    expect(changed.smtp_pass).toBe(before.smtp_pass)
    expect(changed.notification_mailbox).toBe('after-differential@example.test')
    expect((await storage.readStore()).settings.smtpPass).toBe('differential-system-smtp-secret')
  })

  it('appends events idempotently, preserves omitted history, and applies explicit retention', async () => {
    const eventId = uniqueId('event_differential_history')
    const setup = await storage.readStore()
    setup.settings.systemLogRetentionDays = null
    setup.systemEvents.unshift({
      id: eventId,
      time: '2000-01-01T00:00:00.000Z',
      scope: 'Differential test',
      actorId: setup.users[0].id,
      message: 'Initial historical event',
      metadata: { retained: true },
    })
    await storage.lockedWriteStore(setup)

    const changed = await storage.readStore()
    changed.systemEvents.find(({ id }) => id === eventId).message = 'Updated historical event'
    await storage.lockedWriteStore(changed)
    expect(rawWorkspaceValue(
      'SELECT message FROM system_events WHERE id = ?',
      eventId,
    ).message).toBe('Initial historical event')

    const omitted = await storage.readStore()
    omitted.systemEvents = omitted.systemEvents.filter(({ id }) => id !== eventId)
    await storage.lockedWriteStore(omitted)
    expect(rawWorkspaceValue('SELECT COUNT(*) AS count FROM system_events WHERE id = ?', eventId).count)
      .toBe(1)

    const retained = await storage.readStore()
    retained.settings.systemLogRetentionDays = 1
    await storage.lockedWriteStore(retained)
    expect(rawWorkspaceValue('SELECT COUNT(*) AS count FROM system_events WHERE id = ?', eventId).count)
      .toBe(0)
  })

  it('persists jobs, notifications, and business meta on an empty entity diff', async () => {
    const snapshot = await storage.readStore()
    const revisionBefore = snapshot.meta.revision
    const dedupeKey = uniqueId('system_mail_differential')
    const notificationDedupe = uniqueId('notification_differential')
    const publicSetupState = uniqueId('public_setup_state')
    snapshot.meta.publicSetupState = publicSetupState

    const result = await storage.writeStore(snapshot, {
      systemMailJobs: [{
        dedupeKey,
        kind: 'differential-test',
        to: 'recipient@example.test',
        subject: 'Differential mail persistence',
        text: 'Persist even when no workspace entity changed.',
      }],
      notifications: [{
        userId: snapshot.users[0].id,
        candidate: {
          type: 'differential_test',
          title: 'Differential notification',
          body: 'Persisted with an empty entity plan.',
          dedupeKey: notificationDedupe,
          triggerDate: new Date().toISOString(),
        },
      }],
    })

    expect(result.createdNotifications).toHaveLength(1)
    expect(rawWorkspaceValue(
      'SELECT payload_encrypted FROM system_mail_jobs WHERE dedupe_key = ?',
      dedupeKey,
    ).payload_encrypted).toMatch(/^payload:v3:/)
    expect((await storage.getSystemMailJobByDedupeKey(dedupeKey))?.payload.text)
      .toBe('Persist even when no workspace entity changed.')
    expect(rawWorkspaceValue(
      'SELECT COUNT(*) AS count FROM notifications WHERE dedupe_key = ?',
      notificationDedupe,
    ).count).toBe(1)
    const persisted = await storage.readStore()
    expect(persisted.meta.publicSetupState).toBe(publicSetupState)
    expect(persisted.meta.revision).toBe(revisionBefore + 1)
  })

  it('rejects a stale direct write at the transaction revision boundary', async () => {
    const current = await storage.readStore()
    const stale = await storage.readStore()
    current.applications[0].program = 'Current direct write'
    stale.applications[0].program = 'Stale direct write'
    await storage.writeStore(current)

    await expect(storage.writeStore(stale)).rejects.toMatchObject({
      status: 409,
      code: 'STORE_WRITE_CONFLICT',
      entityType: 'application',
    })
    expect((await storage.readStore()).applications[0].program).toBe('Current direct write')
  })

  it('retries disjoint stale writes after a tenant revision moved', async () => {
    const setup = await storage.readStore()
    const ownerId = setup.users[0].id
    const firstId = uniqueId('app_retry_first')
    const secondId = uniqueId('app_retry_second')
    setup.applications.push(
      applicationFrom(setup.applications[0], {
        id: firstId,
        ownerId,
        schoolName: 'First Retry University',
      }),
      applicationFrom(setup.applications[0], {
        id: secondId,
        ownerId,
        schoolName: 'Second Retry University',
      }),
    )
    await storage.lockedWriteStore(setup)

    const current = await storage.readStore()
    const stale = await storage.readStore()
    const first = current.applications.find((application) => application.id === firstId)
    const second = stale.applications.find((application) => application.id === secondId)
    first.program = 'Current retry marker'
    second.program = 'Stale retry marker'
    await storage.writeStore(current)

    await storage.writeStore(stale)
    const persisted = await storage.readStore()
    expect(persisted.applications.find((application) => application.id === firstId)?.program)
      .toBe('Current retry marker')
    expect(persisted.applications.find((application) => application.id === secondId)?.program)
      .toBe('Stale retry marker')
  })

  it('merges disjoint stale settings patches while preserving the latest mutation receipt', async () => {
    const first = await storage.readStore()
    const second = await storage.readStore()
    const userId = first.users[0].id
    const firstUser = first.users.find((user) => user.id === userId)
    const secondUser = second.users.find((user) => user.id === userId)
    firstUser.settings.themeAccent = 'indigo'
    firstUser.settings.settingsMutationNonce = 'settings-first-disjoint'
    secondUser.settings.highContrast = true
    secondUser.settings.settingsMutationNonce = 'settings-second-disjoint'

    await storage.lockedWriteStore(first)
    await storage.lockedWriteStore(second)

    const persisted = await storage.readStore()
    const persistedUser = persisted.users.find((user) => user.id === userId)
    expect(persistedUser.settings.themeAccent).toBe('indigo')
    expect(persistedUser.settings.highContrast).toBe(true)
    expect(persistedUser.settings.settingsMutationNonce).toBe('settings-second-disjoint')
  })

  it('retains a real conflict when two stale settings patches change the same authored field', async () => {
    const first = await storage.readStore()
    const second = await storage.readStore()
    const userId = first.users[0].id
    first.users.find((user) => user.id === userId).settings.themeAccent = 'indigo'
    second.users.find((user) => user.id === userId).settings.themeAccent = 'emerald'

    await storage.lockedWriteStore(first)
    await expect(storage.lockedWriteStore(second)).rejects.toMatchObject({
      status: 409,
      code: 'STORE_WRITE_CONFLICT',
      entityType: 'user settings',
      entityId: userId,
    })
  })

  it('uses the legacy full reconcile for user deletion and normalizes cascades to one revision', async () => {
    const setup = await storage.readStore()
    const userId = uniqueId('user_full_reconcile_delete')
    setup.users.push(userFrom(setup.users[0], {
      id: userId,
      email: `${userId}@example.test`,
    }))
    setup.applications.push(applicationFrom(setup.applications[0], {
      id: uniqueId('app_owned_by_deleted_user'),
      ownerId: userId,
      schoolName: 'Deleted User University',
    }))
    setup.profileAssets.push(profileAssetFrom(setup.profileAssets[0], {
      id: uniqueId('asset_owned_by_deleted_user'),
      ownerId: userId,
    }))
    await storage.lockedWriteStore(setup)
    const team = await storage.createTeam(userId, 'Deleted owner team')

    const mutation = await storage.readStore()
    const revisionBefore = mutation.meta.revision
    mutation.users = mutation.users.filter(({ id }) => id !== userId)
    mutation.applications = mutation.applications.filter(({ ownerId }) => ownerId !== userId)
    mutation.profileAssets = mutation.profileAssets.filter(({ ownerId }) => ownerId !== userId)
    await storage.lockedWriteStore(mutation)

    const persisted = await storage.readStore()
    expect(persisted.users.some(({ id }) => id === userId)).toBe(false)
    expect(persisted.applications.some(({ ownerId }) => ownerId === userId)).toBe(false)
    expect(persisted.profileAssets.some(({ ownerId }) => ownerId === userId)).toBe(false)
    expect(await storage.getTeamById(team.id)).toBeNull()
    expect(persisted.meta.revision).toBe(revisionBefore + 1)
  })
})
