import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  commitWebAuthnAuthenticationTransaction,
  commitWebAuthnRegistrationTransaction,
  deleteWebAuthnPasskeyTransaction,
  readWebAuthnChallengeRecord,
  renameWebAuthnPasskeyTransaction,
} from './passkeyAuthTransactions.js'

function createDatabase() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      auth_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      disabled_at TEXT,
      settings_json TEXT NOT NULL
    );

    CREATE TABLE webauthn_challenges (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      user_id TEXT,
      challenge_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE webauthn_passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports_json TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL DEFAULT '',
      backed_up INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE system_events (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
  `)
  return database
}

function seedUser(database, suffix = 'owner', overrides = {}) {
  const user = {
    id: `user_${suffix}`,
    role: overrides.role ?? 'user',
    authVersion: overrides.authVersion ?? 3,
    disabledAt: overrides.disabledAt ?? null,
  }
  database.prepare(
    `INSERT INTO users (
       id, name, email, role, password_hash, auth_version, created_at,
       last_login_at, disabled_at, settings_json
     ) VALUES (?, ?, ?, ?, 'unused', ?, ?, NULL, ?, ?)`,
  ).run(
    user.id,
    `Passkey ${suffix}`,
    `${suffix}@example.test`,
    user.role,
    user.authVersion,
    new Date().toISOString(),
    user.disabledAt,
    JSON.stringify({ authVersion: user.authVersion }),
  )
  return user
}

function seedChallenge(database, {
  suffix,
  purpose,
  userId = null,
  metadata = {},
}) {
  const now = new Date().toISOString()
  const challenge = {
    id: `challenge_${suffix}`,
    purpose,
    challengeHash: `challenge-hash-${suffix}`,
    at: now,
    expectedMetadata: metadata,
  }
  database.prepare(
    `INSERT INTO webauthn_challenges (
       id, purpose, user_id, challenge_hash, created_at, expires_at,
       used_at, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    challenge.id,
    purpose,
    userId,
    challenge.challengeHash,
    now,
    new Date(Date.now() + 60_000).toISOString(),
    JSON.stringify(metadata),
  )
  return challenge
}

function seedPasskey(database, user, suffix = 'credential', overrides = {}) {
  const passkey = {
    id: `passkey_${suffix}`,
    userId: user.id,
    credentialId: `credential-${suffix}`,
    publicKey: `public-key-${suffix}`,
    counter: overrides.counter ?? 8,
  }
  database.prepare(
    `INSERT INTO webauthn_passkeys (
       id, user_id, credential_id, public_key, counter, transports_json,
       device_type, backed_up, label, created_at, last_used_at
     ) VALUES (?, ?, ?, ?, ?, '["internal"]', 'singleDevice', 0, ?, ?, NULL)`,
  ).run(
    passkey.id,
    passkey.userId,
    passkey.credentialId,
    passkey.publicKey,
    passkey.counter,
    `Passkey ${suffix}`,
    new Date().toISOString(),
  )
  return passkey
}

function event(suffix, actorId, message) {
  return {
    id: `event_${suffix}`,
    time: new Date().toISOString(),
    scope: 'Authentication',
    actorId,
    message,
    metadataJson: '{}',
  }
}

function authenticationInput(database, suffix, overrides = {}) {
  const user = overrides.user ?? seedUser(database, suffix)
  const passkey = overrides.passkey ?? seedPasskey(database, user, suffix, overrides)
  const metadata = { origin: 'https://atlas.example', rpID: 'atlas.example', scope: 'app' }
  const challenge = overrides.challenge ?? seedChallenge(database, {
    suffix,
    purpose: 'authentication',
    userId: overrides.discoverable ? null : user.id,
    metadata,
  })
  const completedAt = new Date().toISOString()
  return {
    challenge,
    credential: passkey,
    user,
    scope: 'app',
    passkeyUpdate: {
      counter: passkey.counter > 0 ? passkey.counter + 1 : 0,
      deviceType: 'multiDevice',
      backedUp: true,
    },
    completedAt,
    event: event(`login_${suffix}`, user.id, 'User signed in with passkey'),
  }
}

function registrationInput(database, suffix, overrides = {}) {
  const user = overrides.user ?? seedUser(database, suffix)
  const metadata = {
    origin: 'https://atlas.example',
    rpID: 'atlas.example',
    authVersion: user.authVersion,
  }
  return {
    challenge: overrides.challenge ?? seedChallenge(database, {
      suffix,
      purpose: 'registration',
      userId: user.id,
      metadata,
    }),
    user,
    passkey: {
      id: `passkey_registration_${suffix}`,
      credentialId: overrides.credentialId ?? `registration-credential-${suffix}`,
      publicKey: `registration-public-key-${suffix}`,
      counter: 0,
      transportsJson: '["internal"]',
      deviceType: 'multiDevice',
      backedUp: true,
      label: `Registered ${suffix}`,
    },
    createdAt: new Date().toISOString(),
    event: event(`registration_${suffix}`, user.id, 'Passkey added'),
  }
}

describe.sequential('passkey authentication transactions', () => {
  it('reads a challenge for verification without consuming it', () => {
    const database = createDatabase()
    try {
      const user = seedUser(database, 'read')
      const metadata = { origin: 'https://atlas.example', rpID: 'atlas.example' }
      const challenge = seedChallenge(database, {
        suffix: 'read',
        purpose: 'registration',
        userId: user.id,
        metadata,
      })
      expect(readWebAuthnChallengeRecord(database, challenge)).toMatchObject({
        id: challenge.id,
        userId: user.id,
        metadata,
      })
      expect(database.prepare(
        'SELECT used_at FROM webauthn_challenges WHERE id = ?',
      ).get(challenge.id).used_at).toBeNull()
    } finally {
      database.close()
    }
  })

  for (const stage of ['challenge-claimed', 'passkey-updated', 'user-updated', 'event-inserted']) {
    it(`rolls authentication back after the ${stage} failpoint`, () => {
      const database = createDatabase()
      try {
        const input = authenticationInput(database, stage)
        expect(() => commitWebAuthnAuthenticationTransaction(database, input, {
          onStage: (current) => {
            if (current === stage) throw new Error(`failpoint:${stage}`)
          },
        })).toThrow(`failpoint:${stage}`)
        expect(database.prepare(
          'SELECT used_at FROM webauthn_challenges WHERE id = ?',
        ).get(input.challenge.id).used_at).toBeNull()
        expect(database.prepare(
          'SELECT counter, last_used_at FROM webauthn_passkeys WHERE id = ?',
        ).get(input.credential.id)).toEqual({
          counter: input.credential.counter,
          last_used_at: null,
        })
        expect(database.prepare(
          'SELECT last_login_at FROM users WHERE id = ?',
        ).get(input.user.id).last_login_at).toBeNull()
        expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(0)
      } finally {
        database.close()
      }
    })
  }

  for (const stage of ['challenge-claimed', 'passkey-inserted', 'event-inserted']) {
    it(`rolls registration back after the ${stage} failpoint`, () => {
      const database = createDatabase()
      try {
        const input = registrationInput(database, stage)
        expect(() => commitWebAuthnRegistrationTransaction(database, input, {
          onStage: (current) => {
            if (current === stage) throw new Error(`failpoint:${stage}`)
          },
        })).toThrow(`failpoint:${stage}`)
        expect(database.prepare(
          'SELECT used_at FROM webauthn_challenges WHERE id = ?',
        ).get(input.challenge.id).used_at).toBeNull()
        expect(database.prepare('SELECT COUNT(*) AS count FROM webauthn_passkeys').get().count).toBe(0)
        expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(0)
      } finally {
        database.close()
      }
    })
  }

  it('allows exactly one of 50 commits for one authentication challenge', async () => {
    const database = createDatabase()
    try {
      const input = authenticationInput(database, 'concurrent')
      const outcomes = await Promise.all(Array.from({ length: 50 }, (_, index) => (
        Promise.resolve().then(() => commitWebAuthnAuthenticationTransaction(database, {
          ...input,
          event: event(`concurrent_login_${index}`, input.user.id, 'User signed in with passkey'),
        }))
      )))
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.reason === 'INVALID_CHALLENGE')).toHaveLength(49)
      expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(1)
      expect(database.prepare(
        'SELECT counter FROM webauthn_passkeys WHERE id = ?',
      ).get(input.credential.id).counter).toBe(input.passkeyUpdate.counter)
    } finally {
      database.close()
    }
  })

  it('rejects stale credential and account guards without consuming the challenge', () => {
    for (const mutation of ['counter', 'auth-version', 'disabled']) {
      const database = createDatabase()
      try {
        const input = authenticationInput(database, `stale_${mutation}`)
        if (mutation === 'counter') {
          database.prepare('UPDATE webauthn_passkeys SET counter = counter + 1 WHERE id = ?')
            .run(input.credential.id)
        } else if (mutation === 'auth-version') {
          database.prepare('UPDATE users SET auth_version = auth_version + 1 WHERE id = ?')
            .run(input.user.id)
        } else {
          database.prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
            .run(new Date().toISOString(), input.user.id)
        }
        const outcome = commitWebAuthnAuthenticationTransaction(database, input)
        expect(outcome.ok).toBe(false)
        expect(database.prepare(
          'SELECT used_at FROM webauthn_challenges WHERE id = ?',
        ).get(input.challenge.id).used_at).toBeNull()
        expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(0)
      } finally {
        database.close()
      }
    }
  })

  it('registers one credential once and leaves duplicate challenges unused', () => {
    const database = createDatabase()
    try {
      const first = registrationInput(database, 'first', { credentialId: 'shared-credential' })
      const secondUser = seedUser(database, 'second')
      const second = registrationInput(database, 'second', {
        user: secondUser,
        credentialId: 'shared-credential',
      })
      expect(commitWebAuthnRegistrationTransaction(database, first).ok).toBe(true)
      expect(commitWebAuthnRegistrationTransaction(database, second)).toEqual({
        ok: false,
        reason: 'ALREADY_REGISTERED',
      })
      expect(database.prepare(
        'SELECT used_at FROM webauthn_challenges WHERE id = ?',
      ).get(second.challenge.id).used_at).toBeNull()
      expect(database.prepare('SELECT COUNT(*) AS count FROM webauthn_passkeys').get().count).toBe(1)
      expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(1)
    } finally {
      database.close()
    }
  })

  it('rolls rename and delete back with their audit event', () => {
    for (const operation of ['rename', 'delete']) {
      const database = createDatabase()
      try {
        const user = seedUser(database, operation)
        const passkey = seedPasskey(database, user, operation)
        const eventInput = event(`${operation}_rollback`, user.id, `Passkey ${operation}d`)
        const execute = operation === 'rename'
          ? () => renameWebAuthnPasskeyTransaction(database, {
              user,
              passkeyId: passkey.id,
              label: 'Changed label',
              event: eventInput,
            }, { onStage: (stage) => { if (stage === 'event-inserted') throw new Error('rollback') } })
          : () => deleteWebAuthnPasskeyTransaction(database, {
              user,
              passkeyId: passkey.id,
              event: eventInput,
            }, { onStage: (stage) => { if (stage === 'event-inserted') throw new Error('rollback') } })
        expect(execute).toThrow('rollback')
        expect(database.prepare(
          'SELECT label FROM webauthn_passkeys WHERE id = ?',
        ).get(passkey.id).label).toBe(`Passkey ${operation}`)
        expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(0)
      } finally {
        database.close()
      }
    }
  })
})
