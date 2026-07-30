import { AlertTriangle } from 'lucide-react'
import { useId, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { tx } = useI18n()
  const titleId = useId()
  const messageId = useId()
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const { exiting, requestClose } = useAnimatedClose(open, onCancel)
  const dialogRef = useModalA11y<HTMLDivElement>({
    open,
    onClose: () => requestClose(onCancel),
    onConfirm: () => requestClose(onConfirm),
    initialFocusRef: variant === 'danger' ? cancelBtnRef : confirmBtnRef,
  })
  const resolvedConfirmLabel = confirmLabel ?? tx('confirm')
  const resolvedCancelLabel = cancelLabel ?? tx('cancel')

  if (!open) return null

  return (
    <ModalPortal>
      <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={(event) => {
      if (event.target === event.currentTarget) requestClose(onCancel)
    }}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
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
        <div className="confirm-actions">
          <button ref={cancelBtnRef} type="button" className="quiet-action" onClick={() => requestClose(onCancel)}>
            {resolvedCancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={variant === 'danger' ? 'danger-action' : 'primary-action'}
            onClick={() => requestClose(onConfirm)}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
      </div>
    </ModalPortal>
  )
}
