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
  constructor(code, message) {
    super(message)
    this.name = 'AiProviderError'
    this.code = code
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
  if (parsed.pathname === '/' || parsed.pathname === '') return `${baseUrl}/v1/chat/completions`
  return `${baseUrl}/chat/completions`
}

function openAiResponsesEndpoint(configuredUrl) {
  const baseUrl = normalizedBaseUrl('openai', configuredUrl)
  const parsed = new URL(baseUrl)
  // The official default ends in /v1, while an explicitly configured root does
  // not. Keep both forms valid without opening this capability to arbitrary
  // OpenAI-compatible gateways that may not implement the Responses API.
  if (parsed.pathname === '/' || parsed.pathname === '') return `${baseUrl}/v1/responses`
  return `${baseUrl}/responses`
}

function openAiModelsEndpoint(provider, configuredUrl) {
  const baseUrl = normalizedBaseUrl(provider, configuredUrl)
  const parsed = new URL(baseUrl)
  if (parsed.pathname === '/' || parsed.pathname === '') return `${baseUrl}/v1/models`
  return `${baseUrl}/models`
}

const TRUSTED_RESPONSES_WEB_SEARCH_HOSTS = new Set([
  'api.openai.com',
  // Live-tested against /v1/models and /v1/responses with web_search on
  // 2026-07-22. The capability check below also pins the public HTTPS port
  // and the root or /v1 base path, so a same-host proxy path is not trusted.
  'lingsuan.top',
])

/**
 * Responses web-search is not part of the generic Chat Completions contract.
 * Only explicitly live-tested endpoints may receive a /responses request;
 * every other OpenAI-compatible gateway stays on Chat Completions.
 */
export function supportsNativeOpenAiWebSearch(key) {
  if (key?.provider !== 'openai') return false
  try {
    const url = new URL(normalizedBaseUrl('openai', key.baseUrl))
    const pathname = url.pathname.replace(/\/+$/, '')
    return TRUSTED_RESPONSES_WEB_SEARCH_HOSTS.has(url.hostname.toLowerCase())
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

function parseSseStream(response, onEvent) {
  const reader = response.body?.getReader()
  if (!reader) throw new AiProviderError('EMPTY_STREAM', 'The AI provider did not return a stream.')
  const decoder = new TextDecoder()
  let buffer = ''

  const processLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    try {
      onEvent(JSON.parse(data))
    } catch {
      // Provider keep-alive lines and malformed individual chunks are non-fatal.
    }
  }

  return (async () => {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = done ? '' : (lines.pop() ?? '')
      lines.forEach(processLine)
      if (done) break
    }
    if (buffer) processLine(buffer)
  })()
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
    return new AiProviderError('PROVIDER_RATE_LIMITED', 'The AI provider is temporarily rate limited. Please retry shortly.')
  }
  if (status === 408 || status === 504) {
    return new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.')
  }
  if ([500, 502, 503].includes(status)) {
    return new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.')
  }
  return new AiProviderError('PROVIDER_REJECTED', 'The AI provider rejected this request. Check the model, key, and provider URL.')
}

async function fetchProvider(url, options, signal, timeoutMs = 90_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) {
      throw providerHttpError(response.status)
    }
    return response
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error?.name === 'AbortError') throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.')
    throw new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function openAiTools(attachmentCandidates = []) {
  const tools = [{
    type: 'function',
    function: {
      name: 'get_granted_application_context',
      description: 'Read the applicant data the user explicitly allowed for this editable email draft, including eligible files that may be attached. Call this before drafting if more details are needed.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 240 } },
        required: [],
        additionalProperties: false,
      },
    },
  }]
  if (attachmentCandidates.length === 0) return tools
  const candidateSummary = attachmentCandidates
    .slice(0, 80)
    .map((candidate) => `${candidate.name} [${candidate.id}]`)
    .join('; ')
  tools.push({
    type: 'function',
    function: {
      name: 'select_email_attachments',
      description: `Add one or more suitable saved files to the editable email draft. This never sends an email. Only use candidate ids that were explicitly provided. Available candidates: ${candidateSummary}`,
      parameters: {
        type: 'object',
        properties: {
          attachmentIds: {
            type: 'array',
            items: { type: 'string', enum: attachmentCandidates.map((candidate) => candidate.id) },
            maxItems: Math.min(20, attachmentCandidates.length),
          },
        },
        required: ['attachmentIds'],
        additionalProperties: false,
      },
    },
  })
  return tools
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
  const candidateIds = new Set(attachmentCandidates.map((candidate) => candidate.id))
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
    await parseSseStream(response, (event) => {
      if (event.usage) {
        usage = normalizedUsage(
          event.usage.prompt_tokens,
          event.usage.completion_tokens,
          event.usage.total_tokens,
        )
      }
      const choice = event.choices?.[0]
      const delta = choice?.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        emittedText = true
        onText(delta.content)
      }
      for (const chunk of delta.tool_calls ?? []) {
        const index = Number(chunk.index ?? 0)
        const current = toolCalls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
        current.id += chunk.id ?? ''
        current.function.name += chunk.function?.name ?? ''
        current.function.arguments += chunk.function?.arguments ?? ''
        toolCalls.set(index, current)
      }
    })
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
        let requestedIds = []
        try {
          const parsed = JSON.parse(call.function.arguments || '{}')
          if (Array.isArray(parsed?.attachmentIds)) requestedIds = parsed.attachmentIds
        } catch {
          // The provider receives a structured tool error below and can still
          // continue drafting without adding an attachment.
        }
        const selectedIds = Array.from(new Set(requestedIds.map((id) => String(id))))
          .filter((id) => candidateIds.has(id))
          .slice(0, 20)
        if (selectedIds.length > 0) {
          onStatus?.('attaching')
          onAttachmentSelection?.(selectedIds)
        }
        return {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ selectedAttachmentIds: selectedIds, draftOnly: true }),
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

async function streamAnthropic({ key, system, instruction, grantedContext, attachments, onText, signal }) {
  const baseUrl = normalizedBaseUrl('anthropic', key.baseUrl)
  const content = [{ type: 'text', text: `${instruction}\n\nGranted context:\n${JSON.stringify(grantedContext)}` }]
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
      messages: [{ role: 'user', content }],
    }),
  }, signal, 150_000)
  let usage = emptyUsage()
  await parseSseStream(response, (event) => {
    const reported = event.message?.usage ?? event.usage
    if (reported) {
      usage = normalizedUsage(
        Math.max(usage.inputTokens, Number(reported.input_tokens ?? 0)),
        Math.max(usage.outputTokens, Number(reported.output_tokens ?? 0)),
      )
    }
    if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') onText(event.delta.text)
  })
  return usage
}

async function streamGemini({ key, system, instruction, grantedContext, attachments, onText, signal }) {
  const baseUrl = normalizedBaseUrl('gemini', key.baseUrl)
  const model = encodeURIComponent(key.model || providerDefaults('gemini').defaultModel)
  const parts = [{ text: `${instruction}\n\nGranted context:\n${JSON.stringify(grantedContext)}` }]
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
  const response = await fetchProvider(`${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { temperature: 0.35 },
      contents: [{ role: 'user', parts }],
    }),
  }, signal)
  let usage = emptyUsage()
  await parseSseStream(response, (event) => {
    if (event.usageMetadata) {
      usage = normalizedUsage(
        event.usageMetadata.promptTokenCount,
        event.usageMetadata.candidatesTokenCount,
        event.usageMetadata.totalTokenCount,
      )
    }
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === 'string') onText(part.text)
    }
  })
  return usage
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
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (key.provider === 'anthropic') return streamAnthropic({ key, system, instruction, grantedContext, attachments, onText, signal })
  if (key.provider === 'gemini') return streamGemini({ key, system, instruction, grantedContext, attachments, onText, signal })
  return streamOpenAiCompatible({
    provider: key.provider,
    key,
    system,
    instruction,
    grantedContext,
    attachments,
    attachmentCandidates,
    onText,
    onStatus,
    onAttachmentSelection,
    signal,
  })
}

/** Short timeout for connectivity probes (not full drafting). */
async function fetchProviderProbe(url, options, signal, timeoutMs = 20_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) {
      throw providerHttpError(response.status)
    }
    // Drain body so sockets can close promptly on keep-alive servers.
    try { await response.arrayBuffer() } catch { /* ignore */ }
    return response
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error?.name === 'AbortError') throw new AiProviderError('PROVIDER_TIMEOUT', 'The AI provider took too long to respond.')
    throw new AiProviderError('PROVIDER_UNAVAILABLE', 'The AI provider could not be reached.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

const RETRYABLE_PROVIDER_PROBE_CODES = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
])

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
    `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const started = Date.now()
  await retryProviderProbe(async () => {
    if (key.provider === 'anthropic') await testAnthropic(key, signal)
    else if (key.provider === 'gemini') await testGemini(key, signal)
    else await testOpenAiCompatible(key.provider, key, signal)
  }, signal)
  return {
    ok: true,
    latencyMs: Date.now() - started,
    provider: key.provider,
    model: key.model || providerDefaults(key.provider)?.defaultModel || '',
  }
}

/**
 * Discover's trusted Responses gateways are authenticated with their lightweight
 * models endpoint. Using Chat Completions here can falsely time out even though
 * the Responses API used by the actual research job is healthy.
 */
export async function testAiResearchKeyConnection(key, signal) {
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (!supportsNativeOpenAiWebSearch(key)) return testAiKeyConnection(key, signal)

  const started = Date.now()
  await retryProviderProbe(() => fetchProviderProbe(openAiModelsEndpoint(key.provider, key.baseUrl), {
    method: 'GET',
    headers: { Authorization: `Bearer ${key.apiKey}` },
  }, signal), signal)
  return {
    ok: true,
    latencyMs: Date.now() - started,
    provider: key.provider,
    model: key.model || providerDefaults(key.provider)?.defaultModel || '',
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
  webSearch = false,
  allowedDomains = [],
  outputSchema = null,
}) {
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (webSearch && supportsNativeOpenAiWebSearch(key)) {
    return completeOpenAiWebResearch({ key, system, user, signal, maxTokens, allowedDomains, outputSchema })
  }
  if (key.provider === 'anthropic') return completeAnthropic({ key, system, user, signal, temperature, maxTokens })
  if (key.provider === 'gemini') return completeGemini({ key, system, user, signal, temperature, maxTokens })
  return completeOpenAiCompatible({ provider: key.provider, key, system, user, signal, temperature, maxTokens })
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
 * Official OpenAI live research path. It deliberately uses the Responses API
 * only for an `openai` key because the web-search tool is not part of the
 * Chat Completions compatibility contract used by other providers.
 */
async function completeOpenAiWebResearch({ key, system, user, signal, maxTokens, allowedDomains, outputSchema }) {
  const endpoint = openAiResponsesEndpoint(key.baseUrl)
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
      model: key.model || providerDefaults('openai').defaultModel,
      instructions: system,
      input: user,
      tools: [tool],
      max_output_tokens: maxTokens,
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
  const payload = await response.json().catch(() => ({}))
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

async function completeOpenAiCompatible({ provider, key, system, user, signal, temperature, maxTokens }) {
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
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }, signal)
  const payload = await response.json().catch(() => ({}))
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
  const payload = await response.json().catch(() => ({}))
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
    `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { temperature, maxOutputTokens: maxTokens },
        contents: [{ role: 'user', parts: [{ text: user }] }],
      }),
    },
    signal,
  )
  const payload = await response.json().catch(() => ({}))
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
