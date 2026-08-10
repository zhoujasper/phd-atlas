/**
 * Wait until the next paint + a short idle window so heavy React commits finish
 * under the loading curtain before it lifts (avoids post-load jank).
 */
export function waitForUiSettle(timeoutMs = 480): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const browserWindow = window

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const reduceMotion = browserWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      finish()
      return
    }

    const hardTimeout = browserWindow.setTimeout(finish, Math.max(80, timeoutMs))
    const idleWindow = browserWindow as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    browserWindow.requestAnimationFrame(() => {
      browserWindow.requestAnimationFrame(() => {
        if (typeof idleWindow.requestIdleCallback === 'function') {
          idleWindow.requestIdleCallback(() => {
            browserWindow.clearTimeout(hardTimeout)
            finish()
          }, { timeout: 140 })
        } else {
          browserWindow.setTimeout(() => {
            browserWindow.clearTimeout(hardTimeout)
            finish()
          }, 36)
        }
      })
    })
  })
}
