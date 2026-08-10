import { AlertTriangle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { PendingLabel } from './PendingLabel'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  children?: ReactNode
  confirmLabel?: string
  secondaryLabel?: string
  cancelLabel?: string
  confirmDisabled?: boolean
  variant?: 'danger' | 'default'
  initialFocusRef?: RefObject<HTMLElement | null>
  onConfirm: () => void | Promise<void>
  onSecondary?: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmLabel,
  secondaryLabel,
  cancelLabel,
  confirmDisabled = false,
  variant = 'default',
  initialFocusRef,
  onConfirm,
  onSecondary,
  onCancel,
}: ConfirmDialogProps) {
  const { tx } = useI18n()
  const titleId = useId()
  const messageId = useId()
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const [pendingAction, setPendingAction] = useState<'confirm' | 'secondary' | null>(null)
  const pending = pendingAction !== null
  const { exiting, requestClose } = useAnimatedClose(open, onCancel)

  useEffect(() => {
    if (!open) setPendingAction(null)
  }, [open])

  const requestCancel = () => {
    if (pending) return
    requestClose(onCancel)
  }

  const submitAction = (action: 'confirm' | 'secondary', handler: () => void | Promise<void>) => {
    if (pending) return
    setPendingAction(action)
    void Promise.resolve()
      .then(handler)
      .then(() => {
        setPendingAction(null)
        requestClose(onCancel)
      })
      .catch(() => {
        // The mutation owner is responsible for its localized error toast.
        // Keep this confirmation mounted so the user can retry after failure.
        setPendingAction(null)
      })
  }
  const submitConfirm = () => submitAction('confirm', onConfirm)
  const submitSecondary = () => {
    if (onSecondary) submitAction('secondary', onSecondary)
  }

  const dialogRef = useModalA11y<HTMLDivElement>({
    open,
    onClose: requestCancel,
    onConfirm: confirmDisabled ? undefined : submitConfirm,
    initialFocusRef: initialFocusRef ?? (variant === 'danger' ? cancelBtnRef : confirmBtnRef),
  })
  const resolvedConfirmLabel = confirmLabel ?? tx('confirm')
  const resolvedCancelLabel = cancelLabel ?? tx('cancel')

  if (!open) return null

  return (
    <ModalPortal>
      <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(event) => {
      if (event.target === event.currentTarget) requestCancel()
    }}>
      <div
        ref={dialogRef}
        className={`confirm-dialog${secondaryLabel && onSecondary ? ' has-secondary-action' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="confirm-icon">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <h3 id={titleId}>{title}</h3>
        <p id={messageId}>{message}</p>
        {children}
        <div className="confirm-actions" aria-busy={pending || undefined}>
          <button ref={cancelBtnRef} type="button" className="quiet-action" disabled={pending} onClick={requestCancel}>
            {resolvedCancelLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              className="quiet-action confirm-secondary-action"
              disabled={pending}
              aria-busy={pendingAction === 'secondary' || undefined}
              onClick={submitSecondary}
            >
              {pendingAction === 'secondary' ? <PendingLabel label={tx('working')} /> : secondaryLabel}
            </button>
          ) : null}
          <button
            ref={confirmBtnRef}
            type="button"
            className={variant === 'danger' ? 'danger-action' : 'primary-action'}
            disabled={pending || confirmDisabled}
            aria-busy={pending || undefined}
            onClick={submitConfirm}
          >
            {pendingAction === 'confirm' ? <PendingLabel label={tx('working')} /> : resolvedConfirmLabel}
          </button>
        </div>
      </div>
      </div>
    </ModalPortal>
  )
}
