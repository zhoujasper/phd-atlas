import { describe, expect, it } from 'vitest'
import type { SystemEvent } from '../../api/phdApi'
import { eventMetadata, localizeAuditMessage } from './teamAuditMergeModel'

const translations: Record<string, string> = {
  'team.eventAutoMergedFields': 'Auto-merged {count} fields into {name}',
  'team.eventUserSignedIn': 'Signed in',
}

const tx = (key: string, fallback = '') => translations[key] ?? (fallback || key)
const fallbackTx = (_key: string, fallback = '') => fallback

describe('team audit event model', () => {
  it('normalizes automatic coordination messages without restoring manual controls', () => {
    expect(localizeAuditMessage('Automatically coordinated 2 fields in Example University', tx)).toBe(
      'Auto-merged 2 fields into Example University',
    )
    expect(localizeAuditMessage('User signed in', tx)).toBe('Signed in')
    expect(localizeAuditMessage('Approved team removal for Example University', fallbackTx)).toBe(
      'Approved team removal: Example University',
    )
    expect(localizeAuditMessage('Shared editor updated materials', fallbackTx)).toBe(
      'Shared editor updated materials',
    )
  })

  it('exposes only the metadata required by read-only activity rendering', () => {
    const event: SystemEvent = {
      id: 'event-1',
      time: '2026-07-22T10:00:00.000Z',
      scope: 'Application',
      actorId: 'teacher-1',
      message: 'Updated application for Example University',
      metadata: {
        applicationId: 'application-1',
        impersonation: {
          actorId: 'teacher-1',
          targetUserId: 'student-1',
        },
      },
    }

    expect(eventMetadata(event)).toMatchObject({
      applicationId: 'application-1',
      impersonation: {
        actorId: 'teacher-1',
        targetUserId: 'student-1',
      },
    })
  })
})
