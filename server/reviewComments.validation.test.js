import { describe, expect, it } from 'vitest'
import { ReviewCommentSchema } from './validation.js'

describe('ReviewCommentSchema', () => {
  it('preserves nested team replies and nullable root parent ids', () => {
    const parsed = ReviewCommentSchema.parse({
      id: 'review-parent',
      authorId: 'teacher-1',
      authorName: 'Advisor',
      body: 'Please clarify this section.',
      createdAt: '2026-07-23T08:00:00.000Z',
      parentId: null,
      replies: [{
        id: 'review-reply',
        authorId: 'student-1',
        authorName: 'Student',
        body: 'Updated — thank you.',
        createdAt: '2026-07-23T09:00:00.000Z',
        parentId: 'review-parent',
      }],
    })

    expect(parsed.parentId).toBeNull()
    expect(parsed.replies).toHaveLength(1)
    expect(parsed.replies[0].parentId).toBe('review-parent')
  })
})
