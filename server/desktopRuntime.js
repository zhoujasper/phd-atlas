import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DESKTOP_RUNTIME_FILE = 'desktop-runtime.json'
export const DESKTOP_COMPLETE_FORMAT = 'phd-atlas-complete-v1'
export const UNLIMITED_DESKTOP_QUOTA = -1
export const DESKTOP_UNLOCK_PASSWORD_MIN_LENGTH = 4
export const DESKTOP_UNLOCK_PASSWORD_MAX_LENGTH = 128
export const DESKTOP_LOCAL_OWNER_EMAIL = 'local@desktop.phd-atlas'

const TOKEN_CIPHER = 'aes-256-gcm'

export function isDesktopProcess(env = process.env) {
  const value = String(env.PHD_ATLAS_DESKTOP ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export function defaultDesktopRuntimeState() {
  return {
    version: 1,
    mode: 'local',
    remoteOrigin: null,
    remoteEmail: null,
    remoteToken: null,
    remoteUsage: null,
    applicationMappings: [],
    linkedAt: null,
    unlockPasswordHash: null,
  }
}

export function normalizeDesktopRuntimeState(value) {
  const fallback = defaultDesktopRuntimeState()
  const candidate = value && typeof value === 'object' ? value : {}
  const mode = candidate.mode === 'remote' ? 'remote' : 'local'
  const origin = normalizeDesktopOrigin(candidate.remoteOrigin)
  const mappings = Array.isArray(candidate.applicationMappings)
    ? candidate.applicationMappings
      .map((entry) => ({
        localId: String(entry?.localId ?? '').trim(),
        remoteId: String(entry?.remoteId ?? '').trim(),
        key: String(entry?.key ?? '').trim(),
      }))
      .filter((entry) => entry.localId && entry.remoteId)
    : []
  return {
    version: 1,
    mode: mode === 'remote' && origin ? 'remote' : 'local',
    remoteOrigin: mode === 'remote' ? origin : null,
    remoteEmail: typeof candidate.remoteEmail === 'string' && candidate.remoteEmail.trim()
      ? candidate.remoteEmail.trim().slice(0, 320)
      : null,
    remoteToken: typeof candidate.remoteToken === 'string' && candidate.remoteToken.trim()
      ? candidate.remoteToken.trim()
      : null,
    remoteUsage: normalizeRemoteUsage(candidate.remoteUsage),
    applicationMappings: mappings,
    linkedAt: typeof candidate.linkedAt === 'string' && candidate.linkedAt.trim()
      ? candidate.linkedAt
      : null,
    unlockPasswordHash: typeof candidate.unlockPasswordHash === 'string' && candidate.unlockPasswordHash.trim()
      ? candidate.unlockPasswordHash.trim()
      : fallback.unlockPasswordHash,
  }
}

export function normalizeDesktopOrigin(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    url.hash = ''
    url.search = ''
    const normalized = url.toString().replace(/\/+$/u, '')
    return normalized.slice(0, 500)
  } catch {
    return null
  }
}

export function isDesktopLocalUnlinked(state) {
  return normalizeDesktopRuntimeState(state).mode !== 'remote'
}

export function isDesktopShareEnabled(state) {
  return normalizeDesktopRuntimeState(state).mode === 'remote'
}

export function desktopPublicRuntime(state, { enabled = true, unlocked } = {}) {
  const runtime = normalizeDesktopRuntimeState(state)
  const local = runtime.mode !== 'remote'
  const unlockRequired = Boolean(runtime.unlockPasswordHash)
  return {
    enabled: Boolean(enabled),
    mode: runtime.mode,
    remoteOrigin: runtime.remoteOrigin,
    remoteEmail: runtime.remoteEmail,
    shareEnabled: runtime.mode === 'remote',
    adminEnabled: false,
    teamEnabled: false,
    unlimited: local,
    linkedAt: runtime.linkedAt,
    unlockRequired,
    unlocked: unlockRequired ? unlocked === true : true,
  }
}

export function desktopLocalAccountSettings(settings = {}) {
  return {
    ...settings,
    membershipPlan: 'pro',
    personalMembershipPlan: 'pro',
    autoBackup: settings.autoBackup !== false,
    applicationQuota: UNLIMITED_DESKTOP_QUOTA,
    applicationCreateQuota: UNLIMITED_DESKTOP_QUOTA,
    shareQuota: UNLIMITED_DESKTOP_QUOTA,
    shareCreateQuota: UNLIMITED_DESKTOP_QUOTA,
    storageQuotaMb: UNLIMITED_DESKTOP_QUOTA,
  }
}

export function desktopLinkedAccountSettings(settings = {}, remoteUsage = null) {
  const usage = normalizeRemoteUsage(remoteUsage)
  const next = {
    ...settings,
    membershipPlan: usage.plan === 'pro' || usage.plan === 'team' ? usage.plan : (usage.plan === 'admin' ? 'pro' : 'free'),
  }
  if (Number.isFinite(usage.applicationQuota)) next.applicationQuota = usage.applicationQuota
  if (Number.isFinite(usage.applicationCreateQuota)) next.applicationCreateQuota = usage.applicationCreateQuota
  if (Number.isFinite(usage.shareQuota)) next.shareQuota = usage.shareQuota
  if (Number.isFinite(usage.shareCreateQuota)) next.shareCreateQuota = usage.shareCreateQuota
  if (Number.isFinite(usage.storageQuotaMb)) next.storageQuotaMb = usage.storageQuotaMb
  else if (Number.isFinite(usage.storageQuotaBytes) && usage.storageQuotaBytes >= 0) {
    next.storageQuotaMb = Math.max(1, Math.round(usage.storageQuotaBytes / (1024 * 1024)))
  }
  return next
}

export function applyDesktopAccountSettings(settings, state) {
  const runtime = normalizeDesktopRuntimeState(state)
  if (runtime.mode === 'remote') {
    return desktopLinkedAccountSettings(settings, runtime.remoteUsage)
  }
  return desktopLocalAccountSettings(settings)
}

export function applicationSyncKey(application) {
  const school = String(application?.school?.name ?? application?.university ?? '').trim().toLowerCase()
  const program = String(application?.program ?? '').trim().toLowerCase()
  const email = String(application?.professor?.email ?? application?.professorEmail ?? '').trim().toLowerCase()
  return `${school}|${program}|${email}`
}

export function mergeDesktopApplicationMappings(localApplications, remoteApplications, pushedMappings = []) {
  const remoteByKey = new Map()
  for (const application of Array.isArray(remoteApplications) ? remoteApplications : []) {
    const key = applicationSyncKey(application)
    const remoteId = String(application?.id ?? '').trim()
    if (key !== '||' && remoteId) remoteByKey.set(key, remoteId)
  }
  for (const mapping of Array.isArray(pushedMappings) ? pushedMappings : []) {
    const key = String(mapping?.key ?? '').trim()
    const remoteId = String(mapping?.remoteId ?? '').trim()
    if (key && remoteId) remoteByKey.set(key, remoteId)
  }
  const mappings = []
  const seen = new Set()
  for (const application of Array.isArray(localApplications) ? localApplications : []) {
    const localId = String(application?.id ?? '').trim()
    const key = applicationSyncKey(application)
    const remoteId = remoteByKey.get(key)
    if (!localId || !remoteId || seen.has(localId)) continue
    seen.add(localId)
    mappings.push({ localId, remoteId, key })
  }
  return mappings
}

export function findMissingLocalApplications(localApplications, remoteApplications) {
  const remoteKeys = new Set(
    (Array.isArray(remoteApplications) ? remoteApplications : [])
      .map((application) => applicationSyncKey(application))
      .filter((key) => key !== '||'),
  )
  return (Array.isArray(localApplications) ? localApplications : []).filter((application) => {
    const key = applicationSyncKey(application)
    return key !== '||' && !remoteKeys.has(key)
  })
}

export function evaluateDesktopWebApplicationQuota({
  localCount,
  remoteCount,
  remoteQuota,
  missingCount,
} = {}) {
  const quota = Number(remoteQuota)
  const local = Math.max(0, Number(localCount) || 0)
  const remote = Math.max(0, Number(remoteCount) || 0)
  const missing = Math.max(0, Number(missingCount) || 0)
  const unlimited = !Number.isFinite(quota)
    || quota < 0
    || quota >= Number.MAX_SAFE_INTEGER
  if (unlimited) {
    return { ok: true, unlimited: true, remaining: Number.MAX_SAFE_INTEGER, quota: null, local, remote, missing }
  }
  const remaining = Math.max(0, quota - remote)
  if (missing > remaining) {
    return {
      ok: false,
      unlimited: false,
      code: 'APPLICATION_LIMIT_REACHED',
      quota,
      remaining,
      local,
      remote,
      missing,
    }
  }
  return { ok: true, unlimited: false, remaining, quota, local, remote, missing }
}

export function desktopWebQuotaMessage(result) {
  const limit = Number(result?.quota)
  const local = Number(result?.local) || 0
  const missing = Number(result?.missing) || 0
  if (!Number.isFinite(limit)) {
    return 'The linked web account does not have enough application capacity. Upgrade that account before switching storage.'
  }
  return `Application records cannot exceed ${limit}. This device has ${local} applications (${missing} are missing on the web account). Upgrade the web account before switching storage.`
}

export function desktopRuntimePath(storageRoot) {
  return path.join(path.resolve(storageRoot), DESKTOP_RUNTIME_FILE)
}

export async function readDesktopRuntimeState(storageRoot) {
  const filePath = desktopRuntimePath(storageRoot)
  try {
    const raw = await readFile(filePath, 'utf8')
    return normalizeDesktopRuntimeState(JSON.parse(raw))
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultDesktopRuntimeState()
    throw error
  }
}

export async function writeDesktopRuntimeState(storageRoot, state) {
  const current = await readDesktopRuntimeState(storageRoot)
  return persistDesktopRuntimeState(storageRoot, {
    ...current,
    ...state,
    unlockPasswordHash: current.unlockPasswordHash,
  })
}

export async function writeDesktopUnlockPassword(storageRoot, unlockPasswordHash) {
  const current = await readDesktopRuntimeState(storageRoot)
  return persistDesktopRuntimeState(storageRoot, {
    ...current,
    unlockPasswordHash: typeof unlockPasswordHash === 'string' && unlockPasswordHash.trim()
      ? unlockPasswordHash.trim()
      : null,
  })
}

async function persistDesktopRuntimeState(storageRoot, state) {
  const filePath = desktopRuntimePath(storageRoot)
  await mkdir(path.dirname(filePath), { recursive: true })
  const normalized = normalizeDesktopRuntimeState(state)
  const payload = `${JSON.stringify(normalized, null, 2)}\n`
  await writeFile(filePath, payload, 'utf8')
  return normalized
}

export function createDesktopLockState() {
  return {
    hydrated: false,
    required: false,
    unlocked: true,
    passwordHash: null,
  }
}

export function applyDesktopLockState(lock, state) {
  const runtime = normalizeDesktopRuntimeState(state)
  const hash = runtime.unlockPasswordHash
  lock.required = Boolean(hash)
  lock.passwordHash = hash
  lock.unlocked = !hash
  lock.hydrated = true
  return lock
}

export function desktopUnlockPolicy(password) {
  const value = String(password ?? '')
  if (value.length < DESKTOP_UNLOCK_PASSWORD_MIN_LENGTH || value.length > DESKTOP_UNLOCK_PASSWORD_MAX_LENGTH) {
    return { ok: false, code: 'DESKTOP_UNLOCK_TOO_SHORT' }
  }
  return { ok: true }
}

export function findDesktopLocalOwner(users) {
  const list = Array.isArray(users) ? users : []
  return list.find((user) => user && !user.disabledAt && String(user.role || 'user') !== 'admin')
    || list.find((user) => user && !user.disabledAt)
    || null
}

export function createDesktopLocalOwnerRecord({
  id,
  createdAt,
  passwordHash,
} = {}) {
  const now = createdAt || new Date().toISOString()
  return {
    id,
    name: 'Local',
    email: DESKTOP_LOCAL_OWNER_EMAIL,
    role: 'user',
    passwordHash,
    createdAt: now,
    lastLoginAt: now,
    disabledAt: null,
    settings: desktopLocalAccountSettings({
      language: 'en',
      highContrast: false,
      themeAccent: '#0071e3',
      sendFrom: DESKTOP_LOCAL_OWNER_EMAIL,
      receiveAt: DESKTOP_LOCAL_OWNER_EMAIL,
      receiveEmails: [{ address: DESKTOP_LOCAL_OWNER_EMAIL, isPrimary: true, notify: true, verified: true }],
      autoBackup: true,
      incomingProtocol: 'imap',
      incomingHost: '',
      incomingPort: 993,
      incomingUser: '',
      incomingPass: '',
      incomingTls: true,
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpTls: true,
      applicationCreatedCount: 0,
      shareCreatedCount: 0,
      authVersion: 0,
    }),
  }
}

export function encryptDesktopSecret(plain, secret) {
  const text = String(plain ?? '')
  if (!text) return null
  const key = desktopSecretKey(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv(TOKEN_CIPHER, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptDesktopSecret(payload, secret) {
  const packed = String(payload ?? '')
  if (!packed) return null
  if (!packed.startsWith('v1:')) return packed
  const parts = packed.split(':')
  if (parts.length !== 4) return null
  try {
    const key = desktopSecretKey(secret)
    const iv = Buffer.from(parts[1], 'base64url')
    const tag = Buffer.from(parts[2], 'base64url')
    const encrypted = Buffer.from(parts[3], 'base64url')
    const decipher = createDecipheriv(TOKEN_CIPHER, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function desktopSecretKey(secret) {
  return createHash('sha256').update(String(secret || 'phd-atlas-desktop')).digest()
}

function normalizeRemoteUsage(value) {
  if (!value || typeof value !== 'object') return null
  const plan = value.plan === 'pro' || value.plan === 'team' || value.plan === 'admin' || value.plan === 'free'
    ? value.plan
    : null
  const numberOrNull = (candidate) => {
    const next = Number(candidate)
    return Number.isFinite(next) ? next : null
  }
  return {
    plan,
    applicationQuota: numberOrNull(value.applicationQuota),
    applicationCreateQuota: numberOrNull(value.applicationCreateQuota),
    shareQuota: numberOrNull(value.shareQuota),
    shareCreateQuota: numberOrNull(value.shareCreateQuota),
    storageQuotaBytes: numberOrNull(value.storageQuotaBytes),
    storageQuotaMb: numberOrNull(value.storageQuotaMb),
    applicationCount: numberOrNull(value.applicationCount),
  }
}
