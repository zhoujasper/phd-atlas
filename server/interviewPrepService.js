import {
  assertInterviewAiArtifactCurrent,
  attachInterviewAiModelMetadata,
  buildInterviewAnswerDeepeningPrompts,
  buildInterviewMockEvaluationPrompts,
  buildInterviewNextTurnPrompts,
  buildInterviewQuestionBankPrompts,
  parseInterviewAnswerDeepeningResponse,
  parseInterviewMockEvaluationResponse,
  parseInterviewNextTurnResponse,
  parseInterviewQuestionBankResponse,
  verifyInterviewAiArtifactFingerprint,
} from './interviewPrepAi.js'
import {
  appendInterviewTeacherFeedback,
  appendInterviewTurn,
  assertInterviewRevision,
  interviewContentFingerprint,
  normalizeInterviewIdempotencyKey,
  normalizeInterviewItem,
  normalizeInterviewRepository,
  normalizeInterviewSession,
  patchInterviewItem,
  patchInterviewRepository,
  patchInterviewSession,
} from './interviewPrepModel.js'
import {
  normalizeStudentPermissions,
  normalizeTeacherPermissions,
  normalizeTeamPermissionDefaults,
} from './teamPermissions.js'
import { isTeacherAssignedToStudent } from './teamRelationships.js'

const ACCESS_CAPABILITIES = Object.freeze(['read', 'write', 'ai', 'feedback'])
const AI_MODES = Object.freeze([
  'question_bank',
  'answer_deepening',
  'next_mock_turn',
  'mock_evaluation',
])
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u
const DEFAULT_AI_CONCURRENCY = 4
const DEFAULT_AI_QUEUE_LIMIT = 32
const MAX_AGGREGATE_REPOSITORIES = 1_000
const MAX_AGGREGATE_CHILDREN = 10_000

export class InterviewPrepServiceError extends Error {
  constructor(code, message, status, details = null) {
    super(message)
    this.name = 'InterviewPrepServiceError'
    this.code = code
    this.status = status
    if (details && typeof details === 'object') this.details = details
  }
}

function serviceError(code, message, status, details = null) {
  return new InterviewPrepServiceError(code, message, status, details)
}

function invalidWorkspace(message, field = null) {
  throw serviceError(
    'INTERVIEW_WORKSPACE_INVALID',
    message,
    400,
    field ? { field } : null,
  )
}

function safeId(value, field, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) invalidWorkspace(field + ' is required.', field)
    return null
  }
  const normalized = String(value).normalize('NFKC').trim()
  if (!SAFE_ID_PATTERN.test(normalized)) invalidWorkspace(field + ' is invalid.', field)
  return normalized
}

function normalizeWorkspace(value = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const ownerId = safeId(raw.ownerId ?? raw.targetUserId, 'workspace.ownerId')
  const teamId = safeId(raw.teamId, 'workspace.teamId', false)
  const kind = raw.kind ?? (teamId ? 'team' : 'personal')
  if (!['personal', 'team'].includes(kind)) {
    invalidWorkspace('workspace.kind must be personal or team.', 'workspace.kind')
  }
  if (kind === 'personal' && teamId) {
    invalidWorkspace('A personal Interview Prep workspace cannot have a teamId.', 'workspace.teamId')
  }
  if (kind === 'team' && !teamId) {
    invalidWorkspace('A Team Interview Prep workspace requires teamId.', 'workspace.teamId')
  }
  return { kind, ownerId, teamId: kind === 'team' ? teamId : null }
}

function isSystemAdmin(actor) {
  return Boolean(actor?.isSystemAdmin || actor?.role === 'admin')
}

function deniedAccess(scope, actorId, reason) {
  const permissions = {
    read: false,
    write: false,
    ai: false,
    feedback: false,
  }
  return {
    allowed: false,
    scope,
    actorId,
    actorRole: 'none',
    targetRole: scope.kind === 'team' ? 'student' : 'personal',
    assigned: false,
    reason,
    permissions,
    canRead: false,
    canWrite: false,
    canUseAi: false,
    canGiveFeedback: false,
  }
}

function allowedAccess(scope, actorId, actorRole, permissions, assigned = false) {
  const normalized = {
    read: Boolean(permissions.read),
    write: Boolean(permissions.write),
    ai: Boolean(permissions.ai),
    feedback: Boolean(permissions.feedback),
  }
  return {
    allowed: Object.values(normalized).some(Boolean),
    scope,
    actorId,
    actorRole,
    targetRole: scope.kind === 'team' ? 'student' : 'personal',
    assigned,
    reason: null,
    permissions: normalized,
    canRead: normalized.read,
    canWrite: normalized.write,
    canUseAi: normalized.ai,
    canGiveFeedback: normalized.feedback,
  }
}

function activeMembership(memberships, teamId, userId) {
  return (Array.isArray(memberships) ? memberships : []).find((membership) => (
    membership?.teamId === teamId
    && membership?.userId === userId
    && membership?.status === 'active'
  )) ?? null
}

/**
 * Pure authorization resolver. It never trusts a caller-supplied role without
 * the matching active membership and defaults to a fully denied matrix.
 */
export function resolveInterviewWorkspaceAccess(input = {}) {
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {}
  const actorId = safeId(actor.id, 'actor.id')
  const scope = normalizeWorkspace(input.workspace ?? input)
  if (actor.disabledAt) return deniedAccess(scope, actorId, 'actor_inactive')

  if (scope.kind === 'personal') {
    if (isSystemAdmin(actor)) {
      return allowedAccess(scope, actorId, 'system_admin', {
        read: true,
        write: true,
        ai: true,
        feedback: true,
      })
    }
    if (actorId === scope.ownerId) {
      return allowedAccess(scope, actorId, 'self', {
        read: true,
        write: true,
        ai: true,
        feedback: false,
      })
    }
    return deniedAccess(scope, actorId, 'personal_owner_mismatch')
  }

  const team = input.team && typeof input.team === 'object' ? input.team : null
  if (
    !team
    || team.id !== scope.teamId
    || team.disabledAt
    || team.archivedAt
    || (team.status && team.status !== 'active')
  ) {
    return deniedAccess(scope, actorId, 'team_inaccessible')
  }
  const memberships = Array.isArray(input.memberships) ? input.memberships : []
  const targetMembership = activeMembership(memberships, scope.teamId, scope.ownerId)
  if (!targetMembership || targetMembership.role !== 'member') {
    return deniedAccess(scope, actorId, 'target_student_inactive')
  }

  if (isSystemAdmin(actor)) {
    return allowedAccess(scope, actorId, 'system_admin', {
      read: true,
      write: true,
      ai: true,
      feedback: true,
    })
  }
  if (team.ownerId === actorId) {
    return allowedAccess(scope, actorId, 'owner', {
      read: true,
      write: true,
      ai: true,
      feedback: true,
    })
  }

  const actorMembership = activeMembership(memberships, scope.teamId, actorId)
  if (!actorMembership) return deniedAccess(scope, actorId, 'actor_membership_inactive')
  const defaults = normalizeTeamPermissionDefaults(
    input.permissionDefaults ?? team.permissionDefaults,
  )
  if (actorMembership.role === 'member' && actorId === scope.ownerId) {
    const studentPermissions = normalizeStudentPermissions(
      actorMembership.relationships?.studentPermissions,
      defaults.student,
    )
    const enabled = studentPermissions.useInterviewPrep
    return allowedAccess(scope, actorId, 'student', {
      read: enabled,
      write: enabled,
      ai: enabled,
      feedback: false,
    })
  }
  if (actorMembership.role === 'admin') {
    const assigned = isTeacherAssignedToStudent(targetMembership, actorId)
    const teacherPermissions = normalizeTeacherPermissions(
      actorMembership.relationships?.teacherPermissions,
      defaults.teacher,
    )
    const enabled = assigned && teacherPermissions.manageStudentInterviewPrep
    return allowedAccess(scope, actorId, 'teacher', {
      read: enabled,
      write: enabled,
      ai: enabled,
      feedback: enabled,
    }, assigned)
  }
  return deniedAccess(scope, actorId, 'team_role_forbidden')
}

export function requireInterviewWorkspaceCapability(access, capability) {
  if (!ACCESS_CAPABILITIES.includes(capability)) {
    invalidWorkspace('Unknown Interview Prep capability.', 'capability')
  }
  if (!access?.permissions?.[capability]) {
    throw serviceError(
      'INTERVIEW_ACCESS_FORBIDDEN',
      'Your permissions do not allow this Interview Prep operation.',
      403,
      { capability },
    )
  }
  return access
}

/**
 * Validates scope without returning the credential secret. The service keeps
 * the original credential only inside the provider-call closure.
 */
export function validateInterviewAiKeyScope(aiKey, workspace) {
  const scope = normalizeWorkspace(workspace)
  if (!aiKey || typeof aiKey !== 'object') {
    throw serviceError('INTERVIEW_AI_KEY_NOT_FOUND', 'The selected AI key was not found.', 404)
  }
  if (!aiKey.apiKey || typeof aiKey.apiKey !== 'string') {
    throw serviceError(
      'INTERVIEW_AI_KEY_UNAVAILABLE',
      'The selected AI key has no usable credential.',
      409,
    )
  }
  if (aiKey.enabled === false) {
    throw serviceError(
      'INTERVIEW_AI_KEY_UNAVAILABLE',
      'The selected AI key is disabled.',
      409,
    )
  }
  const keyScope = String(aiKey.scope ?? '')
  const keyOwnerId = safeId(aiKey.ownerId, 'aiKey.ownerId')
  const keyTeamId = safeId(aiKey.teamId, 'aiKey.teamId', false)
  const matches = scope.kind === 'personal'
    ? keyScope === 'personal' && keyOwnerId === scope.ownerId && keyTeamId === null
    : keyScope === 'team' && keyTeamId === scope.teamId
  if (!matches) {
    throw serviceError(
      'INTERVIEW_AI_KEY_SCOPE_FORBIDDEN',
      'The selected AI key does not belong to this Interview Prep workspace.',
      403,
    )
  }
  const id = safeId(aiKey.id, 'aiKey.id')
  const provider = String(aiKey.provider ?? '').trim()
  const model = String(aiKey.model ?? '').trim()
  if (!provider || !model) {
    throw serviceError(
      'INTERVIEW_AI_KEY_INVALID',
      'The selected AI key has incomplete provider configuration.',
      409,
    )
  }
  return {
    id,
    ownerId: keyOwnerId,
    teamId: keyTeamId,
    scope: keyScope,
    provider,
    model,
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw serviceError(
      'INTERVIEW_OPERATION_ABORTED',
      'The Interview Prep operation was cancelled.',
      499,
    )
  }
}

class InterviewAiConcurrencyGate {
  constructor(limit, queueLimit) {
    this.limit = limit
    this.queueLimit = queueLimit
    this.active = 0
    this.queue = []
  }

  run(signal, operation) {
    throwIfAborted(signal)
    return new Promise((resolve, reject) => {
      const entry = {
        operation,
        signal,
        resolve,
        reject,
        started: false,
        onAbort: null,
      }
      entry.onAbort = () => {
        if (entry.started) return
        const index = this.queue.indexOf(entry)
        if (index >= 0) this.queue.splice(index, 1)
        reject(serviceError(
          'INTERVIEW_OPERATION_ABORTED',
          'The Interview Prep operation was cancelled.',
          499,
        ))
      }
      if (signal) signal.addEventListener('abort', entry.onAbort, { once: true })
      if (this.active < this.limit) {
        this.start(entry)
        return
      }
      if (this.queue.length >= this.queueLimit) {
        if (signal) signal.removeEventListener('abort', entry.onAbort)
        reject(serviceError(
          'INTERVIEW_AI_BUSY',
          'Interview AI is at capacity. Please retry shortly.',
          429,
        ))
        return
      }
      this.queue.push(entry)
    })
  }

  start(entry) {
    entry.started = true
    if (entry.signal) entry.signal.removeEventListener('abort', entry.onAbort)
    this.active += 1
    Promise.resolve()
      .then(() => entry.operation())
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active -= 1
        this.drain()
      })
  }

  drain() {
    while (this.active < this.limit && this.queue.length > 0) {
      const entry = this.queue.shift()
      if (entry.signal?.aborted) {
        entry.reject(serviceError(
          'INTERVIEW_OPERATION_ABORTED',
          'The Interview Prep operation was cancelled.',
          499,
        ))
        continue
      }
      this.start(entry)
    }
  }
}

export function createInterviewAiConcurrencyGate(options = {}) {
  const limit = Number(options.limit ?? DEFAULT_AI_CONCURRENCY)
  const queueLimit = Number(options.queueLimit ?? DEFAULT_AI_QUEUE_LIMIT)
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > 32
    || !Number.isInteger(queueLimit)
    || queueLimit < 0
    || queueLimit > 1_000
  ) {
    throw serviceError(
      'INTERVIEW_SERVICE_CONFIG_INVALID',
      'Interview AI concurrency configuration is invalid.',
      500,
    )
  }
  return new InterviewAiConcurrencyGate(limit, queueLimit)
}

function normalizeUsage(value) {
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

function jsonClone(value, field) {
  try {
    const serialized = JSON.stringify(value ?? {})
    if (serialized.length > 250_000) {
      throw serviceError(
        'INTERVIEW_AI_INPUT_TOO_LARGE',
        'Interview AI evidence exceeded its service input limit.',
        400,
        { field },
      )
    }
    return JSON.parse(serialized)
  } catch (error) {
    if (error instanceof InterviewPrepServiceError) throw error
    throw serviceError(
      'INTERVIEW_AI_INPUT_INVALID',
      'Interview AI evidence must be JSON serializable.',
      400,
      { field },
    )
  }
}

function publicAccess(access) {
  return {
    scope: access.scope,
    actorRole: access.actorRole,
    assigned: access.assigned,
    permissions: { ...access.permissions },
  }
}

function scopeKey(scope) {
  return scope.kind + ':' + (scope.teamId ?? 'personal') + ':' + scope.ownerId
}

function entityFromResult(result, key) {
  if (result && typeof result === 'object' && result[key]) return result[key]
  if (result && typeof result === 'object' && result.entity) return result.entity
  return result
}

function listFromResult(result, key) {
  if (Array.isArray(result)) return result
  if (result && Array.isArray(result[key])) return result[key]
  if (result && Array.isArray(result.items)) return result.items
  return []
}

function sourceRevisionSnapshot(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entity]) => entity)
      .map(([key, entity]) => [key, {
        id: entity.id,
        revision: entity.revision,
      }]),
  )
}

function sameSourceRevisions(left, right) {
  return interviewContentFingerprint(left) === interviewContentFingerprint(right)
}

function normalizeProviderFailure(error, signal) {
  if (
    signal?.aborted
    || error?.name === 'AbortError'
    || error?.code === 'INTERVIEW_OPERATION_ABORTED'
  ) {
    return serviceError(
      'INTERVIEW_OPERATION_ABORTED',
      'The Interview Prep operation was cancelled.',
      499,
    )
  }
  if (error instanceof InterviewPrepServiceError) return error
  return serviceError(
    'INTERVIEW_AI_PROVIDER_FAILED',
    'The Interview AI provider could not complete this request.',
    502,
  )
}

/**
 * The adapter is intentionally injected. Expected methods use one object
 * argument and may enforce stronger transactions/idempotency at persistence.
 */
export function createInterviewPrepService(options = {}) {
  const storage = options.storage
  if (!storage || typeof storage !== 'object') {
    throw serviceError(
      'INTERVIEW_SERVICE_CONFIG_INVALID',
      'Interview Prep requires a storage adapter.',
      500,
    )
  }
  const completeChat = options.completeChat
  const now = typeof options.now === 'function'
    ? options.now
    : () => new Date().toISOString()
  const aiGate = options.aiGate ?? createInterviewAiConcurrencyGate({
    limit: options.maxConcurrentAi,
    queueLimit: options.maxQueuedAi,
  })
  const aiInFlight = new Map()

  async function adapterCall(name, payload, callOptions = {}) {
    const method = storage[name]
    if (typeof method !== 'function') {
      if (callOptions.optional) return null
      throw serviceError(
        'INTERVIEW_STORAGE_ADAPTER_INVALID',
        'Interview Prep storage adapter is missing ' + name + '.',
        500,
      )
    }
    throwIfAborted(payload?.signal)
    try {
      return await method.call(storage, payload)
    } catch (error) {
      if (error instanceof InterviewPrepServiceError || (error?.status && error?.code)) throw error
      if (payload?.signal?.aborted || error?.name === 'AbortError') throwIfAborted(payload?.signal)
      throw serviceError(
        'INTERVIEW_STORAGE_FAILED',
        'Interview Prep storage could not complete the operation.',
        503,
      )
    }
  }

  async function serviceAccess(actor, workspace, capability, signal) {
    throwIfAborted(signal)
    const scope = normalizeWorkspace(workspace)
    let context = {}
    if (scope.kind === 'team') {
      context = await adapterCall('getInterviewAccessContext', {
        actorId: actor?.id,
        ownerId: scope.ownerId,
        teamId: scope.teamId,
        signal,
      })
      if (!context || typeof context !== 'object') context = {}
    }
    const access = resolveInterviewWorkspaceAccess({
      actor,
      workspace: scope,
      team: context.team,
      memberships: context.memberships,
      permissionDefaults: context.permissionDefaults,
    })
    return requireInterviewWorkspaceCapability(access, capability)
  }

  function assertRepositoryScope(repository, scope) {
    const matches = repository.ownerId === scope.ownerId
      && (
        scope.kind === 'personal'
          ? repository.teamId === null
          : repository.teamId === scope.teamId
      )
    if (!matches) {
      throw serviceError(
        'INTERVIEW_STORAGE_SCOPE_VIOLATION',
        'Interview Prep storage returned content outside the authorized workspace.',
        500,
      )
    }
    return repository
  }

  function assertSessionScope(session, scope, repositoryId = null) {
    const matches = session.ownerId === scope.ownerId
      && (
        scope.kind === 'personal'
          ? session.teamId === null
          : session.teamId === scope.teamId
      )
      && (!repositoryId || session.repositoryId === repositoryId)
    if (!matches) {
      throw serviceError(
        'INTERVIEW_STORAGE_SCOPE_VIOLATION',
        'Interview Prep storage returned a session outside the authorized workspace.',
        500,
      )
    }
    return session
  }

  async function loadRepository(access, repositoryId, signal) {
    const id = safeId(repositoryId, 'repositoryId')
    const result = await adapterCall('getInterviewRepository', {
      scope: access.scope,
      repositoryId: id,
      signal,
    })
    const raw = entityFromResult(result, 'repository')
    if (!raw) {
      throw serviceError('INTERVIEW_REPOSITORY_NOT_FOUND', 'Interview repository not found.', 404)
    }
    return assertRepositoryScope(normalizeInterviewRepository(raw), access.scope)
  }

  async function loadItem(access, itemId, repositoryId, signal) {
    const id = safeId(itemId, 'itemId')
    const result = await adapterCall('getInterviewItem', {
      scope: access.scope,
      repositoryId,
      itemId: id,
      signal,
    })
    const raw = entityFromResult(result, 'item')
    if (!raw) throw serviceError('INTERVIEW_ITEM_NOT_FOUND', 'Interview item not found.', 404)
    const item = normalizeInterviewItem(raw)
    if (item.repositoryId !== repositoryId) {
      throw serviceError(
        'INTERVIEW_STORAGE_SCOPE_VIOLATION',
        'Interview Prep storage returned an item outside its repository.',
        500,
      )
    }
    return item
  }

  async function loadSession(access, sessionId, repositoryId, signal) {
    const id = safeId(sessionId, 'sessionId')
    const result = await adapterCall('getInterviewSession', {
      scope: access.scope,
      repositoryId,
      sessionId: id,
      signal,
    })
    const raw = entityFromResult(result, 'session')
    if (!raw) throw serviceError('INTERVIEW_SESSION_NOT_FOUND', 'Interview session not found.', 404)
    return assertSessionScope(
      normalizeInterviewSession(raw),
      access.scope,
      repositoryId,
    )
  }

  async function listRepositoryItems(access, repositoryId, signal) {
    const result = await adapterCall('listInterviewItems', {
      scope: access.scope,
      repositoryId,
      signal,
    })
    const values = listFromResult(result, 'items')
    if (values.length > MAX_AGGREGATE_CHILDREN) {
      throw serviceError('INTERVIEW_STORAGE_LIMIT_EXCEEDED', 'Interview item limit exceeded.', 500)
    }
    return values.map((value) => {
      const item = normalizeInterviewItem(value)
      if (item.repositoryId !== repositoryId) {
        throw serviceError(
          'INTERVIEW_STORAGE_SCOPE_VIOLATION',
          'Interview Prep storage returned an item outside its repository.',
          500,
        )
      }
      return item
    })
  }

  async function listRepositorySessions(access, repositoryId, signal) {
    const result = await adapterCall('listInterviewSessions', {
      scope: access.scope,
      repositoryId,
      signal,
    })
    const values = listFromResult(result, 'sessions')
    if (values.length > MAX_AGGREGATE_CHILDREN) {
      throw serviceError('INTERVIEW_STORAGE_LIMIT_EXCEEDED', 'Interview session limit exceeded.', 500)
    }
    return values.map((value) => assertSessionScope(
      normalizeInterviewSession(value),
      access.scope,
      repositoryId,
    ))
  }

  async function getRepositoryAggregateInternal(access, repositoryId, signal) {
    const repository = await loadRepository(access, repositoryId, signal)
    const [items, sessions] = await Promise.all([
      listRepositoryItems(access, repository.id, signal),
      listRepositorySessions(access, repository.id, signal),
    ])
    const aggregate = { repository, items, sessions }
    return {
      ...aggregate,
      contentFingerprint: interviewContentFingerprint(aggregate),
    }
  }

  async function getRepositoryAggregate(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'read', args.signal)
    return {
      access: publicAccess(access),
      ...(await getRepositoryAggregateInternal(access, args.repositoryId, args.signal)),
    }
  }

  async function getWorkspaceSnapshot(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'read', args.signal)
    const result = await adapterCall('listInterviewRepositories', {
      scope: access.scope,
      signal: args.signal,
    })
    const values = listFromResult(result, 'repositories')
    if (values.length > MAX_AGGREGATE_REPOSITORIES) {
      throw serviceError(
        'INTERVIEW_STORAGE_LIMIT_EXCEEDED',
        'Interview repository limit exceeded.',
        500,
      )
    }
    const repositories = values.map((value) => (
      assertRepositoryScope(normalizeInterviewRepository(value), access.scope)
    ))
    const aggregates = await Promise.all(repositories.map(async (repository) => {
      const [items, sessions] = await Promise.all([
        listRepositoryItems(access, repository.id, args.signal),
        listRepositorySessions(access, repository.id, args.signal),
      ])
      return { repository, items, sessions }
    }))
    return {
      access: publicAccess(access),
      scope: access.scope,
      repositories: aggregates,
      contentFingerprint: interviewContentFingerprint(aggregates),
    }
  }

  function writeIdempotencyKey(value, seed) {
    return normalizeInterviewIdempotencyKey(value, {
      scope: 'interview_write',
      seed,
    })
  }

  async function createRepository(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const timestamp = now()
    const repositoryInput = args.repository && typeof args.repository === 'object'
      && !Array.isArray(args.repository)
      ? args.repository
      : {}
    const repository = normalizeInterviewRepository({
      ...repositoryInput,
      ownerId: access.scope.ownerId,
      teamId: access.scope.teamId,
    }, {
      ownerId: access.scope.ownerId,
      teamId: access.scope.teamId,
      createdBy: args.actor.id,
      updatedBy: args.actor.id,
      now: timestamp,
    })
    const inputFingerprint = interviewContentFingerprint(repository)
    const idempotencyKey = writeIdempotencyKey(args.idempotencyKey, {
      operation: 'create_repository',
      inputFingerprint,
    })
    const result = await adapterCall('saveInterviewRepository', {
      scope: access.scope,
      repository,
      expectedRevision: null,
      idempotencyKey,
      inputFingerprint,
      signal: args.signal,
    })
    return assertRepositoryScope(
      normalizeInterviewRepository(entityFromResult(result, 'repository') ?? repository),
      access.scope,
    )
  }

  async function updateRepository(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const current = await loadRepository(access, args.repositoryId, args.signal)
    const repository = patchInterviewRepository(current, args.patch, {
      expectedRevision: args.expectedRevision,
      actorId: args.actor.id,
      now: now(),
    })
    const inputFingerprint = interviewContentFingerprint(repository)
    const result = await adapterCall('saveInterviewRepository', {
      scope: access.scope,
      repository,
      expectedRevision: current.revision,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'update_repository',
        repositoryId: current.id,
        inputFingerprint,
      }),
      inputFingerprint,
      signal: args.signal,
    })
    return assertRepositoryScope(
      normalizeInterviewRepository(entityFromResult(result, 'repository') ?? repository),
      access.scope,
    )
  }

  async function deleteRepository(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    assertInterviewRevision(args.expectedRevision, repository.revision, {
      entityType: 'interview repository',
      entityId: repository.id,
    })
    await adapterCall('deleteInterviewRepository', {
      scope: access.scope,
      repositoryId: repository.id,
      expectedRevision: repository.revision,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'delete_repository',
        repositoryId: repository.id,
        revision: repository.revision,
      }),
      signal: args.signal,
    })
    return { id: repository.id, deleted: true }
  }

  async function createItem(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const item = normalizeInterviewItem(args.item, {
      repositoryId: repository.id,
      createdBy: args.actor.id,
      updatedBy: args.actor.id,
      now: now(),
    })
    const inputFingerprint = interviewContentFingerprint(item)
    const result = await adapterCall('saveInterviewItem', {
      scope: access.scope,
      item,
      expectedRevision: null,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'create_item',
        inputFingerprint,
      }),
      inputFingerprint,
      signal: args.signal,
    })
    const saved = normalizeInterviewItem(entityFromResult(result, 'item') ?? item)
    if (saved.repositoryId !== repository.id) {
      throw serviceError('INTERVIEW_STORAGE_SCOPE_VIOLATION', 'Saved item changed repository.', 500)
    }
    return saved
  }

  async function updateItem(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const current = await loadItem(access, args.itemId, repository.id, args.signal)
    const item = patchInterviewItem(current, args.patch, {
      expectedRevision: args.expectedRevision,
      actorId: args.actor.id,
      now: now(),
    })
    const inputFingerprint = interviewContentFingerprint(item)
    const result = await adapterCall('saveInterviewItem', {
      scope: access.scope,
      item,
      expectedRevision: current.revision,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'update_item',
        itemId: item.id,
        inputFingerprint,
      }),
      inputFingerprint,
      signal: args.signal,
    })
    return normalizeInterviewItem(entityFromResult(result, 'item') ?? item)
  }

  async function deleteItem(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const item = await loadItem(access, args.itemId, repository.id, args.signal)
    assertInterviewRevision(args.expectedRevision, item.revision, {
      entityType: 'interview item',
      entityId: item.id,
    })
    await adapterCall('deleteInterviewItem', {
      scope: access.scope,
      repositoryId: repository.id,
      itemId: item.id,
      expectedRevision: item.revision,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'delete_item',
        itemId: item.id,
        revision: item.revision,
      }),
      signal: args.signal,
    })
    return { id: item.id, deleted: true }
  }

  async function createSession(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const sessionInput = args.session && typeof args.session === 'object'
      && !Array.isArray(args.session)
      ? args.session
      : {}
    const session = normalizeInterviewSession({
      ...sessionInput,
      repositoryId: repository.id,
      ownerId: access.scope.ownerId,
      teamId: access.scope.teamId,
      applicationId: repository.applicationId,
    }, {
      repositoryId: repository.id,
      ownerId: access.scope.ownerId,
      teamId: access.scope.teamId,
      applicationId: repository.applicationId,
      createdBy: args.actor.id,
      updatedBy: args.actor.id,
      now: now(),
    })
    const inputFingerprint = interviewContentFingerprint(session)
    const result = await adapterCall('saveInterviewSession', {
      scope: access.scope,
      session,
      expectedRevision: null,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'create_session',
        inputFingerprint,
      }),
      inputFingerprint,
      signal: args.signal,
    })
    return assertSessionScope(
      normalizeInterviewSession(entityFromResult(result, 'session') ?? session),
      access.scope,
      repository.id,
    )
  }

  async function updateSession(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const current = await loadSession(
      access,
      args.sessionId,
      repository.id,
      args.signal,
    )
    const session = patchInterviewSession(current, args.patch, {
      expectedRevision: args.expectedRevision,
      actorId: args.actor.id,
      now: now(),
      allowStatus: Boolean(args.allowStatus),
    })
    const inputFingerprint = interviewContentFingerprint(session)
    const result = await adapterCall('saveInterviewSession', {
      scope: access.scope,
      session,
      expectedRevision: current.revision,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'update_session',
        sessionId: session.id,
        inputFingerprint,
      }),
      inputFingerprint,
      signal: args.signal,
    })
    return assertSessionScope(
      normalizeInterviewSession(entityFromResult(result, 'session') ?? session),
      access.scope,
      repository.id,
    )
  }

  async function deleteSession(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const session = await loadSession(
      access,
      args.sessionId,
      repository.id,
      args.signal,
    )
    assertInterviewRevision(args.expectedRevision, session.revision, {
      entityType: 'interview session',
      entityId: session.id,
    })
    await adapterCall('deleteInterviewSession', {
      scope: access.scope,
      repositoryId: repository.id,
      sessionId: session.id,
      expectedRevision: session.revision,
      idempotencyKey: writeIdempotencyKey(args.idempotencyKey, {
        operation: 'delete_session',
        sessionId: session.id,
        revision: session.revision,
      }),
      signal: args.signal,
    })
    return { id: session.id, deleted: true }
  }

  async function appendTurn(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'write', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const current = await loadSession(
      access,
      args.sessionId,
      repository.id,
      args.signal,
    )
    const appended = appendInterviewTurn(current, args.turn, {
      actorId: args.actor.id,
      turnId: args.turnId,
      now: now(),
    })
    if (!appended.inserted) return appended
    assertInterviewRevision(args.expectedRevision, current.revision, {
      entityType: 'interview session',
      entityId: current.id,
    })
    const inputFingerprint = interviewContentFingerprint(appended.session)
    const result = await adapterCall('saveInterviewSession', {
      scope: access.scope,
      session: appended.session,
      expectedRevision: current.revision,
      idempotencyKey: writeIdempotencyKey(
        args.idempotencyKey ?? appended.turn.idempotencyKey,
        {
          operation: 'append_turn',
          sessionId: current.id,
          turnFingerprint: appended.turn.contentFingerprint,
        },
      ),
      inputFingerprint,
      signal: args.signal,
    })
    const session = assertSessionScope(
      normalizeInterviewSession(entityFromResult(result, 'session') ?? appended.session),
      access.scope,
      repository.id,
    )
    return {
      session,
      turn: session.turns.find((turn) => turn.id === appended.turn.id) ?? appended.turn,
      inserted: true,
    }
  }

  async function addTeacherFeedback(args = {}) {
    const access = await serviceAccess(args.actor, args.workspace, 'feedback', args.signal)
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    const current = await loadItem(access, args.itemId, repository.id, args.signal)
    const appended = appendInterviewTeacherFeedback(current, args.feedback, {
      expectedRevision: args.expectedRevision,
      actorId: args.actor.id,
      feedbackId: args.feedbackId,
      now: now(),
    })
    if (!appended.inserted) return appended
    const inputFingerprint = interviewContentFingerprint(appended.item)
    const result = await adapterCall('saveInterviewItem', {
      scope: access.scope,
      item: appended.item,
      expectedRevision: current.revision,
      idempotencyKey: writeIdempotencyKey(
        args.idempotencyKey ?? appended.feedback.clientId,
        {
          operation: 'teacher_feedback',
          itemId: current.id,
          feedbackId: appended.feedback.id,
        },
      ),
      inputFingerprint,
      signal: args.signal,
    })
    return {
      item: normalizeInterviewItem(entityFromResult(result, 'item') ?? appended.item),
      feedback: appended.feedback,
      inserted: true,
    }
  }

  async function buildAiPlan(mode, args, access) {
    const externalInput = jsonClone(args.input ?? args.evidence ?? {}, 'input')
    const repository = await loadRepository(access, args.repositoryId, args.signal)
    if (mode === 'question_bank') {
      const build = (currentRepository) => buildInterviewQuestionBankPrompts({
        ...externalInput,
        repository: currentRepository,
      })
      return {
        bundle: build(repository),
        sources: { repository },
        refresh: async () => {
          const latestRepository = await loadRepository(
            access,
            repository.id,
            args.signal,
          )
          return {
            bundle: build(latestRepository),
            sources: { repository: latestRepository },
          }
        },
        parse: parseInterviewQuestionBankResponse,
      }
    }
    if (mode === 'answer_deepening') {
      const item = await loadItem(access, args.itemId, repository.id, args.signal)
      const build = (currentRepository, currentItem) => (
        buildInterviewAnswerDeepeningPrompts({
          ...externalInput,
          repository: currentRepository,
          item: currentItem,
        })
      )
      return {
        bundle: build(repository, item),
        sources: { repository, item },
        refresh: async () => {
          const [latestRepository, latestItem] = await Promise.all([
            loadRepository(access, repository.id, args.signal),
            loadItem(access, item.id, repository.id, args.signal),
          ])
          return {
            bundle: build(latestRepository, latestItem),
            sources: { repository: latestRepository, item: latestItem },
          }
        },
        parse: parseInterviewAnswerDeepeningResponse,
      }
    }
    const session = await loadSession(access, args.sessionId, repository.id, args.signal)
    if (mode === 'next_mock_turn') {
      const item = args.itemId
        ? await loadItem(access, args.itemId, repository.id, args.signal)
        : null
      const build = (currentRepository, currentSession, currentItem) => (
        buildInterviewNextTurnPrompts({
          ...externalInput,
          repository: currentRepository,
          session: currentSession,
          ...(currentItem ? { item: currentItem } : {}),
        })
      )
      return {
        bundle: build(repository, session, item),
        sources: { repository, session, ...(item ? { item } : {}) },
        refresh: async () => {
          const [latestRepository, latestSession, latestItem] = await Promise.all([
            loadRepository(access, repository.id, args.signal),
            loadSession(access, session.id, repository.id, args.signal),
            item ? loadItem(access, item.id, repository.id, args.signal) : null,
          ])
          return {
            bundle: build(latestRepository, latestSession, latestItem),
            sources: {
              repository: latestRepository,
              session: latestSession,
              ...(latestItem ? { item: latestItem } : {}),
            },
          }
        },
        parse: parseInterviewNextTurnResponse,
      }
    }
    const build = (currentRepository, currentSession) => (
      buildInterviewMockEvaluationPrompts({
        ...externalInput,
        repository: currentRepository,
        session: currentSession,
      })
    )
    return {
      bundle: build(repository, session),
      sources: { repository, session },
      refresh: async () => {
        const [latestRepository, latestSession] = await Promise.all([
          loadRepository(access, repository.id, args.signal),
          loadSession(access, session.id, repository.id, args.signal),
        ])
        return {
          bundle: build(latestRepository, latestSession),
          sources: { repository: latestRepository, session: latestSession },
        }
      },
      parse: parseInterviewMockEvaluationResponse,
    }
  }

  async function loadAiKey(aiKeyId, access, signal) {
    const id = safeId(aiKeyId, 'aiKeyId')
    const result = await adapterCall('getAiKeyById', {
      aiKeyId: id,
      signal,
    })
    const aiKey = entityFromResult(result, 'aiKey')
    validateInterviewAiKeyScope(aiKey, access.scope)
    return aiKey
  }

  async function priorAiResult(access, mode, idempotencyKey, bundle, signal) {
    const result = await adapterCall('getInterviewAiArtifactByIdempotencyKey', {
      scope: access.scope,
      mode,
      idempotencyKey,
      signal,
    }, { optional: true })
    if (!result) return null
    const artifact = entityFromResult(result, 'artifact')
    if (!artifact || !verifyInterviewAiArtifactFingerprint(artifact)) {
      throw serviceError(
        'INTERVIEW_STORAGE_SCOPE_VIOLATION',
        'Stored Interview AI artifact failed integrity validation.',
        500,
      )
    }
    if (artifact.inputFingerprint !== bundle.inputFingerprint) {
      throw serviceError(
        'INTERVIEW_IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for different Interview AI input.',
        409,
      )
    }
    assertInterviewAiArtifactCurrent(artifact, bundle)
    return {
      artifact,
      usage: normalizeUsage(result.usage),
      cached: true,
      persisted: true,
    }
  }

  async function runAiOperation(mode, args = {}) {
    if (!AI_MODES.includes(mode)) {
      throw serviceError('INTERVIEW_AI_MODE_INVALID', 'Unsupported Interview AI mode.', 400)
    }
    if (typeof completeChat !== 'function') {
      throw serviceError(
        'INTERVIEW_SERVICE_CONFIG_INVALID',
        'Interview Prep AI requires completeChat.',
        500,
      )
    }
    const access = await serviceAccess(args.actor, args.workspace, 'ai', args.signal)
    const plan = await buildAiPlan(mode, args, access)
    const idempotencyKey = normalizeInterviewIdempotencyKey(args.idempotencyKey, {
      scope: 'interview_ai',
      seed: {
        mode,
        inputFingerprint: plan.bundle.inputFingerprint,
      },
    })
    const aiKey = await loadAiKey(args.aiKeyId, access, args.signal)
    const prior = await priorAiResult(
      access,
      mode,
      idempotencyKey,
      plan.bundle,
      args.signal,
    )
    if (prior) return prior

    const inFlightKey = scopeKey(access.scope) + ':' + mode + ':' + idempotencyKey
    const existing = aiInFlight.get(inFlightKey)
    if (existing) {
      if (existing.inputFingerprint !== plan.bundle.inputFingerprint) {
        throw serviceError(
          'INTERVIEW_IDEMPOTENCY_CONFLICT',
          'The idempotency key is already running with different Interview AI input.',
          409,
        )
      }
      return existing.promise
    }

    const promise = (async () => {
      let completion
      try {
        completion = await aiGate.run(args.signal, () => completeChat({
          key: aiKey,
          system: plan.bundle.system,
          user: plan.bundle.user,
          signal: args.signal,
          temperature: 0.2,
          maxTokens: mode === 'question_bank'
            ? 8_000
            : mode === 'answer_deepening'
              ? 8_000
              : mode === 'mock_evaluation'
                ? 6_000
                : 3_000,
          webSearch: false,
          allowedDomains: [],
          outputSchema: plan.bundle.outputSchema,
          ...(aiKey.model === 'gpt-5.6-luna' ? { reasoningEffort: 'high' } : {}),
        }))
      } catch (error) {
        throw normalizeProviderFailure(error, args.signal)
      }
      const usage = normalizeUsage(completion?.usage)
      await adapterCall('recordAiUsage', {
        aiKeyId: aiKey.id,
        usage,
        mode,
        ownerId: access.scope.ownerId,
        teamId: access.scope.teamId,
        signal: null,
      })
      throwIfAborted(args.signal)

      const artifact = plan.parse(completion?.text, plan.bundle)
      const withMetadata = attachInterviewAiModelMetadata(artifact, {
        provider: aiKey.provider,
        model: aiKey.model,
        promptTemplateId: 'interview_' + mode + '_v1',
        promptVersion: '1',
        promptFingerprint: plan.bundle.promptFingerprint,
        requestId: idempotencyKey,
        generatedAt: now(),
        tokenUsage: {
          prompt: usage.inputTokens,
          completion: usage.outputTokens,
        },
      })

      const latestAccess = await serviceAccess(
        args.actor,
        args.workspace,
        'ai',
        args.signal,
      )
      await loadAiKey(args.aiKeyId, latestAccess, args.signal)
      const fresh = await plan.refresh()
      const expectedRevisions = sourceRevisionSnapshot(plan.sources)
      const currentRevisions = sourceRevisionSnapshot(fresh.sources)
      if (
        !sameSourceRevisions(expectedRevisions, currentRevisions)
        || fresh.bundle.inputFingerprint !== plan.bundle.inputFingerprint
      ) {
        throw serviceError(
          'INTERVIEW_AI_STALE_RESULT',
          'Interview content changed while AI was working; the generated result was not saved.',
          409,
          {
            expectedInputFingerprint: plan.bundle.inputFingerprint,
            currentInputFingerprint: fresh.bundle.inputFingerprint,
          },
        )
      }
      throwIfAborted(args.signal)

      const saved = await adapterCall('saveInterviewAiArtifact', {
        scope: access.scope,
        mode,
        artifact: withMetadata,
        idempotencyKey,
        inputFingerprint: plan.bundle.inputFingerprint,
        usage,
        expectedSourceRevisions: expectedRevisions,
        signal: args.signal,
      }, { optional: true })
      const savedArtifact = saved
        ? entityFromResult(saved, 'artifact')
        : withMetadata
      if (
        !savedArtifact
        || !verifyInterviewAiArtifactFingerprint(savedArtifact)
        || savedArtifact.inputFingerprint !== plan.bundle.inputFingerprint
      ) {
        throw serviceError(
          'INTERVIEW_STORAGE_SCOPE_VIOLATION',
          'Saved Interview AI artifact failed integrity validation.',
          500,
        )
      }
      return {
        artifact: savedArtifact,
        usage,
        cached: false,
        persisted: Boolean(saved),
      }
    })()
    aiInFlight.set(inFlightKey, {
      inputFingerprint: plan.bundle.inputFingerprint,
      promise,
    })
    try {
      return await promise
    } finally {
      if (aiInFlight.get(inFlightKey)?.promise === promise) aiInFlight.delete(inFlightKey)
    }
  }

  const generateQuestionBank = (args) => runAiOperation('question_bank', args)
  const deepenSelectedAnswer = (args) => runAiOperation('answer_deepening', args)
  const generateNextMockTurn = (args) => runAiOperation('next_mock_turn', args)
  const evaluateCompletedMock = (args) => runAiOperation('mock_evaluation', args)

  return {
    getWorkspaceSnapshot,
    getRepositoryAggregate,
    createRepository,
    updateRepository,
    deleteRepository,
    createItem,
    updateItem,
    deleteItem,
    createSession,
    updateSession,
    deleteSession,
    appendTurn,
    addTeacherFeedback,
    runAiOperation,
    generateQuestionBank,
    deepenSelectedAnswer,
    generateNextMockTurn,
    evaluateCompletedMock,
  }
}
