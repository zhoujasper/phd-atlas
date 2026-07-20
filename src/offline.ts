import type {
  ApplicationTrashItem,
  AuthSession,
  BackupRecord,
  ProfileAsset,
  TeamApplicationRecord,
  TeamSummary,
  TeamWorkspaceOption,
} from './api/phdApi'
import type { ApplicationRecord } from './data/applications'

export type OfflineSnapshotData = {
  applications: ApplicationRecord[]
  profileAssets: ProfileAsset[]
  backups: BackupRecord[]
  applicationTrash: ApplicationTrashItem[]
  teamWorkspaces: TeamWorkspaceOption[]
  activeTeamId: string | null
  teamSummary: TeamSummary | null
  teamApplications: TeamApplicationRecord[]
}

type OfflineSnapshot = {
  version: 2
  userId: string
  savedAt: string
  data: OfflineSnapshotData
  integrity: OfflineIntegrity
}

type OfflineIntegrity = {
  algorithm: 'hmac-sha256-json-v2' | 'hmac-sha256-device-v1' | 'fnv1a64-device-v1'
  digest: string
}

type OfflineSnapshotPayload = Omit<OfflineSnapshot, 'integrity'>

type OfflineQueueStore = {
  version: 2
  userId: string
  updatedAt: string
  items: OfflineApplicationUpdate[]
  integrity: OfflineIntegrity
}

export type OfflineApplicationUpdate = {
  id: string
  type: 'updateApplication'
  userId: string
  applicationId: string
  baseUpdatedAt: string | null
  baseApplication?: ApplicationRecord
  createdAt: string
  updatedAt: string
  application: ApplicationRecord
  status?: 'pending' | 'blocked'
  blockedReason?: string
}

const SNAPSHOT_PREFIX = 'phd-atlas-offline-snapshot:v2:'
const QUEUE_PREFIX = 'phd-atlas-offline-queue:v2:'
const DEVICE_SECRET_KEY = 'phd-atlas-offline-integrity-key:v1'
const WORKER_INTEGRITY_ALGORITHM: OfflineIntegrity['algorithm'] = 'hmac-sha256-json-v2'
const INTEGRITY_ALGORITHM: OfflineIntegrity['algorithm'] = 'hmac-sha256-device-v1'
const LEGACY_INTEGRITY_ALGORITHM: OfflineIntegrity['algorithm'] = 'fnv1a64-device-v1'
const SNAPSHOT_WORKER_TIMEOUT_MS = 12_000
let cachedDeviceSecret: string | null = null
let snapshotWorker: Worker | null = null
let snapshotWorkerUnavailable = false
let snapshotWorkerSequence = 0
const latestSnapshotWorkerJob = new Map<string, number>()

type SnapshotWorkerJob = {
  id: number
  key: string
  userId: string
  payload: OfflineSnapshotPayload
  timer: ReturnType<typeof setTimeout>
}

const snapshotWorkerJobs = new Map<string, SnapshotWorkerJob>()

type SnapshotWorkerResponse = {
  id: number
  key: string
  serialized?: string
  error?: string
}

const SHA256_INITIAL_HASH = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
]

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]

function snapshotKey(userId: string) {
  return `${SNAPSHOT_PREFIX}${userId}`
}

function queueKey(userId: string) {
  return `${QUEUE_PREFIX}${userId}`
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function randomHex(bytes = 32) {
  const array = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array)
  } else {
    for (let index = 0; index < array.length; index += 1) {
      array[index] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readDeviceSecret() {
  if (cachedDeviceSecret) {
    try {
      if (!localStorage.getItem(DEVICE_SECRET_KEY)) {
        localStorage.setItem(DEVICE_SECRET_KEY, cachedDeviceSecret)
      }
    } catch {
      // Volatile storage still works for the current tab; future reloads will simply reject old data.
    }
    return cachedDeviceSecret
  }
  try {
    const stored = localStorage.getItem(DEVICE_SECRET_KEY)
    if (stored && /^[a-f0-9]{48,}$/i.test(stored)) {
      cachedDeviceSecret = stored
      return stored
    }
    const next = randomHex()
    localStorage.setItem(DEVICE_SECRET_KEY, next)
    cachedDeviceSecret = next
    return next
  } catch {
    cachedDeviceSecret = cachedDeviceSecret ?? randomHex()
    return cachedDeviceSecret
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function utf8Bytes(value: string) {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0
    if (codePoint > 0xffff) index += 1
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

function hexToBytes(hex: string) {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`
  const bytes = new Uint8Array(normalized.length / 2)
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const bytes = new Uint8Array(left.length + right.length)
  bytes.set(left)
  bytes.set(right, left.length)
  return bytes
}

function rotateRight(value: number, shift: number) {
  return (value >>> shift) | (value << (32 - shift))
}

function sha256Bytes(bytes: Uint8Array) {
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)

  const hash = SHA256_INITIAL_HASH.slice()
  const words = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4)
    }
    for (let index = 16; index < 64; index += 1) {
      const sigma0 = rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3)
      const sigma1 = rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10)
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0
    }

    let a = hash[0]
    let b = hash[1]
    let c = hash[2]
    let d = hash[3]
    let e = hash[4]
    let f = hash[5]
    let g = hash[6]
    let h = hash[7]

    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + bigSigma1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (bigSigma0 + majority) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  const digest = new Uint8Array(32)
  const digestView = new DataView(digest.buffer)
  hash.forEach((word, index) => digestView.setUint32(index * 4, word))
  return digest
}

function hmacSha256Hex(keyHex: string, message: string) {
  let key = hexToBytes(keyHex)
  if (key.length > 64) key = sha256Bytes(key)

  const blockKey = new Uint8Array(64)
  blockKey.set(key)
  const outerKeyPad = new Uint8Array(64)
  const innerKeyPad = new Uint8Array(64)
  for (let index = 0; index < 64; index += 1) {
    outerKeyPad[index] = blockKey[index] ^ 0x5c
    innerKeyPad[index] = blockKey[index] ^ 0x36
  }

  const innerDigest = sha256Bytes(concatBytes(innerKeyPad, utf8Bytes(message)))
  return bytesToHex(sha256Bytes(concatBytes(outerKeyPad, innerDigest)))
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

function offlineSignatureMessage(scope: 'snapshot' | 'queue', userId: string, payload: unknown) {
  return stableStringify({ scope, userId, payload })
}

function offlineJsonSignatureMessage(scope: 'snapshot' | 'queue', userId: string, payload: unknown) {
  return JSON.stringify({ scope, userId, payload })
}

function signOfflinePayload(scope: 'snapshot' | 'queue', userId: string, payload: unknown): OfflineIntegrity {
  return {
    algorithm: INTEGRITY_ALGORITHM,
    digest: hmacSha256Hex(readDeviceSecret(), offlineSignatureMessage(scope, userId, payload)),
  }
}

function signLegacyOfflinePayload(scope: 'snapshot' | 'queue', userId: string, payload: unknown): OfflineIntegrity {
  return {
    algorithm: LEGACY_INTEGRITY_ALGORITHM,
    digest: fnv1a64(stableStringify({
      scope,
      userId,
      deviceSecret: readDeviceSecret(),
      payload,
    })),
  }
}

function hasValidIntegrity(
  scope: 'snapshot' | 'queue',
  userId: string,
  payload: unknown,
  integrity: unknown,
) {
  if (!isRecord(integrity)) return false
  if (typeof integrity.digest !== 'string') return false
  const digest = integrity.digest.toLowerCase()
  if (integrity.algorithm === WORKER_INTEGRITY_ALGORITHM) {
    if (!/^[a-f0-9]{64}$/i.test(digest)) return false
    return hmacSha256Hex(
      readDeviceSecret(),
      offlineJsonSignatureMessage(scope, userId, payload),
    ) === digest
  }
  if (integrity.algorithm === INTEGRITY_ALGORITHM) {
    if (!/^[a-f0-9]{64}$/i.test(digest)) return false
    return signOfflinePayload(scope, userId, payload).digest === digest
  }
  if (integrity.algorithm === LEGACY_INTEGRITY_ALGORITHM) {
    if (!/^[a-f0-9]{16}$/i.test(digest)) return false
    return signLegacyOfflinePayload(scope, userId, payload).digest === digest
  }
  return false
}

function isApplicationLike(value: unknown): value is ApplicationRecord {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.school) &&
    typeof value.school.name === 'string' &&
    typeof value.program === 'string'
}

function isOfflineSnapshotData(value: unknown): value is OfflineSnapshotData {
  return isRecord(value) &&
    Array.isArray(value.applications) &&
    value.applications.every(isApplicationLike) &&
    Array.isArray(value.profileAssets) &&
    Array.isArray(value.backups) &&
    Array.isArray(value.applicationTrash) &&
    Array.isArray(value.teamWorkspaces) &&
    (value.activeTeamId === null || typeof value.activeTeamId === 'string') &&
    (value.teamSummary === null || isRecord(value.teamSummary)) &&
    Array.isArray(value.teamApplications)
}

function isOfflineApplicationUpdate(value: unknown, userId: string): value is OfflineApplicationUpdate {
  if (!isRecord(value)) return false
  if (value.type !== 'updateApplication' || value.userId !== userId) return false
  if (typeof value.id !== 'string' || typeof value.applicationId !== 'string') return false
  if (value.baseUpdatedAt !== null && typeof value.baseUpdatedAt !== 'string') return false
  if (value.baseApplication !== undefined && !isApplicationLike(value.baseApplication)) return false
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false
  if (value.status !== undefined && value.status !== 'pending' && value.status !== 'blocked') return false
  if (value.blockedReason !== undefined && typeof value.blockedReason !== 'string') return false
  if (!isApplicationLike(value.application)) return false
  if (value.application.id !== value.applicationId) return false
  if (value.application.ownerId && value.application.ownerId !== userId) return false
  return true
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function writeSerializedJson(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeStoredJson(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage cleanup is best effort; invalid data is still rejected for this session.
  }
}

function settleSnapshotWorkerJob(key: string, id: number, serialized?: string) {
  const job = snapshotWorkerJobs.get(key)
  if (!job || job.id !== id || latestSnapshotWorkerJob.get(key) !== id) return
  clearTimeout(job.timer)
  snapshotWorkerJobs.delete(key)
  latestSnapshotWorkerJob.delete(key)
  if (serialized) {
    writeSerializedJson(key, serialized)
    return
  }
  const snapshot: OfflineSnapshot = {
    ...job.payload,
    integrity: signOfflinePayload('snapshot', job.userId, job.payload),
  }
  writeJson(key, snapshot)
}

function disableSnapshotWorker() {
  snapshotWorker?.terminate()
  snapshotWorker = null
  snapshotWorkerUnavailable = true
  for (const job of [...snapshotWorkerJobs.values()]) {
    settleSnapshotWorkerJob(job.key, job.id)
  }
}

function getSnapshotWorker() {
  if (snapshotWorkerUnavailable || typeof Worker === 'undefined') return null
  if (snapshotWorker) return snapshotWorker
  try {
    snapshotWorker = new Worker(new URL('./offlineSnapshot.worker.ts', import.meta.url), { type: 'module' })
    snapshotWorker.addEventListener('message', (event: MessageEvent<SnapshotWorkerResponse>) => {
      const result = event.data
      if (!result || latestSnapshotWorkerJob.get(result.key) !== result.id) return
      settleSnapshotWorkerJob(result.key, result.id, result.error ? undefined : result.serialized)
    })
    snapshotWorker.addEventListener('error', disableSnapshotWorker)
    snapshotWorker.addEventListener('messageerror', disableSnapshotWorker)
    return snapshotWorker
  } catch {
    snapshotWorker = null
    snapshotWorkerUnavailable = true
    return null
  }
}

function createOfflineId(applicationId: string) {
  return `offline_${applicationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function saveOfflineSnapshot(session: AuthSession, data: OfflineSnapshotData) {
  const payload: OfflineSnapshotPayload = {
    version: 2,
    userId: session.user.id,
    savedAt: new Date().toISOString(),
    data,
  }
  const key = snapshotKey(session.user.id)
  const worker = getSnapshotWorker()
  if (worker) {
    const id = ++snapshotWorkerSequence
    const previous = snapshotWorkerJobs.get(key)
    if (previous) clearTimeout(previous.timer)
    const timer = setTimeout(() => disableSnapshotWorker(), SNAPSHOT_WORKER_TIMEOUT_MS)
    latestSnapshotWorkerJob.set(key, id)
    snapshotWorkerJobs.set(key, { id, key, userId: session.user.id, payload, timer })
    try {
      worker.postMessage({
        id,
        key,
        userId: session.user.id,
        secret: readDeviceSecret(),
        payload,
      })
    } catch {
      disableSnapshotWorker()
    }
    return
  }
  const snapshot: OfflineSnapshot = {
    ...payload,
    integrity: signOfflinePayload('snapshot', session.user.id, payload),
  }
  writeJson(key, snapshot)
}

export function loadOfflineSnapshot(session: AuthSession): OfflineSnapshot | null {
  const key = snapshotKey(session.user.id)
  const snapshot = safeParse<OfflineSnapshot>(localStorage.getItem(key))
  if (!snapshot || snapshot.version !== 2 || snapshot.userId !== session.user.id) {
    removeStoredJson(key)
    return null
  }
  if (!isOfflineSnapshotData(snapshot.data)) {
    removeStoredJson(key)
    return null
  }
  const { integrity, ...payload } = snapshot
  if (!hasValidIntegrity('snapshot', session.user.id, payload, integrity)) {
    removeStoredJson(key)
    return null
  }
  return snapshot
}

function writeOfflineQueue(userId: string, items: OfflineApplicationUpdate[]) {
  const payload = {
    version: 2 as const,
    userId,
    updatedAt: new Date().toISOString(),
    items,
  }
  const store: OfflineQueueStore = {
    ...payload,
    integrity: signOfflinePayload('queue', userId, payload),
  }
  writeJson(queueKey(userId), store)
}

export function readOfflineQueue(userId: string): OfflineApplicationUpdate[] {
  const key = queueKey(userId)
  const store = safeParse<OfflineQueueStore>(localStorage.getItem(key))
  if (!store || store.version !== 2 || store.userId !== userId || !Array.isArray(store.items)) {
    removeStoredJson(key)
    return []
  }
  const { integrity, ...payload } = store
  if (!hasValidIntegrity('queue', userId, payload, integrity)) {
    removeStoredJson(key)
    return []
  }
  if (!store.items.every((item) => isOfflineApplicationUpdate(item, userId))) {
    removeStoredJson(key)
    return []
  }
  return store.items
}

export function offlineQueueSize(userId: string) {
  return readOfflineQueue(userId).length
}

export function pendingOfflineQueueSize(userId: string) {
  return readOfflineQueue(userId).filter((item) => item.status !== 'blocked').length
}

export function blockedOfflineQueueSize(userId: string) {
  return readOfflineQueue(userId).filter((item) => item.status === 'blocked').length
}

export function enqueueApplicationUpdate(
  userId: string,
  application: ApplicationRecord,
  baseUpdatedAt: string | null,
  baseApplication?: ApplicationRecord | null,
) {
  const now = new Date().toISOString()
  const queue = readOfflineQueue(userId)
  const existingIndex = queue.findIndex((item) =>
    item.type === 'updateApplication' &&
    item.applicationId === application.id &&
    item.status !== 'blocked'
  )

  if (existingIndex >= 0) {
    const existing = queue[existingIndex]
    queue[existingIndex] = {
      ...existing,
      application,
      updatedAt: now,
      status: 'pending',
      blockedReason: undefined,
    }
  } else {
    queue.push({
      id: createOfflineId(application.id),
      type: 'updateApplication',
      userId,
      applicationId: application.id,
      baseUpdatedAt,
      baseApplication: baseApplication ?? undefined,
      createdAt: now,
      updatedAt: now,
      application,
      status: 'pending',
    })
  }

  writeOfflineQueue(userId, queue)
  return queue
}

function valuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/**
 * Conservatively merges an offline edit when the server changed a different
 * top-level application field. Nested collections remain atomic so simultaneous
 * edits to tasks/materials never get silently interleaved or overwritten.
 */
export function mergeOfflineApplicationUpdate(
  operation: OfflineApplicationUpdate,
  serverApplication: ApplicationRecord,
): { application: ApplicationRecord; merged: boolean } | null {
  if (serverApplication.updatedAt === operation.baseUpdatedAt) {
    return { application: operation.application, merged: false }
  }
  const base = operation.baseApplication
  if (!base || base.id !== serverApplication.id || base.id !== operation.application.id) return null

  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(operation.application),
    ...Object.keys(serverApplication),
  ] as Array<keyof ApplicationRecord>)
  keys.delete('id')
  keys.delete('ownerId')
  keys.delete('teamId')
  keys.delete('teamTransferRequest')
  keys.delete('updatedAt')
  keys.delete('createdAt')

  const localChanges = new Set<keyof ApplicationRecord>()
  const serverChanges = new Set<keyof ApplicationRecord>()
  for (const key of keys) {
    if (!valuesEqual(operation.application[key], base[key])) localChanges.add(key)
    if (!valuesEqual(serverApplication[key], base[key])) serverChanges.add(key)
  }
  for (const key of localChanges) {
    if (serverChanges.has(key) && !valuesEqual(operation.application[key], serverApplication[key])) return null
  }

  const merged = { ...serverApplication }
  for (const key of localChanges) {
    ;(merged as unknown as Record<string, unknown>)[key] = operation.application[key]
  }
  return { application: merged, merged: true }
}

export function removeOfflineQueueItems(userId: string, operationIds: string[]) {
  if (operationIds.length === 0) return readOfflineQueue(userId)
  const blocked = new Set(operationIds)
  const queue = readOfflineQueue(userId).filter((item) => !blocked.has(item.id))
  writeOfflineQueue(userId, queue)
  return queue
}

export function removeOfflineApplicationUpdates(userId: string, applicationId: string) {
  const queue = readOfflineQueue(userId).filter((item) => item.applicationId !== applicationId)
  writeOfflineQueue(userId, queue)
  return queue
}

export function markOfflineQueueItemBlocked(userId: string, operationId: string, blockedReason: string) {
  const queue = readOfflineQueue(userId).map((item) =>
    item.id === operationId
      ? { ...item, status: 'blocked' as const, blockedReason, updatedAt: new Date().toISOString() }
      : item,
  )
  writeOfflineQueue(userId, queue)
  return queue
}

export function canQueueApplicationUpdate(
  session: AuthSession,
  application: ApplicationRecord,
  options: { isTeamMode: boolean },
) {
  if (options.isTeamMode) return false
  if (application.ownerId && application.ownerId !== session.user.id) return false
  if (!application.updatedAt) return false
  return true
}

export function isNetworkLikeError(error: unknown) {
  if (!navigator.onLine) return true
  if (error instanceof TypeError) return true
  if (error instanceof Error) {
    const transportError = error as Error & { code?: string; status?: number }
    if (transportError.code === 'REQUEST_TIMEOUT') return true
    if (transportError.code === 'SERVER_UNAVAILABLE') return true
    // A structured API error means Atlas was reached successfully. SMTP,
    // IMAP, push and provider failures commonly use 502/503 without implying
    // that the application server itself is offline.
    if (
      !transportError.code
      && (transportError.status === 502 || transportError.status === 503 || transportError.status === 504)
    ) return true
    return /failed to fetch|networkerror|load failed|network request failed/i.test(error.message)
  }
  return false
}
