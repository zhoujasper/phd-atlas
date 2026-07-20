import { useRef, useCallback, useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { PRIORITY_LEVELS } from '../../appModel'

const LAST_INDEX = PRIORITY_LEVELS.length - 1

const STOP_COLORS = [
  'var(--priority-very-low)',
  'var(--priority-low)',
  'var(--priority-medium)',
  'var(--priority-high)',
  'var(--priority-critical)',
]

function indexFromValue(value: number) {
  let idx = 0
  for (let i = PRIORITY_LEVELS.length - 1; i >= 0; i--) {
    if (value >= PRIORITY_LEVELS[i].value) {
      idx = i
      break
    }
  }
  return idx
}

export function PrioritySlider({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const { tx } = useI18n()
  const trackRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Stable ref — never causes effect re-runs
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const draggingRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const dragStartIdxRef = useRef(0)
  const dragLastIdxRef = useRef(0)
  const dragStartPositionRef = useRef<number | null>(null)
  const dragMovedRef = useRef(false)
  const suppressClickUntilRef = useRef(0)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const activeIdx = indexFromValue(value)
  const displayIdx = dragIdx ?? activeIdx

  const positionFromX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return null
    const rect = track.getBoundingClientRect()
    if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(clientX)) return null
    const inset = 3
    const innerWidth = Math.max(1, rect.width - inset * 2)
    const segmentWidth = innerWidth / PRIORITY_LEVELS.length
    const position = (clientX - rect.left - inset - segmentWidth / 2) / segmentWidth
    return Number.isFinite(position) ? Math.max(0, Math.min(LAST_INDEX, position)) : null
  }, [])

  const previewPosition = useCallback((position: number) => {
    indicatorRef.current?.style.setProperty('--priority-position', String(position))
    const idx = Math.max(0, Math.min(LAST_INDEX, Math.round(position)))
    dragLastIdxRef.current = idx
    setDragIdx((previous) => (previous === idx ? previous : idx))
    return idx
  }, [])

  const selectIndex = useCallback((idx: number) => {
    const clamped = Number.isFinite(idx) ? Math.max(0, Math.min(LAST_INDEX, idx)) : 0
    onChangeRef.current(PRIORITY_LEVELS[clamped].value)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    activePointerIdRef.current = e.pointerId
    draggingRef.current = true
    dragMovedRef.current = false
    const pointerPosition = positionFromX(e.clientX)
    dragStartPositionRef.current = pointerPosition
    dragStartIdxRef.current = activeIdx
    dragLastIdxRef.current = activeIdx
    setDragIdx(activeIdx)
  }, [activeIdx, positionFromX])

  // Stable global listeners — registered once, always read live drag state via refs
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
      const pointerPosition = positionFromX(e.clientX)
      if (pointerPosition === null) return
      const startPosition = dragStartPositionRef.current
      const moved = startPosition !== null
        ? Math.abs(pointerPosition - startPosition) > 0.06
        : Math.round(pointerPosition) !== dragStartIdxRef.current
      if (moved) {
        dragMovedRef.current = true
        previewPosition(pointerPosition)
      }
    }
    const endDrag = (e: PointerEvent) => {
      if (!draggingRef.current) return
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
      const pointerPosition = positionFromX(e.clientX)
      if (dragMovedRef.current) {
        const idx = pointerPosition === null ? dragLastIdxRef.current : previewPosition(pointerPosition)
        selectIndex(idx)
        suppressClickUntilRef.current = window.performance.now() + 250
      } else {
        indicatorRef.current?.style.setProperty('--priority-position', String(activeIdx))
      }
      activePointerIdRef.current = null
      dragStartPositionRef.current = null
      draggingRef.current = false
      setDragIdx(null)
    }
    const cancelDrag = (e: PointerEvent) => {
      if (!draggingRef.current) return
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
      activePointerIdRef.current = null
      dragStartPositionRef.current = null
      draggingRef.current = false
      dragMovedRef.current = false
      setDragIdx(null)
      indicatorRef.current?.style.setProperty('--priority-position', String(activeIdx))
    }
    window.addEventListener('pointermove', handleMove, { passive: true })
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', cancelDrag)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', cancelDrag)
    }
  }, [activeIdx, positionFromX, previewPosition, selectIndex])

  const handleOptionClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, idx: number) => {
    // PriorityPicker is commonly placed inside a field <label>. Prevent the
    // label's default activation from dispatching a second click to its first
    // button after this exact option has already handled the interaction.
    e.preventDefault()
    if (window.performance.now() < suppressClickUntilRef.current) {
      e.stopPropagation()
      suppressClickUntilRef.current = 0
      return
    }
    selectIndex(idx)
  }, [selectIndex])

  const handlePickerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (window.performance.now() >= suppressClickUntilRef.current) return
    // A drag that starts on one option and ends on another produces a click on
    // their common radiogroup ancestor. Cancel it so an enclosing <label> does
    // not activate the first option after the drag has already committed.
    e.preventDefault()
    e.stopPropagation()
    suppressClickUntilRef.current = 0
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const focusAndSelect = (next: number) => {
      const clamped = Math.max(0, Math.min(LAST_INDEX, next))
      selectIndex(clamped)
      optionRefs.current[clamped]?.focus()
    }
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        focusAndSelect(idx + 1)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        focusAndSelect(idx - 1)
        break
      case 'Home':
        e.preventDefault()
        focusAndSelect(0)
        break
      case 'End':
        e.preventDefault()
        focusAndSelect(LAST_INDEX)
        break
      default:
        break
    }
  }

  return (
    <div
      className={`priority-picker ${dragIdx !== null ? 'dragging' : ''}`}
      role="radiogroup"
      aria-label={tx('dossier.priority')}
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onClick={handlePickerClick}
      style={{ '--count': PRIORITY_LEVELS.length } as React.CSSProperties}
    >
      <div
        ref={indicatorRef}
        className="priority-picker-indicator"
        style={{ '--priority-position': activeIdx } as React.CSSProperties}
      />
      {PRIORITY_LEVELS.map((level, idx) => {
        const isActive = idx === displayIdx
        return (
          <button
            key={level.value}
            data-priority-index={idx}
            ref={(node) => { optionRefs.current[idx] = node }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`priority-picker-option ${isActive ? 'active' : ''}`}
            onClick={(e) => handleOptionClick(e, idx)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            style={isActive ? { color: STOP_COLORS[idx] } : undefined}
          >
            {tx(`settings.${level.key}`)}
          </button>
        )
      })}
    </div>
  )
}
