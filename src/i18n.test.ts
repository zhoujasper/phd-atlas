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
const localizedMarketingSeedPhrases = [
  'Computer Science PhD',
  'human-AI collaboration, learning interfaces, and evaluation',
  'Interactive Intelligence Lab',
  'Mentor review',
  'EECS PhD',
  'robot learning, embodied planning, and safe autonomy',
  'Robot Learning Group',
  'Data Science PhD',
  'Advanced Computer Science PhD',
  'multilingual NLP and evaluation for scientific discovery',
  'Language and Knowledge Lab',
  'Robotics PhD',
]

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

  it('lets every translation own the two semantic hero lines', async () => {
    await Promise.all(expectedLanguages.map((language) => loadLanguage(language, ['core'])))

    for (const language of expectedLanguages) {
      const lines = t(language, 'authMarketingHeroTitle')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      expect(lines, language).toHaveLength(2)
      expect(lines.every((line) => line.length > 0), language).toBe(true)
    }
  })

  it('localizes every translatable seed value exposed by the public workspace demo', async () => {
    await Promise.all(expectedLanguages.map((language) => loadLanguage(language, ['core'])))

    for (const language of expectedLanguages.filter((value) => value !== 'en')) {
      for (const phrase of localizedMarketingSeedPhrases) {
        expect(localizeStaticText(phrase, language), `${language}: ${phrase}`).not.toBe(phrase)
      }
    }
  })
})
