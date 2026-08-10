/** Public-edition compatibility boundary; Team relationships are unavailable. */
export function teamMemberTeacherIds() { return [] }
export function isTeacherAssignedToStudent() { return false }
export function withTeamMemberTeacherIds(relationships) {
  return { ...(relationships && typeof relationships === "object" ? relationships : {}), teacherIds: [] }
}
export function normalizeTeamTeacherGroups() { return [] }
