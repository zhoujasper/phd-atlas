import type { CSSProperties } from 'react'
import { avatarInitial } from './avatarInitial'

export function UserAvatar({
  avatarUrl,
  name,
  email,
  className = 'user-avatar',
  label,
  decorative = true,
  style,
}: {
  avatarUrl?: string | null
  name?: string
  email?: string
  className?: string
  label?: string
  decorative?: boolean
  style?: CSSProperties
}) {
  const accessibility = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label || name || email || 'Avatar' }

  return (
    <span className={className} style={style} {...accessibility}>
      {avatarUrl ? (
        <img className="user-avatar-image" src={avatarUrl} alt="" draggable={false} />
      ) : avatarInitial(name, email)}
    </span>
  )
}
