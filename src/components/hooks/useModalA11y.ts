import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]'
const modalStack: Array<{ dialog: RefObject<HTMLElement | null> }> = []

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled')) return false
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

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
    const owner = { dialog: dialogRef }
    // React mounts child effects first. A parent opened in the same commit
    // belongs below its already-registered nested dialog.
    const childIndex = modalStack.findIndex((entry) => (
      entry.dialog.current && dialogRef.current?.contains(entry.dialog.current)
    ))
    if (childIndex < 0) modalStack.push(owner)
    else modalStack.splice(childIndex, 0, owner)
    const isTopModal = () => modalStack[modalStack.length - 1] === owner
    const previousFocus = document.activeElement as HTMLElement | null
    let initialFocusPending = true
    // Let the overlay's cheap opacity/transform layer paint first. Focusing a
    // control can trigger style, layout and virtual-keyboard work; doing that in
    // the same commit made large dialogs visibly miss their first animation frame.
    const focusFrame = window.requestAnimationFrame(() => {
      initialFocusPending = false
      const dialog = dialogRef.current
      if (!dialog || !isTopModal() || dialog.contains(document.activeElement)) return
      const target = initialFocusRefRef.current?.current ?? focusableElements(dialog)[0]
      target?.focus({ preventScroll: true })
    })

    function handleKey(event: KeyboardEvent) {
      if (!isTopModal() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      const dialog = dialogRef.current
      if (!dialog) return
      const target = event.target instanceof HTMLElement ? event.target : null
      // Portaled menus/editors own their keys before the surrounding dialog.
      const escapeFromOpeningTrigger = initialFocusPending && event.key === 'Escape' && target === previousFocus
      if (target && target !== document.body && !dialog.contains(target) && !escapeFromOpeningTrigger) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      const onConfirmCurrent = onConfirmRef.current
      const ownsEnter = target?.closest(
        'button, a[href], textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="combobox"], [role="listbox"], [role="menu"]',
      )
      if (onConfirmCurrent && event.key === 'Enter' && !ownsEnter && !event.repeat) {
        event.preventDefault()
        onConfirmCurrent()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = focusableElements(dialog)

      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => {
      const ownedFocus = isTopModal()
      const index = modalStack.indexOf(owner)
      if (index >= 0) modalStack.splice(index, 1)
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKey)
      if (ownedFocus && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true })
    }
  }, [open])

  return dialogRef
}
