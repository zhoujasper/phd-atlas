import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CloudOff,
  CloudUpload,
  RefreshCw,
  ServerOff,
  Wifi,
  WifiLow,
} from 'lucide-react'
import type { ConnectivitySnapshot } from '../../connectivity'
import { localeForLanguage, type Language, tpl } from '../../i18n'

type Props = {
  connectivity: ConnectivitySnapshot
  language: Language
  snapshotActive: boolean
  snapshotSavedAt: string | null
  pendingCount: number
  blockedCount: number
  syncing: boolean
  updateReady: boolean
  onRetry: () => void
  onReviewBlocked: () => void
  onInstallUpdate: () => void
  onToggleOffline: () => void
  tx: (path: string, fallback?: string) => string
  authSurface?: boolean
  allowManualOffline?: boolean
}

function connectivityUnavailableForBadge(mode: ConnectivitySnapshot['mode']) {
  return mode === 'offline' || mode === 'server-unreachable' || mode === 'slow'
}

export function OfflineStatusCenter({
  connectivity,
  language,
  snapshotActive,
  snapshotSavedAt,
  pendingCount,
  blockedCount,
  syncing,
  updateReady,
  onRetry,
  onReviewBlocked,
  onInstallUpdate,
  onToggleOffline,
  tx,
  authSurface = false,
  allowManualOffline = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const visible = connectivity.mode !== 'online'
    || snapshotActive
    || pendingCount > 0
    || blockedCount > 0
    || syncing
    || updateReady

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!visible) return null

  const mode = syncing ? 'syncing' : connectivity.mode
  const Icon = mode === 'syncing'
    ? CloudUpload
    : mode === 'offline'
      ? CloudOff
      : mode === 'server-unreachable'
        ? ServerOff
        : mode === 'slow'
          ? WifiLow
          : mode === 'checking'
            ? RefreshCw
            : updateReady
              ? RefreshCw
              : pendingCount > 0
                ? CloudUpload
                : Wifi
  const label = syncing
    ? tx('offlineStatus.syncing')
    : connectivity.manualOffline
      ? tx('offlineStatus.workingOffline')
      : connectivity.mode === 'server-unreachable'
          ? tx('offlineStatus.serverUnavailable')
          : connectivity.mode === 'slow'
            ? tx('offlineStatus.slow')
            : connectivity.mode === 'checking'
              ? tx('offlineStatus.checking')
              : connectivity.mode === 'offline'
              ? tx('offlineStatus.offline')
                : blockedCount > 0
                  ? tpl(tx('offlineStatus.blocked'), { count: blockedCount })
                  : pendingCount > 0
                    ? tpl(tx('offlineStatus.pending'), { count: pendingCount })
                    : updateReady
                      ? tx('offlineStatus.updateReady')
                      : tx('offlineStatus.snapshot')
  const detail = connectivity.manualOffline
    ? tx('offlineStatus.manualDetail')
    : connectivity.mode === 'offline'
      ? tx('offlineStatus.offlineDetail')
    : connectivity.mode === 'server-unreachable'
      ? tx('offlineStatus.serverUnavailableDetail')
      : connectivity.mode === 'slow'
        ? tx('offlineStatus.slowDetail')
        : connectivity.mode === 'checking'
          ? tx('offlineStatus.checkingDetail')
          : tx('offlineStatus.onlineDetail')
  const timeFormatter = new Intl.DateTimeFormat(localeForLanguage(language), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const savedLabel = snapshotSavedAt
    ? timeFormatter.format(new Date(snapshotSavedAt))
    : tx('offlineStatus.notAvailable')

  return (
    <div className={`offline-status-center mode-${mode}${open ? ' open' : ''}${authSurface ? ' auth-surface' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="offline-status-pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon className={mode === 'checking' || mode === 'syncing' ? 'spin' : ''} size={13} aria-hidden="true" />
        <span>{label}</span>
        {connectivityUnavailableForBadge(connectivity.mode) && pendingCount + blockedCount > 0 ? (
          <span className="offline-status-count" aria-label={tpl(tx('offlineStatus.queueBadge'), { count: pendingCount + blockedCount })}>
            {pendingCount + blockedCount}
          </span>
        ) : null}
        <ChevronDown className="offline-status-chevron" size={12} aria-hidden="true" />
      </button>

      {open ? (
        <section className="offline-status-popover" role="dialog" aria-label={tx('offlineStatus.panelTitle')}>
          <div className="offline-status-heading">
            <span className="offline-status-icon"><Icon size={18} aria-hidden="true" /></span>
            <div>
              <strong>{label}</strong>
              <p>{detail}</p>
            </div>
          </div>

          <div className="offline-status-facts">
            <div>
              <span>{tx('offlineStatus.server')}</span>
              <strong>
                {connectivity.serverReachable === true ? tx('offlineStatus.reachable')
                  : connectivity.mode === 'checking' ? tx('offlineStatus.checking')
                    : tx('offlineStatus.unreachable')}
              </strong>
            </div>
            <div>
              <span>{tx('offlineStatus.localCopy')}</span>
              <strong>{savedLabel}</strong>
            </div>
            <div>
              <span>{tx('offlineStatus.syncQueue')}</span>
              <strong>{tpl(tx('offlineStatus.queueSummary'), { pending: pendingCount, blocked: blockedCount })}</strong>
            </div>
          </div>

          {snapshotActive ? (
            <div className="offline-status-note">
              <Check size={14} aria-hidden="true" />
              <span>{tx('offlineStatus.snapshotSafe')}</span>
            </div>
          ) : null}

          {blockedCount > 0 ? (
            <button type="button" className="offline-status-review" onClick={onReviewBlocked}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{tpl(tx('offlineStatus.reviewBlocked'), { count: blockedCount })}</span>
            </button>
          ) : null}

          <div className="offline-status-actions">
            <button type="button" className="quiet-action" onClick={onRetry} disabled={connectivity.mode === 'checking' || syncing || connectivity.manualOffline}>
              <RefreshCw size={14} aria-hidden="true" />
              {syncing ? tx('offlineStatus.syncing') : tx('offlineStatus.retry')}
            </button>
            {allowManualOffline && connectivity.browserOnline ? (
              <button type="button" className="quiet-action" onClick={onToggleOffline}>
                {connectivity.manualOffline ? <Wifi size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
                {connectivity.manualOffline ? tx('offlineStatus.resumeOnline') : tx('offlineStatus.workOffline')}
              </button>
            ) : null}
            {updateReady ? (
              <button type="button" className="primary-action compact" onClick={onInstallUpdate}>
                {tx('offlineStatus.installUpdate')}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
