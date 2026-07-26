import { describe, expect, it } from 'vitest'
import type { SystemEvent, TeamMergePreview } from '../../api/phdApi'
import {
  auditFieldSummary,
  canMergeEvent,
  canRestoreEvent,
  changedFields,
  eventApplicationOwnerId,
  formatMergeValue,
  isAutomaticMergeAuditEvent,
  isManualMergeEvent,
  localizeAuditMessage,
  localizeAuditScope,
  mergeChangeKindKey,
  mergeConflictDeltaKey,
  mergeFieldLabel,
  mergeImpactText,
  mergeStatusRank,
} from './teamAuditMergeModel'

const translations: Record<string, string> = {
  'team.mergeFieldSchoolName': 'School name',
  'team.mergeFieldName': 'Name',
  'team.mergeItemIndex': 'Item {index}',
  'team.mergeFieldNestedIndexed': '{item}: {field}',
  'team.auditFieldSummary': 'Changed {fields}',
  'team.auditFieldSummaryMore': 'Changed {fields} and {count} more',
  'team.eventMergedFields': 'Merged {count} fields into {name}',
  'team.eventUserSignedIn': 'Signed in',
  'team.auditScopeTeamMerge': 'Team merge',
  'team.mergeImpactAdd': 'Added {field}: {value}',
  'team.mergeImpactEdit': 'Edited {field}: {value}',
  'team.mergeImpactRemove': 'Removed {field}',
  'team.mergeImpactSame': '{field} is already applied',
  'team.mergeImpactConflict': '{field} needs review',
  'team.mergeValueEmpty': 'Empty',
  'team.mergeValueYes': 'Yes',
  'team.mergeValueNo': 'No',
  'team.mergeValueListWithMore': '{items} and {count} more',
  'team.mergeValueListCount': '{count} items',
  'team.mergeValueObjectFilled': '{count} fields',
}

const tx = (key: string, fallback = '') => translations[key] ?? (fallback || key)
const format = (template: string, values: Record<string, string | number>) => (
  Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template)
)
const fallbackTx = (_key: string, fallback = '') => fallback

const applicationEvent = (metadata: Record<string, unknown> = {}): SystemEvent => ({
  id: 'event-1',
  time: '2026-07-22T10:00:00.000Z',
  scope: 'Application',
  actorId: 'member-1',
  message: 'Merged 2 fields into Example University',
  metadata: {
    teamId: 'team-1',
    applicationId: 'application-1',
    beforeApplication: { ownerId: 'owner-before' },
    afterApplication: { ownerId: 'owner-after' },
    changedFields: ['school.name', 'materials.0.name'],
    ...metadata,
  },
})

describe('team audit and merge model', () => {
  it('keeps audit-event permissions, changed fields, and ownership rules intact', () => {
    const event = applicationEvent()

    expect(changedFields(event)).toEqual(['school.name', 'materials.0.name'])
    expect(canRestoreEvent(event, 'member')).toBe(true)
    expect(canMergeEvent(event, 'member')).toBe(true)
    expect(eventApplicationOwnerId(event)).toBe('owner-after')
    expect(isAutomaticMergeAuditEvent(event)).toBe(true)

    const conflict = applicationEvent({ flaggedConflictForEventId: 'event-source' })
    expect(isManualMergeEvent(conflict)).toBe(true)
    expect(isAutomaticMergeAuditEvent(conflict)).toBe(false)
  })

  it('preserves localized audit labels and indexed merge field summaries', () => {
    expect(mergeFieldLabel('materials.0.name', tx, format)).toBe('Item 1: Name')
    expect(auditFieldSummary(['school.name', 'school.name', 'materials.0.name'], tx, format, 'en')).toBe(
      'Changed School name and Item 1: Name and 1 more',
    )
    expect(localizeAuditMessage('Merged 2 fields into Example University', tx)).toBe(
      'Merged 2 fields into Example University',
    )
    expect(localizeAuditMessage('User signed in', tx)).toBe('Signed in')
    expect(localizeAuditScope('Team merge', tx)).toBe('Team merge')
    expect(localizeAuditMessage('Approved team removal for Example University', fallbackTx)).toBe(
      'Approved team removal: Example University',
    )
    expect(localizeAuditMessage('Shared editor updated materials', fallbackTx)).toBe(
      'Shared editor updated materials',
    )
  })

  it('keeps merge status, impact, conflict, and value formatting deterministic', () => {
    const added: TeamMergePreview['fields'][number] = {
      field: 'school.name',
      status: 'clean',
      baseValue: '',
      eventValue: 'Example University',
      currentValue: '',
    }
    const conflict: TeamMergePreview['fields'][number] = {
      ...added,
      status: 'conflict',
      baseValue: 'Original',
      eventValue: 'Incoming',
      currentValue: 'Incoming',
    }

    expect(mergeStatusRank('conflict')).toBeLessThan(mergeStatusRank('clean'))
    expect(mergeChangeKindKey(added)).toBe('team.mergeChangeAdded')
    expect(mergeImpactText(added, 'School name', tx, format)).toBe('Added School name: Example University')
    expect(mergeConflictDeltaKey(conflict)).toBe('team.mergeConflictAlreadyMatched')
    expect(formatMergeValue([{ name: 'One' }, { name: 'Two' }, { name: 'Three' }, { name: 'Four' }], tx, format)).toBe(
      'One, Two, Three and 1 more',
    )
  })
})
