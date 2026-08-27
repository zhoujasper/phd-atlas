import { AlertCircle, WifiOff, RefreshCw, XCircle } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

type ErrorCategory = 'network' | 'conflict' | 'validation' | 'server' | 'generic'

interface EnhancedErrorToastProps {
  category: ErrorCategory
  title?: string
  message?: string
  onRetry?: () => void
  onDismiss?: () => void
}

/**
 * Enhanced error UI with icon, clear title, and actionable suggestion.
 * Addresses audit finding: generic "Request failed" messages lack user guidance.
 */
export function EnhancedErrorToast({ category, title, message, onRetry, onDismiss }: EnhancedErrorToastProps) {
  const { tx } = useI18n()
  const errorConfig = getErrorConfig(category, tx, title, message)
  const retryLabel = tx('feedback.retry', 'Retry')

  return (
    <div className="enhanced-error-toast" role="alert">
      <div className="enhanced-error-icon" aria-hidden="true">
        {errorConfig.icon}
      </div>
      <div className="enhanced-error-content">
        <strong className="enhanced-error-title">{errorConfig.title}</strong>
        <p className="enhanced-error-message">{errorConfig.message}</p>
      </div>
      <div className="enhanced-error-actions">
        {onRetry && errorConfig.showRetry && (
          <button
            type="button"
            className="enhanced-error-retry"
            onClick={onRetry}
            aria-label={retryLabel}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {retryLabel}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="enhanced-error-dismiss"
            onClick={onDismiss}
            aria-label={tx('close', 'Close')}
          >
            <XCircle size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}

function getErrorConfig(
  category: ErrorCategory,
  tx: (path: string, fallback?: string) => string,
  customTitle?: string,
  customMessage?: string,
) {
  switch (category) {
    case 'network':
      return {
        icon: <WifiOff size={18} />,
        title: customTitle || tx('feedback.networkTitle', 'Connection lost'),
        message: customMessage || tx('apiErrors.NETWORK_ERROR', 'Check your network and try again.'),
        showRetry: true,
      }
    case 'conflict':
      return {
        icon: <AlertCircle size={18} />,
        title: customTitle || tx('feedback.conflictTitle', 'Changes conflict'),
        message: customMessage || tx('apiErrors.APPLICATION_VERSION_CONFLICT', 'Reload to see the latest version.'),
        showRetry: true,
      }
    case 'validation':
      return {
        icon: <AlertCircle size={18} />,
        title: customTitle || tx('feedback.validationTitle', 'Check your input'),
        message: customMessage || tx('apiErrors.VALIDATION_ERROR', 'Check your inputs and try again.'),
        showRetry: false,
      }
    case 'server':
      return {
        icon: <AlertCircle size={18} />,
        title: customTitle || tx('feedback.serverTitle', 'Server unavailable'),
        message: customMessage || tx('apiErrors.SERVER_ERROR', 'Try again in a moment.'),
        showRetry: true,
      }
    default:
      return {
        icon: <AlertCircle size={18} />,
        title: customTitle || tx('feedback.genericTitle', 'Something went wrong'),
        message: customMessage || tx('apiErrors.REQUEST_FAILED', 'Please try again.'),
        showRetry: true,
      }
  }
}

/* CSS for enhanced error toast (add to animation-optimization.css) */
/*
.enhanced-error-toast {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
}

.enhanced-error-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius);
  background: var(--danger-bg);
  color: var(--danger-text);
  flex: 0 0 auto;
}

.enhanced-error-content {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.enhanced-error-title {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.enhanced-error-message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.enhanced-error-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
}

.enhanced-error-retry {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--text-inverse);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    transform 80ms var(--ease-out);
}

.enhanced-error-retry:hover {
  background: var(--accent-hover);
}

.enhanced-error-retry:active {
  transform: scale(0.97);
}

.enhanced-error-dismiss {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.enhanced-error-dismiss:hover {
  background: var(--surface-hover);
  color: var(--text);
}
*/
