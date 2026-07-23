import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  webPushPublicKey: vi.fn(),
  saveWebPushSubscription: vi.fn(),
  deleteWebPushSubscription: vi.fn(),
  testWebPush: vi.fn(),
}))

vi.mock('../../api/phdApi', () => ({
  ApiError: class ApiError extends Error {
    code: string
    status: number
    constructor(message: string, code: string, status: number) {
      super(message)
      this.code = code
      this.status = status
    }
  },
  phdApi: api,
}))

const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification')
const originalPushManager = Object.getOwnPropertyDescriptor(window, 'PushManager')
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
let serviceWorker: ServiceWorkerContainer
let activeWorker: { postMessage: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  const subscription = {
    endpoint: 'https://push.example.test/subscription',
    toJSON: () => ({
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'browser-public-key', auth: 'browser-auth-key' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  let currentSubscription: typeof subscription | null = null
  activeWorker = { postMessage: vi.fn() }
  const registration = {
    active: activeWorker,
    pushManager: {
      getSubscription: vi.fn(async () => currentSubscription),
      subscribe: vi.fn(async () => {
        currentSubscription = subscription
        return subscription
      }),
    },
  }
  serviceWorker = new EventTarget() as ServiceWorkerContainer
  Object.assign(serviceWorker, {
    getRegistration: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  })
  const notificationApi = {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn(async () => {
      notificationApi.permission = 'granted'
      return 'granted' as NotificationPermission
    }),
  }
  Object.defineProperty(window, 'Notification', { configurable: true, value: notificationApi })
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
  api.webPushPublicKey.mockResolvedValue({ publicKey: 'BEl2bGFiX3Rlc3Qta2V5' })
  api.saveWebPushSubscription.mockResolvedValue({ endpoint: subscription.endpoint })
  api.deleteWebPushSubscription.mockResolvedValue({ endpoint: subscription.endpoint, deleted: true })
  api.testWebPush.mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  if (originalNotification) Object.defineProperty(window, 'Notification', originalNotification)
  else Reflect.deleteProperty(window, 'Notification')
  if (originalPushManager) Object.defineProperty(window, 'PushManager', originalPushManager)
  else Reflect.deleteProperty(window, 'PushManager')
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
})

describe('useWebPushNotifications', () => {
  it('exposes the enabling state before the browser permission decision resolves', async () => {
    let resolvePermission: ((permission: NotificationPermission) => void) | undefined
    const permission = new Promise<NotificationPermission>((resolve) => { resolvePermission = resolve })
    const requestPermission = vi.fn(() => permission)
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    })
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    let pending: Promise<unknown>
    act(() => { pending = result.current.enable() })
    await waitFor(() => expect(result.current.status).toBe('enabling'))
    expect(api.webPushPublicKey).not.toHaveBeenCalled()

    await act(async () => {
      resolvePermission?.('denied')
      await pending!
    })
    expect(result.current.status).toBe('denied')
  })

  it('keeps enabling visible even if a background resync finishes during the permission prompt', async () => {
    let resolvePermission: ((permission: NotificationPermission) => void) | undefined
    const permission = new Promise<NotificationPermission>((resolve) => { resolvePermission = resolve })
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission: vi.fn(() => permission) },
    })
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    let pending: Promise<unknown>
    act(() => { pending = result.current.enable() })
    await waitFor(() => expect(result.current.status).toBe('enabling'))

    // Simulate a late controllerchange/resync while the user is still in the permission UI.
    await act(async () => {
      serviceWorker.dispatchEvent(new Event('controllerchange'))
      await Promise.resolve()
    })
    expect(result.current.status).toBe('enabling')

    await act(async () => {
      resolvePermission?.('granted')
      await pending!
    })
    expect(result.current.status).toBe('enabled')
  })

  it('requests permission only on explicit enable and registers the browser endpoint', async () => {
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { await result.current.enable() })

    expect(api.webPushPublicKey).toHaveBeenCalledWith('session_token')
    expect(api.saveWebPushSubscription).toHaveBeenCalledWith('session_token', {
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'browser-public-key', auth: 'browser-auth-key' },
    })
    expect(result.current.status).toBe('enabled')
  })

  it('does not silently recreate a subscription after the user turned device notifications off', async () => {
    ;(window.Notification as unknown as { permission: NotificationPermission }).permission = 'granted'
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    await waitFor(() => expect(result.current.status).toBe('ready'))

    const registration = await serviceWorker.getRegistration()
    expect(registration!.pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.saveWebPushSubscription).not.toHaveBeenCalled()
  })

  it('persists a disabled delivery preference and ignores a late worker message', async () => {
    const onNotification = vi.fn()
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    renderHook(() => useWebPushNotifications('session_token', false, onNotification))

    await waitFor(() => expect(activeWorker.postMessage).toHaveBeenCalledWith({
      type: 'SET_PUSH_NOTIFICATIONS_ENABLED',
      enabled: false,
    }))
    serviceWorker.dispatchEvent(new MessageEvent('message', {
      data: { type: 'PUSH_NOTIFICATION', notification: { id: 'late', title: 'Late alert' } },
    }))
    expect(onNotification).not.toHaveBeenCalled()
    expect(api.saveWebPushSubscription).not.toHaveBeenCalled()
  })

  it('returns an error instead of waiting indefinitely for a missing worker', async () => {
    vi.useFakeTimers()
    Object.assign(serviceWorker, {
      getRegistration: vi.fn().mockResolvedValue(undefined),
      ready: new Promise<ServiceWorkerRegistration>(() => {}),
    })
    const { WEB_PUSH_READY_TIMEOUT_MS, useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    let outcome: string | undefined
    await act(async () => {
      const pending = result.current.enable().then((value) => { outcome = value })
      // `enable` intentionally paints its loading state across two animation
      // frames before opening permission UI; let those frames settle before
      // advancing the independent service-worker readiness timeout.
      await vi.advanceTimersByTimeAsync(32)
      await vi.advanceTimersByTimeAsync(WEB_PUSH_READY_TIMEOUT_MS)
      await pending
    })

    expect(outcome).toBe('error')
    expect(result.current.status).toBe('error')
  })

  it('renews a subscription whose application server key no longer matches', async () => {
    ;(window.Notification as unknown as { permission: NotificationPermission }).permission = 'granted'
    const staleSubscription = {
      endpoint: 'https://push.example.test/stale',
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      toJSON: () => ({
        endpoint: 'https://push.example.test/stale',
        keys: { p256dh: 'stale-public-key', auth: 'stale-auth-key' },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const registration = await serviceWorker.getRegistration()
    vi.mocked(registration!.pushManager.getSubscription).mockResolvedValue(staleSubscription as unknown as PushSubscription)
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    await waitFor(() => expect(result.current.status).toBe('enabled'))

    expect(api.deleteWebPushSubscription).toHaveBeenCalledWith('session_token', staleSubscription.endpoint)
    expect(staleSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(registration!.pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(api.saveWebPushSubscription).toHaveBeenCalled()
  })

  it('force-renews and retries when the push service rejects the first test', async () => {
    const { ApiError } = await import('../../api/phdApi')
    api.testWebPush
      .mockRejectedValueOnce(new ApiError('Push failed', 'PUSH_DELIVERY_FAILED', 502))
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, failed: 0, removed: 1 })
    const { useWebPushNotifications } = await import('./useWebPushNotifications')
    const { result } = renderHook(() => useWebPushNotifications('session_token'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { await result.current.enable() })
    await act(async () => { await result.current.test() })

    const registration = await serviceWorker.getRegistration()
    expect(api.testWebPush).toHaveBeenCalledTimes(2)
    expect(registration!.pushManager.subscribe).toHaveBeenCalledTimes(2)
  })
})
