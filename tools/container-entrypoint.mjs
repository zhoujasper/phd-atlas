import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  mkdirSync,
  promises as fs,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimPendingUpdateBoot,
  isUpdateLockAbandoned,
  readUpdateLockState,
  recoverAbandonedPendingUpdateBoot,
  recoverAbandonedUpdateLock,
  releasePendingUpdateBootClaim,
  replayActiveUpdateIfNeeded,
} from '../server/systemUpdate.js'
import {
  appendSystemUpdateLog,
  patchSystemUpdateStatus,
} from '../server/systemUpdateJournal.js'
import { runProductionDependencyInstall } from '../server/dependencyInstall.js'

export const UPDATE_RESTART_EXIT_CODE = 75

const __filename = fileURLToPath(import.meta.url)
const defaultProjectRoot = path.resolve(
  process.env.PHD_ATLAS_PROJECT_ROOT
    ?? path.resolve(path.dirname(__filename), '..'),
)
export const CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH = '/usr/local/share/phd-atlas/runtime-manifest.json'
const DEFAULT_UPDATE_WAIT_MS = 15 * 60_000
const DEFAULT_UPDATE_POLL_MS = 250
const RAPID_EXIT_WINDOW_MS = 30_000
const MAX_RESTART_DELAY_MS = 30_000
const DEFAULT_MAX_RAPID_WORKER_RESTARTS = 8
const DEFAULT_DIAGNOSTIC_WRITE_TIMEOUT_MS = 1_000
// The worker owns at most 20 seconds of cooperative drain plus 40 seconds of
// storage-durability recovery. Leave ten seconds beyond the primary worker
// budget and five seconds before the outer Compose/systemd 75-second ceiling.
export const DEFAULT_WORKER_SHUTDOWN_GRACE_MS = 70_000
const DEFAULT_CGROUP_ROOT = '/sys/fs/cgroup'
const DEFAULT_WORKER_EXIT_MAX_ENTRIES = 64
const DEFAULT_WORKER_EXIT_MAX_BYTES = 64 * 1024
const MAX_DIAGNOSTIC_READ_BYTES = 256 * 1024
const MAX_RESTART_FUSE_READ_BYTES = 4 * 1024
export const DEFAULT_CONTAINER_RESTART_FUSE_COOLDOWN_MS = 15 * 60_000
const STALE_ATOMIC_WRITE_MS = 5 * 60_000
const WORKER_DIAGNOSTIC_FORMAT_VERSION = 1
const CGROUP_MEMORY_EVENT_KEYS = [
  'low',
  'high',
  'max',
  'oom',
  'oom_kill',
  'oom_group_kill',
]
const WORKER_ERROR_CODES = new Set([
  'EACCES',
  'EAGAIN',
  'EMFILE',
  'ENOENT',
  'ENOMEM',
])

export const WORKER_EXIT_LOG_RELATIVE_PATH = path.join(
  'diagnostics',
  'server-worker-exits.jsonl',
)
export const WORKER_STATUS_RELATIVE_PATH = path.join(
  'diagnostics',
  'server-worker-status.json',
)
export const WORKER_FATAL_STATUS_RELATIVE_PATH = path.join(
  'diagnostics',
  'server-worker-fatal.json',
)
export const CONTAINER_RESTART_FUSE_RELATIVE_PATH = path.join(
  'diagnostics',
  'container-restart-fuse.json',
)

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer = null
    const finish = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function safeSignal(value) {
  return typeof value === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(value)
    ? value
    : null
}

function safeWorkerErrorCode(value) {
  return WORKER_ERROR_CODES.has(value) ? value : null
}

function safeRecordedAt(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : value
  return Number.isFinite(timestamp)
    && timestamp >= 0
    && timestamp <= 8_640_000_000_000_000
    ? new Date(timestamp).toISOString()
    : new Date().toISOString()
}

function parseCgroupNumber(value, { allowMax = false } = {}) {
  const text = String(value ?? '').trim()
  if (allowMax && text === 'max') return 'max'
  if (!/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return safeNonNegativeInteger(parsed)
}

function parseCgroupMemoryEvents(value) {
  const parsed = {}
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const [key, rawCount, ...remainder] = line.trim().split(/\s+/)
    if (remainder.length > 0 || !CGROUP_MEMORY_EVENT_KEYS.includes(key)) continue
    const count = parseCgroupNumber(rawCount)
    if (count !== null) parsed[key] = count
  }
  return Object.keys(parsed).length > 0 ? parsed : null
}

function sanitizeCgroupEvents(events) {
  if (!events || typeof events !== 'object') return null
  const sanitized = {}
  for (const key of CGROUP_MEMORY_EVENT_KEYS) {
    const value = safeNonNegativeInteger(events[key])
    if (value !== null) sanitized[key] = value
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function sanitizeCgroupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  const currentBytes = safeNonNegativeInteger(snapshot.currentBytes)
  const maxBytes = snapshot.maxBytes === 'max'
    ? 'max'
    : safeNonNegativeInteger(snapshot.maxBytes)
  const events = sanitizeCgroupEvents(snapshot.events)
  if (currentBytes === null && maxBytes === null && !events) return null
  return { currentBytes, maxBytes, events }
}

async function readOptionalUtf8(filePath, readFile) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function readOptionalUtf8Sync(filePath, readFile) {
  try {
    return readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function readCgroupMemorySnapshot(options = {}) {
  if ((options.platform ?? process.platform) !== 'linux') return null
  const cgroupRoot = options.cgroupRoot ?? DEFAULT_CGROUP_ROOT
  const readFile = options.readFile ?? fs.readFile
  const [current, maximum, events] = await Promise.all([
    readOptionalUtf8(path.join(cgroupRoot, 'memory.current'), readFile),
    readOptionalUtf8(path.join(cgroupRoot, 'memory.max'), readFile),
    readOptionalUtf8(path.join(cgroupRoot, 'memory.events'), readFile),
  ])
  return sanitizeCgroupSnapshot({
    currentBytes: parseCgroupNumber(current),
    maxBytes: parseCgroupNumber(maximum, { allowMax: true }),
    events: parseCgroupMemoryEvents(events),
  })
}

export function readCgroupMemorySnapshotSync(options = {}) {
  if ((options.platform ?? process.platform) !== 'linux') return null
  const cgroupRoot = options.cgroupRoot ?? DEFAULT_CGROUP_ROOT
  const readFile = options.readFile ?? readFileSync
  return sanitizeCgroupSnapshot({
    currentBytes: parseCgroupNumber(readOptionalUtf8Sync(
      path.join(cgroupRoot, 'memory.current'),
      readFile,
    )),
    maxBytes: parseCgroupNumber(readOptionalUtf8Sync(
      path.join(cgroupRoot, 'memory.max'),
      readFile,
    ), { allowMax: true }),
    events: parseCgroupMemoryEvents(readOptionalUtf8Sync(
      path.join(cgroupRoot, 'memory.events'),
      readFile,
    )),
  })
}

function cgroupEventDeltas(before, after) {
  if (!before?.events || !after?.events) return null
  const deltas = {}
  for (const key of CGROUP_MEMORY_EVENT_KEYS) {
    const previous = safeNonNegativeInteger(before?.events?.[key])
    const current = safeNonNegativeInteger(after?.events?.[key])
    if (previous === null || current === null) continue
    deltas[key] = Math.max(0, current - previous)
  }
  return Object.keys(deltas).length > 0 ? deltas : null
}

export function buildCgroupMemoryExitEvidence(beforeSnapshot, afterSnapshot) {
  const before = sanitizeCgroupSnapshot(beforeSnapshot)
  const after = sanitizeCgroupSnapshot(afterSnapshot)
  if (!after) return null
  const eventDeltas = cgroupEventDeltas(before, after)
  return {
    ...after,
    eventDeltas,
    oomEventDeltaObserved: eventDeltas
      ? (eventDeltas.oom ?? 0) > 0
      : null,
    oomKillDeltaObserved: eventDeltas
      ? (eventDeltas.oom_kill ?? 0) > 0
        || (eventDeltas.oom_group_kill ?? 0) > 0
      : null,
  }
}

function sanitizeCgroupExitEvidence(evidence) {
  const snapshot = sanitizeCgroupSnapshot(evidence)
  if (!snapshot) return null
  const eventDeltas = sanitizeCgroupEvents(evidence?.eventDeltas)
  return {
    ...snapshot,
    eventDeltas,
    oomEventDeltaObserved: typeof evidence?.oomEventDeltaObserved === 'boolean'
      ? evidence.oomEventDeltaObserved
      : null,
    oomKillDeltaObserved: typeof evidence?.oomKillDeltaObserved === 'boolean'
      ? evidence.oomKillDeltaObserved
      : null,
  }
}

function sanitizeWorkerExitEvent(event) {
  const allowedReasons = new Set([
    'boot_rollback_restart',
    'boot_claim_failed',
    'clean_exit',
    'recovery_failed',
    'restart_budget_exhausted',
    'runtime_preparation_restart_budget_exhausted',
    'spawn_failed',
    'supervisor_shutdown',
    'unexpected_exit',
    'update_restart',
  ])
  return {
    formatVersion: WORKER_DIAGNOSTIC_FORMAT_VERSION,
    recordedAt: safeRecordedAt(event?.recordedAt ?? event?.recordedAtMs),
    type: 'worker_exit',
    reason: allowedReasons.has(event?.reason) ? event.reason : 'unexpected_exit',
    pid: safeNonNegativeInteger(event?.pid),
    code: safeNonNegativeInteger(event?.code),
    signal: safeSignal(event?.signal),
    uptimeMs: safeNonNegativeInteger(event?.uptimeMs) ?? 0,
    rapidRestartCount: safeNonNegativeInteger(event?.rapidRestartCount) ?? 0,
    restartDelayMs: safeNonNegativeInteger(event?.restartDelayMs),
    workerError: event?.workerError === true,
    workerErrorCode: safeWorkerErrorCode(event?.workerErrorCode),
    cgroupMemory: sanitizeCgroupExitEvidence(event?.cgroupMemory),
  }
}

function temporaryAtomicPath(filePath) {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
}

async function cleanupStaleAtomicWrites(filePath) {
  const directory = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}.tmp-`
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  const cutoff = Date.now() - STALE_ATOMIC_WRITE_MS
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map(async (entry) => {
      const candidate = path.join(directory, entry.name)
      try {
        if ((await fs.stat(candidate)).mtimeMs <= cutoff) await fs.unlink(candidate)
      } catch {
        // Cleanup is best effort; the bounded journal write remains independent.
      }
    }))
}

function cleanupStaleAtomicWritesSync(filePath) {
  const directory = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}.tmp-`
  const cutoff = Date.now() - STALE_ATOMIC_WRITE_MS
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(prefix)) continue
      const candidate = path.join(directory, entry.name)
      try {
        if (statSync(candidate).mtimeMs <= cutoff) unlinkSync(candidate)
      } catch {
        // Fatal-path cleanup must never alter process termination behavior.
      }
    }
  } catch {
    // The diagnostics directory may not exist yet.
  }
}

async function atomicWriteText(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await cleanupStaleAtomicWrites(filePath)
  const temporaryPath = temporaryAtomicPath(filePath)
  let handle = null
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporaryPath, filePath)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(temporaryPath).catch(() => undefined)
  }
}

async function readExistingWorkerExitLines(filePath, maxBytes) {
  let handle = null
  try {
    handle = await fs.open(filePath, 'r')
    const stat = await handle.stat()
    const readBytes = Math.min(
      stat.size,
      Math.max(4_096, Math.min(maxBytes * 2, MAX_DIAGNOSTIC_READ_BYTES)),
    )
    if (readBytes <= 0) return []
    const buffer = Buffer.alloc(readBytes)
    const start = Math.max(0, stat.size - readBytes)
    const { bytesRead } = await handle.read(buffer, 0, readBytes, start)
    let contents = buffer.subarray(0, bytesRead).toString('utf8')
    if (start > 0) {
      const firstNewline = contents.indexOf('\n')
      contents = firstNewline >= 0 ? contents.slice(firstNewline + 1) : ''
    }
    const lines = []
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        lines.push(JSON.stringify(sanitizeWorkerExitEvent(JSON.parse(line))))
      } catch {
        // A partial or corrupt prior line is discarded during the bounded rewrite.
      }
    }
    return lines
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function persistWorkerExitDiagnostic(storageRoot, event, options = {}) {
  // A storage root has exactly one active container supervisor. Replacing the
  // complete bounded file atomically protects readers from partial JSONL.
  const maxEntries = Math.max(
    1,
    safeNonNegativeInteger(options.maxEntries) ?? DEFAULT_WORKER_EXIT_MAX_ENTRIES,
  )
  const maxBytes = Math.max(
    1_024,
    safeNonNegativeInteger(options.maxBytes) ?? DEFAULT_WORKER_EXIT_MAX_BYTES,
  )
  const diagnostic = sanitizeWorkerExitEvent(event)
  const logPath = path.join(storageRoot, WORKER_EXIT_LOG_RELATIVE_PATH)
  const statusPath = path.join(storageRoot, WORKER_STATUS_RELATIVE_PATH)
  const lines = await readExistingWorkerExitLines(logPath, maxBytes)
  lines.push(JSON.stringify(diagnostic))
  while (lines.length > maxEntries) lines.shift()
  while (lines.length > 1 && Buffer.byteLength(`${lines.join('\n')}\n`) > maxBytes) {
    lines.shift()
  }
  const logContents = Buffer.byteLength(`${lines.join('\n')}\n`) <= maxBytes
    ? `${lines.join('\n')}\n`
    : ''
  await atomicWriteText(logPath, logContents)
  await atomicWriteText(statusPath, `${JSON.stringify({
    formatVersion: WORKER_DIAGNOSTIC_FORMAT_VERSION,
    updatedAt: diagnostic.recordedAt,
    latest: diagnostic,
  }, null, 2)}\n`)
  return diagnostic
}

function sanitizeContainerRestartFuse(value) {
  const trippedAtMs = safeNonNegativeInteger(value?.trippedAtMs)
  const retryAfterMs = safeNonNegativeInteger(value?.retryAfterMs)
  if (value?.formatVersion !== 1 || trippedAtMs === null || retryAfterMs === null) {
    return null
  }
  if (retryAfterMs < trippedAtMs || retryAfterMs - trippedAtMs > 24 * 60 * 60_000) {
    return null
  }
  const allowedReasons = new Set([
    'boot_claim_failed',
    'recovery_failed',
    'restart_budget_exhausted',
    'runtime_preparation_restart_budget_exhausted',
  ])
  return {
    formatVersion: 1,
    trippedAtMs,
    retryAfterMs,
    reason: allowedReasons.has(value?.reason)
      ? value.reason
      : 'restart_budget_exhausted',
    rapidRestartCount: safeNonNegativeInteger(value?.rapidRestartCount) ?? 0,
  }
}

export async function readContainerRestartFuse(storageRoot) {
  const filePath = path.join(storageRoot, CONTAINER_RESTART_FUSE_RELATIVE_PATH)
  let handle = null
  try {
    handle = await fs.open(filePath, 'r')
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_RESTART_FUSE_READ_BYTES) {
      throw Object.assign(new Error('Invalid container restart fuse file.'), {
        code: 'INVALID_CONTAINER_RESTART_FUSE',
      })
    }
    const value = sanitizeContainerRestartFuse(JSON.parse(await handle.readFile('utf8')))
    if (!value) {
      throw Object.assign(new Error('Invalid container restart fuse payload.'), {
        code: 'INVALID_CONTAINER_RESTART_FUSE',
      })
    }
    return value
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function tripContainerRestartFuse(storageRoot, event, options = {}) {
  const trippedAtMs = safeNonNegativeInteger(event?.recordedAtMs) ?? Date.now()
  const cooldownMs = Math.max(
    60_000,
    Math.min(
      24 * 60 * 60_000,
      safeNonNegativeInteger(options.cooldownMs)
        ?? DEFAULT_CONTAINER_RESTART_FUSE_COOLDOWN_MS,
    ),
  )
  const fuse = sanitizeContainerRestartFuse({
    formatVersion: 1,
    trippedAtMs,
    retryAfterMs: trippedAtMs + cooldownMs,
    reason: event?.reason,
    rapidRestartCount: event?.rapidRestartCount,
  })
  const filePath = path.join(storageRoot, CONTAINER_RESTART_FUSE_RELATIVE_PATH)
  await atomicWriteText(filePath, `${JSON.stringify(fuse, null, 2)}\n`)
  return fuse
}

export async function clearContainerRestartFuse(storageRoot) {
  const filePath = path.join(storageRoot, CONTAINER_RESTART_FUSE_RELATIVE_PATH)
  await fs.unlink(filePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

function safeProcessMemory(processRef) {
  try {
    const memory = processRef.memoryUsage()
    return {
      rssBytes: safeNonNegativeInteger(memory?.rss),
      heapTotalBytes: safeNonNegativeInteger(memory?.heapTotal),
      heapUsedBytes: safeNonNegativeInteger(memory?.heapUsed),
      externalBytes: safeNonNegativeInteger(memory?.external),
      arrayBuffersBytes: safeNonNegativeInteger(memory?.arrayBuffers),
    }
  } catch {
    return null
  }
}

function safeProcessResources(processRef) {
  try {
    const resources = processRef.resourceUsage()
    return {
      userCpuTimeMicros: safeNonNegativeInteger(resources?.userCPUTime),
      systemCpuTimeMicros: safeNonNegativeInteger(resources?.systemCPUTime),
      maxRssKb: safeNonNegativeInteger(resources?.maxRSS),
      fsRead: safeNonNegativeInteger(resources?.fsRead),
      fsWrite: safeNonNegativeInteger(resources?.fsWrite),
      involuntaryContextSwitches: safeNonNegativeInteger(
        resources?.involuntaryContextSwitches,
      ),
    }
  } catch {
    return null
  }
}

export function writeWorkerFatalDiagnosticSync(storageRoot, event, options = {}) {
  const processRef = options.processRef ?? process
  const fatalType = event?.fatalType === 'unhandled_rejection'
    ? 'unhandled_rejection'
    : 'uncaught_exception'
  const diagnostic = {
    formatVersion: WORKER_DIAGNOSTIC_FORMAT_VERSION,
    recordedAt: safeRecordedAt(event?.recordedAt ?? event?.recordedAtMs),
    type: 'worker_fatal',
    fatalType,
    pid: safeNonNegativeInteger(event?.pid ?? processRef.pid),
    code: safeNonNegativeInteger(event?.code) ?? 1,
    signal: safeSignal(event?.signal),
    processMemory: safeProcessMemory(processRef),
    processResources: safeProcessResources(processRef),
    cgroupMemory: sanitizeCgroupSnapshot(
      options.cgroupMemory
      ?? readCgroupMemorySnapshotSync(options),
    ),
  }
  const filePath = path.join(storageRoot, WORKER_FATAL_STATUS_RELATIVE_PATH)
  const temporaryPath = temporaryAtomicPath(filePath)
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    cleanupStaleAtomicWritesSync(filePath)
    writeFileSync(temporaryPath, `${JSON.stringify(diagnostic, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporaryPath, filePath)
    return true
  } catch {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // Fatal diagnostics are strictly best effort and must never mask the crash.
    }
    return false
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function collectRuntimeFiles(projectRoot) {
  const paths = []
  const visit = async (relativeRoot) => {
    const absoluteRoot = path.join(projectRoot, ...relativeRoot.split('/'))
    for (const entry of await fs.readdir(absoluteRoot, { withFileTypes: true })) {
      const relativePath = `${relativeRoot}/${entry.name}`
      if (entry.isDirectory()) {
        await visit(relativePath)
      } else if (entry.isFile()) {
        paths.push(relativePath)
      } else {
        throw new Error(`Container runtime contains an unsupported entry: ${relativePath}`)
      }
    }
  }
  for (const root of ['dist', 'server', 'tools']) await visit(root)
  paths.push('package.json', 'package-lock.json')
  const files = []
  for (const relativePath of paths.sort((left, right) => left.localeCompare(right))) {
    const filePath = path.join(projectRoot, ...relativePath.split('/'))
    const stat = await fs.stat(filePath)
    files.push({
      path: relativePath,
      size: stat.size,
      sha256: await sha256File(filePath),
    })
  }
  return files
}

function runtimeFingerprint(files) {
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
  return hash.digest('hex')
}

export async function createImageRuntimeManifest(projectRoot, manifestPath = CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH) {
  const currentPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const files = await collectRuntimeFiles(projectRoot)
  const manifest = {
    formatVersion: 1,
    appId: 'phd-atlas-container-runtime',
    version: currentPackage.version,
    contentSha256: runtimeFingerprint(files),
    files,
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

export async function readContainerImageRuntime(projectRoot, manifestPath = CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH) {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (
      manifest?.formatVersion !== 1
      || manifest?.appId !== 'phd-atlas-container-runtime'
      || typeof manifest?.version !== 'string'
      || !Array.isArray(manifest?.files)
      || runtimeFingerprint(manifest.files) !== manifest.contentSha256
    ) {
      throw new Error('The immutable container runtime manifest is invalid.')
    }
    return { version: manifest.version, manifest }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const currentPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  return { version: currentPackage.version, manifest: null }
}

export async function verifyImageRuntime(projectRoot, imageRuntime) {
  if (!imageRuntime?.manifest) return false
  try {
    const currentPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    if (currentPackage.version !== imageRuntime.version) return false
    const currentFiles = await collectRuntimeFiles(projectRoot)
    return runtimeFingerprint(currentFiles) === imageRuntime.manifest.contentSha256
      && JSON.stringify(currentFiles) === JSON.stringify(imageRuntime.manifest.files)
  } catch {
    return false
  }
}

export function restartDelayMs(rapidRestartCount) {
  return Math.min(1_000 * (2 ** Math.max(0, rapidRestartCount - 1)), MAX_RESTART_DELAY_MS)
}

export function resolveContainerStorageRoot(projectRoot, configuredStorageRoot) {
  const expectedStorageRoot = path.resolve(projectRoot, 'storage')
  if (configuredStorageRoot === undefined || configuredStorageRoot === null) {
    return expectedStorageRoot
  }
  const configuredText = String(configuredStorageRoot).trim()
  if (!configuredText) return expectedStorageRoot
  const resolvedStorageRoot = path.resolve(configuredText)
  if (resolvedStorageRoot !== expectedStorageRoot) {
    throw Object.assign(new Error(
      `Container storage must remain mounted at ${expectedStorageRoot}; received ${resolvedStorageRoot}.`,
    ), {
      code: 'CONTAINER_STORAGE_ROOT_MISMATCH',
      expectedStorageRoot,
      resolvedStorageRoot,
    })
  }
  return resolvedStorageRoot
}

export async function waitForUpdateCompletion(storageRoot, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_WAIT_MS
  const pollMs = options.pollMs ?? DEFAULT_UPDATE_POLL_MS
  const sleep = options.sleep ?? delay
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (options.signal?.aborted) return
    const lock = await readUpdateLockState(storageRoot)
    if (!lock) return
    if (await isUpdateLockAbandoned(lock, {
      processExists: options.processExists,
      claimGraceMs: options.claimGraceMs,
      now: options.now,
    })) {
      if (!options.recoverAbandonedLock) {
        throw Object.assign(new Error('The update helper exited without clearing its lock.'), {
          code: 'UPDATE_LOCK_ABANDONED',
        })
      }
      await options.recoverAbandonedLock(lock)
      continue
    }
    if (Date.now() >= deadline) {
      throw Object.assign(new Error(`Update lock did not clear within ${timeoutMs}ms.`), {
        code: 'UPDATE_LOCK_TIMEOUT',
      })
    }
    await sleep(pollMs, options.signal)
  }
}

export function installProductionDependencies(cwd, options = {}) {
  return runProductionDependencyInstall(cwd, {
    ...options,
    storageRoot: options.storageRoot
      ?? process.env.PHD_ATLAS_STORAGE_ROOT
      ?? path.join(cwd, 'storage'),
    onAttempt: options.onAttempt ?? (({ source, index, total }) => {
      console.log(`[dependency-install] source ${index + 1}/${total}: ${source.label}`)
    }),
    onAttemptFailure: options.onAttemptFailure ?? (({ source, error }) => {
      console.error(`[dependency-install] ${source.label} failed: ${error?.message ?? error}`)
    }),
    onLine: options.onLine ?? (({ streamName, message }) => {
      const write = streamName === 'stderr' ? console.error : console.log
      write(`[dependency-install] ${message}`)
    }),
  })
}

function waitForWorker(child) {
  return new Promise((resolve) => {
    let settled = false
    child.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ code: 1, signal: null, error })
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal, error: null })
    })
  })
}

export async function runContainerSupervisor(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot)
  const storageRoot = options.storageRoot !== undefined
    ? path.resolve(options.storageRoot)
    : resolveContainerStorageRoot(projectRoot, process.env.PHD_ATLAS_STORAGE_ROOT)
  const logger = options.logger ?? console
  const processRef = options.processRef ?? process
  const now = options.now ?? Date.now
  const supervisorAbortController = new AbortController()
  const maxRapidWorkerRestarts = Math.max(
    1,
    safeNonNegativeInteger(options.maxRapidWorkerRestarts)
      ?? DEFAULT_MAX_RAPID_WORKER_RESTARTS,
  )
  const diagnosticWriteTimeoutMs = Math.max(
    1,
    safeNonNegativeInteger(options.diagnosticWriteTimeoutMs)
      ?? DEFAULT_DIAGNOSTIC_WRITE_TIMEOUT_MS,
  )
  const workerShutdownGraceMs = Math.max(
    1,
    safeNonNegativeInteger(options.workerShutdownGraceMs)
      ?? DEFAULT_WORKER_SHUTDOWN_GRACE_MS,
  )
  const readCgroupMemory = options.readCgroupMemory
    ?? (() => readCgroupMemorySnapshot({
      cgroupRoot: options.cgroupRoot,
      platform: options.platform,
    }))
  const recordWorkerExit = options.recordWorkerExit
    ?? ((event) => persistWorkerExitDiagnostic(
      storageRoot,
      event,
      options.workerDiagnostics,
    ))
  const readRestartFuse = options.readRestartFuse
    ?? (() => readContainerRestartFuse(storageRoot))
  const tripRestartFuse = options.tripRestartFuse
    ?? ((event) => tripContainerRestartFuse(storageRoot, event, {
      cooldownMs: options.restartFuseCooldownMs,
    }))
  const clearRestartFuse = options.clearRestartFuse
    ?? (() => clearContainerRestartFuse(storageRoot))
  const restartFuseCooldownMs = Math.max(
    60_000,
    safeNonNegativeInteger(options.restartFuseCooldownMs)
      ?? DEFAULT_CONTAINER_RESTART_FUSE_COOLDOWN_MS,
  )
  const installDependencies = options.installDependencies
    ?? ((cwd) => installProductionDependencies(cwd))
  const processExists = options.processExists
  const recordBootRollback = options.recordBootRollback ?? (async (recovery) => {
    if (!recovery?.rolledBack) return
    const failedVersion = recovery.result?.toVersion ?? recovery.marker?.toVersion ?? null
    const message = `The updated server did not complete its first boot; restored ${recovery.version}.`
    await patchSystemUpdateStatus(storageRoot, {
      phase: 'error',
      operationInFlight: false,
      restartPending: false,
      targetVersion: failedVersion,
      errorCode: 'UPDATE_BOOT_ROLLED_BACK',
      errorMessage: message,
    }).catch(() => undefined)
    await appendSystemUpdateLog(storageRoot, {
      level: 'error',
      phase: 'error',
      errorCode: 'UPDATE_BOOT_ROLLED_BACK',
      message,
    }).catch(() => undefined)
  })
  const recoverPendingRuntime = options.recoverPendingRuntime
    ?? (() => recoverAbandonedPendingUpdateBoot({
      projectRoot,
      storageRoot,
      installDependencies,
      processExists,
    }))
  const claimPendingBoot = options.claimPendingBoot
    ?? ((processId) => claimPendingUpdateBoot(storageRoot, processId, { processExists }))
  const releasePendingBoot = options.releasePendingBoot
    ?? ((processId) => releasePendingUpdateBootClaim(storageRoot, processId))
  const recoverStaleLock = options.recoverStaleLock
    ?? (() => recoverAbandonedUpdateLock({
      projectRoot,
      storageRoot,
      installDependencies,
      processExists,
    }))
  const waitForUpdate = options.waitForUpdate ?? ((root) => waitForUpdateCompletion(root, {
    processExists,
    recoverAbandonedLock: recoverStaleLock,
    signal: supervisorAbortController.signal,
  }))
  let imageRuntime = options.imageRuntime ?? null
  let baseVersion = options.baseVersion ?? imageRuntime?.version ?? null
  const prepareRuntime = options.prepareRuntime ?? (async () => {
    if (!imageRuntime) {
      imageRuntime = await readContainerImageRuntime(
        projectRoot,
        options.imageRuntimeManifestPath,
      )
      baseVersion ??= imageRuntime.version
    }
    await recordBootRollback(await recoverPendingRuntime())
    const baseRuntimeVerified = options.baseRuntimeVerified !== undefined
      ? options.baseRuntimeVerified
      : await verifyImageRuntime(projectRoot, imageRuntime)
    return replayActiveUpdateIfNeeded({
      projectRoot,
      storageRoot,
      baseVersion,
      baseRuntimeVerified,
      requireVerifiedBase: Boolean(imageRuntime.manifest),
      installDependencies,
    })
  })
  const spawnWorker = options.spawnWorker ?? (() => spawn(process.execPath, [
    path.join(projectRoot, 'tools', 'start-server.mjs'),
  ], {
    cwd: projectRoot,
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  }))

  let currentWorker = null
  let stopping = false
  let rapidRestartCount = 0
  let runtimePreparationFailureCount = 0
  let shutdownKillTimer = null
  let diagnosticsDisabled = false
  const waitForRestartDelay = async (ms) => {
    if (supervisorAbortController.signal.aborted) return
    if (!options.sleep) {
      await delay(ms, supervisorAbortController.signal)
      return
    }
    let interrupt = null
    const interrupted = new Promise((resolve) => {
      interrupt = resolve
      supervisorAbortController.signal.addEventListener('abort', resolve, { once: true })
    })
    try {
      await Promise.race([
        Promise.resolve().then(() => options.sleep(ms)),
        interrupted,
      ])
    } finally {
      supervisorAbortController.signal.removeEventListener('abort', interrupt)
    }
  }
  const recordWorkerExitBestEffort = async (event) => {
    if (diagnosticsDisabled) return
    let timeout = null
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => recordWorkerExit(event))
        .then(() => 'written', () => 'failed'),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), diagnosticWriteTimeoutMs)
      }),
    ])
    if (timeout) clearTimeout(timeout)
    if (outcome === 'written') return
    if (outcome === 'timeout') diagnosticsDisabled = true
    logger.error(outcome === 'timeout'
      ? '[container-entrypoint] Server worker diagnostics timed out and were disabled for this supervisor run.'
      : '[container-entrypoint] Could not persist the server worker exit diagnostic.')
  }
  const tripRestartFuseBestEffort = async (event) => {
    try {
      await tripRestartFuse(event)
      return true
    } catch (error) {
      logger.error(
        `[container-entrypoint] Could not persist the restart fuse; holding this container for ${restartFuseCooldownMs}ms before the runtime may retry.`,
        error,
      )
      await waitForRestartDelay(restartFuseCooldownMs)
      return false
    }
  }
  const forwardSignal = (signal) => {
    if (stopping) return
    stopping = true
    supervisorAbortController.abort()
    if (currentWorker && currentWorker.exitCode === null && currentWorker.signalCode === null) {
      const worker = currentWorker
      try {
        worker.kill(signal)
      } catch {
        logger.error('[container-entrypoint] Could not forward the shutdown signal to the server worker.')
      }
      if (worker.exitCode === null && worker.signalCode === null) {
        shutdownKillTimer = setTimeout(() => {
          if (worker.exitCode === null && worker.signalCode === null) {
            try {
              worker.kill('SIGKILL')
            } catch {
              logger.error('[container-entrypoint] Could not force-stop the unresponsive server worker.')
            }
          }
        }, workerShutdownGraceMs)
        shutdownKillTimer.unref?.()
      }
    }
  }
  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')
  processRef.on('SIGINT', onSigint)
  processRef.on('SIGTERM', onSigterm)

  try {
    let persistedFuse = null
    try {
      persistedFuse = await readRestartFuse()
    } catch (error) {
      logger.error('[container-entrypoint] Ignoring an invalid restart-fuse marker; inspect the diagnostics directory.', error)
    }
    if (persistedFuse && !stopping) {
      // A clock rollback or hand-edited marker must not create an unbounded
      // outage. The persisted interval itself is validated, then capped again
      // against this image's fixed cooldown policy.
      const remainingMs = Math.max(
        0,
        Math.min(restartFuseCooldownMs, persistedFuse.retryAfterMs - now()),
      )
      if (remainingMs > 0) {
        logger.error(
          `[container-entrypoint] Persistent restart fuse is open after ${persistedFuse.rapidRestartCount} rapid failures; delaying worker startup for ${remainingMs}ms.`,
        )
        await waitForRestartDelay(remainingMs)
      }
      if (!stopping) {
        await clearRestartFuse().catch((error) => {
          logger.error('[container-entrypoint] Could not clear the expired restart fuse.', error)
        })
      }
    }
    while (!stopping) {
      try {
        await waitForUpdate(storageRoot)
        if (stopping) break
        await prepareRuntime()
        // A recovered preparation path should not permanently consume the
        // rapid-worker budget. Preserve any real spawn/worker failures that
        // preceded it, while forgiving only the consecutive preparation
        // failures that this successful pass resolved.
        rapidRestartCount = Math.max(
          0,
          rapidRestartCount - runtimePreparationFailureCount,
        )
        runtimePreparationFailureCount = 0
      } catch (error) {
        if (stopping) break
        runtimePreparationFailureCount += 1
        rapidRestartCount += 1
        const restartBudgetExhausted = rapidRestartCount >= maxRapidWorkerRestarts
        const retryDelay = restartBudgetExhausted
          ? null
          : restartDelayMs(rapidRestartCount)
        if (restartBudgetExhausted) {
          await recordWorkerExitBestEffort({
            recordedAtMs: now(),
            reason: 'runtime_preparation_restart_budget_exhausted',
            pid: null,
            code: null,
            signal: null,
            uptimeMs: 0,
            rapidRestartCount,
            restartDelayMs: null,
            workerError: true,
            workerErrorCode: safeWorkerErrorCode(error?.code),
            cgroupMemory: null,
          })
          if (stopping) break
          logger.error('[container-entrypoint] Runtime preparation restart budget exhausted; handing recovery to the container runtime.', error)
          await tripRestartFuseBestEffort({
            recordedAtMs: now(),
            reason: 'runtime_preparation_restart_budget_exhausted',
            rapidRestartCount,
          })
          return 1
        }
        logger.error(`[container-entrypoint] Runtime preparation failed; retrying in ${retryDelay}ms.`, error)
        await waitForRestartDelay(retryDelay)
        continue
      }
      if (stopping) break

      let cgroupMemoryBefore = null
      try {
        cgroupMemoryBefore = await readCgroupMemory()
      } catch {
        logger.error('[container-entrypoint] Could not sample cgroup memory before starting the server worker.')
      }
      if (stopping) break
      const startedAt = now()
      try {
        currentWorker = spawnWorker()
      } catch (error) {
        currentWorker = null
        rapidRestartCount += 1
        const restartBudgetExhausted = rapidRestartCount >= maxRapidWorkerRestarts
        const retryDelay = restartBudgetExhausted
          ? null
          : restartDelayMs(rapidRestartCount)
        await recordWorkerExitBestEffort({
          recordedAtMs: now(),
          reason: restartBudgetExhausted
            ? 'restart_budget_exhausted'
            : 'spawn_failed',
          pid: null,
          code: null,
          signal: null,
          uptimeMs: 0,
          rapidRestartCount,
          restartDelayMs: retryDelay,
          workerError: true,
          workerErrorCode: error?.code,
          cgroupMemory: buildCgroupMemoryExitEvidence(
            cgroupMemoryBefore,
            cgroupMemoryBefore,
          ),
        })
        if (restartBudgetExhausted) {
          logger.error('[container-entrypoint] Server worker launch restart budget exhausted; handing recovery to the container runtime.')
          await tripRestartFuseBestEffort({
            recordedAtMs: now(),
            reason: 'restart_budget_exhausted',
            rapidRestartCount,
          })
          return 1
        }
        logger.error(`[container-entrypoint] Failed to start the server worker; retrying in ${retryDelay}ms.`)
        await waitForRestartDelay(retryDelay)
        continue
      }
      const worker = currentWorker
      const outcomePromise = waitForWorker(worker)
      try {
        if (Number.isSafeInteger(worker.pid) && worker.pid > 0) {
          await claimPendingBoot(worker.pid)
        }
      } catch (error) {
        logger.error('[container-entrypoint] Failed to claim the pending update boot for the server worker.', error)
        let forceStopTimer = null
        if (worker.exitCode === null && worker.signalCode === null) {
          try {
            worker.kill('SIGTERM')
          } catch {
            logger.error('[container-entrypoint] Could not stop the worker after its pending boot claim failed.')
          }
          if (worker.exitCode === null && worker.signalCode === null) {
            forceStopTimer = setTimeout(() => {
              if (worker.exitCode === null && worker.signalCode === null) {
                try {
                  worker.kill('SIGKILL')
                } catch {
                  logger.error('[container-entrypoint] Could not force-stop the worker after its pending boot claim failed.')
                }
              }
            }, workerShutdownGraceMs)
          }
        }
        const claimFailureOutcome = await outcomePromise
        if (forceStopTimer) clearTimeout(forceStopTimer)
        currentWorker = null
        const endedAt = now()
        let cgroupMemoryAfter = null
        try {
          cgroupMemoryAfter = await readCgroupMemory()
        } catch {
          logger.error('[container-entrypoint] Could not sample cgroup memory after the server worker exited.')
        }
        await recordWorkerExitBestEffort({
          recordedAtMs: endedAt,
          reason: 'boot_claim_failed',
          pid: worker.pid,
          code: claimFailureOutcome.code,
          signal: claimFailureOutcome.signal,
          uptimeMs: Math.max(0, endedAt - startedAt),
          rapidRestartCount: rapidRestartCount + 1,
          restartDelayMs: null,
          workerError: Boolean(claimFailureOutcome.error),
          cgroupMemory: buildCgroupMemoryExitEvidence(
            cgroupMemoryBefore,
            cgroupMemoryAfter,
          ),
        })
        await tripRestartFuseBestEffort({
          recordedAtMs: endedAt,
          reason: 'boot_claim_failed',
          rapidRestartCount: rapidRestartCount + 1,
        })
        return 1
      }
      const outcome = await outcomePromise
      if (shutdownKillTimer) {
        clearTimeout(shutdownKillTimer)
        shutdownKillTimer = null
      }
      currentWorker = null
      const endedAt = now()
      const uptimeMs = Math.max(0, endedAt - startedAt)
      let cgroupMemoryAfter = null
      try {
        cgroupMemoryAfter = await readCgroupMemory()
      } catch {
        logger.error('[container-entrypoint] Could not sample cgroup memory after the server worker exited.')
      }
      if (outcome.error) {
        logger.error('[container-entrypoint] Server worker emitted an error.', outcome.error)
      }

      let recovery = null
      let recoveryError = null
      if (!stopping && outcome.code !== UPDATE_RESTART_EXIT_CODE) {
        try {
          recovery = await recoverPendingRuntime()
          if (recovery?.rolledBack) {
            await recordBootRollback(recovery)
          }
        } catch (error) {
          recoveryError = error
        }
      }

      const plannedUpdateRestart = outcome.code === UPDATE_RESTART_EXIT_CODE
      const restartCandidate = !stopping && (
        plannedUpdateRestart
        || Boolean(recovery?.rolledBack)
        || !recoveryError
      )
      const nextRapidRestartCount = stopping || plannedUpdateRestart
        ? rapidRestartCount
        : recoveryError || recovery?.rolledBack
          ? rapidRestartCount + 1
          : (uptimeMs >= RAPID_EXIT_WINDOW_MS ? 0 : rapidRestartCount + 1)
      const restartBudgetExhausted = restartCandidate
        && outcome.code !== UPDATE_RESTART_EXIT_CODE
        && !recovery?.rolledBack
        && uptimeMs < RAPID_EXIT_WINDOW_MS
        && nextRapidRestartCount >= maxRapidWorkerRestarts
      const shouldRestart = restartCandidate && !restartBudgetExhausted
      const retryDelay = shouldRestart ? restartDelayMs(nextRapidRestartCount) : null
      const reason = stopping
        ? 'supervisor_shutdown'
        : restartBudgetExhausted
          ? 'restart_budget_exhausted'
          : outcome.code === UPDATE_RESTART_EXIT_CODE
            ? 'update_restart'
            : recoveryError
              ? 'recovery_failed'
              : recovery?.rolledBack
                ? 'boot_rollback_restart'
                : 'unexpected_exit'
      await recordWorkerExitBestEffort({
        recordedAtMs: endedAt,
        reason,
        pid: worker.pid,
        code: outcome.code,
        signal: outcome.signal,
        uptimeMs,
        rapidRestartCount: nextRapidRestartCount,
        restartDelayMs: retryDelay,
        workerError: Boolean(outcome.error),
        workerErrorCode: outcome.error?.code,
        cgroupMemory: buildCgroupMemoryExitEvidence(
          cgroupMemoryBefore,
          cgroupMemoryAfter,
        ),
      })

      if (stopping) {
        if (Number.isSafeInteger(worker.pid) && worker.pid > 0) {
          await releasePendingBoot(worker.pid).catch((error) => {
            logger.error('[container-entrypoint] Failed to release the pending boot claim during shutdown.', error)
          })
        }
        return 0
      }
      if (recoveryError) {
        logger.error('[container-entrypoint] Server startup failed and automatic update rollback could not complete.', recoveryError)
        await tripRestartFuseBestEffort({
          recordedAtMs: endedAt,
          reason: 'recovery_failed',
          rapidRestartCount: nextRapidRestartCount,
        })
        return 1
      }
      if (recovery?.rolledBack) {
        rapidRestartCount = nextRapidRestartCount
        logger.error(
          `[container-entrypoint] The updated runtime failed before boot confirmation; restored ${recovery.version} and retrying in ${retryDelay}ms.`,
        )
        await waitForRestartDelay(retryDelay)
        continue
      }
      if (outcome.code !== UPDATE_RESTART_EXIT_CODE) {
        if (restartBudgetExhausted) {
          logger.error('[container-entrypoint] Rapid server worker restart budget exhausted; handing recovery to the container runtime.')
          await tripRestartFuseBestEffort({
            recordedAtMs: endedAt,
            reason: 'restart_budget_exhausted',
            rapidRestartCount: nextRapidRestartCount,
          })
          return Number.isInteger(outcome.code) && outcome.code !== 0 ? outcome.code : 1
        }
        rapidRestartCount = nextRapidRestartCount
        logger.error(
          `[container-entrypoint] Server worker stopped with ${outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`}; restarting in ${retryDelay}ms.`,
        )
        await waitForRestartDelay(retryDelay)
        continue
      }

      // The worker deliberately exits while its detached update helper keeps
      // running. Remaining alive here keeps the container up and, critically,
      // does not signal or reap that helper before it replaces the runtime.
      rapidRestartCount = nextRapidRestartCount
      try {
        await waitForUpdate(storageRoot)
      } catch (error) {
        if (stopping) continue
        logger.error('[container-entrypoint] Update helper did not finish cleanly; runtime preparation will remain fail-closed.', error)
        await patchSystemUpdateStatus(storageRoot, {
          phase: 'error',
          operationInFlight: false,
          restartPending: false,
          errorCode: error?.code ?? 'UPDATE_HELPER_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
        await appendSystemUpdateLog(storageRoot, {
          level: 'error',
          phase: 'error',
          errorCode: error?.code ?? 'UPDATE_HELPER_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
      }
      if (stopping) continue
      logger.info(`[container-entrypoint] Update restart requested; restarting the server worker in ${retryDelay}ms.`)
      await waitForRestartDelay(retryDelay)
    }
    return 0
  } finally {
    processRef.off('SIGINT', onSigint)
    processRef.off('SIGTERM', onSigterm)
    supervisorAbortController.abort()
    if (shutdownKillTimer) clearTimeout(shutdownKillTimer)
    if (currentWorker && currentWorker.exitCode === null && currentWorker.signalCode === null) {
      currentWorker.kill('SIGTERM')
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  if (process.argv[2] === '--write-image-manifest') {
    const manifestPath = path.resolve(process.argv[3] ?? CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH)
    await createImageRuntimeManifest(defaultProjectRoot, manifestPath)
  } else {
    const exitCode = await runContainerSupervisor()
    process.exitCode = exitCode
  }
}
