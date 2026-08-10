import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiRequestBlockReason,
  CONNECTIVITY_OUTAGE_GRACE_MS,
  connectivityUnavailable,
  getConnectivityGeneration,
  getConnectivitySnapshot,
  probeServerConnectivity,
  reportApiReachable,
  reportApiUnavailable,
  resolveHealthHttpUrl,
  resolveHealthSocketUrl,
  resetConnectivityForTests,
  setManualOfflineMode,
  subscribeConnectivity,
} from './connectivity'

class TestHealthSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: TestHealthSocket[] = []

  readyState = TestHealthSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  closeCalls = 0

  constructor(url: string) {
    this.url = url
    TestHealthSocket.instances.push(this)
  }

  open() {
    if (this.readyState !== TestHealthSocket.CONNECTING) return
    this.readyState = TestHealthSocket.OPEN
    this.onopen?.()
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }

  fail() {
    if (this.readyState === TestHealthSocket.CLOSED) return
    this.readyState = TestHealthSocket.CLOSED
    this.onerror?.()
    this.onclose?.()
  }

  close() {
    if (this.readyState === TestHealthSocket.CLOSED) return
    this.closeCalls += 1
    this.readyState = TestHealthSocket.CLOSED
    this.onclose?.()
  }
}

function latestSocket() {
  const socket = TestHealthSocket.instances.at(-1)
  if (!socket) throw new Error('Expected a health WebSocket')
  return socket
}

async function connectHealthSocket(options: { force?: boolean } = {}) {
  const pending = probeServerConnectivity(options)
  const socket = latestSocket()
  socket.open()
  socket.message({ type: 'ready', ok: true })
  return pending
}

describe('connectivity state', () => {
  beforeEach(() => {
    TestHealthSocket.instances = []
    vi.stubGlobal('WebSocket', TestHealthSocket)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
    resetConnectivityForTests()
    reportApiReachable(80)
  })

  afterEach(() => {
    resetConnectivityForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('distinguishes a reachable browser network from an unavailable server', () => {
    reportApiUnavailable()

    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      browserOnline: true,
      serverReachable: false,
    })
    expect(connectivityUnavailable()).toBe(true)
    expect(apiRequestBlockReason('GET')).toBe('server-unreachable')
    expect(apiRequestBlockReason('POST')).toBeNull()
  })

  it.each(['transport', 'timeout'] as const)(
    'requires consecutive %s evidence and a sustained grace window before opening the client circuit',
    async (evidence) => {
      vi.useFakeTimers()
      const observedGeneration = getConnectivityGeneration()

      reportApiUnavailable({ evidence, observedGeneration })
      expect(getConnectivitySnapshot()).toMatchObject({
        mode: 'online',
        serverReachable: true,
      })

      reportApiUnavailable({ evidence, observedGeneration })
      expect(getConnectivitySnapshot()).toMatchObject({
        mode: 'checking',
        serverReachable: null,
      })

      await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS - 1)
      expect(getConnectivitySnapshot().mode).toBe('checking')
      await vi.advanceTimersByTimeAsync(1)
      expect(getConnectivitySnapshot()).toMatchObject({
        mode: 'server-unreachable',
        serverReachable: false,
      })
    },
  )

  it('lets a ready health socket override repeated endpoint timeouts', async () => {
    const pending = probeServerConnectivity({ force: true })
    const socket = latestSocket()
    socket.open()
    socket.message({ type: 'ready', ok: true })
    await expect(pending).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
    const observedGeneration = getConnectivityGeneration()

    reportApiUnavailable({ evidence: 'timeout', observedGeneration })
    reportApiUnavailable({ evidence: 'timeout', observedGeneration })

    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
      consecutiveFailures: 0,
    })
  })

  it('lets a user choose immediate offline work while the server remains reachable', () => {
    setManualOfflineMode(true)

    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'offline',
      browserOnline: true,
      serverReachable: true,
      manualOffline: true,
    })
    expect(sessionStorage.getItem('phd-atlas-manual-offline:v1')).toBe('1')
    expect(localStorage.getItem('phd-atlas-manual-offline:v1')).toBeNull()
    expect(connectivityUnavailable()).toBe(true)

    setManualOfflineMode(false)
    expect(sessionStorage.getItem('phd-atlas-manual-offline:v1')).toBeNull()
    expect(getConnectivitySnapshot().mode).toBe('online')
    expect(connectivityUnavailable()).toBe(false)
  })

  it('uses one health WebSocket instead of repeated /api/health fetches', async () => {
    const result = await connectHealthSocket({ force: true })

    expect(TestHealthSocket.instances).toHaveLength(1)
    expect(latestSocket().url).toMatch(/^ws:\/\/localhost(?::\d+)?\/api\/health\/ws$/)
    expect(result.serverReachable).toBe(true)
    expect(result.mode).toBe('online')
  })

  it('bypasses the Vite WebSocket proxy only for the local development server', () => {
    expect(resolveHealthSocketUrl('http://localhost:5173/applications', { development: true }))
      .toBe('ws://localhost:4317/api/health/ws')
    expect(resolveHealthSocketUrl('http://localhost:5173/applications', {
      development: true,
      apiPort: '5317',
    })).toBe('ws://localhost:5317/api/health/ws')
    expect(resolveHealthSocketUrl('https://atlas.example/applications', { development: false }))
      .toBe('wss://atlas.example/api/health/ws')
    expect(resolveHealthHttpUrl('http://localhost:5173/applications'))
      .toBe('http://localhost:5173/api/health')
    expect(resolveHealthHttpUrl('https://atlas.example/applications'))
      .toBe('https://atlas.example/api/health')
  })

  it('coalesces concurrent health checks behind one socket connection', async () => {
    resetConnectivityForTests()
    const first = probeServerConnectivity()
    const second = probeServerConnectivity()

    expect(TestHealthSocket.instances).toHaveLength(1)
    latestSocket().open()
    latestSocket().message({ type: 'ready', ok: true })

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('replaces the socket for an explicit forced retry without leaving the old socket authoritative', async () => {
    await connectHealthSocket({ force: true })
    const oldSocket = latestSocket()

    const forced = probeServerConnectivity({ force: true })
    const newSocket = latestSocket()
    expect(newSocket).not.toBe(oldSocket)
    oldSocket.fail()
    newSocket.open()
    newSocket.message({ type: 'ready', ok: true })

    await expect(forced).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
    expect(getConnectivitySnapshot().consecutiveFailures).toBe(0)
  })

  it('retires a replaced connecting socket only after its handshake completes', async () => {
    vi.useFakeTimers()
    const first = probeServerConnectivity({ force: true })
    const connectingSocket = latestSocket()

    const replacement = probeServerConnectivity({ force: true })
    const activeSocket = latestSocket()

    expect(activeSocket).not.toBe(connectingSocket)
    expect(connectingSocket.readyState).toBe(TestHealthSocket.CONNECTING)
    expect(connectingSocket.closeCalls).toBe(0)

    connectingSocket.open()
    expect(connectingSocket.readyState).toBe(TestHealthSocket.CLOSED)
    expect(connectingSocket.closeCalls).toBe(1)

    activeSocket.open()
    activeSocket.message({ type: 'ready', ok: true })
    // Only the active connection's heartbeat deadline remains. The retired
    // socket cleared its private deadline as soon as its handshake completed.
    expect(vi.getTimerCount()).toBe(1)
    await expect(replacement).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
    await expect(first).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
  })

  it('bounds every black-holed retired socket across repeated forced replacements', async () => {
    vi.useFakeTimers()
    const pending: Array<Promise<ReturnType<typeof getConnectivitySnapshot>>> = []

    for (let index = 0; index < 7; index += 1) {
      pending.push(probeServerConnectivity({ force: true }))
    }

    const activeSocket = latestSocket()
    const retiredSockets = TestHealthSocket.instances.slice(0, -1)
    expect(retiredSockets).toHaveLength(6)
    expect(retiredSockets.every((socket) => socket.readyState === TestHealthSocket.CONNECTING)).toBe(true)
    expect(retiredSockets.every((socket) => socket.closeCalls === 0)).toBe(true)

    activeSocket.open()
    activeSocket.message({ type: 'ready', ok: true })
    const stableSnapshot = getConnectivitySnapshot()

    await vi.advanceTimersByTimeAsync(4_499)
    expect(retiredSockets.every((socket) => socket.closeCalls === 0)).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(retiredSockets.every((socket) => socket.readyState === TestHealthSocket.CLOSED)).toBe(true)
    expect(retiredSockets.every((socket) => socket.closeCalls === 1)).toBe(true)
    expect(activeSocket.readyState).toBe(TestHealthSocket.OPEN)
    expect(getConnectivitySnapshot()).toBe(stableSnapshot)
    // All six private retirement timers are gone; only the current socket's
    // heartbeat timeout remains.
    expect(vi.getTimerCount()).toBe(1)
    await expect(Promise.all(pending)).resolves.toHaveLength(7)
  })

  it('clears a retired connection deadline when the old handshake fails', async () => {
    vi.useFakeTimers()
    const first = probeServerConnectivity({ force: true })
    const retiredSocket = latestSocket()
    const replacement = probeServerConnectivity({ force: true })
    const activeSocket = latestSocket()

    expect(vi.getTimerCount()).toBe(2)
    retiredSocket.fail()
    expect(retiredSocket.closeCalls).toBe(0)
    expect(vi.getTimerCount()).toBe(1)

    activeSocket.open()
    activeSocket.message({ type: 'ready', ok: true })
    expect(vi.getTimerCount()).toBe(1)
    await expect(replacement).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
    await expect(first).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
  })

  it('keeps a one-probe health interruption in checking before confirming an outage', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))
    const pending = probeServerConnectivity({ force: true })
    latestSocket().fail()

    await expect(pending).resolves.toMatchObject({
      mode: 'checking',
      browserOnline: true,
      serverReachable: null,
    })

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })
  })

  it('cancels outage confirmation when the same-origin HTTP route recovers inside the grace window', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { status: 'ok', ready: true },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const initial = probeServerConnectivity({ force: true })
    latestSocket().fail()
    await expect(initial).resolves.toMatchObject({ mode: 'checking' })

    await expect(probeServerConnectivity({ force: true })).resolves.toMatchObject({
      mode: 'online',
      serverReachable: true,
    })
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS + 1)
    expect(getConnectivitySnapshot()).toMatchObject({ mode: 'online', serverReachable: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a live Atlas process in checking while startup is not ready', async () => {
    vi.useFakeTimers()
    reportApiUnavailable()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: { status: 'starting', ready: false },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(probeServerConnectivity({ force: true })).resolves.toMatchObject({
      mode: 'checking',
      serverReachable: true,
    })
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS + 1)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'checking',
      serverReachable: true,
    })
  })

  it('uses one HTTP recovery probe after an outage and restores reachability before reopening sockets', async () => {
    reportApiUnavailable()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: { status: 'ok' },
      requestId: 'health-test',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = probeServerConnectivity({ force: true })
    const second = probeServerConnectivity({ force: true })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ serverReachable: true, mode: 'online' }),
      expect.objectContaining({ serverReachable: true, mode: 'online' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(TestHealthSocket.instances).toHaveLength(0)
  })

  it('coalesces an outage failure wave and ignores a failure from an older connectivity generation', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConnectivity(listener)
    const observedGeneration = getConnectivityGeneration()

    reportApiUnavailable({ observedGeneration })
    reportApiUnavailable({ observedGeneration })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getConnectivitySnapshot().consecutiveFailures).toBe(1)

    reportApiReachable(80)
    const restoredSnapshot = getConnectivitySnapshot()
    reportApiUnavailable({ observedGeneration })
    expect(getConnectivitySnapshot()).toBe(restoredSnapshot)
    unsubscribe()
  })

  it('does not let a late pre-outage response reopen the server circuit', () => {
    const staleGeneration = getConnectivityGeneration()

    reportApiUnavailable({ observedGeneration: staleGeneration })
    const unavailableSnapshot = getConnectivitySnapshot()
    reportApiReachable(80, { observedGeneration: staleGeneration })

    expect(getConnectivitySnapshot()).toBe(unavailableSnapshot)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })

    const recoveryGeneration = getConnectivityGeneration()
    reportApiReachable(80, { observedGeneration: recoveryGeneration })
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
    })

    reportApiUnavailable({ evidence: 'timeout', observedGeneration: staleGeneration })
    reportApiUnavailable({ evidence: 'timeout', observedGeneration: staleGeneration })
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
    })
  })

  it('does not publish a global render update for every successful API response', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConnectivity(listener)

    reportApiReachable()
    reportApiReachable()

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('does not describe localhost as a slow network from outward connection hints', () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '2g', rtt: 2_000, downlink: 0.2 },
    })

    expect(reportApiReachable(3_000)).toMatchObject({
      mode: 'online',
      serverReachable: true,
    })
  })

  it('rejects malformed health socket events instead of treating a proxy response as Atlas', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))
    const pending = probeServerConnectivity({ force: true })
    latestSocket().open()
    latestSocket().message({ ok: true, type: 'unexpected' })

    expect(latestSocket().readyState).toBe(TestHealthSocket.CLOSED)
    await expect(pending).resolves.toMatchObject({ mode: 'checking', serverReachable: null })
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })
  })
})
