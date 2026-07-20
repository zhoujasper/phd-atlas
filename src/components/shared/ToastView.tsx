import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react'
import type { Toast } from '../../appModel'
import { useI18n } from '../hooks/useI18n'
import type { QueuedToast } from '../hooks/useToastQueue'

export function ToastView({
  toast,
  exiting,
  onClose,
}: {
  toast: Toast | null
  exiting: boolean
  onClose: () => void
}) {
  const { tx } = useI18n()
  if (!toast) return null

  const isUrgent = toast.tone === 'error' || toast.tone === 'warning'

  return (
    <div
      className={`atlas-toast ${toast.tone}${exiting ? ' exiting' : ''}`}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
    >
      <span className="atlas-toast-icon" aria-hidden="true">
        {toast.tone === 'success' ? <Check size={13} /> : null}
        {toast.tone === 'error' ? <XCircle size={13} /> : null}
        {toast.tone === 'info' ? <Info size={13} /> : null}
        {toast.tone === 'warning' ? <AlertTriangle size={13} /> : null}
      </span>
      <span className="atlas-toast-message">{toast.message}</span>
      {toast.action ? (
        <button type="button" className="atlas-toast-action" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="atlas-toast-close"
        onClick={onClose}
        aria-label={tx('close')}
        title={tx('close')}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ToastStack({
  toasts,
  onClose,
  onPause,
  onResume,
}: {
  toasts: QueuedToast[]
  onClose: (id: number) => void
  onPause: (id: number) => void
  onResume: (id: number) => void
}) {
  const { tx } = useI18n()
  if (toasts.length === 0) return null
  return (
    <div className="atlas-toast-stack" aria-label={tx('notifications.title')}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`atlas-toast-slot${toast.exiting ? ' exiting' : ''}`}
          onMouseEnter={() => onPause(toast.id)}
          onMouseLeave={() => onResume(toast.id)}
          onFocusCapture={() => onPause(toast.id)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onResume(toast.id)
          }}
        >
          <ToastView toast={toast} exiting={toast.exiting} onClose={() => onClose(toast.id)} />
        </div>
      ))}
    </div>
  )
}
