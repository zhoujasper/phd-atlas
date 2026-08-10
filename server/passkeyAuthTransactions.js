function normalizedText(value) {
  return String(value ?? '').trim()
}

function normalizedCounter(value) {
  const counter = Number(value)
  return Number.isSafeInteger(counter) && counter >= 0 ? counter : 0
}

function parsedMetadata(value) {
  try {
    const metadata = JSON.parse(String(value ?? '{}'))
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
  } catch {
    return {}
  }
}

function metadataMatches(metadata, expected = {}) {
  return Object.entries(expected).every(([key, value]) => (
    value === undefined || String(metadata?.[key] ?? '') === String(value ?? '')
  ))
}

function invokeStage(onStage, stage) {
  if (typeof onStage !== 'function') return
  const result = onStage(stage)
  if (result && typeof result.then === 'function') {
    throw new TypeError('Passkey transaction stage hooks must be synchronous.')
  }
}

class PasskeyTransactionAbort extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'PasskeyTransactionAbort'
    this.reason = reason
  }
}

function abort(reason) {
  throw new PasskeyTransactionAbort(reason)
}

function runImmediate(database, operation) {
  try {
    return database.transaction(operation).immediate()
  } catch (error) {
    if (error instanceof PasskeyTransactionAbort) return { ok: false, reason: error.reason }
    throw error
  }
}

function challengeRow(database, input) {
  const row = database.prepare(
    `SELECT id, purpose, user_id, challenge_hash, expires_at, used_at, metadata_json
       FROM webauthn_challenges
      WHERE id = ? AND purpose = ? AND challenge_hash = ?
      LIMIT 1`,
  ).get(input.id, input.purpose, input.challengeHash)
  if (!row || row.used_at || row.expires_at <= input.at) return null
  const metadata = parsedMetadata(row.metadata_json)
  if (!metadataMatches(metadata, input.expectedMetadata)) return null
  if (
    input.expectedUserId
    && row.user_id
    && row.user_id !== input.expectedUserId
  ) return null
  return { ...row, metadata }
}

export function readWebAuthnChallengeRecord(database, input) {
  const row = database.prepare(
    `SELECT id, purpose, user_id, challenge_hash, expires_at, used_at, metadata_json
       FROM webauthn_challenges
      WHERE purpose = ? AND challenge_hash = ?
      LIMIT 1`,
  ).get(input.purpose, input.challengeHash)
  if (!row || row.used_at || row.expires_at <= input.at) return null
  return {
    id: row.id,
    purpose: row.purpose,
    userId: row.user_id,
    challengeHash: row.challenge_hash,
    expiresAt: row.expires_at,
    metadata: parsedMetadata(row.metadata_json),
  }
}

function claimChallenge(database, challenge, usedAt) {
  const claimed = database.prepare(
    `UPDATE webauthn_challenges
        SET used_at = ?
      WHERE id = ? AND purpose = ? AND challenge_hash = ?
        AND used_at IS NULL AND expires_at > ?`,
  ).run(
    usedAt,
    challenge.id,
    challenge.purpose,
    challenge.challenge_hash,
    usedAt,
  )
  if (Number(claimed.changes ?? 0) !== 1) abort('INVALID_CHALLENGE')
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

function accountMutationRow(database, guard) {
  const row = database.prepare(
    `SELECT id, role, disabled_at, auth_version
       FROM users WHERE id = ? LIMIT 1`,
  ).get(guard.id)
  if (!row) abort('UNKNOWN_USER')
  if (row.disabled_at) abort('ACCOUNT_DISABLED')
  if (row.role !== guard.role) abort('AUTH_CHANGED')
  if (normalizedCounter(row.auth_version) !== normalizedCounter(guard.authVersion)) {
    abort('AUTH_CHANGED')
  }
  return row
}

export function commitWebAuthnAuthenticationTransaction(database, input, dependencies = {}) {
  return runImmediate(database, () => {
    const challenge = challengeRow(database, {
      ...input.challenge,
      expectedUserId: input.credential.userId,
    })
    if (!challenge) return { ok: false, reason: 'INVALID_CHALLENGE' }

    const row = database.prepare(
      `SELECT passkey.id, passkey.user_id, passkey.credential_id,
              passkey.public_key, passkey.counter,
              account.role, account.disabled_at, account.auth_version
         FROM webauthn_passkeys passkey
         JOIN users account ON account.id = passkey.user_id
        WHERE passkey.credential_id = ?
        LIMIT 1`,
    ).get(input.credential.credentialId)
    if (!row || row.id !== input.credential.id || row.user_id !== input.credential.userId) {
      return { ok: false, reason: 'PASSKEY_CHANGED' }
    }
    if (row.public_key !== input.credential.publicKey) {
      return { ok: false, reason: 'PASSKEY_CHANGED' }
    }
    if (normalizedCounter(row.counter) !== normalizedCounter(input.credential.counter)) {
      return { ok: false, reason: 'PASSKEY_CHANGED' }
    }
    if (row.disabled_at) return { ok: false, reason: 'ACCOUNT_DISABLED' }
    if (row.role !== input.user.role) return { ok: false, reason: 'AUTH_CHANGED' }
    if (normalizedCounter(row.auth_version) !== normalizedCounter(input.user.authVersion)) {
      return { ok: false, reason: 'AUTH_CHANGED' }
    }
    if (input.scope === 'admin' && row.role !== 'admin') {
      return { ok: false, reason: 'SCOPE_FORBIDDEN' }
    }

    const previousCounter = normalizedCounter(row.counter)
    const nextCounter = normalizedCounter(input.passkeyUpdate.counter)
    if (previousCounter > 0 && nextCounter <= previousCounter) {
      return { ok: false, reason: 'INVALID_COUNTER' }
    }

    claimChallenge(database, challenge, input.completedAt)
    invokeStage(dependencies.onStage, 'challenge-claimed')

    const updatedPasskey = database.prepare(
      `UPDATE webauthn_passkeys
          SET counter = ?,
              device_type = COALESCE(NULLIF(?, ''), device_type),
              backed_up = ?,
              last_used_at = ?
        WHERE id = ? AND user_id = ? AND credential_id = ?
          AND public_key = ? AND counter = ?`,
    ).run(
      nextCounter,
      input.passkeyUpdate.deviceType ?? '',
      input.passkeyUpdate.backedUp ? 1 : 0,
      input.completedAt,
      row.id,
      row.user_id,
      row.credential_id,
      row.public_key,
      previousCounter,
    )
    if (Number(updatedPasskey.changes ?? 0) !== 1) abort('PASSKEY_CHANGED')
    invokeStage(dependencies.onStage, 'passkey-updated')

    const updatedUser = database.prepare(
      `UPDATE users SET last_login_at = ?
        WHERE id = ? AND disabled_at IS NULL AND role = ? AND auth_version = ?`,
    ).run(
      input.completedAt,
      row.user_id,
      row.role,
      normalizedCounter(row.auth_version),
    )
    if (Number(updatedUser.changes ?? 0) !== 1) abort('AUTH_CHANGED')
    invokeStage(dependencies.onStage, 'user-updated')

    insertEvent(database, input.event)
    invokeStage(dependencies.onStage, 'event-inserted')
    return { ok: true, userId: row.user_id, passkeyId: row.id }
  })
}

export function commitWebAuthnRegistrationTransaction(database, input, dependencies = {}) {
  return runImmediate(database, () => {
    const challenge = challengeRow(database, {
      ...input.challenge,
      expectedUserId: input.user.id,
    })
    if (!challenge || challenge.user_id !== input.user.id) {
      return { ok: false, reason: 'INVALID_CHALLENGE' }
    }
    accountMutationRow(database, input.user)
    if (database.prepare(
      'SELECT 1 FROM webauthn_passkeys WHERE credential_id = ? LIMIT 1',
    ).get(input.passkey.credentialId)) {
      return { ok: false, reason: 'ALREADY_REGISTERED' }
    }

    claimChallenge(database, challenge, input.createdAt)
    invokeStage(dependencies.onStage, 'challenge-claimed')

    database.prepare(
      `INSERT INTO webauthn_passkeys (
         id, user_id, credential_id, public_key, counter, transports_json,
         device_type, backed_up, label, created_at, last_used_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      input.passkey.id,
      input.user.id,
      input.passkey.credentialId,
      input.passkey.publicKey,
      normalizedCounter(input.passkey.counter),
      input.passkey.transportsJson,
      input.passkey.deviceType ?? '',
      input.passkey.backedUp ? 1 : 0,
      normalizedText(input.passkey.label).slice(0, 80),
      input.createdAt,
    )
    invokeStage(dependencies.onStage, 'passkey-inserted')

    insertEvent(database, input.event)
    invokeStage(dependencies.onStage, 'event-inserted')
    return { ok: true, userId: input.user.id, passkeyId: input.passkey.id }
  })
}

export function renameWebAuthnPasskeyTransaction(database, input, dependencies = {}) {
  return runImmediate(database, () => {
    accountMutationRow(database, input.user)
    const row = database.prepare(
      'SELECT id, label FROM webauthn_passkeys WHERE id = ? AND user_id = ? LIMIT 1',
    ).get(input.passkeyId, input.user.id)
    if (!row) return { ok: false, reason: 'NOT_FOUND' }
    const label = normalizedText(input.label).slice(0, 80)
    const updated = database.prepare(
      `UPDATE webauthn_passkeys SET label = ?
        WHERE id = ? AND user_id = ? AND label = ?`,
    ).run(label, row.id, input.user.id, row.label)
    if (Number(updated.changes ?? 0) !== 1) abort('PASSKEY_CHANGED')
    invokeStage(dependencies.onStage, 'passkey-updated')
    insertEvent(database, input.event)
    invokeStage(dependencies.onStage, 'event-inserted')
    return { ok: true, passkeyId: row.id }
  })
}

export function deleteWebAuthnPasskeyTransaction(database, input, dependencies = {}) {
  return runImmediate(database, () => {
    accountMutationRow(database, input.user)
    const deleted = database.prepare(
      'DELETE FROM webauthn_passkeys WHERE id = ? AND user_id = ? RETURNING id',
    ).get(input.passkeyId, input.user.id)
    if (!deleted) return { ok: false, reason: 'NOT_FOUND' }
    invokeStage(dependencies.onStage, 'passkey-deleted')
    insertEvent(database, input.event)
    invokeStage(dependencies.onStage, 'event-inserted')
    return { ok: true, passkeyId: deleted.id }
  })
}
