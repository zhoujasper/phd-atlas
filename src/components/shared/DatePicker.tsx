import { ChevronLeft, ChevronRight, Calendar, Clock } from 'lucide-react'
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { localeForLanguage } from '../../i18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import {
  addFloatingViewportListeners,
  applyFloatingOverlayStyle,
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
} from './floatingOverlay'
import { TimeWheel } from './TimeWheel'

function localizedMonths(locale: string): string[] {
  return Array.from({ length: 12 }, (_, month) => (
    new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2020, month, 1))
  ))
}

function localizedWeekdays(locale: string): string[] {
  // 2020-01-05 is a Sunday — walk 7 days for the header row.
  const start = new Date(2020, 0, 5)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(day)
  })
}

type PickerMode = 'calendar' | 'month' | 'year'

function getDaysMatrix(year: number, month: number): Array<Date | null> {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = firstDay.getDay()
  const cells: Array<Date | null> = []

  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d))
  // Pad to fill remaining cells so total is multiple of 7
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseYMD(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00`)
  return isNaN(d.getTime()) ? null : d
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isCompleteTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(value)
}

function normalizeTypedTime(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function commitTypedTime(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  const padded = digits.padEnd(4, '0').slice(0, 4)
  const hour = Math.min(23, Number(padded.slice(0, 2)))
  const minute = Math.min(59, Number(padded.slice(2, 4)))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  min,
  max,
  allowClear = false,
  timeValue,
  onTimeChange,
  timeAriaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  min?: string
  max?: string
  allowClear?: boolean
  /** When supplied, specific time lives in the calendar footer rather than in a second popover. */
  timeValue?: string
  onTimeChange?: (value: string) => void
  timeAriaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())
  const [mode, setMode] = useState<PickerMode>('calendar')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const [positionReady, setPositionReady] = useState(false)
  const [timeDraft, setTimeDraft] = useState(timeValue ?? '')
  const [timeEditing, setTimeEditing] = useState(false)
  const [timeWheelOpen, setTimeWheelOpen] = useState(false)
  const [timeWheelExiting, setTimeWheelExiting] = useState(false)
  const [timeWheelStyle, setTimeWheelStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const [timeWheelPositionReady, setTimeWheelPositionReady] = useState(false)
  const { lang, tx } = useI18n()
  const dateLocale = localeForLanguage(lang)
  const MONTHS_SHORT = useMemo(() => localizedMonths(dateLocale), [dateLocale])
  const DAYS_HEADER = useMemo(() => localizedWeekdays(dateLocale), [dateLocale])
  const todayLabel = tx('datePicker.today')
  const clearLabel = tx('datePicker.clear')
  const displayPlaceholder = placeholder ?? tx('datePicker.placeholder')
  const supportsTime = typeof onTimeChange === 'function'
  const timeLabel = timeAriaLabel ?? tx('timePicker.toggle')
  const timePlaceholder = tx('timePicker.placeholder')

  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const timeFieldRef = useRef<HTMLLabelElement>(null)
  const timeWheelDropdownRef = useRef<HTMLDivElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const timeWheelPositionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const timeWheelCloseTimerRef = useRef<number | null>(null)
  /** Ignore outside closes until after the open gesture finishes (same-click races). */
  const ignoreOutsideUntilRef = useRef(0)
  const openVisible = open && !exiting
  const timeWheelVisible = timeWheelOpen && !timeWheelExiting

  const selectedDate = parseYMD(value)
  const minDate = min ? parseYMD(min) : null
  const maxDate = max ? parseYMD(max) : null
  const today = new Date()

  const selectedTime = isCompleteTime(timeValue ?? '') ? timeValue!.trim() : ''
  const displayValue = selectedDate
    ? `${selectedDate.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', year: 'numeric' })}${selectedTime ? ` · ${selectedTime}` : ''}`
    : ''

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(containerRef.current, {
      minWidth: 252,
      maxWidth: 252,
      estimatedHeight: supportsTime ? 366 : 330,
      actualHeight: dropdownRef.current?.offsetHeight,
      baseZIndex: FLOATING_CONTROL_BASE_Z_INDEX,
    })
  }, [supportsTime])

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

  const getTimeWheelPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(timeFieldRef.current, {
      minWidth: 218,
      maxWidth: 218,
      estimatedHeight: 246,
      actualHeight: timeWheelDropdownRef.current?.offsetHeight,
      baseZIndex: FLOATING_CONTROL_BASE_Z_INDEX,
    })
  }, [])

  const updateTimeWheelPosition = useCallback(() => {
    const nextStyle = getTimeWheelPosition()
    const dropdown = timeWheelDropdownRef.current
    if (!dropdown) {
      setTimeWheelStyle(nextStyle)
      return
    }
    applyFloatingOverlayStyle(dropdown, nextStyle)
  }, [getTimeWheelPosition])

  const scheduleTimeWheelPosition = useCallback(() => {
    if (timeWheelPositionFrameRef.current !== null) return
    timeWheelPositionFrameRef.current = window.requestAnimationFrame(() => {
      timeWheelPositionFrameRef.current = null
      updateTimeWheelPosition()
    })
  }, [updateTimeWheelPosition])

  const openCalendar = useCallback(() => {
    const d = selectedDate || new Date()
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    // Suppress outside-dismiss for the remainder of this pointer/focus gesture.
    ignoreOutsideUntilRef.current = performance.now() + 120
    setDropdownStyle({ visibility: 'hidden' })
    setPositionReady(false)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setMode('calendar')
    setExiting(false)
    setOpen(true)
  }, [selectedDate])

  const closeTimeWheel = useCallback(() => {
    if (!timeWheelOpen || timeWheelExiting) return
    if (timeWheelCloseTimerRef.current !== null) {
      window.clearTimeout(timeWheelCloseTimerRef.current)
      timeWheelCloseTimerRef.current = null
    }
    setTimeWheelExiting(true)
    timeWheelCloseTimerRef.current = window.setTimeout(() => {
      timeWheelCloseTimerRef.current = null
      setTimeWheelOpen(false)
      setTimeWheelExiting(false)
      setTimeWheelPositionReady(false)
      setTimeWheelStyle({ visibility: 'hidden' })
    }, getMotionDelay(150))
  }, [timeWheelExiting, timeWheelOpen])

  const openTimeWheel = useCallback(() => {
    if (timeWheelVisible) {
      setTimeEditing(true)
      return
    }
    if (timeWheelCloseTimerRef.current !== null) {
      window.clearTimeout(timeWheelCloseTimerRef.current)
      timeWheelCloseTimerRef.current = null
    }
    ignoreOutsideUntilRef.current = performance.now() + 120
    setTimeWheelStyle({ visibility: 'hidden' })
    setTimeWheelPositionReady(false)
    setTimeWheelExiting(false)
    setTimeEditing(true)
    setTimeWheelOpen(true)
  }, [timeWheelVisible])

  const closeCalendar = useCallback(() => {
    if (!open || exiting) return
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setExiting(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setExiting(false)
      setPositionReady(false)
      setDropdownStyle({ visibility: 'hidden' })
    }, getMotionDelay(150))
    closeTimeWheel()
  }, [closeTimeWheel, exiting, open])

  const toggleCalendar = useCallback(() => {
    if (openVisible) closeCalendar()
    else openCalendar()
  }, [closeCalendar, openCalendar, openVisible])

  useEffect(() => {
    if (!open || exiting) return undefined
    function handleClick(e: MouseEvent) {
      if (performance.now() < ignoreOutsideUntilRef.current) return
      const target = e.target as Node
      const insideTrigger = containerRef.current?.contains(target) ?? false
      const insideCalendar = dropdownRef.current?.contains(target) ?? false
      const insideTimeWheel = timeWheelDropdownRef.current?.contains(target) ?? false
      if (!insideTrigger && !insideCalendar && !insideTimeWheel) {
        closeCalendar()
      }
    }
    // Defer attachment so the opening click cannot immediately dismiss.
    const attachTimer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true)
    }, 0)
    return () => {
      window.clearTimeout(attachTimer)
      document.removeEventListener('mousedown', handleClick, true)
    }
  }, [open, exiting, closeCalendar])

  // Listen for resize/scroll to keep position updated
  useEffect(() => {
    if (!open || !positionReady) return
    const removeViewportListeners = addFloatingViewportListeners(scheduleDropdownPosition)
    return () => {
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [open, positionReady, scheduleDropdownPosition])

  // Do not let the first visible frame inherit the trigger position while the
  // portal is still measuring. The observer also handles month/year views that
  // change the calendar's real height while it is flipped above the field.
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

  useEffect(() => {
    if (!timeWheelOpen || !timeWheelPositionReady) return undefined
    const removeViewportListeners = addFloatingViewportListeners(scheduleTimeWheelPosition)
    return () => {
      removeViewportListeners()
      if (timeWheelPositionFrameRef.current !== null) {
        window.cancelAnimationFrame(timeWheelPositionFrameRef.current)
        timeWheelPositionFrameRef.current = null
      }
    }
  }, [scheduleTimeWheelPosition, timeWheelOpen, timeWheelPositionReady])

  useLayoutEffect(() => {
    if (!timeWheelOpen || timeWheelPositionReady || !timeWheelDropdownRef.current) return undefined
    setTimeWheelStyle(getTimeWheelPosition())
    setTimeWheelPositionReady(true)
  }, [getTimeWheelPosition, timeWheelOpen, timeWheelPositionReady])

  useEffect(() => {
    if (!timeWheelOpen || !timeWheelPositionReady) return undefined
    const dropdown = timeWheelDropdownRef.current
    if (!dropdown || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => scheduleTimeWheelPosition())
    observer.observe(dropdown)
    return () => observer.disconnect()
  }, [scheduleTimeWheelPosition, timeWheelOpen, timeWheelPositionReady])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    if (timeWheelCloseTimerRef.current !== null) window.clearTimeout(timeWheelCloseTimerRef.current)
  }, [])

  useEffect(() => {
    if (!timeEditing) setTimeDraft(timeValue ?? '')
  }, [timeEditing, timeValue])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (timeWheelVisible) { closeTimeWheel(); return }
        if (mode !== 'calendar') { setMode('calendar'); return }
        closeCalendar()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [closeCalendar, closeTimeWheel, mode, open, timeWheelVisible])

  const days = useMemo(() => getDaysMatrix(viewYear, viewMonth), [viewYear, viewMonth])

  const navMonth = (delta: number) => {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewYear(y)
    setViewMonth(m)
  }

  const selectDate = (date: Date) => {
    if (minDate && date < minDate) return
    if (maxDate && date > maxDate) return
    onChange(formatYMD(date))
    // When a time is part of this field, keep the calendar resident after a
    // day choice so the next natural action is typing the time at its lower
    // right edge. Date-only controls retain their quick select-and-close path.
    if (!supportsTime) closeCalendar()
  }

  const updateTimeDraft = (rawValue: string) => {
    const nextValue = normalizeTypedTime(rawValue)
    setTimeDraft(nextValue)
    if (!nextValue || isCompleteTime(nextValue)) onTimeChange?.(nextValue)
  }

  const finalizeTimeDraft = () => {
    const nextValue = commitTypedTime(timeDraft)
    setTimeDraft(nextValue)
    onTimeChange?.(nextValue)
    setTimeEditing(false)
  }

  const updateTimeFromWheel = (nextValue: string) => {
    setTimeDraft(nextValue)
    setTimeEditing(true)
    onTimeChange?.(nextValue)
  }

  const setCurrentTime = () => {
    const now = new Date()
    updateTimeFromWheel(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
  }

  const clearTime = () => {
    setTimeDraft('')
    setTimeEditing(false)
    onTimeChange?.('')
    closeTimeWheel()
  }

  const clearSelection = () => {
    onChange('')
    onTimeChange?.('')
    setTimeDraft('')
    closeCalendar()
  }

  const isDisabled = (date: Date) =>
    (minDate && date < minDate) || (maxDate && date > maxDate) || false

  const selectMonth = (m: number) => {
    setViewMonth(m)
    setMode('calendar')
  }

  const selectYear = (y: number) => {
    setViewYear(y)
    setMode('month')
  }

  // Generate year range centered on viewYear
  const yearStart = Math.floor(viewYear / 12) * 12
  const years = Array.from({ length: 12 }, (_, i) => yearStart + i)

  return (
    <div
      className="date-picker-root"
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      onMouseDown={(event) => {
        // Prevent parent <label> from stealing focus / re-triggering toggles.
        event.stopPropagation()
      }}
    >
      <div className="date-picker-input-wrap">
          <input
            type="text"
            readOnly
            value={displayValue}
            placeholder={displayPlaceholder}
          onMouseDown={(event) => {
            // Prefer pointer-down open so focus+click races cannot cancel open.
            event.preventDefault()
            openCalendar()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              event.preventDefault()
              openCalendar()
            }
          }}
            className="date-picker-display"
            aria-label={placeholder}
            aria-haspopup="dialog"
            aria-expanded={openVisible}
        />
        <button
          type="button"
          className="date-picker-icon"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            toggleCalendar()
          }}
          aria-label={tx('datePicker.toggle')}
          aria-expanded={openVisible}
        >
          <Calendar size={14} aria-hidden="true" />
        </button>
      </div>

      {open && createPortal(
        <div
          className={`date-picker-dropdown ${exiting ? 'date-picker-exit' : ''}`}
          ref={dropdownRef}
          style={dropdownStyle}
          data-floating-overlay="true"
          onMouseDown={(event) => {
            // Keep focus/outside handlers from treating in-panel clicks as dismiss.
            event.stopPropagation()
          }}
        >
          {/* Header with clickable month/year */}
          <div className="date-picker-header">
            <button type="button" className="date-picker-nav" onClick={() => navMonth(-1)} aria-label={tx('datePicker.previousMonth')}>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <div className="date-picker-header-center">
              <button type="button" className="date-picker-header-btn" onClick={() => setMode('month')}>
                {MONTHS_SHORT[viewMonth]}
              </button>
              <button type="button" className="date-picker-header-btn" onClick={() => setMode('year')}>
                {viewYear}
              </button>
            </div>
            <button type="button" className="date-picker-nav" onClick={() => navMonth(1)} aria-label={tx('datePicker.nextMonth')}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Calendar mode */}
          {mode === 'calendar' && (
            <>
              <div className="date-picker-weekdays">
                {DAYS_HEADER.map((d, index) => <span key={`${d}-${index}`} className="date-picker-weekday">{d}</span>)}
              </div>
              <div className="date-picker-grid">
                {days.map((date, idx) => {
                  if (!date) return <span key={`e-${idx}`} className="date-picker-day empty" />
                  const disabled = isDisabled(date)
                  const selected = selectedDate ? sameDay(date, selectedDate) : false
                  const isToday = sameDay(date, today)
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`date-picker-day${selected ? ' selected' : ''}${isToday && !selected ? ' today' : ''}${disabled ? ' disabled' : ''}`}
                      onClick={() => selectDate(date)}
                      disabled={disabled}
                      aria-label={date.toLocaleDateString(dateLocale, { month: 'long', day: 'numeric' })}
                    >
                      {date.getDate()}
                    </button>
                  )
                })}
              </div>
              <div className="date-picker-footer">
                <span className="date-picker-footer-start">
                  <button type="button" className="date-picker-today-btn" onClick={() => selectDate(new Date())}>{todayLabel}</button>
                  {allowClear && value ? (
                    <button type="button" className="date-picker-clear-btn" onClick={clearSelection}>{clearLabel}</button>
                  ) : null}
                </span>
                {supportsTime ? (
                  <label className="date-picker-time-field" ref={timeFieldRef}>
                    <Clock size={12} aria-hidden="true" />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={timeDraft}
                      placeholder={timePlaceholder}
                      aria-label={timeLabel}
                      aria-haspopup="dialog"
                      aria-expanded={timeWheelVisible}
                      onFocus={openTimeWheel}
                      onMouseDown={() => {
                        ignoreOutsideUntilRef.current = performance.now() + 120
                      }}
                      onClick={openTimeWheel}
                      onChange={(event) => updateTimeDraft(event.target.value)}
                      onBlur={finalizeTimeDraft}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        finalizeTimeDraft()
                        closeCalendar()
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </>
          )}

          {/* Month picker */}
          {mode === 'month' && (
            <div className="date-picker-month-grid">
              {MONTHS_SHORT.map((m, idx) => (
                <button
                  key={m}
                  type="button"
                  className={`date-picker-month-btn${idx === viewMonth ? ' selected' : ''}`}
                  onClick={() => selectMonth(idx)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {/* Year picker */}
          {mode === 'year' && (
            <div className="date-picker-year-grid">
              <div className="date-picker-year-nav">
                <button type="button" className="date-picker-nav" onClick={() => setViewYear(viewYear - 12)} aria-label={tx('datePicker.previousYears')}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <span className="date-picker-year-range">{yearStart} – {yearStart + 11}</span>
                <button type="button" className="date-picker-nav" onClick={() => setViewYear(viewYear + 12)} aria-label={tx('datePicker.nextYears')}>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="date-picker-year-grid-inner">
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    className={`date-picker-year-btn${y === viewYear ? ' selected' : ''}${y === today.getFullYear() && y !== viewYear ? ' today' : ''}`}
                    onClick={() => selectYear(y)}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}

      {timeWheelOpen && supportsTime && createPortal(
        <div
          className={`date-time-wheel-dropdown ${timeWheelExiting ? 'time-wheel-exit' : ''}`}
          ref={timeWheelDropdownRef}
          style={timeWheelStyle}
          data-floating-overlay="true"
          role="dialog"
          aria-label={timeLabel}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <TimeWheel
            value={timeDraft}
            onChange={updateTimeFromWheel}
            onNow={setCurrentTime}
            onClear={clearTime}
            allowClear={Boolean(timeDraft)}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
