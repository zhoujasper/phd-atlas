import { Clock } from 'lucide-react'
import { daysUntil, deadlineUrgency } from '../../appModel'
import { useI18n } from '../hooks/useI18n'

export function DeadlineBadge({
  deadline,
  compact = false,
}: {
  deadline: string
  compact?: boolean
}) {
  const { tx, format } = useI18n()
  const days = daysUntil(deadline)
  const urgency = deadlineUrgency(days)

  const label =
    days === 0
      ? tx('workspace.today')
      : days > 0
        ? format(tx('workspace.dayShort'), { count: days })
        : format(tx('workspace.daysPast'), { count: Math.abs(days) })

  const fullLabel =
    days === 0
      ? tx('inspector.today')
      : days > 0
        ? format(tx('inspector.daysLeft'), { count: days })
        : format(tx('inspector.daysPast'), { count: Math.abs(days) })

  if (compact) {
    return (
      <span className={`deadline-badge ${urgency}`} title={fullLabel}>
        <Clock size={10} aria-hidden="true" />
        {label}
      </span>
    )
  }

  return (
    <span className={`deadline-badge ${urgency}`} title={fullLabel}>
      <Clock size={11} aria-hidden="true" />
      {fullLabel}
    </span>
  )
}
