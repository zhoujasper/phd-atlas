import { describe, expect, it } from 'vitest'
import { publicUser } from './storage.js'

describe('unlimited quota settings', () => {
  it('preserves the -1 sentinel in the public settings payload', () => {
    const user = publicUser({
      id: 'user_unlimited',
      name: 'Unlimited User',
      email: 'unlimited@example.com',
      role: 'user',
      createdAt: '2026-07-28T00:00:00.000Z',
      settings: {
        membershipPlan: 'free',
        storageQuotaMb: -1,
        applicationQuota: -1,
        applicationCreateQuota: -1,
        shareQuota: -1,
        shareCreateQuota: -1,
      },
    })

    expect(user.settings).toMatchObject({
      storageQuotaMb: -1,
      applicationQuota: -1,
      applicationCreateQuota: -1,
      shareQuota: -1,
      shareCreateQuota: -1,
    })
  })
})
