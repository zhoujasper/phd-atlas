import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Standard modal keyboard/focus behavior: focuses into the dialog on open, restores focus to
 * whatever had it on close, traps Tab within the dialog, closes on Escape, and (optionally)
 * confirms on Enter — skipped inside a textarea so multi-line notes still get real newlines.
 */
export function useModalA11y<T extends HTMLElement = HTMLElement>({
  open,
  onClose,
  onConfirm,
  initialFocusRef,
}: {
  open: boolean
  onClose: () => void
  onConfirm?: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
}): RefObject<T | null> {
  const dialogRef = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  const onConfirmRef = useRef(onConfirm)
  const initialFocusRefRef = useRef(initialFocusRef)

  useEffect(() => {
    onCloseRef.current = onClose
    onConfirmRef.current = onConfirm
    initialFocusRefRef.current = initialFocusRef
  }, [onClose, onConfirm, initialFocusRef])

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement as HTMLElement | null
    // Let the overlay's cheap opacity/transform layer paint first. Focusing a
    // control can trigger style, layout and virtual-keyboard work; doing that in
    // the same commit made large dialogs visibly miss their first animation frame.
    const focusFrame = window.requestAnimationFrame(() => {
      const target = initialFocusRefRef.current?.current
        ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      target?.focus({ preventScroll: true })
    })

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      const onConfirmCurrent = onConfirmRef.current
      if (onConfirmCurrent && event.key === 'Enter' && (event.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        event.preventDefault()
        onConfirmCurrent()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('disabled'))

      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKey)
      previousFocus?.focus?.({ preventScroll: true })
    }
  }, [open])

  return dialogRef
}
