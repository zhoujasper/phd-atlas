import { Readable, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { pinnedHttpsFetch } from './pinnedHttpsFetch.js'

function fakeHttpsRequest(responseBody, capture, responseHeaders = []) {
  return (options, callback) => {
    capture.options = options
    const chunks = []
    const request = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk))
        done()
      },
    })
    request.once('finish', () => {
      capture.body = Buffer.concat(chunks).toString('utf8')
      const incoming = Readable.from([Buffer.from(responseBody)])
      incoming.statusCode = 200
      incoming.statusMessage = 'OK'
      incoming.rawHeaders = responseHeaders
      callback(incoming)
    })
    return request
  }
}

describe('pinned HTTPS fetch', () => {
  it('connects to the validated numeric address while retaining Host and TLS SNI', async () => {
    const capture = {}
    const resolveTarget = vi.fn(async () => ({
      address: '8.8.8.8',
      family: 4,
      host: 'provider.example',
      servername: 'provider.example',
      pinned: true,
    }))
    const response = await pinnedHttpsFetch(
      'https://provider.example:8443/v1/chat?mode=safe',
      {
        method: 'POST',
        headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
        body: '{"hello":"world"}',
      },
      {
        resolveTarget,
        requestImpl: fakeHttpsRequest('{"ok":true}', capture, ['Content-Type', 'application/json']),
      },
    )

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(resolveTarget).toHaveBeenCalledWith('provider.example', expect.objectContaining({
      enforcePublic: true,
    }))
    expect(capture.options).toMatchObject({
      hostname: '8.8.8.8',
      port: 8443,
      path: '/v1/chat?mode=safe',
      servername: 'provider.example',
      rejectUnauthorized: true,
    })
    expect(capture.options.headers.host).toBe('provider.example:8443')
    expect(capture.body).toBe('{"hello":"world"}')
  })

  it('rejects non-HTTPS URLs and bounds the decoded response body', async () => {
    await expect(pinnedHttpsFetch('http://provider.example/v1')).rejects.toMatchObject({
      code: 'INVALID_OUTBOUND_URL',
    })

    const response = await pinnedHttpsFetch('https://provider.example/v1', {}, {
      maxResponseBytes: 4,
      resolveTarget: async () => ({
        address: '8.8.8.8',
        family: 4,
        host: 'provider.example',
        servername: 'provider.example',
        pinned: true,
      }),
      requestImpl: fakeHttpsRequest('too large', {}),
    })
    await expect(response.text()).rejects.toThrow()
  })
})
