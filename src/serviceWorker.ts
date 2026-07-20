let reloadingForServiceWorker = false
let waitingRegistration: ServiceWorkerRegistration | null = null
let updateActivationRequested = false

export const PWA_OFFLINE_SYNC_EVENT = 'phd-atlas:offline-sync-request'

function canRegisterDevelopmentWorker() {
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function announceWaitingWorker(registration: ServiceWorkerRegistration) {
  if (!registration.waiting) return
  waitingRegistration = registration
  window.dispatchEvent(new CustomEvent('phd-atlas:pwa-update-ready'))
}

function watchRegistration(registration: ServiceWorkerRegistration) {
  announceWaitingWorker(registration)

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    if (!worker) return
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        announceWaitingWorker(registration)
      }
    })
  })

  const checkForUpdate = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void registration.update().catch(() => {})
    }
  }

  const interval = window.setInterval(checkForUpdate, 15 * 60 * 1000)
  const cleanup = () => {
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', checkForUpdate)
    window.removeEventListener('online', checkForUpdate)
    window.removeEventListener('focus', checkForUpdate)
    window.removeEventListener('pageshow', checkForUpdate)
    window.removeEventListener('pagehide', handlePageHide)
  }
  const handlePageHide = (event: PageTransitionEvent) => {
    // A standalone PWA can enter the back/forward cache. Keep its lightweight
    // listeners alive there so it checks again when the installed app resumes.
    if (!event.persisted) cleanup()
  }
  document.addEventListener('visibilitychange', checkForUpdate)
  window.addEventListener('online', checkForUpdate)
  window.addEventListener('focus', checkForUpdate)
  window.addEventListener('pageshow', checkForUpdate)
  window.addEventListener('pagehide', handlePageHide)
  checkForUpdate()
}

export function activatePwaUpdate() {
  const worker = waitingRegistration?.waiting
  if (!worker) return false
  updateActivationRequested = true
  worker.postMessage({ type: 'SKIP_WAITING' })
  return true
}

export async function requestOfflineSync() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined)
  if (!registration) return
  const registrationWithSync = registration as ServiceWorkerRegistration & {
    sync?: { register: (tag: string) => Promise<void> }
  }
  if (registrationWithSync.sync) {
    await registrationWithSync.sync.register('phd-atlas-offline-sync').catch(() => undefined)
    return
  }
  ;(registration.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'REQUEST_OFFLINE_SYNC' })
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD && !canRegisterDevelopmentWorker()) return

  const workerUrl = import.meta.env.PROD ? '/sw.js' : '/sw.js?dev=1'

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' })
      .then(watchRegistration)
      .catch(() => {})
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateActivationRequested || reloadingForServiceWorker) return
    reloadingForServiceWorker = true
    window.location.reload()
  })

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'OFFLINE_SYNC_REQUEST') {
      window.dispatchEvent(new Event(PWA_OFFLINE_SYNC_EVENT))
    }
  })
}
