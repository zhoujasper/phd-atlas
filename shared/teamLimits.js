/**
 * Seat limits, shared by the browser's permission editor and the server that
 * enforces them.
 *
 * The ceiling was written as a bare `10_000` in `src/teamPermissions.ts` and as
 * `MAX_TEAM_MEMBER_LIMIT` in `server/teamPermissions.js`. They agree today, and
 * that is precisely the problem with leaving it: an authorization bound where
 * the editor clamps to one number and the server enforces another shows an
 * administrator a limit that is not the one in force.
 */
export const MAX_TEAM_MEMBER_LIMIT = 10_000

/** `null` means unlimited; anything unparseable is treated as unlimited too. */
export function normalizeOptionalMemberLimit(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  return Math.max(1, Math.min(MAX_TEAM_MEMBER_LIMIT, parsed))
}
