import { describe, expect, it } from 'vitest'
import {
  MAX_APPLICATION_CORRESPONDENCE_EMAILS,
  additionalCorrespondenceEmails,
  applicationCorrespondenceEmails,
  isValidCorrespondenceEmail,
  normalizeCorrespondenceEmail,
} from './correspondenceRecipients'

describe('application correspondence recipients', () => {
  it('normalizes, deduplicates, and keeps the primary address first', () => {
    expect(applicationCorrespondenceEmails({
      email: 'Professor@Example.edu',
      correspondenceEmails: [
        'lab@example.edu',
        'PROFESSOR@example.edu',
        'Lab@example.edu',
      ],
    })).toEqual([
      'professor@example.edu',
      'lab@example.edu',
    ])
  })

  it('extracts a temporary address from display-name mail syntax', () => {
    expect(normalizeCorrespondenceEmail('Professor Lee <lee@example.edu>')).toBe('lee@example.edu')
    expect(isValidCorrespondenceEmail('lee@example.edu')).toBe(true)
    expect(isValidCorrespondenceEmail('lee@example')).toBe(false)
  })

  it('bounds additional exact-match addresses below the total application limit', () => {
    const additional = additionalCorrespondenceEmails(
      'primary@example.edu',
      Array.from(
        { length: MAX_APPLICATION_CORRESPONDENCE_EMAILS + 3 },
        (_, index) => `recipient-${index}@example.edu`,
      ),
    )

    expect(additional).toHaveLength(MAX_APPLICATION_CORRESPONDENCE_EMAILS - 1)
    expect(additional).not.toContain('primary@example.edu')
  })
})
