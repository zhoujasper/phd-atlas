import { describe, expect, it } from 'vitest'
import de from './i18n/de/dossier.json'
import en from './i18n/en/dossier.json'
import es from './i18n/es/dossier.json'
import fr from './i18n/fr/dossier.json'
import itPack from './i18n/it/dossier.json'
import ja from './i18n/ja/dossier.json'
import ko from './i18n/ko/dossier.json'
import pt from './i18n/pt/dossier.json'
import ru from './i18n/ru/dossier.json'
import th from './i18n/th/dossier.json'
import vi from './i18n/vi/dossier.json'
import zh from './i18n/zh/dossier.json'
import {
  mailCategories,
  mailCategoryLabelKey,
  mailClassificationActionLabelKey,
  mailClassificationActions,
} from './mailClassification'

const dictionaries = { en, zh, ja, ko, es, fr, de, pt, it: itPack, ru, vi, th }

function valueAt(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => (
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)[segment]
      : undefined
  ), source)
}

describe('mail classification translations', () => {
  it('covers all 14 categories and 10 suggested actions in every language pack', () => {
    expect(mailCategories).toHaveLength(14)
    expect(mailClassificationActions).toHaveLength(10)

    for (const [language, dictionary] of Object.entries(dictionaries)) {
      const keys = [
        ...mailCategories.map(mailCategoryLabelKey),
        ...mailClassificationActions.map(mailClassificationActionLabelKey),
      ]
      for (const key of keys) {
        const value = valueAt(dictionary, key)
        expect(value, `${language}:${key}`).toEqual(expect.any(String))
        expect((value as string).trim(), `${language}:${key}`).not.toBe('')
        expect(value, `${language}:${key}`).not.toContain('__')
      }
    }
  })
})
