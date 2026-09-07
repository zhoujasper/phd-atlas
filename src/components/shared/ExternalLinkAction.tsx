import { ExternalLink } from 'lucide-react'
import { normalizedExternalHref } from '../screens/dossierResourceModel'

export function ExternalLinkAction({ value, label }: { value: string; label: string }) {
  const href = normalizedExternalHref(value)
  const icon = <ExternalLink size={14} aria-hidden="true" />
  if (!href) {
    return <button type="button" className="icon-action" aria-label={label} title={label} disabled>{icon}</button>
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" className="icon-action"
    aria-label={label} title={label}>{icon}</a>
}
