import bcrypt from 'bcryptjs'
import {
  argon2,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { withAbortDeadline } from './abortDeadline.js'

export const PASSWORD_MIN_LENGTH = 15
export const PASSWORD_MAX_LENGTH = 128

const ARGON2_MEMORY_KIB = 19_456
const ARGON2_PASSES = 2
const ARGON2_PARALLELISM = 1
const ARGON2_TAG_LENGTH = 32
// Stored hashes are data, not trusted work instructions. These ceilings keep a
// corrupted or attacker-controlled backup from turning login into an
// unbounded CPU/memory request while still accepting sensibly stronger legacy
// hashes and rehashing weaker ones after a successful login.
const ARGON2_MAX_MEMORY_KIB = 65_536
const ARGON2_MAX_PASSES = 6
const ARGON2_MAX_PARALLELISM = 4
const ARGON2_MIN_NONCE_LENGTH = 8
const ARGON2_MAX_NONCE_LENGTH = 64
const ARGON2_MIN_TAG_LENGTH = 16
const ARGON2_MAX_TAG_LENGTH = 64
const BCRYPT_MIN_COST = 4
const BCRYPT_MAX_COST = 14
const PWNED_PREFIX_CACHE_LIMIT = 256
const PWNED_PREFIX_CACHE_TTL_MS = 12 * 60 * 60_000
const pwnedPrefixCache = new Map()

const COMMON_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  'abc123',
  'admin',
  'admin123',
  'changeme',
  'iloveyou',
  'letmein',
  'login',
  'password',
  'password1',
  'password123',
  'qwerty',
  'qwerty123',
  'welcome',
  'welcome123',
])

function argon2Derive(message, nonce, parameters = {}) {
  return new Promise((resolve, reject) => {
    argon2('argon2id', {
      message,
      nonce,
      parallelism: parameters.parallelism ?? ARGON2_PARALLELISM,
      tagLength: parameters.tagLength ?? ARGON2_TAG_LENGTH,
      memory: parameters.memory ?? ARGON2_MEMORY_KIB,
      passes: parameters.passes ?? ARGON2_PASSES,
    }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

function parseArgon2Hash(encoded) {
  const match = String(encoded ?? '').match(
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/,
  )
  if (!match) return null
  const parsed = {
    memory: Number(match[1]),
    passes: Number(match[2]),
    parallelism: Number(match[3]),
    nonce: Buffer.from(match[4], 'base64url'),
    hash: Buffer.from(match[5], 'base64url'),
  }
  if (
    !Number.isSafeInteger(parsed.memory)
    || parsed.memory < 8
    || parsed.memory > ARGON2_MAX_MEMORY_KIB
    || !Number.isSafeInteger(parsed.passes)
    || parsed.passes < 1
    || parsed.passes > ARGON2_MAX_PASSES
    || !Number.isSafeInteger(parsed.parallelism)
    || parsed.parallelism < 1
    || parsed.parallelism > ARGON2_MAX_PARALLELISM
    || parsed.memory < 8 * parsed.parallelism
    || parsed.nonce.length < ARGON2_MIN_NONCE_LENGTH
    || parsed.nonce.length > ARGON2_MAX_NONCE_LENGTH
    || parsed.hash.length < ARGON2_MIN_TAG_LENGTH
    || parsed.hash.length > ARGON2_MAX_TAG_LENGTH
  ) {
    return null
  }
  return parsed
}

export async function hashAccountPassword(password) {
  const nonce = randomBytes(16)
  const hash = await argon2Derive(Buffer.from(password), nonce)
  return `$argon2id$v=19$m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}`
    + `$${nonce.toString('base64url')}$${Buffer.from(hash).toString('base64url')}`
}

export async function verifyAccountPassword(password, encoded) {
  const parsed = parseArgon2Hash(encoded)
  if (parsed) {
    const actual = Buffer.from(await argon2Derive(Buffer.from(password), parsed.nonce, {
      memory: parsed.memory,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: parsed.hash.length,
    }))
    const valid = actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash)
    const needsRehash = parsed.memory < ARGON2_MEMORY_KIB
      || parsed.passes < ARGON2_PASSES
      || parsed.parallelism !== ARGON2_PARALLELISM
      || parsed.hash.length < ARGON2_TAG_LENGTH
    return { valid, needsRehash }
  }
  const bcryptMatch = String(encoded ?? '').match(/^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/)
  if (bcryptMatch) {
    const cost = Number(bcryptMatch[1])
    if (cost >= BCRYPT_MIN_COST && cost <= BCRYPT_MAX_COST) {
      return { valid: await bcrypt.compare(password, encoded), needsRehash: true }
    }
  }
  return { valid: false, needsRehash: false }
}

function normalizedPassword(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
}

export function localPasswordPolicy(password, context = {}) {
  const value = String(password ?? '')
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: 'length' }
  }
  const normalized = normalizedPassword(value)
  const collapsed = normalized.replace(/[^a-z0-9]/g, '')
  if (
    COMMON_PASSWORDS.has(normalized)
    || COMMON_PASSWORDS.has(collapsed)
    || /^(.{3,12})\1+$/u.test(normalized)
  ) {
    return { ok: false, reason: 'common' }
  }
  const personalTokens = [
    String(context.email ?? '').split('@')[0],
    ...String(context.name ?? '').split(/\s+/),
  ]
    .map((token) => normalizedPassword(token).replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 4)
  if (personalTokens.some((token) => {
    const occurrences = collapsed.split(token).length - 1
    return occurrences >= 2 || (occurrences === 1 && collapsed.length - token.length < 8)
  })) {
    return { ok: false, reason: 'personal' }
  }
  if (/^(.)\1{14,}$/u.test(normalized) || /(?:012345|123456|abcdef|qwerty)/.test(collapsed)) {
    return { ok: false, reason: 'predictable' }
  }
  return { ok: true }
}

function rememberPwnedPrefix(prefix, value) {
  if (pwnedPrefixCache.size >= PWNED_PREFIX_CACHE_LIMIT) {
    pwnedPrefixCache.delete(pwnedPrefixCache.keys().next().value)
  }
  pwnedPrefixCache.set(prefix, { value, expiresAt: Date.now() + PWNED_PREFIX_CACHE_TTL_MS })
}

async function fetchPwnedPrefix(prefix, options) {
  const cached = pwnedPrefixCache.get(prefix)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) pwnedPrefixCache.delete(prefix)
  return withAbortDeadline(async (signal) => {
    const response = await (options.fetchImpl ?? fetch)(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: {
          'Add-Padding': 'true',
          'User-Agent': 'PhD-Atlas-Password-Policy',
        },
        signal,
      },
    )
    if (!response.ok) throw new Error(`Pwned Passwords returned ${response.status}`)
    const body = await response.text()
    rememberPwnedPrefix(prefix, body)
    return body
  }, { timeoutMs: options.timeoutMs ?? 2_500 })
}

export async function pwnedPasswordCount(password, options = {}) {
  const digest = createHash('sha1').update(String(password)).digest('hex').toUpperCase()
  const prefix = digest.slice(0, 5)
  const suffix = digest.slice(5)
  const body = await fetchPwnedPrefix(prefix, options)
  for (const line of body.split(/\r?\n/)) {
    const [candidate, count] = line.trim().split(':')
    if (candidate === suffix) return Number(count) || 1
  }
  return 0
}

export async function assertStrongAccountPassword(password, context = {}, options = {}) {
  const local = localPasswordPolicy(password, context)
  if (!local.ok) {
    const error = new Error('Choose a longer, less predictable password that is not based on your name or email.')
    error.status = 400
    error.code = 'PASSWORD_TOO_WEAK'
    error.field = 'password'
    throw error
  }
  const enabled = options.checkPwned
    ?? (process.env.NODE_ENV === 'production' && process.env.PWNED_PASSWORDS_CHECK !== '0')
  if (!enabled) return
  try {
    if (await pwnedPasswordCount(password, options) > 0) {
      const error = new Error('This password appears in known data breaches. Choose a different password.')
      error.status = 400
      error.code = 'PASSWORD_TOO_WEAK'
      error.field = 'password'
      throw error
    }
  } catch (error) {
    if (error?.code === 'PASSWORD_TOO_WEAK') throw error
    if (options.failClosed ?? process.env.PWNED_PASSWORDS_FAIL_CLOSED === '1') {
      const unavailable = new Error('Password safety verification is temporarily unavailable.')
      unavailable.status = 503
      unavailable.code = 'PASSWORD_CHECK_UNAVAILABLE'
      unavailable.field = 'password'
      throw unavailable
    }
  }
}
