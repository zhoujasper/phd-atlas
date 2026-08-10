import { describe, expect, it } from 'vitest'
import { compareFactSources, mergeWithProvenance, provenanceRecord } from './sourceProvenance.js'

const base = {
  sourceUrl: 'https://example.com/source',
  fetchedAt: '2026-08-03T00:00:00.000Z',
}

describe('source provenance merge', () => {
  it('records a disagreement instead of silently choosing a source', () => {
    const records = [
      provenanceRecord({ ...base, kind: 'fact', sourceId: 'a', value: { id: 'p1', active: true }, confidence: 1 }),
      provenanceRecord({ ...base, kind: 'fact', sourceId: 'b', value: { id: 'p1', active: false }, confidence: 0.8 }),
    ]
    const groups = compareFactSources(records)
    const merged = mergeWithProvenance(records)

    expect(groups).toHaveLength(1)
    expect(groups[0].disagreement).toBe(true)
    expect(groups[0].values).toHaveLength(2)
    expect(merged[0]).toMatchObject({ factKey: 'p1', status: 'disagreement', value: null })
    expect(merged[0].sources.map((entry) => entry.sourceId)).toEqual(['a', 'b'])
  })

  it('keeps a confirmed value and its original provenance', () => {
    const records = [
      provenanceRecord({ ...base, kind: 'fact', sourceId: 'a', value: { id: 'p1', active: true }, confidence: 1 }),
      provenanceRecord({ ...base, kind: 'fact', sourceId: 'b', value: { id: 'p1', active: true }, confidence: 0.9 }),
    ]
    const merged = mergeWithProvenance(records)

    expect(merged).toEqual([{
      factKey: 'p1',
      status: 'confirmed',
      value: { id: 'p1', active: true },
      provenance: {
        value: { id: 'p1', active: true },
        sourceId: 'a',
        sourceUrl: base.sourceUrl,
        fetchedAt: base.fetchedAt,
        confidence: 1,
      },
    }])
  })
})
