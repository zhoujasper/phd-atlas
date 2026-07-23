import { AiProviderError } from './aiProviders.js'

const RETRYABLE_PROVIDER_CODES = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
])

const RETRYABLE_OUTPUT_CODES = new Set([
  'EMPTY_DRAFT',
  'EMPTY_STREAM',
  'AI_RESPONSE_EMPTY',
  'AI_RESPONSE_INVALID',
  'AI_RESPONSE_SCHEMA_INVALID',
])

function normalizedUsage(value) {
  const inputTokens = Math.max(0, Number(value?.inputTokens) || 0)
  const outputTokens = Math.max(0, Number(value?.outputTokens) || 0)
  const totalTokens = Math.max(inputTokens + outputTokens, Number(value?.totalTokens) || 0)
  return { inputTokens, outputTokens, totalTokens }
}

function addUsage(left, right) {
  const first = normalizedUsage(left)
  const second = normalizedUsage(right)
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  }
}

function parseJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!cleaned) {
    throw new AiProviderError('AI_RESPONSE_EMPTY', 'The research agent returned an empty response.')
  }
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        // Fall through to one stable machine-readable error code.
      }
    }
    throw new AiProviderError('AI_RESPONSE_INVALID', 'The research agent returned malformed JSON.')
  }
}

/**
 * Validate the hand-off between a provider and the deterministic evidence
 * pipeline. This is deliberately about shape, not trust: URLs and facts still
 * have to pass the crawler and source-grounding gates after this check.
 */
export function validateDiscoverAgentCompletion(completion) {
  const parsed = parseJsonObject(completion?.text)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new AiProviderError('AI_RESPONSE_SCHEMA_INVALID', 'The research agent response must be a JSON object.')
  }
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.suggestedPrograms)) {
    throw new AiProviderError('AI_RESPONSE_SCHEMA_INVALID', 'The research agent response does not match the required schema.')
  }
  if (parsed.enrichments != null && !Array.isArray(parsed.enrichments)) {
    throw new AiProviderError('AI_RESPONSE_SCHEMA_INVALID', 'The research agent enrichments must be an array.')
  }
  for (const program of parsed.suggestedPrograms) {
    if (!program || Array.isArray(program) || typeof program !== 'object') {
      throw new AiProviderError('AI_RESPONSE_SCHEMA_INVALID', 'The research agent returned an invalid program record.')
    }
    if (
      typeof program.school !== 'string'
      || typeof program.program !== 'string'
      || typeof program.website !== 'string'
      || !Array.isArray(program.sources)
      || !Array.isArray(program.pis)
    ) {
      throw new AiProviderError('AI_RESPONSE_SCHEMA_INVALID', 'The research agent program record does not match the required schema.')
    }
  }
  return parsed
}

export function isRetryableDiscoverAgentError(error) {
  const code = String(error?.code || '')
  return RETRYABLE_PROVIDER_CODES.has(code) || RETRYABLE_OUTPUT_CODES.has(code)
}

function fallbackCompletion(error, usage) {
  const code = String(error?.code || 'PROVIDER_UNAVAILABLE')
  return {
    text: JSON.stringify({
      summary: `Agent batch unavailable after bounded retry (${code}); prior verified records were preserved.`,
      suggestedPrograms: [],
    }),
    // Citations from an empty, malformed, or schema-invalid response never
    // enlarge the evidence allow-list. A later valid retry supplies its own
    // independently auditable citations.
    sources: [],
    usage,
    providerError: {
      code,
      message: String(error?.message || '').slice(0, 240),
    },
  }
}

/**
 * Execute one independent agent batch with bounded retry. Provider transport
 * failures and malformed/empty model output degrade only this batch. Auth,
 * key, endpoint and other configuration errors are intentionally re-thrown so
 * the API can reject them instead of pretending research was successful.
 */
export async function runDiscoverAgentWithRetry({
  complete,
  attempts = 2,
  retryDelayMs = 500,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (typeof complete !== 'function') throw new TypeError('A Discover agent completion function is required.')
  const boundedAttempts = Math.min(4, Math.max(1, Number(attempts) || 1))
  let lastError = null
  let usage = normalizedUsage()
  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      const completion = await complete(attempt)
      usage = addUsage(usage, completion?.usage)
      validateDiscoverAgentCompletion(completion)
      return {
        ...completion,
        sources: [...new Set((completion?.sources || [])
          .filter((source) => typeof source === 'string' && /^https:\/\//i.test(source)))],
        usage,
      }
    } catch (error) {
      lastError = error
      if (!isRetryableDiscoverAgentError(error)) throw error
      if (attempt < boundedAttempts && retryDelayMs > 0) {
        await wait(Math.max(0, retryDelayMs) * attempt)
      }
    }
  }
  return fallbackCompletion(lastError, usage)
}

/**
 * Checkpoints improve resume speed, but a temporary filesystem replacement
 * failure must not invalidate a result that is still safely held in memory.
 * The caller can surface the bounded audit metadata on the completed job.
 */
export function createNonFatalCheckpointWriter(onCheckpoint, { maxRecordedFailures = 8 } = {}) {
  let failureCount = 0
  const failures = []
  const write = async (value) => {
    if (typeof onCheckpoint !== 'function') return true
    try {
      await onCheckpoint(value)
      return true
    } catch (error) {
      failureCount += 1
      if (failures.length < Math.max(0, maxRecordedFailures)) {
        failures.push({
          stage: String(value?.stage || 'unknown'),
          code: String(error?.code || error?.name || 'CHECKPOINT_WRITE_FAILED').slice(0, 80),
        })
      }
      return false
    }
  }
  Object.defineProperties(write, {
    failureCount: { get: () => failureCount },
    failures: { get: () => [...failures] },
  })
  return write
}
