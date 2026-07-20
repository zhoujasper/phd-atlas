import { describe, expect, it } from 'vitest'
import {
  PROFILE_PRESET_ICONS,
  PROFILE_PRESET_ICON_CATALOG,
  profilePresetIconComponents,
  profilePresetIconSearchText,
} from './profilePresetIconCatalog'

describe('profile preset icon catalog', () => {
  it('exposes at least 100 unique icons with component mappings', () => {
    expect(PROFILE_PRESET_ICON_CATALOG.length).toBeGreaterThanOrEqual(100)
    expect(PROFILE_PRESET_ICONS.length).toBe(PROFILE_PRESET_ICON_CATALOG.length)
    expect(new Set(PROFILE_PRESET_ICONS).size).toBe(PROFILE_PRESET_ICONS.length)

    for (const id of PROFILE_PRESET_ICONS) {
      expect(profilePresetIconComponents[id]).toBeTruthy()
    }
  })

  it('keeps legacy default icon ids for existing presets', () => {
    for (const id of ['file-text', 'file-check', 'briefcase', 'graduation-cap', 'flask-conical', 'scroll-text', 'mail', 'pen-line', 'book-open'] as const) {
      expect(PROFILE_PRESET_ICONS).toContain(id)
    }
  })

  it('matches search queries against id and bilingual labels', () => {
    expect(profilePresetIconSearchText('microscope', 'Microscope')).toContain('microscope')
    expect(profilePresetIconSearchText('microscope', '')).toContain('显微镜')
    expect(profilePresetIconSearchText('mail', 'Letter')).toContain('letter')
  })
})
