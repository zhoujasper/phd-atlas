import type { ProfileAsset } from './api/phdApi'
import { localizeStaticText, t as translate, type Language } from './i18n'

export const CUSTOM_PROFILE_KIND = 'Custom'
export const LEGACY_OTHER_PROFILE_KIND = 'Other'

type ProfileAssetGroupingFields = Pick<ProfileAsset, 'id' | 'kind' | 'familyId'>
  & Partial<Pick<ProfileAsset, 'customLabelZh' | 'customLabelEn'>>

function normalizeGroupingPart(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/**
 * Stable type-group id used by the library and insert picker.
 *
 * Older records may carry unrelated `familyId` values because users previously
 * had to maintain version families manually. The product model is now simpler:
 * every built-in material kind is one visual group, while custom materials are
 * grouped by their bilingual custom type label.
 */
export function profileAssetFamilyId(asset: ProfileAssetGroupingFields): string {
  const kind = normalizeGroupingPart(asset.kind) || 'custom'
  if (!isGenericCustomProfileKind(asset.kind)) return `kind:${kind}`

  const customLabel = [asset.customLabelEn, asset.customLabelZh]
    .map(normalizeGroupingPart)
    .filter(Boolean)
    .sort()
    .join('|')
  return `kind:${kind}:${customLabel || 'unlabelled'}`
}

export type ProfileAssetFamily = {
  familyId: string
  kind: string
  familyName: string
  versions: ProfileAsset[]
  primary: ProfileAsset
  versionCount: number
  updatedAt: string
}

function versionSortKey(asset: ProfileAsset) {
  const n = Number(asset.versionNumber)
  if (Number.isFinite(n) && n > 0) return n
  const t = asset.updatedAt || asset.createdAt || ''
  return t
}

/** Group assets automatically by their material type for library + insert UI. */
export function groupProfileAssetsIntoFamilies(assets: ProfileAsset[]): ProfileAssetFamily[] {
  const map = new Map<string, ProfileAsset[]>()
  for (const asset of assets) {
    const fid = profileAssetFamilyId(asset)
    const list = map.get(fid) ?? []
    list.push(asset)
    map.set(fid, list)
  }

  const families: ProfileAssetFamily[] = []
  for (const [familyId, versions] of map) {
    const sorted = [...versions].sort((a, b) => {
      const aPrimary = a.isPrimary ? 1 : 0
      const bPrimary = b.isPrimary ? 1 : 0
      if (aPrimary !== bPrimary) return bPrimary - aPrimary
      const av = Number(a.versionNumber) || 0
      const bv = Number(b.versionNumber) || 0
      if (av !== bv) return bv - av
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
    const primary = sorted.find((item) => item.isPrimary) ?? sorted[0]
    const kind = primary.kind
    const familyName = isGenericCustomProfileKind(kind)
      ? (primary.customLabelEn || primary.customLabelZh || primary.name).trim()
      : kind
    const updatedAt = sorted
      .map((item) => item.updatedAt || '')
      .sort()
      .at(-1) || ''
    families.push({
      familyId,
      kind,
      familyName,
      versions: sorted,
      primary,
      versionCount: sorted.length,
      updatedAt,
    })
  }

  return families.sort((a, b) => {
    // Kind clusters then recency
    const kindCmp = a.kind.localeCompare(b.kind)
    if (kindCmp !== 0) return kindCmp
    return String(b.updatedAt).localeCompare(String(a.updatedAt))
  })
}

/** Cluster families by document kind for section headers (CV, PS, Portfolio…). */
export function clusterFamiliesByKind(families: ProfileAssetFamily[]) {
  const order = PROFILE_PRESET_KINDS.map((item) => item.kind)
  const map = new Map<string, ProfileAssetFamily[]>()
  for (const family of families) {
    const key = family.kind || CUSTOM_PROFILE_KIND
    const list = map.get(key) ?? []
    list.push(family)
    map.set(key, list)
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    const ai = order.indexOf(a as ProfilePresetKind)
    const bi = order.indexOf(b as ProfilePresetKind)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return keys.map((kind) => ({ kind, families: map.get(kind)! }))
}

export function nextVersionNumber(familyVersions: ProfileAsset[]): number {
  let max = 0
  for (const asset of familyVersions) {
    const n = Number(asset.versionNumber)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

export function defaultVersionLabel(versionNumber: number, lang: string = 'en') {
  return lang.startsWith('zh') ? `版本 ${versionNumber}` : `Version ${versionNumber}`
}

// silence unused helper warning in some builds
void versionSortKey

/** Built-in kinds for the personal profile library (PhD application materials). */
export const PROFILE_PRESET_KINDS = [
  { kind: 'CV', labelKey: 'profile.presetCv', hintKey: 'profile.presetCvHint' },
  { kind: 'Personal Statement', labelKey: 'profile.presetPersonalStatement', hintKey: 'profile.presetPersonalStatementHint' },
  { kind: 'SOP', labelKey: 'profile.presetSop', hintKey: 'profile.presetSopHint' },
  { kind: 'Research Proposal', labelKey: 'profile.presetResearchProposal', hintKey: 'profile.presetResearchProposalHint' },
  { kind: 'Research Statement', labelKey: 'profile.presetResearchStatement', hintKey: 'profile.presetResearchStatementHint' },
  { kind: 'Teaching Statement', labelKey: 'profile.presetTeachingStatement', hintKey: 'profile.presetTeachingStatementHint' },
  { kind: 'Cover Letter', labelKey: 'profile.presetCoverLetter', hintKey: 'profile.presetCoverLetterHint' },
  { kind: 'Transcript', labelKey: 'profile.presetTranscript', hintKey: 'profile.presetTranscriptHint' },
  { kind: 'Language Scores', labelKey: 'profile.presetLanguageScores', hintKey: 'profile.presetLanguageScoresHint' },
  { kind: 'Recommendation', labelKey: 'profile.presetRecommendation', hintKey: 'profile.presetRecommendationHint' },
  { kind: 'Writing Sample', labelKey: 'profile.presetWritingSample', hintKey: 'profile.presetWritingSampleHint' },
  { kind: 'Publications', labelKey: 'profile.presetPublications', hintKey: 'profile.presetPublicationsHint' },
  { kind: 'Portfolio', labelKey: 'profile.presetPortfolio', hintKey: 'profile.presetPortfolioHint' },
  { kind: 'Scholarship Essay', labelKey: 'profile.presetScholarshipEssay', hintKey: 'profile.presetScholarshipEssayHint' },
] as const

export type ProfilePresetKind = typeof PROFILE_PRESET_KINDS[number]['kind']

export const PROFILE_PRESET_DEFAULT_KEYS: Record<ProfilePresetKind, string> = {
  CV: 'cv',
  'Personal Statement': 'personalStatement',
  SOP: 'sop',
  'Research Proposal': 'researchProposal',
  'Research Statement': 'researchStatement',
  'Teaching Statement': 'teachingStatement',
  'Cover Letter': 'coverLetter',
  Transcript: 'transcript',
  'Language Scores': 'languageScores',
  Recommendation: 'recommendation',
  'Writing Sample': 'writingSample',
  Publications: 'publications',
  Portfolio: 'portfolio',
  'Scholarship Essay': 'scholarshipEssay',
}

export function isBuiltInProfilePresetKind(kind: string): kind is ProfilePresetKind {
  return PROFILE_PRESET_KINDS.some((preset) => preset.kind === kind)
}

export function isGenericCustomProfileKind(kind: string) {
  return kind === CUSTOM_PROFILE_KIND || kind === LEGACY_OTHER_PROFILE_KIND
}

export function profileKindLabel(
  kind: string,
  lang: Language,
  customLabels?: { zh?: string; en?: string },
  /**
   * When provided, custom labels use the content-language dual slots:
   * en field = primary language, zh field = secondary language.
   * Without a pair, fall back to the legacy zh/en language-code heuristic.
   */
  contentLanguages?: { primary: string; secondary: string } | null,
): string {
  const preset = PROFILE_PRESET_KINDS.find((item) => item.kind === kind)
  if (preset) return translate(lang, preset.labelKey, kind)
  if (isGenericCustomProfileKind(kind)) {
    const preferSecondary = contentLanguages
      ? lang === contentLanguages.secondary
      : lang === 'zh'
    const preferred = (preferSecondary ? customLabels?.zh : customLabels?.en)?.trim()
    const fallback = (preferSecondary ? customLabels?.en : customLabels?.zh)?.trim()
    return preferred || fallback || translate(lang, 'profile.presetCustom', CUSTOM_PROFILE_KIND)
  }
  return localizeStaticText(kind, lang)
}
