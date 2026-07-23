import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeChat,
  streamEmailDraft,
  supportsNativeOpenAiWebSearch,
  testAiResearchKeyConnection,
  testAiKeyConnection,
  AiProviderError,
} from './aiProviders.js'

const encoder = new TextEncoder()

function sseResponse(events) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const baseRequest = {
  key: {
    provider: 'openai',
    apiKey: 'test-key-only',
    baseUrl: 'https://gateway.example',
    model: 'gateway-test-model',
  },
  system: 'Draft a concise, professional email.',
  instruction: 'Write a follow-up to the professor.',
  grantedContext: { profile: { name: 'Test Applicant' } },
  attachments: [],
  onStatus: vi.fn(),
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AI key connection probe', () => {
  it('posts a minimal OpenAI-compatible completion to verify the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await testAiKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    })

    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-4.1-mini',
      max_tokens: 1,
      stream: false,
    })
  })

  it('surfaces provider rejection for invalid keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'bad',
      baseUrl: '',
      model: 'gpt-4.1-mini',
    })).rejects.toBeInstanceOf(AiProviderError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries one transient probe failure before accepting a healthy key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'transient-key',
      baseUrl: 'https://gateway.example',
      model: 'gateway-test-model',
    })).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    [429, 'PROVIDER_RATE_LIMITED'],
    [502, 'PROVIDER_UNAVAILABLE'],
    [503, 'PROVIDER_UNAVAILABLE'],
    [504, 'PROVIDER_TIMEOUT'],
  ])('maps transient HTTP %i responses to retryable provider errors', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('temporary failure', { status })))

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'temporary-key',
      baseUrl: '',
      model: 'gpt-4.1-mini',
    })).rejects.toMatchObject({ code })
  })
})

describe('AI provider streaming', () => {
  it('uses the /v1 chat endpoint for an OpenAI-compatible gateway root and streams tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: 'Dear Professor ' } }] },
      { choices: [{ delta: { content: 'Chen,' } }] },
      { choices: [], usage: { prompt_tokens: 41, completion_tokens: 8, total_tokens: 49 } },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const tokens = []

    const usage = await streamEmailDraft({ ...baseRequest, onText: (token) => tokens.push(token) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/chat/completions')
    expect(tokens.join('')).toBe('Dear Professor Chen,')
    expect(usage).toEqual({ inputTokens: 41, outputTokens: 8, totalTokens: 49 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gateway-test-model',
      stream: true,
      stream_options: { include_usage: true },
      tools: [expect.objectContaining({
        function: expect.objectContaining({ name: 'get_granted_application_context' }),
      })],
    })
  })

  it('returns only granted context when the model invokes the context function before drafting', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        { choices: [{ delta: {
          tool_calls: [{
            index: 0,
            id: 'call_context_1',
            type: 'function',
            function: { name: 'get_granted_application_context', arguments: '{"reason":"Personalize the greeting"}' },
          }],
        } }] },
      ]))
      .mockResolvedValueOnce(sseResponse([
        { choices: [{ delta: { content: 'Dear Professor Chen,' } }] },
      ]))
    vi.stubGlobal('fetch', fetchMock)
    const onStatus = vi.fn()
    const tokens = []

    await streamEmailDraft({ ...baseRequest, onStatus, onText: (token) => tokens.push(token) })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenCalledWith('context')
    const continuation = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(continuation.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: expect.objectContaining({ name: 'get_granted_application_context' }),
      }),
    ]))
    expect(continuation.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_context_1',
        content: JSON.stringify(baseRequest.grantedContext),
      }),
    ]))
    expect(tokens.join('')).toBe('Dear Professor Chen,')
  })

  it('lets the model add only server-provided files to the editable draft', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        { choices: [{ delta: {
          tool_calls: [{
            index: 0,
            id: 'call_attachments_1',
            type: 'function',
            function: { name: 'select_email_attachments', arguments: '{"attachmentIds":["file:cv-1","file:forged"]}' },
          }],
        } }] },
      ]))
      .mockResolvedValueOnce(sseResponse([
        { choices: [{ delta: { content: 'Subject: Research fit\n\nDear Professor Chen,' } }] },
      ]))
    vi.stubGlobal('fetch', fetchMock)
    const onStatus = vi.fn()
    const onAttachmentSelection = vi.fn()

    await streamEmailDraft({
      ...baseRequest,
      onStatus,
      onAttachmentSelection,
      attachmentCandidates: [{ id: 'file:cv-1', name: 'CV.pdf', mimeType: 'application/pdf' }],
      onText: vi.fn(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenCalledWith('attaching')
    expect(onAttachmentSelection).toHaveBeenCalledWith(['file:cv-1'])
    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(firstRequest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: expect.objectContaining({ name: 'select_email_attachments' }),
      }),
    ]))
    const continuation = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(continuation.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_attachments_1',
        content: JSON.stringify({ selectedAttachmentIds: ['file:cv-1'], draftOnly: true }),
      }),
    ]))
  })
})

describe('OpenAI live web research', () => {
  it('keeps custom OpenAI-compatible gateways on Chat Completions even when web research is requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"gateway result","suggestedPrograms":[]}' } }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeChat({
      key: { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://lingsuan.example', model: 'compatible-model' },
      system: 'Return JSON only.',
      user: 'Use only the supplied official evidence.',
      webSearch: true,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://lingsuan.example/v1/chat/completions')
    expect(result.text).toBe('{"summary":"gateway result","suggestedPrograms":[]}')
    expect(result.webSearchUsed).toBeUndefined()
  })

  it('recognizes only explicitly live-tested Responses web-search bases', () => {
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: '' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top/v1' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://api.openai.com.evil.example/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top.evil.example/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top:444/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top/proxy/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top/v1?target=responses' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://gateway.example' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'deepseek', baseUrl: 'https://api.openai.com/v1' })).toBe(false)
  })

  it('uses the verified Lingsuan Responses endpoint for live web research', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"summary":"Lingsuan live result","suggestedPrograms":[]}',
      usage: { input_tokens: 13, output_tokens: 7, total_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeChat({
      key: { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://lingsuan.top', model: 'gpt-5.4-mini' },
      system: 'Return JSON only.',
      user: 'Find an official doctoral programme.',
      webSearch: true,
      allowedDomains: ['example.edu'],
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://lingsuan.top/v1/responses')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-5.4-mini',
      tools: [{ type: 'web_search', filters: { allowed_domains: ['example.edu'] } }],
    })
    expect(result.webSearchUsed).toBe(true)
  })

  it('preflights a trusted Responses research key through the lightweight models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'gpt-5.4-mini' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await testAiResearchKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://lingsuan.top/v1/models',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-5.4-mini' })
  })

  it('retries a transient trusted Responses preflight without queuing a false failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'gpt-5.4-mini' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiResearchKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    })).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the Responses API with the official web-search tool and retains citations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: '{"summary":"Official-source result","suggestedPrograms":[]}',
          annotations: [{ type: 'url_citation', url: 'https://www.example.edu/graduate/phd' }],
        }],
      }],
      usage: { input_tokens: 19, output_tokens: 11, total_tokens: 30 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeChat({
      key: { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
      system: 'Return JSON only.',
      user: 'Find a PhD programme.',
      webSearch: true,
      allowedDomains: ['example.edu'],
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-4.1-mini',
      tools: [{ type: 'web_search', filters: { allowed_domains: ['example.edu'] } }],
    })
    expect(result).toMatchObject({
      text: '{"summary":"Official-source result","suggestedPrograms":[]}',
      sources: ['https://www.example.edu/graduate/phd'],
      webSearchUsed: true,
      usage: { inputTokens: 19, outputTokens: 11, totalTokens: 30 },
    })
  })

  it('uses Responses Structured Outputs when a research agent supplies a schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"summary":"ok","suggestedPrograms":[]}',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await completeChat({
      key: { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' },
      system: 'Return JSON only.',
      user: 'Find an official doctoral programme.',
      webSearch: true,
      outputSchema: {
        name: 'official_program_result',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' }, suggestedPrograms: { type: 'array', items: {} } },
          required: ['summary', 'suggestedPrograms'],
        },
      },
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      text: {
        format: {
          type: 'json_schema',
          name: 'official_program_result',
          strict: true,
        },
      },
    })
  })
})
