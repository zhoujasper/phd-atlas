import { describe, expect, it } from 'vitest'
import { BACKUP_FREQUENCIES, normalizeBackupFrequency } from '../shared/backupFrequency.js'
import { MAX_TEAM_MEMBER_LIMIT, normalizeOptionalMemberLimit } from '../shared/teamLimits.js'
import { normalizeBackupFrequency as serverNormalizeBackupFrequency } from './sharedConstants.js'
import { normalizeStudentPermissions } from './teamPermissions.js'

/**
 * One level above a duplicated constant: a *rule* implemented separately on
 * each side of the wire. Both copies look right in review, and the failure only
 * appears when a value lands in the gap between them — the browser writes what
 * its copy produced, the server stores what its copy produced, and the
 * difference reads as data changing on its own.
 *
 * Two of these were live when this was written:
 *
 *   - Backup cadence: the browser validated against its *picker's* options
 *     rather than the accepted set. The admin console lists four cadences and
 *     the server accepts eleven, so an account on the `15m` default displayed
 *     "Daily" and any save on that screen wrote `daily` back.
 *   - Team seat limits: the same clamp written with a bare `10_000` in the
 *     editor and a named constant on the server. Equal today; an authorization
 *     bound that can silently stop being equal.
 *
 * These now have one implementation each, in `shared/`. This asserts the
 * property that matters rather than the wiring: the same input reaches the same
 * answer wherever it is asked.
 */
describe('rules that both sides of the wire must agree on', () => {
  it('normalizes every backup cadence identically wherever it is applied', () => {
    const inputs = [...BACKUP_FREQUENCIES, 'weekly', 'monthly', 'nonsense', '', undefined, null]
    for (const input of inputs) {
      expect(serverNormalizeBackupFrequency(input)).toBe(normalizeBackupFrequency(input))
    }
    // And an accepted cadence is never rewritten into a different one.
    for (const frequency of BACKUP_FREQUENCIES) {
      expect(normalizeBackupFrequency(frequency)).toBe(frequency)
    }
  })

  it('clamps a seat limit to the same bound the editor shows', () => {
    expect(normalizeOptionalMemberLimit(MAX_TEAM_MEMBER_LIMIT + 5)).toBe(MAX_TEAM_MEMBER_LIMIT)
    expect(normalizeOptionalMemberLimit(0)).toBe(1)
    expect(normalizeOptionalMemberLimit('')).toBeNull()
    expect(normalizeOptionalMemberLimit(1.5)).toBeNull()

    // The server's own permission normalization runs through that same clamp.
    const permissions = normalizeStudentPermissions({
      activeApplicationLimit: MAX_TEAM_MEMBER_LIMIT + 5,
    })
    expect(permissions.activeApplicationLimit).toBe(MAX_TEAM_MEMBER_LIMIT)
  })
})
