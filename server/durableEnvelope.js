import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import {
  createSecretCipherWithProfile,
  createSecretDecipherWithProfile,
  decryptSecretWithProfile,
  encryptSecretWithProfile,
  normalizeAlgorithm,
} from './crypto.js'
import { replaceFileAtomic } from './sqliteSeal.js'

export const EXTERNAL_STATE_MAGIC = Buffer.from('PHDSTATE1\n', 'utf8')
export const BACKUP_ENVELOPE_MAGIC = Buffer.from('PHDBACKUP1\n', 'utf8')

const BINARY_VERSION = 2
const AUTH_TAG_BYTES = 16
const MAX_HEADER_BYTES = 64 * 1024
const STREAM_CHUNK_BYTES = 64 * 1024

function durableError(label, message, cause) {
  const error = new Error(`${label} ${message}`)
  error.code = 'DURABLE_ENVELOPE_INVALID'
  error.status = 400
  if (cause) error.cause = cause
  return error
}

function profileForPolicy(policy = {}) {
  return {
    algorithm: normalizeAlgorithm(policy.encryptionAlgorithm ?? policy.algorithm),
    passwordBinding: String(policy.passwordBinding || ''),
  }
}

function profilesEqual(left, right) {
  return Boolean(
    left
    && right
    && normalizeAlgorithm(left.algorithm) === normalizeAlgorithm(right.algorithm)
    && String(left.passwordBinding || '') === String(right.passwordBinding || ''),
  )
}

function uniqueTemporaryPath(target, kind = 'tmp') {
  return `${target}.${kind}-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
}

async function syncFile(target) {
  const handle = await fs.open(target, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function publishTemporaryFile(temporary, target) {
  await syncFile(temporary)
  await replaceFileAtomic(temporary, target)
}

function *bufferChunks(payload) {
  for (let offset = 0; offset < payload.length; offset += STREAM_CHUNK_BYTES) {
    yield payload.subarray(offset, Math.min(payload.length, offset + STREAM_CHUNK_BYTES))
  }
}

function sourceStream(source) {
  if (Buffer.isBuffer(source)) return Readable.from(bufferChunks(source))
  return createReadStream(source)
}

class Base64EncodeTransform extends Transform {
  constructor() {
    super()
    this.carry = Buffer.alloc(0)
  }

  _transform(chunk, _encoding, callback) {
    try {
      const input = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk
      const complete = input.length - (input.length % 3)
      if (complete) this.push(input.subarray(0, complete).toString('base64'))
      this.carry = complete < input.length ? Buffer.from(input.subarray(complete)) : Buffer.alloc(0)
      callback()
    } catch (error) {
      callback(error)
    }
  }

  _flush(callback) {
    try {
      if (this.carry.length) this.push(this.carry.toString('base64'))
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

class Base64DecodeTransform extends Transform {
  constructor(label) {
    super()
    this.label = label
    this.carry = ''
    this.finishedPadding = false
  }

  _transform(chunk, _encoding, callback) {
    try {
      const text = this.carry + chunk.toString('ascii')
      if (!/^[A-Za-z0-9+/=]*$/.test(text)) {
        throw durableError(this.label, 'contains invalid base64 data.')
      }
      const complete = text.length - (text.length % 4)
      if (complete) {
        const body = text.slice(0, complete)
        const paddingAt = body.indexOf('=')
        if (this.finishedPadding || (paddingAt >= 0 && paddingAt < body.length - 2)) {
          throw durableError(this.label, 'contains invalid base64 padding.')
        }
        if (paddingAt >= 0) this.finishedPadding = true
        this.push(Buffer.from(body, 'base64'))
      }
      this.carry = text.slice(complete)
      callback()
    } catch (error) {
      callback(error)
    }
  }

  _flush(callback) {
    try {
      if (this.carry.length) {
        if (this.carry.length === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(this.carry)) {
          throw durableError(this.label, 'contains truncated base64 data.')
        }
        this.push(Buffer.from(this.carry, 'base64'))
      }
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

function binaryPrefix(magic, profile, plainBytes) {
  const metadata = Buffer.from(JSON.stringify({
    version: BINARY_VERSION,
    algorithm: profile.algorithm,
    passwordBinding: profile.passwordBinding,
    plainBytes,
  }), 'utf8')
  if (metadata.length > MAX_HEADER_BYTES) {
    throw durableError('Encrypted payload', 'has an oversized profile header.')
  }
  const length = Buffer.alloc(4)
  length.writeUInt32BE(metadata.length)
  return Buffer.concat([magic, Buffer.from([BINARY_VERSION]), length, metadata])
}

async function sizeOfSource(source) {
  if (Buffer.isBuffer(source)) return source.length
  return (await fs.stat(source)).size
}

async function encodeBinaryFile(source, target, magic, policy) {
  const profile = profileForPolicy(policy)
  const plainBytes = await sizeOfSource(source)
  const { cipher, iv } = createSecretCipherWithProfile(profile)
  const header = binaryPrefix(magic, profile, plainBytes)
  cipher.setAAD(header)
  const temporary = uniqueTemporaryPath(target)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  let output
  try {
    output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    output.write(header)
    output.write(iv)
    await pipeline(sourceStream(source), cipher, output, { end: false })
    output.write(cipher.getAuthTag())
    output.end()
    await finished(output)
    await publishTemporaryFile(temporary, target)
    return { encrypted: true, version: BINARY_VERSION, profile, plainBytes }
  } catch (error) {
    output?.destroy()
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function copyFileAtomic(source, target) {
  const temporary = uniqueTemporaryPath(target)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  try {
    await pipeline(
      sourceStream(source),
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    )
    await publishTemporaryFile(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readWindow(handle, length, position = 0) {
  const payload = Buffer.alloc(length)
  const { bytesRead } = await handle.read(payload, 0, length, position)
  return payload.subarray(0, bytesRead)
}

async function inspectLegacyEnvelope(target, stat, magic, label, initial) {
  const marker = Buffer.from('"ciphertext":"', 'utf8')
  const markerIndex = initial.indexOf(marker, magic.length)
  if (markerIndex < 0) throw durableError(label, 'has an oversized or invalid legacy header.')
  let metadata
  try {
    const prefix = initial.subarray(magic.length, markerIndex).toString('utf8')
    metadata = JSON.parse(`${prefix}"ciphertext":""}`)
  } catch (error) {
    throw durableError(label, 'has an invalid legacy envelope.', error)
  }
  const cipherValueStart = markerIndex + marker.length
  const legacyPrefixWindow = initial.subarray(cipherValueStart).toString('ascii')
  const prefixMatch = legacyPrefixWindow.match(/^v3:(aes-256-gcm|chacha20-poly1305):([^:]+):([^:]+):/)
  if (!prefixMatch) throw durableError(label, 'uses an unsupported legacy ciphertext.')
  const innerAlgorithm = normalizeAlgorithm(prefixMatch[1])
  const profile = {
    algorithm: normalizeAlgorithm(metadata.algorithm),
    passwordBinding: String(metadata.passwordBinding || ''),
  }
  if (profile.algorithm !== innerAlgorithm) throw durableError(label, 'has inconsistent cipher metadata.')
  const iv = Buffer.from(prefixMatch[2], 'base64')
  const authTag = Buffer.from(prefixMatch[3], 'base64')
  if (iv.length !== 12 || authTag.length !== AUTH_TAG_BYTES) {
    throw durableError(label, 'has invalid legacy cipher parameters.')
  }
  const cipherStart = cipherValueStart + Buffer.byteLength(prefixMatch[0], 'ascii')
  const handle = await fs.open(target, 'r')
  let tail
  try {
    tail = await readWindow(handle, 2, stat.size - 2)
  } finally {
    await handle.close()
  }
  if (!tail.equals(Buffer.from('"}', 'utf8')) || cipherStart > stat.size - 2) {
    throw durableError(label, 'has an invalid legacy envelope terminator.')
  }
  return {
    encrypted: true,
    version: 1,
    profile,
    iv,
    authTag,
    cipherStart,
    cipherEnd: stat.size - 2,
    plainBytes: null,
  }
}

export async function inspectDurableEnvelopeFile(target, magic, label = 'Encrypted payload') {
  const handle = await fs.open(target, 'r')
  let stat
  let initial
  try {
    stat = await handle.stat()
    initial = await readWindow(handle, Math.min(stat.size, MAX_HEADER_BYTES), 0)
  } finally {
    await handle.close()
  }
  if (!initial.subarray(0, magic.length).equals(magic)) {
    return { encrypted: false, version: 0, profile: null, plainBytes: stat.size, size: stat.size }
  }
  const version = initial[magic.length]
  if (version !== BINARY_VERSION) {
    return { ...(await inspectLegacyEnvelope(target, stat, magic, label, initial)), size: stat.size }
  }
  if (initial.length < magic.length + 5) throw durableError(label, 'is truncated.')
  const metadataBytes = initial.readUInt32BE(magic.length + 1)
  if (metadataBytes <= 0 || metadataBytes > MAX_HEADER_BYTES) {
    throw durableError(label, 'has an invalid binary header length.')
  }
  const metadataStart = magic.length + 5
  const metadataEnd = metadataStart + metadataBytes
  const cipherStart = metadataEnd + 12
  const cipherEnd = stat.size - AUTH_TAG_BYTES
  if (initial.length < cipherStart || cipherEnd < cipherStart) throw durableError(label, 'is truncated.')
  let metadata
  try {
    metadata = JSON.parse(initial.subarray(metadataStart, metadataEnd).toString('utf8'))
  } catch (error) {
    throw durableError(label, 'has an invalid binary header.', error)
  }
  const profile = profileForPolicy(metadata)
  const plainBytes = Number(metadata.plainBytes)
  if (!Number.isSafeInteger(plainBytes) || plainBytes < 0 || cipherEnd - cipherStart !== plainBytes) {
    throw durableError(label, 'has an inconsistent authenticated length.')
  }
  const tailHandle = await fs.open(target, 'r')
  let authTag
  try {
    authTag = await readWindow(tailHandle, AUTH_TAG_BYTES, cipherEnd)
  } finally {
    await tailHandle.close()
  }
  if (authTag.length !== AUTH_TAG_BYTES) throw durableError(label, 'is truncated.')
  return {
    encrypted: true,
    version: BINARY_VERSION,
    profile,
    iv: initial.subarray(metadataEnd, cipherStart),
    authTag,
    aad: initial.subarray(0, metadataEnd),
    cipherStart,
    cipherEnd,
    plainBytes,
    size: stat.size,
  }
}

async function decodeInspectedFile(source, target, inspection, label) {
  if (!inspection.encrypted) {
    await copyFileAtomic(source, target)
    return inspection
  }
  const temporary = uniqueTemporaryPath(target, 'plain-tmp')
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const { decipher } = createSecretDecipherWithProfile(
    inspection.iv,
    inspection.authTag,
    inspection.profile,
  )
  if (inspection.version === BINARY_VERSION) decipher.setAAD(inspection.aad)
  const encryptedInput = inspection.cipherEnd > inspection.cipherStart
    ? createReadStream(source, { start: inspection.cipherStart, end: inspection.cipherEnd - 1 })
    : Readable.from([])
  const stages = [encryptedInput]
  if (inspection.version === 1) stages.push(new Base64DecodeTransform(label))
  stages.push(decipher)
  if (inspection.version === 1) stages.push(new Base64DecodeTransform(label))
  stages.push(createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
  try {
    await pipeline(...stages)
    const stat = await fs.stat(temporary)
    if (inspection.plainBytes !== null && stat.size !== inspection.plainBytes) {
      throw durableError(label, 'failed its authenticated length check.')
    }
    await publishTemporaryFile(temporary, target)
    return inspection
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    if (error?.code === 'DURABLE_ENVELOPE_INVALID') throw error
    throw durableError(label, 'could not be authenticated.', error)
  }
}

export async function decodeDurableEnvelopeFile(source, target, magic, label = 'Encrypted payload') {
  const inspection = await inspectDurableEnvelopeFile(source, magic, label)
  return decodeInspectedFile(source, target, inspection, label)
}

export async function encodeDurableEnvelopeFile(source, target, magic, policy) {
  if (!policy?.encryptionAtRest) {
    await copyFileAtomic(source, target)
    return { encrypted: false, version: 0, profile: null, plainBytes: await sizeOfSource(source) }
  }
  return encodeBinaryFile(source, target, magic, policy)
}

export async function rewrapDurableEnvelopeFile(target, magic, label, policy) {
  const inspection = await inspectDurableEnvelopeFile(target, magic, label)
  const wantsEncryption = Boolean(policy?.encryptionAtRest)
  const desiredProfile = profileForPolicy(policy)
  if (!wantsEncryption && !inspection.encrypted) return { changed: false, ...inspection }
  if (wantsEncryption && inspection.encrypted && profilesEqual(inspection.profile, desiredProfile)) {
    return { changed: false, ...inspection }
  }
  const plain = uniqueTemporaryPath(path.join(path.dirname(target), '.durable-rewrap'), 'plain')
  try {
    await decodeInspectedFile(target, plain, inspection, label)
    await encodeDurableEnvelopeFile(plain, target, magic, policy)
    return { changed: true, ...(await inspectDurableEnvelopeFile(target, magic, label)) }
  } finally {
    await fs.rm(plain, { force: true }).catch(() => undefined)
  }
}

async function encodeLegacyV1File(source, target, magic, policy) {
  const profile = profileForPolicy(policy)
  const { cipher, iv, algorithm } = createSecretCipherWithProfile(profile)
  const cipherPath = uniqueTemporaryPath(path.join(os.tmpdir(), 'phd-atlas-durable-cipher'))
  const temporary = uniqueTemporaryPath(target)
  try {
    await pipeline(
      sourceStream(source),
      new Base64EncodeTransform(),
      cipher,
      createWriteStream(cipherPath, { flags: 'wx', mode: 0o600 }),
    )
    const tag = cipher.getAuthTag()
    const cipherPrefix = `v3:${algorithm}:${iv.toString('base64')}:${tag.toString('base64')}:`
    const jsonPrefix = `{"version":1,"algorithm":${JSON.stringify(algorithm)},"passwordBinding":${JSON.stringify(profile.passwordBinding)},"ciphertext":${JSON.stringify(cipherPrefix).slice(0, -1)}`
    const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    output.write(magic)
    output.write(jsonPrefix)
    await pipeline(createReadStream(cipherPath), new Base64EncodeTransform(), output, { end: false })
    output.end('"}')
    await finished(output)
    await publishTemporaryFile(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(cipherPath, { force: true }).catch(() => undefined)
  }
}

/**
 * External state deliberately remains legacy-v1 on write so a deployment can
 * roll back to an older server. Construction is streamed through disk-backed
 * ciphertext and returns only the single Buffer required by SQL BLOB drivers.
 */
export async function encodeExternalStatePayloadStreaming(payload, policy) {
  if (!policy?.encryptionAtRest) return Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
  const target = uniqueTemporaryPath(path.join(os.tmpdir(), 'phd-atlas-external-envelope'))
  try {
    await encodeLegacyV1File(payload, target, EXTERNAL_STATE_MAGIC, policy)
    return await fs.readFile(target)
  } finally {
    await fs.rm(target, { force: true }).catch(() => undefined)
  }
}

export async function encodeExternalStateFileStreaming(source, policy) {
  if (!policy?.encryptionAtRest) return fs.readFile(source)
  const target = uniqueTemporaryPath(path.join(os.tmpdir(), 'phd-atlas-external-envelope'))
  try {
    await encodeLegacyV1File(source, target, EXTERNAL_STATE_MAGIC, policy)
    return await fs.readFile(target)
  } finally {
    await fs.rm(target, { force: true }).catch(() => undefined)
  }
}

export async function decodeExternalStatePayloadToFile(payload, target) {
  const source = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
  if (!source.subarray(0, EXTERNAL_STATE_MAGIC.length).equals(EXTERNAL_STATE_MAGIC)) {
    const temporary = uniqueTemporaryPath(target)
    try {
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      await fs.writeFile(temporary, source, { flag: 'wx', mode: 0o600 })
      await publishTemporaryFile(temporary, target)
      return { encrypted: false, version: 0, profile: null, plainBytes: source.length }
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
  const envelope = uniqueTemporaryPath(path.join(os.tmpdir(), 'phd-atlas-external-read'))
  try {
    await fs.writeFile(envelope, source, { flag: 'wx', mode: 0o600 })
    return await decodeDurableEnvelopeFile(
      envelope,
      target,
      EXTERNAL_STATE_MAGIC,
      'Encrypted external database state',
    )
  } finally {
    await fs.rm(envelope, { force: true }).catch(() => undefined)
  }
}

export async function encodeBackupFile(source, target, policy) {
  return encodeDurableEnvelopeFile(source, target, BACKUP_ENVELOPE_MAGIC, policy)
}

export async function decodeBackupFile(source, target) {
  return decodeDurableEnvelopeFile(source, target, BACKUP_ENVELOPE_MAGIC, 'Encrypted backup')
}

export async function inspectBackupFile(source) {
  return inspectDurableEnvelopeFile(source, BACKUP_ENVELOPE_MAGIC, 'Encrypted backup')
}

export async function rewrapBackupFile(target, policy) {
  return rewrapDurableEnvelopeFile(target, BACKUP_ENVELOPE_MAGIC, 'Encrypted backup', policy)
}

export function encodeDurableEnvelope(payload, magic, policy) {
  const plain = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
  if (!policy?.encryptionAtRest) return plain
  const algorithm = String(policy.encryptionAlgorithm || 'aes-256-gcm')
  const passwordBinding = String(policy.passwordBinding || '')
  const ciphertext = encryptSecretWithProfile(plain.toString('base64'), { algorithm, passwordBinding })
  return Buffer.concat([
    magic,
    Buffer.from(JSON.stringify({ version: 1, algorithm, passwordBinding, ciphertext }), 'utf8'),
  ])
}

export function decodeDurableEnvelope(payload, magic, label) {
  const source = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
  if (!source.subarray(0, magic.length).equals(magic)) {
    return { plain: source, encrypted: false, profile: null }
  }
  // Binary v2 is intended for file streaming. Keep this bounded Buffer reader
  // for existing small callers and tests; workspace archives use the file API.
  if (source[magic.length] === BINARY_VERSION) {
    try {
      const metadataBytes = source.readUInt32BE(magic.length + 1)
      if (metadataBytes <= 0 || metadataBytes > MAX_HEADER_BYTES) throw new Error('invalid header length')
      const metadataStart = magic.length + 5
      const metadataEnd = metadataStart + metadataBytes
      const metadata = JSON.parse(source.subarray(metadataStart, metadataEnd).toString('utf8'))
      const profile = profileForPolicy(metadata)
      const iv = source.subarray(metadataEnd, metadataEnd + 12)
      const encrypted = source.subarray(metadataEnd + 12, source.length - AUTH_TAG_BYTES)
      const tag = source.subarray(source.length - AUTH_TAG_BYTES)
      const { decipher } = createSecretDecipherWithProfile(iv, tag, profile)
      decipher.setAAD(source.subarray(0, metadataEnd))
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()])
      if (plain.length !== Number(metadata.plainBytes)) throw new Error('length mismatch')
      return { plain, encrypted: true, profile }
    } catch (error) {
      throw durableError(`Encrypted ${label}`, 'could not be authenticated.', error)
    }
  }
  let envelope
  try {
    envelope = JSON.parse(source.subarray(magic.length).toString('utf8'))
  } catch {
    throw new Error(`Encrypted ${label} has an invalid envelope.`)
  }
  const profile = {
    algorithm: String(envelope.algorithm || 'aes-256-gcm'),
    passwordBinding: String(envelope.passwordBinding || ''),
  }
  const plain = decryptSecretWithProfile(String(envelope.ciphertext || ''), profile)
  if (!plain) throw new Error(`Encrypted ${label} could not be authenticated.`)
  return { plain: Buffer.from(plain, 'base64'), encrypted: true, profile }
}

export function encodeExternalStatePayload(payload, policy) {
  return encodeDurableEnvelope(payload, EXTERNAL_STATE_MAGIC, policy)
}

export function decodeExternalStatePayload(payload) {
  return decodeDurableEnvelope(payload, EXTERNAL_STATE_MAGIC, 'external database state').plain
}

export function encodeBackupPayload(payload, policy) {
  return encodeDurableEnvelope(payload, BACKUP_ENVELOPE_MAGIC, policy)
}

export function decodeBackupPayload(payload) {
  return decodeDurableEnvelope(payload, BACKUP_ENVELOPE_MAGIC, 'backup')
}
