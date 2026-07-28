import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from './api/phdApi'
import type { ApplicationRecord } from './data/applications'
import {
  canQueueApplicationUpdate,
  enqueueApplicationUpdate,
  isNetworkLikeError,
  loadOfflineSnapshot,
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

  it('automatically merges offline and server edits made to different application fields', () => {
    const local = { ...application, progress: 35 }
    enqueueApplicationUpdate(
      session,
      local,
      application.updatedAt ?? null,
      application,
    )
    const operation = readOfflineQueue(session.user.id)[0]
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
  })

  it('keeps overlapping offline/server edits blocked instead of overwriting either copy', () => {
    enqueueApplicationUpdate(
      session,
      { ...application, progress: 35 },
      application.updatedAt ?? null,
      application,
    )
    const operation = readOfflineQueue(session.user.id)[0]
    const server = {
      ...application,
      progress: 60,
      updatedAt: '2026-07-09T00:00:00.000Z',
    }

    expect(mergeOfflineApplicationUpdate(operation, server)).toBeNull()
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
    const local = {
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
