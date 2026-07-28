import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { copyToClipboard } from './clipboard'

export function CopyButton({
  value,
  label,
  size = 14,
  className = '',
  onNotify,
}: {
  value: string
  label: string
  size?: number
  className?: string
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const { tx, format } = useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimerRef = useRef<number | null>(null)
  const copyLabel = format(tx('copy'), { label })

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const ok = await copyToClipboard(value)
      setState(ok ? 'copied' : 'failed')
      if (!ok) onNotify?.(tx('copyFailed'), 'error')
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null
        setState('idle')
      }, 1800)
    },
    [onNotify, tx, value],
  )

  const stateLabel = state === 'copied' ? tx('copiedBang') : state === 'failed' ? tx('copyFailed') : copyLabel

  return (
    <button
      type="button"
      className={`copy-button ${state !== 'idle' ? state : ''} ${className}`}
      onClick={handleCopy}
      aria-label={stateLabel}
      title={stateLabel}
    >
      <span className="copy-button-icon-stage" aria-hidden="true">
        <span className={`copy-button-state-icon idle${state === 'idle' ? ' is-active' : ''}`}>
          <Copy size={size} />
        </span>
        <span className={`copy-button-state-icon copied${state === 'copied' ? ' is-active' : ''}`}>
          <Check size={size} />
        </span>
        <span className={`copy-button-state-icon failed${state === 'failed' ? ' is-active' : ''}`}>
          <AlertTriangle size={size} />
        </span>
      </span>
    </button>
  )
}
