import { useCallback, useEffect, useRef, useState } from 'react'
import type { Toast, ToastAction, ToastTone } from '../../appModel'

export type QueuedToast = Toast & {
  id: number
  exiting: boolean
}

type ToastTimer = {
  handle: ReturnType<typeof setTimeout> | null
  remaining: number
  startedAt: number
}

const MAX_VISIBLE_TOASTS = 5
const TOAST_EXIT_MS = 220

function holdDuration(tone: ToastTone) {
  return tone === 'error' || tone === 'warning' ? 2_000 : 1_800
}

/**
 * Shared top-toast queue. Every toast owns its own clock, so hovering one item
 * pauses only that item while the rest of the stack continues normally.
 */
export function useToastQueue() {
  const [toasts, setToasts] = useState<QueuedToast[]>([])
  const toastsRef = useRef<QueuedToast[]>([])
  const nextIdRef = useRef(0)
  const timersRef = useRef(new Map<number, ToastTimer>())
  const removalTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const removeToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer?.handle) clearTimeout(timer.handle)
    timersRef.current.delete(id)
    const removalTimer = removalTimersRef.current.get(id)
    if (removalTimer) clearTimeout(removalTimer)
    removalTimersRef.current.delete(id)
    const next = toastsRef.current.filter((toast) => toast.id !== id)
    toastsRef.current = next
    setToasts(next)
  }, [])

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer?.handle) clearTimeout(timer.handle)
    timersRef.current.delete(id)
    const next = toastsRef.current.map((toast) => (
      toast.id === id ? { ...toast, exiting: true } : toast
    ))
    toastsRef.current = next
    setToasts(next)
    if (removalTimersRef.current.has(id)) return
    removalTimersRef.current.set(id, setTimeout(() => removeToast(id), TOAST_EXIT_MS))
  }, [removeToast])

  const startTimer = useCallback((id: number, remaining: number) => {
    const safeRemaining = Math.max(80, remaining)
    const timer: ToastTimer = {
      handle: null,
      remaining: safeRemaining,
      startedAt: performance.now(),
    }
    timer.handle = setTimeout(() => dismissToast(id), safeRemaining)
    timersRef.current.set(id, timer)
  }, [dismissToast])

  const notify = useCallback((
    message: string,
    tone: ToastTone = 'success',
    action?: ToastAction,
    durationMs?: number,
  ) => {
    const id = ++nextIdRef.current
    const item: QueuedToast = { id, message, tone, action, exiting: false }
    const current = toastsRef.current
    const active = current.filter((toast) => !toast.exiting)
    const overflowId = active.length >= MAX_VISIBLE_TOASTS
      ? active[active.length - 1]?.id ?? null
      : null
    const next = [
      item,
      ...current.map((toast) => (
        toast.id === overflowId ? { ...toast, exiting: true } : toast
      )),
    ]
    toastsRef.current = next
    setToasts(next)
    startTimer(id, durationMs ?? holdDuration(tone))
    // State updaters run synchronously for this event path, so overflowId is
    // available here without another render or an effect-wide queue scan.
    if (overflowId !== null) {
      const overflowTimer = timersRef.current.get(overflowId)
      if (overflowTimer?.handle) clearTimeout(overflowTimer.handle)
      timersRef.current.delete(overflowId)
      removalTimersRef.current.set(overflowId, setTimeout(() => removeToast(overflowId), TOAST_EXIT_MS))
    }
    return id
  }, [removeToast, startTimer])

  const pauseToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (!timer?.handle) return
    clearTimeout(timer.handle)
    timer.handle = null
    timer.remaining = Math.max(80, timer.remaining - (performance.now() - timer.startedAt))
  }, [])

  const resumeToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (!timer || timer.handle) return
    startTimer(id, timer.remaining)
  }, [startTimer])

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((timer) => {
      if (timer.handle) clearTimeout(timer.handle)
    })
    removalTimersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current.clear()
    removalTimersRef.current.clear()
    toastsRef.current = []
    setToasts([])
  }, [])

  useEffect(() => clearToasts, [clearToasts])

  return { toasts, notify, dismissToast, pauseToast, resumeToast, clearToasts }
}
