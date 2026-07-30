import { useEffect, useRef, useState } from 'react'
import type { I18nContextValue } from '../hooks/useI18n'
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling'
import { formatUptime } from './adminScreenModel'

function normalizeUptime(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/**
 * Isolates the one-second uptime tick from the large AdminScreen render tree.
 * The elapsed value is derived from one anchor timestamp, so hidden tabs can
 * sleep without losing time and refresh immediately when they become visible.
 */
export function AdminLiveUptime({
  initialSeconds,
  label,
  tx,
}: {
  initialSeconds: number
  label: string
  tx: I18nContextValue['tx']
}) {
  const normalizedInitial = normalizeUptime(initialSeconds)
  const startedAtRef = useRef(Date.now() - normalizedInitial * 1_000)
  const [seconds, setSeconds] = useState(normalizedInitial)

  useEffect(() => {
    startedAtRef.current = Date.now() - normalizedInitial * 1_000
    setSeconds(normalizedInitial)
  }, [normalizedInitial])

  useVisibilityAwarePolling({
    enabled: true,
    initialDelayMs: 1_000,
    intervalMs: 1_000,
    pauseWhenServerUnavailable: false,
    restartKey: normalizedInitial,
    poll: (signal) => {
      if (!signal.aborted) {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1_000))
      }
    },
  })

  return (
    <span>
      {label} <strong>{formatUptime(seconds, tx)}</strong>
    </span>
  )
}
