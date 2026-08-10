import { createHash } from 'node:crypto'

export const INTERVIEW_PREP_SCHEMA_VERSION = 1

export const INTERVIEW_MODEL_LIMITS = Object.freeze({
  id: 128,
  title: 180,
  description: 4_000,
  question: 6_000,
  answer: 24_000,
  notes: 12_000,
  turnContent: 18_000,
  feedback: 8_000,
  evaluationSummary: 6_000,
  preview: 280,
  url: 2_048,
  tags: 24,
  evidenceLinks: 24,
  teacherFeedback: 80,
  plannedItems: 200,
  evaluationDimensions: 20,
  evaluationListItems: 20,
  turns: 500,
  pageSize: 50,
})

export const INTERVIEW_QUESTION_CATEGORIES = Object.freeze([
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

export const INTERVIEW_ITEM_KINDS = Object.freeze([
  'question',
  'research_note',
  'story',
  'resource',
  'checklist',
])

export const INTERVIEW_SESSION_MODES = Object.freeze([
  'solo',
  'ai_mock',
  'teacher_mock',
  'live_practice',
])

export const INTERVIEW_SESSION_STATUSES = Object.freeze([
  'draft',
  'ready',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
])

export const INTERVIEW_TURN_SPEAKERS = Object.freeze([
  'interviewer',
  'candidate',
  'coach',
  'system',
])

export const INTERVIEW_TURN_TYPES = Object.freeze([
  'question',
  'answer',
  'feedback',
  'note',
])

const REPOSITORY_STATUSES = ['active', 'archived']
const ANSWER_STATUSES = ['draft', 'ready', 'practiced']
const DIFFICULTIES = ['unspecified', 'easy', 'medium', 'hard']
const EVIDENCE_SOURCE_TYPES = ['publication', 'project', 'experience', 'programme', 'web', 'other']
const MODEL_OPERATIONS = [
  'question_generation',
  'answer_review',
  'mock_interview',
  'evaluation',
  'coach_feedback',
  'other',
]
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,127}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069]/gu
const DANGEROUS_HTML_BLOCK_PATTERN = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/giu
const HTML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/gu
const SECRET_TOKEN_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/gu
const NAMED_SECRET_PATTERN = /(\b(?:api[_ -]?key|access[_ -]?token|secret|authorization)\b\s*[:=]\s*)[^\s,;]+/giu
const BEARER_TOKEN_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}/giu
const SECRET_QUERY_PARAMETER_PATTERN = /^(?:api[_-]?key|access[_-]?token|auth|authorization|key|secret|token)$/iu

export class InterviewModelValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'InterviewModelValidationError'
    this.status = 400
    this.code = 'INTERVIEW_MODEL_INVALID'
    this.field = field
  }
}

export class InterviewRevisionConflictError extends Error {
  constructor(entityType, entityId, expectedRevision, currentRevision) {
    super('The ' + entityType + ' changed while this request was being processed.')
    this.name = 'InterviewRevisionConflictError'
    this.status = 409
    this.code = 'INTERVIEW_REVISION_CONFLICT'
    this.entityType = entityType
    this.entityId = entityId
    this.expectedRevision = expectedRevision
    this.currentRevision = currentRevision
  }
}

export class InterviewIdempotencyConflictError extends Error {
  constructor(entityType, entityId, idempotencyKey) {
    super('The idempotency key has already been used for different ' + entityType + ' content.')
    this.name = 'InterviewIdempotencyConflictError'
    this.status = 409
    this.code = 'INTERVIEW_IDEMPOTENCY_CONFLICT'
    this.entityType = entityType
    this.entityId = entityId
    this.idempotencyKey = idempotencyKey
  }
}

function invalid(field, message) {
  throw new InterviewModelValidationError(field, message)
}

function record(value, field) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    invalid(field, field + ' must be an object.')
  }
  return value
}

function truncateCodePoints(value, maximum) {
  const points = Array.from(value)
  return points.length > maximum ? points.slice(0, maximum).join('') : value
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

function redactSecrets(value) {
  return value
    .replace(SECRET_TOKEN_PATTERN, '[REDACTED]')
    .replace(NAMED_SECRET_PATTERN, '$1[REDACTED]')
    .replace(BEARER_TOKEN_PATTERN, '$1[REDACTED]')
}

function normalizeText(value, options) {
  const {
    field,
    maximum,
    required = false,
    multiline = true,
    fallback = '',
  } = options
  if (value === undefined || value === null) value = fallback
  if (typeof value !== 'string' && typeof value !== 'number') {
    invalid(field, field + ' must be text.')
  }
  let normalized = removeUnsafeControlCharacters(String(value))
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(BIDI_CONTROL_PATTERN, '')
    .replace(DANGEROUS_HTML_BLOCK_PATTERN, '')
    .replace(HTML_TAG_PATTERN, '')
  normalized = redactSecrets(normalized)
  normalized = multiline
    ? normalized.replace(/[ \t]+\n/gu, '\n').trim()
    : normalized.replace(/\s+/gu, ' ').trim()
  normalized = truncateCodePoints(normalized, maximum)
  if (required && !normalized) invalid(field, field + ' is required.')
  return normalized
}

function normalizeEnum(value, allowed, field, fallback) {
  const normalized = normalizeText(value, {
    field,
    maximum: 64,
    multiline: false,
    fallback,
  }).toLowerCase()
  if (!allowed.includes(normalized)) {
    invalid(field, field + ' must be one of: ' + allowed.join(', ') + '.')
  }
  return normalized
}

function normalizeInteger(value, options) {
  const { field, minimum, maximum, fallback = null, nullable = false } = options
  if (value === undefined || value === null || value === '') {
    if (nullable) return null
    value = fallback
  }
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    invalid(field, field + ' must be an integer between ' + minimum + ' and ' + maximum + '.')
  }
  return normalized
}

function normalizeScore(value, field) {
  if (value === undefined || value === null || value === '') return null
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    invalid(field, field + ' must be between 0 and 100.')
  }
  return Math.round(normalized * 10) / 10
}

function normalizeTimestamp(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  const timestamp = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(timestamp.getTime())) invalid(field, field + ' must be a valid timestamp.')
  return timestamp.toISOString()
}

function currentTimestamp(options) {
  return normalizeTimestamp(options.now ?? new Date(), 'now')
}

function normalizeArray(value, field, maximum) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) invalid(field, field + ' must be an array.')
  if (value.length > maximum) {
    invalid(field, field + ' cannot contain more than ' + maximum + ' entries.')
  }
  return value
}

function normalizeId(value, field, options = {}) {
  const { required = true, maximum = INTERVIEW_MODEL_LIMITS.id } = options
  if (value === undefined || value === null || value === '') {
    if (required) invalid(field, field + ' is required.')
    return null
  }
  const normalized = String(value).normalize('NFKC').trim()
  if (
    !normalized
    || Array.from(normalized).length > maximum
    || !ENTITY_ID_PATTERN.test(normalized)
  ) {
    invalid(field, field + ' is not a valid stable identifier.')
  }
  return normalized
}

function normalizeOptionalId(value, field) {
  return normalizeId(value, field, { required: false })
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, seen))
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) invalid('content', 'Content cannot contain circular references.')
  seen.add(value)
  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) normalized[key] = canonicalize(value[key], seen)
  }
  seen.delete(value)
  return normalized
}

export function stableCanonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function interviewContentFingerprint(value) {
  return createHash('sha256').update(stableCanonicalJson(value)).digest('hex')
}

export const contentFingerprint = interviewContentFingerprint

export function createStableInterviewClientId(scope, seed) {
  const normalizedScope = normalizeText(scope, {
    field: 'scope',
    maximum: 24,
    required: true,
    multiline: false,
  }).toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  if (!normalizedScope) invalid('scope', 'scope must contain a letter or number.')
  if (seed === undefined || seed === null || seed === '') invalid('seed', 'seed is required.')
  return 'iv_' + normalizedScope + '_' + interviewContentFingerprint(seed).slice(0, 24)
}

export function normalizeInterviewClientId(value, options = {}) {
  const {
    field = 'clientId',
    scope = 'client',
    seed,
  } = options
  if (value !== undefined && value !== null && value !== '') return normalizeId(value, field)
  if (seed === undefined) invalid(field, field + ' or a stable seed is required.')
  return createStableInterviewClientId(scope, seed)
}

export function normalizeInterviewIdempotencyKey(value, options = {}) {
  const {
    field = 'idempotencyKey',
    scope = 'request',
    seed,
  } = options
  let normalized = value
  if (normalized === undefined || normalized === null || normalized === '') {
    if (seed === undefined) invalid(field, field + ' or a stable seed is required.')
    normalized = createStableInterviewClientId(scope, seed)
  }
  normalized = String(normalized).normalize('NFKC').trim()
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    invalid(field, field + ' must be 8-128 safe identifier characters.')
  }
  return normalized
}

export function assertInterviewRevision(expectedRevision, currentRevision, context = {}) {
  const expected = normalizeInteger(expectedRevision, {
    field: 'expectedRevision',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  const current = normalizeInteger(currentRevision, {
    field: 'currentRevision',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  if (expected !== current) {
    throw new InterviewRevisionConflictError(
      context.entityType ?? 'interview entity',
      context.entityId ?? null,
      expected,
      current,
    )
  }
  return current
}

function normalizeFingerprint(value, field) {
  if (value === undefined || value === null || value === '') return null
  const normalized = String(value).trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) invalid(field, field + ' must be a SHA-256 fingerprint.')
  return normalized
}

function normalizeStringList(value, field, maximumEntries, maximumLength) {
  const seen = new Set()
  const result = []
  for (const [index, entry] of normalizeArray(value, field, maximumEntries).entries()) {
    const normalized = normalizeText(entry, {
      field: field + '[' + index + ']',
      maximum: maximumLength,
      required: true,
      multiline: false,
    })
    const dedupeKey = normalized.toLocaleLowerCase('en')
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      result.push(normalized)
    }
  }
  return result
}

function normalizeIdList(value, field, maximumEntries) {
  const seen = new Set()
  const result = []
  for (const [index, entry] of normalizeArray(value, field, maximumEntries).entries()) {
    const normalized = normalizeId(entry, field + '[' + index + ']')
    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

function normalizeUrl(value, field) {
  const raw = normalizeText(value, {
    field,
    maximum: INTERVIEW_MODEL_LIMITS.url,
    required: true,
    multiline: false,
  })
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    invalid(field, field + ' must be an absolute HTTP(S) URL.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    invalid(field, field + ' must be an HTTP(S) URL without embedded credentials.')
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (SECRET_QUERY_PARAMETER_PATTERN.test(key)) parsed.searchParams.delete(key)
  }
  return truncateCodePoints(parsed.toString(), INTERVIEW_MODEL_LIMITS.url)
}

export function normalizeInterviewModelMetadata(value, options = {}) {
  if (value === undefined || value === null) return null
  const raw = record(value, options.field ?? 'modelMetadata')
  const field = options.field ?? 'modelMetadata'
  const model = normalizeText(raw.model, {
    field: field + '.model',
    maximum: 128,
    required: true,
    multiline: false,
  })
  const provider = normalizeText(raw.provider, {
    field: field + '.provider',
    maximum: 64,
    multiline: false,
    fallback: 'unknown',
  })
  const operation = normalizeEnum(
    raw.operation,
    MODEL_OPERATIONS,
    field + '.operation',
    'other',
  )
  const tokenUsageRaw = record(raw.tokenUsage, field + '.tokenUsage')
  const promptTokens = normalizeInteger(tokenUsageRaw.prompt, {
    field: field + '.tokenUsage.prompt',
    minimum: 0,
    maximum: 10_000_000,
    fallback: 0,
  })
  const completionTokens = normalizeInteger(tokenUsageRaw.completion, {
    field: field + '.tokenUsage.completion',
    minimum: 0,
    maximum: 10_000_000,
    fallback: 0,
  })
  return {
    provider,
    model,
    operation,
    promptTemplateId: normalizeText(raw.promptTemplateId ?? raw.prompt?.templateId, {
      field: field + '.promptTemplateId',
      maximum: 128,
      multiline: false,
    }),
    promptVersion: normalizeText(raw.promptVersion ?? raw.prompt?.version, {
      field: field + '.promptVersion',
      maximum: 64,
      multiline: false,
    }),
    promptFingerprint: normalizeFingerprint(
      raw.promptFingerprint ?? raw.prompt?.fingerprint,
      field + '.promptFingerprint',
    ),
    inputFingerprint: normalizeFingerprint(raw.inputFingerprint, field + '.inputFingerprint'),
    outputFingerprint: normalizeFingerprint(raw.outputFingerprint, field + '.outputFingerprint'),
    requestId: normalizeOptionalId(raw.requestId, field + '.requestId'),
    generatedAt: normalizeTimestamp(raw.generatedAt, field + '.generatedAt', null),
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: Math.min(20_000_000, promptTokens + completionTokens),
    },
  }
}

export function normalizeInterviewEvidenceLink(value, options = {}) {
  const raw = record(value, options.field ?? 'evidenceLink')
  const field = options.field ?? 'evidenceLink'
  const url = normalizeUrl(raw.url, field + '.url')
  const label = normalizeText(raw.label, {
    field: field + '.label',
    maximum: 180,
    multiline: false,
    fallback: new URL(url).hostname,
  })
  const clientId = normalizeInterviewClientId(raw.clientId ?? raw.id, {
    field: field + '.clientId',
    scope: 'evidence',
    seed: { label, url },
  })
  return {
    id: normalizeOptionalId(options.id ?? raw.id, field + '.id')
      ?? createStableInterviewClientId('evidence', clientId),
    clientId,
    label,
    url,
    sourceType: normalizeEnum(
      raw.sourceType,
      EVIDENCE_SOURCE_TYPES,
      field + '.sourceType',
      'other',
    ),
    note: normalizeText(raw.note, {
      field: field + '.note',
      maximum: 2_000,
    }),
    addedBy: normalizeOptionalId(options.addedBy ?? raw.addedBy, field + '.addedBy'),
    addedAt: normalizeTimestamp(raw.addedAt, field + '.addedAt', options.now ?? null),
  }
}

export function normalizeInterviewTeacherFeedback(value, options = {}) {
  const raw = record(value, options.field ?? 'teacherFeedback')
  const field = options.field ?? 'teacherFeedback'
  const authorId = normalizeId(options.authorId ?? raw.authorId, field + '.authorId')
  const body = normalizeText(raw.body, {
    field: field + '.body',
    maximum: INTERVIEW_MODEL_LIMITS.feedback,
    required: true,
  })
  const createdAt = normalizeTimestamp(raw.createdAt, field + '.createdAt', options.now ?? null)
  const clientId = normalizeInterviewClientId(raw.clientId ?? raw.id, {
    field: field + '.clientId',
    scope: 'feedback',
    seed: { authorId, body, createdAt },
  })
  return {
    id: normalizeOptionalId(options.id ?? raw.id, field + '.id')
      ?? createStableInterviewClientId('feedback', clientId),
    clientId,
    authorId,
    authorName: normalizeText(raw.authorName, {
      field: field + '.authorName',
      maximum: 120,
      multiline: false,
    }),
    body,
    rating: normalizeInteger(raw.rating, {
      field: field + '.rating',
      minimum: 1,
      maximum: 5,
      nullable: true,
    }),
    createdAt,
    updatedAt: normalizeTimestamp(raw.updatedAt, field + '.updatedAt', createdAt),
  }
}

export function normalizeInterviewAnswerDraft(value, options = {}) {
  const field = options.field ?? 'answerDraft'
  const raw = typeof value === 'string' ? { content: value } : record(value, field)
  const updatedAt = normalizeTimestamp(raw.updatedAt, field + '.updatedAt', options.now ?? null)
  return {
    content: normalizeText(raw.content, {
      field: field + '.content',
      maximum: INTERVIEW_MODEL_LIMITS.answer,
    }),
    status: normalizeEnum(raw.status, ANSWER_STATUSES, field + '.status', 'draft'),
    evidenceLinkIds: normalizeIdList(
      raw.evidenceLinkIds,
      field + '.evidenceLinkIds',
      INTERVIEW_MODEL_LIMITS.evidenceLinks,
    ),
    revision: normalizeInteger(raw.revision, {
      field: field + '.revision',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      fallback: 1,
    }),
    updatedBy: normalizeOptionalId(options.updatedBy ?? raw.updatedBy, field + '.updatedBy'),
    updatedAt,
  }
}

function normalizeEvaluationDimension(value, field) {
  const raw = record(value, field)
  return {
    key: normalizeId(raw.key, field + '.key', { maximum: 64 }),
    label: normalizeText(raw.label, {
      field: field + '.label',
      maximum: 100,
      required: true,
      multiline: false,
    }),
    score: normalizeScore(raw.score, field + '.score'),
    summary: normalizeText(raw.summary, {
      field: field + '.summary',
      maximum: 1_200,
    }),
  }
}

export function normalizeInterviewEvaluation(value, options = {}) {
  if (value === undefined || value === null) return null
  const field = options.field ?? 'evaluation'
  const raw = record(value, field)
  return {
    overallScore: normalizeScore(raw.overallScore, field + '.overallScore'),
    summary: normalizeText(raw.summary, {
      field: field + '.summary',
      maximum: INTERVIEW_MODEL_LIMITS.evaluationSummary,
    }),
    dimensions: normalizeArray(
      raw.dimensions,
      field + '.dimensions',
      INTERVIEW_MODEL_LIMITS.evaluationDimensions,
    ).map((entry, index) => normalizeEvaluationDimension(entry, field + '.dimensions[' + index + ']')),
    strengths: normalizeStringList(
      raw.strengths,
      field + '.strengths',
      INTERVIEW_MODEL_LIMITS.evaluationListItems,
      1_000,
    ),
    improvements: normalizeStringList(
      raw.improvements,
      field + '.improvements',
      INTERVIEW_MODEL_LIMITS.evaluationListItems,
      1_000,
    ),
    nextSteps: normalizeStringList(
      raw.nextSteps,
      field + '.nextSteps',
      INTERVIEW_MODEL_LIMITS.evaluationListItems,
      1_000,
    ),
    rubricVersion: normalizeText(raw.rubricVersion, {
      field: field + '.rubricVersion',
      maximum: 64,
      multiline: false,
    }),
    evaluatedBy: normalizeOptionalId(options.evaluatedBy ?? raw.evaluatedBy, field + '.evaluatedBy'),
    evaluatedAt: normalizeTimestamp(raw.evaluatedAt, field + '.evaluatedAt', options.now ?? null),
    modelMetadata: normalizeInterviewModelMetadata(raw.modelMetadata, {
      field: field + '.modelMetadata',
    }),
  }
}

function normalizeRepositoryTarget(value, field) {
  const raw = record(value, field)
  return {
    institution: normalizeText(raw.institution, {
      field: field + '.institution',
      maximum: 180,
      multiline: false,
    }),
    programme: normalizeText(raw.programme, {
      field: field + '.programme',
      maximum: 180,
      multiline: false,
    }),
    degree: normalizeText(raw.degree, {
      field: field + '.degree',
      maximum: 80,
      multiline: false,
    }),
    discipline: normalizeText(raw.discipline, {
      field: field + '.discipline',
      maximum: 180,
      multiline: false,
    }),
    supervisorNames: normalizeStringList(raw.supervisorNames, field + '.supervisorNames', 20, 120),
    interviewDate: normalizeTimestamp(raw.interviewDate, field + '.interviewDate', null),
  }
}

function entityAudit(raw, options, entityType, seed, ownerRequired = false) {
  const now = currentTimestamp(options)
  const clientId = normalizeInterviewClientId(options.clientId ?? raw.clientId ?? raw.id, {
    field: 'clientId',
    scope: entityType,
    seed: options.clientSeed ?? seed,
  })
  const id = normalizeOptionalId(options.id ?? raw.id, 'id')
    ?? createStableInterviewClientId(entityType, clientId)
  const ownerId = ownerRequired
    ? normalizeId(options.ownerId ?? raw.ownerId, 'ownerId')
    : normalizeOptionalId(options.ownerId ?? raw.ownerId, 'ownerId')
  const createdBy = normalizeId(
    options.createdBy ?? raw.createdBy ?? ownerId,
    'createdBy',
  )
  const createdAt = normalizeTimestamp(raw.createdAt, 'createdAt', now)
  return {
    id,
    clientId,
    ownerId,
    revision: normalizeInteger(raw.revision, {
      field: 'revision',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      fallback: 1,
    }),
    createdBy,
    updatedBy: normalizeId(options.updatedBy ?? raw.updatedBy ?? createdBy, 'updatedBy'),
    createdAt,
    updatedAt: normalizeTimestamp(raw.updatedAt, 'updatedAt', createdAt),
  }
}

export function normalizeInterviewRepository(value, options = {}) {
  const raw = record(value, 'repository')
  const title = normalizeText(raw.title, {
    field: 'title',
    maximum: INTERVIEW_MODEL_LIMITS.title,
    required: true,
    multiline: false,
  })
  const audit = entityAudit(
    raw,
    options,
    'repository',
    {
      ownerId: options.ownerId ?? raw.ownerId,
      applicationId: options.applicationId ?? raw.applicationId,
      title,
    },
    true,
  )
  return {
    schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
    id: audit.id,
    clientId: audit.clientId,
    ownerId: audit.ownerId,
    teamId: normalizeOptionalId(options.teamId ?? raw.teamId, 'teamId'),
    applicationId: normalizeOptionalId(
      options.applicationId ?? raw.applicationId,
      'applicationId',
    ),
    title,
    description: normalizeText(raw.description, {
      field: 'description',
      maximum: INTERVIEW_MODEL_LIMITS.description,
    }),
    status: normalizeEnum(raw.status, REPOSITORY_STATUSES, 'status', 'active'),
    target: normalizeRepositoryTarget(raw.target, 'target'),
    revision: audit.revision,
    createdBy: audit.createdBy,
    updatedBy: audit.updatedBy,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  }
}

export function normalizeInterviewItem(value, options = {}) {
  const raw = record(value, 'item')
  const repositoryId = normalizeId(options.repositoryId ?? raw.repositoryId, 'repositoryId')
  const kind = normalizeEnum(raw.kind, INTERVIEW_ITEM_KINDS, 'kind', 'question')
  const question = normalizeText(raw.question, {
    field: 'question',
    maximum: INTERVIEW_MODEL_LIMITS.question,
    required: kind === 'question',
  })
  const audit = entityAudit(raw, options, 'item', {
    repositoryId,
    kind,
    question,
    title: raw.title,
  })
  const evidenceLinks = normalizeArray(
    raw.evidenceLinks,
    'evidenceLinks',
    INTERVIEW_MODEL_LIMITS.evidenceLinks,
  ).map((entry, index) => normalizeInterviewEvidenceLink(entry, {
    field: 'evidenceLinks[' + index + ']',
    now: audit.createdAt,
  }))
  const feedbackIds = new Set()
  const teacherFeedback = normalizeArray(
    raw.teacherFeedback,
    'teacherFeedback',
    INTERVIEW_MODEL_LIMITS.teacherFeedback,
  ).map((entry, index) => normalizeInterviewTeacherFeedback(entry, {
    field: 'teacherFeedback[' + index + ']',
    now: audit.createdAt,
  })).filter((entry) => {
    if (feedbackIds.has(entry.id)) invalid('teacherFeedback', 'Teacher feedback identifiers must be unique.')
    feedbackIds.add(entry.id)
    return true
  })
  return {
    schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
    id: audit.id,
    clientId: audit.clientId,
    repositoryId,
    kind,
    category: normalizeEnum(
      raw.category,
      INTERVIEW_QUESTION_CATEGORIES,
      'category',
      'custom',
    ),
    title: normalizeText(raw.title, {
      field: 'title',
      maximum: INTERVIEW_MODEL_LIMITS.title,
      multiline: false,
    }),
    question,
    answerDraft: normalizeInterviewAnswerDraft(raw.answerDraft, {
      field: 'answerDraft',
      now: audit.updatedAt,
      updatedBy: audit.updatedBy,
    }),
    notes: normalizeText(raw.notes, {
      field: 'notes',
      maximum: INTERVIEW_MODEL_LIMITS.notes,
    }),
    difficulty: normalizeEnum(raw.difficulty, DIFFICULTIES, 'difficulty', 'unspecified'),
    tags: normalizeStringList(raw.tags, 'tags', INTERVIEW_MODEL_LIMITS.tags, 80),
    evidenceLinks,
    teacherFeedback,
    modelMetadata: normalizeInterviewModelMetadata(raw.modelMetadata),
    sortOrder: normalizeInteger(raw.sortOrder, {
      field: 'sortOrder',
      minimum: 0,
      maximum: 1_000_000,
      fallback: 0,
    }),
    archived: Boolean(raw.archived),
    revision: audit.revision,
    createdBy: audit.createdBy,
    updatedBy: audit.updatedBy,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  }
}

export function normalizeInterviewDraftState(value, options = {}) {
  const raw = record(value, options.field ?? 'draftState')
  const field = options.field ?? 'draftState'
  return {
    activeItemId: normalizeOptionalId(raw.activeItemId, field + '.activeItemId'),
    pendingAnswer: normalizeText(raw.pendingAnswer, {
      field: field + '.pendingAnswer',
      maximum: INTERVIEW_MODEL_LIMITS.answer,
    }),
    privateNotes: normalizeText(raw.privateNotes, {
      field: field + '.privateNotes',
      maximum: INTERVIEW_MODEL_LIMITS.notes,
    }),
    elapsedSeconds: normalizeInteger(raw.elapsedSeconds, {
      field: field + '.elapsedSeconds',
      minimum: 0,
      maximum: 604_800,
      fallback: 0,
    }),
    lastClientEventId: normalizeOptionalId(
      raw.lastClientEventId,
      field + '.lastClientEventId',
    ),
    revision: normalizeInteger(raw.revision, {
      field: field + '.revision',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      fallback: 1,
    }),
    savedAt: normalizeTimestamp(raw.savedAt, field + '.savedAt', options.now ?? null),
  }
}

function defaultTurnType(speaker) {
  if (speaker === 'interviewer') return 'question'
  if (speaker === 'candidate') return 'answer'
  if (speaker === 'coach') return 'feedback'
  return 'note'
}

function turnSemanticContent(turn) {
  return {
    speaker: turn.speaker,
    type: turn.type,
    parentTurnId: turn.parentTurnId,
    content: turn.content,
    evidenceLinks: turn.evidenceLinks,
    evaluation: turn.evaluation,
    modelMetadata: turn.modelMetadata,
  }
}

export function normalizeInterviewTurn(value, options = {}) {
  const raw = record(value, options.field ?? 'turn')
  const field = options.field ?? 'turn'
  const sessionId = normalizeId(options.sessionId ?? raw.sessionId, field + '.sessionId')
  const speaker = normalizeEnum(
    raw.speaker,
    INTERVIEW_TURN_SPEAKERS,
    field + '.speaker',
    'candidate',
  )
  const type = normalizeEnum(
    raw.type,
    INTERVIEW_TURN_TYPES,
    field + '.type',
    defaultTurnType(speaker),
  )
  const content = normalizeText(raw.content, {
    field: field + '.content',
    maximum: INTERVIEW_MODEL_LIMITS.turnContent,
    required: true,
  })
  const clientTurnId = normalizeInterviewClientId(
    raw.clientTurnId ?? raw.clientId ?? raw.idempotencyKey ?? raw.id,
    {
      field: field + '.clientTurnId',
      scope: 'turn',
      seed: options.clientSeed,
    },
  )
  const idempotencyKey = normalizeInterviewIdempotencyKey(
    raw.idempotencyKey ?? clientTurnId,
    {
      field: field + '.idempotencyKey',
      scope: 'turn_request',
      seed: { sessionId, clientTurnId },
    },
  )
  const id = normalizeOptionalId(options.id ?? raw.id, field + '.id')
    ?? createStableInterviewClientId('turn', { sessionId, clientTurnId })
  const createdBy = normalizeId(options.createdBy ?? raw.createdBy, field + '.createdBy')
  const createdAt = normalizeTimestamp(raw.createdAt, field + '.createdAt', options.now ?? null)
  const normalized = {
    schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
    id,
    clientTurnId,
    idempotencyKey,
    sessionId,
    sequence: normalizeInteger(options.sequence ?? raw.sequence, {
      field: field + '.sequence',
      minimum: 1,
      maximum: INTERVIEW_MODEL_LIMITS.turns,
    }),
    speaker,
    type,
    parentTurnId: normalizeOptionalId(raw.parentTurnId, field + '.parentTurnId'),
    content,
    evidenceLinks: normalizeArray(
      raw.evidenceLinks,
      field + '.evidenceLinks',
      INTERVIEW_MODEL_LIMITS.evidenceLinks,
    ).map((entry, index) => normalizeInterviewEvidenceLink(entry, {
      field: field + '.evidenceLinks[' + index + ']',
      now: createdAt,
    })),
    evaluation: normalizeInterviewEvaluation(raw.evaluation, {
      field: field + '.evaluation',
    }),
    modelMetadata: normalizeInterviewModelMetadata(raw.modelMetadata, {
      field: field + '.modelMetadata',
    }),
    revision: normalizeInteger(raw.revision, {
      field: field + '.revision',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      fallback: 1,
    }),
    createdBy,
    updatedBy: normalizeId(options.updatedBy ?? raw.updatedBy ?? createdBy, field + '.updatedBy'),
    createdAt,
    updatedAt: normalizeTimestamp(raw.updatedAt, field + '.updatedAt', createdAt),
  }
  return {
    ...normalized,
    contentFingerprint: interviewContentFingerprint(turnSemanticContent(normalized)),
  }
}

function normalizeSessionTurns(value, options) {
  const turns = normalizeArray(value, 'turns', INTERVIEW_MODEL_LIMITS.turns)
    .map((entry, index) => normalizeInterviewTurn(entry, {
      field: 'turns[' + index + ']',
      sessionId: options.sessionId,
      createdBy: entry?.createdBy ?? options.createdBy,
      now: options.now,
    }))
  const byClientId = new Map()
  const byIdempotencyKey = new Map()
  const bySequence = new Map()
  const deduped = []
  for (const turn of turns) {
    const priorByClient = byClientId.get(turn.clientTurnId)
    const priorByKey = byIdempotencyKey.get(turn.idempotencyKey)
    const prior = priorByClient ?? priorByKey
    if (prior) {
      if (prior.contentFingerprint !== turn.contentFingerprint) {
        throw new InterviewIdempotencyConflictError('turn', prior.id, turn.idempotencyKey)
      }
      continue
    }
    if (bySequence.has(turn.sequence)) {
      invalid('turns', 'Turn sequence values must be unique.')
    }
    byClientId.set(turn.clientTurnId, turn)
    byIdempotencyKey.set(turn.idempotencyKey, turn)
    bySequence.set(turn.sequence, turn)
    deduped.push(turn)
  }
  return deduped.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
}

export function normalizeInterviewSession(value, options = {}) {
  const raw = record(value, 'session')
  const repositoryId = normalizeId(options.repositoryId ?? raw.repositoryId, 'repositoryId')
  const title = normalizeText(raw.title, {
    field: 'title',
    maximum: INTERVIEW_MODEL_LIMITS.title,
    required: true,
    multiline: false,
  })
  const audit = entityAudit(
    raw,
    options,
    'session',
    {
      repositoryId,
      ownerId: options.ownerId ?? raw.ownerId,
      title,
      clientStartedAt: raw.clientStartedAt,
    },
    true,
  )
  const idempotencyKey = normalizeInterviewIdempotencyKey(
    options.idempotencyKey ?? raw.idempotencyKey ?? audit.clientId,
    {
      field: 'idempotencyKey',
      scope: 'session_request',
      seed: { repositoryId, clientId: audit.clientId },
    },
  )
  return {
    schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
    id: audit.id,
    clientId: audit.clientId,
    idempotencyKey,
    repositoryId,
    ownerId: audit.ownerId,
    teamId: normalizeOptionalId(options.teamId ?? raw.teamId, 'teamId'),
    applicationId: normalizeOptionalId(
      options.applicationId ?? raw.applicationId,
      'applicationId',
    ),
    title,
    mode: normalizeEnum(raw.mode, INTERVIEW_SESSION_MODES, 'mode', 'solo'),
    status: normalizeEnum(raw.status, INTERVIEW_SESSION_STATUSES, 'status', 'draft'),
    plannedItemIds: normalizeIdList(
      raw.plannedItemIds,
      'plannedItemIds',
      INTERVIEW_MODEL_LIMITS.plannedItems,
    ),
    currentItemId: normalizeOptionalId(raw.currentItemId, 'currentItemId'),
    draftState: normalizeInterviewDraftState(raw.draftState, {
      field: 'draftState',
      now: audit.updatedAt,
    }),
    turns: normalizeSessionTurns(raw.turns, {
      sessionId: audit.id,
      createdBy: audit.ownerId,
      now: audit.createdAt,
    }),
    evaluation: normalizeInterviewEvaluation(raw.evaluation),
    modelMetadata: normalizeInterviewModelMetadata(raw.modelMetadata),
    startedAt: normalizeTimestamp(raw.startedAt, 'startedAt', null),
    completedAt: normalizeTimestamp(raw.completedAt, 'completedAt', null),
    revision: audit.revision,
    createdBy: audit.createdBy,
    updatedBy: audit.updatedBy,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  }
}

function nextRevision(entity) {
  return normalizeInteger(entity.revision, {
    field: 'revision',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER - 1,
  }) + 1
}

function expectedRevisionFrom(patch, options) {
  return options.expectedRevision ?? patch.expectedRevision
}

export function patchInterviewRepository(currentValue, patchValue, options = {}) {
  const current = normalizeInterviewRepository(currentValue)
  const patch = record(patchValue, 'patch')
  assertInterviewRevision(expectedRevisionFrom(patch, options), current.revision, {
    entityType: 'interview repository',
    entityId: current.id,
  })
  const now = currentTimestamp(options)
  return normalizeInterviewRepository({
    ...current,
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    status: patch.status ?? current.status,
    target: patch.target === undefined
      ? current.target
      : { ...current.target, ...record(patch.target, 'patch.target') },
    revision: nextRevision(current),
    updatedBy: options.actorId ?? current.updatedBy,
    updatedAt: now,
  }, {
    id: current.id,
    clientId: current.clientId,
    ownerId: current.ownerId,
    teamId: current.teamId,
    applicationId: current.applicationId,
    createdBy: current.createdBy,
    updatedBy: options.actorId ?? current.updatedBy,
    now,
  })
}

export function patchInterviewItem(currentValue, patchValue, options = {}) {
  const current = normalizeInterviewItem(currentValue)
  const patch = record(patchValue, 'patch')
  assertInterviewRevision(expectedRevisionFrom(patch, options), current.revision, {
    entityType: 'interview item',
    entityId: current.id,
  })
  const now = currentTimestamp(options)
  const answerDraft = patch.answerDraft === undefined
    ? current.answerDraft
    : {
        ...current.answerDraft,
        ...(typeof patch.answerDraft === 'string'
          ? { content: patch.answerDraft }
          : record(patch.answerDraft, 'patch.answerDraft')),
        revision: current.answerDraft.revision + 1,
        updatedBy: options.actorId ?? current.updatedBy,
        updatedAt: now,
      }
  return normalizeInterviewItem({
    ...current,
    kind: patch.kind ?? current.kind,
    category: patch.category ?? current.category,
    title: patch.title ?? current.title,
    question: patch.question ?? current.question,
    answerDraft,
    notes: patch.notes ?? current.notes,
    difficulty: patch.difficulty ?? current.difficulty,
    tags: patch.tags ?? current.tags,
    evidenceLinks: patch.evidenceLinks ?? current.evidenceLinks,
    sortOrder: patch.sortOrder ?? current.sortOrder,
    archived: patch.archived ?? current.archived,
    teacherFeedback: current.teacherFeedback,
    modelMetadata: current.modelMetadata,
    revision: nextRevision(current),
    updatedBy: options.actorId ?? current.updatedBy,
    updatedAt: now,
  }, {
    id: current.id,
    clientId: current.clientId,
    repositoryId: current.repositoryId,
    createdBy: current.createdBy,
    updatedBy: options.actorId ?? current.updatedBy,
    now,
  })
}

export function appendInterviewTeacherFeedback(currentValue, feedbackValue, options = {}) {
  const current = normalizeInterviewItem(currentValue)
  assertInterviewRevision(options.expectedRevision, current.revision, {
    entityType: 'interview item',
    entityId: current.id,
  })
  const now = currentTimestamp(options)
  const feedback = normalizeInterviewTeacherFeedback(feedbackValue, {
    id: options.feedbackId,
    authorId: options.actorId,
    now,
  })
  const existing = current.teacherFeedback.find((entry) => (
    entry.id === feedback.id || entry.clientId === feedback.clientId
  ))
  if (existing) {
    if (interviewContentFingerprint(existing) !== interviewContentFingerprint(feedback)) {
      throw new InterviewIdempotencyConflictError('teacher feedback', existing.id, feedback.clientId)
    }
    return { item: current, feedback: existing, inserted: false }
  }
  if (current.teacherFeedback.length >= INTERVIEW_MODEL_LIMITS.teacherFeedback) {
    invalid('teacherFeedback', 'Teacher feedback has reached its storage limit.')
  }
  const item = normalizeInterviewItem({
    ...current,
    teacherFeedback: [...current.teacherFeedback, feedback],
    revision: nextRevision(current),
    updatedBy: options.actorId ?? current.updatedBy,
    updatedAt: now,
  }, {
    id: current.id,
    clientId: current.clientId,
    repositoryId: current.repositoryId,
    createdBy: current.createdBy,
    updatedBy: options.actorId ?? current.updatedBy,
    now,
  })
  return { item, feedback, inserted: true }
}

export function patchInterviewTurn(currentValue, patchValue, options = {}) {
  const current = normalizeInterviewTurn(currentValue)
  const patch = record(patchValue, 'patch')
  assertInterviewRevision(expectedRevisionFrom(patch, options), current.revision, {
    entityType: 'interview turn',
    entityId: current.id,
  })
  const now = currentTimestamp(options)
  return normalizeInterviewTurn({
    ...current,
    content: patch.content ?? current.content,
    evidenceLinks: patch.evidenceLinks ?? current.evidenceLinks,
    evaluation: options.allowEvaluation
      ? (patch.evaluation ?? current.evaluation)
      : current.evaluation,
    modelMetadata: current.modelMetadata,
    revision: nextRevision(current),
    updatedBy: options.actorId ?? current.updatedBy,
    updatedAt: now,
  }, {
    id: current.id,
    sessionId: current.sessionId,
    sequence: current.sequence,
    createdBy: current.createdBy,
    updatedBy: options.actorId ?? current.updatedBy,
    now,
  })
}

export function patchInterviewSession(currentValue, patchValue, options = {}) {
  const current = normalizeInterviewSession(currentValue)
  const patch = record(patchValue, 'patch')
  assertInterviewRevision(expectedRevisionFrom(patch, options), current.revision, {
    entityType: 'interview session',
    entityId: current.id,
  })
  const now = currentTimestamp(options)
  const draftState = patch.draftState === undefined
    ? current.draftState
    : {
        ...current.draftState,
        ...record(patch.draftState, 'patch.draftState'),
        revision: current.draftState.revision + 1,
        savedAt: now,
      }
  return normalizeInterviewSession({
    ...current,
    title: patch.title ?? current.title,
    plannedItemIds: patch.plannedItemIds ?? current.plannedItemIds,
    currentItemId: patch.currentItemId ?? current.currentItemId,
    draftState,
    status: options.allowStatus ? (patch.status ?? current.status) : current.status,
    evaluation: options.allowEvaluation
      ? (patch.evaluation ?? current.evaluation)
      : current.evaluation,
    modelMetadata: options.allowModelMetadata
      ? (patch.modelMetadata ?? current.modelMetadata)
      : current.modelMetadata,
    turns: current.turns,
    revision: nextRevision(current),
    updatedBy: options.actorId ?? current.updatedBy,
    updatedAt: now,
  }, {
    id: current.id,
    clientId: current.clientId,
    repositoryId: current.repositoryId,
    ownerId: current.ownerId,
    teamId: current.teamId,
    applicationId: current.applicationId,
    createdBy: current.createdBy,
    updatedBy: options.actorId ?? current.updatedBy,
    now,
  })
}

export function appendInterviewTurn(currentValue, turnValue, options = {}) {
  const current = normalizeInterviewSession(currentValue)
  if (options.expectedRevision !== undefined) {
    assertInterviewRevision(options.expectedRevision, current.revision, {
      entityType: 'interview session',
      entityId: current.id,
    })
  }
  const rawTurn = record(turnValue, 'turn')
  const clientTurnId = normalizeInterviewClientId(
    rawTurn.clientTurnId ?? rawTurn.clientId ?? rawTurn.idempotencyKey ?? rawTurn.id,
    {
      field: 'turn.clientTurnId',
      scope: 'turn',
      seed: options.clientSeed,
    },
  )
  const idempotencyKey = normalizeInterviewIdempotencyKey(
    rawTurn.idempotencyKey ?? clientTurnId,
    {
      field: 'turn.idempotencyKey',
      scope: 'turn_request',
      seed: { sessionId: current.id, clientTurnId },
    },
  )
  const existingByClient = current.turns.find((turn) => turn.clientTurnId === clientTurnId)
  const existingByKey = current.turns.find((turn) => turn.idempotencyKey === idempotencyKey)
  if (existingByClient && existingByKey && existingByClient.id !== existingByKey.id) {
    throw new InterviewIdempotencyConflictError('turn', existingByClient.id, idempotencyKey)
  }
  const existing = existingByClient ?? existingByKey
  const now = currentTimestamp(options)
  const sequence = existing
    ? existing.sequence
    : current.turns.reduce((maximum, turn) => Math.max(maximum, turn.sequence), 0) + 1
  const candidate = normalizeInterviewTurn({
    ...rawTurn,
    clientTurnId,
    idempotencyKey,
  }, {
    id: existing?.id ?? options.turnId,
    sessionId: current.id,
    sequence,
    createdBy: existing?.createdBy ?? options.actorId,
    updatedBy: existing?.updatedBy ?? options.actorId,
    now: existing?.createdAt ?? now,
  })
  if (existing) {
    if (existing.contentFingerprint !== candidate.contentFingerprint) {
      throw new InterviewIdempotencyConflictError('turn', existing.id, idempotencyKey)
    }
    return { session: current, turn: existing, inserted: false }
  }
  if (current.turns.length >= INTERVIEW_MODEL_LIMITS.turns) {
    invalid('turns', 'This interview session has reached its turn storage limit.')
  }
  const session = normalizeInterviewSession({
    ...current,
    turns: [...current.turns, candidate],
    revision: nextRevision(current),
    updatedBy: options.actorId ?? current.updatedBy,
    updatedAt: now,
  }, {
    id: current.id,
    clientId: current.clientId,
    repositoryId: current.repositoryId,
    ownerId: current.ownerId,
    teamId: current.teamId,
    applicationId: current.applicationId,
    createdBy: current.createdBy,
    updatedBy: options.actorId ?? current.updatedBy,
    now,
  })
  return {
    session,
    turn: session.turns.find((turn) => turn.id === candidate.id),
    inserted: true,
  }
}

function preview(value) {
  return truncateCodePoints(
    normalizeText(value, {
      field: 'preview',
      maximum: INTERVIEW_MODEL_LIMITS.preview,
      multiline: false,
    }),
    INTERVIEW_MODEL_LIMITS.preview,
  )
}

function summarizeModelMetadata(metadata) {
  if (!metadata) return null
  return {
    provider: metadata.provider,
    model: metadata.model,
    operation: metadata.operation,
    promptTemplateId: metadata.promptTemplateId,
    promptVersion: metadata.promptVersion,
    generatedAt: metadata.generatedAt,
  }
}

export function summarizeInterviewRepository(value, options = {}) {
  const repository = normalizeInterviewRepository(value)
  return {
    id: repository.id,
    clientId: repository.clientId,
    ownerId: repository.ownerId,
    teamId: repository.teamId,
    applicationId: repository.applicationId,
    title: repository.title,
    descriptionPreview: preview(repository.description),
    status: repository.status,
    target: repository.target,
    itemCount: normalizeInteger(options.itemCount, {
      field: 'itemCount',
      minimum: 0,
      maximum: 1_000_000,
      fallback: 0,
    }),
    sessionCount: normalizeInteger(options.sessionCount, {
      field: 'sessionCount',
      minimum: 0,
      maximum: 1_000_000,
      fallback: 0,
    }),
    revision: repository.revision,
    updatedAt: repository.updatedAt,
  }
}

export function summarizeInterviewItem(value) {
  const item = normalizeInterviewItem(value)
  return {
    id: item.id,
    clientId: item.clientId,
    repositoryId: item.repositoryId,
    kind: item.kind,
    category: item.category,
    title: item.title,
    questionPreview: preview(item.question),
    answerStatus: item.answerDraft.status,
    hasAnswerDraft: Boolean(item.answerDraft.content),
    evidenceCount: item.evidenceLinks.length,
    teacherFeedbackCount: item.teacherFeedback.length,
    difficulty: item.difficulty,
    tags: item.tags,
    archived: item.archived,
    sortOrder: item.sortOrder,
    revision: item.revision,
    updatedAt: item.updatedAt,
  }
}

export function summarizeInterviewSession(value) {
  const session = normalizeInterviewSession(value)
  const latestTurn = session.turns.at(-1) ?? null
  return {
    id: session.id,
    clientId: session.clientId,
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    teamId: session.teamId,
    applicationId: session.applicationId,
    title: session.title,
    mode: session.mode,
    status: session.status,
    plannedItemCount: session.plannedItemIds.length,
    turnCount: session.turns.length,
    lastSequence: latestTurn?.sequence ?? 0,
    overallScore: session.evaluation?.overallScore ?? null,
    evaluationSummary: preview(session.evaluation?.summary ?? ''),
    modelMetadata: summarizeModelMetadata(session.modelMetadata),
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    revision: session.revision,
    updatedAt: session.updatedAt,
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  if (typeof value !== 'string' || value.length > 512) invalid('cursor', 'cursor is invalid.')
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      decoded?.version !== 1
      || typeof decoded.updatedAt !== 'string'
      || typeof decoded.id !== 'string'
    ) {
      invalid('cursor', 'cursor is invalid.')
    }
    return {
      version: 1,
      updatedAt: normalizeTimestamp(decoded.updatedAt, 'cursor.updatedAt'),
      id: normalizeId(decoded.id, 'cursor.id'),
    }
  } catch (error) {
    if (error instanceof InterviewModelValidationError) throw error
    invalid('cursor', 'cursor is invalid.')
  }
}

function compareForPagination(left, right) {
  const timestampOrder = right.updatedAt.localeCompare(left.updatedAt)
  return timestampOrder || left.id.localeCompare(right.id)
}

function isAfterCursor(value, cursor) {
  if (value.updatedAt < cursor.updatedAt) return true
  if (value.updatedAt > cursor.updatedAt) return false
  return value.id.localeCompare(cursor.id) > 0
}

function paginate(values, options, normalize, summarize) {
  const limit = normalizeInteger(options.limit, {
    field: 'limit',
    minimum: 1,
    maximum: INTERVIEW_MODEL_LIMITS.pageSize,
    fallback: 20,
  })
  const cursor = decodeCursor(options.cursor)
  const normalized = normalizeArray(values, 'records', 100_000)
    .map((value) => normalize(value))
    .sort(compareForPagination)
  let startIndex = 0
  if (cursor) {
    const exactIndex = normalized.findIndex((value) => (
      value.id === cursor.id && value.updatedAt === cursor.updatedAt
    ))
    startIndex = exactIndex >= 0
      ? exactIndex + 1
      : normalized.findIndex((value) => isAfterCursor(value, cursor))
    if (startIndex < 0) startIndex = normalized.length
  }
  const page = normalized.slice(startIndex, startIndex + limit)
  const hasNextPage = startIndex + page.length < normalized.length
  const last = page.at(-1)
  const nextCursor = hasNextPage && last
    ? encodeCursor({ version: 1, updatedAt: last.updatedAt, id: last.id })
    : null
  return {
    items: page.map((value) => summarize(value)),
    nextCursor,
    hasNextPage,
    pageInfo: {
      limit,
      nextCursor,
      hasNextPage,
    },
  }
}

export function paginateInterviewRepositories(values, options = {}) {
  return paginate(values, options, normalizeInterviewRepository, summarizeInterviewRepository)
}

export function paginateInterviewItems(values, options = {}) {
  return paginate(values, options, normalizeInterviewItem, summarizeInterviewItem)
}

export function paginateInterviewSessions(values, options = {}) {
  return paginate(values, options, normalizeInterviewSession, summarizeInterviewSession)
}

export function paginateInterviewSummaries(values, options = {}) {
  const kind = normalizeEnum(
    options.kind,
    ['repository', 'item', 'session'],
    'kind',
    'session',
  )
  if (kind === 'repository') return paginateInterviewRepositories(values, options)
  if (kind === 'item') return paginateInterviewItems(values, options)
  return paginateInterviewSessions(values, options)
}
