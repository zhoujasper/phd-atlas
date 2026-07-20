import type { ProfilePresetColor, ProfilePresetIcon as ProfilePresetIconName } from '../../api/phdApi'
import { profilePresetIconComponents } from '../../profilePresetIcons'

export function ProfilePresetIcon({
  icon,
  color,
  size = 16,
  className = '',
}: {
  icon: ProfilePresetIconName
  color: ProfilePresetColor
  size?: number
  className?: string
}) {
  const Icon = profilePresetIconComponents[icon] ?? profilePresetIconComponents['file-text']
  return (
    <span className={`profile-preset-icon preset-color-${color}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  )
}
