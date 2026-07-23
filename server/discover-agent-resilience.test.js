import { describe, expect, it, vi } from 'vitest'
import { AiProviderError } from './aiProviders.js'
import {
  createNonFatalCheckpointWriter,
  isRetryableDiscoverAgentError,
  runDiscoverAgentWithRetry,
  validateDiscoverAgentCompletion,
} from './discover-agent-resilience.js'

function completion(overrides = {}) {
  return {
    text: JSON.stringify({ summary: 'ok', suggestedPrograms: [] }),
    sources: [],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ...overrides,
  }
}

describe('Discover agent batch resilience', () => {
  it('retries a transient provider failure and returns the successful batch', async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(new AiProviderError('PROVIDER_UNAVAILABLE', 'temporary'))
      .mockResolvedValueOnce(completion())

    const result = await runDiscoverAgentWithRetry({ complete, retryDelayMs: 0 })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.providerError).toBeUndefined()
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it('retries malformed output before accepting a valid structured response', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(completion({
        text: 'not-json',
        usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
      }))
      .mockResolvedValueOnce(completion())

    const result = await runDiscoverAgentWithRetry({ complete, retryDelayMs: 0 })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.providerError).toBeUndefined()
    expect(result.usage).toEqual({ inputTokens: 17, outputTokens: 7, totalTokens: 24 })
  })

  it('never carries citations from an invalid response into a later valid batch', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(completion({ text: 'not-json', sources: ['https://poisoned.example/claim'] }))
      .mockResolvedValueOnce(completion({ sources: ['https://example.edu/phd'] }))

    const result = await runDiscoverAgentWithRetry({ complete, retryDelayMs: 0 })

    expect(result.sources).toEqual(['https://example.edu/phd'])
    expect(result.sources).not.toContain('https://poisoned.example/claim')
  })

  it.each([
    ['empty response', () => Promise.reject(new AiProviderError('EMPTY_DRAFT', 'empty')), 'EMPTY_DRAFT'],
    ['malformed JSON', () => Promise.resolve(completion({ text: '{broken' })), 'AI_RESPONSE_INVALID'],
    ['schema-invalid JSON', () => Promise.resolve(completion({
      text: JSON.stringify({ summary: 'bad', suggestedPrograms: {} }),
    })), 'AI_RESPONSE_SCHEMA_INVALID'],
  ])('degrades one %s batch after bounded retries without throwing', async (_label, implementation, expectedCode) => {
    const complete = vi.fn(implementation)

    const result = await runDiscoverAgentWithRetry({ complete, retryDelayMs: 0 })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.providerError).toMatchObject({ code: expectedCode })
    expect(JSON.parse(result.text)).toMatchObject({ suggestedPrograms: [] })
  })

  it('does not downgrade invalid credentials or configuration into a false success', async () => {
    const complete = vi.fn().mockRejectedValue(new AiProviderError('KEY_UNAVAILABLE', 'missing'))

    await expect(runDiscoverAgentWithRetry({ complete, retryDelayMs: 0 }))
      .rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('validates program collection shapes before source grounding', () => {
    expect(() => validateDiscoverAgentCompletion(completion({
      text: JSON.stringify({
        summary: 'bad',
        suggestedPrograms: [{ school: 'Example', program: 'PhD', website: 'https://example.edu/phd', sources: {}, pis: [] }],
      }),
    }))).toThrowError(expect.objectContaining({ code: 'AI_RESPONSE_SCHEMA_INVALID' }))
  })

  it('classifies output failures and transport failures as retryable, but not auth/config rejection', () => {
    expect(isRetryableDiscoverAgentError({ code: 'PROVIDER_TIMEOUT' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'PROVIDER_RATE_LIMITED' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'EMPTY_DRAFT' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'AI_RESPONSE_INVALID' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'AI_RESPONSE_SCHEMA_INVALID' })).toBe(true)
    expect(isRetryableDiscoverAgentError({ code: 'PROVIDER_REJECTED' })).toBe(false)
    expect(isRetryableDiscoverAgentError({ code: 'KEY_UNAVAILABLE' })).toBe(false)
  })

  it('records checkpoint failures without rejecting the in-memory research run', async () => {
    const onCheckpoint = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockResolvedValueOnce(undefined)
    const write = createNonFatalCheckpointWriter(onCheckpoint)

    await expect(write({ stage: 'crawling' })).resolves.toBe(false)
    await expect(write({ stage: 'advisors' })).resolves.toBe(true)
    expect(write.failureCount).toBe(1)
    expect(write.failures).toEqual([{ stage: 'crawling', code: 'EBUSY' }])
  })
})
