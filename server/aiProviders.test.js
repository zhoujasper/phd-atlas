import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAiResearchCapabilityProbeCache,
  completeChat,
  sanitizeAiAttachmentFileName,
  streamEmailDraft,
  supportsNativeOpenAiWebSearch,
  testAiResearchKeyConnection,
  testAiKeyConnection,
  AiProviderError,
} from './aiProviders.js'
import { OutboundNetworkPolicyError } from './outboundNetworkPolicy.js'

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

function researchModelsResponse(ids = ['gpt-5.4-mini']) {
  return new Response(JSON.stringify({
    data: ids.map((id) => ({ id, object: 'model' })),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function researchCapabilityResponse({
  marker = 'discover_research_v1',
  webSearchStatus = 'completed',
} = {}) {
  return new Response(JSON.stringify({
    output: [
      { type: 'web_search_call', status: webSearchStatus },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({ capability: marker }),
        }],
      },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  clearAiResearchCapabilityProbeCache()
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

  it('probes the configured Responses protocol and rejects disabled keys before network I/O', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://gateway.example/v1',
      model: 'responses-model',
      requestMode: 'responses',
    })).resolves.toMatchObject({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/responses')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'responses-model',
      input: 'ping',
    })

    fetchMock.mockClear()
    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'responses-model',
      enabled: false,
    })).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('retries a temporary provider DNS failure without calling it an invalid base URL', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new OutboundNetworkPolicyError(
      'OUTBOUND_HOST_UNRESOLVED',
      'temporary DNS failure',
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'temporary-key',
      baseUrl: 'https://gateway.example',
      model: 'gateway-test-model',
    })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a private or reserved provider resolution as a permanent base URL rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new OutboundNetworkPolicyError(
      'OUTBOUND_HOST_NOT_PUBLIC',
      'private target',
    )))

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'unsafe-key',
      baseUrl: 'https://unsafe.example',
      model: 'gateway-test-model',
    })).rejects.toMatchObject({ code: 'INVALID_BASE_URL' })
  })
})

describe('AI provider streaming', () => {
  it('streams email drafts through the selected Responses protocol', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { type: 'response.created', response: { id: 'resp_1' } },
      { type: 'response.output_text.delta', delta: 'Dear Professor Chen,' },
      {
        type: 'response.completed',
        response: { id: 'resp_1', usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } },
      },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const tokens = []

    const usage = await streamEmailDraft({
      ...baseRequest,
      key: { ...baseRequest.key, requestMode: 'responses' },
      onText: (token) => tokens.push(token),
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/responses')
    expect(tokens.join('')).toBe('Dear Professor Chen,')
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 4, totalTokens: 24 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gateway-test-model',
      stream: true,
      instructions: baseRequest.system,
    })
  })

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

  it('accepts an OpenAI-compatible gateway that returns one JSON completion despite stream mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: 'Dear Professor Chen,' }] } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const tokens = []

    const usage = await streamEmailDraft({ ...baseRequest, onText: (token) => tokens.push(token) })

    expect(tokens.join('')).toBe('Dear Professor Chen,')
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 4, totalTokens: 16 })
  })

  it('reports malformed and upstream error frames instead of mislabelling them as an empty draft', async () => {
    const malformed = new Response('data: {not-json}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
    const limited = sseResponse([{ error: { code: 'rate_limit_exceeded' } }])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(limited)
    vi.stubGlobal('fetch', fetchMock)

    await expect(streamEmailDraft({ ...baseRequest, onText: vi.fn() }))
      .rejects.toMatchObject({ code: 'PROVIDER_STREAM_INVALID' })
    await expect(streamEmailDraft({ ...baseRequest, onText: vi.fn() }))
      .rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' })
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
            function: {
              name: 'select_email_attachments',
              arguments: '{"attachments":[{"attachmentId":"file:cv-1","fileName":"Jasper Zhou Academic CV.docx"},{"attachmentId":"file:forged","fileName":"stolen.pdf"}]}',
            },
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
    expect(onAttachmentSelection).toHaveBeenCalledWith([
      { attachmentId: 'file:cv-1', fileName: 'Jasper Zhou Academic CV.pdf' },
    ])
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
        content: JSON.stringify({
          selectedAttachments: [{ attachmentId: 'file:cv-1', fileName: 'Jasper Zhou Academic CV.pdf' }],
          draftOnly: true,
        }),
      }),
    ]))
  })

  it('sanitizes recipient-facing attachment names without changing the real extension', () => {
    expect(sanitizeAiAttachmentFileName('../../Research CV.exe', 'original.CV.pdf')).toBe('Research CV.pdf')
    expect(sanitizeAiAttachmentFileName('CON', 'writing-sample.docx')).toBe('attachment-CON.docx')
    expect(sanitizeAiAttachmentFileName('', 'statement-of-purpose.pdf')).toBe('statement-of-purpose.pdf')
  })

  it('supports the same constrained attachment plan through Anthropic tool use', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_attach_1', name: 'select_email_attachments', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"attachments":[{"attachmentId":"file:cv-1","fileName":"Applicant CV.pdf"}]}',
          },
        },
      ]))
      .mockResolvedValueOnce(sseResponse([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Subject: Research fit' } },
      ]))
    vi.stubGlobal('fetch', fetchMock)
    const onAttachmentSelection = vi.fn()

    await streamEmailDraft({
      ...baseRequest,
      key: {
        provider: 'anthropic',
        apiKey: 'test-key-only',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-test',
      },
      attachmentCandidates: [{ id: 'file:cv-1', name: 'CV.pdf', mimeType: 'application/pdf' }],
      onAttachmentSelection,
      onText: vi.fn(),
    })

    expect(onAttachmentSelection).toHaveBeenCalledWith([
      { attachmentId: 'file:cv-1', fileName: 'Applicant CV.pdf' },
    ])
    const continuation = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(continuation.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_attach_1' })],
      }),
    ]))
  })

  it('supports the same constrained attachment plan through Gemini function calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        {
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  name: 'select_email_attachments',
                  args: { attachments: [{ attachmentId: 'file:cv-1', fileName: 'Applicant CV.pdf' }] },
                },
              }],
            },
          }],
        },
      ]))
      .mockResolvedValueOnce(sseResponse([
        { candidates: [{ content: { parts: [{ text: 'Subject: Research fit' }] } }] },
      ]))
    vi.stubGlobal('fetch', fetchMock)
    const onAttachmentSelection = vi.fn()

    await streamEmailDraft({
      ...baseRequest,
      key: {
        provider: 'gemini',
        apiKey: 'test-key-only',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-test',
      },
      attachmentCandidates: [{ id: 'file:cv-1', name: 'CV.pdf', mimeType: 'application/pdf' }],
      onAttachmentSelection,
      onText: vi.fn(),
    })

    expect(onAttachmentSelection).toHaveBeenCalledWith([
      { attachmentId: 'file:cv-1', fileName: 'Applicant CV.pdf' },
    ])
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).not.toContain('test-key-only')
      expect(init.headers).toMatchObject({ 'x-goog-api-key': 'test-key-only' })
    }
    const continuation = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(continuation.contents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        parts: [expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'select_email_attachments' }),
        })],
      }),
    ]))
  })

  it('awaits a slow downstream token consumer before reading the next SSE event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: 'first' } }] },
      { choices: [{ delta: { content: 'second' } }] },
    ])))
    let releaseFirst
    const firstConsumed = new Promise((resolve) => { releaseFirst = resolve })
    const tokens = []
    const drafting = streamEmailDraft({
      ...baseRequest,
      onText: async (token) => {
        tokens.push(token)
        if (token === 'first') await firstConsumed
      },
    })

    await vi.waitFor(() => expect(tokens).toEqual(['first']))
    releaseFirst()
    await drafting
    expect(tokens).toEqual(['first', 'second'])
  })

  it('cancels a provider body that remains open after response headers', async () => {
    const cancelled = vi.fn()
    const hangingResponse = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'first' } }] })}\n\n`))
      },
      cancel: cancelled,
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hangingResponse))
    const controller = new AbortController()

    const drafting = streamEmailDraft({
      ...baseRequest,
      signal: controller.signal,
      onText: () => controller.abort(new Error('client disconnected')),
    })
    await expect(drafting).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
})

describe('OpenAI live web research', () => {
  it('lets one authorized key use both bounded provider slots', async () => {
    const releases = []
    const fetchMock = vi.fn(() => new Promise((resolve) => releases.push(resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const key = {
      id: 'discover-key',
      ownerId: 'discover-owner',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://gateway.example',
      model: 'test-model',
    }

    const completions = [1, 2].map((index) => completeChat({
      key,
      system: 'Return JSON.',
      user: `batch ${index}`,
    }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    for (const [index, release] of releases.entries()) {
      release(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ batch: index + 1 }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }

    await expect(Promise.all(completions)).resolves.toEqual([
      expect.objectContaining({ text: '{"batch":1}' }),
      expect.objectContaining({ text: '{"batch":2}' }),
    ])
  })

  it('uses the saved key concurrency instead of silently retaining the two-slot default', async () => {
    const releases = []
    const fetchMock = vi.fn(() => new Promise((resolve) => releases.push(resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const key = {
      id: 'wide-discover-key',
      ownerId: 'discover-owner',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://gateway.example',
      model: 'test-model',
      maxConcurrency: 6,
    }

    const completions = Array.from({ length: 6 }, (_, index) => completeChat({
      key,
      system: 'Return JSON.',
      user: `parallel batch ${index + 1}`,
    }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    for (const [index, release] of releases.entries()) {
      release(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ batch: index + 1 }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    await expect(Promise.all(completions)).resolves.toHaveLength(6)
  })

  it('returns structured 429 metadata when 100 accounts exhaust provider admission', async () => {
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start() {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const controllers = Array.from({ length: 100 }, () => new AbortController())
    const settledErrors = []
    const completions = controllers.map((controller, index) => completeChat({
      key: {
        id: `key-${index}`,
        ownerId: `user-${index}`,
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://gateway.example',
        model: 'test-model',
      },
      system: 'Return JSON.',
      user: 'test',
      signal: controller.signal,
    }).catch((error) => {
      settledErrors.push(error)
      throw error
    }))
    const allSettled = Promise.allSettled(completions)

    await vi.waitFor(() => {
      expect(settledErrors.filter((error) => error.code === 'AI_CAPACITY_EXCEEDED').length).toBeGreaterThanOrEqual(32)
    })
    const capacityError = settledErrors.find((error) => error.code === 'AI_CAPACITY_EXCEEDED')
    expect(capacityError).toMatchObject({ status: 429, retryAfterSeconds: 2 })
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)

    controllers.forEach((controller) => controller.abort(new Error('test cleanup')))
    await allSettled
  })

  it('cancels a non-streaming provider body that stalls after response headers', async () => {
    const cancelled = vi.fn()
    const pulled = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start() {},
      pull: pulled,
      cancel: cancelled,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const controller = new AbortController()
    const completion = completeChat({
      key: { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://gateway.example', model: 'test-model' },
      system: 'Return JSON.',
      user: 'test',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(pulled).toHaveBeenCalled())
    controller.abort(new Error('client disconnected'))

    await expect(completion).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))
  })

  it('uses the selected Responses protocol for ordinary non-streaming completions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"summary":"responses result"}',
      usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeChat({
      key: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://gateway.example/v1',
        model: 'responses-model',
        requestMode: 'responses',
      },
      system: 'Return JSON only.',
      user: 'Summarize the supplied evidence.',
      reasoningEffort: 'high',
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/responses')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'responses-model',
      instructions: 'Return JSON only.',
      input: 'Summarize the supplied evidence.',
      reasoning: { effort: 'high' },
    })
    expect(result).toEqual({
      text: '{"summary":"responses result"}',
      usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
    })
  })

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
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: '', requestMode: 'chat_completions' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top/v1' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'http://api.openai.com/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://api.openai.com./v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://api.openai.com@evil.example/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://api.openai.com.evil.example/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top.evil.example/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top:444/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top/proxy/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://lingsuan.top/v1?target=responses' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com/v1' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com.evil.example/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com:444/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com/proxy/v1' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com/v1?target=responses' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://sub2api.luchikey.com/v1#responses' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' })).toBe(true)
    expect(supportsNativeOpenAiWebSearch({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com.evil.example', model: 'deepseek-v4-flash' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'openai', baseUrl: 'https://gateway.example' })).toBe(false)
    expect(supportsNativeOpenAiWebSearch({ provider: 'deepseek', baseUrl: 'https://api.openai.com/v1' })).toBe(false)
  })

  it('uses DeepSeek official Responses web search with maximum reasoning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"summary":"DeepSeek live result","suggestedPrograms":[]}',
      output: [{ type: 'web_search_call', status: 'completed' }],
      usage: { input_tokens: 11, output_tokens: 9, total_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeChat({
      key: {
        provider: 'deepseek',
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
      system: 'Return JSON only.',
      user: 'Find an official doctoral programme.',
      webSearch: true,
      reasoningEffort: 'max',
      allowedDomains: ['example.edu'],
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/responses')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'deepseek-v4-flash',
      reasoning: { effort: 'max' },
      tools: [{ type: 'web_search', filters: { allowed_domains: ['example.edu'] } }],
    })
    expect(result.webSearchUsed).toBe(true)
  })

  it('classifies a reset while reading a completed-response body as retryable provider unavailability', async () => {
    const transportError = Object.assign(new Error('aborted'), { code: 'ECONNRESET' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.error(transportError)
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(completeChat({
      key: {
        provider: 'deepseek',
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
      system: 'Return JSON only.',
      user: 'Find an official doctoral programme.',
      webSearch: true,
      reasoningEffort: 'max',
      allowedDomains: ['example.edu'],
    })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
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

  it('preflights the exact model and the complete low-token Discover capability combination', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(researchModelsResponse(['gpt-5.4-mini', 'other-model']))
      .mockResolvedValueOnce(researchCapabilityResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await testAiResearchKeyConnection({
      id: 'aikey-capability-success',
      updatedAt: '2026-08-03T00:00:00.000Z',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://lingsuan.top/v1/models',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://lingsuan.top/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    )
    const probe = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(probe).toMatchObject({
      model: 'gpt-5.4-mini',
      tools: [{
        type: 'web_search',
        search_context_size: 'low',
        filters: { allowed_domains: ['iana.org'] },
      }],
      tool_choice: { type: 'web_search' },
      max_output_tokens: 128,
      reasoning: { effort: 'low' },
      text: {
        format: {
          type: 'json_schema',
          name: 'discover_research_capability',
          strict: true,
          schema: {
            required: ['capability'],
            additionalProperties: false,
          },
        },
      },
    })
    expect(result).toMatchObject({
      ok: true,
      provider: 'openai',
      model: 'gpt-5.4-mini',
      cached: false,
      capabilities: {
        responses: true,
        webSearch: true,
        structuredOutput: true,
        reasoning: true,
      },
    })
  })

  it('probes the same maximum-reasoning shape that Luna planner and verifier calls require', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(researchModelsResponse(['gpt-5.6-luna']))
      .mockResolvedValueOnce(researchCapabilityResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiResearchKeyConnection({
      id: 'aikey-luna-capability-shape',
      updatedAt: '2026-08-03T00:00:00.000Z',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.6-luna',
    })).resolves.toMatchObject({
      ok: true,
      model: 'gpt-5.6-luna',
      capabilities: { reasoning: true },
    })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      model: 'gpt-5.6-luna',
      max_output_tokens: 1_024,
      reasoning: { effort: 'max' },
    })
  })

  it('accepts DeepSeek Responses prose only when it contains the exact schema marker after a completed web search', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(researchModelsResponse(['deepseek-v4-flash']))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [
          { type: 'web_search_call', status: 'completed' },
          {
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'Confirmed from IANA.\n\n{"capability":"discover_research_v1"}',
            }],
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiResearchKeyConnection({
      id: 'deepseek-responses-live-shape',
      provider: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    })).resolves.toMatchObject({
      ok: true,
      capabilities: { responses: true, webSearch: true, structuredOutput: true, reasoning: true },
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      model: 'deepseek-v4-flash',
      max_output_tokens: 2_048,
      reasoning: { effort: 'max' },
    })
  })

  it('retries a transient trusted Responses preflight without queuing a false failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(researchModelsResponse())
      .mockResolvedValueOnce(researchCapabilityResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiResearchKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    })).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects a near-match because the selected research model must be listed exactly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(researchModelsResponse([
      'gpt-5.4-mini-preview',
      'GPT-5.4-MINI',
      ' gpt-5.4-mini',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiResearchKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    })).rejects.toMatchObject({
      code: 'DISCOVER_RESEARCH_UNSUPPORTED',
      status: 422,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['wrong structured marker', { marker: 'different-capability' }],
    ['failed web-search call', { webSearchStatus: 'failed' }],
  ])('rejects a nominal 200 with %s', async (_label, responseOptions) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(researchModelsResponse())
      .mockResolvedValueOnce(researchCapabilityResponse(responseOptions))
    vi.stubGlobal('fetch', fetchMock)

    await expect(testAiResearchKeyConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    })).rejects.toMatchObject({ code: 'DISCOVER_RESEARCH_UNSUPPORTED', status: 422 })
  })

  it('normalizes a permanent capability-parameter rejection to the stable unsupported error', async () => {
    const secret = 'sk-capability-rejection-private-test-only'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(researchModelsResponse())
      .mockResolvedValueOnce(new Response(`unsupported combination for ${secret}`, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    let rejection
    try {
      await testAiResearchKeyConnection({
        provider: 'openai',
        apiKey: secret,
        baseUrl: 'https://lingsuan.top',
        model: 'gpt-5.4-mini',
      })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({
      code: 'DISCOVER_RESEARCH_UNSUPPORTED',
      status: 422,
      upstreamStatus: null,
    })
    expect(`${rejection?.message || ''}\n${JSON.stringify(rejection)}`).not.toContain(secret)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent probes and serves a later result from the bounded cache', async () => {
    let releaseCapability
    const capabilityGate = new Promise((resolve) => { releaseCapability = resolve })
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith('/models')) return researchModelsResponse()
      await capabilityGate
      return researchCapabilityResponse()
    })
    vi.stubGlobal('fetch', fetchMock)
    const key = {
      id: 'aikey-deduplicated',
      updatedAt: '2026-08-03T00:00:00.000Z',
      provider: 'openai',
      apiKey: 'sk-deduplicated-test',
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    }

    const first = testAiResearchKeyConnection(key)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const second = testAiResearchKeyConnection(key)
    releaseCapability()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(firstResult.cached).toBe(false)
    expect(secondResult.cached).toBe(false)
    const cachedResult = await testAiResearchKeyConnection(key)
    expect(cachedResult.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches stable unsupported results without exposing the credential in URLs, bodies, or errors', async () => {
    const secret = 'sk-private-capability-test-only'
    const fetchMock = vi.fn().mockResolvedValue(researchModelsResponse(['different-model']))
    vi.stubGlobal('fetch', fetchMock)
    const key = {
      id: 'aikey-negative-cache',
      updatedAt: '2026-08-03T00:00:00.000Z',
      provider: 'openai',
      apiKey: secret,
      baseUrl: 'https://lingsuan.top',
      model: 'gpt-5.4-mini',
    }

    let firstError
    try {
      await testAiResearchKeyConnection(key)
    } catch (error) {
      firstError = error
    }
    await expect(testAiResearchKeyConnection(key)).rejects.toMatchObject({
      code: 'DISCOVER_RESEARCH_UNSUPPORTED',
      status: 422,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(firstError).toMatchObject({ code: 'DISCOVER_RESEARCH_UNSUPPORTED', status: 422 })
    const exposedError = `${firstError?.message || ''}\n${firstError?.stack || ''}\n${JSON.stringify(firstError)}`
    expect(exposedError).not.toContain(secret)
    for (const [url, options] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(secret)
      expect(String(options?.body || '')).not.toContain(secret)
    }
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

  it('forwards an explicitly requested high reasoning effort to OpenAI-compatible gateways', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"category":"other"}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await completeChat({
      key: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://gateway.example',
        model: 'gpt-5.6-luna',
      },
      system: 'Return JSON only.',
      user: 'Classify this bounded input.',
      reasoningEffort: 'high',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoning_effort: 'high',
    })
  })

  it('uses the Responses reasoning shape and ignores unsupported effort values', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: '{"ok":true}' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: '{"ok":true}' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const key = {
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-luna',
    }
    await completeChat({
      key,
      system: 'Return JSON only.',
      user: 'Research from official sources.',
      webSearch: true,
      reasoningEffort: 'high',
    })
    await completeChat({
      key,
      system: 'Return JSON only.',
      user: 'Research from official sources.',
      webSearch: true,
      reasoningEffort: 'maximum',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      reasoning: { effort: 'high' },
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning).toBeUndefined()
  })
})
