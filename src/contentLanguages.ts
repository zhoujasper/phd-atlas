import type { UserSettings } from './api/phdApi'
import { isCjkUiLanguage, languageLabel, resolveLanguage, t as translate } from './i18n'

export type ContentLanguagePair = {
  primary: string
  secondary: string
}

/**
 * Historical dual-field storage maps:
 * - `*En` fields → primary content language (default en)
 * - `*Zh` fields → secondary content language (default zh)
 *
 * UI always labels columns with the live content-language pair, never hard-coded
 * "Chinese" / "English", so switching Settings → content languages updates the
 * profile writing-language headers and system preset copy.
 */
export type ContentLanguageSlot = 'primary' | 'secondary'

/** Resolve the account's two preferred content languages (defaults: en + zh). */
export function contentLanguagesFromSettings(settings?: Pick<UserSettings, 'contentLanguagePrimary' | 'contentLanguageSecondary'> | null): ContentLanguagePair {
  const primary = resolveLanguage(settings?.contentLanguagePrimary ?? 'en')
  let secondary = resolveLanguage(settings?.contentLanguageSecondary ?? 'zh')
  if (secondary === primary) {
    secondary = primary === 'en' ? 'zh' : 'en'
  }
  return { primary, secondary }
}

export function contentLanguageOptions(pair: ContentLanguagePair): Array<{ value: string; label: string }> {
  return [
    { value: pair.primary, label: languageLabel(pair.primary) },
    { value: pair.secondary, label: languageLabel(pair.secondary) },
  ]
}

/** Prefer primary when UI language matches neither content language. */
export function preferredContentLanguage(pair: ContentLanguagePair, uiLang: string): string {
  const resolved = resolveLanguage(uiLang)
  if (resolved === pair.primary || resolved === pair.secondary) return resolved
  return pair.primary
}

/** East-Asian-style list joining for zh/ja/ko; English-style otherwise. */
export function isCjkContentLanguage(lang: string) {
  return isCjkUiLanguage(lang)
}

export function contentLanguageSlot(language: string, pair: ContentLanguagePair): ContentLanguageSlot {
  return resolveLanguage(language) === pair.secondary ? 'secondary' : 'primary'
}

export function contentLanguageForSlot(slot: ContentLanguageSlot, pair: ContentLanguagePair): string {
  return slot === 'primary' ? pair.primary : pair.secondary
}

/** Pick dual-field value: En stores primary, Zh stores secondary. */
export function dualFieldValue<T>(
  slot: ContentLanguageSlot,
  fields: { primary: T; secondary: T },
): T {
  return slot === 'primary' ? fields.primary : fields.secondary
}

export function snippetPhraseForLanguage(
  language: string,
  pair: ContentLanguagePair,
  settings: Pick<UserSettings, 'snippetPhraseLeadZh' | 'snippetPhraseTailZh' | 'snippetPhraseLeadEn' | 'snippetPhraseTailEn'>,
): { lead: string; tail: string } {
  const slot = contentLanguageSlot(language, pair)
  if (slot === 'secondary') {
    return {
      lead: settings.snippetPhraseLeadZh ?? '',
      tail: settings.snippetPhraseTailZh ?? '',
    }
  }
  return {
    lead: settings.snippetPhraseLeadEn ?? '',
    tail: settings.snippetPhraseTailEn ?? '',
  }
}

export function phrasePlaceholder(language: string, part: 'lead' | 'tail'): string {
  const lang = resolveLanguage(language)
  if (part === 'lead') {
    return translate(
      lang,
      isCjkContentLanguage(lang) ? 'profile.phrasePrefixPlaceholderZh' : 'profile.phrasePrefixPlaceholderEn',
      '',
    )
  }
  return translate(
    lang,
    isCjkContentLanguage(lang) ? 'profile.phraseSuffixPlaceholderZh' : 'profile.phraseSuffixPlaceholderEn',
    '',
  )
}
