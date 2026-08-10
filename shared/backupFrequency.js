/**
 * Automatic-backup cadence, defined once for the browser and the server.
 *
 * These were three separate implementations: the server's, and two copies in
 * the browser that validated against the *picker's* option list instead of the
 * accepted set. The picker offers four cadences; the server accepts eleven, and
 * its default — `15m` — is not one of the four. So an account on any sub-hourly
 * cadence was shown "Daily" in Settings and in the admin console, and saving
 * anything on either screen wrote `daily` back, silently changing a backup
 * schedule the person never touched.
 *
 * A value the server accepts must survive a round trip through the browser
 * untouched, whether or not the picker happens to offer it.
 */

/** Cadences the product accepts today. */
export const BACKUP_FREQUENCIES = Object.freeze([
  '1m', '5m', '15m', '30m', '1h', '3h', '6h', '12h', 'daily', '3d', '7d',
])

const BACKUP_FREQUENCY_SET = new Set(BACKUP_FREQUENCIES)

/** Retired from the picker, still present in stored settings. */
export const LEGACY_BACKUP_FREQUENCIES = Object.freeze(['weekly', 'monthly'])

export const DEFAULT_BACKUP_FREQUENCY = '15m'

export function isBackupFrequency(value) {
  return BACKUP_FREQUENCY_SET.has(value)
}

/**
 * The single normalization both sides apply. `weekly` became `7d` when the
 * cadence list was rewritten; `monthly` has no equivalent and falls back.
 */
export function normalizeBackupFrequency(value, fallback = DEFAULT_BACKUP_FREQUENCY) {
  if (BACKUP_FREQUENCY_SET.has(value)) return value
  if (value === 'weekly') return '7d'
  if (LEGACY_BACKUP_FREQUENCIES.includes(value)) return 'daily'
  return BACKUP_FREQUENCY_SET.has(fallback) ? fallback : DEFAULT_BACKUP_FREQUENCY
}
