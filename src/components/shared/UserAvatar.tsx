import type { CSSProperties } from 'react'

export function avatarInitial(name?: string, email?: string) {
  return name?.trim().charAt(0).toUpperCase()
    || email?.trim().charAt(0).toUpperCase()
    || '?'
}

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
