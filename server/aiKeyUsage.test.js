import { describe, expect, it } from 'vitest'
import {
  createAiKey,
  deleteAiKey,
  publicAiKey,
  readStore,
  recordAiKeyUsage,
  resetAiKeyUsage,
  updateAiKey,
} from './storage.js'
import { AiKeyCreateSchema, AiKeyPatchSchema } from './validation.js'

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
      maxConcurrency: 2_500,
      requestMode: 'responses',
      weight: 80,
      enabled: false,
    })

    try {
      expect(publicAiKey(key)).toMatchObject({
        maxConcurrency: 2_500,
        requestMode: 'responses',
        weight: 80,
        enabled: false,
        secretSet: true,
      })
      expect(publicAiKey(key)).not.toHaveProperty('apiKey')
      const reduced = await updateAiKey(key.id, {
        maxConcurrency: 17,
        requestMode: 'chat_completions',
        weight: 20,
        enabled: true,
      })
      expect(reduced).toMatchObject({
        maxConcurrency: 17,
        requestMode: 'chat_completions',
        weight: 20,
        enabled: true,
      })
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

  it('validates the public 1–2500 concurrency contract on create and update', () => {
    const base = {
      scope: 'personal',
      provider: 'openai',
      label: 'Research',
      model: 'gpt-5.6-luna',
      apiKey: 'test-secret',
    }
    expect(AiKeyCreateSchema.parse({ ...base, maxConcurrency: 2_500 }).maxConcurrency).toBe(2_500)
    expect(AiKeyCreateSchema.parse({ ...base }).requestMode).toBe('auto')
    expect(AiKeyCreateSchema.parse({ ...base }).weight).toBe(50)
    expect(AiKeyCreateSchema.parse({ ...base }).enabled).toBe(true)
    expect(AiKeyPatchSchema.parse({ requestMode: 'responses', weight: 100, enabled: false })).toEqual({
      requestMode: 'responses',
      weight: 100,
      enabled: false,
    })
    expect(() => AiKeyCreateSchema.parse({ ...base, maxConcurrency: 2_501 })).toThrow()
    expect(() => AiKeyPatchSchema.parse({ maxConcurrency: 0 })).toThrow()
    expect(() => AiKeyPatchSchema.parse({ requestMode: 'legacy' })).toThrow()
    expect(() => AiKeyPatchSchema.parse({ weight: 101 })).toThrow()
  })
})
