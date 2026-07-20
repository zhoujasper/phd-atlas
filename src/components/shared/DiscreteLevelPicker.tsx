import type { CSSProperties } from 'react'
import { useId, useState } from 'react'

export type DiscreteLevelPickerProps = {
  label: string
  value: number
  options: readonly number[]
  onChange: (value: number) => void
  suffix?: string
}

export function DiscreteLevelPicker({
  label,
  value,
  options,
  onChange,
  suffix = '',
}: DiscreteLevelPickerProps) {
  const id = useId()
  const availableOptions = options.includes(value)
    ? [...options]
    : [...options, value].sort((a, b) => a - b)
  const selectedIndex = Math.max(0, availableOptions.indexOf(value))
  const [dragging, setDragging] = useState(false)
  const pickerStyle = {
    '--discover-level-count': availableOptions.length,
    '--discover-level-index': selectedIndex,
  } as CSSProperties

  return (
    <div className="discover-level-field">
      <div className="discover-level-heading">
        <span id={`${id}-label`}>{label}</span>
        <output aria-live="polite">{value}{suffix}</output>
      </div>
      <div
        className={`discover-level-picker${dragging ? ' is-dragging' : ''}`}
        style={pickerStyle}
      >
        <input
          className="discover-level-range"
          type="range"
          min={0}
          max={Math.max(0, availableOptions.length - 1)}
          step={1}
          value={selectedIndex}
          aria-labelledby={`${id}-label`}
          aria-valuetext={`${value}${suffix}`}
          onChange={(event) => onChange(availableOptions[Number(event.target.value)] ?? availableOptions[0])}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onBlur={() => setDragging(false)}
        />
        <span className="discover-level-indicator" aria-hidden="true" />
        <span className="discover-level-labels" aria-hidden="true">
          {availableOptions.map((option) => (
            <span className={option === value ? 'is-selected' : undefined} key={option}>{option}</span>
          ))}
        </span>
      </div>
    </div>
  )
}
