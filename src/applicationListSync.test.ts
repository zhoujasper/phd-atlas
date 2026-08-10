import { describe, expect, it } from 'vitest'
import type { ApplicationRecord } from './data/applications'
import { mergeApplicationListPreservingIdentity } from './applicationListSync'

function record(id: string, updatedAt: string) {
  return { id, updatedAt } as unknown as ApplicationRecord
}

describe('realtime application list merge', () => {
  it('returns the previous array when the fetched list carries no new revision', () => {
    const previous = [record('a', '2026-08-05T10:00:00.000Z'), record('b', '2026-08-05T10:01:00.000Z')]
    const next = [record('a', '2026-08-05T10:00:00.000Z'), record('b', '2026-08-05T10:01:00.000Z')]

    expect(mergeApplicationListPreservingIdentity(previous, next)).toBe(previous)
  })

  it('keeps the object identity of records whose revision did not move', () => {
    const unchanged = record('a', '2026-08-05T10:00:00.000Z')
    const previous = [unchanged, record('b', '2026-08-05T10:01:00.000Z')]
    const next = [record('a', '2026-08-05T10:00:00.000Z'), record('b', '2026-08-05T10:09:00.000Z')]

    const merged = mergeApplicationListPreservingIdentity(previous, next)
    expect(merged).not.toBe(previous)
    expect(merged[0]).toBe(unchanged)
    expect(merged[1]).toBe(next[1])
  })

  it('adopts additions, removals and reorders', () => {
    const previous = [record('a', '1'), record('b', '2')]

    expect(mergeApplicationListPreservingIdentity(previous, [record('a', '1')])).toHaveLength(1)
    expect(mergeApplicationListPreservingIdentity(previous, [
      record('a', '1'),
      record('b', '2'),
      record('c', '3'),
    ])).toHaveLength(3)

    const reordered = mergeApplicationListPreservingIdentity(previous, [record('b', '2'), record('a', '1')])
    expect(reordered).not.toBe(previous)
    expect(reordered.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('treats a record without a revision marker as changed', () => {
    const previous = [record('a', '2026-08-05T10:00:00.000Z')]
    const next = [{ id: 'a' } as unknown as ApplicationRecord]

    expect(mergeApplicationListPreservingIdentity(previous, next)).not.toBe(previous)
  })
})
