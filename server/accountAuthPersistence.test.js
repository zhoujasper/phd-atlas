import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  accountAuthProjection,
  commitPasswordResetTransaction,
  completeRegistrationTransaction,
  issuePasswordResetTransaction,
} from './accountAuthTransactions.js'
import {
  canonicalRegistrationEmail,
  issueSecurityChallenge,
  securityChallengeClaimInput,
} from './antiAbuse.js'

const passkeyVerification = vi.hoisted(() => ({ challenge: '' }))

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    verifyAuthenticationResponse: vi.fn(async ({ expectedChallenge }) => {
      const accepted = typeof expectedChallenge === 'function'
        ? await expectedChallenge(passkeyVerification.challenge)
        : expectedChallenge === passkeyVerification.challenge
      if (!accepted) throw new Error('The test passkey challenge was rejected.')
      return {
        verified: true,
        authenticationInfo: {
          newCounter: 1,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      }
    }),
  }
})

const TRANSACTION_SECRET = 'account-auth-transaction-test-secret'
const LARGE_UNRELATED_SETTINGS_BYTES = 17 * 1024 * 1024
const SUPPORTED_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'th', 'vi', 'zh']

function createTransactionDatabase() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE system_settings (
      id TEXT PRIMARY KEY,
      allow_registration INTEGER NOT NULL
    );
    INSERT INTO system_settings (id, allow_registration) VALUES ('global', 1);

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      canonical_email TEXT NOT NULL,
      recovery_email TEXT NOT NULL,
      language TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      auth_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      disabled_at TEXT,
      settings_json TEXT NOT NULL
    );

    CREATE INDEX idx_test_users_canonical_email ON users(canonical_email);
    CREATE INDEX idx_test_users_recovery_email ON users(recovery_email, created_at, id);

    CREATE TABLE security_challenges (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      subject_hash TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      verifier_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL,
      not_before_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE system_events (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE TABLE test_mail_outbox (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL
    );
  `)
  return database
}

function insertTestMailJob(database, job) {
  const id = `mail_${createHash('sha256').update(job.dedupeKey).digest('hex').slice(0, 24)}`
  database.prepare(
    'INSERT INTO test_mail_outbox (id, dedupe_key, payload_json) VALUES (?, ?, ?)',
  ).run(id, job.dedupeKey, JSON.stringify(job))
  return { job: { id, ...job }, alreadyQueued: false }
}

function testChallenge(database, suffix, email = `atomic-${suffix}@example.test`) {
  const nowMs = Date.now()
  const token = `registration-token-${suffix}-${'x'.repeat(32)}`
  const answer = '482913'
  const challenge = securityChallengeClaimInput({
    secret: TRANSACTION_SECRET,
    kind: 'signup-email',
    token,
    subject: canonicalRegistrationEmail(email),
    answer,
    nowMs,
  })
  database.prepare(
    `INSERT INTO security_challenges (
       id, kind, token_hash, subject_hash, context_hash, verifier_hash,
       attempts, max_attempts, created_at, not_before_at, expires_at,
       consumed_at, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, 0, 5, ?, ?, ?, NULL, '{}')`,
  ).run(
    `challenge_${suffix}`,
    challenge.kind,
    challenge.tokenHash,
    challenge.subjectHash,
    challenge.contextHash,
    challenge.verifierHash,
    new Date(nowMs - 1_000).toISOString(),
    new Date(nowMs - 500).toISOString(),
    new Date(nowMs + 60_000).toISOString(),
  )
  return challenge
}

function registrationTransactionInput(database, suffix, email = `atomic-${suffix}@example.test`) {
  const now = new Date().toISOString()
  return {
    challenge: testChallenge(database, suffix, email),
    user: {
      id: `user_${suffix}`,
      name: `Atomic ${suffix}`,
      email,
      canonicalEmail: canonicalRegistrationEmail(email),
      recoveryEmail: email.toLowerCase(),
      language: 'fr',
      role: 'user',
      passwordHash: `password-hash-${suffix}`,
      authVersion: 0,
      createdAt: now,
      lastLoginAt: now,
      disabledAt: null,
      settingsJson: JSON.stringify({ language: 'fr', authVersion: 0 }),
    },
    event: {
      id: `event_registration_${suffix}`,
      time: now,
      scope: 'Authentication',
      actorId: `user_${suffix}`,
      message: 'New user registered',
      metadataJson: '{}',
    },
    mailJob: {
      dedupeKey: `welcome:${suffix}`,
      kind: 'welcome',
      to: email,
      subject: 'Welcome',
    },
  }
}

function seedResetUser(database, suffix = 'reset') {
  const user = {
    id: `user_${suffix}`,
    email: `${suffix}@example.test`,
    passwordHash: `old-password-${suffix}`,
    authVersion: 7,
  }
  database.prepare(
    `INSERT INTO users (
       id, name, email, canonical_email, recovery_email, language, role,
       password_hash, auth_version, created_at, last_login_at, disabled_at,
       settings_json
     ) VALUES (?, ?, ?, ?, ?, 'ja', 'user', ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    user.id,
    `Reset ${suffix}`,
    user.email,
    canonicalRegistrationEmail(user.email),
    user.email,
    user.passwordHash,
    user.authVersion,
    new Date().toISOString(),
    JSON.stringify({ language: 'ja', authVersion: user.authVersion }),
  )
  return user
}

function resetIssueInput(user, suffix) {
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 60_000).toISOString()
  const token = `password-reset-token-${suffix}-${'y'.repeat(32)}`
  return {
    userId: user.id,
    recoveryEmail: user.email,
    tokenId: `reset_${suffix}`,
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    createdAt,
    expiresAt,
    event: {
      id: `event_reset_issue_${suffix}`,
      time: createdAt,
      scope: 'Account recovery',
      actorId: user.id,
      message: 'Password reset link generated',
      metadataJson: JSON.stringify({ expiresAt }),
    },
    mailJob: {
      dedupeKey: `password-reset:${suffix}`,
      kind: 'password-reset',
      to: user.email,
      subject: 'Reset password',
    },
  }
}

describe.sequential('account authentication transactions', () => {
  it('keeps every supported locale in the compact account projection', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(accountAuthProjection({
        id: `user_${language}`,
        email: `${language}@example.test`,
        settings: { language },
      })).toMatchObject({ language, recoveryEmail: `${language}@example.test` })
    }
  })

  for (const stage of ['challenge-claimed', 'user-inserted', 'event-inserted', 'outbox-inserted']) {
    it(`rolls registration back after the ${stage} failpoint`, () => {
      const database = createTransactionDatabase()
      try {
        const input = registrationTransactionInput(database, stage)
        expect(() => completeRegistrationTransaction(database, input, {
          insertSystemMailJob: insertTestMailJob,
          onStage: (current) => {
            if (current === stage) throw new Error(`failpoint:${stage}`)
          },
        })).toThrow(`failpoint:${stage}`)

        expect(database.prepare('SELECT consumed_at FROM security_challenges').get().consumed_at).toBeNull()
        expect(database.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(0)
        expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(0)
        expect(database.prepare('SELECT COUNT(*) AS count FROM test_mail_outbox').get().count).toBe(0)
      } finally {
        database.close()
      }
    })
  }

  for (const stage of ['token-inserted', 'event-inserted', 'outbox-inserted']) {
    it(`rolls reset issuance back after the ${stage} failpoint`, () => {
      const database = createTransactionDatabase()
      try {
        const user = seedResetUser(database, `issue_${stage}`)
        const input = resetIssueInput(user, stage)
        expect(() => issuePasswordResetTransaction(database, input, {
          insertSystemMailJob: insertTestMailJob,
          onStage: (current) => {
            if (current === stage) throw new Error(`failpoint:${stage}`)
          },
        })).toThrow(`failpoint:${stage}`)

        expect(database.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get().count).toBe(0)
        expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(0)
        expect(database.prepare('SELECT COUNT(*) AS count FROM test_mail_outbox').get().count).toBe(0)
      } finally {
        database.close()
      }
    })
  }

  for (const stage of ['user-updated', 'token-consumed', 'event-inserted']) {
    it(`rolls reset completion back after the ${stage} failpoint`, () => {
      const database = createTransactionDatabase()
      try {
        const user = seedResetUser(database, `confirm_${stage}`)
        const token = `confirm-token-${stage}-${'z'.repeat(32)}`
        const tokenHash = createHash('sha256').update(token).digest('hex')
        const completedAt = new Date().toISOString()
        database.prepare(
          `INSERT INTO password_reset_tokens (
             id, user_id, token_hash, created_at, expires_at, used_at
           ) VALUES (?, ?, ?, ?, ?, NULL)`,
        ).run(
          `reset_confirm_${stage}`,
          user.id,
          tokenHash,
          completedAt,
          new Date(Date.now() + 60_000).toISOString(),
        )

        expect(() => commitPasswordResetTransaction(database, {
          tokenHash,
          passwordHash: `new-password-${stage}`,
          completedAt,
          event: {
            id: `event_reset_confirm_${stage}`,
            time: completedAt,
            scope: 'Account recovery',
            message: 'Password reset completed',
            metadataJson: '{}',
          },
        }, {
          onStage: (current) => {
            if (current === stage) throw new Error(`failpoint:${stage}`)
          },
        })).toThrow(`failpoint:${stage}`)

        expect(database.prepare(
          'SELECT password_hash, auth_version FROM users WHERE id = ?',
        ).get(user.id)).toEqual({
          password_hash: user.passwordHash,
          auth_version: user.authVersion,
        })
        expect(database.prepare(
          'SELECT used_at FROM password_reset_tokens WHERE token_hash = ?',
        ).get(tokenHash).used_at).toBeNull()
        expect(database.prepare(
          'SELECT COUNT(*) AS count FROM system_events WHERE id = ?',
        ).get(`event_reset_confirm_${stage}`).count).toBe(0)
      } finally {
        database.close()
      }
    })
  }

  it('allows exactly one of 50 simultaneous registrations for one email', async () => {
    const database = createTransactionDatabase()
    try {
      const email = 'one-account@example.test'
      const inputs = Array.from({ length: 50 }, (_, index) => (
        registrationTransactionInput(database, `concurrent_${index}`, email)
      ))
      const results = await Promise.all(inputs.map((input) => Promise.resolve().then(() => (
        completeRegistrationTransaction(database, input, { insertSystemMailJob: insertTestMailJob })
      ))))

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => result.reason === 'EMAIL_EXISTS')).toHaveLength(49)
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM users WHERE canonical_email = ?',
      ).get(canonicalRegistrationEmail(email)).count).toBe(1)
      expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(1)
      expect(database.prepare('SELECT COUNT(*) AS count FROM test_mail_outbox').get().count).toBe(1)
    } finally {
      database.close()
    }
  })

  it('allows exactly one of 50 simultaneous completions for one reset token', async () => {
    const database = createTransactionDatabase()
    try {
      const user = seedResetUser(database, 'concurrent_confirm')
      const token = `single-use-reset-${'q'.repeat(40)}`
      const tokenHash = createHash('sha256').update(token).digest('hex')
      const completedAt = new Date().toISOString()
      database.prepare(
        `INSERT INTO password_reset_tokens (
           id, user_id, token_hash, created_at, expires_at, used_at
         ) VALUES ('reset_concurrent', ?, ?, ?, ?, NULL)`,
      ).run(user.id, tokenHash, completedAt, new Date(Date.now() + 60_000).toISOString())

      const results = await Promise.all(Array.from({ length: 50 }, (_, index) => (
        Promise.resolve().then(() => commitPasswordResetTransaction(database, {
          tokenHash,
          passwordHash: 'only-one-new-password-hash',
          completedAt,
          event: {
            id: `event_concurrent_confirm_${index}`,
            time: completedAt,
            scope: 'Account recovery',
            message: 'Password reset completed',
            metadataJson: '{}',
          },
        }))
      )))

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => result.reason === 'INVALID_TOKEN')).toHaveLength(49)
      expect(database.prepare(
        'SELECT password_hash, auth_version FROM users WHERE id = ?',
      ).get(user.id)).toEqual({
        password_hash: 'only-one-new-password-hash',
        auth_version: user.authVersion + 1,
      })
      expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(1)
      expect(database.prepare(
        'SELECT used_at FROM password_reset_tokens WHERE token_hash = ?',
      ).get(tokenHash).used_at).toBeTruthy()
    } finally {
      database.close()
    }
  })
})

describe.sequential('account authentication routes avoid workspace hydration', () => {
  let app
  let server
  let baseUrl
  let storage
  let testRoot
  let sqlitePath
  let registrationToken
  let issuedResetToken
  let passwordResetResponseTiming

  const jwtSecret = 'account-auth-persistence-route-jwt-secret-2026'
  const encryptionKey = 'account-auth-persistence-route-encryption-key-2026'
  const registrationEmail = 'atomic-route-registration@example.test'
  const resetEmail = 'atomic-route-reset@example.test'
  const registrationCode = '731904'

  beforeAll(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-account-auth-'))
    sqlitePath = path.join(testRoot, 'workspace.sqlite')
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('RATE_LIMIT_DISABLED', '1')
    vi.stubEnv('PASSWORD_RESET_MIN_RESPONSE_MS', '120')
    vi.stubEnv('PASSWORD_RESET_RESPONSE_JITTER_MS', '0')
    vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
    vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
    vi.stubEnv('JWT_SECRET', jwtSecret)
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', encryptionKey)

    vi.resetModules()
    storage = await import('./storage.js')
    await storage.ensureStorage()

    const raw = new Database(sqlitePath)
    try {
      const now = new Date().toISOString()
      const insertUser = raw.prepare(
        `INSERT INTO users (
           id, name, email, canonical_email, recovery_email, language, role,
           password_hash, auth_version, created_at, last_login_at, disabled_at,
           settings_version, settings_json
         ) VALUES (?, ?, ?, ?, ?, ?, 'user', ?, 0, ?, NULL, NULL, 0, ?)`,
      )
      insertUser.run(
        'user_atomic_route_reset',
        'Atomic route reset',
        resetEmail,
        canonicalRegistrationEmail(resetEmail),
        resetEmail,
        'de',
        'old-route-password-hash',
        now,
        JSON.stringify({ language: 'de', authVersion: 0 }),
      )

      const hugeSettings = JSON.stringify({
        language: 'ja',
        authVersion: 0,
        applicationTrash: 'x'.repeat(LARGE_UNRELATED_SETTINGS_BYTES),
      })
      insertUser.run(
        'user_atomic_route_unrelated',
        'Large unrelated tenant',
        'large-unrelated@example.test',
        'large-unrelated@example.test',
        'large-unrelated@example.test',
        'ja',
        'unrelated-password-hash',
        now,
        hugeSettings,
      )
      insertUser.run(
        'user_atomic_route_disabled',
        'Disabled passkey hint',
        'disabled-passkey-hint@example.test',
        'disabled-passkey-hint@example.test',
        'disabled-passkey-hint@example.test',
        'en',
        'disabled-password-hash',
        now,
        JSON.stringify({ language: 'en', authVersion: 0 }),
      )
      raw.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(
        now,
        'user_atomic_route_disabled',
      )
      raw.prepare(
        `INSERT INTO applications (
           id, owner_id, school_name, professor_name, program, deadline,
           status, progress, priority, updated_at, payload_version,
           authored_hash, authority_hash, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?)`,
      ).run(
        'app_atomic_route_corrupt',
        'user_atomic_route_unrelated',
        'Corrupt payload university',
        '',
        'Corrupt payload programme',
        '2030-01-01',
        'Considering',
        0,
        1,
        now,
        '{this-is-not-valid-json',
      )
      raw.prepare("UPDATE system_settings SET allow_registration = 1 WHERE id = 'global'").run()
    } finally {
      raw.close()
    }

    const antiAbuseSecret = createHash('sha256')
      .update(`phd-atlas-anti-abuse-v1\u001f${jwtSecret}`)
      .digest('hex')
    registrationToken = await issueSecurityChallenge({
      secret: antiAbuseSecret,
      kind: 'signup-email',
      subject: canonicalRegistrationEmail(registrationEmail),
      answer: registrationCode,
      ttlMs: 60_000,
      create: storage.createSecurityChallenge,
    })

    const index = await import('./index.js')
    passwordResetResponseTiming = index.passwordResetResponseTiming
    app = index.createApp({
      testHooks: {
        passwordResetIssued: ({ token }) => { issuedResetToken = token },
      },
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  }, 120_000)

  afterAll(async () => {
    await app?.locals.stopRecurringTasks()
    if (server) await new Promise((resolve) => server.close(resolve))
    await storage?.shutdownStorage().catch(() => undefined)
    vi.unstubAllEnvs()
    vi.resetModules()
    if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
  }, 30_000)

  it('registers and resets durably without touching a 17 MiB tenant or corrupt payload', async () => {
    const before = storage.sharedStoreCacheDiagnostics()
    expect(passwordResetResponseTiming()).toEqual({ minimumMs: 120, jitterMs: 0 })
    vi.stubEnv('PASSWORD_RESET_MIN_RESPONSE_MS', '999999')
    vi.stubEnv('PASSWORD_RESET_RESPONSE_JITTER_MS', '999999')
    expect(passwordResetResponseTiming()).toEqual({ minimumMs: 2_000, jitterMs: 500 })
    vi.stubEnv('PASSWORD_RESET_MIN_RESPONSE_MS', '120')
    vi.stubEnv('PASSWORD_RESET_RESPONSE_JITTER_MS', '0')

    const passkeyOptionShapes = []
    for (const body of [
      { scope: 'app' },
      { email: resetEmail, scope: 'app' },
      { email: 'missing-passkey-hint@example.test', scope: 'app' },
      { email: 'disabled-passkey-hint@example.test', scope: 'app' },
    ]) {
      const optionsResponse = await fetch(`${baseUrl}/api/auth/passkeys/login/options`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify(body),
      })
      expect(optionsResponse.status, await optionsResponse.clone().text()).toBe(200)
      const optionsPayload = await optionsResponse.json()
      expect(optionsPayload).toMatchObject({
        ok: true,
        data: { options: { challenge: expect.any(String) } },
      })
      expect(optionsPayload.data.options.allowCredentials).toBeUndefined()
      const publicShape = { ...optionsPayload.data.options }
      delete publicShape.challenge
      passkeyOptionShapes.push(publicShape)
    }
    expect(passkeyOptionShapes.every((shape) => (
      JSON.stringify(shape) === JSON.stringify(passkeyOptionShapes[0])
    ))).toBe(true)

    const registrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Atomic Route User',
        email: registrationEmail,
        password: 'Atomic registration password 2026!',
        language: 'fr',
        emailCodeToken: registrationToken,
        emailCode: registrationCode,
      }),
    })
    expect(registrationResponse.status, await registrationResponse.clone().text()).toBe(201)
    const registrationPayload = await registrationResponse.json()
    expect(registrationPayload).toMatchObject({
      ok: true,
      data: {
        user: { id: expect.any(String), email: registrationEmail },
        settings: expect.any(Object),
      },
    })

    const requestReset = async (email) => {
      const startedAt = performance.now()
      const response = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const payload = await response.json()
      return { response, payload, elapsedMs: performance.now() - startedAt }
    }
    issuedResetToken = null
    const missingReset = await requestReset('missing-reset-account@example.test')
    const resetRequest = await requestReset(resetEmail)
    expect(missingReset.response.status).toBe(200)
    expect(resetRequest.response.status).toBe(200)
    expect(resetRequest.payload.data).toEqual(missingReset.payload.data)
    expect(resetRequest.payload.ok).toBe(missingReset.payload.ok)
    expect(resetRequest.payload).toMatchObject({
      ok: true,
      data: { sent: true, delivery: 'email reset link' },
    })
    expect(resetRequest.payload.data.resetUrl).toBeUndefined()
    for (const elapsedMs of [missingReset.elapsedMs, resetRequest.elapsedMs]) {
      expect(elapsedMs).toBeGreaterThanOrEqual(100)
      expect(elapsedMs).toBeLessThan(2_500)
    }
    expect(Math.abs(missingReset.elapsedMs - resetRequest.elapsedMs)).toBeLessThan(1_000)
    expect(issuedResetToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const resetToken = issuedResetToken

    const resetConfirmResponse = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        password: 'Atomic reset password route 2026!',
      }),
    })
    expect(resetConfirmResponse.status, await resetConfirmResponse.clone().text()).toBe(200)
    await expect(resetConfirmResponse.json()).resolves.toMatchObject({
      ok: true,
      data: { reset: true },
    })

    const duplicateConfirmResponse = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        password: 'Atomic reset password route 2026!',
      }),
    })
    expect(duplicateConfirmResponse.status).toBe(404)

    const accountSmtpSecret = 'route-account-smtp-secret-must-not-leak'
    const accountIncomingSecret = 'route-account-imap-secret-must-not-leak'
    const rawPasskeySetup = new Database(sqlitePath)
    try {
      rawPasskeySetup.prepare(
        'UPDATE users SET settings_json = ? WHERE id = ?',
      ).run(JSON.stringify({
        language: 'fr',
        authVersion: 0,
        membershipPlan: 'pro',
        smtpHost: 'smtp.example.test',
        smtpUser: registrationEmail,
        smtpPass: accountSmtpSecret,
        incomingProtocol: 'imap',
        incomingHost: 'imap.example.test',
        incomingUser: registrationEmail,
        incomingPass: accountIncomingSecret,
      }), registrationPayload.data.user.id)
    } finally {
      rawPasskeySetup.close()
    }

    const credentialId = 'credential_account_auth_route_success'
    await storage.createWebAuthnPasskey({
      userId: registrationPayload.data.user.id,
      credentialId,
      publicKey: Buffer.from('focused-passkey-public-key'),
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      label: 'Focused route passkey',
    })
    const passkeyOptionsResponse = await fetch(`${baseUrl}/api/auth/passkeys/login/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ email: registrationEmail, scope: 'app' }),
    })
    expect(passkeyOptionsResponse.status, await passkeyOptionsResponse.clone().text()).toBe(200)
    const passkeyOptionsPayload = await passkeyOptionsResponse.json()
    expect(passkeyOptionsPayload.data.options.allowCredentials).toBeUndefined()
    expect(JSON.stringify(passkeyOptionsPayload)).not.toContain(credentialId)
    passkeyVerification.challenge = passkeyOptionsPayload.data.options.challenge

    const fakePasskeyResponse = await fetch(`${baseUrl}/api/auth/passkeys/login/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        scope: 'app',
        response: { id: 'credential_that_is_not_registered' },
      }),
    })
    expect(fakePasskeyResponse.status).toBe(401)
    await expect(fakePasskeyResponse.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'PASSKEY_NOT_FOUND' },
    })

    const passkeyVerifyResponse = await fetch(`${baseUrl}/api/auth/passkeys/login/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        scope: 'app',
        response: {
          id: credentialId,
          response: {
            userHandle: Buffer.from(registrationPayload.data.user.id).toString('base64url'),
          },
        },
      }),
    })
    expect(passkeyVerifyResponse.status, await passkeyVerifyResponse.clone().text()).toBe(200)
    const passkeyVerifyPayload = await passkeyVerifyResponse.json()
    expect(passkeyVerifyPayload).toMatchObject({
      ok: true,
      data: {
        token: expect.any(String),
        user: {
          id: registrationPayload.data.user.id,
          email: registrationEmail,
          settings: {
            language: 'fr',
            smtpPass: '',
            smtpPassSet: true,
            incomingPass: '',
            incomingPassSet: true,
          },
        },
        settings: {
          smtpPass: '',
          encryptionPasswordHash: '',
          encryptionPasswordSalt: expect.stringMatching(/^(?:|set)$/),
        },
        usage: {
          applicationCount: 0,
          storageUsedBytes: expect.any(Number),
          storageQuotaBytes: expect.any(Number),
        },
      },
    })
    const serializedPasskeyResponse = JSON.stringify(passkeyVerifyPayload)
    expect(serializedPasskeyResponse).not.toContain(accountSmtpSecret)
    expect(serializedPasskeyResponse).not.toContain(accountIncomingSecret)
    passkeyVerification.challenge = ''

    const after = storage.sharedStoreCacheDiagnostics()
    expect(after.hydratedSnapshots).toBe(before.hydratedSnapshots)
    expect(after.populated).toBe(false)

    const raw = new Database(sqlitePath, { readonly: true })
    try {
      expect(raw.prepare(
        'SELECT language, recovery_email FROM users WHERE canonical_email = ?',
      ).get(canonicalRegistrationEmail(registrationEmail))).toEqual({
        language: 'fr',
        recovery_email: registrationEmail,
      })
      expect(raw.prepare(
        'SELECT auth_version, password_hash FROM users WHERE id = ?',
      ).get('user_atomic_route_reset')).toMatchObject({
        auth_version: 1,
        password_hash: expect.not.stringMatching(/^old-route-password-hash$/),
      })
      expect(raw.prepare(
        'SELECT length(settings_json) AS bytes FROM users WHERE id = ?',
      ).get('user_atomic_route_unrelated').bytes).toBeGreaterThan(LARGE_UNRELATED_SETTINGS_BYTES)
      expect(raw.prepare(
        'SELECT payload_json FROM applications WHERE id = ?',
      ).get('app_atomic_route_corrupt').payload_json).toBe('{this-is-not-valid-json')
    } finally {
      raw.close()
    }
  }, 120_000)
})
