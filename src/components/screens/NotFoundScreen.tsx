import { ArrowLeft, ChevronDown, Compass, Home } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { CopyButton } from '../shared/CopyButton'

export type NotFoundKind = 'route' | 'application'

function createErrorId() {
  const stamp = Date.now().toString(36).toUpperCase()
  const entropy =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase()
  return `NF-${stamp}-${entropy}`
}

function currentPath() {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}`
}

function formatTimestamp(date: Date, lang: string) {
  try {
    return new Intl.DateTimeFormat(localeForLanguage(lang), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

export function NotFoundScreen({
  title,
  message,
  actionLabel,
  onAction,
  onBack,
  kind = 'route',
  path,
  requestMethod = 'GET',
  errorCode = 'NOT_FOUND',
}: {
  title?: string
  message?: string
  actionLabel?: string
  onAction: () => void
  onBack?: () => void
  kind?: NotFoundKind
  path?: string
  requestMethod?: string
  errorCode?: string
}) {
  const { tx, lang } = useI18n()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  const errorId = useMemo(() => createErrorId(), [])
  const occurredAt = useMemo(() => new Date(), [])
  const resolvedPath = path ?? currentPath()
  const resolvedTitle = title ?? tx('notFound.title')
  const resolvedMessage = message ?? tx('notFound.message')
  const requestType =
    kind === 'application' ? tx('notFound.requestTypeApplication') : tx('notFound.requestTypeRoute')
  const timestamp = formatTimestamp(occurredAt, lang)

  const detailRows = [
    { label: tx('notFound.errorId'), value: errorId, mono: true, copyable: true },
    { label: tx('notFound.path'), value: resolvedPath, mono: true, copyable: true },
    { label: tx('notFound.requestType'), value: requestType, mono: false, copyable: false },
    { label: tx('notFound.requestMethod'), value: requestMethod, mono: true, copyable: false },
    { label: tx('notFound.errorCode'), value: errorCode, mono: true, copyable: false },
    { label: tx('notFound.errorMessage'), value: resolvedMessage, mono: false, copyable: false },
    { label: tx('notFound.timestamp'), value: timestamp, mono: false, copyable: false },
  ] as const

  const diagnosticsText = [
    `Error ID: ${errorId}`,
    `Path: ${resolvedPath}`,
    `Request type: ${requestType}`,
    `Method: ${requestMethod}`,
    `Code: ${errorCode}`,
    `Message: ${resolvedMessage}`,
    `Time: ${timestamp}`,
  ].join('\n')

  const handleBack = () => {
    if (onBack) {
      onBack()
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    onAction()
  }

  return (
    <div className="not-found-screen">
      <div className="not-found-card animate-enter">
        <div className="not-found-visual" aria-hidden="true">
          <span className="not-found-code">404</span>
          <div className="not-found-icon">
            <Compass size={26} strokeWidth={1.75} />
          </div>
        </div>

        <p className="not-found-eyebrow">{tx('notFound.eyebrow')}</p>
        <h2>{resolvedTitle}</h2>
        <p className="not-found-message">{resolvedMessage}</p>

        <div className="not-found-actions">
          <button type="button" className="secondary-action" onClick={handleBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            {tx('notFound.goBack')}
          </button>
          <button type="button" className="primary-action" onClick={onAction}>
            <Home size={15} aria-hidden="true" />
            {actionLabel ?? tx('notFound.backToDashboard')}
          </button>
        </div>

        <div className={`not-found-details${detailsOpen ? ' open' : ''}`}>
          <button
            type="button"
            className="not-found-details-toggle"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <span>{tx('notFound.details')}</span>
            <ChevronDown size={15} aria-hidden="true" className="not-found-details-chevron" />
          </button>

          <div
            id={detailsId}
            className="not-found-details-panel"
            aria-hidden={!detailsOpen}
          >
            <div className="not-found-details-inner" inert={!detailsOpen}>
              <div className="not-found-details-head">
                <span>{tx('notFound.diagnostics')}</span>
                <CopyButton value={diagnosticsText} label={tx('notFound.copyAll')} size={13} />
              </div>

              <dl className="not-found-meta">
                {detailRows.map((row) => (
                  <div key={row.label} className="not-found-meta-row">
                    <dt>{row.label}</dt>
                    <dd>
                      <code className={row.mono ? 'is-mono' : undefined} title={row.value}>
                        {row.value}
                      </code>
                      {row.copyable ? (
                        <CopyButton value={row.value} label={row.label} size={12} />
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
