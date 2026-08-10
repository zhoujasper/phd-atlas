import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  buildInterviewMockEvaluationPrompts,
  buildInterviewNextTurnPrompts,
  buildInterviewQuestionBankPrompts,
  parseInterviewMockEvaluationResponse,
  parseInterviewNextTurnResponse,
  parseInterviewQuestionBankResponse,
} from './interviewPrepAi.js'
import {
  createInterviewAiConcurrencyGate,
  requireInterviewWorkspaceCapability,
  resolveInterviewWorkspaceAccess,
  validateInterviewAiKeyScope,
} from './interviewPrepService.js'
import {
  createInterviewWorkspaceFingerprint,
  createStableInterviewWorkspaceId,
  mapInterviewMockEvaluationArtifactToFeedback,
  mapInterviewQuestionBankArtifactToQuestions,
  normalizeInterviewPrepWorkspace,
  stableInterviewWorkspaceJson,
} from './interviewWorkspace.js'

const AUTHORITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,159}$/u
const REQUIRED_AI_MODEL = 'gpt-5.6-luna'
const PERSONAL_SCOPE = 'personal'
const TEAM_SCOPE = 'team'
const ARTIFACT_PROOF_DOMAIN = 'phd-atlas-interview-artifact-v1'

export class InterviewPrepApiError extends Error {
  constructor(code, message, status, field = null) {
    super(message)
    this.name = 'InterviewPrepApiError'
    this.code = code
    this.status = status
    if (field) this.field = field
  }
}

function apiError(code, message, status, field = null) {
  return new InterviewPrepApiError(code, message, status, field)
}

function requireDependency(options, name) {
  if (typeof options[name] !== 'function') {
    throw apiError(
      'INTERVIEW_API_CONFIG_INVALID',
      `Interview Prep API requires ${name}.`,
      500,
    )
  }
  return options[name]
}

function authorityId(value, field, optional = false) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  if (!normalized && optional) return null
  if (!AUTHORITY_ID_PATTERN.test(normalized)) {
    throw apiError(
      'INTERVIEW_SCOPE_INVALID',
      `${field} is invalid.`,
      400,
      field,
    )
  }
  return normalized
}

function integerRevision(value, field = 'expectedRevision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw apiError(
      'INTERVIEW_REVISION_INVALID',
      `${field} must be a non-negative safe integer.`,
      400,
      field,
    )
  }
  return value
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw apiError(
      'INTERVIEW_OPERATION_ABORTED',
      'The Interview Prep operation was cancelled.',
      499,
    )
  }
}

function requestSignal(request) {
  // Only the admission middleware owns this signal. Newer Node/Express
  // runtimes may expose a framework-level `request.signal` whose lifecycle is
  // tied to consuming the inbound request body. Treating that transport signal
  // as AI-operation ownership makes a fully received request look cancelled
  // before the Interview handler begins.
  return request?.aiAbortSignal ?? null
}

function scopeFromInput(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const ownerId = authorityId(raw.subjectUserId, 'subjectUserId')
  const teamId = authorityId(raw.teamId, 'teamId', true)
  return {
    kind: teamId ? TEAM_SCOPE : PERSONAL_SCOPE,
    ownerId,
    teamId,
  }
}

function enforceImpersonationBoundary(request, scope) {
  const lockedTeamId = typeof request?.impersonation?.teamId === 'string'
    ? request.impersonation.teamId
    : null
  if (!lockedTeamId) return
  if (scope.kind !== TEAM_SCOPE || scope.teamId !== lockedTeamId) {
    throw apiError(
      'TEAM_IMPERSONATION_SCOPE_REQUIRED',
      'Temporary team views can access only their selected Team workspace.',
      403,
    )
  }
}

function publicScope(scope) {
  return {
    subjectUserId: scope.ownerId,
    teamId: scope.teamId,
  }
}

function usageFromCompletion(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const bounded = (entry) => {
    const normalized = Math.round(Number(entry) || 0)
    return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, normalized))
  }
  const inputTokens = bounded(raw.inputTokens ?? raw.promptTokens)
  const outputTokens = bounded(raw.outputTokens ?? raw.completionTokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, bounded(raw.totalTokens)),
  }
}

function normalizedOutputLanguage(request, option) {
  const selected = typeof option === 'function'
    ? option(request)
    : request?.user?.settings?.language
  const normalized = typeof selected === 'string' ? selected.trim() : ''
  return normalized || 'auto'
}

function subjectFromRequestStore(request, subjectUserId) {
  return request?.store?.users?.find((candidate) => candidate?.id === subjectUserId) ?? null
}

function defaultEmptyWorkspace(scope, subject, now) {
  return {
    subjectUserId: scope.ownerId,
    subjectName: String(subject?.name ?? '').trim(),
    revision: 0,
    interviews: [],
    questions: [],
    mockSessions: [],
    feedback: [],
    updatedAt: now,
  }
}

function normalizeCanonicalWorkspace(value, { scope, subject, now }) {
  return normalizeInterviewPrepWorkspace(value, {
    subjectUserId: scope.ownerId,
    ownerUserId: scope.ownerId,
    createdByUserId: scope.ownerId,
    teamId: scope.teamId,
    subjectName: String(subject?.name ?? '').trim(),
    allowAiArtifacts: true,
    allowTeacherFeedback: true,
    dropInvalidReferences: false,
    truncateCollections: false,
    now,
  })
}

function sameJson(left, right) {
  return stableInterviewWorkspaceJson(left) === stableInterviewWorkspaceJson(right)
}

function normalizedEntityId(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function assertUniqueIds(values, field, selector = (entry) => entry?.id) {
  if (!Array.isArray(values)) return
  const seen = new Set()
  values.forEach((entry, index) => {
    const id = normalizedEntityId(selector(entry))
    if (seen.has(id)) {
      throw apiError(
        'INTERVIEW_ENTITY_ID_DUPLICATE',
        `${field} contains duplicate or Unicode-equivalent identifiers.`,
        400,
        `${field}[${index}].id`,
      )
    }
    seen.add(id)
  })
}

function assertUniqueWorkspaceEntityIds(workspace) {
  assertUniqueIds(workspace?.interviews, 'workspace.interviews')
  assertUniqueIds(workspace?.questions, 'workspace.questions')
  assertUniqueIds(workspace?.mockSessions, 'workspace.mockSessions')
  assertUniqueIds(workspace?.feedback, 'workspace.feedback')
  for (const [index, session] of (Array.isArray(workspace?.mockSessions)
    ? workspace.mockSessions
    : []).entries()) {
    assertUniqueIds(
      session?.questionIds,
      `workspace.mockSessions[${index}].questionIds`,
      (entry) => entry,
    )
    assertUniqueIds(
      session?.answers,
      `workspace.mockSessions[${index}].answers`,
      (entry) => entry?.questionId,
    )
  }
}

function resolveArtifactProofSecret(value) {
  if (!Buffer.isBuffer(value) || value.length < 32) {
    throw apiError(
      'INTERVIEW_API_CONFIG_INVALID',
      'Interview Prep API requires a domain-separated artifactProofSecret Buffer.',
      500,
    )
  }
  return Buffer.from(value)
}

function artifactSemanticRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'id' && key !== 'updatedAt'),
  )
}

function workspaceProofSource(workspace, scope) {
  return {
    revision: integerRevision(workspace?.revision ?? 0, 'workspace.revision'),
    fingerprint: createInterviewWorkspaceFingerprint(workspace, {
      subjectUserId: scope.ownerId,
      ownerUserId: scope.ownerId,
      createdByUserId: scope.ownerId,
      teamId: scope.teamId,
      subjectName: workspace?.subjectName ?? '',
      now: workspace?.updatedAt,
    }),
  }
}

function expectedArtifactProofId(kind, scope, value, proofKey, source) {
  const prefix = kind === 'question' ? 'aiq' : 'aif'
  const payload = stableInterviewWorkspaceJson({
    kind,
    scope: publicScope(scope),
    source,
    value: artifactSemanticRow(value),
  })
  const digest = createHmac('sha256', proofKey)
    .update(ARTIFACT_PROOF_DOMAIN)
    .update('\0')
    .update(payload)
    .digest('hex')
  return `${prefix}-${source.revision.toString(36)}-${source.fingerprint}-${digest}`
}

function parseArtifactProofId(value) {
  const match = typeof value === 'string'
    ? value.match(/^(aiq|aif)-([0-9a-z]+)-([a-f0-9]{64})-([a-f0-9]{64})$/u)
    : null
  if (!match) return null
  const revision = Number.parseInt(match[2], 36)
  if (!Number.isSafeInteger(revision) || revision < 0) return null
  return { prefix: match[1], revision, fingerprint: match[3] }
}

function proofIdMatches(kind, scope, value, proofKey, currentSource) {
  const parsed = parseArtifactProofId(value?.id)
  const expectedPrefix = kind === 'question' ? 'aiq' : 'aif'
  if (
    !parsed
    || parsed.prefix !== expectedPrefix
    || parsed.revision !== currentSource.revision
    || parsed.fingerprint !== currentSource.fingerprint
  ) return false
  const actual = typeof value?.id === 'string' ? Buffer.from(value.id) : Buffer.alloc(0)
  const expected = Buffer.from(expectedArtifactProofId(
    kind,
    scope,
    value,
    proofKey,
    currentSource,
  ))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function signAiArtifact(kind, scope, value, proofKey, source) {
  return {
    ...value,
    id: expectedArtifactProofId(kind, scope, value, proofKey, source),
  }
}

function assertAiArtifactsAuthorized(current, submitted, scope, proofKey) {
  const currentSource = workspaceProofSource(current, scope)
  const currentAiQuestions = new Map(
    current.questions
      .filter((question) => question.source === 'ai')
      .map((question) => [normalizedEntityId(question.id), question]),
  )
  const currentAiFeedback = new Map(
    current.feedback
      .filter((feedback) => feedback.authorKind === 'ai')
      .map((feedback) => [normalizedEntityId(feedback.id), feedback]),
  )
  const submittedQuestions = Array.isArray(submitted?.questions) ? submitted.questions : []
  const submittedFeedback = Array.isArray(submitted?.feedback) ? submitted.feedback : []
  const submittedQuestionsById = new Map(
    submittedQuestions.map((entry) => [normalizedEntityId(entry?.id), entry]),
  )
  const submittedFeedbackById = new Map(
    submittedFeedback.map((entry) => [normalizedEntityId(entry?.id), entry]),
  )

  for (const [id, canonical] of currentAiQuestions) {
    const candidate = submittedQuestionsById.get(id)
    if (candidate && !sameJson(canonical, candidate)) {
      throw apiError(
        'INTERVIEW_AI_ARTIFACT_FORBIDDEN',
        'AI-authored Interview Prep content cannot be altered or re-attributed.',
        403,
        'workspace.questions',
      )
    }
  }
  for (const [id, canonical] of currentAiFeedback) {
    const candidate = submittedFeedbackById.get(id)
    if (candidate && !sameJson(canonical, candidate)) {
      throw apiError(
        'INTERVIEW_AI_ARTIFACT_FORBIDDEN',
        'AI-authored Interview Prep content cannot be altered or re-attributed.',
        403,
        'workspace.feedback',
      )
    }
  }
  for (const candidate of submittedQuestions) {
    if (candidate?.source !== 'ai') continue
    const canonical = currentAiQuestions.get(normalizedEntityId(candidate.id))
    if (
      !sameJson(canonical, candidate)
      && !proofIdMatches('question', scope, candidate, proofKey, currentSource)
    ) {
      throw apiError(
        'INTERVIEW_AI_ARTIFACT_FORBIDDEN',
        'AI questions must be issued by the Interview Prep AI endpoint.',
        403,
        'workspace.questions',
      )
    }
  }
  for (const candidate of submittedFeedback) {
    if (candidate?.authorKind !== 'ai') continue
    const canonical = currentAiFeedback.get(normalizedEntityId(candidate.id))
    if (
      !sameJson(canonical, candidate)
      && !proofIdMatches('feedback', scope, candidate, proofKey, currentSource)
    ) {
      throw apiError(
        'INTERVIEW_AI_ARTIFACT_FORBIDDEN',
        'AI feedback must be issued by the Interview Prep AI endpoint.',
        403,
        'workspace.feedback',
      )
    }
  }
}

function assertUnprivilegedTeacherArtifactsUnchanged(current, submitted, access) {
  if (access?.permissions?.feedback) return
  const currentTeacherQuestions = new Map(
    current.questions
      .filter((question) => question.source === 'teacher')
      .map((question) => [normalizedEntityId(question.id), question]),
  )
  const currentTeacherFeedback = new Map(
    current.feedback
      .filter((feedback) => feedback.authorKind === 'teacher')
      .map((feedback) => [normalizedEntityId(feedback.id), feedback]),
  )
  const submittedQuestions = Array.isArray(submitted?.questions) ? submitted.questions : []
  const submittedFeedback = Array.isArray(submitted?.feedback) ? submitted.feedback : []
  const submittedQuestionsById = new Map(
    submittedQuestions.map((entry) => [normalizedEntityId(entry?.id), entry]),
  )
  const submittedFeedbackById = new Map(
    submittedFeedback.map((entry) => [normalizedEntityId(entry?.id), entry]),
  )

  // Canonical teacher IDs remain privileged even if a caller attempts to
  // downgrade their discriminator to user/AI. Check from the canonical side,
  // not only from rows that still self-identify as teacher in the request.
  for (const [id, canonical] of currentTeacherQuestions) {
    if (!sameJson(canonical, submittedQuestionsById.get(id))) {
      throw apiError(
        'INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN',
        'Teacher-authored Interview Prep content can be changed only by an assigned teacher or Team owner.',
        403,
        'workspace.questions',
      )
    }
  }
  for (const [id, canonical] of currentTeacherFeedback) {
    if (!sameJson(canonical, submittedFeedbackById.get(id))) {
      throw apiError(
        'INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN',
        'Teacher-authored Interview Prep content can be changed only by an assigned teacher or Team owner.',
        403,
        'workspace.feedback',
      )
    }
  }
  for (const question of submittedQuestions) {
    if (question?.source !== 'teacher') continue
    if (!sameJson(currentTeacherQuestions.get(normalizedEntityId(question.id)), question)) {
      throw apiError(
        'INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN',
        'Only an assigned teacher or Team owner can create or change teacher questions.',
        403,
        'workspace.questions',
      )
    }
  }
  for (const feedback of submittedFeedback) {
    if (feedback?.authorKind !== 'teacher') continue
    if (!sameJson(currentTeacherFeedback.get(normalizedEntityId(feedback.id)), feedback)) {
      throw apiError(
        'INTERVIEW_TEACHER_ARTIFACT_FORBIDDEN',
        'Only an assigned teacher or Team owner can create or change teacher feedback.',
        403,
        'workspace.feedback',
      )
    }
  }
}

function applyTeacherFeedbackAttribution(current, submitted, access, actorName) {
  if (!access?.permissions?.feedback || !Array.isArray(submitted?.feedback)) return submitted
  const canonicalById = new Map(
    current.feedback
      .filter((entry) => entry.authorKind === 'teacher')
      .map((entry) => [normalizedEntityId(entry.id), entry]),
  )
  return {
    ...submitted,
    feedback: submitted.feedback.map((entry) => {
      if (entry?.authorKind !== 'teacher') return entry
      const canonical = canonicalById.get(normalizedEntityId(entry.id))
      if (sameJson(canonical, entry)) return entry
      return { ...entry, authorName: String(actorName ?? '').trim() }
    }),
  }
}

function requestIdempotencyKey(request, input) {
  const header = request?.get?.('Idempotency-Key')
    ?? request?.headers?.['idempotency-key']
  if (header !== undefined && header !== null && String(header).trim()) {
    const normalized = String(header).normalize('NFKC').trim()
    if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
      throw apiError(
        'INTERVIEW_IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must be 8–160 safe characters.',
        400,
        'Idempotency-Key',
      )
    }
    return normalized
  }
  return createStableInterviewWorkspaceId('save', input)
}

function repositoryFromInterview(interview, scope, actorId, revision, now) {
  const title = interview.title || [interview.school, interview.program].filter(Boolean).join(' — ')
    || 'Interview preparation'
  return {
    id: interview.id,
    clientId: interview.id,
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    applicationId: interview.applicationId,
    title,
    description: [interview.preparationNotes, interview.talkingPoints].filter(Boolean).join('\n\n'),
    status: interview.status === 'completed' ? 'archived' : 'active',
    target: {
      institution: interview.school,
      programme: interview.program,
      degree: 'PhD',
      discipline: '',
      supervisorNames: interview.advisor ? [interview.advisor] : [],
      interviewDate: interview.scheduledAt,
    },
    revision: Math.max(1, revision),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: interview.createdAt || now,
    updatedAt: interview.updatedAt || now,
  }
}

function applicationEvidenceFromInterview(interview) {
  return {
    id: interview.applicationId ?? interview.id,
    institution: interview.school,
    programme: interview.program,
    notes: [interview.preparationNotes, interview.talkingPoints].filter(Boolean).join('\n\n'),
  }
}

function professorEvidenceFromInterview(interview) {
  return interview.advisor
    ? [{
        id: `advisor-${interview.id}`,
        name: interview.advisor,
        institution: interview.school,
        researchSummary: interview.talkingPoints,
      }]
    : []
}

function validateAiQuestionInput(body, context) {
  const interviewId = authorityId(body?.interview?.id, 'interview.id')
  const candidate = normalizeInterviewPrepWorkspace({
    subjectUserId: context.scope.ownerId,
    subjectName: context.subject.name ?? '',
    revision: context.revision,
    interviews: [body?.interview],
    questions: Array.isArray(body?.existingQuestions) ? body.existingQuestions : [],
    mockSessions: [],
    feedback: [],
    updatedAt: context.now,
  }, {
    subjectUserId: context.scope.ownerId,
    ownerUserId: context.scope.ownerId,
    createdByUserId: context.scope.ownerId,
    teamId: context.scope.teamId,
    subjectName: context.subject.name ?? '',
    allowAiArtifacts: true,
    allowTeacherFeedback: true,
    dropInvalidReferences: false,
    truncateCollections: false,
    now: context.now,
  })
  const interview = candidate.interviews.find((entry) => entry.id === interviewId)
  if (!interview) {
    throw apiError('INTERVIEW_EVENT_NOT_FOUND', 'Interview event is invalid.', 400, 'interview')
  }
  return {
    interview,
    existingQuestions: candidate.questions,
    focus: typeof body?.focus === 'string' ? body.focus : '',
  }
}

function sessionTurns(session, questionById, ownerId, now, options = {}) {
  const turns = []
  for (const questionId of session.questionIds) {
    const question = questionById.get(questionId)
    const answer = session.answers.find((entry) => entry.questionId === questionId)
    if (!question || !answer?.body?.trim()) continue
    const questionTurnId = `turn-question-${String(turns.length + 1).padStart(4, '0')}`
    turns.push({
      id: questionTurnId,
      clientTurnId: questionTurnId,
      idempotencyKey: questionTurnId,
      sequence: turns.length + 1,
      speaker: 'interviewer',
      type: 'question',
      content: question.prompt,
      evidenceLinks: [],
      evaluation: null,
      modelMetadata: null,
      revision: 1,
      createdBy: ownerId,
      updatedBy: ownerId,
      createdAt: session.startedAt || now,
      updatedAt: session.startedAt || now,
    })
    const answerTurnId = `turn-answer-${String(turns.length + 1).padStart(4, '0')}`
    turns.push({
      id: answerTurnId,
      clientTurnId: answerTurnId,
      idempotencyKey: answerTurnId,
      sequence: turns.length + 1,
      speaker: 'candidate',
      type: 'answer',
      parentTurnId: questionTurnId,
      content: answer.body,
      evidenceLinks: [],
      evaluation: null,
      modelMetadata: null,
      revision: 1,
      createdBy: ownerId,
      updatedBy: ownerId,
      createdAt: answer.updatedAt || now,
      updatedAt: answer.updatedAt || now,
    })
  }
  if (turns.length < 2) {
    throw apiError(
      'INTERVIEW_AI_INPUT_INVALID',
      options.insufficientMessage ?? 'Complete at least one mock answer before requesting feedback.',
      400,
      'session.answers',
    )
  }
  return turns
}

function validateAiFeedbackInput(body, context) {
  const interviewId = authorityId(body?.interview?.id, 'interview.id')
  const sessionId = authorityId(body?.session?.id, 'session.id')
  const candidate = normalizeInterviewPrepWorkspace({
    subjectUserId: context.scope.ownerId,
    subjectName: context.subject.name ?? '',
    revision: context.revision,
    interviews: [body?.interview],
    questions: Array.isArray(body?.questions) ? body.questions : [],
    mockSessions: [body?.session],
    feedback: [],
    updatedAt: context.now,
  }, {
    subjectUserId: context.scope.ownerId,
    ownerUserId: context.scope.ownerId,
    createdByUserId: context.scope.ownerId,
    teamId: context.scope.teamId,
    subjectName: context.subject.name ?? '',
    allowAiArtifacts: true,
    allowTeacherFeedback: true,
    dropInvalidReferences: false,
    truncateCollections: false,
    now: context.now,
  })
  const interview = candidate.interviews.find((entry) => entry.id === interviewId)
  const session = candidate.mockSessions.find((entry) => entry.id === sessionId)
  if (!interview || !session || session.interviewId !== interview.id) {
    throw apiError(
      'INTERVIEW_AI_INPUT_INVALID',
      'The mock session does not belong to this interview.',
      400,
      'session',
    )
  }
  if (session.status !== 'completed') {
    throw apiError(
      'INTERVIEW_AI_INPUT_INVALID',
      'Complete the mock session before requesting feedback.',
      400,
      'session.status',
    )
  }
  return { interview, session, questions: candidate.questions }
}

function validateAiMockTurnInput(body, context) {
  const interviewId = authorityId(body?.interview?.id, 'interview.id')
  const sessionId = authorityId(body?.session?.id, 'session.id')
  const candidate = normalizeInterviewPrepWorkspace({
    subjectUserId: context.scope.ownerId,
    subjectName: context.subject.name ?? '',
    revision: context.revision,
    interviews: [body?.interview],
    questions: Array.isArray(body?.questions) ? body.questions : [],
    mockSessions: [body?.session],
    feedback: [],
    updatedAt: context.now,
  }, {
    subjectUserId: context.scope.ownerId,
    ownerUserId: context.scope.ownerId,
    createdByUserId: context.scope.ownerId,
    teamId: context.scope.teamId,
    subjectName: context.subject.name ?? '',
    allowAiArtifacts: true,
    allowTeacherFeedback: true,
    dropInvalidReferences: false,
    truncateCollections: false,
    now: context.now,
  })
  const interview = candidate.interviews.find((entry) => entry.id === interviewId)
  const session = candidate.mockSessions.find((entry) => entry.id === sessionId)
  if (!interview || !session || session.interviewId !== interview.id) {
    throw apiError(
      'INTERVIEW_AI_INPUT_INVALID',
      'The mock session does not belong to this interview.',
      400,
      'session',
    )
  }
  if (session.status === 'completed') {
    throw apiError(
      'INTERVIEW_AI_INPUT_INVALID',
      'A completed mock session is already ready for review.',
      400,
      'session.status',
    )
  }
  return { interview, session, questions: candidate.questions }
}

function mapInterviewNextTurnArtifactToQuestion(artifact, options) {
  const prompt = String(artifact?.turn?.content ?? '').trim()
  if (!prompt) {
    throw apiError(
      'INTERVIEW_AI_RESPONSE_INVALID',
      'The Interview AI provider returned an empty follow-up question.',
      502,
    )
  }
  const timestamp = options.now
  const evidence = Array.isArray(artifact?.evidenceRefs) ? artifact.evidenceRefs : []
  return {
    id: createStableInterviewWorkspaceId('question', {
      inputFingerprint: artifact?.inputFingerprint,
      interviewId: options.interviewId,
      prompt,
    }),
    interviewId: options.interviewId,
    category: 'research',
    prompt,
    source: 'ai',
    createdByUserId: options.createdByUserId,
    order: options.startOrder ?? 0,
    notes: evidence.map((reference) => `• ${reference}`).join('\n'),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function modelSessionFromWorkspace(input, repository, scope, actorId, revision, now, options = {}) {
  const questionById = new Map(input.questions.map((question) => [question.id, question]))
  const completed = options.completed !== false
  return {
    id: input.session.id,
    clientId: input.session.id,
    idempotencyKey: createStableInterviewWorkspaceId('session', {
      ownerId: scope.ownerId,
      sessionId: input.session.id,
    }),
    repositoryId: repository.id,
    ownerId: scope.ownerId,
    teamId: scope.teamId,
    applicationId: repository.applicationId,
    title: `Mock interview — ${repository.title}`,
    mode: input.session.mode === 'teacher' ? 'teacher_mock' : 'ai_mock',
    status: completed ? 'completed' : 'in_progress',
    plannedItemIds: [],
    currentItemId: null,
    draftState: {
      activeItemId: null,
      pendingAnswer: '',
      privateNotes: '',
      elapsedSeconds: 0,
      lastClientEventId: null,
      revision: 1,
      savedAt: input.session.updatedAt || now,
    },
    turns: sessionTurns(input.session, questionById, scope.ownerId, now),
    evaluation: null,
    modelMetadata: null,
    startedAt: input.session.startedAt,
    completedAt: completed
      ? input.session.completedAt || input.session.updatedAt || now
      : null,
    revision: Math.max(1, revision),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: input.session.startedAt || now,
    updatedAt: input.session.updatedAt || now,
  }
}

function safeProviderFailure(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') {
    return apiError(
      'INTERVIEW_OPERATION_ABORTED',
      'The Interview Prep operation was cancelled.',
      499,
    )
  }
  if (error?.code === 'INTERVIEW_AI_BUSY' || error?.code === 'INTERVIEW_OPERATION_ABORTED') {
    return error
  }
  return apiError(
    'INTERVIEW_AI_PROVIDER_FAILED',
    'The Interview AI provider could not complete this request.',
    502,
  )
}

function safeAiResponseFailure() {
  return apiError(
    'INTERVIEW_AI_RESPONSE_INVALID',
    'The Interview AI provider returned an invalid structured response.',
    502,
  )
}

function responseNoStore(response) {
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Pragma', 'no-cache')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

/**
 * Builds route handlers without importing server/index.js. All credential,
 * persistence and Team-directory operations remain injected, making this
 * module usable by the main server and by real isolated HTTP tests.
 */
export function createInterviewPrepApiController(options = {}) {
  const getWorkspaceRecord = requireDependency(options, 'getInterviewPrepWorkspaceRecord')
  const saveWorkspaceRecord = requireDependency(options, 'saveInterviewPrepWorkspaceRecord')
  const getAuthorizationVersion = requireDependency(options, 'getInterviewPrepAuthorizationVersion')
  const getAiKeyById = requireDependency(options, 'getAiKeyById')
  const recordAiKeyUsage = requireDependency(options, 'recordAiKeyUsage')
  const completeChat = requireDependency(options, 'completeChat')
  const getTeamById = requireDependency(options, 'getTeamById')
  const listTeamMembers = requireDependency(options, 'listTeamMembers')
  const now = typeof options.now === 'function'
    ? options.now
    : () => new Date().toISOString()
  const getSubjectUser = typeof options.getSubjectUser === 'function'
    ? options.getSubjectUser
    : async ({ request, subjectUserId }) => subjectFromRequestStore(request, subjectUserId)
  const aiGate = options.aiGate ?? createInterviewAiConcurrencyGate({
    limit: options.maxConcurrentAi,
    queueLimit: options.maxQueuedAi,
  })
  const artifactProofSecret = resolveArtifactProofSecret(options.artifactProofSecret)

  async function subjectFor(request, scope) {
    const subject = await getSubjectUser({
      request,
      subjectUserId: scope.ownerId,
      teamId: scope.teamId,
    })
    if (!subject || subject.disabledAt) {
      throw apiError(
        'INTERVIEW_SUBJECT_NOT_FOUND',
        'The Interview Prep subject is unavailable.',
        404,
      )
    }
    return subject
  }

  async function authorize(request, scope, capability) {
    const signal = requestSignal(request)
    throwIfAborted(signal)
    if (!request?.user?.id) {
      throw apiError('UNAUTHORIZED', 'Authentication is required.', 401)
    }
    enforceImpersonationBoundary(request, scope)
    let context = {}
    if (scope.kind === TEAM_SCOPE) {
      const team = await getTeamById(scope.teamId)
        ?? request?.store?.teams?.find((entry) => entry?.id === scope.teamId)
      const memberships = await listTeamMembers(scope.teamId)
      context = {
        team,
        memberships,
        permissionDefaults: team?.permissionDefaults,
      }
    }
    const access = resolveInterviewWorkspaceAccess({
      actor: request.user,
      workspace: scope,
      ...context,
    })
    requireInterviewWorkspaceCapability(access, capability)
    return access
  }

  function authorizationVersionInput(request, scope) {
    const expectedActorAuthVersion = Number(
      request?.auth?.authVersion
      ?? request?.user?.settings?.authVersion
      ?? 0,
    )
    if (!Number.isSafeInteger(expectedActorAuthVersion) || expectedActorAuthVersion < 0) {
      throw apiError(
        'INTERVIEW_ACCESS_REVOKED',
        'The signed-in session is no longer valid for Interview Prep.',
        403,
      )
    }
    return {
      actorId: request.user.id,
      subjectUserId: scope.ownerId,
      teamId: scope.teamId,
      expectedActorRole: request.user.role,
      expectedActorAuthVersion,
    }
  }

  async function readCanonical(scope, subject, timestamp = now()) {
    const record = await getWorkspaceRecord(publicScope(scope))
    return normalizeCanonicalWorkspace(
      record ?? defaultEmptyWorkspace(scope, subject, timestamp),
      { scope, subject, now: timestamp },
    )
  }

  async function getWorkspace(request, response) {
    responseNoStore(response)
    const scope = scopeFromInput(request.query)
    await authorize(request, scope, 'read')
    const subject = await subjectFor(request, scope)
    return readCanonical(scope, subject)
  }

  async function saveWorkspace(request, response) {
    responseNoStore(response)
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body
      : {}
    const scope = scopeFromInput(body)
    const access = await authorize(request, scope, 'write')
    const subject = await subjectFor(request, scope)
    const expectedRevision = integerRevision(body.expectedRevision)
    if (!body.workspace || typeof body.workspace !== 'object' || Array.isArray(body.workspace)) {
      throw apiError(
        'INTERVIEW_WORKSPACE_INVALID',
        'workspace must be an object.',
        400,
        'workspace',
      )
    }
    if (
      body.workspace.subjectUserId !== undefined
      && authorityId(body.workspace.subjectUserId, 'workspace.subjectUserId') !== scope.ownerId
    ) {
      throw apiError(
        'INTERVIEW_SCOPE_MISMATCH',
        'The workspace subject does not match the authorized scope.',
        400,
        'workspace.subjectUserId',
      )
    }
    const timestamp = now()
    assertUniqueWorkspaceEntityIds(body.workspace)
    const current = await readCanonical(scope, subject, timestamp)
    assertUnprivilegedTeacherArtifactsUnchanged(current, body.workspace, access)
    assertAiArtifactsAuthorized(current, body.workspace, scope, artifactProofSecret)
    const attributedWorkspace = applyTeacherFeedbackAttribution(
      current,
      body.workspace,
      access,
      request.user.name,
    )
    const workspace = normalizeInterviewPrepWorkspace({
      ...attributedWorkspace,
      subjectUserId: scope.ownerId,
      subjectName: subject.name ?? '',
      revision: current.revision,
      updatedAt: timestamp,
    }, {
      subjectUserId: scope.ownerId,
      ownerUserId: scope.ownerId,
      createdByUserId: scope.ownerId,
      teamId: scope.teamId,
      subjectName: subject.name ?? '',
      // Reaching this authority flag is safe only because every client-supplied
      // AI row was matched to canonical storage or verified by the controller's
      // HMAC proof immediately above.
      allowAiArtifacts: true,
      // Unprivileged callers were already constrained above to an exact
      // round-trip of canonical teacher artifacts. The normalizer must still
      // be allowed to read those preserved rows.
      allowTeacherFeedback: true,
      dropInvalidReferences: false,
      truncateCollections: false,
      now: timestamp,
    })
    const inputFingerprint = createInterviewWorkspaceFingerprint(workspace, {
      subjectUserId: scope.ownerId,
      ownerUserId: scope.ownerId,
      createdByUserId: scope.ownerId,
      teamId: scope.teamId,
      subjectName: subject.name ?? '',
      now: timestamp,
    })
    const requestId = requestIdempotencyKey(request, {
      actorId: request.user.id,
      scope,
      expectedRevision,
      inputFingerprint,
    })
    throwIfAborted(requestSignal(request))
    // Capture the durable auth rows first, then authorize from fresh Team rows.
    // A revocation before authorize is denied there; a revocation afterwards
    // changes this version and is rejected inside the storage transaction.
    const authorizationVersion = await getAuthorizationVersion(
      authorizationVersionInput(request, scope),
    )
    await authorize(request, scope, 'write')
    const saved = await saveWorkspaceRecord({
      subjectUserId: scope.ownerId,
      teamId: scope.teamId,
      workspace,
      expectedRevision,
      actorId: request.user.id,
      requestId,
      authorizationVersion,
    })
    throwIfAborted(requestSignal(request))
    const acknowledged = normalizeCanonicalWorkspace(saved, {
      scope,
      subject,
      now: saved?.updatedAt ?? timestamp,
    })
    const acknowledgedFingerprint = createInterviewWorkspaceFingerprint(acknowledged, {
      subjectUserId: scope.ownerId,
      ownerUserId: scope.ownerId,
      createdByUserId: scope.ownerId,
      teamId: scope.teamId,
      subjectName: subject.name ?? '',
      now: acknowledged.updatedAt ?? timestamp,
    })
    if (acknowledgedFingerprint !== inputFingerprint) {
      throw apiError(
        'INTERVIEW_SAVE_NOT_ACKNOWLEDGED',
        'The durable Interview Prep response did not acknowledge every submitted value.',
        503,
      )
    }
    return acknowledged
  }

  async function loadScopedAiKey(request, scope, keyId) {
    const id = authorityId(keyId, 'keyId')
    const key = await getAiKeyById(id)
    validateInterviewAiKeyScope(key, scope)
    if (String(key.model ?? '').trim().toLowerCase() !== REQUIRED_AI_MODEL) {
      throw apiError(
        'INTERVIEW_AI_MODEL_REQUIRED',
        `Interview Prep AI requires ${REQUIRED_AI_MODEL}.`,
        409,
        'keyId',
      )
    }
    if (typeof options.authorizeAiKey === 'function') {
      const permitted = await options.authorizeAiKey({ request, scope, key })
      if (!permitted) {
        throw apiError(
          'INTERVIEW_AI_KEY_SCOPE_FORBIDDEN',
          'The selected AI key is not available in this Interview Prep workspace.',
          403,
          'keyId',
        )
      }
    }
    return key
  }

  async function runAi(request, response, mode) {
    responseNoStore(response)
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body
      : {}
    const scope = scopeFromInput(body)
    await authorize(request, scope, 'ai')
    const subject = await subjectFor(request, scope)
    const signal = requestSignal(request)
    throwIfAborted(signal)
    const authorizationVersion = await getAuthorizationVersion(
      authorizationVersionInput(request, scope),
    )
    // The request snapshot may be older than a just-committed Team change.
    // Re-resolve Team and assignment rows only after the durable account/auth
    // boundary above has proved that the actor snapshot is still current.
    await authorize(request, scope, 'ai')
    const timestamp = now()
    const durableBefore = await readCanonical(scope, subject, timestamp)
    const artifactProofSource = workspaceProofSource(durableBefore, scope)
    const key = await loadScopedAiKey(request, scope, body.keyId)
    const input = mode === 'questions'
      ? validateAiQuestionInput(body, {
          scope,
          subject,
          revision: durableBefore.revision,
          now: timestamp,
        })
      : mode === 'next'
        ? validateAiMockTurnInput(body, {
            scope,
            subject,
            revision: durableBefore.revision,
            now: timestamp,
          })
        : validateAiFeedbackInput(body, {
            scope,
            subject,
            revision: durableBefore.revision,
            now: timestamp,
          })
    const repository = repositoryFromInterview(
      input.interview,
      scope,
      request.user.id,
      durableBefore.revision,
      timestamp,
    )
    const bundle = mode === 'questions'
      ? buildInterviewQuestionBankPrompts({
          repository,
          application: applicationEvidenceFromInterview(input.interview),
          professors: professorEvidenceFromInterview(input.interview),
          sourceEvidence: input.existingQuestions.map((question) => ({
            id: question.id,
            type: 'other',
            title: question.prompt,
            excerpt: question.notes,
          })),
          requestedCount: 8,
          focus: input.focus,
          outputLanguage: normalizedOutputLanguage(request, options.outputLanguageForRequest),
        })
      : mode === 'next'
        ? buildInterviewNextTurnPrompts({
            repository,
            session: modelSessionFromWorkspace(
              input,
              repository,
              scope,
              request.user.id,
              durableBefore.revision,
              timestamp,
              { completed: false },
            ),
            application: applicationEvidenceFromInterview(input.interview),
            professors: professorEvidenceFromInterview(input.interview),
            outputLanguage: normalizedOutputLanguage(request, options.outputLanguageForRequest),
          })
        : buildInterviewMockEvaluationPrompts({
            repository,
            session: modelSessionFromWorkspace(
              input,
              repository,
              scope,
              request.user.id,
              durableBefore.revision,
              timestamp,
            ),
            application: applicationEvidenceFromInterview(input.interview),
            professors: professorEvidenceFromInterview(input.interview),
            outputLanguage: normalizedOutputLanguage(request, options.outputLanguageForRequest),
          })
    let completion
    try {
      completion = await aiGate.run(signal, () => completeChat({
        key,
        system: bundle.system,
        user: bundle.user,
        signal,
        temperature: 0.2,
        maxTokens: mode === 'questions'
          ? 8_000
          : mode === 'next'
            ? 3_000
            : 6_000,
        webSearch: false,
        allowedDomains: [],
        outputSchema: bundle.outputSchema,
        reasoningEffort: 'high',
      }))
    } catch (error) {
      throw safeProviderFailure(error, signal)
    }
    const usage = usageFromCompletion(completion?.usage)
    try {
      await recordAiKeyUsage(key.id, usage)
    } catch {
      throw apiError(
        'INTERVIEW_AI_USAGE_RECORD_FAILED',
        'Interview AI usage could not be recorded safely.',
        503,
      )
    }
    throwIfAborted(signal)

    // Re-check all mutable authorization and source-revision boundaries after
    // the provider returns. A stale or newly unauthorized artifact is never
    // parsed, mapped, persisted, or returned to the browser.
    const currentAuthorizationVersion = await getAuthorizationVersion(
      authorizationVersionInput(request, scope),
    )
    if (currentAuthorizationVersion !== authorizationVersion) {
      throw apiError(
        'INTERVIEW_ACCESS_REVOKED',
        'Interview Prep access changed while AI was working; the result was discarded.',
        403,
      )
    }
    await authorize(request, scope, 'ai')
    await loadScopedAiKey(request, scope, key.id)
    const durableAfter = await readCanonical(scope, subject, now())
    if (durableAfter.revision !== durableBefore.revision) {
      throw apiError(
        'INTERVIEW_AI_STALE_RESULT',
        'Interview content changed while AI was working; the result was discarded.',
        409,
      )
    }
    throwIfAborted(signal)
    try {
      if (mode === 'questions') {
        const artifact = parseInterviewQuestionBankResponse(completion?.text, bundle)
        return mapInterviewQuestionBankArtifactToQuestions(artifact, {
          allowAiArtifacts: true,
          interviewId: input.interview.id,
          createdByUserId: scope.ownerId,
          startOrder: input.existingQuestions.length,
          now: timestamp,
        }).map((entry) => signAiArtifact(
          'question',
          scope,
          entry,
          artifactProofSecret,
          artifactProofSource,
        ))
      }
      if (mode === 'next') {
        const artifact = parseInterviewNextTurnResponse(completion?.text, bundle)
        const question = mapInterviewNextTurnArtifactToQuestion(artifact, {
          interviewId: input.interview.id,
          createdByUserId: scope.ownerId,
          startOrder: input.questions.length,
          now: timestamp,
        })
        return [signAiArtifact(
          'question',
          scope,
          question,
          artifactProofSecret,
          artifactProofSource,
        )]
      }
      const artifact = parseInterviewMockEvaluationResponse(completion?.text, bundle)
      return mapInterviewMockEvaluationArtifactToFeedback(artifact, {
        allowAiArtifacts: true,
        interviewId: input.interview.id,
        sessionId: input.session.id,
        createdByUserId: scope.ownerId,
        aiAuthorName: 'AI coach',
        now: timestamp,
      }).map((entry) => signAiArtifact(
        'feedback',
        scope,
        entry,
        artifactProofSecret,
        artifactProofSource,
      ))
    } catch {
      throw safeAiResponseFailure()
    }
  }

  return {
    getWorkspace,
    saveWorkspace,
    generateQuestions: (request, response) => runAi(request, response, 'questions'),
    generateNextMockTurn: (request, response) => runAi(request, response, 'next'),
    generateFeedback: (request, response) => runAi(request, response, 'feedback'),
  }
}

function defaultAsyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
}

function defaultOk(response, data, status = 200) {
  response.status(status).json({ ok: true, data })
}

/** Register all five authenticated Interview Prep routes after /api auth hydration. */
export function installInterviewPrepApiRoutes(app, options = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.put !== 'function' || typeof app.post !== 'function') {
    throw apiError('INTERVIEW_API_CONFIG_INVALID', 'An Express-compatible app is required.', 500)
  }
  const controller = options.controller ?? createInterviewPrepApiController(options)
  const wrap = options.asyncHandler ?? defaultAsyncHandler
  const send = options.ok ?? defaultOk
  app.get('/api/interview-prep/workspace', wrap(async (request, response) => {
    send(response, await controller.getWorkspace(request, response))
  }))
  app.put('/api/interview-prep/workspace', wrap(async (request, response) => {
    send(response, await controller.saveWorkspace(request, response))
  }))
  app.post('/api/interview-prep/ai/questions', wrap(async (request, response) => {
    send(response, await controller.generateQuestions(request, response))
  }))
  app.post('/api/interview-prep/ai/mock-turn', wrap(async (request, response) => {
    send(response, await controller.generateNextMockTurn(request, response))
  }))
  app.post('/api/interview-prep/ai/feedback', wrap(async (request, response) => {
    send(response, await controller.generateFeedback(request, response))
  }))
  return controller
}
