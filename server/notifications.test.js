import { describe, expect, it } from 'vitest'
import { evaluateNotificationsForUser, localizeNotificationCandidate, shouldEmailNotifications } from './notifications.js'
import { notificationDigestTemplate } from './index.js'

describe('notification localization', () => {
  it('stores reminder copy in the user language', () => {
    const [candidate] = evaluateNotificationsForUser([
      {
        id: 'app_test',
        school: { name: 'MIT' },
        professor: {},
        program: 'Computer Science PhD',
        status: 'Draft',
        deadline: '2026-08-01',
        tasks: [
          {
            id: 'task_test',
            title: 'Submit statement',
            due: '2026-07-12',
            done: false,
            reminderEnabled: true,
            reminderOffsets: ['same-day'],
          },
        ],
        materials: [],
      },
    ], '2026-07-12')

    expect(localizeNotificationCandidate(candidate, 'zh')).toMatchObject({
      title: '任务到期：Submit statement',
      body: '“Submit statement”（MIT）截止日期为 2026-07-12。',
    })
  })

  it('requires both the global email preference and a verified opted-in mailbox', () => {
    const user = {
      settings: {
        emailNotificationsEnabled: false,
        receiveEmails: [{ address: 'user@example.com', verified: true, notify: true }],
      },
    }
    expect(shouldEmailNotifications(user)).toBe(false)

    user.settings.emailNotificationsEnabled = true
    expect(shouldEmailNotifications(user)).toBe(true)

    user.settings.receiveEmails[0].notify = false
    expect(shouldEmailNotifications(user)).toBe(false)
  })

  it('builds one digest containing every notification instead of one message per event', () => {
    const digest = notificationDigestTemplate([
      { id: 'one', title: 'New professor email', body: 'Professor Chen replied.' },
      { id: 'two', title: 'Deadline approaching', body: 'Your application closes tomorrow.' },
    ])

    expect(digest.subject).toBe('PhD Atlas: 2 notifications')
    expect(digest.text).toContain('New professor email')
    expect(digest.text).toContain('Deadline approaching')
    expect(digest.html).toContain('Professor Chen replied.')
    expect(digest.html).toContain('Your application closes tomorrow.')
  })
})
