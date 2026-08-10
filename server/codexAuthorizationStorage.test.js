import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let storage
let testRoot
let userId
let sqlitePath

function digest(label) {
  return createHash('sha256').update(`${label}:${randomUUID()}`).digest('hex')
}

function authorizationMaterial(label, overrides = {}) {
  const selectorDigest = digest(`${label}:selector`)
  const tokenHash = digest(`${label}:token`)
  return {
    tokenSelector: `sel_${selectorDigest.slice(0, 28)}`,
    tokenHash,
    tokenHint: tokenHash.slice(-6),
    name: label,
    clientName: 'Codex CLI',
    clientVersion: '1.0.0-test',
    deviceName: 'Storage test',
    scopes: ['applications:read', 'applications:write'],
    scopeVersion: 2,
    ...overrides,
  }
}

function deviceMaterial(label, overrides = {}) {
  return {
    deviceCodeHash: digest(`${label}:device`),
    userCodeHash: digest(`${label}:user`),
    clientName: 'Codex CLI',
    clientVersion: '1.0.0-test',
    deviceName: label,
    requestedScopes: ['applications:read', 'applications:write'],
    scopeVersion: 2,
    pollIntervalSeconds: 5,
    ...overrides,
  }
}

function timestamp(base, offsetMs = 0) {
  return new Date(base + offsetMs).toISOString()
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(tmpdir(), 'phd-atlas-codex-storage-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', path.join(testRoot, 'phd-atlas.sqlite'))
  vi.stubEnv('CODEX_TELEMETRY_PERSIST_INTERVAL_MINUTES', '5')
  vi.resetModules()
  storage = await import('./storage.js')
  const store = await storage.readStore()
  userId = store.users[0].id
  sqlitePath = storage.databasePath
})

afterEach(async () => {
  if (!storage || !userId) return
  storage.configureDurableStorageAcknowledgementFailpointForTests(null)
  await storage.revokeAllCodexAuthorizations(userId, {
    reason: 'focused_test_cleanup',
  })
})

afterAll(async () => {
  await storage?.shutdownStorage()
  if (sqlitePath) {
    await Promise.all([
      fs.rm(sqlitePath, { force: true }),
      fs.rm(`${sqlitePath}-wal`, { force: true }),
      fs.rm(`${sqlitePath}-shm`, { force: true }),
    ])
  }
  if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe.sequential('Codex authorization storage', () => {
  it('keeps a failed durable revoke pending across an idempotent retry and restart', async () => {
    const base = Date.now()
    const material = authorizationMaterial('Durable revoke retry')
    const created = await storage.createCodexAuthorization({
      userId,
      ...material,
      createdAt: timestamp(base),
    })
    const unavailable = Object.assign(new Error('Injected durable acknowledgement failure.'), {
      code: 'INJECTED_DURABLE_ACK_FAILED',
      status: 503,
    })
    storage.configureDurableStorageAcknowledgementFailpointForTests(() => { throw unavailable })

    await expect(storage.revokeCodexAuthorization(userId, created.id, {
      at: timestamp(base, 1_000),
    })).rejects.toBe(unavailable)
    await expect(storage.revokeCodexAuthorization(userId, created.id, {
      at: timestamp(base, 2_000),
    })).rejects.toBe(unavailable)

    storage.configureDurableStorageAcknowledgementFailpointForTests(null)
    await expect(storage.revokeCodexAuthorization(userId, created.id, {
      at: timestamp(base, 3_000),
    })).resolves.toMatchObject({ status: 'revoked' })

    await storage.shutdownStorage()
    vi.resetModules()
    storage = await import('./storage.js')
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      material.tokenSelector,
      { at: timestamp(base, 4_000) },
    )).resolves.toBeNull()
  })

  it('stores only credential material internally and exposes a safe, revocable projection', async () => {
    const base = Date.now()
    const rawSecret = digest('Lifecycle raw bearer secret')
    const material = authorizationMaterial('Lifecycle', {
      tokenHash: createHash('sha256').update(rawSecret).digest('hex'),
    })
    const created = await storage.createCodexAuthorization({
      userId,
      ...material,
      createdAt: timestamp(base),
    })

    expect(created).toMatchObject({
      userId,
      name: 'Lifecycle',
      scopes: ['applications:read', 'applications:write'],
      status: 'active',
      active: true,
    })
    expect(JSON.stringify(created)).not.toContain(material.tokenHash)
    expect(JSON.stringify(created)).not.toContain(material.tokenSelector)

    const inspectionDatabase = new Database(sqlitePath, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      const columns = inspectionDatabase
        .prepare('PRAGMA table_info(codex_authorizations)')
        .all()
        .map((column) => column.name)
      const stored = inspectionDatabase.prepare(
        'SELECT * FROM codex_authorizations WHERE id = ?',
      ).get(created.id)
      expect(columns).toContain('token_hash')
      expect(columns).not.toContain('token')
      expect(columns).not.toContain('token_secret')
      expect(stored.token_hash).toBe(material.tokenHash)
      expect(JSON.stringify(stored)).not.toContain(rawSecret)
    } finally {
      inspectionDatabase.close()
    }

    const credential = await storage.findCurrentCodexAuthorizationBySelector(
      material.tokenSelector,
      { at: timestamp(base, 1_000) },
    )
    expect(credential).toMatchObject({
      id: created.id,
      tokenHash: material.tokenHash,
      issuedAuthVersion: expect.any(Number),
    })

    const firstTouch = await storage.touchCodexAuthorizationLastUsed(created.id, {
      at: timestamp(base, 2_000),
      minIntervalMs: 60_000,
    })
    const throttledTouch = await storage.touchCodexAuthorizationLastUsed(created.id, {
      at: timestamp(base, 32_000),
      minIntervalMs: 60_000,
    })
    const laterTouch = await storage.touchCodexAuthorizationLastUsed(created.id, {
      at: timestamp(base, 63_000),
      minIntervalMs: 60_000,
    })
    expect(firstTouch.touched).toBe(true)
    expect(throttledTouch.touched).toBe(false)
    expect(laterTouch.touched).toBe(true)

    const reduced = await storage.updateCodexAuthorization(
      userId,
      created.id,
      { name: 'Lifecycle renamed', scopes: ['applications:read'] },
      { at: timestamp(base, 64_000) },
    )
    expect(reduced).toMatchObject({
      name: 'Lifecycle renamed',
      scopes: ['applications:read'],
    })
    await expect(storage.updateCodexAuthorization(
      userId,
      created.id,
      { scopes: ['applications:read', 'profile:read'] },
      { at: timestamp(base, 65_000) },
    )).rejects.toMatchObject({ code: 'CODEX_SCOPE_EXPANSION_REQUIRES_APPROVAL' })

    const revoked = await storage.revokeCodexAuthorization(userId, created.id, {
      reason: 'test_revoked',
      at: timestamp(base, 66_000),
    })
    const repeated = await storage.revokeCodexAuthorization(userId, created.id, {
      reason: 'second_reason_must_not_replace',
      at: timestamp(base, 67_000),
    })
    expect(revoked).toMatchObject({ status: 'revoked', revokedReason: 'test_revoked' })
    expect(repeated.revokedAt).toBe(revoked.revokedAt)
    expect(repeated.revokedReason).toBe('test_revoked')
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      material.tokenSelector,
      { at: timestamp(base, 68_000) },
    )).resolves.toBeNull()

    const audit = await storage.querySystemEvents({
      scope: 'Codex authorization',
      search: created.id,
      pageSize: 100,
    })
    expect(audit.items.some((event) => event.message === 'Created Codex authorization')).toBe(true)
    expect(JSON.stringify(audit.items)).not.toContain(material.tokenHash)
    expect(JSON.stringify(audit.items)).not.toContain(material.tokenSelector)
  })

  it('fails closed on unsupported scopes and expires credentials after 180 idle days', async () => {
    const base = Date.now()
    const longHint = `phda_cdx_v1_${digest('long hint').slice(0, 44)}`
    const material = authorizationMaterial('Idle expiry', { tokenHint: longHint })
    const created = await storage.createCodexAuthorization({
      userId,
      ...material,
      createdAt: timestamp(base),
    })
    expect(created.tokenHint).toBe(longHint)

    const beforeBoundary = await storage.getCodexAuthorizationById(userId, created.id, {
      at: timestamp(base, storage.CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS - 1),
    })
    const atBoundary = await storage.getCodexAuthorizationById(userId, created.id, {
      at: timestamp(base, storage.CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS),
    })
    expect(beforeBoundary).toMatchObject({ status: 'active', active: true })
    expect(atBoundary).toMatchObject({ status: 'idle_expired', active: false })
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      material.tokenSelector,
      { at: timestamp(base, storage.CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS) },
    )).resolves.toBeNull()

    await expect(storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('No scopes', { scopes: [] }),
    })).rejects.toMatchObject({ code: 'INVALID_CODEX_AUTHORIZATION_SCOPES' })
    await expect(storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('Unknown scope', { scopes: ['future:superuser'] }),
    })).rejects.toMatchObject({ code: 'INVALID_CODEX_AUTHORIZATION_SCOPES' })
    await expect(storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('Future scope version', { scopeVersion: 3 }),
    })).rejects.toMatchObject({ code: 'INVALID_CODEX_SCOPE_VERSION' })

    expect(storage.publicCodexAuthorization({
      id: 'legacy_invalid_scope',
      user_id: userId,
      account_id: userId,
      account_settings_json: '{}',
      name: 'Legacy invalid',
      token_hint: '',
      client_name: '',
      client_version: '',
      device_name: '',
      scopes_json: JSON.stringify(['future:superuser']),
      scope_version: 1,
      issued_auth_version: 0,
      created_at: timestamp(base),
      updated_at: timestamp(base),
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      revoked_reason: null,
    }, { at: timestamp(base, 1_000) })).toMatchObject({
      status: 'invalidated',
      active: false,
    })
  })

  it('uses the canonical auth-version scalar without materializing legacy settings JSON', async () => {
    const material = authorizationMaterial('Scalar auth version')
    const created = await storage.createCodexAuthorization({ userId, ...material })
    const inspectionDatabase = new Database(sqlitePath, { fileMustExist: true })
    let originalSettings
    let authVersion
    try {
      const account = inspectionDatabase.prepare(
        'SELECT settings_json, auth_version FROM users WHERE id = ?',
      ).get(userId)
      originalSettings = account.settings_json
      authVersion = Number(account.auth_version)
      inspectionDatabase.prepare(
        'UPDATE users SET settings_json = ? WHERE id = ?',
      ).run(JSON.stringify({ authVersion: authVersion + 1000, ignoredLegacyPayload: 'x'.repeat(4096) }), userId)

      await expect(storage.findCurrentCodexAuthorizationBySelector(material.tokenSelector))
        .resolves.toMatchObject({
          id: created.id,
          issuedAuthVersion: authVersion,
          account: { authVersion },
        })
    } finally {
      if (originalSettings !== undefined) {
        inspectionDatabase.prepare(
          'UPDATE users SET settings_json = ? WHERE id = ?',
        ).run(originalSettings, userId)
      }
      inspectionDatabase.close()
    }
  })

  it('coalesces 100 simultaneous activity touches into one bounded persistence batch', async () => {
    const base = Date.now()
    const touchedAt = timestamp(base, 61_000)
    const material = authorizationMaterial('Coalesced activity')
    const created = await storage.createCodexAuthorization({
      userId,
      ...material,
      createdAt: timestamp(base),
    })
    await storage.readStore()
    const cacheBefore = storage.sharedStoreCacheDiagnostics()
    const diagnosticsBefore = storage.codexAuthorizationLastUsedDiagnostics()

    const touches = await Promise.all(Array.from({ length: 100 }, () => (
      storage.touchCodexAuthorizationLastUsed(created.id, {
        at: touchedAt,
        minIntervalMs: 60_000,
      })
    )))
    expect(touches.filter((touch) => touch.touched)).toHaveLength(1)
    expect(touches.every((touch) => touch.authorization?.lastUsedAt === touchedAt)).toBe(true)
    expect(storage.codexAuthorizationLastUsedDiagnostics().pending).toBe(1)

    const flushed = await storage.flushCodexAuthorizationLastUsed()
    expect(flushed).toEqual({ batches: 1, persisted: 1, discarded: 0 })
    const diagnosticsAfterBatch = storage.codexAuthorizationLastUsedDiagnostics()
    expect(diagnosticsAfterBatch).toMatchObject({
      pending: 0,
      timerScheduled: true,
      telemetryDirty: true,
    })
    await storage.flushCodexTelemetryPersistence()
    const diagnosticsAfter = storage.codexAuthorizationLastUsedDiagnostics()
    expect(diagnosticsAfter).toMatchObject({
      pending: 0,
      timerScheduled: false,
      telemetryDirty: false,
    })
    expect(diagnosticsAfter.batches - diagnosticsBefore.batches).toBe(1)
    expect(diagnosticsAfter.persisted - diagnosticsBefore.persisted).toBe(1)
    expect(storage.sharedStoreCacheDiagnostics()).toEqual(cacheBefore)

    const inspectionDatabase = new Database(sqlitePath, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      expect(inspectionDatabase.prepare(
        'SELECT last_used_at FROM codex_authorizations WHERE id = ?',
      ).get(created.id)?.last_used_at).toBe(touchedAt)
    } finally {
      inspectionDatabase.close()
    }
  })

  it('keeps the sole telemetry timer when an expired bearer lookup clears an empty overlay', async () => {
    const base = Date.now()
    const expiringAuthorization = authorizationMaterial('Timer preservation', {
      expiresAt: timestamp(base, 1_000),
    })
    await storage.createCodexAuthorization({
      userId,
      ...expiringAuthorization,
      createdAt: timestamp(base),
    })
    const device = deviceMaterial('Timer preservation poll', {
      createdAt: timestamp(base),
      expiresAt: timestamp(base, 60 * 60_000),
    })
    await storage.createCodexDeviceAuthorization(device)

    vi.useFakeTimers()
    try {
      const acknowledgementsBefore = storage.durableStorageAckDiagnostics().attempts
      await storage.pollCodexDeviceAuthorization(device.deviceCodeHash, {
        at: timestamp(base, 500),
      })
      expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore)
      expect(storage.codexAuthorizationLastUsedDiagnostics()).toMatchObject({
        pending: 0,
        timerScheduled: true,
        telemetryDirty: true,
      })

      await expect(storage.findCurrentCodexAuthorizationBySelector(
        expiringAuthorization.tokenSelector,
        { at: timestamp(base, 2_000) },
      )).resolves.toBeNull()
      expect(storage.codexAuthorizationLastUsedDiagnostics()).toMatchObject({
        pending: 0,
        timerScheduled: true,
        telemetryDirty: true,
      })

      await vi.advanceTimersByTimeAsync(storage.CODEX_TELEMETRY_PERSIST_INTERVAL_MS)
      expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore + 1)
      expect(storage.codexAuthorizationLastUsedDiagnostics()).toMatchObject({
        timerScheduled: false,
        telemetryDirty: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a failed durable device expiry acknowledgement on the idempotent expired poll', async () => {
    const base = Date.now()
    const device = deviceMaterial('Durable expiry retry', {
      createdAt: timestamp(base),
      expiresAt: timestamp(base, 1_000),
    })
    await storage.createCodexDeviceAuthorization(device)
    const acknowledgementsBefore = storage.durableStorageAckDiagnostics().attempts
    let failOnce = true
    storage.configureDurableStorageAcknowledgementFailpointForTests(() => {
      if (!failOnce) return
      failOnce = false
      const error = new Error('Injected expiry acknowledgement failure.')
      error.code = 'INJECTED_DURABILITY_FAILURE'
      throw error
    })

    await expect(storage.pollCodexDeviceAuthorization(device.deviceCodeHash, {
      at: timestamp(base, 2_000),
    })).rejects.toMatchObject({ code: 'INJECTED_DURABILITY_FAILURE' })
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore + 1)

    storage.configureDurableStorageAcknowledgementFailpointForTests(null)
    await expect(storage.pollCodexDeviceAuthorization(device.deviceCodeHash, {
      at: timestamp(base, 2_001),
    })).resolves.toMatchObject({ status: 'expired', reason: 'EXPIRED' })
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore + 2)

    const afterRetry = storage.durableStorageAckDiagnostics().attempts
    await expect(storage.approveCodexDeviceAuthorization(device.userCodeHash, {
      userId,
      approvedScopes: ['applications:read'],
      at: timestamp(base, 2_002),
    })).resolves.toMatchObject({ ok: false, reason: 'EXPIRED' })
    await expect(storage.denyCodexDeviceAuthorization(device.userCodeHash, {
      userId,
      at: timestamp(base, 2_003),
    })).resolves.toMatchObject({ ok: false, reason: 'EXPIRED' })
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(afterRetry)
  })

  it('persists 100 different authorization touches with one global durable acknowledgement', async () => {
    const base = Date.now()
    const createdAt = timestamp(base)
    const expiresAt = timestamp(base, 24 * 60 * 60_000)
    const fixtureDatabase = new Database(sqlitePath)
    const authVersion = Number(
      fixtureDatabase.prepare('SELECT auth_version FROM users WHERE id = ?').get(userId)?.auth_version ?? 0,
    )
    const authorizations = Array.from({ length: 100 }, (_, index) => ({
      id: `codexauth_cadence_${index}_${digest(`cadence-id-${index}`).slice(0, 12)}`,
      tokenSelector: `sel_${digest(`cadence-selector-${index}`).slice(0, 28)}`,
      tokenHash: digest(`cadence-token-${index}`),
      name: `Cadence authorization ${index}`,
    }))
    const insert = fixtureDatabase.prepare(
      `INSERT INTO codex_authorizations (
         id, user_id, token_selector, token_hash, token_hint, name,
         client_name, client_version, device_name, scopes_json, scope_version,
         issued_auth_version, created_at, updated_at, expires_at,
         last_used_at, revoked_at, revoked_reason
       ) VALUES (?, ?, ?, ?, ?, ?, 'Codex CLI', '1.0.0-test', 'Cadence test', ?, 2,
                 ?, ?, ?, ?, NULL, NULL, NULL)`,
    )
    fixtureDatabase.transaction(() => {
      for (const authorization of authorizations) {
        insert.run(
          authorization.id,
          userId,
          authorization.tokenSelector,
          authorization.tokenHash,
          authorization.tokenHash.slice(-6),
          authorization.name,
          JSON.stringify(['applications:read']),
          authVersion,
          createdAt,
          createdAt,
          expiresAt,
        )
      }
    }).immediate()
    fixtureDatabase.close()

    vi.useFakeTimers()
    try {
      const diagnosticsBefore = storage.codexAuthorizationLastUsedDiagnostics()
      const acknowledgementsBefore = storage.durableStorageAckDiagnostics().attempts
      const touchedAt = timestamp(base, 61_000)
      const touches = await Promise.all(authorizations.map((authorization) => (
        storage.touchCodexAuthorizationLastUsed(authorization.id, {
          at: touchedAt,
          minIntervalMs: 60_000,
        })
      )))
      expect(touches.every((touch) => touch.touched)).toBe(true)
      expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore)
      expect(storage.codexAuthorizationLastUsedDiagnostics()).toMatchObject({
        pending: 100,
        timerScheduled: true,
      })

      await vi.advanceTimersByTimeAsync(storage.CODEX_TELEMETRY_PERSIST_INTERVAL_MS)
      const diagnosticsAfter = storage.codexAuthorizationLastUsedDiagnostics()
      expect(diagnosticsAfter.flushes - diagnosticsBefore.flushes).toBe(1)
      expect(diagnosticsAfter.batches - diagnosticsBefore.batches).toBe(1)
      expect(diagnosticsAfter.persisted - diagnosticsBefore.persisted).toBe(100)
      expect(diagnosticsAfter).toMatchObject({
        pending: 0,
        timerScheduled: false,
        telemetryDirty: false,
      })
      expect(storage.durableStorageAckDiagnostics().attempts).toBe(acknowledgementsBefore + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not revive a revoked bearer after activity batching and a full storage reopen', async () => {
    const base = Date.now()
    const material = authorizationMaterial('Revocation survives reopen')
    const created = await storage.createCodexAuthorization({
      userId,
      ...material,
      createdAt: timestamp(base),
    })

    await expect(storage.touchCodexAuthorizationLastUsed(created.id, {
      at: timestamp(base, 61_000),
      minIntervalMs: 60_000,
    })).resolves.toMatchObject({ touched: true })
    expect(storage.codexAuthorizationLastUsedDiagnostics().pending).toBe(1)

    await expect(storage.revokeCodexAuthorization(userId, created.id, {
      reason: 'durable_reopen_test',
      at: timestamp(base, 62_000),
    })).resolves.toMatchObject({
      status: 'revoked',
      revokedReason: 'durable_reopen_test',
    })
    expect(storage.codexAuthorizationLastUsedDiagnostics().pending).toBe(0)

    await storage.shutdownStorage()
    vi.resetModules()
    storage = await import('./storage.js')
    sqlitePath = storage.databasePath

    await expect(storage.findCurrentCodexAuthorizationBySelector(
      material.tokenSelector,
      { at: timestamp(base, 63_000) },
    )).resolves.toBeNull()
    await expect(storage.getCodexAuthorizationById(
      userId,
      created.id,
      { at: timestamp(base, 63_000) },
    )).resolves.toMatchObject({
      status: 'revoked',
      active: false,
      revokedReason: 'durable_reopen_test',
    })
  })

  it('pauses and resumes a bearer, but refuses to resume a revoked one', async () => {
    const base = Date.now()
    const pausable = authorizationMaterial('Pausable grant')
    const revoked = authorizationMaterial('Revoked grant')
    const paused = await storage.createCodexAuthorization({
      userId,
      ...pausable,
      createdAt: timestamp(base),
    })
    const withdrawn = await storage.createCodexAuthorization({
      userId,
      ...revoked,
      createdAt: timestamp(base),
    })

    await expect(storage.setCodexAuthorizationDisabled(userId, paused.id, true, {
      at: timestamp(base, 1_000),
    })).resolves.toMatchObject({ status: 'disabled', active: false })
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      pausable.tokenSelector,
      { at: timestamp(base, 2_000) },
    )).resolves.toBeNull()

    await expect(storage.setCodexAuthorizationDisabled(userId, paused.id, false, {
      at: timestamp(base, 3_000),
    })).resolves.toMatchObject({ status: 'active', active: true, disabledAt: null })
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      pausable.tokenSelector,
      { at: timestamp(base, 4_000) },
    )).resolves.toMatchObject({ id: paused.id })

    // Revocation is one-way: resuming must never bring a withdrawn bearer back.
    await storage.revokeCodexAuthorization(userId, withdrawn.id, { at: timestamp(base, 5_000) })
    await expect(storage.setCodexAuthorizationDisabled(userId, withdrawn.id, false, {
      at: timestamp(base, 6_000),
    })).rejects.toMatchObject({ code: 'CODEX_AUTHORIZATION_REVOKED', status: 409 })
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      revoked.tokenSelector,
      { at: timestamp(base, 7_000) },
    )).resolves.toBeNull()
  })

  it('deletes a bearer outright while keeping its audit trail', async () => {
    const base = Date.now()
    const material = authorizationMaterial('Deletable grant')
    const created = await storage.createCodexAuthorization({
      userId,
      ...material,
      createdAt: timestamp(base),
    })

    await expect(storage.deleteCodexAuthorization(userId, created.id, {
      at: timestamp(base, 1_000),
    })).resolves.toMatchObject({ id: created.id, deleted: true })

    await expect(storage.getCodexAuthorizationById(userId, created.id)).resolves.toBeNull()
    await expect(storage.findCurrentCodexAuthorizationBySelector(
      material.tokenSelector,
      { at: timestamp(base, 2_000) },
    )).resolves.toBeNull()
    await expect(storage.listCodexAuthorizations(userId))
      .resolves.not.toContainEqual(expect.objectContaining({ id: created.id }))

    const audit = await storage.querySystemEvents({
      scope: 'Codex authorization',
      search: 'Deleted Codex authorization',
      pageSize: 50,
    })
    expect(audit.items.some((event) => event.message === 'Deleted Codex authorization')).toBe(true)
    expect(JSON.stringify(audit.items)).not.toContain(material.tokenHash)
  })

  it('approves a device grant, slows rapid polling, and exchanges it exactly once', async () => {
    const base = Date.now()
    const device = deviceMaterial('Concurrent exchange', {
      createdAt: timestamp(base),
      expiresAt: timestamp(base, 10 * 60_000),
      requestedExpiresInDays: 180,
    })
    const started = await storage.createCodexDeviceAuthorization(device)
    expect(started).toMatchObject({
      status: 'pending',
      requestedScopes: ['applications:read', 'applications:write'],
      requestedExpiresInDays: 180,
    })
    expect(JSON.stringify(started)).not.toContain(device.deviceCodeHash)
    expect(JSON.stringify(started)).not.toContain(device.userCodeHash)

    const pollAcknowledgementsBefore = storage.durableStorageAckDiagnostics().attempts
    const pending = await storage.pollCodexDeviceAuthorization(device.deviceCodeHash, {
      at: timestamp(base, 1_000),
    })
    const slowDown = await storage.pollCodexDeviceAuthorization(device.deviceCodeHash, {
      at: timestamp(base, 2_000),
    })
    expect(pending).toMatchObject({ status: 'pending', reason: 'AUTHORIZATION_PENDING' })
    expect(slowDown).toMatchObject({
      status: 'slow_down',
      reason: 'SLOW_DOWN',
      retryAfterSeconds: 10,
    })
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(pollAcknowledgementsBefore)

    const approved = await storage.approveCodexDeviceAuthorization(device.userCodeHash, {
      userId,
      approvedScopes: ['applications:read'],
      approvedExpiresInDays: 90,
      authorizationName: 'Approved test device',
      at: timestamp(base, 3_000),
    })
    expect(approved).toMatchObject({
      ok: true,
      deviceAuthorization: {
        status: 'approved',
        approvedScopes: ['applications:read'],
        approvedExpiresInDays: 90,
        approvedName: 'Approved test device',
        approvedUserId: userId,
      },
    })

    const first = authorizationMaterial('Exchange A', {
      scopes: undefined,
      at: timestamp(base, 20_000),
    })
    const second = authorizationMaterial('Exchange B', {
      scopes: undefined,
      at: timestamp(base, 20_000),
    })
    const exchanges = await Promise.all([
      storage.exchangeCodexDeviceAuthorization(device.deviceCodeHash, first),
      storage.exchangeCodexDeviceAuthorization(device.deviceCodeHash, second),
    ])
    const successes = exchanges.filter((result) => result.ok)
    const consumed = exchanges.filter((result) => result.reason === 'ALREADY_CONSUMED')
    expect(successes).toHaveLength(1)
    expect(consumed).toHaveLength(1)
    expect(successes[0].authorization).toMatchObject({
      userId,
      name: 'Approved test device',
      scopes: ['applications:read'],
      status: 'active',
    })
    expect(successes[0].authorization.expiresAt).toBe(
      timestamp(base, 20_000 + 90 * 24 * 60 * 60_000),
    )
    const consumedPollCount = successes[0].deviceAuthorization.pollCount
    const consumedPoll = await storage.pollCodexDeviceAuthorization(device.deviceCodeHash, {
      at: timestamp(base, 20_001),
    })
    expect(consumedPoll).toMatchObject({
      status: 'consumed',
      reason: 'ALREADY_CONSUMED',
      retryAfterSeconds: 0,
      deviceAuthorization: { pollCount: consumedPollCount },
    })

    const firstCredential = await storage.findCurrentCodexAuthorizationBySelector(
      first.tokenSelector,
      { at: timestamp(base, 21_000) },
    )
    const secondCredential = await storage.findCurrentCodexAuthorizationBySelector(
      second.tokenSelector,
      { at: timestamp(base, 21_000) },
    )
    expect([firstCredential, secondCredential].filter(Boolean)).toHaveLength(1)
    expect(firstCredential?.tokenHash ?? secondCredential?.tokenHash).toBe(
      firstCredential ? first.tokenHash : second.tokenHash,
    )
    const listed = await storage.listCodexAuthorizations(userId, {
      at: timestamp(base, 21_000),
    })
    expect(listed.filter((authorization) => authorization.active)).toHaveLength(1)
  })

  it('persists denial and expiry terminal states without exposing device hashes', async () => {
    const base = Date.now()
    const deniedDevice = deviceMaterial('Denied device', {
      createdAt: timestamp(base),
      expiresAt: timestamp(base, 60_000),
    })
    await storage.createCodexDeviceAuthorization(deniedDevice)
    const denied = await storage.denyCodexDeviceAuthorization(deniedDevice.userCodeHash, {
      userId,
      reason: 'test_denied',
      at: timestamp(base, 1_000),
    })
    const deniedPoll = await storage.pollCodexDeviceAuthorization(deniedDevice.deviceCodeHash, {
      at: timestamp(base, 2_000),
    })
    const repeatedDeniedPoll = await storage.pollCodexDeviceAuthorization(
      deniedDevice.deviceCodeHash,
      { at: timestamp(base, 2_001) },
    )
    expect(denied).toMatchObject({
      ok: true,
      deviceAuthorization: { status: 'denied', denialReason: 'test_denied' },
    })
    expect(deniedPoll).toMatchObject({
      status: 'denied',
      reason: 'ACCESS_DENIED',
      retryAfterSeconds: 0,
      deviceAuthorization: { pollCount: 0 },
    })
    expect(repeatedDeniedPoll).toMatchObject({
      status: 'denied',
      reason: 'ACCESS_DENIED',
      retryAfterSeconds: 0,
      deviceAuthorization: { pollCount: 0 },
    })

    const expiringDevice = deviceMaterial('Expired device', {
      createdAt: timestamp(base),
      expiresAt: timestamp(base, 5_000),
    })
    await storage.createCodexDeviceAuthorization(expiringDevice)
    const expiryAcknowledgementsBefore = storage.durableStorageAckDiagnostics().attempts
    const expired = await storage.pollCodexDeviceAuthorization(expiringDevice.deviceCodeHash, {
      at: timestamp(base, 6_000),
    })
    const projection = await storage.getCodexDeviceAuthorizationByUserCodeHash(
      expiringDevice.userCodeHash,
      { at: timestamp(base, 6_000) },
    )
    expect(expired).toMatchObject({ status: 'expired', reason: 'EXPIRED' })
    expect(storage.durableStorageAckDiagnostics().attempts).toBe(expiryAcknowledgementsBefore + 1)
    expect(projection).toMatchObject({ status: 'expired' })
    expect(JSON.stringify(projection)).not.toContain(expiringDevice.deviceCodeHash)
    expect(JSON.stringify(projection)).not.toContain(expiringDevice.userCodeHash)
  })

  it('adds bounded Codex attribution to domain audit events without credential material', async () => {
    const store = await storage.readStore()
    const tokenHash = digest('audit hash')
    const selector = `sel_${digest('audit selector').slice(0, 28)}`
    const rawToken = `phda_cdx_v1_${digest('audit token')}`
    const event = storage.runWithAuditContext({
      codexAuthorization: {
        credentialId: 'codexauth_audit_test',
        name: 'Audit device',
        grantedScopes: ['applications:write', 'applications:read'],
        scopeVersion: 2,
        clientName: 'Codex CLI',
        deviceName: 'Audit machine',
        tokenHash,
        tokenSelector: selector,
        token: rawToken,
      },
    }, () => storage.logEvent(store, {
      actorId: userId,
      scope: 'Application',
      message: 'Updated application through Codex',
      metadata: { applicationId: 'app_test' },
    }))

    expect(event.metadata.codexAuthorization).toEqual({
      credentialId: 'codexauth_audit_test',
      name: 'Audit device',
      grantedScopes: ['applications:read', 'applications:write'],
      scopeVersion: 2,
      clientName: 'Codex CLI',
      deviceName: 'Audit machine',
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain(tokenHash)
    expect(serialized).not.toContain(selector)
    expect(serialized).not.toContain(rawToken)
  })

  it('enforces the per-account active authorization limit atomically', async () => {
    const created = []
    for (let index = 0; index < storage.MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER; index += 1) {
      created.push(await storage.createCodexAuthorization({
        userId,
        ...authorizationMaterial(`Limit ${index}`),
      }))
    }
    expect(created).toHaveLength(storage.MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER)
    await expect(storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('Limit overflow'),
    })).rejects.toMatchObject({
      code: 'CODEX_AUTHORIZATION_LIMIT',
      limit: storage.MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER,
    })

    const revoked = await storage.revokeAllCodexAuthorizations(userId, {
      reason: 'limit_test_complete',
    })
    expect(revoked.revokedCount).toBe(storage.MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER)

    const idleCreatedAt = new Date(
      Date.now() - storage.CODEX_AUTHORIZATION_IDLE_TIMEOUT_MS - 60_000,
    ).toISOString()
    for (let index = 0; index < storage.MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER; index += 1) {
      await storage.createCodexAuthorization({
        userId,
        ...authorizationMaterial(`Idle limit ${index}`),
        createdAt: idleCreatedAt,
      })
    }
    await expect(storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('Fresh after idle limit'),
    })).resolves.toMatchObject({ status: 'active' })
  })

  it('invalidates legacy scope-version grants without occupying active grant capacity', async () => {
    const legacy = authorizationMaterial('Legacy v1 token')
    const inspectionDatabase = new Database(sqlitePath, { fileMustExist: true })
    const authVersion = Number(
      inspectionDatabase.prepare('SELECT auth_version FROM users WHERE id = ?')
        .get(userId)?.auth_version ?? 0,
    )
    const now = new Date().toISOString()
    const legacyId = `codexauth_legacy_v1_${digest('legacy v1 id').slice(0, 12)}`
    inspectionDatabase.prepare(
      `INSERT INTO codex_authorizations (
         id, user_id, token_selector, token_hash, token_hint, name,
         client_name, client_version, device_name, scopes_json, scope_version,
         issued_auth_version, created_at, updated_at, expires_at,
         last_used_at, revoked_at, revoked_reason
       ) VALUES (?, ?, ?, ?, ?, 'Legacy v1', 'Codex CLI', '1.0.0', 'Legacy test',
                 ?, 1, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      legacyId,
      userId,
      legacy.tokenSelector,
      legacy.tokenHash,
      legacy.tokenHint,
      JSON.stringify(['applications:read']),
      authVersion,
      now,
      now,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      now,
    )
    inspectionDatabase.close()

    await expect(storage.findCurrentCodexAuthorizationBySelector(
      legacy.tokenSelector,
    )).resolves.toBeNull()
    const discovered = await storage.findCodexAuthorizationBySelector(legacy.tokenSelector)
    expect(discovered).toMatchObject({
      status: 'invalidated',
      scopeVersion: 1,
      active: false,
    })

    for (let index = 0; index < storage.MAX_ACTIVE_CODEX_AUTHORIZATIONS_PER_USER - 1; index += 1) {
      await storage.createCodexAuthorization({
        userId,
        ...authorizationMaterial(`Fresh capacity ${index}`),
      })
    }
    await expect(storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('Fresh after legacy invalidated'),
    })).resolves.toMatchObject({ status: 'active', scopeVersion: 2 })
  })

  it('migrates legacy scope-version tables before creating scope-v2 grants', async () => {
    await storage.shutdownStorage()
    const legacyDatabase = new Database(sqlitePath)
    legacyDatabase.pragma('foreign_keys = OFF')
    legacyDatabase.exec(`
      DROP TABLE IF EXISTS codex_device_authorizations;
      DROP TABLE IF EXISTS codex_authorizations;
      CREATE TABLE codex_authorizations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_selector TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        client_name TEXT NOT NULL DEFAULT '',
        client_version TEXT NOT NULL DEFAULT '',
        device_name TEXT NOT NULL DEFAULT '',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        scope_version INTEGER NOT NULL DEFAULT 1 CHECK(scope_version = 1),
        issued_auth_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        revoked_at TEXT,
        revoked_reason TEXT
      );
      CREATE TABLE codex_device_authorizations (
        id TEXT PRIMARY KEY,
        device_code_hash TEXT NOT NULL UNIQUE,
        user_code_hash TEXT NOT NULL UNIQUE,
        client_name TEXT NOT NULL DEFAULT '',
        client_version TEXT NOT NULL DEFAULT '',
        device_name TEXT NOT NULL DEFAULT '',
        requested_scopes_json TEXT NOT NULL DEFAULT '[]',
        requested_expires_in_days INTEGER NOT NULL DEFAULT 365,
        approved_scopes_json TEXT,
        approved_expires_in_days INTEGER,
        approved_name TEXT,
        scope_version INTEGER NOT NULL DEFAULT 1 CHECK(scope_version = 1),
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        poll_interval_seconds INTEGER NOT NULL DEFAULT 5,
        last_polled_at TEXT,
        poll_count INTEGER NOT NULL DEFAULT 0,
        approved_user_id TEXT,
        approved_auth_version INTEGER,
        approved_at TEXT,
        denied_by_user_id TEXT,
        denied_at TEXT,
        denial_reason TEXT,
        consumed_at TEXT,
        authorization_id TEXT
      );
    `)
    const legacyMaterial = authorizationMaterial('Pre-migration legacy')
    const now = new Date().toISOString()
    legacyDatabase.prepare(
      `INSERT INTO codex_authorizations (
         id, user_id, token_selector, token_hash, token_hint, name,
         client_name, client_version, device_name, scopes_json, scope_version,
         issued_auth_version, created_at, updated_at, expires_at,
         last_used_at, revoked_at, revoked_reason
       ) VALUES (?, ?, ?, ?, ?, 'Pre-migration legacy', 'Codex CLI', '1.0.0', 'Legacy test',
                 ?, 1, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      `codexauth_pre_migration_${digest('pre-migration legacy').slice(0, 12)}`,
      userId,
      legacyMaterial.tokenSelector,
      legacyMaterial.tokenHash,
      legacyMaterial.tokenHint,
      JSON.stringify(['applications:read']),
      0,
      now,
      now,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      now,
    )
    legacyDatabase.close()

    vi.resetModules()
    storage = await import('./storage.js')
    const preserved = await storage.findCodexAuthorizationBySelector(legacyMaterial.tokenSelector)
    expect(preserved).toMatchObject({
      status: 'invalidated',
      scopeVersion: 1,
      tokenHash: legacyMaterial.tokenHash,
    })
    const migrated = await storage.createCodexAuthorization({
      userId,
      ...authorizationMaterial('Migrated scope v2'),
    })
    expect(migrated).toMatchObject({
      status: 'active',
      scopeVersion: 2,
    })
    const inspectionDatabase = new Database(sqlitePath, { fileMustExist: true })
    const authorizationSql = inspectionDatabase
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_authorizations'")
      .get()?.sql ?? ''
    const deviceSql = inspectionDatabase
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_device_authorizations'")
      .get()?.sql ?? ''
    inspectionDatabase.close()
    expect(authorizationSql).not.toMatch(/CHECK\s*\(\s*scope_version\s*=\s*1\s*\)/i)
    expect(deviceSql).not.toMatch(/CHECK\s*\(\s*scope_version\s*=\s*1\s*\)/i)
  })

  it('revokes restored bearer credentials and discards unconsumed device grants before publication', async () => {
    const activeMaterial = authorizationMaterial('Restored token')
    const active = await storage.createCodexAuthorization({
      userId,
      ...activeMaterial,
    })
    const pendingDevice = deviceMaterial('Restored pending device', {
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    await storage.createCodexDeviceAuthorization(pendingDevice)
    const backup = await storage.createBackup(
      await storage.readStore(),
      userId,
      null,
      10,
      { prune: false },
    )

    try {
      await storage.revokeCodexAuthorization(userId, active.id, {
        reason: 'revoked_after_backup',
      })
      await storage.restoreBackup(backup.fileName, { actorId: userId })

      await expect(storage.findCurrentCodexAuthorizationBySelector(
        activeMaterial.tokenSelector,
      )).resolves.toBeNull()
      const restored = await storage.getCodexAuthorizationById(userId, active.id)
      expect(restored).toMatchObject({
        status: 'revoked',
        revokedReason: 'workspace_restore',
      })
      await expect(storage.getCodexDeviceAuthorizationByUserCodeHash(
        pendingDevice.userCodeHash,
      )).resolves.toBeNull()

      const audit = await storage.querySystemEvents({
        scope: 'Codex authorization',
        search: 'workspace_restore',
        pageSize: 100,
      })
      expect(audit.items.some(
        (event) => event.message === 'Revoked Codex authorizations after workspace restore',
      )).toBe(true)
      expect(JSON.stringify(audit.items)).not.toContain(activeMaterial.tokenHash)
      expect(JSON.stringify(audit.items)).not.toContain(pendingDevice.deviceCodeHash)
    } finally {
      await storage.deleteBackup(backup.fileName).catch(() => undefined)
    }
  })
})
