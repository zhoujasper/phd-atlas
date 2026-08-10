import { describe, expect, it } from 'vitest'
import type { ApplicationRecord } from './data/applications'
import { ApplicationDeltaTooLargeError, buildApplicationDelta } from './applicationDelta'

const application = (input: Record<string, unknown>): ApplicationRecord => ({
  id: 'app-1',
  ownerId: 'owner-1',
  teamId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  school: { name: 'Example University', country: 'United Kingdom' },
  materials: [],
  tags: [],
  ...input,
} as unknown as ApplicationRecord)

describe('buildApplicationDelta', () => {
  it('emits only changed editable fields and excludes server-owned roots', () => {
    const base = application({ notes: 'Before', shares: [{ id: 'share-1' }] })
    const next = application({
      notes: 'After',
      ownerId: 'attacker',
      updatedAt: 'client-clock',
      shares: [],
    })

    expect(buildApplicationDelta(base, next)).toEqual({
      baseUpdatedAt: base.updatedAt,
      operations: [{ op: 'replace', path: '/notes', value: 'After' }],
    })
  })

  it('does not send message snapshots or classifier output through the resident editor delta', () => {
    const base = application({
      communications: [{
        id: 'mail-1',
        summary: 'Before',
        bodyFormat: 'html',
        bodyHtml: '<p>Server copy</p>',
        bodyText: 'Server copy',
        mailClassification: { category: 'other' },
      }],
    })
    const next = application({
      ...base,
      communications: [{
        ...base.communications[0],
        summary: 'After',
        bodyHtml: '<p>Stale browser copy</p>',
        bodyText: 'Stale browser copy',
        mailClassification: { category: 'offer' },
      }],
    })

    expect(buildApplicationDelta(base, next).operations).toEqual([
      { op: 'replace', path: '/communications/0/summary', value: 'After' },
    ])
  })

  it('uses stable-id edits plus one reorder instead of replacing a large collection', () => {
    const base = application({
      materials: [
        { id: 'a', name: 'A', notes: '' },
        { id: 'b', name: 'B', notes: '' },
        { id: 'c', name: 'C', notes: '' },
      ],
    })
    const next = application({
      materials: [
        { id: 'd', name: 'D', notes: '' },
        { id: 'b', name: 'B2', notes: '' },
        { id: 'a', name: 'A', notes: '' },
      ],
    })

    expect(buildApplicationDelta(base, next).operations).toEqual([
      { op: 'replace', path: '/materials/1/name', value: 'B2' },
      { op: 'remove', path: '/materials/2' },
      { op: 'add', path: '/materials/-', value: { id: 'd', name: 'D', notes: '' } },
      { op: 'reorder', path: '/materials', ids: ['d', 'b', 'a'] },
    ])
  })

  it('keeps a tiny payload when editing a multi-megabyte application', () => {
    const base = application({
      notes: 'Before',
      communications: Array.from({ length: 64 }, (_, index) => ({
        id: `mail-${index}`,
        body: 'x'.repeat(32 * 1_024),
      })),
    })
    const next = { ...base, notes: 'After' }
    expect(JSON.stringify(base).length).toBeGreaterThan(2 * 1_024 * 1_024)
    expect(JSON.stringify(buildApplicationDelta(base, next)).length).toBeLessThan(256)
  })

  it('fails closed when a single save exceeds the bounded operation protocol', () => {
    const base = application({ fields: {} })
    const next = application({
      fields: Object.fromEntries(Array.from({ length: 2_049 }, (_, index) => [`field-${index}`, index])),
    })
    expect(() => buildApplicationDelta(base, next)).toThrow(ApplicationDeltaTooLargeError)
  })
})
