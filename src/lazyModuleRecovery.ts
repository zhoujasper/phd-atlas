const DEFAULT_RETRY_DELAYS_MS = [120, 420] as const
const AUTOMATIC_RELOAD_COOLDOWN_MS = 30_000
const AUTOMATIC_RELOAD_STORAGE_KEY = 'phd-atlas-lazy-module-recovery:v1'

type LazyModuleRecoveryOptions = {
  reload?: () => void
  now?: () => number
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  setTimer?: (callback: () => void, delay: number) => unknown
}

type VitePreloadErrorEvent = Event & {
  payload?: unknown
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

export function isLazyModuleLoadFailure(error: unknown) {
  const message = errorMessage(error).toLocaleLowerCase()
  return [
    'failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'importing a module script failed',
    'failed to load module script',
    'chunkloaderror',
    'loading chunk',
    'unable to preload css',
  ].some((fragment) => message.includes(fragment))
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
}

export async function loadLazyModule<T>(
  loader: () => Promise<T>,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await wait(retryDelaysMs[attempt - 1] ?? 0)
    try {
      return await loader()
    } catch (error) {
      lastError = error
      if (!isLazyModuleLoadFailure(error)) throw error
    }
  }

  throw lastError
}

/**
 * Shares one in-flight import between hover preloading and React.lazy, while
 * allowing a later interaction to try again after a failed request.
 */
export function createRecoverableModuleLoader<T>(loader: () => Promise<T>) {
  let resolved: T | undefined
  let pending: Promise<T> | null = null

  return () => {
    if (resolved !== undefined) return Promise.resolve(resolved)
    if (pending) return pending

    pending = loadLazyModule(loader).then(
      (module) => {
        resolved = module
        return module
      },
      (error) => {
        pending = null
        throw error
      },
    )
    return pending
  }
}

function readLastAutomaticReload(storage: Pick<Storage, 'getItem'>) {
  try {
    const value = Number(storage.getItem(AUTOMATIC_RELOAD_STORAGE_KEY))
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function recordAutomaticReload(storage: Pick<Storage, 'setItem'>, now: number) {
  try {
    storage.setItem(AUTOMATIC_RELOAD_STORAGE_KEY, String(now))
  } catch {
    // The root error boundary remains available when session storage is blocked.
  }
}

/**
 * Vite emits this event when the active HTML points at a code chunk that can no
 * longer be fetched. Reload once to acquire the current asset manifest; a
 * cooldown prevents a damaged deployment from entering a refresh loop.
 */
export function installLazyModuleRecovery(options: LazyModuleRecoveryOptions = {}) {
  const reload = options.reload ?? (() => window.location.reload())
  const now = options.now ?? Date.now
  const storage = options.storage ?? window.sessionStorage
  const setTimer = options.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay))

  const handlePreloadError = (rawEvent: Event) => {
    const event = rawEvent as VitePreloadErrorEvent
    if (!isLazyModuleLoadFailure(event.payload)) return

    const currentTime = now()
    const lastReload = readLastAutomaticReload(storage)
    if (currentTime - lastReload < AUTOMATIC_RELOAD_COOLDOWN_MS) return

    event.preventDefault()
    recordAutomaticReload(storage, currentTime)
    setTimer(reload, 0)
  }

  window.addEventListener('vite:preloadError', handlePreloadError)
  return () => window.removeEventListener('vite:preloadError', handlePreloadError)
}
