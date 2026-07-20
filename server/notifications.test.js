import { describe, expect, it } from 'vitest'
import { evaluateNotificationsForUser, localizeNotificationCandidate } from './notifications.js'

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
})
