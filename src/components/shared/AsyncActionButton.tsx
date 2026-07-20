import { Check, CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'

export type AsyncActionState = 'idle' | 'pending' | 'success' | 'error'

type AsyncActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> & {
  idleLabel: string
  pendingLabel: string
  successLabel: string
  errorLabel: string
  onAction: () => Promise<unknown> | unknown
  IdleIcon?: LucideIcon
  iconSize?: number
  successDurationMs?: number
  errorDurationMs?: number
}

/**
 * A compact async action with a complete interaction sentence:
 * ready -> visibly working -> succeeded/failed -> ready.
 *
 * All layers stay mounted so labels and icons cross-fade without width jumps.
 */
export function AsyncActionButton({
  idleLabel,
  pendingLabel,
  successLabel,
  errorLabel,
  onAction,
  IdleIcon,
  iconSize = 12,
  successDurationMs = 1200,
  errorDurationMs = 1600,
  className = '',
  disabled,
  ...buttonProps
}: AsyncActionButtonProps) {
  const [state, setState] = useState<AsyncActionState>('idle')
  const resetTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    }
  }, [])

  const scheduleReset = (delay: number) => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null
      if (mountedRef.current) setState('idle')
    }, delay)
  }

  const run = async () => {
    if (disabled || state === 'pending') return
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    setState('pending')
    try {
      await onAction()
      if (!mountedRef.current) return
      setState('success')
      scheduleReset(successDurationMs)
    } catch {
      if (!mountedRef.current) return
      setState('error')
      scheduleReset(errorDurationMs)
    }
  }

  const currentLabel = state === 'pending'
    ? pendingLabel
    : state === 'success'
      ? successLabel
      : state === 'error'
        ? errorLabel
        : idleLabel

  return (
    <button
      {...buttonProps}
      type="button"
      className={`async-action-button is-${state}${className ? ` ${className}` : ''}`}
      data-state={state}
      disabled={disabled || state === 'pending'}
      aria-busy={state === 'pending' || undefined}
      aria-label={currentLabel}
      title={currentLabel}
      onClick={() => void run()}
    >
      <span className="async-action-layer async-action-idle" aria-hidden={state !== 'idle'}>
        {IdleIcon ? <IdleIcon size={iconSize} aria-hidden="true" /> : null}
        <span>{idleLabel}</span>
      </span>
      <span className="async-action-layer async-action-pending" aria-hidden={state !== 'pending'}>
        <LoaderCircle size={iconSize} className="spin-icon" aria-hidden="true" />
        <span>{pendingLabel}</span>
      </span>
      <span className="async-action-layer async-action-success" aria-hidden={state !== 'success'}>
        <Check size={iconSize} aria-hidden="true" />
        <span>{successLabel}</span>
      </span>
      <span className="async-action-layer async-action-error" aria-hidden={state !== 'error'}>
        <CircleAlert size={iconSize} aria-hidden="true" />
        <span>{errorLabel}</span>
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{currentLabel}</span>
    </button>
  )
}
