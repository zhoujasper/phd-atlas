/**
 * Whole-file AES-256-GCM seal for the SQLite database at rest.
 * While the process is running the plain .sqlite file is open; on seal the
 * ciphertext is written to a sibling .sealed file (and optionally the plain
 * copy is removed after a successful seal).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import path from 'node:path'

const SEAL_MAGIC_V1 = Buffer.from('PHDSQL1\0') // legacy AES-only format
const SEAL_MAGIC_V2 = Buffer.from('PHDSQL2\0') // algorithm byte follows
const IV_LEN = 12
const TAG_LEN = 16
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

async function replaceFileAtomic(temporary, target) {
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
  const tmp = `${sealedPath}.tmp-${process.pid}`
  await fs.mkdir(path.dirname(sealedPath), { recursive: true })

  const out = createWriteStream(tmp)
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

  await pipeline(createReadStream(plainPath), transform, out)
  await replaceFileAtomic(tmp, sealedPath)
}

/** Seal an in-memory SQLite image without ever creating a plaintext file. */
export async function sealSqliteBuffer(plain, sealedPath, hexKey, algorithm = 'aes-256-gcm') {
  const key = keyFromHex(hexKey)
  const iv = randomBytes(IV_LEN)
  const selectedAlgorithm = normalizedAlgorithm(algorithm)
  const cipher = createCipheriv(selectedAlgorithm, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const payload = Buffer.concat([
    SEAL_MAGIC_V2,
    Buffer.from([algorithmCode(selectedAlgorithm)]),
    iv,
    encrypted,
    cipher.getAuthTag(),
  ])
  const tmp = `${sealedPath}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(path.dirname(sealedPath), { recursive: true })
  await fs.writeFile(tmp, payload)
  await replaceFileAtomic(tmp, sealedPath)
}

/** Open a sealed SQLite image into memory. Authentication is checked first. */
export async function unsealSqliteBuffer(sealedPath, hexKey) {
  const key = keyFromHex(hexKey)
  const raw = await fs.readFile(sealedPath)
  if (raw.length < SEAL_MAGIC_V1.length + IV_LEN + TAG_LEN + 1) {
    throw new Error('Sealed SQLite file is truncated.')
  }
  const isV2 = raw.subarray(0, SEAL_MAGIC_V2.length).equals(SEAL_MAGIC_V2)
  const isV1 = raw.subarray(0, SEAL_MAGIC_V1.length).equals(SEAL_MAGIC_V1)
  if (!isV1 && !isV2) {
    throw new Error('Sealed SQLite file has an unknown format.')
  }
  const algorithm = isV2 ? algorithmFromCode(raw[SEAL_MAGIC_V2.length]) : 'aes-256-gcm'
  const payloadOffset = (isV2 ? SEAL_MAGIC_V2.length + 1 : SEAL_MAGIC_V1.length)
  const iv = raw.subarray(payloadOffset, payloadOffset + IV_LEN)
  const tag = raw.subarray(raw.length - TAG_LEN)
  const encrypted = raw.subarray(payloadOffset + IV_LEN, raw.length - TAG_LEN)
  const decipher = createDecipheriv(algorithm, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

/**
 * @param {string} sealedPath
 * @param {string} plainPath
 * @param {string} hexKey
 */
export async function unsealSqliteFile(sealedPath, plainPath, hexKey) {
  const plain = await unsealSqliteBuffer(sealedPath, hexKey)
  await fs.mkdir(path.dirname(plainPath), { recursive: true })
  const tmp = `${plainPath}.tmp-${process.pid}`
  await fs.writeFile(tmp, plain)
  await replaceFileAtomic(tmp, plainPath)
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
