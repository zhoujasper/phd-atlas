import { describe, expect, it } from 'vitest'

import { validateDiscoverCapabilityProof } from './discover-capability-proof.js'

const proof = {
  schemaVersion: 1,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  observedAt: '2026-08-09T08:56:00.000Z',
  httpStatus: 200,
  responseStatus: 'completed',
  webSearchCallStatus: 'completed',
  outputMarker: 'discover_research_v1',
}

const target = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/',
  model: 'deepseek-v4-flash',
  now: Date.parse('2026-08-09T10:00:00.000Z'),
}

describe('validateDiscoverCapabilityProof', () => {
  it('accepts only a recent exact-target completed web-search observation', () => {
    expect(validateDiscoverCapabilityProof(proof, target)).toMatchObject({
      model: 'deepseek-v4-flash',
      cached: true,
      capabilities: { webSearch: true, reasoning: true },
    })
  })

  it.each([
    ['stale observation', { observedAt: '2026-08-08T00:00:00.000Z' }],
    ['wrong model', { model: 'deepseek-chat' }],
    ['missing web search', { webSearchCallStatus: 'incomplete' }],
    ['wrong marker', { outputMarker: 'discover_research_v2' }],
    ['failed response', { responseStatus: 'incomplete' }],
  ])('rejects %s', (_label, change) => {
    expect(validateDiscoverCapabilityProof({ ...proof, ...change }, target)).toBeNull()
  })
})
