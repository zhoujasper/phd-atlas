import { memo } from 'react'

export type AnimatedCheckmarkVariant = 'circle' | 'square'

export const AnimatedCheckmark = memo(function AnimatedCheckmark({
  checked,
  variant = 'circle',
  size = 20,
  className = '',
}: {
  checked: boolean
  variant?: AnimatedCheckmarkVariant
  size?: number
  className?: string
}) {
  return (
    <svg
      className={`animated-checkmark is-${variant}${checked ? ' is-checked' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {variant === 'circle' ? (
        <circle className="animated-checkmark-shape" cx="10" cy="10" r="8.1" />
      ) : (
        <rect className="animated-checkmark-shape" x="2" y="2" width="16" height="16" rx="4.2" />
      )}
      <path
        className="animated-checkmark-tick"
        d="M5.75 10.15 8.6 13 14.45 7.15"
        pathLength={1}
      />
    </svg>
  )
})
