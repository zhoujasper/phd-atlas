import type { ApplicationStatus, MaterialStatus } from '../../data/applications'
import { statusCssSlug, statusLabel, statusMenuTone } from '../../statusLabels'
import { useI18n } from '../hooks/useI18n'

export function StatusPill({ status }: { status: ApplicationStatus | MaterialStatus | string }) {
  const { tx } = useI18n()
  const label = statusLabel(status, tx)
  const slug = statusCssSlug(status)
  const tone = statusMenuTone(status)

  return (
    <span className={`status-pill ${slug} tone-${tone}`} title={label}>
      <span className="status-pill-dot" aria-hidden="true" />
      <span className="status-pill-label">{label}</span>
    </span>
  )
}

export function MaterialPill({ status }: { status: MaterialStatus | string }) {
  const { tx } = useI18n()
  const label = statusLabel(status, tx)
  const slug = statusCssSlug(status)
  const tone = statusMenuTone(status)

  return (
    <span className={`material-pill ${slug}-status tone-${tone}`} title={label}>
      <span className="status-pill-dot" aria-hidden="true" />
      <span className="status-pill-label">{label}</span>
    </span>
  )
}

/** Compact inline chip for dashboard / dense lists. */
export function StatusChip({
  status,
  className = '',
}: {
  status: string
  className?: string
}) {
  const { tx } = useI18n()
  const label = statusLabel(status, tx)
  const slug = statusCssSlug(status)
  const tone = statusMenuTone(status)

  return (
    <span className={`status-chip ${slug} tone-${tone}${className ? ` ${className}` : ''}`} title={label}>
      <span className="status-pill-dot" aria-hidden="true" />
      <span className="status-pill-label">{label}</span>
    </span>
  )
}
