import type { Language } from './i18n'
import { t as translate } from './i18n'
import type { ProfilePreset, ProfilePresetColor, ProfilePresetIcon } from './api/phdApi'
import {
  PROFILE_PRESET_DEFAULT_KEYS,
  PROFILE_PRESET_KINDS,
  isBuiltInProfilePresetKind,
  type ProfilePresetKind,
} from './profileAssets'
import {
  contentLanguagesFromSettings,
  type ContentLanguagePair,
} from './contentLanguages'
import { normalizeEscapedMultiline } from './textNormalize'

const DEFAULT_PRESENTATION: Record<string, { icon: ProfilePresetIcon; color: ProfilePresetColor }> = {
  CV: { icon: 'file-check', color: 'blue' },
  'Personal Statement': { icon: 'file-text', color: 'purple' },
  SOP: { icon: 'scroll-text', color: 'orange' },
  'Research Proposal': { icon: 'flask-conical', color: 'teal' },
  'Research Statement': { icon: 'flask-conical', color: 'blue' },
  'Teaching Statement': { icon: 'book-open', color: 'green' },
  'Cover Letter': { icon: 'mail', color: 'orange' },
  Transcript: { icon: 'graduation-cap', color: 'green' },
  'Language Scores': { icon: 'graduation-cap', color: 'teal' },
  Recommendation: { icon: 'mail', color: 'pink' },
  'Writing Sample': { icon: 'pen-line', color: 'gray' },
  Publications: { icon: 'book-open', color: 'purple' },
  Portfolio: { icon: 'briefcase', color: 'blue' },
  'Scholarship Essay': { icon: 'scroll-text', color: 'pink' },
}

export function profilePresetPresentation(kind: string): { icon: ProfilePresetIcon; color: ProfilePresetColor } {
  return DEFAULT_PRESENTATION[kind] ?? { icon: 'file-text', color: 'system' }
}

/**
 * Built-in presets ship with full i18n packs for every supported language.
 * Dual-slot storage maps:
 * - nameEn / descriptionEn / contentEn → first content language
 * - nameZh / descriptionZh / contentZh → second content language
 *
 * Library card titles always follow the *appearance* UI language.
 * Insert-phrase copy always follows the *content language* pair (live from i18n).
 */
export function builtInPresetCopyForLanguage(kind: ProfilePresetKind, language: string) {
  const meta = PROFILE_PRESET_KINDS.find((item) => item.kind === kind)
  const defaultKey = PROFILE_PRESET_DEFAULT_KEYS[kind]
  // Some language packs historically double-escaped newlines (`\\n`); normalize so editors render real line breaks.
  return {
    name: translate(language, meta?.labelKey ?? 'profile.presetCustom', kind),
    description: translate(language, meta?.hintKey ?? '', ''),
    content: normalizeEscapedMultiline(translate(language, `profile.presetDefaults.${defaultKey}.content`, '')),
  }
}

export function defaultProfilePresets(pair?: ContentLanguagePair): ProfilePreset[] {
  const languages = pair ?? contentLanguagesFromSettings(null)
  return PROFILE_PRESET_KINDS.map((preset) => {
    const presentation = DEFAULT_PRESENTATION[preset.kind] ?? { icon: 'file-text', color: 'blue' }
    const primary = builtInPresetCopyForLanguage(preset.kind, languages.primary)
    const secondary = builtInPresetCopyForLanguage(preset.kind, languages.secondary)
    return {
      id: `profile-preset-default-${PROFILE_PRESET_DEFAULT_KEYS[preset.kind]}`,
      kind: preset.kind,
      nameEn: primary.name,
      nameZh: secondary.name,
      descriptionEn: primary.description,
      descriptionZh: secondary.description,
      contentEn: primary.content,
      contentZh: secondary.content,
      icon: presentation.icon,
      color: presentation.color,
      builtIn: true,
    }
  })
}

/**
 * Always re-resolve built-in insert slots from the current content-language pair
 * so first/second language changes take effect without stale stored en/zh copy.
 */
export function effectiveProfilePresets(
  value: ProfilePreset[] | undefined,
  pair?: ContentLanguagePair,
): ProfilePreset[] {
  const languages = pair ?? contentLanguagesFromSettings(null)
  if (value === undefined) return defaultProfilePresets(languages)
  return remapBuiltInProfilePresets(value, languages)
}

/**
 * When content languages change, refresh built-in dual-slot insert copy only.
 * Also merges in any catalog built-ins that are missing from older stored lists
 * (e.g. kinds added after the user first saved profilePresets).
 * Does not affect appearance / UI language of the profile library.
 */
export function remapBuiltInProfilePresets(
  current: ProfilePreset[] | undefined,
  pair: ContentLanguagePair,
): ProfilePreset[] {
  const fresh = defaultProfilePresets(pair)
  if (!current || current.length === 0) return fresh

  const freshByKind = new Map(fresh.map((preset) => [preset.kind, preset]))
  const presentKinds = new Set<string>()

  const remapped = current.map((preset) => {
    presentKinds.add(preset.kind)
    if (!preset.builtIn) return preset
    const next = freshByKind.get(preset.kind)
    if (!next) return preset
    return {
      ...next,
      id: preset.id,
      // Keep any user-visible presentation already stored on the row.
      icon: preset.icon || next.icon,
      color: preset.color || next.color,
    }
  })

  // Older accounts may only store the original subset of built-ins. Append any
  // newer catalog kinds so the gallery always shows the full template set.
  const missingBuiltIns = fresh.filter((preset) => !presentKinds.has(preset.kind))
  return missingBuiltIns.length > 0 ? [...remapped, ...missingBuiltIns] : remapped
}

/**
 * Text shown in the profile UI (library cards, confirmations).
 * Always localizes built-in kinds to the *appearance* language.
 */
export function profilePresetText(
  preset: ProfilePreset,
  uiLang: Language,
  _pair?: ContentLanguagePair,
) {
  if (preset.builtIn && isBuiltInProfilePresetKind(preset.kind)) {
    const copy = builtInPresetCopyForLanguage(preset.kind, uiLang)
    return copy
  }

  const preferZh = uiLang === 'zh' || uiLang.startsWith('zh')
  const preferred = preferZh
    ? { name: preset.nameZh, description: preset.descriptionZh, content: preset.contentZh }
    : { name: preset.nameEn, description: preset.descriptionEn, content: preset.contentEn }
  const fallback = preferZh
    ? { name: preset.nameEn, description: preset.descriptionEn, content: preset.contentEn }
    : { name: preset.nameZh, description: preset.descriptionZh, content: preset.contentZh }
  return {
    name: preferred.name.trim() || fallback.name.trim(),
    description: preferred.description.trim() || fallback.description.trim(),
    content: preferred.content.trim() || fallback.content.trim(),
  }
}

/**
 * Dual-slot insert labels for a preset.
 * Built-in kinds always resolve live from i18n for first/second content languages
 * (every supported language already has packs). Custom presets use stored dual fields.
 */
export function profilePresetInsertLabels(
  preset: ProfilePreset,
  pair?: ContentLanguagePair,
) {
  const languages = pair ?? contentLanguagesFromSettings(null)
  if (preset.builtIn && isBuiltInProfilePresetKind(preset.kind)) {
    const primary = builtInPresetCopyForLanguage(preset.kind, languages.primary)
    const secondary = builtInPresetCopyForLanguage(preset.kind, languages.secondary)
    return {
      primary: primary.name,
      secondary: secondary.name,
      contentPrimary: primary.content,
      contentSecondary: secondary.content,
      descriptionPrimary: primary.description,
      descriptionSecondary: secondary.description,
    }
  }
  return {
    primary: preset.nameEn.trim(),
    secondary: preset.nameZh.trim(),
    contentPrimary: preset.contentEn.trim(),
    contentSecondary: preset.contentZh.trim(),
    descriptionPrimary: preset.descriptionEn.trim(),
    descriptionSecondary: preset.descriptionZh.trim(),
  }
}

export function newProfilePresetId() {
  return `profile-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
