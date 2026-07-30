import { LoaderCircle } from 'lucide-react'

const TRAILING_WAIT_MARKS = /(?:\s*(?:…|\.{3}))+\s*$/u

function pendingLabelBase(label: string) {
  const trimmed = label.trim()
  const base = trimmed.replace(TRAILING_WAIT_MARKS, '').trimEnd()
  return base || trimmed
}

export function PendingLabel({
  label,
  iconSize = 13,
  className = '',
  showSpinner = true,
}: {
  label: string
  iconSize?: number
  className?: string
  showSpinner?: boolean
}) {
  const base = pendingLabelBase(label)

  return (
    <span className={`pending-label${className ? ` ${className}` : ''}`}>
      {showSpinner ? (
        <span className="pending-label-spinner" style={{ width: iconSize, height: iconSize }} aria-hidden="true">
          <LoaderCircle />
        </span>
      ) : null}
      <span className="pending-label-copy" aria-hidden="true">
        {base}
        <span className="pending-label-dots">...</span>
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
