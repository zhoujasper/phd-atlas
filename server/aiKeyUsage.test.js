import { describe, expect, it } from 'vitest'
import {
  createAiKey,
  deleteAiKey,
  publicAiKey,
  readStore,
  recordAiKeyUsage,
  resetAiKeyUsage,
} from './storage.js'

describe.sequential('AI key usage accounting', () => {
  it('counts successful calls and tokens and can reset the counters', async () => {
    const owner = (await readStore()).users[0]
    const key = await createAiKey({
      ownerId: owner.id,
      scope: 'personal',
      provider: 'openai',
      label: `Usage test ${Date.now()}`,
      model: 'gpt-4.1-mini',
      apiKey: 'test-secret',
    })

    try {
      await recordAiKeyUsage(key.id, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      const counted = await recordAiKeyUsage(key.id, { inputTokens: 7, outputTokens: 3 })
      expect(publicAiKey(counted).usage).toEqual({
        calls: 2,
        inputTokens: 17,
        outputTokens: 8,
        totalTokens: 25,
        resetAt: null,
      })

      const reset = await resetAiKeyUsage(key.id)
      expect(publicAiKey(reset).usage).toMatchObject({
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(reset.usage.resetAt).toEqual(expect.any(String))
    } finally {
      await deleteAiKey(key.id)
    }
  })
})
