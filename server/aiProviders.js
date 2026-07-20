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

async function fetchProvider(url, options, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) {
      throw new AiProviderError('PROVIDER_REJECTED', 'The AI provider rejected this request. Check the model, key, and provider URL.')
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

function openAiTools() {
  return [{
    type: 'function',
    function: {
      name: 'get_granted_application_context',
      description: 'Read the applicant data the user explicitly allowed for this email draft. Call this before drafting if more details are needed.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 240 } },
        required: [],
        additionalProperties: false,
      },
    },
  }]
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

async function streamOpenAiCompatible({ provider, key, system, instruction, grantedContext, attachments, onText, onStatus, signal }) {
  const endpoint = openAiChatEndpoint(provider, key.baseUrl)
  const attachmentParts = openAiCompatibleAttachmentParts(attachments)
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: attachmentParts.length > 0
        ? [{ type: 'text', text: instruction }, ...attachmentParts]
        : instruction,
    },
  ]

  const run = async (nextMessages, allowContextTool) => {
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
        ...(allowContextTool ? { tools: openAiTools(), tool_choice: 'auto' } : {}),
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
    if (emittedText || toolCalls.size === 0 || !allowContextTool) return usage
    const calls = Array.from(toolCalls.values()).filter((call) => call.function.name === 'get_granted_application_context')
    if (calls.length === 0) return usage
    onStatus('context')
    const assistantMessage = { role: 'assistant', tool_calls: Array.from(toolCalls.values()) }
    const toolMessages = calls.map((call) => ({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(grantedContext),
    }))
    const continuationUsage = await run([...nextMessages, assistantMessage, ...toolMessages], false)
    return addUsage(usage, continuationUsage)
  }

  return run(messages, true)
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
  }, signal)
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

export async function streamEmailDraft({ key, system, instruction, grantedContext, attachments = [], onText, onStatus, signal }) {
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (key.provider === 'anthropic') return streamAnthropic({ key, system, instruction, grantedContext, attachments, onText, signal })
  if (key.provider === 'gemini') return streamGemini({ key, system, instruction, grantedContext, attachments, onText, signal })
  return streamOpenAiCompatible({ provider: key.provider, key, system, instruction, grantedContext, attachments, onText, onStatus, signal })
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
      throw new AiProviderError('PROVIDER_REJECTED', 'The AI provider rejected this request. Check the model, key, and provider URL.')
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
  if (key.provider === 'anthropic') await testAnthropic(key, signal)
  else if (key.provider === 'gemini') await testGemini(key, signal)
  else await testOpenAiCompatible(key.provider, key, signal)
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
export async function completeChat({ key, system, user, signal, temperature = 0.3, maxTokens = 4096 }) {
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (key.provider === 'anthropic') return completeAnthropic({ key, system, user, signal, temperature, maxTokens })
  if (key.provider === 'gemini') return completeGemini({ key, system, user, signal, temperature, maxTokens })
  return completeOpenAiCompatible({ provider: key.provider, key, system, user, signal, temperature, maxTokens })
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
