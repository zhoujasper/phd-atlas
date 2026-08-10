import { RefreshCw } from 'lucide-react'

export function UpdateReadyBanner({
  updateReady,
  onInstall,
  tx,
}: {
  updateReady: boolean
  onInstall: () => void
  tx: (path: string, fallback?: string) => string
}) {
  if (!updateReady) return null
  return (
    <div className="update-ready-banner" role="status">
      <div className="update-ready-banner-surface">
        <span className="update-ready-banner-icon" aria-hidden="true">
          <RefreshCw size={15} />
        </span>
        <span className="update-ready-banner-copy">
          <strong>{tx('offlineStatus.updateReady')}</strong>
          <span>{tx('offlineStatus.updateReadyHint')}</span>
        </span>
        <button
          type="button"
          className="primary-action compact-action"
          onClick={onInstall}
        >
          {tx('offlineStatus.installUpdate')}
        </button>
      </div>
    </div>
  )
}
