import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  aiCapacityIdentity,
  aiCapacityRequestDeadlineMs,
  bindAiRequestLifecycle,
  createAiAdmissionController,
  isAiCapacityRequest,
  startSseHeartbeat,
  writeSseFrame,
} from './aiRuntimeGuard.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('AI runtime admission', () => {
  it('keeps 100 independent callers within every configured concurrency bound', async () => {
    const admission = createAiAdmissionController({
      maxActive: 5,
      maxQueued: 100,
      maxPerPrincipal: 1,
      maxPerKey: 2,
      waitTimeoutMs: 5_000,
    })
    let observedGlobal = 0
    const perPrincipal = new Map()
    const perKey = new Map()

    await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const principalId = `user-${index}`
      const keyId = `key-${index % 10}`
      const release = await admission.acquire({ principalId, keyIds: [keyId] })
      const snapshot = admission.snapshot()
      observedGlobal = Math.max(observedGlobal, snapshot.active)
      perPrincipal.set(principalId, (perPrincipal.get(principalId) ?? 0) + 1)
      perKey.set(keyId, (perKey.get(keyId) ?? 0) + 1)
      expect(perPrincipal.get(principalId)).toBeLessThanOrEqual(1)
      expect(perKey.get(keyId)).toBeLessThanOrEqual(2)
      await new Promise((resolve) => setTimeout(resolve, 1))
      perPrincipal.set(principalId, perPrincipal.get(principalId) - 1)
      perKey.set(keyId, perKey.get(keyId) - 1)
      release()
    }))

    expect(observedGlobal).toBeLessThanOrEqual(5)
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0, accepted: 100 })
  })

  it('cancels a queued request without leaking an active reservation', async () => {
    const admission = createAiAdmissionController({ maxActive: 1, maxQueued: 2, waitTimeoutMs: 5_000 })
    const firstRelease = await admission.acquire({ principalId: 'one', keyIds: ['key-one'] })
    const controller = new AbortController()
    const waiting = admission.acquire({ principalId: 'two', keyIds: ['key-two'], signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'AI_CAPACITY_EXCEEDED', reason: 'cancelled' })
    firstRelease()
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0, cancelled: 1 })
  })

  it('honors a per-key request limit below the explicit 2500 ceiling', async () => {
    const admission = createAiAdmissionController({
      maxActive: 2_500,
      maxQueued: 20,
      maxPerPrincipal: 2_500,
      maxPerKey: 2_500,
      waitTimeoutMs: 5_000,
    })
    const releases = await Promise.all(Array.from({ length: 12 }, () => admission.acquire({
      principalId: 'researcher',
      keyIds: ['high-throughput-key'],
      maxActive: 12,
      maxPerKey: 12,
    })))
    expect(admission.snapshot()).toMatchObject({ active: 12, queued: 0 })

    const waiting = admission.acquire({
      principalId: 'researcher',
      keyIds: ['high-throughput-key'],
      maxActive: 12,
      maxPerKey: 12,
    })
    await Promise.resolve()
    expect(admission.snapshot()).toMatchObject({ active: 12, queued: 1 })
    releases.pop()()
    const lastRelease = await waiting
    releases.forEach((release) => release())
    lastRelease()
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0, accepted: 13 })
  })

  it('admits exactly 1000 independent tasks when one saved key explicitly allows 1000', async () => {
    const admission = createAiAdmissionController({
      maxActive: 2_500,
      maxQueued: 1_000,
      maxPerPrincipal: 2_500,
      maxPerKey: 2_500,
      waitTimeoutMs: 5_000,
    })
    const releases = await Promise.all(Array.from({ length: 1_000 }, () => admission.acquire({
      principalId: 'luchi-researcher',
      keyIds: ['luchi-key'],
      maxActive: 1_000,
      maxPerKey: 1_000,
    })))

    expect(admission.snapshot()).toMatchObject({
      active: 1_000,
      queued: 0,
      accepted: 1_000,
    })
    releases.forEach((release) => release())
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0 })
  })

  it('identifies only expensive AI POST routes and scopes keys to the authenticated actor', () => {
    const request = {
      method: 'POST',
      originalUrl: '/api/discover/research/start?ignored=1',
      auth: { sub: 'target', act: { sub: 'actor' } },
      body: { keyIds: ['key-a', 'key-b', 'key-a'] },
    }
    expect(isAiCapacityRequest(request)).toBe(true)
    expect(isAiCapacityRequest({
      ...request,
      originalUrl: '/API/AI/DRAFT',
    })).toBe(true)
    expect(isAiCapacityRequest({
      method: 'POST',
      originalUrl: '/api/interview-prep/ai/questions',
      body: { keyId: 'key-interview' },
    })).toBe(true)
    expect(isAiCapacityRequest({
      method: 'POST',
      originalUrl: '/api/interview-prep/ai/mock-turn',
      body: { keyId: 'key-interview' },
    })).toBe(true)
    expect(isAiCapacityRequest({
      method: 'POST',
      originalUrl: '/api/interview-prep/ai/feedback',
      body: { keyId: 'key-interview' },
    })).toBe(true)
    expect(aiCapacityIdentity(request)).toEqual({ principalId: 'actor', keyIds: ['key-a', 'key-b'] })
    expect(aiCapacityIdentity({
      method: 'POST',
      originalUrl: '/API/AI/KEYS/Shared-Key/TEST',
      auth: { sub: 'actor' },
      body: {},
    })).toEqual({ principalId: 'actor', keyIds: ['Shared-Key'] })
    expect(isAiCapacityRequest({ method: 'GET', originalUrl: '/api/ai/draft' })).toBe(false)
  })

  it('selects an absolute deadline for every admitted route', () => {
    expect(aiCapacityRequestDeadlineMs(
      { method: 'POST', originalUrl: '/api/ai/draft' },
      { draft: 123_000 },
    )).toBe(123_000)
    expect(aiCapacityRequestDeadlineMs(
      { method: 'POST', originalUrl: '/api/discover/applications/app-1/enrichment/preview' },
      { enrichmentPreview: 456_000 },
    )).toBe(456_000)
    expect(aiCapacityRequestDeadlineMs(
      { method: 'POST', originalUrl: '/api/interview-prep/ai/questions' },
      { interviewQuestions: 234_000 },
    )).toBe(234_000)
    expect(aiCapacityRequestDeadlineMs(
      { method: 'POST', originalUrl: '/api/interview-prep/ai/mock-turn' },
      { interviewMockTurn: 234_000 },
    )).toBe(234_000)
    expect(aiCapacityRequestDeadlineMs(
      { method: 'GET', originalUrl: '/api/ai/draft' },
    )).toBe(0)
  })
})

describe('AI request lifecycle', () => {
  function createLifecycleIo() {
    const socket = {
      destroyed: false,
      timeout: 30_000,
      server: { keepAliveTimeout: 15_000 },
      setTimeout: vi.fn(function setTimeoutValue(value) {
        this.timeout = value
      }),
    }
    const request = new EventEmitter()
    request.socket = socket
    const response = new EventEmitter()
    return { request, response, socket }
  }

  it('lets a fake provider remain silent beyond 30 seconds and restores keep-alive on finish', async () => {
    vi.useFakeTimers()
    const { request, response, socket } = createLifecycleIo()
    const controller = new AbortController()
    bindAiRequestLifecycle(request, response, {
      controller,
      deadlineMs: 180_000,
    })
    const provider = new Promise((resolve) => setTimeout(() => resolve('first token'), 31_000))

    await vi.advanceTimersByTimeAsync(31_000)
    await expect(provider).resolves.toBe('first token')
    expect(controller.signal.aborted).toBe(false)
    expect(socket.timeout).toBe(0)

    response.emit('finish')
    expect(socket.timeout).toBe(15_000)
    expect(socket.setTimeout).toHaveBeenNthCalledWith(1, 0)
    expect(socket.setTimeout).toHaveBeenNthCalledWith(2, 15_000)
  })

  it('still aborts a silent provider at the independent absolute deadline', async () => {
    vi.useFakeTimers()
    const { request, response, socket } = createLifecycleIo()
    const controller = new AbortController()
    const onDeadline = vi.fn()
    const lifecycle = bindAiRequestLifecycle(request, response, {
      controller,
      deadlineMs: 125,
      onDeadline,
    })

    await vi.advanceTimersByTimeAsync(124)
    expect(controller.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toMatchObject({ code: 'AI_REQUEST_TIMEOUT', timeoutMs: 125 })
    expect(lifecycle.deadlineExceeded).toBe(true)
    expect(onDeadline).toHaveBeenCalledOnce()
    expect(socket.timeout).toBe(0)

    response.emit('finish')
    expect(socket.timeout).toBe(15_000)
  })
})

describe('AI SSE backpressure', () => {
  it('waits for drain before accepting the next provider token', async () => {
    const response = new EventEmitter()
    response.writableEnded = false
    response.destroyed = false
    response.write = () => false
    let settled = false
    const writing = writeSseFrame(response, 'token', { text: 'bounded' }).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    response.emit('drain')
    await expect(writing).resolves.toBe(true)
  })

  it('releases a slow writer when the client disconnects', async () => {
    const response = new EventEmitter()
    response.writableEnded = false
    response.destroyed = false
    response.write = () => false
    const writing = writeSseFrame(response, 'token', { text: 'bounded' })
    response.destroyed = true
    response.emit('close')
    await expect(writing).resolves.toBe(false)
  })

  it('bounds a client that stays connected but never drains', async () => {
    const response = new EventEmitter()
    response.writableEnded = false
    response.destroyed = false
    response.write = () => false
    await expect(writeSseFrame(
      response,
      'token',
      { text: 'bounded' },
      { drainTimeoutMs: 5 },
    )).resolves.toBe(false)
    expect(response.listenerCount('drain')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })

  it('serializes low-frequency heartbeats and stops cleanly on abort', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let releaseWrite
    const send = vi.fn(() => new Promise((resolve) => { releaseWrite = resolve }))
    const onFailure = vi.fn()
    startSseHeartbeat({
      send,
      signal: controller.signal,
      intervalMs: 20_000,
      onFailure,
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(send).toHaveBeenCalledOnce()
    // Backpressure holds the only scheduled heartbeat; no interval callbacks
    // accumulate while this write remains unresolved.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledOnce()

    releaseWrite(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(send).toHaveBeenCalledTimes(2)
    controller.abort()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(onFailure).not.toHaveBeenCalled()
  })
})
