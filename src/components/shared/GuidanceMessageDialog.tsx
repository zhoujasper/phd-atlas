import { Send, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { normalizeErrorMessage } from '../../errorMessages'
import { registerSafeReloadGuard } from '../../safeReload'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { PendingLabel } from './PendingLabel'
import {
  clearRecoverableGuidanceMessageDraft,
  guidanceMessageDraftStorageKey,
  loadRecoverableGuidanceMessageDraft,
  saveRecoverableGuidanceMessageDraft,
  type GuidanceMessageDraftScope,
  type ResidentDraftScope,
} from './residentCommunicationDraftStorage'

export function GuidanceMessageDialog({
  open,
  recipientId,
  recipientName,
  draftScope,
  onClose,
  onSend,
}: {
  open: boolean
  recipientId: string
  recipientName: string
  draftScope?: ResidentDraftScope
  onClose: () => void
  onSend: (title: string, body: string) => Promise<void>
}) {
  const { tx, format, lang } = useI18n()
  const draftScopeUserId = draftScope?.userId
  const draftScopeWorkspaceId = draftScope?.workspaceId
  const guidanceDraftScope: GuidanceMessageDraftScope | null = useMemo(() => (
    draftScopeUserId && draftScopeWorkspaceId && recipientId
      ? { userId: draftScopeUserId, workspaceId: draftScopeWorkspaceId, recipientId }
      : null
  ), [draftScopeUserId, draftScopeWorkspaceId, recipientId])
  const guidanceDraftScopeKey = guidanceDraftScope
    ? guidanceMessageDraftStorageKey(guidanceDraftScope)
    : null
  const [residentSeed] = useState(() => (
    guidanceDraftScope ? loadRecoverableGuidanceMessageDraft(guidanceDraftScope) : null
  ))
  const [title, setTitle] = useState(residentSeed?.title ?? '')
  const [body, setBody] = useState(residentSeed?.body ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  const safeReloadGuardId = useId()
  const draftRef = useRef({ title, body })
  const draftScopeRef = useRef(guidanceDraftScope)
  const draftScopeKeyRef = useRef(guidanceDraftScopeKey)
  const dirtyRef = useRef(Boolean(title.trim() || body.trim()))
  const sendingRef = useRef(sending)
  const mountedRef = useRef(true)
  const previousOpenRef = useRef(open)
  draftRef.current = { title, body }
  draftScopeRef.current = guidanceDraftScope
  draftScopeKeyRef.current = guidanceDraftScopeKey
  dirtyRef.current = Boolean(title.trim() || body.trim())
  sendingRef.current = sending
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 150, recipientId)
  const dialogRef = useModalA11y<HTMLFormElement>({
    open,
    onClose: () => {
      if (!sending) requestClose(onClose)
    },
    initialFocusRef: titleInputRef,
  })

  useEffect(() => {
    if (open && !previousOpenRef.current) setError('')
    previousOpenRef.current = open
  }, [open])

  const persistResidentDraft = () => {
    const scope = draftScopeRef.current
    if (!scope) return true
    return saveRecoverableGuidanceMessageDraft(scope, draftRef.current)
  }

  useEffect(() => {
    if (!guidanceDraftScope || !guidanceDraftScopeKey) return undefined
    const timer = window.setTimeout(() => {
      persistResidentDraft()
    }, 160)
    return () => window.clearTimeout(timer)
  }, [body, guidanceDraftScope, guidanceDraftScopeKey, title])

  useEffect(() => registerSafeReloadGuard(`guidance-message:${safeReloadGuardId}`, {
    prepare: () => !sendingRef.current && persistResidentDraft(),
    hasUnsavedChanges: () => dirtyRef.current || sendingRef.current,
  }), [safeReloadGuardId])

  useEffect(() => {
    mountedRef.current = true
    const persist = () => {
      persistResidentDraft()
    }
    window.addEventListener('beforeunload', persist)
    window.addEventListener('pagehide', persist)
    return () => {
      mountedRef.current = false
      window.removeEventListener('beforeunload', persist)
      window.removeEventListener('pagehide', persist)
      persist()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextTitle = title.trim()
    const nextBody = body.trim()
    if (!nextTitle || !nextBody || sending) return
    const submittedScope = draftScopeRef.current
    const submittedScopeKey = draftScopeKeyRef.current
    const submittedSignature = JSON.stringify(draftRef.current)
    if (!persistResidentDraft()) {
      setError(tx('localRecoveryUnavailable'))
      return
    }
    sendingRef.current = true
    setSending(true)
    setError('')
    try {
      await onSend(nextTitle, nextBody)
      const canSettleSubmittedDraft = draftScopeKeyRef.current === submittedScopeKey
        && JSON.stringify(draftRef.current) === submittedSignature
      if (!canSettleSubmittedDraft) return
      if (submittedScope && !clearRecoverableGuidanceMessageDraft(submittedScope)) {
        if (mountedRef.current) setError(tx('localRecoveryUnavailable'))
        return
      }
      draftRef.current = { title: '', body: '' }
      dirtyRef.current = false
      if (!mountedRef.current || draftScopeKeyRef.current !== submittedScopeKey) return
      setTitle('')
      setBody('')
      requestClose(onClose)
    } catch (reason) {
      if (mountedRef.current && draftScopeKeyRef.current === submittedScopeKey) {
        setError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      }
    } finally {
      sendingRef.current = false
      if (mountedRef.current) setSending(false)
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
                required
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
                required
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
                aria-busy={sending || undefined}
              >
                {sending ? (
                  <PendingLabel label={tx('working')} />
                ) : (
                  <><Send size={13} aria-hidden="true" /> {tx('notificationPublisher.send')}</>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}
