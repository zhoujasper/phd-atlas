import { AlertCircle, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

type ErrorSeverity = 'recoverable' | 'conflict' | 'critical'

interface ErrorRecoveryDialogProps {
  open: boolean
  severity: ErrorSeverity
  title?: string
  message?: string
  recoverySteps?: string[]
  onRetry?: () => void
  onReload?: () => void
  onDismiss?: () => void
  loading?: boolean
}

/**
 * Structured error recovery dialog with clear next steps.
 * Guides users through save conflicts, network failures, and critical errors.
 * Addresses audit finding: errors lack actionable recovery guidance.
 */
export function ErrorRecoveryDialog({
  open,
  severity,
  title,
  message,
  recoverySteps,
  onRetry,
  onReload,
  onDismiss,
  loading = false,
}: ErrorRecoveryDialogProps) {
  const { tx } = useI18n()

  if (!open) return null

  const errorConfig = getErrorConfig(severity, tx, title, message, recoverySteps)

  return (
    <div className="error-recovery-overlay" role="dialog" aria-modal="true" aria-labelledby="error-dialog-title">
      <div className={`error-recovery-dialog severity-${severity}`}>
        <div className="error-recovery-header">
          <div className="error-recovery-icon" aria-hidden="true">
            <AlertCircle size={22} />
          </div>
          <div className="error-recovery-heading">
            <h2 id="error-dialog-title">{errorConfig.title}</h2>
            <p>{errorConfig.message}</p>
          </div>
          {onDismiss && severity === 'recoverable' ? (
            <button
              type="button"
              className="error-recovery-close"
              onClick={onDismiss}
              aria-label={tx('close', 'Close')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {errorConfig.steps.length > 0 ? (
          <div className="error-recovery-steps">
            <strong>{tx('feedback.nextSteps', 'Next steps:')}</strong>
            <ol>
              {errorConfig.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="error-recovery-actions">
          {onRetry ? (
            <button
              type="button"
              className="primary-action"
              onClick={onRetry}
              disabled={loading}
              aria-busy={loading}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {loading ? tx('feedback.retrying', 'Retrying…') : tx('feedback.retry', 'Retry')}
            </button>
          ) : null}
          {onReload ? (
            <button
              type="button"
              className={onRetry ? 'quiet-action' : 'primary-action'}
              onClick={onReload}
            >
              <RotateCcw size={14} aria-hidden="true" />
              {tx('appRecovery.reload', 'Reload PhD Atlas')}
            </button>
          ) : null}
          {onDismiss && severity !== 'critical' ? (
            <button type="button" className="quiet-action" onClick={onDismiss}>
              {tx('cancel', 'Cancel')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function getErrorConfig(
  severity: ErrorSeverity,
  tx: (path: string, fallback?: string) => string,
  customTitle?: string,
  customMessage?: string,
  customSteps?: string[]
) {
  const defaults = (() => {
    switch (severity) {
    case 'conflict':
      return {
        title: tx('feedback.conflictTitle', 'Changes conflict'),
        message: tx('apiErrors.APPLICATION_VERSION_CONFLICT', 'This record changed while you were editing. Your changes are still safe.'),
        steps: [
          tx('feedback.copyChanges', 'Copy your changes to a safe place'),
          tx('feedback.reloadLatest', 'Reload to see the latest version'),
          tx('feedback.reapplyEdits', 'Reapply your edits'),
        ],
      }
    case 'critical':
      return {
        title: tx('appRecovery.title', 'This view could not be loaded'),
        message: tx('appRecovery.description', 'Your saved work is still available.'),
        steps: [
          tx('feedback.reloadContinue', 'Reload the page to continue'),
          tx('feedback.contactSupport', 'Contact support if the problem continues'),
        ],
      }
    default:
      return {
        title: tx('feedback.genericTitle', 'Something went wrong'),
        message: tx('apiErrors.REQUEST_FAILED', 'Check your connection and try again.'),
        steps: [],
      }
    }
  })()

  return {
    title: customTitle || defaults.title,
    message: customMessage || defaults.message,
    steps: customSteps ?? defaults.steps,
  }
}
