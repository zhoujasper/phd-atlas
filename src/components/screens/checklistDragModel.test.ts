import { describe, expect, it } from 'vitest'
import { resolveChecklistDrop, type ChecklistDragRowMetric } from './checklistDragModel'

const rows: ChecklistDragRowMetric[] = [
  { id: 'a', center: 25 },
  { id: 'b', center: 75 },
  { id: 'c', center: 125 },
  { id: 'd', center: 175 },
]

describe('resolveChecklistDrop', () => {
  it('resolves upward and downward insertion slots without measuring live DOM', () => {
    expect(resolveChecklistDrop('task', 'c', rows, 10)).toEqual({
      target: { kind: 'task', id: 'a', position: 'before' },
      insertionIndex: 0,
    })
    expect(resolveChecklistDrop('task', 'a', rows, 150)).toEqual({
      target: { kind: 'task', id: 'd', position: 'before' },
      insertionIndex: 2,
    })
    expect(resolveChecklistDrop('task', 'a', rows, 220)).toEqual({
      target: { kind: 'task', id: 'd', position: 'after' },
      insertionIndex: 3,
    })
  })

  it('adjusts cached centers by scroll delta', () => {
    expect(resolveChecklistDrop('material', 'b', rows, 70, 70)).toEqual({
      target: { kind: 'material', id: 'd', position: 'before' },
      insertionIndex: 2,
    })
  })

  it('keeps a small midpoint dead band so a trembling pointer does not flicker', () => {
    expect(resolveChecklistDrop('task', 'a', rows, 78, 0, 0, 6)).toEqual({
      target: { kind: 'task', id: 'b', position: 'before' },
      insertionIndex: 0,
    })
    expect(resolveChecklistDrop('task', 'a', rows, 82, 0, 1, 6)).toEqual({
      target: { kind: 'task', id: 'c', position: 'before' },
      insertionIndex: 1,
    })
  })
})
