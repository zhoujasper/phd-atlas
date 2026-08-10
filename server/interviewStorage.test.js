import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let storage
let testRoot
let sqlitePath

function workspaceFixture(subjectUserId, subjectName, teamId = null, suffix = 'one') {
  const createdAt = '2026-08-02T10:00:00.000Z'
  const interviewId = `interview-${suffix}`
  const questionId = `question-${suffix}`
  const sessionId = `session-${suffix}`
  return {
    subjectUserId,
    subjectName,
    revision: 0,
    interviews: [{
      id: interviewId,
      ownerUserId: subjectUserId,
      teamId,
      applicationId: null,
      sourceCommunicationId: null,
      createdByUserId: subjectUserId,
      title: `Sensitive interview ${suffix}`,
      school: 'Ciphertext University',
      program: 'Private doctoral programme',
      advisor: 'Professor Confidential',
      format: 'video',
      scheduledAt: '2026-08-12T09:30:00.000Z',
      timezone: 'Europe/London',
      durationMinutes: 30,
      participantNames: ['Professor Confidential'],
      status: 'preparing',
      preparationNotes: `Private preparation notes ${suffix}`,
      talkingPoints: 'Unpublished research direction',
      createdAt,
      updatedAt: createdAt,
    }],
    questions: [{
      id: questionId,
      interviewId,
      category: 'research',
      prompt: `Explain the secret research problem ${suffix}`,
      source: 'user',
      createdByUserId: subjectUserId,
      order: 0,
      notes: 'Do not disclose this question',
      createdAt,
      updatedAt: createdAt,
    }],
    mockSessions: [{
      id: sessionId,
      interviewId,
      ownerUserId: subjectUserId,
      mode: 'self',
      status: 'in-progress',
      questionIds: [questionId],
      currentQuestionId: questionId,
      answers: [{
        questionId,
        body: `Private mock answer ${suffix}`,
        confidence: 74,
        updatedAt: createdAt,
      }],
      startedAt: createdAt,
      completedAt: null,
      updatedAt: createdAt,
    }],
    feedback: [{
      id: `feedback-${suffix}`,
      interviewId,
      sessionId,
      questionId,
      authorKind: 'self',
      authorName: subjectName,
      body: `Private feedback body ${suffix}`,
      strengths: ['Evidence'],
      improvements: ['Structure'],
      score: 74,
      createdAt,
      updatedAt: createdAt,
    }],
    updatedAt: createdAt,
  }
}

async function seededScope() {
  const store = await storage.readStore()
  const subject = store.users.find((user) => user.role !== 'admin') ?? store.users[0]
  const secondSubject = store.users.find((user) => user.id !== subject.id)
  const team = store.teams[0]
  expect(subject).toBeTruthy()
  expect(secondSubject).toBeTruthy()
  return { store, subject, secondSubject, team }
}

async function reloadStorage() {
  await storage.shutdownStorage()
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
}

function openRawDatabase() {
  return new Database(sqlitePath, { readonly: true, fileMustExist: true })
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-interview-storage-'))
  sqlitePath = path.join(testRoot, 'workspace.sqlite')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('PHD_ATLAS_STORAGE_ROOT', testRoot)
  vi.stubEnv('PHD_ATLAS_SQLITE_PATH', sqlitePath)
  vi.stubEnv('PHD_ATLAS_SERVER_KEY', 'interview-storage-test-key-only')
}, 60_000)

beforeEach(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  await fs.rm(testRoot, { recursive: true, force: true })
  await fs.mkdir(testRoot, { recursive: true })
  vi.resetModules()
  storage = await import('./storage.js')
  await storage.ensureStorage()
}, 60_000)

afterEach(async () => {
  await storage?.shutdownStorage().catch(() => undefined)
  storage = null
  vi.resetModules()
}, 60_000)

afterAll(async () => {
  vi.unstubAllEnvs()
  await fs.rm(testRoot, { recursive: true, force: true })
}, 60_000)

describe('Interview Prep normalized storage', () => {
  it('rejects a stale Team authorization snapshot inside the immediate save transaction', async () => {
    const { store, team } = await seededScope()
    const members = await storage.listTeamMembers(team.id)
    const target = members.find((member) => member.status === 'active' && member.userId)
    expect(target).toBeTruthy()
    const subject = store.users.find((entry) => entry.id === target.userId)
    expect(subject).toBeTruthy()
    const authorizationVersion = await storage.getInterviewPrepAuthorizationVersion({
      actorId: subject.id,
      subjectUserId: subject.id,
      teamId: team.id,
    })

    await storage.updateTeamMemberRelationships(target.id, {
      ...target.relationships,
      studentPermissions: {
        ...(target.relationships?.studentPermissions ?? {}),
        useInterviewPrep: false,
      },
    })

    await expect(storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      teamId: team.id,
      workspace: workspaceFixture(subject.id, subject.name, team.id, 'revoked-auth'),
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-revoked-auth',
      authorizationVersion,
    })).rejects.toMatchObject({
      status: 403,
      code: 'INTERVIEW_ACCESS_REVOKED',
    })
    expect(await storage.getInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      teamId: team.id,
    })).toBeNull()
  })

  it('binds authorization snapshots to the active actor role and auth version', async () => {
    const { subject } = await seededScope()
    const authVersion = Number(subject.settings?.authVersion ?? 0)
    await expect(storage.getInterviewPrepAuthorizationVersion({
      actorId: subject.id,
      subjectUserId: subject.id,
      expectedActorRole: subject.role,
      expectedActorAuthVersion: authVersion + 1,
    })).rejects.toMatchObject({
      status: 403,
      code: 'INTERVIEW_ACCESS_REVOKED',
    })

    const authorizationVersion = await storage.getInterviewPrepAuthorizationVersion({
      actorId: subject.id,
      subjectUserId: subject.id,
      expectedActorRole: subject.role,
      expectedActorAuthVersion: authVersion,
    })
    const changed = await storage.readStore()
    const changedSubject = changed.users.find((entry) => entry.id === subject.id)
    changedSubject.settings.authVersion = authVersion + 1
    await storage.lockedWriteStore(changed)

    await expect(storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace: workspaceFixture(subject.id, subject.name, null, 'auth-version-changed'),
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-auth-version-changed',
      authorizationVersion,
    })).rejects.toMatchObject({
      status: 403,
      code: 'INTERVIEW_ACCESS_REVOKED',
    })
    expect(await storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id })).toBeNull()
  })

  it('creates the normalized schema and reads an encrypted aggregate after a cold restart', async () => {
    const { subject } = await seededScope()
    const workspace = workspaceFixture(subject.id, subject.name)
    const saved = await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace,
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-create-personal',
    })

    expect(saved).toMatchObject({
      subjectUserId: subject.id,
      subjectName: subject.name,
      revision: 1,
    })
    expect(saved.interviews).toHaveLength(1)
    expect(saved.questions[0].prompt).toContain('secret research problem')
    expect(saved.mockSessions[0].answers[0].body).toContain('Private mock answer')

    await reloadStorage()
    const restored = await storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id })
    expect(restored).toEqual(saved)

    const raw = openRawDatabase()
    try {
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'interview_%'")
        .all()
        .map((row) => row.name)
      expect(tables).toEqual(expect.arrayContaining([
        'interview_workspaces',
        'interview_events',
        'interview_questions',
        'interview_sessions',
        'interview_feedback',
        'interview_workspace_requests',
      ]))
      expect(raw.pragma('foreign_key_check')).toEqual([])
    } finally {
      raw.close()
    }
  })

  it('never writes interview questions or answers as plaintext when global at-rest storage is off', async () => {
    const { store, subject } = await seededScope()
    store.settings.encryptionAtRest = false
    store.settings.sqliteEncryption = false
    await storage.writeStore(store)

    const workspace = workspaceFixture(subject.id, 'Sensitive Applicant', null, 'plaintext-check')
    await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace,
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-plaintext-check',
    })
    await storage.shutdownStorage()

    const raw = openRawDatabase()
    try {
      for (const table of [
        'interview_workspaces',
        'interview_events',
        'interview_questions',
        'interview_sessions',
        'interview_feedback',
      ]) {
        const payloads = raw.prepare(`SELECT payload_encrypted FROM ${table}`).all()
        expect(payloads.length).toBeGreaterThan(0)
        for (const row of payloads) expect(row.payload_encrypted.startsWith('payload:')).toBe(true)
      }
    } finally {
      raw.close()
    }

    const image = await fs.readFile(sqlitePath)
    for (const privateText of [
      'Sensitive Applicant',
      'Explain the secret research problem plaintext-check',
      'Private mock answer plaintext-check',
      'Private feedback body plaintext-check',
    ]) {
      expect(image.includes(Buffer.from(privateText, 'utf8'))).toBe(false)
    }
  })

  it('allows exactly one writer for the same revision and returns a stable CAS conflict', async () => {
    const { subject } = await seededScope()
    const initial = workspaceFixture(subject.id, subject.name)
    const saved = await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace: initial,
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-cas-create',
    })
    const left = { ...saved, subjectName: 'CAS winner left' }
    const right = { ...saved, subjectName: 'CAS winner right' }

    const outcomes = await Promise.allSettled([
      storage.saveInterviewPrepWorkspaceRecord({
        subjectUserId: subject.id,
        workspace: left,
        expectedRevision: 1,
        actorId: subject.id,
        requestId: 'request-cas-left',
      }),
      storage.saveInterviewPrepWorkspaceRecord({
        subjectUserId: subject.id,
        workspace: right,
        expectedRevision: 1,
        actorId: subject.id,
        requestId: 'request-cas-right',
      }),
    ])

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((result) => result.status === 'rejected')
    expect(rejected.reason).toMatchObject({
      status: 409,
      code: 'INTERVIEW_REVISION_CONFLICT',
      expectedRevision: 1,
      currentRevision: 2,
    })
    expect((await storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id })).revision).toBe(2)
  })

  it('deduplicates identical fingerprints and rejects request-id reuse for different content', async () => {
    const { subject } = await seededScope()
    const workspace = workspaceFixture(subject.id, subject.name)
    const input = {
      subjectUserId: subject.id,
      workspace,
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-idempotent-one',
    }
    const created = await storage.saveInterviewPrepWorkspaceRecord(input)
    const retried = await storage.saveInterviewPrepWorkspaceRecord(input)
    const sameContentNewRequest = await storage.saveInterviewPrepWorkspaceRecord({
      ...input,
      requestId: 'request-idempotent-two',
    })

    expect(retried).toEqual(created)
    expect(sameContentNewRequest).toEqual(created)
    await expect(storage.saveInterviewPrepWorkspaceRecord({
      ...input,
      workspace: { ...workspace, subjectName: 'Different content' },
      expectedRevision: 1,
    })).rejects.toMatchObject({
      status: 409,
      code: 'INTERVIEW_IDEMPOTENCY_CONFLICT',
      requestId: 'request-idempotent-one',
    })
  })

  it('isolates personal, subject, and Team scopes even when entity identifiers overlap', async () => {
    const { subject, secondSubject, team } = await seededScope()
    const personal = workspaceFixture(subject.id, 'Personal scope')
    const teamWorkspace = workspaceFixture(subject.id, 'Team scope', team.id)
    const otherSubject = workspaceFixture(secondSubject.id, 'Other subject')

    await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace: personal,
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-scope-personal',
    })
    await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      teamId: team.id,
      workspace: teamWorkspace,
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-scope-team',
    })
    await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: secondSubject.id,
      workspace: otherSubject,
      expectedRevision: 0,
      actorId: secondSubject.id,
      requestId: 'request-scope-other',
    })

    await expect(Promise.all([
      storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id }),
      storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id, teamId: team.id }),
      storage.getInterviewPrepWorkspaceRecord({ subjectUserId: secondSubject.id }),
    ])).resolves.toMatchObject([
      { subjectName: 'Personal scope', interviews: [{ id: 'interview-one', teamId: null }] },
      { subjectName: 'Team scope', interviews: [{ id: 'interview-one', teamId: team.id }] },
      { subjectName: 'Other subject', interviews: [{ id: 'interview-one', teamId: null }] },
    ])
  })

  it('cascades every child and idempotency record when a workspace is deleted', async () => {
    const { subject } = await seededScope()
    await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace: workspaceFixture(subject.id, subject.name),
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-cascade-create',
    })
    expect(await storage.deleteInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      expectedRevision: 1,
    })).toBe(true)

    expect(await storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id })).toBeNull()
    const raw = openRawDatabase()
    try {
      for (const table of [
        'interview_events',
        'interview_questions',
        'interview_sessions',
        'interview_feedback',
        'interview_workspace_requests',
      ]) {
        expect(raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(0)
      }
      expect(raw.pragma('foreign_key_check')).toEqual([])
    } finally {
      raw.close()
    }
  })

  it('re-encrypts every interview payload across a runtime cipher rotation', async () => {
    const { store, subject } = await seededScope()
    const saved = await storage.saveInterviewPrepWorkspaceRecord({
      subjectUserId: subject.id,
      workspace: workspaceFixture(subject.id, subject.name, null, 'rotation'),
      expectedRevision: 0,
      actorId: subject.id,
      requestId: 'request-rotation-create',
    })
    const beforeDb = openRawDatabase()
    const before = beforeDb
      .prepare('SELECT payload_encrypted FROM interview_sessions LIMIT 1')
      .get().payload_encrypted
    beforeDb.close()

    const previousAlgorithm = store.settings.encryptionAlgorithm
    const nextAlgorithm = previousAlgorithm === 'chacha20-poly1305'
      ? 'aes-256-gcm'
      : 'chacha20-poly1305'
    const crypto = await import('./crypto.js')
    crypto.setRuntimeCryptoConfig({ algorithm: nextAlgorithm, passwordBinding: '' })
    await storage.reencryptAllEncryptionMaterial({
      fromAlgorithm: previousAlgorithm,
      fromPasswordBinding: '',
    }, {
      ...store.settings,
      encryptionAlgorithm: nextAlgorithm,
    })

    const afterDb = openRawDatabase()
    const after = afterDb
      .prepare('SELECT payload_encrypted FROM interview_sessions LIMIT 1')
      .get().payload_encrypted
    afterDb.close()
    expect(after).not.toBe(before)
    expect(await storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id })).toEqual(saved)

    await reloadStorage()
    expect(await storage.getInterviewPrepWorkspaceRecord({ subjectUserId: subject.id })).toEqual(saved)
  })
})

describe('bounded account authentication projection backfill', () => {
  it('backfills more than two thousand users across bounded cold-start pages', async () => {
    await storage.shutdownStorage()
    const raw = new Database(sqlitePath)
    const insert = raw.prepare(
      `INSERT INTO users (
         id, name, email, canonical_email, recovery_email, language, role,
         password_hash, auth_version, created_at, last_login_at, disabled_at,
         settings_json
       ) VALUES (?, ?, ?, '', '', '', 'user', ?, 0, ?, NULL, NULL, ?)`,
    )
    const expected = []
    const insertUsers = raw.transaction(() => {
      for (let index = 0; index < 2_113; index += 1) {
        const suffix = String(index).padStart(4, '0')
        const id = `auth-backfill-${suffix}`
        const email = `Auth.Backfill.${suffix}@Example.EDU`
        const recoveryEmail = `recovery-${suffix}@example.edu`
        const language = index % 2 === 0 ? 'zh' : 'en'
        const authVersion = (index % 9) + 1
        insert.run(
          id,
          `Backfill User ${suffix}`,
          email,
          'test-only-password-hash',
          '2026-08-02T00:00:00.000Z',
          JSON.stringify({
            authVersion,
            language,
            receiveEmails: [{ address: recoveryEmail, isPrimary: true }],
          }),
        )
        expected.push({
          id,
          canonicalEmail: email.toLowerCase(),
          recoveryEmail,
          language,
          authVersion,
        })
      }
    })
    insertUsers.immediate()
    raw.close()

    await reloadStorage()

    const verified = openRawDatabase()
    const rows = verified.prepare(
      `SELECT id, canonical_email, recovery_email, language, auth_version
         FROM users
        WHERE id LIKE 'auth-backfill-%'
        ORDER BY id ASC`,
    ).all()
    verified.close()
    expect(rows).toHaveLength(expected.length)
    expect(rows).toEqual(expected.map((row) => ({
      id: row.id,
      canonical_email: row.canonicalEmail,
      recovery_email: row.recoveryEmail,
      language: row.language,
      auth_version: row.authVersion,
    })))
  }, 60_000)
})
