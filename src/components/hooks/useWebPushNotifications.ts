import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  phdApi,
  type NotificationRecord,
  type WebPushSubscriptionInput,
  type WebPushTestResult,
} from '../../api/phdApi'

export type WebPushNotificationStatus =
  | 'unsupported'
  | 'ready'
  | 'enabling'
  | 'disabling'
  | 'enabled'
  | 'denied'
  | 'error'

export const WEB_PUSH_READY_TIMEOUT_MS = 10_000

type PushMessage = {
  type: 'PUSH_NOTIFICATION'
  notification: NotificationRecord
}

function pushIsSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

function statusForPermission(): WebPushNotificationStatus {
  if (!pushIsSupported()) return 'unsupported'
  return Notification.permission === 'denied' ? 'denied' : 'ready'
}

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`
  const normalized = padded.replaceAll('-', '+').replaceAll('_', '/')
  const binary = window.atob(normalized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function subscriptionInput(subscription: PushSubscription): WebPushSubscriptionInput {
  const value = subscription.toJSON()
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error('The browser returned an incomplete push subscription.')
  }
  return {
    endpoint: value.endpoint,
    keys: {
      p256dh: value.keys.p256dh,
      auth: value.keys.auth,
    },
  }
}

function applicationServerKey(subscription: PushSubscription) {
  const value = subscription.options?.applicationServerKey
  return value ? new Uint8Array(value) : null
}

function keysMatch(left: Uint8Array | null, right: Uint8Array) {
  if (!left) return true
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function existingRegistration() {
  return navigator.serviceWorker.getRegistration()
}

/**
 * The browser can still wake a service worker for a push already accepted by
 * its provider. Persisting this local opt-out lets the worker discard that
 * final in-flight event instead of showing a notification after the user has
 * turned the channel off.
 */
async function setServiceWorkerPushPreference(enabled: boolean) {
  if (!pushIsSupported()) return
  const registration = await existingRegistration().catch(() => undefined)
  const worker = navigator.serviceWorker.controller ?? registration?.active
  worker?.postMessage?.({ type: 'SET_PUSH_NOTIFICATIONS_ENABLED', enabled })
}

async function readyRegistration() {
  const registration = await existingRegistration()
  if (registration?.active) return registration

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Service worker did not become ready in time.'))
    }, WEB_PUSH_READY_TIMEOUT_MS)

    navigator.serviceWorker.ready.then(
      (ready) => {
        window.clearTimeout(timeout)
        resolve(ready)
      },
      (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

/** Let React commit and the browser paint the loading state before opening the blocking permission UI. */
function waitForLoadingPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

export function useWebPushNotifications(
  token: string | undefined,
  channelEnabled = true,
  onNotification?: (notification: NotificationRecord) => void,
) {
  const [status, setStatus] = useState<WebPushNotificationStatus>(statusForPermission)
  const onNotificationRef = useRef(onNotification)
  onNotificationRef.current = onNotification
  // Prevent background subscription sync from clobbering an in-flight enable/disable
  // (that race made the enable button look unresponsive while the permission prompt was pending).
  const actionInFlightRef = useRef(false)

  const registerCurrentSubscription = useCallback(async (
    registration: ServiceWorkerRegistration,
    {
      forceRenew = false,
      createIfMissing = true,
    }: { forceRenew?: boolean; createIfMissing?: boolean } = {},
  ) => {
    if (!token) throw new Error('A signed-in session is required for Web Push.')
    const { publicKey } = await phdApi.webPushPublicKey(token)
    const expectedKey = urlBase64ToUint8Array(publicKey)
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription && !createIfMissing) return null
    const shouldRenew = Boolean(subscription) && (
      forceRenew || !keysMatch(applicationServerKey(subscription!), expectedKey)
    )

    if (subscription && shouldRenew) {
      await phdApi.deleteWebPushSubscription(token, subscription.endpoint).catch(() => undefined)
      await subscription.unsubscribe().catch(() => false)
      subscription = null
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKey,
      })
    }
    await phdApi.saveWebPushSubscription(token, subscriptionInput(subscription))
    return subscription
  }, [token])

  const syncExistingSubscription = useCallback(async () => {
    if (!channelEnabled || !token || !pushIsSupported() || Notification.permission !== 'granted') return false
    const registration = await existingRegistration()
    if (!registration?.active) return false
    return Boolean(await registerCurrentSubscription(registration, { createIfMissing: false }))
  }, [channelEnabled, registerCurrentSubscription, token])

  useEffect(() => {
    if (!pushIsSupported()) {
      setStatus('unsupported')
      return undefined
    }

    void setServiceWorkerPushPreference(channelEnabled)

    const receivePush = (event: MessageEvent<PushMessage>) => {
      if (channelEnabled && event.data?.type === 'PUSH_NOTIFICATION' && event.data.notification) {
        onNotificationRef.current?.(event.data.notification)
      }
    }
    const resync = () => {
      if (!channelEnabled) {
        if (!actionInFlightRef.current) setStatus(statusForPermission())
        return
      }
      void syncExistingSubscription()
        .then((synced) => {
          if (actionInFlightRef.current) return
          setStatus(synced ? 'enabled' : statusForPermission())
        })
        .catch(() => {
          if (actionInFlightRef.current) return
          setStatus('error')
        })
    }
    navigator.serviceWorker.addEventListener('message', receivePush)
    navigator.serviceWorker.addEventListener('controllerchange', resync)
    resync()
    return () => {
      navigator.serviceWorker.removeEventListener('message', receivePush)
      navigator.serviceWorker.removeEventListener('controllerchange', resync)
    }
  }, [channelEnabled, syncExistingSubscription])

  const enable = useCallback(async () => {
    if (!token || !pushIsSupported()) {
      setStatus('unsupported')
      return 'unsupported' as const
    }
    if (actionInFlightRef.current) return 'enabling' as const
    actionInFlightRef.current = true
    setStatus('enabling')
    try {
      // Force a paint so the spinner/disabled state is visible before the
      // permission dialog blocks the main thread.
      await waitForLoadingPaint()
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'ready')
        return permission
      }
      const registration = await readyRegistration()
      await registerCurrentSubscription(registration)
      await setServiceWorkerPushPreference(true)
      setStatus('enabled')
      return 'granted' as const
    } catch {
      setStatus('error')
      return 'error' as const
    } finally {
      actionInFlightRef.current = false
    }
  }, [registerCurrentSubscription, token])

  const disable = useCallback(async () => {
    if (!token || !pushIsSupported()) return false
    if (actionInFlightRef.current) return false
    actionInFlightRef.current = true
    setStatus('disabling')
    try {
      // Suppress queued provider deliveries before waiting on network cleanup.
      await setServiceWorkerPushPreference(false)
      await waitForLoadingPaint()
      const registration = await existingRegistration()
      const subscription = registration ? await registration.pushManager.getSubscription() : null
      if (subscription) {
        await phdApi.deleteWebPushSubscription(token, subscription.endpoint)
        await subscription.unsubscribe()
      }
      setStatus(statusForPermission())
      return true
    } catch {
      setStatus('error')
      return false
    } finally {
      actionInFlightRef.current = false
    }
  }, [token])

  const test = useCallback(async (): Promise<WebPushTestResult> => {
    if (!token || !pushIsSupported() || Notification.permission !== 'granted') {
      throw new Error('Web Push is not enabled on this device.')
    }
    const registration = await readyRegistration()
    await registerCurrentSubscription(registration)
    try {
      return await phdApi.testWebPush(token)
    } catch (error) {
      const canRepair = error instanceof ApiError
        && (error.code === 'PUSH_NOT_SUBSCRIBED' || error.code === 'PUSH_DELIVERY_FAILED')
      if (!canRepair) throw error
      await registerCurrentSubscription(registration, { forceRenew: true })
      return phdApi.testWebPush(token)
    }
  }, [registerCurrentSubscription, token])

  return { status, enable, disable, test }
}
