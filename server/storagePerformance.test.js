import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTERNAL_SYNC_DEBOUNCE_MS,
  DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
  DEFAULT_SYSTEM_EVENT_HARD_LIMIT,
  automaticBackupEventIdentity,
  compactLegacyAutomaticBackupEvents,
  configureSystemEventMaintenance,
  installStoragePerformanceIndexes,
  normalizeExternalSyncDebounceMs,
  normalizeSqliteBusyTimeoutMs,
  normalizeSystemEventHardLimit,
  readMaintainedSystemEventCount,
  shouldVacuumAfterSystemEventCompaction,
} from './storagePerformance.js'

function createEventDatabase() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspace_revision (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    INSERT INTO workspace_revision (id, revision) VALUES ('workspace', 7);
    CREATE TABLE system_events (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE INDEX idx_system_events_time ON system_events(time DESC);
  `)
  return database
}

describe('storage performance configuration', () => {
  it('keeps concurrency and retention bounds conservative and configurable', () => {
    expect(normalizeSystemEventHardLimit(undefined)).toBe(DEFAULT_SYSTEM_EVENT_HARD_LIMIT)
    expect(normalizeSystemEventHardLimit(1)).toBe(10_000)
    expect(normalizeSystemEventHardLimit(9_000_000)).toBe(2_000_000)
    expect(normalizeSqliteBusyTimeoutMs(undefined)).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT_MS)
    expect(normalizeSqliteBusyTimeoutMs(50)).toBe(1_000)
    expect(normalizeSqliteBusyTimeoutMs(90_000)).toBe(30_000)
    expect(normalizeExternalSyncDebounceMs(undefined)).toBe(DEFAULT_EXTERNAL_SYNC_DEBOUNCE_MS)
    expect(normalizeExternalSyncDebounceMs(1)).toBe(50)
    expect(normalizeExternalSyncDebounceMs(9_000)).toBe(2_000)
    expect(shouldVacuumAfterSystemEventCompaction({
      compactedRows: 50_000,
      pageCount: 20_000,
      freePages: 15_000,
      fileBytes: 80 * 1024 * 1024,
      availableBytes: 2 * 1024 * 1024 * 1024,
    })).toBe(true)
    expect(shouldVacuumAfterSystemEventCompaction({
      compactedRows: 50_000,
      pageCount: 20_000,
      freePages: 15_000,
      fileBytes: 80 * 1024 * 1024,
      availableBytes: 100 * 1024 * 1024,
    })).toBe(false)
  })

  it('uses one deterministic identity only for automatic backup streams', () => {
    const event = {
      actorId: 'user_1',
      scope: 'Backup',
      message: 'Created automatic backup for Example University',
      metadata: { applicationId: 'app_1', fileName: 'first.json' },
    }
    expect(automaticBackupEventIdentity(event)?.id).toMatch(/^event_auto_backup_[a-f0-9]{40}$/)
    expect(automaticBackupEventIdentity({
      ...event,
      metadata: { ...event.metadata, fileName: 'second.json' },
    })).toEqual(automaticBackupEventIdentity(event))
    expect(automaticBackupEventIdentity({
      ...event,
      message: 'Created backup checkpoint for Example University',
    })).toBeNull()
  })
})

describe('automatic backup audit compaction', () => {
  it('rolls up only automatic backup noise and preserves counts and time bounds', () => {
    const database = createEventDatabase()
    const insert = database.prepare(
      `INSERT INTO system_events (id, time, scope, actor_id, message, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (let index = 0; index < 3; index += 1) {
      insert.run(
        `legacy_app_${index}`,
        `2026-08-0${index + 1}T10:00:00.000Z`,
        'Backup',
        'user_1',
        'Created automatic backup for Example University',
        JSON.stringify({ applicationId: 'app_1', fileName: `${index}.json`, frequency: '1m' }),
      )
    }
    for (let index = 0; index < 2; index += 1) {
      insert.run(
        `legacy_workspace_${index}`,
        `2026-08-0${index + 1}T11:00:00.000Z`,
        'Backup',
        null,
        'Created automatic workspace backup',
        JSON.stringify({ fileName: `workspace-${index}.tar.gz`, frequency: 'daily' }),
      )
    }
    insert.run(
      'manual_checkpoint',
      '2026-08-03T12:00:00.000Z',
      'Backup',
      'user_1',
      'Created backup checkpoint for Example University',
      JSON.stringify({ applicationId: 'app_1', fileName: 'manual.json' }),
    )

    expect(compactLegacyAutomaticBackupEvents(database)).toEqual({
      skipped: false,
      groups: 2,
      compactedRows: 3,
    })
    const rows = database.prepare('SELECT * FROM system_events ORDER BY time').all()
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.id === 'manual_checkpoint')).toBeTruthy()
    const applicationRollup = rows.find((row) => row.message.includes('automatic backup for'))
    expect(applicationRollup.id).toMatch(/^event_auto_backup_[a-f0-9]{40}$/)
    expect(JSON.parse(applicationRollup.metadata_json)).toMatchObject({
      applicationId: 'app_1',
      fileName: '2.json',
      occurrences: 3,
      firstCreatedAt: '2026-08-01T10:00:00.000Z',
      lastCreatedAt: '2026-08-03T10:00:00.000Z',
    })
    expect(JSON.parse(rows.find((row) => row.message === 'Created automatic workspace backup').metadata_json))
      .toMatchObject({ occurrences: 2, fileName: 'workspace-1.tar.gz' })
    expect(database.prepare("SELECT revision FROM workspace_revision WHERE id = 'workspace'").get().revision)
      .toBe(8)
    expect(compactLegacyAutomaticBackupEvents(database)).toEqual({
      skipped: true,
      groups: 2,
      compactedRows: 3,
    })
    database.close()
  })
})

describe('bounded system-event maintenance', () => {
  it('enforces the exact cross-process hard cap without a COUNT scan per insert', () => {
    const database = createEventDatabase()
    configureSystemEventMaintenance(database, { hardLimit: 10_000 })
    const insert = database.prepare(
      `INSERT INTO system_events (id, time, scope, actor_id, message, metadata_json)
       VALUES (?, ?, 'Test', NULL, 'event', '{}')`,
    )
    database.transaction(() => {
      for (let index = 0; index < 10_025; index += 1) {
        insert.run(`event_${String(index).padStart(5, '0')}`, `2026-08-02T00:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.${String(index).padStart(5, '0')}Z`)
      }
    }).immediate()

    expect(readMaintainedSystemEventCount(database)).toBe(10_000)
    expect(database.prepare('SELECT COUNT(*) AS count FROM system_events').get().count).toBe(10_000)
    expect(database.prepare("SELECT 1 FROM system_events WHERE id = 'event_00000'").get()).toBeUndefined()
    expect(database.prepare("SELECT 1 FROM system_events WHERE id = 'event_10024'").get()).toBeTruthy()
    database.close()
  })
})

describe('storage query indexes', () => {
  it('removes audit temp sorts and covers long-running notification/team lookups', () => {
    const database = createEventDatabase()
    database.exec(`
      CREATE TABLE profile_assets (id TEXT PRIMARY KEY, owner_id TEXT, updated_at TEXT);
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, archived_at TEXT,
        read_at TEXT, emailed_at TEXT, push_enqueued_at TEXT
      );
      CREATE TABLE notification_groups (
        id TEXT PRIMARY KEY, scope TEXT, owner_id TEXT, team_id TEXT, updated_at TEXT
      );
      CREATE TABLE teams (id TEXT PRIMARY KEY, owner_id TEXT);
      CREATE TABLE team_members (
        id TEXT PRIMARY KEY, team_id TEXT, user_id TEXT, status TEXT, role TEXT,
        invited_email TEXT
      );
      CREATE TABLE school_logo_cache (cache_key TEXT PRIMARY KEY, updated_at TEXT);
      CREATE INDEX idx_team_members_user ON team_members(user_id);
      CREATE INDEX idx_notifications_pending_push ON notifications(push_enqueued_at, created_at);
      CREATE INDEX idx_notification_groups_scope_owner ON notification_groups(scope, owner_id);
      CREATE INDEX idx_notification_groups_team ON notification_groups(team_id);
    `)
    installStoragePerformanceIndexes(database)

    const latestPlan = database.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM system_events ORDER BY time DESC, id DESC LIMIT 100',
    ).all().map((row) => row.detail).join(' ')
    const scopePlan = database.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM system_events WHERE scope = 'Security' ORDER BY time DESC, id DESC LIMIT 100",
    ).all().map((row) => row.detail).join(' ')
    const unreadPlan = database.prepare(
      "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM notifications WHERE user_id = 'user_1' AND read_at IS NULL AND archived_at IS NULL",
    ).all().map((row) => row.detail).join(' ')

    expect(latestPlan).toContain('idx_system_events_time_id')
    expect(latestPlan).not.toContain('TEMP B-TREE')
    expect(scopePlan).toContain('idx_system_events_scope_time_id')
    expect(scopePlan).not.toContain('TEMP B-TREE')
    expect(unreadPlan).toContain('idx_notifications_unread_user')
    expect(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_team_members_user'").get())
      .toBeUndefined()
    database.close()
  })
})
