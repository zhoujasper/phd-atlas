import { useState } from 'react'
import { CloudOff, GraduationCap, RefreshCw, ShieldCheck } from 'lucide-react'

export function OfflineUnavailableScreen({
  onRetry,
  tx,
}: {
  onRetry: () => Promise<unknown>
  tx: (path: string, fallback?: string) => string
}) {
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    if (retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <main className="offline-launch-canvas">
      <section className="offline-launch-content" aria-labelledby="offline-launch-title">
        <div className="offline-launch-brand" aria-label={tx('appTitle')}>
          <span className="offline-launch-mark">
            <GraduationCap size={23} aria-hidden="true" />
          </span>
          <span>{tx('appTitle')}</span>
        </div>

        <div className="offline-launch-state-icon">
          <CloudOff size={24} aria-hidden="true" />
        </div>
        <h1 id="offline-launch-title">{tx('offlineStatus.launchTitle')}</h1>
        <p className="offline-launch-detail">{tx('offlineStatus.launchDetail')}</p>
        <p className="offline-launch-local-copy">{tx('offlineStatus.noLocalCopy')}</p>

        <button
          type="button"
          className="primary-action offline-launch-retry"
          onClick={() => { void retry() }}
          disabled={retrying}
          aria-busy={retrying}
        >
          <RefreshCw className={retrying ? 'spin' : ''} size={15} aria-hidden="true" />
          {retrying ? tx('offlineStatus.checking') : tx('offlineStatus.retry')}
        </button>

        <div className="offline-launch-security">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{tx('offlineStatus.permissionProtected')}</span>
        </div>
      </section>
    </main>
  )
}
