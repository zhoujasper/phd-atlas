import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { addFloatingViewportListeners, getAnchoredOverlayStyle } from './floatingOverlay'

const focusableSelector = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function AnchoredPopover({
  trigger,
  triggerAriaLabel,
  popoverAriaLabel = triggerAriaLabel,
  triggerClassName = '',
  popoverClassName = '',
  width = 264,
  estimatedHeight = 260,
  align = 'start',
  onOpenChange,
  children,
}: {
  trigger: ReactNode
  triggerAriaLabel: string
  popoverAriaLabel?: string
  triggerClassName?: string
  popoverClassName?: string
  width?: number
  estimatedHeight?: number
  align?: 'start' | 'end'
  onOpenChange?: (open: boolean) => void
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const positionFrameRef = useRef<number | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  const popoverId = useId()

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  const setOpenState = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChangeRef.current?.(nextOpen)
  }, [])

  const getPopoverPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(triggerRef.current, {
      minWidth: width,
      maxWidth: width,
      estimatedHeight,
      actualHeight: popoverRef.current?.getBoundingClientRect().height,
      gap: 6,
      align,
    })
  }, [align, estimatedHeight, width])

  const updatePopoverPosition = useCallback(() => {
    setPopoverStyle(getPopoverPosition())
  }, [getPopoverPosition])

  const schedulePopoverPosition = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      updatePopoverPosition()
    })
  }, [updatePopoverPosition])

  const close = useCallback((restoreFocus = true) => {
    setOpenState(false)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [setOpenState])

  useEffect(() => {
    if (!open) return undefined
    const focusFrame = window.requestAnimationFrame(() => {
      const preferredFocus = popoverRef.current?.querySelector<HTMLElement>('[data-popover-autofocus]')
      const firstFocus = popoverRef.current?.querySelector<HTMLElement>(focusableSelector)
      ;(preferredFocus ?? firstFocus)?.focus()
    })

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
        return
      }
      if (event.key !== 'Tab' || !popoverRef.current?.contains(document.activeElement)) return
      const focusable = Array.from(popoverRef.current.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) return
      event.preventDefault()
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1)
      focusable[nextIndex]?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    const removeViewportListeners = addFloatingViewportListeners(schedulePopoverPosition)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [close, open, schedulePopoverPosition])

  return (
    <span className="anchored-popover-root">
      <button
        ref={triggerRef}
        type="button"
        className={`anchored-popover-trigger ${triggerClassName}${open ? ' open' : ''}`}
        onClick={() => {
          if (open) {
            close()
          } else {
            setPopoverStyle(getPopoverPosition())
            setOpenState(true)
          }
        }}
        aria-label={triggerAriaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        {trigger}
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          className={`anchored-popover ${popoverClassName}`}
          style={popoverStyle}
          role="dialog"
          aria-label={popoverAriaLabel}
        >
          {children(() => close())}
        </div>,
        document.body,
      ) : null}
    </span>
  )
}
