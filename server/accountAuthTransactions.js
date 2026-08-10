import { timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { canonicalRegistrationEmail } from './antiAbuse.js'

function normalizedText(value) {
  return String(value ?? '').trim()
}

export function normalizeAccountAuthVersion(value) {
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 0 ? version : 0
}

function storedSettings(settingsJson) {
  try {
    const value = JSON.parse(String(settingsJson ?? '{}'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function primaryRecoveryEmail(email, settings = {}) {
  const accountEmail = normalizedText(email).toLowerCase()
  const receiveEmails = Array.isArray(settings.receiveEmails) && settings.receiveEmails.length > 0
    ? settings.receiveEmails
    : [{ address: settings.receiveAt ?? accountEmail, isPrimary: true }]
  const primary = receiveEmails.find((candidate) => candidate?.isPrimary) ?? receiveEmails[0]
  return normalizedText(primary?.address || settings.receiveAt || accountEmail).toLowerCase()
}

export function accountAuthProjection({ id, email, settings = {}, authVersion } = {}) {
  return {
    id: normalizedText(id),
    canonicalEmail: canonicalRegistrationEmail(email),
    recoveryEmail: primaryRecoveryEmail(email, settings),
    language: normalizedText(settings.language) || 'en',
    authVersion: Math.max(
      normalizeAccountAuthVersion(authVersion),
      normalizeAccountAuthVersion(settings.authVersion),
    ),
  }
}

export function accountAuthProjectionFromRow(row = {}) {
  return accountAuthProjection({
    id: row.id,
    email: row.email,
    settings: storedSettings(row.settings_json),
    authVersion: row.auth_version,
  })
}

function constantTimeTextMatches(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function challengeRowResult(database, input, { consume = false } = {}) {
  const now = new Date(Number(input.nowMs ?? Date.now())).toISOString()
  const row = database.prepare(
    `SELECT id, subject_hash, context_hash, verifier_hash, attempts, max_attempts,
            not_before_at, expires_at, consumed_at
       FROM security_challenges
      WHERE token_hash = ? AND kind = ?`,
  ).get(input.tokenHash, input.kind)

  if (!row || row.consumed_at || row.expires_at <= now || row.not_before_at > now) {
    return { ok: false, reason: 'invalid' }
  }

  const identityMatches = constantTimeTextMatches(row.subject_hash, input.subjectHash)
    && constantTimeTextMatches(row.context_hash, input.contextHash)
  const verifierMatches = constantTimeTextMatches(row.verifier_hash, input.verifierHash)
  if (!identityMatches || !verifierMatches) {
    const attempts = Number(row.attempts ?? 0) + 1
    const consumedAt = attempts >= Number(row.max_attempts) ? now : null
    database.prepare(
      `UPDATE security_challenges
          SET attempts = ?, consumed_at = COALESCE(consumed_at, ?)
        WHERE id = ?`,
    ).run(attempts, consumedAt, row.id)
    return { ok: false, reason: 'invalid' }
  }

  if (!consume) return { ok: true, id: row.id }
  const claimed = database.prepare(
    `UPDATE security_challenges
        SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL
      RETURNING id`,
  ).get(now, row.id)
  return claimed ? { ok: true, id: claimed.id } : { ok: false, reason: 'invalid' }
}

function invokeStage(onStage, stage) {
  if (typeof onStage !== 'function') return
  const result = onStage(stage)
  if (result && typeof result.then === 'function') {
    throw new TypeError('Account authentication transaction stage hooks must be synchronous.')
  }
}

export function verifyRegistrationChallengeTransaction(database, challenge) {
  return database.transaction(() => challengeRowResult(database, challenge)).immediate()
}

export function readRegistrationGateRecord(database, canonicalEmail) {
  const settings = database.prepare(
    `SELECT allow_registration
       FROM system_settings
      WHERE id = 'global'`,
  ).get()
  const normalizedEmail = canonicalRegistrationEmail(canonicalEmail)
  const existing = database.prepare(
    `SELECT 1
       FROM users
      WHERE canonical_email = ? OR email = ?
      LIMIT 1`,
  ).get(normalizedEmail, normalizedText(canonicalEmail).toLowerCase())
  return {
    allowRegistration: Boolean(settings?.allow_registration),
    emailExists: Boolean(existing),
  }
}

function insertEvent(database, event) {
  database.prepare(
    `INSERT INTO system_events (
       id, time, scope, actor_id, message, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.time,
    event.scope,
    event.actorId ?? null,
    event.message,
    event.metadataJson ?? '{}',
  )
}

export function completeRegistrationTransaction(database, input, dependencies = {}) {
  const transact = database.transaction(() => {
    const claimed = challengeRowResult(database, input.challenge, { consume: true })
    if (!claimed.ok) return { ok: false, reason: 'INVALID_EMAIL_CODE' }
    invokeStage(dependencies.onStage, 'challenge-claimed')

    const gate = readRegistrationGateRecord(database, input.user.canonicalEmail)
    if (!gate.allowRegistration) return { ok: false, reason: 'REGISTRATION_CLOSED' }
    if (gate.emailExists) return { ok: false, reason: 'EMAIL_EXISTS' }

    database.prepare(
      `INSERT INTO users (
         id, name, email, canonical_email, recovery_email, language,
         role, password_hash, auth_version, created_at, last_login_at,
         disabled_at, settings_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.user.id,
      input.user.name,
      input.user.email,
      input.user.canonicalEmail,
      input.user.recoveryEmail,
      input.user.language,
      input.user.role,
      input.user.passwordHash,
      normalizeAccountAuthVersion(input.user.authVersion),
      input.user.createdAt,
      input.user.lastLoginAt ?? null,
      input.user.disabledAt ?? null,
      input.user.settingsJson,
    )
    invokeStage(dependencies.onStage, 'user-inserted')

    insertEvent(database, input.event)
    invokeStage(dependencies.onStage, 'event-inserted')

    const mail = dependencies.insertSystemMailJob(database, input.mailJob)
    invokeStage(dependencies.onStage, 'outbox-inserted')
    return { ok: true, userId: input.user.id, mail }
  })
  return transact.immediate()
}

export function readPasswordResetCandidateRecord(database, recoveryEmail) {
  return database.prepare(
    `SELECT id, recovery_email, language
       FROM users
      WHERE recovery_email = ?
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
  ).get(normalizedText(recoveryEmail).toLowerCase()) ?? null
}

export function issuePasswordResetTransaction(database, input, dependencies = {}) {
  const transact = database.transaction(() => {
    const candidate = database.prepare(
      `SELECT id, recovery_email, language
         FROM users
        WHERE id = ? AND recovery_email = ?
        LIMIT 1`,
    ).get(input.userId, normalizedText(input.recoveryEmail).toLowerCase())
    if (!candidate) return { ok: false, reason: 'NOT_FOUND' }

    database.prepare(
      `INSERT INTO password_reset_tokens (
         id, user_id, token_hash, created_at, expires_at, used_at
       ) VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(
      input.tokenId,
      input.userId,
      input.tokenHash,
      input.createdAt,
      input.expiresAt,
    )
    invokeStage(dependencies.onStage, 'token-inserted')

    insertEvent(database, input.event)
    invokeStage(dependencies.onStage, 'event-inserted')

    const mail = dependencies.insertSystemMailJob(database, input.mailJob)
    invokeStage(dependencies.onStage, 'outbox-inserted')
    return { ok: true, candidate, mail }
  })
  return transact.immediate()
}

export function commitPasswordResetTransaction(database, input, dependencies = {}) {
  const transact = database.transaction(() => {
    const now = input.completedAt
    const token = database.prepare(
      `SELECT token.id, token.user_id, user.auth_version
         FROM password_reset_tokens token
         JOIN users user ON user.id = token.user_id
        WHERE token.token_hash = ?
          AND token.used_at IS NULL
          AND token.expires_at > ?
        LIMIT 1`,
    ).get(input.tokenHash, now)
    if (!token) return { ok: false, reason: 'INVALID_TOKEN' }

    const updated = database.prepare(
      `UPDATE users
          SET password_hash = ?, auth_version = auth_version + 1
        WHERE id = ? AND auth_version = ?`,
    ).run(
      input.passwordHash,
      token.user_id,
      normalizeAccountAuthVersion(token.auth_version),
    )
    if (Number(updated.changes ?? 0) !== 1) return { ok: false, reason: 'AUTH_CHANGED' }
    invokeStage(dependencies.onStage, 'user-updated')

    const consumed = database.prepare(
      `UPDATE password_reset_tokens
          SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
    ).run(now, token.id, now)
    if (Number(consumed.changes ?? 0) !== 1) return { ok: false, reason: 'INVALID_TOKEN' }
    invokeStage(dependencies.onStage, 'token-consumed')

    insertEvent(database, {
      ...input.event,
      actorId: token.user_id,
    })
    invokeStage(dependencies.onStage, 'event-inserted')
    return {
      ok: true,
      userId: token.user_id,
      authVersion: normalizeAccountAuthVersion(token.auth_version) + 1,
    }
  })
  return transact.immediate()
}
