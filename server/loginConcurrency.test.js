import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createApp } from './index.js'
import { hashAccountPassword } from './passwordSecurity.js'
import {
  commitSuccessfulPasswordLogin,
  databasePath,
  readFocusedSessionAccount,
  readPasswordLoginCandidateByEmail,
  readScopedStore,
  readStore,
  sharedStoreCacheDiagnostics,
  withWriteLock,
  writeStore,
} from './storage.js'

const TEST_PASSWORD = 'Concurrent login safety 2026!'
const NEW_PASSWORD = 'Rotated login safety 2026!'
const BULK_ACCOUNT_COUNT = 100

let app
let server
let baseUrl
let stamp
let bulkAccounts
let barrierAccounts
let accountIds
let passwordHash
let rotatedPasswordHash
let previousRateLimitDisabled
let afterPasswordLoginCommit

async function updateAccount(id, update) {
  await withWriteLock(async () => {
    const store = await readStore()
    const user = store.users.find((candidate) => candidate.id === id)
    if (!user) throw new Error(`Missing test account ${id}`)
    await update(user)
    await writeStore(store)
  })
}

async function login(email, password = TEST_PASSWORD) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, scope: 'app' }),
  })
  return { response, payload: await response.json() }
}

async function loginWithCapacityRetry(email, password = TEST_PASSWORD, maxAttempts = 12) {
  const statuses = []
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await login(email, password)
    statuses.push(result.response.status)
    if (result.response.status !== 429 || result.payload?.error?.code !== 'AUTH_CAPACITY_EXCEEDED') {
      return { result, statuses }
    }
    const retryAfterMs = Number(result.response.headers.get('x-phd-retry-after-ms')) || 1_000
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
  }
  return { result: await login(email, password), statuses }
}

async function waitForAdmission(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for password admission state.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

beforeAll(async () => {
  stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  passwordHash = await hashAccountPassword(TEST_PASSWORD)
  rotatedPasswordHash = await hashAccountPassword(NEW_PASSWORD)
  bulkAccounts = Array.from({ length: BULK_ACCOUNT_COUNT }, (_, index) => ({
    id: `user_login_load_${stamp}_${index}`,
    email: `login-load-${stamp}-${index}@example.test`,
  }))
  barrierAccounts = {
    disabled: { id: `user_login_disabled_${stamp}`, email: `login-disabled-${stamp}@example.test` },
    authVersion: { id: `user_login_auth_${stamp}`, email: `login-auth-${stamp}@example.test` },
    role: { id: `user_login_role_${stamp}`, email: `login-role-${stamp}@example.test` },
    password: { id: `user_login_password_${stamp}`, email: `login-password-${stamp}@example.test` },
    settings: { id: `user_login_settings_${stamp}`, email: `login-settings-${stamp}@example.test` },
    sameUser: { id: `user_login_same_${stamp}`, email: `login-same-${stamp}@example.test` },
    cancelled: { id: `user_login_cancelled_${stamp}`, email: `login-cancelled-${stamp}@example.test` },
    postCommitReset: { id: `user_login_post_commit_${stamp}`, email: `login-post-commit-${stamp}@example.test` },
  }
  accountIds = new Set([
    ...bulkAccounts.map((account) => account.id),
    ...Object.values(barrierAccounts).map((account) => account.id),
  ])

  await withWriteLock(async () => {
    const store = await readStore()
    const createdAt = new Date().toISOString()
    const makeUser = (account, settings = {}) => ({
      id: account.id,
      name: `Login test ${account.id}`,
      email: account.email,
      role: 'user',
      passwordHash,
      createdAt,
      lastLoginAt: null,
      disabledAt: null,
      settings: {
        language: 'en',
        membershipPlan: 'pro',
        personalMembershipPlan: 'pro',
        authVersion: 0,
        ...settings,
      },
    })
    store.users.push(...bulkAccounts.map((account, index) => makeUser(
      account,
      index === 0
        ? {
            applicationTrash: [{
              id: `expired-trash-${stamp}`,
              deletedAt: '2000-01-01T00:00:00.000Z',
              expiresAt: '2000-01-02T00:00:00.000Z',
              application: { id: `expired-app-${stamp}`, teamId: null },
            }],
          }
        : {},
    )))
    store.users.push(...Object.values(barrierAccounts).map((account) => makeUser(account)))
    await writeStore(store)
  })

  previousRateLimitDisabled = process.env.RATE_LIMIT_DISABLED
  delete process.env.RATE_LIMIT_DISABLED
  app = createApp({
    testHooks: {
      afterPasswordLoginCommit: (context) => afterPasswordLoginCommit?.(context),
    },
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}, 120_000)

afterAll(async () => {
  if (app) await app.locals.stopRecurringTasks()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (previousRateLimitDisabled === undefined) delete process.env.RATE_LIMIT_DISABLED
  else process.env.RATE_LIMIT_DISABLED = previousRateLimitDisabled

  await withWriteLock(async () => {
    const store = await readStore()
    store.users = store.users.filter((user) => !accountIds.has(user.id))
    store.systemEvents = store.systemEvents.filter((event) => !accountIds.has(event.actorId))
    await writeStore(store)
  })
}, 120_000)

describe('password login concurrency safety', () => {
  it('lets 100 accounts behind one NAT retry once without hitting the anonymous network ceiling', async () => {
    const retryEmails = Array.from(
      { length: BULK_ACCOUNT_COUNT },
      (_, index) => `login-nat-retry-${stamp}-${index}@example.test`,
    )
    const responses = await Promise.all(retryEmails.flatMap((email) => (
      Array.from({ length: 2 }, () => fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Omitting the password keeps this a fast middleware-level retry
        // probe while preserving the real IP + email limiter identity.
        body: JSON.stringify({ email, scope: 'app' }),
      }))
    )))

    expect(responses).toHaveLength(200)
    expect(responses.every((response) => response.status !== 429)).toBe(true)
    expect(responses.every((response) => response.headers.get('ratelimit-limit') === '1200')).toBe(true)
  })

  it('still rate-limits repeated attempts against one account behind that NAT', async () => {
    const email = `login-nat-attack-${stamp}@example.test`
    const responses = []
    for (let attempt = 0; attempt < 9; attempt += 1) {
      responses.push(await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, scope: 'app' }),
      }))
    }

    expect(responses.slice(0, 8).every((response) => response.status !== 429)).toBe(true)
    expect(responses[8].status).toBe(429)
    await expect(responses[8].json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('keeps discoverable passkey login usable behind a NAT while isolating credential abuse', async () => {
    const discoverableOptions = []
    for (let attempt = 0; attempt < 9; attempt += 1) {
      discoverableOptions.push(await fetch(`${baseUrl}/api/auth/passkeys/login/options`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'app' }),
      }))
    }
    expect(discoverableOptions.every((response) => response.status !== 429)).toBe(true)

    const hintedEmail = `passkey-nat-${stamp}@example.test`
    const hintedOptions = []
    for (let attempt = 0; attempt < 9; attempt += 1) {
      hintedOptions.push(await fetch(`${baseUrl}/api/auth/passkeys/login/options`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: hintedEmail, scope: 'app' }),
      }))
    }
    expect(hintedOptions.slice(0, 8).every((response) => response.status !== 429)).toBe(true)
    expect(hintedOptions[8].status).toBe(429)

    const distinctCredentialResponses = await Promise.all(Array.from({ length: 9 }, (_, index) => (
      fetch(`${baseUrl}/api/auth/passkeys/login/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: { id: `passkey-distinct-${stamp}-${index}` }, scope: 'app' }),
      })
    )))
    expect(distinctCredentialResponses.every((response) => response.status !== 429)).toBe(true)

    const attackedCredential = `passkey-attacked-${stamp}`
    const repeatedCredentialResponses = []
    for (let attempt = 0; attempt < 9; attempt += 1) {
      repeatedCredentialResponses.push(await fetch(`${baseUrl}/api/auth/passkeys/login/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: { id: attackedCredential }, scope: 'app' }),
      }))
    }
    expect(repeatedCredentialResponses.slice(0, 8).every((response) => response.status !== 429)).toBe(true)
    expect(repeatedCredentialResponses[8].status).toBe(429)
  })

  it('does not widen registration or password-reset credential ceilings', async () => {
    const registrationResponses = []
    const registrationEmail = `register-rate-${stamp}@example.test`
    for (let attempt = 0; attempt < 9; attempt += 1) {
      registrationResponses.push(await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: registrationEmail }),
      }))
    }
    expect(registrationResponses.slice(0, 8).every((response) => response.status !== 429)).toBe(true)
    expect(registrationResponses[8].status).toBe(429)
    expect(registrationResponses[0].headers.get('ratelimit-limit')).toBe('180')

    const resetResponses = []
    const resetEmail = `reset-rate-${stamp}@example.test`
    for (let attempt = 0; attempt < 6; attempt += 1) {
      resetResponses.push(await fetch(`${baseUrl}/api/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      }))
    }
    expect(resetResponses.slice(0, 5).every((response) => response.status !== 429)).toBe(true)
    expect(resetResponses[5].status).toBe(429)
    expect(resetResponses[0].headers.get('ratelimit-limit')).toBe('180')
  })

  it('keeps unknown-account and wrong-password failures non-enumerating', async () => {
    const known = await login(barrierAccounts.sameUser.email, 'Definitely not the password 2026!')
    const unknown = await login(`unknown-login-${stamp}@example.test`, 'Definitely not the password 2026!')

    expect(known.response.status).toBe(401)
    expect(unknown.response.status).toBe(401)
    expect(known.payload.error).toEqual(unknown.payload.error)
    expect(known.payload).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CREDENTIALS' },
    })
  }, 30_000)

  it('refuses to write a bounded session projection as complete durable settings', async () => {
    const account = barrierAccounts.sameUser
    const focusedStore = await readScopedStore(account.id, {
      includeApplications: false,
      includeProfileAssets: false,
      includeTeams: false,
      includeTeamPeers: false,
      includeSystemEvents: false,
      compactWorkspaceUsers: true,
      compactMemoryReservation: true,
      retainMemoryReservation: false,
    })
    const user = focusedStore.users.find((candidate) => candidate.id === account.id)
    const originalAccent = user.settings.themeAccent
    user.settings.themeAccent = '#fedcba'

    await expect(writeStore(focusedStore)).rejects.toMatchObject({
      code: 'FOCUSED_SESSION_PROJECTION_WRITE_FORBIDDEN',
    })
    expect((await readFocusedSessionAccount(account.id)).settings.themeAccent).toBe(originalAccent)

    const completeStore = await readStore()
    const projection = await readFocusedSessionAccount(account.id)
    projection.settings.themeAccent = '#abcdef'
    completeStore.users = completeStore.users.map((candidate) => (
      candidate.id === account.id ? { ...projection } : candidate
    ))
    await expect(writeStore(completeStore)).rejects.toMatchObject({
      code: 'FOCUSED_SESSION_PROJECTION_WRITE_FORBIDDEN',
    })
    expect((await readFocusedSessionAccount(account.id)).settings.themeAccent).toBe(originalAccent)
  })

  it('serves 100 independent account logins without cross-account writes or unbounded password work', async () => {
    const cacheBefore = sharedStoreCacheDiagnostics()
    const outcomes = await Promise.all(bulkAccounts.map((account) => loginWithCapacityRetry(account.email)))
    const responses = outcomes.map((outcome) => outcome.result)

    expect(
      responses.every(({ response }) => response.status === 200),
      JSON.stringify(outcomes.map(({ statuses }) => statuses)),
    ).toBe(true)
    expect(outcomes.some(({ statuses }) => statuses.some((status) => status >= 500))).toBe(false)
    responses.forEach(({ payload }, index) => {
      expect(payload.data.user).toMatchObject({
        id: bulkAccounts[index].id,
        email: bulkAccounts[index].email,
      })
      const claims = JSON.parse(Buffer.from(payload.data.token.split('.')[1], 'base64url').toString('utf8'))
      expect(claims.sub).toBe(bulkAccounts[index].id)
    })

    const admission = app.locals.passwordAdmission.snapshot()
    expect(admission.maxObservedActive).toBeLessThanOrEqual(1)
    expect(admission.maxObservedQueued).toBe(0)
    expect(sharedStoreCacheDiagnostics().hydratedSnapshots - cacheBefore.hydratedSnapshots).toBeLessThanOrEqual(1)

    const store = await readStore()
    const first = store.users.find((user) => user.id === bulkAccounts[0].id)
    expect(first.settings.applicationTrash).toEqual([
      expect.objectContaining({ id: `expired-trash-${stamp}` }),
    ])
    expect(store.systemEvents.filter((event) => (
      bulkAccounts.some((account) => account.id === event.actorId)
      && event.scope === 'Authentication'
      && event.message === 'User signed in'
    ))).toHaveLength(BULK_ACCOUNT_COUNT)
  }, 120_000)

  it('bounds 100 concurrent logins for one account without full-store hydration or lost audit commits', async () => {
    const account = barrierAccounts.sameUser
    const cacheBefore = sharedStoreCacheDiagnostics()
    const memoryBefore = process.memoryUsage()
    const outcomes = await Promise.all(
      Array.from({ length: BULK_ACCOUNT_COUNT }, () => loginWithCapacityRetry(account.email)),
    )
    const responses = outcomes.map((outcome) => outcome.result)

    const successful = responses.filter(({ response }) => response.status === 200)
    const limited = responses.filter(({ response }) => response.status === 429)
    expect(successful.length).toBeGreaterThan(0)
    expect(successful.length + limited.length).toBe(BULK_ACCOUNT_COUNT)
    expect(responses.some(({ response }) => response.status >= 500)).toBe(false)
    expect(limited.every(({ payload }) => payload?.error?.code === 'RATE_LIMITED')).toBe(true)
    const issuedAtValues = new Set()
    for (const { payload } of successful) {
      expect(payload.data.user).toMatchObject({ id: account.id, email: account.email })
      const claims = JSON.parse(Buffer.from(payload.data.token.split('.')[1], 'base64url').toString('utf8'))
      expect(claims).toMatchObject({ sub: account.id, authVersion: 0 })
      issuedAtValues.add(claims.iat)
    }
    expect(issuedAtValues.size).toBeGreaterThan(0)
    expect(sharedStoreCacheDiagnostics().hydratedSnapshots - cacheBefore.hydratedSnapshots).toBe(0)

    const store = await readStore()
    const current = store.users.find((user) => user.id === account.id)
    expect(current.lastLoginAt).toBeTruthy()
    expect(store.systemEvents.filter((event) => (
      event.actorId === account.id
      && event.scope === 'Authentication'
      && event.message === 'User signed in'
    ))).toHaveLength(successful.length)
    const memoryAfter = process.memoryUsage()
    expect(memoryAfter.rss - memoryBefore.rss).toBeLessThan(128 * 1024 * 1024)
  }, 180_000)

  it('keeps a 17 MiB legacy account and a corrupt unrelated 17 MiB application out of login hydration', async () => {
    const account = barrierAccounts.settings
    const corruptApplicationId = `app_login_corrupt_${stamp}`
    const direct = new Database(databasePath)
    direct.pragma('busy_timeout = 30000')
    const original = direct.prepare(
      'SELECT settings_json, language FROM users WHERE id = ?',
    ).get(account.id)
    const baseSettings = JSON.parse(original.settings_json)
    let largeSettingsJson = JSON.stringify({
      ...baseSettings,
      language: 'zh',
      contentLanguagePrimary: 'zh',
      contentLanguageSecondary: 'en',
      themeAccent: '#7654ab',
      storageQuotaMb: 321,
      applicationQuota: 44,
      smtpPass: `legacy:${'s'.repeat(8 * 1024 * 1024)}`,
      applicationTrash: [{
        id: `trash_large_${stamp}`,
        deletedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        application: {
          id: `app_trash_large_${stamp}`,
          teamId: null,
          legacyBlob: 't'.repeat(9 * 1024 * 1024),
        },
      }],
    })
    let corruptPayload = `{"broken":"${'x'.repeat(17 * 1024 * 1024)}`
    try {
      direct.transaction(() => {
        direct.prepare(
          'UPDATE users SET settings_json = ?, language = ? WHERE id = ?',
        ).run(largeSettingsJson, 'zh', account.id)
        direct.prepare(
          `INSERT INTO applications (
             id, owner_id, school_name, professor_name, program, deadline,
             status, progress, priority, updated_at, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          corruptApplicationId,
          bulkAccounts.at(-1).id,
          'Corrupt unrelated fixture',
          'Nobody',
          'Fixture',
          '2099-01-01',
          'Draft',
          0,
          0,
          new Date().toISOString(),
          corruptPayload,
        )
      })()
      // Do not keep a second JS copy while observing the focused login path.
      largeSettingsJson = null
      corruptPayload = null

      const cacheBefore = sharedStoreCacheDiagnostics()
      const memoryBefore = process.memoryUsage()
      const candidateStartedAt = performance.now()
      const candidate = await readPasswordLoginCandidateByEmail(account.email)
      const candidateElapsedMs = performance.now() - candidateStartedAt
      const candidateMemory = process.memoryUsage()
      expect(candidate.guard).toMatchObject({ id: account.id, authVersion: 0 })
      expect(candidate.user.settings).toEqual({ authVersion: 0 })
      expect(candidateElapsedMs).toBeLessThan(5_000)
      expect(candidateMemory.heapUsed - memoryBefore.heapUsed).toBeLessThan(16 * 1024 * 1024)
      expect(candidateMemory.external - memoryBefore.external).toBeLessThan(16 * 1024 * 1024)

      const loginResult = await loginWithCapacityRetry(account.email, TEST_PASSWORD, 12)
      expect(loginResult.result.response.status).toBe(200)
      const loginPayloadText = JSON.stringify(loginResult.result.payload)
      expect(Buffer.byteLength(loginPayloadText, 'utf8')).toBeLessThan(256 * 1024)
      expect(loginResult.result.payload.data.user.settings).toMatchObject({
        language: 'zh',
        contentLanguagePrimary: 'zh',
        contentLanguageSecondary: 'en',
        themeAccent: '#7654ab',
        storageQuotaMb: 321,
        applicationQuota: 44,
        smtpPass: '',
        smtpPassSet: true,
      })
      expect(loginPayloadText).not.toContain('legacy:')
      expect(loginPayloadText).not.toContain('legacyBlob')
      expect(sharedStoreCacheDiagnostics().hydratedSnapshots).toBe(cacheBefore.hydratedSnapshots)

      const me = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${loginResult.result.payload.data.token}` },
      })
      const meText = await me.text()
      expect(me.status).toBe(200)
      expect(Buffer.byteLength(meText, 'utf8')).toBeLessThan(256 * 1024)
      const mePayload = JSON.parse(meText)
      expect(mePayload.data.user.settings).toMatchObject({
        language: 'zh',
        themeAccent: '#7654ab',
        storageQuotaMb: 321,
        smtpPassSet: true,
      })
      expect(meText).not.toContain('legacy:')
      expect(meText).not.toContain('legacyBlob')
      expect(sharedStoreCacheDiagnostics().hydratedSnapshots).toBe(cacheBefore.hydratedSnapshots)
      const memoryAfter = process.memoryUsage()
      expect(memoryAfter.rss - memoryBefore.rss).toBeLessThan(128 * 1024 * 1024)
      expect(memoryAfter.external - memoryBefore.external).toBeLessThan(32 * 1024 * 1024)
    } finally {
      direct.transaction(() => {
        direct.prepare('DELETE FROM applications WHERE id = ?').run(corruptApplicationId)
        direct.prepare(
          'UPDATE users SET settings_json = ?, language = ? WHERE id = ?',
        ).run(original.settings_json, original.language, account.id)
      })()
      direct.close()
    }
  }, 120_000)

  it('preserves unrelated settings saved after password verification', async () => {
    const account = barrierAccounts.settings
    const candidate = await readPasswordLoginCandidateByEmail(account.email)
    await updateAccount(account.id, (user) => {
      user.settings.themeAccent = '#123456'
    })
    const cachedBefore = await readStore({ cache: true })
    const retainedBefore = structuredClone(cachedBefore)
    const previousLastLoginAt = cachedBefore.users.find((user) => user.id === account.id)?.lastLoginAt

    const committed = await commitSuccessfulPasswordLogin({
      guard: candidate.guard,
      scope: 'app',
      lastLoginAt: new Date().toISOString(),
    })
    expect(committed.ok).toBe(true)
    expect(cachedBefore).toEqual(retainedBefore)
    const cachedAfter = await readStore({ cache: true })
    expect(cachedAfter).not.toBe(cachedBefore)
    expect(cachedAfter.meta.revision).toBeGreaterThan(cachedBefore.meta.revision)
    expect(cachedAfter.users).not.toBe(cachedBefore.users)
    expect(cachedAfter.systemEvents).not.toBe(cachedBefore.systemEvents)
    expect(cachedAfter.applications).toStrictEqual(cachedBefore.applications)
    expect(cachedAfter.profileAssets).toStrictEqual(cachedBefore.profileAssets)
    expect(cachedBefore.users.find((user) => user.id === account.id)?.lastLoginAt).toBe(previousLastLoginAt)
    expect(cachedAfter.users.find((user) => user.id === account.id)?.lastLoginAt).toBe(committed.user.lastLoginAt)
    expect((await readStore()).meta.revision).toBe(cachedAfter.meta.revision)
    const fresh = await readFocusedSessionAccount(account.id)
    expect(fresh.settings.themeAccent).toBe('#123456')
  })

  it('keeps a reset committed after login CAS newer than the issued token and shared cache', async () => {
    const account = barrierAccounts.postCommitReset
    let hookCalls = 0
    afterPasswordLoginCommit = async ({ user }) => {
      if (user.id !== account.id) return
      hookCalls += 1
      await updateAccount(account.id, (current) => {
        current.settings.authVersion = Number(current.settings.authVersion ?? 0) + 1
        current.passwordHash = rotatedPasswordHash
      })
    }

    try {
      const { response, payload } = await login(account.email)
      expect(response.status).toBe(200)
      expect(hookCalls).toBe(1)
      const claims = JSON.parse(Buffer.from(payload.data.token.split('.')[1], 'base64url').toString('utf8'))
      expect(claims.authVersion).toBe(0)

      const cached = await readStore({ cache: true })
      const current = cached.users.find((user) => user.id === account.id)
      expect(current.settings.authVersion).toBe(1)
      expect(current.passwordHash).toBe(rotatedPasswordHash)

      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${payload.data.token}` },
      })
      expect(meResponse.status).toBe(401)
      await expect(meResponse.json()).resolves.toMatchObject({ ok: false })
    } finally {
      afterPasswordLoginCommit = null
    }
  }, 60_000)

  it('rejects stale login guards after disable, revocation, role, or password changes', async () => {
    const cases = [
      {
        account: barrierAccounts.disabled,
        mutate: (user) => { user.disabledAt = new Date().toISOString() },
        reason: 'DISABLED',
      },
      {
        account: barrierAccounts.authVersion,
        mutate: (user) => { user.settings.authVersion = Number(user.settings.authVersion ?? 0) + 1 },
        reason: 'AUTH_VERSION_CHANGED',
      },
      {
        account: barrierAccounts.role,
        mutate: (user) => { user.role = 'admin' },
        reason: 'ROLE_CHANGED',
      },
      {
        account: barrierAccounts.password,
        mutate: (user) => { user.passwordHash = rotatedPasswordHash },
        reason: 'PASSWORD_CHANGED',
      },
    ]

    for (const testCase of cases) {
      const candidate = await readPasswordLoginCandidateByEmail(testCase.account.email)
      expect(candidate).not.toBeNull()
      await updateAccount(testCase.account.id, testCase.mutate)
      const committed = await commitSuccessfulPasswordLogin({
        guard: candidate.guard,
        scope: 'app',
        lastLoginAt: new Date().toISOString(),
        nextPasswordHash: passwordHash,
      })
      expect(committed).toEqual({ ok: false, reason: testCase.reason })
    }

    const store = await readStore()
    for (const account of [
      barrierAccounts.disabled,
      barrierAccounts.authVersion,
      barrierAccounts.role,
      barrierAccounts.password,
    ]) {
      expect(store.users.find((user) => user.id === account.id)?.lastLoginAt).toBeNull()
      expect(store.systemEvents.some((event) => (
        event.actorId === account.id
        && event.scope === 'Authentication'
        && event.message === 'User signed in'
      ))).toBe(false)
    }
    expect(store.users.find((user) => user.id === barrierAccounts.disabled.id)?.disabledAt).toBeTruthy()
    expect(store.users.find((user) => user.id === barrierAccounts.authVersion.id)?.settings.authVersion).toBe(1)
    expect(store.users.find((user) => user.id === barrierAccounts.role.id)?.role).toBe('admin')
    expect(store.users.find((user) => user.id === barrierAccounts.password.id)?.passwordHash).toBe(rotatedPasswordHash)
  }, 60_000)

  it('never lets an old password overwrite a completed password rotation', async () => {
    const oldAttempt = await login(barrierAccounts.password.email, TEST_PASSWORD)
    expect(oldAttempt.response.status).toBe(401)
    expect(oldAttempt.payload).toMatchObject({ ok: false, error: { code: 'INVALID_CREDENTIALS' } })

    const currentAttempt = await login(barrierAccounts.password.email, NEW_PASSWORD)
    expect(currentAttempt.response.status).toBe(200)
    expect(currentAttempt.payload.data.user.id).toBe(barrierAccounts.password.id)
    const fresh = await readPasswordLoginCandidateByEmail(barrierAccounts.password.email)
    expect(fresh.guard.passwordHash).not.toBe(passwordHash)
  }, 60_000)

  it('cancels queued password work without committing login state or an audit event', async () => {
    const admission = app.locals.passwordAdmission
    const capacity = admission.snapshot()
    const activeReleases = await Promise.all(
      Array.from({ length: capacity.maxActive }, () => admission.acquire()),
    )
    const controller = new AbortController()
    const request = fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: barrierAccounts.cancelled.email,
        password: TEST_PASSWORD,
        scope: 'app',
      }),
      signal: controller.signal,
    })

    try {
      await waitForAdmission(() => admission.snapshot().waiting === 1)
      controller.abort()
      await expect(request).rejects.toMatchObject({ name: 'AbortError' })
      await waitForAdmission(() => admission.snapshot().waiting === 0)
    } finally {
      activeReleases.forEach((release) => release())
    }

    const candidate = await readPasswordLoginCandidateByEmail(barrierAccounts.cancelled.email)
    expect(candidate.user.lastLoginAt).toBeNull()
    const store = await readStore()
    expect(store.systemEvents.some((event) => (
      event.actorId === barrierAccounts.cancelled.id
      && event.scope === 'Authentication'
      && event.message === 'User signed in'
    ))).toBe(false)
  }, 60_000)

  it('dispatches a completed login body after waiting for the shared parser lease', async () => {
    const admission = app.locals.requestBodyAdmission
    const capacity = admission.snapshot()
    const activeReleases = await Promise.all(
      Array.from({ length: capacity.maxActive }, () => admission.acquire()),
    )
    const pendingLogin = login(barrierAccounts.settings.email)

    try {
      await waitForAdmission(() => admission.snapshot().waiting === 1)
      // Give Node's HTTP parser a boundary to receive the complete tiny body
      // while the application-level body reader is still queued.
      await new Promise((resolve) => setTimeout(resolve, 20))
      activeReleases.shift()?.()
      const { response, payload } = await pendingLogin
      expect(response.status).toBe(200)
      expect(payload.data.user.id).toBe(barrierAccounts.settings.id)
    } finally {
      activeReleases.forEach((release) => release())
    }
    await waitForAdmission(() => admission.snapshot().active === 0)
  }, 60_000)

  it('returns a stable 429 when the bounded password queue is full', async () => {
    const admission = app.locals.passwordAdmission
    const capacity = admission.snapshot()
    const activeReleases = await Promise.all(
      Array.from({ length: capacity.maxActive }, () => admission.acquire()),
    )
    const queued = Array.from({ length: capacity.maxQueued }, () => (
      admission.acquire().then((release) => release())
    ))
    expect(admission.snapshot().waiting).toBe(capacity.maxQueued)

    try {
      const { response, payload } = await login(bulkAccounts[0].email)
      expect(response.status).toBe(429)
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
      expect(Number(response.headers.get('x-phd-retry-after-ms'))).toBeGreaterThanOrEqual(750)
      expect(Number(response.headers.get('x-phd-retry-after-ms'))).toBeLessThanOrEqual(1_500)
      expect(payload).toMatchObject({ ok: false, error: { code: 'AUTH_CAPACITY_EXCEEDED' } })
    } finally {
      activeReleases.forEach((release) => release())
      await Promise.all(queued)
    }
    expect(admission.snapshot()).toMatchObject({ active: 0, waiting: 0 })
  }, 60_000)
})
