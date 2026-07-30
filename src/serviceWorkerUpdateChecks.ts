export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 15 * 60_000
export const SERVICE_WORKER_UPDATE_MIN_GAP_MS = 5 * 60_000

type UpdateRegistration = Pick<ServiceWorkerRegistration, 'update'>

type ServiceWorkerUpdateCheckOptions = {
  intervalMs?: number
  minimumGapMs?: number
  now?: () => number
}

/**
 * Checks an installed worker without overlapping requests or rechecking on
 * every rapid focus/pageshow event. Hidden and offline pages sleep; the first
 * eligible resume checks immediately.
 */
export function startServiceWorkerUpdateChecks(
  registration: UpdateRegistration,
  {
    intervalMs = SERVICE_WORKER_UPDATE_INTERVAL_MS,
    minimumGapMs = SERVICE_WORKER_UPDATE_MIN_GAP_MS,
    now = Date.now,
  }: ServiceWorkerUpdateCheckOptions = {},
) {
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs
    : SERVICE_WORKER_UPDATE_INTERVAL_MS
  const safeMinimumGapMs = Number.isFinite(minimumGapMs) && minimumGapMs >= 0
    ? minimumGapMs
    : SERVICE_WORKER_UPDATE_MIN_GAP_MS
  let stopped = false
  let updateInFlight = false
  let lastUpdateStartedAt = Number.NEGATIVE_INFINITY

  const checkForUpdate = () => {
    if (
      stopped
      || updateInFlight
      || document.visibilityState !== 'visible'
      || navigator.onLine === false
    ) {
      return false
    }

    const startedAt = now()
    if (startedAt - lastUpdateStartedAt < safeMinimumGapMs) return false
    lastUpdateStartedAt = startedAt
    updateInFlight = true
    let update: Promise<ServiceWorkerRegistration>
    try {
      update = registration.update()
    } catch {
      updateInFlight = false
      return false
    }
    void update
      .catch(() => undefined)
      .finally(() => {
        updateInFlight = false
      })
    return true
  }

  const interval = window.setInterval(checkForUpdate, safeIntervalMs)
  document.addEventListener('visibilitychange', checkForUpdate)
  window.addEventListener('online', checkForUpdate)
  window.addEventListener('focus', checkForUpdate)
  window.addEventListener('pageshow', checkForUpdate)
  checkForUpdate()

  return () => {
    if (stopped) return
    stopped = true
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', checkForUpdate)
    window.removeEventListener('online', checkForUpdate)
    window.removeEventListener('focus', checkForUpdate)
    window.removeEventListener('pageshow', checkForUpdate)
  }
}
