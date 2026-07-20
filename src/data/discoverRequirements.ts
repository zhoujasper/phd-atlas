/** Structured application requirements for Discover (planner-style facts, Atlas UX). */

export type DeadlineCertainty = 'official' | 'typical' | 'rolling' | 'unknown'
export type DeadlineKind = 'application' | 'funding' | 'priority' | 'interview' | 'other'

export type DiscoverDeadline = {
  id: string
  label: string
  /** ISO date when known; null for rolling/unknown */
  date: string | null
  kind: DeadlineKind
  certainty: DeadlineCertainty
  notes?: string
}

export type TestRequirementStatus =
  | 'required'
  | 'optional'
  | 'waived'
  | 'not_required'
  | 'required_if_intl'
  | 'unknown'

export type DiscoverTestRequirement = {
  id: string
  name: string
  status: TestRequirementStatus
  notes?: string
}

export type DiscoverMaterialRequirement = {
  id: string
  name: string
  required: boolean
  count?: number
  notes?: string
}

export type DiscoverFeeRequirement = {
  amountUSD: number | null
  currency?: string
  waiverAvailable: boolean
  notes?: string
}

export type SupervisorContact = 'required' | 'recommended' | 'optional' | 'not_needed' | 'unknown'
export type MultiApplyRule = 'multi' | 'single' | 'unknown'

export type DiscoverRestrictionSet = {
  multiApply: MultiApplyRule
  supervisorContact: SupervisorContact
  priorDegree: string
  intlEligible: boolean
  workAuthNotes?: string
  other: string[]
  summary: string
}

export type DiscoverApplicationRoute = {
  type: 'portal' | 'email' | 'position' | 'mixed' | 'unknown'
  label: string
  steps: string[]
  notes?: string
}

export type DiscoverRequirements = {
  deadlines: DiscoverDeadline[]
  tests: DiscoverTestRequirement[]
  materials: DiscoverMaterialRequirement[]
  fees: DiscoverFeeRequirement
  restrictions: DiscoverRestrictionSet
  route: DiscoverApplicationRoute
  degreeMilestones: string[]
  verified: {
    deadlines: boolean
    restrictions: boolean
    fees: boolean
  }
}

export type RequirementFilterState = {
  /** Days until main deadline upper bound; 0 = off */
  deadlineWithinDays: number
  greNotRequired: boolean
  englishFlexible: boolean
  feeWaiver: boolean
  multiApplyOnly: boolean
  supervisorOptional: boolean
  intlFriendly: boolean
  rollingOk: boolean
}

export const DEFAULT_REQUIREMENT_FILTERS: RequirementFilterState = {
  deadlineWithinDays: 0,
  greNotRequired: false,
  englishFlexible: false,
  feeWaiver: false,
  multiApplyOnly: false,
  supervisorOptional: false,
  intlFriendly: false,
  rollingOk: false,
}

export function primaryDeadline(req?: DiscoverRequirements | null): DiscoverDeadline | null {
  if (!req?.deadlines?.length) return null
  const dated = req.deadlines
    .filter((d) => d.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return dated[0] ?? req.deadlines[0] ?? null
}

export function daysUntilIso(date: string | null | undefined, today = new Date().toISOString().slice(0, 10)) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const target = new Date(`${date}T00:00:00`).getTime()
  const now = new Date(`${today}T00:00:00`).getTime()
  return Math.round((target - now) / 86_400_000)
}

export function deadlineUrgencyClass(days: number | null): 'past' | 'urgent' | 'warning' | 'safe' | 'unknown' {
  if (days == null) return 'unknown'
  if (days < 0) return 'past'
  if (days <= 14) return 'urgent'
  if (days <= 45) return 'warning'
  return 'safe'
}

export function testStatusTone(status: TestRequirementStatus): 'ok' | 'warn' | 'soft' | 'muted' {
  if (status === 'not_required' || status === 'waived' || status === 'optional') return 'ok'
  if (status === 'required') return 'warn'
  if (status === 'required_if_intl') return 'soft'
  return 'muted'
}

export function programMatchesRequirementFilters(
  requirements: DiscoverRequirements | undefined,
  multiApply: MultiApplyRule | string | undefined,
  filters: RequirementFilterState,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (!filters) return true
  const req = requirements
  const multi = (req?.restrictions?.multiApply || multiApply || 'unknown') as MultiApplyRule

  if (filters.multiApplyOnly && multi !== 'multi') return false

  if (filters.feeWaiver) {
    if (!req?.fees?.waiverAvailable) return false
  }

  if (filters.greNotRequired) {
    const gre = req?.tests?.find((t) => t.id === 'gre' || /gre/i.test(t.name))
    if (!gre) return false
    if (!['optional', 'waived', 'not_required'].includes(gre.status)) return false
  }

  if (filters.englishFlexible) {
    const eng = req?.tests?.find((t) => t.id === 'english' || /toefl|ielts|english/i.test(t.name))
    if (eng && eng.status === 'required') return false
  }

  if (filters.supervisorOptional) {
    const contact = req?.restrictions?.supervisorContact
    if (contact && !['optional', 'not_needed', 'recommended'].includes(contact)) return false
  }

  if (filters.intlFriendly) {
    if (req?.restrictions && req.restrictions.intlEligible === false) return false
  }

  if (filters.rollingOk) {
    const hasRolling = req?.deadlines?.some((d) => d.kind === 'application' && (d.certainty === 'rolling' || !d.date))
    // When rollingOk is on as a positive filter, require rolling OR still show dated — interpret as "include rolling programs" not exclusive.
    // Exclusive mode: only show if rolling present when filter is the only deadline preference.
    void hasRolling
  }

  if (filters.deadlineWithinDays > 0) {
    const primary = primaryDeadline(req)
    const days = daysUntilIso(primary?.date, today)
    if (days == null) {
      // rolling programs pass only if rollingOk
      if (!(filters.rollingOk || primary?.certainty === 'rolling')) return false
    } else if (days < 0 || days > filters.deadlineWithinDays) {
      return false
    }
  }

  return true
}

export function requirementSummaryChips(req?: DiscoverRequirements | null, lang = 'en') {
  if (!req) return [] as Array<{ id: string; label: string; tone: string }>
  const chips: Array<{ id: string; label: string; tone: string }> = []
  const primary = primaryDeadline(req)
  if (primary?.date) {
    const days = daysUntilIso(primary.date)
    const zh = lang.startsWith('zh')
    chips.push({
      id: 'ddl',
      label: days == null
        ? (zh ? '截止未知' : 'Deadline TBD')
        : days < 0
          ? (zh ? '已过截止' : 'Past deadline')
          : days === 0
            ? (zh ? '今日截止' : 'Due today')
            : (zh ? `${days} 天后截止` : `${days}d to deadline`),
      tone: deadlineUrgencyClass(days),
    })
  } else if (primary?.certainty === 'rolling') {
    chips.push({ id: 'rolling', label: lang.startsWith('zh') ? '滚动招生' : 'Rolling', tone: 'safe' })
  }

  const gre = req.tests.find((t) => t.id === 'gre')
  if (gre) {
    const zh = lang.startsWith('zh')
    const map: Record<string, string> = {
      not_required: zh ? 'GRE 不要求' : 'No GRE',
      waived: zh ? 'GRE 可免' : 'GRE waived',
      optional: zh ? 'GRE 可选' : 'GRE optional',
      required: zh ? '需 GRE' : 'GRE required',
      required_if_intl: zh ? 'GRE(视情况)' : 'GRE conditional',
      unknown: zh ? 'GRE 未知' : 'GRE unknown',
    }
    chips.push({ id: 'gre', label: map[gre.status] || gre.status, tone: testStatusTone(gre.status) })
  }

  if (req.fees.waiverAvailable) {
    chips.push({ id: 'waiver', label: lang.startsWith('zh') ? '可减免申请费' : 'Fee waiver', tone: 'ok' })
  }

  if (req.restrictions.multiApply === 'multi') {
    chips.push({ id: 'multi', label: lang.startsWith('zh') ? '可多申' : 'Multi-apply', tone: 'ok' })
  } else if (req.restrictions.multiApply === 'single') {
    chips.push({ id: 'single', label: lang.startsWith('zh') ? '仅一所' : 'Single only', tone: 'soft' })
  }

  const letters = req.materials.find((m) => m.id === 'letters' || /recommend/i.test(m.name))
  if (letters?.count) {
    chips.push({
      id: 'letters',
      label: lang.startsWith('zh') ? `${letters.count} 封推荐信` : `${letters.count} letters`,
      tone: 'muted',
    })
  }

  return chips
}
