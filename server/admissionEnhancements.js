/**
 * Admission evidence observations and saved-record helpers.
 *
 * Lookup observations measure freshness and source changes. Decision-year
 * evidence comes from the dated verified records in the saved report; these
 * two timelines must never be presented as the same thing.
 */

import { randomUUID } from 'node:crypto'

/**
 * Save one lookup observation. This tracks freshness/change over time; it is
 * not an admissions-cycle data point.
 */
export function saveAdmissionHistorySnapshot(db, userId, applicationId, report) {
  const now = new Date().toISOString()
  const queryDate = now.split('T')[0] // YYYY-MM-DD

  const outcomes = report?.outcomes?.summary || {}
  const advisor = report?.advisor?.funding || {}

  const row = {
    id: randomUUID(),
    user_id: userId,
    application_id: applicationId,
    query_date: queryDate,
    accepted_count: outcomes.accepted || 0,
    rejected_count: outcomes.rejected || 0,
    waitlisted_count: outcomes.waitlisted || 0,
    interview_count: outcomes.interview || 0,
    total_count: outcomes.total || 0,
    accepted_share: outcomes.acceptedShare ?? null,
    has_public_award: advisor.hasPublicAward ? 1 : 0,
    award_count: advisor.awardCount || 0,
    program_name: report?.target?.program || report?.outcomes?.query?.program || null,
    school_name: report?.target?.school || report?.outcomes?.query?.school || null,
    advisor_name: report?.target?.advisorName || report?.advisor?.query?.name || null,
    created_at: now,
  }

  db.prepare(`
    INSERT INTO admission_signal_history (
      id, user_id, application_id, query_date,
      accepted_count, rejected_count, waitlisted_count, interview_count,
      total_count, accepted_share, has_public_award, award_count,
      program_name, school_name, advisor_name, created_at
    ) VALUES (
      @id, @user_id, @application_id, @query_date,
      @accepted_count, @rejected_count, @waitlisted_count, @interview_count,
      @total_count, @accepted_share, @has_public_award, @award_count,
      @program_name, @school_name, @advisor_name, @created_at
    )
    ON CONFLICT(user_id, application_id, query_date) DO UPDATE SET
      accepted_count = @accepted_count,
      rejected_count = @rejected_count,
      waitlisted_count = @waitlisted_count,
      interview_count = @interview_count,
      total_count = @total_count,
      accepted_share = @accepted_share,
      has_public_award = @has_public_award,
      award_count = @award_count,
      program_name = @program_name,
      school_name = @school_name,
      advisor_name = @advisor_name
  `).run(row)
}

/**
 * Return lookup observations. `observedAt` is intentionally explicit so a
 * client cannot mistake the query date for an admissions year.
 */
export function getAdmissionHistoryTrend(db, userId, applicationId, limit = 10) {
  const rows = db
    .prepare(`
      SELECT
        query_date as observedAt,
        accepted_count as accepted,
        total_count as total,
        accepted_share as acceptedShare,
        has_public_award as hasPublicAward,
        award_count as awardCount
      FROM admission_signal_history
      WHERE user_id = ? AND application_id = ?
      ORDER BY query_date DESC
      LIMIT ?
    `)
    .all(userId, applicationId, limit)

  return rows.map(row => ({
    ...row,
    hasPublicAward: Boolean(row.hasPublicAward),
  }))
}

/**
 * 批量查询多个应用的招生数据（用于对比）
 */
export function getAdmissionReportsForComparison(db, userId, applicationIds) {
  if (!applicationIds || applicationIds.length === 0) return []

  const placeholders = applicationIds.map(() => '?').join(',')
  const rows = db
    .prepare(`
      SELECT
        application_id as applicationId,
        payload_json as payloadJson
      FROM admission_signal_reports
      WHERE user_id = ? AND application_id IN (${placeholders})
    `)
    .all(userId, ...applicationIds)

  return rows.map(row => ({
    applicationId: row.applicationId,
    report: JSON.parse(row.payloadJson),
  }))
}

/**
 * 收藏管理
 */
export function createAdmissionBookmark(db, userId, applicationId, bookmark) {
  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    user_id: userId,
    application_id: applicationId,
    bookmark_type: bookmark.type,
    title: bookmark.title,
    data_json: JSON.stringify(bookmark.data),
    note: bookmark.note || null,
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO admission_bookmarks (
      id, user_id, application_id, bookmark_type, title, data_json, note, created_at, updated_at
    ) VALUES (
      @id, @user_id, @application_id, @bookmark_type, @title, @data_json, @note, @created_at, @updated_at
    )
  `).run(row)

  return row.id
}

export function getAdmissionBookmarks(db, userId, applicationId = null) {
  const query = applicationId
    ? 'SELECT * FROM admission_bookmarks WHERE user_id = ? AND application_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM admission_bookmarks WHERE user_id = ? ORDER BY created_at DESC'

  const params = applicationId ? [userId, applicationId] : [userId]
  const rows = db.prepare(query).all(...params)

  return rows.map(row => ({
    id: row.id,
    applicationId: row.application_id,
    type: row.bookmark_type,
    title: row.title,
    data: JSON.parse(row.data_json),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function updateAdmissionBookmarkNote(db, userId, bookmarkId, note) {
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE admission_bookmarks
    SET note = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(note, now, bookmarkId, userId)
}

export function deleteAdmissionBookmark(db, userId, bookmarkId) {
  db.prepare('DELETE FROM admission_bookmarks WHERE id = ? AND user_id = ?')
    .run(bookmarkId, userId)
}

/**
 * 通知设置
 */
export function getAdmissionNotificationSettings(db, userId) {
  const row = db
    .prepare('SELECT * FROM admission_notification_settings WHERE user_id = ?')
    .get(userId)

  if (!row) return null

  return {
    enabled: Boolean(row.enabled),
    emailEnabled: Boolean(row.email_enabled),
    desktopEnabled: Boolean(row.desktop_enabled),
    lastCheckAt: row.last_check_at,
  }
}

export function updateAdmissionNotificationSettings(db, userId, settings) {
  const now = new Date().toISOString()

  const existing = db
    .prepare('SELECT user_id FROM admission_notification_settings WHERE user_id = ?')
    .get(userId)

  if (existing) {
    db.prepare(`
      UPDATE admission_notification_settings
      SET enabled = ?, email_enabled = ?, desktop_enabled = ?, updated_at = ?
      WHERE user_id = ?
    `).run(
      settings.enabled ? 1 : 0,
      settings.emailEnabled ? 1 : 0,
      settings.desktopEnabled ? 1 : 0,
      now,
      userId
    )
  } else {
    db.prepare(`
      INSERT INTO admission_notification_settings (
        user_id, enabled, email_enabled, desktop_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      settings.enabled ? 1 : 0,
      settings.emailEnabled ? 1 : 0,
      settings.desktopEnabled ? 1 : 0,
      now,
      now
    )
  }
}
