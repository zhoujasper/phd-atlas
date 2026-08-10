import { describe, expect, it } from 'vitest'
import {
  clearRecoverableGuidanceMessageDraft,
  emptyNotificationPublisherDraft,
  guidanceMessageDraftStorageKey,
  loadRecoverableGuidanceMessageDraft,
  loadRecoverableNotificationPublisherDraft,
  loadRecoverableTeamBulkInviteDraft,
  notificationPublisherDraftStorageKey,
  saveRecoverableGuidanceMessageDraft,
  saveRecoverableNotificationPublisherDraft,
  saveRecoverableTeamBulkInviteDraft,
  teamBulkInviteDraftStorageKey,
} from './residentCommunicationDraftStorage'

function memoryStorage({ ignoreWrites = false }: { ignoreWrites?: boolean } = {}) {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!ignoreWrites) values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('resident communication draft storage', () => {
  it('isolates notification drafts by exact user and workspace scope', () => {
    const storage = memoryStorage()
    const scope = { userId: 'user-a', workspaceId: 'team-a' }
    const draft = {
      ...emptyNotificationPublisherDraft(),
      title: 'Deadline update',
      body: 'Please submit by Friday.',
      channels: ['in_app', 'email'] as Array<'in_app' | 'email'>,
      recipientIds: ['member-2', 'member-1'],
    }

    expect(saveRecoverableNotificationPublisherDraft(scope, draft, storage)).toBe(true)
    expect(loadRecoverableNotificationPublisherDraft(scope, storage)).toEqual(draft)
    expect(loadRecoverableNotificationPublisherDraft({ ...scope, userId: 'user-b' }, storage)).toBeNull()
    expect(loadRecoverableNotificationPublisherDraft({ ...scope, workspaceId: 'team-b' }, storage)).toBeNull()
    expect(notificationPublisherDraftStorageKey(scope)).not.toBe(
      notificationPublisherDraftStorageKey({ ...scope, workspaceId: 'team-b' }),
    )

    expect(saveRecoverableNotificationPublisherDraft(scope, { ...draft, channels: [] }, storage)).toBe(true)
    expect(loadRecoverableNotificationPublisherDraft(scope, storage)?.channels).toEqual([])
  })

  it('recovers guidance only for the same user, workspace, and recipient then clears after ACK', () => {
    const storage = memoryStorage()
    const scope = { userId: 'student', workspaceId: 'team-a', recipientId: 'teacher-a' }
    const draft = { title: 'Interview', body: 'Could we practise tomorrow?' }

    expect(saveRecoverableGuidanceMessageDraft(scope, draft, storage)).toBe(true)
    expect(loadRecoverableGuidanceMessageDraft(scope, storage)).toEqual(draft)
    expect(loadRecoverableGuidanceMessageDraft({ ...scope, recipientId: 'teacher-b' }, storage)).toBeNull()
    expect(guidanceMessageDraftStorageKey(scope)).not.toBe(
      guidanceMessageDraftStorageKey({ ...scope, userId: 'another-student' }),
    )
    expect(clearRecoverableGuidanceMessageDraft(scope, storage)).toBe(true)
    expect(loadRecoverableGuidanceMessageDraft(scope, storage)).toBeNull()
  })

  it('round-trips bounded bulk invite CSV without crossing Team scopes', () => {
    const storage = memoryStorage()
    const scope = { userId: 'owner', workspaceId: 'team-a' }
    const draft = {
      text: 'email,role\nstudent@example.com,member',
      fileName: 'students.csv',
    }

    expect(saveRecoverableTeamBulkInviteDraft(scope, draft, storage)).toBe(true)
    expect(loadRecoverableTeamBulkInviteDraft(scope, storage)).toEqual(draft)
    expect(loadRecoverableTeamBulkInviteDraft({ ...scope, workspaceId: 'team-b' }, storage)).toBeNull()
    expect(teamBulkInviteDraftStorageKey(scope)).not.toBe(
      teamBulkInviteDraftStorageKey({ ...scope, userId: 'other-owner' }),
    )
  })

  it('fails closed when a privacy shim silently ignores a draft write', () => {
    const storage = memoryStorage({ ignoreWrites: true })
    expect(saveRecoverableGuidanceMessageDraft(
      { userId: 'student', workspaceId: 'team', recipientId: 'teacher' },
      { title: 'Title', body: 'Body' },
      storage,
    )).toBe(false)
  })

  it('rejects stale, malformed, and oversized recovery records', () => {
    const storage = memoryStorage()
    const scope = { userId: 'owner', workspaceId: 'team' }
    const key = teamBulkInviteDraftStorageKey(scope)!
    storage.setItem(key, JSON.stringify({
      version: 1,
      text: 'old@example.com,member',
      fileName: '',
      updatedAt: Date.now() - (8 * 24 * 60 * 60 * 1_000),
    }))
    expect(loadRecoverableTeamBulkInviteDraft(scope, storage)).toBeNull()

    storage.setItem(key, '{not-json')
    expect(loadRecoverableTeamBulkInviteDraft(scope, storage)).toBeNull()
    expect(saveRecoverableTeamBulkInviteDraft(scope, {
      text: 'x'.repeat((512 * 1024) + 1),
      fileName: '',
    }, storage)).toBe(false)
  })
})
