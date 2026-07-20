import { describe, expect, it } from 'vitest'
import type { NotificationRecord } from './api/phdApi'
import { t, tpl } from './i18n'
import { notificationDisplayText } from './notificationMessages'

const baseNotification: NotificationRecord = {
  id: 'notif_test',
  type: 'task_due',
  applicationId: 'app_test',
  title: 'Task due: Submit statement',
  body: '"Submit statement" for MIT is due 2026-07-12.',
  triggerDate: '2026-07-12',
  createdAt: '2026-07-01T00:00:00.000Z',
  readAt: null,
  emailedAt: null,
}

const tx = (path: string, fallback?: string) => t('zh', path, fallback)

describe('notificationDisplayText', () => {
  it('localizes stored English task reminders for Chinese users', () => {
    expect(notificationDisplayText(baseNotification, tx, tpl)).toEqual({
      title: '任务到期：Submit statement',
      body: '“Submit statement”（MIT）截止日期为 2026-07-12。',
    })
  })

  it('localizes externally sent email import notifications', () => {
    expect(notificationDisplayText({
      ...baseNotification,
      type: 'new_email_imported',
      title: 'Sent email to Professor Lee imported',
      body: '"Proposal" sent from your mailbox was imported into Stanford correspondence.',
      metadata: { direction: 'outgoing', recipient: 'Professor Lee' },
    }, tx, tpl)).toEqual({
      title: '已导入发送给 Professor Lee 的邮件',
      body: '从你的邮箱发送的“Proposal”已导入Stanford的往来消息。',
    })
  })
})
