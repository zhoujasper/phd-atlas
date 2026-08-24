import { Buffer } from 'node:buffer'
import { DESKTOP_COMPLETE_FORMAT } from './desktopRuntime.js'

const MAX_SNAPSHOT_FILE_BYTES = 25 * 1024 * 1024
const MAX_SNAPSHOT_TOTAL_BYTES = 128 * 1024 * 1024

const IMPORT_SETTINGS_SKIP = new Set([
  'smtpPass',
  'incomingPass',
  'passwordHash',
  'calendarToken',
  'webauthn',
  'authVersion',
  'membershipPlan',
  'personalMembershipPlan',
  'applicationQuota',
  'applicationCreateQuota',
  'shareQuota',
  'shareCreateQuota',
  'storageQuotaMb',
  'applicationCreatedCount',
  'shareCreatedCount',
  'applicationTrash',
])

export function restoreImportedUserSettings(current, incoming) {
  const next = { ...(current && typeof current === 'object' ? current : {}) }
  if (!incoming || typeof incoming !== 'object') return next
  for (const [key, value] of Object.entries(incoming)) {
    if (IMPORT_SETTINGS_SKIP.has(key)) continue
    next[key] = value
  }
  return next
}

export function sanitizeDesktopExportUser(user) {
  if (!user || typeof user !== 'object') return null
  const settings = user.settings && typeof user.settings === 'object' ? { ...user.settings } : {}
  delete settings.smtpPass
  delete settings.incomingPass
  delete settings.passwordHash
  delete settings.calendarToken
  delete settings.webauthn
  return {
    name: String(user.name ?? ''),
    email: String(user.email ?? ''),
    settings,
  }
}

export function collectUploadStorageNames(application) {
  const names = []
  const add = (storageName) => {
    const name = String(storageName ?? '').trim()
    if (name) names.push(name)
  }
  for (const material of application?.materials ?? []) {
    add(material.storageName)
    for (const version of material.versions ?? []) add(version.storageName)
    for (const attachment of material.attachments ?? []) add(attachment.storageName)
  }
  for (const task of application?.tasks ?? []) {
    add(task.storageName)
    for (const version of task.versions ?? []) add(version.storageName)
    for (const attachment of task.attachments ?? []) add(attachment.storageName)
  }
  for (const communication of application?.communications ?? []) {
    for (const attachment of communication.attachments ?? []) add(attachment.storageName)
  }
  return names
}

export function collectProfileAssetStorageNames(asset) {
  const names = []
  for (const attachment of asset?.attachments ?? []) {
    const name = String(attachment?.storageName ?? '').trim()
    if (name) names.push(name)
  }
  return names
}

export function personalApplicationsForUser(applications, userId) {
  return (Array.isArray(applications) ? applications : []).filter((application) => (
    application?.ownerId === userId && !application?.teamId
  ))
}

export function personalProfileAssetsForUser(assets, userId) {
  return (Array.isArray(assets) ? assets : []).filter((asset) => (
    asset?.ownerId === userId && !asset?.teamId
  ))
}

export function createCompleteWorkspaceSnapshot({
  user,
  applications = [],
  profileAssets = [],
  interviewPrep = null,
  files = [],
  exportedAt = new Date().toISOString(),
} = {}) {
  return {
    format: DESKTOP_COMPLETE_FORMAT,
    exportedAt,
    user: sanitizeDesktopExportUser(user),
    applications: personalApplicationsForUser(applications, user?.id).map((application) => ({
      ...application,
      teamId: null,
      visibleToTeam: false,
    })),
    profileAssets: personalProfileAssetsForUser(profileAssets, user?.id),
    interviewPrep: interviewPrep && typeof interviewPrep === 'object' ? interviewPrep : null,
    files: Array.isArray(files) ? files : [],
  }
}

export function parseCompleteWorkspaceSnapshot(value) {
  const snapshot = typeof value === 'string' ? JSON.parse(value) : value
  if (!snapshot || typeof snapshot !== 'object') {
    throw completeExportError('DESKTOP_IMPORT_INVALID', 'Complete workspace archive is missing.')
  }
  if (snapshot.format !== DESKTOP_COMPLETE_FORMAT) {
    throw completeExportError('DESKTOP_IMPORT_INVALID', 'This file is not a PhD Atlas complete workspace archive.')
  }
  return {
    format: DESKTOP_COMPLETE_FORMAT,
    exportedAt: String(snapshot.exportedAt ?? ''),
    user: snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : null,
    applications: Array.isArray(snapshot.applications) ? snapshot.applications : [],
    profileAssets: Array.isArray(snapshot.profileAssets) ? snapshot.profileAssets : [],
    interviewPrep: snapshot.interviewPrep && typeof snapshot.interviewPrep === 'object'
      ? snapshot.interviewPrep
      : null,
    files: Array.isArray(snapshot.files) ? snapshot.files : [],
  }
}

export function decodeSnapshotFileBytes(entry) {
  const encoding = String(entry?.encoding ?? 'base64')
  const payload = String(entry?.bytes ?? entry?.content ?? '')
  if (!payload) return null
  if (encoding !== 'base64') {
    throw completeExportError('DESKTOP_IMPORT_INVALID', 'Complete archive files must use base64 encoding.')
  }
  const buffer = Buffer.from(payload, 'base64')
  if (!buffer.length) return null
  if (buffer.length > MAX_SNAPSHOT_FILE_BYTES) {
    throw completeExportError('DESKTOP_IMPORT_INVALID', 'A stored file in the archive exceeds the import size limit.')
  }
  return buffer
}

export async function collectSnapshotFiles(storageNames, readBuffer) {
  const unique = [...new Set((storageNames ?? []).map((name) => String(name ?? '').trim()).filter(Boolean))]
  const files = []
  let total = 0
  for (const storageName of unique) {
    if (total >= MAX_SNAPSHOT_TOTAL_BYTES) break
    try {
      const buffer = await readBuffer(storageName, { maxBytes: MAX_SNAPSHOT_FILE_BYTES })
      if (!buffer?.length) continue
      if (total + buffer.length > MAX_SNAPSHOT_TOTAL_BYTES) continue
      total += buffer.length
      files.push({
        storageName,
        encoding: 'base64',
        bytes: Buffer.from(buffer).toString('base64'),
        size: buffer.length,
      })
    } catch {
      // A missing vault object is omitted rather than failing a complete export.
    }
  }
  return files
}

export function completeExportError(code, message, status = 400) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

export { MAX_SNAPSHOT_FILE_BYTES, MAX_SNAPSHOT_TOTAL_BYTES }
