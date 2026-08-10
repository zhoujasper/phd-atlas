import { describe, expect, it } from 'vitest'
import {
  INTERVIEW_WORKSPACE_CATEGORY_MAP,
  INTERVIEW_WORKSPACE_LIMITS,
  InterviewWorkspaceRevisionConflictError,
  InterviewWorkspaceValidationError,
  assertInterviewWorkspaceRevision,
  createInterviewWorkspaceFingerprint,
  createStableInterviewWorkspaceId,
  mapInterviewMockEvaluationArtifactToFeedback,
  mapInterviewQuestionBankArtifactToQuestions,
  normalizeInterviewPrepWorkspace,
  stableInterviewWorkspaceJson,
  validateInterviewPrepWorkspace,
} from './interviewWorkspace.js'

const NOW = '2026-08-02T12:00:00.000Z'

function interview(overrides = {}) {
  return {
    id: 'interview-1',
    ownerUserId: 'forged-owner',
    teamId: 'forged-team',
    applicationId: 'application-1',
    sourceCommunicationId: 'communication-1',
    createdByUserId: 'forged-creator',
    title: 'Oxford interview',
    school: 'Oxford',
    program: 'DPhil Computer Science',
    advisor: 'Professor Example',
    format: 'video',
    scheduledAt: '2026-08-10T09:00:00.000Z',
    timezone: 'Europe/London',
    durationMinutes: 30,
    participantNames: ['Professor Example'],
    status: 'preparing',
    preparationNotes: 'Prepare research-fit examples.',
    talkingPoints: 'Reproducible systems.',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function question(overrides = {}) {
  return {
    id: 'question-1',
    interviewId: 'interview-1',
    category: 'research',
    prompt: 'Why this group?',
    source: 'user',
    createdByUserId: 'forged-creator',
    order: 0,
    notes: 'Use one concrete example.',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function session(overrides = {}) {
  return {
    id: 'mock-1',
    interviewId: 'interview-1',
    ownerUserId: 'forged-owner',
    mode: 'self',
    status: 'in-progress',
    questionIds: ['question-1'],
    currentQuestionId: 'question-1',
    answers: [{
      questionId: 'question-1',
      body: 'Because our work is closely aligned.',
      confidence: 4,
      updatedAt: '2026-08-01T10:00:00.000Z',
    }],
    startedAt: '2026-08-01T09:00:00.000Z',
    completedAt: null,
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function feedback(overrides = {}) {
  return {
    id: 'feedback-1',
    interviewId: 'interview-1',
    sessionId: 'mock-1',
    questionId: 'question-1',
    authorKind: 'self',
    authorName: 'Student',
    body: 'Use a more specific result.',
    strengths: ['Clear structure'],
    improvements: ['Quantify impact'],
    score: 4,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function workspace(overrides = {}) {
  return {
    subjectUserId: 'student-1',
    subjectName: 'Student One',
    revision: 3,
    interviews: [interview()],
    questions: [question()],
    mockSessions: [session()],
    feedback: [feedback()],
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

const AUTHORITY = {
  subjectUserId: 'student-authoritative',
  subjectName: 'Authoritative Student',
  ownerUserId: 'student-authoritative',
  createdByUserId: 'actor-authoritative',
  teamId: 'team-authoritative',
  now: NOW,
}

function normalize(value = workspace(), options = {}) {
  return normalizeInterviewPrepWorkspace(value, { ...AUTHORITY, ...options })
}

function questionBankArtifact(overrides = {}) {
  return {
    artifactType: 'question_bank',
    artifactFingerprint: 'a'.repeat(64),
    inputFingerprint: 'b'.repeat(64),
    questions: [{
      clientId: 'ai-question-1',
      category: 'research_fit',
      difficulty: 'medium',
      question: 'How does your work align with this group?',
      rationale: 'Private reasoning that must not reach the frontend.',
      evidenceRefs: ['application:one', 'professor:one'],
      suggestedActions: ['add_example'],
      modelMetadata: { provider: 'secret-provider' },
    }],
    coverageSummary: 'Research fit coverage.',
    rationale: 'Never expose this.',
    modelMetadata: { provider: 'secret-provider' },
    ...overrides,
  }
}

function evaluationArtifact(overrides = {}) {
  return {
    artifactType: 'mock_evaluation',
    artifactFingerprint: 'c'.repeat(64),
    inputFingerprint: 'd'.repeat(64),
    evaluation: {
      overallScore: 82,
      summary: 'The answer was clear and grounded.',
      rubric: [{
        criterion: 'clarity',
        score: 80,
        summary: 'Private rubric detail.',
        evidenceRefs: ['turn:one', 'turn:two'],
      }],
      strengths: ['Clear structure'],
      improvements: ['Add a numerical result'],
      modelMetadata: { provider: 'secret-provider' },
    },
    rationale: 'Hidden chain of thought.',
    modelMetadata: { provider: 'secret-provider' },
    ...overrides,
  }
}

describe('interview workspace normalization and authority', () => {
  it('emits the exact aggregate workspace shape expected by the frontend', () => {
    const result = normalize()
    expect(Object.keys(result)).toEqual([
      'subjectUserId',
      'subjectName',
      'revision',
      'interviews',
      'questions',
      'mockSessions',
      'feedback',
      'updatedAt',
    ])
    expect(result.interviews).toHaveLength(1)
    expect(result.questions).toHaveLength(1)
    expect(result.mockSessions).toHaveLength(1)
    expect(result.feedback).toHaveLength(1)
  })

  it('overrides subject, owner, team, and creator authority from server options', () => {
    const result = normalize()
    expect(result.subjectUserId).toBe('student-authoritative')
    expect(result.subjectName).toBe('Authoritative Student')
    expect(result.interviews[0]).toMatchObject({
      ownerUserId: 'student-authoritative',
      teamId: 'team-authoritative',
      createdByUserId: 'actor-authoritative',
    })
    expect(result.questions[0].createdByUserId).toBe('actor-authoritative')
    expect(result.mockSessions[0].ownerUserId).toBe('student-authoritative')
  })

  it('does not accept a raw team id when no trusted team option is supplied', () => {
    const result = normalizeInterviewPrepWorkspace(workspace(), {
      subjectUserId: 'student-1',
      createdByUserId: 'student-1',
      now: NOW,
    })
    expect(result.interviews[0].teamId).toBeNull()
  })

  it('rejects unsafe authority identifiers instead of hashing them', () => {
    expect(() => normalize(workspace(), { subjectUserId: 'https://evil.test/user' }))
      .toThrowError(InterviewWorkspaceValidationError)
  })

  it('replaces unsafe entity identifiers with deterministic stable ids', () => {
    const input = workspace({
      interviews: [interview({ id: 'https://evil.test/interview' })],
      questions: [question({ interviewId: 'https://evil.test/interview' })],
      mockSessions: [],
      feedback: [],
    })
    const first = normalize(input)
    const second = normalize(input)
    expect(first.interviews[0].id).toMatch(/^interview-[a-f0-9]{24}$/u)
    expect(first.interviews[0].id).toBe(second.interviews[0].id)
    expect(first.questions[0].interviewId).toBe(first.interviews[0].id)
  })

  it('creates canonical stable ids and JSON independent of object key order', () => {
    expect(stableInterviewWorkspaceJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(createStableInterviewWorkspaceId('question', { b: 2, a: 1 }))
      .toBe(createStableInterviewWorkspaceId('question', { a: 1, b: 2 }))
  })

  it('cleans HTML, URLs, secrets, bidi controls, and chain-of-thought text', () => {
    const result = normalize(workspace({
      interviews: [interview({
        title: '<b>Safe title</b> https://evil.test',
        preparationNotes: [
          '<script>alert(1)</script>',
          '<analysis>private deliberation</analysis>',
          'Reasoning: do not expose this',
          'api key = sk-1234567890abcdef',
          '\u202Evisible',
        ].join('\n'),
      })],
    }))
    const event = result.interviews[0]
    expect(event.title).toContain('Safe title')
    expect(event.title).not.toMatch(/<|https?:\/\//u)
    expect(event.preparationNotes).not.toMatch(/alert|private deliberation|do not expose|sk-|\u202E/u)
    expect(event.preparationNotes).toContain('[redacted]')
  })

  it('bounds authored text by Unicode code point', () => {
    const result = normalize(workspace({
      questions: [question({ prompt: '😀'.repeat(INTERVIEW_WORKSPACE_LIMITS.questionPrompt + 20) })],
    }))
    expect([...result.questions[0].prompt]).toHaveLength(INTERVIEW_WORKSPACE_LIMITS.questionPrompt)
  })

  it('rejects collections over their hard limit by default', () => {
    const input = workspace({
      interviews: Array.from({ length: INTERVIEW_WORKSPACE_LIMITS.interviews + 1 }, (_, index) => (
        interview({ id: `interview-${index}` })
      )),
      questions: [],
      mockSessions: [],
      feedback: [],
    })
    expect(() => normalize(input)).toThrowError(expect.objectContaining({
      code: 'INTERVIEW_WORKSPACE_LIMIT_EXCEEDED',
      field: 'workspace.interviews',
    }))
  })

  it('offers an explicit bounded truncation mode for import recovery', () => {
    const input = workspace({
      interviews: Array.from({ length: INTERVIEW_WORKSPACE_LIMITS.interviews + 1 }, (_, index) => (
        interview({ id: `interview-${index}` })
      )),
      questions: [],
      mockSessions: [],
      feedback: [],
    })
    expect(normalize(input, { truncateCollections: true }).interviews)
      .toHaveLength(INTERVIEW_WORKSPACE_LIMITS.interviews)
  })

  it('deduplicates entity ids, answer question ids, and string lists', () => {
    const result = normalize(workspace({
      interviews: [interview(), interview({ title: 'Duplicate id' })],
      questions: [question(), question({ prompt: 'Duplicate id' })],
      mockSessions: [session({
        questionIds: ['question-1', 'question-1'],
        answers: [
          session().answers[0],
          { ...session().answers[0], body: 'Duplicate answer' },
        ],
      })],
      feedback: [feedback({ strengths: ['Clear', 'clear', 'Specific'] })],
    }))
    expect(result.interviews).toHaveLength(1)
    expect(result.questions).toHaveLength(1)
    expect(result.mockSessions[0].questionIds).toEqual(['question-1'])
    expect(result.mockSessions[0].answers).toHaveLength(1)
    expect(result.feedback[0].strengths).toEqual(['Clear', 'Specific'])
  })
})

describe('interview workspace referential integrity and ordering', () => {
  it('rejects a question that references an unknown interview', () => {
    expect(() => normalize(workspace({ questions: [question({ interviewId: 'missing' })] })))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_REFERENCE_INVALID' }))
  })

  it('can explicitly drop dangling records for legacy recovery', () => {
    const result = normalize(workspace({ questions: [question({ interviewId: 'missing' })], mockSessions: [], feedback: [] }), {
      dropInvalidReferences: true,
    })
    expect(result.questions).toEqual([])
  })

  it('rejects a session question belonging to another interview', () => {
    const secondInterview = interview({ id: 'interview-2' })
    const secondQuestion = question({ id: 'question-2', interviewId: 'interview-2' })
    const input = workspace({
      interviews: [interview(), secondInterview],
      questions: [question(), secondQuestion],
      mockSessions: [session({ questionIds: ['question-2'], currentQuestionId: 'question-2', answers: [] })],
      feedback: [],
    })
    expect(() => normalize(input)).toThrowError(expect.objectContaining({
      field: 'workspace.mockSessions[0].questionIds[0]',
    }))
  })

  it('rejects an answer outside the session question set', () => {
    expect(() => normalize(workspace({
      mockSessions: [session({
        questionIds: [],
        currentQuestionId: null,
        answers: [session().answers[0]],
      })],
      feedback: [],
    }))).toThrowError(expect.objectContaining({
      field: 'workspace.mockSessions[0].answers[0].questionId',
    }))
  })

  it('rejects feedback whose session belongs to another interview', () => {
    const input = workspace({
      interviews: [interview(), interview({ id: 'interview-2' })],
      questions: [question(), question({ id: 'question-2', interviewId: 'interview-2' })],
      mockSessions: [session(), session({
        id: 'mock-2',
        interviewId: 'interview-2',
        questionIds: ['question-2'],
        currentQuestionId: 'question-2',
        answers: [],
      })],
      feedback: [feedback({ sessionId: 'mock-2' })],
    })
    expect(() => normalize(input)).toThrowError(expect.objectContaining({
      field: 'workspace.feedback[0].sessionId',
    }))
  })

  it('rejects feedback for a question outside its referenced session', () => {
    const input = workspace({
      questions: [question(), question({ id: 'question-2', order: 1 })],
      feedback: [feedback({ questionId: 'question-2' })],
    })
    expect(() => normalize(input)).toThrowError(expect.objectContaining({
      field: 'workspace.feedback[0].questionId',
    }))
  })

  it('sorts upcoming interviews first and completed interviews last', () => {
    const result = normalize(workspace({
      interviews: [
        interview({ id: 'completed', status: 'completed', scheduledAt: '2026-08-01T09:00:00Z' }),
        interview({ id: 'later', scheduledAt: '2026-08-20T09:00:00Z' }),
        interview({ id: 'sooner', scheduledAt: '2026-08-05T09:00:00Z' }),
      ],
      questions: [],
      mockSessions: [],
      feedback: [],
    }))
    expect(result.interviews.map((entry) => entry.id)).toEqual(['sooner', 'later', 'completed'])
  })

  it('sorts questions by interview and explicit order', () => {
    const result = normalize(workspace({
      questions: [
        question({ id: 'question-2', order: 2 }),
        question({ id: 'question-0', order: 0 }),
        question({ id: 'question-1', order: 1 }),
      ],
      mockSessions: [],
      feedback: [],
    }))
    expect(result.questions.map((entry) => entry.id)).toEqual(['question-0', 'question-1', 'question-2'])
  })

  it('sorts sessions and feedback newest first within an interview', () => {
    const result = normalize(workspace({
      mockSessions: [
        session({ id: 'mock-old', updatedAt: '2026-08-01T10:00:00Z' }),
        session({ id: 'mock-new', updatedAt: '2026-08-02T10:00:00Z' }),
      ],
      feedback: [
        feedback({ id: 'feedback-old', sessionId: 'mock-old', updatedAt: '2026-08-01T10:00:00Z' }),
        feedback({ id: 'feedback-new', sessionId: 'mock-new', updatedAt: '2026-08-02T10:00:00Z' }),
      ],
    }))
    expect(result.mockSessions.map((entry) => entry.id)).toEqual(['mock-new', 'mock-old'])
    expect(result.feedback.map((entry) => entry.id)).toEqual(['feedback-new', 'feedback-old'])
  })

  it('rejects malformed timestamps rather than preserving ambiguous values', () => {
    expect(() => normalize(workspace({ interviews: [interview({ scheduledAt: 'next Tuesday' })] })))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_TIMESTAMP_INVALID' }))
  })
})

describe('trusted artifact boundaries', () => {
  it('rejects client-forged teacher questions', () => {
    expect(() => normalize(workspace({ questions: [question({ source: 'teacher' })] })))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_TEACHER_ARTIFACT_FORBIDDEN' }))
  })

  it('rejects client-forged AI questions', () => {
    expect(() => normalize(workspace({ questions: [question({ source: 'ai' })] })))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN' }))
  })

  it('rejects client-forged teacher feedback', () => {
    expect(() => normalize(workspace({ feedback: [feedback({ authorKind: 'teacher' })] })))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_TEACHER_ARTIFACT_FORBIDDEN' }))
  })

  it('rejects client-forged AI feedback', () => {
    expect(() => normalize(workspace({ feedback: [feedback({ authorKind: 'ai' })] })))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN' }))
  })

  it('allows trusted teacher and AI artifacts only with explicit authority flags', () => {
    const result = normalize(workspace({
      questions: [question({ source: 'teacher' })],
      feedback: [feedback({ authorKind: 'ai', authorName: 'Forged' })],
    }), {
      allowTeacherFeedback: true,
      allowAiArtifacts: true,
      aiAuthorName: 'AI coach',
    })
    expect(result.questions[0].source).toBe('teacher')
    expect(result.feedback[0]).toMatchObject({ authorKind: 'ai', authorName: 'AI coach' })
  })
})

describe('revision compare-and-swap and idempotency fingerprinting', () => {
  it('returns the durable revision on a successful CAS check', () => {
    expect(assertInterviewWorkspaceRevision(3, 3)).toBe(3)
  })

  it('throws a structured conflict for a stale workspace revision', () => {
    expect(() => assertInterviewWorkspaceRevision(2, 3, { subjectUserId: 'student-1' }))
      .toThrowError(InterviewWorkspaceRevisionConflictError)
    try {
      assertInterviewWorkspaceRevision(2, 3, { subjectUserId: 'student-1' })
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        expectedRevision: 2,
        currentRevision: 3,
        subjectUserId: 'student-1',
      })
    }
  })

  it('keeps client idempotency fingerprints stable across revision and update timestamps', () => {
    const first = createInterviewWorkspaceFingerprint(workspace(), AUTHORITY)
    const second = createInterviewWorkspaceFingerprint(workspace({
      revision: 99,
      updatedAt: '2026-08-02T11:00:00Z',
      interviews: [interview({ updatedAt: '2026-08-02T11:00:00Z' })],
      questions: [question({ updatedAt: '2026-08-02T11:00:00Z' })],
      mockSessions: [session({
        updatedAt: '2026-08-02T11:00:00Z',
        answers: [{ ...session().answers[0], updatedAt: '2026-08-02T11:00:00Z' }],
      })],
      feedback: [feedback({ updatedAt: '2026-08-02T11:00:00Z' })],
    }), AUTHORITY)
    expect(second).toBe(first)
  })

  it('changes the client idempotency fingerprint for authored content', () => {
    const first = createInterviewWorkspaceFingerprint(workspace(), AUTHORITY)
    const second = createInterviewWorkspaceFingerprint(workspace({
      questions: [question({ prompt: 'A materially different question' })],
    }), AUTHORITY)
    expect(second).not.toBe(first)
  })

  it('validates rather than silently truncating through the strict helper', () => {
    const input = workspace({
      feedback: Array.from({ length: INTERVIEW_WORKSPACE_LIMITS.feedback + 1 }, (_, index) => (
        feedback({ id: `feedback-${index}` })
      )),
    })
    expect(() => validateInterviewPrepWorkspace(input, AUTHORITY))
      .toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_LIMIT_EXCEEDED' }))
  })
})

describe('safe AI artifact mapping', () => {
  it('defines a complete mapping for every server AI question category', () => {
    expect(Object.keys(INTERVIEW_WORKSPACE_CATEGORY_MAP)).toEqual([
      'motivation',
      'research_fit',
      'research_proposal',
      'methods',
      'technical',
      'experience',
      'behavioral',
      'teaching',
      'ethics',
      'funding',
      'logistics',
      'custom',
    ])
    const artifact = questionBankArtifact({
      questions: Object.keys(INTERVIEW_WORKSPACE_CATEGORY_MAP).map((category, index) => ({
        clientId: `ai-question-${index}`,
        category,
        question: `Unique question ${index}?`,
        rationale: `Private rationale ${index}`,
        evidenceRefs: [],
      })),
    })
    const result = mapInterviewQuestionBankArtifactToQuestions(artifact, {
      allowAiArtifacts: true,
      interviewId: 'interview-1',
      createdByUserId: 'ai-service',
      now: NOW,
    })
    expect(result.map((entry) => entry.category)).toEqual(Object.values(INTERVIEW_WORKSPACE_CATEGORY_MAP))
  })

  it('maps question artifacts to stable frontend questions without rationale or metadata', () => {
    const options = {
      allowAiArtifacts: true,
      interviewId: 'interview-1',
      createdByUserId: 'ai-service',
      startOrder: 4,
      now: NOW,
    }
    const artifact = questionBankArtifact({
      questions: [
        questionBankArtifact().questions[0],
        { ...questionBankArtifact().questions[0], clientId: 'duplicate', rationale: 'another secret' },
      ],
    })
    const first = mapInterviewQuestionBankArtifactToQuestions(artifact, options)
    const second = mapInterviewQuestionBankArtifactToQuestions(artifact, options)
    expect(first).toHaveLength(1)
    expect(first).toEqual(second)
    expect(first[0]).toMatchObject({
      interviewId: 'interview-1',
      category: 'advisor',
      source: 'ai',
      createdByUserId: 'ai-service',
      order: 4,
      notes: '• application:one\n• professor:one',
    })
    expect(JSON.stringify(first)).not.toMatch(/rationale|metadata|provider|secret-provider|Private reasoning/iu)
  })

  it('sanitizes mapped question text and discards unsafe evidence references', () => {
    const artifact = questionBankArtifact({
      questions: [{
        ...questionBankArtifact().questions[0],
        question: '<b>Safe</b> https://evil.test sk-1234567890abcdef',
        evidenceRefs: ['application:one', 'https://evil.test/evidence'],
      }],
    })
    const [result] = mapInterviewQuestionBankArtifactToQuestions(artifact, {
      allowAiArtifacts: true,
      interviewId: 'interview-1',
      createdByUserId: 'ai-service',
      now: NOW,
    })
    expect(result.prompt).not.toMatch(/<|https?:\/\/|sk-/u)
    expect(result.notes).toBe('• application:one')
  })

  it('requires explicit trusted AI authority for question mapping', () => {
    expect(() => mapInterviewQuestionBankArtifactToQuestions(questionBankArtifact(), {
      interviewId: 'interview-1',
      createdByUserId: 'student-1',
      now: NOW,
    })).toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN' }))
  })

  it('maps mock evaluation summaries and evidence into bounded frontend feedback', () => {
    const [result] = mapInterviewMockEvaluationArtifactToFeedback(evaluationArtifact(), {
      allowAiArtifacts: true,
      interviewId: 'interview-1',
      sessionId: 'mock-1',
      aiAuthorName: 'AI coach',
      now: NOW,
    })
    expect(result).toMatchObject({
      interviewId: 'interview-1',
      sessionId: 'mock-1',
      questionId: null,
      authorKind: 'ai',
      authorName: 'AI coach',
      strengths: ['Clear structure'],
      improvements: ['Add a numerical result'],
      score: 4,
    })
    expect(result.body).toContain('The answer was clear and grounded.')
    expect(result.body).toContain('• turn:one')
    expect(JSON.stringify(result)).not.toMatch(/rationale|metadata|provider|Private rubric detail/iu)
  })

  it('sanitizes evaluation output and never leaks hidden response fields', () => {
    const artifact = evaluationArtifact({
      evaluation: {
        ...evaluationArtifact().evaluation,
        summary: '<analysis>private</analysis><b>Clear</b> https://evil.test',
        strengths: ['api key=sk-1234567890abcdef'],
      },
      rawResponse: 'secret raw model output',
    })
    const [result] = mapInterviewMockEvaluationArtifactToFeedback(artifact, {
      allowAiArtifacts: true,
      interviewId: 'interview-1',
      sessionId: 'mock-1',
      now: NOW,
    })
    expect(JSON.stringify(result)).not.toMatch(/private|https?:\/\/|sk-|rawResponse|secret raw/iu)
    expect(result.body).toContain('Clear')
    expect(result.strengths[0]).toContain('[redacted]')
  })

  it('requires explicit trusted AI authority and the expected evaluation artifact type', () => {
    expect(() => mapInterviewMockEvaluationArtifactToFeedback(evaluationArtifact(), {
      interviewId: 'interview-1',
      sessionId: 'mock-1',
      now: NOW,
    })).toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN' }))
    expect(() => mapInterviewMockEvaluationArtifactToFeedback(questionBankArtifact(), {
      allowAiArtifacts: true,
      interviewId: 'interview-1',
      sessionId: 'mock-1',
      now: NOW,
    })).toThrowError(expect.objectContaining({ code: 'INTERVIEW_WORKSPACE_ARTIFACT_INVALID' }))
  })
})
