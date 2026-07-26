export type RelationshipDropMode = 'add' | 'move'

export const RELATIONSHIP_ZOOM_MIN = 0.65
export const RELATIONSHIP_ZOOM_MAX = 1.5
export const RELATIONSHIP_ZOOM_STEP = 0.1

export type RelationshipCanvasPoint = {
  x: number
  y: number
}

export type RelationshipZoomScrollInput = {
  startZoom: number
  nextZoom: number
  startScrollLeft: number
  startScrollTop: number
  startAnchor: RelationshipCanvasPoint
  nextAnchor?: RelationshipCanvasPoint
}

function uniqueIds(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function relationshipDropMode(altKey: boolean): RelationshipDropMode {
  return altKey ? 'add' : 'move'
}

/**
 * Alt-drag adds a co-manager. Move-drag replaces only the relationship that
 * the dragged node represents, leaving every other teacher assignment intact.
 */
export function teacherIdsAfterRelationshipDrop(
  currentTeacherUserIds: readonly string[],
  sourceTeacherUserId: string | null,
  targetTeacherUserId: string,
  mode: RelationshipDropMode,
) {
  const current = uniqueIds(currentTeacherUserIds)
  const target = targetTeacherUserId.trim()
  if (!target) return current

  if (mode === 'add') {
    return current.includes(target) ? current : [...current, target]
  }

  const source = sourceTeacherUserId?.trim() || null
  if (!source) {
    return current.includes(target) ? current : [target, ...current]
  }

  const sourceIndex = current.indexOf(source)
  if (sourceIndex < 0) {
    return current.includes(target) ? current : [...current, target]
  }

  const next = current.filter((teacherId) => teacherId !== source && teacherId !== target)
  next.splice(Math.min(sourceIndex, next.length), 0, target)
  return next
}

export function clampRelationshipZoom(value: number) {
  const finiteValue = Number.isFinite(value) ? value : 1
  return Math.round(
    Math.min(RELATIONSHIP_ZOOM_MAX, Math.max(RELATIONSHIP_ZOOM_MIN, finiteValue)) * 100,
  ) / 100
}

export function relationshipZoomFromPinch(
  startZoom: number,
  startDistance: number,
  nextDistance: number,
) {
  if (
    !Number.isFinite(startDistance)
    || !Number.isFinite(nextDistance)
    || startDistance <= 0
    || nextDistance <= 0
  ) {
    return clampRelationshipZoom(startZoom)
  }
  return clampRelationshipZoom(startZoom * (nextDistance / startDistance))
}

/**
 * Keeps the same map point under the cursor/finger while zoom changes. A
 * different next anchor also turns a two-finger translation into canvas pan.
 */
export function relationshipScrollForZoom({
  startZoom,
  nextZoom,
  startScrollLeft,
  startScrollTop,
  startAnchor,
  nextAnchor = startAnchor,
}: RelationshipZoomScrollInput) {
  const safeStartZoom = Math.max(0.01, Number.isFinite(startZoom) ? startZoom : 1)
  const safeNextZoom = Math.max(0.01, Number.isFinite(nextZoom) ? nextZoom : safeStartZoom)
  const scale = safeNextZoom / safeStartZoom
  return {
    left: Math.max(0, (startScrollLeft + startAnchor.x) * scale - nextAnchor.x),
    top: Math.max(0, (startScrollTop + startAnchor.y) * scale - nextAnchor.y),
  }
}
