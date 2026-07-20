import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export const overlayExitDurationMs = 160

export function getMotionDelay(duration: number) {
  if (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return 0
  return duration
}

export function useAnimatedClose(
  open: boolean,
  onClose: () => void,
  duration = overlayExitDurationMs,
  resetKey?: string | number,
) {
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  // The returned callback is used directly by buttons as well as by callers
  // that provide a post-close action. React passes an event to direct onClick
  // handlers, so only a real function may become the deferred close action.
  const requestClose = useCallback((afterClose?: unknown) => {
    if (timerRef.current !== null) return
    const closeAction = typeof afterClose === 'function' ? afterClose : onCloseRef.current
    setExiting(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      closeAction()
    }, getMotionDelay(duration))
  }, [duration])

  useEffect(() => {
    if (open) {
      cancelTimer()
      setExiting(false)
    }
  }, [cancelTimer, open])

  // A parent can preserve its component instance while swapping its underlying
  // record. In that case an old exit timer must not close a newly opened overlay.
  useLayoutEffect(() => {
    if (resetKey === undefined) return
    cancelTimer()
    setExiting(false)
  }, [cancelTimer, resetKey])

  useEffect(() => () => cancelTimer(), [cancelTimer])

  return { exiting, requestClose }
}
