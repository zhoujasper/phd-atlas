import clsx from 'clsx'
import { Bookmark } from 'lucide-react'
import { useState, type ReactNode } from 'react'

type FavoriteMotion = 'adding' | 'removing' | null

export function FavoriteBookmarkButton({
  active,
  label,
  onToggle,
  className,
  iconSize = 16,
  disabled = false,
  children,
}: {
  active: boolean
  label: string
  onToggle: () => void
  className?: string
  iconSize?: number
  disabled?: boolean
  children?: ReactNode
}) {
  const [motion, setMotion] = useState<FavoriteMotion>(null)

  const toggle = () => {
    setMotion(active ? 'removing' : 'adding')
    onToggle()
  }

  return (
    <button
      type="button"
      className={clsx(
        'favorite-bookmark-button',
        active && 'is-favorite',
        motion && `is-favorite-${motion}`,
        className,
      )}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={toggle}
    >
      <span
        className="favorite-bookmark-glyph"
        aria-hidden="true"
        onAnimationEnd={() => setMotion(null)}
      >
        <Bookmark size={iconSize} />
      </span>
      {children}
    </button>
  )
}
