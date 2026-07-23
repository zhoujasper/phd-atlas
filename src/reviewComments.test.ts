import { describe, expect, it } from 'vitest'
import type { ReviewComment } from './data/applications'
import { appendReviewComment, countReviewComments, reviewRepliesFor } from './reviewComments'

const parent: ReviewComment = {
  id: 'comment-parent',
  authorId: 'teacher-1',
  authorName: 'Advisor',
  body: 'Please clarify the research fit.',
  createdAt: '2026-07-23T08:00:00.000Z',
}

const reply: ReviewComment = {
  id: 'comment-reply',
  authorId: 'student-1',
  authorName: 'Student',
  body: 'I added a concrete project example.',
  createdAt: '2026-07-23T09:00:00.000Z',
  parentId: parent.id,
}

describe('review comment threads', () => {
  it('appends replies under their parent without changing top-level ordering', () => {
    const comments = appendReviewComment([parent], reply, parent.id)

    expect(comments).toHaveLength(1)
    expect(comments[0].replies).toEqual([reply])
  })

  it('counts nested and legacy flat replies once', () => {
    const nestedParent = { ...parent, replies: [reply] }
    expect(countReviewComments([nestedParent, reply])).toBe(2)
    expect(reviewRepliesFor([nestedParent, reply], nestedParent)).toEqual([reply])
  })
})
