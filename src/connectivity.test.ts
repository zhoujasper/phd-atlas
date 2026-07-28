import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectivityUnavailable,
  getConnectivitySnapshot,
  probeServerConnectivity,
  reportApiReachable,
  reportApiUnavailable,
  resolveHealthSocketUrl,
  resetConnectivityForTests,
  setManualOfflineMode,
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

  constructor(url: string) {
    this.url = url
    TestHealthSocket.instances.push(this)
  }

  open() {
    this.readyState = TestHealthSocket.OPEN
    this.onopen?.()
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }

  fail() {
    this.readyState = TestHealthSocket.CLOSED
    this.onerror?.()
    this.onclose?.()
  }

  close() {
    if (this.readyState === TestHealthSocket.CLOSED) return
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
    vi.unstubAllGlobals()
    resetConnectivityForTests()
  })

  it('distinguishes a reachable browser network from an unavailable server', () => {
    reportApiUnavailable()

    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      browserOnline: true,
      serverReachable: false,
    })
    expect(connectivityUnavailable()).toBe(true)
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
    const first = probeServerConnectivity({ force: true })
    const connectingSocket = latestSocket()

    const replacement = probeServerConnectivity({ force: true })
    const activeSocket = latestSocket()

    expect(activeSocket).not.toBe(connectingSocket)
    expect(connectingSocket.readyState).toBe(TestHealthSocket.CONNECTING)

    connectingSocket.open()
    expect(connectingSocket.readyState).toBe(TestHealthSocket.CLOSED)

    activeSocket.open()
    activeSocket.message({ type: 'ready', ok: true })
    await expect(replacement).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
    await expect(first).resolves.toMatchObject({ serverReachable: true, mode: 'online' })
  })

  it('marks the server unavailable when the health socket closes before readiness', async () => {
    const pending = probeServerConnectivity({ force: true })
    latestSocket().fail()

    await expect(pending).resolves.toMatchObject({
      mode: 'server-unreachable',
      browserOnline: true,
      serverReachable: false,
    })
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
    const pending = probeServerConnectivity({ force: true })
    latestSocket().open()
    latestSocket().message({ ok: true, type: 'unexpected' })

    expect(latestSocket().readyState).toBe(TestHealthSocket.CLOSED)
    await expect(pending).resolves.toMatchObject({ serverReachable: false })
  })
})
