import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

import { decodeExternalStatePayload } from './durableEnvelope.js'

const external = vi.hoisted(() => ({
  persisted: null,
  rows: new Map(),
  writes: [],
  observers: [],
  blocker: null,
  readBlocker: null,
  failuresRemaining: 0,
  failureObserved: null,
}))

function cloneRow(row) {
  return row
    ? { ...row, payload: Buffer.from(row.payload) }
    : null
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function waitForAppliedWrite(predicate) {
  const pending = deferred()
  external.observers.push({ predicate, resolve: pending.resolve })
  return pending.promise
}

vi.mock('./databaseConnection.js', async (importOriginal) => {
  const actual = await importOriginal()
  const targetKey = (configuration) => `${configuration.type}:${configuration.database}`
  return {
    ...actual,
    async verifyDatabaseConnection(configuration) {
      return {
        ...configuration,
        port: Number(configuration.port),
        passwordSet: Boolean(configuration.password),
      }
    },
    async persistDatabaseConfiguration(configuration) {
      external.persisted = structuredClone(configuration)
    },
    async readPersistedDatabaseConfiguration() {
      return external.persisted ? structuredClone(external.persisted) : null
    },
    async readExternalDatabaseState(configuration, options = {}) {
      const key = targetKey(configuration)
      if (external.readBlocker?.key === key && !external.readBlocker.used) {
        external.readBlocker.used = true
        external.readBlocker.started.resolve()
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(options.signal?.reason)
          options.signal?.addEventListener('abort', onAbort, { once: true })
          external.readBlocker.release.promise.then(resolve, reject).finally(() => {
            options.signal?.removeEventListener('abort', onAbort)
          })
          if (options.signal?.aborted) onAbort()
        })
      }
      return cloneRow(external.rows.get(targetKey(configuration)))
    },
    async assertExternalDatabaseTargetEmpty(configuration) {
      if (external.rows.has(targetKey(configuration))) {
        const error = new Error('Target is not empty.')
        error.code = 'DATABASE_TARGET_NOT_EMPTY'
        throw error
      }
      return true
    },
    async writeExternalDatabaseState(configuration, payload, revision, updatedAt, options = {}) {
      const key = targetKey(configuration)
      external.writes.push({ key, revision, payload: Buffer.from(payload) })
      if (external.failuresRemaining > 0) {
        external.failuresRemaining -= 1
        external.failureObserved?.resolve()
        const error = new Error('Injected transient connection failure.')
        error.code = 'DATABASE_CONNECTION_FAILED'
        throw error
      }
      if (external.blocker?.key === key && !external.blocker.used) {
        external.blocker.used = true
        external.blocker.started.resolve()
        await external.blocker.release.promise
      }
      const current = external.rows.get(key)
      if (options.overwrite === false && current) {
        const error = new Error('Target is not empty.')
        error.code = 'DATABASE_TARGET_NOT_EMPTY'
        throw error
      }
      if (current && revision < current.revision) return { outcome: 'stale' }
      if (current && revision === current.revision) {
        if (Buffer.from(payload).equals(current.payload)) return undefined
        const error = new Error('Equal revision has different content.')
        error.code = 'DATABASE_REVISION_CONFLICT'
        error.status = 409
        throw error
      }
      const next = { payload: Buffer.from(payload), revision, updatedAt }
      external.rows.set(key, next)
      for (const observer of external.observers.splice(0)) {
        if (observer.predicate({ key, ...next })) observer.resolve(cloneRow(next))
        else external.observers.push(observer)
      }
      return undefined
    },
  }
})

const postgresql = (database) => ({
  type: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  database,
  username: 'atlas',
  password: 'test-only',
  ssl: false,
  schema: 'public',
})

let storage
let testRoot
let sqlitePath

async function openRemoteWorkspace(database) {
  const row = external.rows.get(`postgresql:${database}`)
  expect(row).toBeTruthy()
  const image = Buffer.from(decodeExternalStatePayload(row.payload))
  image[18] = 1
  image[19] = 1
  return {
    row,
    database: new Database(image),
  }
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-external-revision-'))
  sqlitePath = path.join(testRoot, 'workspace.sqlite')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'external-revision-test-key')
  vi.stubEnv('RUNTIME_MEMORY_BUDGET_BYTES', String(512 * 1024 * 1024))
  vi.stubEnv('PHD_ATLAS_SNAPSHOT_MAX_BYTES', String(64 * 1024 * 1024))
})

beforeEach(async () => {
  external.persisted = null
  external.rows.clear()
  external.writes.length = 0
  external.observers.length = 0
  external.blocker = null
  external.readBlocker = null
  external.failuresRemaining = 0
  external.failureObserved = null
  await fs.rm(testRoot, { recursive: true, force: true })
  await fs.mkdir(testRoot, { recursive: true })
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const quotaPrepared = await storage.readStore()
  for (const user of quotaPrepared.users) {
    user.settings = {
      ...(user.settings ?? {}),
      storageQuotaMb: 128,
    }
  }
  await storage.writeStore(quotaPrepared)
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

describe('external workspace durable revision', () => {
  it('cancels external initialization and releases service/cache ownership during shutdown', async () => {
    const configuration = postgresql('shutdown_initialization')
    await storage.configureDatabaseConfiguration(configuration, {
      allowExistingState: false,
    })
    await storage.shutdownStorage()

    external.readBlocker = {
      key: 'postgresql:shutdown_initialization',
      used: false,
      started: deferred(),
      release: deferred(),
    }
    vi.resetModules()
    storage = await import('./storage.js')
    const initialization = storage.ensureStorage()
    await external.readBlocker.started.promise
    const shutdown = storage.shutdownStorage()
    await expect(initialization).rejects.toMatchObject({ code: 'STORAGE_SHUTTING_DOWN' })
    await expect(shutdown).resolves.toBeUndefined()
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: false,
      initializing: false,
      databaseOpen: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    })

    external.readBlocker = null
    await storage.ensureStorage()
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: true,
      databaseLeaseHeld: true,
      serviceLeaseHeld: true,
    })
  }, 120_000)

  it('rejects a Codex revocation until the exact security revision is durable', async () => {
    await storage.configureDatabaseConfiguration(postgresql('codex_security_ack'), {
      allowExistingState: false,
    })
    const store = await storage.readStore()
    const userId = store.users[0].id
    const created = await storage.createCodexAuthorization({
      userId,
      tokenSelector: 'sel_' + 'a'.repeat(28),
      tokenHash: 'b'.repeat(64),
      tokenHint: 'bbbbbb',
      name: 'External durable revocation',
      scopes: ['applications:read'],
      scopeVersion: 2,
      createdAt: new Date().toISOString(),
    })
    const attemptsBefore = storage.durableStorageAckDiagnostics().attempts

    external.failuresRemaining = 1
    await expect(storage.revokeCodexAuthorization(userId, created.id, {
      reason: 'external_failure_test',
    })).rejects.toMatchObject({ code: 'DATABASE_CONNECTION_FAILED' })
    expect(storage.durableStorageAckDiagnostics()).toMatchObject({
      attempts: attemptsBefore + 1,
      failures: 1,
    })

    // The local CAS is already revoked, so this retry is intentionally a
    // no-op. Sticky security acknowledgement must still flush it remotely
    // before allowing the idempotent success response.
    await expect(storage.revokeCodexAuthorization(userId, created.id, {
      reason: 'external_failure_test',
    })).resolves.toMatchObject({ status: 'revoked' })
    const remote = await openRemoteWorkspace('codex_security_ack')
    try {
      expect(remote.database.prepare(
        'SELECT revoked_at FROM codex_authorizations WHERE id = ?',
      ).get(created.id)?.revoked_at).toBeTruthy()
    } finally {
      remote.database.close()
    }
  })

  it('persists full and narrow writes in one monotonic snapshot and reloads them after a cold restart', async () => {
    await storage.configureDatabaseConfiguration(postgresql('restart_target'), { allowExistingState: false })
    const store = await storage.readStore()
    const userId = store.users[0].id
    const applicationId = store.applications[0].id
    store.settings.notificationMailbox = 'full-write@example.test'
    await storage.writeStore(store)
    const fullRevision = external.rows.get('postgresql:restart_target').revision

    const scheduled = waitForAppliedWrite(({ key, revision }) => (
      key === 'postgresql:restart_target' && revision > fullRevision
    ))
    await storage.writeAdmissionSignalReport(userId, applicationId, {
      marker: 'narrow-write-marker',
    })
    await storage.flushDurableStorage()
    await scheduled

    const remote = await openRemoteWorkspace('restart_target')
    expect(remote.database.prepare(
      'SELECT notification_mailbox AS mailbox FROM system_settings WHERE id = ?'
    ).get('global')).toEqual({ mailbox: 'full-write@example.test' })
    expect(remote.database.prepare(
      'SELECT COUNT(*) AS count FROM admission_signal_reports WHERE user_id = ? AND application_id = ?'
    ).get(userId, applicationId).count).toBe(1)
    expect(remote.database.prepare(
      'SELECT revision FROM workspace_revision WHERE id = 1'
    ).get().revision).toBe(remote.row.revision)
    remote.database.close()

    await storage.shutdownStorage()
    storage = null
    await Promise.all([
      fs.rm(sqlitePath, { force: true }),
      fs.rm(`${sqlitePath}-wal`, { force: true }),
      fs.rm(`${sqlitePath}-shm`, { force: true }),
    ])
    vi.resetModules()
    storage = await import('./storage.js')
    const restarted = await storage.readStore()
    expect(restarted.settings.notificationMailbox).toBe('full-write@example.test')
    await expect(storage.readAdmissionSignalReport(userId, applicationId)).resolves.toMatchObject({
      marker: 'narrow-write-marker',
    })
    expect(restarted.meta.revision).toBe(external.rows.get('postgresql:restart_target').revision)
  })

  it('keeps local workspace backups on a live SQLite source across encryption-mode replacement', async () => {
    const diskStore = await storage.readStore()
    diskStore.settings.encryptionAtRest = false
    diskStore.settings.sqliteEncryption = false
    await storage.writeStore(diskStore)

    const firstBackupStarted = deferred()
    const firstBackupRelease = deferred()
    const transitionWaiting = deferred()
    const transitionDrained = deferred()
    const transitionCloseRelease = deferred()
    const secondBackupWaiting = deferred()
    const events = []
    const backupSources = []
    let sourceGateWaitCount = 0
    let firstBackup
    let transition
    let secondBackup

    const originalBackup = Database.prototype.backup
    const backupSpy = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (...args) {
      backupSources.push(this)
      if (backupSources.length === 1) {
        events.push('first-backup-started')
        firstBackupStarted.resolve()
        await firstBackupRelease.promise
      }
      const result = await originalBackup.apply(this, args)
      events.push(`backup-${backupSources.length}-finished`)
      return result
    })
    const originalClose = Database.prototype.close
    const closeSpy = vi.spyOn(Database.prototype, 'close').mockImplementation(function (...args) {
      if (this === backupSources[0]) events.push('first-source-closed')
      return originalClose.apply(this, args)
    })

    vi.stubEnv('NODE_ENV', 'test')
    storage.configureDatabaseHandleReplacementFailpointForTests(async ({ stage }) => {
      events.push(stage)
      if (stage === 'database-source-gate-waiting') {
        sourceGateWaitCount += 1
        if (sourceGateWaitCount === 1) transitionWaiting.resolve()
        if (sourceGateWaitCount === 2) secondBackupWaiting.resolve()
      }
      if (stage === 'after-drain') {
        transitionDrained.resolve()
        await transitionCloseRelease.promise
      }
    })
    vi.stubEnv('NODE_ENV', 'development')

    try {
      firstBackup = storage.createBackup(diskStore, 'workspace-backup-race', null, 5, {
        prune: false,
      })
      await firstBackupStarted.promise

      const encryptedStore = await storage.readStore()
      encryptedStore.settings.encryptionAtRest = true
      encryptedStore.settings.sqliteEncryption = true
      transition = storage.writeStore(encryptedStore)
      await transitionWaiting.promise

      expect(backupSources).toHaveLength(1)
      expect(events).not.toContain('first-source-closed')

      firstBackupRelease.resolve()
      await transitionDrained.promise
      await expect(firstBackup).resolves.toMatchObject({ kind: 'workspace' })

      secondBackup = storage.createBackup(encryptedStore, 'workspace-backup-race', null, 5, {
        prune: false,
      })
      await secondBackupWaiting.promise
      expect(backupSources).toHaveLength(1)
      expect(events).not.toContain('first-source-closed')

      transitionCloseRelease.resolve()
      await expect(transition).resolves.toBeTruthy()
      await expect(secondBackup).resolves.toMatchObject({ kind: 'workspace' })

      expect(backupSources).toHaveLength(2)
      expect(backupSources[1]).not.toBe(backupSources[0])
      expect(events.indexOf('backup-1-finished')).toBeLessThan(events.indexOf('after-drain'))
      expect(events.indexOf('after-drain')).toBeLessThan(events.indexOf('first-source-closed'))
      expect(events.indexOf('first-source-closed')).toBeLessThan(events.indexOf('backup-2-finished'))
    } finally {
      firstBackupRelease.resolve()
      transitionCloseRelease.resolve()
      await firstBackup?.catch(() => undefined)
      await transition?.catch(() => undefined)
      await secondBackup?.catch(() => undefined)
      storage.configureDatabaseHandleReplacementFailpointForTests(null)
      backupSpy.mockRestore()
      closeSpy.mockRestore()
    }
  }, 120_000)

  it('drains an in-flight external snapshot before replacing its SQLite source handle', async () => {
    await storage.configureDatabaseConfiguration(postgresql('handle_transition'), {
      allowExistingState: false,
    })
    const seeded = await storage.readStore()
    const userId = seeded.users[0].id
    const applicationId = seeded.applications[0].id
    const snapshotStarted = deferred()
    const snapshotRelease = deferred()
    const transitionStarted = deferred()
    const transitionDrained = deferred()
    const transitionCloseRelease = deferred()
    const forcedSyncWaiting = deferred()
    const events = []
    let sourceDatabase = null
    let blockedSnapshot = false
    let transition
    let lateWrite
    let lateFlush

    const originalBackup = Database.prototype.backup
    const backupSpy = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (...args) {
      sourceDatabase ??= this
      if (!blockedSnapshot) {
        blockedSnapshot = true
        events.push('snapshot-started')
        snapshotStarted.resolve()
        await snapshotRelease.promise
        const result = await originalBackup.apply(this, args)
        events.push('snapshot-finished')
        return result
      }
      return originalBackup.apply(this, args)
    })
    const originalClose = Database.prototype.close
    const closeSpy = vi.spyOn(Database.prototype, 'close').mockImplementation(function (...args) {
      if (this === sourceDatabase) events.push('source-closed')
      return originalClose.apply(this, args)
    })

    vi.stubEnv('NODE_ENV', 'test')
    storage.configureDatabaseHandleReplacementFailpointForTests(async ({ stage }) => {
      events.push(stage)
      if (stage === 'before-drain') transitionStarted.resolve()
      if (stage === 'after-drain') {
        transitionDrained.resolve()
        await transitionCloseRelease.promise
      }
      if (stage === 'external-sync-waiting') forcedSyncWaiting.resolve()
    })
    vi.stubEnv('NODE_ENV', 'development')

    try {
      await storage.writeAdmissionSignalReport(userId, applicationId, {
        marker: 'before-handle-transition',
      })
      await snapshotStarted.promise

      const update = await storage.readStore()
      update.settings.notificationMailbox = 'handle-transition@example.test'
      transition = storage.writeStore(update)
      await transitionStarted.promise

      expect(events).toContain('snapshot-started')
      expect(events).toContain('before-drain')
      expect(events).not.toContain('snapshot-finished')
      expect(events).not.toContain('after-drain')
      expect(events).not.toContain('source-closed')

      snapshotRelease.resolve()
      await transitionDrained.promise
      let lateWriteSettled = false
      lateWrite = storage.writeAdmissionSignalReport(userId, applicationId, {
        marker: 'after-handle-transition',
      })
      void lateWrite.then(
        () => { lateWriteSettled = true },
        () => { lateWriteSettled = true },
      )
      lateFlush = storage.flushDurableStorage()
      await forcedSyncWaiting.promise

      expect(lateWriteSettled).toBe(false)
      expect(events).not.toContain('source-closed')
      transitionCloseRelease.resolve()
      await expect(transition).resolves.toBeTruthy()
      await expect(lateFlush).resolves.toBeUndefined()
      await expect(lateWrite).resolves.toMatchObject({
        marker: 'after-handle-transition',
      })
      await storage.flushDurableStorage()
      expect(events.indexOf('snapshot-finished')).toBeLessThan(events.indexOf('after-drain'))
      expect(events.indexOf('after-drain')).toBeLessThan(events.indexOf('source-closed'))
    } finally {
      snapshotRelease.resolve()
      transitionCloseRelease.resolve()
      await transition?.catch(() => undefined)
      await lateFlush?.catch(() => undefined)
      await lateWrite?.catch(() => undefined)
      storage.configureDatabaseHandleReplacementFailpointForTests(null)
      backupSpy.mockRestore()
      closeSpy.mockRestore()
    }

    const remote = await openRemoteWorkspace('handle_transition')
    try {
      expect(remote.database.prepare(
        'SELECT notification_mailbox AS mailbox FROM system_settings WHERE id = ?'
      ).get('global')).toEqual({ mailbox: 'handle-transition@example.test' })
      expect(remote.database.prepare(
        'SELECT COUNT(*) AS count FROM admission_signal_reports WHERE user_id = ? AND application_id = ?'
      ).get(userId, applicationId).count).toBe(1)
    } finally {
      remote.database.close()
    }

    await storage.shutdownStorage()
    storage = null
    await Promise.all([
      fs.rm(sqlitePath, { force: true }),
      fs.rm(`${sqlitePath}-wal`, { force: true }),
      fs.rm(`${sqlitePath}-shm`, { force: true }),
    ])
    vi.resetModules()
    storage = await import('./storage.js')
    const restarted = await storage.readStore()
    expect(restarted.settings.notificationMailbox).toBe('handle-transition@example.test')
    await expect(storage.readAdmissionSignalReport(userId, applicationId)).resolves.toMatchObject({
      marker: 'after-handle-transition',
    })
  })

  it('keeps the old SQLite handle authoritative when its pre-transition external flush fails', async () => {
    await storage.configureDatabaseConfiguration(postgresql('handle_transition_retry'), {
      allowExistingState: false,
    })
    const events = []
    let sourceDatabase = null
    const originalBackup = Database.prototype.backup
    const backupSpy = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (...args) {
      sourceDatabase ??= this
      return originalBackup.apply(this, args)
    })
    const originalClose = Database.prototype.close
    const closeSpy = vi.spyOn(Database.prototype, 'close').mockImplementation(function (...args) {
      if (this === sourceDatabase) events.push('source-closed')
      return originalClose.apply(this, args)
    })

    vi.stubEnv('NODE_ENV', 'test')
    storage.configureDatabaseHandleReplacementFailpointForTests(({ stage }) => events.push(stage))
    vi.stubEnv('NODE_ENV', 'development')

    try {
      const update = await storage.readStore()
      update.settings.notificationMailbox = 'handle-transition-retry@example.test'
      external.failuresRemaining = 1
      await expect(storage.writeStore(update)).rejects.toMatchObject({
        code: 'DATABASE_CONNECTION_FAILED',
      })
      const failedAttempt = external.writes.at(-1)
      expect(failedAttempt).toBeTruthy()
      expect(events).toContain('before-drain')
      expect(events).not.toContain('after-drain')
      expect(events).not.toContain('source-closed')

      const retry = await storage.readStore()
      retry.settings.notificationMailbox = 'handle-transition-confirmed@example.test'
      await expect(storage.writeStore(retry)).resolves.toBeTruthy()

      const exactRevisionAttempts = external.writes.filter(({ key, revision }) => (
        key === 'postgresql:handle_transition_retry' && revision === failedAttempt.revision
      ))
      expect(exactRevisionAttempts).toHaveLength(2)
      expect(exactRevisionAttempts[1].payload.equals(exactRevisionAttempts[0].payload)).toBe(true)
      expect(events).toContain('after-drain')
      expect(events).toContain('source-closed')
    } finally {
      storage.configureDatabaseHandleReplacementFailpointForTests(null)
      backupSpy.mockRestore()
      closeSpy.mockRestore()
    }

    const remote = await openRemoteWorkspace('handle_transition_retry')
    try {
      expect(remote.database.prepare(
        'SELECT notification_mailbox AS mailbox FROM system_settings WHERE id = ?'
      ).get('global')).toEqual({ mailbox: 'handle-transition-confirmed@example.test' })
    } finally {
      remote.database.close()
    }
  })

  it('does not let a stale tenant store reverse a completed encryption-mode transition', async () => {
    await storage.configureDatabaseConfiguration(postgresql('stale_policy_write'), {
      allowExistingState: false,
    })
    const enabled = await storage.readStore()
    enabled.settings.encryptionAtRest = true
    enabled.settings.notificationMailbox = 'policy-enabled@example.test'
    await storage.writeStore(enabled)

    const staleTenantStore = await storage.readStore()
    const disabled = await storage.readStore()
    disabled.settings.encryptionAtRest = false
    disabled.settings.notificationMailbox = 'policy-disabled@example.test'
    await storage.writeStore(disabled)
    expect(storage.getEncryptionPolicy().encryptionAtRest).toBe(false)

    const transitionStages = []
    vi.stubEnv('NODE_ENV', 'test')
    storage.configureDatabaseHandleReplacementFailpointForTests(({ stage }) => {
      transitionStages.push(stage)
    })
    vi.stubEnv('NODE_ENV', 'development')
    try {
      staleTenantStore.applications[0].snapshotCapacityProbe = 'stale-policy-tenant-write'
      await expect(storage.writeStore(staleTenantStore)).resolves.toBeTruthy()
      expect(storage.getEncryptionPolicy().encryptionAtRest).toBe(false)
      expect(transitionStages).not.toContain('before-drain')
    } finally {
      storage.configureDatabaseHandleReplacementFailpointForTests(null)
    }

    const remote = await openRemoteWorkspace('stale_policy_write')
    try {
      expect(remote.database.prepare(
        'SELECT encryption_at_rest AS enabled FROM system_settings WHERE id = ?'
      ).get('global')).toEqual({ enabled: 0 })
    } finally {
      remote.database.close()
    }

    await storage.shutdownStorage()
    storage = null
    await Promise.all([
      fs.rm(sqlitePath, { force: true }),
      fs.rm(`${sqlitePath}-wal`, { force: true }),
      fs.rm(`${sqlitePath}-shm`, { force: true }),
    ])
    vi.resetModules()
    storage = await import('./storage.js')
    const restarted = await storage.readStore()
    expect(restarted.settings.encryptionAtRest).toBe(false)
    expect(restarted.applications[0].snapshotCapacityProbe).toBe('stale-policy-tenant-write')
  })

  it('bounds a large external one-field snapshot and restores it in a fresh process image', async () => {
    const markerBytes = 6 * 1024 * 1024
    await storage.configureDatabaseConfiguration(postgresql('bounded_target'), { allowExistingState: false })
    const prepared = await storage.readStore()
    prepared.applications[0].snapshotCapacityProbe = 'e'.repeat(markerBytes)
    await storage.writeStore(prepared)

    const update = await storage.readStore()
    const writesBefore = external.writes.length
    const pidBefore = process.pid
    const baseline = process.memoryUsage()
    const peak = { ...baseline }
    const sample = () => {
      const current = process.memoryUsage()
      for (const field of ['rss', 'heapUsed', 'external', 'arrayBuffers']) {
        peak[field] = Math.max(peak[field], current[field])
      }
    }
    const sampler = setInterval(sample, 2)
    update.settings.notificationMailbox = 'external-bounded@example.test'
    await storage.writeStore(update)
    sample()
    clearInterval(sampler)

    const writes = external.writes.slice(writesBefore)
    const diagnostics = storage.externalDatabaseSyncDiagnostics().snapshotStorage
    expect(process.pid).toBe(pidBefore)
    expect(writes).toHaveLength(1)
    expect(writes[0].payload.length).toBeLessThanOrEqual(diagnostics.payloadLimitBytes)
    expect(writes.reduce((bytes, write) => bytes + write.payload.length, 0))
      .toBeLessThanOrEqual(diagnostics.payloadLimitBytes)
    expect(diagnostics).toMatchObject({
      mode: 'external-whole-snapshot',
      configuredLimitBytes: 64 * 1024 * 1024,
      memoryBudgetBytes: 512 * 1024 * 1024,
      memoryConstrained: true,
      supported: true,
    })
    expect(diagnostics.currentBytes).toBeLessThanOrEqual(diagnostics.effectiveLimitBytes)
    expect(peak.rss - baseline.rss).toBeLessThan(256 * 1024 * 1024)
    expect(peak.external - baseline.external).toBeLessThan(192 * 1024 * 1024)
    expect(peak.arrayBuffers - baseline.arrayBuffers).toBeLessThan(192 * 1024 * 1024)

    await storage.shutdownStorage()
    storage = null
    await Promise.all([
      fs.rm(sqlitePath, { force: true }),
      fs.rm(`${sqlitePath}-wal`, { force: true }),
      fs.rm(`${sqlitePath}-shm`, { force: true }),
    ])
    vi.resetModules()
    storage = await import('./storage.js')
    const restarted = await storage.readStore()
    expect(restarted.settings.notificationMailbox).toBe('external-bounded@example.test')
    expect(restarted.applications[0].snapshotCapacityProbe).toHaveLength(markerBytes)
  })

  it('rejects an oversized local-to-external migration before upload and keeps the local workspace active', async () => {
    const markerBytes = 26 * 1024 * 1024
    const prepared = await storage.readStore()
    prepared.applications[0].snapshotCapacityProbe = 'm'.repeat(markerBytes)
    await storage.writeStore(prepared)

    await expect(storage.configureDatabaseConfiguration(
      postgresql('oversized_target'),
      { allowExistingState: false },
    )).rejects.toMatchObject({
      code: 'DATABASE_SNAPSHOT_CAPACITY_EXCEEDED',
      status: 413,
    })

    expect(external.rows.has('postgresql:oversized_target')).toBe(false)
    expect(external.writes).toHaveLength(0)
    expect(storage.getDatabaseConfiguration()).toMatchObject({ type: 'sqlite' })
    expect(storage.externalDatabaseSyncDiagnostics().snapshotStorage).toMatchObject({
      mode: 'plain-local-sqlite',
      effectiveLimitBytes: null,
      highScaleRecommended: true,
    })
    const retained = await storage.readStore()
    expect(retained.applications[0].snapshotCapacityProbe).toHaveLength(markerBytes)
  })

  it('drains the old target, rejects narrow writes during maintenance, and never sends them to the new target', async () => {
    await storage.configureDatabaseConfiguration(postgresql('target_a'), { allowExistingState: false })
    const seeded = await storage.readStore()
    const userId = seeded.users[0].id
    const applicationId = seeded.applications[0].id
    const beforeRevision = external.rows.get('postgresql:target_a').revision
    external.blocker = {
      key: 'postgresql:target_a',
      used: false,
      started: deferred(),
      release: deferred(),
    }
    const oldWriteStarted = external.blocker.started.promise
    await storage.writeAdmissionSignalReport(userId, applicationId, {
      marker: 'before-target-switch',
    })
    const oldWrite = storage.flushDurableStorage()
    await oldWriteStarted

    const switching = storage.configureDatabaseConfiguration(
      postgresql('target_b'),
      { allowExistingState: false },
    )
    await vi.waitFor(() => expect(storage.externalDatabaseSyncDiagnostics().maintenance).toBe(true))
    await expect(storage.recordSecurityEvent('must-not-commit-during-switch'))
      .rejects.toMatchObject({ code: 'DATABASE_MAINTENANCE', status: 503 })
    external.blocker.release.resolve()
    await oldWrite
    await switching

    expect(external.rows.get('postgresql:target_a').revision).toBeGreaterThan(beforeRevision)
    const targetB = await openRemoteWorkspace('target_b')
    expect(targetB.database.prepare(
      'SELECT COUNT(*) AS count FROM admission_signal_reports WHERE user_id = ? AND application_id = ?'
    ).get(userId, applicationId).count).toBe(1)
    expect(targetB.database.prepare(
      'SELECT COUNT(*) AS count FROM system_events WHERE message = ?'
    ).get('must-not-commit-during-switch').count).toBe(0)
    targetB.database.close()
    expect(storage.externalDatabaseSyncDiagnostics()).toMatchObject({
      adapter: 'postgresql',
      status: 'idle',
      quarantined: false,
      snapshotStorage: {
        mode: 'external-whole-snapshot',
        strategy: 'whole-database-snapshot',
        enabled: true,
        supported: true,
        highScaleRecommended: false,
      },
    })
    const diagnostics = storage.externalDatabaseSyncDiagnostics().snapshotStorage
    expect(diagnostics.configuredLimitBytes).toBeGreaterThanOrEqual(diagnostics.effectiveLimitBytes)
    expect(diagnostics.effectiveLimitBytes).toBeGreaterThanOrEqual(diagnostics.currentBytes)
    expect(diagnostics.requiredMemoryBytes).toBeGreaterThan(0)
    expect(diagnostics.memoryBudgetBytes).toBeGreaterThan(0)
  })

  it('retries a transient failure with the exact pending revision and reports recovery', async () => {
    await storage.configureDatabaseConfiguration(postgresql('retry_target'), { allowExistingState: false })
    const seeded = await storage.readStore()
    const userId = seeded.users[0].id
    const applicationId = seeded.applications[0].id
    const previous = external.rows.get('postgresql:retry_target').revision
    const failureObserved = deferred()
    external.failureObserved = failureObserved
    external.failuresRemaining = 1
    const recovered = waitForAppliedWrite(({ key, revision }) => (
      key === 'postgresql:retry_target' && revision > previous
    ))

    await storage.writeAdmissionSignalReport(userId, applicationId, { marker: 'retry-marker' })
    const firstFlush = storage.flushDurableStorage()
    await failureObserved.promise
    await expect(firstFlush).rejects.toMatchObject({ code: 'DATABASE_CONNECTION_FAILED' })
    await vi.waitFor(() => expect(storage.externalDatabaseSyncDiagnostics()).toMatchObject({
      status: 'retrying',
      retryAttempt: 1,
      quarantined: false,
    }))
    await recovered
    await vi.waitFor(() => expect(storage.externalDatabaseSyncDiagnostics()).toMatchObject({
      status: 'healthy',
      retryAttempt: 0,
      quarantined: false,
    }))

    const attempts = external.writes.filter(({ key, revision }) => (
      key === 'postgresql:retry_target' && revision > previous
    ))
    expect(attempts).toHaveLength(2)
    expect(attempts[1].revision).toBe(attempts[0].revision)
    expect(attempts[1].payload.equals(attempts[0].payload)).toBe(true)
  })

  it('quarantines a stale local fork, blocks further writes, and permits an explicit target switch', async () => {
    await storage.configureDatabaseConfiguration(postgresql('stale_target'), { allowExistingState: false })
    const seeded = await storage.readStore()
    const userId = seeded.users[0].id
    const applicationId = seeded.applications[0].id
    const remote = external.rows.get('postgresql:stale_target')
    external.rows.set('postgresql:stale_target', {
      ...remote,
      revision: remote.revision + 1_000,
    })

    await storage.writeAdmissionSignalReport(userId, applicationId, {
      marker: 'local-fork-marker',
    })
    await expect(storage.flushDurableStorage()).rejects.toMatchObject({
      code: 'DATABASE_EXTERNAL_REVISION_STALE',
      status: 409,
    })
    await vi.waitFor(() => expect(storage.externalDatabaseSyncDiagnostics()).toMatchObject({
      status: 'quarantined',
      quarantined: true,
      lastError: { code: 'DATABASE_EXTERNAL_REVISION_STALE' },
    }))
    await expect(storage.recordSecurityEvent('must-be-blocked-after-quarantine'))
      .rejects.toMatchObject({ code: 'DATABASE_EXTERNAL_SYNC_QUARANTINED', status: 503 })

    await storage.configureDatabaseConfiguration(postgresql('recovery_target'), { allowExistingState: false })
    expect(storage.externalDatabaseSyncDiagnostics()).toMatchObject({
      status: 'idle',
      quarantined: false,
    })
    const recovered = await openRemoteWorkspace('recovery_target')
    expect(recovered.database.prepare(
      'SELECT COUNT(*) AS count FROM admission_signal_reports WHERE user_id = ? AND application_id = ?'
    ).get(userId, applicationId).count).toBe(1)
    expect(recovered.database.prepare(
      'SELECT COUNT(*) AS count FROM system_events WHERE message = ?'
    ).get('must-be-blocked-after-quarantine').count).toBe(0)
    recovered.database.close()
  })

  it('does not acknowledge a mail enqueue until the selected database contains it', async () => {
    await storage.configureDatabaseConfiguration(postgresql('mail_enqueue_ack'), { allowExistingState: false })
    const userId = (await storage.readStore()).users[0].id
    external.failuresRemaining = 1

    const firstAttempt = await storage.enqueueMailSyncJob(userId, 'incremental')
      .then(() => null, (error) => error)
    expect(firstAttempt).toMatchObject({ code: 'DATABASE_CONNECTION_FAILED' })
    expect(await storage.getMailFetchState(userId)).toMatchObject({
      syncJob: { status: 'queued' },
    })

    const retried = await storage.enqueueMailSyncJob(userId, 'incremental')
    expect(retried).toMatchObject({ alreadyQueued: true })
    const remote = await openRemoteWorkspace('mail_enqueue_ack')
    expect(remote.database.prepare(
      'SELECT sync_job_id AS id, sync_job_status AS status FROM mail_fetch_state WHERE user_id = ?',
    ).get(userId)).toEqual({ id: retried.job.id, status: 'queued' })
    remote.database.close()
  })

  it('acks deferred mail business data and its continuation in one recoverable revision', async () => {
    await storage.configureDatabaseConfiguration(postgresql('mail_checkpoint_ack'), { allowExistingState: false })
    const initial = await storage.readStore()
    const userId = initial.users[0].id
    const queued = await storage.enqueueMailSyncJob(userId, 'history')
    await storage.claimNextMailSyncJob(queued.job.id)

    const changed = await storage.readStore()
    changed.settings.notificationMailbox = 'mail-checkpoint-durable@example.test'
    const continuation = {
      accountKey: 'imap:mail-checkpoint-test',
      mode: 'history',
      mailSyncGeneration: 'generation-1',
      whitelistDigest: 'a'.repeat(64),
      folderStates: { INBOX: { uidValidity: '9', lastUid: 42 } },
      totals: { fetched: 4, filed: 3, duplicates: 1, scannedUids: 42 },
    }
    await expect(storage.writeStore(changed, {
      deferExternalDatabaseSync: true,
      mailSyncContinuation: { jobId: queued.job.id, userId, value: continuation },
    })).resolves.toMatchObject({
      mailSyncContinuation: { folderStates: continuation.folderStates },
    })
    external.failuresRemaining = 1
    await expect(storage.flushDurableStorage())
      .rejects.toMatchObject({ code: 'DATABASE_CONNECTION_FAILED' })

    // A duplicate replay makes no second business-store write. Re-saving the
    // same checkpoint must nevertheless force/verify the selected snapshot.
    const afterFailure = await storage.getMailFetchState(userId)
    if (afterFailure.syncJob?.status === 'running') {
      await storage.retryMailSyncJob(queued.job.id, {
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        errorCode: 'DATABASE_CONNECTION_FAILED',
        errorMessage: 'retry combined mail checkpoint',
      })
    }
    await storage.claimNextMailSyncJob(queued.job.id)
    await expect(storage.saveMailSyncJobContinuation(queued.job.id, userId, continuation))
      .resolves.toMatchObject({ folderStates: continuation.folderStates })

    const remote = await openRemoteWorkspace('mail_checkpoint_ack')
    expect(remote.database.prepare(
      'SELECT notification_mailbox AS mailbox FROM system_settings WHERE id = ?',
    ).get('global')).toEqual({ mailbox: 'mail-checkpoint-durable@example.test' })
    expect(JSON.parse(remote.database.prepare(
      'SELECT sync_job_resume_json AS value FROM mail_fetch_state WHERE user_id = ?',
    ).get(userId).value)).toMatchObject({
      folderStates: continuation.folderStates,
      totals: { filed: 3, duplicates: 1 },
    })
    remote.database.close()

    await storage.shutdownStorage()
    storage = null
    await Promise.all([
      fs.rm(sqlitePath, { force: true }),
      fs.rm(`${sqlitePath}-wal`, { force: true }),
      fs.rm(`${sqlitePath}-shm`, { force: true }),
    ])
    vi.resetModules()
    storage = await import('./storage.js')
    expect((await storage.readStore()).settings.notificationMailbox)
      .toBe('mail-checkpoint-durable@example.test')
    await expect(storage.claimNextMailSyncJob(queued.job.id)).resolves.toMatchObject({
      continuation: {
        folderStates: continuation.folderStates,
        totals: { filed: 3, duplicates: 1 },
      },
    })
  })

  it('keeps a failed terminal flush non-successful and durably requeues it', async () => {
    await storage.configureDatabaseConfiguration(postgresql('mail_finish_ack'), { allowExistingState: false })
    const userId = (await storage.readStore()).users[0].id
    const queued = await storage.enqueueMailSyncJob(userId, 'incremental')
    await storage.claimNextMailSyncJob(queued.job.id)
    external.failuresRemaining = 1

    await expect(storage.finishMailSyncJob(queued.job.id, {
      status: 'succeeded',
      result: { filed: 1, stateCommitted: true },
    })).rejects.toMatchObject({ code: 'DATABASE_CONNECTION_FAILED' })
    expect(await storage.getMailFetchState(userId)).toMatchObject({
      syncJob: { id: queued.job.id, status: 'running', result: null },
    })

    const nextAttemptAt = new Date(Date.now() + 5_000).toISOString()
    await expect(storage.retryMailSyncJob(queued.job.id, {
      nextAttemptAt,
      errorCode: 'DATABASE_CONNECTION_FAILED',
      errorMessage: 'retry durable terminal transition',
    })).resolves.toMatchObject({ status: 'queued', nextAttemptAt })
    const remote = await openRemoteWorkspace('mail_finish_ack')
    expect(remote.database.prepare(
      `SELECT sync_job_status AS status, sync_job_terminal_status AS terminalStatus
       FROM mail_fetch_state WHERE user_id = ?`,
    ).get(userId)).toEqual({ status: 'queued', terminalStatus: null })
    remote.database.close()
  })

  it('bulk-enqueues automatic mail work with one snapshot and indexed sequence allocation', async () => {
    await storage.configureDatabaseConfiguration(postgresql('mail_bulk_ack'), { allowExistingState: false })
    const userIds = (await storage.readStore()).users.slice(0, 3).map(({ id }) => id)
    expect(userIds.length).toBeGreaterThan(0)
    const writesBefore = external.writes.length
    const results = await storage.enqueueMailSyncJobs(userIds, 'incremental')
    expect(results).toHaveLength(userIds.length)
    expect(external.writes.length - writesBefore).toBe(1)

    const remote = await openRemoteWorkspace('mail_bulk_ack')
    expect(remote.database.prepare(
      `SELECT COUNT(*) AS count FROM mail_fetch_state
       WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND sync_job_status = 'queued'`,
    ).get(...userIds).count).toBe(userIds.length)
    const queryPlan = remote.database.prepare(
      'EXPLAIN QUERY PLAN SELECT MAX(sync_job_schedule_sequence) FROM mail_fetch_state',
    ).all().map((row) => String(row.detail)).join(' ')
    expect(queryPlan).toContain('idx_mail_fetch_sync_schedule_sequence')
    remote.database.close()
  })
})
