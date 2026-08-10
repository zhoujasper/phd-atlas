import { describe, expect, it } from 'vitest'
import {
  SourceConfigSchema,
  validateProvenanceRecord,
  validateSourceConfig,
} from './sourceSchemas.js'
import { SourceConfigurationError } from './sourceErrors.js'

describe('source schemas', () => {
  it('fills safe defaults and accepts passthrough source extensions', () => {
    const source = validateSourceConfig({
      id: 'demo-api',
      name: 'Demo API',
      kind: 'api',
      baseUrl: 'https://api.example.com/items',
      auth: { clientId: 'private-field' },
    })

    expect(source.id).toBe('demo-api')
    expect(source.enabled).toBe(true)
    expect(source.rateLimitPerMin).toBe(30)
    expect(source.concurrency).toBe(1)
    expect(source.cacheTtlMs).toBe(60 * 60 * 1_000)
    expect(source.robotsPolicy).toBe('respect')
    expect(source.retry.maxAttempts).toBe(3)
    expect(source.auth).toEqual({ clientId: 'private-field' })
  })

  it('rejects invalid source configs with a focused error', () => {
    expect(() => validateSourceConfig({
      id: 'not valid!',
      name: '',
      kind: 'web',
      baseUrl: 'not-a-url',
      rateLimitPerMin: 0,
    })).toThrow(SourceConfigurationError)
  })

  it('enforces the provenance contract', () => {
    expect(validateProvenanceRecord({
      kind: 'demo:item',
      value: { id: '1' },
      sourceId: 'demo-api',
      sourceUrl: 'https://api.example.com/items',
      fetchedAt: '2026-08-03T00:00:00.000Z',
      confidence: 0.9,
    })).toMatchObject({ sourceId: 'demo-api', confidence: 0.9 })

    expect(() => validateProvenanceRecord({
      value: { id: '1' },
      sourceUrl: 'https://api.example.com/items',
    })).toThrow(SourceConfigurationError)
  })

  it('rejects impossible confidence values', () => {
    expect(() => SourceConfigSchema.parse({
      id: 'demo',
      name: 'Demo',
      kind: 'api',
      baseUrl: 'https://example.com',
    })).not.toThrow()
    expect(() => validateProvenanceRecord({
      value: 1,
      sourceId: 'demo',
      sourceUrl: 'https://example.com',
      fetchedAt: '2026-08-03T00:00:00.000Z',
      confidence: 1.2,
    })).toThrow(SourceConfigurationError)
  })
})
