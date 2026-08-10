import { createHash } from 'node:crypto'
import {
  MAIL_CLASSIFICATION_CATEGORIES,
  MAIL_CLASSIFICATION_LIMITS,
  MAIL_CLASSIFICATION_OUTPUT_SCHEMA,
  buildMailClassificationPrompts,
  mailClassificationOutputSchema,
  parseMailClassificationResponse,
} from './mailClassification.js'
import {
  MAIL_CLASSIFICATION_THREAD_CONTEXT_ITEMS,
  isMailClassificationEmail,
  isMailClassificationIncomingEmail,
  isMailClassificationUnsafe,
  mailClassificationInputForCommunication,
} from './mailClassificationContext.js'

export const MAIL_CLASSIFICATION_SERVICE_LIMITS = Object.freeze({
  communicationIds: 50,
  communicationIdChars: 160,
  idempotencyKeyChars: 200,
  keyIdChars: 160,
  threadContextItems: MAIL_CLASSIFICATION_THREAD_CONTEXT_ITEMS,
  maxConcurrentBatches: 4,
  maxConcurrentItems: 3,
})

export const MAIL_CLASSIFICATION_VERSION = 1

const CATEGORY_SET = new Set(MAIL_CLASSIFICATION_CATEGORIES)
const CONFLICT_CODES = new Set([
  'CONFLICT',
  'REVISION_CONFLICT',
  'VERSION_CONFLICT',
  'CAS_MISMATCH',
  'PRECONDITION_FAILED',
])

export class MailClassificationServiceError extends Error {
  constructor(code, message, status = 400, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'MailClassificationServiceError'
    this.code = code
    this.status = status
    this.statusCode = status
    if (options.field) this.field = options.field
    if (options.retryAfter) this.retryAfter = options.retryAfter
  }
}

function serviceError(code, message, status, options) {
  return new MailClassificationServiceError(code, message, status, options)
}

function abortError(signal) {
  return serviceError(
    'MAIL_CLASSIFICATION_ABORTED',
    signal?.reason instanceof Error && signal.reason.message
      ? 'Mail classification was cancelled.'
      : 'Mail classification was cancelled.',
    499,
  )
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal)
}

function normalizedString(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function normalizeCommunicationIds(value) {
  if (!Array.isArray(value)) {
    throw serviceError(
      'MAIL_CLASSIFICATION_IDS_REQUIRED',
      'Choose one or more email messages.',
      400,
      { field: 'communicationIds' },
    )
  }
  const ids = []
  const seen = new Set()
  for (const rawId of value) {
    const id = normalizedString(rawId, MAIL_CLASSIFICATION_SERVICE_LIMITS.communicationIdChars + 1)
    if (!id || id.length > MAIL_CLASSIFICATION_SERVICE_LIMITS.communicationIdChars) {
      throw serviceError(
        'MAIL_CLASSIFICATION_ID_INVALID',
        'A selected email identifier is invalid.',
        400,
        { field: 'communicationIds' },
      )
    }
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length > MAIL_CLASSIFICATION_SERVICE_LIMITS.communicationIds) {
      throw serviceError(
        'MAIL_CLASSIFICATION_BATCH_TOO_LARGE',
        `Classify at most ${MAIL_CLASSIFICATION_SERVICE_LIMITS.communicationIds} emails at once.`,
        413,
        { field: 'communicationIds' },
      )
    }
  }
  if (ids.length === 0) {
    throw serviceError(
      'MAIL_CLASSIFICATION_IDS_REQUIRED',
      'Choose one or more email messages.',
      400,
      { field: 'communicationIds' },
    )
  }
  return ids
}

const CUSTOM_CATEGORY_PREFIX = 'custom:'
const MAX_MANUAL_CATEGORIES = 6

function isKnownCategory(value, allowedCustomIds) {
  if (typeof value !== 'string') return false
  if (CATEGORY_SET.has(value)) return true
  // A custom id is only accepted while this account still defines it, so a
  // deleted category cannot be re-applied through a replayed request.
  return value.startsWith(CUSTOM_CATEGORY_PREFIX) && allowedCustomIds.has(value)
}

/**
 * A message can be several things at once, so the manual selection is a list.
 * `null` and `[]` both mean "clear it". A single string is still accepted for
 * callers written against the earlier single-valued contract.
 */
function normalizeCategories(value, allowedCustomIds = new Set()) {
  if (value === null || value === undefined) return []
  const raw = Array.isArray(value) ? value : [value]
  const result = []
  for (const entry of raw) {
    if (!isKnownCategory(entry, allowedCustomIds)) {
      throw serviceError(
        'MAIL_CLASSIFICATION_CATEGORY_INVALID',
        'Choose a supported email category or clear the manual category.',
        400,
        { field: 'categories' },
      )
    }
    if (!result.includes(entry)) result.push(entry)
  }
  if (result.length > MAX_MANUAL_CATEGORIES) {
    throw serviceError(
      'MAIL_CLASSIFICATION_CATEGORY_INVALID',
      'A message can carry at most six categories.',
      400,
      { field: 'categories' },
    )
  }
  return result
}

function normalizeCategory(value) {
  if (value === null) return null
  if (typeof value === 'string' && CATEGORY_SET.has(value)) return value
  throw serviceError(
    'MAIL_CLASSIFICATION_CATEGORY_INVALID',
    'Choose a supported email category or clear the manual category.',
    400,
    { field: 'category' },
  )
}

function normalizedIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return ''
  const key = normalizedString(value, MAIL_CLASSIFICATION_SERVICE_LIMITS.idempotencyKeyChars + 1)
  if (!key || key.length > MAIL_CLASSIFICATION_SERVICE_LIMITS.idempotencyKeyChars) {
    throw serviceError(
      'MAIL_CLASSIFICATION_IDEMPOTENCY_KEY_INVALID',
      'The idempotency key is invalid.',
      400,
      { field: 'idempotencyKey' },
    )
  }
  return key
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function commitIdentity({ operation, applicationId, actor, idempotencyKey, payloadFingerprint }) {
  const actorId = normalizedString(actor?.id ?? actor?.userId, 160) || 'anonymous'
  const scope = `${operation}\u0000${applicationId}\u0000${actorId}`
  const stableKey = idempotencyKey
    ? `${scope}\u0000${idempotencyKey}`
    : `${scope}\u0000${payloadFingerprint}`
  return {
    idempotencyKey: `mail_classification_${digest(stableKey)}`,
    idempotencyFingerprint: payloadFingerprint,
    inFlightKey: idempotencyKey ? digest(`${stableKey}\u0000${payloadFingerprint}`) : '',
    durable: Boolean(idempotencyKey),
  }
}

function unwrapApplication(value) {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value.communications)) return value
  if (value.application && Array.isArray(value.application.communications)) return value.application
  if (value.data?.application && Array.isArray(value.data.application.communications)) {
    return value.data.application
  }
  return null
}

function revisionToken(wrapper, application) {
  return wrapper?.revision
    ?? wrapper?.version
    ?? application?.revision
    ?? application?.version
    ?? application?.updatedAt
    ?? null
}

function applicationRead(value, applicationId) {
  const application = unwrapApplication(value)
  if (!application) {
    throw serviceError(
      'MAIL_CLASSIFICATION_APPLICATION_NOT_FOUND',
      'Application not found.',
      404,
    )
  }
  if (application.id !== undefined && String(application.id) !== String(applicationId)) {
    throw serviceError(
      'MAIL_CLASSIFICATION_APPLICATION_NOT_FOUND',
      'Application not found.',
      404,
    )
  }
  return {
    application,
    revision: revisionToken(value, application),
    release: typeof value?.release === 'function' ? value.release : () => {},
  }
}

function selectedCommunications(
  application,
  communicationIds,
  { blockUnsafe = false, incomingOnly = false } = {},
) {
  const byId = new Map((application.communications ?? []).map((communication) => [
    String(communication?.id ?? ''),
    communication,
  ]))
  const selected = []
  for (const id of communicationIds) {
    const communication = byId.get(id)
    if (!communication) {
      throw serviceError(
        'MAIL_CLASSIFICATION_COMMUNICATION_NOT_FOUND',
        'A selected email no longer exists.',
        404,
      )
    }
    if (!isMailClassificationEmail(communication) || (incomingOnly && !isMailClassificationIncomingEmail(communication))) {
      throw serviceError(
        'MAIL_CLASSIFICATION_EMAIL_REQUIRED',
        incomingOnly
          ? 'Only received email can be AI-classified.'
          : 'Only sent or received email can be classified.',
        422,
      )
    }
    if (blockUnsafe && isMailClassificationUnsafe(communication)) {
      throw serviceError(
        'MAIL_CLASSIFICATION_UNSAFE_MAIL',
        'AI classification is blocked for a security-flagged email.',
        422,
      )
    }
    selected.push(communication)
  }
  return selected
}

function scopeForApplication(application, applicationOwnerId, actor) {
  const teamId = normalizedString(application?.teamId, 160)
  if (teamId) return { scope: 'team', teamId }
  const ownerId = normalizedString(
    application?.ownerId ?? applicationOwnerId ?? actor?.id ?? actor?.userId,
    160,
  )
  if (!ownerId) {
    throw serviceError(
      'MAIL_CLASSIFICATION_OWNER_REQUIRED',
      'The personal application owner could not be resolved.',
      422,
    )
  }
  return { scope: 'personal', ownerId }
}

function assertKeyScope(key, keyId, requiredScope) {
  if (!key || typeof key !== 'object' || String(key.id ?? '') !== keyId) {
    throw serviceError(
      'MAIL_CLASSIFICATION_KEY_NOT_FOUND',
      'AI key not found.',
      404,
      { field: 'keyId' },
    )
  }
  if (!normalizedString(key.apiKey, 100_000)) {
    throw serviceError(
      'MAIL_CLASSIFICATION_KEY_UNAVAILABLE',
      'The selected AI key is unavailable.',
      422,
      { field: 'keyId' },
    )
  }
  const matches = requiredScope.scope === 'team'
    ? key.scope === 'team' && key.teamId === requiredScope.teamId
    : key.scope === 'personal' && key.ownerId === requiredScope.ownerId
  if (!matches) {
    throw serviceError(
      'MAIL_CLASSIFICATION_KEY_SCOPE_MISMATCH',
      'The selected AI key cannot be used for this application.',
      403,
      { field: 'keyId' },
    )
  }
}

function timestampFrom(now) {
  const value = now()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw serviceError(
      'MAIL_CLASSIFICATION_CLOCK_INVALID',
      'The server clock could not produce a classification timestamp.',
      500,
    )
  }
  return date.toISOString()
}

function aggregateUsage(records) {
  const result = { calls: records.length, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  for (const record of records) {
    const inputTokens = Math.max(0, Math.round(Number(record?.inputTokens ?? 0) || 0))
    const outputTokens = Math.max(0, Math.round(Number(record?.outputTokens ?? 0) || 0))
    const totalTokens = Math.max(
      inputTokens + outputTokens,
      Math.round(Number(record?.totalTokens ?? 0) || 0),
    )
    result.inputTokens += inputTokens
    result.outputTokens += outputTokens
    result.totalTokens += totalTokens
  }
  return result
}

function normalizedProviderFailure(error, signal) {
  if (error instanceof MailClassificationServiceError) return error
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return abortError(signal)
  if (String(error?.code ?? '').startsWith('MAIL_CLASSIFICATION_')) {
    return serviceError(error.code, error.message || 'The AI classification response was invalid.', 502, { cause: error })
  }
  if (error?.code === 'PROVIDER_RATE_LIMITED') {
    return serviceError(
      'MAIL_CLASSIFICATION_PROVIDER_BUSY',
      'The AI provider is busy. Please retry shortly.',
      429,
      { cause: error, retryAfter: 30 },
    )
  }
  if (error?.code === 'PROVIDER_TIMEOUT') {
    return serviceError(
      'MAIL_CLASSIFICATION_PROVIDER_TIMEOUT',
      'The AI provider took too long to classify this email.',
      504,
      { cause: error },
    )
  }
  return serviceError(
    'MAIL_CLASSIFICATION_PROVIDER_FAILED',
    'The AI provider could not classify this email.',
    502,
    { cause: error },
  )
}

function parseStrictProviderResponse(value, allowedCustomCategoryIds = []) {
  if (typeof value !== 'string' || !value.trim()) {
    throw serviceError(
      'MAIL_CLASSIFICATION_RESPONSE_EMPTY',
      'Mail classification returned an empty response.',
      502,
    )
  }
  if (value.length > MAIL_CLASSIFICATION_LIMITS.responseChars) {
    throw serviceError(
      'MAIL_CLASSIFICATION_RESPONSE_TOO_LARGE',
      'Mail classification response exceeded its size limit.',
      502,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(value.trim())
  } catch (error) {
    throw serviceError(
      'MAIL_CLASSIFICATION_INVALID_JSON',
      'Mail classification must be exactly one JSON object.',
      502,
      { cause: error },
    )
  }
  return parseMailClassificationResponse(parsed, { allowedCustomCategoryIds })
}

function normalizedCommitFailure(error, signal) {
  if (error instanceof MailClassificationServiceError) return error
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return abortError(signal)
  if (
    error?.code === 'MAIL_CLASSIFICATION_IDEMPOTENCY_CONFLICT'
    || error?.code === 'MAIL_CLASSIFICATION_IN_PROGRESS'
    || error?.code === 'MAIL_CLASSIFICATION_TASK_CAPACITY'
    || error?.code === 'MAIL_CLASSIFICATION_FORBIDDEN'
    || error?.code === 'MAIL_CLASSIFICATION_SESSION_INVALID'
  ) {
    return serviceError(
      error.code,
      error.message || 'The durable email-classification task could not be claimed.',
      Number(error.status ?? error.statusCode ?? 409),
      { cause: error, ...(error.code === 'MAIL_CLASSIFICATION_IN_PROGRESS' ? { retryAfter: 3 } : {}) },
    )
  }
  if (CONFLICT_CODES.has(error?.code) || error?.status === 409 || error?.statusCode === 409) {
    return serviceError(
      'MAIL_CLASSIFICATION_CONFLICT',
      'The email changed before the classification could be saved. Retry with the latest version.',
      409,
      { cause: error },
    )
  }
  return serviceError(
    'MAIL_CLASSIFICATION_SAVE_FAILED',
    'The email classification could not be saved.',
    503,
    { cause: error },
  )
}

function normalizedTaskFailure(error, signal) {
  if (error instanceof MailClassificationServiceError) return error
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return abortError(signal)
  if (String(error?.code ?? '').startsWith('MAIL_CLASSIFICATION_')) {
    return serviceError(
      error.code,
      error.message || 'The durable email-classification task could not be updated.',
      Number(error.status ?? error.statusCode ?? 503),
      { cause: error, ...(error.code === 'MAIL_CLASSIFICATION_IN_PROGRESS' ? { retryAfter: 3 } : {}) },
    )
  }
  return serviceError(
    'MAIL_CLASSIFICATION_TASK_FAILED',
    'The durable email-classification task could not be updated.',
    503,
    { cause: error },
  )
}

function communicationsFromCommit(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.communications)) return value.communications
  if (Array.isArray(value?.application?.communications)) return value.application.communications
  if (Array.isArray(value?.data?.communications)) return value.data.communications
  if (Array.isArray(value?.data?.application?.communications)) return value.data.application.communications
  return null
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function acknowledgedUpdate(actual, update) {
  if (!actual) return false
  if (Object.hasOwn(update, 'mailCategories')) {
    const actualCategories = Array.isArray(actual.mailCategories)
      ? actual.mailCategories
      : actual.mailCategoryOverride
        ? [actual.mailCategoryOverride]
        : []
    const expectedCategories = Array.isArray(update.mailCategories) ? update.mailCategories : []
    if (!sameStringArray(actualCategories, expectedCategories)) return false
  }
  if (Object.hasOwn(update, 'mailCategoryOverride')) {
    if (update.mailCategoryOverride === null) {
      if (!(actual.mailCategoryOverride === null || actual.mailCategoryOverride === undefined)) return false
    } else if (actual.mailCategoryOverride !== update.mailCategoryOverride) {
      return false
    }
    return true
  }
  const expected = update.mailClassification
  const classification = actual.mailClassification
  return Boolean(
    classification
    && classification.category === expected.category
    && classification.confidence === expected.confidence
    && classification.summary === expected.summary
    && sameStringArray(classification.evidence, expected.evidence)
    && sameStringArray(classification.actions, expected.actions)
    && classification.source === expected.source
    && classification.classifiedAt === expected.classifiedAt
    && classification.inputHash === expected.inputHash
    && classification.version === expected.version,
  )
}

function canonicalAcknowledgement(commitResult, updates) {
  const communications = communicationsFromCommit(commitResult)
  if (!communications) {
    throw serviceError(
      'MAIL_CLASSIFICATION_ACK_INVALID',
      'The server did not acknowledge the saved email classification.',
      502,
    )
  }
  const byId = new Map(communications.map((communication) => [String(communication?.id ?? ''), communication]))
  if (updates.some((update) => !acknowledgedUpdate(byId.get(update.id), update))) {
    throw serviceError(
      'MAIL_CLASSIFICATION_ACK_INVALID',
      'The server did not acknowledge the saved email classification.',
      502,
    )
  }
  return communications
}

function sanitizeStoredClassification(value) {
  if (!value || typeof value !== 'object') return undefined
  const storedCategory = (candidate) => (
    typeof candidate === 'string'
      && candidate.length <= 64
      && (CATEGORY_SET.has(candidate) || candidate.startsWith('custom:'))
      ? candidate
      : null
  )
  const category = storedCategory(value.category)
  if (!category) return undefined
  const sanitized = {
    category,
    confidence: Number.isFinite(value.confidence) ? Math.min(1, Math.max(0, value.confidence)) : 0,
    summary: typeof value.summary === 'string' ? value.summary : '',
    evidence: Array.isArray(value.evidence) ? value.evidence.filter((item) => typeof item === 'string') : [],
    actions: Array.isArray(value.actions) ? value.actions.filter((item) => typeof item === 'string') : [],
    source: value.source === 'rule' ? 'rule' : 'ai',
    classifiedAt: typeof value.classifiedAt === 'string' ? value.classifiedAt : '',
    inputHash: typeof value.inputHash === 'string' ? value.inputHash : '',
    version: Number.isSafeInteger(value.version) && value.version > 0
      ? value.version
      : MAIL_CLASSIFICATION_VERSION,
  }
  if (Array.isArray(value.categories)) {
    const categories = [...new Set(value.categories.map(storedCategory).filter(Boolean))].slice(0, 6)
    if (!categories.includes(category)) categories.unshift(category)
    sanitized.categories = categories.slice(0, 6)
  }
  return sanitized
}

function sanitizeCommunicationForClient(communication) {
  const classification = sanitizeStoredClassification(communication?.mailClassification)
  return {
    id: String(communication?.id ?? ''),
    mailCategories: Array.isArray(communication?.mailCategories)
      ? [...communication.mailCategories]
      : null,
    mailCategoryOverride: communication?.mailCategoryOverride ?? null,
    mailClassification: classification ?? null,
  }
}

function selectCanonicalForResponse(communications, communicationIds) {
  const byId = new Map(communications.map((communication) => [String(communication?.id ?? ''), communication]))
  return communicationIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(sanitizeCommunicationForClient)
}

function durableTaskReplay(taskResult, communicationIds) {
  const communications = communicationsFromCommit(taskResult)
  if (!communications) {
    throw serviceError(
      'MAIL_CLASSIFICATION_ACK_INVALID',
      'The durable email-classification acknowledgement is unavailable.',
      502,
    )
  }
  const selected = selectCanonicalForResponse(communications, communicationIds)
  if (selected.length !== communicationIds.length) {
    throw serviceError(
      'MAIL_CLASSIFICATION_ACK_INVALID',
      'The durable email-classification acknowledgement is incomplete.',
      502,
    )
  }
  return { communications: selected, revision: revisionToken(taskResult, null) }
}

async function parallelMap(values, concurrency, operation, signal) {
  const results = new Array(values.length)
  let cursor = 0
  let failure = null
  const worker = async () => {
    while (!failure) {
      checkAbort(signal)
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      try {
        results[index] = await operation(values[index], index)
      } catch (error) {
        failure = error
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ))
  if (failure) throw failure
  return results
}

function classifyPayloadFingerprint({ keyId, force, communicationIds, snapshots, outputLanguage, customCategories }) {
  return digest(JSON.stringify({
    keyId,
    force: Boolean(force),
    communicationIds,
    inputHashes: snapshots.map((snapshot) => snapshot.inputHash),
    outputLanguage: normalizedString(outputLanguage, 80),
    customCategories,
  }))
}

function manualPayloadFingerprint({ categories, communicationIds }) {
  return digest(JSON.stringify({ categories, communicationIds }))
}

/**
 * Construct the mail-classification service around explicit authorization and
 * persistence callbacks. The service never reads a global store and never
 * exposes provider, model, key metadata, or raw reasoning to its caller.
 */
export function createMailClassificationService({
  readApplication,
  resolveAiKey,
  completeChat,
  commitCommunications,
  claimTask = async () => ({ state: 'claimed', leaseToken: null }),
  saveTaskProgress = async () => ({ state: 'prepared' }),
  releaseTask = async () => false,
  recordUsage = async () => {},
  onOperationalError = () => {},
  now = () => new Date(),
  maxConcurrentBatches = MAIL_CLASSIFICATION_SERVICE_LIMITS.maxConcurrentBatches,
  maxConcurrentItems = MAIL_CLASSIFICATION_SERVICE_LIMITS.maxConcurrentItems,
} = {}) {
  for (const [name, dependency] of Object.entries({
    readApplication,
    resolveAiKey,
    completeChat,
    commitCommunications,
  })) {
    if (typeof dependency !== 'function') throw new TypeError(`${name} must be a function.`)
  }
  if (typeof recordUsage !== 'function') throw new TypeError('recordUsage must be a function.')
  if (typeof onOperationalError !== 'function') throw new TypeError('onOperationalError must be a function.')
  if (typeof now !== 'function') throw new TypeError('now must be a function.')
  if (typeof claimTask !== 'function') throw new TypeError('claimTask must be a function.')
  if (typeof saveTaskProgress !== 'function') throw new TypeError('saveTaskProgress must be a function.')
  if (typeof releaseTask !== 'function') throw new TypeError('releaseTask must be a function.')

  const batchCapacity = Math.max(1, Math.min(32, Math.floor(Number(maxConcurrentBatches) || 1)))
  const itemConcurrency = Math.max(1, Math.min(10, Math.floor(Number(maxConcurrentItems) || 1)))
  const inFlight = new Map()
  let activeBatches = 0

  const read = async ({ applicationId, actor, signal }) => {
    checkAbort(signal)
    let value
    try {
      value = await readApplication({ applicationId, actor, signal })
    } catch (error) {
      if (error instanceof MailClassificationServiceError) throw error
      if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal)
      throw serviceError(
        'MAIL_CLASSIFICATION_READ_FAILED',
        'The application could not be read.',
        503,
        { cause: error },
      )
    }
    checkAbort(signal)
    return applicationRead(value, applicationId)
  }

  const commit = async ({
    applicationId,
    actor,
    expectedRevision,
    expectedOwnerId,
    expectedTeamId,
    updates,
    selectedCommunicationIds,
    resultMetadata,
    identity,
    leaseToken,
    signal,
  }) => {
    checkAbort(signal)
    let result
    try {
      result = await commitCommunications({
        applicationId,
        actor,
        expectedRevision,
        expectedOwnerId,
        expectedTeamId,
        updates,
        idempotencyKey: identity.idempotencyKey,
        idempotencyFingerprint: identity.idempotencyFingerprint,
        durableIdempotency: identity.durable,
        leaseToken,
        selectedCommunicationIds,
        resultMetadata,
        signal,
      })
    } catch (error) {
      throw normalizedCommitFailure(error, signal)
    }
    checkAbort(signal)
    return {
      result,
      communications: canonicalAcknowledgement(result, updates),
      revision: revisionToken(result, unwrapApplication(result)),
    }
  }

  const claimDurableTask = async ({ identity, operation, applicationId, actor, signal }) => {
    if (!identity.durable) return { state: 'claimed', leaseToken: null }
    checkAbort(signal)
    try {
      return await claimTask({
        idempotencyKey: identity.idempotencyKey,
        fingerprint: identity.idempotencyFingerprint,
        operation,
        applicationId,
        actor,
        signal,
      })
    } catch (error) {
      throw normalizedTaskFailure(error, signal)
    }
  }

  const saveDurableTaskProgress = async ({ identity, operation, applicationId, actor, leaseToken, updates, signal }) => {
    if (!identity.durable) return { state: 'prepared' }
    checkAbort(signal)
    try {
      return await saveTaskProgress({
        idempotencyKey: identity.idempotencyKey,
        fingerprint: identity.idempotencyFingerprint,
        operation,
        applicationId,
        actor,
        leaseToken,
        updates,
        signal,
      })
    } catch (error) {
      throw normalizedTaskFailure(error, signal)
    }
  }

  const releaseDurableTask = async ({ identity, operation, applicationId, actor, leaseToken }) => {
    if (!identity.durable || !leaseToken) return
    try {
      await releaseTask({
        idempotencyKey: identity.idempotencyKey,
        fingerprint: identity.idempotencyFingerprint,
        operation,
        applicationId,
        actor,
        leaseToken,
      })
    } catch (error) {
      try {
        onOperationalError(error, {
          code: 'MAIL_CLASSIFICATION_TASK_RELEASE_FAILED',
          applicationId,
        })
      } catch {
        // A cleanup signal cannot replace the primary request outcome.
      }
    }
  }

  const coalesced = (key, operation) => {
    if (!key) return operation()
    const current = inFlight.get(key)
    if (current) return current
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key)
      })
    inFlight.set(key, promise)
    return promise
  }

  const withBatchAdmission = async (operation) => {
    if (activeBatches >= batchCapacity) {
      throw serviceError(
        'MAIL_CLASSIFICATION_CAPACITY_EXCEEDED',
        'The email classification service is busy. Please retry shortly.',
        429,
        { retryAfter: 15 },
      )
    }
    activeBatches += 1
    try {
      return await operation()
    } finally {
      activeBatches -= 1
    }
  }

  const setManualCategories = async ({
    applicationId: rawApplicationId,
    communicationIds: rawCommunicationIds,
    category: rawCategory,
    categories: rawCategories,
    allowedCustomCategoryIds = [],
    actor = null,
    idempotencyKey: rawIdempotencyKey,
    signal,
  } = {}) => {
    const applicationId = normalizedString(rawApplicationId, 160)
    if (!applicationId) {
      throw serviceError('MAIL_CLASSIFICATION_APPLICATION_REQUIRED', 'Application id is required.', 400)
    }
    const communicationIds = normalizeCommunicationIds(rawCommunicationIds)
    const categories = normalizeCategories(
      rawCategories === undefined ? rawCategory : rawCategories,
      new Set(allowedCustomCategoryIds),
    )
    const idempotencyKey = normalizedIdempotencyKey(rawIdempotencyKey)
    const payloadFingerprint = manualPayloadFingerprint({ categories, communicationIds })
    const identity = commitIdentity({
      operation: 'manual',
      applicationId,
      actor,
      idempotencyKey,
      payloadFingerprint,
    })

    return coalesced(identity.inFlightKey, async () => {
      const initial = await read({ applicationId, actor, signal })
      let task = null
      let committed = false
      try {
        const selected = selectedCommunications(initial.application, communicationIds)
        task = await claimDurableTask({
          identity,
          operation: 'manual',
          applicationId,
          actor,
          signal,
        })
        if (task?.state === 'committed') {
          const replay = durableTaskReplay(task.result, communicationIds)
          return {
            ...replay,
            updatedIds: Array.isArray(task.result?.updatedIds) ? task.result.updatedIds : communicationIds,
          }
        }
        // Writing both shapes keeps a client that only reads the old single
        // value showing the primary category instead of nothing at all.
        const primaryCategory = categories.find((entry) => CATEGORY_SET.has(entry)) ?? null
        const sameAsStored = (communication) => {
          const stored = Array.isArray(communication.mailCategories)
            ? communication.mailCategories
            : communication.mailCategoryOverride
              ? [communication.mailCategoryOverride]
              : []
          return stored.length === categories.length
            && stored.every((entry, index) => entry === categories[index])
        }
        const updates = selected
          .filter((communication) => !sameAsStored(communication))
          .map((communication) => ({
            id: String(communication.id),
            mailCategories: categories.length > 0 ? categories : null,
            mailCategoryOverride: primaryCategory,
          }))

        if (updates.length === 0) {
          await releaseDurableTask({
            identity,
            operation: 'manual',
            applicationId,
            actor,
            leaseToken: task?.leaseToken,
          })
          task = null
          return {
            communications: selected.map(sanitizeCommunicationForClient),
            updatedIds: [],
            revision: initial.revision,
          }
        }
        const saved = await commit({
          applicationId,
          actor,
          expectedRevision: initial.revision,
          expectedOwnerId: initial.application.ownerId,
          expectedTeamId: initial.application.teamId ?? null,
          updates,
          selectedCommunicationIds: communicationIds,
          resultMetadata: { updatedIds: updates.map((update) => update.id) },
          identity,
          leaseToken: task?.leaseToken,
          signal,
        })
        committed = true
        return {
          communications: selectCanonicalForResponse(saved.communications, communicationIds),
          updatedIds: updates.map((update) => update.id),
          revision: saved.revision,
        }
      } finally {
        initial.release()
        if (!committed && task?.leaseToken) {
          await releaseDurableTask({
            identity,
            operation: 'manual',
            applicationId,
            actor,
            leaseToken: task.leaseToken,
          })
        }
      }
    })
  }

  const classifyCommunications = async ({
    applicationId: rawApplicationId,
    applicationOwnerId,
    communicationIds: rawCommunicationIds,
    keyId: rawKeyId,
    force = false,
    outputLanguage = '',
    customCategories = [],
    actor = null,
    idempotencyKey: rawIdempotencyKey,
    signal,
  } = {}) => {
    const applicationId = normalizedString(rawApplicationId, 160)
    const keyId = normalizedString(rawKeyId, MAIL_CLASSIFICATION_SERVICE_LIMITS.keyIdChars + 1)
    if (!applicationId) {
      throw serviceError('MAIL_CLASSIFICATION_APPLICATION_REQUIRED', 'Application id is required.', 400)
    }
    if (!keyId || keyId.length > MAIL_CLASSIFICATION_SERVICE_LIMITS.keyIdChars) {
      throw serviceError(
        'MAIL_CLASSIFICATION_KEY_REQUIRED',
        'Choose an AI key for email classification.',
        400,
        { field: 'keyId' },
      )
    }
    const communicationIds = normalizeCommunicationIds(rawCommunicationIds)
    const idempotencyKey = normalizedIdempotencyKey(rawIdempotencyKey)
    const initial = await read({ applicationId, actor, signal })
    try {
      const selected = selectedCommunications(initial.application, communicationIds, {
        blockUnsafe: true,
        incomingOnly: true,
      })
      const requiredScope = scopeForApplication(initial.application, applicationOwnerId, actor)
      const snapshots = selected.map((communication) => {
        const prompts = buildMailClassificationPrompts(
          mailClassificationInputForCommunication(initial.application, communication, outputLanguage),
          { customCategories },
        )
        const customCategoryIds = prompts.customCategories.map((category) => category.id)
        return {
          id: String(communication.id),
          prompts,
          customCategoryIds,
          inputHash: prompts.contentFingerprint,
          currentClassification: communication.mailClassification,
        }
      })
      const payloadFingerprint = classifyPayloadFingerprint({
        keyId,
        force,
        communicationIds,
        snapshots,
        outputLanguage,
        customCategories: snapshots[0]?.prompts.customCategories ?? [],
      })
      const identity = commitIdentity({
        operation: 'ai',
        applicationId,
        actor,
        idempotencyKey,
        payloadFingerprint,
      })
      return await coalesced(identity.inFlightKey, () => withBatchAdmission(async () => {
        checkAbort(signal)
        let key
        try {
          key = await resolveAiKey({
            keyId,
            applicationId,
            application: initial.application,
            actor,
            requiredScope,
            signal,
          })
        } catch (error) {
          if (error instanceof MailClassificationServiceError) throw error
          if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal)
          throw serviceError(
            'MAIL_CLASSIFICATION_KEY_ACCESS_FAILED',
            'The selected AI key could not be authorized.',
            503,
            { cause: error },
          )
        }
        checkAbort(signal)
        assertKeyScope(key, keyId, requiredScope)

        let task = null
        let taskCommitted = false
        let latest = null
        try {
          task = await claimDurableTask({
            identity,
            operation: 'ai',
            applicationId,
            actor,
            signal,
          })
          if (task?.state === 'committed') {
            const replay = durableTaskReplay(task.result, communicationIds)
            return {
              ...replay,
              classifiedIds: Array.isArray(task.result?.classifiedIds)
                ? task.result.classifiedIds
                : communicationIds,
              reusedIds: Array.isArray(task.result?.reusedIds) ? task.result.reusedIds : [],
            }
          }

          // Claim before the no-op shortcut. Otherwise a normal (non-force)
          // retry after a successful commit would observe the newly stored
          // classification, skip the durable journal, and return different
          // classified/reused metadata instead of the original exact result.
          const preparedIds = task?.state === 'prepared'
            ? new Set((task.updates ?? []).map((update) => String(update?.id ?? '')))
            : null
          const pending = preparedIds
            ? snapshots.filter((snapshot) => preparedIds.has(snapshot.id))
            : snapshots.filter((snapshot) => !(
                force !== true
                && snapshot.currentClassification?.source === 'ai'
                && snapshot.currentClassification?.inputHash === snapshot.inputHash
                && snapshot.currentClassification?.version === MAIL_CLASSIFICATION_VERSION
                && snapshot.customCategoryIds.length === 0
              ))
          if (pending.length === 0) {
            await releaseDurableTask({
              identity,
              operation: 'ai',
              applicationId,
              actor,
              leaseToken: task?.leaseToken,
            })
            task = null
            return {
              communications: selected.map(sanitizeCommunicationForClient),
              classifiedIds: [],
              reusedIds: communicationIds,
              revision: initial.revision,
            }
          }

          const usageRecords = []
          let completed
          let completedByProvider = false
          if (task?.state === 'prepared') {
            completed = Array.isArray(task.updates) ? structuredClone(task.updates) : []
            const pendingById = new Map(pending.map((snapshot) => [snapshot.id, snapshot]))
            if (
              completed.length !== pending.length
              || completed.some((update) => (
                !pendingById.has(String(update?.id ?? ''))
                || update?.mailClassification?.inputHash !== pendingById.get(String(update.id))?.inputHash
              ))
            ) {
              throw serviceError(
                'MAIL_CLASSIFICATION_TASK_PROGRESS_CONFLICT',
                'The prepared email-classification result no longer matches this request.',
                409,
              )
            }
          } else {
            let providerFailure = null
            try {
              completed = await parallelMap(pending, itemConcurrency, async (snapshot) => {
                checkAbort(signal)
                const completion = await completeChat({
                  key,
                  system: snapshot.prompts.system,
                  user: snapshot.prompts.user,
                  signal,
                  temperature: 0.1,
                  maxTokens: 768,
                  outputSchema: snapshot.customCategoryIds.length > 0
                    ? mailClassificationOutputSchema(snapshot.customCategoryIds)
                    : MAIL_CLASSIFICATION_OUTPUT_SCHEMA,
                  ...(normalizedString(key.model, 200).toLowerCase() === 'gpt-5.6-luna'
                    ? { reasoningEffort: 'high' }
                    : {}),
                })
                checkAbort(signal)
                const text = typeof completion === 'string' ? completion : completion?.text
                usageRecords.push(completion?.usage ?? {})
                const parsed = parseStrictProviderResponse(text, snapshot.customCategoryIds)
                return {
                  id: snapshot.id,
                  mailClassification: {
                    ...parsed,
                    source: 'ai',
                    classifiedAt: timestampFrom(now),
                    inputHash: snapshot.inputHash,
                    version: MAIL_CLASSIFICATION_VERSION,
                  },
                }
              }, signal)
              completedByProvider = true
            } catch (error) {
              providerFailure = normalizedProviderFailure(error, signal)
            }
            if (providerFailure) {
              if (usageRecords.length > 0) {
                try {
                  await recordUsage({
                    keyId,
                    applicationId,
                    actor,
                    operation: 'mail-classification',
                    usage: aggregateUsage(usageRecords),
                  })
                } catch (error) {
                  try {
                    onOperationalError(error, {
                      code: 'MAIL_CLASSIFICATION_USAGE_RECORD_FAILED',
                      applicationId,
                      keyId,
                    })
                  } catch {
                    // Accounting remains isolated from the provider failure.
                  }
                }
              }
              throw providerFailure
            }
            await saveDurableTaskProgress({
              identity,
              operation: 'ai',
              applicationId,
              actor,
              leaseToken: task?.leaseToken,
              updates: completed,
              signal,
            })
          }

          if (completedByProvider && usageRecords.length > 0) {
            try {
              await recordUsage({
                keyId,
                applicationId,
                actor,
                operation: 'mail-classification',
                usage: aggregateUsage(usageRecords),
              })
            } catch (error) {
              try {
                onOperationalError(error, {
                  code: 'MAIL_CLASSIFICATION_USAGE_RECORD_FAILED',
                  applicationId,
                  keyId,
                })
              } catch {
                // Accounting remains isolated from the durable result.
              }
            }
          }

          latest = await read({ applicationId, actor, signal })
          const latestScope = scopeForApplication(latest.application, applicationOwnerId, actor)
          if (JSON.stringify(latestScope) !== JSON.stringify(requiredScope)) {
            throw serviceError(
              'MAIL_CLASSIFICATION_CONFLICT',
              'The application scope changed during classification. Retry with the latest version.',
              409,
            )
          }
          assertKeyScope(key, keyId, latestScope)
          const latestSelected = selectedCommunications(latest.application, communicationIds, { blockUnsafe: true })
          const latestById = new Map(latestSelected.map((communication) => [String(communication.id), communication]))
          for (const snapshot of snapshots) {
            const communication = latestById.get(snapshot.id)
            const latestPrompts = buildMailClassificationPrompts(
              mailClassificationInputForCommunication(latest.application, communication, outputLanguage),
              { customCategories },
            )
            if (latestPrompts.contentFingerprint !== snapshot.inputHash) {
              throw serviceError(
                'MAIL_CLASSIFICATION_STALE',
                'An email changed during classification. No classifications were saved.',
                409,
              )
            }
          }

          const classifiedIds = completed.map((update) => update.id)
          const reusedIds = communicationIds.filter((id) => !classifiedIds.includes(id))
          const saved = await commit({
            applicationId,
            actor,
            expectedRevision: latest.revision,
            expectedOwnerId: latest.application.ownerId,
            expectedTeamId: latest.application.teamId ?? null,
            updates: completed,
            selectedCommunicationIds: communicationIds,
            resultMetadata: { classifiedIds, reusedIds },
            identity,
            leaseToken: task?.leaseToken,
            signal,
          })
          taskCommitted = true
          return {
            communications: selectCanonicalForResponse(saved.communications, communicationIds),
            classifiedIds,
            reusedIds,
            revision: saved.revision,
          }
        } finally {
          latest?.release()
          if (!taskCommitted && task?.leaseToken) {
            await releaseDurableTask({
              identity,
              operation: 'ai',
              applicationId,
              actor,
              leaseToken: task.leaseToken,
            })
          }
        }
      }))
    } finally {
      initial.release()
    }
  }

  return Object.freeze({ setManualCategories, classifyCommunications })
}
