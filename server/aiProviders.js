import { AbortDeadlineError, withAbortDeadline } from './abortDeadline.js'
import { OutboundNetworkPolicyError } from './outboundNetworkPolicy.js'
import { pinnedHttpsFetch } from './pinnedHttpsFetch.js'

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
  try {
    const response = await withAbortDeadline(
      (deadlineSignal) => (
        process.env.NODE_ENV === 'production'
          ? pinnedHttpsFetch(url, { ...options, signal: deadlineSignal })
          : fetch(url, { ...options, redirect: 'error', signal: deadlineSignal })
      ),
      { signal, timeoutMs },
    )
    if (!response.ok) {
      throw providerHttpError(response.status)
    }
    return response
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error instanceof OutboundNetworkPolicyError || error?.code === 'INVALID_OUTBOUND_URL') {
      throw new AiProviderError(
        'INVALID_BASE_URL',
        'The provider URL must resolve only to a public HTTPS endpoint.',
      )
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
    await parseSseStream(response, (event) => {
      const reported = event.message?.usage ?? event.usage
      if (reported) {
        usage = normalizedUsage(
          Math.max(usage.inputTokens, Number(reported.input_tokens ?? 0)),
          Math.max(usage.outputTokens, Number(reported.output_tokens ?? 0)),
        )
      }
      if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
        emittedText = true
        onText(event.delta.text)
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
    })
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
    const response = await fetchProvider(`${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    await parseSseStream(response, (event) => {
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
          onText(part.text)
        }
        if (part.functionCall?.name) calls.push(part.functionCall)
      }
    })
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
  if (!providerDefaults(key.provider)) throw new AiProviderError('UNSUPPORTED_PROVIDER', 'This AI provider is not supported.')
  if (!key.apiKey) throw new AiProviderError('KEY_UNAVAILABLE', 'The saved AI key is unavailable.')
  if (key.provider === 'anthropic') {
    return streamAnthropic({
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
  if (key.provider === 'gemini') {
    return streamGemini({
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
  try {
    const response = await withAbortDeadline(
      (deadlineSignal) => (
        process.env.NODE_ENV === 'production'
          ? pinnedHttpsFetch(url, { ...options, signal: deadlineSignal })
          : fetch(url, { ...options, redirect: 'error', signal: deadlineSignal })
      ),
      { signal, timeoutMs },
    )
    if (!response.ok) {
      throw providerHttpError(response.status)
    }
    // Drain body so sockets can close promptly on keep-alive servers.
    try { await response.arrayBuffer() } catch { /* ignore */ }
    return response
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error instanceof OutboundNetworkPolicyError || error?.code === 'INVALID_OUTBOUND_URL') {
      throw new AiProviderError(
        'INVALID_BASE_URL',
        'The provider URL must resolve only to a public HTTPS endpoint.',
      )
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
