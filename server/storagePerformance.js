import { createHash } from 'node:crypto'

export const DEFAULT_SYSTEM_LOG_RETENTION_DAYS = 90
export const DEFAULT_SYSTEM_EVENT_HARD_LIMIT = 250_000
export const MIN_SYSTEM_EVENT_HARD_LIMIT = 10_000
export const MAX_SYSTEM_EVENT_HARD_LIMIT = 2_000_000
export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5_000
export const MIN_SQLITE_BUSY_TIMEOUT_MS = 1_000
export const MAX_SQLITE_BUSY_TIMEOUT_MS = 30_000
export const DEFAULT_EXTERNAL_SYNC_DEBOUNCE_MS = 80
export const MIN_EXTERNAL_SYNC_DEBOUNCE_MS = 50
export const MAX_EXTERNAL_SYNC_DEBOUNCE_MS = 2_000
export const DEFAULT_STARTUP_VACUUM_MAX_BYTES = 512 * 1024 * 1024
const MIN_STARTUP_VACUUM_MAX_BYTES = 16 * 1024 * 1024
const MAX_STARTUP_VACUUM_MAX_BYTES = 8 * 1024 * 1024 * 1024

const AUTOMATIC_BACKUP_EVENT_ID_PREFIX = 'event_auto_backup_'
const AUTOMATIC_BACKUP_COMPACTION_MARKER = 'system-event-auto-backup-compaction-v1'

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)))
}

export function normalizeSystemEventHardLimit(
  value = process.env.PHD_ATLAS_SYSTEM_EVENT_HARD_LIMIT,
) {
  return boundedInteger(
    value,
    DEFAULT_SYSTEM_EVENT_HARD_LIMIT,
    MIN_SYSTEM_EVENT_HARD_LIMIT,
    MAX_SYSTEM_EVENT_HARD_LIMIT,
  )
}

export function normalizeSqliteBusyTimeoutMs(
  value = process.env.PHD_ATLAS_SQLITE_BUSY_TIMEOUT_MS,
) {
  return boundedInteger(
    value,
    DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
    MIN_SQLITE_BUSY_TIMEOUT_MS,
    MAX_SQLITE_BUSY_TIMEOUT_MS,
  )
}

export function normalizeExternalSyncDebounceMs(
  value = process.env.PHD_ATLAS_EXTERNAL_SYNC_DEBOUNCE_MS,
) {
  return boundedInteger(
    value,
    DEFAULT_EXTERNAL_SYNC_DEBOUNCE_MS,
    MIN_EXTERNAL_SYNC_DEBOUNCE_MS,
    MAX_EXTERNAL_SYNC_DEBOUNCE_MS,
  )
}

export function normalizeStartupVacuumMaxBytes(
  value = process.env.PHD_ATLAS_STARTUP_VACUUM_MAX_BYTES,
) {
  return boundedInteger(
    value,
    DEFAULT_STARTUP_VACUUM_MAX_BYTES,
    MIN_STARTUP_VACUUM_MAX_BYTES,
    MAX_STARTUP_VACUUM_MAX_BYTES,
  )
}

export function shouldVacuumAfterSystemEventCompaction({
  compactedRows,
  pageCount,
  freePages,
  fileBytes,
  availableBytes,
  maxFileBytes = normalizeStartupVacuumMaxBytes(),
}) {
  if (!Number.isSafeInteger(compactedRows) || compactedRows < 1_000) return false
  if (!Number.isFinite(pageCount) || pageCount <= 0) return false
  if (!Number.isFinite(freePages) || freePages / pageCount < 0.25) return false
  if (!Number.isFinite(fileBytes) || fileBytes <= 0 || fileBytes > maxFileBytes) return false
  if (!Number.isFinite(availableBytes)) return false
  // SQLite VACUUM builds a replacement file beside the original. Keep a 64 MiB
  // reserve beyond 1.25x the current image instead of gambling with a full disk.
  return availableBytes >= (fileBytes * 1.25) + (64 * 1024 * 1024)
}

function parseEventMetadata(event) {
  if (event?.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)) {
    return event.metadata
  }
  if (typeof event?.metadata_json !== 'string') return {}
  try {
    const parsed = JSON.parse(event.metadata_json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * High-frequency automatic backups are operational heartbeats, not distinct
 * user-authored audit actions. Give each application/workspace stream one
 * deterministic event identity so subsequent successful backups update a
 * bounded roll-up instead of appending an unbounded row.
 */
export function automaticBackupEventIdentity(event) {
  if (String(event?.scope ?? '') !== 'Backup') return null
  const message = String(event?.message ?? '')
  const metadata = parseEventMetadata(event)
  const actorId = String(event?.actorId ?? event?.actor_id ?? '').trim() || 'system'
  let key
  if (message === 'Created automatic workspace backup') {
    key = `workspace\u0000${actorId}`
  } else if (message.startsWith('Created automatic backup for ')) {
    const applicationId = String(metadata.applicationId ?? '').trim()
    if (!applicationId) return null
    key = `application\u0000${actorId}\u0000${applicationId}`
  } else {
    return null
  }
  return {
    id: `${AUTOMATIC_BACKUP_EVENT_ID_PREFIX}${createHash('sha256').update(key).digest('hex').slice(0, 40)}`,
    key,
  }
}

export function isAutomaticBackupEventId(value) {
  return String(value ?? '').startsWith(AUTOMATIC_BACKUP_EVENT_ID_PREFIX)
}

function validIsoStamp(value, fallback) {
  const text = String(value ?? '')
  return Number.isFinite(Date.parse(text)) ? text : fallback
}

function positiveOccurrenceCount(value) {
  const count = Number(value)
  return Number.isSafeInteger(count) && count > 0 ? count : 1
}

function tableExists(database, table) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table))
}

function revisionBeforeMaintenance(database) {
  if (!tableExists(database, 'workspace_revision')) return null
  const row = database.prepare('SELECT id, revision FROM workspace_revision ORDER BY id LIMIT 1').get()
  const revision = Number(row?.revision)
  return Number.isSafeInteger(revision) && revision >= 0 ? { id: row.id, revision } : null
}

function normalizeMaintenanceRevision(database, state) {
  if (state === null || state.revision >= Number.MAX_SAFE_INTEGER) return
  database.prepare('UPDATE workspace_revision SET revision = ? WHERE id = ?')
    .run(state.revision + 1, state.id)
}

function suspendSystemEventRevisionTriggers(database) {
  const triggers = database.prepare(
    `SELECT name, sql
     FROM sqlite_master
     WHERE type = 'trigger'
       AND tbl_name = 'system_events'
       AND name LIKE 'phd_atlas_revision_system_events_%'
     ORDER BY name`,
  ).all()
  for (const trigger of triggers) {
    const name = `"${String(trigger.name).replaceAll('"', '""')}"`
    database.exec(`DROP TRIGGER ${name}`)
  }
  return () => {
    for (const trigger of triggers) database.exec(trigger.sql)
  }
}

/**
 * One-time lossless roll-up for legacy automatic-backup noise. It retains the
 * latest metadata plus the aggregate count and first/last timestamps. Manual
 * checkpoints, restores, deletes, security events, and all business tables are
 * outside the candidate predicate.
 */
export function compactLegacyAutomaticBackupEvents(database, {
  now = new Date().toISOString(),
  markerKey = AUTOMATIC_BACKUP_COMPACTION_MARKER,
} = {}) {
  if (!tableExists(database, 'app_meta') || !tableExists(database, 'system_events')) {
    return { skipped: true, groups: 0, compactedRows: 0 }
  }
  const existingMarker = database.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1').get(markerKey)
  if (existingMarker) {
    try {
      const parsed = JSON.parse(existingMarker.value)
      return {
        skipped: true,
        groups: Number.isSafeInteger(Number(parsed?.groups)) ? Number(parsed.groups) : 0,
        compactedRows: Number.isSafeInteger(Number(parsed?.compactedRows))
          ? Number(parsed.compactedRows)
          : 0,
      }
    } catch {
      return { skipped: true, groups: 0, compactedRows: 0 }
    }
  }

  const compact = database.transaction(() => {
    const baseRevision = revisionBeforeMaintenance(database)
    const restoreRevisionTriggers = suspendSystemEventRevisionTriggers(database)
    const groups = new Map()
    const candidates = database.prepare(
      `SELECT id, time, scope, actor_id, message, metadata_json
       FROM system_events
       WHERE scope = 'Backup'
         AND json_valid(metadata_json)
         AND (
           message = 'Created automatic workspace backup'
           OR (
             message LIKE 'Created automatic backup for %'
             AND json_type(metadata_json, '$.applicationId') = 'text'
             AND TRIM(json_extract(metadata_json, '$.applicationId')) <> ''
           )
         )
       ORDER BY time ASC, id ASC`,
    ).iterate()

    let candidateRows = 0
    for (const row of candidates) {
      const metadata = parseEventMetadata(row)
      const identity = automaticBackupEventIdentity(row)
      if (!identity) continue
      candidateRows += 1
      const firstAt = validIsoStamp(metadata.firstCreatedAt, row.time)
      const lastAt = validIsoStamp(metadata.lastCreatedAt, row.time)
      const previous = groups.get(identity.key)
      if (!previous) {
        groups.set(identity.key, {
          identity,
          occurrences: positiveOccurrenceCount(metadata.occurrences),
          firstAt,
          lastAt,
          latest: { ...row, metadata },
        })
        continue
      }
      previous.occurrences += positiveOccurrenceCount(metadata.occurrences)
      if (firstAt < previous.firstAt) previous.firstAt = firstAt
      if (lastAt > previous.lastAt) previous.lastAt = lastAt
      if (
        row.time > previous.latest.time
        || (row.time === previous.latest.time && row.id > previous.latest.id)
      ) {
        previous.latest = { ...row, metadata }
      }
    }

    if (candidateRows > 0) {
      database.prepare(
        `DELETE FROM system_events
         WHERE scope = 'Backup'
           AND json_valid(metadata_json)
           AND (
             message = 'Created automatic workspace backup'
             OR (
               message LIKE 'Created automatic backup for %'
               AND json_type(metadata_json, '$.applicationId') = 'text'
               AND TRIM(json_extract(metadata_json, '$.applicationId')) <> ''
             )
           )`,
      ).run()
      const insert = database.prepare(
        `INSERT INTO system_events (id, time, scope, actor_id, message, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const group of groups.values()) {
        const latest = group.latest
        const metadata = {
          ...latest.metadata,
          occurrences: group.occurrences,
          firstCreatedAt: group.firstAt,
          lastCreatedAt: group.lastAt,
        }
        insert.run(
          group.identity.id,
          group.lastAt,
          latest.scope,
          latest.actor_id,
          latest.message,
          JSON.stringify(metadata),
        )
      }
    }

    database.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(markerKey, JSON.stringify({
      completedAt: now,
      groups: groups.size,
      compactedRows: Math.max(0, candidateRows - groups.size),
    }))
    restoreRevisionTriggers()
    normalizeMaintenanceRevision(database, baseRevision)
    return {
      skipped: false,
      groups: groups.size,
      compactedRows: Math.max(0, candidateRows - groups.size),
    }
  })
  return compact.immediate()
}

const SYSTEM_EVENT_MAINTENANCE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS system_event_maintenance (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count >= 0),
    hard_limit INTEGER NOT NULL CHECK(hard_limit >= 1),
    last_pruned_at TEXT
  );
`

const SYSTEM_EVENT_MAINTENANCE_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS trg_system_events_bounded_delete
  AFTER DELETE ON system_events
  BEGIN
    UPDATE system_event_maintenance
    SET row_count = MAX(0, row_count - 1)
    WHERE id = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_system_events_bounded_insert
  AFTER INSERT ON system_events
  BEGIN
    UPDATE system_event_maintenance
    SET row_count = row_count + 1
    WHERE id = 1;

    DELETE FROM system_events
    WHERE id IN (
      SELECT id
      FROM system_events
      ORDER BY time ASC, id ASC
      LIMIT MAX((
        SELECT row_count - hard_limit
        FROM system_event_maintenance
        WHERE id = 1
      ), 0)
    );

    UPDATE system_event_maintenance
    SET last_pruned_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = 1 AND row_count >= hard_limit;
  END;
`

/** Install a cross-process, exact audit-row cap without counting the table on each insert. */
export function configureSystemEventMaintenance(database, {
  hardLimit = normalizeSystemEventHardLimit(),
} = {}) {
  const normalizedLimit = normalizeSystemEventHardLimit(hardLimit)
  database.exec(SYSTEM_EVENT_MAINTENANCE_SCHEMA)
  const configure = database.transaction(() => {
    const count = Number(database.prepare('SELECT COUNT(*) AS count FROM system_events').get()?.count ?? 0)
    database.prepare(
      `INSERT INTO system_event_maintenance (id, row_count, hard_limit, last_pruned_at)
       VALUES (1, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         row_count = excluded.row_count,
         hard_limit = excluded.hard_limit`,
    ).run(count, normalizedLimit)
    const overflow = Math.max(0, count - normalizedLimit)
    if (overflow > 0) {
      database.prepare(
        `DELETE FROM system_events
         WHERE id IN (
           SELECT id FROM system_events ORDER BY time ASC, id ASC LIMIT ?
         )`,
      ).run(overflow)
      database.prepare(
        `UPDATE system_event_maintenance
         SET row_count = (SELECT COUNT(*) FROM system_events),
             last_pruned_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = 1`,
      ).run()
    }
  })
  configure.immediate()
  database.exec(SYSTEM_EVENT_MAINTENANCE_TRIGGERS)
  return {
    hardLimit: normalizedLimit,
    rowCount: readMaintainedSystemEventCount(database),
  }
}

export function readMaintainedSystemEventCount(database) {
  const maintained = database.prepare(
    'SELECT row_count FROM system_event_maintenance WHERE id = 1',
  ).get()
  if (Number.isSafeInteger(Number(maintained?.row_count))) return Number(maintained.row_count)
  return Number(database.prepare('SELECT COUNT(*) AS count FROM system_events').get()?.count ?? 0)
}

/** Install covering/partial indexes for the storage layer's actual query shapes. */
export function installStoragePerformanceIndexes(database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_system_events_time_id
      ON system_events(time DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_system_events_scope_time_id
      ON system_events(scope, time DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_profile_assets_owner_updated
      ON profile_assets(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_active_user_created
      ON notifications(user_id, created_at DESC)
      WHERE archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_unread_user
      ON notifications(user_id)
      WHERE read_at IS NULL AND archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_pending_email
      ON notifications(user_id, created_at ASC)
      WHERE emailed_at IS NULL AND archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_pending_push_active
      ON notifications(created_at ASC)
      WHERE push_enqueued_at IS NULL AND archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_notification_groups_scope_owner_updated
      ON notification_groups(scope, owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_groups_team_updated
      ON notification_groups(team_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_teams_owner
      ON teams(owner_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_team_status_role
      ON team_members(team_id, status, role, user_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_user_status_team
      ON team_members(user_id, status, team_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_team_email_ci_status
      ON team_members(team_id, lower(invited_email), status);
    CREATE INDEX IF NOT EXISTS idx_school_logo_cache_updated
      ON school_logo_cache(updated_at DESC);

    DROP INDEX IF EXISTS idx_system_events_time;
    DROP INDEX IF EXISTS idx_team_members_user;
    DROP INDEX IF EXISTS idx_notifications_pending_push;
    DROP INDEX IF EXISTS idx_notification_groups_scope_owner;
    DROP INDEX IF EXISTS idx_notification_groups_team;
  `)
}
