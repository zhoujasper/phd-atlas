import bcrypt from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'
import {
  hashAccountPassword,
  localPasswordPolicy,
  pwnedPasswordCount,
  verifyAccountPassword,
} from './passwordSecurity.js'

describe('account password storage', () => {
  it('hashes with Argon2id and verifies without exposing the password', async () => {
    const encoded = await hashAccountPassword('a long unique atlas phrase 2026')
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    await expect(verifyAccountPassword('a long unique atlas phrase 2026', encoded))
      .resolves.toEqual({ valid: true, needsRehash: false })
    await expect(verifyAccountPassword('wrong password value', encoded))
      .resolves.toEqual({ valid: false, needsRehash: false })
  })

  it('accepts legacy bcrypt hashes once and marks them for migration', async () => {
    const encoded = await bcrypt.hash('legacy password value', 4)
    await expect(verifyAccountPassword('legacy password value', encoded))
      .resolves.toEqual({ valid: true, needsRehash: true })
  })
})

describe('password policy', () => {
  it('rejects short, predictable, and identity-derived passwords', () => {
    expect(localPasswordPolicy('short')).toEqual({ ok: false, reason: 'length' })
    expect(localPasswordPolicy('passwordpassword')).toEqual({ ok: false, reason: 'common' })
    expect(localPasswordPolicy('jasper-jasper-2026', { email: 'jasper@example.com' }).ok).toBe(false)
    expect(localPasswordPolicy('orbit mango granite river 82').ok).toBe(true)
  })

  it('uses the Pwned Passwords k-anonymity range endpoint', async () => {
    const password = 'unique-test-password'
    const digest = (await import('node:crypto'))
      .createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase()
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => `${digest.slice(5)}:42\r\n00000000000000000000000000000000000:0`,
    }))
    await expect(pwnedPasswordCount(password, { fetchImpl })).resolves.toBe(42)
    expect(fetchImpl.mock.calls[0][0].endsWith(digest.slice(0, 5))).toBe(true)
    expect(fetchImpl.mock.calls[0][1].headers['Add-Padding']).toBe('true')
  })
})
