import { createHash } from 'node:crypto'

import { AI_KEY_MAX_CONCURRENCY, normalizeAiKeyMaxConcurrency } from './shared/aiConcurrency.js'
import { normalizeAiKeyRequestMode } from './shared/aiKeyRouting.js'

import { AbortDeadlineError, withAbortDeadline } from './abortDeadline.js'
import { OutboundNetworkPolicyError } from './outboundNetworkPolicy.js'
import { pinnedHttpsFetch } from './pinnedHttpsFetch.js'
import { AiCapacityError, createAiAdmissionController } from './aiRuntimeGuard.js'

const PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    // Any local draft attachment may be selected; non-image files are inlined as text/base64 context.
    attachmentTypes: ['any'],
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    attachmentTypes: ['any'],
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    attachmentTypes: ['any'],
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    attachmentTypes: ['any'],
  },
}

export class AiProviderError extends Error {
  constructor(code, message, { status = null, retryAfterSeconds = null, upstreamStatus = null } = {}) {
    super(message)
    this.name = 'AiProviderError'
    this.code = code
    this.status = Number.isInteger(status) ? status : null
    // Provider status is diagnostic control-flow metadata only. It must not be
    // forwarded as our API status (for example, an upstream 401 must not make
    // the browser treat its own PhD Atlas session as unauthenticated).
    this.upstreamStatus = Number.isInteger(upstreamStatus) ? upstreamStatus : null
    this.retryAfterSeconds = Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds
      : null
  }
}

export function providerDefaults(provider) {
  return PROVIDER_DEFAULTS[provider] ?? null
}

function normalizedBaseUrl(provider, configuredUrl = '') {
  const fallback = providerDefaults(provider)?.baseUrl
  const candidate = (configuredUrl || fallback || '').trim().replace(/\/+$/, '')
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    throw new AiProviderError('INVALID_BASE_URL', 'The provider URL is invalid.')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    throw new AiProviderError('INVALID_BASE_URL', 'The provider URL must be a public HTTPS endpoint.')
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === '::1') {
    throw new AiProviderError('INVALID_BASE_URL', 'The provider URL must not point to a local network address.')
  }
  return parsed.toString().replace(/\/$/, '')
}

function openAiChatEndpoint(provider, configuredUrl) {
  const baseUrl = normalizedBaseUrl(provider, configuredUrl)
  const parsed = new URL(baseUrl)
  // OpenAI-compatible gateways commonly publish their host root in setup guides,
  // while the official APIs include /v1. Support both without special-casing a host.
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return provider === 'deepseek' ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`
  }
  return `${baseUrl}/chat/completions`
}

function openAiResponsesEndpoint(provider, configuredUrl) {
  const baseUrl = normalizedBaseUrl(provider, configuredUrl)
  const parsed = new URL(baseUrl)
  // The official default ends in /v1, while an explicitly configured root does
  // not. Keep both forms valid without opening this capability to arbitrary
  // OpenAI-compatible gateways that may not implement the Responses API.
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return provider === 'deepseek' ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`
  }
  return `${baseUrl}/responses`
}

function openAiModelsEndpoint(provider, configuredUrl) {
  const baseUrl = normalizedBaseUrl(provider, configuredUrl)
  const parsed = new URL(baseUrl)
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return provider === 'deepseek' ? `${baseUrl}/models` : `${baseUrl}/v1/models`
  }
  return `${baseUrl}/models`
}

const TRUSTED_RESPONSES_WEB_SEARCH_HOSTS = new Set([
  'api.openai.com',
  // Live-tested against /v1/models and /v1/responses with web_search on
  // 2026-07-22. The capability check below also pins the public HTTPS port
  // and the root or /v1 base path, so a same-host proxy path is not trusted.
  'lingsuan.top',
  // Live-tested on 2026-08-03 with the exact gpt-5.6-luna model plus one
  // Responses request combining web_search, strict JSON Schema output, and
  // reasoning. The same port/path/query constraints below remain mandatory.
  'sub2api.luchikey.com',
  // DeepSeek's official 2026 Responses compatibility explicitly supports
  // deepseek-v4-flash, reasoning effort and the server-side web_search tool.
  'api.deepseek.com',
])

/**
 * Responses web-search is not part of the generic Chat Completions contract.
 * Only explicitly live-tested endpoints may receive a /responses request;
 * every other OpenAI-compatible gateway stays on Chat Completions.
 */
export function supportsNativeOpenAiWebSearch(key) {
  if (!['openai', 'deepseek'].includes(key?.provider)) return false
  if (normalizeAiKeyRequestMode(key?.requestMode, key?.provider) === 'chat_completions') return false
  try {
    const url = new URL(normalizedBaseUrl(key.provider, key.baseUrl))
    const pathname = url.pathname.replace(/\/+$/, '')
    const trustedProviderHost = key.provider === 'deepseek'
      ? url.hostname.toLowerCase() === 'api.deepseek.com'
      : TRUSTED_RESPONSES_WEB_SEARCH_HOSTS.has(url.hostname.toLowerCase())
    const supportedModel = key.provider !== 'deepseek'
      || String(key.model || providerDefaults('deepseek').defaultModel).toLowerCase() === 'deepseek-v4-flash'
    return trustedProviderHost
      && supportedModel
      && (!url.port || url.port === '443')
      && (pathname === '' || pathname === '/v1')
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

export function attachmentCapability(provider) {
  return providerDefaults(provider)?.attachmentTypes ?? []
}

/** Whether this provider accepts the given MIME for AI draft attachment selection. */
export function canAttachMime(provider, mimeType = '') {
  const capability = attachmentCapability(provider)
  if (capability.includes('any') || capability.includes('*')) return true
  const mime = String(mimeType || '').toLowerCase()
  if (mime.startsWith('image/')) return capability.includes('image')
  if (mime === 'application/pdf') return capability.includes('pdf')
  return capability.includes('file')
}

function isTextLikeMime(mimeType = '') {
  const mime = String(mimeType || '').toLowerCase()
  if (mime.startsWith('text/')) return true
  return [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/csv',
    'application/sql',
    'application/x-yaml',
    'application/yaml',
    'application/md',
    'application/x-markdown',
  ].includes(mime)
}

function decodeAttachmentText(attachment) {
  try {
    return Buffer.from(String(attachment.contentBase64 || ''), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

/** Build a text fallback block for files that have no native multimodal part. */
function attachmentTextFallback(attachment) {
  const name = attachment.name || 'attachment'
  const mime = attachment.mimeType || 'application/octet-stream'
  if (isTextLikeMime(mime)) {
    const text = decodeAttachmentText(attachment)
    const clipped = text.length > 80_000 ? `${text.slice(0, 80_000)}\n…[truncated]` : text
    return `[Attachment: ${name} (${mime})]\n${clipped}`
  }
  // Binary / unknown: include a bounded base64 payload so the model still receives the file.
  const raw = String(attachment.contentBase64 || '')
  const clipped = raw.length > 120_000 ? `${raw.slice(0, 120_000)}…[truncated]` : raw
  return `[Binary attachment: ${name} (${mime})]\nBase64:\n${clipped}`
}

function boundedProviderInteger(value, fallback, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(parsed)))
}

const PROVIDER_STREAM_MAX_BYTES = boundedProviderInteger(
  process.env.AI_PROVIDER_STREAM_MAX_BYTES,
  8 * 1024 * 1024,
  64 * 1024 * 1024,
)
const PROVIDER_JSON_MAX_BYTES = boundedProviderInteger(
  process.env.AI_PROVIDER_JSON_MAX_BYTES,
  8 * 1024 * 1024,
  64 * 1024 * 1024,
)
const PROVIDER_SSE_BUFFER_MAX_BYTES = boundedProviderInteger(
  process.env.AI_PROVIDER_SSE_BUFFER_MAX_BYTES,
  1024 * 1024,
  8 * 1024 * 1024,
)
const PROVIDER_DRAFT_TIMEOUT_MS = boundedProviderInteger(
  process.env.AI_PROVIDER_DRAFT_TIMEOUT_MS,
  180_000,
  10 * 60_000,
)
const PROVIDER_COMPLETION_TIMEOUT_MS = boundedProviderInteger(
  process.env.AI_PROVIDER_COMPLETION_TIMEOUT_MS,
  180_000,
  10 * 60_000,
)
const providerAdmission = createAiAdmissionController({
  // The saved key supplies the effective aggregate limit per request. This is
  // only the controller ceiling for gateways that explicitly allow a larger
  // research fan-out.
  maxActive: boundedProviderInteger(process.env.AI_PROVIDER_MAX_ACTIVE, AI_KEY_MAX_CONCURRENCY, AI_KEY_MAX_CONCURRENCY),
  maxQueued: boundedProviderInteger(process.env.AI_PROVIDER_MAX_QUEUED, 64, 1_000),
  maxPerPrincipal: boundedProviderInteger(process.env.AI_PROVIDER_MAX_ACTIVE_PER_OWNER, AI_KEY_MAX_CONCURRENCY, AI_KEY_MAX_CONCURRENCY),
  maxPerKey: boundedProviderInteger(process.env.AI_PROVIDER_MAX_ACTIVE_PER_KEY, AI_KEY_MAX_CONCURRENCY, AI_KEY_MAX_CONCURRENCY),
  // Admission starts before the provider-operation deadline. A queued request
  // therefore needs at least one complete provider cycle to reach a slot.
  waitTimeoutMs: boundedProviderInteger(process.env.AI_PROVIDER_WAIT_TIMEOUT_MS, 240_000, 300_000),
})

export function aiKeyMaxConcurrency(value, fallback = 2) {
  return normalizeAiKeyMaxConcurrency(value, fallback)
}

function providerAdmissionIdentity(key) {
  const fallback = `${key?.provider || 'provider'}:${key?.ownerId || 'unknown-owner'}`
  const maxConcurrency = aiKeyMaxConcurrency(key?.maxConcurrency)
  return {
    principalId: key?.ownerId || fallback,
    keyIds: [key?.id || fallback],
    maxActive: maxConcurrency,
    maxPerKey: maxConcurrency,
  }
}

async function withProviderAdmission(key, signal, operation) {
  let release
  try {
    release = await providerAdmission.acquire({ ...providerAdmissionIdentity(key), signal })
  } catch (error) {
    if (error instanceof AiCapacityError && error.reason === 'cancelled') {
      throw signal?.reason ?? error
    }
    if (error instanceof AiCapacityError) {
      throw new AiProviderError(
        'AI_CAPACITY_EXCEEDED',
        'AI provider capacity is busy. Please retry shortly.',
        { status: 429, retryAfterSeconds: 2 },
      )
    }
    throw error
  }
  try {
    return await operation()
  } finally {
    release()
  }
}

function providerBodyError(code, message) {
  return new AiProviderError(code, message)
}

async function readBoundedBodyText(response, {
  signal,
  maxBytes = PROVIDER_JSON_MAX_BYTES,
  bodyKind = 'response',
} = {}) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  let completed = false
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('The provider request was aborted.')
      const { done, value } = await reader.read()
      if (done) {
        text += decoder.decode()
        completed = true
        return text
      }
      totalBytes += value?.byteLength ?? 0
      if (totalBytes > maxBytes) {
        throw providerBodyError(
          'PROVIDER_RESPONSE_TOO_LARGE',
          `The AI provider ${bodyKind} exceeded the safe response size.`,
        )
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (!completed) await reader.cancel().catch(() => {})
    try { reader.releaseLock() } catch { /* already released/cancelled */ }
  }
}

async function readProviderJson(response, signal) {
  const text = await readBoundedBodyText(response, { signal, bodyKind: 'JSON body' })
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function parseSseStream(response, onEvent, { signal } = {}) {
  const reader = response.body?.getReader()
  if (!reader) throw new AiProviderError('EMPTY_STREAM', 'The AI provider did not return a stream.')
  const decoder = new TextDecoder()
  let buffer = ''
  let totalBytes = 0
  let completed = false
  let eventCount = 0

  const assertProviderEvent = (event) => {
    if (!event?.error) return
    const status = Number(event.error.status ?? event.error.status_code ?? event.status ?? 0)
    if (status) throw providerHttpError(status)
    const code = String(event.error.code ?? event.error.type ?? '').toLowerCase()
    if (code.includes('rate') || code.includes('quota')) throw providerHttpError(429)
    if (code.includes('timeout')) throw providerHttpError(504)
    if (code.includes('server') || code.includes('unavailable')) throw providerHttpError(503)
    throw new AiProviderError(
      'PROVIDER_REJECTED',
      'The AI provider rejected this request. Check the model, key, and provider URL.',
    )
  }

  const processLine = async (line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let parsed
    try {
      parsed = JSON.parse(data)
    } catch {
      // Keep-alives are comments or blank data lines and were returned above.
      // A non-empty malformed data frame means authored text may have been
      // lost; continuing would misreport a corrupt stream as EMPTY_DRAFT.
      throw new AiProviderError(
        'PROVIDER_STREAM_INVALID',
        'The AI provider returned an invalid streaming response.',
      )
    }
    assertProviderEvent(parsed)
    eventCount += 1
    await onEvent(parsed)
  }

  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('The provider stream was aborted.')
      const { done, value } = await reader.read()
      totalBytes += value?.byteLength ?? 0
      if (totalBytes > PROVIDER_STREAM_MAX_BYTES) {
        throw providerBodyError('PROVIDER_RESPONSE_TOO_LARGE', 'The AI provider stream exceeded the safe response size.')
      }
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      if (Buffer.byteLength(buffer) > PROVIDER_SSE_BUFFER_MAX_BYTES) {
        throw providerBodyError('PROVIDER_RESPONSE_TOO_LARGE', 'The AI provider sent an oversized streaming event.')
      }
      const lines = buffer.split(/\r?\n/)
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) await processLine(line)
      if (done) break
    }
    if (buffer) await processLine(buffer)
    if (eventCount === 0) {
      throw new AiProviderError('EMPTY_STREAM', 'The AI provider did not return a stream.')
    }
    completed = true
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (!completed) await reader.cancel().catch(() => {})
    try { reader.releaseLock() } catch { /* already released/cancelled */ }
  }
}

function openAiContentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (typeof part?.text === 'string') return part.text
    if (typeof part?.text?.value === 'string') return part.text.value
    return ''
  }).join('')
}

async function parseOpenAiEvents(response, onEvent, { signal } = {}) {
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.includes('application/json')) {
    return parseSseStream(response, onEvent, { signal })
  }
  const payload = await readProviderJson(response, signal)
  if (payload?.error) {
    const status = Number(payload.error.status ?? payload.error.status_code ?? 0)
    if (status) throw providerHttpError(status)
    throw new AiProviderError(
      'PROVIDER_REJECTED',
      'The AI provider rejected this request. Check the model, key, and provider URL.',
    )
  }
  await onEvent(payload)
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

function normalizedUsage(inputTokens = 0, outputTokens = 0, totalTokens = 0) {
  const input = Math.max(0, Math.round(Number(inputTokens) || 0))
  const output = Math.max(0, Math.round(Number(outputTokens) || 0))
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: Math.max(input + output, Math.round(Number(totalTokens) || 0)),
  }
}

function addUsage(left, right) {
  return normalizedUsage(
    Number(left?.inputTokens ?? 0) + Number(right?.inputTokens ?? 0),
    Number(left?.outputTokens ?? 0) + Number(right?.outputTokens ?? 0),
    Number(left?.totalTokens ?? 0) + Number(right?.totalTokens ?? 0),
  )
}

function providerHttpError(status) {
  if (status === 429) {
    return new AiProviderError(
      'PROVIDER_RATE_LIMITED',
      'The AI provider is temporarily rate limited. Please retry shortly.',
      { upstreamStatus: status },
    )
  }
  if (status === 408 || status === 504) {
    return new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.', { upstreamStatus: status })
  }
  if ([500, 502, 503].includes(status)) {
    return new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', { upstreamStatus: status })
  }
  return new AiProviderError(
    'PROVIDER_REJECTED',
    'The AI provider rejected this request. Check the model, key, and provider URL.',
    { upstreamStatus: status },
  )
}

const TRANSIENT_PROVIDER_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
])

function isTransientProviderNetworkError(error) {
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (TRANSIENT_PROVIDER_NETWORK_CODES.has(String(current.code || '').toUpperCase())) return true
    current = current.cause
  }
  return false
}

function outboundProviderPolicyError(error) {
  // A syntactically valid public provider can suffer a temporary DNS lookup
  // failure. That is retryable availability, not evidence that the saved base
  // URL is unsafe. Private/reserved resolutions and malformed URLs remain a
  // permanent configuration rejection.
  if (error instanceof OutboundNetworkPolicyError && error.code === 'OUTBOUND_HOST_UNRESOLVED') {
    return new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider host could not be resolved temporarily.')
  }
  return new AiProviderError(
    'INVALID_BASE_URL',
    'The provider URL must resolve only to a public HTTPS endpoint.',
  )
}

async function fetchProvider(url, options, signal, timeoutMs = 90_000) {
  try {
    const response = await withAbortDeadline(
      (deadlineSignal) => providerNetworkFetch(url, { ...options, signal: deadlineSignal }),
      { signal, timeoutMs },
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw providerHttpError(response.status)
    }
    return response
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error instanceof OutboundNetworkPolicyError || error?.code === 'INVALID_OUTBOUND_URL') {
      throw outboundProviderPolicyError(error)
    }
    if (
      error instanceof AbortDeadlineError
      || signal?.aborted
      || error?.name === 'AbortError'
    ) {
      throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.')
    }
    throw new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.')
  }
}

/**
 * All real provider traffic uses DNS validation plus address pinning. Vitest
 * alone retains its injected Fetch fixtures; development and an unset
 * NODE_ENV must not weaken the SSRF / DNS-rebinding boundary.
 */
function providerNetworkFetch(url, options) {
  return process.env.NODE_ENV === 'test'
    ? fetch(url, { ...options, redirect: 'error' })
    : pinnedHttpsFetch(url, options)
}

function safeFileExtension(fileName) {
  const leaf = String(fileName ?? '').split(/[\\/]/).at(-1) ?? ''
  const dot = leaf.lastIndexOf('.')
  if (dot <= 0 || dot === leaf.length - 1) return ''
  const extension = leaf.slice(dot)
  return /^\.[a-z0-9]{1,16}$/i.test(extension) ? extension : ''
}

function safeFileNameLeaf(value) {
  const normalized = String(value ?? '').normalize('NFKC').trim()
  const leaf = normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const printable = Array.from(leaf, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 || '<>:"|?*'.includes(character) ? ' ' : character
  }).join('')
  return printable
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
}

/** Keep model-proposed display names safe while preserving the file's true extension. */
export function sanitizeAiAttachmentFileName(proposedName, originalName = 'attachment') {
  const extension = safeFileExtension(originalName)
  const cleanOriginal = safeFileNameLeaf(originalName) || 'attachment'
  const cleanProposed = safeFileNameLeaf(proposedName)
  let stem = cleanProposed || cleanOriginal
  if (extension) {
    const proposedExtension = safeFileExtension(stem)
    if (proposedExtension) stem = stem.slice(0, -proposedExtension.length)
    stem = stem.replace(/\.+$/g, '').trim()
    if (!stem) stem = cleanOriginal.slice(0, -extension.length).replace(/\.+$/g, '').trim() || 'attachment'
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `attachment-${stem}`
  const maxStemLength = Math.max(1, 180 - extension.length)
  stem = stem.slice(0, maxStemLength).trim().replace(/\.+$/g, '') || 'attachment'
  return `${stem}${extension}`
}

function aiDraftToolDefinitions(attachmentCandidates = []) {
  const definitions = [{
    name: 'get_granted_application_context',
    description: 'Read the applicant data the user explicitly allowed for this editable email draft, including eligible files that may be attached. Call this before drafting if more details are needed.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', maxLength: 240 } },
      required: [],
      additionalProperties: false,
    },
  }]
  if (attachmentCandidates.length === 0) return definitions
  const candidateSummary = attachmentCandidates
    .slice(0, 80)
    .map((candidate) => `${candidate.name} [${candidate.id}; source=${candidate.source ?? 'enabled-source'}]`)
    .join('; ')
  definitions.push({
    name: 'select_email_attachments',
    description: `Set the complete saved-file attachment plan for the editable email draft. Choose only genuinely useful files, give each a clear recipient-facing filename, and call once even when the list is empty. This never sends email. Only use ids explicitly provided here. Available candidates: ${candidateSummary}`,
    parameters: {
      type: 'object',
      properties: {
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              attachmentId: { type: 'string', enum: attachmentCandidates.map((candidate) => candidate.id) },
              fileName: {
                type: 'string',
                minLength: 1,
                maxLength: 180,
                description: 'Concise recipient-facing filename. Use the real file type; the server enforces the original extension.',
              },
            },
            required: ['attachmentId', 'fileName'],
            additionalProperties: false,
          },
          maxItems: Math.min(20, attachmentCandidates.length),
        },
      },
      required: ['attachments'],
      additionalProperties: false,
    },
  })
  return definitions
}

function attachmentPlanFromToolInput(input, attachmentCandidates) {
  let requestedAttachments = []
  if (Array.isArray(input?.attachments)) {
    requestedAttachments = input.attachments
  } else if (Array.isArray(input?.attachmentIds)) {
    // Tolerate an older OpenAI-compatible gateway replaying the previous
    // schema while every new request advertises the complete plan.
    requestedAttachments = input.attachmentIds.map((attachmentId) => ({ attachmentId }))
  }
  const candidateById = new Map(attachmentCandidates.map((candidate) => [candidate.id, candidate]))
  const selectedAttachments = []
  const selectedIds = new Set()
  for (const requested of requestedAttachments) {
    const attachmentId = String(requested?.attachmentId ?? '')
    const candidate = candidateById.get(attachmentId)
    if (!candidate || selectedIds.has(attachmentId) || selectedAttachments.length >= 20) continue
    selectedIds.add(attachmentId)
    selectedAttachments.push({
      attachmentId,
      fileName: sanitizeAiAttachmentFileName(requested?.fileName, candidate.name),
    })
  }
  return selectedAttachments
}

function openAiTools(attachmentCandidates = []) {
  return aiDraftToolDefinitions(attachmentCandidates).map((definition) => ({
    type: 'function',
    function: definition,
  }))
}

function openAiCompatibleAttachmentParts(attachments) {
  const parts = []
  const textFallbacks = []
  for (const attachment of attachments) {
    const mime = String(attachment.mimeType || '').toLowerCase()
    if (mime.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.contentBase64}` },
      })
      continue
    }
    // PDFs and other non-image files are inlined as context text for OpenAI-compatible chat APIs.
    textFallbacks.push(attachmentTextFallback(attachment))
  }
  if (textFallbacks.length > 0) {
    parts.unshift({ type: 'text', text: textFallbacks.join('\n\n') })
  }
  return parts
}

function openAiResponseAttachmentParts(attachments) {
  const parts = []
  const textFallbacks = []
  for (const attachment of attachments) {
    const mime = String(attachment.mimeType || '').toLowerCase()
    if (mime.startsWith('image/')) {
      parts.push({
        type: 'input_image',
        image_url: `data:${attachment.mimeType};base64,${attachment.contentBase64}`,
      })
    } else {
      textFallbacks.push(attachmentTextFallback(attachment))
    }
  }
  if (textFallbacks.length > 0) {
    parts.unshift({ type: 'input_text', text: textFallbacks.join('\n\n') })
  }
  return parts
}

function openAiResponseTools(attachmentCandidates = []) {
  return aiDraftToolDefinitions(attachmentCandidates).map((definition) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }))
}

async function streamOpenAiResponses({
  provider,
  key,
  system,
  instruction,
  grantedContext,
  attachments,
  attachmentCandidates = [],
  onText,
  onStatus,
  onAttachmentSelection,
  signal,
}) {
  const endpoint = openAiResponsesEndpoint(provider, key.baseUrl)
  const attachmentParts = openAiResponseAttachmentParts(attachments)
  const tools = openAiResponseTools(attachmentCandidates)
  const initialInput = [{
    role: 'user',
    content: [
      { type: 'input_text', text: instruction },
      ...attachmentParts,
    ],
  }]

  const run = async (input, remainingToolRounds, previousResponseId = null) => {
    const response = await fetchProvider(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: key.model || providerDefaults(provider).defaultModel,
        instructions: system,
        input,
        stream: true,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        ...(remainingToolRounds > 0 && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
    }, signal)
    const toolCalls = new Map()
    let responseId = previousResponseId
    let emittedText = false
    let usage = emptyUsage()
    await parseSseStream(response, async (event) => {
      if (event.type === 'response.failed') {
        throw new AiProviderError(
          'PROVIDER_REJECTED',
          event.response?.error?.message || 'The AI provider rejected this Responses request.',
        )
      }
      if (event.response?.id) responseId = event.response.id
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        emittedText = true
        await onText(event.delta)
      }
      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        toolCalls.set(event.item.id || String(event.output_index ?? toolCalls.size), {
          id: String(event.item.id || ''),
          callId: String(event.item.call_id || event.item.id || ''),
          name: String(event.item.name || ''),
          arguments: String(event.item.arguments || ''),
        })
      }
      if (event.type === 'response.function_call_arguments.delta') {
        const itemId = event.item_id || String(event.output_index ?? '')
        const current = toolCalls.get(itemId) ?? {
          id: String(itemId),
          callId: String(event.call_id || itemId),
          name: String(event.name || ''),
          arguments: '',
        }
        current.arguments += String(event.delta || '')
        toolCalls.set(itemId, current)
      }
      if (event.type === 'response.function_call_arguments.done') {
        const itemId = event.item_id || String(event.output_index ?? '')
        const current = toolCalls.get(itemId) ?? {
          id: String(itemId),
          callId: String(event.call_id || itemId),
          name: String(event.name || ''),
          arguments: '',
        }
        current.arguments = String(event.arguments ?? current.arguments)
        current.name = String(event.name ?? current.name)
        toolCalls.set(itemId, current)
      }
      const reported = event.response?.usage
      if (reported) {
        usage = normalizedUsage(reported.input_tokens, reported.output_tokens, reported.total_tokens)
      }
    }, { signal })
    if (emittedText || toolCalls.size === 0 || remainingToolRounds <= 0) return usage
    if (!responseId) {
      throw new AiProviderError('PROVIDER_STREAM_INVALID', 'The Responses stream omitted its response id.')
    }
    let handled = false
    const toolOutputs = [...toolCalls.values()].map((call) => {
      let result
      if (call.name === 'get_granted_application_context') {
        handled = true
        onStatus?.('context')
        result = grantedContext
      } else if (call.name === 'select_email_attachments') {
        handled = true
        let toolInput = {}
        try {
          toolInput = JSON.parse(call.arguments || '{}')
        } catch {
          // Return an empty plan so the model can continue without attachment changes.
        }
        const selectedAttachments = attachmentPlanFromToolInput(toolInput, attachmentCandidates)
        if (selectedAttachments.length > 0) onStatus?.('attaching')
        onAttachmentSelection?.(selectedAttachments)
        result = { selectedAttachments, draftOnly: true }
      } else {
        result = { error: 'This tool is unavailable for the current email draft.' }
      }
      return {
        type: 'function_call_output',
        call_id: call.callId,
        output: JSON.stringify(result),
      }
    })
    if (!handled) return usage
    const continuationUsage = await run(toolOutputs, remainingToolRounds - 1, responseId)
    return addUsage(usage, continuationUsage)
  }

  return run(initialInput, 2)
}

async function streamOpenAiCompatible({
  provider,
  key,
  system,
  instruction,
  grantedContext,
  attachments,
  attachmentCandidates = [],
  onText,
  onStatus,
  onAttachmentSelection,
  signal,
}) {
  const endpoint = openAiChatEndpoint(provider, key.baseUrl)
  const attachmentParts = openAiCompatibleAttachmentParts(attachments)
  const tools = openAiTools(attachmentCandidates)
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: attachmentParts.length > 0
        ? [{ type: 'text', text: instruction }, ...attachmentParts]
        : instruction,
    },
  ]

  const run = async (nextMessages, remainingToolRounds) => {
    const response = await fetchProvider(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: key.model || providerDefaults(provider).defaultModel,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.35,
        messages: nextMessages,
        ...(remainingToolRounds > 0 && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
    }, signal)
    const toolCalls = new Map()
    let emittedText = false
    let usage = emptyUsage()
    await parseOpenAiEvents(response, async (event) => {
      if (event.usage) {
        usage = normalizedUsage(
          event.usage.prompt_tokens,
          event.usage.completion_tokens,
          event.usage.total_tokens,
        )
      }
      const choice = event.choices?.[0]
      const delta = choice?.delta ?? {}
      const content = openAiContentText(delta.content) || openAiContentText(choice?.message?.content)
      if (content) {
        emittedText = true
        await onText(content)
      }
      for (const chunk of delta.tool_calls ?? choice?.message?.tool_calls ?? []) {
        const index = Number(chunk.index ?? 0)
        const current = toolCalls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
        current.id += chunk.id ?? ''
        current.function.name += chunk.function?.name ?? ''
        current.function.arguments += chunk.function?.arguments ?? ''
        toolCalls.set(index, current)
      }
    }, { signal })
    if (emittedText || toolCalls.size === 0 || remainingToolRounds <= 0) return usage
    const calls = Array.from(toolCalls.values())
    const assistantMessage = { role: 'assistant', tool_calls: Array.from(toolCalls.values()) }
    let handled = false
    const toolMessages = calls.map((call) => {
      if (call.function.name === 'get_granted_application_context') {
        handled = true
        onStatus?.('context')
        return {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(grantedContext),
        }
      }
      if (call.function.name === 'select_email_attachments') {
        handled = true
        let toolInput = {}
        try {
          toolInput = JSON.parse(call.function.arguments || '{}')
        } catch {
          // The provider receives a structured tool error below and can still
          // continue drafting without adding an attachment.
        }
        const selectedAttachments = attachmentPlanFromToolInput(toolInput, attachmentCandidates)
        if (selectedAttachments.length > 0) {
          onStatus?.('attaching')
        }
        onAttachmentSelection?.(selectedAttachments)
        return {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ selectedAttachments, draftOnly: true }),
        }
      }
      return {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ error: 'This tool is unavailable for the current email draft.' }),
      }
    })
    if (!handled) return usage
    const continuationUsage = await run([...nextMessages, assistantMessage, ...toolMessages], remainingToolRounds - 1)
    return addUsage(usage, continuationUsage)
  }

  return run(messages, 2)
}

async function streamAnthropic({
  key,
  system,
  instruction,
  grantedContext,
  attachments,
  attachmentCandidates = [],
  onText,
  onStatus,
  onAttachmentSelection,
  signal,
}) {
  const baseUrl = normalizedBaseUrl('anthropic', key.baseUrl)
  const content = [{ type: 'text', text: `${instruction}\n\nGranted context:\n${JSON.stringify(grantedContext)}` }]
  const tools = aiDraftToolDefinitions(attachmentCandidates).map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters,
  }))
  const textFallbacks = []
  for (const attachment of attachments) {
    const mime = String(attachment.mimeType || '').toLowerCase()
    if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.contentBase64 } })
    } else if (mime.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.contentBase64 } })
    } else {
      textFallbacks.push(attachmentTextFallback(attachment))
    }
  }
  if (textFallbacks.length > 0) {
    content.push({ type: 'text', text: textFallbacks.join('\n\n') })
  }

  const run = async (messages, remainingToolRounds) => {
    const response = await fetchProvider(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: key.model || providerDefaults('anthropic').defaultModel,
        max_tokens: 1400,
        temperature: 0.35,
        stream: true,
        system,
        messages,
        ...(remainingToolRounds > 0 ? { tools } : {}),
      }),
    }, signal, 150_000)
    let usage = emptyUsage()
    let emittedText = false
    const pendingToolCalls = new Map()
    await parseSseStream(response, async (event) => {
      const reported = event.message?.usage ?? event.usage
      if (reported) {
        usage = normalizedUsage(
          Math.max(usage.inputTokens, Number(reported.input_tokens ?? 0)),
          Math.max(usage.outputTokens, Number(reported.output_tokens ?? 0)),
        )
      }
      if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
        emittedText = true
        await onText(event.delta.text)
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        pendingToolCalls.set(Number(event.index ?? pendingToolCalls.size), {
          id: String(event.content_block.id ?? ''),
          name: String(event.content_block.name ?? ''),
          input: event.content_block.input ?? {},
          partialJson: '',
        })
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const index = Number(event.index ?? 0)
        const current = pendingToolCalls.get(index)
        if (current) current.partialJson += String(event.delta.partial_json ?? '')
      }
    }, { signal })
    if (emittedText || pendingToolCalls.size === 0 || remainingToolRounds <= 0) return usage
    const calls = Array.from(pendingToolCalls.values()).map((call) => {
      let input = call.input
      if (call.partialJson) {
        try {
          input = JSON.parse(call.partialJson)
        } catch {
          input = {}
        }
      }
      return { ...call, input }
    })
    let handled = false
    const toolResults = calls.map((call) => {
      let result
      if (call.name === 'get_granted_application_context') {
        handled = true
        onStatus?.('context')
        result = grantedContext
      } else if (call.name === 'select_email_attachments') {
        handled = true
        const selectedAttachments = attachmentPlanFromToolInput(call.input, attachmentCandidates)
        if (selectedAttachments.length > 0) onStatus?.('attaching')
        onAttachmentSelection?.(selectedAttachments)
        result = { selectedAttachments, draftOnly: true }
      } else {
        result = { error: 'This tool is unavailable for the current email draft.' }
      }
      return {
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result),
      }
    })
    if (!handled) return usage
    const assistantContent = calls.map((call) => ({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.input,
    }))
    const continuationUsage = await run([
      ...messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    ], remainingToolRounds - 1)
    return addUsage(usage, continuationUsage)
  }

  return run([{ role: 'user', content }], 2)
}

async function streamGemini({
  key,
  system,
  instruction,
  grantedContext,
  attachments,
  attachmentCandidates = [],
  onText,
  onStatus,
  onAttachmentSelection,
  signal,
}) {
  const baseUrl = normalizedBaseUrl('gemini', key.baseUrl)
  const model = encodeURIComponent(key.model || providerDefaults('gemini').defaultModel)
  const parts = [{ text: `${instruction}\n\nGranted context:\n${JSON.stringify(grantedContext)}` }]
  const tools = [{
    functionDeclarations: aiDraftToolDefinitions(attachmentCandidates).map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    })),
  }]
  const textFallbacks = []
  for (const attachment of attachments) {
    const mime = String(attachment.mimeType || '').toLowerCase()
    // Gemini accepts many inline mime types; images and PDFs are the most reliable.
    if (mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('audio/') || mime.startsWith('video/')) {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.contentBase64 } })
    } else {
      textFallbacks.push(attachmentTextFallback(attachment))
    }
  }
  if (textFallbacks.length > 0) {
    parts.push({ text: textFallbacks.join('\n\n') })
  }

  const run = async (contents, remainingToolRounds) => {
    const response = await fetchProvider(`${baseUrl}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { temperature: 0.35 },
        contents,
        ...(remainingToolRounds > 0 ? { tools } : {}),
      }),
    }, signal)
    let usage = emptyUsage()
    let emittedText = false
    const calls = []
    await parseSseStream(response, async (event) => {
      if (event.usageMetadata) {
        usage = normalizedUsage(
          event.usageMetadata.promptTokenCount,
          event.usageMetadata.candidatesTokenCount,
          event.usageMetadata.totalTokenCount,
        )
      }
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (typeof part.text === 'string') {
          emittedText = true
          await onText(part.text)
        }
        if (part.functionCall?.name) calls.push(part.functionCall)
      }
    }, { signal })
    if (emittedText || calls.length === 0 || remainingToolRounds <= 0) return usage
    let handled = false
    const responseParts = calls.map((call) => {
      let result
      if (call.name === 'get_granted_application_context') {
        handled = true
        onStatus?.('context')
        result = grantedContext
      } else if (call.name === 'select_email_attachments') {
        handled = true
        const selectedAttachments = attachmentPlanFromToolInput(call.args ?? {}, attachmentCandidates)
        if (selectedAttachments.length > 0) onStatus?.('attaching')
        onAttachmentSelection?.(selectedAttachments)
        result = { selectedAttachments, draftOnly: true }
      } else {
        result = { error: 'This tool is unavailable for the current email draft.' }
      }
      return {
        functionResponse: {
          name: call.name,
          response: result,
        },
      }
    })
    if (!handled) return usage
    const continuationUsage = await run([
      ...contents,
      { role: 'model', parts: calls.map((functionCall) => ({ functionCall })) },
      { role: 'user', parts: responseParts },
    ], remainingToolRounds - 1)
    return addUsage(usage, continuationUsage)
  }

  return run([{ role: 'user', parts }], 2)
}

export async function streamEmailDraft({
  key,
  system,
  instruction,
  grantedContext,
  attachments = [],
  attachmentCandidates = [],
  onText,
  onStatus,
  onAttachmentSelection,
  signal,
}) {
  try {
    return await withProviderAdmission(key, signal, () => withAbortDeadline(async (deadlineSignal) => {
      if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
      if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
      if (key.enabled === false) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is disabled.')
      const common = {
        key,
        system,
        instruction,
        grantedContext,
        attachments,
        attachmentCandidates,
        onText,
        onStatus,
        onAttachmentSelection,
        signal: deadlineSignal,
      }
      if (key.provider === 'anthropic') return streamAnthropic(common)
      if (key.provider === 'gemini') return streamGemini(common)
      if (normalizeAiKeyRequestMode(key.requestMode, key.provider) === 'responses') {
        return streamOpenAiResponses({ provider: key.provider, ...common })
      }
      return streamOpenAiCompatible({ provider: key.provider, ...common })
    }, { signal, timeoutMs: PROVIDER_DRAFT_TIMEOUT_MS }))
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error instanceof AbortDeadlineError || signal?.aborted || error?.name === 'AbortError') {
      throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to finish streaming.')
    }
    throw error
  }
}

/** Short timeout for connectivity probes (not full drafting). */
async function fetchProviderProbe(url, options, signal, timeoutMs = 20_000) {
  try {
    return await withAbortDeadline(async (deadlineSignal) => {
      const response = await providerNetworkFetch(url, { ...options, signal: deadlineSignal })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw providerHttpError(response.status)
      }
      // Drain a bounded body under the same complete-operation deadline so a
      // gateway cannot pass the headers check and then pin a socket forever.
      return await readBoundedBodyText(response, {
        signal: deadlineSignal,
        maxBytes: 1024 * 1024,
        bodyKind: 'probe body',
      })
    }, { signal, timeoutMs })
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error instanceof OutboundNetworkPolicyError || error?.code === 'INVALID_OUTBOUND_URL') {
      throw outboundProviderPolicyError(error)
    }
    if (
      error instanceof AbortDeadlineError
      || signal?.aborted
      || error?.name === 'AbortError'
    ) {
      throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.')
    }
    throw new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.')
  }
}

const RETRYABLE_PROVIDER_PROBE_CODES = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
])

const DISCOVER_RESEARCH_UNSUPPORTED_CODE = 'DISCOVER_RESEARCH_UNSUPPORTED'
const DISCOVER_RESEARCH_PROBE_MARKER = 'discover_research_v1'
const DISCOVER_RESEARCH_PROBE_MAX_TOKENS = 128
const DISCOVER_RESEARCH_PROBE_CACHE_TTL_MS = boundedProviderInteger(
  process.env.AI_RESEARCH_PROBE_CACHE_TTL_MS,
  15 * 60_000,
  24 * 60 * 60_000,
)
const DISCOVER_RESEARCH_UNSUPPORTED_CACHE_TTL_MS = boundedProviderInteger(
  process.env.AI_RESEARCH_UNSUPPORTED_CACHE_TTL_MS,
  60_000,
  30 * 60_000,
)
const DISCOVER_RESEARCH_PROBE_CACHE_MAX_ENTRIES = boundedProviderInteger(
  process.env.AI_RESEARCH_PROBE_CACHE_MAX_ENTRIES,
  256,
  2_048,
)
const discoverResearchProbeCache = new Map()
const discoverResearchProbeInFlight = new Map()
const DISCOVER_RESEARCH_CAPABILITY_REJECTION_STATUSES = new Set([400, 404, 405, 409, 415, 422])

function discoverResearchUnsupported() {
  return new AiProviderError(
    DISCOVER_RESEARCH_UNSUPPORTED_CODE,
    'The selected AI model does not support the complete Discover research capability set.',
    { status: 422 },
  )
}

function discoverResearchModel(key) {
  return String(key?.model || providerDefaults('openai')?.defaultModel || '').trim()
}

function discoverResearchProbeReasoningEffort(model) {
  const normalized = String(model || '').toLowerCase()
  if (normalized === 'deepseek-v4-flash' || normalized === 'gpt-5.6-luna') return 'max'
  return 'low'
}

function discoverResearchProbeMaxTokens(model) {
  // DeepSeek counts visible reasoning text against max_output_tokens. Its
  // `max` probe needs a larger but still tightly bounded budget to reliably
  // reach the schema marker after the required web-search call. A live 1,024
  // token probe was intermittently incomplete even though a 2,048 token probe
  // completed with only 308 output tokens; the hidden reasoning reservation is
  // therefore not equivalent to the eventual visible usage.
  const normalized = String(model || '').toLowerCase()
  if (normalized === 'deepseek-v4-flash') return 2_048
  if (normalized === 'gpt-5.6-luna') return 1_024
  return DISCOVER_RESEARCH_PROBE_MAX_TOKENS
}

function discoverResearchProbeTimeoutMs(model) {
  // DeepSeek v4 flash at maximum reasoning has a measured multi-minute tail
  // even for the smallest required web-search call. Keep that provider-specific
  // behavior out of the ordinary connectivity probe budget.
  const normalized = String(model || '').toLowerCase()
  if (normalized === 'deepseek-v4-flash') return 300_000
  if (normalized === 'gpt-5.6-luna') return 180_000
  return 45_000
}

/**
 * Cache keys contain only a one-way credential revision, never the credential
 * itself. The digest is process-local metadata and is never returned or logged.
 * Including it prevents a same-millisecond credential rotation from reusing a
 * capability result produced by the old secret.
 */
function discoverResearchProbeCacheKey(key, model) {
  const secret = String(key?.apiKey || '')
  if (!secret) return null
  const credentialRevision = createHash('sha256').update(secret).digest('base64url')
  return JSON.stringify([
    key?.id || null,
    key?.updatedAt || null,
    normalizedBaseUrl(key?.provider || 'openai', key?.baseUrl),
    model,
    credentialRevision,
  ])
}

function pruneDiscoverResearchProbeCache(now = Date.now()) {
  for (const [cacheKey, entry] of discoverResearchProbeCache) {
    if (entry.expiresAt <= now) discoverResearchProbeCache.delete(cacheKey)
  }
  while (discoverResearchProbeCache.size >= DISCOVER_RESEARCH_PROBE_CACHE_MAX_ENTRIES) {
    const oldestKey = discoverResearchProbeCache.keys().next().value
    if (oldestKey === undefined) break
    discoverResearchProbeCache.delete(oldestKey)
  }
}

function readDiscoverResearchProbeCache(cacheKey) {
  if (!cacheKey) return null
  const now = Date.now()
  const entry = discoverResearchProbeCache.get(cacheKey)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    discoverResearchProbeCache.delete(cacheKey)
    return null
  }
  // Refresh insertion order so the bounded map behaves as an LRU cache.
  discoverResearchProbeCache.delete(cacheKey)
  discoverResearchProbeCache.set(cacheKey, entry)
  if (entry.error) {
    throw new AiProviderError(entry.error.code, entry.error.message, { status: entry.error.status })
  }
  return { ...entry.value, cached: true }
}

function writeDiscoverResearchProbeCache(cacheKey, { value = null, error = null } = {}) {
  if (!cacheKey) return
  const now = Date.now()
  pruneDiscoverResearchProbeCache(now)
  discoverResearchProbeCache.set(cacheKey, {
    expiresAt: now + (error
      ? DISCOVER_RESEARCH_UNSUPPORTED_CACHE_TTL_MS
      : DISCOVER_RESEARCH_PROBE_CACHE_TTL_MS),
    value,
    error: error
      ? { code: error.code, message: error.message, status: error.status }
      : null,
  })
}

/** Test-only lifecycle hook; production callers never need to clear the TTL cache. */
export function clearAiResearchCapabilityProbeCache() {
  discoverResearchProbeCache.clear()
  discoverResearchProbeInFlight.clear()
}

function parseDiscoverProbeJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function parseDiscoverCapabilityMarker(text) {
  const exact = parseDiscoverProbeJson(text)
  if (exact) return exact
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function assertDiscoverModelListed(modelsText, model) {
  const payload = parseDiscoverProbeJson(modelsText)
  if (!Array.isArray(payload?.data)) throw discoverResearchUnsupported()
  const modelExists = payload.data.some((candidate) => (
    candidate
      && typeof candidate === 'object'
      && typeof candidate.id === 'string'
      && candidate.id === model
  ))
  if (!modelExists) throw discoverResearchUnsupported()
}

function assertDiscoverCapabilityProbe(payload) {
  const webSearchCompleted = Array.isArray(payload?.output)
    && payload.output.some((item) => item?.type === 'web_search_call' && item?.status === 'completed')
  const output = parseDiscoverCapabilityMarker(responseOutputText(payload))
  const exactMarker = output?.capability === DISCOVER_RESEARCH_PROBE_MARKER
    && Object.keys(output).length === 1
  if (!webSearchCompleted || !exactMarker) {
    throw discoverResearchUnsupported()
  }
}

async function runDiscoverResearchCapabilityProbe(key, model, signal) {
  const modelsText = await retryProviderProbe(() => fetchProviderProbe(
    openAiModelsEndpoint(key.provider, key.baseUrl),
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${key.apiKey}` },
    },
    signal,
  ), signal)
  assertDiscoverModelListed(modelsText, model)

  let responseText
  try {
    responseText = await retryProviderProbe(() => fetchProviderProbe(
      openAiResponsesEndpoint(key.provider, key.baseUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key.apiKey}`,
        },
        body: JSON.stringify({
          model,
          instructions: 'Use the required web-search tool, then return only the requested structured capability marker.',
          input: 'Use web search to confirm that IANA maintains reserved example domains, then report the capability marker.',
          tools: [{
            type: 'web_search',
            search_context_size: 'low',
            filters: { allowed_domains: ['iana.org'] },
          }],
          tool_choice: { type: 'web_search' },
          max_output_tokens: discoverResearchProbeMaxTokens(model),
          reasoning: { effort: discoverResearchProbeReasoningEffort(model) },
          text: {
            format: {
              type: 'json_schema',
              name: 'discover_research_capability',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  capability: { type: 'string', enum: [DISCOVER_RESEARCH_PROBE_MARKER] },
                },
                required: ['capability'],
                additionalProperties: false,
              },
            },
          },
        }),
      },
      signal,
      discoverResearchProbeTimeoutMs(model),
    ), signal)
  } catch (error) {
    if (
      error instanceof AiProviderError
      && error.code === 'PROVIDER_REJECTED'
      && DISCOVER_RESEARCH_CAPABILITY_REJECTION_STATUSES.has(error.upstreamStatus)
    ) {
      throw discoverResearchUnsupported()
    }
    throw error
  }

  const payload = parseDiscoverProbeJson(responseText)
  assertDiscoverCapabilityProbe(payload)
  return {
    model,
    capabilities: {
      responses: true,
      webSearch: true,
      structuredOutput: true,
      reasoning: true,
    },
    cached: false,
  }
}

async function discoverResearchCapabilities(key, model, signal) {
  const cacheKey = discoverResearchProbeCacheKey(key, model)
  const cached = readDiscoverResearchProbeCache(cacheKey)
  if (cached) return cached

  const activeProbe = cacheKey ? discoverResearchProbeInFlight.get(cacheKey) : null
  if (activeProbe) return activeProbe

  const probe = withProviderAdmission(
    key,
    signal,
    () => runDiscoverResearchCapabilityProbe(key, model, signal),
  ).then((value) => {
    writeDiscoverResearchProbeCache(cacheKey, { value })
    return value
  }).catch((error) => {
    if (error instanceof AiProviderError && error.code === DISCOVER_RESEARCH_UNSUPPORTED_CODE) {
      writeDiscoverResearchProbeCache(cacheKey, { error })
    }
    throw error
  }).finally(() => {
    if (cacheKey && discoverResearchProbeInFlight.get(cacheKey) === probe) {
      discoverResearchProbeInFlight.delete(cacheKey)
    }
  })

  if (cacheKey) discoverResearchProbeInFlight.set(cacheKey, probe)
  return probe
}

async function waitForProviderProbeRetry(signal, delayMs = 250) {
  if (signal?.aborted) throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider probe was cancelled.')
  await new Promise((resolve, reject) => {
    let timer = null
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider probe was cancelled.'))
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/**
 * Connectivity checks are a gate, not the research workload itself. One slow
 * gateway response must not create a false "bad key" result, while permanent
 * credential/configuration errors must still fail immediately.
 */
async function retryProviderProbe(operation, signal, attempts = 2) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const retryable = error instanceof AiProviderError
        && RETRYABLE_PROVIDER_PROBE_CODES.has(error.code)
        && !signal?.aborted
      if (!retryable || attempt === attempts - 1) throw error
      await waitForProviderProbeRetry(signal)
    }
  }
  throw lastError
}

async function testOpenAiCompatible(provider, key, signal) {
  const endpoint = openAiChatEndpoint(provider, key.baseUrl)
  await fetchProviderProbe(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || providerDefaults(provider).defaultModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    }),
  }, signal)
}

async function testOpenAiResponses(provider, key, signal) {
  const endpoint = openAiResponsesEndpoint(provider, key.baseUrl)
  await fetchProviderProbe(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || providerDefaults(provider).defaultModel,
      input: 'ping',
      max_output_tokens: 16,
    }),
  }, signal)
}

async function testAnthropic(key, signal) {
  const baseUrl = normalizedBaseUrl('anthropic', key.baseUrl)
  await fetchProviderProbe(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: key.model || providerDefaults('anthropic').defaultModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  }, signal)
}

async function testGemini(key, signal) {
  const baseUrl = normalizedBaseUrl('gemini', key.baseUrl)
  const model = encodeURIComponent(key.model || providerDefaults('gemini').defaultModel)
  await fetchProviderProbe(
    `${baseUrl}/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    },
    signal,
  )
}

/**
 * Lightweight live probe: one minimal completion so we know the key, model,
 * and endpoint are accepted by the provider (without drafting email).
 */
export async function testAiKeyConnection(key, signal) {
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (key.enabled === false) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is disabled.')
  const started = Date.now()
  await withProviderAdmission(key, signal, () => retryProviderProbe(async () => {
    if (key.provider === 'anthropic') await testAnthropic(key, signal)
    else if (key.provider === 'gemini') await testGemini(key, signal)
    else if (normalizeAiKeyRequestMode(key.requestMode, key.provider) === 'responses') {
      await testOpenAiResponses(key.provider, key, signal)
    }
    else await testOpenAiCompatible(key.provider, key, signal)
  }, signal))
  return {
    ok: true,
    latencyMs: Date.now() - started,
    provider: key.provider,
    model: key.model || providerDefaults(key.provider)?.defaultModel || '',
  }
}

/**
 * Discover's trusted Responses gateways must advertise the exact selected
 * model and complete one bounded probe that combines every capability the
 * research pipeline relies on. Successful and stable-unsupported results are
 * cached so opening the research sheet repeatedly cannot spend tokens or burst
 * the provider; generic OpenAI-compatible gateways retain their normal minimal
 * Chat Completions connectivity check.
 */
export async function testAiResearchKeyConnection(key, signal) {
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (key.enabled === false) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is disabled.')
  if (!supportsNativeOpenAiWebSearch(key)) return testAiKeyConnection(key, signal)

  const started = Date.now()
  const model = discoverResearchModel(key)
  const capability = await discoverResearchCapabilities(key, model, signal)
  return {
    ok: true,
    latencyMs: Date.now() - started,
    provider: key.provider,
    model,
    capabilities: capability.capabilities,
    cached: capability.cached,
  }
}

/**
 * Non-streaming text completion for structured research tasks (Discover agents).
 * Returns { text, usage }. Prefer JSON-only system prompts on the caller side.
 */
export async function completeChat({
  key,
  system,
  user,
  signal,
  temperature = 0.3,
  maxTokens = 4096,
  reasoningEffort = null,
  webSearch = false,
  allowedDomains = [],
  outputSchema = null,
}) {
  const normalizedReasoningEffort = ['low', 'medium', 'high', 'max'].includes(reasoningEffort)
    ? reasoningEffort
    : null
  try {
    return await withProviderAdmission(key, signal, () => withAbortDeadline(async (deadlineSignal) => {
      if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
      if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
      if (key.enabled === false) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is disabled.')
      if (webSearch && supportsNativeOpenAiWebSearch(key)) {
        return completeOpenAiWebResearch({
          key,
          system,
          user,
          signal: deadlineSignal,
          maxTokens,
          reasoningEffort: normalizedReasoningEffort,
          allowedDomains,
          outputSchema,
        })
      }
      if (key.provider === 'anthropic') {
        return completeAnthropic({ key, system, user, signal: deadlineSignal, temperature, maxTokens })
      }
      if (key.provider === 'gemini') {
        return completeGemini({ key, system, user, signal: deadlineSignal, temperature, maxTokens })
      }
      if (normalizeAiKeyRequestMode(key.requestMode, key.provider) === 'responses') {
        return completeOpenAiResponse({
          provider: key.provider,
          key,
          system,
          user,
          signal: deadlineSignal,
          maxTokens,
          reasoningEffort: normalizedReasoningEffort,
        })
      }
      return completeOpenAiCompatible({
        provider: key.provider,
        key,
        system,
        user,
        signal: deadlineSignal,
        temperature,
        maxTokens,
        reasoningEffort: normalizedReasoningEffort,
      })
    }, { signal, timeoutMs: PROVIDER_COMPLETION_TIMEOUT_MS }))
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error instanceof AbortDeadlineError || signal?.aborted || error?.name === 'AbortError') {
      throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to return a complete response.')
    }
    // A connection can reset after response headers while the JSON body is
    // still streaming. fetchProvider owns establishment errors, but body-read
    // failures occur later and must receive the same retryable classification
    // instead of aborting an entire multi-program Discover run.
    if (isTransientProviderNetworkError(error)) {
      throw new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider connection was interrupted before the response completed.')
    }
    throw error
  }
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()
  const text = []
  for (const item of payload?.output ?? []) {
    if (item?.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (typeof part?.text === 'string') text.push(part.text)
      else if (typeof part?.text?.value === 'string') text.push(part.text.value)
    }
  }
  return text.join('').trim()
}

function responseCitationUrls(payload) {
  const urls = new Set()
  const collect = (value) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.url === 'string' && /^https:\/\//i.test(value.url)) urls.add(value.url)
    for (const child of Array.isArray(value) ? value : Object.values(value)) collect(child)
  }
  collect(payload?.output)
  return [...urls].slice(0, 100)
}

/**
 * Trusted Responses live-research path. Generic compatible providers remain
 * on Chat Completions; only explicitly capability-probed OpenAI-compatible
 * endpoints (including DeepSeek's official v4-flash endpoint) reach here.
 */
async function completeOpenAiWebResearch({
  key,
  system,
  user,
  signal,
  maxTokens,
  reasoningEffort,
  allowedDomains,
  outputSchema,
}) {
  const endpoint = openAiResponsesEndpoint(key.provider, key.baseUrl)
  const domains = [...new Set((allowedDomains || [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)))]
  const tool = {
    type: 'web_search',
    search_context_size: 'high',
    // OpenAI's web-search domain filter has a bounded allow-list. Callers
    // further scope this by region/batch; this hard cap prevents a broad source
    // registry from turning a valid research request into a provider rejection.
    ...(domains.length ? { filters: { allowed_domains: domains.slice(0, 100) } } : {}),
  }
  const response = await fetchProvider(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || providerDefaults(key.provider).defaultModel,
      instructions: system,
      input: user,
      tools: [tool],
      max_output_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      // JSON-only prompting is not enough for a background data pipeline: a
      // citation can otherwise turn an otherwise useful answer into invalid
      // JSON. Responses Structured Outputs makes the first research hand-off
      // machine-readable before we apply our independent source gate.
      ...(outputSchema?.schema && outputSchema?.name ? {
        text: {
          format: {
            type: 'json_schema',
            name: String(outputSchema.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
            schema: outputSchema.schema,
            strict: outputSchema.strict !== false,
          },
        },
      } : {}),
    }),
  }, signal)
  const payload = await readProviderJson(response, signal)
  const text = responseOutputText(payload)
  if (!text) throw new AiProviderError('EMPTY_DRAFT', 'The AI provider did not return live research text.')
  return {
    text,
    sources: responseCitationUrls(payload),
    webSearchUsed: true,
    usage: normalizedUsage(
      payload?.usage?.input_tokens,
      payload?.usage?.output_tokens,
      payload?.usage?.total_tokens,
    ),
  }
}

async function completeOpenAiResponse({
  provider,
  key,
  system,
  user,
  signal,
  maxTokens,
  reasoningEffort,
}) {
  const response = await fetchProvider(openAiResponsesEndpoint(provider, key.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || providerDefaults(provider).defaultModel,
      instructions: system,
      input: user,
      max_output_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }),
  }, signal)
  const payload = await readProviderJson(response, signal)
  const text = responseOutputText(payload)
  if (!text) throw new AiProviderError('EMPTY_DRAFT', 'The AI provider did not return research text.')
  return {
    text,
    usage: normalizedUsage(
      payload?.usage?.input_tokens,
      payload?.usage?.output_tokens,
      payload?.usage?.total_tokens,
    ),
  }
}

async function completeOpenAiCompatible({
  provider,
  key,
  system,
  user,
  signal,
  temperature,
  maxTokens,
  reasoningEffort,
}) {
  const endpoint = openAiChatEndpoint(provider, key.baseUrl)
  const response = await fetchProvider(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || providerDefaults(provider).defaultModel,
      temperature,
      max_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }, signal)
  const payload = await readProviderJson(response, signal)
  const text = payload?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiProviderError('EMPTY_DRAFT', 'The AI provider did not return research text.')
  }
  return {
    text: text.trim(),
    usage: normalizedUsage(
      payload?.usage?.prompt_tokens,
      payload?.usage?.completion_tokens,
      payload?.usage?.total_tokens,
    ),
  }
}

async function completeAnthropic({ key, system, user, signal, temperature, maxTokens }) {
  const baseUrl = normalizedBaseUrl('anthropic', key.baseUrl)
  const response = await fetchProvider(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: key.model || providerDefaults('anthropic').defaultModel,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  }, signal)
  const payload = await readProviderJson(response, signal)
  const text = (payload?.content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  if (!text.trim()) throw new AiProviderError('EMPTY_DRAFT', 'The AI provider did not return research text.')
  return {
    text: text.trim(),
    usage: normalizedUsage(payload?.usage?.input_tokens, payload?.usage?.output_tokens),
  }
}

async function completeGemini({ key, system, user, signal, temperature, maxTokens }) {
  const baseUrl = normalizedBaseUrl('gemini', key.baseUrl)
  const model = encodeURIComponent(key.model || providerDefaults('gemini').defaultModel)
  const response = await fetchProvider(
    `${baseUrl}/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { temperature, maxOutputTokens: maxTokens },
        contents: [{ role: 'user', parts: [{ text: user }] }],
      }),
    },
    signal,
  )
  const payload = await readProviderJson(response, signal)
  const text = (payload?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
  if (!text.trim()) throw new AiProviderError('EMPTY_DRAFT', 'The AI provider did not return research text.')
  return {
    text: text.trim(),
    usage: normalizedUsage(
      payload?.usageMetadata?.promptTokenCount,
      payload?.usageMetadata?.candidatesTokenCount,
      payload?.usageMetadata?.totalTokenCount,
    ),
  }
}
