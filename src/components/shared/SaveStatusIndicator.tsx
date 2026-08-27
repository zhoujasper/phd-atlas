import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, LoaderCircle } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

type SavePhase = 'idle' | 'saving' | 'saved' | 'error'

interface SaveStatusIndicatorProps {
  phase: SavePhase
  lastSavedAt?: Date
  errorMessage?: string
  autoHideMs?: number
  className?: string
}

/**
 * Persistent save status indicator for DossierView toolbar.
 * Shows "Saving…" during save, "Saved" with timestamp on success,
 * auto-hides after delay. Addresses audit finding: no persistent
 * save indicator during operations.
 */
export function SaveStatusIndicator({
  phase,
  lastSavedAt,
  errorMessage,
  autoHideMs = 2000,
  className = '',
}: SaveStatusIndicatorProps) {
  const { lang, tx, format } = useI18n()
  const [isHiding, setIsHiding] = useState(false)
  const [shouldRender, setShouldRender] = useState(phase !== 'idle')

  useEffect(() => {
    if (phase === 'saved' && autoHideMs > 0) {
      setIsHiding(false)
      const hideTimer = window.setTimeout(() => {
        setIsHiding(true)
      }, autoHideMs)

      const unmountTimer = window.setTimeout(() => {
        setShouldRender(false)
      }, autoHideMs + 200) // 200ms fade-out duration

      return () => {
        window.clearTimeout(hideTimer)
        window.clearTimeout(unmountTimer)
      }
    }

    if (phase === 'saving' || phase === 'error') {
      setIsHiding(false)
      setShouldRender(true)
    }

    if (phase === 'idle') {
      setIsHiding(false)
      setShouldRender(false)
    }
  }, [phase, autoHideMs])

  if (!shouldRender) return null

  const statusClass = `dossier-save-status ${phase} ${isHiding ? 'hiding' : ''} ${className}`

  const formatTimestamp = (date: Date) => {
    const now = Date.now()
    const diff = now - date.getTime()
    const seconds = Math.floor(diff / 1000)

    const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
    if (seconds < 5) return relative.format(0, 'second')
    if (seconds < 60) return relative.format(-seconds, 'second')
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return relative.format(-minutes, 'minute')
    return date.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className={statusClass} role="status" aria-live="polite">
      <span className="dossier-save-status-icon" aria-hidden="true">
        {phase === 'saving' && <LoaderCircle size={13} />}
        {phase === 'saved' && <CheckCircle2 size={13} />}
        {phase === 'error' && <AlertCircle size={13} />}
      </span>
      <span>
        {phase === 'saving' && tx('feedback.saving', 'Saving…')}
        {phase === 'saved' && lastSavedAt && format(tx('feedback.savedAt', 'Saved {time}'), { time: formatTimestamp(lastSavedAt) })}
        {phase === 'saved' && !lastSavedAt && tx('feedback.saved', 'Saved')}
        {phase === 'error' && (errorMessage || tx('feedback.saveFailed', 'Save failed'))}
      </span>
    </div>
  )
}
