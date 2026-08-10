import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { constantTimeBootstrapTokenMatches } from './index.js'
import {
  acquireInitialBootstrapClaim,
  consumeInitialBootstrapClaim,
  shutdownStorage,
  verifyInitialBootstrapClaim,
} from './storage.js'

function digest(label, value) {
  return createHash('sha256').update(`${label}\u001f${value}`).digest('hex')
}

function claimIdentity(subject, client, token) {
  return {
    subjectHash: digest('subject', subject),
    contextHash: digest('client', client),
    tokenHash: digest('token', token),
  }
}

afterAll(async () => {
  await shutdownStorage()
})

describe('initial setup bootstrap claim', () => {
  it('compares the out-of-band operator token without a length-dependent equality path', () => {
    const configured = 'test-only-operator-token-with-at-least-32-characters'
    expect(constantTimeBootstrapTokenMatches(configured, configured)).toBe(true)
    expect(constantTimeBootstrapTokenMatches(`${configured}x`, configured)).toBe(false)
    expect(constantTimeBootstrapTokenMatches('', configured)).toBe(false)
    expect(constantTimeBootstrapTokenMatches(configured, '')).toBe(false)
  })

  it('atomically permits one browser claimant and validates only its bound access token', async () => {
    const subject = `operator-${Date.now()}`
    const first = claimIdentity(subject, 'browser-a', 'access-a')
    const second = claimIdentity(subject, 'browser-b', 'access-b')
    const expiresAtMs = Date.now() + 60_000

    const outcomes = await Promise.all([
      acquireInitialBootstrapClaim({ ...first, expiresAtMs }),
      acquireInitialBootstrapClaim({ ...second, expiresAtMs }),
    ])
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      expect.objectContaining({ reason: 'claimed' }),
    ])

    const winner = outcomes[0].ok ? first : second
    const loser = outcomes[0].ok ? second : first
    await expect(verifyInitialBootstrapClaim(winner)).resolves.toMatchObject({ ok: true })
    await expect(verifyInitialBootstrapClaim(loser)).resolves.toMatchObject({ ok: false })
    await expect(consumeInitialBootstrapClaim(winner)).resolves.toBe(true)
    await expect(verifyInitialBootstrapClaim(winner)).resolves.toMatchObject({ ok: false })
  })

  it('uses an operator-token rotation as the explicit atomic recovery path', async () => {
    const first = claimIdentity(`operator-old-${Date.now()}`, 'browser-a', 'access-a')
    const replacement = claimIdentity(`operator-new-${Date.now()}`, 'browser-b', 'access-b')
    const expiresAtMs = Date.now() + 60_000

    await expect(acquireInitialBootstrapClaim({ ...first, expiresAtMs })).resolves.toMatchObject({ ok: true })
    await expect(acquireInitialBootstrapClaim({ ...replacement, expiresAtMs })).resolves.toMatchObject({ ok: true })
    await expect(verifyInitialBootstrapClaim(first)).resolves.toMatchObject({ ok: false })
    await expect(verifyInitialBootstrapClaim(replacement)).resolves.toMatchObject({ ok: true })
    await consumeInitialBootstrapClaim(replacement)
  })
})
