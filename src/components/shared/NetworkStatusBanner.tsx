import { useEffect, useState } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

interface NetworkStatusBannerProps {
  online: boolean
  reconnecting?: boolean
  onRetry?: () => void
  tx?: (key: string) => string
}

/**
 * Minimal top banner for network status changes.
 * Shows when offline/reconnecting, auto-hides when back online.
 * Complements OfflineStatusCenter for immediate visual feedback.
 */
export function NetworkStatusBanner({
  online,
  reconnecting = false,
  onRetry,
  tx: providedTx,
}: NetworkStatusBannerProps) {
  const { tx: contextTx } = useI18n()
  const tx = providedTx ?? contextTx
  const [visible, setVisible] = useState(!online)
  const [hiding, setHiding] = useState(false)

  useEffect(() => {
    if (!online || reconnecting) {
      setVisible(true)
      setHiding(false)
    } else if (visible) {
      // Auto-hide after coming back online
      const hideTimer = setTimeout(() => setHiding(true), 1200)
      const unmountTimer = setTimeout(() => setVisible(false), 1500)
      return () => {
        clearTimeout(hideTimer)
        clearTimeout(unmountTimer)
      }
    }
  }, [online, reconnecting, visible])

  if (!visible) return null

  const status = reconnecting
    ? 'reconnecting'
    : online
      ? 'online'
      : 'offline'

  return (
    <div
      className={`network-status-banner ${status}${hiding ? ' hiding' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="network-status-icon" aria-hidden="true">
        {status === 'reconnecting' && <RefreshCw size={14} />}
        {status === 'offline' && <WifiOff size={14} />}
        {status === 'online' && <Wifi size={14} />}
      </span>
      <span className="network-status-text">
        {status === 'reconnecting' && tx('feedback.reconnecting', 'Reconnecting…')}
        {status === 'offline' && tx('feedback.offline', "You're offline")}
        {status === 'online' && tx('feedback.backOnline', 'Back online')}
      </span>
      {onRetry && status === 'offline' ? (
        <button
          type="button"
          className="network-status-retry"
          onClick={onRetry}
          aria-label={tx('feedback.retryConnection', 'Retry connection')}
        >
          <RefreshCw size={13} aria-hidden="true" />
          {tx('feedback.retry', 'Retry')}
        </button>
      ) : null}
    </div>
  )
}
