import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useState, useCallback } from 'react'
import { useI18n } from '../hooks/useI18n'
import { copyToClipboard } from './clipboard'

export function CopyButton({
  value,
  label,
  size = 14,
  className = '',
}: {
  value: string
  label: string
  size?: number
  className?: string
}) {
  const { tx, format } = useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyLabel = format(tx('copy'), { label })

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const ok = await copyToClipboard(value)
      setState(ok ? 'copied' : 'failed')
      setTimeout(() => setState('idle'), 1800)
    },
    [value],
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
      {state === 'copied' ? (
        <Check size={size} aria-hidden="true" className="copy-check" />
      ) : state === 'failed' ? (
        <AlertTriangle size={size} aria-hidden="true" />
      ) : (
        <Copy size={size} aria-hidden="true" />
      )}
    </button>
  )
}
