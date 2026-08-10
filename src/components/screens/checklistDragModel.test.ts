import { describe, expect, it } from 'vitest'
import {
  resolveChecklistDrop,
  resolveChecklistPreviewPlacement,
  type ChecklistDragRowMetric,
  type ChecklistGroupBoundary,
  type ChecklistGroupGeometry,
  type ChecklistRowGeometry,
} from './checklistDragModel'

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

describe('resolveChecklistDrop across groups', () => {
  // Two groups, each with two rows. A heading sits above each group.
  const groupedRows: ChecklistDragRowMetric[] = [
    { id: 'a1', center: 40, group: 'Core' },
    { id: 'a2', center: 90, group: 'Core' },
    { id: 'b1', center: 190, group: 'Extra' },
    { id: 'b2', center: 240, group: 'Extra' },
  ]
  const boundaries: ChecklistGroupBoundary[] = [
    { group: 'Core', top: 10 },
    { group: 'Extra', top: 140 },
  ]

  it('keeps a row in its own group when it is dragged past the last row', () => {
    // Below a2's center but still above the next group's heading: the slot is
    // the end of Core, not the start of Extra.
    const resolution = resolveChecklistDrop('material', 'a1', groupedRows, 120, 0, undefined, 0, boundaries)
    expect(resolution.group).toBe('Core')
    expect(resolution.insertionIndex).toBe(1)
    expect(resolution.target).toEqual({ kind: 'material', id: 'b1', position: 'before' })
  })

  it('keeps a row in its own group when it is dragged above the first row', () => {
    const resolution = resolveChecklistDrop('material', 'b2', groupedRows, 150, 0, undefined, 0, boundaries)
    expect(resolution.group).toBe('Extra')
    expect(resolution.insertionIndex).toBe(2)
    expect(resolution.target).toEqual({ kind: 'material', id: 'b1', position: 'before' })
  })

  it('adopts the other group only once the pointer is past its heading', () => {
    const resolution = resolveChecklistDrop('material', 'a1', groupedRows, 210, 0, undefined, 0, boundaries)
    expect(resolution.group).toBe('Extra')
    expect(resolution.insertionIndex).toBe(2)
  })

  it('holds a lone row in its own group when every candidate is elsewhere', () => {
    const lone: ChecklistDragRowMetric[] = [
      { id: 'a1', center: 40, group: 'Core' },
      { id: 'b1', center: 190, group: 'Extra' },
    ]
    const resolution = resolveChecklistDrop('material', 'a1', lone, 60, 0, undefined, 0, boundaries)
    expect(resolution.group).toBe('Core')
    expect(resolution.insertionIndex).toBe(0)
  })

  it('leaves an ungrouped list alone', () => {
    expect(resolveChecklistDrop('task', 'a', rows, 220).group).toBeUndefined()
  })
})

describe('resolveChecklistPreviewPlacement', () => {
  // Two groups. Rows are 40 tall, 8 apart inside a group, and the second group
  // starts 60 below the first one's last row because a heading sits between.
  const grouped: ChecklistRowGeometry[] = [
    { top: 0, height: 40 },
    { top: 48, height: 40 },
    { top: 148, height: 40 },
    { top: 196, height: 40 },
  ]

  it('leaves everything in place when the row is dropped back where it started', () => {
    expect(resolveChecklistPreviewPlacement(grouped, 1, 1)).toEqual({
      sourceShift: 0,
      shifts: [0, 0, 0, 0],
    })
  })

  it('carries the heading gap when a row moves down into the next group', () => {
    const placement = resolveChecklistPreviewPlacement(grouped, 0, 2)
    // Removing row 0 lifts everything below it by its height plus its own gap.
    expect(placement.shifts).toEqual([0, -48, -48, 0])
    // Row 2 now sits at 100 and the source follows it 8 below: 100 + 40 + 8.
    expect(placement.sourceShift).toBe(148)
    // The 60px heading gap between rows 1 and 2 is preserved rather than being
    // flattened into the one `rowHeight + gap` constant this used to apply.
  })

  it('carries the heading gap when a row moves up into the previous group', () => {
    const placement = resolveChecklistPreviewPlacement(grouped, 3, 1)
    expect(placement.sourceShift).toBe(48 - 196)
    // Rows 1 and 2 follow the source down, each keeping its original spacing.
    expect(placement.shifts).toEqual([0, 48, 48, 0])
  })

  it('accounts for a taller expanded row instead of assuming a uniform height', () => {
    const mixed: ChecklistRowGeometry[] = [
      { top: 0, height: 40 },
      { top: 48, height: 120 },
      { top: 176, height: 40 },
    ]
    const placement = resolveChecklistPreviewPlacement(mixed, 0, 2)
    expect(placement.shifts).toEqual([0, -48, -48])
    // 120-tall row 1 lands at 0, row 2 follows at 128, the source at 176.
    expect(placement.sourceShift).toBe(176)
  })

  it('moves the destination heading with the group when a row enters from above', () => {
    const grouped: Array<ChecklistRowGeometry & { group: string }> = [
      { top: 28, height: 40, group: 'Core' },
      { top: 74, height: 40, group: 'Core' },
      { top: 162, height: 40, group: 'Extra' },
      { top: 208, height: 40, group: 'Extra' },
    ]
    const groups: ChecklistGroupGeometry[] = [
      { group: 'Core', top: 0, height: 20, headerRowGap: 8, rowGap: 6 },
      { group: 'Extra', top: 134, height: 20, headerRowGap: 8, rowGap: 6 },
    ]

    const placement = resolveChecklistPreviewPlacement(grouped, 0, 1, groups, 'Extra')
    expect(placement.sourceShift).toBe(88)
    expect(placement.shifts).toEqual([0, -46, 0, 0])
    expect(placement.groupShifts).toEqual({ Core: 0, Extra: -46 })
  })

  it('uses the destination group gap when a row moves upward', () => {
    const grouped: Array<ChecklistRowGeometry & { group: string }> = [
      { top: 28, height: 40, group: 'Core' },
      { top: 74, height: 40, group: 'Core' },
      { top: 162, height: 40, group: 'Extra' },
      { top: 208, height: 40, group: 'Extra' },
    ]
    const groups: ChecklistGroupGeometry[] = [
      { group: 'Core', top: 0, height: 20, headerRowGap: 8, rowGap: 6 },
      { group: 'Extra', top: 134, height: 20, headerRowGap: 8, rowGap: 6 },
    ]

    const placement = resolveChecklistPreviewPlacement(grouped, 2, 1, groups, 'Core')
    expect(placement.sourceShift).toBe(-88)
    expect(placement.shifts).toEqual([0, 46, 0, 0])
    expect(placement.groupShifts).toEqual({ Core: 0, Extra: 46 })
  })
})
