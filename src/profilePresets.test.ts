import { describe, expect, it } from 'vitest'
import type { ProfilePreset } from './api/phdApi'
import { PROFILE_PRESET_KINDS } from './profileAssets'
import {
  defaultProfilePresets,
  effectiveProfilePresets,
  remapBuiltInProfilePresets,
} from './profilePresets'

const pair = { primary: 'en', secondary: 'zh' } as const

describe('profile preset catalog merge', () => {
  it('returns the full built-in catalog when nothing is stored', () => {
    const presets = effectiveProfilePresets(undefined, pair)
    expect(presets).toHaveLength(PROFILE_PRESET_KINDS.length)
    expect(presets.every((preset) => preset.builtIn)).toBe(true)
  })

  it('appends newly added built-in kinds that older saved lists are missing', () => {
    const legacySubset: ProfilePreset[] = defaultProfilePresets(pair)
      .filter((preset) => ['CV', 'Personal Statement', 'SOP', 'Research Proposal', 'Transcript', 'Recommendation', 'Writing Sample'].includes(preset.kind))
      .map((preset) => ({ ...preset, icon: 'file-text' as const, color: 'gray' as const }))

    expect(legacySubset.length).toBe(7)

    const merged = remapBuiltInProfilePresets(legacySubset, pair)
    expect(merged.length).toBe(PROFILE_PRESET_KINDS.length)

    const kinds = merged.map((preset) => preset.kind)
    for (const { kind } of PROFILE_PRESET_KINDS) {
      expect(kinds).toContain(kind)
    }

    // Existing rows keep presentation overrides; new catalog rows use defaults.
    const cv = merged.find((preset) => preset.kind === 'CV')
    expect(cv?.icon).toBe('file-text')
    expect(cv?.color).toBe('gray')

    const portfolio = merged.find((preset) => preset.kind === 'Portfolio')
    expect(portfolio?.builtIn).toBe(true)
    expect(portfolio?.icon).toBe('briefcase')
  })

  it('keeps custom presets while filling missing built-ins', () => {
    const custom: ProfilePreset = {
      id: 'profile-preset-custom-1',
      kind: 'Custom',
      nameZh: '作品集包',
      nameEn: 'Portfolio pack',
      descriptionZh: '',
      descriptionEn: '',
      contentZh: '',
      contentEn: 'demo',
      icon: 'briefcase',
      color: 'system',
      builtIn: false,
    }

    const merged = effectiveProfilePresets([custom], pair)
    expect(merged.some((preset) => preset.id === custom.id)).toBe(true)
    expect(merged.filter((preset) => preset.builtIn)).toHaveLength(PROFILE_PRESET_KINDS.length)
  })
})
