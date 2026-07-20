import { Clock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { addFloatingViewportListeners, getAnchoredOverlayStyle } from './floatingOverlay'

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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const positionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const ignoreOutsideUntilRef = useRef(0)
  const openVisible = open && !exiting
  const selected = parseTime(draftValue) ?? parseTime(value)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, minute) => minute), [])
  const displayPlaceholder = placeholder ?? tx('timePicker.placeholder')
  const label = ariaLabel ?? tx('timePicker.toggle')

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(rootRef.current, {
      minWidth: 196,
      maxWidth: 196,
      estimatedHeight: 290,
      actualHeight: dropdownRef.current?.getBoundingClientRect().height,
    })
  }, [])

  const updateDropdownPosition = useCallback(() => {
    setDropdownStyle(getDropdownPosition())
  }, [getDropdownPosition])

  const scheduleDropdownPosition = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      updateDropdownPosition()
    })
  }, [updateDropdownPosition])

  const openPicker = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    ignoreOutsideUntilRef.current = performance.now() + 120
    setDropdownStyle(getDropdownPosition())
    setEditing(true)
    setExiting(false)
    setOpen(true)
    window.requestAnimationFrame(() => setDropdownStyle(getDropdownPosition()))
  }, [getDropdownPosition])

  const closePicker = useCallback(() => {
    if (!open || exiting) return
    setExiting(true)
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setExiting(false)
    }, getMotionDelay(140))
  }, [exiting, open])

  const togglePicker = useCallback(() => {
    if (openVisible) closePicker()
    else openPicker()
  }, [closePicker, openPicker, openVisible])

  const selectTime = (hour: number, minute: number) => {
    const nextValue = formatTime(hour, minute)
    setDraftValue(nextValue)
    onChange(nextValue)
    setEditing(false)
    closePicker()
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

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open || exiting) return undefined
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
  }, [open, exiting, closePicker, scheduleDropdownPosition])

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
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="time-picker-columns">
            <div className="time-picker-column" aria-label={tx('timePicker.hour')}>
              <span>{tx('timePicker.hour')}</span>
              <div className="time-picker-options">
                {hours.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    className={selected?.hour === hour ? 'selected' : ''}
                    onClick={() => selectTime(hour, selected?.minute ?? 0)}
                  >
                    {String(hour).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-picker-column" aria-label={tx('timePicker.minute')}>
              <span>{tx('timePicker.minute')}</span>
              <div className="time-picker-options">
                {minutes.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    className={selected?.minute === minute ? 'selected' : ''}
                    onClick={() => selectTime(selected?.hour ?? 9, minute)}
                  >
                    {String(minute).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="time-picker-footer">
            <button
              type="button"
              className="time-picker-now-btn"
              onClick={() => {
                const now = new Date()
                selectTime(now.getHours(), now.getMinutes())
              }}
            >
              {tx('timePicker.now')}
            </button>
            {allowClear && value ? (
              <button type="button" className="time-picker-clear-btn" onClick={() => { setDraftValue(''); setEditing(false); onChange(''); closePicker() }}>
                {tx('timePicker.clear')}
              </button>
            ) : null}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
