import { useState } from 'react'
import type { ApplicationRecord } from '../../data/applications'
import { phdApi } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { MarkdownContent } from '../shared/MarkdownContent'
import { MarkdownTextarea } from '../shared/MarkdownTextarea'

interface ReviewComment {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  targetTab?: string
  parentId?: string | null
  mentionedUserIds?: string[]
  replies?: ReviewComment[]
}

interface ReviewTabProps {
  application: ApplicationRecord
  token: string
  currentUserId?: string
  onCommentAdded: () => void
}

export default function ReviewTab({ application, token, currentUserId, onCommentAdded }: ReviewTabProps) {
  const { tx, format, lang } = useI18n()
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const comments = application.reviewComments ?? []
  const topLevel = comments.filter(function (c: ReviewComment) { return !c.parentId })
  const canRequestFeedback = Boolean(
    application.teamId
    && currentUserId
    && application.ownerId === currentUserId,
  )

  async function handleSubmit(parentId?: string) {
    const text = parentId ? replyBody : body
    if (!text.trim()) return
    setSending(true)
    try {
      await phdApi.addReviewComment(token, application.id, text.trim(), 'review', parentId ?? undefined)
      if (parentId) { setReplyBody(''); setReplyTo(null) }
      else { setBody('') }
      onCommentAdded()
    } catch (e) { console.error(e) }
    finally { setSending(false) }
  }

  async function handleRequestFeedback() {
    if (!canRequestFeedback) return
    setFeedbackBusy(true)
    setFeedbackError(null)
    setFeedbackMessage(null)
    try {
      const result = await phdApi.requestApplicationFeedback(token, application.id, feedbackNote.trim())
      setFeedbackMessage(format(tx('team.requestFeedbackSent'), { count: result.notified }))
      setFeedbackNote('')
    } catch (error) {
      setFeedbackError(normalizeErrorMessage(error, lang, tx('team.requestFeedback', 'Request feedback')))
    } finally {
      setFeedbackBusy(false)
    }
  }

  function renderComment(comment: ReviewComment, isReply: boolean) {
    const childReplies = comments.filter(function (c: ReviewComment) { return c.parentId === comment.id })
    const nestedReplies = comment.replies ?? []

    return (
      <div key={comment.id} className={'review-comment' + (isReply ? ' review-reply' : '')}>
        <div className="review-comment-header">
          <span className="review-comment-author">{comment.authorName}</span>
          <span className="review-comment-time">
            {new Date(comment.createdAt).toLocaleDateString(localeForLanguage(lang), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <MarkdownContent value={comment.body} className="review-comment-body" />
        {!isReply && (
          <div className="review-comment-actions">
            <button type="button" className="quiet-action" onClick={function () { setReplyTo(comment.id); setReplyBody('') }}>
              {tx('review.reply', 'Reply')}
            </button>
          </div>
        )}
        <CollapsiblePanel
          open={replyTo === comment.id}
          className="review-reply-composer-panel"
          innerClassName="review-reply-composer"
          collapseMs={220}
          keepMounted
        >
            <MarkdownTextarea
              placeholder={tx('review.writeReply', 'Write a reply...')}
              value={replyBody}
              onChange={function (e: React.ChangeEvent<HTMLTextAreaElement>) { setReplyBody(e.target.value) }}
              rows={2}
            />
            <div className="review-reply-actions">
              <button type="button" className="quiet-action" onClick={function () { setReplyTo(null) }}>{tx('review.cancel', 'Cancel')}</button>
              <button type="button" className="primary-action" disabled={sending || !replyBody.trim()} onClick={function () { handleSubmit(comment.id) }}>
                {sending ? tx('review.sending', 'Sending...') : tx('review.reply', 'Reply')}
              </button>
            </div>
        </CollapsiblePanel>
        {[...childReplies, ...nestedReplies].map(function (reply: ReviewComment) { return renderComment(reply, true) })}
      </div>
    )
  }

  return (
    <div className="review-thread">
      {canRequestFeedback ? (
        <section className="review-request-feedback" aria-label={tx('team.requestFeedback')}>
          <div>
            <strong>{tx('team.requestFeedback')}</strong>
            <p>{tx('team.requestFeedbackHint')}</p>
          </div>
          <textarea
            className="review-request-feedback-note"
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder={tx('team.requestFeedbackNotePlaceholder')}
            rows={2}
            maxLength={500}
            disabled={feedbackBusy}
          />
          <button
            type="button"
            className="secondary-action"
            disabled={feedbackBusy}
            onClick={() => void handleRequestFeedback()}
          >
            {feedbackBusy ? tx('team.requestFeedbackWorking') : tx('team.requestFeedback')}
          </button>
          {feedbackMessage ? <p className="review-request-feedback-ok" role="status">{feedbackMessage}</p> : null}
          {feedbackError ? <p className="settings-inline-error" role="alert">{feedbackError}</p> : null}
        </section>
      ) : null}

      <div className="review-composer">
        <MarkdownTextarea
          placeholder={tx('review.placeholder', 'Add team feedback... Use @name to mention team members')}
          value={body}
          onChange={function (e: React.ChangeEvent<HTMLTextAreaElement>) { setBody(e.target.value) }}
          rows={3}
        />
        <div className="review-composer-actions">
          <button
            type="button"
            className="primary-action"
            disabled={sending || !body.trim()}
            onClick={function () { handleSubmit() }}
          >
            {sending ? tx('review.posting', 'Posting...') : tx('review.postComment', 'Post Comment')}
          </button>
        </div>
      </div>

      {topLevel.length === 0 ? (
        <div className="review-empty">
          <p>{tx('review.empty', 'No team feedback yet.')}</p>
          <p className="review-empty-hint">{tx('review.emptyHint', 'Start a discussion about this application with your team.')}</p>
        </div>
      ) : (
        topLevel.map(function (comment: ReviewComment) { return renderComment(comment, false) })
      )}
    </div>
  )
}
