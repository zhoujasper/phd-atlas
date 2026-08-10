import { describe, expect, it } from 'vitest'
import {
  INTERVIEW_MODEL_LIMITS,
  InterviewIdempotencyConflictError,
  InterviewModelValidationError,
  InterviewRevisionConflictError,
  appendInterviewTeacherFeedback,
  appendInterviewTurn,
  assertInterviewRevision,
  createStableInterviewClientId,
  interviewContentFingerprint,
  normalizeInterviewIdempotencyKey,
  normalizeInterviewItem,
  normalizeInterviewRepository,
  normalizeInterviewSession,
  paginateInterviewSessions,
  patchInterviewItem,
  patchInterviewRepository,
  patchInterviewSession,
  stableCanonicalJson,
  summarizeInterviewSession,
} from './interviewPrepModel.js'

const NOW = '2026-08-02T12:00:00.000Z'

function repositoryFixture(overrides = {}) {
  return normalizeInterviewRepository({
    id: 'repository-001',
    clientId: 'repository-client-001',
    ownerId: 'student-001',
    teamId: 'team-001',
    applicationId: 'application-001',
    title: 'Oxford DPhil interview',
    description: 'Prepare research-fit answers.',
    target: {
      institution: 'University of Oxford',
      programme: 'Computer Science DPhil',
      supervisorNames: ['Professor Example'],
    },
    revision: 3,
    createdBy: 'teacher-001',
    updatedBy: 'teacher-001',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }, { now: NOW })
}

function itemFixture(overrides = {}) {
  return normalizeInterviewItem({
    id: 'item-001',
    clientId: 'item-client-001',
    repositoryId: 'repository-001',
    kind: 'question',
    category: 'research_fit',
    title: 'Research fit',
    question: 'Why is this lab the right place for your proposed work?',
    answerDraft: {
      content: 'My work aligns with the lab.',
      status: 'draft',
      revision: 2,
    },
    evidenceLinks: [{
      id: 'evidence-001',
      clientId: 'evidence-client-001',
      label: 'Lab page',
      url: 'https://example.edu/lab',
      sourceType: 'web',
    }],
    teacherFeedback: [{
      id: 'feedback-001',
      clientId: 'feedback-client-001',
      authorId: 'teacher-001',
      authorName: 'Teacher',
      body: 'Add one concrete example.',
      createdAt: '2026-08-01T09:30:00.000Z',
    }],
    modelMetadata: {
      provider: 'openai-compatible',
      model: 'gpt-test',
      operation: 'question_generation',
      promptTemplateId: 'interview-question-v1',
      promptVersion: '1',
    },
    revision: 4,
    createdBy: 'student-001',
    updatedBy: 'student-001',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }, { now: NOW })
}

function sessionFixture(overrides = {}) {
  return normalizeInterviewSession({
    id: 'session-001',
    clientId: 'session-client-001',
    idempotencyKey: 'session-request-001',
    repositoryId: 'repository-001',
    ownerId: 'student-001',
    teamId: 'team-001',
    applicationId: 'application-001',
    title: 'Research mock interview',
    mode: 'ai_mock',
    status: 'in_progress',
    plannedItemIds: ['item-001'],
    draftState: {
      activeItemId: 'item-001',
      pendingAnswer: 'An answer still being composed.',
      privateNotes: 'Remember the pilot result.',
      revision: 2,
    },
    turns: [],
    revision: 5,
    createdBy: 'student-001',
    updatedBy: 'student-001',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }, { now: NOW })
}

describe('interview model stable identity and fingerprints', () => {
  it('uses canonical key ordering for repeatable fingerprints and client ids', () => {
    expect(stableCanonicalJson({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(stableCanonicalJson({ nested: { a: 1, b: 2 }, z: 1 }))
    expect(interviewContentFingerprint({ z: 1, a: 2 }))
      .toBe(interviewContentFingerprint({ a: 2, z: 1 }))

    const first = createStableInterviewClientId('session', {
      ownerId: 'student-001',
      repositoryId: 'repository-001',
    })
    const second = createStableInterviewClientId('session', {
      repositoryId: 'repository-001',
      ownerId: 'student-001',
    })
    expect(first).toBe(second)
    expect(first).toMatch(/^iv_session_[a-f0-9]{24}$/)
    expect(normalizeInterviewIdempotencyKey('', { scope: 'save', seed: first }))
      .toBe(normalizeInterviewIdempotencyKey('', { scope: 'save', seed: first }))
  })

  it('rejects malformed identifiers and short idempotency keys', () => {
    expect(() => createStableInterviewClientId('***', 'seed')).toThrow(InterviewModelValidationError)
    expect(() => normalizeInterviewIdempotencyKey('short')).toThrow(
      expect.objectContaining({ code: 'INTERVIEW_MODEL_INVALID', field: 'idempotencyKey' }),
    )
  })
})

describe('interview model bounds and sanitization', () => {
  it('bounds long text, rejects oversized arrays, and validates enums', () => {
    const item = itemFixture({
      question: 'Q'.repeat(INTERVIEW_MODEL_LIMITS.question + 50),
      answerDraft: 'A'.repeat(INTERVIEW_MODEL_LIMITS.answer + 50),
    })
    expect(Array.from(item.question)).toHaveLength(INTERVIEW_MODEL_LIMITS.question)
    expect(Array.from(item.answerDraft.content)).toHaveLength(INTERVIEW_MODEL_LIMITS.answer)

    expect(() => itemFixture({
      evidenceLinks: Array.from(
        { length: INTERVIEW_MODEL_LIMITS.evidenceLinks + 1 },
        (_, index) => ({ label: 'Source ' + index, url: 'https://example.edu/' + index }),
      ),
    })).toThrow(expect.objectContaining({
      code: 'INTERVIEW_MODEL_INVALID',
      field: 'evidenceLinks',
    }))
    expect(() => itemFixture({ category: 'made_up_category' })).toThrow(
      InterviewModelValidationError,
    )
    expect(() => sessionFixture({
      turns: Array.from({ length: INTERVIEW_MODEL_LIMITS.turns + 1 }, () => ({})),
    })).toThrow(expect.objectContaining({ field: 'turns' }))
  })

  it('removes executable markup, credentials, and secret URL parameters', () => {
    const item = itemFixture({
      question: '<script>alert("x")</script><b>Safe question</b>',
      notes: 'api_key=sk-1234567890abcdefghijklmnop',
      evidenceLinks: [{
        label: '<img src=x onerror=alert(1)>Paper',
        url: 'https://example.edu/paper?token=top-secret&paper=42',
      }],
      teacherFeedback: [{
        authorId: 'teacher-001',
        body: '<iframe src="bad"></iframe>Useful feedback',
      }],
    })
    const serialized = JSON.stringify(item)

    expect(item.question).toBe('Safe question')
    expect(item.notes).toContain('[REDACTED]')
    expect(item.evidenceLinks[0].url).toContain('paper=42')
    expect(item.evidenceLinks[0].url).not.toContain('token=')
    expect(serialized).not.toMatch(/<script|<iframe|onerror/iu)
    expect(serialized).not.toContain('sk-1234567890abcdefghijklmnop')
    expect(() => itemFixture({
      evidenceLinks: [{
        label: 'Unsafe',
        url: 'https://user:password@example.edu/private',
      }],
    })).toThrow(InterviewModelValidationError)
  })

  it('persists only public model metadata and never raw chain-of-thought or secrets', () => {
    const secret = 'sk-this-secret-must-never-be-persisted'
    const chain = 'private hidden reasoning that must never be stored'
    const item = itemFixture({
      modelMetadata: {
        provider: 'openai-compatible',
        model: 'gpt-test',
        operation: 'answer_review',
        promptTemplateId: 'answer-review',
        promptVersion: '2',
        promptFingerprint: interviewContentFingerprint('safe template'),
        apiKey: secret,
        authorization: 'Bearer private-provider-token',
        rawChainOfThought: chain,
        reasoning: chain,
        messages: [{ role: 'system', content: secret }],
        prompt: {
          templateId: 'answer-review',
          version: '2',
          content: chain,
        },
        rawResponse: { hidden: chain },
      },
    })
    const session = sessionFixture({
      evaluation: {
        overallScore: 88,
        summary: 'Well structured.',
        strengths: ['Specific evidence'],
        chainOfThought: chain,
        rawReasoning: chain,
        providerResponse: { apiKey: secret },
        modelMetadata: {
          provider: 'openai-compatible',
          model: 'gpt-test',
          operation: 'evaluation',
          apiKey: secret,
          rawChainOfThought: chain,
        },
      },
    })
    const serialized = JSON.stringify({ item, session })

    expect(item.modelMetadata).toMatchObject({
      provider: 'openai-compatible',
      model: 'gpt-test',
      operation: 'answer_review',
      promptTemplateId: 'answer-review',
      promptVersion: '2',
    })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(chain)
    expect(serialized).not.toMatch(/rawChainOfThought|rawReasoning|providerResponse|messages/iu)
  })
})

describe('interview revision and server-authority boundaries', () => {
  it('returns a structured revision conflict', () => {
    expect(() => assertInterviewRevision(2, 3, {
      entityType: 'interview repository',
      entityId: 'repository-001',
    })).toThrow(expect.objectContaining({
      code: 'INTERVIEW_REVISION_CONFLICT',
      status: 409,
      expectedRevision: 2,
      currentRevision: 3,
      entityId: 'repository-001',
    }))
    expect(() => assertInterviewRevision(2, 3)).toThrow(InterviewRevisionConflictError)
  })

  it('patches editable repository fields while preserving ownership and audit authority', () => {
    const current = repositoryFixture()
    const patched = patchInterviewRepository(current, {
      expectedRevision: 3,
      id: 'attacker-repository',
      ownerId: 'attacker',
      teamId: 'attacker-team',
      applicationId: 'attacker-application',
      createdBy: 'attacker',
      createdAt: NOW,
      revision: 999,
      title: 'Updated preparation plan',
      target: { discipline: 'Machine learning' },
    }, {
      actorId: 'teacher-002',
      now: '2026-08-02T13:00:00.000Z',
    })

    expect(patched).toMatchObject({
      id: current.id,
      clientId: current.clientId,
      ownerId: current.ownerId,
      teamId: current.teamId,
      applicationId: current.applicationId,
      createdBy: current.createdBy,
      createdAt: current.createdAt,
      updatedBy: 'teacher-002',
      title: 'Updated preparation plan',
      revision: 4,
    })
    expect(patched.target).toMatchObject({
      institution: 'University of Oxford',
      discipline: 'Machine learning',
    })
    expect(() => patchInterviewRepository(current, { expectedRevision: 2, title: 'Stale' }))
      .toThrow(InterviewRevisionConflictError)
  })

  it('keeps teacher feedback and AI provenance server-owned in ordinary item patches', () => {
    const current = itemFixture()
    const patched = patchInterviewItem(current, {
      expectedRevision: 4,
      answerDraft: { content: 'A stronger answer.' },
      teacherFeedback: [{
        authorId: 'attacker',
        body: 'Forged feedback',
      }],
      modelMetadata: {
        provider: 'forged',
        model: 'forged',
      },
      repositoryId: 'attacker-repository',
    }, {
      actorId: 'student-001',
      now: '2026-08-02T13:00:00.000Z',
    })

    expect(patched.repositoryId).toBe(current.repositoryId)
    expect(patched.teacherFeedback).toEqual(current.teacherFeedback)
    expect(patched.modelMetadata).toEqual(current.modelMetadata)
    expect(patched.answerDraft).toMatchObject({
      content: 'A stronger answer.',
      revision: 3,
      updatedBy: 'student-001',
    })
    expect(patched.revision).toBe(5)
  })

  it('adds feedback through its authority-aware idempotent operation', () => {
    const current = itemFixture()
    const payload = {
      clientId: 'feedback-client-002',
      body: 'Lead with the result, then explain the method.',
      rating: 4,
    }
    const first = appendInterviewTeacherFeedback(current, payload, {
      expectedRevision: 4,
      actorId: 'teacher-002',
      feedbackId: 'feedback-002',
      now: '2026-08-02T13:00:00.000Z',
    })
    const retry = appendInterviewTeacherFeedback(first.item, payload, {
      expectedRevision: 5,
      actorId: 'teacher-002',
      feedbackId: 'feedback-002',
      now: '2026-08-02T13:00:00.000Z',
    })

    expect(first.inserted).toBe(true)
    expect(first.item.revision).toBe(5)
    expect(first.feedback.authorId).toBe('teacher-002')
    expect(retry.inserted).toBe(false)
    expect(retry.item.revision).toBe(5)
  })
})

describe('mock interview turn durability', () => {
  it('assigns authoritative sequence values and deduplicates retries', () => {
    const current = sessionFixture()
    const firstPayload = {
      clientTurnId: 'client-turn-001',
      idempotencyKey: 'turn-request-001',
      sequence: 99,
      speaker: 'interviewer',
      type: 'question',
      content: 'Why this research group?',
    }
    const first = appendInterviewTurn(current, firstPayload, {
      expectedRevision: 5,
      actorId: 'student-001',
      turnId: 'turn-001',
      now: '2026-08-02T13:00:00.000Z',
    })
    const retry = appendInterviewTurn(first.session, {
      ...firstPayload,
      sequence: 499,
    }, {
      actorId: 'student-001',
      now: '2026-08-02T13:05:00.000Z',
    })
    const second = appendInterviewTurn(retry.session, {
      clientTurnId: 'client-turn-002',
      idempotencyKey: 'turn-request-002',
      sequence: 1,
      speaker: 'candidate',
      type: 'answer',
      content: 'The group is a close methods and impact match.',
    }, {
      actorId: 'student-001',
      turnId: 'turn-002',
      now: '2026-08-02T13:06:00.000Z',
    })

    expect(first.inserted).toBe(true)
    expect(first.turn.sequence).toBe(1)
    expect(first.session.revision).toBe(6)
    expect(retry).toMatchObject({ inserted: false })
    expect(retry.session.revision).toBe(6)
    expect(second.session.turns.map((turn) => [turn.id, turn.sequence])).toEqual([
      ['turn-001', 1],
      ['turn-002', 2],
    ])
    expect(second.session.revision).toBe(7)
  })

  it('rejects an idempotency key reused with divergent content', () => {
    const first = appendInterviewTurn(sessionFixture(), {
      clientTurnId: 'client-turn-001',
      idempotencyKey: 'turn-request-001',
      speaker: 'interviewer',
      content: 'Tell me about your methods.',
    }, {
      actorId: 'student-001',
      turnId: 'turn-001',
      now: NOW,
    })

    expect(() => appendInterviewTurn(first.session, {
      clientTurnId: 'client-turn-001',
      idempotencyKey: 'turn-request-001',
      speaker: 'interviewer',
      content: 'Different content under the same retry key.',
    }, {
      actorId: 'student-001',
      now: NOW,
    })).toThrow(expect.objectContaining({
      code: 'INTERVIEW_IDEMPOTENCY_CONFLICT',
      idempotencyKey: 'turn-request-001',
    }))
    expect(() => appendInterviewTurn(first.session, {
      clientTurnId: 'client-turn-001',
      idempotencyKey: 'turn-request-001',
      speaker: 'interviewer',
      content: 'Different content under the same retry key.',
    }, {
      actorId: 'student-001',
      now: NOW,
    })).toThrow(InterviewIdempotencyConflictError)
  })

  it('normalizes persisted turns into stable sequence order and collapses exact retries', () => {
    const turns = [
      {
        id: 'turn-002',
        clientTurnId: 'client-turn-002',
        idempotencyKey: 'turn-request-002',
        sessionId: 'session-001',
        sequence: 2,
        speaker: 'candidate',
        content: 'Answer',
        createdBy: 'student-001',
      },
      {
        id: 'turn-001',
        clientTurnId: 'client-turn-001',
        idempotencyKey: 'turn-request-001',
        sessionId: 'session-001',
        sequence: 1,
        speaker: 'interviewer',
        content: 'Question',
        createdBy: 'student-001',
      },
      {
        id: 'turn-retry-copy',
        clientTurnId: 'client-turn-001',
        idempotencyKey: 'turn-request-001',
        sessionId: 'session-001',
        sequence: 3,
        speaker: 'interviewer',
        content: 'Question',
        createdBy: 'student-001',
      },
    ]
    const normalized = sessionFixture({ turns })

    expect(normalized.turns.map((turn) => turn.id)).toEqual(['turn-001', 'turn-002'])
  })
})

describe('durable draft state and compact pagination summaries', () => {
  it('updates the durable draft without accepting forged session authority', () => {
    const current = sessionFixture()
    const patched = patchInterviewSession(current, {
      expectedRevision: 5,
      ownerId: 'attacker',
      status: 'completed',
      turns: [{
        id: 'forged-turn',
        content: 'Forged transcript',
      }],
      draftState: {
        pendingAnswer: 'A locally recovered response.',
        privateNotes: 'Recovered notes.',
        lastClientEventId: 'client-event-009',
      },
    }, {
      actorId: 'student-001',
      now: '2026-08-02T14:00:00.000Z',
    })

    expect(patched.ownerId).toBe(current.ownerId)
    expect(patched.status).toBe(current.status)
    expect(patched.turns).toEqual(current.turns)
    expect(patched.draftState).toMatchObject({
      pendingAnswer: 'A locally recovered response.',
      privateNotes: 'Recovered notes.',
      lastClientEventId: 'client-event-009',
      revision: 3,
      savedAt: '2026-08-02T14:00:00.000Z',
    })
    expect(patched.revision).toBe(6)
  })

  it('never includes transcripts or active draft bodies in list summaries', () => {
    const withTurn = appendInterviewTurn(sessionFixture({
      draftState: {
        pendingAnswer: 'D'.repeat(10_000),
        privateNotes: 'N'.repeat(8_000),
      },
      evaluation: {
        overallScore: 91,
        summary: 'S'.repeat(2_000),
      },
    }), {
      clientTurnId: 'client-turn-summary',
      idempotencyKey: 'turn-request-summary',
      speaker: 'candidate',
      content: 'T'.repeat(15_000),
    }, {
      actorId: 'student-001',
      turnId: 'turn-summary',
      now: NOW,
    }).session
    const summary = summarizeInterviewSession(withTurn)
    const serialized = JSON.stringify(summary)

    expect(summary).toMatchObject({
      turnCount: 1,
      lastSequence: 1,
      overallScore: 91,
    })
    expect(Array.from(summary.evaluationSummary).length)
      .toBeLessThanOrEqual(INTERVIEW_MODEL_LIMITS.preview)
    expect(serialized).not.toContain('"turns"')
    expect(serialized).not.toContain('"draftState"')
    expect(serialized).not.toContain('T'.repeat(100))
    expect(serialized.length).toBeLessThan(2_000)
  })

  it('paginates stable updated-time summaries with bounded page sizes', () => {
    const sessions = [
      sessionFixture({
        id: 'session-001',
        clientId: 'session-client-001',
        idempotencyKey: 'session-request-001',
        updatedAt: '2026-08-02T12:00:00.000Z',
      }),
      sessionFixture({
        id: 'session-002',
        clientId: 'session-client-002',
        idempotencyKey: 'session-request-002',
        updatedAt: '2026-08-02T11:00:00.000Z',
      }),
      sessionFixture({
        id: 'session-003',
        clientId: 'session-client-003',
        idempotencyKey: 'session-request-003',
        updatedAt: '2026-08-02T10:00:00.000Z',
      }),
    ]
    const first = paginateInterviewSessions(sessions, { limit: 2 })
    const second = paginateInterviewSessions(sessions, {
      limit: 2,
      cursor: first.nextCursor,
    })

    expect(first.items.map((item) => item.id)).toEqual(['session-001', 'session-002'])
    expect(first.hasNextPage).toBe(true)
    expect(first.nextCursor).toBeTypeOf('string')
    expect(second.items.map((item) => item.id)).toEqual(['session-003'])
    expect(second.hasNextPage).toBe(false)
    expect(second.nextCursor).toBeNull()
    expect(() => paginateInterviewSessions(sessions, {
      limit: INTERVIEW_MODEL_LIMITS.pageSize + 1,
    })).toThrow(expect.objectContaining({ field: 'limit' }))
    expect(() => paginateInterviewSessions(sessions, {
      cursor: 'not-a-valid-cursor',
    })).toThrow(expect.objectContaining({ field: 'cursor' }))
  })
})
