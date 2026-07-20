import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamEmailDraft, testAiKeyConnection, AiProviderError } from './aiProviders.js'

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))

    await expect(testAiKeyConnection({
      provider: 'openai',
      apiKey: 'bad',
      baseUrl: '',
      model: 'gpt-4.1-mini',
    })).rejects.toBeInstanceOf(AiProviderError)
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
    expect(continuation.tools).toBeUndefined()
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
})
