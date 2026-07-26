function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  ))
}

/**
 * Existing Team rows used `invitedBy` as both invitation provenance and the
 * student's single teacher. `relationships.teacherIds` is the explicit
 * many-to-many assignment. A missing key preserves the legacy fallback; an
 * explicit empty array intentionally means that the student is unassigned.
 */
export function teamMemberTeacherIds(member) {
  const relationships = member?.relationships
  if (
    relationships
    && typeof relationships === 'object'
    && Object.prototype.hasOwnProperty.call(relationships, 'teacherIds')
  ) {
    return uniqueStrings(relationships.teacherIds)
  }
  return member?.invitedBy ? [String(member.invitedBy)] : []
}

export function isTeacherAssignedToStudent(member, teacherUserId) {
  if (!teacherUserId || member?.role !== 'member') return false
  return teamMemberTeacherIds(member).includes(String(teacherUserId))
}

export function withTeamMemberTeacherIds(relationships, teacherIds) {
  return {
    ...(relationships && typeof relationships === 'object' ? relationships : {}),
    teacherIds: uniqueStrings(teacherIds),
  }
}

export function normalizeTeamTeacherGroups(value) {
  if (!Array.isArray(value)) return []
  const seenIds = new Set()
  const seenNames = new Set()
  const groups = []

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = String(raw.id ?? '').trim().slice(0, 100)
    const name = String(raw.name ?? '').trim().slice(0, 40)
    const normalizedName = name.toLocaleLowerCase()
    if (!id || !name || seenIds.has(id) || seenNames.has(normalizedName)) continue
    seenIds.add(id)
    seenNames.add(normalizedName)
    groups.push({
      id,
      name,
      memberIds: uniqueStrings(raw.memberIds).slice(0, 100),
      createdBy: raw.createdBy ? String(raw.createdBy) : null,
      createdAt: raw.createdAt ? String(raw.createdAt) : null,
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    })
  }

  return groups.slice(0, 50)
}
