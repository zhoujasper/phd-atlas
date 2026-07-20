import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { useI18n } from '../hooks/useI18n'

export type InlineConfirmProps = {
  open: boolean
  /** Idle trigger content (icon + label). */
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  confirmTone?: 'default' | 'danger'
  busy?: boolean
  disabled?: boolean
  className?: string
  idleClassName?: string
  confirmClassName?: string
  cancelClassName?: string
  idleTitle?: string
  idleAriaLabel?: string
  onOpen: () => void
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Compact confirm UX for low-stakes actions: the idle control morphs into
 * Cancel + Confirm instead of opening a modal dialog.
 */
export function InlineConfirm({
  open,
  children,
  confirmLabel,
  cancelLabel,
  confirmTone = 'default',
  busy = false,
  disabled = false,
  className = '',
  idleClassName = '',
  confirmClassName = '',
  cancelClassName = '',
  idleTitle,
  idleAriaLabel,
  onOpen,
  onCancel,
  onConfirm,
}: InlineConfirmProps) {
  const { tx } = useI18n()
  const groupId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const idleRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const resolvedCancel = cancelLabel ?? tx('cancel')

  useLayoutEffect(() => {
    const root = rootRef.current
    const idle = idleRef.current
    const actions = actionsRef.current
    if (!root || !idle || !actions) return undefined

    let frame = 0
    const measure = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const idleWidth = Math.ceil(idle.getBoundingClientRect().width)
        const openWidth = Math.ceil(actions.getBoundingClientRect().width)
        if (idleWidth > 0) root.style.setProperty('--inline-confirm-idle-width', `${idleWidth}px`)
        if (openWidth > 0) root.style.setProperty('--inline-confirm-open-width', `${openWidth}px`)
      })
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return () => window.cancelAnimationFrame(frame)
    const observer = new ResizeObserver(measure)
    observer.observe(idle)
    observer.observe(actions)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [children, confirmLabel, resolvedCancel])

  useEffect(() => {
    if (!open) return
    const target = confirmTone === 'danger' ? cancelRef.current : confirmRef.current
    window.requestAnimationFrame(() => target?.focus())
  }, [confirmTone, open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel, open])

  return (
    <div
      ref={rootRef}
      className={clsx('inline-confirm', open && 'is-open', busy && 'is-busy', className)}
      data-tone={confirmTone}
      role="group"
      aria-label={open ? confirmLabel : idleAriaLabel}
    >
      <button
        ref={idleRef}
        type="button"
        className={clsx('inline-confirm-idle', idleClassName)}
        disabled={disabled || busy || open}
        tabIndex={open ? -1 : 0}
        title={idleTitle}
        aria-label={idleAriaLabel}
        aria-expanded={open}
        aria-controls={groupId}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!disabled && !busy) onOpen()
        }}
      >
        {children}
      </button>

      <div
        ref={actionsRef}
        id={groupId}
        className="inline-confirm-actions"
        aria-hidden={!open}
      >
        <button
          ref={cancelRef}
          type="button"
          className={clsx('inline-confirm-cancel', cancelClassName)}
          disabled={!open || busy}
          tabIndex={open ? 0 : -1}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }}
        >
          {resolvedCancel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={clsx(
            'inline-confirm-commit',
            confirmTone === 'danger' && 'is-danger',
            confirmClassName,
          )}
          disabled={!open || busy}
          tabIndex={open ? 0 : -1}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
