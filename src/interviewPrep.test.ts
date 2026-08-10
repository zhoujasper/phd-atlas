import { describe, expect, it } from 'vitest'
import {
  clearRecoverableInterviewPrepDraft,
  createEmptyInterviewPrepWorkspace,
  createInterviewMockSession,
  interviewPrepRecoveryKey,
  interviewPrepWorkspaceAcknowledged,
  loadRecoverableInterviewPrepDraft,
  normalizeInterviewPrepWorkspace,
  removeInterviewEvent,
  saveRecoverableInterviewPrepDraft,
  selectInterviewPrepAiKey,
  sortInterviewEvents,
  upsertInterviewEvent,
} from './interviewPrep'
import type { InterviewEvent, InterviewPrepRecoveryScope, InterviewPrepWorkspace } from './interviewPrep'

function interview(overrides: Partial<InterviewEvent> = {}): InterviewEvent {
  return {
    id: 'interview-1',
    ownerUserId: 'student-1',
    teamId: null,
    applicationId: null,
    sourceCommunicationId: null,
    createdByUserId: 'student-1',
    title: 'Faculty interview',
    school: 'Northbridge University',
    program: 'Computer Science',
    advisor: 'Professor Lin',
    format: 'video',
    scheduledAt: '2026-08-12T10:00:00.000Z',
    timezone: 'Europe/London',
    durationMinutes: 30,
    participantNames: [],
    status: 'upcoming',
    preparationNotes: '',
    talkingPoints: '',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('interview prep model', () => {
  it('sorts upcoming interviews before completed records and undated drafts', () => {
    const events = [
      interview({ id: 'completed', status: 'completed', scheduledAt: '2026-08-01T09:00:00.000Z' }),
      interview({ id: 'undated', status: 'preparing', scheduledAt: null }),
      interview({ id: 'later', scheduledAt: '2026-08-20T09:00:00.000Z' }),
      interview({ id: 'earlier', scheduledAt: '2026-08-10T09:00:00.000Z' }),
    ]

    expect(sortInterviewEvents(events).map((event) => event.id)).toEqual([
      'earlier',
      'later',
      'undated',
      'completed',
    ])
  })

  it('removes an interview and every dependent question, mock, and feedback entry together', () => {
    const event = interview()
    const base = upsertInterviewEvent(createEmptyInterviewPrepWorkspace('student-1', 'Ada'), event)
    const session = createInterviewMockSession({
      interviewId: event.id,
      ownerUserId: 'student-1',
      questionIds: ['question-1'],
      now: '2026-08-02T10:00:00.000Z',
    })
    const workspace = {
      ...base,
      questions: [{
        id: 'question-1',
        interviewId: event.id,
        category: 'research' as const,
        prompt: 'Describe your research.',
        source: 'user' as const,
        createdByUserId: 'student-1',
        order: 0,
        notes: '',
        createdAt: '2026-08-02T10:00:00.000Z',
        updatedAt: '2026-08-02T10:00:00.000Z',
      }],
      mockSessions: [session],
      feedback: [{
        id: 'feedback-1',
        interviewId: event.id,
        sessionId: session.id,
        questionId: 'question-1',
        authorKind: 'self' as const,
        body: 'Tighten the opening.',
        strengths: [],
        improvements: [],
        score: null,
        createdAt: '2026-08-02T10:00:00.000Z',
        updatedAt: '2026-08-02T10:00:00.000Z',
      }],
    }

    const next = removeInterviewEvent(workspace, event.id, '2026-08-02T11:00:00.000Z')

    expect(next.interviews).toEqual([])
    expect(next.questions).toEqual([])
    expect(next.mockSessions).toEqual([])
    expect(next.feedback).toEqual([])
    expect(next.revision).toBe(workspace.revision)
  })

  it('normalizes malformed recovered data and drops orphaned child records', () => {
    const normalized = normalizeInterviewPrepWorkspace({
      subjectUserId: 'student-1',
      subjectName: 'Ada',
      revision: -4,
      updatedAt: '2026-08-02T10:00:00.000Z',
      interviews: [interview({ durationMinutes: 9999 })],
      questions: [
        {
          id: 'question-valid',
          interviewId: 'interview-1',
          category: 'unknown',
          prompt: 'Question',
          source: 'unknown',
        },
        { id: 'question-orphan', interviewId: 'missing' },
      ],
      mockSessions: [],
      feedback: [],
    })

    expect(normalized?.revision).toBe(0)
    expect(normalized?.interviews[0].durationMinutes).toBe(480)
    expect(normalized?.questions).toHaveLength(1)
    expect(normalized?.questions[0]).toMatchObject({ category: 'research', source: 'user' })
  })

  it('requires an advanced revision and every nested authored value in a canonical save acknowledgement', () => {
    const submitted: InterviewPrepWorkspace = {
      ...createEmptyInterviewPrepWorkspace('student-1', 'Ada'),
      revision: 3,
      interviews: [interview({
        status: 'completed',
        preparationNotes: 'Keep the methods example concise.',
        talkingPoints: 'Failure analysis',
      })],
      questions: [{
        id: 'question-1',
        interviewId: 'interview-1',
        category: 'technical',
        prompt: 'Explain the validation protocol.',
        source: 'user',
        createdByUserId: 'student-1',
        order: 0,
        notes: 'Name the held-out cohort.',
        createdAt: '2026-08-02T10:00:00.000Z',
        updatedAt: '2026-08-02T10:00:00.000Z',
      }],
      mockSessions: [{
        id: 'mock-1',
        interviewId: 'interview-1',
        ownerUserId: 'student-1',
        mode: 'self',
        status: 'completed',
        questionIds: ['question-1'],
        currentQuestionId: 'question-1',
        answers: [{
          questionId: 'question-1',
          body: 'A nested answer that must be acknowledged.',
          confidence: 4,
          updatedAt: '2026-08-02T10:03:00.000Z',
        }],
        startedAt: '2026-08-02T10:02:00.000Z',
        completedAt: '2026-08-02T10:04:00.000Z',
        updatedAt: '2026-08-02T10:04:00.000Z',
      }],
      feedback: [{
        id: 'feedback-1',
        interviewId: 'interview-1',
        sessionId: 'mock-1',
        questionId: 'question-1',
        authorKind: 'self',
        authorName: 'Ada',
        body: 'Add one measurable result.',
        strengths: ['Clear structure'],
        improvements: ['Quantify the outcome'],
        score: 4,
        createdAt: '2026-08-02T10:05:00.000Z',
        updatedAt: '2026-08-02T10:05:00.000Z',
      }],
    }
    const canonical = { ...structuredClone(submitted), revision: 4, subjectName: 'Canonical Ada' }

    expect(interviewPrepWorkspaceAcknowledged(submitted, canonical, 3)).toBe(true)
    expect(interviewPrepWorkspaceAcknowledged(submitted, { ...canonical, revision: 3 }, 3)).toBe(false)

    const omittedOrStale = [
      (value: InterviewPrepWorkspace) => { value.interviews[0].status = 'upcoming' },
      (value: InterviewPrepWorkspace) => { value.interviews[0].preparationNotes = '' },
      (value: InterviewPrepWorkspace) => { value.questions[0].notes = '' },
      (value: InterviewPrepWorkspace) => { value.mockSessions[0].status = 'in-progress' },
      (value: InterviewPrepWorkspace) => { value.mockSessions[0].answers[0].body = '' },
      (value: InterviewPrepWorkspace) => { value.feedback[0].strengths = [] },
      (value: InterviewPrepWorkspace) => { value.feedback[0].authorName = '' },
    ]
    for (const mutate of omittedOrStale) {
      const stale = structuredClone(canonical)
      mutate(stale)
      expect(interviewPrepWorkspaceAcknowledged(submitted, stale, 3)).toBe(false)
    }
  })

  it('selects only a Luna key bound to the exact personal or Team scope', () => {
    const usable = {
      provider: 'openai',
      baseUrl: 'https://api.example.test/v1',
      secretSet: true,
    }
    const keys = [
      { id: 'personal-other', model: 'gpt-5.6-luna', scope: 'personal' as const, ownerId: 'student-2' },
      { ...usable, id: 'personal-wrong-model', model: 'gpt-5.6-terra', scope: 'personal' as const, ownerId: 'student-1' },
      { ...usable, id: 'personal-luna', model: ' GPT-5.6-LUNA ', scope: 'personal' as const, ownerId: 'student-1' },
      { ...usable, id: 'team-luna', model: 'gpt-5.6-luna', scope: 'team' as const, teamId: 'team-1' },
    ]

    expect(selectInterviewPrepAiKey(keys, 'student-1')?.id).toBe('personal-luna')
    expect(selectInterviewPrepAiKey(keys, 'teacher-1', 'team-1')?.id).toBe('team-luna')
    expect(selectInterviewPrepAiKey(keys, 'teacher-1', 'team-2')).toBeNull()
  })

  it('keeps credential placeholders and unsupported provider configurations fail closed', () => {
    const base = {
      model: 'gpt-5.6-luna',
      scope: 'personal' as const,
      ownerId: 'student-1',
      provider: 'openai',
      baseUrl: 'https://api.example.test/v1',
      secretSet: true,
    }
    expect(selectInterviewPrepAiKey([{ ...base, id: 'missing-secret', secretSet: false }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'disabled-key', enabled: false }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'wrong-provider', provider: 'anthropic' }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'official-openai-default', baseUrl: '' }], 'student-1')?.id)
      .toBe('official-openai-default')
    expect(selectInterviewPrepAiKey([{ ...base, id: 'missing-url', baseUrl: undefined }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'blank-url', baseUrl: '   ' }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'bad-url', baseUrl: 'not a URL' }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'insecure-url', baseUrl: 'http://api.example.test/v1' }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'localhost-http', baseUrl: 'http://localhost:8787/v1' }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{ ...base, id: 'loopback-http', baseUrl: 'http://127.0.0.1:8787/v1' }], 'student-1')).toBeNull()
    expect(selectInterviewPrepAiKey([{
      ...base,
      id: 'embedded-credentials',
      baseUrl: 'https://user:pass@example.test/v1',
    }], 'student-1')).toBeNull()
  })
})

describe('interview prep recovery', () => {
  it('isolates a dirty draft by session user, team, and managed student', () => {
    const storage = memoryStorage()
    const workspace = {
      ...createEmptyInterviewPrepWorkspace('student-1', 'Ada', '2026-08-02T10:00:00.000Z'),
      interviews: [interview()],
    }
    const scope: InterviewPrepRecoveryScope = {
      sessionUserId: 'teacher-1',
      subjectUserId: 'student-1',
      teamId: 'team-1',
    }

    expect(saveRecoverableInterviewPrepDraft(scope, {
      workspace,
      activeInterviewId: 'interview-1',
      activeTab: 'questions',
      selectedQuestionId: null,
      activeSessionId: null,
      mobilePane: 'workspace',
      dirty: true,
    }, storage)).toBe(true)

    expect(loadRecoverableInterviewPrepDraft(scope, storage)).toMatchObject({
      activeInterviewId: 'interview-1',
      activeTab: 'questions',
      dirty: true,
    })
    expect(loadRecoverableInterviewPrepDraft({ ...scope, subjectUserId: 'student-2' }, storage)).toBeNull()
    expect(interviewPrepRecoveryKey(scope)).not.toBe(interviewPrepRecoveryKey({ ...scope, teamId: 'team-2' }))

    expect(clearRecoverableInterviewPrepDraft(scope, storage)).toBe(true)
    expect(loadRecoverableInterviewPrepDraft(scope, storage)).toBeNull()
  })

  it('fails closed for corrupt storage without throwing', () => {
    const scope: InterviewPrepRecoveryScope = {
      sessionUserId: 'student-1',
      subjectUserId: 'student-1',
      teamId: null,
    }
    const storage = memoryStorage()
    storage.setItem(interviewPrepRecoveryKey(scope), '{broken')

    expect(loadRecoverableInterviewPrepDraft(scope, storage)).toBeNull()
  })

  it('does not claim a recovery write or delete that cannot be read back', () => {
    const scope: InterviewPrepRecoveryScope = {
      sessionUserId: 'teacher-1',
      subjectUserId: 'student-1',
      teamId: 'team-1',
    }
    const draft = {
      workspace: createEmptyInterviewPrepWorkspace('student-1', 'Ada'),
      activeInterviewId: null,
      activeTab: 'plan' as const,
      selectedQuestionId: null,
      activeSessionId: null,
      mobilePane: 'workspace' as const,
      dirty: true as const,
    }
    expect(saveRecoverableInterviewPrepDraft(scope, draft, {
      getItem: () => null,
      setItem: () => undefined,
    })).toBe(false)
    expect(clearRecoverableInterviewPrepDraft(scope, {
      getItem: () => '{"dirty":true}',
      removeItem: () => undefined,
    })).toBe(false)
  })
})
