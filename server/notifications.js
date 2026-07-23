import { createHash } from 'node:crypto'

const FINAL_STATUSES = new Set(['Accepted', 'Rejected'])
const DEADLINE_WINDOW_DAYS = 30

function dedupeKey(type, entityId, triggerDate) {
  return createHash('sha1').update(`${type}:${entityId}:${triggerDate}`).digest('hex').slice(0, 32)
}

function daysBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00`).getTime()
  const to = new Date(`${toIso}T00:00:00`).getTime()
  return Math.round((to - from) / 86_400_000)
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Matches the fixed vocabulary produced by the task reminder UI: 'same-day' | '1d' | '3d' | '7d'. */
function offsetToDays(offset) {
  if (offset === 'same-day') return 0
  const match = /^(\d+)d$/.exec(String(offset ?? ''))
  return match ? Number(match[1]) : null
}

/**
 * Walks every application's tasks/materials/deadline and returns notification
 * candidates whose trigger date has arrived. Pure function — callers persist via
 * insertNotificationIfNew, which is what actually prevents duplicate/repeat firing.
 */
export function evaluateNotificationsForUser(applications, todayStr) {
  const candidates = []

  for (const application of applications) {
    const schoolName = application.school?.name ?? ''

    for (const task of application.tasks ?? []) {
      if (task.done || !task.reminderEnabled) continue
      for (const offset of task.reminderOffsets ?? []) {
        const offsetDays = offsetToDays(offset)
        if (offsetDays === null) continue
        const triggerDate = addDays(task.due, -offsetDays)
        if (triggerDate > todayStr) continue
        candidates.push({
          type: 'task_due',
          applicationId: application.id,
          // Distinct offsets on the same task are independent reminders (Apple-Calendar-style "remind me twice").
          dedupeKey: dedupeKey('task_due', `${task.id}:${offset}`, task.due),
          triggerDate,
          title: `Task due: ${task.title}`,
          body: `"${task.title}" for ${schoolName} is due ${task.due}.`,
          titleZh: `任务到期：${task.title}`,
          bodyZh: `“${task.title}”（${schoolName}）截止日期为 ${task.due}。`,
          targetPath: `/applications/${encodeURIComponent(application.id)}/materials`,
          targetTab: 'materials',
          targetId: `task-${task.id}`,
          metadata: { taskId: task.id },
        })
      }
    }

    for (const material of application.materials ?? []) {
      if (!material.reminderEnabled || !material.reminderDate) continue
      if (material.reminderDate > todayStr) continue
      candidates.push({
        type: 'material_reminder',
        applicationId: application.id,
        dedupeKey: dedupeKey('material_reminder', material.id, material.reminderDate),
        triggerDate: material.reminderDate,
        title: `Material reminder: ${material.name}`,
        body: `Reminder for "${material.name}" (${schoolName}) — due ${material.reminderDate}.`,
        titleZh: `材料提醒：${material.name}`,
        bodyZh: `“${material.name}”（${schoolName}）提醒日期为 ${material.reminderDate}。`,
        targetPath: `/applications/${encodeURIComponent(application.id)}/materials`,
        targetTab: 'materials',
        targetId: `material-${material.id}`,
        metadata: { materialId: material.id },
      })
    }

    if (!FINAL_STATUSES.has(application.status) && application.deadline) {
      const remaining = daysBetween(todayStr, application.deadline)
      if (remaining >= 0 && remaining <= DEADLINE_WINDOW_DAYS) {
        candidates.push({
          type: 'deadline_approaching',
          applicationId: application.id,
          dedupeKey: dedupeKey('deadline_approaching', application.id + ':' + remaining, application.deadline),
          triggerDate: application.deadline,
          title: `Deadline approaching: ${schoolName}`,
          body: `${application.program} deadline is ${application.deadline} (${remaining} day${remaining === 1 ? '' : 's'} away).`,
          titleZh: `截止日期临近：${schoolName}`,
          bodyZh: `${application.program} 的截止日期是 ${application.deadline}（还有 ${remaining} 天）。`,
          targetPath: `/applications/${encodeURIComponent(application.id)}/dossier`,
          targetTab: 'dossier',
          targetId: 'dossier-config-card',
        })
      }
    }
  }

  return candidates
}

/** A notification is emailed only if the user has at least one verified, notify-enabled receive address. */
export function shouldEmailNotifications(user) {
  return user.settings?.emailNotificationsEnabled !== false
    && (user.settings?.receiveEmails ?? []).some((email) => email.notify && email.verified)
}

export function localizeNotificationCandidate(candidate, lang = 'en') {
  if (lang !== 'zh') return candidate
  return {
    ...candidate,
    title: candidate.titleZh ?? candidate.title,
    body: candidate.bodyZh ?? candidate.body,
  }
}
