import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopServer } from './index.js'

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function fakeServer({ close } = {}) {
  return {
    listening: true,
    phdAtlasAbortStartup: vi.fn(),
    phdAtlasStartupSignalCleanup: vi.fn(),
    phdAtlasCloseLongLivedConnections: vi.fn(),
    close: close ?? vi.fn(function closeServer(callback) {
      this.listening = false
      queueMicrotask(() => callback())
    }),
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('stopServer storage-safe drain boundary', () => {
  it('returns safe only after HTTP, background, and Browser Push are idle', async () => {
    const server = fakeServer()
    const beginBackgroundShutdown = vi.fn(() => ({
      pending: () => [],
      whenIdle: Promise.resolve(),
    }))
    server.phdAtlasBeginBackgroundShutdown = beginBackgroundShutdown
    const stopBrowserPush = vi.fn().mockResolvedValue(undefined)

    await expect(stopServer(server, {
      drainTimeoutMs: 100,
      stopBrowserPush,
    })).resolves.toEqual({
      drained: true,
      httpClosed: true,
      timedOut: false,
      pending: [],
      safeToShutdownStorage: true,
    })

    expect(server.phdAtlasCloseLongLivedConnections).toHaveBeenCalledOnce()
    expect(beginBackgroundShutdown).toHaveBeenCalledOnce()
    expect(stopBrowserPush).toHaveBeenCalledOnce()
  })

  it('returns a pending task without pretending an ignored abort is idle', async () => {
    vi.useFakeTimers()
    const background = deferred()
    const server = fakeServer()
    server.phdAtlasBeginBackgroundShutdown = vi.fn(() => ({
      pending: () => [{ name: 'recurring:mail-fetch', count: 1 }],
      whenIdle: background.promise,
    }))

    const stopping = stopServer(server, {
      drainTimeoutMs: 50,
      stopBrowserPush: vi.fn().mockResolvedValue(undefined),
    })
    await vi.advanceTimersByTimeAsync(50)

    await expect(stopping).resolves.toMatchObject({
      drained: false,
      httpClosed: true,
      timedOut: true,
      safeToShutdownStorage: false,
      pending: [{ name: 'recurring:mail-fetch', count: 1 }],
    })

    // The timeout ended only the caller's wait. The accepted task remains
    // alive and observed until its real durable boundary settles.
    background.resolve()
    await Promise.resolve()
  })

  it('treats an active HTTP handler as storage-unsafe even after background drain', async () => {
    vi.useFakeTimers()
    let closeCallback
    const server = fakeServer({
      close: vi.fn((callback) => { closeCallback = callback }),
    })
    server.phdAtlasBeginBackgroundShutdown = vi.fn(() => ({
      pending: () => [],
      whenIdle: Promise.resolve(),
    }))

    const stopping = stopServer(server, {
      drainTimeoutMs: 25,
      stopBrowserPush: vi.fn().mockResolvedValue(undefined),
    })
    await vi.advanceTimersByTimeAsync(25)
    await expect(stopping).resolves.toMatchObject({
      drained: true,
      httpClosed: false,
      timedOut: true,
      safeToShutdownStorage: false,
      pending: [{ name: 'http-server', count: 1 }],
    })

    closeCallback()
    await Promise.resolve()
  })
})
