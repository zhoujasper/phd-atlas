import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectivityUnavailable,
  getConnectivitySnapshot,
  probeServerConnectivity,
  reportApiReachable,
  reportApiUnavailable,
  resetConnectivityForTests,
  setManualOfflineMode,
} from './connectivity'

describe('connectivity state', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
    setManualOfflineMode(false)
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
    expect(localStorage.getItem('phd-atlas-manual-offline:v1')).toBe('1')
    expect(connectivityUnavailable()).toBe(true)

    setManualOfflineMode(false)
    expect(localStorage.getItem('phd-atlas-manual-offline:v1')).toBeNull()
    expect(getConnectivitySnapshot().mode).toBe('online')
    expect(connectivityUnavailable()).toBe(false)
  })

  it('measures the real health endpoint instead of trusting navigator.onLine', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))

    const result = await probeServerConnectivity({ force: true })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/health\?connectivity=/),
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    )
    expect(result.serverReachable).toBe(true)
    expect(result.mode).toBe('online')
  })

  it('coalesces concurrent background health probes', async () => {
    resetConnectivityForTests()
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => { resolveResponse = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response))

    const first = probeServerConnectivity()
    const second = probeServerConnectivity()
    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses a fresh background result while allowing an explicit forced retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await probeServerConnectivity()
    expect(fetchMock).not.toHaveBeenCalled()

    await probeServerConnectivity({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a synthetic gateway response as an unavailable Atlas server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))

    const result = await probeServerConnectivity({ force: true })

    expect(result).toMatchObject({
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

  it('rejects a successful HTML shell as proof that the Atlas API is healthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })))

    await expect(probeServerConnectivity({ force: true })).resolves.toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })
  })
})
