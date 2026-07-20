import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from './api/phdApi'
import type { ApplicationRecord } from './data/applications'
import {
  canQueueApplicationUpdate,
  enqueueApplicationUpdate,
  isNetworkLikeError,
  loadOfflineSnapshot,
  mergeOfflineApplicationUpdate,
  readOfflineQueue,
  saveOfflineSnapshot,
} from './offline'

const session = {
  token: 'token',
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

    expect(loadOfflineSnapshot(session)?.data.applications).toHaveLength(1)
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
    enqueueApplicationUpdate(session.user.id, application, application.updatedAt ?? null)

    const snapshot = JSON.parse(offlineStorageValue('phd-atlas-offline-snapshot:v2:').value)
    const queue = JSON.parse(offlineStorageValue('phd-atlas-offline-queue:v2:').value)

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

    const stored = offlineStorageValue('phd-atlas-offline-snapshot:v2:')
    const parsed = JSON.parse(stored.value)
    parsed.data.applications[0].progress = 99
    localStorage.setItem(stored.key, JSON.stringify(parsed))

    expect(loadOfflineSnapshot(session)).toBeNull()
    expect(localStorage.getItem(stored.key)).toBeNull()
  })

  it('deduplicates offline application saves while preserving the first base timestamp', () => {
    const baseUpdatedAt = '2026-07-08T00:00:00.000Z'
    enqueueApplicationUpdate(session.user.id, application, baseUpdatedAt)
    enqueueApplicationUpdate(
      session.user.id,
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
      session.user.id,
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
      session.user.id,
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
    enqueueApplicationUpdate(session.user.id, application, application.updatedAt ?? null)

    const stored = offlineStorageValue('phd-atlas-offline-queue:v2:')
    const parsed = JSON.parse(stored.value)
    parsed.items[0].application.progress = 88
    localStorage.setItem(stored.key, JSON.stringify(parsed))

    expect(readOfflineQueue(session.user.id)).toEqual([])
    expect(localStorage.getItem(stored.key)).toBeNull()
  })

  it('filters malformed or cross-owner queue items even with a valid queue envelope', () => {
    enqueueApplicationUpdate(
      session.user.id,
      { ...application, ownerId: 'other-user' },
      application.updatedAt ?? null,
    )
    const stored = offlineStorageValue('phd-atlas-offline-queue:v2:')

    expect(readOfflineQueue(session.user.id)).toEqual([])
    expect(localStorage.getItem(stored.key)).toBeNull()
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
      { ...application, updatedAt: undefined },
      { isTeamMode: false },
    )).toBe(false)
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
