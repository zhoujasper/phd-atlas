import { describe, expect, it } from 'vitest'
import de from '../../i18n/de/interview.json'
import en from '../../i18n/en/interview.json'
import es from '../../i18n/es/interview.json'
import fr from '../../i18n/fr/interview.json'
import itPack from '../../i18n/it/interview.json'
import ja from '../../i18n/ja/interview.json'
import ko from '../../i18n/ko/interview.json'
import pt from '../../i18n/pt/interview.json'
import ru from '../../i18n/ru/interview.json'
import th from '../../i18n/th/interview.json'
import vi from '../../i18n/vi/interview.json'
import zh from '../../i18n/zh/interview.json'
import {
  interviewFormatLabelKey,
  interviewFormats,
  interviewPrepTabLabelKey,
  interviewPrepTabs,
  interviewQuestionCategories,
  interviewQuestionCategoryLabelKey,
  interviewStatuses,
  interviewStatusLabelKey,
} from '../../interviewPrep'

const dictionaries = { en, zh, ja, ko, es, fr, de, pt, it: itPack, ru, vi, th }

function valueAt(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => (
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)[segment]
      : undefined
  ), source)
}

describe('Interview Prep translation contract', () => {
  it('covers every dynamic category, format, status, and tab in all 12 languages', () => {
    const dynamicKeys = [
      ...interviewQuestionCategories.map(interviewQuestionCategoryLabelKey),
      ...interviewFormats.map(interviewFormatLabelKey),
      ...interviewStatuses.map(interviewStatusLabelKey),
      ...interviewPrepTabs.map(interviewPrepTabLabelKey),
    ]

    expect(interviewQuestionCategories).toHaveLength(7)
    expect(interviewFormats).toHaveLength(4)
    expect(interviewStatuses).toHaveLength(3)
    expect(interviewPrepTabs).toHaveLength(4)

    for (const [language, dictionary] of Object.entries(dictionaries)) {
      for (const key of dynamicKeys) {
        const value = valueAt(dictionary, key)
        expect(value, `${language}:${key}`).toEqual(expect.any(String))
        expect((value as string).trim(), `${language}:${key}`).not.toBe('')
        expect(value, `${language}:${key}`).not.toContain('__')
      }
    }
  })

  it('localizes AI-discard and teacher empty-roster states in every language', () => {
    const stateKeys = [
      'interview.aiUnavailable',
      'interview.aiResultDiscarded',
      'interview.noStudentsShort',
      'interview.noStudentsTitle',
      'interview.noStudentsBody',
    ]
    for (const [language, dictionary] of Object.entries(dictionaries)) {
      for (const key of stateKeys) {
        const value = valueAt(dictionary, key)
        expect(value, `${language}:${key}`).toEqual(expect.any(String))
        expect((value as string).trim(), `${language}:${key}`).not.toBe('')
        expect(value, `${language}:${key}`).not.toContain('__')
      }
    }
  })
})
