import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AuthSession } from './api/phdApi'
import type { ApplicationRecord } from './data/applications'
import {
  canQueueApplicationUpdate,
  enqueueApplicationUpdate,
  isNetworkLikeError,
  isRebaseableApplicationConflict,
  isRecoverableRecommenderVersionError,
  loadOfflineSnapshot,
  markOfflineQueueItemBlocked,
  mergeOfflineApplicationUpdate,
  offlineAccessForSession,
  readOfflineQueue,
  saveOfflineSnapshot,
} from './offline'

function jwtFor(claims: Record<string, unknown>) {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature`
}

const sessionIssuedAt = Math.floor(Date.now() / 1000)
const session = {
  token: jwtFor({
    sub: 'user-1',
    scope: 'app',
    iat: sessionIssuedAt,
    exp: sessionIssuedAt + 12 * 60 * 60,
  }),
  user: {
    id: 'user-1',
    name: 'Jasper',
    email: 'jasper@example.com',
    role: 'user',
    createdAt: '2026-07-08T00:00:00.000Z',
    lastLoginAt: null,
    settings: {
      language: 'en',
      highContrast: false,
      themeAccent: 'blue',
    },
  },
  settings: {
    allowRegistration: true,
    notificationMailbox: '',
    backupFrequency: 'weekly',
    encryptionAtRest: false,
  },
} as AuthSession

const application = {
  id: 'app-1',
  ownerId: 'user-1',
  professor: {
    english: 'Prof. Ada Chen',
    chinese: '',
    email: 'ada@example.edu',
    phone: '',
    social: '',
    homepage: '',
    research: '',
    lab: '',
  },
  school: {
    name: 'Example University',
    country: 'United States',
    website: '',
  },
  program: 'Computer Science PhD',
  deadline: '2026-12-15',
  status: 'Draft',
  progress: 10,
  priority: 50,
  tags: [],
  nextReminder: '',
  result: '',
  materials: [],
  communications: [],
  scholarships: [],
  tasks: [],
  timeline: [],
  versions: [],
  shares: [],
  reviewComments: [],
  backupSettings: {
    autoBackup: false,
    frequency: 'weekly',
    maxBackups: 3,
  },
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
} as ApplicationRecord

describe('offline queue safeguards', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  function offlineStorageValue(prefix: string) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) return { key, value: localStorage.getItem(key) ?? '' }
    }
    throw new Error(`Missing offline storage key ${prefix}`)
  }

  it('stores and restores the last trusted workspace snapshot', () => {
    saveOfflineSnapshot(session, {
      applications: [application],
      profileAssets: [],
      backups: [],
      applicationTrash: [],
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
    })

    const snapshot = loadOfflineSnapshot(session)
    expect(snapshot?.version).toBe(3)
    expect(snapshot?.authorization).toMatchObject({
      scope: 'personal-owner',
      subject: session.user.id,
    })
    expect(snapshot?.data.applications).toHaveLength(1)
    expect(Date.parse(snapshot?.authorization.expiresAt ?? '')).toBeGreaterThan(Date.now())
  })

  it('reduces the cached workspace to owned personal applications without capability fields', () => {
    const applicationWithVaultHandles = {
      ...application,
      materials: [{
        id: 'material-1',
        name: 'Transcript',
        type: 'file',
        status: 'ready',
        version: '1',
        updatedAt: application.updatedAt ?? '',
        fileId: 'private-material-file',
        storageName: 'private-material-storage',
        versions: [{
          id: 'material-version-1',
          file: 'transcript.pdf',
          author: 'Jasper',
          createdAt: application.updatedAt ?? '',
          fileId: 'private-version-file',
          storageName: 'private-version-storage',
        }],
      }],
      communications: [{
        id: 'communication-1',
        subject: 'Application',
        channel: 'Email',
        date: '2026-07-08',
        summary: 'Follow-up',
        deliveryStatus: 'queued',
        scheduledAt: '2026-07-29T12:00:00.000Z',
        deliveryId: 'private-delivery-id',
        deliveryUserId: 'private-delivery-user',
        sourceMessageKey: 'private-message-key',
        sourceMailbox: 'private-mailbox',
        attachments: [{
          id: 'attachment-1',
          fileName: 'letter.pdf',
          fileId: 'private-attachment-file',
          storageName: 'private-attachment-storage',
        }],
      }],
    } as ApplicationRecord
    saveOfflineSnapshot(session, {
      applications: [
        applicationWithVaultHandles,
        { ...application, id: 'team-app', teamId: 'team-1' },
        { ...application, id: 'foreign-app', ownerId: 'other-user' },
      ],
      profileAssets: [{ id: 'profile-asset' }] as never,
      backups: [{ id: 'backup-1' }] as never,
      applicationTrash: [{ id: 'trash-1' }] as never,
      teamWorkspaces: [{ id: 'team-1' }] as never,
      activeTeamId: 'team-1',
      teamSummary: { id: 'team-1' } as never,
      teamApplications: [{ id: 'team-app' }] as never,
    })

    const data = loadOfflineSnapshot(session)?.data
    expect(data?.applications.map((item) => item.id)).toEqual(['app-1'])
    expect(data?.applications[0]).not.toHaveProperty('shares')
    expect(data?.applications[0]).not.toHaveProperty('reviewComments')
    expect(data?.applications[0]).not.toHaveProperty('backupSettings')
    expect(data?.applications[0].materials[0]).not.toHaveProperty('fileId')
    expect(data?.applications[0].materials[0]).not.toHaveProperty('storageName')
    expect(data?.applications[0].materials[0].versions?.[0]).not.toHaveProperty('fileId')
    expect(data?.applications[0].communications[0]).not.toHaveProperty('sourceMessageKey')
    expect(data?.applications[0].communications[0]).not.toHaveProperty('deliveryId')
    expect(data?.applications[0].communications[0]).not.toHaveProperty('scheduledAt')
    expect(data?.applications[0].communications[0].attachments?.[0]).not.toHaveProperty('fileId')
    expect(offlineStorageValue('phd-atlas-offline-snapshot:v3:').value).not.toContain('private-')
    expect(data).toMatchObject({
      profileAssets: [],
      backups: [],
      applicationTrash: [],
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
    })
  })

  it('uses a device-keyed HMAC integrity envelope for snapshots and queues', () => {
    saveOfflineSnapshot(session, {
      applications: [application],
      profileAssets: [],
      backups: [],
      applicationTrash: [],
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
    })
    enqueueApplicationUpdate(session, application, application.updatedAt ?? null)

    const snapshot = JSON.parse(offlineStorageValue('phd-atlas-offline-snapshot:v3:').value)
    const queue = JSON.parse(offlineStorageValue('phd-atlas-offline-queue:v3:').value)

    expect(snapshot.integrity.algorithm).toBe('hmac-sha256-device-v1')
    expect(snapshot.integrity.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(queue.integrity.algorithm).toBe('hmac-sha256-device-v1')
    expect(queue.integrity.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a locally tampered workspace snapshot', () => {
    saveOfflineSnapshot(session, {
      applications: [application],
      profileAssets: [],
      backups: [],
      applicationTrash: [],
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
    })

    const stored = offlineStorageValue('phd-atlas-offline-snapshot:v3:')
    const parsed = JSON.parse(stored.value)
    parsed.data.applications[0].progress = 99
    localStorage.setItem(stored.key, JSON.stringify(parsed))

    expect(loadOfflineSnapshot(session)).toBeNull()
    expect(localStorage.getItem(stored.key)).toBeNull()
  })

  it('deduplicates offline application saves while preserving the first base timestamp', () => {
    const baseUpdatedAt = '2026-07-08T00:00:00.000Z'
    enqueueApplicationUpdate(session, application, baseUpdatedAt)
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      '2026-07-09T00:00:00.000Z',
    )

    const queue = readOfflineQueue(session.user.id)
    expect(queue).toHaveLength(1)
    expect(queue[0].baseUpdatedAt).toBe(baseUpdatedAt)
    expect(queue[0].application.progress).toBe(35)
  })

  it('rejects an offline queue acknowledgement when durable storage throws', () => {
    const originalSetItem = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (String(key).startsWith('phd-atlas-offline-queue:v3:')) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      }
      return originalSetItem.call(localStorage, key, value)
    })

    try {
      expect(() => enqueueApplicationUpdate(
        session,
        { ...application, progress: 42 },
        application.updatedAt ?? null,
      )).toThrow(/durable browser storage/i)
      expect(readOfflineQueue(session.user.id)).toEqual([])
    } finally {
      write.mockRestore()
    }
  })

  it('rejects silent no-op storage writes instead of reporting an offline save', () => {
    const originalSetItem = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (String(key).startsWith('phd-atlas-offline-queue:v3:')) return
      return originalSetItem.call(localStorage, key, value)
    })

    try {
      expect(() => enqueueApplicationUpdate(
        session,
        { ...application, progress: 43 },
        application.updatedAt ?? null,
      )).toThrow(/durable browser storage/i)
      expect(readOfflineQueue(session.user.id)).toEqual([])
    } finally {
      write.mockRestore()
    }
  })

  it('can read the acknowledged queue immediately from storage', () => {
    const queued = enqueueApplicationUpdate(
      session,
      { ...application, progress: 44 },
      application.updatedAt ?? null,
    )

    expect(queued).toHaveLength(1)
    expect(readOfflineQueue(session.user.id)).toEqual(queued)
    expect(readOfflineQueue(session.user.id)[0].application.progress).toBe(44)
  })

  it('does not return snapshot metadata when the snapshot write cannot be read back', () => {
    const originalSetItem = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (String(key).startsWith('phd-atlas-offline-snapshot:v3:')) return
      return originalSetItem.call(localStorage, key, value)
    })

    try {
      expect(saveOfflineSnapshot(session, {
        applications: [application],
        profileAssets: [],
        backups: [],
        applicationTrash: [],
        teamWorkspaces: [],
        activeTeamId: null,
        teamSummary: null,
        teamApplications: [],
      })).toBeNull()
      expect(loadOfflineSnapshot(session)).toBeNull()
    } finally {
      write.mockRestore()
    }
  })

  it('folds a newer local edit into an older blocked entry so it can retry automatically', () => {
    enqueueApplicationUpdate(
      session,
      application,
      application.updatedAt ?? null,
      application,
    )
    const blocked = readOfflineQueue(session.user.id)[0]
    markOfflineQueueItemBlocked(session.user.id, blocked.id, 'conflict')

    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      '2026-07-09T00:00:00.000Z',
      application,
    )

    const queue = readOfflineQueue(session.user.id)
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      id: blocked.id,
      status: 'pending',
      baseUpdatedAt: application.updatedAt,
    })
    expect(queue[0]).not.toHaveProperty('blockedReason')
    expect(queue[0].application.progress).toBe(35)
  })

  it('automatically merges offline and server edits made to different application fields', () => {
    const local = { ...application, progress: 35 }
    enqueueApplicationUpdate(
      session,
      local,
      application.updatedAt ?? null,
      application,
    )
    const operation = {
      ...readOfflineQueue(session.user.id)[0],
      localEditedAt: '2026-07-08T12:00:00.000Z',
    }
    const server = {
      ...application,
      priority: 92,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    const result = mergeOfflineApplicationUpdate(operation, server)

    expect(result?.merged).toBe(true)
    expect(result?.application.progress).toBe(35)
    expect(result?.application.priority).toBe(92)
    expect(result?.application.updatedAt).toBe(server.updatedAt)
    expect(result?.replayRequired).toBe(true)
    expect(result?.conflicts).toEqual([])
  })

  it('keeps a newer offline overlap queued for explicit recovery instead of trusting device clocks', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const operation = {
      ...readOfflineQueue(session.user.id)[0],
      localEditedAt: '2026-07-10T00:00:00.000Z',
    }
    const server = {
      ...application,
      progress: 60,
      priority: 92,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    const result = mergeOfflineApplicationUpdate(operation, server)

    expect(result?.merged).toBe(true)
    expect(result?.application.progress).toBe(60)
    expect(result?.application.priority).toBe(92)
    expect(result?.application.updatedAt).toBe(server.updatedAt)
    expect(result?.replayRequired).toBe(false)
    expect(result?.conflicts).toEqual(['progress'])
  })

  it('auto-resolves an overlap to the newer local edit so a reconnect drains the queue', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const operation = {
      ...readOfflineQueue(session.user.id)[0],
      localEditedAt: '2026-07-10T00:00:00.000Z',
    }
    const server = {
      ...application,
      progress: 60,
      priority: 92,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    const result = mergeOfflineApplicationUpdate(operation, server, { autoResolve: true })

    expect(result?.conflicts).toEqual([])
    expect(result?.autoResolved).toEqual([{ field: 'progress', winner: 'local' }])
    // The local edit is newer, so it wins the overlap and still has to be replayed.
    expect(result?.application.progress).toBe(35)
    expect(result?.application.priority).toBe(92)
    expect(result?.replayRequired).toBe(true)
  })

  it('auto-resolves an overlap to the newer server edit without queueing a pointless replay', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const operation = {
      ...readOfflineQueue(session.user.id)[0],
      localEditedAt: '2026-07-08T12:00:00.000Z',
    }
    const server = {
      ...application,
      progress: 60,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    const result = mergeOfflineApplicationUpdate(operation, server, { autoResolve: true })

    expect(result?.conflicts).toEqual([])
    expect(result?.autoResolved).toEqual([{ field: 'progress', winner: 'server' }])
    expect(result?.application.progress).toBe(60)
    // The server already holds every winning value, so clearing the queue entry
    // is the whole sync; nothing is rewritten to manufacture a newer timestamp.
    expect(result?.replayRequired).toBe(false)
  })

  it('keeps the local value when neither side has a usable authoring timestamp', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const operation = {
      ...readOfflineQueue(session.user.id)[0],
      localEditedAt: 'not-a-date',
      updatedAt: 'not-a-date',
      createdAt: 'not-a-date',
    }
    const server = { ...application, progress: 60, updatedAt: '2026-07-09T00:00:00.000Z' }

    const result = mergeOfflineApplicationUpdate(operation, server, { autoResolve: true })

    expect(result?.autoResolved).toEqual([{ field: 'progress', winner: 'local' }])
    expect(result?.application.progress).toBe(35)
  })

  it('never treats a server-newer overlap as safely synced while the local value is still queued', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const operation = {
      ...readOfflineQueue(session.user.id)[0],
      localEditedAt: '2026-07-08T12:00:00.000Z',
    }
    const server = {
      ...application,
      progress: 60,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    const result = mergeOfflineApplicationUpdate(operation, server)

    expect(result?.merged).toBe(true)
    expect(result?.application.progress).toBe(60)
    expect(result?.application.updatedAt).toBe(server.updatedAt)
    expect(result?.replayRequired).toBe(false)
    expect(result?.conflicts).toEqual(['progress'])
  })

  it('does not mistake an older blocked-status timestamp for a newer local edit', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const queued = readOfflineQueue(session.user.id)[0]
    const legacyBlockedOperation = {
      ...queued,
      status: 'blocked' as const,
      createdAt: '2026-07-08T12:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      localEditedAt: undefined,
    }
    const server = {
      ...application,
      progress: 60,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    const result = mergeOfflineApplicationUpdate(legacyBlockedOperation, server)

    expect(result?.application.progress).toBe(60)
    expect(result?.replayRequired).toBe(false)
    expect(result?.conflicts).toEqual(['progress'])
  })

  it('drops a locally tampered offline queue before replay', () => {
    enqueueApplicationUpdate(session, application, application.updatedAt ?? null)

    const stored = offlineStorageValue('phd-atlas-offline-queue:v3:')
    const parsed = JSON.parse(stored.value)
    parsed.items[0].application.progress = 88
    localStorage.setItem(stored.key, JSON.stringify(parsed))

    expect(readOfflineQueue(session.user.id)).toEqual([])
    expect(localStorage.getItem(stored.key)).toBeNull()
  })

  it('refuses to create a cross-owner queue item', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, ownerId: 'other-user' },
      application.updatedAt ?? null,
    )

    expect(readOfflineQueue(session.user.id)).toEqual([])
    expect(() => offlineStorageValue('phd-atlas-offline-queue:v3:')).toThrow()
  })

  it('allows only personal-scope application updates to queue', () => {
    expect(canQueueApplicationUpdate(session, application, { isTeamMode: false })).toBe(true)
    expect(canQueueApplicationUpdate(session, application, { isTeamMode: true })).toBe(false)
    expect(canQueueApplicationUpdate(
      session,
      { ...application, ownerId: 'other-user' },
      { isTeamMode: false },
    )).toBe(false)
    expect(canQueueApplicationUpdate(
      session,
      { ...application, teamId: 'team-1' },
      { isTeamMode: false },
    )).toBe(false)
    expect(canQueueApplicationUpdate(
      session,
      { ...application, updatedAt: undefined },
      { isTeamMode: false },
    )).toBe(false)
  })

  it('denies offline leases to administrators, impersonated sessions, and expired tokens', () => {
    expect(offlineAccessForSession({
      ...session,
      user: { ...session.user, role: 'admin' },
    }).reason).toBe('administrator')
    expect(offlineAccessForSession({
      ...session,
      impersonation: {
        actorId: 'admin-1',
        actorName: 'Admin',
        actorEmail: 'admin@example.com',
        targetUserId: session.user.id,
        targetName: session.user.name,
        targetEmail: session.user.email,
        startedAt: new Date().toISOString(),
        returnTo: 'admin',
      },
    }).reason).toBe('impersonation')
    expect(offlineAccessForSession({
      ...session,
      token: jwtFor({
        sub: session.user.id,
        scope: 'app',
        iat: Math.floor(Date.now() / 1000) - 120,
        exp: Math.floor(Date.now() / 1000) - 60,
      }),
    }).reason).toBe('expired')
    expect(offlineAccessForSession({
      ...session,
      token: 'opaque-or-malformed-token',
    }).reason).toBe('identity')
  })

  it('binds the offline lease to token issue time instead of rolling it on each save', () => {
    const issuedAt = Date.parse('2026-07-20T10:00:00.000Z')
    const longSession = {
      ...session,
      token: jwtFor({
        sub: session.user.id,
        scope: 'app',
        iat: issuedAt / 1000,
        exp: issuedAt / 1000 + 30 * 24 * 60 * 60,
      }),
    }

    const first = offlineAccessForSession(longSession, issuedAt + 60 * 60 * 1000)
    const later = offlineAccessForSession(longSession, issuedAt + 48 * 60 * 60 * 1000)

    expect(first.expiresAt).toBe('2026-07-23T10:00:00.000Z')
    expect(later.expiresAt).toBe(first.expiresAt)
  })

  it('restores server-owned sharing, backup, and file authority before replay', () => {
    const local: ApplicationRecord = {
      ...application,
      progress: 35,
      materials: [{
        id: 'material-1',
        name: 'Transcript',
        type: 'file',
        status: 'ready',
        version: '1',
        updatedAt: application.updatedAt ?? '',
        fileId: 'forged-local-file',
        storageName: 'forged-local-storage',
      }],
      communications: [{
        id: 'communication-1',
        subject: 'Local subject edit',
        summary: 'Local summary edit',
        channel: 'Email',
        date: '2026-07-08',
        bodyFormat: 'html',
        bodyHtml: '<script>forged</script>',
        bodyText: 'Forged body',
        attachments: [{ id: 'forged-attachment', fileName: 'forged.txt' }],
        mailSecurity: {
          level: 'danger',
          signals: ['prompt-injection'],
          linksDisabled: true,
          quarantinedAttachmentCount: 1,
        },
        mailClassification: {
          category: 'rejection',
          confidence: 0.99,
          summary: 'Forged classification',
          evidence: [],
          actions: ['none'],
          source: 'ai',
          classifiedAt: '2026-07-08T00:00:00.000Z',
          inputHash: 'forged',
          version: 1,
        },
      }],
    }
    const base = { ...local, progress: application.progress }
    enqueueApplicationUpdate(session, local, application.updatedAt ?? null, base)
    const operation = readOfflineQueue(session.user.id)[0]
    const server = {
      ...local,
      progress: application.progress,
      materials: [{
        ...local.materials[0],
        fileId: 'server-file',
        storageName: 'server-storage',
      }],
      communications: [{
        ...local.communications[0],
        bodyFormat: 'plain',
        bodyHtml: undefined,
        bodyText: 'Server body',
        attachments: [{ id: 'server-attachment', fileName: 'server.txt' }],
        mailSecurity: {
          level: 'caution',
          signals: ['reply-to-mismatch'],
          linksDisabled: true,
          quarantinedAttachmentCount: 0,
        },
        mailClassification: {
          category: 'interview_invite',
          confidence: 0.91,
          summary: 'Interview invitation',
          evidence: ['Interview scheduling request'],
          actions: ['prepare_interview'],
          source: 'ai',
          classifiedAt: '2026-07-08T00:00:00.000Z',
          inputHash: 'server',
          version: 1,
        },
      }],
      updatedAt: application.updatedAt,
    } as ApplicationRecord

    const result = mergeOfflineApplicationUpdate(operation, server)

    expect(result?.application.progress).toBe(35)
    expect(result?.application.materials[0]).toMatchObject({
      fileId: 'server-file',
      storageName: 'server-storage',
    })
    expect(result?.application.shares).toBe(server.shares)
    expect(result?.application.backupSettings).toBe(server.backupSettings)
    expect(result?.application.communications[0]).toMatchObject({
      subject: 'Local subject edit',
      summary: 'Local summary edit',
      bodyFormat: 'plain',
      bodyText: 'Server body',
      attachments: server.communications[0].attachments,
      mailSecurity: { level: 'caution' },
      mailClassification: { category: 'interview_invite', source: 'ai' },
    })
    expect(result?.application.communications[0]).not.toHaveProperty('bodyHtml')
  })

  it('does not load obsolete offline storage versions', () => {
    localStorage.setItem('phd-atlas-offline-snapshot:v2:user-1', JSON.stringify({
      version: 2,
      userId: 'user-1',
      savedAt: new Date().toISOString(),
      data: { applications: [application] },
    }))
    localStorage.setItem('phd-atlas-offline-queue:v2:user-1', JSON.stringify({
      version: 2,
      userId: 'user-1',
      items: [{ application }],
    }))

    expect(loadOfflineSnapshot(session)).toBeNull()
    expect(readOfflineQueue(session.user.id)).toEqual([])
    expect(localStorage.getItem('phd-atlas-offline-snapshot:v3:user-1')).toBeNull()
    expect(localStorage.getItem('phd-atlas-offline-queue:v3:user-1')).toBeNull()
  })

  it('treats request timeouts and gateway outages as offline transport failures', () => {
    const timeout = Object.assign(new Error('Request timed out.'), { code: 'REQUEST_TIMEOUT', status: 408 })
    const unavailable = Object.assign(new Error('Service unavailable.'), { status: 503 })

    expect(isNetworkLikeError(timeout)).toBe(true)
    expect(isNetworkLikeError(unavailable)).toBe(true)
  })

  it('does not treat structured SMTP or IMAP failures as an Atlas server outage', () => {
    const smtpFailure = Object.assign(new Error('SMTP authentication failed.'), {
      code: 'SMTP_AUTH_FAILED',
      status: 502,
    })
    const imapFailure = Object.assign(new Error('IMAP connection failed.'), {
      code: 'MAIL_FETCH_CONNECTION_FAILED',
      status: 502,
    })

    expect(isNetworkLikeError(smtpFailure)).toBe(false)
    expect(isNetworkLikeError(imapFailure)).toBe(false)
  })

  it('does not turn structured conflicts or capacity responses into offline mode', () => {
    for (const [code, status] of [
      ['STORE_WRITE_CONFLICT', 409],
      ['SERVER_BUSY', 503],
      ['AUTH_CAPACITY_EXCEEDED', 429],
      ['AI_CAPACITY_EXCEEDED', 503],
    ] as const) {
      const error = Object.assign(new Error('Structured API response.'), { code, status })
      expect(isNetworkLikeError(error), code).toBe(false)
    }
  })

  it('falls back to a signed main-thread snapshot when the worker reports an error', async () => {
    class FailingSnapshotWorker {
      private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }

      postMessage(message: { id: number; key: string }) {
        queueMicrotask(() => {
          for (const listener of this.listeners.get('message') ?? []) {
            listener({ data: { id: message.id, key: message.key, error: 'worker failed' } } as MessageEvent)
          }
        })
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', FailingSnapshotWorker)
    try {
      saveOfflineSnapshot(session, {
        applications: [application],
        profileAssets: [],
        backups: [],
        applicationTrash: [],
        teamWorkspaces: [],
        activeTeamId: null,
        teamSummary: null,
        teamApplications: [],
      })

      await vi.waitFor(() => expect(loadOfflineSnapshot(session)?.data.applications).toHaveLength(1))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('rebaseable application conflicts', () => {
  it('classifies stale-baseline rejections as recoverable so a save can replay itself', () => {
    const codes = [
      'APPLICATION_MUTATION_BASELINE_MISMATCH',
      'APPLICATION_VERSION_CONFLICT',
      'APPLICATION_VERSION_REQUIRED',
      'APPLICATION_DELTA_CANONICAL_MISMATCH',
      'APPLICATION_DURABILITY_UNVERIFIED',
      'STORE_WRITE_CONFLICT',
    ]
    for (const code of codes) {
      expect(isRebaseableApplicationConflict(new ApiError('conflict', code, 409))).toBe(true)
    }
  })

  it('leaves genuine rejections alone so they still reach the person', () => {
    expect(isRebaseableApplicationConflict(new ApiError('bad url', 'VALIDATION_ERROR', 400))).toBe(false)
    expect(isRebaseableApplicationConflict(new ApiError('nope', 'FORBIDDEN', 403))).toBe(false)
    expect(isRebaseableApplicationConflict(new Error('boom'))).toBe(false)
    expect(isRebaseableApplicationConflict(null)).toBe(false)
  })
})

describe('recoverable recommender version errors', () => {
  it('treats a stale directory version as recoverable, not as the author\u2019s problem', () => {
    for (const code of [
      'PROFILE_RECOMMENDER_VERSION_CONFLICT',
      'PROFILE_RECOMMENDER_VERSION_REQUIRED',
      'TEAM_PROFILE_RECOMMENDER_VERSION_CONFLICT',
      'APPLICATION_VERSION_CONFLICT',
    ]) {
      expect(isRecoverableRecommenderVersionError(new ApiError('stale', code, 409))).toBe(true)
    }
  })

  it('leaves a real refusal to surface', () => {
    expect(isRecoverableRecommenderVersionError(
      new ApiError('choose', 'RECOMMENDER_SYNC_DECISION_REQUIRED', 409),
    )).toBe(false)
    expect(isRecoverableRecommenderVersionError(
      new ApiError('duplicate', 'RECOMMENDER_IDENTITY_AMBIGUOUS', 409),
    )).toBe(false)
    expect(isRecoverableRecommenderVersionError(new Error('boom'))).toBe(false)
  })
})
