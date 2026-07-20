import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  PROFILE_PRESET_COLORS,
  PROFILE_PRESET_ICONS,
  type ProfilePresetColor,
  type ProfilePresetIcon,
} from '../../api/phdApi'
import {
  profilePresetIconComponents,
  profilePresetIconLabelMap,
  profilePresetIconSearchText,
} from '../../profilePresetIcons'
import { useI18n } from '../hooks/useI18n'
import { AnchoredPopover } from './AnchoredPopover'
import { ProfilePresetIcon as PresetIcon } from './ProfilePresetIcon'

export function ProfileAppearancePicker({
  icon,
  color,
  onIconChange,
  onColorChange,
  triggerClassName = '',
  iconSize = 18,
}: {
  icon: ProfilePresetIcon
  color: ProfilePresetColor
  onIconChange: (icon: ProfilePresetIcon) => void
  onColorChange: (color: ProfilePresetColor) => void
  triggerClassName?: string
  iconSize?: number
}) {
  const { tx, format } = useI18n()
  const [iconSearch, setIconSearch] = useState('')
  const filteredIcons = useMemo(() => {
    const query = iconSearch.trim().toLowerCase()
    if (!query) return PROFILE_PRESET_ICONS
    return PROFILE_PRESET_ICONS.filter((candidate) => {
      const localized = tx(
        `profile.presetIconNames.${candidate}`,
        profilePresetIconLabelMap[candidate]?.en ?? candidate,
      )
      return profilePresetIconSearchText(candidate, localized).includes(query)
    })
  }, [iconSearch, tx])

  return (
    <AnchoredPopover
      triggerAriaLabel={tx('profile.changeIconAndColor')}
      popoverAriaLabel={tx('profile.presetAppearanceTitle')}
      triggerClassName={`profile-preset-icon-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
      popoverClassName="profile-preset-picker-popover profile-preset-identity-popover"
      width={320}
      estimatedHeight={460}
      onOpenChange={(pickerOpen) => { if (!pickerOpen) setIconSearch('') }}
      trigger={<PresetIcon icon={icon} color={color} size={iconSize} />}
    >
      {() => (
        <>
          <div className="profile-preset-picker-head">
            <strong>{tx('profile.presetAppearanceTitle')}</strong>
            <span>{tx('profile.presetAppearancePickerHint')}</span>
          </div>

          <label className="profile-preset-icon-search">
            <span className="sr-only">{tx('profile.presetIconSearchPlaceholder')}</span>
            <div>
              <Search size={13} aria-hidden="true" />
              <input
                data-popover-autofocus
                value={iconSearch}
                onChange={(event) => setIconSearch(event.target.value)}
                placeholder={tx('profile.presetIconSearchPlaceholder')}
                aria-label={tx('profile.presetIconSearchPlaceholder')}
              />
              {iconSearch.trim() ? (
                <button
                  type="button"
                  className="profile-preset-search-clear"
                  onClick={() => setIconSearch('')}
                  aria-label={tx('datePicker.clear')}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </label>

          <div className="profile-preset-icon-options" role="listbox" aria-label={tx('profile.presetIcon')}>
            {filteredIcons.map((candidate) => {
              const Icon = profilePresetIconComponents[candidate]
              const label = tx(
                `profile.presetIconNames.${candidate}`,
                profilePresetIconLabelMap[candidate]?.en ?? candidate,
              )
              return (
                <button
                  key={candidate}
                  type="button"
                  className={icon === candidate ? 'active' : ''}
                  onClick={() => onIconChange(candidate as ProfilePresetIcon)}
                  aria-label={label}
                  aria-pressed={icon === candidate}
                  title={label}
                >
                  <Icon size={16} aria-hidden="true" />
                  {icon === candidate ? <Check size={10} aria-hidden="true" className="profile-preset-option-check" /> : null}
                </button>
              )
            })}
            {filteredIcons.length === 0 ? (
              <p className="profile-preset-icon-empty">
                {format(tx('profile.presetNoIconMatches'), { query: iconSearch.trim() })}
              </p>
            ) : null}
          </div>

          <div className="profile-preset-color-picker">
            <span>{tx('profile.presetColor')}</span>
            <div className="profile-preset-color-strip" role="group" aria-label={tx('profile.presetColor')}>
              {PROFILE_PRESET_COLORS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={`preset-color-${candidate} ${color === candidate ? 'active' : ''}`}
                  onClick={() => onColorChange(candidate as ProfilePresetColor)}
                  aria-label={tx(`profile.presetColorNames.${candidate}`)}
                  aria-pressed={color === candidate}
                  title={tx(`profile.presetColorNames.${candidate}`)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </AnchoredPopover>
  )
}
