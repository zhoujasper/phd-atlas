import { localeForLanguage, t, type Language } from './i18n'

export type Screen = 'dashboard' | 'workspace' | 'discover' | 'profile' | 'settings' | 'team'
/** Which nav/data context is active for team roles that have both a personal workspace and
 * a team system to manage or participate in. */
export type InterfaceMode = 'personal' | 'team'
export type TeamSection = 'overview' | 'applications' | 'members' | 'resources' | 'discover' | 'audit' | 'settings'
export type DetailTab = 'dossier' | 'materials' | 'mail' | 'funding' | 'timeline' | 'review'
export type ReviewCommentTargetTab = DetailTab
export type ToastTone = 'success' | 'error' | 'info' | 'warning'
export type SortField = 'deadline' | 'name' | 'status' | 'priority' | 'progress'
export type SortKey = SortField | `${SortField}:asc` | `${SortField}:desc`

export type ToastAction = {
  label: string
  onClick: () => void
}

export type Toast = {
  tone: ToastTone
  message: string
  action?: ToastAction
}

/** Parses JSON from storage without ever throwing — malformed/corrupted values just yield null. */
export function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export type I18nContextValue = {
  lang: Language
  t: Record<string, unknown>
}

export const today = new Date().toISOString().slice(0, 10)

export function formatDate(value: string, lang: string = 'en') {
  const locale = localeForLanguage(lang)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

export function formatDateFull(value: string, lang: string = 'en') {
  const locale = localeForLanguage(lang)
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

export function daysUntil(value: string) {
  const target = new Date(`${value}T00:00:00`).getTime()
  const now = new Date(`${today}T00:00:00`).getTime()
  return Math.ceil((target - now) / 86_400_000)
}

export function deadlineUrgency(days: number): 'past' | 'urgent' | 'warning' | 'safe' {
  if (days < 0) return 'past'
  if (days <= 7) return 'urgent'
  if (days <= 30) return 'warning'
  return 'safe'
}

export const PRIORITY_LEVELS = [
  { value: 0, key: 'priorityVeryLow' },
  { value: 25, key: 'priorityLow' },
  { value: 50, key: 'priorityMedium' },
  { value: 75, key: 'priorityHigh' },
  { value: 100, key: 'priorityCritical' },
] as const
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number]

export function priorityLabel(priority: number): 'high' | 'medium' | 'low' {
  if (priority >= 80) return 'high'
  if (priority >= 50) return 'medium'
  return 'low'
}

/** Map a priority value (0-100) to the closest priority level */
export function priorityToLevel(priority: number): (typeof PRIORITY_LEVELS)[number] {
  let best = PRIORITY_LEVELS[0] as PriorityLevel
  for (const level of PRIORITY_LEVELS) {
    if (priority >= level.value) best = level
  }
  return best
}

export function priorityTone(priority: number): 'very-low' | 'low' | 'medium' | 'high' | 'critical' {
  switch (priorityToLevel(priority).key) {
    case 'priorityCritical':
      return 'critical'
    case 'priorityHigh':
      return 'high'
    case 'priorityMedium':
      return 'medium'
    case 'priorityLow':
      return 'low'
    case 'priorityVeryLow':
    default:
      return 'very-low'
  }
}

/** Human-friendly relative time string. Falls back to formatted date for events far in the past or future. */
export function relativeTime(dateStr: string, lang: string = 'en'): string {
  const formatter = new Intl.RelativeTimeFormat(localeForLanguage(lang), { numeric: 'auto', style: 'short' })
  const now = new Date()
  const target = new Date(`${dateStr}T00:00:00`)
  // Signed diff so future dates take the "in X" branch instead of underflowing into "just now".
  const diffMs = target.getTime() - now.getTime()
  const future = diffMs > 0
  const absSec = Math.floor(Math.abs(diffMs) / 1000)
  const absMin = Math.floor(absSec / 60)
  const absHour = Math.floor(absMin / 60)
  const absDay = Math.floor(absHour / 24)

  if (absSec < 60) return formatter.format(0, 'second')
  if (absMin < 60) return formatter.format(future ? absMin : -absMin, 'minute')
  if (absHour < 24) return formatter.format(future ? absHour : -absHour, 'hour')
  if (absDay < 7) return formatter.format(future ? absDay : -absDay, 'day')
  return formatDate(dateStr, lang)
}

/** Where a timeline event date sits relative to today, for past/present/future styling. */
export function timelineDateStatus(dateStr: string): 'past' | 'today' | 'future' {
  if (dateStr === today) return 'today'
  return dateStr > today ? 'future' : 'past'
}

export type TimelineGroup<
  T extends { id: string; title: string; date: string; note: string; source?: string; manual?: boolean } =
    { id: string; title: string; date: string; note: string; source?: string; manual?: boolean },
> = {
  label: string
  key: string
  events: T[]
}

/** Bucket timeline events into labelled date groups (newest first). Preserves any extra fields on T. */
export function groupTimelineEvents<
  T extends { id: string; title: string; date: string; note: string; source?: string; manual?: boolean },
>(
  events: T[],
  lang: string = 'en',
): TimelineGroup<T>[] {
  const locale = localeForLanguage(lang)
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  // Current week (Monday-Sunday)
  const startOfWeek = new Date(now)
  const dayOfWeek = startOfWeek.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  startOfWeek.setDate(startOfWeek.getDate() + mondayOffset)
  const weekStartStr = startOfWeek.toISOString().slice(0, 10)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(endOfWeek.getDate() + 6)
  const weekEndStr = endOfWeek.toISOString().slice(0, 10)

  // Current month
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const endOfMonthStr = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date))

  const groups: Record<string, TimelineGroup<T>> = {}
  const groupOrder: string[] = []

  for (const event of sorted) {
    let key: string
    let label: string

    if (event.date === todayStr) {
      key = 'today'
      label = t(lang, 'dossier.timeGroupToday')
    } else if (event.date === yesterdayStr) {
      key = 'yesterday'
      label = t(lang, 'dossier.timeGroupYesterday')
    } else if (event.date >= weekStartStr && event.date <= weekEndStr) {
      key = 'this-week'
      label = t(lang, 'dossier.timeGroupThisWeek')
    } else if (event.date >= startOfMonth && event.date <= endOfMonthStr) {
      key = 'this-month'
      label = t(lang, 'dossier.timeGroupThisMonth')
    } else {
      const d = new Date(`${event.date}T00:00:00`)
      const monthYear = new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(d)
      key = `month-${d.getFullYear()}-${d.getMonth()}`
      label = monthYear
    }

    if (!groups[key]) {
      groups[key] = { label, key, events: [] }
      groupOrder.push(key)
    }
    groups[key].events.push(event)
  }

  return groupOrder.map((k) => groups[k])
}
