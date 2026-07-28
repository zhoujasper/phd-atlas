import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SYSTEM_UPDATE_STATUS_NAME = 'system-update-status.json'
export const SYSTEM_UPDATE_LOG_NAME = 'system-update.log.jsonl'

const STATUS_FORMAT_VERSION = 1
const MAX_LOG_FILE_BYTES = 8 * 1024 * 1024
const MAX_LOG_MESSAGE_LENGTH = 4_000
const MAX_LOG_ENTRIES = 200
const writeQueues = new Map()

const ACTIVE_UPDATE_PHASES = new Set([
  'resolving',
  'probing',
  'downloading',
  'verifying',
  'preparing',
  'installing',
  'restarting',
])

function statusPath(storageRoot) {
  return path.join(storageRoot, SYSTEM_UPDATE_STATUS_NAME)
}

function logPath(storageRoot) {
  return path.join(storageRoot, SYSTEM_UPDATE_LOG_NAME)
}

function enqueueWrite(storageRoot, task) {
  const key = path.resolve(storageRoot)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(task)
  writeQueues.set(key, next)
  void next
    .finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key)
    })
    .catch(() => undefined)
  return next
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function boundedText(value, maximum = MAX_LOG_MESSAGE_LENGTH) {
  const text = String(value ?? '')
    .replace(/(https?:\/\/)([^/\s:@]+):([^@/\s]+)@/gi, '$1[redacted]@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(authorization|password|passwd|token|secret|_authToken)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
  if (text.length <= maximum) return text
  return `${text.slice(0, maximum - 18)}… [truncated]`
}

function normalizedStatus(value = {}) {
  return {
    formatVersion: STATUS_FORMAT_VERSION,
    jobId: typeof value.jobId === 'string' && value.jobId ? value.jobId : null,
    phase: typeof value.phase === 'string' && value.phase ? value.phase : 'idle',
    source: typeof value.source === 'string' && value.source ? value.source : null,
    bytes: Number.isFinite(value.bytes) && value.bytes >= 0 ? value.bytes : 0,
    total: Number.isFinite(value.total) && value.total >= 0 ? value.total : 0,
    targetVersion: typeof value.targetVersion === 'string' && value.targetVersion
      ? value.targetVersion
      : null,
    errorCode: typeof value.errorCode === 'string' && value.errorCode ? value.errorCode : null,
    errorMessage: typeof value.errorMessage === 'string' && value.errorMessage
      ? boundedText(value.errorMessage)
      : null,
    operationInFlight: Boolean(value.operationInFlight),
    restartPending: Boolean(value.restartPending),
    requestedAt: typeof value.requestedAt === 'string' && value.requestedAt
      ? value.requestedAt
      : null,
    requestedBy: typeof value.requestedBy === 'string' && value.requestedBy
      ? value.requestedBy
      : null,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt
      ? value.updatedAt
      : new Date().toISOString(),
  }
}

export function createSystemUpdateStatus(overrides = {}) {
  return normalizedStatus({
    phase: 'idle',
    source: null,
    bytes: 0,
    total: 0,
    targetVersion: null,
    errorCode: null,
    errorMessage: null,
    operationInFlight: false,
    restartPending: false,
    ...overrides,
  })
}

export function isSystemUpdateActivePhase(phase) {
  return ACTIVE_UPDATE_PHASES.has(phase)
}

export async function readSystemUpdateStatus(storageRoot) {
  try {
    return normalizedStatus(JSON.parse(await fs.readFile(statusPath(storageRoot), 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return createSystemUpdateStatus()
    throw error
  }
}

export function writeSystemUpdateStatus(storageRoot, status) {
  const next = normalizedStatus({
    ...status,
    updatedAt: status?.updatedAt ?? new Date().toISOString(),
  })
  return enqueueWrite(storageRoot, () => writeJsonAtomically(statusPath(storageRoot), next))
}

export function patchSystemUpdateStatus(storageRoot, patch) {
  return enqueueWrite(storageRoot, async () => {
    const current = await readSystemUpdateStatus(storageRoot)
    const next = normalizedStatus({
      ...current,
      ...patch,
      updatedAt: patch?.updatedAt ?? patch?.at ?? new Date().toISOString(),
    })
    await writeJsonAtomically(statusPath(storageRoot), next)
    return next
  })
}

async function rotateLogIfNeeded(filePath) {
  const size = await fs.stat(filePath)
    .then((entry) => entry.size)
    .catch((error) => {
      if (error?.code === 'ENOENT') return 0
      throw error
    })
  if (size < MAX_LOG_FILE_BYTES) return
  const archivePath = `${filePath}.1`
  await fs.rm(archivePath, { force: true })
  await fs.rename(filePath, archivePath)
}

export function appendSystemUpdateLog(storageRoot, entry) {
  return enqueueWrite(storageRoot, async () => {
    const filePath = logPath(storageRoot)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await rotateLogIfNeeded(filePath)
    const record = {
      at: typeof entry?.at === 'string' && entry.at ? entry.at : new Date().toISOString(),
      jobId: typeof entry?.jobId === 'string' && entry.jobId ? entry.jobId : null,
      level: ['debug', 'info', 'warning', 'error'].includes(entry?.level) ? entry.level : 'info',
      phase: typeof entry?.phase === 'string' && entry.phase ? entry.phase : null,
      message: boundedText(entry?.message || 'System update event'),
      errorCode: typeof entry?.errorCode === 'string' && entry.errorCode
        ? boundedText(entry.errorCode, 160)
        : null,
      detail: typeof entry?.detail === 'string' && entry.detail
        ? boundedText(entry.detail)
        : null,
    }
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return record
  })
}

async function readLogLines(filePath) {
  try {
    return (await fs.readFile(filePath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function readSystemUpdateLogs(storageRoot, options = {}) {
  const requestedLimit = Number.parseInt(options.limit, 10)
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(MAX_LOG_ENTRIES, Math.max(1, requestedLimit))
    : 80
  const filePath = logPath(storageRoot)
  const [archived, current] = await Promise.all([
    readLogLines(`${filePath}.1`),
    readLogLines(filePath),
  ])
  const entries = []
  for (const line of [...archived, ...current].slice(-limit)) {
    try {
      const parsed = JSON.parse(line)
      entries.push({
        at: String(parsed.at ?? ''),
        jobId: parsed.jobId ? String(parsed.jobId) : null,
        level: ['debug', 'info', 'warning', 'error'].includes(parsed.level)
          ? parsed.level
          : 'info',
        phase: parsed.phase ? String(parsed.phase) : null,
        message: boundedText(parsed.message),
        errorCode: parsed.errorCode ? boundedText(parsed.errorCode, 160) : null,
        detail: parsed.detail ? boundedText(parsed.detail) : null,
      })
    } catch {
      // Ignore a partial final line left by an unexpected process termination.
    }
  }
  return {
    entries,
    fileName: SYSTEM_UPDATE_LOG_NAME,
  }
}

export async function flushSystemUpdateJournal(storageRoot) {
  const pending = writeQueues.get(path.resolve(storageRoot))
  if (pending) await pending
}
