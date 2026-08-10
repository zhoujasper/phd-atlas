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
  /** Grouped lists only. Undefined for a flat list such as the task list. */
  group?: string
}

/**
 * A group heading, in the same coordinate space as the row centers. The heading
 * — not the midpoint between two rows — is the real boundary between "after the
 * last row of this group" and "before the first row of the next one".
 */
export type ChecklistGroupBoundary = {
  group: string
  top: number
}

/** Geometry needed to preview a row moving through the real group layout. */
export type ChecklistGroupGeometry = ChecklistGroupBoundary & {
  height: number
  /** Gap between a group heading and its first row. */
  headerRowGap: number
  /** Gap between rows in this group. */
  rowGap: number
}

export type ChecklistDropResolution = {
  target: ChecklistDropTarget
  insertionIndex: number
  /** The group the row would join, for a grouped list. */
  group?: string
}

export type ChecklistRowGeometry = {
  top: number
  height: number
}

export type ChecklistPreviewPlacement = {
  /** Offset for the dragged row's own placeholder. */
  sourceShift: number
  /** Parallel to `rows`; 0 for rows that do not move. */
  shifts: number[]
  /** Parallel to measured group headers. Omitted for a flat list. */
  groupShifts?: Record<string, number>
}

/** Original spacing between row `index - 1` and row `index`. */
function spacingBefore(rows: readonly ChecklistRowGeometry[], index: number) {
  if (index <= 0 || index >= rows.length) return 0
  const previous = rows[index - 1]
  return rows[index].top - (previous.top + previous.height)
}

/**
 * Original spacing that follows `index`. The last row has nothing after it, so
 * reuse the spacing in front of it rather than collapsing the slot to zero.
 */
function spacingAfter(rows: readonly ChecklistRowGeometry[], index: number) {
  return index + 1 < rows.length
    ? spacingBefore(rows, index + 1)
    : spacingBefore(rows, index)
}

/**
 * Exact preview offsets for every row the drag displaces.
 *
 * A single `rowHeight + rowGap` displacement is only correct while every row is
 * the same height and every gap is the same. In the grouped materials checklist
 * neither holds: a row dragged into another group crosses a group heading and a
 * group-level gap, and an expanded row is taller than a collapsed one. Using one
 * constant there sized the reserved slot wrongly and let the dragged card sit on
 * top of the heading it was moving past.
 *
 * Walking the measured geometry instead reproduces the committed layout: each
 * displaced row is placed at the slot its neighbour vacated, carrying that
 * neighbour's real spacing with it, so whatever separates two rows — a gap, a
 * heading, a group boundary — is preserved by construction.
 */
export function resolveChecklistPreviewPlacement(
  rows: readonly ChecklistRowGeometry[],
  sourceIndex: number,
  insertionIndex: number,
  groupGeometry: readonly ChecklistGroupGeometry[] = [],
  targetGroup?: string,
): ChecklistPreviewPlacement {
  if (groupGeometry.length > 0 && targetGroup) {
    const grouped = resolveGroupedChecklistPreviewPlacement(
      rows,
      sourceIndex,
      insertionIndex,
      groupGeometry,
      targetGroup,
    )
    if (grouped) return grouped
  }

  return resolveFlatChecklistPreviewPlacement(rows, sourceIndex, insertionIndex)
}

function resolveFlatChecklistPreviewPlacement(
  rows: readonly ChecklistRowGeometry[],
  sourceIndex: number,
  insertionIndex: number,
): ChecklistPreviewPlacement {
  const shifts = rows.map(() => 0)
  const source = rows[sourceIndex]
  if (!source || insertionIndex === sourceIndex) return { sourceShift: 0, shifts }

  if (insertionIndex > sourceIndex) {
    // Rows below the source close up behind it, then the source lands last.
    let cursor = source.top
    for (let index = sourceIndex + 1; index <= insertionIndex && index < rows.length; index += 1) {
      shifts[index] = cursor - rows[index].top
      cursor += rows[index].height + spacingAfter(rows, index)
    }
    return { sourceShift: cursor - source.top, shifts }
  }

  // Dragging up: the source takes the insertion slot and everything from there
  // down to its old position follows behind it.
  const sourceShift = rows[insertionIndex].top - source.top
  let cursor = rows[insertionIndex].top + source.height + spacingAfter(rows, sourceIndex)
  for (let index = insertionIndex; index < sourceIndex; index += 1) {
    shifts[index] = cursor - rows[index].top
    cursor += rows[index].height + spacingAfter(rows, index)
  }
  return { sourceShift, shifts }
}

/**
 * Preview the layout as group blocks, rather than treating a heading-to-row gap
 * like an ordinary row gap. The old row-only walk was subtly wrong in both
 * directions: when a row left a group, the following heading stayed put, and
 * when a row entered a previous group it carried the source group's larger
 * boundary gap into the destination. Both errors make the empty slot visibly
 * drift away from the group the pointer is over.
 */
function resolveGroupedChecklistPreviewPlacement(
  rows: readonly ChecklistRowGeometry[],
  sourceIndex: number,
  insertionIndex: number,
  groups: readonly ChecklistGroupGeometry[],
  targetGroup: string,
): ChecklistPreviewPlacement | null {
  const source = rows[sourceIndex] as (ChecklistRowGeometry & { group?: string }) | undefined
  const groupedRows = rows as readonly (ChecklistRowGeometry & { group?: string })[]
  if (!source || !source.group) return null
  const sourceGroup = source.group
  const sourceGeometry = groups.find((group) => group.group === sourceGroup)
  const targetGeometry = groups.find((group) => group.group === targetGroup)
  if (!sourceGeometry || !targetGeometry) return null

  const shifts = rows.map(() => 0)
  const candidates = groupedRows.filter((row) => row !== source)
  const safeInsertionIndex = Math.max(0, Math.min(insertionIndex, candidates.length))
  const localInsertionIndex = candidates
    .slice(0, safeInsertionIndex)
    .filter((row) => row.group === targetGroup).length
  const sourceRows = groupedRows.filter((row) => row.group === sourceGroup)
  const targetRows = groupedRows.filter((row) => row.group === targetGroup && row !== source)
  const sourceRowGap = sourceRows.length > 1 ? sourceGeometry.rowGap : sourceGeometry.headerRowGap
  const targetRowGap = targetRows.length > 0 ? targetGeometry.rowGap : targetGeometry.headerRowGap
  const sourceRemoval = source.height + sourceRowGap
  const targetAddition = source.height + targetRowGap
  const groupDeltas = new Map<string, number>()

  if (sourceGroup !== targetGroup) {
    groupDeltas.set(sourceGroup, -sourceRemoval)
    groupDeltas.set(targetGroup, targetAddition)
  }

  const groupShifts: Record<string, number> = {}
  let precedingDelta = 0
  for (const group of groups) {
    groupShifts[group.group] = precedingDelta
    precedingDelta += groupDeltas.get(group.group) ?? 0
  }

  let sourceTop: number | null = null
  for (const group of groups) {
    const groupRows = groupedRows.filter((row) => row.group === group.group && row !== source)
    let cursor = group.top + group.height + group.headerRowGap + (groupShifts[group.group] ?? 0)
    let localIndex = 0
    let inserted = false

    for (const row of groupRows) {
      if (group.group === targetGroup && !inserted && localIndex === localInsertionIndex) {
        sourceTop = cursor
        cursor += source.height + targetRowGap
        inserted = true
      }
      const rowIndex = groupedRows.indexOf(row)
      if (rowIndex >= 0) shifts[rowIndex] = cursor - row.top
      cursor += row.height + group.rowGap
      localIndex += 1
    }

    if (group.group === targetGroup && !inserted) {
      sourceTop = cursor
    }
  }

  if (sourceTop === null) return null
  return {
    sourceShift: sourceTop - source.top,
    shifts,
    groupShifts,
  }
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
  groupBoundaries: readonly ChecklistGroupBoundary[] = [],
): ChecklistDropResolution {
  const candidates = rows.filter((row) => row.id !== activeId)
  const sourceIndex = rows.findIndex((row) => row.id === activeId)
  if (candidates.length === 0) {
    return {
      target: null,
      insertionIndex: Math.max(0, sourceIndex),
      group: groupBoundaries[0]?.group,
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

  // Which group the pointer is actually over decides the group, and the slot is
  // then clamped inside it. Reading the group off the neighbouring row instead
  // made the first and last slot of a group unreachable: aiming at the end of
  // one group always landed on the first row of the next, and joined it.
  const group = groupBoundaries.length > 0
    ? pointerGroup(groupBoundaries, contentY)
    : undefined
  if (group !== undefined) {
    const first = candidates.findIndex((row) => row.group === group)
    if (first === -1) {
      // Every row of this group is the one being dragged. Its slot is where the
      // group sits in the list, which is where the next group's rows begin.
      const followingGroups = new Set(
        groupBoundaries
          .slice(groupBoundaries.findIndex((boundary) => boundary.group === group) + 1)
          .map((boundary) => boundary.group),
      )
      const following = candidates.findIndex((row) => row.group !== undefined && followingGroups.has(row.group))
      insertionIndex = following === -1 ? candidates.length : following
    } else {
      let last = first
      for (let index = first; index < candidates.length; index += 1) {
        if (candidates[index].group === group) last = index
      }
      insertionIndex = Math.min(Math.max(insertionIndex, first), last + 1)
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
      group,
    }
  }

  return {
    target: {
      kind,
      id: candidates[candidates.length - 1].id,
      position: 'after',
    },
    insertionIndex,
    group,
  }
}

/** The group whose heading the pointer has passed, in list order. */
function pointerGroup(boundaries: readonly ChecklistGroupBoundary[], contentY: number) {
  let group = boundaries[0]?.group
  for (const boundary of boundaries) {
    if (contentY < boundary.top) break
    group = boundary.group
  }
  return group
}
