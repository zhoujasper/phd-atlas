import {
  AtSign,
  Check,
  ChevronDown,
  Inbox,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  MAX_APPLICATION_CORRESPONDENCE_EMAILS,
  isValidCorrespondenceEmail,
  normalizeCorrespondenceEmail,
} from '../../correspondenceRecipients'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { AnchoredPopover } from './AnchoredPopover'
import { ModalPortal } from './ModalPortal'

export function ComposerRecipientControl({
  value,
  trackedEmails,
  primaryEmail,
  onChange,
}: {
  value: string
  trackedEmails: string[]
  primaryEmail: string
  onChange: (email: string) => void
}) {
  const { tx, format } = useI18n()
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const normalizedValue = normalizeCorrespondenceEmail(value)
  const normalizedPrimary = normalizeCorrespondenceEmail(primaryEmail)
  const isTracked = trackedEmails.includes(normalizedValue)

  useLayoutEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const beginEditing = () => {
    setEditValue(value)
    setError('')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditValue(value)
    setError('')
    setEditing(false)
  }

  const commitEditing = () => {
    const normalized = normalizeCorrespondenceEmail(editValue)
    if (!isValidCorrespondenceEmail(normalized)) {
      setError(tx('dossier.recipientInvalid'))
      return false
    }
    onChange(normalized)
    setEditValue(normalized)
    setError('')
    setEditing(false)
    return true
  }

  return (
    <div className={`composer-recipient-control${editing ? ' editing' : ''}${isTracked ? '' : ' temporary'}`}>
      <span>{tx('dossier.emailTo')}</span>
      {editing ? (
        <>
          <div className="composer-recipient-edit-stage">
            <AtSign size={13} aria-hidden="true" />
            <input
              ref={inputRef}
              value={editValue}
              type="email"
              inputMode="email"
              spellCheck={false}
              aria-label={tx('dossier.recipientTemporaryEdit')}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setEditValue(event.target.value)
                setError('')
              }}
              onBlur={commitEditing}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitEditing()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEditing()
                }
              }}
            />
            <button
              type="button"
              aria-label={tx('cancel')}
              title={tx('cancel')}
              onPointerDown={(event) => event.preventDefault()}
              onClick={cancelEditing}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
          {error ? <small className="composer-recipient-error" role="alert">{error}</small> : null}
        </>
      ) : (
        <AnchoredPopover
          triggerAriaLabel={format(tx('dossier.recipientSwitchAria'), { email: normalizedValue })}
          popoverAriaLabel={tx('dossier.recipientSwitchTitle')}
          triggerClassName="composer-recipient-trigger"
          popoverClassName="composer-recipient-popover"
          width={326}
          estimatedHeight={214}
          align="end"
          onTriggerDoubleClick={beginEditing}
          trigger={(
            <span className="composer-recipient-trigger-content">
              <span className="composer-recipient-value">
                <strong>{normalizedValue || tx('dossier.emailNotConfigured')}</strong>
                <em className={isTracked ? 'tracked' : 'temporary'}>
                  {isTracked ? <ShieldCheck size={11} aria-hidden="true" /> : <AtSign size={11} aria-hidden="true" />}
                  {tx(isTracked ? 'dossier.recipientTracked' : 'dossier.recipientTemporary')}
                </em>
              </span>
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          )}
        >
          {(close) => (
            <>
              <div className="composer-recipient-popover-head">
                <strong>{tx('dossier.recipientSwitchTitle')}</strong>
                <p>{tx('dossier.recipientSwitchHint')}</p>
              </div>
              <div className="composer-recipient-options" role="list">
                {trackedEmails.map((email, index) => {
                  const selected = email === normalizedValue
                  return (
                    <button
                      key={email}
                      type="button"
                      className={selected ? 'selected' : ''}
                      data-popover-autofocus={selected ? 'true' : undefined}
                      onClick={() => {
                        onChange(email)
                        close()
                      }}
                    >
                      <span>
                        <strong>{email}</strong>
                        <small>{email === normalizedPrimary
                          ? tx('dossier.recipientPrimary')
                          : tx('dossier.recipientTracked')}</small>
                      </span>
                      {selected ? <Check size={14} aria-hidden="true" /> : <span>{index + 1}</span>}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                className="composer-recipient-temporary-action"
                onClick={() => {
                  close()
                  beginEditing()
                }}
              >
                <AtSign size={13} aria-hidden="true" />
                {tx('dossier.recipientTemporaryEdit')}
              </button>
            </>
          )}
        </AnchoredPopover>
      )}
    </div>
  )
}

export function CorrespondenceRecipientSettings({
  emails,
  primaryEmail,
  activeEmail,
  onSelect,
  onAdd,
  onRemove,
}: {
  emails: string[]
  primaryEmail: string
  activeEmail: string
  onSelect: (email: string) => void
  onAdd: (email: string) => boolean
  onRemove: (email: string) => void
}) {
  const { tx, format } = useI18n()
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const normalizedPrimary = normalizeCorrespondenceEmail(primaryEmail)
  const normalizedActive = normalizeCorrespondenceEmail(activeEmail)

  const addRecipient = (event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeCorrespondenceEmail(value)
    if (!isValidCorrespondenceEmail(normalized)) {
      setFeedback({ tone: 'error', message: tx('dossier.recipientInvalid') })
      return
    }
    if (emails.includes(normalized)) {
      setFeedback({ tone: 'error', message: tx('dossier.recipientDuplicate') })
      return
    }
    if (emails.length >= MAX_APPLICATION_CORRESPONDENCE_EMAILS) {
      setFeedback({
        tone: 'error',
        message: format(tx('dossier.recipientLimit'), { count: MAX_APPLICATION_CORRESPONDENCE_EMAILS }),
      })
      return
    }
    if (!onAdd(normalized)) return
    setValue('')
    setFeedback({ tone: 'success', message: tx('dossier.recipientAdded') })
  }

  return (
    <AnchoredPopover
      triggerAriaLabel={`${tx('dossier.recipientSettings')} · ${format(
        tx('dossier.recipientCount'),
        { count: emails.length },
      )}`}
      popoverAriaLabel={tx('dossier.recipientSettingsTitle')}
      triggerClassName="correspondence-recipient-settings-trigger"
      popoverClassName="correspondence-recipient-settings-popover"
      width={356}
      estimatedHeight={390}
      align="end"
      trigger={(
        <span
          className="correspondence-recipient-settings-icon"
          title={tx('dossier.recipientSettings')}
        >
          <Settings size={13} aria-hidden="true" />
        </span>
      )}
    >
      {() => (
        <>
          <div className="recipient-settings-head">
            <div className="recipient-settings-icon"><Inbox size={17} aria-hidden="true" /></div>
            <div>
              <strong>{tx('dossier.recipientSettingsTitle')}</strong>
              <p>{tx('dossier.recipientSettingsDescription')}</p>
            </div>
            <span>{format(tx('dossier.recipientCount'), { count: emails.length })}</span>
          </div>
          <div className="recipient-settings-list" role="list">
            {emails.map((email) => {
              const primary = email === normalizedPrimary
              const selected = email === normalizedActive
              return (
                <div key={email} className={`recipient-settings-row${selected ? ' selected' : ''}`}>
                  <button
                    type="button"
                    className="recipient-settings-select"
                    data-popover-autofocus={selected ? 'true' : undefined}
                    onClick={() => onSelect(email)}
                  >
                    <span className="recipient-settings-row-icon">
                      {selected ? <Check size={13} aria-hidden="true" /> : <AtSign size={13} aria-hidden="true" />}
                    </span>
                    <span>
                      <strong>{email}</strong>
                      <small>{primary ? tx('dossier.recipientPrimary') : tx('dossier.recipientTracked')}</small>
                    </span>
                  </button>
                  {!primary ? (
                    <button
                      type="button"
                      className="recipient-settings-remove"
                      aria-label={format(tx('dossier.recipientRemoveAria'), { email })}
                      title={format(tx('dossier.recipientRemoveAria'), { email })}
                      onClick={() => onRemove(email)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
          <form className="recipient-settings-add" onSubmit={addRecipient}>
            <label htmlFor="recipient-settings-email">{tx('dossier.recipientAddLabel')}</label>
            <div>
              <input
                id="recipient-settings-email"
                value={value}
                type="email"
                inputMode="email"
                spellCheck={false}
                placeholder={tx('dossier.recipientAddPlaceholder')}
                onChange={(event) => {
                  setValue(event.target.value)
                  setFeedback(null)
                }}
              />
              <button type="submit" disabled={!value.trim()}>
                <Plus size={13} aria-hidden="true" />
                {tx('dossier.recipientAdd')}
              </button>
            </div>
            {feedback ? (
              <small className={feedback.tone} role={feedback.tone === 'error' ? 'alert' : 'status'}>
                {feedback.message}
              </small>
            ) : (
              <small>{format(tx('dossier.recipientLimitHint'), {
                count: MAX_APPLICATION_CORRESPONDENCE_EMAILS,
              })}</small>
            )}
          </form>
        </>
      )}
    </AnchoredPopover>
  )
}

export function RecipientTrackingDialog({
  recipient,
  onDecision,
}: {
  recipient: string
  onDecision: (decision: 'track' | 'once' | 'cancel') => void
}) {
  const { tx, format } = useI18n()
  const titleId = useId()
  const messageId = useId()
  const {
    exiting,
    requestClose,
  } = useAnimatedClose(true, () => onDecision('cancel'))
  const dialogRef = useModalA11y<HTMLElement>({
    open: true,
    onClose: () => requestClose(),
  })

  return (
    <ModalPortal>
      <div
        className={`dialog-layer recipient-tracking-layer${exiting ? ' exiting' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose()
        }}
      >
        <section
          ref={dialogRef}
          className="recipient-tracking-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={messageId}
        >
          <div className="recipient-tracking-icon">
            <Inbox size={21} aria-hidden="true" />
          </div>
          <div className="recipient-tracking-copy">
            <span>{tx('dossier.recipientTrackingEyebrow')}</span>
            <h3 id={titleId}>{tx('dossier.recipientTrackingTitle')}</h3>
            <p id={messageId}>{format(tx('dossier.recipientTrackingMessage'), { email: recipient })}</p>
            <strong><AtSign size={13} aria-hidden="true" /> {recipient}</strong>
            <small>{tx('dossier.recipientTrackingHint')}</small>
          </div>
          <div className="recipient-tracking-actions">
            <button type="button" className="quiet-action" onClick={() => requestClose()}>
              <X size={13} aria-hidden="true" /> {tx('cancel')}
            </button>
            <button type="button" className="quiet-action" onClick={() => requestClose(() => onDecision('once'))}>
              <Send size={13} aria-hidden="true" /> {tx('dossier.recipientSendOnce')}
            </button>
            <button type="button" className="primary-action" onClick={() => requestClose(() => onDecision('track'))}>
              <ShieldCheck size={13} aria-hidden="true" /> {tx('dossier.recipientTrackAndSend')}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  )
}
