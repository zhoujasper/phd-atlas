// @vitest-environment node

import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { acquireEncryptedSqliteProcessLease } from './sqliteProcessLease.js'

let storage
let testRoot

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-storage-shutdown-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'workspace.sqlite'))
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'shutdown-lifecycle-server-key-32-bytes')
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'shutdown-lifecycle-settings-key-32-bytes')
  vi.stubEnv('PHD_ATLAS_FORCE_SQLITE_SEAL_TEST', '1')
  vi.resetModules()
  storage = await import('./storage.js')
})

afterAll(async () => {
  storage?.configureStorageShutdownDurabilityFailpointForTests(null)
  storage?.configureDatabaseConfigurationSealFailpointForTests(null)
  storage?.configureStorageInitializationFailpointForTests(null)
  await storage?.shutdownStorage().catch(() => undefined)
  vi.unstubAllEnvs()
  vi.resetModules()
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
})

describe.sequential('storage shutdown durability handoff', () => {
  it('retains the resident database and lease until a failed final durability boundary recovers', async () => {
    const workspace = await storage.readStore()
    workspace.settings.encryptionAtRest = true
    workspace.settings.sqliteEncryption = true
    workspace.settings.notificationMailbox = 'shutdown-retained@example.test'
    await storage.writeStore(workspace)

    let attempts = 0
    storage.configureStorageShutdownDurabilityFailpointForTests(() => {
      attempts += 1
      const error = new Error('Injected final seal failure.')
      error.code = 'INJECTED_FINAL_DURABILITY_FAILURE'
      throw error
    })

    await expect(storage.shutdownStorage()).rejects.toMatchObject({
      code: 'INJECTED_FINAL_DURABILITY_FAILURE',
      shutdownDurabilityRetained: true,
    })
    expect(attempts).toBe(3)
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: true,
      shuttingDown: true,
      shutdownDurabilityFailed: true,
      databaseOpen: true,
      leaseHeld: true,
      databaseLeaseHeld: true,
      serviceLeaseHeld: true,
    })
    await expect(storage.ensureStorage()).rejects.toMatchObject({
      code: 'STORAGE_SHUTTING_DOWN',
    })

    storage.configureStorageShutdownDurabilityFailpointForTests(null)
    await expect(storage.shutdownStorage()).resolves.toBeUndefined()
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: false,
      shuttingDown: false,
      shutdownDurabilityFailed: false,
      databaseOpen: false,
      leaseHeld: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    })

    // A completed shutdown may be reopened only through full initialization,
    // which reacquires the sidecar lease before the database can be touched.
    await storage.ensureStorage()
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: true,
      leaseHeld: true,
      databaseLeaseHeld: true,
      serviceLeaseHeld: true,
    })
    expect((await storage.readStore()).settings.notificationMailbox)
      .toBe('shutdown-retained@example.test')
  }, 120_000)

  it('is idempotent after an early acknowledgement error but a successful final seal and close', async () => {
    const lateSnapshot = await storage.readStore()
    let rejectAcknowledgement
    let markEntered
    const entered = new Promise((resolve) => { markEntered = resolve })
    storage.configureDurableStorageAcknowledgementFailpointForTests(() => new Promise((_, reject) => {
      rejectAcknowledgement = reject
      markEntered()
    }))
    const challengeMutation = storage.createWebAuthnChallenge({
      purpose: 'authentication',
      challenge: randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      metadata: { scope: 'app' },
    })
    await entered
    const shutdown = storage.shutdownStorage()
    const acknowledgementError = new Error('Injected in-flight acknowledgement failure.')
    acknowledgementError.code = 'INJECTED_IN_FLIGHT_ACK_FAILURE'
    rejectAcknowledgement(acknowledgementError)
    await expect(challengeMutation).rejects.toBe(acknowledgementError)
    await expect(shutdown).rejects.toBe(acknowledgementError)
    storage.configureDurableStorageAcknowledgementFailpointForTests(null)

    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: false,
      shuttingDown: false,
      shutdownDurabilityFailed: false,
      databaseOpen: false,
      leaseHeld: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    })
    await expect(storage.shutdownStorage()).resolves.toBeUndefined()

    await expect(storage.writeStore(lateSnapshot)).rejects.toMatchObject({
      code: 'STORAGE_SHUTDOWN',
    })
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      databaseOpen: false,
      leaseHeld: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    })
    await expect(fs.stat(storage.databasePath)).rejects.toMatchObject({ code: 'ENOENT' })
    const handoffLease = await acquireEncryptedSqliteProcessLease(storage.databasePath, { waitMs: 0 })
    await handoffLease.release()
  }, 120_000)

  it('keeps the latest resident image when a same-path encrypted publish fails', async () => {
    await storage.ensureStorage()
    const baseline = await storage.readStore()
    baseline.settings.notificationMailbox = 'same-path-sealed-baseline@example.test'
    await storage.writeStore(baseline)
    await storage.flushDurableStorage()

    const latest = await storage.readStore()
    latest.settings.notificationMailbox = 'same-path-resident-latest@example.test'
    await storage.writeStore(latest)
    const injectedError = Object.assign(new Error('Injected local target seal failure.'), {
      code: 'INJECTED_DATABASE_CONFIGURATION_SEAL_FAILURE',
    })
    storage.configureDatabaseConfigurationSealFailpointForTests(() => {
      throw injectedError
    })

    await expect(storage.configureDatabaseConfiguration({
      type: 'sqlite',
      sqlitePath: storage.databasePath,
    })).rejects.toBe(injectedError)
    expect((await storage.readStore()).settings.notificationMailbox)
      .toBe('same-path-resident-latest@example.test')
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: true,
      databaseOpen: true,
      databaseLeaseHeld: true,
      serviceLeaseHeld: true,
    })

    storage.configureDatabaseConfigurationSealFailpointForTests(null)
    await storage.flushDurableStorage()
    await storage.shutdownStorage()
    await storage.ensureStorage()
    expect((await storage.readStore()).settings.notificationMailbox)
      .toBe('same-path-resident-latest@example.test')
  }, 120_000)

  it('aborts incomplete encrypted initialization and releases both ownership levels', async () => {
    await storage.shutdownStorage()
    let markEntered
    const entered = new Promise((resolve) => { markEntered = resolve })
    storage.configureStorageInitializationFailpointForTests(({ signal }) => new Promise((_, reject) => {
      const onAbort = () => reject(signal.reason)
      markEntered()
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }))

    const initialization = storage.ensureStorage()
    await entered
    const shutdown = storage.shutdownStorage()
    await expect(initialization).rejects.toMatchObject({ code: 'STORAGE_SHUTTING_DOWN' })
    await expect(shutdown).resolves.toBeUndefined()
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: false,
      initializing: false,
      shuttingDown: false,
      databaseOpen: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    })

    storage.configureStorageInitializationFailpointForTests(null)
    await storage.ensureStorage()
    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: true,
      databaseLeaseHeld: true,
      serviceLeaseHeld: true,
    })
  }, 120_000)

  it('prevents a late continuation from reacquiring either lease after terminal handoff', async () => {
    storage.requestStorageTerminalShutdown()
    // Work already inside the initialized owner may still finish while the
    // listener drains; terminal ownership applies once shutdown releases it.
    await expect(storage.ensureStorage()).resolves.toBeUndefined()
    await storage.shutdownStorage({ terminal: true })

    expect(storage.storageLifecycleDiagnostics()).toMatchObject({
      initialized: false,
      initializing: false,
      shuttingDown: false,
      terminalShutdownRequested: true,
      databaseOpen: false,
      databaseLeaseHeld: false,
      serviceLeaseHeld: false,
    })
    await expect(storage.ensureStorage()).rejects.toMatchObject({
      code: 'STORAGE_TERMINATED',
    })

    const serviceLease = await acquireEncryptedSqliteProcessLease(
      path.join(testRoot, '.phd-atlas-runtime-owner'),
      { waitMs: 0 },
    )
    const databaseLease = await acquireEncryptedSqliteProcessLease(storage.databasePath, { waitMs: 0 })
    await databaseLease.release()
    await serviceLease.release()
  }, 120_000)
})
