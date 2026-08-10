import { describe, expect, it } from 'vitest'
import { SourceConfigurationError } from './sourceErrors.js'
import { createSourceAdapter } from './sourceAdapter.js'

const config = {
  id: 'demo',
  name: 'Demo',
  kind: 'api',
  baseUrl: 'https://api.example.com',
}

describe('source adapter runner', () => {
  it('runs an adapter and returns a stable result shape', async () => {
    const adapter = createSourceAdapter(config, async () => ({
      records: [{
        kind: 'demo:item',
        value: { id: '1' },
        sourceId: 'demo',
        sourceUrl: 'https://api.example.com/items',
        fetchedAt: '2026-08-03T00:00:00.000Z',
        confidence: 1,
      }],
    }))

    const result = await adapter.run({}, { now: () => 1_752_000_000_000 })
    expect(result.status).toBe('ok')
    expect(result.records[0].value).toEqual({ id: '1' })
    expect(result.meta.checkedAt).toBe('2025-07-08T18:40:00.000Z')
  })

  it('rejects records without provenance', async () => {
    const adapter = createSourceAdapter(config, async () => ({
      records: [{ value: { id: '1' } }],
    }))
    await expect(adapter.run({})).rejects.toThrow(SourceConfigurationError)
  })

  it('returns disabled status without touching the implementation', async () => {
    const impl = async () => {
      throw new Error('must not run')
    }
    const adapter = createSourceAdapter({ ...config, enabled: false }, impl)
    const result = await adapter.run({})
    expect(result.status).toBe('disabled')
    expect(result.records).toEqual([])
    expect(result.warnings).toEqual(['Source is disabled by configuration.'])
  })

  it('allows tests to override transport-sensitive config values', async () => {
    const adapter = createSourceAdapter(config, async (_query, context) => {
      expect(context.source.timeoutMs).toBe(42)
      expect(context.source.retry.baseDelayMs).toBe(0)
      expect(context.source.rateLimitPerMin).toBe(60)
      return { records: [] }
    })
    const result = await adapter.run({}, {
      timeoutMs: 42,
      retry: { baseDelayMs: 0 },
      rateLimitPerMin: 60,
    })
    expect(result.status).toBe('empty')
  })
})
