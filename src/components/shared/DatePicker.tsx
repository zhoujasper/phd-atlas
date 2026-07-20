import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { localeForLanguage } from '../../i18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { addFloatingViewportListeners, getAnchoredOverlayStyle } from './floatingOverlay'

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

export function DatePicker({
  value,
  onChange,
  placeholder,
  min,
  max,
  allowClear = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  min?: string
  max?: string
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())
  const [mode, setMode] = useState<PickerMode>('calendar')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const { lang, tx } = useI18n()
  const dateLocale = localeForLanguage(lang)
  const MONTHS_SHORT = useMemo(() => localizedMonths(dateLocale), [dateLocale])
  const DAYS_HEADER = useMemo(() => localizedWeekdays(dateLocale), [dateLocale])
  const todayLabel = tx('datePicker.today')
  const clearLabel = tx('datePicker.clear')
  const displayPlaceholder = placeholder ?? tx('datePicker.placeholder')

  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  /** Ignore outside closes until after the open gesture finishes (same-click races). */
  const ignoreOutsideUntilRef = useRef(0)
  const openVisible = open && !exiting

  const selectedDate = parseYMD(value)
  const minDate = min ? parseYMD(min) : null
  const maxDate = max ? parseYMD(max) : null
  const today = new Date()

  const displayValue = selectedDate
    ? selectedDate.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(containerRef.current, {
      minWidth: 252,
      maxWidth: 252,
      estimatedHeight: 330,
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

  const openCalendar = useCallback(() => {
    const d = selectedDate || new Date()
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    // Suppress outside-dismiss for the remainder of this pointer/focus gesture.
    ignoreOutsideUntilRef.current = performance.now() + 120
    setDropdownStyle(getDropdownPosition())
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setMode('calendar')
    setExiting(false)
    setOpen(true)
    // Re-measure after paint — nested scroll layouts (fees form) can shift.
    window.requestAnimationFrame(() => {
      updateDropdownPosition()
    })
  }, [getDropdownPosition, selectedDate, updateDropdownPosition])

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
    }, getMotionDelay(140))
  }, [exiting, open])

  const toggleCalendar = useCallback(() => {
    if (openVisible) closeCalendar()
    else openCalendar()
  }, [closeCalendar, openCalendar, openVisible])

  useEffect(() => {
    if (!open || exiting) return undefined
    function handleClick(e: MouseEvent) {
      if (performance.now() < ignoreOutsideUntilRef.current) return
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
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
    if (!open) return
    const removeViewportListeners = addFloatingViewportListeners(scheduleDropdownPosition)
    return () => {
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [open, scheduleDropdownPosition])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode !== 'calendar') { setMode('calendar'); return }
        closeCalendar()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, closeCalendar, mode])

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
                {DAYS_HEADER.map((d) => <span key={d} className="date-picker-weekday">{d}</span>)}
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
                <button type="button" className="date-picker-today-btn" onClick={() => selectDate(new Date())}>{todayLabel}</button>
                {allowClear && value && (
                  <button type="button" className="date-picker-clear-btn" onClick={() => { onChange(''); closeCalendar() }}>{clearLabel}</button>
                )}
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
    </div>
  )
}
