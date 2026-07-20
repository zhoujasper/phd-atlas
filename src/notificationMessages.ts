import type { NotificationRecord } from './api/phdApi'

type Tx = (path: string, fallback?: string) => string
type Format = (template: string, values: Record<string, string | number>) => string

function notificationKey(key: string) {
  return `notifications.item.${key}`
}

function localizeTaskDue(item: NotificationRecord, tx: Tx, format: Format) {
  const titleMatch = /^Task due: (.+)$/.exec(item.title)
  const bodyMatch = /^"(.+)" for (.+) is due (\d{4}-\d{2}-\d{2})\.$/.exec(item.body)
  const title = titleMatch?.[1] ?? bodyMatch?.[1]
  if (!title) return null
  return {
    title: format(tx(notificationKey('taskDueTitle')), { title }),
    body: bodyMatch
      ? format(tx(notificationKey('taskDueBody')), {
          title: bodyMatch[1] ?? title,
          school: bodyMatch[2] ?? '',
          due: bodyMatch[3] ?? item.triggerDate,
        })
      : item.body,
  }
}

function localizeMaterialReminder(item: NotificationRecord, tx: Tx, format: Format) {
  const titleMatch = /^Material reminder: (.+)$/.exec(item.title)
  const bodyMatch = /^Reminder for "(.+)" \((.+)\) [—-] due (\d{4}-\d{2}-\d{2})\.$/.exec(item.body)
  const name = titleMatch?.[1] ?? bodyMatch?.[1]
  if (!name) return null
  return {
    title: format(tx(notificationKey('materialReminderTitle')), { name }),
    body: bodyMatch
      ? format(tx(notificationKey('materialReminderBody')), {
          name: bodyMatch[1] ?? name,
          school: bodyMatch[2] ?? '',
          due: bodyMatch[3] ?? item.triggerDate,
        })
      : item.body,
  }
}

function localizeDeadline(item: NotificationRecord, tx: Tx, format: Format) {
  const titleMatch = /^Deadline approaching: (.+)$/.exec(item.title)
  const bodyMatch = /^(.+) deadline is (\d{4}-\d{2}-\d{2}) \((\d+) days? away\)\.$/.exec(item.body)
  const school = titleMatch?.[1]
  if (!school) return null
  const count = Number(bodyMatch?.[3] ?? 0)
  return {
    title: format(tx(notificationKey('deadlineApproachingTitle')), { school }),
    body: bodyMatch
      ? format(tx(notificationKey(count === 1 ? 'deadlineApproachingBodyOne' : 'deadlineApproachingBody')), {
          program: bodyMatch[1] ?? '',
          deadline: bodyMatch[2] ?? item.triggerDate,
          count,
        })
      : item.body,
  }
}

function localizeNewEmail(item: NotificationRecord, tx: Tx, format: Format) {
  const direction = item.metadata?.direction
  const outgoingTitleMatch = /^Sent email to (.+) imported$/.exec(item.title)
  const outgoingBodyMatch = /^"(.+?)" sent from your mailbox was imported into (.+) correspondence\.$/.exec(item.body)
  if (direction === 'outgoing' || outgoingTitleMatch) {
    const recipient = outgoingTitleMatch?.[1]
      ?? (typeof item.metadata?.recipientName === 'string' ? item.metadata.recipientName : null)
      ?? (typeof item.metadata?.recipient === 'string' ? item.metadata.recipient : '')
    if (!recipient) return null
    const school = outgoingBodyMatch?.[2] === 'your'
      ? tx(notificationKey('yourApplication'))
      : outgoingBodyMatch?.[2]
    return {
      title: format(tx(notificationKey('sentEmailImportedTitle')), { recipient }),
      body: outgoingBodyMatch
        ? format(tx(notificationKey('sentEmailImportedBody')), {
            subject: outgoingBodyMatch[1] ?? '',
            school: school ?? tx(notificationKey('yourApplication')),
          })
        : item.body,
    }
  }

  const titleMatch = /^New email from (.+)$/.exec(item.title)
  const bodyMatch = /^"(.+)" was imported into (.+) correspondence\.$/.exec(item.body)
  const sender = titleMatch?.[1]
  if (!sender) return null
  const school = bodyMatch?.[2] === 'your' ? tx(notificationKey('yourApplication')) : bodyMatch?.[2]
  return {
    title: format(tx(notificationKey('newEmailImportedTitle')), { sender }),
    body: bodyMatch
      ? format(tx(notificationKey('newEmailImportedBody')), {
          subject: bodyMatch[1] ?? '',
          school: school ?? tx(notificationKey('yourApplication')),
        })
      : item.body,
  }
}

function localizeDiscoverMatch(item: NotificationRecord, tx: Tx, format: Format) {
  const school =
    (typeof item.metadata?.school === 'string' && item.metadata.school)
    || /^New program match: (.+)$/.exec(item.title)?.[1]
    || ''
  if (!school) return null
  const program =
    (typeof item.metadata?.program === 'string' && item.metadata.program)
    || ''
  return {
    title: format(tx(notificationKey('discoverMatchTitle'), 'New program match: {school}'), { school }),
    body: program
      ? format(tx(notificationKey('discoverMatchBody'), '{program} looks like a strong fit for your Discover criteria.'), { program, school })
      : item.body,
  }
}

function localizeDiscoverDeadline(item: NotificationRecord, tx: Tx, format: Format) {
  const school =
    (typeof item.metadata?.school === 'string' && item.metadata.school)
    || /^Watched program deadline: (.+)$/.exec(item.title)?.[1]
    || ''
  if (!school) return null
  const deadline =
    (typeof item.metadata?.deadline === 'string' && item.metadata.deadline)
    || item.triggerDate
  return {
    title: format(tx(notificationKey('discoverDeadlineTitle'), 'Watched program deadline: {school}'), { school }),
    body: format(tx(notificationKey('discoverDeadlineBody'), 'Typical cycle deadline {deadline} is approaching (verify officially).'), {
      school,
      deadline,
    }),
  }
}

export function notificationDisplayText(item: NotificationRecord, tx: Tx, format: Format) {
  const localized =
    item.type === 'task_due'
      ? localizeTaskDue(item, tx, format)
      : item.type === 'material_reminder'
        ? localizeMaterialReminder(item, tx, format)
        : item.type === 'deadline_approaching'
          ? localizeDeadline(item, tx, format)
          : item.type === 'new_email_imported'
            ? localizeNewEmail(item, tx, format)
            : item.type === 'discover_match'
              ? localizeDiscoverMatch(item, tx, format)
              : item.type === 'discover_deadline'
                ? localizeDiscoverDeadline(item, tx, format)
                : null

  return localized ?? { title: item.title, body: item.body }
}
