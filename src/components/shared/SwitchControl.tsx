import type { ButtonHTMLAttributes } from 'react'

/**
 * A compact Apple-style toggle switch.
 * Always pair with a visible text label — the `label` prop is used as `aria-label`.
 *
 * `variant` defaults to `"accent"` (blue). Use `"success"` for positive-sentiment
 * toggles like "Allow Registration" and `"danger"` for destructive toggles.
 */

export type SwitchVariant = 'accent' | 'success' | 'danger'

export function SwitchControl({
  checked,
  disabled,
  label,
  onChange,
  variant = 'accent',
  ...rest
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
  variant?: SwitchVariant
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'aria-checked' | 'role' | 'type'>) {
  const variantClass = `switch-${variant}`

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch-control ${variantClass}${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span aria-hidden="true" />
    </button>
  )
}
