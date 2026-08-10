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

  it('emits one stable overdue reminder after a restart that crossed the deadline', () => {
    const [candidate] = evaluateNotificationsForUser([{
      id: 'app_overdue',
      school: { name: 'Oxford' },
      program: 'DPhil',
      status: 'Draft',
      deadline: '2026-07-27',
      tasks: [],
      materials: [],
    }], '2026-07-29')

    expect(candidate).toMatchObject({
      type: 'deadline_passed',
      triggerDate: '2026-07-27',
      targetTab: 'dossier',
    })
    expect(evaluateNotificationsForUser([{
      id: 'app_overdue',
      school: { name: 'Oxford' },
      program: 'DPhil',
      status: 'Draft',
      deadline: '2026-07-27',
      tasks: [],
      materials: [],
    }], '2026-07-30')[0].dedupeKey).toBe(candidate.dedupeKey)
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

describe('recommender reminders', () => {
  function applicationWithRecommenders(recommenders, materialPatch = {}) {
    return {
      id: 'app_recommenders',
      school: { name: 'Cambridge' },
      program: 'Computer Science PhD',
      status: 'Draft',
      deadline: '',
      tasks: [],
      recommenders,
      materials: [{
        id: 'material_letters',
        name: 'Recommendation letters',
        reminderEnabled: false,
        reminderDate: '',
        ...materialPatch,
      }],
    }
  }

  it('fires a due recommender reminder and targets the application dossier', () => {
    const [candidate] = evaluateNotificationsForUser([
      applicationWithRecommenders([{
        id: 'recommender_ada',
        name: 'Prof. Ada Lovelace',
        contact: 'ada@example.edu',
        reminderDate: '2026-08-01',
        reminderTime: '09:30',
      }]),
    ], '2026-08-01')

    expect(candidate).toMatchObject({
      type: 'material_reminder',
      triggerDate: '2026-08-01',
      title: 'Recommender reminder: Prof. Ada Lovelace',
      body: 'Reminder for "Prof. Ada Lovelace" (Cambridge) — due 2026-08-01.',
      targetTab: 'dossier',
      targetId: 'application-recommenders',
      metadata: {
        recommenderId: 'recommender_ada',
        reminderTime: '09:30',
      },
    })
  })

  it('ignores future, invalid, and identity-less recommender rows', () => {
    const candidates = evaluateNotificationsForUser([
      applicationWithRecommenders([
        {
          id: 'future',
          name: 'Future Professor',
          contact: 'future@example.edu',
          reminderDate: '2026-08-02',
        },
        {
          id: 'invalid',
          name: 'Invalid Date',
          contact: 'invalid@example.edu',
          reminderDate: '2026-02-30',
        },
        {
          id: 'blank',
          name: '',
          contact: '',
          reminderDate: '2026-08-01',
        },
        {
          id: 'default-empty',
          name: '',
          contact: '',
          reminderDate: '',
        },
      ]),
    ], '2026-08-01')

    expect(candidates).toEqual([])
  })

  it('keeps the dedupe key stable after the reminder date and separate from a material reminder', () => {
    const application = applicationWithRecommenders([{
      id: 'recommender_stable',
      name: 'Prof. Stable',
      contact: 'stable@example.edu',
      reminderDate: '2026-07-30',
      reminderTime: '14:00',
    }], {
      reminderEnabled: true,
      reminderDate: '2026-07-30',
    })

    const first = evaluateNotificationsForUser([application], '2026-08-01')
    const restarted = evaluateNotificationsForUser([application], '2026-08-02')
    const recommenderCandidate = first.find((candidate) => candidate.metadata?.recommenderId === 'recommender_stable')
    const restartedCandidate = restarted.find((candidate) => candidate.metadata?.recommenderId === 'recommender_stable')
    const materialCandidate = first.find((candidate) => !candidate.metadata?.recommenderId)

    expect(restartedCandidate?.dedupeKey).toBe(recommenderCandidate?.dedupeKey)
    expect(recommenderCandidate?.dedupeKey).not.toBe(materialCandidate?.dedupeKey)
  })

  it('creates distinct candidates for distinct recommenders on the same date', () => {
    const candidates = evaluateNotificationsForUser([
      applicationWithRecommenders([
        {
          id: 'recommender_one',
          name: 'Professor One',
          contact: 'one@example.edu',
          reminderDate: '2026-08-01',
        },
        {
          id: 'recommender_two',
          name: 'Professor Two',
          contact: 'two@example.edu',
          reminderDate: '2026-08-01',
        },
      ]),
    ], '2026-08-01')

    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map((candidate) => candidate.dedupeKey)).size).toBe(2)
    expect(candidates.map((candidate) => candidate.metadata.recommenderId)).toEqual([
      'recommender_one',
      'recommender_two',
    ])
  })

  it('uses a safe application-level fallback when a populated recommender has no display name', () => {
    const [candidate] = evaluateNotificationsForUser([
      applicationWithRecommenders([{
        id: 'recommender_email_only',
        name: '',
        contact: 'unknown@example.edu',
        reminderDate: '2026-08-01',
      }]),
    ], '2026-08-01')

    expect(candidate.title).toBe('Recommender reminder: Unnamed recommender')
  })
})
