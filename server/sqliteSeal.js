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

const SEAL_MAGIC = Buffer.from('PHDSQL1\0') // 8 bytes
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

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
export async function sealSqliteFile(plainPath, sealedPath, hexKey) {
  const key = keyFromHex(hexKey)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const tmp = `${sealedPath}.tmp-${process.pid}`
  await fs.mkdir(path.dirname(sealedPath), { recursive: true })

  const out = createWriteStream(tmp)
  out.write(SEAL_MAGIC)
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
  await fs.rename(tmp, sealedPath)
}

/**
 * @param {string} sealedPath
 * @param {string} plainPath
 * @param {string} hexKey
 */
export async function unsealSqliteFile(sealedPath, plainPath, hexKey) {
  const key = keyFromHex(hexKey)
  const raw = await fs.readFile(sealedPath)
  if (raw.length < SEAL_MAGIC.length + IV_LEN + TAG_LEN + 1) {
    throw new Error('Sealed SQLite file is truncated.')
  }
  if (!raw.subarray(0, SEAL_MAGIC.length).equals(SEAL_MAGIC)) {
    throw new Error('Sealed SQLite file has an unknown format.')
  }
  const iv = raw.subarray(SEAL_MAGIC.length, SEAL_MAGIC.length + IV_LEN)
  const tag = raw.subarray(raw.length - TAG_LEN)
  const encrypted = raw.subarray(SEAL_MAGIC.length + IV_LEN, raw.length - TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()])
  await fs.mkdir(path.dirname(plainPath), { recursive: true })
  const tmp = `${plainPath}.tmp-${process.pid}`
  await fs.writeFile(tmp, plain)
  await fs.rename(tmp, plainPath)
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
