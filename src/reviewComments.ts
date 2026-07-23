import type { ReviewComment } from './data/applications'

export function reviewRepliesFor(
  comments: readonly ReviewComment[] | undefined,
  parent: ReviewComment,
): ReviewComment[] {
  const replies: ReviewComment[] = []
  const seen = new Set<string>()
  const add = (comment: ReviewComment) => {
    if (seen.has(comment.id)) return
    seen.add(comment.id)
    replies.push(comment)
  }

  parent.replies?.forEach(add)
  comments?.forEach((comment) => {
    if (comment.parentId === parent.id) add(comment)
  })
  return replies
}

export function countReviewComments(comments: readonly ReviewComment[] | undefined): number {
  const seen = new Set<string>()
  const visit = (comment: ReviewComment) => {
    if (seen.has(comment.id)) return
    seen.add(comment.id)
    comment.replies?.forEach(visit)
  }
  comments?.forEach(visit)
  return seen.size
}

export function appendReviewComment(
  comments: readonly ReviewComment[] | undefined,
  comment: ReviewComment,
  parentId?: string,
): ReviewComment[] {
  const current = comments ?? []
  if (!parentId) return [...current, comment]

  let parentFound = false
  const next = current.map((item) => {
    if (item.id !== parentId) return item
    parentFound = true
    const replies = item.replies ?? []
    if (replies.some((reply) => reply.id === comment.id)) return item
    return { ...item, replies: [...replies, comment] }
  })
  return parentFound ? next : [...current, comment]
}
