import { Clock3, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const RESEND_COOLDOWN_MS = 60_000

function remainingSeconds(sentAt: string | undefined, now: number) {
  if (!sentAt) return 0
  const sentAtMs = Date.parse(sentAt)
  if (!Number.isFinite(sentAtMs)) return 0
  return Math.max(0, Math.ceil((sentAtMs + RESEND_COOLDOWN_MS - now) / 1000))
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
  const [now, setNow] = useState(() => Date.now())
  const [sending, setSending] = useState(false)
  const [optimisticSentAt, setOptimisticSentAt] = useState<string | undefined>(sentAt)

  useEffect(() => {
    setOptimisticSentAt(sentAt)
    setNow(Date.now())
  }, [sentAt])

  const remaining = useMemo(
    () => remainingSeconds(optimisticSentAt, now),
    [now, optimisticSentAt],
  )

  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [remaining])

  const resend = async () => {
    if (sending || remaining > 0) return
    setSending(true)
    try {
      const nextSentAt = await onResend()
      setOptimisticSentAt(nextSentAt || new Date().toISOString())
      setNow(Date.now())
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
    >
      <span className="verification-resend-layer verification-resend-ready" aria-hidden={state !== 'ready'}>
        <RefreshCw size={12} aria-hidden="true" />
        <span>{resendLabel}</span>
      </span>
      <span className="verification-resend-layer verification-resend-sending" aria-hidden={state !== 'sending'}>
        <LoaderCircle size={12} className="spin-icon" aria-hidden="true" />
        <span>{sendingLabel}</span>
      </span>
      <span className="verification-resend-layer verification-resend-cooldown" aria-hidden={state !== 'cooldown'} aria-live="polite">
        <Clock3 size={12} aria-hidden="true" />
        <span>{countdownLabel(remaining)}</span>
      </span>
    </button>
  )
}
