export type ChecklistDragKind = 'material' | 'task'
export type ChecklistDropPosition = 'before' | 'after'

export type ChecklistDropTarget = {
  kind: ChecklistDragKind
  id: string
  position: ChecklistDropPosition
} | null

export type ChecklistDragRowMetric = {
  id: string
  center: number
}

export type ChecklistDropResolution = {
  target: ChecklistDropTarget
  insertionIndex: number
}

/**
 * Resolves a pointer to a stable insertion slot using geometry captured once
 * when dragging begins. `scrollDelta` keeps those cached viewport coordinates
 * valid while the owning scroller moves, so pointer-frequency work never needs
 * to remeasure every row.
 */
export function resolveChecklistDrop(
  kind: ChecklistDragKind,
  activeId: string,
  rows: readonly ChecklistDragRowMetric[],
  clientY: number,
  scrollDelta = 0,
  currentInsertionIndex?: number,
  hysteresis = 0,
): ChecklistDropResolution {
  const candidates = rows.filter((row) => row.id !== activeId)
  const sourceIndex = rows.findIndex((row) => row.id === activeId)
  if (candidates.length === 0) {
    return {
      target: null,
      insertionIndex: Math.max(0, sourceIndex),
    }
  }

  const contentY = clientY + scrollDelta
  let insertionIndex = candidates.findIndex((row) => contentY <= row.center)
  if (insertionIndex === -1) insertionIndex = candidates.length

  if (
    currentInsertionIndex !== undefined
    && currentInsertionIndex >= 0
    && currentInsertionIndex <= candidates.length
    && insertionIndex !== currentInsertionIndex
    && hysteresis > 0
  ) {
    if (insertionIndex > currentInsertionIndex) {
      const boundary = candidates[Math.min(currentInsertionIndex, candidates.length - 1)]?.center
      if (boundary !== undefined && contentY < boundary + hysteresis) {
        insertionIndex = currentInsertionIndex
      }
    } else {
      const boundary = candidates[Math.min(insertionIndex, candidates.length - 1)]?.center
      if (boundary !== undefined && contentY > boundary - hysteresis) {
        insertionIndex = currentInsertionIndex
      }
    }
  }

  if (insertionIndex < candidates.length) {
    return {
      target: {
        kind,
        id: candidates[insertionIndex].id,
        position: 'before',
      },
      insertionIndex,
    }
  }

  return {
    target: {
      kind,
      id: candidates[candidates.length - 1].id,
      position: 'after',
    },
    insertionIndex,
  }
}
