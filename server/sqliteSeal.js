/**
 * Whole-file AES-256-GCM seal for the SQLite database at rest.
 * While the process is running the plain .sqlite file is open; on seal the
 * ciphertext is written to a sibling .sealed file (and optionally the plain
 * copy is removed after a successful seal).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform, Writable } from 'node:stream'
import path from 'node:path'

const SEAL_MAGIC_V1 = Buffer.from('PHDSQL1\0') // legacy AES-only format
const SEAL_MAGIC_V2 = Buffer.from('PHDSQL2\0') // algorithm byte follows
const IV_LEN = 12
const TAG_LEN = 16
const SEAL_CHUNK_BYTES = 64 * 1024
const replaceQueues = new Map()

function isReplaceConflict(error) {
  return error?.code === 'EEXIST' || error?.code === 'EPERM' || error?.code === 'EBUSY'
}

async function renameWithRetry(source, destination) {
  let lastError
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(source, destination)
      return
    } catch (error) {
      lastError = error
      if (!isReplaceConflict(error) || attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw lastError
}

export async function replaceFileAtomic(temporary, target) {
  const previous = replaceQueues.get(target) ?? Promise.resolve()
  const replacement = previous.catch(() => undefined).then(async () => {
    try {
      await fs.rename(temporary, target)
      return
    } catch (error) {
      if (!isReplaceConflict(error)) throw error
    }

    // Windows does not replace an existing destination with fs.rename(). Keep
    // the last authenticated snapshot beside it until the new one is in place
    // so startup recovery can survive an interruption between the two moves.
    const previousSnapshot = `${target}.previous-${process.pid}-${Date.now()}`
    let movedPrevious = false
    try {
      try {
        await renameWithRetry(target, previousSnapshot)
        movedPrevious = true
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await renameWithRetry(temporary, target)
      if (movedPrevious) await fs.rm(previousSnapshot, { force: true })
    } catch (error) {
      if (movedPrevious) {
        try {
          await fs.access(target)
        } catch {
          await renameWithRetry(previousSnapshot, target).catch(() => undefined)
        }
      }
      throw error
    }
  })
  replaceQueues.set(target, replacement)
  try {
    await replacement
  } finally {
    if (replaceQueues.get(target) === replacement) replaceQueues.delete(target)
  }
}

function normalizedAlgorithm(value) {
  return value === 'chacha20-poly1305' ? 'chacha20-poly1305' : 'aes-256-gcm'
}

function algorithmCode(value) {
  return normalizedAlgorithm(value) === 'chacha20-poly1305' ? 2 : 1
}

function algorithmFromCode(value) {
  if (value === 2) return 'chacha20-poly1305'
  if (value === 1) return 'aes-256-gcm'
  throw new Error('Sealed SQLite file uses an unsupported algorithm.')
}

async function readSealedMetadata(sealedPath) {
  const handle = await fs.open(sealedPath, 'r')
  try {
    const stat = await handle.stat()
    const prefix = Buffer.alloc(SEAL_MAGIC_V2.length + 1 + IV_LEN)
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0)
    if (prefixRead.bytesRead < SEAL_MAGIC_V1.length + IV_LEN || stat.size < SEAL_MAGIC_V1.length + IV_LEN + TAG_LEN) {
      throw new Error('Sealed SQLite file is truncated.')
    }
    const isV2 = prefix.subarray(0, SEAL_MAGIC_V2.length).equals(SEAL_MAGIC_V2)
    const isV1 = prefix.subarray(0, SEAL_MAGIC_V1.length).equals(SEAL_MAGIC_V1)
    if (!isV1 && !isV2) throw new Error('Sealed SQLite file has an unknown format.')
    const algorithm = isV2 ? algorithmFromCode(prefix[SEAL_MAGIC_V2.length]) : 'aes-256-gcm'
    const payloadOffset = isV2 ? SEAL_MAGIC_V2.length + 1 : SEAL_MAGIC_V1.length
    const encryptedStart = payloadOffset + IV_LEN
    const encryptedEnd = stat.size - TAG_LEN
    if (encryptedEnd < encryptedStart) throw new Error('Sealed SQLite file is truncated.')
    const tag = Buffer.alloc(TAG_LEN)
    const tagRead = await handle.read(tag, 0, TAG_LEN, encryptedEnd)
    if (tagRead.bytesRead !== TAG_LEN) throw new Error('Sealed SQLite file is truncated.')
    return {
      algorithm,
      iv: prefix.subarray(payloadOffset, payloadOffset + IV_LEN),
      tag,
      encryptedStart,
      encryptedEnd,
      encryptedBytes: encryptedEnd - encryptedStart,
    }
  } finally {
    await handle.close()
  }
}

/**
 * @param {string} hexKey 64-char hex (32 bytes)
 */
function keyFromHex(hexKey) {
  const key = Buffer.from(String(hexKey ?? ''), 'hex')
  if (key.length !== 32) {
    // Fall back to a stable 32-byte digest so misconfigured keys still fail closed.
    return createHash('sha256').update(String(hexKey ?? '')).digest()
  }
  return key
}

/**
 * @param {string} plainPath
 * @param {string} sealedPath
 * @param {string} hexKey
 */
export async function sealSqliteFile(plainPath, sealedPath, hexKey, algorithm = 'aes-256-gcm') {
  const key = keyFromHex(hexKey)
  const iv = randomBytes(IV_LEN)
  const selectedAlgorithm = normalizedAlgorithm(algorithm)
  const cipher = createCipheriv(selectedAlgorithm, key, iv)
  const tmp = `${sealedPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
  await fs.mkdir(path.dirname(sealedPath), { recursive: true })

  const out = createWriteStream(tmp, { flags: 'wx', mode: 0o600 })
  out.write(SEAL_MAGIC_V2)
  out.write(Buffer.from([algorithmCode(selectedAlgorithm)]))
  out.write(iv)

  const transform = new Transform({
    transform(chunk, _enc, cb) {
      try {
        cb(null, cipher.update(chunk))
      } catch (error) {
        cb(error)
      }
    },
    flush(cb) {
      try {
        const final = cipher.final()
        const tag = cipher.getAuthTag()
        this.push(final)
        this.push(tag)
        cb()
      } catch (error) {
        cb(error)
      }
    },
  })

  try {
    await pipeline(createReadStream(plainPath), transform, out)
    const handle = await fs.open(tmp, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFileAtomic(tmp, sealedPath)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Seal an in-memory SQLite image without ever creating a plaintext file. */
export async function sealSqliteBuffer(plain, sealedPath, hexKey, algorithm = 'aes-256-gcm') {
  const key = keyFromHex(hexKey)
  const iv = randomBytes(IV_LEN)
  const selectedAlgorithm = normalizedAlgorithm(algorithm)
  const cipher = createCipheriv(selectedAlgorithm, key, iv)
  const tmp = `${sealedPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
  await fs.mkdir(path.dirname(sealedPath), { recursive: true })
  try {
    const out = createWriteStream(tmp, { mode: 0o600, flags: 'wx' })
    out.write(SEAL_MAGIC_V2)
    out.write(Buffer.from([algorithmCode(selectedAlgorithm)]))
    out.write(iv)
    const transform = new Transform({
      transform(chunk, _enc, callback) {
        try {
          callback(null, cipher.update(chunk))
        } catch (error) {
          callback(error)
        }
      },
      flush(callback) {
        try {
          this.push(cipher.final())
          this.push(cipher.getAuthTag())
          callback()
        } catch (error) {
          callback(error)
        }
      },
    })
    const chunks = function *chunks() {
      for (let offset = 0; offset < plain.length; offset += SEAL_CHUNK_BYTES) {
        yield plain.subarray(offset, Math.min(plain.length, offset + SEAL_CHUNK_BYTES))
      }
    }
    await pipeline(Readable.from(chunks()), transform, out)
    const handle = await fs.open(tmp, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFileAtomic(tmp, sealedPath)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Open a sealed SQLite image into memory. Authentication is checked first. */
export async function unsealSqliteBuffer(sealedPath, hexKey) {
  const key = keyFromHex(hexKey)
  const metadata = await readSealedMetadata(sealedPath)
  const decipher = createDecipheriv(metadata.algorithm, key, metadata.iv)
  decipher.setAuthTag(metadata.tag)
  const plain = Buffer.allocUnsafe(metadata.encryptedBytes)
  const input = Buffer.allocUnsafe(Math.min(SEAL_CHUNK_BYTES, Math.max(1, metadata.encryptedBytes)))
  const handle = await fs.open(sealedPath, 'r')
  let inputOffset = metadata.encryptedStart
  let outputOffset = 0
  try {
    while (inputOffset < metadata.encryptedEnd) {
      const requested = Math.min(input.length, metadata.encryptedEnd - inputOffset)
      const { bytesRead } = await handle.read(input, 0, requested, inputOffset)
      if (!bytesRead) throw new Error('Sealed SQLite file is truncated.')
      inputOffset += bytesRead
      const opened = decipher.update(input.subarray(0, bytesRead))
      opened.copy(plain, outputOffset)
      outputOffset += opened.length
    }
    const final = decipher.final()
    final.copy(plain, outputOffset)
    outputOffset += final.length
    if (outputOffset !== plain.length) throw new Error('Sealed SQLite file has an inconsistent length.')
    return plain
  } catch (error) {
    plain.fill(0)
    throw error
  } finally {
    await handle.close()
  }
}

/**
 * @param {string} sealedPath
 * @param {string} plainPath
 * @param {string} hexKey
 */
export async function unsealSqliteFile(sealedPath, plainPath, hexKey) {
  const key = keyFromHex(hexKey)
  const metadata = await readSealedMetadata(sealedPath)
  const decipher = createDecipheriv(metadata.algorithm, key, metadata.iv)
  decipher.setAuthTag(metadata.tag)
  await fs.mkdir(path.dirname(plainPath), { recursive: true })
  const tmp = `${plainPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
  try {
    const input = metadata.encryptedBytes
      ? createReadStream(sealedPath, { start: metadata.encryptedStart, end: metadata.encryptedEnd - 1 })
      : Readable.from([])
    await pipeline(input, decipher, createWriteStream(tmp, { flags: 'wx', mode: 0o600 }))
    const output = await fs.open(tmp, 'r+')
    try {
      await output.sync()
    } finally {
      await output.close()
    }
    await replaceFileAtomic(tmp, plainPath)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Authenticate a sealed image while discarding plaintext as it streams. */
export async function verifySealedSqliteFile(sealedPath, hexKey) {
  const key = keyFromHex(hexKey)
  const metadata = await readSealedMetadata(sealedPath)
  const decipher = createDecipheriv(metadata.algorithm, key, metadata.iv)
  decipher.setAuthTag(metadata.tag)
  const input = metadata.encryptedBytes
    ? createReadStream(sealedPath, { start: metadata.encryptedStart, end: metadata.encryptedEnd - 1 })
    : Readable.from([])
  await pipeline(input, decipher, new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }))
  return true
}

/** Copy an already sealed image, re-authenticate the copy, then publish it. */
export async function promoteSealedSqliteFile(source, target, hexKey) {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
  await fs.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.copyFile(source, temporary)
    await fs.chmod(temporary, 0o600).catch(() => undefined)
    await verifySealedSqliteFile(temporary, hexKey)
    const handle = await fs.open(temporary, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFileAtomic(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * @param {string} sealedPath
 */
export async function sealedSqliteExists(sealedPath) {
  try {
    const st = await fs.stat(sealedPath)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

/**
 * @param {string} plainPath
 */
export async function plainSqliteExists(plainPath) {
  try {
    const st = await fs.stat(plainPath)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

export function sealedPathFor(databasePath) {
  return `${databasePath}.sealed`
}
