import type { SystemEvent } from '../../api/phdApi'

export type TeamTx = (key: string, fallback?: string) => string

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

function withValue(template: string, key: string, value: string) {
  return template.replace(`{${key}}`, value)
}

function withCountAndName(template: string, count: string, name: string) {
  return withValue(withValue(template, 'count', count), 'name', name)
}

function localizeAuditSection(value: string, tx: TeamTx) {
  const normalized = value.trim()
  return tx(AUDIT_SECTION_KEYS[normalized] ?? 'team.auditSectionNamed', normalized)
    .replace('{section}', normalized)
}

const AUDIT_MESSAGE_PATTERNS: AuditMessagePattern[] = [
  { regex: /^Created application for (.+)$/, localize: (match, tx) => withValue(tx('team.eventCreatedApplication', 'Created application: {name}'), 'name', match[1] ?? '') },
  { regex: /^Updated application for (.+)$/, localize: (match, tx) => withValue(tx('team.eventUpdatedApplication', 'Updated application: {name}'), 'name', match[1] ?? '') },
  { regex: /^Deleted application for (.+)$/, localize: (match, tx) => withValue(tx('team.eventDeletedApplication', 'Deleted application: {name}'), 'name', match[1] ?? '') },
  { regex: /^Restored application for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRestoredApplication', 'Restored application for {name}'), 'name', match[1] ?? '') },
  { regex: /^Shared application with team for (.+)$/, localize: (match, tx) => withValue(tx('team.eventSharedApplicationWithTeam', 'Shared application with team: {name}'), 'name', match[1] ?? '') },
  { regex: /^Removed team visibility for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRemovedTeamVisibility', 'Removed from team workspace: {name}'), 'name', match[1] ?? '') },
  { regex: /^Updated share link expiration for (.+)$/, localize: (match, tx) => withValue(tx('team.eventUpdatedShare', 'Updated share link: {name}'), 'name', match[1] ?? '') },
  { regex: /^Revoked share link for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRevokedShare', 'Revoked share link: {name}'), 'name', match[1] ?? '') },
  { regex: /^Merged (\d+) fields into (.+)$/, localize: (match, tx) => withCountAndName(tx('team.eventMergedFields', 'Merged {count} fields into {name}'), match[1] ?? '0', match[2] ?? '') },
  { regex: /^Auto-merged (\d+) fields into (.+)$/, localize: (match, tx) => withCountAndName(tx('team.eventAutoMergedFields', 'Auto-merged {count} fields into {name}'), match[1] ?? '0', match[2] ?? '') },
  { regex: /^Automatically coordinated (\d+) fields in (.+)$/, localize: (match, tx) => withCountAndName(tx('team.eventAutoMergedFields', 'Auto-merged {count} fields into {name}'), match[1] ?? '0', match[2] ?? '') },
  { regex: /^Flagged manual merge handling for (.+)$/, localize: (match, tx) => withValue(tx('team.eventFlaggedMergeConflict', 'Marked manual merge for {name}'), 'name', match[1] ?? '') },
  { regex: /^Requested team import for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRequestedTeamImport', 'Requested team import: {name}'), 'name', match[1] ?? '') },
  { regex: /^Requested team removal for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRequestedTeamRemoval', 'Requested team removal: {name}'), 'name', match[1] ?? '') },
  { regex: /^Approved team import for (.+)$/, localize: (match, tx) => withValue(tx('team.eventApprovedTeamImport', 'Approved team import: {name}'), 'name', match[1] ?? '') },
  { regex: /^Approved team removal for (.+)$/, localize: (match, tx) => withValue(tx('team.eventApprovedTeamRemoval', 'Approved team removal: {name}'), 'name', match[1] ?? '') },
  { regex: /^Rejected team import for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRejectedTeamImport', 'Rejected team import: {name}'), 'name', match[1] ?? '') },
  { regex: /^Rejected team removal for (.+)$/, localize: (match, tx) => withValue(tx('team.eventRejectedTeamRemoval', 'Rejected team removal: {name}'), 'name', match[1] ?? '') },
  { regex: /^Shared editor updated (.+)$/, localize: (match, tx) => withValue(tx('team.eventSharedEditorUpdated', 'Shared editor updated {section}'), 'section', localizeAuditSection(match[1] ?? '', tx)) },
  { regex: /^Entered temporary view as (.+)$/, localize: (match, tx) => withValue(tx('team.eventEnteredTemporaryView', 'Entered temporary view as {target}'), 'target', match[1] ?? '') },
]

type EventMetadata = {
  applicationId?: string
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
