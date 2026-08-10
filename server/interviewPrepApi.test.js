import express from 'express'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installInterviewPrepApiRoutes } from './interviewPrepApi.js'
import { createInterviewWorkspaceFingerprint } from './interviewWorkspace.js'
import { PUBLIC_EDITION } from './edition.js'

const NOW = '2026-08-02T12:00:00.000Z'

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value)
}

function user(id, name = id) {
  return { id, name, role: 'user', settings: { language: 'en', authVersion: 0 } }
}

function interview(overrides = {}) {
  return {
    id: 'interview-primary',
    ownerUserId: 'student-one',
    teamId: 'team-one',
    applicationId: 'application-one',
    sourceCommunicationId: null,
    createdByUserId: 'student-one',
    title: 'Research interview',
    school: 'Example University',
    program: 'PhD Computer Science',
    advisor: 'Professor Ada',
    format: 'video',
    scheduledAt: '2026-08-14T09:00:00.000Z',
    timezone: 'Europe/London',
    durationMinutes: 45,
    participantNames: ['Professor Ada'],
    status: 'upcoming',
    preparationNotes: 'Discuss robust inference.',
    talkingPoints: 'Prior work on uncertainty.',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function question(overrides = {}) {
  return {
    id: 'question-primary',
    interviewId: 'interview-primary',
    category: 'research',
    prompt: 'How will you validate the method?',
    source: 'user',
    createdByUserId: 'student-one',
    order: 0,
    notes: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function mockSession(overrides = {}) {
  return {
    id: 'mock-primary',
    interviewId: 'interview-primary',
    ownerUserId: 'student-one',
    mode: 'ai',
    status: 'completed',
    questionIds: ['question-primary'],
    currentQuestionId: 'question-primary',
    answers: [{
      questionId: 'question-primary',
      body: 'I will compare calibration and coverage on held-out cohorts.',
      confidence: 4,
      updatedAt: NOW,
    }],
    startedAt: NOW,
    completedAt: '2026-08-02T12:10:00.000Z',
    updatedAt: '2026-08-02T12:10:00.000Z',
    ...overrides,
  }
}

function workspace(subjectUserId = 'student-one', overrides = {}) {
  return {
    subjectUserId,
    subjectName: 'Student One',
    revision: 0,
    interviews: [],
    questions: [],
    mockSessions: [],
    feedback: [],
    updatedAt: NOW,
    ...overrides,
  }
}

function questionCompletion() {
  return JSON.stringify({
    schemaVersion: 1,
    artifactType: 'question_bank',
    questions: [{
      category: 'research_fit',
      difficulty: 'medium',
      question: 'Which part of the lab agenda best supports your proposed method?',
      rationale: 'Connects the supplied programme and advisor evidence.',
      evidenceRefs: [],
      suggestedActions: ['practice_aloud'],
    }],
    coverageSummary: 'Research fit is covered.',
    evidenceGaps: [],
    suggestedActions: ['practice_aloud'],
  })
}

function nextTurnCompletion() {
  return JSON.stringify({
    schemaVersion: 1,
    artifactType: 'next_mock_turn',
    intent: 'clarify_method',
    question: 'How did you verify that the measured improvement is reproducible?',
    rationale: 'The latest answer names a result but not its validation method.',
    evidenceRefs: [],
    suggestedActions: ['prepare_follow_up'],
  })
}

function feedbackCompletion() {
  const criteria = [
    'clarity',
    'specificity',
    'research_fit',
    'methodological_rigor',
    'evidence_use',
    'communication',
  ]
  return JSON.stringify({
    schemaVersion: 1,
    artifactType: 'mock_evaluation',
    overallScore: 80,
    summary: 'The answer is structured and testable.',
    rationale: 'The supplied answer names concrete validation criteria.',
    rubric: criteria.map((criterion) => ({
      criterion,
      score: 80,
      summary: `${criterion} is supported by the supplied turn.`,
      evidenceRefs: [],
    })),
    strengths: ['Names measurable criteria'],
    improvements: ['Add a failure-analysis example'],
    suggestedActions: ['practice_aloud'],
  })
}

function createHarness(overrides = {}) {
  const users = [
    user('personal-one', 'Personal One'),
    user('student-one', 'Student One'),
    user('teacher-one', 'Teacher One'),
    user('teacher-two', 'Teacher Two'),
    user('owner-one', 'Owner One'),
    user('outsider-one', 'Outsider One'),
  ]
  const team = {
    id: 'team-one',
    ownerId: 'owner-one',
    status: 'active',
    permissionDefaults: {
      student: { useInterviewPrep: true },
      teacher: { manageStudentInterviewPrep: true },
    },
  }
  const memberships = [
    {
      id: 'membership-student',
      teamId: team.id,
      userId: 'student-one',
      status: 'active',
      role: 'member',
      relationships: {
        teacherIds: ['teacher-one', 'teacher-two'],
        studentPermissions: { useInterviewPrep: true },
      },
    },
    {
      id: 'membership-teacher',
      teamId: team.id,
      userId: 'teacher-one',
      status: 'active',
      role: 'admin',
      relationships: {
        teacherPermissions: { manageStudentInterviewPrep: true },
      },
    },
    {
      id: 'membership-outsider',
      teamId: team.id,
      userId: 'outsider-one',
      status: 'active',
      role: 'admin',
      relationships: {
        teacherPermissions: { manageStudentInterviewPrep: true },
      },
    },
    {
      id: 'membership-teacher-two',
      teamId: team.id,
      userId: 'teacher-two',
      status: 'active',
      role: 'admin',
      relationships: {
        teacherPermissions: { manageStudentInterviewPrep: true },
      },
    },
  ]
  const records = new Map()
  const requests = new Map()
  const keyFor = (subjectUserId, teamId = null) => `${teamId ?? 'personal'}:${subjectUserId}`
  const aiKeys = new Map([
    ['key-personal', {
      id: 'key-personal',
      scope: 'personal',
      ownerId: 'personal-one',
      teamId: null,
      provider: 'compatible',
      model: 'gpt-5.6-luna',
      apiKey: 'credential-material-personal',
    }],
    ['key-team', {
      id: 'key-team',
      scope: 'team',
      ownerId: 'owner-one',
      teamId: 'team-one',
      provider: 'compatible',
      model: 'gpt-5.6-luna',
      apiKey: 'credential-material-team',
    }],
    ['key-wrong-model', {
      id: 'key-wrong-model',
      scope: 'personal',
      ownerId: 'personal-one',
      teamId: null,
      provider: 'compatible',
      model: 'gpt-5.4-mini',
      apiKey: 'credential-material-other',
    }],
  ])
  const completeChat = overrides.completeChat ?? vi.fn(async () => ({
    text: questionCompletion(),
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  }))
  const recordAiKeyUsage = vi.fn(async () => {})
  const currentAuthorizationVersion = () => createHash('sha256').update(JSON.stringify({
    users: users.map((entry) => ({
      id: entry.id,
      role: entry.role,
      disabledAt: entry.disabledAt ?? null,
      authVersion: entry.settings?.authVersion ?? 0,
    })),
    team,
    memberships,
  })).digest('hex')

  const apiOptions = {
    getInterviewPrepWorkspaceRecord: async ({ subjectUserId, teamId }) => (
      clone(records.get(keyFor(subjectUserId, teamId)) ?? null)
    ),
    saveInterviewPrepWorkspaceRecord: async (input) => {
      await overrides.beforeWorkspaceSave?.(input, { users, team, memberships })
      if (input.authorizationVersion !== currentAuthorizationVersion()) {
        throw Object.assign(new Error('Interview access was revoked.'), {
          status: 403,
          code: 'INTERVIEW_ACCESS_REVOKED',
        })
      }
      const storageKey = keyFor(input.subjectUserId, input.teamId)
      const current = records.get(storageKey) ?? null
      const currentRevision = current?.revision ?? 0
      const fingerprint = createInterviewWorkspaceFingerprint(input.workspace, {
        subjectUserId: input.subjectUserId,
        ownerUserId: input.subjectUserId,
        createdByUserId: input.subjectUserId,
        teamId: input.teamId,
        subjectName: input.workspace.subjectName,
        now: NOW,
      })
      const requestKey = `${storageKey}:${input.requestId}`
      const prior = requests.get(requestKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw Object.assign(new Error('Idempotency conflict.'), {
            status: 409,
            code: 'INTERVIEW_IDEMPOTENCY_CONFLICT',
          })
        }
        return clone(records.get(storageKey))
      }
      const currentFingerprint = current
        ? createInterviewWorkspaceFingerprint(current, {
            subjectUserId: input.subjectUserId,
            ownerUserId: input.subjectUserId,
            createdByUserId: input.subjectUserId,
            teamId: input.teamId,
            subjectName: current.subjectName,
            now: NOW,
          })
        : null
      if (currentFingerprint === fingerprint) {
        requests.set(requestKey, { fingerprint })
        return clone(current)
      }
      if (input.expectedRevision !== currentRevision) {
        throw Object.assign(new Error('Revision conflict.'), {
          status: 409,
          code: 'INTERVIEW_REVISION_CONFLICT',
        })
      }
      const saved = clone({
        ...input.workspace,
        revision: currentRevision + 1,
        updatedAt: NOW,
      })
      records.set(storageKey, saved)
      requests.set(requestKey, { fingerprint })
      return clone(saved)
    },
    getAiKeyById: async (id) => clone(aiKeys.get(id) ?? null),
    getInterviewPrepAuthorizationVersion: async (input) => {
      await overrides.beforeAuthorizationVersion?.(input, { users, team, memberships })
      const actor = users.find((entry) => entry.id === input.actorId)
      const subject = users.find((entry) => entry.id === input.subjectUserId)
      if (
        !actor
        || actor.disabledAt
        || !subject
        || subject.disabledAt
        || actor.role !== input.expectedActorRole
        || Number(actor.settings?.authVersion ?? 0) !== Number(input.expectedActorAuthVersion)
      ) {
        throw Object.assign(new Error('Interview access was revoked.'), {
          status: 403,
          code: 'INTERVIEW_ACCESS_REVOKED',
        })
      }
      return currentAuthorizationVersion()
    },
    recordAiKeyUsage,
    completeChat,
    getTeamById: async (id) => id === team.id ? team : null,
    listTeamMembers: async (id) => id === team.id ? clone(memberships) : [],
    getSubjectUser: async ({ subjectUserId }) => users.find((entry) => entry.id === subjectUserId) ?? null,
    artifactProofSecret: Buffer.alloc(32, 0x5a),
    now: () => NOW,
    ...overrides.apiOptions,
  }

  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use((request, _response, next) => {
    const actorId = request.get('X-Test-User') || 'personal-one'
    request.user = users.find((entry) => entry.id === actorId) ?? null
    request.auth = request.user
      ? { authVersion: Number(request.user.settings?.authVersion ?? 0) }
      : null
    request.store = { users, teams: [team] }
    if (request.get('X-Test-Abort') === '1') {
      const controller = new AbortController()
      controller.abort()
      request.aiAbortSignal = controller.signal
    }
    if (request.get('X-Test-Framework-Abort') === '1') {
      const controller = new AbortController()
      controller.abort()
      Object.defineProperty(request, 'signal', {
        configurable: true,
        value: controller.signal,
      })
    }
    const lockedTeamId = request.get('X-Test-Team-Lock')
    if (lockedTeamId) request.impersonation = { teamId: lockedTeamId }
    next()
  })
  installInterviewPrepApiRoutes(app, apiOptions)
  app.use((error, _request, response, _next) => {
    const status = Number(error?.status) || 500
    response.status(status).json({
      ok: false,
      error: {
        code: error?.code ?? 'SERVER_ERROR',
        message: status >= 500 ? 'Unexpected server error.' : error.message,
        field: error?.field,
      },
    })
  })

  let server
  return {
    users,
    team,
    memberships,
    records,
    aiKeys,
    completeChat,
    recordAiKeyUsage,
    keyFor,
    async start() {
      server = await new Promise((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
      })
      const address = server.address()
      this.baseUrl = `http://127.0.0.1:${address.port}`
      return this
    },
    async request(path, options = {}) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      })
      return { response, body: await response.json() }
    },
    async stop() {
      if (!server) return
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      server = null
    },
  }
}

const activeHarnesses = []

async function harness(options) {
  const instance = await createHarness(options).start()
  activeHarnesses.push(instance)
  return instance
}

afterEach(async () => {
  await Promise.all(activeHarnesses.splice(0).map((instance) => instance.stop()))
})

describe('Interview Prep API real handlers', () => {
  it('returns a private empty personal workspace only to its owner', async () => {
    const test = await harness()
    const own = await test.request('/api/interview-prep/workspace?subjectUserId=personal-one')
    expect(own.response.status).toBe(200)
    expect(own.response.headers.get('cache-control')).toBe('private, no-store')
    expect(own.body.data).toMatchObject({
      subjectUserId: 'personal-one',
      subjectName: 'Personal One',
      revision: 0,
      interviews: [],
    })

    const other = await test.request('/api/interview-prep/workspace?subjectUserId=student-one')
    expect(other.response.status).toBe(403)
    expect(other.body.error.code).toBe('INTERVIEW_ACCESS_FORBIDDEN')
  })

  it('enforces student, assigned-teacher, Team-owner and permission boundaries', async () => {
    const test = await harness()
    const path = '/api/interview-prep/workspace?subjectUserId=student-one&teamId=team-one'
    expect((await test.request(path, { headers: { 'X-Test-User': 'student-one' } })).response.status).toBe(200)
    expect((await test.request(path, { headers: { 'X-Test-User': 'teacher-one' } })).response.status).toBe(200)
    expect((await test.request(path, { headers: { 'X-Test-User': 'owner-one' } })).response.status).toBe(200)
    expect((await test.request(path, { headers: { 'X-Test-User': 'outsider-one' } })).response.status).toBe(403)

    test.memberships[0].relationships.studentPermissions.useInterviewPrep = false
    expect((await test.request(path, { headers: { 'X-Test-User': 'student-one' } })).response.status).toBe(403)
    test.memberships[0].relationships.studentPermissions.useInterviewPrep = true
    test.memberships[1].relationships.teacherPermissions.manageStudentInterviewPrep = false
    expect((await test.request(path, { headers: { 'X-Test-User': 'teacher-one' } })).response.status).toBe(403)
  })

  it('keeps Team impersonation locked to its selected Team', async () => {
    const test = await harness()
    const personal = await test.request(
      '/api/interview-prep/workspace?subjectUserId=student-one',
      { headers: { 'X-Test-User': 'student-one', 'X-Test-Team-Lock': 'team-one' } },
    )
    expect(personal.response.status).toBe(403)
    expect(personal.body.error.code).toBe('TEAM_IMPERSONATION_SCOPE_REQUIRED')

    const team = await test.request(
      '/api/interview-prep/workspace?subjectUserId=student-one&teamId=team-one',
      { headers: { 'X-Test-User': 'student-one', 'X-Test-Team-Lock': 'team-one' } },
    )
    expect(team.response.status).toBe(200)
  })

  it('saves a canonical aggregate with CAS and idempotent retry semantics', async () => {
    const test = await harness()
    const body = {
      subjectUserId: 'personal-one',
      expectedRevision: 0,
      workspace: workspace('personal-one', {
        subjectName: 'Spoofed Name',
        interviews: [interview({
          ownerUserId: 'someone-else',
          teamId: null,
          createdByUserId: 'someone-else',
        })],
      }),
    }
    const first = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'save-request-0001' },
      body: JSON.stringify(body),
    })
    expect(first.response.status).toBe(200)
    expect(first.body.data).toMatchObject({ revision: 1, subjectName: 'Personal One' })
    expect(first.body.data.interviews[0]).toMatchObject({
      ownerUserId: 'personal-one',
      teamId: null,
      createdByUserId: 'personal-one',
    })

    const retry = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'save-request-0001' },
      body: JSON.stringify(body),
    })
    expect(retry.response.status).toBe(200)
    expect(retry.body.data.revision).toBe(1)

    const conflict = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'save-request-0002' },
      body: JSON.stringify({
        ...body,
        workspace: { ...body.workspace, subjectName: 'Changed', interviews: [] },
      }),
    })
    expect(conflict.response.status).toBe(409)
    expect(conflict.body.error.code).toBe('INTERVIEW_REVISION_CONFLICT')
  })

  it('does not report success when storage silently omits submitted content', async () => {
    const test = await harness({
      apiOptions: {
        saveInterviewPrepWorkspaceRecord: async ({ subjectUserId, workspace: submitted }) => ({
          ...submitted,
          subjectUserId,
          revision: 1,
          interviews: [],
          updatedAt: NOW,
        }),
      },
    })
    const result = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('personal-one', {
          interviews: [interview({ ownerUserId: 'personal-one', teamId: null })],
        }),
      }),
    })
    expect(result.response.status).toBe(503)
    expect(result.body.error.code).toBe('INTERVIEW_SAVE_NOT_ACKNOWLEDGED')
  })

  it('rejects subject mismatch and unprivileged teacher artifact forgery', async () => {
    const test = await harness()
    const mismatch = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('student-one'),
      }),
    })
    expect(mismatch.response.status).toBe(400)
    expect(mismatch.body.error.code).toBe('INTERVIEW_SCOPE_MISMATCH')

    const forged = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'student-one' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 0,
        workspace: workspace('student-one', {
          interviews: [interview()],
          questions: [question({ source: 'teacher' })],
        }),
      }),
    })
    expect(forged.response.status).toBe(403)
    expect(forged.body.error.code).toBe('INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN')
  })

  it.skipIf(PUBLIC_EDITION)('lets a student round-trip canonical teacher artifacts without altering them', async () => {
    const test = await harness()
    const teacherWorkspace = workspace('student-one', {
      interviews: [interview()],
      questions: [question({ source: 'teacher' })],
      feedback: [{
        id: 'feedback-teacher',
        interviewId: 'interview-primary',
        sessionId: null,
        questionId: 'question-primary',
        authorKind: 'teacher',
        authorName: 'Untrusted supplied name',
        body: 'Make the validation protocol more specific.',
        strengths: ['Clear objective'],
        improvements: ['Name the held-out cohort'],
        score: 4,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    })
    const teacherSave = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'teacher-one', 'Idempotency-Key': 'teacher-save-0001' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 0,
        workspace: teacherWorkspace,
      }),
    })
    expect(teacherSave.response.status).toBe(200)
    expect(teacherSave.body.data.feedback[0].authorName).toBe('Teacher One')

    const canonical = teacherSave.body.data
    const duplicateTeacher = clone(canonical)
    duplicateTeacher.questions = [{
      ...duplicateTeacher.questions[0],
      source: 'user',
      prompt: 'First-wins forged replacement.',
    }, duplicateTeacher.questions[0]]
    const duplicateBypass = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'student-one', 'Idempotency-Key': 'student-duplicate-teacher' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 1,
        workspace: duplicateTeacher,
      }),
    })
    expect(duplicateBypass.response.status).toBe(400)
    expect(duplicateBypass.body.error.code).toBe('INTERVIEW_ENTITY_ID_DUPLICATE')

    const unicodeDuplicate = clone(canonical)
    unicodeDuplicate.questions = [{
      ...unicodeDuplicate.questions[0],
      id: unicodeDuplicate.questions[0].id.replace(/^q/u, 'ｑ'),
      source: 'user',
      prompt: 'Unicode-equivalent forged replacement.',
    }, unicodeDuplicate.questions[0]]
    const unicodeBypass = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'student-one', 'Idempotency-Key': 'student-unicode-teacher' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 1,
        workspace: unicodeDuplicate,
      }),
    })
    expect(unicodeBypass.response.status).toBe(400)
    expect(unicodeBypass.body.error.code).toBe('INTERVIEW_ENTITY_ID_DUPLICATE')

    const downgradedQuestion = clone(canonical)
    downgradedQuestion.questions[0] = {
      ...downgradedQuestion.questions[0],
      source: 'user',
      prompt: 'Student replaced the privileged question.',
    }
    const questionBypass = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'student-one', 'Idempotency-Key': 'student-downgrade-question' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 1,
        workspace: downgradedQuestion,
      }),
    })
    expect(questionBypass.response.status).toBe(403)
    expect(questionBypass.body.error.code).toBe('INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN')

    const downgradedFeedback = clone(canonical)
    downgradedFeedback.feedback[0] = {
      ...downgradedFeedback.feedback[0],
      authorKind: 'self',
      body: 'Student replaced the privileged feedback.',
    }
    const feedbackBypass = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'student-one', 'Idempotency-Key': 'student-downgrade-feedback' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 1,
        workspace: downgradedFeedback,
      }),
    })
    expect(feedbackBypass.response.status).toBe(403)
    expect(feedbackBypass.body.error.code).toBe('INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN')

    canonical.interviews[0].preparationNotes = 'Student-owned revision after feedback.'
    const studentSave = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'student-one', 'Idempotency-Key': 'student-save-0001' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 1,
        workspace: canonical,
      }),
    })
    expect(studentSave.response.status).toBe(200)
    expect(studentSave.body.data.revision).toBe(2)
    expect(studentSave.body.data.feedback[0]).toEqual(teacherSave.body.data.feedback[0])
    expect(studentSave.body.data.questions[0]).toEqual(teacherSave.body.data.questions[0])
  })

  it.skipIf(PUBLIC_EDITION)('does not re-author one teacher\'s unchanged feedback when another teacher saves', async () => {
    const test = await harness()
    const initial = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'teacher-one', 'Idempotency-Key': 'teacher-one-create' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 0,
        workspace: workspace('student-one', {
          interviews: [interview()],
          questions: [question({ source: 'teacher' })],
          feedback: [{
            id: 'feedback-by-teacher-one',
            interviewId: 'interview-primary',
            sessionId: null,
            questionId: 'question-primary',
            authorKind: 'teacher',
            authorName: 'Spoofed',
            body: 'Original teacher feedback.',
            strengths: [],
            improvements: [],
            score: 4,
            createdAt: NOW,
            updatedAt: NOW,
          }],
        }),
      }),
    })
    expect(initial.response.status).toBe(200)
    expect(initial.body.data.feedback[0].authorName).toBe('Teacher One')

    const secondDraft = clone(initial.body.data)
    secondDraft.interviews[0].talkingPoints = 'Unrelated edit by the second teacher.'
    const second = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'teacher-two', 'Idempotency-Key': 'teacher-two-save' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 1,
        workspace: secondDraft,
      }),
    })
    expect(second.response.status).toBe(200)
    expect(second.body.data.feedback[0].authorName).toBe('Teacher One')
  })

  it('rejects a save when Team permission is revoked after fresh authorize but before commit', async () => {
    let revoked = false
    const test = await harness({
      beforeWorkspaceSave: async (_input, { memberships }) => {
        if (revoked) return
        revoked = true
        const teacher = memberships.find((entry) => entry.userId === 'teacher-one')
        teacher.relationships.teacherPermissions.manageStudentInterviewPrep = false
        teacher.updatedAt = '2026-08-02T12:00:01.000Z'
      },
    })
    const result = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'X-Test-User': 'teacher-one', 'Idempotency-Key': 'revoke-before-commit' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        expectedRevision: 0,
        workspace: workspace('student-one', { interviews: [interview()] }),
      }),
    })
    expect(result.response.status).toBe(403)
    expect(result.body.error.code).toBe('INTERVIEW_ACCESS_REVOKED')
    expect(test.records.has(test.keyFor('student-one', 'team-one'))).toBe(false)
  })

  it('rejects an auth-version revocation before the save captures its durable boundary', async () => {
    let changed = false
    const test = await harness({
      beforeAuthorizationVersion: async (_input, { users }) => {
        if (changed) return
        changed = true
        const actor = users.find((entry) => entry.id === 'personal-one')
        actor.settings.authVersion += 1
      },
    })
    const result = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'revoked-before-capture' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('personal-one', {
          interviews: [interview({ ownerUserId: 'personal-one', teamId: null })],
        }),
      }),
    })
    expect(result.response.status).toBe(403)
    expect(result.body.error.code).toBe('INTERVIEW_ACCESS_REVOKED')
    expect(test.records.has(test.keyFor('personal-one'))).toBe(false)
  })

  it('rejects forged AI attribution in an ordinary workspace PUT', async () => {
    const test = await harness()
    const forgedQuestion = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('personal-one', {
          interviews: [interview({ ownerUserId: 'personal-one', teamId: null })],
          questions: [question({
            id: 'forged-ai-question',
            source: 'ai',
            createdByUserId: 'personal-one',
          })],
        }),
      }),
    })
    expect(forgedQuestion.response.status).toBe(403)
    expect(forgedQuestion.body.error.code).toBe('INTERVIEW_AI_ARTIFACT_FORBIDDEN')

    const forgedFeedback = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('personal-one', {
          interviews: [interview({ ownerUserId: 'personal-one', teamId: null })],
          feedback: [{
            id: 'forged-ai-feedback',
            interviewId: 'interview-primary',
            sessionId: null,
            questionId: null,
            authorKind: 'ai',
            authorName: 'AI coach',
            body: 'Fabricated evaluation.',
            strengths: [],
            improvements: [],
            score: 5,
            createdAt: NOW,
            updatedAt: NOW,
          }],
        }),
      }),
    })
    expect(forgedFeedback.response.status).toBe(403)
    expect(forgedFeedback.body.error.code).toBe('INTERVIEW_AI_ARTIFACT_FORBIDDEN')
  })

  it('generates strict Luna/high questions without provider, key or rationale leakage', async () => {
    const completeChat = vi.fn(async (input) => {
      expect(input.key.apiKey).toBe('credential-material-personal')
      expect(input.key.model).toBe('gpt-5.6-luna')
      expect(input.reasoningEffort).toBe('high')
      expect(input.webSearch).toBe(false)
      expect(input.outputSchema.strict).toBe(true)
      expect(input.user).toContain('BEGIN_UNTRUSTED_INTERVIEW_DATA')
      return {
        text: questionCompletion(),
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        raw: { providerSecret: 'must-not-leak' },
      }
    })
    const test = await harness({ completeChat })
    const result = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        existingQuestions: [],
        focus: 'Research fit',
      }),
    })
    expect(result.response.status).toBe(200)
    expect(result.body.data).toHaveLength(1)
    expect(result.body.data[0]).toMatchObject({
      category: 'advisor',
      source: 'ai',
      createdByUserId: 'personal-one',
    })
    const serialized = JSON.stringify(result.body)
    expect(serialized).not.toMatch(/provider|apiKey|model|rationale|must-not-leak|reasoning/i)
    expect(test.recordAiKeyUsage).toHaveBeenCalledWith('key-personal', {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })

    const signedQuestion = { ...result.body.data[0], updatedAt: '2026-08-02T12:00:01.000Z' }
    const saved = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('personal-one', {
          interviews: [interview({ ownerUserId: 'personal-one', teamId: null })],
          questions: [signedQuestion],
        }),
      }),
    })
    expect(saved.response.status).toBe(200)
    expect(saved.body.data.questions[0]).toMatchObject({
      id: signedQuestion.id,
      source: 'ai',
      prompt: signedQuestion.prompt,
    })

    const duplicateAi = clone(saved.body.data)
    duplicateAi.questions = [{
      ...duplicateAi.questions[0],
      source: 'user',
      prompt: 'First-wins forged AI replacement.',
    }, duplicateAi.questions[0]]
    const duplicateAiBypass = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'duplicate-ai-replacement' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 1,
        workspace: duplicateAi,
      }),
    })
    expect(duplicateAiBypass.response.status).toBe(400)
    expect(duplicateAiBypass.body.error.code).toBe('INTERVIEW_ENTITY_ID_DUPLICATE')

    const unicodeAi = clone(saved.body.data)
    unicodeAi.questions = [{
      ...unicodeAi.questions[0],
      id: unicodeAi.questions[0].id.replace(/^a/u, 'ａ'),
      source: 'user',
      prompt: 'Unicode-equivalent AI replacement.',
    }]
    const unicodeAiBypass = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'unicode-ai-replacement' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 1,
        workspace: unicodeAi,
      }),
    })
    expect(unicodeAiBypass.response.status).toBe(403)
    expect(unicodeAiBypass.body.error.code).toBe('INTERVIEW_AI_ARTIFACT_FORBIDDEN')

    const withoutAi = clone(saved.body.data)
    withoutAi.questions = []
    const removed = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'remove-signed-ai' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 1,
        workspace: withoutAi,
      }),
    })
    expect(removed.response.status).toBe(200)
    expect(removed.body.data.revision).toBe(2)

    const replayed = clone(removed.body.data)
    replayed.questions = [signedQuestion]
    const replay = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'replay-deleted-ai' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 2,
        workspace: replayed,
      }),
    })
    expect(replay.response.status).toBe(403)
    expect(replay.body.error.code).toBe('INTERVIEW_AI_ARTIFACT_FORBIDDEN')
  })

  it('rejects a non-Luna model and a cross-scope key before provider execution', async () => {
    const test = await harness()
    const payload = {
      subjectUserId: 'personal-one',
      interview: interview({ ownerUserId: 'personal-one', teamId: null }),
      existingQuestions: [],
      focus: '',
    }
    const wrongModel = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify({ ...payload, keyId: 'key-wrong-model' }),
    })
    expect(wrongModel.response.status).toBe(409)
    expect(wrongModel.body.error.code).toBe('INTERVIEW_AI_MODEL_REQUIRED')

    const wrongScope = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify({ ...payload, keyId: 'key-team' }),
    })
    expect(wrongScope.response.status).toBe(403)
    expect(wrongScope.body.error.code).toBe('INTERVIEW_AI_KEY_SCOPE_FORBIDDEN')
    expect(test.completeChat).not.toHaveBeenCalled()
  })

  it('rejects a signed AI artifact whose source workspace advanced before first save', async () => {
    const test = await harness()
    const generated = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        existingQuestions: [],
        focus: '',
      }),
    })
    expect(generated.response.status).toBe(200)

    const advanced = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'advance-before-ai-save' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 0,
        workspace: workspace('personal-one', {
          interviews: [interview({ ownerUserId: 'personal-one', teamId: null })],
        }),
      }),
    })
    expect(advanced.response.status).toBe(200)
    expect(advanced.body.data.revision).toBe(1)

    const staleDraft = clone(advanced.body.data)
    staleDraft.questions = generated.body.data
    const stale = await test.request('/api/interview-prep/workspace', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'stale-first-ai-save' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        expectedRevision: 1,
        workspace: staleDraft,
      }),
    })
    expect(stale.response.status).toBe(403)
    expect(stale.body.error.code).toBe('INTERVIEW_AI_ARTIFACT_FORBIDDEN')
  })

  it('records usage but discards an AI result when the durable revision changes', async () => {
    let test
    const completeChat = vi.fn(async () => {
      test.records.set(test.keyFor('personal-one'), workspace('personal-one', { revision: 1 }))
      return {
        text: questionCompletion(),
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      }
    })
    test = await harness({ completeChat })
    const result = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        existingQuestions: [],
        focus: '',
      }),
    })
    expect(result.response.status).toBe(409)
    expect(result.body.error.code).toBe('INTERVIEW_AI_STALE_RESULT')
    expect(test.recordAiKeyUsage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result.body)).not.toContain('Which part of the lab agenda')
  })

  it('records usage but returns no AI artifact after the actor auth version is revoked', async () => {
    let test
    const completeChat = vi.fn(async () => {
      const actor = test.users.find((entry) => entry.id === 'personal-one')
      actor.settings.authVersion += 1
      return {
        text: questionCompletion(),
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      }
    })
    test = await harness({ completeChat })
    const result = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        existingQuestions: [],
        focus: '',
      }),
    })
    expect(result.response.status).toBe(403)
    expect(result.body.error.code).toBe('INTERVIEW_ACCESS_REVOKED')
    expect(test.recordAiKeyUsage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result.body)).not.toContain('Which part of the lab agenda')
  })

  it('records usage but returns no Team AI artifact after the student assignment is revoked', async () => {
    let test
    const completeChat = vi.fn(async () => {
      const student = test.memberships.find((entry) => entry.userId === 'student-one')
      student.relationships.teacherIds = []
      student.updatedAt = '2026-08-02T12:00:02.000Z'
      return {
        text: questionCompletion(),
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      }
    })
    test = await harness({ completeChat })
    const result = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      headers: { 'X-Test-User': 'teacher-one' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        keyId: 'key-team',
        interview: interview(),
        existingQuestions: [],
        focus: '',
      }),
    })
    expect(result.response.status).toBe(403)
    expect(result.body.error.code).toBe('INTERVIEW_ACCESS_REVOKED')
    expect(test.recordAiKeyUsage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result.body)).not.toContain('Which part of the lab agenda')
  })

  it('honours an already-aborted request without provider or usage side effects', async () => {
    const test = await harness()
    const result = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      headers: { 'X-Test-Abort': '1' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        existingQuestions: [],
        focus: '',
      }),
    })
    expect(result.response.status).toBe(499)
    expect(result.body.error.code).toBe('INTERVIEW_OPERATION_ABORTED')
    expect(test.completeChat).not.toHaveBeenCalled()
    expect(test.recordAiKeyUsage).not.toHaveBeenCalled()
  })

  it('does not confuse a framework-owned request signal with AI cancellation', async () => {
    const test = await harness()
    const result = await test.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      headers: { 'X-Test-Framework-Abort': '1' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        existingQuestions: [],
        focus: '',
      }),
    })
    expect(result.response.status).toBe(200)
    expect(result.body.data).toHaveLength(1)
    expect(test.completeChat).toHaveBeenCalledTimes(1)
    expect(test.recordAiKeyUsage).toHaveBeenCalledTimes(1)
  })

  it('maps strict AI follow-up to a signed question while the session stays open', async () => {
    const completeChat = vi.fn(async (input) => {
      expect(input.maxTokens).toBe(3_000)
      return {
        text: nextTurnCompletion(),
        usage: { promptTokens: 11, completionTokens: 6 },
      }
    })
    const test = await harness({ completeChat })
    const result = await test.request('/api/interview-prep/ai/mock-turn', {
      method: 'POST',
      headers: { 'X-Test-User': 'student-one' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        keyId: 'key-team',
        interview: interview(),
        session: mockSession({ status: 'in-progress', completedAt: null }),
        questions: [question()],
      }),
    })
    expect(result.response.status).toBe(200)
    expect(result.body.data).toHaveLength(1)
    expect(result.body.data[0]).toMatchObject({
      interviewId: 'interview-primary',
      source: 'ai',
      category: 'research',
      prompt: 'How did you verify that the measured improvement is reproducible?',
    })
    expect(result.body.data[0].id).toMatch(/^[A-Za-z0-9._:@/-]+$/)
    expect(JSON.stringify(result.body)).not.toMatch(/rationale|turn|intent/i)
    expect(test.recordAiKeyUsage).toHaveBeenCalledWith('key-team', {
      inputTokens: 11,
      outputTokens: 6,
      totalTokens: 17,
    })
  })

  it('rejects next-turn input without a practice answer before any provider call', async () => {
    const test = await harness({ completeChat: vi.fn() })
    const result = await test.request('/api/interview-prep/ai/mock-turn', {
      method: 'POST',
      headers: { 'X-Test-User': 'student-one' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        keyId: 'key-team',
        interview: interview(),
        session: mockSession({
          status: 'in-progress',
          completedAt: null,
          answers: [],
        }),
        questions: [question()],
      }),
    })
    expect(result.response.status).toBe(400)
    expect(result.body.error.code).toBe('INTERVIEW_AI_INPUT_INVALID')
    expect(test.completeChat).not.toHaveBeenCalled()
    expect(test.recordAiKeyUsage).not.toHaveBeenCalled()
  })

  it('honours an aborted next-turn request without provider or usage side effects', async () => {
    const test = await harness()
    const result = await test.request('/api/interview-prep/ai/mock-turn', {
      method: 'POST',
      headers: { 'X-Test-Abort': '1' },
      body: JSON.stringify({
        subjectUserId: 'personal-one',
        keyId: 'key-personal',
        interview: interview({ ownerUserId: 'personal-one', teamId: null }),
        session: mockSession({
          status: 'in-progress',
          completedAt: null,
          ownerUserId: 'personal-one',
        }),
        questions: [question({ interviewId: 'interview-primary' })],
      }),
    })
    expect(result.response.status).toBe(499)
    expect(result.body.error.code).toBe('INTERVIEW_OPERATION_ABORTED')
    expect(test.completeChat).not.toHaveBeenCalled()
    expect(test.recordAiKeyUsage).not.toHaveBeenCalled()
  })

  it('maps strict mock evaluation to the frontend feedback contract', async () => {
    const completeChat = vi.fn(async (input) => {
      expect(input.reasoningEffort).toBe('high')
      return {
        text: feedbackCompletion(),
        usage: { promptTokens: 25, completionTokens: 15 },
      }
    })
    const test = await harness({ completeChat })
    const result = await test.request('/api/interview-prep/ai/feedback', {
      method: 'POST',
      headers: { 'X-Test-User': 'student-one' },
      body: JSON.stringify({
        subjectUserId: 'student-one',
        teamId: 'team-one',
        keyId: 'key-team',
        interview: interview(),
        session: mockSession(),
        questions: [question()],
      }),
    })
    expect(result.response.status).toBe(200)
    expect(result.body.data).toHaveLength(1)
    expect(result.body.data[0]).toMatchObject({
      interviewId: 'interview-primary',
      sessionId: 'mock-primary',
      authorKind: 'ai',
      authorName: 'AI coach',
      score: 4,
      strengths: ['Names measurable criteria'],
      improvements: ['Add a failure-analysis example'],
    })
    expect(JSON.stringify(result.body)).not.toMatch(/rationale|rubric|provider|model/i)
    expect(test.recordAiKeyUsage).toHaveBeenCalledWith('key-team', {
      inputTokens: 25,
      outputTokens: 15,
      totalTokens: 40,
    })
  })

  it('turns provider and malformed structured-output failures into non-leaking errors', async () => {
    const provider = await harness({
      completeChat: vi.fn(async () => {
        throw new Error('credential-material-personal upstream private detail')
      }),
    })
    const payload = {
      subjectUserId: 'personal-one',
      keyId: 'key-personal',
      interview: interview({ ownerUserId: 'personal-one', teamId: null }),
      existingQuestions: [],
      focus: '',
    }
    const failed = await provider.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    expect(failed.response.status).toBe(502)
    expect(failed.body.error.code).toBe('INTERVIEW_AI_PROVIDER_FAILED')
    expect(JSON.stringify(failed.body)).not.toContain('credential-material-personal')

    const malformed = await harness({
      completeChat: vi.fn(async () => ({ text: '{"analysis":"private"}', usage: {} })),
    })
    const invalid = await malformed.request('/api/interview-prep/ai/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    expect(invalid.response.status).toBe(502)
    expect(invalid.body.error.code).toBe('INTERVIEW_AI_RESPONSE_INVALID')
    expect(JSON.stringify(invalid.body)).not.toContain('private')
  })
})
