type StatusTranslator = (path: string, fallback?: string) => string

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent' | 'purple'

const statusAliases: Record<string, string> = {
  approved: 'Approved',
  'in progress': 'In progress',
  'needs review': 'Needs Review',
  'need review': 'Needs Review',
  'needs revision': 'Needs revision',
  'not started': 'Not started',
  complete: 'Done',
  completed: 'Done',
  done: 'Done',
  open: 'Open',
}

function normalizeStatusToken(status: string) {
  return status
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function statusTranslationKeys(status: string): string[] {
  const raw = status.trim()
  if (!raw) return []
  const normalized = normalizeStatusToken(raw)
  const alias = statusAliases[normalized]
  return Array.from(new Set([raw, alias].filter(Boolean)))
}

export function statusLabel(status: string, tx: StatusTranslator): string {
  const raw = status.trim()
  for (const key of statusTranslationKeys(raw)) {
    const path = `status.${key}`
    const translated = tx(path)
    if (translated !== path) return translated
  }
  return raw
}

/** CSS class slug for pills / menu dots (`Needs Review` → `needs-review`). */
export function statusCssSlug(status: string): string {
  const normalized = normalizeStatusToken(status)
  if (!normalized) return 'custom'
  const aliased = statusAliases[normalized]
  const token = aliased ? normalizeStatusToken(aliased) : normalized
  return token.replace(/\s+/g, '-') || 'custom'
}

/**
 * Semantic tone for status pickers and chips.
 * Covers material, application, task, and common imported aliases.
 */
export function statusMenuTone(status: string): StatusTone {
  switch (normalizeStatusToken(status)) {
    case 'missing':
    case 'rejected':
      return 'danger'
    case 'requested':
    case 'in progress':
    case 'preparing':
    case 'interview':
      return 'info'
    case 'waiting':
    case 'needs review':
    case 'needs revision':
      return 'warning'
    case 'ready':
    case 'submitted':
    case 'approved':
    case 'accepted':
    case 'done':
    case 'complete':
    case 'completed':
      return 'success'
    case 'waitlist':
      return 'purple'
    case 'draft':
    case 'not started':
    case 'open':
      return 'neutral'
    default:
      return 'neutral'
  }
}

/** @deprecated Use statusMenuTone — kept for existing call sites. */
export function materialStatusMenuTone(status: string): StatusTone {
  return statusMenuTone(status)
}
