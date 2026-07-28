import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  claimSecurityChallenge,
  clearSecurityRateLimits,
  consumeSecurityRateLimits,
  createSecurityChallenge,
} from './storage.js'

describe('persistent security challenges', () => {
  it('caps failed answers and consumes a correct answer exactly once', async () => {
    const suffix = randomUUID()
    const base = {
      id: `challenge_${suffix}`,
      kind: 'storage-test',
      tokenHash: `token-${suffix}`,
      subjectHash: `subject-${suffix}`,
      contextHash: `context-${suffix}`,
      verifierHash: `verifier-${suffix}`,
      maxAttempts: 3,
      createdAtMs: Date.now(),
      notBeforeAtMs: Date.now() - 1,
      expiresAtMs: Date.now() + 60_000,
    }
    await createSecurityChallenge(base)

    await expect(claimSecurityChallenge({
      ...base,
      verifierHash: 'wrong-verifier',
    })).resolves.toEqual({ ok: false, reason: 'invalid' })
    await expect(claimSecurityChallenge(base)).resolves.toMatchObject({ ok: true })
    await expect(claimSecurityChallenge(base)).resolves.toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('persistent security budgets', () => {
  it('checks all buckets atomically and survives until explicitly cleared', async () => {
    const suffix = randomUUID()
    const entry = {
      keyHash: `rate-${suffix}`,
      bucketName: 'storage-test',
      windowMs: 60_000,
      blockMs: 60_000,
      max: 2,
    }
    await expect(consumeSecurityRateLimits([entry])).resolves.toEqual({ allowed: true })
    await expect(consumeSecurityRateLimits([entry])).resolves.toEqual({ allowed: true })
    await expect(consumeSecurityRateLimits([entry])).resolves.toMatchObject({
      allowed: false,
      bucketName: 'storage-test',
    })
    await clearSecurityRateLimits([entry.keyHash])
    await expect(consumeSecurityRateLimits([entry])).resolves.toEqual({ allowed: true })
  })
})
