import { ClipboardList, Plus } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

export function EmptyDossier({
  onNew,
  description,
}: {
  // Omitted in the team-scoped workspace — no one creates an application on a teammate's behalf.
  onNew?: () => void
  description?: string
}) {
  const { tx } = useI18n()
  return (
    <section className="empty-dossier">
      <div className="empty-state-icon">
        <ClipboardList size={28} aria-hidden="true" />
      </div>
      <h2>{tx('dossier.noAppSelected')}</h2>
      <p className="muted">{description ?? tx('dossier.noAppDesc')}</p>
      {onNew ? (
        <button type="button" className="primary-action" onClick={onNew}>
          <Plus size={16} aria-hidden="true" /> {tx('dossier.createFirst')}
        </button>
      ) : null}
    </section>
  )
}
