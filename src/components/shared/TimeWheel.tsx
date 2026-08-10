import { useCallback, useEffect, useId, useLayoutEffect, useRef, type UIEvent } from 'react'
import { useI18n } from '../hooks/useI18n'

const TIME_WHEEL_ROW_HEIGHT = 32
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute)

type TimeParts = {
  hour: number
  minute: number
}

function parseTimeValue(value: string): TimeParts | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function formatTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Keep the wheel useful while a user is still typing a partial numeric value. */
function previewTimeValue(value: string, fallback: TimeParts = { hour: 9, minute: 0 }): TimeParts {
  const complete = parseTimeValue(value)
  if (complete) return complete

  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (!digits) return fallback
  const padded = digits.padEnd(4, '0')
  return {
    hour: Math.min(23, Number(padded.slice(0, 2))),
    minute: Math.min(59, Number(padded.slice(2, 4))),
  }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Odd number of repetitions of the value list. The wheel lives in the middle
 * copy and is silently re-centred whenever a scroll drifts into an outer one,
 * so 59 is followed by 00 in both directions and the list never hits an end.
 */
const LOOP_COPIES = 5
const MIDDLE_COPY = (LOOP_COPIES - 1) / 2

function WheelColumn({
  label,
  values,
  selectedValue,
  onSelect,
}: {
  label: string
  values: number[]
  selectedValue: number
  onSelect: (value: number) => void
}) {
  const optionsRef = useRef<HTMLDivElement>(null)
  const settleTimerRef = useRef<number | null>(null)
  const skipNextScrollRef = useRef(true)
  const programmaticScrollUntilRef = useRef(0)
  const cycle = values.length
  const middleOffset = MIDDLE_COPY * cycle

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior) => {
    const options = optionsRef.current
    if (!options) return
    const top = index * TIME_WHEEL_ROW_HEIGHT
    const nextBehavior = prefersReducedMotion() ? 'auto' : behavior
    programmaticScrollUntilRef.current = performance.now() + (nextBehavior === 'smooth' ? 360 : 60)
    try {
      options.scrollTo({ top, behavior: nextBehavior })
    } catch {
      options.scrollTop = top
    }
  }, [])

  // Keep the wheel on whichever copy it is already showing so a value change
  // never yanks it back across four copies of the same numbers.
  const scrollToValue = useCallback((value: number, behavior: ScrollBehavior) => {
    const options = optionsRef.current
    const currentIndex = options
      ? Math.round(options.scrollTop / TIME_WHEEL_ROW_HEIGHT)
      : middleOffset
    const currentCopy = Math.min(
      LOOP_COPIES - 1,
      Math.max(0, Math.floor(currentIndex / cycle)),
    )
    const candidates = [currentCopy - 1, currentCopy, currentCopy + 1]
      .filter((copy) => copy >= 0 && copy < LOOP_COPIES)
      .map((copy) => copy * cycle + value)
    const nearest = candidates.reduce(
      (best, index) => (Math.abs(index - currentIndex) < Math.abs(best - currentIndex) ? index : best),
      candidates[0] ?? middleOffset + value,
    )
    scrollToIndex(nearest, behavior)
  }, [cycle, middleOffset, scrollToIndex])

  useLayoutEffect(() => {
    if (!skipNextScrollRef.current) return
    scrollToIndex(middleOffset + selectedValue, 'auto')
  }, [middleOffset, scrollToIndex, selectedValue])

  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false
      return
    }
    scrollToValue(selectedValue, 'smooth')
  }, [scrollToValue, selectedValue])

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
  }, [])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (performance.now() < programmaticScrollUntilRef.current) return
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    const options = event.currentTarget
    const scrollTop = options.scrollTop
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      const rawIndex = Math.round(scrollTop / TIME_WHEEL_ROW_HEIGHT)
      const boundedIndex = Math.min(cycle * LOOP_COPIES - 1, Math.max(0, rawIndex))
      const valueIndex = ((boundedIndex % cycle) + cycle) % cycle

      // Recentre before the wheel can reach a real end. The rows are identical
      // across copies, so the jump is invisible.
      if (boundedIndex < cycle || boundedIndex >= cycle * (LOOP_COPIES - 1)) {
        programmaticScrollUntilRef.current = performance.now() + 120
        const previousBehavior = options.style.scrollBehavior
        options.style.scrollBehavior = 'auto'
        options.scrollTop = (middleOffset + valueIndex) * TIME_WHEEL_ROW_HEIGHT
        options.style.scrollBehavior = previousBehavior
      }

      onSelect(values[valueIndex])
    }, 80)
  }

  return (
    <div className="time-wheel-column" aria-label={label}>
      <span className="time-wheel-column-label">{label}</span>
      <div className="time-wheel-column-shell">
        <div
          ref={optionsRef}
          className="time-wheel-options"
          role="listbox"
          aria-label={label}
          onScroll={handleScroll}
        >
          <span className="time-wheel-spacer" aria-hidden="true" />
          {Array.from({ length: cycle * LOOP_COPIES }, (_, index) => {
            const value = values[index % cycle]
            const formatted = String(value).padStart(2, '0')
            const selected = value === selectedValue
            return (
              <button
                key={index}
                type="button"
                role="option"
                aria-selected={selected}
                // Only the middle copy is announced; the rest are visual runway.
                aria-hidden={Math.floor(index / cycle) === MIDDLE_COPY ? undefined : true}
                tabIndex={Math.floor(index / cycle) === MIDDLE_COPY ? undefined : -1}
                className={`time-wheel-option${selected ? ' selected' : ''}`}
                onClick={() => {
                  scrollToIndex(index, 'smooth')
                  onSelect(value)
                }}
              >
                {formatted}
              </button>
            )
          })}
          <span className="time-wheel-spacer" aria-hidden="true" />
        </div>
        <span className="time-wheel-selection-window" aria-hidden="true" />
      </div>
    </div>
  )
}

export function TimeWheel({
  value,
  onChange,
  onNow,
  onClear,
  allowClear = false,
}: {
  value: string
  onChange: (value: string) => void
  onNow?: () => void
  onClear?: () => void
  allowClear?: boolean
}) {
  const { tx } = useI18n()
  const wheelId = useId()
  const selected = previewTimeValue(value)

  const setHour = (hour: number) => onChange(formatTimeValue(hour, selected.minute))
  const setMinute = (minute: number) => onChange(formatTimeValue(selected.hour, minute))

  return (
    <div className="time-wheel" id={wheelId}>
      <div className="time-wheel-columns">
        <WheelColumn
          label={tx('timePicker.hour')}
          values={HOURS}
          selectedValue={selected.hour}
          onSelect={setHour}
        />
        <WheelColumn
          label={tx('timePicker.minute')}
          values={MINUTES}
          selectedValue={selected.minute}
          onSelect={setMinute}
        />
      </div>
      {(onNow || (allowClear && onClear)) ? (
        <div className="time-wheel-footer">
          {onNow ? (
            <button type="button" className="time-wheel-now-btn" onClick={onNow}>
              {tx('timePicker.now')}
            </button>
          ) : null}
          {allowClear && onClear ? (
            <button type="button" className="time-wheel-clear-btn" onClick={onClear}>
              {tx('timePicker.clear')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
