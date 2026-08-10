import {
  scryptSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto'
import { getBootstrapSecrets } from './bootstrapSecrets.js'

const ENCRYPTION_KEY = process.env.SETTINGS_ENCRYPTION_KEY
  ?? getBootstrapSecrets().encryptionKey
  ?? (process.env.NODE_ENV === 'production' ? '' : 'phd-atlas-dev-encryption-key')
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 16) {
  console.error('FATAL: SETTINGS_ENCRYPTION_KEY must be at least 16 characters.')
  process.exit(1)
}

/** @typedef {'aes-256-gcm' | 'chacha20-poly1305'} EncryptionAlgorithm */

export const ENCRYPTION_ALGORITHMS = /** @type {const} */ (['aes-256-gcm', 'chacha20-poly1305'])

const PREFIX_V2 = 'v2:'
const PREFIX_V3 = 'v3:'
const PAYLOAD_PREFIX = 'payload:'

const BASE_SALT = 'phd-atlas-settings-salt-v2'

/**
 * Derive the server sealing key from the env secret only.
 * Admin passwords are an authorization gate for re-key operations — they are
 * never required at process boot so the API can start unattended.
 * @param {string} [pepper]
 * @param {string} [passwordSaltB64]
 */
function deriveKeyMaterial(pepper = '', passwordSaltB64 = '') {
  const salt = passwordSaltB64
    ? Buffer.concat([Buffer.from(BASE_SALT, 'utf8'), Buffer.from(passwordSaltB64, 'base64')])
    : Buffer.from(BASE_SALT, 'utf8')
  const material = pepper ? `${ENCRYPTION_KEY}\0${pepper}` : ENCRYPTION_KEY
  return scryptSync(material, salt, 32, { N: 2 ** 14, r: 8, p: 1 })
}

/** Runtime crypto profile (updated when admin changes encryption settings). */
let runtime = {
  algorithm: /** @type {EncryptionAlgorithm} */ ('aes-256-gcm'),
  /** @type {Buffer} */
  key: deriveKeyMaterial(),
  passwordBinding: '',
}
const runtimeCryptoStats = {
  keyDerivations: 1,
  profileChanges: 0,
  reusedConfigurations: 0,
}

/**
 * @param {{ algorithm?: string, passwordBinding?: string }} config
 */
export function setRuntimeCryptoConfig(config = {}) {
  const algorithm = normalizeAlgorithm(config.algorithm)
  const passwordBinding = String(config.passwordBinding || '')
  // Storage reapplies the durable policy after each successful write so a
  // real settings change becomes active immediately. The overwhelmingly
  // common case is the identical profile, where another memory-hard scrypt
  // derivation is pure duplicate work and serializes an otherwise independent
  // burst of account saves on the Node main thread.
  if (runtime.algorithm === algorithm && runtime.passwordBinding === passwordBinding) {
    runtimeCryptoStats.reusedConfigurations += 1
    return getRuntimeCryptoConfig()
  }
  runtime = {
    algorithm,
    // The server secret remains mandatory. When password protection is on, the
    // salted password verifier becomes an additional KDF binding so changing
    // the admin-selected password actually rotates the field data key while
    // unattended boot remains possible.
    key: deriveKeyMaterial(passwordBinding),
    passwordBinding,
  }
  runtimeCryptoStats.keyDerivations += 1
  runtimeCryptoStats.profileChanges += 1
  return getRuntimeCryptoConfig()
}

export function getRuntimeCryptoConfig() {
  return {
    algorithm: runtime.algorithm,
  }
}

/** Non-secret runtime counters used to prove stable policy reapplication is cheap. */
export function runtimeCryptoDiagnostics() {
  return {
    algorithm: runtime.algorithm,
    passwordBound: runtime.passwordBinding.length > 0,
    ...runtimeCryptoStats,
  }
}

export function clearRuntimePassword() {
  // Kept for API compatibility — sealing key does not depend on an interactive password.
}

/**
 * @param {string | null | undefined} value
 * @returns {EncryptionAlgorithm}
 */
export function normalizeAlgorithm(value) {
  if (value === 'chacha20-poly1305') return 'chacha20-poly1305'
  return 'aes-256-gcm'
}

/**
 * Create an authenticated cipher for streaming durable payloads without
 * materialising their plaintext as a UTF-8/base64 string. The caller owns the
 * returned stream and must persist `cipher.getAuthTag()` after it has ended.
 */
export function createSecretCipherWithProfile(profile = {}, iv = randomBytes(12)) {
  const algorithm = normalizeAlgorithm(profile.algorithm)
  const key = profile.key
    ?? deriveKeyMaterial(String(profile.passwordBinding || ''))
  return {
    algorithm,
    iv,
    cipher: createCipheriv(nodeAlgorithm(algorithm), key, iv),
  }
}

/**
 * Create an authenticated decipher for a streaming durable payload. Setting
 * the tag before piping means `final()` rejects before a temporary plaintext
 * file can ever be promoted to its destination.
 */
export function createSecretDecipherWithProfile(iv, authTag, profile = {}) {
  const algorithm = normalizeAlgorithm(profile.algorithm)
  const key = profile.key
    ?? deriveKeyMaterial(String(profile.passwordBinding || ''))
  const decipher = createDecipheriv(nodeAlgorithm(algorithm), key, iv)
  decipher.setAuthTag(authTag)
  return { algorithm, decipher }
}

/**
 * @param {EncryptionAlgorithm} algorithm
 */
function nodeAlgorithm(algorithm) {
  return algorithm === 'chacha20-poly1305' ? 'chacha20-poly1305' : 'aes-256-gcm'
}

/**
 * @param {string} plaintext
 * @param {{ algorithm?: EncryptionAlgorithm, key?: Buffer }} [options]
 */
export function encryptSecret(plaintext, options = {}) {
  if (!plaintext) return ''
  const algorithm = normalizeAlgorithm(options.algorithm ?? runtime.algorithm)
  const key = options.key ?? runtime.key
  const iv = randomBytes(12)
  const cipher = createCipheriv(nodeAlgorithm(algorithm), key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    PREFIX_V3 + algorithm,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

/**
 * @param {string} ciphertext
 * @param {{ key?: Buffer }} [options]
 */
export function decryptSecret(ciphertext, options = {}) {
  if (!ciphertext) return ''
  const key = options.key ?? runtime.key

  if (ciphertext.startsWith(PREFIX_V3)) {
    try {
      const body = ciphertext.slice(PREFIX_V3.length)
      const algorithmEnd = body.indexOf(':')
      const ivEnd = body.indexOf(':', algorithmEnd + 1)
      const tagEnd = body.indexOf(':', ivEnd + 1)
      if (
        algorithmEnd <= 0
        || ivEnd <= algorithmEnd + 1
        || tagEnd <= ivEnd + 1
        || body.indexOf(':', tagEnd + 1) !== -1
      ) return ''
      const algorithm = normalizeAlgorithm(body.slice(0, algorithmEnd))
      const iv = Buffer.from(body.slice(algorithmEnd + 1, ivEnd), 'base64')
      const authTag = Buffer.from(body.slice(ivEnd + 1, tagEnd), 'base64')
      const decipher = createDecipheriv(nodeAlgorithm(algorithm), key, iv)
      decipher.setAuthTag(authTag)
      return decipher.update(body.slice(tagEnd + 1), 'base64', 'utf8') + decipher.final('utf8')
    } catch {
      return ''
    }
  }

  if (ciphertext.startsWith(PREFIX_V2)) {
    try {
      const body = ciphertext.slice(PREFIX_V2.length)
      const ivEnd = body.indexOf(':')
      const tagEnd = body.indexOf(':', ivEnd + 1)
      if (ivEnd <= 0 || tagEnd <= ivEnd + 1 || body.indexOf(':', tagEnd + 1) !== -1) return ''
      const iv = Buffer.from(body.slice(0, ivEnd), 'base64')
      const authTag = Buffer.from(body.slice(ivEnd + 1, tagEnd), 'base64')
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      return decipher.update(body.slice(tagEnd + 1), 'base64', 'utf8') + decipher.final('utf8')
    } catch {
      // Fall through to legacy / alternate-key attempts below.
    }
  }

  // Legacy untagged format
  try {
    const encryptedStart = ciphertext.lastIndexOf(':')
    const tagStart = ciphertext.lastIndexOf(':', encryptedStart - 1)
    const ivStart = ciphertext.lastIndexOf(':', tagStart - 1)
    if (tagStart < 0 || encryptedStart <= tagStart + 1) return ''
    const iv = Buffer.from(ciphertext.slice(ivStart + 1, tagStart), 'base64')
    const authTag = Buffer.from(ciphertext.slice(tagStart + 1, encryptedStart), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext.slice(encryptedStart + 1), 'base64', 'utf8') + decipher.final('utf8')
  } catch {
    return ''
  }
}

/**
 * Decrypt with an explicit key profile (used during algorithm migration).
 * @param {string} ciphertext
 * @param {{ key?: Buffer }} [profile]
 */
export function decryptSecretWithProfile(ciphertext, profile = {}) {
  const key = profile.key
    ?? deriveKeyMaterial(String(profile.passwordBinding || ''))
  return decryptSecret(ciphertext, { key })
}

/** Encrypt with an explicit password-binding profile during durable migrations. */
export function encryptSecretWithProfile(plaintext, profile = {}) {
  return encryptSecret(plaintext, {
    algorithm: normalizeAlgorithm(profile.algorithm),
    key: profile.key ?? deriveKeyMaterial(String(profile.passwordBinding || '')),
  })
}

/**
 * Re-encrypt a ciphertext with the current runtime algorithm.
 * @param {string} ciphertext
 * @param {{ key?: Buffer }} [fromProfile]
 */
export function reencryptSecret(ciphertext, fromProfile) {
  if (!ciphertext) return ''
  const plain = fromProfile
    ? decryptSecretWithProfile(ciphertext, fromProfile)
    : decryptSecret(ciphertext)
  if (!plain && ciphertext) {
    // Ciphertext was non-empty but decrypt failed — keep original to avoid data loss.
    return ciphertext
  }
  return encryptSecret(plain)
}

/**
 * Encrypt large JSON payloads for at-rest storage when encryption is enabled.
 * @param {string} plaintext
 */
export function encryptPayload(plaintext) {
  if (!plaintext) return ''
  return PAYLOAD_PREFIX + encryptSecret(plaintext)
}

/**
 * @param {string} value
 */
export function decryptPayload(value) {
  if (!value) return ''
  if (!value.startsWith(PAYLOAD_PREFIX)) return value
  const plain = decryptSecret(value.slice(PAYLOAD_PREFIX.length))
  return plain || value
}

/**
 * @param {string} value
 */
export function isEncryptedPayload(value) {
  return typeof value === 'string' && value.startsWith(PAYLOAD_PREFIX)
}

/**
 * Admin gate password verifier (not used as the field-sealing key).
 * @param {string} password
 * @param {string} [saltB64]
 */
export function createPasswordVerifier(password, saltB64 = randomBytes(16).toString('base64')) {
  const material = deriveKeyMaterial(password, saltB64)
  const hash = createHash('sha256').update(material).digest('base64')
  return { salt: saltB64, hash }
}

/**
 * @param {string} password
 * @param {string} saltB64
 * @param {string} expectedHash
 */
export function verifyPassword(password, saltB64, expectedHash) {
  if (!password || !saltB64 || !expectedHash) return false
  try {
    const { hash } = createPasswordVerifier(password, saltB64)
    const a = Buffer.from(hash)
    const b = Buffer.from(expectedHash)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Deterministic key for whole-file SQLite sealing. Uses the server env key only
 * so the process can unseal the database on boot without an interactive password.
 * Optional admin passwords protect field-level secrets after unlock, not the seal.
 */
export function deriveSqliteKey() {
  return deriveKeyMaterial('', '').toString('hex')
}

export function newPasswordSalt() {
  return randomBytes(16).toString('base64')
}
