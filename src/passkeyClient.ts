type StandaloneNavigator = Navigator & {
  standalone?: boolean
}

export function isStandalonePwa() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return Boolean(
    (navigator as StandaloneNavigator).standalone
      || window.matchMedia?.('(display-mode: standalone)').matches
      || window.matchMedia?.('(display-mode: fullscreen)').matches,
  )
}

/**
 * Installed mobile PWAs are more reliable when WebAuthn is allowed to discover
 * the resident credential itself. Supplying an allowCredentials list can make
 * iOS cancel the chooser before it is painted even though the synced passkey is
 * available to the standalone app.
 */
export function passkeyLoginEmailHint(email: string, standalone = isStandalonePwa()) {
  return standalone ? '' : email.trim()
}
