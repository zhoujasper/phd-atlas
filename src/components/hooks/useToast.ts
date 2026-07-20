import { useRef, useState, useCallback } from 'react'
import type { ToastTone } from '../../appModel'

export type Toast = {
  tone: ToastTone
  message: string
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const [toastExiting, setToastExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setToastExiting(false)
    setToast({ message, tone })
    timerRef.current = setTimeout(() => {
      setToastExiting(true)
      timerRef.current = setTimeout(() => {
        setToast(null)
        setToastExiting(false)
      }, 160)
    }, 2400)
  }, [])

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setToast(null)
    setToastExiting(false)
  }, [])

  return { toast, toastExiting, notify, clearToast }
}
