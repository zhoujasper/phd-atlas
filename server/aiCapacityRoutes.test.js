import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createApp } from './index.js'

const realFetch = globalThis.fetch
const encoder = new TextEncoder()

let server
let baseUrl

beforeAll(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function login() {
  const response = await realFetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jasper@example.com', password: 'demo123456', scope: 'app' }),
  })
  expect(response.status).toBe(200)
  return (await response.json()).data.token
}

describe('AI route capacity', () => {
  it('bounds a 100-request draft burst without provider fan-out or server errors', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const applicationsResponse = await realFetch(`${baseUrl}/api/applications`, { headers })
    const applications = (await applicationsResponse.json()).data
    expect(applications.length).toBeGreaterThan(0)

    const keyResponse = await realFetch(`${baseUrl}/api/ai/keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'personal',
        provider: 'openai',
        label: 'Capacity test key',
        model: 'test-model',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-only-secret',
      }),
    })
    expect(keyResponse.status).toBe(201)
    const keyId = (await keyResponse.json()).data.id

    let providerActive = 0
    let maxProviderActive = 0
    const providerFetch = vi.fn(async () => {
      providerActive += 1
      maxProviderActive = Math.max(maxProviderActive, providerActive)
      return new Response(new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 20))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Subject: Test\n\nBounded draft.' } }] })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
          providerActive -= 1
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', providerFetch)

    const results = await Promise.all(Array.from({ length: 100 }, () => realFetch(`${baseUrl}/api/ai/draft`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        keyId,
        applicationId: applications[0].id,
        mode: 'compose',
        instructions: 'Write a concise test draft.',
        grants: {
          userProfile: false,
          dossier: true,
          checklist: false,
          scholarships: false,
          tasks: false,
          correspondence: false,
        },
      }),
    }).then(async (response) => ({ status: response.status, body: await response.text() }))))

    expect(results).toHaveLength(100)
    expect(results.every(({ status }) => [200, 429, 503].includes(status))).toBe(true)
    expect(results.some(({ status, body }) => (
      [429, 503].includes(status)
      && (body.includes('AI_CAPACITY_EXCEEDED') || body.includes('SERVER_BUSY'))
    ))).toBe(true)
    expect(results.some(({ status, body }) => status === 200 && body.includes('event: done'))).toBe(true)
    expect(results.some(({ status }) => status >= 500 && status !== 503)).toBe(false)
    expect(maxProviderActive).toBeLessThanOrEqual(1)
    expect(providerFetch.mock.calls.length).toBeLessThan(100)

    vi.unstubAllGlobals()
    await realFetch(`${baseUrl}/api/ai/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE', headers })
  }, 30_000)

  it('does not let the production socket timeout cut off a provider with a long first-token gap', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const applications = (await (await realFetch(`${baseUrl}/api/applications`, { headers })).json()).data
    const keyResponse = await realFetch(`${baseUrl}/api/ai/keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'personal',
        provider: 'openai',
        label: 'Delayed first token key',
        model: 'test-model',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-only-secret',
      }),
    })
    expect(keyResponse.status).toBe(201)
    const keyId = (await keyResponse.json()).data.id
    const timeoutServer = createApp().listen(0)
    timeoutServer.timeout = 25
    await new Promise((resolve) => timeoutServer.once('listening', resolve))
    const timeoutBaseUrl = `http://127.0.0.1:${timeoutServer.address().port}`
    let providerCancelled = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      async start(controller) {
        // Scale the production 30s socket / >30s first-token race down to
        // milliseconds so this regression test stays fast.
        await new Promise((resolve) => setTimeout(resolve, 80))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Subject: Delayed\n\nStill connected.' } }] })}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
      cancel() {
        providerCancelled = true
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))

    try {
      const response = await realFetch(`${timeoutBaseUrl}/api/ai/draft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          keyId,
          applicationId: applications[0].id,
          mode: 'compose',
          instructions: 'Wait for the provider safely.',
          grants: {
            userProfile: false,
            dossier: true,
            checklist: false,
            scholarships: false,
            tasks: false,
            correspondence: false,
          },
        }),
      })
      const body = await response.text()
      expect(response.status).toBe(200)
      expect(body).toContain('event: done')
      expect(body).toContain('Still connected.')
      expect(providerCancelled).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      await new Promise((resolve) => timeoutServer.close(resolve))
      await realFetch(`${baseUrl}/api/ai/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE', headers })
    }
  })

  it('terminates hanging streaming and non-streaming providers at their absolute request deadlines', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const applications = (await (await realFetch(`${baseUrl}/api/applications`, { headers })).json()).data
    const keyResponse = await realFetch(`${baseUrl}/api/ai/keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'personal',
        provider: 'openai',
        label: 'Absolute deadline key',
        model: 'test-model',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-only-secret',
      }),
    })
    expect(keyResponse.status).toBe(201)
    const keyId = (await keyResponse.json()).data.id
    const deadlineServer = createApp({
      testHooks: {
        aiRequestDeadlines: { draft: 400, keyTest: 400 },
        aiDraftHeartbeatMs: 25,
      },
    }).listen(0)
    await new Promise((resolve) => deadlineServer.once('listening', resolve))
    const deadlineBaseUrl = `http://127.0.0.1:${deadlineServer.address().port}`
    let providerCancellationCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      cancel() {
        providerCancellationCount += 1
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))

    try {
      const response = await realFetch(`${deadlineBaseUrl}/api/ai/draft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          keyId,
          applicationId: applications[0].id,
          mode: 'compose',
          instructions: 'Exercise the absolute deadline.',
          grants: {
            userProfile: false,
            dossier: true,
            checklist: false,
            scholarships: false,
            tasks: false,
            correspondence: false,
          },
        }),
      })
      const body = await response.text()
      expect(response.status).toBe(200)
      expect(body).toContain('AI_REQUEST_TIMEOUT')
      expect(providerCancellationCount).toBe(1)

      const keyTestResponse = await realFetch(
        `${deadlineBaseUrl}/api/ai/keys/${encodeURIComponent(keyId)}/test`,
        { method: 'POST', headers },
      )
      const keyTestBody = await keyTestResponse.text()
      expect(keyTestResponse.status).toBe(504)
      expect(keyTestBody).toContain('AI_REQUEST_TIMEOUT')
      expect(providerCancellationCount).toBe(2)
    } finally {
      vi.unstubAllGlobals()
      await new Promise((resolve) => deadlineServer.close(resolve))
      await realFetch(`${baseUrl}/api/ai/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE', headers })
    }
  }, 5_000)
})
