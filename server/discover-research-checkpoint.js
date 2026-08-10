import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decryptPayload, encryptPayload, isEncryptedPayload } from './crypto.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const root = process.env.NODE_ENV === 'test'
  ? path.join(projectRoot, 'logs', 'tmp', `discover-research-jobs-${process.pid}`)
  : path.join(process.env.PHD_ATLAS_STORAGE_ROOT
      ? path.resolve(process.env.PHD_ATLAS_STORAGE_ROOT)
      : path.join(projectRoot, 'storage'), 'discover-research-jobs')

const RETRYABLE_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EEXIST', 'EPERM'])
export const DISCOVER_RESEARCH_PIPELINE_VERSION = 2
export const DISCOVER_RESEARCH_CHECKPOINT_DEFAULT_TTL_MS = 72 * 60 * 60 * 1_000

const DEFAULT_CHECKPOINT_MAX_BYTES = 32 * 1024 * 1024
const CHECKPOINT_CLEANUP_INTERVAL_MS = 60_000
const CHECKPOINT_CLEANUP_SCAN_LIMIT = 128
const CHECKPOINT_CLEANUP_DELETE_LIMIT = 64
const CHECKPOINT_ARTIFACT_GRACE_MS = 15 * 60 * 1_000
const JOB_ARTIFACT_SCAN_LIMIT = 2_048
const JOB_ARTIFACT_LIMIT = 128
const CHECKPOINT_FILE_PATTERN = /^[a-z0-9_-]{1,100}\.json(?:\.(?:tmp|previous)-[a-z0-9_-]+)?$/i

let lastCleanupAt = 0
let cleanupPromise = null

function boundedEnvironmentNumber(name, fallback, min, max) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0
    ? Math.max(min, Math.min(max, value))
    : fallback
}

export function discoverResearchCheckpointTtlMs() {
  const hours = boundedEnvironmentNumber(
    'DISCOVER_RESEARCH_CHECKPOINT_TTL_HOURS',
    DISCOVER_RESEARCH_CHECKPOINT_DEFAULT_TTL_MS / 3_600_000,
    1 / 3_600,
    24 * 365,
  )
  return Math.round(hours * 3_600_000)
}

function discoverResearchCheckpointMaxBytes() {
  return Math.round(boundedEnvironmentNumber(
    'DISCOVER_RESEARCH_CHECKPOINT_MAX_BYTES',
    DEFAULT_CHECKPOINT_MAX_BYTES,
    1_024,
    256 * 1024 * 1024,
  ))
}

function discoverResearchCheckpointMaxFileBytes() {
  return Math.ceil(discoverResearchCheckpointMaxBytes() * 1.5) + 4_096
}

function checkpointError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isRecoverableCheckpointError(error) {
  return error instanceof SyntaxError || [
    'DISCOVER_CHECKPOINT_CORRUPT',
    'DISCOVER_CHECKPOINT_EXPIRED',
    'DISCOVER_CHECKPOINT_TOO_LARGE',
  ].includes(error?.code)
}

function checkpointTimestamp(value, fallback) {
  const timestamp = Date.parse(String(value?.updatedAt || ''))
  // The file timestamp is controlled by the storage boundary. Never let a
  // malformed or far-future payload bypass expiry indefinitely.
  return Number.isFinite(timestamp) ? Math.min(timestamp, fallback) : fallback
}

async function readCheckpointFile(target, now = Date.now()) {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw checkpointError('DISCOVER_CHECKPOINT_CORRUPT', 'Discover research checkpoint path is not a regular file.')
  }
  if (stat.size > discoverResearchCheckpointMaxFileBytes()) {
    throw checkpointError('DISCOVER_CHECKPOINT_TOO_LARGE', 'Discover research checkpoint exceeds the configured size limit.')
  }
  const serialized = await fs.readFile(target, 'utf8')
  const encrypted = isEncryptedPayload(serialized)
  const plaintext = encrypted ? decryptPayload(serialized) : serialized
  if (encrypted && (plaintext === serialized || isEncryptedPayload(plaintext))) {
    throw checkpointError('DISCOVER_CHECKPOINT_CORRUPT', 'Discover research checkpoint authentication failed.')
  }
  if (Buffer.byteLength(plaintext, 'utf8') > discoverResearchCheckpointMaxBytes()) {
    throw checkpointError('DISCOVER_CHECKPOINT_TOO_LARGE', 'Discover research checkpoint plaintext exceeds the configured size limit.')
  }
  const value = JSON.parse(plaintext)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw checkpointError('DISCOVER_CHECKPOINT_CORRUPT', 'Discover research checkpoint must contain an object.')
  }
  if (now - checkpointTimestamp(value, stat.mtimeMs) > discoverResearchCheckpointTtlMs()) {
    throw checkpointError('DISCOVER_CHECKPOINT_EXPIRED', 'Discover research checkpoint expired.')
  }
  return { value, encrypted, mtimeMs: stat.mtimeMs }
}

async function listJobArtifacts(target, prefixes, limit = JOB_ARTIFACT_LIMIT) {
  const directory = path.dirname(target)
  const output = []
  let scanned = 0
  let handle
  try {
    handle = await fs.opendir(directory)
    for await (const entry of handle) {
      scanned += 1
      if (scanned > JOB_ARTIFACT_SCAN_LIMIT || output.length >= limit) break
      if (!entry.isFile() || !prefixes.some((prefix) => entry.name.startsWith(prefix))) continue
      output.push(path.join(directory, entry.name))
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return output
}

async function removeStaleJobArtifacts(target, now = Date.now()) {
  const basename = path.basename(target)
  const artifacts = await listJobArtifacts(target, [
    `${basename}.tmp-`,
    `${basename}.previous-`,
  ])
  await Promise.all(artifacts.map(async (artifact) => {
    try {
      const stat = await fs.stat(artifact)
      if (now - stat.mtimeMs <= CHECKPOINT_ARTIFACT_GRACE_MS) return
      await fs.rm(artifact, { force: true })
    } catch {
      // Artifact cleanup is best effort and must not invalidate a good target.
    }
  }))
}

export async function cleanupDiscoverResearchCheckpoints({ now = Date.now() } = {}) {
  const ttlMs = discoverResearchCheckpointTtlMs()
  let scanned = 0
  let deleted = 0
  let handle
  try {
    handle = await fs.opendir(root)
    for await (const entry of handle) {
      scanned += 1
      if (scanned > CHECKPOINT_CLEANUP_SCAN_LIMIT || deleted >= CHECKPOINT_CLEANUP_DELETE_LIMIT) break
      if (!entry.isFile() || !CHECKPOINT_FILE_PATTERN.test(entry.name)) continue
      const target = path.join(root, entry.name)
      try {
        const stat = await fs.stat(target)
        const maximumAge = entry.name.includes('.tmp-') ? CHECKPOINT_ARTIFACT_GRACE_MS : ttlMs
        if (now - stat.mtimeMs <= maximumAge) continue
        await fs.rm(target, { force: true })
        deleted += 1
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { scanned: Math.min(scanned, CHECKPOINT_CLEANUP_SCAN_LIMIT), deleted }
}

async function maybeCleanupDiscoverResearchCheckpoints() {
  const now = Date.now()
  if (cleanupPromise) return cleanupPromise
  if (now - lastCleanupAt < CHECKPOINT_CLEANUP_INTERVAL_MS) return undefined
  cleanupPromise = cleanupDiscoverResearchCheckpoints({ now })
    .catch(() => undefined)
    .finally(() => {
      lastCleanupAt = Date.now()
      cleanupPromise = null
    })
  return cleanupPromise
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function replaceCheckpoint(temporary, target) {
  try {
    await fs.rename(temporary, target)
    return
  } catch (error) {
    if (!RETRYABLE_RENAME_CODES.has(error?.code)) throw error
  }
  const previous = `${target}.previous-${process.pid}-${Date.now()}`
  let movedPrevious = false
  try {
    try {
      await fs.rename(target, previous)
      movedPrevious = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(temporary, target)
        // Promotion is already committed once rename succeeds. A transient
        // cleanup failure must not turn a successful durable write into a
        // reported failure that callers may retry and duplicate.
        if (movedPrevious) await fs.rm(previous, { force: true }).catch(() => undefined)
        return
      } catch (error) {
        if (!RETRYABLE_RENAME_CODES.has(error?.code) || attempt === 5) throw error
        await sleep(25 * (2 ** attempt))
      }
    }
  } catch (error) {
    if (movedPrevious) {
      try {
        await fs.access(target)
      } catch {
        await fs.rename(previous, target).catch(() => undefined)
      }
    }
    throw error
  }
}

export function isDiscoverResearchCheckpointCompatible(checkpoint, state) {
  if (checkpoint?.pipelineVersion !== DISCOVER_RESEARCH_PIPELINE_VERSION) return false
  const checkpointIntake = checkpoint?.workingState?.intake
  const currentIntake = state?.intake
  if (!checkpointIntake || !currentIntake) return false
  return JSON.stringify(checkpointIntake) === JSON.stringify(currentIntake)
}

function checkpointPath(jobId) {
  const safe = String(jobId || '').trim()
  if (!/^[a-z0-9_-]{1,100}$/i.test(safe)) throw new Error('Invalid Discover research job id.')
  const target = path.resolve(root, `${safe}.json`)
  if (path.dirname(target) !== path.resolve(root)) throw new Error('Invalid Discover research checkpoint path.')
  return target
}

export async function readDiscoverResearchCheckpoint(jobId) {
  const target = checkpointPath(jobId)
  await maybeCleanupDiscoverResearchCheckpoints()
  try {
    const { value } = await readCheckpointFile(target)
    await removeStaleJobArtifacts(target)
    return value
  } catch (error) {
    if (error?.code === 'DISCOVER_CHECKPOINT_EXPIRED') {
      await fs.rm(target, { force: true }).catch(() => undefined)
    } else if (error?.code !== 'ENOENT' && !isRecoverableCheckpointError(error)) {
      throw error
    }
  }
  const prefix = `${path.basename(target)}.previous-`
  const candidates = await listJobArtifacts(target, [prefix], 64)
  const newest = (await Promise.all(candidates.map(async (candidate) => {
    try {
      return { candidate, mtimeMs: (await fs.stat(candidate)).mtimeMs }
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }))).filter(Boolean).sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const { candidate } of newest) {
    try {
      const { value } = await readCheckpointFile(candidate)
      await replaceCheckpoint(candidate, target)
      await removeStaleJobArtifacts(target)
      return value && typeof value === 'object' ? value : null
    } catch (error) {
      if (error?.code === 'DISCOVER_CHECKPOINT_EXPIRED') {
        await fs.rm(candidate, { force: true }).catch(() => undefined)
      } else if (!isRecoverableCheckpointError(error) && error?.code !== 'ENOENT') {
        throw error
      }
      // Continue to an older complete checkpoint if this one was interrupted.
    }
  }
  return null
}

export async function writeDiscoverResearchCheckpoint(jobId, value) {
  const target = checkpointPath(jobId)
  await maybeCleanupDiscoverResearchCheckpoints()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    // sourceIndex is a deterministic projection of crawls and accounted for
    // more than half of large checkpoints. Rebuild it on resume instead of
    // synchronously serializing the same page evidence twice on every batch.
    const { sourceIndex: _derivedSourceIndex, ...durableValue } = value || {}
    const plaintext = JSON.stringify({
      ...durableValue,
      version: 1,
      pipelineVersion: DISCOVER_RESEARCH_PIPELINE_VERSION,
      updatedAt: new Date().toISOString(),
    })
    if (Buffer.byteLength(plaintext, 'utf8') > discoverResearchCheckpointMaxBytes()) {
      throw checkpointError('DISCOVER_CHECKPOINT_TOO_LARGE', 'Discover research checkpoint exceeds the configured size limit.')
    }
    const encrypted = encryptPayload(plaintext)
    if (!isEncryptedPayload(encrypted) || Buffer.byteLength(encrypted, 'utf8') > discoverResearchCheckpointMaxFileBytes()) {
      throw checkpointError('DISCOVER_CHECKPOINT_TOO_LARGE', 'Encrypted Discover research checkpoint exceeds the configured size limit.')
    }
    await fs.writeFile(temporary, encrypted, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await replaceCheckpoint(temporary, target)
    await removeStaleJobArtifacts(target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function deleteDiscoverResearchCheckpoint(jobId) {
  const target = checkpointPath(jobId)
  await fs.rm(target, { force: true })
  const prefixes = [`${path.basename(target)}.tmp-`, `${path.basename(target)}.previous-`]
  const leftovers = await listJobArtifacts(target, prefixes)
  await Promise.all(leftovers.map((leftover) => fs.rm(leftover, { force: true }).catch(() => undefined)))
}

// A bounded, best-effort sweep at module load handles stale crash remnants
// before queue recovery. Reads and writes repeat the sweep on a throttled basis.
void maybeCleanupDiscoverResearchCheckpoints()
