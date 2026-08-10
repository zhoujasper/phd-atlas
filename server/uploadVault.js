import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { deriveSqliteKey, normalizeAlgorithm } from './crypto.js'

const MAGIC = Buffer.from('PHDUPLOAD2\n', 'utf8')
const HEADER_LENGTH_BYTES = 4
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_HEADER_BYTES = 64 * 1024
const JOURNAL_NAME = '.upload-vault-migration.json'
const JOURNAL_PREVIOUS_NAME = '.upload-vault-migration.previous.json'
const JOURNAL_TEMP_NAME = '.upload-vault-migration.next.json'
const MAIL_STAGE_PREFIX = '.mail-stage-v1-'
const UPLOAD_STAGE_PREFIX = '.upload-stage-v1-'
const MIGRATION_LOCK_DIRECTORY = '.upload-vault-migration.lock'
const MIGRATION_LOCK_OWNER = 'owner.json'
const MIGRATION_LOCK_RECLAIM = 'reclaim.json'
const MIGRATION_LOCK_RETRY_MS = 60
const MIGRATION_LOCK_OWNER_GRACE_MS = 2_000
const NEXT_SUFFIX = '.vault-next'
const PREVIOUS_SUFFIX = '.vault-previous'
const DEFAULT_MAX_CONCURRENT_IO = 2
const DEFAULT_MAX_QUEUED_IO = 64
const DEFAULT_MAX_IN_FLIGHT_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_QUEUED_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024
// Stay below the server's ordinary 30s idle timeout so an overloaded upload
// receives a structured 503/Retry-After instead of a reset socket.
const DEFAULT_QUEUE_TIMEOUT_MS = 20_000
const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 20_000
const DEFAULT_IO_CHUNK_BYTES = 256 * 1024
const STREAM_MEMORY_RESERVATION_BYTES = 512 * 1024
const MAXIMUM_ENVELOPE_OVERHEAD = MAGIC.length + HEADER_LENGTH_BYTES + MAX_HEADER_BYTES + IV_BYTES + TAG_BYTES

export class UploadVaultError extends Error {
  constructor(code, message, cause, details = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'UploadVaultError'
    this.code = code
    if (details.status) this.status = details.status
    if (details.retryAfterSeconds) this.retryAfterSeconds = details.retryAfterSeconds
    if (details.retryable) this.retryable = true
  }
}

function capacityError(message = 'Upload storage is busy. Please retry shortly.') {
  return new UploadVaultError('UPLOAD_VAULT_BUSY', message, undefined, {
    status: 503,
    retryAfterSeconds: 1,
    retryable: true,
  })
}

function cancelledError(cause) {
  return new UploadVaultError('UPLOAD_CANCELLED', 'Upload storage operation was cancelled.', cause, {
    status: 499,
    retryable: true,
  })
}

function migrationLockTimeoutError(timeoutMs) {
  return new UploadVaultError(
    'UPLOAD_MIGRATION_LOCK_TIMEOUT',
    `Upload storage migration remained locked for ${timeoutMs}ms. Please retry shortly.`,
    undefined,
    {
      status: 503,
      retryAfterSeconds: 1,
      retryable: true,
    },
  )
}

function migrationAttemptTimeoutError() {
  return new UploadVaultError(
    'UPLOAD_MIGRATION_TIMEOUT',
    'Upload storage migration exceeded its deadline. Please retry shortly.',
    undefined,
    {
      status: 503,
      retryAfterSeconds: 1,
      retryable: true,
    },
  )
}

function fileTooLargeError(maxBytes) {
  return new UploadVaultError(
    'UPLOAD_FILE_TOO_LARGE',
    `Stored upload exceeds the ${maxBytes}-byte file size limit.`,
    undefined,
    { status: 413 },
  )
}

function decryptedSizeLimitError(maxBytes) {
  return new UploadVaultError(
    'UPLOAD_DECRYPTED_SIZE_LIMIT',
    `Stored upload exceeds the ${maxBytes}-byte decrypted size limit.`,
    undefined,
    { status: 413 },
  )
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function configuredLimit(options, key, environmentName, fallback) {
  return positiveInteger(options[key] ?? process.env[environmentName], fallback)
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError(signal.reason)
}

/**
 * Fair, bounded admission for vault I/O. Shared jobs before the next exclusive
 * barrier may run in parallel when both the operation and byte budgets allow
 * it. An exclusive job (migration/backup) waits for every active shared job and
 * prevents later jobs from overtaking it.
 */
function createIoAdmission(options = {}) {
  const limits = Object.freeze({
    maxConcurrent: positiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT_IO),
    maxQueued: positiveInteger(options.maxQueued, DEFAULT_MAX_QUEUED_IO),
    maxInFlightBytes: positiveInteger(options.maxInFlightBytes, DEFAULT_MAX_IN_FLIGHT_BYTES),
    maxQueuedBytes: positiveInteger(options.maxQueuedBytes, DEFAULT_MAX_QUEUED_BYTES),
    queueTimeoutMs: positiveInteger(options.queueTimeoutMs, DEFAULT_QUEUE_TIMEOUT_MS),
  })
  const queue = []
  const activeKeys = new Map()
  let active = 0
  let activeBytes = 0
  let queuedBytes = 0
  let exclusiveActive = false
  let peakActive = 0
  let peakActiveBytes = 0
  let rejected = 0

  const removeQueued = (job) => {
    const index = queue.indexOf(job)
    if (index < 0) return false
    queue.splice(index, 1)
    queuedBytes -= job.bytes
    clearTimeout(job.timer)
    job.signal?.removeEventListener('abort', job.onAbort)
    return true
  }

  const release = (job) => {
    if (job.exclusive) {
      exclusiveActive = false
    } else {
      active -= 1
      activeBytes -= job.bytes
      if (job.key) {
        const state = activeKeys.get(job.key)
        if (state) {
          if (job.write) state.writer = false
          else state.readers -= 1
          if (!state.writer && state.readers <= 0) activeKeys.delete(job.key)
        }
      }
    }
    drain()
  }

  const start = (job) => {
    removeQueued(job)
    if (job.exclusive) {
      exclusiveActive = true
    } else {
      active += 1
      activeBytes += job.bytes
      if (job.key) {
        const state = activeKeys.get(job.key) ?? { readers: 0, writer: false }
        if (job.write) state.writer = true
        else state.readers += 1
        activeKeys.set(job.key, state)
      }
      peakActive = Math.max(peakActive, active)
      peakActiveBytes = Math.max(peakActiveBytes, activeBytes)
    }
    Promise.resolve()
      .then(() => {
        throwIfAborted(job.signal)
        return job.operation()
      })
      .then(job.resolve, job.reject)
      .finally(() => release(job))
  }

  function drain() {
    if (exclusiveActive || queue.length === 0) return
    if (queue[0]?.exclusive) {
      if (active === 0) start(queue[0])
      return
    }
    while (active < limits.maxConcurrent) {
      const exclusiveIndex = queue.findIndex((job) => job.exclusive)
      const sharedBoundary = exclusiveIndex < 0 ? queue.length : exclusiveIndex
      if (sharedBoundary === 0) break
      const sharedJobs = queue.slice(0, sharedBoundary)
      const candidate = sharedJobs.find((job, jobIndex) => {
        const earlierSameKey = job.key && sharedJobs
          .slice(0, jobIndex)
          .some((earlier) => earlier.key === job.key)
        const keyState = job.key ? activeKeys.get(job.key) : null
        const keyBusy = keyState && (job.write || keyState.writer)
        return !earlierSameKey && !keyBusy && activeBytes + job.bytes <= limits.maxInFlightBytes
      })
      if (!candidate) break
      start(candidate)
    }
  }

  const schedule = (operation, {
    bytes = 0,
    exclusive = false,
    key = '',
    write = false,
    signal,
  } = {}) => new Promise((resolve, reject) => {
    if (typeof operation !== 'function') {
      reject(new TypeError('Upload vault operation must be a function.'))
      return
    }
    if (signal?.aborted) {
      reject(cancelledError(signal.reason))
      return
    }
    const reservedBytes = Math.max(0, Number(bytes) || 0)
    if (!exclusive && reservedBytes > limits.maxInFlightBytes) {
      rejected += 1
      reject(capacityError('Upload storage does not have enough safe memory capacity for this file.'))
      return
    }
    if (queue.length >= limits.maxQueued || queuedBytes + reservedBytes > limits.maxQueuedBytes) {
      rejected += 1
      reject(capacityError())
      return
    }

    const job = {
      operation,
      bytes: exclusive ? 0 : reservedBytes,
      exclusive,
      key: exclusive ? '' : String(key || ''),
      write: !exclusive && Boolean(write),
      signal,
      resolve,
      reject,
      timer: null,
      onAbort: null,
    }
    job.onAbort = () => {
      if (!removeQueued(job)) return
      reject(cancelledError(signal.reason))
      drain()
    }
    job.timer = setTimeout(() => {
      if (!removeQueued(job)) return
      rejected += 1
      reject(capacityError('Upload storage remained busy for too long. Please retry.'))
      drain()
    }, limits.queueTimeoutMs)
    job.timer.unref?.()
    signal?.addEventListener('abort', job.onAbort, { once: true })
    queue.push(job)
    queuedBytes += job.bytes
    drain()
  })

  return {
    schedule,
    snapshot: () => ({
      active,
      activeBytes,
      exclusiveActive,
      queued: queue.length,
      queuedBytes,
      peakActive,
      peakActiveBytes,
      rejected,
      limits,
    }),
  }
}

function normalizedPolicy(policy = {}) {
  return {
    // User uploads have a stricter invariant than the optional database and
    // backup encryption switch: they are always encrypted at rest.
    encryptionAtRest: true,
    encryptionAlgorithm: normalizeAlgorithm(policy.encryptionAlgorithm),
    passwordBinding: String(policy.passwordBinding || ''),
  }
}

export function uploadEncryptionPolicy(settings = {}) {
  return {
    encryptionAtRest: true,
    encryptionAlgorithm: normalizeAlgorithm(settings.encryptionAlgorithm),
    passwordBinding: settings.encryptionPasswordEnabled
      ? String(settings.encryptionPasswordHash || '')
      : '',
  }
}

function profileForPolicy(policy) {
  const normalized = normalizedPolicy(policy)
  return {
    algorithm: normalized.encryptionAlgorithm,
    passwordBinding: normalized.passwordBinding,
  }
}

function profileMatchesPolicy(profile, policy) {
  const normalized = normalizedPolicy(policy)
  return Boolean(profile)
    && normalizeAlgorithm(profile.algorithm) === normalized.encryptionAlgorithm
    && String(profile.passwordBinding || '') === normalized.passwordBinding
}

function uploadKey(profile) {
  const masterKey = Buffer.from(deriveSqliteKey(), 'hex')
  return Buffer.from(hkdfSync(
    'sha256',
    masterKey,
    Buffer.from('phd-atlas-upload-v2', 'utf8'),
    Buffer.from(`upload-vault\0${String(profile.passwordBinding || '')}`, 'utf8'),
    32,
  ))
}

function headerForProfile(profile) {
  return Buffer.from(JSON.stringify({
    version: 2,
    algorithm: normalizeAlgorithm(profile.algorithm),
    passwordBinding: String(profile.passwordBinding || ''),
  }), 'utf8')
}

function envelopePrefix(profile, iv) {
  const header = headerForProfile(profile)
  if (header.length > MAX_HEADER_BYTES) {
    throw new UploadVaultError('UPLOAD_ENVELOPE_HEADER_TOO_LARGE', 'Upload encryption metadata is too large.')
  }
  const length = Buffer.alloc(HEADER_LENGTH_BYTES)
  length.writeUInt32BE(header.length)
  return Buffer.concat([MAGIC, length, header, iv])
}

function parseEnvelopeHeader(headerBytes) {
  let header
  try {
    header = JSON.parse(headerBytes.toString('utf8'))
  } catch (error) {
    throw new UploadVaultError('UPLOAD_ENVELOPE_INVALID', 'Encrypted upload metadata is invalid.', error)
  }
  if (header?.version !== 2 || !['aes-256-gcm', 'chacha20-poly1305'].includes(header?.algorithm)) {
    throw new UploadVaultError('UPLOAD_ENVELOPE_UNSUPPORTED', 'Encrypted upload format is unsupported.')
  }
  return {
    algorithm: normalizeAlgorithm(header.algorithm),
    passwordBinding: String(header.passwordBinding || ''),
  }
}

function resemblesEnvelopeWithInvalidMagic(source) {
  if (source.length < MAGIC.length + HEADER_LENGTH_BYTES + IV_BYTES + TAG_BYTES) return false
  const headerLength = source.readUInt32BE(MAGIC.length)
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) return false
  const headerStart = MAGIC.length + HEADER_LENGTH_BYTES
  const headerEnd = headerStart + headerLength
  if (headerEnd + IV_BYTES + TAG_BYTES > source.length) return false
  try {
    parseEnvelopeHeader(source.subarray(headerStart, headerEnd))
    return true
  } catch {
    return false
  }
}

function encodeUploadPayload(plain, policy) {
  const normalized = normalizedPolicy(policy)
  const source = Buffer.isBuffer(plain) ? plain : Buffer.from(plain ?? '')
  const profile = profileForPolicy(normalized)
  const iv = randomBytes(IV_BYTES)
  const prefix = envelopePrefix(profile, iv)
  const cipher = createCipheriv(profile.algorithm, uploadKey(profile), iv)
  cipher.setAAD(prefix)
  return Buffer.concat([prefix, cipher.update(source), cipher.final(), cipher.getAuthTag()])
}

function safeStorageName(value) {
  const input = String(value || '')
  const name = path.basename(input)
  if (!name || name !== input || name === '.' || name === '..') {
    throw new UploadVaultError('UPLOAD_NAME_INVALID', 'Stored upload name is invalid.')
  }
  return name
}

function mailStageName(storageName) {
  const finalName = safeStorageName(storageName)
  const encoded = Buffer.from(finalName, 'utf8').toString('base64url')
  return `${MAIL_STAGE_PREFIX}${encoded}-${randomUUID()}`
}

function mailStageInfo(value) {
  const stageName = safeStorageName(value)
  if (!stageName.startsWith(MAIL_STAGE_PREFIX)) return null
  const body = stageName.slice(MAIL_STAGE_PREFIX.length)
  // UUIDs contain dashes, so locate the fixed 36-character suffix boundary.
  const uuidStart = body.length - 36
  if (uuidStart <= 0 || body[uuidStart - 1] !== '-') return null
  const encoded = body.slice(0, uuidStart - 1)
  try {
    const storageName = safeStorageName(Buffer.from(encoded, 'base64url').toString('utf8'))
    return { stageName, storageName }
  } catch {
    return null
  }
}

function uploadStageName(storageName) {
  const finalName = safeStorageName(storageName)
  return `${UPLOAD_STAGE_PREFIX}${Buffer.from(finalName, 'utf8').toString('base64url')}`
}

function uploadStageInfo(value) {
  const stageName = safeStorageName(value)
  if (!stageName.startsWith(UPLOAD_STAGE_PREFIX)) return null
  try {
    const storageName = safeStorageName(
      Buffer.from(stageName.slice(UPLOAD_STAGE_PREFIX.length), 'base64url').toString('utf8'),
    )
    return { stageName, storageName }
  } catch {
    return null
  }
}

async function exists(target) {
  try {
    const stat = await fs.stat(target)
    return stat.isFile()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function writeAll(handle, buffer, startPosition) {
  let offset = 0
  let position = startPosition
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position)
    if (!bytesWritten) throw new UploadVaultError('UPLOAD_WRITE_FAILED', 'Upload storage stopped accepting data.')
    offset += bytesWritten
    position += bytesWritten
  }
  return position
}

async function writeDurableFile(target, payload) {
  const handle = await fs.open(target, 'wx', 0o600)
  try {
    await writeAll(handle, payload, 0)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function readExact(handle, length, position, signal) {
  const output = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    throwIfAborted(signal)
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset)
    if (!bytesRead) {
      throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
    }
    offset += bytesRead
  }
  return output
}

function assertDecodedSize(size, byteLimit, capacityLimit) {
  if (byteLimit !== null && size > byteLimit) throw decryptedSizeLimitError(byteLimit)
  if (capacityLimit !== null && size > capacityLimit) throw fileTooLargeError(capacityLimit)
}

function captureLengthFor(size, captureBytes) {
  if (captureBytes === undefined || captureBytes === null) return size
  return Math.min(size, Math.max(0, Number(captureBytes) || 0))
}

async function readLegacyPayload(handle, size, {
  captureBytes,
  includeDigest,
  signal,
  chunkBytes,
  onProgress,
}) {
  const captured = Buffer.allocUnsafe(captureLengthFor(size, captureBytes))
  const hash = includeDigest ? createHash('sha256') : null
  let position = 0
  let capturedOffset = 0
  while (position < size) {
    throwIfAborted(signal)
    const length = Math.min(chunkBytes, size - position)
    const chunk = await readExact(handle, length, position, signal)
    onProgress?.(chunk.length, { phase: 'verify' })
    hash?.update(chunk)
    if (capturedOffset < captured.length) {
      const copyLength = Math.min(chunk.length, captured.length - capturedOffset)
      chunk.copy(captured, capturedOffset, 0, copyLength)
      capturedOffset += copyLength
    }
    position += chunk.length
  }
  return {
    plain: captured,
    profile: null,
    size,
    ...(hash ? { digest: hash.digest('hex') } : {}),
  }
}

/**
 * Authenticates encrypted payloads incrementally while retaining only the
 * requested plaintext bytes. Full-buffer callers still receive plaintext only
 * after the final AEAD tag succeeds, but the encrypted source is never held in
 * memory alongside the returned Buffer.
 */
async function readDecodedPath(target, {
  maxBytes,
  capacityBytes,
  captureBytes,
  includeDigest = false,
  signal,
  chunkBytes = DEFAULT_IO_CHUNK_BYTES,
  onProgress,
} = {}) {
  const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes >= 0 ? maxBytes : null
  const capacityLimit = Number.isSafeInteger(capacityBytes) && capacityBytes >= 0 ? capacityBytes : null
  let handle
  try {
    throwIfAborted(signal)
    handle = await fs.open(target, 'r')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new UploadVaultError('UPLOAD_NOT_FOUND', 'Stored upload was not found.', error)
    }
    throw error
  }

  try {
    const stat = await handle.stat()
    const size = stat.size
    const leadingLength = Math.min(size, MAGIC.length + HEADER_LENGTH_BYTES)
    const leading = await readExact(handle, leadingLength, 0, signal)
    if (!leading.subarray(0, MAGIC.length).equals(MAGIC)) {
      // Preserve genuine headerless legacy files, but inspect enough of an
      // envelope-shaped object to keep damaged/unknown magic fail-closed.
      const probeLength = Math.min(size, MAXIMUM_ENVELOPE_OVERHEAD)
      const probe = probeLength === leading.length
        ? leading
        : await readExact(handle, probeLength, 0, signal)
      if (resemblesEnvelopeWithInvalidMagic(probe)) {
        throw new UploadVaultError('UPLOAD_ENVELOPE_MAGIC_INVALID', 'Encrypted upload signature is invalid.')
      }
      assertDecodedSize(size, byteLimit, capacityLimit)
      return await readLegacyPayload(handle, size, {
        captureBytes,
        includeDigest,
        signal,
        chunkBytes: positiveInteger(chunkBytes, DEFAULT_IO_CHUNK_BYTES),
        onProgress,
      })
    }

    const minimum = MAGIC.length + HEADER_LENGTH_BYTES + IV_BYTES + TAG_BYTES
    if (size < minimum || leading.length < MAGIC.length + HEADER_LENGTH_BYTES) {
      throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
    }
    const headerLength = leading.readUInt32BE(MAGIC.length)
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
      throw new UploadVaultError('UPLOAD_ENVELOPE_INVALID', 'Encrypted upload metadata is invalid.')
    }
    const prefixLength = MAGIC.length + HEADER_LENGTH_BYTES + headerLength + IV_BYTES
    if (prefixLength + TAG_BYTES > size) {
      throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
    }
    const plainSize = size - prefixLength - TAG_BYTES
    assertDecodedSize(plainSize, byteLimit, capacityLimit)

    const prefix = await readExact(handle, prefixLength, 0, signal)
    const headerStart = MAGIC.length + HEADER_LENGTH_BYTES
    const headerEnd = headerStart + headerLength
    const profile = parseEnvelopeHeader(prefix.subarray(headerStart, headerEnd))
    const iv = prefix.subarray(headerEnd, prefixLength)
    const tag = await readExact(handle, TAG_BYTES, size - TAG_BYTES, signal)
    const captured = Buffer.allocUnsafe(captureLengthFor(plainSize, captureBytes))
    const hash = includeDigest ? createHash('sha256') : null
    const decipher = createDecipheriv(profile.algorithm, uploadKey(profile), iv)
    decipher.setAAD(prefix)
    decipher.setAuthTag(tag)
    let encryptedPosition = prefixLength
    let remaining = plainSize
    let capturedOffset = 0
    let decodedSize = 0
    try {
      while (remaining > 0) {
        throwIfAborted(signal)
        const length = Math.min(positiveInteger(chunkBytes, DEFAULT_IO_CHUNK_BYTES), remaining)
        const encrypted = await readExact(handle, length, encryptedPosition, signal)
        const plain = decipher.update(encrypted)
        onProgress?.(plain.length, { phase: 'verify' })
        hash?.update(plain)
        if (capturedOffset < captured.length) {
          const copyLength = Math.min(plain.length, captured.length - capturedOffset)
          plain.copy(captured, capturedOffset, 0, copyLength)
          capturedOffset += copyLength
        }
        decodedSize += plain.length
        encryptedPosition += length
        remaining -= length
      }
      const final = decipher.final()
      onProgress?.(final.length, { phase: 'verify' })
      hash?.update(final)
      if (capturedOffset < captured.length) {
        const copyLength = Math.min(final.length, captured.length - capturedOffset)
        final.copy(captured, capturedOffset, 0, copyLength)
        capturedOffset += copyLength
      }
      decodedSize += final.length
    } catch (error) {
      if (error instanceof UploadVaultError) throw error
      throw new UploadVaultError(
        'UPLOAD_AUTHENTICATION_FAILED',
        'Encrypted upload could not be authenticated.',
        error,
      )
    }
    if (decodedSize !== plainSize || capturedOffset !== captured.length) {
      throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
    }
    return {
      plain: captured,
      profile,
      size: plainSize,
      ...(hash ? { digest: hash.digest('hex') } : {}),
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function sameOpenFileIdentity(before, after) {
  if (!before || !after) return false
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
}

async function openVerifiedDecodedReadStream(target, {
  capacityBytes,
  signal,
  chunkBytes = DEFAULT_IO_CHUNK_BYTES,
  onProgress,
} = {}) {
  throwIfAborted(signal)
  let identityBefore
  try {
    identityBefore = await fs.stat(target, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new UploadVaultError('UPLOAD_NOT_FOUND', 'Stored upload was not found.', error)
    }
    throw error
  }
  const verified = await readDecodedPath(target, {
    captureBytes: 0,
    capacityBytes,
    signal,
    chunkBytes,
    onProgress,
  })

  let handle
  try {
    handle = await fs.open(target, 'r')
    const identityAfter = await handle.stat({ bigint: true })
    if (!sameOpenFileIdentity(identityBefore, identityAfter)) {
      throw new UploadVaultError(
        'UPLOAD_CHANGED_DURING_READ',
        'Stored upload changed while it was being prepared for download.',
      )
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (error?.code === 'ENOENT') {
      throw new UploadVaultError('UPLOAD_NOT_FOUND', 'Stored upload was not found.', error)
    }
    throw error
  }

  const selectedChunkBytes = positiveInteger(chunkBytes, DEFAULT_IO_CHUNK_BYTES)
  let handleClosed = false
  const closeHandle = async () => {
    if (handleClosed) return
    handleClosed = true
    await handle.close().catch(() => undefined)
  }
  const decodedChunks = async function* () {
    try {
      throwIfAborted(signal)
      const rawSize = Number(identityBefore.size)
      const leadingLength = Math.min(rawSize, MAGIC.length + HEADER_LENGTH_BYTES)
      const leading = await readExact(handle, leadingLength, 0, signal)
      if (!leading.subarray(0, MAGIC.length).equals(MAGIC)) {
        if (rawSize !== verified.size) {
          throw new UploadVaultError('UPLOAD_CHANGED_DURING_READ', 'Stored upload size changed before download.')
        }
        let position = 0
        while (position < rawSize) {
          throwIfAborted(signal)
          const length = Math.min(selectedChunkBytes, rawSize - position)
          const chunk = await readExact(handle, length, position, signal)
          position += chunk.length
          onProgress?.(chunk.length, { phase: 'stream' })
          yield chunk
        }
        return
      }

      const headerLength = leading.readUInt32BE(MAGIC.length)
      if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
        throw new UploadVaultError('UPLOAD_ENVELOPE_INVALID', 'Encrypted upload metadata is invalid.')
      }
      const prefixLength = MAGIC.length + HEADER_LENGTH_BYTES + headerLength + IV_BYTES
      if (prefixLength + TAG_BYTES > rawSize) {
        throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
      }
      const plainSize = rawSize - prefixLength - TAG_BYTES
      if (plainSize !== verified.size) {
        throw new UploadVaultError('UPLOAD_CHANGED_DURING_READ', 'Stored upload size changed before download.')
      }
      const prefix = await readExact(handle, prefixLength, 0, signal)
      const headerStart = MAGIC.length + HEADER_LENGTH_BYTES
      const headerEnd = headerStart + headerLength
      const profile = parseEnvelopeHeader(prefix.subarray(headerStart, headerEnd))
      const iv = prefix.subarray(headerEnd, prefixLength)
      const tag = await readExact(handle, TAG_BYTES, rawSize - TAG_BYTES, signal)
      const decipher = createDecipheriv(profile.algorithm, uploadKey(profile), iv)
      decipher.setAAD(prefix)
      decipher.setAuthTag(tag)
      let encryptedPosition = prefixLength
      let remaining = plainSize
      try {
        while (remaining > 0) {
          throwIfAborted(signal)
          const length = Math.min(selectedChunkBytes, remaining)
          const encrypted = await readExact(handle, length, encryptedPosition, signal)
          const plain = decipher.update(encrypted)
          encryptedPosition += length
          remaining -= length
          if (plain.length > 0) {
            onProgress?.(plain.length, { phase: 'stream' })
            yield plain
          }
        }
        const final = decipher.final()
        if (final.length > 0) {
          onProgress?.(final.length, { phase: 'stream' })
          yield final
        }
      } catch (error) {
        if (error instanceof UploadVaultError) throw error
        throw new UploadVaultError(
          'UPLOAD_AUTHENTICATION_FAILED',
          'Encrypted upload could not be authenticated.',
          error,
        )
      }
    } finally {
      await closeHandle()
    }
  }

  const stream = Readable.from(decodedChunks(), {
    objectMode: false,
    highWaterMark: selectedChunkBytes,
  })
  stream.once('close', () => {
    void closeHandle()
  })
  return {
    stream,
    size: verified.size,
    profile: verified.profile,
    close: closeHandle,
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function verifyEquivalent(target, expectedPlain, policy, options = {}) {
  const expected = Buffer.isBuffer(expectedPlain)
    ? { size: expectedPlain.length, digest: digest(expectedPlain) }
    : expectedPlain
  const decoded = await readDecodedPath(target, {
    captureBytes: 0,
    includeDigest: true,
    capacityBytes: options.capacityBytes,
    signal: options.signal,
    chunkBytes: options.chunkBytes,
  })
  if (!profileMatchesPolicy(decoded.profile, policy)) {
    throw new UploadVaultError('UPLOAD_MIGRATION_POLICY_MISMATCH', 'Migrated upload uses the wrong encryption policy.')
  }
  if (decoded.size !== expected.size || decoded.digest !== expected.digest) {
    throw new UploadVaultError('UPLOAD_MIGRATION_VERIFY_FAILED', 'Migrated upload did not pass integrity verification.')
  }
}

async function durableJsonWrite(root, value) {
  const target = path.join(root, JOURNAL_NAME)
  const previous = path.join(root, JOURNAL_PREVIOUS_NAME)
  const temporary = path.join(root, JOURNAL_TEMP_NAME)
  await fs.rm(temporary, { force: true })
  await writeDurableFile(temporary, Buffer.from(JSON.stringify(value), 'utf8'))
  await fs.rm(previous, { force: true })
  if (await exists(target)) await fs.rename(target, previous)
  try {
    await fs.rename(temporary, target)
    await fs.rm(previous, { force: true })
  } catch (error) {
    if (!(await exists(target)) && await exists(previous)) {
      await fs.rename(previous, target).catch(() => undefined)
    }
    throw error
  }
}

function processIsAlive(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

async function abandonedMigrationLock(lockDirectory) {
  try {
    const rawOwner = await fs.readFile(path.join(lockDirectory, MIGRATION_LOCK_OWNER), 'utf8')
    const owner = JSON.parse(rawOwner)
    return {
      abandoned: !processIsAlive(Number(owner?.processId)),
      identity: `owner:${rawOwner}`,
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    try {
      const stat = await fs.stat(lockDirectory)
      return {
        abandoned: Date.now() - stat.mtimeMs >= MIGRATION_LOCK_OWNER_GRACE_MS,
        identity: `directory:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`,
      }
    } catch (statError) {
      if (statError?.code === 'ENOENT') return null
      throw statError
    }
  }
}

async function releaseMigrationReclaimMarker(markerPath, token) {
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'))
    if (marker?.token !== token) return
    await fs.rm(markerPath, { force: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return
    throw error
  }
}

async function reclaimAbandonedMigrationLock(lockDirectory, expected, {
  signal,
  deadlineAt,
  timeoutMs,
}) {
  const markerPath = path.join(lockDirectory, MIGRATION_LOCK_RECLAIM)
  const token = randomUUID()
  try {
    await fs.writeFile(
      markerPath,
      JSON.stringify({ processId: process.pid, token, createdAt: new Date().toISOString() }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOENT') return false
    throw error
  }

  let removed = false
  try {
    throwIfAborted(signal)
    throwIfMigrationLockExpired(deadlineAt, timeoutMs)
    const current = await abandonedMigrationLock(lockDirectory)
    if (!current?.abandoned || current.identity !== expected.identity) return false
    throwIfAborted(signal)
    throwIfMigrationLockExpired(deadlineAt, timeoutMs)
    await fs.rm(lockDirectory, { recursive: true, force: true })
    removed = true
    return true
  } finally {
    if (!removed) await releaseMigrationReclaimMarker(markerPath, token)
  }
}

function migrationLockDeadline({ timeoutMs, deadline } = {}) {
  const startedAt = Date.now()
  const finiteTimeoutMs = positiveInteger(timeoutMs, DEFAULT_MIGRATION_LOCK_TIMEOUT_MS)
  const configuredDeadline = deadline === null || deadline === undefined
    ? Number.NaN
    : deadline instanceof Date ? deadline.getTime() : Number(deadline)
  const deadlineAt = Number.isFinite(configuredDeadline)
    ? Math.min(startedAt + finiteTimeoutMs, configuredDeadline)
    : startedAt + finiteTimeoutMs
  return { deadlineAt, timeoutMs: Math.max(0, deadlineAt - startedAt) }
}

function absoluteMigrationDeadline(deadline) {
  if (deadline === null || deadline === undefined) return null
  if (deadline instanceof Date) return Number.isFinite(deadline.getTime()) ? deadline.getTime() : null
  const parsed = Number(deadline)
  return Number.isFinite(parsed) ? parsed : null
}

function throwIfMigrationInterrupted(signal, deadlineAt) {
  throwIfAborted(signal)
  if (deadlineAt !== null && Date.now() >= deadlineAt) throw migrationAttemptTimeoutError()
}

function throwIfMigrationLockExpired(deadlineAt, timeoutMs) {
  if (Date.now() >= deadlineAt) throw migrationLockTimeoutError(timeoutMs)
}

function waitForMigrationLockRetry({ signal, deadlineAt, timeoutMs }) {
  throwIfAborted(signal)
  throwIfMigrationLockExpired(deadlineAt, timeoutMs)
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const settle = (operation, value) => {
      if (settled) return
      settled = true
      cleanup()
      operation(value)
    }
    const onAbort = () => settle(reject, cancelledError(signal.reason))
    const remainingMs = Math.max(1, deadlineAt - Date.now())
    timer = setTimeout(() => {
      if (Date.now() >= deadlineAt) {
        settle(reject, migrationLockTimeoutError(timeoutMs))
        return
      }
      settle(resolve)
    }, Math.min(MIGRATION_LOCK_RETRY_MS, remainingMs))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

async function acquireMigrationLock(root, { signal, timeoutMs, deadline } = {}) {
  const lockDirectory = path.join(root, MIGRATION_LOCK_DIRECTORY)
  const token = randomUUID()
  const lockDeadline = migrationLockDeadline({ timeoutMs, deadline })

  while (true) {
    throwIfAborted(signal)
    throwIfMigrationLockExpired(lockDeadline.deadlineAt, lockDeadline.timeoutMs)
    try {
      await fs.mkdir(lockDirectory)
      try {
        throwIfAborted(signal)
        throwIfMigrationLockExpired(lockDeadline.deadlineAt, lockDeadline.timeoutMs)
        await fs.writeFile(
          path.join(lockDirectory, MIGRATION_LOCK_OWNER),
          JSON.stringify({ processId: process.pid, token, createdAt: new Date().toISOString() }),
          { encoding: 'utf8', flag: 'wx', mode: 0o600 },
        )
        throwIfAborted(signal)
        throwIfMigrationLockExpired(lockDeadline.deadlineAt, lockDeadline.timeoutMs)
      } catch (error) {
        await fs.rm(lockDirectory, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }

      return async () => {
        try {
          const owner = JSON.parse(await fs.readFile(path.join(lockDirectory, MIGRATION_LOCK_OWNER), 'utf8'))
          if (owner?.token !== token) return
        } catch (error) {
          if (error?.code === 'ENOENT') return
          throw error
        }
        await fs.rm(lockDirectory, { recursive: true, force: true })
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      throwIfAborted(signal)
      throwIfMigrationLockExpired(lockDeadline.deadlineAt, lockDeadline.timeoutMs)
      const abandoned = await abandonedMigrationLock(lockDirectory)
      if (abandoned?.abandoned) {
        // Re-check cancellation/deadline before performing stale-lock recovery.
        // A caller that has stopped waiting must never remove another owner's
        // lock as a side effect of timing out or being aborted.
        throwIfAborted(signal)
        throwIfMigrationLockExpired(lockDeadline.deadlineAt, lockDeadline.timeoutMs)
        if (await reclaimAbandonedMigrationLock(lockDirectory, abandoned, {
          signal,
          deadlineAt: lockDeadline.deadlineAt,
          timeoutMs: lockDeadline.timeoutMs,
        })) continue
      }
      await waitForMigrationLockRetry({
        signal,
        deadlineAt: lockDeadline.deadlineAt,
        timeoutMs: lockDeadline.timeoutMs,
      })
    }
  }
}

async function readJournal(root) {
  for (const name of [JOURNAL_NAME, JOURNAL_PREVIOUS_NAME]) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'))
      if (parsed?.version === 1 && Array.isArray(parsed.pending)) return parsed
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
  }
  return null
}

function artifactPaths(root, name) {
  return {
    target: path.join(root, name),
    next: path.join(root, `.${name}${NEXT_SUFFIX}`),
    previous: path.join(root, `.${name}${PREVIOUS_SUFFIX}`),
  }
}

async function pathPolicyAndPlain(target, options = {}) {
  try {
    return await readDecodedPath(target, {
      captureBytes: 0,
      includeDigest: true,
      signal: options.signal,
    })
  } catch (error) {
    if (error?.code === 'UPLOAD_NOT_FOUND') return null
    throw error
  }
}

async function recoverableArtifact(target, options = {}) {
  try {
    return await pathPolicyAndPlain(target, options)
  } catch (error) {
    if (error?.code === 'UPLOAD_CANCELLED') throw error
    if (error instanceof UploadVaultError) return null
    throw error
  }
}

async function recoverArtifacts(root, name, targetPolicy, options = {}) {
  const checkInterrupted = () => throwIfMigrationInterrupted(options.signal, options.deadlineAt ?? null)
  checkInterrupted()
  const paths = artifactPaths(root, name)
  const [targetExists, nextExists, previousExists] = await Promise.all([
    exists(paths.target),
    exists(paths.next),
    exists(paths.previous),
  ])
  checkInterrupted()
  if (!nextExists && !previousExists) return

  // A promoted replacement can be interrupted before the old file is
  // removed. Treat an unauthentic target as unusable here so the still-valid
  // previous artifact can be restored; normal reads continue to fail closed
  // when there is no recovery artifact.
  let target = targetExists ? await recoverableArtifact(paths.target, options) : null
  const next = nextExists ? await recoverableArtifact(paths.next, options) : null
  const previous = previousExists ? await recoverableArtifact(paths.previous, options) : null
  checkInterrupted()

  // A brand-new upload may crash after its authenticated `.vault-next` file is
  // durable but before the first promotion creates the final target. Preserve
  // any authenticated envelope (migration below can re-key an older profile),
  // while deleting partial/corrupt/plaintext orphan artifacts without making
  // startup fail or exposing their bytes as a completed upload.
  if (!targetExists && !previousExists) {
    checkInterrupted()
    if (next?.profile) {
      await fs.rename(paths.next, paths.target)
    } else {
      await fs.rm(paths.next, { force: true })
    }
    checkInterrupted()
    return
  }

  if (target && profileMatchesPolicy(target.profile, targetPolicy)) {
    checkInterrupted()
    await Promise.all([fs.rm(paths.next, { force: true }), fs.rm(paths.previous, { force: true })])
    checkInterrupted()
    return
  }

  const reference = target ?? previous
  const nextIsReplacement = Boolean(next)
    && profileMatchesPolicy(next.profile, targetPolicy)
    && Boolean(reference)
    && next.size === reference.size
    && next.digest === reference.digest

  if (nextIsReplacement) {
    checkInterrupted()
    if (target) {
      await fs.rm(paths.previous, { force: true })
      checkInterrupted()
      await fs.rename(paths.target, paths.previous)
      checkInterrupted()
    } else if (targetExists) {
      await fs.rm(paths.target, { force: true })
      checkInterrupted()
    }
    await fs.rename(paths.next, paths.target)
    checkInterrupted()
    await verifyEquivalent(paths.target, reference, targetPolicy, { signal: options.signal })
    checkInterrupted()
    await fs.rm(paths.previous, { force: true })
    checkInterrupted()
    return
  }

  checkInterrupted()
  await fs.rm(paths.next, { force: true })
  checkInterrupted()
  if (!target && previous) {
    if (targetExists) await fs.rm(paths.target, { force: true })
    checkInterrupted()
    await fs.rename(paths.previous, paths.target)
    checkInterrupted()
    target = previous
  } else {
    await fs.rm(paths.previous, { force: true })
    checkInterrupted()
  }
  if (!target) {
    throw new UploadVaultError('UPLOAD_MIGRATION_RECOVERY_FAILED', `Could not recover interrupted upload migration for ${name}.`)
  }
}

async function uploadNames(root) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ![
      JOURNAL_NAME,
      JOURNAL_PREVIOUS_NAME,
      JOURNAL_TEMP_NAME,
    ].includes(name))
    .filter((name) => !(name.startsWith('.') && (name.endsWith(NEXT_SUFFIX) || name.endsWith(PREVIOUS_SUFFIX))))
    .sort()
}

async function orphanArtifactNames(root) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const names = new Set()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('.')) continue
    for (const suffix of [NEXT_SUFFIX, PREVIOUS_SUFFIX]) {
      if (!entry.name.endsWith(suffix)) continue
      const original = entry.name.slice(1, -suffix.length)
      if (original) names.add(original)
    }
  }
  return [...names]
}

function defaultStoredName(file) {
  const extension = path.extname(file?.originalname || '').slice(0, 16)
  return `${randomUUID()}${extension}`
}

/**
 * Authenticated upload storage. Encrypted files are authenticated in full before
 * any plaintext Buffer is returned, so downloads and email never stream
 * unauthenticated plaintext or create a temporary plaintext file.
 */
export function createUploadVault({
  root,
  policyProvider = () => ({}),
  migrationHook,
  ioLimits = {},
} = {}) {
  if (!root) throw new TypeError('Upload vault root is required.')
  const absoluteRoot = path.resolve(root)
  const configuredIoLimits = {
    maxConcurrent: configuredLimit(
      ioLimits,
      'maxConcurrent',
      'PHD_ATLAS_UPLOAD_IO_MAX_CONCURRENT',
      DEFAULT_MAX_CONCURRENT_IO,
    ),
    maxQueued: configuredLimit(
      ioLimits,
      'maxQueued',
      'PHD_ATLAS_UPLOAD_IO_MAX_QUEUED',
      DEFAULT_MAX_QUEUED_IO,
    ),
    maxInFlightBytes: configuredLimit(
      ioLimits,
      'maxInFlightBytes',
      'PHD_ATLAS_UPLOAD_IO_MAX_IN_FLIGHT_BYTES',
      DEFAULT_MAX_IN_FLIGHT_BYTES,
    ),
    maxQueuedBytes: configuredLimit(
      ioLimits,
      'maxQueuedBytes',
      'PHD_ATLAS_UPLOAD_IO_MAX_QUEUED_BYTES',
      DEFAULT_MAX_QUEUED_BYTES,
    ),
    queueTimeoutMs: configuredLimit(
      ioLimits,
      'queueTimeoutMs',
      'PHD_ATLAS_UPLOAD_IO_WAIT_MS',
      DEFAULT_QUEUE_TIMEOUT_MS,
    ),
    migrationLockTimeoutMs: configuredLimit(
      ioLimits,
      'migrationLockTimeoutMs',
      'PHD_ATLAS_UPLOAD_MIGRATION_LOCK_WAIT_MS',
      DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
    ),
  }
  const maxSingleFileBytes = configuredLimit(
    ioLimits,
    'maxSingleFileBytes',
    'PHD_ATLAS_UPLOAD_MAX_FILE_BYTES',
    DEFAULT_MAX_SINGLE_FILE_BYTES,
  )
  const chunkBytes = positiveInteger(ioLimits.chunkBytes, DEFAULT_IO_CHUNK_BYTES)
  const admission = createIoAdmission(configuredIoLimits)

  const targetPath = (storageName) => path.join(absoluteRoot, safeStorageName(storageName))

  async function readableTargetPath(storageName) {
    const name = safeStorageName(storageName)
    const finalPath = targetPath(name)
    if (await exists(finalPath)) return finalPath
    const stagePath = targetPath(uploadStageName(name))
    return await exists(stagePath) ? stagePath : finalPath
  }

  function readReservation({ captureBytes, maxBytes } = {}) {
    // The file can be atomically replaced while this read waits behind a writer
    // for the same storage key. Reserving from a pre-queue stat would therefore
    // undercount a later, larger replacement. Full-buffer reads reserve their
    // maximum possible plaintext; bounded prefix/inspection reads reserve only
    // the bytes they can retain plus the streaming cipher/decipher workspace.
    const explicitLimit = Number.isSafeInteger(maxBytes) && maxBytes >= 0
      ? Math.min(maxBytes, maxSingleFileBytes)
      : maxSingleFileBytes
    const retainedBytes = captureBytes === undefined || captureBytes === null
      ? explicitLimit
      : Math.min(
          explicitLimit,
          Number.isSafeInteger(captureBytes) && captureBytes >= 0 ? captureBytes : 0,
        )
    return retainedBytes + STREAM_MEMORY_RESERVATION_BYTES
  }

  async function scheduledRead(storageName, options, operation) {
    const name = safeStorageName(storageName)
    const bytes = readReservation(options)
    return admission.schedule(operation, {
      bytes,
      key: name,
      signal: options?.signal,
    })
  }

  async function ensureReady() {
    await fs.mkdir(absoluteRoot, { recursive: true })
  }

  async function writeBufferUnlocked(storageName, plain, policy = policyProvider(), options = {}) {
    return writeStreamUnlocked(
      storageName,
      Readable.from([plain]),
      policy,
      { ...options, expectedSize: plain.length },
    )
  }

  async function writeStreamUnlocked(storageName, stream, policy = policyProvider(), {
    expectedSize,
    signal,
  } = {}) {
    if (Number.isSafeInteger(expectedSize) && expectedSize > maxSingleFileBytes) {
      throw fileTooLargeError(maxSingleFileBytes)
    }
    throwIfAborted(signal)
    await ensureReady()
    const name = safeStorageName(storageName)
    const paths = artifactPaths(absoluteRoot, name)
    await recoverArtifacts(absoluteRoot, name, policy)
    await fs.rm(paths.next, { force: true })
    const selected = normalizedPolicy(policy)
    const handle = await fs.open(paths.next, 'wx', 0o600)
    const hash = createHash('sha256')
    let size = 0
    let position = 0
    let verifiedDigest = ''
    const abortStream = () => stream?.destroy?.(cancelledError(signal?.reason))
    signal?.addEventListener('abort', abortStream, { once: true })
    try {
      if (selected.encryptionAtRest) {
        const profile = profileForPolicy(selected)
        const iv = randomBytes(IV_BYTES)
        const prefix = envelopePrefix(profile, iv)
        const cipher = createCipheriv(profile.algorithm, uploadKey(profile), iv)
        cipher.setAAD(prefix)
        position = await writeAll(handle, prefix, position)
        for await (const chunk of stream) {
          throwIfAborted(signal)
          const plainChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          if (size + plainChunk.length > maxSingleFileBytes) throw fileTooLargeError(maxSingleFileBytes)
          size += plainChunk.length
          hash.update(plainChunk)
          const encrypted = cipher.update(plainChunk)
          if (encrypted.length) position = await writeAll(handle, encrypted, position)
        }
        const final = cipher.final()
        if (final.length) position = await writeAll(handle, final, position)
        await writeAll(handle, cipher.getAuthTag(), position)
      } else {
        for await (const chunk of stream) {
          throwIfAborted(signal)
          const plainChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          if (size + plainChunk.length > maxSingleFileBytes) throw fileTooLargeError(maxSingleFileBytes)
          size += plainChunk.length
          hash.update(plainChunk)
          position = await writeAll(handle, plainChunk, position)
        }
      }
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined)
      await fs.rm(paths.next, { force: true }).catch(() => undefined)
      throw error
    } finally {
      signal?.removeEventListener('abort', abortStream)
    }
    await handle.close()

    try {
      const expected = { size, digest: hash.digest('hex') }
      verifiedDigest = expected.digest
      const decoded = await readDecodedPath(paths.next, {
        captureBytes: 0,
        includeDigest: true,
        capacityBytes: maxSingleFileBytes,
        signal,
        chunkBytes,
      })
      if (
        decoded.size !== expected.size
        || decoded.digest !== expected.digest
        || !profileMatchesPolicy(decoded.profile, selected)
      ) {
        throw new UploadVaultError('UPLOAD_WRITE_VERIFY_FAILED', 'Stored upload did not pass integrity verification.')
      }
      if (await exists(paths.target)) {
        await fs.rm(paths.previous, { force: true })
        await fs.rename(paths.target, paths.previous)
      }
      await fs.rename(paths.next, paths.target)
      await fs.rm(paths.previous, { force: true })
    } catch (error) {
      if (await exists(paths.previous)) {
        await fs.rm(paths.target, { force: true }).catch(() => undefined)
        await fs.rename(paths.previous, paths.target).catch(() => undefined)
      }
      await fs.rm(paths.next, { force: true }).catch(() => undefined)
      throw error
    }
    return { path: paths.target, size, digest: verifiedDigest, encrypted: selected.encryptionAtRest }
  }

  async function migrateWithFileLock(policy, options = {}) {
    const checkInterrupted = () => throwIfMigrationInterrupted(options.signal, options.deadlineAt ?? null)
    checkInterrupted()
    const targetPolicy = normalizedPolicy(policy)
    const priorJournal = await readJournal(absoluteRoot)
    checkInterrupted()
    const recoveryNames = new Set([
      ...(priorJournal?.inFlight?.name ? [priorJournal.inFlight.name] : []),
      ...await orphanArtifactNames(absoluteRoot),
    ])
    checkInterrupted()
    for (const name of recoveryNames) {
      checkInterrupted()
      await recoverArtifacts(absoluteRoot, safeStorageName(name), targetPolicy, options)
      checkInterrupted()
    }

    const names = await uploadNames(absoluteRoot)
    checkInterrupted()
    let journal = {
      version: 1,
      targetPolicy,
      startedAt: priorJournal?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pending: names,
      completed: [],
      inFlight: null,
    }
    await durableJsonWrite(absoluteRoot, journal)
    checkInterrupted()

    for (const name of names) {
      checkInterrupted()
      const paths = artifactPaths(absoluteRoot, name)
      const current = await readDecodedPath(paths.target, {
        capacityBytes: maxSingleFileBytes,
        chunkBytes,
        signal: options.signal,
      })
      checkInterrupted()
      if (profileMatchesPolicy(current.profile, targetPolicy)) {
        journal.pending = journal.pending.filter((candidate) => candidate !== name)
        journal.completed.push(name)
        journal.updatedAt = new Date().toISOString()
        await durableJsonWrite(absoluteRoot, journal)
        checkInterrupted()
        continue
      }

      journal.inFlight = { name }
      journal.updatedAt = new Date().toISOString()
      await durableJsonWrite(absoluteRoot, journal)
      checkInterrupted()
      await fs.rm(paths.next, { force: true })
      checkInterrupted()
      await writeDurableFile(paths.next, encodeUploadPayload(current.plain, targetPolicy))
      checkInterrupted()
      await verifyEquivalent(paths.next, current.plain, targetPolicy, {
        capacityBytes: maxSingleFileBytes,
        chunkBytes,
        signal: options.signal,
      })
      checkInterrupted()
      await migrationHook?.('after-next-written', { name, root: absoluteRoot, signal: options.signal })
      checkInterrupted()

      await fs.rm(paths.previous, { force: true })
      checkInterrupted()
      await fs.rename(paths.target, paths.previous)
      checkInterrupted()
      await migrationHook?.('after-original-moved', { name, root: absoluteRoot, signal: options.signal })
      checkInterrupted()
      let previousRemoved = false
      try {
        await fs.rename(paths.next, paths.target)
        checkInterrupted()
        await migrationHook?.('after-next-promoted', { name, root: absoluteRoot, signal: options.signal })
        checkInterrupted()
        await verifyEquivalent(paths.target, current.plain, targetPolicy, {
          capacityBytes: maxSingleFileBytes,
          chunkBytes,
          signal: options.signal,
        })
        checkInterrupted()
        await fs.rm(paths.previous, { force: true })
        previousRemoved = true
        checkInterrupted()
        await migrationHook?.('after-previous-removed', { name, root: absoluteRoot, signal: options.signal })
        checkInterrupted()
      } catch (error) {
        if (error?.code === 'UPLOAD_VAULT_SIMULATED_CRASH' || previousRemoved) throw error
        await fs.rm(paths.target, { force: true }).catch(() => undefined)
        if (await exists(paths.previous)) await fs.rename(paths.previous, paths.target).catch(() => undefined)
        throw error
      }

      journal.pending = journal.pending.filter((candidate) => candidate !== name)
      journal.completed.push(name)
      journal.inFlight = null
      journal.updatedAt = new Date().toISOString()
      await durableJsonWrite(absoluteRoot, journal)
      checkInterrupted()
    }

    checkInterrupted()
    await Promise.all([
      fs.rm(path.join(absoluteRoot, JOURNAL_NAME), { force: true }),
      fs.rm(path.join(absoluteRoot, JOURNAL_PREVIOUS_NAME), { force: true }),
      fs.rm(path.join(absoluteRoot, JOURNAL_TEMP_NAME), { force: true }),
    ])
    checkInterrupted()
    return {
      migrated: journal.completed.length,
      encryptionAtRest: targetPolicy.encryptionAtRest,
      encryptionAlgorithm: targetPolicy.encryptionAlgorithm,
    }
  }

  async function migrateUnlocked(policy, options = {}) {
    const deadlineAt = absoluteMigrationDeadline(options.deadline)
    throwIfMigrationInterrupted(options.signal, deadlineAt)
    await ensureReady()
    throwIfMigrationInterrupted(options.signal, deadlineAt)
    const releaseMigrationLock = await acquireMigrationLock(absoluteRoot, {
      signal: options.signal,
      timeoutMs: options.lockTimeoutMs ?? configuredIoLimits.migrationLockTimeoutMs,
      deadline: deadlineAt,
    })
    try {
      throwIfMigrationInterrupted(options.signal, deadlineAt)
      return await migrateWithFileLock(policy === undefined ? policyProvider() : policy, {
        signal: options.signal,
        deadlineAt,
      })
    } finally {
      await releaseMigrationLock()
    }
  }

  async function readBuffer(storageName, options = {}) {
    const name = safeStorageName(storageName)
    return scheduledRead(name, options, async () => (
      await readDecodedPath(await readableTargetPath(name), {
        ...options,
        capacityBytes: maxSingleFileBytes,
        chunkBytes,
      })
    ).plain)
  }

  async function withReadBuffer(storageName, options, consumer) {
    const selectedOptions = typeof options === 'function' ? {} : (options ?? {})
    const selectedConsumer = typeof options === 'function' ? options : consumer
    if (typeof selectedConsumer !== 'function') {
      throw new TypeError('Upload vault buffer consumer must be a function.')
    }
    const name = safeStorageName(storageName)
    return scheduledRead(name, selectedOptions, async () => {
      const decoded = await readDecodedPath(await readableTargetPath(name), {
        ...selectedOptions,
        capacityBytes: maxSingleFileBytes,
        chunkBytes,
      })
      return selectedConsumer(decoded.plain, {
        size: decoded.size,
        encrypted: decoded.profile !== null,
      })
    })
  }

  async function withReadStream(storageName, options, consumer) {
    const selectedOptions = typeof options === 'function' ? {} : (options ?? {})
    const selectedConsumer = typeof options === 'function' ? options : consumer
    if (typeof selectedConsumer !== 'function') {
      throw new TypeError('Upload vault stream consumer must be a function.')
    }
    const name = safeStorageName(storageName)
    // Authenticate the complete envelope and pin the verified file handle
    // while the vault's short I/O lease is held. The network consumer then
    // owns only a chunk-sized stream buffer; a slow client cannot retain a
    // full plaintext file or monopolize the vault I/O pool.
    const opened = await scheduledRead(
      name,
      { ...selectedOptions, captureBytes: 0 },
      async () => openVerifiedDecodedReadStream(await readableTargetPath(name), {
        ...selectedOptions,
        capacityBytes: maxSingleFileBytes,
        chunkBytes,
      }),
    )
    try {
      return await selectedConsumer(opened.stream, {
        size: opened.size,
        encrypted: opened.profile !== null,
      })
    } finally {
      opened.stream.destroy()
      await opened.close()
    }
  }

  async function writeBuffer(storageName, plain, policy, options = {}) {
    const name = safeStorageName(storageName)
    const byteLength = Buffer.isBuffer(plain) ? plain.length : Buffer.byteLength(plain ?? '')
    if (byteLength > maxSingleFileBytes) throw fileTooLargeError(maxSingleFileBytes)
    const source = Buffer.isBuffer(plain) ? plain : Buffer.from(plain ?? '')
    return admission.schedule(
      () => writeBufferUnlocked(name, source, policy, options),
      {
        bytes: source.length + STREAM_MEMORY_RESERVATION_BYTES,
        key: name,
        write: true,
        signal: options.signal,
      },
    )
  }

  async function writeStream(storageName, stream, policy, options = {}) {
    const name = safeStorageName(storageName)
    return admission.schedule(
      () => writeStreamUnlocked(name, stream, policy, options),
      {
        bytes: STREAM_MEMORY_RESERVATION_BYTES,
        key: name,
        write: true,
        signal: options.signal,
      },
    )
  }

  async function stageMailBuffer(storageName, plain, policy, options = {}) {
    const finalName = safeStorageName(storageName)
    const stageName = mailStageName(finalName)
    await writeBuffer(stageName, plain, policy, options)
    return { stageName, storageName: finalName }
  }

  async function promoteMailStage(stageName, storageName) {
    const stage = safeStorageName(stageName)
    const finalName = safeStorageName(storageName)
    const parsed = mailStageInfo(stage)
    if (!parsed || parsed.storageName !== finalName) {
      throw new UploadVaultError('UPLOAD_NAME_INVALID', 'Mail attachment staging name is invalid.')
    }
    return admission.schedule(async () => {
      await ensureReady()
      const stagedPath = targetPath(stage)
      const finalPath = targetPath(finalName)
      if (await exists(finalPath)) {
        await fs.rm(stagedPath, { force: true })
        return { created: false, storageName: finalName }
      }
      try {
        await fs.rename(stagedPath, finalPath)
      } catch (error) {
        if (['EEXIST', 'EPERM'].includes(error?.code) && await exists(finalPath)) {
          await fs.rm(stagedPath, { force: true })
          return { created: false, storageName: finalName }
        }
        throw error
      }
      return { created: true, storageName: finalName }
    }, { key: finalName, write: true })
  }

  async function listMailStages(limit = 512) {
    const maximum = Math.min(4096, Math.max(1, Math.floor(Number(limit)) || 512))
    return admission.schedule(async () => {
      await ensureReady()
      const stages = []
      const directory = await fs.opendir(absoluteRoot)
      try {
        for await (const entry of directory) {
          if (!entry.isFile()) continue
          const parsed = mailStageInfo(entry.name)
          if (!parsed) continue
          stages.push(parsed)
          if (stages.length >= maximum) break
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
      return stages
    })
  }

  async function promoteUploadStage(stageName, storageName) {
    const stage = safeStorageName(stageName)
    const finalName = safeStorageName(storageName)
    const parsed = uploadStageInfo(stage)
    if (!parsed || parsed.storageName !== finalName) {
      throw new UploadVaultError('UPLOAD_NAME_INVALID', 'Upload staging name is invalid.')
    }
    return admission.schedule(async () => {
      await ensureReady()
      const stagedPath = targetPath(stage)
      const finalPath = targetPath(finalName)
      if (await exists(finalPath)) {
        await fs.rm(stagedPath, { force: true })
        return { created: false, storageName: finalName }
      }
      await fs.rename(stagedPath, finalPath)
      return { created: true, storageName: finalName }
    }, { key: finalName, write: true })
  }

  async function listUploadStages(limit = 512) {
    const maximum = Math.min(4096, Math.max(1, Math.floor(Number(limit)) || 512))
    return admission.schedule(async () => {
      await ensureReady()
      const stages = []
      const directory = await fs.opendir(absoluteRoot)
      try {
        for await (const entry of directory) {
          if (!entry.isFile()) continue
          const parsed = uploadStageInfo(entry.name)
          if (!parsed) continue
          stages.push(parsed)
          if (stages.length >= maximum) break
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
      return stages
    })
  }

  return {
    root: absoluteRoot,
    pathFor: targetPath,
    capacity: () => {
      const snapshot = admission.snapshot()
      return {
        ...snapshot,
        limits: {
          ...snapshot.limits,
          migrationLockTimeoutMs: configuredIoLimits.migrationLockTimeoutMs,
          maxSingleFileBytes,
          chunkBytes,
        },
      }
    },
    ensureReady: () => admission.schedule(ensureReady),
    exists: async (storageName) => {
      const name = safeStorageName(storageName)
      return admission.schedule(async () => exists(await readableTargetPath(name)), { key: name })
    },
    inspect: async (storageName, options = {}) => {
      const name = safeStorageName(storageName)
      return scheduledRead(name, { ...options, captureBytes: 0 }, async () => {
        const decoded = await readDecodedPath(await readableTargetPath(name), {
          ...options,
          captureBytes: 0,
          capacityBytes: maxSingleFileBytes,
          chunkBytes,
        })
        return {
          encrypted: decoded.profile !== null,
          algorithm: decoded.profile?.algorithm ?? null,
          passwordBound: Boolean(decoded.profile?.passwordBinding),
          size: decoded.size,
        }
      })
    },
    readBuffer,
    withReadBuffer,
    withReadStream,
    readPrefix: async (storageName, byteCount = 8, options = {}) => {
      const name = safeStorageName(storageName)
      const count = Math.max(0, Number(byteCount) || 0)
      return scheduledRead(name, { ...options, captureBytes: count }, async () => (
        await readDecodedPath(await readableTargetPath(name), {
          ...options,
          captureBytes: count,
          capacityBytes: maxSingleFileBytes,
          chunkBytes,
        })
      ).plain)
    },
    writeBuffer,
    writeStream,
    stageMailBuffer,
    promoteMailStage,
    listMailStages,
    promoteUploadStage,
    listUploadStages,
    remove: async (storageName) => {
      const name = safeStorageName(storageName)
      return admission.schedule(async () => {
        await Promise.all([
          fs.rm(targetPath(name), { force: true }),
          ...(uploadStageInfo(name)
            ? []
            : [fs.rm(targetPath(uploadStageName(name)), { force: true })]),
        ])
      }, { key: name, write: true })
    },
    migrate: (policy, options = {}) => admission.schedule(
      () => migrateUnlocked(policy, options),
      { exclusive: true, signal: options.signal },
    ),
    withExclusive(operation) {
      if (typeof operation !== 'function') throw new TypeError('Upload vault exclusive operation must be a function.')
      return admission.schedule(() => operation({
        root: absoluteRoot,
        ensureReady,
        migrate: migrateUnlocked,
      }), { exclusive: true })
    },
    multerStorage({
      filename = (_request, file) => defaultStoredName(file),
      policy = () => policyProvider(),
      staged = false,
    } = {}) {
      return {
        _handleFile(request, file, callback) {
          const controller = new AbortController()
          const onAborted = () => controller.abort(new Error('Upload request aborted.'))
          if (request?.aborted) onAborted()
          else request?.once?.('aborted', onAborted)

          // Resolve the encryption policy only after this upload owns I/O
          // admission. An exclusive re-key barrier therefore cannot be
          // overtaken by a later upload using a stale policy.
          Promise.resolve(filename(request, file))
            .then((rawName) => {
              const finalName = safeStorageName(rawName)
              const name = staged ? uploadStageName(finalName) : finalName
              return admission.schedule(async () => (
                writeStreamUnlocked(name, file.stream, await policy(request, file), {
                  signal: controller.signal,
                })
              ), {
                bytes: STREAM_MEMORY_RESERVATION_BYTES,
                key: name,
                write: true,
                signal: controller.signal,
              })
            })
            .then((result) => callback(null, {
              destination: absoluteRoot,
              filename: staged
                ? uploadStageInfo(path.basename(result.path)).storageName
                : path.basename(result.path),
              ...(staged ? { stagedFilename: path.basename(result.path) } : {}),
              path: result.path,
              size: result.size,
              digest: result.digest,
              encryptedAtRest: result.encrypted,
            }))
            .catch((error) => {
              if (['UPLOAD_VAULT_BUSY', 'UPLOAD_CANCELLED'].includes(error?.code)) {
                file.stream?.destroy?.()
              }
              callback(error)
            })
            .finally(() => request?.removeListener?.('aborted', onAborted))
        },
        _removeFile(_request, file, callback) {
          const rawName = file?.stagedFilename || file?.filename || (file?.path ? path.basename(file.path) : '')
          if (!rawName) {
            callback(null)
            return
          }
          Promise.resolve()
            .then(() => {
              const name = safeStorageName(rawName)
              return admission.schedule(
                () => fs.rm(targetPath(name), { force: true }),
                { key: name, write: true },
              )
            })
            .then(() => callback(null), callback)
        },
      }
    },
    asMailAttachment: async (storageName, { filename, contentType, maxBytes, signal } = {}) => ({
      filename,
      contentType,
      content: await readBuffer(storageName, { maxBytes, signal }),
    }),
  }
}

export const uploadVaultFormat = Object.freeze({
  magic: MAGIC.toString('utf8'),
  version: 2,
  journalName: JOURNAL_NAME,
})
