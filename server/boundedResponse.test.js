import { describe, expect, it, vi } from 'vitest'
import {
  readBoundedResponseJson,
  readBoundedResponseText,
  UpstreamResponseTooLargeError,
} from './boundedResponse.js'

describe('bounded upstream response reads', () => {
  it('reads normal streamed text and JSON within the byte limit', async () => {
    await expect(readBoundedResponseText(
      new Response('Atlas 研究'),
      { maxBytes: 64 },
    )).resolves.toBe('Atlas 研究')

    await expect(readBoundedResponseJson(
      new Response(JSON.stringify({ ok: true, count: 2 })),
      { maxBytes: 64 },
    )).resolves.toEqual({ ok: true, count: 2 })
  })

  it('rejects an oversized declared content length before buffering the body', async () => {
    const response = new Response('small', {
      headers: { 'content-length': '1000' },
    })

    await expect(readBoundedResponseText(response, { maxBytes: 32 }))
      .rejects.toMatchObject({
        name: 'UpstreamResponseTooLargeError',
        code: 'UPSTREAM_RESPONSE_TOO_LARGE',
        maxBytes: 32,
        actualBytes: 1000,
      })
  })

  it('cancels a chunked response as soon as streamed bytes cross the limit', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
      },
      cancel,
    })

    const result = readBoundedResponseText(new Response(body), { maxBytes: 5 })
    await expect(result).rejects.toBeInstanceOf(UpstreamResponseTooLargeError)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('propagates caller cancellation and releases a pending stream read', async () => {
    const controller = new AbortController()
    const cancellation = new Error('request disconnected')
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    const result = readBoundedResponseText(new Response(body), {
      maxBytes: 64,
      signal: controller.signal,
    })

    controller.abort(cancellation)

    await expect(result).rejects.toBe(cancellation)
    expect(cancel).toHaveBeenCalledWith(cancellation)
  })
})
