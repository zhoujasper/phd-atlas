import { describe, expect, it, vi } from 'vitest'
import {
  INTERVIEW_EVALUATION_RUBRIC,
} from './interviewPrepAi.js'
import {
  normalizeInterviewItem,
  normalizeInterviewRepository,
  normalizeInterviewSession,
} from './interviewPrepModel.js'
import {
  createInterviewAiConcurrencyGate,
  createInterviewPrepService,
  resolveInterviewWorkspaceAccess,
  validateInterviewAiKeyScope,
} from './interviewPrepService.js'
import { PUBLIC_EDITION } from './edition.js'

const NOW = '2026-08-02T12:00:00.000Z'
const TEAM_ID = 'team-001'
const STUDENT_ID = 'student-001'
const TEACHER_ID = 'teacher-001'
const OWNER_ID = 'owner-001'

const actors = {
  student: { id: STUDENT_ID, role: 'user' },
  teacher: { id: TEACHER_ID, role: 'user' },
  owner: { id: OWNER_ID, role: 'user' },
  systemAdmin: { id: 'system-admin-001', role: 'admin' },
  outsider: { id: 'outsider-001', role: 'user' },
}

function teamFixture(overrides = {}) {
  return {
    id: TEAM_ID,
    ownerId: OWNER_ID,
    name: 'Research Team',
    permissionDefaults: {
      student: { useInterviewPrep: true },
      teacher: { manageStudentInterviewPrep: true },
    },
    ...overrides,
  }
}

function membershipsFixture(overrides = {}) {
  const members = [
    {
      id: 'membership-teacher',
      teamId: TEAM_ID,
      userId: TEACHER_ID,
      role: 'admin',
      status: 'active',
      relationships: {},
    },
    {
      id: 'membership-student',
      teamId: TEAM_ID,
      userId: STUDENT_ID,
      role: 'member',
      status: 'active',
      invitedBy: TEACHER_ID,
      relationships: { teacherIds: [TEACHER_ID] },
    },
    {
      id: 'membership-outsider',
      teamId: 'team-002',
      userId: actors.outsider.id,
      role: 'admin',
      status: 'active',
      relationships: {},
    },
  ]
  return members.map((member) => (
    overrides[member.id] ? { ...member, ...overrides[member.id] } : member
  ))
}

function workspaceFixture(overrides = {}) {
  return {
    kind: 'team',
    teamId: TEAM_ID,
    ownerId: STUDENT_ID,
    ...overrides,
  }
}

function accessFor(actor, options = {}) {
  return resolveInterviewWorkspaceAccess({
    actor,
    workspace: options.workspace ?? workspaceFixture(),
    team: options.team ?? teamFixture(),
    memberships: options.memberships ?? membershipsFixture(),
    permissionDefaults: options.permissionDefaults,
  })
}

function repositoryFixture(overrides = {}) {
  return normalizeInterviewRepository({
    id: 'repository-001',
    clientId: 'repository-client-001',
    ownerId: STUDENT_ID,
    teamId: TEAM_ID,
    applicationId: 'application-001',
    title: 'DPhil interview preparation',
    description: 'Prepare research-fit answers.',
    target: {
      institution: 'University of Oxford',
      programme: 'Computer Science DPhil',
      discipline: 'Machine learning systems',
    },
    revision: 1,
    createdBy: STUDENT_ID,
    updatedBy: STUDENT_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }, { now: NOW })
}

function itemFixture(overrides = {}) {
  return normalizeInterviewItem({
    id: 'item-001',
    clientId: 'item-client-001',
    repositoryId: 'repository-001',
    category: 'research_fit',
    question: 'Why is this group right for your work?',
    answerDraft: {
      content: 'My reproducibility project aligns with this group.',
      status: 'draft',
      revision: 1,
    },
    revision: 1,
    createdBy: STUDENT_ID,
    updatedBy: STUDENT_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }, { now: NOW })
}

function turnFixture(sequence, overrides = {}) {
  return {
    id: 'turn-' + String(sequence).padStart(3, '0'),
    clientTurnId: 'client-turn-' + String(sequence).padStart(3, '0'),
    idempotencyKey: 'turn-request-' + String(sequence).padStart(3, '0'),
    sessionId: overrides.sessionId ?? 'session-001',
    sequence,
    speaker: sequence % 2 ? 'interviewer' : 'candidate',
    content: sequence % 2 ? 'Why this project?' : 'It demonstrates reproducibility.',
    createdBy: STUDENT_ID,
    createdAt: NOW,
    ...overrides,
  }
}

function sessionFixture(overrides = {}) {
  return normalizeInterviewSession({
    id: 'session-001',
    clientId: 'session-client-001',
    idempotencyKey: 'session-request-001',
    repositoryId: 'repository-001',
    ownerId: STUDENT_ID,
    teamId: TEAM_ID,
    applicationId: 'application-001',
    title: 'Research mock',
    mode: 'ai_mock',
    status: 'in_progress',
    turns: [],
    revision: 1,
    createdBy: STUDENT_ID,
    updatedBy: STUDENT_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }, { now: NOW })
}

function completedSessionFixture() {
  return sessionFixture({
    id: 'session-completed',
    clientId: 'session-client-completed',
    idempotencyKey: 'session-request-completed',
    status: 'completed',
    completedAt: NOW,
    turns: [
      turnFixture(1, { sessionId: 'session-completed', id: 'completed-turn-001' }),
      turnFixture(2, { sessionId: 'session-completed', id: 'completed-turn-002' }),
    ],
  })
}

function clone(value) {
  return structuredClone(value)
}

function adapterFixture(options = {}) {
  const state = {
    team: teamFixture(),
    memberships: membershipsFixture(),
    repositories: [repositoryFixture()],
    items: [itemFixture()],
    sessions: [sessionFixture(), completedSessionFixture()],
    aiKeys: [
      {
        id: 'ai-key-luna',
        ownerId: OWNER_ID,
        teamId: TEAM_ID,
        scope: 'team',
        provider: 'openai',
        model: 'gpt-5.6-luna',
        baseUrl: 'https://provider.invalid/v1',
        apiKey: 'sk-test-secret-never-returned',
      },
      {
        id: 'ai-key-standard',
        ownerId: OWNER_ID,
        teamId: TEAM_ID,
        scope: 'team',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: 'sk-standard-secret-never-returned',
      },
      {
        id: 'ai-key-other-team',
        ownerId: OWNER_ID,
        teamId: 'team-002',
        scope: 'team',
        provider: 'openai',
        model: 'gpt-5.6-luna',
        apiKey: 'sk-cross-team-secret',
      },
    ],
    writeLedger: new Map(),
    aiArtifacts: new Map(),
    usageCalls: [],
    saveSessionCalls: 0,
    saveItemCalls: 0,
    saveArtifactCalls: 0,
    listRepositoryCalls: 0,
    ...options.state,
  }

  function scopeMatches(entity, scope) {
    return entity.ownerId === scope.ownerId
      && entity.teamId === scope.teamId
  }

  function writeOnce(kind, payload, commit) {
    const ledgerKey = kind + ':' + payload.idempotencyKey
    const existing = state.writeLedger.get(ledgerKey)
    if (existing) {
      if (existing.inputFingerprint !== payload.inputFingerprint) {
        throw Object.assign(new Error('idempotency conflict'), {
          code: 'INTERVIEW_IDEMPOTENCY_CONFLICT',
          status: 409,
        })
      }
      return clone(existing.value)
    }
    const value = commit()
    state.writeLedger.set(ledgerKey, {
      inputFingerprint: payload.inputFingerprint,
      value: clone(value),
    })
    return clone(value)
  }

  const adapter = {
    state,
    async getInterviewAccessContext() {
      return {
        team: clone(state.team),
        memberships: clone(state.memberships),
        permissionDefaults: clone(state.team.permissionDefaults),
      }
    },
    async listInterviewRepositories({ scope }) {
      state.listRepositoryCalls += 1
      return clone(state.repositories.filter((entry) => scopeMatches(entry, scope)))
    },
    async getInterviewRepository({ scope, repositoryId }) {
      const value = state.repositories.find((entry) => (
        entry.id === repositoryId && scopeMatches(entry, scope)
      ))
      return value ? clone(value) : null
    },
    async saveInterviewRepository(payload) {
      return writeOnce('repository', payload, () => {
        const index = state.repositories.findIndex((entry) => entry.id === payload.repository.id)
        if (payload.expectedRevision !== null && payload.expectedRevision !== undefined) {
          if (index < 0 || state.repositories[index].revision !== payload.expectedRevision) {
            throw Object.assign(new Error('revision conflict'), {
              code: 'INTERVIEW_REVISION_CONFLICT',
              status: 409,
            })
          }
        }
        if (index >= 0) state.repositories[index] = clone(payload.repository)
        else state.repositories.push(clone(payload.repository))
        return payload.repository
      })
    },
    async listInterviewItems({ repositoryId }) {
      return clone(state.items.filter((entry) => entry.repositoryId === repositoryId))
    },
    async getInterviewItem({ repositoryId, itemId }) {
      const value = state.items.find((entry) => (
        entry.id === itemId && entry.repositoryId === repositoryId
      ))
      return value ? clone(value) : null
    },
    async saveInterviewItem(payload) {
      state.saveItemCalls += 1
      return writeOnce('item', payload, () => {
        const index = state.items.findIndex((entry) => entry.id === payload.item.id)
        if (payload.expectedRevision !== null && payload.expectedRevision !== undefined) {
          if (index < 0 || state.items[index].revision !== payload.expectedRevision) {
            throw Object.assign(new Error('revision conflict'), {
              code: 'INTERVIEW_REVISION_CONFLICT',
              status: 409,
            })
          }
        }
        if (index >= 0) state.items[index] = clone(payload.item)
        else state.items.push(clone(payload.item))
        return payload.item
      })
    },
    async listInterviewSessions({ repositoryId }) {
      return clone(state.sessions.filter((entry) => entry.repositoryId === repositoryId))
    },
    async getInterviewSession({ repositoryId, sessionId }) {
      const value = state.sessions.find((entry) => (
        entry.id === sessionId && entry.repositoryId === repositoryId
      ))
      return value ? clone(value) : null
    },
    async saveInterviewSession(payload) {
      state.saveSessionCalls += 1
      return writeOnce('session', payload, () => {
        const index = state.sessions.findIndex((entry) => entry.id === payload.session.id)
        if (payload.expectedRevision !== null && payload.expectedRevision !== undefined) {
          if (index < 0 || state.sessions[index].revision !== payload.expectedRevision) {
            throw Object.assign(new Error('revision conflict'), {
              code: 'INTERVIEW_REVISION_CONFLICT',
              status: 409,
            })
          }
        }
        if (index >= 0) state.sessions[index] = clone(payload.session)
        else state.sessions.push(clone(payload.session))
        return payload.session
      })
    },
    async getAiKeyById({ aiKeyId }) {
      const value = state.aiKeys.find((entry) => entry.id === aiKeyId)
      return value ? clone(value) : null
    },
    async recordAiUsage(payload) {
      state.usageCalls.push(clone(payload))
      return clone(payload.usage)
    },
    async getInterviewAiArtifactByIdempotencyKey({ scope, mode, idempotencyKey }) {
      const key = scope.kind + ':' + scope.teamId + ':' + scope.ownerId
        + ':' + mode + ':' + idempotencyKey
      const value = state.aiArtifacts.get(key)
      return value ? clone(value) : null
    },
    async saveInterviewAiArtifact(payload) {
      state.saveArtifactCalls += 1
      const key = payload.scope.kind + ':' + payload.scope.teamId + ':'
        + payload.scope.ownerId + ':' + payload.mode + ':' + payload.idempotencyKey
      const existing = state.aiArtifacts.get(key)
      if (existing) {
        if (existing.artifact.inputFingerprint !== payload.inputFingerprint) {
          throw Object.assign(new Error('idempotency conflict'), {
            code: 'INTERVIEW_IDEMPOTENCY_CONFLICT',
            status: 409,
          })
        }
        return clone(existing)
      }
      const record = {
        artifact: clone(payload.artifact),
        usage: clone(payload.usage),
        expectedSourceRevisions: clone(payload.expectedSourceRevisions),
      }
      state.aiArtifacts.set(key, record)
      return clone(record)
    },
  }
  return adapter
}

function completionPayload(name) {
  if (name === 'interview_question_bank') {
    return {
      schemaVersion: 1,
      artifactType: 'question_bank',
      questions: [{
        category: 'research_fit',
        difficulty: 'medium',
        question: 'How does your prior work fit this research group?',
        rationale: 'Tests research fit using the supplied application context.',
        evidenceRefs: [],
        suggestedActions: ['add_example'],
      }],
      coverageSummary: 'Covers research fit.',
      evidenceGaps: [],
      suggestedActions: ['schedule_mock'],
    }
  }
  if (name === 'interview_answer_deepening') {
    return {
      schemaVersion: 1,
      artifactType: 'answer_deepening',
      suggestedAnswer: 'My reproducibility project provides a concrete methods and impact match.',
      rationale: 'Adds a specific and honest fit connection.',
      changes: [],
      suggestedActions: ['revise_draft'],
    }
  }
  if (name === 'interview_next_mock_turn') {
    return {
      schemaVersion: 1,
      artifactType: 'next_mock_turn',
      intent: 'clarify_method',
      question: 'How did you validate reproducibility?',
      rationale: 'The recent answer does not yet explain validation.',
      evidenceRefs: [],
      suggestedActions: ['prepare_follow_up'],
    }
  }
  return {
    schemaVersion: 1,
    artifactType: 'mock_evaluation',
    overallScore: 82,
    summary: 'The completed mock was clear and evidence grounded.',
    rationale: 'Scores reflect only the bounded supplied transcript.',
    rubric: INTERVIEW_EVALUATION_RUBRIC.map((entry) => ({
      criterion: entry.key,
      score: 82,
      summary: 'The supplied turns show competent ' + entry.label.toLowerCase() + '.',
      evidenceRefs: [],
    })),
    strengths: ['Clear structure'],
    improvements: ['Add one more quantified example'],
    suggestedActions: ['practice_aloud'],
  }
}

function completeChatFixture(implementation) {
  return vi.fn(implementation ?? (async ({ outputSchema }) => ({
    text: JSON.stringify(completionPayload(outputSchema.name)),
    usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
  })))
}

function serviceFixture(options = {}) {
  const storage = options.storage ?? adapterFixture()
  const completeChat = options.completeChat ?? completeChatFixture()
  const service = createInterviewPrepService({
    storage,
    completeChat,
    now: () => NOW,
    maxConcurrentAi: options.maxConcurrentAi ?? 2,
    maxQueuedAi: options.maxQueuedAi ?? 8,
  })
  return { storage, completeChat, service }
}

function baseAiArgs(overrides = {}) {
  return {
    actor: actors.student,
    workspace: workspaceFixture(),
    repositoryId: 'repository-001',
    aiKeyId: 'ai-key-luna',
    idempotencyKey: 'interview-ai-request-001',
    ...overrides,
  }
}

describe('Interview Prep workspace authorization', () => {
  it('separates personal self, outsider, and system-admin permissions', () => {
    const personal = { kind: 'personal', ownerId: STUDENT_ID }
    expect(resolveInterviewWorkspaceAccess({
      actor: actors.student,
      workspace: personal,
    })).toMatchObject({
      actorRole: 'self',
      permissions: { read: true, write: true, ai: true, feedback: false },
    })
    expect(resolveInterviewWorkspaceAccess({
      actor: actors.outsider,
      workspace: personal,
    })).toMatchObject({
      allowed: false,
      reason: 'personal_owner_mismatch',
    })
    expect(resolveInterviewWorkspaceAccess({
      actor: actors.systemAdmin,
      workspace: personal,
    })).toMatchObject({
      actorRole: 'system_admin',
      permissions: { read: true, write: true, ai: true, feedback: true },
    })
  })

  it('allows an enabled active Team student to manage only their own workspace', () => {
    expect(accessFor(actors.student)).toMatchObject({
      actorRole: 'student',
      permissions: { read: true, write: true, ai: true, feedback: false },
    })
    expect(accessFor(actors.student, {
      workspace: workspaceFixture({ ownerId: 'student-002' }),
      memberships: [
        ...membershipsFixture(),
        {
          id: 'membership-student-002',
          teamId: TEAM_ID,
          userId: 'student-002',
          role: 'member',
          status: 'active',
          relationships: {},
        },
      ],
    })).toMatchObject({ allowed: false, reason: 'team_role_forbidden' })
    expect(accessFor(actors.student, {
      memberships: membershipsFixture({
        'membership-student': {
          relationships: {
            teacherIds: [TEACHER_ID],
            studentPermissions: { useInterviewPrep: false },
          },
        },
      }),
    })).toMatchObject({
      permissions: { read: false, write: false, ai: false, feedback: false },
    })
  })

  it.skipIf(PUBLIC_EDITION)('requires an active assigned teacher and manageStudentInterviewPrep', () => {
    expect(accessFor(actors.teacher)).toMatchObject({
      actorRole: 'teacher',
      assigned: true,
      permissions: { read: true, write: true, ai: true, feedback: true },
    })
    expect(accessFor(actors.teacher, {
      memberships: membershipsFixture({
        'membership-student': { relationships: { teacherIds: [] } },
      }),
    })).toMatchObject({
      assigned: false,
      permissions: { read: false, write: false, ai: false, feedback: false },
    })
    expect(accessFor(actors.teacher, {
      memberships: membershipsFixture({
        'membership-teacher': {
          relationships: {
            teacherPermissions: { manageStudentInterviewPrep: false },
          },
        },
      }),
    })).toMatchObject({
      assigned: true,
      permissions: { read: false, write: false, ai: false, feedback: false },
    })
    expect(accessFor(actors.teacher, {
      memberships: membershipsFixture({
        'membership-teacher': { status: 'removed' },
      }),
    })).toMatchObject({ allowed: false, reason: 'actor_membership_inactive' })
  })

  it('allows owner/system admin but denies cross-Team and inactive targets by default', () => {
    expect(accessFor(actors.owner)).toMatchObject({
      actorRole: 'owner',
      permissions: { read: true, write: true, ai: true, feedback: true },
    })
    expect(accessFor(actors.systemAdmin)).toMatchObject({
      actorRole: 'system_admin',
      permissions: { read: true, write: true, ai: true, feedback: true },
    })
    expect(accessFor(actors.outsider)).toMatchObject({
      allowed: false,
      reason: 'actor_membership_inactive',
    })
    const inactiveMembers = membershipsFixture({
      'membership-student': { status: 'removed' },
    })
    expect(accessFor(actors.owner, { memberships: inactiveMembers })).toMatchObject({
      allowed: false,
      reason: 'target_student_inactive',
    })
    expect(accessFor(actors.systemAdmin, { memberships: inactiveMembers })).toMatchObject({
      allowed: false,
      reason: 'target_student_inactive',
    })
    expect(accessFor(actors.teacher, {
      team: teamFixture({ id: 'team-002' }),
    })).toMatchObject({ allowed: false, reason: 'team_inaccessible' })
  })
})

describe('Interview Prep AI-key scope', () => {
  it('strictly matches personal and Team credentials without returning secrets', () => {
    const personal = validateInterviewAiKeyScope({
      id: 'personal-key-001',
      ownerId: STUDENT_ID,
      teamId: null,
      scope: 'personal',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      apiKey: 'sk-personal-secret',
    }, { kind: 'personal', ownerId: STUDENT_ID })
    const team = validateInterviewAiKeyScope({
      id: 'team-key-001',
      ownerId: OWNER_ID,
      teamId: TEAM_ID,
      scope: 'team',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      apiKey: 'sk-team-secret',
    }, workspaceFixture())

    expect(personal).not.toHaveProperty('apiKey')
    expect(team).not.toHaveProperty('apiKey')
    expect(team).toMatchObject({ scope: 'team', teamId: TEAM_ID })
    expect(() => validateInterviewAiKeyScope({
      id: 'cross-key',
      ownerId: OWNER_ID,
      teamId: 'team-002',
      scope: 'team',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      apiKey: 'sk-cross-secret',
    }, workspaceFixture())).toThrow(expect.objectContaining({
      code: 'INTERVIEW_AI_KEY_SCOPE_FORBIDDEN',
      status: 403,
    }))
    expect(() => validateInterviewAiKeyScope({
      id: 'mixed-key',
      ownerId: STUDENT_ID,
      teamId: TEAM_ID,
      scope: 'personal',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      apiKey: 'sk-mixed-secret',
    }, { kind: 'personal', ownerId: STUDENT_ID })).toThrow(
      expect.objectContaining({ code: 'INTERVIEW_AI_KEY_SCOPE_FORBIDDEN' }),
    )
  })
})

describe('Interview Prep aggregate operations and authority', () => {
  it('aggregates repositories, items, sessions, and turns inside one authorized scope', async () => {
    const { service } = serviceFixture()
    const snapshot = await service.getWorkspaceSnapshot({
      actor: actors.student,
      workspace: workspaceFixture(),
    })

    expect(snapshot).toMatchObject({
      scope: workspaceFixture(),
      access: {
        actorRole: 'student',
        permissions: { read: true, write: true, ai: true, feedback: false },
      },
    })
    expect(snapshot.repositories).toHaveLength(1)
    expect(snapshot.repositories[0]).toMatchObject({
      repository: { id: 'repository-001' },
      items: [{ id: 'item-001' }],
    })
    expect(snapshot.repositories[0].sessions.map((entry) => entry.id)).toEqual([
      'session-001',
      'session-completed',
    ])
    expect(snapshot.repositories[0].sessions[1].turns).toHaveLength(2)
    expect(snapshot.contentFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('denies unauthorized reads before the storage listing executes', async () => {
    const { service, storage } = serviceFixture()
    await expect(service.getWorkspaceSnapshot({
      actor: actors.outsider,
      workspace: workspaceFixture(),
    })).rejects.toMatchObject({
      code: 'INTERVIEW_ACCESS_FORBIDDEN',
      status: 403,
      details: { capability: 'read' },
    })
    expect(storage.state.listRepositoryCalls).toBe(0)
  })

  it('makes turn retries idempotent even when the caller repeats an old revision', async () => {
    const { service, storage } = serviceFixture()
    const args = {
      actor: actors.student,
      workspace: workspaceFixture(),
      repositoryId: 'repository-001',
      sessionId: 'session-001',
      expectedRevision: 1,
      turnId: 'turn-new-001',
      idempotencyKey: 'turn-service-request-001',
      turn: {
        clientTurnId: 'client-new-turn-001',
        idempotencyKey: 'turn-service-request-001',
        speaker: 'interviewer',
        content: 'Why did you choose this validation method?',
      },
    }
    const first = await service.appendTurn(args)
    const retry = await service.appendTurn(args)

    expect(first).toMatchObject({ inserted: true, turn: { sequence: 1 } })
    expect(retry).toMatchObject({ inserted: false, turn: { id: 'turn-new-001' } })
    expect(retry.session.revision).toBe(2)
    expect(storage.state.saveSessionCalls).toBe(1)
    expect(storage.state.sessions.find((entry) => entry.id === 'session-001').turns)
      .toHaveLength(1)
  })

  it.skipIf(PUBLIC_EDITION)('reserves teacher feedback for authorized managers', async () => {
    const { service } = serviceFixture()
    const args = {
      workspace: workspaceFixture(),
      repositoryId: 'repository-001',
      itemId: 'item-001',
      expectedRevision: 1,
      feedbackId: 'feedback-service-001',
      idempotencyKey: 'feedback-service-request-001',
      feedback: {
        clientId: 'feedback-service-client-001',
        body: 'Lead with the quantified result.',
      },
    }
    await expect(service.addTeacherFeedback({
      ...args,
      actor: actors.student,
    })).rejects.toMatchObject({
      code: 'INTERVIEW_ACCESS_FORBIDDEN',
      details: { capability: 'feedback' },
    })
    const result = await service.addTeacherFeedback({
      ...args,
      actor: actors.teacher,
    })
    expect(result).toMatchObject({
      inserted: true,
      feedback: {
        id: 'feedback-service-001',
        authorId: TEACHER_ID,
      },
    })
  })
})

describe('Interview Prep AI orchestration', () => {
  it('runs all four strict parsers, records usage, and uses high reasoning only for Luna', async () => {
    const { service, completeChat, storage } = serviceFixture()
    const question = await service.generateQuestionBank(baseAiArgs({
      idempotencyKey: 'ai-question-request-001',
    }))
    const answer = await service.deepenSelectedAnswer(baseAiArgs({
      itemId: 'item-001',
      idempotencyKey: 'ai-answer-request-001',
    }))
    const next = await service.generateNextMockTurn(baseAiArgs({
      sessionId: 'session-001',
      idempotencyKey: 'ai-next-request-001',
    }))
    const evaluation = await service.evaluateCompletedMock(baseAiArgs({
      sessionId: 'session-completed',
      idempotencyKey: 'ai-evaluation-request-001',
    }))
    const standard = await service.generateQuestionBank(baseAiArgs({
      aiKeyId: 'ai-key-standard',
      input: { focus: 'A second independent generation.' },
      idempotencyKey: 'ai-question-standard-001',
    }))

    expect([
      question.artifact.artifactType,
      answer.artifact.artifactType,
      next.artifact.artifactType,
      evaluation.artifact.artifactType,
      standard.artifact.artifactType,
    ]).toEqual([
      'question_bank',
      'answer_deepening',
      'next_mock_turn',
      'mock_evaluation',
      'question_bank',
    ])
    expect(completeChat).toHaveBeenCalledTimes(5)
    expect(completeChat.mock.calls.slice(0, 4).every(([input]) => (
      input.reasoningEffort === 'high'
    ))).toBe(true)
    expect(completeChat.mock.calls[4][0].reasoningEffort).toBeUndefined()
    for (const [input] of completeChat.mock.calls) {
      expect(input).toMatchObject({
        webSearch: false,
        allowedDomains: [],
      })
      expect(input.signal).toBeUndefined()
    }
    expect(storage.state.usageCalls).toHaveLength(5)
    expect(storage.state.usageCalls[0]).toMatchObject({
      aiKeyId: 'ai-key-luna',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    })
    const serialized = JSON.stringify({ question, answer, next, evaluation, standard })
    expect(serialized).not.toContain('sk-test-secret-never-returned')
    expect(serialized).not.toMatch(/rawChainOfThought|providerResponse/iu)
  })

  it('rejects a cross-Team key before calling the provider', async () => {
    const { service, completeChat } = serviceFixture()
    await expect(service.generateQuestionBank(baseAiArgs({
      aiKeyId: 'ai-key-other-team',
      idempotencyKey: 'ai-cross-team-request-001',
    }))).rejects.toMatchObject({
      code: 'INTERVIEW_AI_KEY_SCOPE_FORBIDDEN',
      status: 403,
    })
    expect(completeChat).not.toHaveBeenCalled()
  })

  it('collapses concurrent retries and reuses the durable idempotent artifact', async () => {
    let release
    const completeChat = completeChatFixture(({ outputSchema }) => new Promise((resolve) => {
      release = () => resolve({
        text: JSON.stringify(completionPayload(outputSchema.name)),
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      })
    }))
    const { service, storage } = serviceFixture({ completeChat })
    const args = baseAiArgs({ idempotencyKey: 'ai-idempotent-request-001' })
    const firstPromise = service.generateQuestionBank(args)
    const retryPromise = service.generateQuestionBank(args)
    await vi.waitFor(() => expect(completeChat).toHaveBeenCalledTimes(1))
    release()
    const [first, retry] = await Promise.all([firstPromise, retryPromise])
    const durableRetry = await service.generateQuestionBank(args)
    const wrongKeyRetry = service.generateQuestionBank({
      ...args,
      aiKeyId: 'ai-key-other-team',
    })
    await expect(wrongKeyRetry).rejects.toMatchObject({
      code: 'INTERVIEW_AI_KEY_SCOPE_FORBIDDEN',
      status: 403,
    })

    expect(first.artifact.artifactFingerprint).toBe(retry.artifact.artifactFingerprint)
    expect(durableRetry).toMatchObject({
      cached: true,
      persisted: true,
      artifact: { artifactFingerprint: first.artifact.artifactFingerprint },
    })
    expect(completeChat).toHaveBeenCalledTimes(1)
    expect(storage.state.usageCalls).toHaveLength(1)
    expect(storage.state.saveArtifactCalls).toBe(1)
  })

  it('records provider usage but refuses to save a stale answer result', async () => {
    const storage = adapterFixture()
    const completeChat = completeChatFixture(async ({ outputSchema }) => {
      const current = storage.state.items.find((entry) => entry.id === 'item-001')
      const changed = normalizeInterviewItem({
        ...current,
        answerDraft: {
          ...current.answerDraft,
          content: 'The student changed this answer while AI was running.',
          revision: current.answerDraft.revision + 1,
          updatedAt: '2026-08-02T12:01:00.000Z',
        },
        revision: current.revision + 1,
        updatedAt: '2026-08-02T12:01:00.000Z',
      }, { now: '2026-08-02T12:01:00.000Z' })
      storage.state.items = storage.state.items.map((entry) => (
        entry.id === current.id ? changed : entry
      ))
      return {
        text: JSON.stringify(completionPayload(outputSchema.name)),
        usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
      }
    })
    const { service } = serviceFixture({ storage, completeChat })

    await expect(service.deepenSelectedAnswer(baseAiArgs({
      itemId: 'item-001',
      idempotencyKey: 'ai-stale-answer-request-001',
    }))).rejects.toMatchObject({
      code: 'INTERVIEW_AI_STALE_RESULT',
      status: 409,
    })
    expect(storage.state.usageCalls).toHaveLength(1)
    expect(storage.state.usageCalls[0].usage.totalTokens).toBe(13)
    expect(storage.state.saveArtifactCalls).toBe(0)
    expect(storage.state.aiArtifacts.size).toBe(0)
  })

  it('counts malformed model output usage without persisting provider reasoning', async () => {
    const completeChat = completeChatFixture(async ({ outputSchema }) => ({
      text: JSON.stringify({
        ...completionPayload(outputSchema.name),
        rawChainOfThought: 'private provider reasoning',
      }),
      usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
    }))
    const { service, storage } = serviceFixture({ completeChat })

    await expect(service.generateQuestionBank(baseAiArgs({
      idempotencyKey: 'ai-unsafe-output-request-001',
    }))).rejects.toMatchObject({ code: 'INTERVIEW_AI_UNSAFE_OUTPUT' })
    expect(storage.state.usageCalls).toHaveLength(1)
    expect(storage.state.saveArtifactCalls).toBe(0)
    expect(JSON.stringify(storage.state)).not.toContain('private provider reasoning')
  })
})

describe('Interview AI concurrency and cancellation', () => {
  it('removes an aborted queued operation without starting it', async () => {
    const gate = createInterviewAiConcurrencyGate({ limit: 1, queueLimit: 2 })
    let release
    const started = []
    const first = gate.run(undefined, () => new Promise((resolve) => {
      started.push('first')
      release = resolve
    }))
    const controller = new AbortController()
    const second = gate.run(controller.signal, async () => {
      started.push('second')
    })
    await vi.waitFor(() => expect(started).toEqual(['first']))
    controller.abort()

    await expect(second).rejects.toMatchObject({
      code: 'INTERVIEW_OPERATION_ABORTED',
      status: 499,
    })
    release('done')
    await expect(first).resolves.toBe('done')
    expect(started).toEqual(['first'])
  })
})
