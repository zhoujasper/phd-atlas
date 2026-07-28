import { useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-phd-turnstile]')
    const script = existing ?? document.createElement('script')
    const handleLoad = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not initialize.'))
    const handleError = () => reject(new Error('Turnstile could not be loaded.'))
    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.phdTurnstile = 'true'
      document.head.appendChild(script)
    }
  }).catch((error) => {
    scriptPromise = null
    throw error
  })
  return scriptPromise
}

export function TurnstileChallenge({
  siteKey,
  action,
  theme,
  onToken,
  onError,
}: {
  siteKey: string
  action: string
  theme: 'light' | 'dark'
  onToken: (token: string) => void
  onError: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useEffect(() => {
    let disposed = false
    let widgetId = ''
    onTokenRef.current('')
    void loadTurnstile()
      .then((api) => {
        if (disposed || !hostRef.current) return
        widgetId = api.render(hostRef.current, {
          sitekey: siteKey,
          action,
          theme,
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'timeout-callback': () => onTokenRef.current(''),
          'error-callback': () => {
            onTokenRef.current('')
            onErrorRef.current()
          },
        })
      })
      .catch(() => {
        if (!disposed) onErrorRef.current()
      })
    return () => {
      disposed = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [action, siteKey, theme])

  return <div ref={hostRef} style={{ minHeight: 65, width: '100%' }} />
}
