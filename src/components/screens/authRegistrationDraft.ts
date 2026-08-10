import {
  clearVerifiedStorageItem,
  setVerifiedStorageItem,
  type VerifiableStorage,
} from '../../verifiedStorage'

const REGISTRATION_IDENTITY_KEY = 'phd-atlas-auth-register-identity-v1'
const REGISTRATION_IDENTITY_VERSION = 1
const REGISTRATION_IDENTITY_TTL_MS = 24 * 60 * 60_000

export type RecoverableRegistrationIdentity = {
  name: string
  email: string
}

type StoredRegistrationIdentity = RecoverableRegistrationIdentity & {
  version: typeof REGISTRATION_IDENTITY_VERSION
  savedAt: number
  expiresAt: number
}

function browserSessionStorage(): VerifiableStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function boundedIdentity(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

export function registrationIdentityStorageKey() {
  return REGISTRATION_IDENTITY_KEY
}

export function readRecoverableRegistrationIdentity(options: {
  storage?: VerifiableStorage | null
  now?: number
} = {}): RecoverableRegistrationIdentity | null {
  const storage = options.storage === undefined ? browserSessionStorage() : options.storage
  if (!storage) return null
  const now = options.now ?? Date.now()
  try {
    const serialized = storage.getItem(REGISTRATION_IDENTITY_KEY)
    if (!serialized) return null
    const parsed = JSON.parse(serialized) as Partial<StoredRegistrationIdentity>
    if (
      parsed.version !== REGISTRATION_IDENTITY_VERSION
      || typeof parsed.savedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || parsed.expiresAt <= now
      || parsed.savedAt > now + 60_000
    ) {
      clearVerifiedStorageItem(storage, REGISTRATION_IDENTITY_KEY)
      return null
    }
    const name = boundedIdentity(parsed.name, 160)
    const email = boundedIdentity(parsed.email, 320)
    return name || email ? { name, email } : null
  } catch {
    clearVerifiedStorageItem(storage, REGISTRATION_IDENTITY_KEY)
    return null
  }
}

/**
 * Persists only the non-sensitive identity portion of the anonymous signup
 * flow. Passwords, CAPTCHA material, email-code tokens/codes, and submission
 * state are intentionally absent from both this type and the serialized form.
 */
export function saveRecoverableRegistrationIdentity(
  identity: RecoverableRegistrationIdentity,
  options: { storage?: VerifiableStorage | null; now?: number } = {},
) {
  const storage = options.storage === undefined ? browserSessionStorage() : options.storage
  if (!storage) return false
  const name = boundedIdentity(identity.name, 160)
  const email = boundedIdentity(identity.email, 320)
  if (!name && !email) return clearVerifiedStorageItem(storage, REGISTRATION_IDENTITY_KEY)
  const savedAt = options.now ?? Date.now()
  const payload: StoredRegistrationIdentity = {
    version: REGISTRATION_IDENTITY_VERSION,
    savedAt,
    expiresAt: savedAt + REGISTRATION_IDENTITY_TTL_MS,
    name,
    email,
  }
  return setVerifiedStorageItem(storage, REGISTRATION_IDENTITY_KEY, JSON.stringify(payload))
}

export function clearRecoverableRegistrationIdentity(storage?: VerifiableStorage | null) {
  const target = storage === undefined ? browserSessionStorage() : storage
  return target ? clearVerifiedStorageItem(target, REGISTRATION_IDENTITY_KEY) : false
}
