import { Clock3, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDeadlineCountdown } from '../hooks/useDeadlineCountdown'
import { PendingLabel } from './PendingLabel'

const RESEND_COOLDOWN_MS = 60_000

function resendDeadline(sentAt: string | undefined) {
  if (!sentAt) return null
  const sentAtMs = Date.parse(sentAt)
  return Number.isFinite(sentAtMs) ? sentAtMs + RESEND_COOLDOWN_MS : null
}

export function VerificationResendAction({
  sentAt,
  resendLabel,
  sendingLabel,
  countdownLabel,
  onResend,
}: {
  sentAt?: string
  resendLabel: string
  sendingLabel: string
  countdownLabel: (seconds: number) => string
  onResend: () => Promise<string | void> | string | void
}) {
  const [sending, setSending] = useState(false)
  const [optimisticSentAt, setOptimisticSentAt] = useState<string | undefined>(sentAt)

  useEffect(() => {
    setOptimisticSentAt(sentAt)
  }, [sentAt])

  const deadlineAt = useMemo(() => resendDeadline(optimisticSentAt), [optimisticSentAt])
  const remaining = useDeadlineCountdown(deadlineAt)

  const resend = async () => {
    if (sending || remaining > 0) return
    setSending(true)
    try {
      const nextSentAt = await onResend()
      setOptimisticSentAt(nextSentAt || new Date().toISOString())
    } catch {
      // The parent surfaces the delivery error; keep the ready state so it can be retried.
    } finally {
      setSending(false)
    }
  }

  const state = sending ? 'sending' : remaining > 0 ? 'cooldown' : 'ready'
  const accessibleLabel = state === 'sending'
    ? sendingLabel
    : state === 'cooldown'
      ? countdownLabel(remaining)
      : resendLabel

  return (
    <button
      type="button"
      className={`quiet-action compact-action mail-secondary-btn verification-resend-action is-${state}`}
      onClick={() => void resend()}
      disabled={state !== 'ready'}
      title={accessibleLabel}
      aria-label={accessibleLabel}
      aria-busy={sending || undefined}
    >
      <span className="verification-resend-layer verification-resend-ready" aria-hidden={state !== 'ready'}>
        <RefreshCw size={12} aria-hidden="true" />
        <span>{resendLabel}</span>
      </span>
      <span className="verification-resend-layer verification-resend-sending" aria-hidden={state !== 'sending'}>
        <PendingLabel label={sendingLabel} iconSize={12} />
      </span>
      <span className="verification-resend-layer verification-resend-cooldown" aria-hidden={state !== 'cooldown'} aria-live="polite">
        <Clock3 size={12} aria-hidden="true" />
        <span>{countdownLabel(remaining)}</span>
      </span>
    </button>
  )
}
