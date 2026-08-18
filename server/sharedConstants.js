/**
 * Constants that more than one module has to agree on.
 *
 * Each of these was previously typed out in two files. A duplicated list does
 * not fail when it drifts — it produces a value one layer accepts and another
 * rejects, which is the shape of every "it saved but it did not" report this
 * codebase has had. Keeping them here makes agreement structural rather than a
 * matter of remembering to edit both copies.
 *
 * `server/duplicateConstantContract.test.js` fails the build if a copy reappears.
 */

// Backup cadence is shared with the browser, so it lives in shared/ and is
// re-exported here for the server modules that already import from this file.
export {
  BACKUP_FREQUENCIES,
  DEFAULT_BACKUP_FREQUENCY,
  LEGACY_BACKUP_FREQUENCIES,
  isBackupFrequency,
  normalizeBackupFrequency,
} from './shared/backupFrequency.js'

export const DEFAULT_MAX_BACKUPS_PER_APP = 5
export const DEFAULT_PRO_MAX_BACKUPS_PER_APP = 20
export const DEFAULT_ADMIN_MAX_BACKUPS_PER_APP = 100
export const MIN_SYSTEM_BACKUP_LIMIT = 1
export const MAX_SYSTEM_BACKUP_LIMIT = 20

/**
 * Interface languages the server can render an export in. This must stay in
 * step with `src/i18n`; a language present in one exporter and not the other
 * silently falls back mid-document.
 */
export const SUPPORTED_EXPORT_LANGUAGES = Object.freeze(new Set([
  'en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th',
]))

/**
 * Files an update package must contain to be a runnable release. Both the
 * package verifier and the delta builder gate on this, and a disagreement means
 * one of them would accept a package the other considers unbootable.
 */
export const REQUIRED_RUNTIME_FILES = Object.freeze(new Set([
  'dist/index.html',
  'server/index.js',
  'server/shared/aiConcurrency.js',
  'server/shared/aiKeyRouting.js',
  'server/shared/applicationAuthorityFields.js',
  'server/shared/applicationCanonical.js',
  'server/shared/applicationPersistenceProtocol.js',
  'server/shared/backupFrequency.js',
  'server/shared/realtimeScopes.js',
  'server/shared/teamLimits.js',
  'tools/start-server.mjs',
  'tools/apply-update.mjs',
  'tools/container-entrypoint.mjs',
  'package.json',
  'package-lock.json',
]))
