import { beforeEach, describe, expect, it } from 'vitest'
import {
  readRecoverableRegistrationIdentity,
  registrationIdentityStorageKey,
  saveRecoverableRegistrationIdentity,
} from './authRegistrationDraft'

describe('anonymous registration identity recovery', () => {
  beforeEach(() => sessionStorage.clear())

  it('round-trips only bounded name and email fields in tab-scoped storage', () => {
    expect(saveRecoverableRegistrationIdentity({
      name: 'Recoverable Applicant',
      email: 'applicant@example.com',
    }, { now: 1_000 })).toBe(true)

    const serialized = sessionStorage.getItem(registrationIdentityStorageKey()) ?? ''
    expect(serialized).toContain('Recoverable Applicant')
    expect(serialized).toContain('applicant@example.com')
    expect(serialized).not.toMatch(/password|captcha|verification|code|token/i)
    expect(readRecoverableRegistrationIdentity({ now: 2_000 })).toEqual({
      name: 'Recoverable Applicant',
      email: 'applicant@example.com',
    })
  })

  it('fails closed when a privacy shim silently discards recovery writes', () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(saveRecoverableRegistrationIdentity({
      name: 'Not persisted',
      email: 'not-persisted@example.com',
    }, { storage })).toBe(false)
  })

  it('does not restore expired or malformed identity records', () => {
    expect(saveRecoverableRegistrationIdentity({
      name: 'Expired',
      email: 'expired@example.com',
    }, { now: 1_000 })).toBe(true)
    expect(readRecoverableRegistrationIdentity({ now: 24 * 60 * 60_000 + 1_001 })).toBeNull()

    sessionStorage.setItem(registrationIdentityStorageKey(), '{not-json')
    expect(readRecoverableRegistrationIdentity()).toBeNull()
    expect(sessionStorage.getItem(registrationIdentityStorageKey())).toBeNull()
  })
})
