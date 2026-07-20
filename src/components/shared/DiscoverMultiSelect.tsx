import { Check } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'

export function DiscoverMultiSelectOption({
  checked,
  label,
  onChange,
  compact = false,
}: {
  checked: boolean
  label: ReactNode
  onChange: (checked: boolean) => void
  compact?: boolean
}) {
  return (
    <label className={clsx('discover-multiselect-option', checked && 'is-selected', compact && 'is-compact')}>
      <input
        className="discover-checkbox-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="discover-multiselect-check" aria-hidden="true">
        <Check size={11} strokeWidth={2.4} />
      </span>
      <span className="discover-multiselect-label">{label}</span>
    </label>
  )
}
