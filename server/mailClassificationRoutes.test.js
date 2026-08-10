import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import {
  createAiKey,
  deleteAiKey,
  findTeamMembershipForUser,
  mailClassificationTaskDiagnostics,
  readStore,
  updateTeamMemberRelationships,
  withWriteLock,
  writeStore,
} from './storage.js'

const TEAM_ID = 'team_demo_phd_atlas'
const RUN_ID = `${process.pid}-${Date.now()}`
const PERSONAL_APP_ID = `mail-route-personal-${RUN_ID}`
const THREAD_APP_ID = `mail-route-thread-${RUN_ID}`
const TEAM_APP_ID = `mail-route-team-${RUN_ID}`
const UNRELATED_APP_ID = `mail-route-unrelated-${RUN_ID}`
const PRIMARY_MAIL_ID = `mail-primary-${RUN_ID}`
const SECONDARY_MAIL_ID = `mail-secondary-${RUN_ID}`
const THREAD_PRIOR_MAIL_ID = `mail-thread-prior-${RUN_ID}`
const THREAD_TARGET_MAIL_ID = `mail-thread-target-${RUN_ID}`
const TEAM_MAIL_ID = `mail-team-${RUN_ID}`

let server
let baseUrl
let token
let ownerId
let studentId
let teacherId
let teacherToken
let personalKey
let teamKey
let providerCalls = 0
let providerImpl
let beforeCommitImpl = null
let mutationClock = 0
let enforceFocusedMemoryCap = false
const focusedMemoryReservations = []
const FOCUSED_MEMORY_CAP_BYTES = 48 * 1024 * 1024

const memoryReservationLedger = {
  admit(workClass) {
    return {
      allowed: true,
      workClass,
      level: 'normal',
      retryAfterMs: 1_000,
    }
  },
  acquire(workClass, requestedBytes) {
    const bytes = Number(requestedBytes ?? 0)
    if (enforceFocusedMemoryCap && workClass === 'standard') {
      focusedMemoryReservations.push(bytes)
      if (bytes > FOCUSED_MEMORY_CAP_BYTES) {
        return {
          allowed: false,
          decision: {
            code: 'MEMORY_PRESSURE_HARD',
            level: 'hard',
            workClass,
            retryAfterMs: 1_000,
          },
          release() {},
          shrink() {},
        }
      }
    }
    return { allowed: true, release() {}, shrink() {} }
  },
  snapshot() {
    return {
      reservedBytes: 0,
      activeReservations: 0,
      peakReservedBytes: focusedMemoryReservations.length > 0
        ? Math.max(...focusedMemoryReservations)
        : 0,
      counters: { admitted: 0, rejected: 0, released: 0 },
    }
  },
}

function classification(overrides = {}) {
  return {
    category: 'interview_invite',
    confidence: 0.94,
    summary: 'The professor invited the applicant to an interview.',
    evidence: ['The message asks the applicant to choose an interview time.'],
    actions: ['schedule_interview', 'prepare_interview'],
    ...overrides,
  }
}

function email(id, bodyText) {
  return {
    id,
    subject: `Doctoral interview ${id}`,
    channel: 'Email',
    date: '2026-08-02',
    time: '09:30',
    summary: bodyText,
    bodyText,
    direction: 'incoming',
    messageType: 'fetched-email',
    from: 'Professor <professor@example.edu>',
    to: 'Applicant <applicant@example.com>',
    attachments: [],
  }
}

function application({ id, ownerId: applicationOwnerId, teamId = null, communications }) {
  return {
    id,
    ownerId: applicationOwnerId,
    teamId,
    professor: {
      english: 'Professor Route Test',
      chinese: '',
      email: 'professor@example.edu',
      phone: '',
      social: '',
      homepage: 'https://example.edu/professor',
      research: 'safe AI systems',
      lab: 'Route Test Lab',
    },
    school: {
      name: `Mail Route Test ${id}`,
      country: 'United Kingdom',
      website: 'https://example.edu',
    },
    program: 'Computer Science PhD',
    deadline: '2027-01-15',
    status: 'Draft',
    progress: 10,
    priority: 50,
    tags: [],
    result: '',
    notes: '',
    materials: [],
    communications,
    scholarships: [],
    tasks: [],
    timeline: [],
    versions: [],
    shares: [],
    reviewComments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

async function requestAs(authToken, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  return { response, payload, data: payload.data }
}

async function request(path, options = {}) {
  return requestAs(token, path, options)
}

async function readApplication(id = PERSONAL_APP_ID) {
  const result = await request(`/api/applications/${id}`)
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
  return result.data
}

async function mutateCommunication(applicationId, communicationId, mutation) {
  await withWriteLock(async () => {
    const store = await readStore()
    const targetApplication = store.applications.find((candidate) => candidate.id === applicationId)
    const communication = targetApplication?.communications?.find((candidate) => candidate.id === communicationId)
    if (!targetApplication || !communication) throw new Error('Mail route test fixture is missing.')
    mutation(communication, targetApplication)
    mutationClock += 1
    targetApplication.updatedAt = new Date(Date.UTC(2026, 7, 2, 12, 0, mutationClock)).toISOString()
    await writeStore(store)
  })
}

async function mutateApplicationWithoutAdvancingTimestamp(applicationId, mutation) {
  await withWriteLock(async () => {
    const store = await readStore()
    const targetApplication = store.applications.find((candidate) => candidate.id === applicationId)
    if (!targetApplication) throw new Error('Mail route test fixture is missing.')
    const unchangedTimestamp = targetApplication.updatedAt
    mutation(targetApplication)
    targetApplication.updatedAt = unchangedTimestamp
    await writeStore(store)
  })
}

describe.sequential('mail classification application routes', () => {
  beforeAll(async () => {
    providerImpl = async ({ signal }) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return {
        text: JSON.stringify(classification()),
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      }
    }
    const app = createApp({
      testHooks: {
        memoryReservationLedger,
        mailClassificationCompleteChat: async (input) => {
          providerCalls += 1
          return providerImpl(input)
        },
        mailClassificationBeforeCommit: async (input) => beforeCommitImpl?.(input),
      },
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456', scope: 'app' }),
    })
    expect(login.response.status, JSON.stringify(login.payload)).toBe(200)
    token = login.data.token
    ownerId = login.data.user.id

    const teacherLogin = await requestAs(null, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'teacher@phd-atlas.local', password: 'demo123456', scope: 'app' }),
    })
    if (teacherLogin.response.status === 200) {
      teacherToken = teacherLogin.data.token
      teacherId = teacherLogin.data.user.id
    }

    await withWriteLock(async () => {
      const store = await readStore()
      const demoStudentId = store.users.find((candidate) => candidate.email === 'student.lina@phd-atlas.local')?.id
      studentId = demoStudentId
        ?? store.users.find((candidate) => candidate.role === 'admin')?.id
      if (!studentId) throw new Error('An unrelated fixture account is unavailable.')
      const fixtures = [
        application({
          id: PERSONAL_APP_ID,
          ownerId,
          communications: [
            email(PRIMARY_MAIL_ID, 'Please choose an interview time next week.'),
            email(SECONDARY_MAIL_ID, 'A second email must stay in the canonical response.'),
          ],
        }),
        application({
          id: THREAD_APP_ID,
          ownerId,
          communications: [
            {
              ...email(THREAD_TARGET_MAIL_ID, 'Please choose an interview time next week.'),
              subject: 'Re: Shared doctoral thread',
              date: '2026-08-02',
            },
            {
              ...email(THREAD_PRIOR_MAIL_ID, 'The lab expects to recruit one student.'),
              subject: 'Shared doctoral thread',
              date: '2026-08-01',
              direction: 'outgoing',
              messageType: 'outgoing-email',
              from: 'Applicant <applicant@example.com>',
              to: 'Professor <professor@example.edu>',
            },
          ],
        }),
        application({
          id: UNRELATED_APP_ID,
          ownerId: studentId,
          communications: [email(`mail-unrelated-${RUN_ID}`, 'Unrelated tenant email.')],
        }),
      ]
      if (demoStudentId && teacherId && store.teams.some((team) => team.id === TEAM_ID)) {
        fixtures.push(application({
          id: TEAM_APP_ID,
          ownerId: demoStudentId,
          teamId: TEAM_ID,
          communications: [email(TEAM_MAIL_ID, 'Team-scoped interview invitation.')],
        }))
      }
      store.applications.push(...fixtures)
      await writeStore(store)
    })

    personalKey = await createAiKey({
      ownerId,
      scope: 'personal',
      provider: 'openai',
      label: `Mail route personal ${RUN_ID}`,
      model: 'gpt-5.6-luna',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-route-test-personal-never-log',
    })
    if (teacherId) {
      teamKey = await createAiKey({
        ownerId,
        teamId: TEAM_ID,
        scope: 'team',
        provider: 'openai',
        label: `Mail route team ${RUN_ID}`,
        model: 'gpt-5.6-luna',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-route-test-team-never-log',
      })
    }
  })

  afterAll(async () => {
    if (personalKey?.id) await deleteAiKey(personalKey.id)
    if (teamKey?.id) await deleteAiKey(teamKey.id)
    await withWriteLock(async () => {
      const store = await readStore()
      store.applications = store.applications.filter((candidate) => (
        candidate.id !== PERSONAL_APP_ID
        && candidate.id !== THREAD_APP_ID
        && candidate.id !== TEAM_APP_ID
        && candidate.id !== UNRELATED_APP_ID
        && !candidate.id.startsWith(`mail-route-large-team-${RUN_ID}-`)
      ))
      await writeStore(store)
    })
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('persists manual categories and returns only the bounded canonical delta', async () => {
    const result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/categories`, {
      method: 'PATCH',
      headers: { 'idempotency-key': `manual-${RUN_ID}` },
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID],
        categories: ['positive_reply', 'funding'],
        category: 'positive_reply',
      }),
    })

    expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    expect(result.data.updatedIds).toEqual([PRIMARY_MAIL_ID])
    expect(result.data.communications).toEqual([
      expect.objectContaining({
        id: PRIMARY_MAIL_ID,
        mailCategories: ['positive_reply', 'funding'],
        mailCategoryOverride: 'positive_reply',
      }),
    ])
    expect(JSON.stringify(result.data.communications)).not.toContain('A second email')
    expect((await readApplication()).communications.find((item) => item.id === PRIMARY_MAIL_ID))
      .toMatchObject({
        mailCategories: ['positive_reply', 'funding'],
        mailCategoryOverride: 'positive_reply',
      })
  })

  it('does not let the legacy single-communication PATCH bypass the category route', async () => {
    const result = await request(
      `/api/applications/${PERSONAL_APP_ID}/communications/${PRIMARY_MAIL_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ mailCategoryOverride: 'rejection' }),
      },
    )

    expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    expect(result.data.mailCategoryOverride).toBe('positive_reply')
    expect((await readApplication()).communications.find((item) => item.id === PRIMARY_MAIL_ID))
      .toMatchObject({ mailCategoryOverride: 'positive_reply' })
  })

  it('classifies with the scoped key, records a durable result, and returns a bounded delta', async () => {
    const beforeCalls = providerCalls
    const result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      headers: { 'idempotency-key': `ai-success-${RUN_ID}` },
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID],
        keyId: personalKey.id,
      }),
    })

    expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    expect(providerCalls).toBe(beforeCalls + 1)
    expect(result.data.classifiedIds).toEqual([PRIMARY_MAIL_ID])
    expect(result.data.communications).toEqual([
      expect.objectContaining({
        id: PRIMARY_MAIL_ID,
        mailClassification: expect.objectContaining({
          category: 'interview_invite',
          source: 'ai',
          inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    ])
    expect(JSON.stringify(result.data.communications)).not.toContain('A second email')
    expect(JSON.stringify(result.payload)).not.toContain('never-log')
    const persisted = await readApplication()
    expect(persisted.communications.find((item) => item.id === PRIMARY_MAIL_ID)?.mailClassification)
      .toMatchObject({ category: 'interview_invite', source: 'ai' })

    const restartApp = createApp({
      testHooks: {
        memoryReservationLedger,
        mailClassificationCompleteChat: async (input) => {
          providerCalls += 1
          return providerImpl(input)
        },
      },
    })
    const restartServer = restartApp.listen(0, '127.0.0.1')
    await new Promise((resolve) => restartServer.once('listening', resolve))
    try {
      const replayResponse = await fetch(
        `http://127.0.0.1:${restartServer.address().port}/api/applications/${PERSONAL_APP_ID}/communications/classify`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'idempotency-key': `ai-success-${RUN_ID}`,
          },
          body: JSON.stringify({
            communicationIds: [PRIMARY_MAIL_ID],
            keyId: personalKey.id,
          }),
        },
      )
      const replayPayload = await replayResponse.json()
      expect(replayResponse.status, JSON.stringify(replayPayload)).toBe(200)
      expect(replayPayload.data).toEqual(result.data)
      expect(providerCalls).toBe(beforeCalls + 1)
    } finally {
      await new Promise((resolve, reject) => (
        restartServer.close((error) => (error ? reject(error) : resolve()))
      ))
    }
  })

  it('round-trips a thread-aware classification through full PUT and invalidates changed thread content', async () => {
    const manual = await request(`/api/applications/${THREAD_APP_ID}/communications/categories`, {
      method: 'PATCH',
      headers: { 'idempotency-key': `thread-manual-${RUN_ID}` },
      body: JSON.stringify({
        communicationIds: [THREAD_TARGET_MAIL_ID],
        category: 'funding',
      }),
    })
    expect(manual.response.status, JSON.stringify(manual.payload)).toBe(200)

    const classified = await request(`/api/applications/${THREAD_APP_ID}/communications/classify`, {
      method: 'POST',
      headers: { 'idempotency-key': `thread-ai-${RUN_ID}` },
      body: JSON.stringify({
        communicationIds: [THREAD_TARGET_MAIL_ID],
        keyId: personalKey.id,
      }),
    })
    expect(classified.response.status, JSON.stringify(classified.payload)).toBe(200)
    const classifiedHash = classified.data.communications[0]?.mailClassification?.inputHash
    expect(classifiedHash).toMatch(/^[a-f0-9]{64}$/)

    const beforeRoundTrip = await readApplication(THREAD_APP_ID)
    const roundTrip = await request(`/api/applications/${THREAD_APP_ID}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...beforeRoundTrip,
        notes: 'Ordinary save after realtime classification.',
        communications: beforeRoundTrip.communications.map((communication) => (
          communication.id === THREAD_TARGET_MAIL_ID
            ? { ...communication, mailCategoryOverride: 'rejection' }
            : communication
        )),
      }),
    })
    expect(roundTrip.response.status, JSON.stringify(roundTrip.payload)).toBe(200)
    const afterRoundTrip = await readApplication(THREAD_APP_ID)
    // The classifier's own result survives an ordinary save, while the manual
    // selection carried by that save is the person's and is kept. Reverting the
    // manual value here is what made every save carrying one fail its
    // persistence acknowledgement, with no way for the author to get past it.
    expect(afterRoundTrip.communications.find((item) => item.id === THREAD_TARGET_MAIL_ID))
      .toMatchObject({
        mailCategoryOverride: 'rejection',
        mailClassification: { inputHash: classifiedHash },
      })

    const changedThread = await request(`/api/applications/${THREAD_APP_ID}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...afterRoundTrip,
        communications: afterRoundTrip.communications.map((communication) => (
          communication.id === THREAD_PRIOR_MAIL_ID
            ? { ...communication, subject: 'A different doctoral thread' }
            : communication
        )),
      }),
    })
    expect(changedThread.response.status, JSON.stringify(changedThread.payload)).toBe(200)
    const afterThreadChange = await readApplication(THREAD_APP_ID)
    expect(afterThreadChange.communications.find((item) => item.id === THREAD_TARGET_MAIL_ID))
      .not.toHaveProperty('mailClassification')
    // Invalidating a stale classification does not touch the manual selection.
    expect(afterThreadChange.communications.find((item) => item.id === THREAD_TARGET_MAIL_ID))
      .toMatchObject({ mailCategoryOverride: 'rejection' })
  })

  it('rejects stale content after the provider returns and saves no stale classification', async () => {
    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      communication.bodyText = 'STALE_BEFORE_PROVIDER'
      communication.summary = 'STALE_BEFORE_PROVIDER'
      delete communication.mailClassification
    })
    providerImpl = async () => {
      await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
        communication.bodyText = 'STALE_AFTER_PROVIDER'
        communication.summary = 'STALE_AFTER_PROVIDER'
      })
      return { text: JSON.stringify(classification()), usage: {} }
    }

    const result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID],
        keyId: personalKey.id,
        force: true,
      }),
    })

    expect(result.response.status, JSON.stringify(result.payload)).toBe(409)
    expect(result.payload.error.code).toBe('MAIL_CLASSIFICATION_STALE')
    expect((await readApplication()).communications.find((item) => item.id === PRIMARY_MAIL_ID))
      .not.toHaveProperty('mailClassification')
  })

  it('detects a same-timestamp canonical application conflict with payload_version CAS', async () => {
    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      communication.bodyText = 'SAME_TIMESTAMP_CAS_INPUT'
      communication.summary = 'SAME_TIMESTAMP_CAS_INPUT'
      delete communication.mailClassification
    })
    providerImpl = async () => ({ text: JSON.stringify(classification()), usage: {} })
    beforeCommitImpl = async ({ applicationId }) => {
      await mutateApplicationWithoutAdvancingTimestamp(applicationId, (targetApplication) => {
        targetApplication.notes = 'Concurrent write with an intentionally unchanged updatedAt.'
      })
    }

    let result
    try {
      result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
        method: 'POST',
        body: JSON.stringify({
          communicationIds: [PRIMARY_MAIL_ID],
          keyId: personalKey.id,
          force: true,
        }),
      })
    } finally {
      beforeCommitImpl = null
    }

    expect(result.response.status, JSON.stringify(result.payload)).toBe(409)
    expect(result.payload.error.code).toBe('MAIL_CLASSIFICATION_CONFLICT')
    const persisted = await readApplication()
    expect(persisted.notes).toBe('Concurrent write with an intentionally unchanged updatedAt.')
    expect(persisted.communications.find((item) => item.id === PRIMARY_MAIL_ID))
      .not.toHaveProperty('mailClassification')
  })

  it('reuses durable prepared AI progress after a pre-commit failure', async () => {
    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      delete communication.mailSecurity
      delete communication.mailClassification
      communication.bodyText = 'DURABLE_PROGRESS_INPUT'
      communication.summary = 'DURABLE_PROGRESS_INPUT'
    })
    providerImpl = async () => ({ text: JSON.stringify(classification()), usage: {} })
    const beforeCalls = providerCalls
    let failOnce = true
    beforeCommitImpl = async () => {
      if (!failOnce) return
      failOnce = false
      throw new Error('Injected failure after durable provider progress.')
    }
    const idempotencyKey = `ai-progress-${RUN_ID}`
    const first = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID],
        keyId: personalKey.id,
        force: true,
      }),
    })
    expect(first.response.status, JSON.stringify(first.payload)).toBe(503)
    expect(first.payload.error.code).toBe('MAIL_CLASSIFICATION_SAVE_FAILED')

    beforeCommitImpl = null
    const retry = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID],
        keyId: personalKey.id,
        force: true,
      }),
    })
    expect(retry.response.status, JSON.stringify(retry.payload)).toBe(200)
    expect(providerCalls).toBe(beforeCalls + 1)
    expect(await mailClassificationTaskDiagnostics()).toMatchObject({ active: 0 })

    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      communication.bodyText = 'DIFFERENT_FINGERPRINT'
      communication.summary = 'DIFFERENT_FINGERPRINT'
    })
    const callsBeforeConflict = providerCalls
    const conflict = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID],
        keyId: personalKey.id,
        force: true,
      }),
    })
    expect(conflict.response.status, JSON.stringify(conflict.payload)).toBe(409)
    expect(conflict.payload.error.code).toBe('MAIL_CLASSIFICATION_IDEMPOTENCY_CONFLICT')
    expect(providerCalls).toBe(callsBeforeConflict)
  })

  it('does not let an unrelated tenant write conflict with the target app CAS', async () => {
    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      delete communication.mailClassification
      communication.bodyText = 'CROSS_TENANT_TARGET'
      communication.summary = 'CROSS_TENANT_TARGET'
    })
    providerImpl = async () => ({ text: JSON.stringify(classification()), usage: {} })
    beforeCommitImpl = async () => {
      await mutateApplicationWithoutAdvancingTimestamp(UNRELATED_APP_ID, (unrelated) => {
        unrelated.notes = 'Concurrent unrelated tenant write was preserved.'
      })
    }
    let result
    try {
      result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
        method: 'POST',
        headers: { 'idempotency-key': `cross-tenant-${RUN_ID}` },
        body: JSON.stringify({
          communicationIds: [PRIMARY_MAIL_ID],
          keyId: personalKey.id,
          force: true,
        }),
      })
    } finally {
      beforeCommitImpl = null
    }
    expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    const store = await readStore()
    expect(store.applications.find((item) => item.id === UNRELATED_APP_ID)?.notes)
      .toBe('Concurrent unrelated tenant write was preserved.')
  })

  it('enforces personal and Team key isolation before invoking the provider', async () => {
    providerImpl = async () => ({ text: JSON.stringify(classification()), usage: {} })
    const beforeCalls = providerCalls
    const teamKeyOnPersonal = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      body: JSON.stringify({ communicationIds: [PRIMARY_MAIL_ID], keyId: teamKey.id, force: true }),
    })
    const personalKeyOnTeam = await request(`/api/applications/${TEAM_APP_ID}/communications/classify`, {
      method: 'POST',
      body: JSON.stringify({ communicationIds: [TEAM_MAIL_ID], keyId: personalKey.id, force: true }),
    })

    expect(teamKeyOnPersonal.response.status, JSON.stringify(teamKeyOnPersonal.payload)).toBe(403)
    expect(teamKeyOnPersonal.payload.error.code).toBe('MAIL_CLASSIFICATION_KEY_SCOPE_MISMATCH')
    expect(personalKeyOnTeam.response.status, JSON.stringify(personalKeyOnTeam.payload)).toBe(403)
    expect(personalKeyOnTeam.payload.error.code).toBe('MAIL_CLASSIFICATION_KEY_SCOPE_MISMATCH')
    expect(providerCalls).toBe(beforeCalls)
  })

  it('revalidates Team assignment and edit permission inside the final commit transaction', async () => {
    await mutateCommunication(TEAM_APP_ID, TEAM_MAIL_ID, (communication) => {
      delete communication.mailClassification
      communication.bodyText = 'TEAM_ASSIGNMENT_CAS_INPUT'
      communication.summary = 'TEAM_ASSIGNMENT_CAS_INPUT'
    })
    const studentMembership = await findTeamMembershipForUser(TEAM_ID, studentId)
    if (!studentMembership) throw new Error('Demo student Team membership is unavailable.')
    const originalRelationships = structuredClone(studentMembership.relationships)
    expect(originalRelationships.teacherIds).toContain(teacherId)
    providerImpl = async () => ({ text: JSON.stringify(classification()), usage: {} })
    const beforeCalls = providerCalls
    const idempotencyKey = `team-revocation-${RUN_ID}`
    let assignmentRevoked = false
    let denied
    beforeCommitImpl = async ({ applicationId }) => {
      if (applicationId !== TEAM_APP_ID || assignmentRevoked) return
      assignmentRevoked = true
      await updateTeamMemberRelationships(studentMembership.id, {
        ...originalRelationships,
        teacherIds: originalRelationships.teacherIds.filter((id) => id !== teacherId),
      })
    }
    try {
      denied = await requestAs(teacherToken, `/api/applications/${TEAM_APP_ID}/communications/classify`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ communicationIds: [TEAM_MAIL_ID], keyId: teamKey.id }),
      })
    } finally {
      beforeCommitImpl = null
      if (assignmentRevoked) {
        await updateTeamMemberRelationships(studentMembership.id, originalRelationships)
      }
    }

    expect(denied.response.status, JSON.stringify(denied.payload)).toBe(403)
    expect(denied.payload.error.code).toBe('MAIL_CLASSIFICATION_FORBIDDEN')
    expect(providerCalls).toBe(beforeCalls + 1)
    expect((await readApplication(TEAM_APP_ID)).communications.find((item) => item.id === TEAM_MAIL_ID))
      .not.toHaveProperty('mailClassification')

    const retry = await requestAs(teacherToken, `/api/applications/${TEAM_APP_ID}/communications/classify`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ communicationIds: [TEAM_MAIL_ID], keyId: teamKey.id }),
    })
    expect(retry.response.status, JSON.stringify(retry.payload)).toBe(200)
    expect(providerCalls).toBe(beforeCalls + 1)
    expect(await mailClassificationTaskDiagnostics()).toMatchObject({ active: 0 })
  })

  it('blocks dangerous mail before provider admission while retaining manual review', async () => {
    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      communication.mailSecurity = {
        level: 'danger',
        signals: ['prompt-injection'],
        linksDisabled: true,
        quarantinedAttachmentCount: 0,
      }
      delete communication.mailClassification
    })
    const beforeCalls = providerCalls
    const result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      body: JSON.stringify({ communicationIds: [PRIMARY_MAIL_ID], keyId: personalKey.id, force: true }),
    })

    expect(result.response.status, JSON.stringify(result.payload)).toBe(422)
    expect(result.payload.error.code).toBe('MAIL_CLASSIFICATION_UNSAFE_MAIL')
    expect(providerCalls).toBe(beforeCalls)
    expect((await readApplication()).communications.find((item) => item.id === PRIMARY_MAIL_ID))
      .not.toHaveProperty('mailClassification')
  })

  it('keeps a multi-email provider failure atomic with no partial classifications', async () => {
    await mutateCommunication(PERSONAL_APP_ID, PRIMARY_MAIL_ID, (communication) => {
      delete communication.mailSecurity
      delete communication.mailClassification
      communication.bodyText = 'ATOMIC_GOOD'
      communication.summary = 'ATOMIC_GOOD'
    })
    await mutateCommunication(PERSONAL_APP_ID, SECONDARY_MAIL_ID, (communication) => {
      delete communication.mailClassification
      communication.bodyText = 'ATOMIC_BAD'
      communication.summary = 'ATOMIC_BAD'
    })
    providerImpl = async ({ user }) => ({
      text: user.includes('ATOMIC_BAD') ? 'not-json' : JSON.stringify(classification()),
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    })

    const result = await request(`/api/applications/${PERSONAL_APP_ID}/communications/classify`, {
      method: 'POST',
      body: JSON.stringify({
        communicationIds: [PRIMARY_MAIL_ID, SECONDARY_MAIL_ID],
        keyId: personalKey.id,
        force: true,
      }),
    })

    expect(result.response.status, JSON.stringify(result.payload)).toBe(502)
    expect(result.payload.error.code).toBe('MAIL_CLASSIFICATION_INVALID_JSON')
    const persisted = await readApplication()
    expect(persisted.communications.find((item) => item.id === PRIMARY_MAIL_ID))
      .not.toHaveProperty('mailClassification')
    expect(persisted.communications.find((item) => item.id === SECONDARY_MAIL_ID))
      .not.toHaveProperty('mailClassification')
  })

  it('classifies one target inside a large Team without hydrating peer applications or returning bodies', async () => {
    const largeIds = Array.from({ length: 40 }, (_, index) => `mail-route-large-team-${RUN_ID}-${index}`)
    await withWriteLock(async () => {
      const store = await readStore()
      for (const [index, id] of largeIds.entries()) {
        store.applications.push(application({
          id,
          ownerId: studentId,
          teamId: TEAM_ID,
          communications: [email(`large-mail-${RUN_ID}-${index}`, 'x'.repeat(256 * 1024))],
        }))
      }
      await writeStore(store)
    })
    providerImpl = async () => ({ text: JSON.stringify(classification()), usage: {} })
    focusedMemoryReservations.length = 0
    enforceFocusedMemoryCap = true
    let result
    try {
      result = await request(`/api/applications/${TEAM_APP_ID}/communications/classify`, {
        method: 'POST',
        headers: { 'idempotency-key': `large-team-${RUN_ID}` },
        body: JSON.stringify({ communicationIds: [TEAM_MAIL_ID], keyId: teamKey.id, force: true }),
      })
    } finally {
      enforceFocusedMemoryCap = false
      await withWriteLock(async () => {
        const store = await readStore()
        const remove = new Set(largeIds)
        store.applications = store.applications.filter((candidate) => !remove.has(candidate.id))
        await writeStore(store)
      })
    }

    expect(result.response.status, JSON.stringify(result.payload)).toBe(200)
    expect(focusedMemoryReservations.length).toBeGreaterThan(0)
    expect(Math.max(...focusedMemoryReservations)).toBeLessThanOrEqual(FOCUSED_MEMORY_CAP_BYTES)
    expect(Buffer.byteLength(JSON.stringify(result.payload), 'utf8')).toBeLessThan(16 * 1024)
    expect(result.data.communications).toEqual([
      expect.objectContaining({ id: TEAM_MAIL_ID }),
    ])
    expect(JSON.stringify(result.data)).not.toContain('x'.repeat(1024))
  }, 60_000)
})
