import { Send, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { normalizeErrorMessage } from '../../errorMessages'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

export function GuidanceMessageDialog({
  open,
  recipientName,
  onClose,
  onSend,
}: {
  open: boolean
  recipientName: string
  onClose: () => void
  onSend: (title: string, body: string) => Promise<void>
}) {
  const { tx, format, lang } = useI18n()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 150, recipientName)
  const dialogRef = useModalA11y<HTMLFormElement>({
    open: open && !exiting,
    onClose: () => requestClose(onClose),
    initialFocusRef: titleInputRef,
  })

  useEffect(() => {
    if (!open) return
    setTitle('')
    setBody('')
    setSending(false)
    setError('')
  }, [open, recipientName])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextTitle = title.trim()
    const nextBody = body.trim()
    if (!nextTitle || !nextBody || sending) return
    setSending(true)
    setError('')
    try {
      await onSend(nextTitle, nextBody)
      requestClose(onClose)
    } catch (reason) {
      setError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <ModalPortal>
      <div
        className={`dialog-layer guidance-message-layer${exiting ? ' exiting' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget && !sending) requestClose(onClose)
        }}
      >
        <form
          ref={dialogRef}
          className="guidance-message-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          onSubmit={submit}
        >
          <div className="guidance-message-head">
            <div>
              <span className="eyebrow">{tx('notificationPublisher.inApp')}</span>
              <h3 id={headingId}>
                {format(tx('dashboard.guidanceMessageTitle', 'Message {name}'), { name: recipientName })}
              </h3>
              <p id={descriptionId}>{tx('notificationPublisher.messageDetailsHint')}</p>
            </div>
            <button
              type="button"
              className="icon-action"
              aria-label={tx('notificationPublisher.closeDialog')}
              disabled={sending}
              onClick={() => requestClose(onClose)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>

          <div className="guidance-message-fields">
            <label>
              <span>{tx('notificationPublisher.titleLabel')}</span>
              <input
                ref={titleInputRef}
                value={title}
                maxLength={160}
                disabled={sending}
                placeholder={tx('notificationPublisher.titlePlaceholder')}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              <span>{tx('notificationPublisher.bodyLabel')}</span>
              <textarea
                value={body}
                maxLength={2000}
                rows={6}
                disabled={sending}
                placeholder={tx('notificationPublisher.bodyPlaceholder')}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
          </div>

          <div className="guidance-message-foot">
            {error ? <p role="alert">{error}</p> : <span />}
            <div>
              <button
                type="button"
                className="quiet-action compact-action"
                disabled={sending}
                onClick={() => requestClose(onClose)}
              >
                {tx('cancel')}
              </button>
              <button
                type="submit"
                className="primary-action compact-action"
                disabled={sending || !title.trim() || !body.trim()}
              >
                <Send size={13} aria-hidden="true" />
                {sending ? tx('working') : tx('notificationPublisher.send')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}
