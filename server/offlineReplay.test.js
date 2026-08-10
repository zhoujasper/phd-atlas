import { describe, expect, it } from 'vitest'
import {
  OfflineReplayMetadataSchema,
  hasOfflineReplayConflict,
  parseOrThrow,
} from './validation.js'
import {
  applyOfflineReplayAuthorityBoundary,
  offlineReplayScopeAllowed,
} from './offlineReplay.js'

describe('offline replay validation', () => {
  it('accepts a matching trusted baseline and rejects a stale one', () => {
    const currentUpdatedAt = '2026-07-13T10:30:00.000Z'

    expect(hasOfflineReplayConflict(currentUpdatedAt, currentUpdatedAt)).toBe(false)
    expect(hasOfflineReplayConflict(currentUpdatedAt, '2026-07-12T08:00:00.000Z')).toBe(true)
  })

  it('validates replay metadata without trusting unrelated request fields', () => {
    expect(parseOrThrow(OfflineReplayMetadataSchema, {
      clientBaseUpdatedAt: '2026-07-13T10:30:00.000Z',
      progress: 90,
    })).toEqual({ clientBaseUpdatedAt: '2026-07-13T10:30:00.000Z' })

    expect(() => parseOrThrow(OfflineReplayMetadataSchema, {
      clientBaseUpdatedAt: '',
    })).toThrow()
  })

  it('allows replay only for the signed-in owner of a personal application', () => {
    const personal = {
      id: 'app-personal',
      ownerId: 'user-1',
      teamId: null,
      teamTransferRequest: null,
    }

    expect(offlineReplayScopeAllowed({
      application: personal,
      requestUserId: 'user-1',
      requestUserRole: 'user',
      requestScope: 'app',
      impersonation: null,
    })).toBe(true)
    expect(offlineReplayScopeAllowed({
      application: { ...personal, teamId: 'team-1' },
      requestUserId: 'user-1',
      requestUserRole: 'user',
      requestScope: 'app',
      impersonation: null,
    })).toBe(false)
    expect(offlineReplayScopeAllowed({
      application: personal,
      requestUserId: 'teacher-1',
      requestUserRole: 'user',
      requestScope: 'app',
      impersonation: null,
    })).toBe(false)
    expect(offlineReplayScopeAllowed({
      application: personal,
      requestUserId: 'user-1',
      requestUserRole: 'user',
      requestScope: 'app',
      impersonation: { actorId: 'admin-1' },
    })).toBe(false)
    expect(offlineReplayScopeAllowed({
      application: personal,
      requestUserId: 'user-1',
      requestUserRole: 'admin',
      requestScope: 'app',
      impersonation: null,
    })).toBe(false)
    expect(offlineReplayScopeAllowed({
      application: personal,
      requestUserId: 'user-1',
      requestUserRole: 'user',
      requestScope: 'admin',
      impersonation: null,
    })).toBe(false)
  })

  it('keeps permissions, share capabilities and vault handles server-authoritative', () => {
    const current = {
      id: 'app-1',
      ownerId: 'user-1',
      teamId: null,
      teamTransferRequest: null,
      shares: [{ id: 'share-1', token: 'server-token' }],
      reviewComments: [{ id: 'comment-1' }],
      backupSettings: { autoBackup: true },
      versions: [{ id: 'version-1', fileId: 'server-version-file' }],
      createdAt: '2026-07-01T00:00:00.000Z',
      materials: [{
        id: 'material-1',
        name: 'CV',
        fileId: 'server-material-file',
        storageName: 'encrypted-material',
        versions: [{ id: 'material-version-1', fileId: 'server-material-version-file' }],
      }],
      tasks: [{
        id: 'task-1',
        title: 'Upload transcript',
        fileId: 'server-task-file',
        versions: [],
      }],
      communications: [{
        id: 'message-1',
        subject: 'Current subject',
        bodyFormat: 'markdown',
        bodyHtml: '<p><strong>Current</strong> body</p>',
        bodyText: 'Current body',
        attachments: [{ id: 'attachment-1', fileId: 'server-attachment-file' }],
        deliveryStatus: 'queued',
        scheduledAt: '2026-07-29T12:00:00.000Z',
        deliveryId: 'delivery-server-owned',
        sourceMessageKey: 'server-message-key',
        importedAt: '2026-07-29T11:00:00.000Z',
        mailSecurity: { level: 'caution', signals: ['reply-to-mismatch'] },
        mailClassification: { category: 'interview_invite' },
      }],
    }
    const incoming = {
      ...current,
      ownerId: 'attacker',
      teamId: 'team-forged',
      shares: [{ id: 'share-forged', token: 'forged-token' }],
      backupSettings: { autoBackup: false },
      tasks: [{
        ...current.tasks[0],
        title: 'Updated transcript',
        fileId: 'forged-task-file',
      }],
      communications: [{
        ...current.communications[0],
        subject: 'Updated subject',
        bodyFormat: 'html',
        bodyHtml: '<script>forged</script>',
        bodyText: 'Forged body',
        attachments: [{ id: 'forged-attachment' }],
        deliveryStatus: 'sent',
        scheduledAt: '2026-07-30T12:00:00.000Z',
        deliveryId: 'forged-delivery',
        sourceMessageKey: 'forged-message-key',
        importedAt: '2026-07-30T11:00:00.000Z',
        mailSecurity: { level: 'danger', signals: ['prompt-injection'] },
        mailClassification: { category: 'rejection' },
      }],
      materials: [
        {
          ...current.materials[0],
          name: 'Updated CV',
          fileId: 'forged-material-file',
        },
        {
          id: 'material-new',
          name: 'New offline note',
          fileId: 'forged-new-file',
          storageName: 'forged-new-storage',
          versions: [{ id: 'forged-version', fileId: 'forged-version-file' }],
        },
      ],
    }

    const bounded = applyOfflineReplayAuthorityBoundary(current, incoming)

    expect(bounded.ownerId).toBe('user-1')
    expect(bounded.teamId).toBeNull()
    expect(bounded.shares).toEqual(current.shares)
    expect(bounded.backupSettings).toEqual(current.backupSettings)
    expect(bounded.versions).toEqual(current.versions)
    expect(bounded.materials[0]).toMatchObject({
      name: 'Updated CV',
      fileId: 'server-material-file',
      storageName: 'encrypted-material',
    })
    expect(bounded.materials[1]).toEqual({
      id: 'material-new',
      name: 'New offline note',
    })
    expect(bounded.tasks[0]).toMatchObject({
      title: 'Updated transcript',
      fileId: 'server-task-file',
    })
    expect(bounded.communications[0]).toMatchObject({
      subject: 'Updated subject',
      bodyFormat: 'markdown',
      bodyHtml: '<p><strong>Current</strong> body</p>',
      bodyText: 'Current body',
      attachments: current.communications[0].attachments,
      deliveryStatus: 'queued',
      scheduledAt: '2026-07-29T12:00:00.000Z',
      deliveryId: 'delivery-server-owned',
      sourceMessageKey: 'server-message-key',
      importedAt: '2026-07-29T11:00:00.000Z',
      mailSecurity: { level: 'caution', signals: ['reply-to-mismatch'] },
      mailClassification: { category: 'interview_invite' },
    })
  })
})
