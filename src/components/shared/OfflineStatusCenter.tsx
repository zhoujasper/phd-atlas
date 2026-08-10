import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  CloudOff,
  CloudUpload,
  RefreshCw,
  ServerOff,
  ShieldCheck,
  Wifi,
  WifiLow,
} from 'lucide-react'
import type { ConnectivitySnapshot } from '../../connectivity'
import { localeForLanguage, type Language, tpl } from '../../i18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'

type Props = {
  connectivity: ConnectivitySnapshot
  language: Language
  snapshotActive: boolean
  snapshotSavedAt: string | null
  offlineAccessExpiresAt?: string | null
  pendingCount: number
  blockedCount: number
  blockedReason?: string | null
  syncing: boolean
  updateReady: boolean
  onRetry: () => void
  onInstallUpdate: () => void
  onToggleOffline: () => void
  tx: (path: string, fallback?: string) => string
  authSurface?: boolean
  allowManualOffline?: boolean
}

const STATUS_MESSAGE_DWELL_MS = 2800
const BLOCKED_REASON_KINDS = ['conflict', 'missing', 'permission', 'unverifiable']

function connectivityUnavailableForBadge(mode: ConnectivitySnapshot['mode']) {
  return mode === 'offline' || mode === 'server-unreachable' || mode === 'slow'
}

// Entries parked by an older build still carry the reason the server refused
// them ('conflict:field,field', 'missing', 'permission', 'unverifiable'). They
// now clear on the next sync, so the wording explains what will happen rather
// than asking for an action; a change that no longer exists upstream is still
// not the same problem as a divergent edit.
function blockedReasonKey(reason: string | null | undefined) {
  const kind = (reason ?? '').split(':')[0]
  return BLOCKED_REASON_KINDS.includes(kind)
    ? `offlineStatus.blockedReason.${kind}`
    : 'offlineStatus.blockedReason.conflict'
}

export function OfflineStatusCenter({
  connectivity,
  language,
  snapshotActive,
  snapshotSavedAt,
  offlineAccessExpiresAt = null,
  pendingCount,
  blockedCount,
  blockedReason = null,
  syncing,
  updateReady,
  onRetry,
  onInstallUpdate,
  onToggleOffline,
  tx,
  authSurface = false,
  allowManualOffline = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { exiting, requestClose } = useAnimatedClose(open, () => setOpen(false))
  const visible = connectivity.mode !== 'online'
    || snapshotActive
    || pendingCount > 0
    || blockedCount > 0
    || syncing
    || updateReady
  const queuedCount = pendingCount + blockedCount
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
              : queuedCount > 0
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
  const statusPresentationKey = JSON.stringify([mode, label, queuedCount])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) requestClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, requestClose])

  useEffect(() => {
    if (!visible) return undefined
    const center = rootRef.current
    if (!center) return undefined
    center.classList.add('is-status-announcing')
    const timeoutId = window.setTimeout(() => {
      center.classList.remove('is-status-announcing')
    }, STATUS_MESSAGE_DWELL_MS)
    return () => {
      window.clearTimeout(timeoutId)
      center.classList.remove('is-status-announcing')
    }
  }, [statusPresentationKey, visible])

  if (!visible) return null

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
  const accessUntilLabel = offlineAccessExpiresAt
    ? timeFormatter.format(new Date(offlineAccessExpiresAt))
    : tx('offlineStatus.notAvailable')

  return (
    <div
      className={`offline-status-center mode-${mode}${open ? ' open' : ''}${authSurface ? ' auth-surface' : ''}`}
      data-overflow-reveal="off"
      ref={rootRef}
    >
      <button
        type="button"
        className="offline-status-pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) requestClose()
          else setOpen(true)
        }}
      >
        <Icon className={mode === 'checking' || mode === 'syncing' ? 'spin' : ''} size={14} aria-hidden="true" />
        <span className="offline-status-pill-content">
          <span className="offline-status-label" key={statusPresentationKey}>{label}</span>
          {connectivityUnavailableForBadge(connectivity.mode) && queuedCount > 0 ? (
            <span className="offline-status-count" aria-label={tpl(tx('offlineStatus.queueBadge'), { count: queuedCount })}>
              {queuedCount}
            </span>
          ) : null}
          <ChevronDown className="offline-status-chevron" size={12} aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <section className={`offline-status-popover${exiting ? ' is-exiting' : ''}`} role="dialog" aria-label={tx('offlineStatus.panelTitle')}>
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
              <span>{tx('offlineStatus.accessUntil')}</span>
              <strong>{accessUntilLabel}</strong>
            </div>
            <div>
              <span>{tx('offlineStatus.syncQueue')}</span>
              <strong>
                {blockedCount > 0
                  ? tpl(tx('offlineStatus.queueSummary'), { pending: pendingCount, blocked: blockedCount })
                  : tpl(tx('offlineStatus.pending'), { count: pendingCount })}
              </strong>
            </div>
          </div>

          {snapshotActive ? (
            <div className="offline-status-note offline-status-security">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                <strong>{tx('offlineStatus.personalScopeValue')}</strong>
                <small>{tx('offlineStatus.permissionProtected')}</small>
              </span>
            </div>
          ) : null}

          {blockedCount > 0 ? (
            <div className="offline-status-note offline-status-security">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                <strong>{tpl(tx('offlineStatus.blocked'), { count: blockedCount })}</strong>
                <small>{tx(blockedReasonKey(blockedReason))}</small>
              </span>
            </div>
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
