import { describe, expect, it } from 'vitest'
import {
  applyApplicationDelta,
  applicationDeltaCanonicalMatches,
  ApplicationDeltaError,
} from './applicationDelta.js'

describe('application delta', () => {
  it('applies immutable object changes without touching the source', () => {
    const source = {
      id: 'app-1',
      updatedAt: '2026-08-02T00:00:00.000Z',
      school: { name: 'Original', website: '' },
      tags: ['one'],
    }
    const result = applyApplicationDelta(source, {
      operations: [
        { op: 'replace', path: '/school/name', value: 'Updated' },
        { op: 'add', path: '/school/country', value: 'United Kingdom' },
        { op: 'replace', path: '/tags', value: ['one', 'two'] },
      ],
    })

    expect(result).toEqual({
      ...source,
      school: { name: 'Updated', website: '', country: 'United Kingdom' },
      tags: ['one', 'two'],
    })
    expect(source.school.name).toBe('Original')
    expect(source.tags).toEqual(['one'])
  })

  it('updates, removes, appends, and reorders stable-id arrays', () => {
    const source = {
      id: 'app-1',
      materials: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
    }
    const result = applyApplicationDelta(source, {
      operations: [
        { op: 'replace', path: '/materials/1/name', value: 'B2' },
        { op: 'remove', path: '/materials/2' },
        { op: 'add', path: '/materials/-', value: { id: 'd', name: 'D' } },
        { op: 'reorder', path: '/materials', ids: ['d', 'b', 'a'] },
      ],
    })

    expect(result.materials).toEqual([
      { id: 'd', name: 'D' },
      { id: 'b', name: 'B2' },
      { id: 'a', name: 'A' },
    ])
  })

  it.each([
    [{ op: 'replace', path: '/ownerId', value: 'attacker' }],
    [{ op: 'replace', path: '/communications/0/bodyHtml', value: '<p>attacker</p>' }],
    [{ op: 'replace', path: '/communications/0/mailClassification', value: { category: 'offer' } }],
    [{ op: 'add', path: '/__proto__/polluted', value: true }],
    [{ op: 'replace', path: '/materials/999/name', value: 'missing' }],
    [{ op: 'reorder', path: '/materials', ids: ['a', 'a'] }],
  ])('rejects protected, unsafe, or inconsistent operations', (operations) => {
    expect(() => applyApplicationDelta({
      id: 'app-1',
      ownerId: 'owner-1',
      materials: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    }, { operations })).toThrow(ApplicationDeltaError)
  })

  it('enforces a bounded operation count before mutation', () => {
    expect(() => applyApplicationDelta({ id: 'app-1' }, {
      operations: Array.from({ length: 2_049 }, (_, index) => ({
        op: 'add',
        path: `/field-${index}`,
        value: index,
      })),
    })).toThrow(/at most 2048 operations/u)
  })

  it('detects silently stripped touched values while ignoring server-owned metadata', () => {
    const expected = {
      program: 'Expected program',
      school: { name: 'Example', logo: { dataUrl: 'client-cache' } },
      materials: [{ id: 'm1', name: 'Statement', storageName: 'client-file' }],
      communications: [{
        id: 'c1',
        summary: 'Expected summary',
        bodyFormat: 'html',
        bodyHtml: '<p>Expected body</p>',
        bodyText: 'Expected body',
        mailClassification: { category: 'other' },
        deliveryStatus: 'queued',
      }],
    }
    const operations = [
      { op: 'replace', path: '/program', value: 'Expected program' },
      { op: 'replace', path: '/school/name', value: 'Example' },
      { op: 'replace', path: '/materials/0/name', value: 'Statement' },
      { op: 'replace', path: '/communications/0/summary', value: 'Expected summary' },
    ]
    expect(applicationDeltaCanonicalMatches(expected, {
      ...expected,
      school: { name: 'Example', logo: { dataUrl: 'server-cache' } },
      materials: [{ id: 'm1', name: 'Statement', storageName: 'server-file' }],
      communications: [{
        id: 'c1',
        summary: 'Expected summary',
        bodyFormat: 'plain',
        bodyHtml: '<p>Server body</p>',
        bodyText: 'Server body',
        mailClassification: { category: 'offer' },
        deliveryStatus: 'sent',
      }],
    }, { operations })).toBe(true)
    expect(applicationDeltaCanonicalMatches(expected, {
      ...expected,
      program: 'Silently retained old program',
    }, { operations })).toBe(false)
    expect(applicationDeltaCanonicalMatches(expected, {
      ...expected,
      communications: [{
        id: 'c1',
        summary: 'Silently stripped',
        bodyFormat: 'plain',
        bodyHtml: '<p>Server body</p>',
        bodyText: 'Server body',
        mailClassification: { category: 'offer' },
        deliveryStatus: 'sent',
      }],
    }, { operations })).toBe(false)
  })
})
