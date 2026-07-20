import { LoaderCircle, Mail, Send, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function InlineTestEmailAction({
  defaultEmail,
  disabled = false,
  openLabel,
  inputLabel,
  inputPlaceholder,
  sendLabel,
  cancelLabel,
  sendingLabel,
  invalidEmailLabel,
  onSend,
  onBusyChange,
  className = '',
}: {
  defaultEmail?: string
  disabled?: boolean
  openLabel: string
  inputLabel: string
  inputPlaceholder: string
  sendLabel: string
  cancelLabel: string
  sendingLabel: string
  invalidEmailLabel: string
  onSend: (email: string) => Promise<void> | void
  onBusyChange?: (busy: boolean) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (!editing) setEmail(defaultEmail ?? '')
  }, [defaultEmail, editing])

  useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editing])

  const close = () => {
    if (sending) return
    inputRef.current?.setCustomValidity('')
    setEmail(defaultEmail ?? '')
    setEditing(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const delivery = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(delivery)) {
      inputRef.current?.setCustomValidity(invalidEmailLabel)
      inputRef.current?.reportValidity()
      return
    }
    inputRef.current?.setCustomValidity('')
    setSending(true)
    onBusyChange?.(true)
    try {
      await onSend(delivery)
      setEditing(false)
    } catch {
      inputRef.current?.focus()
    } finally {
      setSending(false)
      onBusyChange?.(false)
    }
  }

  return (
    <div className={`inline-test-email${editing ? ' is-editing' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="quiet-action compact-action test-action inline-test-email-trigger"
        onClick={() => setEditing(true)}
        disabled={disabled || sending}
        tabIndex={editing ? -1 : 0}
        aria-hidden={editing}
        title={disabled ? undefined : openLabel}
      >
        <Mail size={12} aria-hidden="true" />
        <span>{openLabel}</span>
      </button>

      <form className="inline-test-email-form" onSubmit={(event) => void submit(event)} aria-hidden={!editing}>
        <label className="sr-only" htmlFor={inputId}>{inputLabel}</label>
        <input
          ref={inputRef}
          id={inputId}
          type="email"
          value={email}
          onChange={(event) => {
            event.currentTarget.setCustomValidity('')
            setEmail(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close()
          }}
          placeholder={inputPlaceholder}
          autoComplete="email"
          disabled={!editing || sending}
          tabIndex={editing ? 0 : -1}
          required
        />
        <button
          type="submit"
          className="quiet-action compact-action inline-test-email-send"
          disabled={!editing || sending}
          tabIndex={editing ? 0 : -1}
          title={sendLabel}
        >
          {sending ? <LoaderCircle size={12} className="spin-icon" aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
          <span>{sending ? sendingLabel : sendLabel}</span>
        </button>
        <button
          type="button"
          className="icon-action inline-test-email-cancel"
          onClick={close}
          disabled={!editing || sending}
          tabIndex={editing ? 0 : -1}
          title={cancelLabel}
          aria-label={cancelLabel}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}
