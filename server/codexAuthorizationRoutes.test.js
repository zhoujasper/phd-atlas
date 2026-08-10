import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createApp } from './index.js'
import { createCodexPersonalAccessToken } from './codexAuthorization.js'
import {
  databasePath,
  insertNotificationIfNew,
  lockedWriteStore,
  readStore,
} from './storage.js'

let server
let baseUrl
let sessionToken
let sessionUserId
let sessionUserEmail
const authorizationIds = new Set()
const applicationIds = new Set()
const legacyAuthorizationIds = new Set()
let settingsMutationSequence = 0

async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  const settingsHeaders = method === 'PATCH' && path === '/api/settings'
    ? {
        'x-phd-settings-acknowledgement': 'v1',
        'x-phd-settings-mutation-id': `codex-route-test:${Date.now()}:${++settingsMutationSequence}`,
      }
    : {}
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...settingsHeaders,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('json') ? await response.json() : await response.text()
  return { response, payload, data: payload?.data }
}

async function createGrant(name, scopes) {
  const created = await request('/api/codex/authorizations', {
    token: sessionToken,
    method: 'POST',
    body: { name, scopeVersion: 2, scopes, expiresInDays: 30 },
  })
  expect(created.response.status, JSON.stringify(created.payload)).toBe(201)
  authorizationIds.add(created.data.authorization.id)
  return created.data
}

describe.sequential('Codex authorization HTTP boundary', () => {
  beforeAll(async () => {
    const store = await readStore()
    const template = store.users.find((user) => user.email === 'jasper@example.com')
    expect(template).toBeTruthy()
    sessionUserId = `codex-route-test-${process.pid}-${Date.now()}`
    sessionUserEmail = `${sessionUserId}@example.test`
    store.users.push({
      ...structuredClone(template),
      id: sessionUserId,
      name: 'Codex route test user',
      email: sessionUserEmail,
      canonicalEmail: sessionUserEmail,
      recoveryEmail: sessionUserEmail,
      role: 'user',
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      disabledAt: null,
      settings: {
        ...structuredClone(template.settings),
        membershipPlan: 'pro',
        personalMembershipPlan: 'pro',
      },
    })
    await lockedWriteStore(store)
    server = createApp().listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: sessionUserEmail, password: 'demo123456' },
    })
    expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
    sessionToken = login.data.token
    expect(login.data.user.id).toBe(sessionUserId)
  })

  afterAll(async () => {
    for (const id of authorizationIds) {
      await request(`/api/codex/authorizations/${encodeURIComponent(id)}`, {
        token: sessionToken,
        method: 'DELETE',
      })
    }
    for (const id of applicationIds) {
      await request(`/api/applications/${encodeURIComponent(id)}`, {
        token: sessionToken,
        method: 'DELETE',
      })
    }
    if (legacyAuthorizationIds.size > 0) {
      const database = new Database(databasePath)
      const remove = database.prepare('DELETE FROM codex_authorizations WHERE id = ?')
      database.transaction(() => {
        for (const id of legacyAuthorizationIds) remove.run(id)
      })()
      database.close()
    }
    const store = await readStore()
    store.users = store.users.filter((user) => user.id !== sessionUserId)
    store.applications = store.applications.filter((application) => application.ownerId !== sessionUserId)
    if (Array.isArray(store.notifications)) {
      store.notifications = store.notifications.filter((notification) => notification.userId !== sessionUserId)
    }
    await lockedWriteStore(store)
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it('completes pending -> interactive approval -> one-time device exchange', async () => {
    const started = await request('/api/codex/device-authorizations', {
      method: 'POST',
      body: {
        client_name: 'Codex route test',
        client_version: '1.0.0',
        device_name: 'Vitest',
        scope_version: 2,
        scopes: ['applications:read'],
        expires_in_days: 30,
      },
    })
    expect(started.response.status, JSON.stringify(started.payload)).toBe(201)
    expect(started.payload.verification_uri_complete)
      .toContain(`/settings?mcpCode=${encodeURIComponent(started.payload.user_code)}`)
    expect(started.payload.interval).toBeGreaterThanOrEqual(5)

    const pending = await request(
      `/api/codex/device-authorizations/${encodeURIComponent(started.payload.user_code)}`,
      { token: sessionToken },
    )
    expect(pending.response.status, JSON.stringify(pending.payload)).toBe(200)
    expect(pending.data.status).toBe('pending')

    const approved = await request(
      `/api/codex/device-authorizations/${encodeURIComponent(started.payload.user_code)}/approve`,
      { token: sessionToken, method: 'POST', body: {} },
    )
    expect(approved.response.status, JSON.stringify(approved.payload)).toBe(200)
    expect(JSON.stringify(approved.payload)).not.toContain('access_token')

    const exchanged = await request('/api/codex/device-authorizations/token', {
      method: 'POST',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: started.payload.device_code,
      },
    })
    expect(exchanged.response.status, JSON.stringify(exchanged.payload)).toBe(200)
    expect(exchanged.payload.access_token).toMatch(/^phda_cdx_v1_/)
    authorizationIds.add(exchanged.payload.authorization.id)

    const again = await request('/api/codex/device-authorizations/token', {
      method: 'POST',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: started.payload.device_code,
      },
    })
    expect(again.response.status).toBe(400)
    expect(again.payload.error).toBe('invalid_grant')

    const whoami = await request('/api/codex/whoami', { token: exchanged.payload.access_token })
    expect(whoami.response.status, JSON.stringify(whoami.payload)).toBe(200)
    expect(whoami.data.user.email).toBe(sessionUserEmail)
    expect(whoami.payload.session).toBeUndefined()
    expect(whoami.response.headers.get('x-session-token')).toBeNull()

    const capabilities = await request('/api/codex/capabilities', {
      token: exchanged.payload.access_token,
    })
    expect(capabilities.data).toMatchObject({
      schemaVersion: 2,
      scopeVersion: 2,
      credential: { id: exchanged.payload.authorization.id },
    })
    expect(capabilities.data.routePrefixes).toEqual(expect.any(Array))
    expect(capabilities.data.deniedPrefixes).toEqual(expect.any(Array))
  })

  it('returns RFC device OAuth errors that the standalone CLI can consume', async () => {
    const startDeviceAuthorization = () => request('/api/codex/device-authorizations', {
      method: 'POST',
      body: {
        client_name: 'Codex OAuth envelope test',
        client_version: '1.0.0',
        scope_version: 2,
        scopes: ['applications:read'],
        expires_in_days: 30,
      },
    })
    const exchange = (deviceCode, grantType = 'urn:ietf:params:oauth:grant-type:device_code') => (
      request('/api/codex/device-authorizations/token', {
        method: 'POST',
        body: {
          ...(grantType ? { grant_type: grantType } : {}),
          device_code: deviceCode,
        },
      })
    )

    const pendingDevice = await startDeviceAuthorization()
    expect(pendingDevice.response.status, JSON.stringify(pendingDevice.payload)).toBe(201)
    const pending = await exchange(pendingDevice.payload.device_code)
    expect(pending.response.status).toBe(400)
    expect(pending.payload).toMatchObject({
      error: 'authorization_pending',
      error_description: expect.any(String),
      interval: expect.any(Number),
    })
    const slowDown = await exchange(pendingDevice.payload.device_code)
    expect(slowDown.response.status).toBe(400)
    expect(slowDown.payload).toMatchObject({
      error: 'slow_down',
      error_description: expect.any(String),
      interval: expect.any(Number),
    })

    const deniedDevice = await startDeviceAuthorization()
    expect(deniedDevice.response.status, JSON.stringify(deniedDevice.payload)).toBe(201)
    const deniedDecision = await request(
      `/api/codex/device-authorizations/${encodeURIComponent(deniedDevice.payload.user_code)}/deny`,
      { token: sessionToken, method: 'POST', body: {} },
    )
    expect(deniedDecision.response.status, JSON.stringify(deniedDecision.payload)).toBe(200)
    const denied = await exchange(deniedDevice.payload.device_code)
    expect(denied.response.status).toBe(400)
    expect(denied.payload).toMatchObject({
      error: 'access_denied',
      error_description: expect.any(String),
    })

    const missingGrantType = await exchange(deniedDevice.payload.device_code, '')
    expect(missingGrantType.response.status).toBe(400)
    expect(missingGrantType.payload).toMatchObject({
      error: 'invalid_request',
      error_description: expect.any(String),
    })
  })

  it('tells v1 clients that reauthorization is required instead of reporting insufficient scope', async () => {
    const created = createCodexPersonalAccessToken()
    const database = new Database(databasePath)
    const authVersion = Number(
      database.prepare('SELECT auth_version FROM users WHERE id = ?').get(sessionUserId)?.auth_version ?? 0,
    )
    const id = `codexauth_v1_${Date.now()}_${created.selector.slice(0, 8)}`
    database.prepare(
      `INSERT INTO codex_authorizations (
         id, user_id, token_selector, token_hash, token_hint, name,
         client_name, client_version, device_name, scopes_json, scope_version,
         issued_auth_version, created_at, updated_at, expires_at,
         last_used_at, revoked_at, revoked_reason
       ) VALUES (?, ?, ?, ?, ?, 'Legacy v1', 'Codex CLI', '1.0.0', 'Legacy test',
                 ?, 1, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(
      id,
      sessionUserId,
      created.selector,
      created.tokenHash,
      created.hint,
      JSON.stringify(['applications:read']),
      authVersion,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    )
    database.close()
    legacyAuthorizationIds.add(id)

    const rejected = await request('/api/codex/whoami', { token: created.token })
    expect(rejected.response.status).toBe(401)
    expect(rejected.payload).toMatchObject({
      ok: false,
      error: { code: 'CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED' },
    })
    expect(rejected.payload.error.message).not.toMatch(/missing scopes|permission/i)
  })

  it('stores only opaque metadata, never upgrades to a session, and defaults unknown routes to deny', async () => {
    const grant = await createGrant(`Route policy ${Date.now()}`, [
      'applications:read',
      'settings:read',
      'settings:write',
    ])
    const listed = await request('/api/codex/authorizations', { token: sessionToken })
    const serialized = JSON.stringify(listed.payload)
    expect(serialized).not.toContain(grant.token)
    expect(serialized).not.toContain('tokenHash')
    expect(serialized).not.toContain('tokenSelector')

    const applications = await request('/api/applications', { token: grant.token })
    expect(applications.response.status, JSON.stringify(applications.payload)).toBe(200)
    expect(applications.payload.session).toBeUndefined()
    expect(applications.response.headers.get('x-session-token')).toBeNull()

    const sessionUpgrade = await request('/api/auth/me', { token: grant.token })
    expect(sessionUpgrade.response.status).toBe(403)
    const defaultDenied = await request('/api/workspace/bootstrap', { token: grant.token })
    expect(defaultDenied.response.status).toBe(403)
    expect(defaultDenied.payload).toMatchObject({
      ok: false,
      error: { code: 'CODEX_WORKSPACE_BOOTSTRAP_FORBIDDEN' },
    })
    const streamDenied = await request('/api/workspace/bootstrap/stream?sections=applications', {
      token: grant.token,
    })
    expect(streamDenied.response.status).toBe(403)
    expect(streamDenied.payload).toMatchObject({
      ok: false,
      error: { code: 'CODEX_WORKSPACE_BOOTSTRAP_FORBIDDEN' },
    })
    const interviewDenied = await request('/api/interview-prep/workspace?subjectUserId=user-owner', {
      token: grant.token,
    })
    expect(interviewDenied.response.status).toBe(403)
    expect(interviewDenied.payload).toMatchObject({
      ok: false,
      error: { code: 'CODEX_SCOPE_REQUIRED' },
    })
    const publicCapability = await request('/api/share/not-a-real-share', { token: grant.token })
    expect(publicCapability.response.status).toBe(403)

    const settingsMutationId = `codex-settings:${Date.now()}-ack`
    const negotiated = await request('/api/settings', {
      token: grant.token,
      method: 'PATCH',
      headers: {
        'x-phd-settings-acknowledgement': 'v1',
        'x-phd-settings-mutation-id': settingsMutationId,
      },
      body: { language: 'en' },
    })
    expect(negotiated.response.status, JSON.stringify(negotiated.payload)).toBe(200)
    expect(negotiated.data).toMatchObject({
      protocol: 'phd-atlas-settings-ack-v1',
      version: 1,
      durable: true,
      mutationId: settingsMutationId,
      settingsVersion: expect.any(Number),
      keys: ['language'],
      secretReceipts: {},
      user: {
        id: sessionUserId,
        settingsVersion: expect.any(Number),
        settings: { language: 'en' },
      },
    })
    expect(JSON.stringify(negotiated.data)).not.toMatch(/smtpPass|incomingPass|calendarToken/)
    const replayed = await request('/api/settings', {
      token: grant.token,
      method: 'PATCH',
      headers: {
        'x-phd-settings-acknowledgement': 'v1',
        'x-phd-settings-mutation-id': settingsMutationId,
      },
      body: { language: 'en' },
    })
    expect(replayed.response.status, JSON.stringify(replayed.payload)).toBe(409)
    expect(replayed.payload).toMatchObject({
      ok: false,
      error: { code: 'SETTINGS_MUTATION_REPLAYED' },
    })

    const lowRisk = await request('/api/settings', {
      token: grant.token,
      method: 'PATCH',
      body: { language: 'en' },
    })
    expect(lowRisk.response.status, JSON.stringify(lowRisk.payload)).toBe(200)
    expect(lowRisk.data).toMatchObject({
      protocol: 'phd-atlas-settings-ack-v1',
      durable: true,
      user: {
        id: expect.any(String),
        name: expect.any(String),
        email: sessionUserEmail,
        role: expect.any(String),
        settings: { language: 'en' },
      },
    })
    expect(lowRisk.data.user.plan).toBeUndefined()
    expect(lowRisk.data.user.settings).not.toHaveProperty('smtp')
    expect(lowRisk.data.user.settings).not.toHaveProperty('profilePresets')
    expect(lowRisk.data.user.settings).not.toHaveProperty('aiProfile')
    expect(lowRisk.data.user.settings).not.toHaveProperty('autoBackup')
    expect(lowRisk.data.user.settings).not.toHaveProperty('sessionDurationMinutes')
    expect(lowRisk.data.user.settings).not.toHaveProperty('calendarToken')
    expect(lowRisk.data.user.settings).not.toHaveProperty('storageQuotaMb')
    const mailField = await request('/api/settings', {
      token: grant.token,
      method: 'PATCH',
      body: { smtpHost: 'smtp.example.test' },
    })
    expect(mailField.response.status).toBe(403)
    const forbiddenField = await request('/api/settings', {
      token: grant.token,
      method: 'PATCH',
      body: { storageQuotaMb: 999 },
    })
    expect(forbiddenField.response.status).toBe(403)

    const safeSettings = await request('/api/codex/settings', { token: grant.token })
    expect(safeSettings.response.status, JSON.stringify(safeSettings.payload)).toBe(200)
    expect(JSON.stringify(safeSettings.data)).not.toMatch(/smtpPass|incomingPass|calendarToken|sessionDurationMinutes/)

    const scopedGrant = await createGrant(`Settings projection ${Date.now()}`, [
      'settings:write',
      'profile:read',
      'backups:manage',
      'mail:manage',
      'ai:read',
    ])
    const scopedPatch = await request('/api/settings', {
      token: scopedGrant.token,
      method: 'PATCH',
      body: { language: 'en' },
    })
    expect(scopedPatch.response.status, JSON.stringify(scopedPatch.payload)).toBe(200)
    expect(scopedPatch.data).toMatchObject({
      protocol: 'phd-atlas-settings-ack-v1',
      durable: true,
      user: { settings: { language: 'en' } },
    })
    expect(JSON.stringify(scopedPatch.data)).not.toMatch(/smtpPass|incomingPass|calendarToken|sessionDurationMinutes|storageQuotaMb/)
  })

  it('allows an interview:read scope v2 authorization to read its workspace', async () => {
    const grant = await createGrant(`Interview read ${Date.now()}`, ['interview:read'])
    const workspace = await request(
      `/api/interview-prep/workspace?subjectUserId=${encodeURIComponent(sessionUserId)}`,
      { token: grant.token },
    )
    expect(workspace.response.status, JSON.stringify(workspace.payload)).toBe(200)
    expect(workspace.data).toMatchObject({
      subjectUserId: sessionUserId,
      revision: 0,
    })
  })

  it('provides atomic recommender CRUD without a whole-settings overwrite', async () => {
    const grant = await createGrant(`Recommender CRUD ${Date.now()}`, ['profile:read', 'profile:write'])
    const id = `codex-recommender-${Date.now()}`
    const created = await request('/api/codex/profile-recommenders', {
      token: grant.token,
      method: 'POST',
      body: {
        id,
        name: 'Professor Codex',
        email: 'codex-recommender@example.edu',
        institution: 'Example University',
      },
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(201)

    const updated = await request(`/api/codex/profile-recommenders/${encodeURIComponent(id)}`, {
      token: grant.token,
      method: 'PATCH',
      body: { notes: 'Updated atomically' },
    })
    expect(updated.response.status, JSON.stringify(updated.payload)).toBe(200)
    expect(updated.data.notes).toBe('Updated atomically')

    const listed = await request('/api/codex/profile-recommenders', { token: grant.token })
    expect(listed.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, name: 'Professor Codex', notes: 'Updated atomically' }),
    ]))

    const removed = await request(`/api/codex/profile-recommenders/${encodeURIComponent(id)}`, {
      token: grant.token,
      method: 'DELETE',
    })
    expect(removed.response.status, JSON.stringify(removed.payload)).toBe(200)
  })

  it('keeps linked profile-private fields out of write-only recommender receipts', async () => {
    const suffix = Date.now()
    const profileId = `codex-private-profile-${suffix}`
    const secret = `directory-secret-${suffix}`
    const writeOnly = await createGrant(`Recommender write receipt ${suffix}`, [
      'applications:write',
      'profile:write',
    ])
    const readable = await createGrant(`Recommender readable receipt ${suffix}`, [
      'applications:read',
      'applications:write',
      'profile:read',
      'profile:write',
    ])
    const createdProfile = await request('/api/codex/profile-recommenders', {
      token: writeOnly.token,
      method: 'POST',
      body: {
        id: profileId,
        name: `Professor Private ${suffix}`,
        email: `private-${suffix}@example.edu`,
        phone: '+44 20 7000 0099',
        title: 'Secret title',
        institution: 'Secret institution',
        relationship: 'Secret relationship',
        notes: secret,
      },
    })
    expect(createdProfile.response.status, JSON.stringify(createdProfile.payload)).toBe(201)
    expect(JSON.stringify(createdProfile.data)).not.toContain(secret)
    expect(createdProfile.data).not.toHaveProperty('createdAt')
    expect(Object.keys(createdProfile.data).sort()).toEqual([
      'email',
      'id',
      'name',
      'phone',
      'updatedAt',
    ])
    const updatedProfile = await request(
      `/api/codex/profile-recommenders/${encodeURIComponent(profileId)}`,
      {
        token: writeOnly.token,
        method: 'PATCH',
        body: { phone: '+44 20 7000 0100' },
      },
    )
    expect(updatedProfile.response.status, JSON.stringify(updatedProfile.payload)).toBe(200)
    expect(JSON.stringify(updatedProfile.data)).not.toContain(secret)
    expect(updatedProfile.data).not.toHaveProperty('createdAt')
    expect(Object.keys(updatedProfile.data).sort()).toEqual([
      'email',
      'id',
      'name',
      'phone',
      'updatedAt',
    ])
    const profileReceipt = updatedProfile.data

    const createdApplication = await request('/api/applications', {
      token: sessionToken,
      method: 'POST',
      body: {
        professor: `Professor Scope ${suffix}`,
        professorChinese: '',
        professorEmail: `scope-${suffix}@example.edu`,
        professorHomepage: '',
        university: `Scope ${suffix} University`,
        country: 'United Kingdom',
        website: '',
        program: 'Scope isolation PhD',
        deadline: '2027-01-15',
        notes: '',
      },
    })
    expect(createdApplication.response.status, JSON.stringify(createdApplication.payload)).toBe(201)
    applicationIds.add(createdApplication.data.id)

    try {
      const canonical = await request(`/api/applications/${createdApplication.data.id}`, {
        token: sessionToken,
      })
      expect(canonical.response.status, JSON.stringify(canonical.payload)).toBe(200)
      const firstRow = {
        id: `row-write-only-${suffix}`,
        profileId,
        name: profileReceipt.name,
        email: profileReceipt.email,
        phone: profileReceipt.phone,
        contact: profileReceipt.email,
        notes: 'Caller-authored application note',
      }
      const writeReceipt = await request(
        `/api/applications/${createdApplication.data.id}/recommenders/${firstRow.id}/resolve`,
        {
          token: writeOnly.token,
          method: 'POST',
          body: {
            recommender: firstRow,
            decision: 'auto',
            expectedApplicationUpdatedAt: canonical.data.updatedAt,
            expectedProfileUpdatedAt: profileReceipt.updatedAt,
          },
        },
      )
      expect(writeReceipt.response.status, JSON.stringify(writeReceipt.payload)).toBe(200)
      expect(JSON.stringify(writeReceipt.data)).not.toContain(secret)
      expect(writeReceipt.data.profile).toEqual({
        id: profileId,
        name: profileReceipt.name,
        email: profileReceipt.email,
        phone: profileReceipt.phone,
        updatedAt: profileReceipt.updatedAt,
      })
      expect(writeReceipt.data.profile).not.toHaveProperty('createdAt')
      expect(writeReceipt.data.profiles).toEqual([writeReceipt.data.profile])
      expect(writeReceipt.data.applications).toEqual([])
      expect(writeReceipt.data.application.recommenders).toEqual([
        expect.objectContaining({ id: firstRow.id, notes: firstRow.notes }),
      ])
      expect(Number.isSafeInteger(writeReceipt.data.directoryRevision)).toBe(true)

      const latest = await request(`/api/applications/${createdApplication.data.id}`, {
        token: sessionToken,
      })
      expect(latest.response.status, JSON.stringify(latest.payload)).toBe(200)
      // A distinct person: one application may not hold two rows sharing an
      // email address. This row exists only so a second resolve can be issued
      // with the readable token, and the receipt still carries the whole
      // profile directory — including the first row's private notes.
      const secondRow = {
        id: `row-readable-${suffix}`,
        name: `Professor Readable ${suffix}`,
        email: `readable-${suffix}@example.edu`,
        phone: profileReceipt.phone,
        contact: `readable-${suffix}@example.edu`,
        notes: 'Second caller-authored application note',
      }
      const readableReceipt = await request(
        `/api/applications/${createdApplication.data.id}/recommenders/${secondRow.id}/resolve`,
        {
          token: readable.token,
          method: 'POST',
          body: {
            recommender: secondRow,
            decision: 'auto',
            expectedApplicationUpdatedAt: latest.data.updatedAt,
          },
        },
      )
      expect(readableReceipt.response.status, JSON.stringify(readableReceipt.payload)).toBe(200)
      expect(JSON.stringify(readableReceipt.data)).toContain(secret)
      expect(readableReceipt.data.profiles).toContainEqual(expect.objectContaining({
        id: profileId,
        createdAt: expect.any(String),
        notes: secret,
      }))
      expect(readableReceipt.data.application.recommenders.map((row) => row.id))
        .toEqual(expect.arrayContaining([firstRow.id, secondRow.id]))
      expect(readableReceipt.data.directoryRevision).toBeGreaterThan(writeReceipt.data.directoryRevision)
    } finally {
      await request(`/api/codex/profile-recommenders/${encodeURIComponent(profileId)}`, {
        token: writeOnly.token,
        method: 'DELETE',
      })
    }
  })

  it('redacts public capability paths from notification string fields', async () => {
    const inviteToken = `codex-notification-secret-${Date.now()}`
    await insertNotificationIfNew(sessionUserId, {
      type: 'team_invite',
      applicationId: null,
      title: 'Private Team invitation',
      body: 'A Team invitation is waiting.',
      dedupeKey: `codex-notification-${Date.now()}`,
      triggerDate: '2026-08-02',
      targetPath: `/team/accept-invite/${inviteToken}`,
      metadata: {
        inviteUrl: `/team/accept-invite/${inviteToken}`,
        token: inviteToken,
      },
    })
    const grant = await createGrant(`Notification redaction ${Date.now()}`, ['notifications:read'])
    const notifications = await request('/api/notifications', { token: grant.token })
    expect(notifications.response.status, JSON.stringify(notifications.payload)).toBe(200)
    expect(JSON.stringify(notifications.data)).not.toContain(inviteToken)
  })

  it('prevents grant expansion and revokes the current bearer immediately', async () => {
    const grant = await createGrant(`Revoke boundary ${Date.now()}`, ['applications:read'])
    const scopeExpansion = await request(`/api/codex/authorizations/${grant.authorization.id}`, {
      token: sessionToken,
      method: 'PATCH',
      body: {
      scopeVersion: 2,
        scopes: ['applications:read', 'applications:write'],
      },
    })
    expect(scopeExpansion.response.status).toBe(409)

    const lifetimeExpansion = await request(`/api/codex/authorizations/${grant.authorization.id}`, {
      token: sessionToken,
      method: 'PATCH',
      body: { expiresInDays: 365 },
    })
    expect(lifetimeExpansion.response.status).toBe(409)

    const revoked = await request('/api/codex/authorizations/current', {
      token: grant.token,
      method: 'DELETE',
    })
    expect(revoked.response.status, JSON.stringify(revoked.payload)).toBe(200)
    const retry = await request('/api/codex/whoami', { token: grant.token })
    expect(retry.response.status).toBe(401)
  })

  it('supports safe application GET -> PUT and strips capability secrets from reads and exports', async () => {
    const createdApplication = await request('/api/applications', {
      token: sessionToken,
      method: 'POST',
      body: {
        professor: 'Professor Codex Boundary',
        professorChinese: '',
        professorEmail: 'codex-boundary@example.edu',
        professorHomepage: '',
        university: `Codex Boundary ${Date.now()}`,
        country: 'United Kingdom',
        website: '',
        program: 'Safe Round Trip PhD',
        deadline: '2027-01-15',
        notes: '',
      },
    })
    expect(createdApplication.response.status, JSON.stringify(createdApplication.payload)).toBe(201)
    applicationIds.add(createdApplication.data.id)
    expect(createdApplication.data).toMatchObject({
      protocol: 'phd-atlas-application-mutation-ack-v2',
      durable: true,
    })
    const canonicalCreatedApplication = await request(
      `/api/applications/${encodeURIComponent(createdApplication.data.id)}`,
      { token: sessionToken },
    )
    expect(
      canonicalCreatedApplication.response.status,
      JSON.stringify(canonicalCreatedApplication.payload),
    ).toBe(200)

    const seededCommunication = {
      id: `communication-${Date.now()}`,
      subject: 'Private seeded correspondence',
      channel: 'Email',
      date: '2026-08-02',
      summary: 'Must require communications:read',
      direction: 'incoming',
      messageType: 'email',
      from: 'professor@example.edu',
      to: 'jasper@example.com',
      time: '10:00',
      attachments: [],
    }
    const seeded = await request(`/api/applications/${createdApplication.data.id}`, {
      token: sessionToken,
      method: 'PUT',
      body: {
        ...canonicalCreatedApplication.data,
        communications: [seededCommunication],
      },
    })
    expect(seeded.response.status, JSON.stringify(seeded.payload)).toBe(200)

    const share = await request(`/api/applications/${createdApplication.data.id}/share`, {
      token: sessionToken,
      method: 'POST',
      body: {},
    })
    expect(share.response.status, JSON.stringify(share.payload)).toBe(201)
    const originalShareToken = share.data.token

    const grant = await createGrant(`Safe export ${Date.now()}`, [
      'applications:read',
      'applications:write',
      'exports:read',
      'shares:manage',
      'communications:send',
    ])
    const read = await request(`/api/applications/${createdApplication.data.id}`, { token: grant.token })
    expect(read.response.status, JSON.stringify(read.payload)).toBe(200)
    expect(JSON.stringify(read.data)).not.toContain(originalShareToken)
    expect(read.data.shares[0].token).toBeUndefined()
    expect(read.data.communications).toBeUndefined()
    expect(read.data.reviewComments).toBeUndefined()

    const saved = await request(`/api/applications/${createdApplication.data.id}`, {
      token: grant.token,
      method: 'PUT',
      body: {
        ...read.data,
        program: `${read.data.program} Updated`,
        communications: [{ ...seededCommunication, subject: 'Unauthorized replacement' }],
      },
    })
    expect(saved.response.status, JSON.stringify(saved.payload)).toBe(200)
    expect(saved.data).toMatchObject({
      protocol: 'phd-atlas-application-mutation-ack-v2',
      durable: true,
      id: createdApplication.data.id,
    })
    expect(JSON.stringify(saved.data)).not.toContain(originalShareToken)

    const browserRead = await request(`/api/applications/${createdApplication.data.id}`, {
      token: sessionToken,
    })
    expect(browserRead.data.program).toBe(`${read.data.program} Updated`)
    expect(browserRead.data.shares[0].token).toBe(originalShareToken)
    expect(browserRead.data.communications).toEqual([
      expect.objectContaining({ id: seededCommunication.id, subject: seededCommunication.subject }),
    ])

    const exported = await request(
      `/api/exports?format=json&applicationId=${encodeURIComponent(createdApplication.data.id)}`,
      { token: grant.token },
    )
    expect(exported.response.status).toBe(200)
    expect(JSON.stringify(exported.payload)).not.toContain(originalShareToken)

    const issued = await request(`/api/applications/${createdApplication.data.id}/share`, {
      token: grant.token,
      method: 'POST',
      body: {},
    })
    expect(issued.response.status, JSON.stringify(issued.payload)).toBe(201)
    expect(issued.data.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(issued.data.url).toContain(issued.data.token)
  })
})
