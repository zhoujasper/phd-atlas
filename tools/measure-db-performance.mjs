#!/usr/bin/env node
import Database from 'better-sqlite3'
import { installStoragePerformanceIndexes } from '../server/storagePerformance.js'

function setupTestDatabase() {
  const db = new Database(':memory:')

  // Create essential schema for performance testing
  db.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspace_revision (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    INSERT INTO workspace_revision (id, revision) VALUES ('workspace', 1);

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE system_events (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE INDEX idx_system_events_time ON system_events(time DESC);

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      archived_at TEXT,
      emailed_at TEXT,
      push_enqueued_at TEXT
    );

    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_email TEXT
    );

    CREATE TABLE notification_groups (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      owner_id TEXT,
      team_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE profile_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE school_logo_cache (
      cache_key TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
    );
  `)

  installStoragePerformanceIndexes(db)
  return db
}

function seedTestData(db, userCount = 50, eventsPerUser = 100) {
  console.log(`Seeding ${userCount} users with ${eventsPerUser} events each...`)

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at)
    VALUES (?, ?, 'hash', ?)
  `)

  const insertEvent = db.prepare(`
    INSERT INTO system_events (id, time, scope, actor_id, message, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertNotification = db.prepare(`
    INSERT INTO notifications (id, user_id, created_at, read_at, archived_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const insertTeam = db.prepare(`
    INSERT INTO teams (id, owner_id, name, created_at)
    VALUES (?, ?, ?, ?)
  `)

  const insertTeamMember = db.prepare(`
    INSERT INTO team_members (id, team_id, user_id, status, role)
    VALUES (?, ?, ?, ?, ?)
  `)

  db.transaction(() => {
    for (let u = 0; u < userCount; u++) {
      const userId = `user_${u}`
      const timestamp = new Date(Date.now() - (userCount - u) * 86400000).toISOString()
      insertUser.run(userId, `user${u}@example.com`, timestamp)

      // Events
      for (let e = 0; e < eventsPerUser; e++) {
        const eventTime = new Date(Date.now() - (eventsPerUser - e) * 3600000).toISOString()
        insertEvent.run(
          `event_${u}_${e}`,
          eventTime,
          e % 10 === 0 ? 'Security' : 'Application',
          userId,
          `Event ${e} for user ${u}`,
          '{}'
        )
      }

      // Notifications
      for (let n = 0; n < 20; n++) {
        const notifTime = new Date(Date.now() - n * 7200000).toISOString()
        insertNotification.run(
          `notif_${u}_${n}`,
          userId,
          notifTime,
          n < 10 ? notifTime : null,
          n < 5 ? notifTime : null
        )
      }

      // Teams (1 per 5 users)
      if (u % 5 === 0) {
        const teamId = `team_${u}`
        insertTeam.run(teamId, userId, `Team ${u}`, timestamp)

        // Add 3 members to each team
        for (let m = 0; m < 3; m++) {
          const memberId = `user_${u + m + 1}`
          if (u + m + 1 < userCount) {
            insertTeamMember.run(
              `member_${u}_${m}`,
              teamId,
              memberId,
              'active',
              m === 0 ? 'admin' : 'member'
            )
          }
        }
      }
    }
  })()

  console.log('Seeding complete.')
}

function measureQuery(db, name, query, params = []) {
  const start = performance.now()
  const stmt = db.prepare(query)
  const result = params.length > 0 ? stmt.all(...params) : stmt.all()
  const duration = performance.now() - start

  const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params)
  const usesIndex = plan.some(row => row.detail && row.detail.includes('idx_'))
  const usesTemp = plan.some(row => row.detail && row.detail.includes('TEMP'))
  const scanType = plan[0]?.detail || 'UNKNOWN'

  return {
    name,
    durationMs: Math.round(duration * 100) / 100,
    rowCount: result.length,
    usesIndex,
    usesTemp,
    scanType,
    plan: plan.map(r => r.detail).join(' / ')
  }
}

function runPerformanceTests() {
  const db = setupTestDatabase()
  seedTestData(db, 50, 100)

  console.log('\n=== Query Performance Analysis ===\n')

  const queries = [
    {
      name: 'Latest 100 system events',
      query: 'SELECT * FROM system_events ORDER BY time DESC, id DESC LIMIT 100'
    },
    {
      name: 'Security events (filtered)',
      query: "SELECT * FROM system_events WHERE scope = 'Security' ORDER BY time DESC, id DESC LIMIT 100"
    },
    {
      name: 'Unread notifications count',
      query: "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL",
      params: ['user_10']
    },
    {
      name: 'User notifications (paginated)',
      query: "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      params: ['user_10']
    },
    {
      name: 'Team members lookup',
      query: "SELECT * FROM team_members WHERE team_id = ?",
      params: ['team_0']
    },
    {
      name: 'User team memberships',
      query: "SELECT tm.*, t.name FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE tm.user_id = ?",
      params: ['user_5']
    },
    {
      name: 'Recent events by actor',
      query: "SELECT * FROM system_events WHERE actor_id = ? ORDER BY time DESC LIMIT 50",
      params: ['user_25']
    }
  ]

  const results = queries.map(q => measureQuery(db, q.name, q.query, q.params || []))

  results.forEach(r => {
    console.log(`${r.name}:`)
    console.log(`  Duration: ${r.durationMs}ms`)
    console.log(`  Rows: ${r.rowCount}`)
    console.log(`  Uses Index: ${r.usesIndex ? '✓' : '✗'}`)
    console.log(`  Temp B-Tree: ${r.usesTemp ? '✗ (inefficient)' : '✓'}`)
    console.log(`  Plan: ${r.plan}`)
    console.log()
  })

  // Summary statistics
  const avgDuration = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length
  const indexedQueries = results.filter(r => r.usesIndex).length
  const tempQueries = results.filter(r => r.usesTemp).length

  console.log('=== Performance Summary ===')
  console.log(`Average query time: ${Math.round(avgDuration * 100) / 100}ms`)
  console.log(`Queries using indexes: ${indexedQueries}/${results.length}`)
  console.log(`Queries using temp tables: ${tempQueries}/${results.length}`)
  console.log(`Index efficiency: ${Math.round(indexedQueries / results.length * 100)}%`)

  db.close()

  return {
    avgDuration,
    indexedQueries,
    totalQueries: results.length,
    efficiency: indexedQueries / results.length
  }
}

runPerformanceTests()
