import { Clock } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import {
  addFloatingViewportListeners,
  applyFloatingOverlayStyle,
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
} from './floatingOverlay'
import { TimeWheel } from './TimeWheel'

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function normalizeTypedTime(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function TimePicker({
  value,
  onChange,
  placeholder,
  ariaLabel,
  allowClear = true,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  allowClear?: boolean
}) {
  const { tx } = useI18n()
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [draftValue, setDraftValue] = useState(value)
  const [editing, setEditing] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const [positionReady, setPositionReady] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const positionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const ignoreOutsideUntilRef = useRef(0)
  const openVisible = open && !exiting
  const displayPlaceholder = placeholder ?? tx('timePicker.placeholder')
  const label = ariaLabel ?? tx('timePicker.toggle')

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(rootRef.current, {
      minWidth: 218,
      maxWidth: 218,
      estimatedHeight: 246,
      actualHeight: dropdownRef.current?.offsetHeight,
      baseZIndex: FLOATING_CONTROL_BASE_Z_INDEX,
    })
  }, [])

  const updateDropdownPosition = useCallback(() => {
    const nextStyle = getDropdownPosition()
    const dropdown = dropdownRef.current
    if (!dropdown) {
      setDropdownStyle(nextStyle)
      return
    }
    applyFloatingOverlayStyle(dropdown, nextStyle)
  }, [getDropdownPosition])

  const scheduleDropdownPosition = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      updateDropdownPosition()
    })
  }, [updateDropdownPosition])

  const openPicker = useCallback(() => {
    // Focus and click both fire for the same input gesture. Once the panel is
    // already visible, keep its measured frame instead of hiding/restarting
    // the entrance path on the second event.
    if (openVisible) {
      setEditing(true)
      return
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    ignoreOutsideUntilRef.current = performance.now() + 120
    setDropdownStyle({ visibility: 'hidden' })
    setPositionReady(false)
    setEditing(true)
    setExiting(false)
    setOpen(true)
  }, [openVisible])

  const closePicker = useCallback(() => {
    if (!open || exiting) return
    setExiting(true)
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setExiting(false)
      setPositionReady(false)
      setDropdownStyle({ visibility: 'hidden' })
    }, getMotionDelay(150))
  }, [exiting, open])

  const togglePicker = useCallback(() => {
    if (openVisible) closePicker()
    else openPicker()
  }, [closePicker, openPicker, openVisible])

  const selectTime = (nextValue: string) => {
    setDraftValue(nextValue)
    onChange(nextValue)
    setEditing(true)
  }

  const commitTypedTime = () => {
    const digits = draftValue.replace(/\D/g, '')
    if (!digits) {
      setDraftValue('')
      onChange('')
      setEditing(false)
      return
    }
    const padded = digits.padEnd(4, '0').slice(0, 4)
    const hour = Math.min(23, Number(padded.slice(0, 2)))
    const minute = Math.min(59, Number(padded.slice(2, 4)))
    const nextValue = formatTime(hour, minute)
    setDraftValue(nextValue)
    onChange(nextValue)
    setEditing(false)
  }

  const updateTypedTime = (rawValue: string) => {
    const nextValue = normalizeTypedTime(rawValue)
    setDraftValue(nextValue)
    if (!nextValue) {
      onChange('')
      return
    }
    if (parseTime(nextValue)) {
      onChange(nextValue)
    }
  }

  useEffect(() => {
    if (!editing) setDraftValue(value)
  }, [editing, value])

  // The time picker can open above a narrow viewport. Position it once the
  // portal has a real box so its compositor entrance is not visibly corrected
  // on the next frame, and follow any content-height change without a jump.
  useLayoutEffect(() => {
    if (!open || positionReady || !dropdownRef.current) return undefined
    setDropdownStyle(getDropdownPosition())
    setPositionReady(true)
  }, [getDropdownPosition, open, positionReady])

  useEffect(() => {
    if (!open || !positionReady) return undefined
    const dropdown = dropdownRef.current
    if (!dropdown || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => scheduleDropdownPosition())
    observer.observe(dropdown)
    return () => observer.disconnect()
  }, [open, positionReady, scheduleDropdownPosition])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open || exiting || !positionReady) return undefined
    function handleClick(event: MouseEvent) {
      if (performance.now() < ignoreOutsideUntilRef.current) return
      const target = event.target as Node
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        closePicker()
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closePicker()
    }
    const attachTimer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true)
    }, 0)
    document.addEventListener('keydown', handleKey)
    const removeViewportListeners = addFloatingViewportListeners(scheduleDropdownPosition)
    return () => {
      window.clearTimeout(attachTimer)
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey)
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [closePicker, exiting, open, positionReady, scheduleDropdownPosition])

  return (
    <div
      className="time-picker-root"
      ref={rootRef}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="time-picker-input-wrap">
        <input
          type="text"
          inputMode="numeric"
          value={draftValue}
          placeholder={displayPlaceholder}
          onFocus={openPicker}
          onMouseDown={() => {
            ignoreOutsideUntilRef.current = performance.now() + 120
          }}
          onClick={openPicker}
          onBlur={commitTypedTime}
          onChange={(event) => updateTypedTime(event.target.value)}
          className="time-picker-display"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={openVisible}
        />
        <button
          type="button"
          className="time-picker-icon"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            togglePicker()
          }}
          aria-label={tx('timePicker.toggle')}
          aria-expanded={openVisible}
        >
          <Clock size={14} aria-hidden="true" />
        </button>
      </div>

      {open && createPortal(
        <div
          className={`time-picker-dropdown ${exiting ? 'time-picker-exit' : ''}`}
          ref={dropdownRef}
          style={dropdownStyle}
          data-floating-overlay="true"
          role="dialog"
          aria-label={label}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <TimeWheel
            value={draftValue}
            onChange={selectTime}
            onNow={() => {
              const now = new Date()
              selectTime(formatTime(now.getHours(), now.getMinutes()))
            }}
            onClear={allowClear && value ? () => {
              setDraftValue('')
              setEditing(false)
              onChange('')
              closePicker()
            } : undefined}
            allowClear={allowClear && Boolean(value)}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
