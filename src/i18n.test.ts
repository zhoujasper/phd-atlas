import { describe, expect, it } from 'vitest'
import {
  availableLanguages,
  browserDefaultLanguage,
  languageOptions,
  loadLanguage,
  localeForLanguage,
  localizeStaticText,
  t,
} from './i18n'

const expectedLanguages = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th']

describe('i18n language packs', () => {
  it('exposes every complete language pack in the intended picker order', () => {
    expect(availableLanguages()).toEqual(expectedLanguages)
    expect(languageOptions().map((option) => option.value)).toEqual(expectedLanguages)
  })

  it.each([
    ['en', 'en-US'],
    ['zh', 'zh-CN'],
    ['ja', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['es', 'es-ES'],
    ['fr', 'fr-FR'],
    ['de', 'de-DE'],
    ['pt', 'pt-BR'],
    ['it', 'it-IT'],
    ['ru', 'ru-RU'],
    ['vi', 'vi-VN'],
    ['th', 'th-TH'],
  ])('maps %s to the expected date and number locale', (language, locale) => {
    expect(localeForLanguage(language)).toBe(locale)
  })

  it('resolves a regional browser locale to its installed base-language pack', () => {
    expect(browserDefaultLanguage('pt-PT')).toBe('pt')
    expect(browserDefaultLanguage('vi-VN')).toBe('vi')
  })

  it('loads translated interface and built-in demo copy for new languages', async () => {
    await Promise.all(expectedLanguages.map((language) => loadLanguage(language, ['shared', 'settings'])))

    for (const language of ['pt', 'it', 'ru', 'vi', 'th']) {
      expect(t(language, 'nav.applications')).not.toBe('Applications')
      expect(t(language, 'settings.title')).not.toBe('Personal settings')
      expect(localizeStaticText('Academic CV', language)).not.toBe('Academic CV')
    }
  })
})
