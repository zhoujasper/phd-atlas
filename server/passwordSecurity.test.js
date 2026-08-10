import bcrypt from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'
import {
  createInFlightPasswordVerificationCoalescer,
  hashAccountPassword,
  localPasswordPolicy,
  passwordHashMemoryReservationBytes,
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

  it('rejects stored hashes whose parameters request excessive work', async () => {
    const nonce = Buffer.alloc(16, 1).toString('base64url')
    const tag = Buffer.alloc(32, 2).toString('base64url')
    const excessiveArgon = `$argon2id$v=19$m=4294967295,t=99,p=32$${nonce}$${tag}`
    const excessiveBcrypt = `$2b$31$${'a'.repeat(53)}`

    await expect(verifyAccountPassword('irrelevant password', excessiveArgon))
      .resolves.toEqual({ valid: false, needsRehash: false })
    await expect(verifyAccountPassword('irrelevant password', excessiveBcrypt))
      .resolves.toEqual({ valid: false, needsRehash: false })
  })

  it('reserves the validated legacy Argon2 work set plus runtime overhead', () => {
    const nonce = Buffer.alloc(16, 1).toString('base64url')
    const tag = Buffer.alloc(32, 2).toString('base64url')
    const strongestAccepted = `$argon2id$v=19$m=65536,t=6,p=4$${nonce}$${tag}`
    const excessive = `$argon2id$v=19$m=65537,t=6,p=4$${nonce}$${tag}`

    expect(passwordHashMemoryReservationBytes(strongestAccepted)).toBe(68 * 1024 * 1024)
    expect(passwordHashMemoryReservationBytes(excessive)).toBe(0)
    expect(passwordHashMemoryReservationBytes('$2b$04$' + 'a'.repeat(53))).toBe(0)
  })

  it('coalesces only overlapping identical verifications and never caches results', async () => {
    let releaseFirst
    const firstGate = new Promise((resolve) => { releaseFirst = resolve })
    const verify = vi.fn(async (password) => {
      if (verify.mock.calls.length === 1) await firstGate
      return { valid: password === 'correct', needsRehash: false }
    })
    const coalesced = createInFlightPasswordVerificationCoalescer(verify, { maxEntries: 2 })

    const first = coalesced('correct', 'same-hash')
    const duplicate = coalesced('correct', 'same-hash')
    const differentPassword = coalesced('wrong', 'same-hash')
    expect(duplicate).toBe(first)
    expect(differentPassword).not.toBe(first)
    await Promise.resolve()
    expect(verify).toHaveBeenCalledTimes(2)

    releaseFirst()
    await expect(Promise.all([first, duplicate, differentPassword])).resolves.toEqual([
      { valid: true, needsRehash: false },
      { valid: true, needsRehash: false },
      { valid: false, needsRehash: false },
    ])

    await expect(coalesced('correct', 'same-hash'))
      .resolves.toEqual({ valid: true, needsRehash: false })
    expect(verify).toHaveBeenCalledTimes(3)
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
    const fetchImpl = vi.fn(async () => new Response(
      `${digest.slice(5)}:42\r\n00000000000000000000000000000000000:0`,
      { status: 200 },
    ))
    await expect(pwnedPasswordCount(password, { fetchImpl })).resolves.toBe(42)
    expect(fetchImpl.mock.calls[0][0].endsWith(digest.slice(0, 5))).toBe(true)
    expect(fetchImpl.mock.calls[0][1].headers['Add-Padding']).toBe('true')
  })

  it('rejects a Pwned Passwords body whose declared size exceeds 2 MiB', async () => {
    const fetchImpl = vi.fn(async () => new Response('oversized', {
      status: 200,
      headers: { 'content-length': String((2 * 1024 * 1024) + 1) },
    }))

    await expect(pwnedPasswordCount('bounded-response-password-2026', { fetchImpl }))
      .rejects.toMatchObject({ code: 'UPSTREAM_RESPONSE_TOO_LARGE' })
  })
})
