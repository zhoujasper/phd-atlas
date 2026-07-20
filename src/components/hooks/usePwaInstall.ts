import { useCallback, useEffect, useRef, useState } from 'react'

export type PwaInstallStatus =
  | 'unavailable'
  | 'available'
  | 'installing'
  | 'installed'
  | 'dismissed'
  | 'error'

export type PwaInstallOutcome = 'accepted' | 'dismissed' | 'installed' | 'unavailable' | 'error'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
  getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string; id?: string }>>
}

export const PWA_INSTALLED_MARKER_KEY = 'phd-atlas-pwa-installed:v1'

/**
 * Module-level deferred prompt. Survives React Strict Mode remounts and
 * lazy App chunk load. Cleared only after prompt() or appinstalled.
 */
let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null
let promptCaptureAttached = false
const promptAvailabilityListeners = new Set<() => void>()

function notifyPromptAvailability() {
  for (const listener of promptAvailabilityListeners) {
    try {
      listener()
    } catch {
      // Ignore subscriber failures so one bad mount cannot break others.
    }
  }
}

function storeDeferredPrompt(event: BeforeInstallPromptEvent) {
  if (typeof event.prompt !== 'function') return
  event.preventDefault()
  sharedDeferredPrompt = event
  setInstalledMarker(false)
  notifyPromptAvailability()
}

function clearDeferredPrompt() {
  sharedDeferredPrompt = null
}

/**
 * Capture `beforeinstallprompt` as early as possible (call from main.tsx).
 * Browsers often fire it before the lazy App chunk mounts; missing it leaves
 * install stuck as unavailable until the next full navigation.
 */
export function capturePwaInstallPrompt() {
  if (promptCaptureAttached || typeof window === 'undefined') return
  promptCaptureAttached = true

  window.addEventListener('beforeinstallprompt', (rawEvent) => {
    storeDeferredPrompt(rawEvent as BeforeInstallPromptEvent)
  })

  window.addEventListener('appinstalled', () => {
    clearDeferredPrompt()
    setInstalledMarker(true)
    notifyPromptAvailability()
  })
}

// Eager side-effect when this module is imported from main entry.
capturePwaInstallPrompt()

function hasInstalledMarker() {
  try {
    return localStorage.getItem(PWA_INSTALLED_MARKER_KEY) === '1'
  } catch {
    return false
  }
}

function setInstalledMarker(installed: boolean) {
  try {
    if (installed) {
      localStorage.setItem(PWA_INSTALLED_MARKER_KEY, '1')
    } else {
      localStorage.removeItem(PWA_INSTALLED_MARKER_KEY)
    }
  } catch {
    // Installation detection remains valid for this window when storage is unavailable.
  }
}

function isStandaloneMode() {
  const iosStandalone = Boolean((navigator as NavigatorWithStandalone).standalone)
  const displayStandalone = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches
  const displayMinimalUi = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: minimal-ui)').matches
  const displayWindowControls = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: window-controls-overlay)').matches
  return iosStandalone || displayStandalone || displayMinimalUi || displayWindowControls
}

/**
 * Ask the browser whether this PWA is installed. Returns:
 * - true / false when the Related Applications API can answer
 * - null when the API is unavailable or fails (unknown)
 */
async function detectInstalledRelatedApp(): Promise<boolean | null> {
  const nav = navigator as NavigatorWithStandalone
  if (typeof nav.getInstalledRelatedApps !== 'function') return null
  try {
    const apps = await nav.getInstalledRelatedApps()
    if (!Array.isArray(apps)) return null
    // Chromium reports an installed same-origin PWA as platform "webapp".
    return apps.some((app) => app.platform === 'webapp')
  } catch {
    return null
  }
}

function getSharedDeferredPrompt() {
  return sharedDeferredPrompt
}

/** Test-only: reset module capture state between unit tests. */
export function __resetPwaInstallCaptureForTests() {
  sharedDeferredPrompt = null
  promptAvailabilityListeners.clear()
  // Keep promptCaptureAttached so listeners stay registered on window in jsdom.
}

export function usePwaInstall() {
  capturePwaInstallPrompt()

  // Optimistic "just installed" flag for the current document lifetime only.
  // Never treat localStorage alone as proof of installation — it goes stale
  // after uninstall until beforeinstallprompt / related-apps revalidation.
  const sessionInstalledRef = useRef(false)
  const [status, setStatus] = useState<PwaInstallStatus>(() => {
    if (isStandaloneMode()) return 'installed'
    if (getSharedDeferredPrompt()) return 'available'
    return 'unavailable'
  })

  useEffect(() => {
    const displayModeQueries = typeof window.matchMedia === 'function'
      ? [
          window.matchMedia('(display-mode: standalone)'),
          window.matchMedia('(display-mode: minimal-ui)'),
          window.matchMedia('(display-mode: window-controls-overlay)'),
        ]
      : []

    const markAvailableFromShared = () => {
      if (isStandaloneMode() || !getSharedDeferredPrompt()) return
      sessionInstalledRef.current = false
      setInstalledMarker(false)
      setStatus('available')
    }

    const handleInstalled = () => {
      clearDeferredPrompt()
      sessionInstalledRef.current = true
      setInstalledMarker(true)
      setStatus('installed')
    }

    const handleDisplayModeChange = () => {
      if (isStandaloneMode()) {
        handleInstalled()
        return
      }
      void revalidateInstalled()
    }

    const revalidateInstalled = async () => {
      if (isStandaloneMode()) {
        sessionInstalledRef.current = true
        setInstalledMarker(true)
        setStatus('installed')
        return
      }

      // Prefer a live deferred prompt over any installed claim.
      // Never "consume" it here — remounts (Strict Mode) must still see it.
      if (getSharedDeferredPrompt()) {
        markAvailableFromShared()
        return
      }

      const related = await detectInstalledRelatedApp()
      // Prompt may have arrived while we awaited related-apps.
      if (getSharedDeferredPrompt()) {
        markAvailableFromShared()
        return
      }

      if (related === true) {
        sessionInstalledRef.current = true
        setInstalledMarker(true)
        setStatus((current) => (current === 'installing' ? current : 'installed'))
        return
      }

      if (related === false) {
        // Authoritative: app is not installed. Clear sticky markers so the
        // install card returns after uninstall.
        sessionInstalledRef.current = false
        setInstalledMarker(false)
        setStatus((current) => {
          if (current === 'available' || current === 'installing' || current === 'dismissed' || current === 'error') {
            return current
          }
          return 'unavailable'
        })
        return
      }

      // API unknown (Safari / Firefox / older browsers).
      // Do not hide the card based solely on localStorage — that marker survives
      // uninstall. Only keep 'installed' for this document if we just installed.
      if (sessionInstalledRef.current) {
        setStatus('installed')
        return
      }
      if (hasInstalledMarker()) {
        // Stale marker without proof → clear and show install guidance again.
        setInstalledMarker(false)
      }
      setStatus((current) => {
        if (current === 'available' || current === 'installing' || current === 'dismissed' || current === 'error') {
          return current
        }
        return 'unavailable'
      })
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') void revalidateInstalled()
    }

    function handlePageShow() {
      void revalidateInstalled()
    }

    // Module-level capture already stores the event; subscribe for late arrivals
    // and for state sync after remount without re-consuming the prompt.
    promptAvailabilityListeners.add(markAvailableFromShared)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pageshow', handlePageShow)
    for (const query of displayModeQueries) {
      query.addEventListener('change', handleDisplayModeChange)
    }

    if (getSharedDeferredPrompt() && !isStandaloneMode()) {
      markAvailableFromShared()
    } else {
      void revalidateInstalled()
    }

    return () => {
      promptAvailabilityListeners.delete(markAvailableFromShared)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pageshow', handlePageShow)
      for (const query of displayModeQueries) {
        query.removeEventListener('change', handleDisplayModeChange)
      }
    }
  }, [])

  const install = useCallback(async (): Promise<PwaInstallOutcome> => {
    if (isStandaloneMode()) {
      clearDeferredPrompt()
      sessionInstalledRef.current = true
      setInstalledMarker(true)
      setStatus('installed')
      return 'installed'
    }

    const deferredPrompt = getSharedDeferredPrompt()
    if (!deferredPrompt) {
      setStatus('unavailable')
      return 'unavailable'
    }

    setStatus('installing')
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      // Prompt can only be used once.
      clearDeferredPrompt()
      if (choice.outcome === 'accepted') {
        // Optimistic: hide the card immediately. appinstalled / related-apps
        // will confirm; if the user cancels mid-install Chrome still reports dismissed.
        sessionInstalledRef.current = true
        setInstalledMarker(true)
        setStatus('installed')
        return 'accepted'
      }
      sessionInstalledRef.current = false
      setStatus('dismissed')
      return 'dismissed'
    } catch {
      clearDeferredPrompt()
      sessionInstalledRef.current = false
      setStatus('error')
      return 'error'
    }
  }, [])

  return {
    status,
    canInstall: status === 'available',
    install,
  }
}
