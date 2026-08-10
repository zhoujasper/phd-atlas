import { EventEmitter } from 'node:events'
import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindAdmissionToHttpLifecycle,
  createMutationAdmissionController,
} from './runtimeResilience.js'

const BODY_BYTES = 256 * 1024
const PREFIX = Buffer.from('{"partial":"')

function waitFor(predicate, describeState, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for lifecycle state: ${JSON.stringify(describeState())}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

function openPartialRequest(baseUrl, pathname) {
  let request
  const response = new Promise((resolve, reject) => {
    request = http.request(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        connection: 'keep-alive',
        'content-length': BODY_BYTES,
        'content-type': 'application/octet-stream',
      },
    }, (incoming) => {
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: incoming.headers,
        status: incoming.statusCode,
      }))
    })
    request.once('error', (error) => {
      // An intentionally closed partial upload may race the already-complete
      // response. The response promise still owns success once headers arrive.
      if (!request.res) reject(error)
    })
    request.flushHeaders()
    request.write(PREFIX)
  })

  return {
    destroy: () => {
      request.socket?.destroy()
      request.destroy()
    },
    request: () => request,
    response,
  }
}

describe('HTTP admission lifecycle', () => {
  const servers = []
  const admissions = []

  afterEach(async () => {
    for (const admission of admissions.splice(0)) admission.close()
    for (const server of servers.splice(0)) {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  async function startServer({ closeUnconsumedBody = false, bodyDeadlineMs = 0 } = {}) {
    const admission = createMutationAdmissionController({
      maxActive: 1,
      maxQueued: 2,
      waitTimeoutMs: 1_000,
    })
    admissions.push(admission)
    const releases = []
    const requests = []
    const server = http.createServer(async (request, response) => {
      const release = await admission.acquire()
      requests.push(request)
      bindAdmissionToHttpLifecycle(request, response, {
        bodyDeadlineMs,
        closeUnconsumedBody,
        onBodyTimeout: () => {
          response.statusCode = 408
          response.setHeader('content-type', 'application/json')
          response.end('{"error":"timeout"}')
        },
        release: () => {
          releases.push({
            requestComplete: request.complete,
            requestDestroyed: request.destroyed,
            responseFinished: response.writableFinished,
            socketDestroyed: request.socket?.destroyed ?? true,
          })
          release()
        },
      })
      response.statusCode = 409
      response.setHeader('content-type', 'application/json')
      response.end('{"error":"early"}')
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    return {
      admission,
      baseUrl: `http://127.0.0.1:${address.port}`,
      releases,
      requests,
    }
  }

  it('requires body completion or actual transport close after response finish', () => {
    const socket = Object.assign(new EventEmitter(), { destroyed: false })
    const request = Object.assign(new EventEmitter(), {
      aborted: false,
      complete: false,
      destroyed: false,
      socket,
    })
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableFinished: false,
    })
    const release = vi.fn()
    bindAdmissionToHttpLifecycle(request, response, { release })

    response.writableFinished = true
    response.emit('finish')
    expect(release).not.toHaveBeenCalled()
    request.destroyed = true
    request.emit('close')
    expect(release).not.toHaveBeenCalled()

    socket.destroyed = true
    socket.emit('close')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('can hand a parser-only lease off as soon as the complete body is available', () => {
    const socket = Object.assign(new EventEmitter(), { destroyed: false })
    const request = Object.assign(new EventEmitter(), {
      aborted: false,
      complete: false,
      destroyed: false,
      socket,
    })
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableFinished: false,
    })
    const release = vi.fn()
    bindAdmissionToHttpLifecycle(request, response, {
      release,
      releaseOnBodyComplete: true,
    })

    request.complete = true
    request.emit('end')
    expect(release).toHaveBeenCalledTimes(1)

    response.writableFinished = true
    response.emit('finish')
    socket.destroyed = true
    socket.emit('close')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not release a slot merely because an early response finished', async () => {
    const harness = await startServer()
    const client = openPartialRequest(harness.baseUrl, '/early')
    await expect(client.response).resolves.toMatchObject({
      body: '{"error":"early"}',
      status: 409,
    })

    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0].complete).toBe(false)
    if (harness.releases.length > 0) {
      expect(
        harness.releases[0].requestComplete
        || harness.releases[0].requestDestroyed
        || harness.releases[0].socketDestroyed,
      ).toBe(true)
    } else {
      expect(harness.admission.snapshot()).toMatchObject({ active: 1, waiting: 0 })
    }

    client.destroy()
    await waitFor(
      () => harness.admission.snapshot().active === 0,
      () => harness.admission.snapshot(),
    )
    expect(harness.releases).toHaveLength(1)
    expect(harness.releases[0]).toMatchObject({ responseFinished: true })
    expect(
      harness.releases[0].requestDestroyed || harness.releases[0].socketDestroyed,
    ).toBe(true)
  })

  it('gracefully closes an unconsumed body after a case-insensitive early route response', async () => {
    const harness = await startServer({ closeUnconsumedBody: true })
    const client = openPartialRequest(harness.baseUrl, '/EARLY-CLOSE')
    await expect(client.response).resolves.toMatchObject({
      body: '{"error":"early"}',
      status: 409,
    })

    await waitFor(
      () => harness.admission.snapshot().active === 0,
      () => harness.admission.snapshot(),
    )
    expect(harness.requests[0].complete).toBe(false)
    expect(harness.releases).toHaveLength(1)
    expect(harness.releases[0].responseFinished).toBe(true)
    expect(
      harness.releases[0].requestDestroyed || harness.releases[0].socketDestroyed,
    ).toBe(true)
    await waitFor(
      () => client.request().destroyed,
      () => ({
        requestDestroyed: client.request().destroyed,
        socketDestroyed: client.request().socket?.destroyed ?? true,
      }),
    )
    expect(client.request().destroyed).toBe(true)
  })

  it('keeps the deadline authoritative after an early response', async () => {
    vi.useFakeTimers()
    try {
      const request = Object.assign(new EventEmitter(), {
        aborted: false,
        complete: false,
        destroyed: false,
        socket: {
          destroy: vi.fn(function destroy() { this.destroyed = true }),
          destroyed: false,
          destroySoon: vi.fn(function destroySoon() { this.destroyed = true }),
        },
      })
      const response = Object.assign(new EventEmitter(), {
        destroyed: false,
        headersSent: true,
        shouldKeepAlive: true,
        writableEnded: true,
        writableFinished: true,
      })
      const release = vi.fn()
      bindAdmissionToHttpLifecycle(request, response, {
        bodyDeadlineMs: 40,
        release,
      })

      response.emit('finish')
      expect(release).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(39)
      expect(release).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(request.socket.destroy).toHaveBeenCalledTimes(1)
      expect(request.socket.destroySoon).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases an aborted upload exactly once', async () => {
    const harness = await startServer()
    const client = openPartialRequest(harness.baseUrl, '/abort')
    await client.response
    client.destroy()

    await waitFor(
      () => harness.admission.snapshot().active === 0,
      () => harness.admission.snapshot(),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(harness.releases).toHaveLength(1)
    expect(harness.admission.snapshot()).toMatchObject({
      active: 0,
      admitted: 1,
      waiting: 0,
    })
  })
})
