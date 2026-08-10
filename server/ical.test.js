import { describe, expect, it } from 'vitest'
import { generateIcalFeed, IcalFeedLimitError } from './ical.js'

const application = (overrides = {}) => ({
  id: 'app-1',
  deadline: '2027-01-15',
  school: { name: 'Example, University; Lab' },
  program: 'Materials\nScience',
  professor: { english: 'Professor Example' },
  status: 'Preparing',
  tasks: [],
  ...overrides,
})

describe('bounded iCalendar feeds', () => {
  it('creates a valid UTF-8 calendar and escapes user-authored fields', () => {
    const feed = generateIcalFeed([application()], '研究者, Example')

    expect(feed.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(feed).toContain('X-WR-CALNAME:PhD Atlas - 研究者\\, Example')
    expect(feed).toContain('SUMMARY:[DL] Example\\, University\\; Lab')
    expect(feed).toContain('Program: Materials\\nScience')
    expect(feed.endsWith('END:VCALENDAR')).toBe(true)
  })

  it('rejects feeds that exceed the caller event bound', () => {
    expect(() => generateIcalFeed([
      application({
        tasks: [{ id: 'task-1', title: 'Follow up', due: '2027-01-10', done: false }],
      }),
    ], 'Example', { maxEvents: 1 })).toThrow(IcalFeedLimitError)
  })

  it('rejects feeds before they exceed the byte transfer bound', () => {
    const applications = Array.from({ length: 8 }, (_, index) => application({
      id: `app-${index}`,
      program: `Program ${index} ${'x'.repeat(1_024)}`,
    }))
    expect(() => generateIcalFeed(applications, 'Example', { maxBytes: 1_024 }))
      .toThrow(expect.objectContaining({
        code: 'CALENDAR_FEED_TOO_LARGE',
        status: 413,
      }))
  })

  it('caps individual text fields while retaining every safe event', () => {
    const feed = generateIcalFeed([application({
      school: { name: '学'.repeat(2_000) },
      program: 'p'.repeat(8_000),
    })], 'u'.repeat(2_000))

    expect(Buffer.byteLength(feed, 'utf8')).toBeLessThan(8 * 1_024)
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(feed).toContain('…')
  })
})
