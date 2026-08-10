import { createHash } from 'node:crypto'

export const INTERVIEW_WORKSPACE_LIMITS = Object.freeze({
  interviews: 100,
  questions: 1_000,
  mockSessions: 500,
  answers: 5_000,
  feedback: 1_000,
  participantNames: 50,
  questionIdsPerSession: 1_000,
  answersPerSession: 1_000,
  feedbackListItems: 20,
  subjectName: 240,
  title: 500,
  institution: 500,
  programme: 500,
  advisor: 500,
  timezone: 100,
  participantName: 240,
  preparationNotes: 16_000,
  talkingPoints: 12_000,
  questionPrompt: 4_000,
  questionNotes: 8_000,
  answerBody: 24_000,
  feedbackBody: 16_000,
  feedbackListItem: 1_000,
  evidenceRefs: 12,
})

export const INTERVIEW_WORKSPACE_QUESTION_CATEGORIES = Object.freeze([
  'research',
  'motivation',
  'experience',
  'behavioral',
  'technical',
  'advisor',
  'closing',
])

export const INTERVIEW_WORKSPACE_CATEGORY_MAP = Object.freeze({
  motivation: 'motivation',
  research_fit: 'advisor',
  research_proposal: 'research',
  methods: 'technical',
  technical: 'technical',
  experience: 'experience',
  behavioral: 'behavioral',
  teaching: 'experience',
  ethics: 'behavioral',
  funding: 'motivation',
  logistics: 'closing',
  custom: 'closing',
})

const INTERVIEW_FORMATS = ['video', 'phone', 'onsite', 'panel']
const INTERVIEW_STATUSES = ['preparing', 'upcoming', 'completed']
const QUESTION_SOURCES = ['library', 'user', 'teacher', 'ai']
const MOCK_MODES = ['self', 'ai', 'teacher']
const FEEDBACK_AUTHORS = ['self', 'teacher', 'ai']
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u
const UNSAFE_ID_SECRET_PREFIX_PATTERN = /^(?:api[_-]?key|access[_-]?token|authorization|bearer|password|secret|token)(?::|@|\/|-)/iu
const HTML_BLOCK_PATTERN = /<(script|style|iframe|object|embed|analysis|reasoning|chain[-_ ]?of[-_ ]?thought)\b[^>]*>[\s\S]*?<\/\1\s*>/giu
const HTML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/gu
const URL_PATTERN = /\b(?:https?:\/\/|www\.|javascript:|data:text\/html)[^\s<>"')\]]*/giu
const SECRET_TOKEN_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/gu
const SECRET_TOKEN_TEST_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/u
const BEARER_TOKEN_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}/giu
const NAMED_SECRET_PATTERN = /(\b(?:api[_ -]?key|access[_ -]?token|password|secret|authorization)\b\s*[:=]\s*)[^\s,;]+/giu
const REASONING_LINE_PATTERN = /^\s*(?:analysis|reasoning|rationale|chain[- ]?of[- ]?thought|hidden reasoning|private deliberation)\s*:\s*.*$/gimu
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069]/gu
const EPOCH = '1970-01-01T00:00:00.000Z'

export class InterviewWorkspaceValidationError extends Error {
  constructor(code, message, field = null) {
    super(message)
    this.name = 'InterviewWorkspaceValidationError'
    this.code = code
    this.field = field
    this.status = 400
  }
}

export class InterviewWorkspaceRevisionConflictError extends Error {
  constructor(expectedRevision, currentRevision, context = {}) {
    super('Interview workspace revision does not match the current durable revision.')
    this.name = 'InterviewWorkspaceRevisionConflictError'
    this.code = 'INTERVIEW_WORKSPACE_REVISION_CONFLICT'
    this.status = 409
    this.expectedRevision = expectedRevision
    this.currentRevision = currentRevision
    this.subjectUserId = context.subjectUserId ?? null
  }
}

function invalid(code, message, field = null) {
  throw new InterviewWorkspaceValidationError(code, message, field)
}

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INTERVIEW_WORKSPACE_INVALID', `${field} must be an object.`, field)
  }
  return value
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function truncateCodePoints(value, maximum) {
  let output = ''
  let count = 0
  for (const character of value) {
    if (count >= maximum) break
    output += character
    count += 1
  }
  return output
}

function removeUnsafeControlCharacters(value) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)
    const unsafe = codePoint <= 8
      || codePoint === 11
      || codePoint === 12
      || (codePoint >= 14 && codePoint <= 31)
      || codePoint === 127
    return unsafe ? '' : character
  }).join('')
}

function cleanText(value, options = {}) {
  const field = options.field ?? 'text'
  const maximum = options.maximum ?? 1_000
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') {
    invalid('INTERVIEW_WORKSPACE_INVALID', `${field} must be a string.`, field)
  }
  let output = removeUnsafeControlCharacters(
    value.slice(0, Math.max(maximum * 8, maximum + 1)).normalize('NFKC'),
  )
    .replace(BIDI_CONTROL_PATTERN, '')
    .replace(HTML_BLOCK_PATTERN, ' ')
    .replace(REASONING_LINE_PATTERN, ' ')
    .replace(URL_PATTERN, '[link removed]')
    .replace(SECRET_TOKEN_PATTERN, '[redacted]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(NAMED_SECRET_PATTERN, '$1[redacted]')
    .replace(HTML_TAG_PATTERN, ' ')
  output = options.multiline === false
    ? output.replace(/\s+/gu, ' ').trim()
    : output.replace(/[\t ]+/gu, ' ').replace(/ *\n */gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
  output = truncateCodePoints(output, maximum)
  if (options.required && !output) {
    invalid('INTERVIEW_WORKSPACE_REQUIRED', `${field} is required.`, field)
  }
  return output
}

function isSafeId(value) {
  return SAFE_ID_PATTERN.test(value)
    && !value.includes('://')
    && !/^(?:javascript|data):/iu.test(value)
    && !SECRET_TOKEN_TEST_PATTERN.test(value)
    && !UNSAFE_ID_SECRET_PREFIX_PATTERN.test(value)
}

function normalizeAuthorityId(value, field, options = {}) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  if (!normalized && options.optional) return null
  if (!isSafeId(normalized)) {
    invalid('INTERVIEW_WORKSPACE_AUTHORITY_INVALID', `${field} is invalid.`, field)
  }
  return normalized
}

function stableCanonicalValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((entry) => stableCanonicalValue(entry, seen))
  if (!value || typeof value !== 'object') return null
  if (seen.has(value)) invalid('INTERVIEW_WORKSPACE_INVALID', 'Workspace values must not be cyclic.')
  seen.add(value)
  const output = {}
  Object.keys(value).sort().forEach((key) => {
    if (value[key] !== undefined) output[key] = stableCanonicalValue(value[key], seen)
  })
  seen.delete(value)
  return output
}

export function stableInterviewWorkspaceJson(value) {
  return JSON.stringify(stableCanonicalValue(value))
}

export function createStableInterviewWorkspaceId(prefix, seed) {
  const safePrefix = typeof prefix === 'string' && /^[a-z][a-z0-9_-]{0,31}$/u.test(prefix)
    ? prefix
    : 'entity'
  const digest = createHash('sha256').update(stableInterviewWorkspaceJson(seed)).digest('hex')
  return `${safePrefix}-${digest.slice(0, 24)}`
}

function normalizeEntityId(value, prefix, seed) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  return isSafeId(normalized) ? normalized : createStableInterviewWorkspaceId(prefix, seed)
}

function normalizeOptionalEntityId(value) {
  if (value === undefined || value === null || value === '') return null
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  return isSafeId(normalized) ? normalized : null
}

function normalizeEnum(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function normalizeInteger(value, minimum, maximum, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function normalizeTimestamp(value, field, fallback, options = {}) {
  if (value === undefined || value === null || value === '') {
    return options.optional ? null : fallback
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    invalid('INTERVIEW_WORKSPACE_TIMESTAMP_INVALID', `${field} must be an ISO timestamp.`, field)
  }
  return new Date(value).toISOString()
}

function boundedArray(value, field, maximum, options) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    invalid('INTERVIEW_WORKSPACE_INVALID', `${field} must be an array.`, field)
  }
  if (value.length > maximum && !options.truncateCollections) {
    invalid('INTERVIEW_WORKSPACE_LIMIT_EXCEEDED', `${field} exceeds its ${maximum} item limit.`, field)
  }
  return value.slice(0, maximum)
}

function cleanStringList(value, field, maximumItems, maximumLength, options) {
  const seen = new Set()
  const output = []
  boundedArray(value, field, maximumItems, options).forEach((entry, index) => {
    const text = cleanText(entry, {
      field: `${field}[${index}]`,
      maximum: maximumLength,
    })
    const key = text.toLocaleLowerCase('en')
    if (text && !seen.has(key)) {
      seen.add(key)
      output.push(text)
    }
  })
  return output
}

function referenceError(options, code, message, field) {
  if (options.dropInvalidReferences) return false
  invalid(code, message, field)
}

function mappedReference(value, aliases) {
  const raw = typeof value === 'string' ? value.normalize('NFKC').trim() : ''
  return aliases.get(raw) ?? (isSafeId(raw) ? raw : null)
}

function addAlias(aliases, rawId, normalizedId) {
  if (typeof rawId !== 'string') return
  const key = rawId.normalize('NFKC').trim()
  if (key && !aliases.has(key)) aliases.set(key, normalizedId)
}

function dedupeById(values) {
  const seen = new Set()
  return values.filter((value) => {
    if (seen.has(value.id)) return false
    seen.add(value.id)
    return true
  })
}

function effectiveAuthorKind(value, options, field) {
  const authorKind = normalizeEnum(value, FEEDBACK_AUTHORS, 'self')
  if (authorKind === 'teacher' && options.allowTeacherFeedback !== true) {
    invalid('INTERVIEW_WORKSPACE_TEACHER_ARTIFACT_FORBIDDEN', 'Teacher feedback requires trusted teacher authority.', field)
  }
  if (authorKind === 'ai' && options.allowAiArtifacts !== true) {
    invalid('INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN', 'AI feedback requires trusted server authority.', field)
  }
  return authorKind
}

function effectiveQuestionSource(value, options, field) {
  const source = normalizeEnum(value, QUESTION_SOURCES, 'user')
  if (source === 'teacher' && options.allowTeacherFeedback !== true) {
    invalid('INTERVIEW_WORKSPACE_TEACHER_ARTIFACT_FORBIDDEN', 'Teacher questions require trusted teacher authority.', field)
  }
  if (source === 'ai' && options.allowAiArtifacts !== true) {
    invalid('INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN', 'AI questions require trusted server authority.', field)
  }
  return source
}

function feedbackAuthorName(rawName, authorKind, options, field) {
  const optionKey = authorKind === 'teacher'
    ? 'teacherAuthorName'
    : authorKind === 'ai'
      ? 'aiAuthorName'
      : 'selfAuthorName'
  const value = hasOwn(options, optionKey) ? options[optionKey] : rawName
  const normalized = cleanText(value, { field, maximum: 240, multiline: false })
  return normalized || undefined
}

function normalizeWorkspaceOptions(input) {
  const options = input && typeof input === 'object' ? input : {}
  const now = normalizeTimestamp(options.now, 'options.now', new Date().toISOString())
  return { ...options, now }
}

export function normalizeInterviewPrepWorkspace(value, inputOptions = {}) {
  const options = normalizeWorkspaceOptions(inputOptions)
  const raw = record(value, 'workspace')
  const subjectUserId = normalizeAuthorityId(
    options.subjectUserId ?? raw.subjectUserId,
    'workspace.subjectUserId',
  )
  const ownerUserId = normalizeAuthorityId(
    options.ownerUserId ?? subjectUserId,
    'options.ownerUserId',
  )
  const createdByUserId = normalizeAuthorityId(
    options.createdByUserId ?? subjectUserId,
    'options.createdByUserId',
  )
  const teamId = hasOwn(options, 'teamId')
    ? normalizeAuthorityId(options.teamId, 'options.teamId', { optional: true })
    : null
  const subjectName = cleanText(
    hasOwn(options, 'subjectName') ? options.subjectName : raw.subjectName,
    { field: 'workspace.subjectName', maximum: INTERVIEW_WORKSPACE_LIMITS.subjectName, multiline: false },
  )
  const updatedAt = normalizeTimestamp(raw.updatedAt, 'workspace.updatedAt', options.now)

  const interviewAliases = new Map()
  const interviews = dedupeById(boundedArray(
    raw.interviews,
    'workspace.interviews',
    INTERVIEW_WORKSPACE_LIMITS.interviews,
    options,
  ).map((entry, index) => {
    const item = record(entry, `workspace.interviews[${index}]`)
    const id = normalizeEntityId(item.id, 'interview', {
      subjectUserId,
      index,
      title: item.title,
      scheduledAt: item.scheduledAt,
    })
    addAlias(interviewAliases, item.id, id)
    const createdAt = normalizeTimestamp(item.createdAt, `workspace.interviews[${index}].createdAt`, options.now)
    return {
      id,
      ownerUserId,
      teamId,
      applicationId: normalizeOptionalEntityId(item.applicationId),
      sourceCommunicationId: normalizeOptionalEntityId(item.sourceCommunicationId),
      createdByUserId,
      title: cleanText(item.title, { field: `workspace.interviews[${index}].title`, maximum: INTERVIEW_WORKSPACE_LIMITS.title, multiline: false }),
      school: cleanText(item.school, { field: `workspace.interviews[${index}].school`, maximum: INTERVIEW_WORKSPACE_LIMITS.institution, multiline: false }),
      program: cleanText(item.program, { field: `workspace.interviews[${index}].program`, maximum: INTERVIEW_WORKSPACE_LIMITS.programme, multiline: false }),
      advisor: cleanText(item.advisor, { field: `workspace.interviews[${index}].advisor`, maximum: INTERVIEW_WORKSPACE_LIMITS.advisor, multiline: false }),
      format: normalizeEnum(item.format, INTERVIEW_FORMATS, 'video'),
      scheduledAt: normalizeTimestamp(item.scheduledAt, `workspace.interviews[${index}].scheduledAt`, null, { optional: true }),
      timezone: cleanText(item.timezone ?? 'UTC', { field: `workspace.interviews[${index}].timezone`, maximum: INTERVIEW_WORKSPACE_LIMITS.timezone, multiline: false }) || 'UTC',
      durationMinutes: normalizeInteger(item.durationMinutes, 5, 480, 30),
      participantNames: cleanStringList(
        item.participantNames,
        `workspace.interviews[${index}].participantNames`,
        INTERVIEW_WORKSPACE_LIMITS.participantNames,
        INTERVIEW_WORKSPACE_LIMITS.participantName,
        options,
      ),
      status: normalizeEnum(item.status, INTERVIEW_STATUSES, 'preparing'),
      preparationNotes: cleanText(item.preparationNotes, { field: `workspace.interviews[${index}].preparationNotes`, maximum: INTERVIEW_WORKSPACE_LIMITS.preparationNotes }),
      talkingPoints: cleanText(item.talkingPoints, { field: `workspace.interviews[${index}].talkingPoints`, maximum: INTERVIEW_WORKSPACE_LIMITS.talkingPoints }),
      createdAt,
      updatedAt: normalizeTimestamp(item.updatedAt, `workspace.interviews[${index}].updatedAt`, createdAt),
    }
  }))
  interviews.sort((left, right) => {
    if (left.status === 'completed' && right.status !== 'completed') return 1
    if (right.status === 'completed' && left.status !== 'completed') return -1
    const leftTime = left.scheduledAt ? Date.parse(left.scheduledAt) : Number.POSITIVE_INFINITY
    const rightTime = right.scheduledAt ? Date.parse(right.scheduledAt) : Number.POSITIVE_INFINITY
    return leftTime - rightTime || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  })
  const interviewById = new Map(interviews.map((entry) => [entry.id, entry]))

  const questionAliases = new Map()
  const questions = dedupeById(boundedArray(
    raw.questions,
    'workspace.questions',
    INTERVIEW_WORKSPACE_LIMITS.questions,
    options,
  ).flatMap((entry, index) => {
    const item = record(entry, `workspace.questions[${index}]`)
    const interviewId = mappedReference(item.interviewId, interviewAliases)
    if (!interviewId || !interviewById.has(interviewId)) {
      referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Question references an unknown interview.', `workspace.questions[${index}].interviewId`)
      return []
    }
    const id = normalizeEntityId(item.id, 'question', {
      interviewId,
      index,
      prompt: item.prompt,
    })
    addAlias(questionAliases, item.id, id)
    const createdAt = normalizeTimestamp(item.createdAt, `workspace.questions[${index}].createdAt`, options.now)
    return [{
      id,
      interviewId,
      category: normalizeEnum(item.category, INTERVIEW_WORKSPACE_QUESTION_CATEGORIES, 'research'),
      prompt: cleanText(item.prompt, { field: `workspace.questions[${index}].prompt`, maximum: INTERVIEW_WORKSPACE_LIMITS.questionPrompt }),
      source: effectiveQuestionSource(item.source, options, `workspace.questions[${index}].source`),
      createdByUserId,
      order: normalizeInteger(item.order, 0, 1_000_000, index),
      notes: cleanText(item.notes, { field: `workspace.questions[${index}].notes`, maximum: INTERVIEW_WORKSPACE_LIMITS.questionNotes }),
      createdAt,
      updatedAt: normalizeTimestamp(item.updatedAt, `workspace.questions[${index}].updatedAt`, createdAt),
    }]
  }))
  questions.sort((left, right) => left.interviewId.localeCompare(right.interviewId)
    || left.order - right.order
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id))
  const questionById = new Map(questions.map((entry) => [entry.id, entry]))

  let totalAnswers = 0
  const sessionAliases = new Map()
  const mockSessions = dedupeById(boundedArray(
    raw.mockSessions,
    'workspace.mockSessions',
    INTERVIEW_WORKSPACE_LIMITS.mockSessions,
    options,
  ).flatMap((entry, index) => {
    const item = record(entry, `workspace.mockSessions[${index}]`)
    const interviewId = mappedReference(item.interviewId, interviewAliases)
    if (!interviewId || !interviewById.has(interviewId)) {
      referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Mock session references an unknown interview.', `workspace.mockSessions[${index}].interviewId`)
      return []
    }
    const id = normalizeEntityId(item.id, 'mock', { interviewId, index, startedAt: item.startedAt })
    addAlias(sessionAliases, item.id, id)
    const questionIds = []
    const questionIdSet = new Set()
    boundedArray(
      item.questionIds,
      `workspace.mockSessions[${index}].questionIds`,
      INTERVIEW_WORKSPACE_LIMITS.questionIdsPerSession,
      options,
    ).forEach((reference, referenceIndex) => {
      const questionId = mappedReference(reference, questionAliases)
      const question = questionId ? questionById.get(questionId) : null
      if (!question || question.interviewId !== interviewId) {
        referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Mock session question belongs to another or unknown interview.', `workspace.mockSessions[${index}].questionIds[${referenceIndex}]`)
        return
      }
      if (!questionIdSet.has(questionId)) {
        questionIdSet.add(questionId)
        questionIds.push(questionId)
      }
    })
    const answers = []
    const answeredQuestions = new Set()
    boundedArray(
      item.answers,
      `workspace.mockSessions[${index}].answers`,
      INTERVIEW_WORKSPACE_LIMITS.answersPerSession,
      options,
    ).forEach((answerValue, answerIndex) => {
      const answer = record(answerValue, `workspace.mockSessions[${index}].answers[${answerIndex}]`)
      const questionId = mappedReference(answer.questionId, questionAliases)
      if (!questionId || !questionIdSet.has(questionId)) {
        referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Mock answer references a question outside its session.', `workspace.mockSessions[${index}].answers[${answerIndex}].questionId`)
        return
      }
      if (answeredQuestions.has(questionId)) return
      answeredQuestions.add(questionId)
      totalAnswers += 1
      if (totalAnswers > INTERVIEW_WORKSPACE_LIMITS.answers) {
        invalid('INTERVIEW_WORKSPACE_LIMIT_EXCEEDED', `workspace answers exceed their ${INTERVIEW_WORKSPACE_LIMITS.answers} item limit.`, 'workspace.mockSessions.answers')
      }
      answers.push({
        questionId,
        body: cleanText(answer.body, { field: `workspace.mockSessions[${index}].answers[${answerIndex}].body`, maximum: INTERVIEW_WORKSPACE_LIMITS.answerBody }),
        confidence: answer.confidence === null || answer.confidence === undefined
          ? null
          : normalizeInteger(answer.confidence, 1, 5, 3),
        updatedAt: normalizeTimestamp(answer.updatedAt, `workspace.mockSessions[${index}].answers[${answerIndex}].updatedAt`, options.now),
      })
    })
    const startedAt = normalizeTimestamp(item.startedAt, `workspace.mockSessions[${index}].startedAt`, options.now)
    const currentQuestionId = mappedReference(item.currentQuestionId, questionAliases)
    return [{
      id,
      interviewId,
      ownerUserId,
      mode: normalizeEnum(item.mode, MOCK_MODES, 'self'),
      status: item.status === 'completed' ? 'completed' : 'in-progress',
      questionIds,
      currentQuestionId: currentQuestionId && questionIdSet.has(currentQuestionId)
        ? currentQuestionId
        : questionIds[0] ?? null,
      answers,
      startedAt,
      completedAt: normalizeTimestamp(item.completedAt, `workspace.mockSessions[${index}].completedAt`, null, { optional: true }),
      updatedAt: normalizeTimestamp(item.updatedAt, `workspace.mockSessions[${index}].updatedAt`, startedAt),
    }]
  }))
  mockSessions.sort((left, right) => left.interviewId.localeCompare(right.interviewId)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id))
  const sessionById = new Map(mockSessions.map((entry) => [entry.id, entry]))

  const feedback = dedupeById(boundedArray(
    raw.feedback,
    'workspace.feedback',
    INTERVIEW_WORKSPACE_LIMITS.feedback,
    options,
  ).flatMap((entry, index) => {
    const item = record(entry, `workspace.feedback[${index}]`)
    const interviewId = mappedReference(item.interviewId, interviewAliases)
    if (!interviewId || !interviewById.has(interviewId)) {
      referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Feedback references an unknown interview.', `workspace.feedback[${index}].interviewId`)
      return []
    }
    const questionId = mappedReference(item.questionId, questionAliases)
    const sessionId = mappedReference(item.sessionId, sessionAliases)
    const question = questionId ? questionById.get(questionId) : null
    const session = sessionId ? sessionById.get(sessionId) : null
    if (item.questionId && (!question || question.interviewId !== interviewId)) {
      referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Feedback question belongs to another or unknown interview.', `workspace.feedback[${index}].questionId`)
      return []
    }
    if (item.sessionId && (!session || session.interviewId !== interviewId)) {
      referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Feedback session belongs to another or unknown interview.', `workspace.feedback[${index}].sessionId`)
      return []
    }
    if (questionId && session && !session.questionIds.includes(questionId)) {
      referenceError(options, 'INTERVIEW_WORKSPACE_REFERENCE_INVALID', 'Feedback question is not part of its referenced mock session.', `workspace.feedback[${index}].questionId`)
      return []
    }
    const authorKind = effectiveAuthorKind(item.authorKind, options, `workspace.feedback[${index}].authorKind`)
    const id = normalizeEntityId(item.id, 'feedback', { interviewId, sessionId, questionId, index })
    const createdAt = normalizeTimestamp(item.createdAt, `workspace.feedback[${index}].createdAt`, options.now)
    return [{
      id,
      interviewId,
      sessionId,
      questionId,
      authorKind,
      authorName: feedbackAuthorName(item.authorName, authorKind, options, `workspace.feedback[${index}].authorName`),
      body: cleanText(item.body, { field: `workspace.feedback[${index}].body`, maximum: INTERVIEW_WORKSPACE_LIMITS.feedbackBody }),
      strengths: cleanStringList(
        item.strengths,
        `workspace.feedback[${index}].strengths`,
        INTERVIEW_WORKSPACE_LIMITS.feedbackListItems,
        INTERVIEW_WORKSPACE_LIMITS.feedbackListItem,
        options,
      ),
      improvements: cleanStringList(
        item.improvements,
        `workspace.feedback[${index}].improvements`,
        INTERVIEW_WORKSPACE_LIMITS.feedbackListItems,
        INTERVIEW_WORKSPACE_LIMITS.feedbackListItem,
        options,
      ),
      score: item.score === null || item.score === undefined
        ? null
        : normalizeInteger(item.score, 1, 5, 3),
      createdAt,
      updatedAt: normalizeTimestamp(item.updatedAt, `workspace.feedback[${index}].updatedAt`, createdAt),
    }]
  }))
  feedback.sort((left, right) => left.interviewId.localeCompare(right.interviewId)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id))

  return {
    subjectUserId,
    subjectName,
    revision: normalizeInteger(raw.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    interviews,
    questions,
    mockSessions,
    feedback,
    updatedAt,
  }
}

export const normalizeInterviewWorkspace = normalizeInterviewPrepWorkspace

export function validateInterviewPrepWorkspace(value, options = {}) {
  return normalizeInterviewPrepWorkspace(value, {
    ...options,
    dropInvalidReferences: false,
    truncateCollections: false,
  })
}

export const validateInterviewWorkspace = validateInterviewPrepWorkspace

export function assertInterviewWorkspaceRevision(expectedRevision, currentRevision, context = {}) {
  const expected = normalizeInteger(expectedRevision, 0, Number.MAX_SAFE_INTEGER, -1)
  const current = normalizeInteger(currentRevision, 0, Number.MAX_SAFE_INTEGER, -2)
  if (expected !== current) {
    throw new InterviewWorkspaceRevisionConflictError(expectedRevision, currentRevision, context)
  }
  return current
}

export const assertInterviewPrepWorkspaceRevision = assertInterviewWorkspaceRevision

function omitMutableAuditFields(value) {
  if (Array.isArray(value)) return value.map(omitMutableAuditFields)
  if (!value || typeof value !== 'object') return value
  const output = {}
  Object.entries(value).forEach(([key, entry]) => {
    if (key !== 'revision' && key !== 'updatedAt') output[key] = omitMutableAuditFields(entry)
  })
  return output
}

export function createInterviewWorkspaceFingerprint(value, options = {}) {
  const workspace = normalizeInterviewPrepWorkspace(value, {
    allowAiArtifacts: true,
    allowTeacherFeedback: true,
    ...options,
    now: options.now ?? EPOCH,
  })
  return createHash('sha256')
    .update(stableInterviewWorkspaceJson(omitMutableAuditFields(workspace)))
    .digest('hex')
}

export const interviewWorkspaceFingerprint = createInterviewWorkspaceFingerprint
export const createInterviewPrepWorkspaceFingerprint = createInterviewWorkspaceFingerprint

function artifactRecord(value, artifactType) {
  const artifact = record(value, 'artifact')
  if (artifact.artifactType !== artifactType) {
    invalid('INTERVIEW_WORKSPACE_ARTIFACT_INVALID', `Expected ${artifactType} artifact.`, 'artifact.artifactType')
  }
  return artifact
}

function artifactFingerprint(artifact) {
  const value = typeof artifact.artifactFingerprint === 'string'
    ? artifact.artifactFingerprint.toLowerCase()
    : ''
  return /^[a-f0-9]{64}$/u.test(value)
    ? value
    : createHash('sha256').update(stableInterviewWorkspaceJson({
      artifactType: artifact.artifactType,
      inputFingerprint: artifact.inputFingerprint,
      questions: Array.isArray(artifact.questions)
        ? artifact.questions.map((entry) => ({
            clientId: entry?.clientId,
            category: entry?.category,
            question: entry?.question,
            evidenceRefs: entry?.evidenceRefs,
          }))
        : null,
      evaluation: artifact.evaluation && typeof artifact.evaluation === 'object'
        ? {
            overallScore: artifact.evaluation.overallScore,
            summary: artifact.evaluation.summary,
            strengths: artifact.evaluation.strengths,
            improvements: artifact.evaluation.improvements,
            rubric: Array.isArray(artifact.evaluation.rubric)
              ? artifact.evaluation.rubric.map((entry) => ({
                  criterion: entry?.criterion,
                  score: entry?.score,
                  evidenceRefs: entry?.evidenceRefs,
                }))
              : null,
          }
        : null,
    })).digest('hex')
}

function safeEvidenceRefs(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.slice(0, INTERVIEW_WORKSPACE_LIMITS.evidenceRefs).flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const normalized = entry.normalize('NFKC').trim()
    if (!isSafeId(normalized) || seen.has(normalized)) return []
    seen.add(normalized)
    return [normalized]
  })
}

export function mapInterviewQuestionBankArtifactToQuestions(value, options = {}) {
  if (options.allowAiArtifacts !== true) {
    invalid('INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN', 'AI artifacts require trusted server authority.', 'options.allowAiArtifacts')
  }
  const artifact = artifactRecord(value, 'question_bank')
  const interviewId = normalizeAuthorityId(options.interviewId, 'options.interviewId')
  const createdByUserId = normalizeAuthorityId(options.createdByUserId, 'options.createdByUserId')
  const timestamp = normalizeTimestamp(options.now, 'options.now', new Date().toISOString())
  const fingerprint = artifactFingerprint(artifact)
  const questions = boundedArray(artifact.questions, 'artifact.questions', 100, options)
  const seenPrompts = new Set()
  return questions.flatMap((entry, index) => {
    const question = record(entry, `artifact.questions[${index}]`)
    const prompt = cleanText(question.question, {
      field: `artifact.questions[${index}].question`,
      maximum: INTERVIEW_WORKSPACE_LIMITS.questionPrompt,
      required: true,
    })
    const dedupeKey = prompt.toLocaleLowerCase('en')
    if (seenPrompts.has(dedupeKey)) return []
    seenPrompts.add(dedupeKey)
    const category = INTERVIEW_WORKSPACE_CATEGORY_MAP[question.category] ?? 'closing'
    const evidenceRefs = safeEvidenceRefs(question.evidenceRefs)
    const id = createStableInterviewWorkspaceId('question', {
      fingerprint,
      interviewId,
      clientId: question.clientId,
      category,
      prompt,
    })
    return [{
      id,
      interviewId,
      category,
      prompt,
      source: 'ai',
      createdByUserId,
      order: normalizeInteger(options.startOrder, 0, 1_000_000, 0) + index,
      notes: evidenceRefs.map((reference) => `• ${reference}`).join('\n'),
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
  })
}

export const mapQuestionBankArtifactToInterviewQuestions = mapInterviewQuestionBankArtifactToQuestions

export function mapInterviewMockEvaluationArtifactToFeedback(value, options = {}) {
  if (options.allowAiArtifacts !== true) {
    invalid('INTERVIEW_WORKSPACE_AI_ARTIFACT_FORBIDDEN', 'AI artifacts require trusted server authority.', 'options.allowAiArtifacts')
  }
  const artifact = artifactRecord(value, 'mock_evaluation')
  const evaluation = record(artifact.evaluation, 'artifact.evaluation')
  const interviewId = normalizeAuthorityId(options.interviewId, 'options.interviewId')
  const sessionId = normalizeAuthorityId(options.sessionId, 'options.sessionId', { optional: true })
  const questionId = normalizeAuthorityId(options.questionId, 'options.questionId', { optional: true })
  const timestamp = normalizeTimestamp(options.now, 'options.now', new Date().toISOString())
  const fingerprint = artifactFingerprint(artifact)
  const summary = cleanText(evaluation.summary, {
    field: 'artifact.evaluation.summary',
    maximum: 2_000,
    required: true,
  })
  const evidenceRefs = boundedArray(evaluation.rubric, 'artifact.evaluation.rubric', 20, options)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      return safeEvidenceRefs(entry.evidenceRefs)
    })
    .filter((entry, index, values) => values.indexOf(entry) === index)
    .slice(0, INTERVIEW_WORKSPACE_LIMITS.evidenceRefs)
  const body = cleanText([
    summary,
    evidenceRefs.length ? evidenceRefs.map((reference) => `• ${reference}`).join('\n') : '',
  ].filter(Boolean).join('\n\n'), {
    field: 'feedback.body',
    maximum: INTERVIEW_WORKSPACE_LIMITS.feedbackBody,
  })
  const score100 = typeof evaluation.overallScore === 'number' && Number.isFinite(evaluation.overallScore)
    ? evaluation.overallScore
    : null
  return [{
    id: createStableInterviewWorkspaceId('feedback', {
      fingerprint,
      interviewId,
      sessionId,
      questionId,
    }),
    interviewId,
    sessionId,
    questionId,
    authorKind: 'ai',
    authorName: cleanText(options.aiAuthorName, {
      field: 'options.aiAuthorName',
      maximum: 240,
      multiline: false,
    }) || undefined,
    body,
    strengths: cleanStringList(
      evaluation.strengths,
      'artifact.evaluation.strengths',
      INTERVIEW_WORKSPACE_LIMITS.feedbackListItems,
      INTERVIEW_WORKSPACE_LIMITS.feedbackListItem,
      options,
    ),
    improvements: cleanStringList(
      evaluation.improvements,
      'artifact.evaluation.improvements',
      INTERVIEW_WORKSPACE_LIMITS.feedbackListItems,
      INTERVIEW_WORKSPACE_LIMITS.feedbackListItem,
      options,
    ),
    score: score100 === null ? null : Math.min(5, Math.max(1, Math.round(score100 / 20))),
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
}

export const mapMockEvaluationArtifactToInterviewFeedback = mapInterviewMockEvaluationArtifactToFeedback
