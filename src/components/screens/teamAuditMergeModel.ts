import type { SystemEvent, TeamMergePreview, TeamRole } from '../../api/phdApi'

export type TeamFormat = (template: string, values: Record<string, string | number>) => string
export type TeamTx = (key: string, fallback?: string) => string

const MERGE_SECTION_LABEL_KEYS: Record<string, string> = {
  school: 'team.mergeSectionSchool',
  professor: 'team.mergeSectionProfessor',
  materials: 'team.mergeSectionMaterials',
  communications: 'team.mergeSectionCommunications',
  scholarships: 'team.mergeSectionScholarships',
  tasks: 'team.mergeSectionTasks',
  timeline: 'team.mergeSectionTimeline',
  versions: 'team.mergeSectionVersions',
  shares: 'team.mergeSectionSharing',
  reviewComments: 'team.mergeSectionFeedback',
  fees: 'team.mergeSectionFees',
  dossierCards: 'team.mergeSectionApplication',
  tags: 'team.mergeSectionApplication',
  status: 'team.mergeSectionApplication',
  progress: 'team.mergeSectionApplication',
  priority: 'team.mergeSectionApplication',
  deadline: 'team.mergeSectionApplication',
  program: 'team.mergeSectionApplication',
  result: 'team.mergeSectionApplication',
  notes: 'team.mergeSectionApplication',
}

const MERGE_DIRECT_FIELD_LABEL_KEYS: Record<string, string> = {
  'school.name': 'team.mergeFieldSchoolName',
  'school.country': 'team.mergeFieldCountry',
  'school.website': 'team.mergeFieldWebsite',
  'professor.english': 'team.mergeFieldProfessorName',
  'professor.chinese': 'team.mergeFieldProfessorChineseName',
  'professor.email': 'team.mergeFieldEmail',
  'professor.phone': 'team.mergeFieldPhone',
  'professor.homepage': 'team.mergeFieldHomepage',
  'professor.research': 'team.mergeFieldResearch',
  'professor.lab': 'team.mergeFieldLab',
}

const MERGE_LEAF_LABEL_KEYS: Record<string, string> = {
  name: 'team.mergeFieldName',
  title: 'team.mergeFieldTitle',
  type: 'team.mergeFieldType',
  status: 'team.mergeFieldStatus',
  result: 'team.mergeFieldResult',
  notes: 'team.mergeFieldNotes',
  detail: 'team.mergeFieldDetail',
  details: 'team.mergeFieldDetail',
  body: 'team.mergeFieldBody',
  content: 'team.mergeFieldBody',
  email: 'team.mergeFieldEmail',
  phone: 'team.mergeFieldPhone',
  website: 'team.mergeFieldWebsite',
  homepage: 'team.mergeFieldHomepage',
  deadline: 'team.mergeFieldDeadline',
  due: 'team.mergeFieldDue',
  progress: 'team.mergeFieldProgress',
  priority: 'team.mergeFieldPriority',
  program: 'team.mergeFieldProgram',
  country: 'team.mergeFieldCountry',
  tags: 'team.mergeFieldTags',
  dossierCards: 'team.mergeFieldDossierCards',
  english: 'team.mergeFieldProfessorName',
  chinese: 'team.mergeFieldProfessorChineseName',
  research: 'team.mergeFieldResearch',
  lab: 'team.mergeFieldLab',
  amount: 'team.mergeFieldAmount',
  start: 'team.mergeFieldStart',
  end: 'team.mergeFieldEnd',
  completed: 'team.mergeFieldCompleted',
  materials: 'team.mergeSectionMaterials',
  communications: 'team.mergeSectionCommunications',
  scholarships: 'team.mergeSectionScholarships',
  tasks: 'team.mergeSectionTasks',
  timeline: 'team.mergeSectionTimeline',
  versions: 'team.mergeSectionVersions',
  shares: 'team.mergeSectionSharing',
  reviewComments: 'team.mergeSectionFeedback',
  fees: 'team.mergeSectionFees',
}

const AUDIT_SCOPE_KEYS: Record<string, string> = {
  Authentication: 'team.auditScopeAuthentication',
  'Account recovery': 'team.auditScopeAccountRecovery',
  Application: 'team.auditScopeApplication',
  'Application share': 'team.auditScopeApplicationShare',
  Material: 'team.auditScopeMaterial',
  Settings: 'team.auditScopeSettings',
  Backup: 'team.auditScopeBackup',
  'System bootstrap': 'team.auditScopeSystemBootstrap',
  Impersonation: 'team.auditScopeImpersonation',
  'Team merge': 'team.auditScopeTeamMerge',
  'Team merge conflict': 'team.auditScopeTeamMergeConflict',
  'Team transfer request': 'team.auditScopeTeamTransferRequest',
  'Team transfer': 'team.auditScopeTeamTransfer',
}

const AUDIT_SECTION_KEYS: Record<string, string> = {
  overview: 'team.auditSectionOverview',
  dossier: 'team.auditSectionDossier',
  materials: 'team.mergeSectionMaterials',
  communications: 'team.mergeSectionCommunications',
  tasks: 'team.mergeSectionTasks',
  shares: 'team.mergeSectionSharing',
}

const AUDIT_MESSAGE_DIRECT_KEYS: Record<string, string> = {
  'User signed in': 'team.eventUserSignedIn',
  'Updated personal settings': 'team.eventUpdatedPersonalSettings',
}

type AuditMessagePattern = {
  regex: RegExp
  localize: (match: RegExpMatchArray, tx: TeamTx) => string
}

const AUDIT_MESSAGE_PATTERNS: AuditMessagePattern[] = [
  { regex: /^Created application for (.+)$/, localize: (match, tx) => tx('team.eventCreatedApplication', 'Created application: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Updated application for (.+)$/, localize: (match, tx) => tx('team.eventUpdatedApplication', 'Updated application: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Deleted application for (.+)$/, localize: (match, tx) => tx('team.eventDeletedApplication', 'Deleted application: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Restored application for (.+)$/, localize: (match, tx) => tx('team.eventRestoredApplication', 'Restored application for {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Shared application with team for (.+)$/, localize: (match, tx) => tx('team.eventSharedApplicationWithTeam', 'Shared application with team: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Removed team visibility for (.+)$/, localize: (match, tx) => tx('team.eventRemovedTeamVisibility', 'Removed from team workspace: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Updated share link expiration for (.+)$/, localize: (match, tx) => tx('team.eventUpdatedShare', 'Updated share link: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Revoked share link for (.+)$/, localize: (match, tx) => tx('team.eventRevokedShare', 'Revoked share link: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Merged (\d+) fields into (.+)$/, localize: (match, tx) => tx('team.eventMergedFields', 'Merged {count} fields into {name}').replace('{count}', match[1] ?? '0').replace('{name}', match[2] ?? '') },
  { regex: /^Auto-merged (\d+) fields into (.+)$/, localize: (match, tx) => tx('team.eventAutoMergedFields', 'Auto-merged {count} fields into {name}').replace('{count}', match[1] ?? '0').replace('{name}', match[2] ?? '') },
  { regex: /^Flagged manual merge handling for (.+)$/, localize: (match, tx) => tx('team.eventFlaggedMergeConflict', 'Marked manual merge for {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Requested team import for (.+)$/, localize: (match, tx) => tx('team.eventRequestedTeamImport', 'Requested team import: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Requested team removal for (.+)$/, localize: (match, tx) => tx('team.eventRequestedTeamRemoval', 'Requested team removal: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Approved team import for (.+)$/, localize: (match, tx) => tx('team.eventApprovedTeamImport', 'Approved team import: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Approved team removal for (.+)$/, localize: (match, tx) => tx('team.eventApprovedTeamRemoval', 'Approved team removal: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Rejected team import for (.+)$/, localize: (match, tx) => tx('team.eventRejectedTeamImport', 'Rejected team import: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Rejected team removal for (.+)$/, localize: (match, tx) => tx('team.eventRejectedTeamRemoval', 'Rejected team removal: {name}').replace('{name}', match[1] ?? '') },
  { regex: /^Shared editor updated (.+)$/, localize: (match, tx) => tx('team.eventSharedEditorUpdated', 'Shared editor updated {section}').replace('{section}', localizeAuditSection(match[1] ?? '', tx)) },
  { regex: /^Entered temporary view as (.+)$/, localize: (match, tx) => tx('team.eventEnteredTemporaryView', 'Entered temporary view as {target}').replace('{target}', match[1] ?? '') },
]

type EventMetadata = {
  teamId?: string
  applicationId?: string
  changedFields?: unknown
  beforeApplication?: unknown
  afterApplication?: unknown
  restoredFromEventId?: string
  mergedFromEventId?: string
  flaggedConflictForEventId?: string
  conflictCount?: number
  impersonation?: {
    actorId?: string
    actorName?: string
    actorEmail?: string
    targetUserId?: string
    targetName?: string
    targetEmail?: string
  }
}

export function eventMetadata(event: SystemEvent): EventMetadata {
  return (event.metadata ?? {}) as EventMetadata
}

export function changedFields(event: SystemEvent) {
  const fields = eventMetadata(event).changedFields
  return Array.isArray(fields) ? fields.map(String).filter(Boolean) : []
}

export function canRestoreEvent(event: SystemEvent, viewerRole: TeamRole | null) {
  const metadata = eventMetadata(event)
  return Boolean(viewerRole && metadata.teamId && metadata.applicationId && metadata.beforeApplication)
}

export function canMergeEvent(event: SystemEvent, viewerRole: TeamRole | null) {
  const metadata = eventMetadata(event)
  return Boolean(viewerRole && metadata.teamId && metadata.applicationId && metadata.beforeApplication && metadata.afterApplication)
}

export function isManualMergeEvent(event: SystemEvent) {
  const metadata = eventMetadata(event)
  return event.scope === 'Team merge conflict'
    || Boolean(metadata.flaggedConflictForEventId)
    || (typeof metadata.conflictCount === 'number' && metadata.conflictCount > 0)
}

export function isAutomaticMergeAuditEvent(event: SystemEvent) {
  const metadata = eventMetadata(event)
  return Boolean(metadata.applicationId && changedFields(event).length > 0 && !isManualMergeEvent(event))
}

function snapshotOwnerId(snapshot: unknown) {
  return snapshot && typeof snapshot === 'object' && 'ownerId' in snapshot && typeof snapshot.ownerId === 'string'
    ? snapshot.ownerId
    : null
}

export function eventApplicationOwnerId(event: SystemEvent) {
  const metadata = eventMetadata(event)
  return snapshotOwnerId(metadata.afterApplication) ?? snapshotOwnerId(metadata.beforeApplication)
}

function titleCaseSegment(segment: string) {
  return segment
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function mergeFieldParts(field: string) {
  return field.split('.').filter(Boolean)
}

export function mergeFieldRoot(field: string) {
  return mergeFieldParts(field)[0] ?? field
}

export function mergeFieldSectionLabel(field: string, tx: TeamTx) {
  const root = mergeFieldRoot(field)
  return tx(MERGE_SECTION_LABEL_KEYS[root] ?? 'team.mergeSectionApplication')
}

function mergeFieldLeafLabel(field: string, tx: TeamTx) {
  const directLabelKey = MERGE_DIRECT_FIELD_LABEL_KEYS[field]
  if (directLabelKey) return tx(directLabelKey)

  const parts = mergeFieldParts(field).filter((part) => !/^\d+$/.test(part))
  const leaf = parts.at(-1) ?? field
  const leafLabelKey = MERGE_LEAF_LABEL_KEYS[leaf]
  return leafLabelKey ? tx(leafLabelKey) : titleCaseSegment(leaf)
}

function mergeFieldItemLabel(field: string, tx: TeamTx, format: TeamFormat) {
  const itemIndex = mergeFieldParts(field).find((part) => /^\d+$/.test(part))
  return itemIndex === undefined
    ? ''
    : format(tx('team.mergeItemIndex'), { index: Number(itemIndex) + 1 })
}

export function mergeFieldLabel(field: string, tx: TeamTx, format: TeamFormat) {
  const itemLabel = mergeFieldItemLabel(field, tx, format)
  const leafLabel = mergeFieldLeafLabel(field, tx)
  return itemLabel
    ? format(tx('team.mergeFieldNestedIndexed'), { item: itemLabel, field: leafLabel })
    : leafLabel
}

function joinHumanList(items: string[], lang: string) {
  if (items.length <= 1) return items[0] ?? ''
  if (lang.startsWith('zh')) return items.join('、')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

export function auditFieldSummary(fields: string[], tx: TeamTx, format: TeamFormat, lang: string) {
  const uniqueLabels = Array.from(new Set(fields.map((field) => mergeFieldLabel(field, tx, format)))).slice(0, 3)
  if (uniqueLabels.length === 0) return ''
  const listed = joinHumanList(uniqueLabels, lang)
  return fields.length > uniqueLabels.length
    ? format(tx('team.auditFieldSummaryMore'), { fields: listed, count: fields.length - uniqueLabels.length })
    : format(tx('team.auditFieldSummary'), { fields: listed })
}

export function localizeAuditScope(scope: string, tx: TeamTx) {
  return tx(AUDIT_SCOPE_KEYS[scope] ?? 'team.auditScopeOther', scope)
}

function localizeAuditSection(value: string, tx: TeamTx) {
  const normalized = value.trim()
  return tx(AUDIT_SECTION_KEYS[normalized] ?? 'team.auditSectionNamed', normalized).replace('{section}', normalized)
}

export function localizeAuditMessage(message: string, tx: TeamTx) {
  const directKey = AUDIT_MESSAGE_DIRECT_KEYS[message]
  const direct = directKey ? tx(directKey, '') : ''
  if (direct) return direct

  for (const { regex, localize } of AUDIT_MESSAGE_PATTERNS) {
    const match = message.match(regex)
    if (match) return localize(match, tx)
  }

  return message
}

export function mergeStatusRecommendationKey(status: TeamMergePreview['fields'][number]['status']) {
  if (status === 'clean') return 'team.mergeRecommendationClean'
  if (status === 'conflict') return 'team.mergeRecommendationConflict'
  return 'team.mergeRecommendationSame'
}

export function mergeStatusRank(status: TeamMergePreview['fields'][number]['status']) {
  if (status === 'conflict') return 0
  if (status === 'clean') return 1
  return 2
}

function valuesEqualForMerge(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function jsonishStringValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function mergeChangeKindKey(field: TeamMergePreview['fields'][number]) {
  if (field.status === 'same') return 'team.mergeChangeAlreadyApplied'
  if (emptyMergeValue(field.baseValue) && !emptyMergeValue(field.eventValue)) return 'team.mergeChangeAdded'
  if (!emptyMergeValue(field.baseValue) && emptyMergeValue(field.eventValue)) return 'team.mergeChangeRemoved'
  return 'team.mergeChangeEdited'
}

export function mergeImpactText(field: TeamMergePreview['fields'][number], label: string, tx: TeamTx, format: TeamFormat) {
  if (field.status === 'same') {
    return format(tx('team.mergeImpactSame'), { field: label })
  }
  if (field.status === 'conflict') {
    return format(tx('team.mergeImpactConflict'), { field: label })
  }
  if (emptyMergeValue(field.baseValue) && !emptyMergeValue(field.eventValue)) {
    return format(tx('team.mergeImpactAdd'), { field: label, value: formatMergeValue(field.eventValue, tx, format) })
  }
  if (!emptyMergeValue(field.baseValue) && emptyMergeValue(field.eventValue)) {
    return format(tx('team.mergeImpactRemove'), { field: label })
  }
  return format(tx('team.mergeImpactEdit'), { field: label, value: formatMergeValue(field.eventValue, tx, format) })
}

export function mergeConflictDeltaKey(field: TeamMergePreview['fields'][number]) {
  if (valuesEqualForMerge(field.eventValue, field.currentValue)) return 'team.mergeConflictAlreadyMatched'
  if (valuesEqualForMerge(field.baseValue, field.currentValue)) return 'team.mergeConflictCurrentUnchanged'
  return 'team.mergeConflictBothChanged'
}

function emptyMergeValue(value: unknown) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}

function objectValueLabel(value: Record<string, unknown>) {
  const school = value.school
  if (school && typeof school === 'object' && 'name' in school && typeof school.name === 'string') return school.name
  for (const key of ['name', 'title', 'english', 'email', 'body', 'content']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

export function formatMergeValue(value: unknown, tx: TeamTx, format: TeamFormat) {
  if (emptyMergeValue(value)) return tx('team.mergeValueEmpty')
  if (typeof value === 'string') {
    const parsed = jsonishStringValue(value)
    if (parsed !== null) return formatMergeValue(parsed, tx, format)
    return value.length > 160 ? `${value.slice(0, 157)}...` : value
  }
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? tx('team.mergeValueYes') : tx('team.mergeValueNo')
  if (Array.isArray(value)) {
    const labels = value
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (typeof item === 'number' || typeof item === 'boolean') return String(item)
        if (item && typeof item === 'object') return objectValueLabel(item as Record<string, unknown>)
        return ''
      })
      .filter(Boolean)
    if (labels.length > 0) {
      const visible = labels.slice(0, 3)
      return value.length > visible.length
        ? format(tx('team.mergeValueListWithMore'), { items: visible.join(', '), count: value.length - visible.length })
        : visible.join(', ')
    }
    return format(tx('team.mergeValueListCount'), { count: value.length })
  }
  if (typeof value === 'object') {
    const label = objectValueLabel(value as Record<string, unknown>)
    if (label) return label.length > 160 ? `${label.slice(0, 157)}...` : label
    const filled = Object.values(value as Record<string, unknown>).filter((item) => !emptyMergeValue(item)).length
    return format(tx('team.mergeValueObjectFilled'), { count: filled })
  }
  return String(value)
}
