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
import { deriveSqliteKey, normalizeAlgorithm } from './crypto.js'

const MAGIC = Buffer.from('PHDUPLOAD2\n', 'utf8')
const HEADER_LENGTH_BYTES = 4
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_HEADER_BYTES = 64 * 1024
const JOURNAL_NAME = '.upload-vault-migration.json'
const JOURNAL_PREVIOUS_NAME = '.upload-vault-migration.previous.json'
const JOURNAL_TEMP_NAME = '.upload-vault-migration.next.json'
const NEXT_SUFFIX = '.vault-next'
const PREVIOUS_SUFFIX = '.vault-previous'

export class UploadVaultError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'UploadVaultError'
    this.code = code
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

function parseEnvelope(source) {
  if (!Buffer.isBuffer(source)) source = Buffer.from(source ?? '')
  if (!source.subarray(0, MAGIC.length).equals(MAGIC)) {
    // Keep genuine headerless legacy uploads readable, but never downgrade an
    // envelope-shaped file with a damaged or unknown signature to plaintext.
    if (resemblesEnvelopeWithInvalidMagic(source)) {
      throw new UploadVaultError('UPLOAD_ENVELOPE_MAGIC_INVALID', 'Encrypted upload signature is invalid.')
    }
    return null
  }
  const minimum = MAGIC.length + HEADER_LENGTH_BYTES + IV_BYTES + TAG_BYTES
  if (source.length < minimum) {
    throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
  }
  const headerLength = source.readUInt32BE(MAGIC.length)
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
    throw new UploadVaultError('UPLOAD_ENVELOPE_INVALID', 'Encrypted upload metadata is invalid.')
  }
  const headerStart = MAGIC.length + HEADER_LENGTH_BYTES
  const headerEnd = headerStart + headerLength
  const ivEnd = headerEnd + IV_BYTES
  if (ivEnd + TAG_BYTES > source.length) {
    throw new UploadVaultError('UPLOAD_ENVELOPE_TRUNCATED', 'Encrypted upload is truncated.')
  }
  const profile = parseEnvelopeHeader(source.subarray(headerStart, headerEnd))
  return {
    profile,
    prefix: source.subarray(0, ivEnd),
    iv: source.subarray(headerEnd, ivEnd),
    encrypted: source.subarray(ivEnd, source.length - TAG_BYTES),
    tag: source.subarray(source.length - TAG_BYTES),
  }
}

function decodeUploadPayload(source) {
  const envelope = parseEnvelope(source)
  if (!envelope) return { plain: Buffer.from(source), profile: null }
  try {
    const decipher = createDecipheriv(
      envelope.profile.algorithm,
      uploadKey(envelope.profile),
      envelope.iv,
    )
    decipher.setAAD(envelope.prefix)
    decipher.setAuthTag(envelope.tag)
    return {
      plain: Buffer.concat([decipher.update(envelope.encrypted), decipher.final()]),
      profile: envelope.profile,
    }
  } catch (error) {
    throw new UploadVaultError(
      'UPLOAD_AUTHENTICATION_FAILED',
      'Encrypted upload could not be authenticated.',
      error,
    )
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

async function readDecodedPath(target, { maxBytes } = {}) {
  const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes >= 0 ? maxBytes : null
  let source
  try {
    if (byteLimit !== null) {
      const stat = await fs.stat(target)
      const maximumEnvelopeOverhead = MAGIC.length + HEADER_LENGTH_BYTES + MAX_HEADER_BYTES + IV_BYTES + TAG_BYTES
      if (stat.size > byteLimit + maximumEnvelopeOverhead) {
        throw new UploadVaultError(
          'UPLOAD_DECRYPTED_SIZE_LIMIT',
          `Stored upload exceeds the ${byteLimit}-byte decrypted size limit.`,
        )
      }
    }
    source = await fs.readFile(target)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new UploadVaultError('UPLOAD_NOT_FOUND', 'Stored upload was not found.', error)
    }
    throw error
  }
  const decoded = decodeUploadPayload(source)
  if (byteLimit !== null && decoded.plain.length > byteLimit) {
    throw new UploadVaultError(
      'UPLOAD_DECRYPTED_SIZE_LIMIT',
      `Stored upload exceeds the ${byteLimit}-byte decrypted size limit.`,
    )
  }
  return decoded
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function verifyEquivalent(target, expectedPlain, policy) {
  const decoded = await readDecodedPath(target)
  if (!profileMatchesPolicy(decoded.profile, policy)) {
    throw new UploadVaultError('UPLOAD_MIGRATION_POLICY_MISMATCH', 'Migrated upload uses the wrong encryption policy.')
  }
  if (decoded.plain.length !== expectedPlain.length || digest(decoded.plain) !== digest(expectedPlain)) {
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

async function pathPolicyAndPlain(target) {
  try {
    return await readDecodedPath(target)
  } catch (error) {
    if (error?.code === 'UPLOAD_NOT_FOUND') return null
    throw error
  }
}

async function recoverableArtifact(target) {
  try {
    return await pathPolicyAndPlain(target)
  } catch (error) {
    if (error instanceof UploadVaultError) return null
    throw error
  }
}

async function recoverArtifacts(root, name, targetPolicy) {
  const paths = artifactPaths(root, name)
  const [targetExists, nextExists, previousExists] = await Promise.all([
    exists(paths.target),
    exists(paths.next),
    exists(paths.previous),
  ])
  if (!nextExists && !previousExists) return

  // A promoted replacement can be interrupted before the old file is
  // removed. Treat an unauthentic target as unusable here so the still-valid
  // previous artifact can be restored; normal reads continue to fail closed
  // when there is no recovery artifact.
  let target = targetExists ? await recoverableArtifact(paths.target) : null
  const next = nextExists ? await recoverableArtifact(paths.next) : null
  const previous = previousExists ? await recoverableArtifact(paths.previous) : null

  // A brand-new upload may crash after its authenticated `.vault-next` file is
  // durable but before the first promotion creates the final target. Preserve
  // any authenticated envelope (migration below can re-key an older profile),
  // while deleting partial/corrupt/plaintext orphan artifacts without making
  // startup fail or exposing their bytes as a completed upload.
  if (!targetExists && !previousExists) {
    if (next?.profile) {
      await fs.rename(paths.next, paths.target)
    } else {
      await fs.rm(paths.next, { force: true })
    }
    return
  }

  if (target && profileMatchesPolicy(target.profile, targetPolicy)) {
    await Promise.all([fs.rm(paths.next, { force: true }), fs.rm(paths.previous, { force: true })])
    return
  }

  const reference = target ?? previous
  const nextIsReplacement = Boolean(next)
    && profileMatchesPolicy(next.profile, targetPolicy)
    && Boolean(reference)
    && next.plain.length === reference.plain.length
    && digest(next.plain) === digest(reference.plain)

  if (nextIsReplacement) {
    if (target) {
      await fs.rm(paths.previous, { force: true })
      await fs.rename(paths.target, paths.previous)
    } else if (targetExists) {
      await fs.rm(paths.target, { force: true })
    }
    await fs.rename(paths.next, paths.target)
    await verifyEquivalent(paths.target, reference.plain, targetPolicy)
    await fs.rm(paths.previous, { force: true })
    return
  }

  await fs.rm(paths.next, { force: true })
  if (!target && previous) {
    if (targetExists) await fs.rm(paths.target, { force: true })
    await fs.rename(paths.previous, paths.target)
    target = previous
  } else {
    await fs.rm(paths.previous, { force: true })
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
export function createUploadVault({ root, policyProvider = () => ({}), migrationHook } = {}) {
  if (!root) throw new TypeError('Upload vault root is required.')
  const absoluteRoot = path.resolve(root)
  let operationTail = Promise.resolve()

  const locked = (operation) => {
    const running = operationTail.then(operation, operation)
    operationTail = running.catch(() => undefined)
    return running
  }

  const targetPath = (storageName) => path.join(absoluteRoot, safeStorageName(storageName))

  async function ensureReady() {
    await fs.mkdir(absoluteRoot, { recursive: true })
  }

  async function writeBufferUnlocked(storageName, plain, policy = policyProvider()) {
    await ensureReady()
    const name = safeStorageName(storageName)
    const paths = artifactPaths(absoluteRoot, name)
    await recoverArtifacts(absoluteRoot, name, policy)
    await fs.rm(paths.next, { force: true })
    await writeDurableFile(paths.next, encodeUploadPayload(plain, policy))
    await verifyEquivalent(paths.next, Buffer.from(plain), policy)
    if (await exists(paths.target)) {
      await fs.rm(paths.previous, { force: true })
      await fs.rename(paths.target, paths.previous)
    }
    try {
      await fs.rename(paths.next, paths.target)
      await verifyEquivalent(paths.target, Buffer.from(plain), policy)
      await fs.rm(paths.previous, { force: true })
    } catch (error) {
      await fs.rm(paths.target, { force: true }).catch(() => undefined)
      if (await exists(paths.previous)) await fs.rename(paths.previous, paths.target).catch(() => undefined)
      throw error
    }
    return { path: paths.target, size: Buffer.byteLength(plain), encrypted: normalizedPolicy(policy).encryptionAtRest }
  }

  async function writeStreamUnlocked(storageName, stream, policy = policyProvider()) {
    await ensureReady()
    const name = safeStorageName(storageName)
    const paths = artifactPaths(absoluteRoot, name)
    await recoverArtifacts(absoluteRoot, name, policy)
    await fs.rm(paths.next, { force: true })
    const selected = normalizedPolicy(policy)
    const handle = await fs.open(paths.next, 'wx', 0o600)
    let size = 0
    let position = 0
    try {
      if (selected.encryptionAtRest) {
        const profile = profileForPolicy(selected)
        const iv = randomBytes(IV_BYTES)
        const prefix = envelopePrefix(profile, iv)
        const cipher = createCipheriv(profile.algorithm, uploadKey(profile), iv)
        cipher.setAAD(prefix)
        position = await writeAll(handle, prefix, position)
        for await (const chunk of stream) {
          const plainChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += plainChunk.length
          const encrypted = cipher.update(plainChunk)
          if (encrypted.length) position = await writeAll(handle, encrypted, position)
        }
        const final = cipher.final()
        if (final.length) position = await writeAll(handle, final, position)
        await writeAll(handle, cipher.getAuthTag(), position)
      } else {
        for await (const chunk of stream) {
          const plainChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += plainChunk.length
          position = await writeAll(handle, plainChunk, position)
        }
      }
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined)
      await fs.rm(paths.next, { force: true }).catch(() => undefined)
      throw error
    }
    await handle.close()

    const decoded = await readDecodedPath(paths.next)
    if (decoded.plain.length !== size || !profileMatchesPolicy(decoded.profile, selected)) {
      await fs.rm(paths.next, { force: true })
      throw new UploadVaultError('UPLOAD_WRITE_VERIFY_FAILED', 'Stored upload did not pass integrity verification.')
    }
    if (await exists(paths.target)) {
      await fs.rm(paths.previous, { force: true })
      await fs.rename(paths.target, paths.previous)
    }
    try {
      await fs.rename(paths.next, paths.target)
      await fs.rm(paths.previous, { force: true })
    } catch (error) {
      await fs.rm(paths.target, { force: true }).catch(() => undefined)
      if (await exists(paths.previous)) await fs.rename(paths.previous, paths.target).catch(() => undefined)
      throw error
    }
    return { path: paths.target, size, encrypted: selected.encryptionAtRest }
  }

  async function migrateUnlocked(policy = policyProvider()) {
    await ensureReady()
    const targetPolicy = normalizedPolicy(policy)
    const priorJournal = await readJournal(absoluteRoot)
    const recoveryNames = new Set([
      ...(priorJournal?.inFlight?.name ? [priorJournal.inFlight.name] : []),
      ...await orphanArtifactNames(absoluteRoot),
    ])
    for (const name of recoveryNames) {
      await recoverArtifacts(absoluteRoot, safeStorageName(name), targetPolicy)
    }

    const names = await uploadNames(absoluteRoot)
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

    for (const name of names) {
      const paths = artifactPaths(absoluteRoot, name)
      const current = await readDecodedPath(paths.target)
      if (profileMatchesPolicy(current.profile, targetPolicy)) {
        journal.pending = journal.pending.filter((candidate) => candidate !== name)
        journal.completed.push(name)
        journal.updatedAt = new Date().toISOString()
        await durableJsonWrite(absoluteRoot, journal)
        continue
      }

      journal.inFlight = { name }
      journal.updatedAt = new Date().toISOString()
      await durableJsonWrite(absoluteRoot, journal)
      await fs.rm(paths.next, { force: true })
      await writeDurableFile(paths.next, encodeUploadPayload(current.plain, targetPolicy))
      await verifyEquivalent(paths.next, current.plain, targetPolicy)
      await migrationHook?.('after-next-written', { name, root: absoluteRoot })

      await fs.rm(paths.previous, { force: true })
      await fs.rename(paths.target, paths.previous)
      await migrationHook?.('after-original-moved', { name, root: absoluteRoot })
      let previousRemoved = false
      try {
        await fs.rename(paths.next, paths.target)
        await migrationHook?.('after-next-promoted', { name, root: absoluteRoot })
        await verifyEquivalent(paths.target, current.plain, targetPolicy)
        await fs.rm(paths.previous, { force: true })
        previousRemoved = true
        await migrationHook?.('after-previous-removed', { name, root: absoluteRoot })
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
    }

    await Promise.all([
      fs.rm(path.join(absoluteRoot, JOURNAL_NAME), { force: true }),
      fs.rm(path.join(absoluteRoot, JOURNAL_PREVIOUS_NAME), { force: true }),
      fs.rm(path.join(absoluteRoot, JOURNAL_TEMP_NAME), { force: true }),
    ])
    return {
      migrated: journal.completed.length,
      encryptionAtRest: targetPolicy.encryptionAtRest,
      encryptionAlgorithm: targetPolicy.encryptionAlgorithm,
    }
  }

  return {
    root: absoluteRoot,
    pathFor: targetPath,
    ensureReady: () => locked(ensureReady),
    exists: (storageName) => locked(() => exists(targetPath(storageName))),
    inspect: (storageName) => locked(async () => {
      const decoded = await readDecodedPath(targetPath(storageName))
      return {
        encrypted: decoded.profile !== null,
        algorithm: decoded.profile?.algorithm ?? null,
        passwordBound: Boolean(decoded.profile?.passwordBinding),
        size: decoded.plain.length,
      }
    }),
    readBuffer: (storageName, options) => locked(async () => (await readDecodedPath(targetPath(storageName), options)).plain),
    readPrefix: (storageName, byteCount = 8) => locked(async () => (
      (await readDecodedPath(targetPath(storageName))).plain.subarray(0, Math.max(0, byteCount))
    )),
    writeBuffer: (storageName, plain, policy) => locked(() => writeBufferUnlocked(storageName, plain, policy)),
    writeStream: (storageName, stream, policy) => locked(() => writeStreamUnlocked(storageName, stream, policy)),
    remove: (storageName) => locked(() => fs.rm(targetPath(storageName), { force: true })),
    migrate: (policy) => locked(() => migrateUnlocked(policy)),
    withExclusive(operation) {
      if (typeof operation !== 'function') throw new TypeError('Upload vault exclusive operation must be a function.')
      return locked(() => operation({
        root: absoluteRoot,
        ensureReady,
        migrate: migrateUnlocked,
      }))
    },
    multerStorage({
      filename = (_request, file) => defaultStoredName(file),
      policy = () => policyProvider(),
    } = {}) {
      return {
        _handleFile(request, file, callback) {
          // Resolve the policy only after this upload owns the vault lock. If
          // an administrator re-keys while an upload is waiting, this prevents
          // the queued upload from committing with a stale pre-migration
          // algorithm/password profile.
          Promise.resolve(filename(request, file))
            .then((name) => locked(async () => (
              writeStreamUnlocked(name, file.stream, await policy(request, file))
            )))
            .then((result) => callback(null, {
              destination: absoluteRoot,
              filename: path.basename(result.path),
              path: result.path,
              size: result.size,
              encryptedAtRest: result.encrypted,
            }), callback)
        },
        _removeFile(_request, file, callback) {
          const name = file?.filename || (file?.path ? path.basename(file.path) : '')
          if (!name) {
            callback(null)
            return
          }
          locked(() => fs.rm(targetPath(name), { force: true })).then(() => callback(null), callback)
        },
      }
    },
    asMailAttachment: async (storageName, { filename, contentType, maxBytes } = {}) => ({
      filename,
      contentType,
      content: await locked(async () => (await readDecodedPath(targetPath(storageName), { maxBytes })).plain),
    }),
  }
}

export const uploadVaultFormat = Object.freeze({
  magic: MAGIC.toString('utf8'),
  version: 2,
  journalName: JOURNAL_NAME,
})
