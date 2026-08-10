import { beforeAll, describe, expect, it } from 'vitest'
import { ApiError } from '../api/phdApi'
import { loadLanguage, t, type Language } from '../i18n'
import { enhanceErrorInfo } from './errorHandling'

const LANGUAGES: Language[] = ['en', 'zh', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'pt', 'ru', 'th', 'vi']

beforeAll(async () => {
  await Promise.all(LANGUAGES.map((language) => loadLanguage(language, ['shared'])))
})

describe('enhanceErrorInfo localization', () => {
  it.each(LANGUAGES)('uses the shared error pipeline for %s', (language) => {
    const rawServerMessage = 'RAW_SERVER_BUSY_MESSAGE'
    const info = enhanceErrorInfo(
      new ApiError(rawServerMessage, 'SERVER_BUSY', 503),
      language,
    )

    expect(info.title).toBe(t(language, 'feedback.serverTitle'))
    expect(info.message).toBe(t(language, 'apiErrors.SERVER_BUSY'))
    expect(info.message).not.toContain(rawServerMessage)
    expect(info.actions?.[0]?.label).toBe(t(language, 'feedback.retry'))
  })

  it('preserves localized validation-field guidance instead of raw server text', () => {
    const info = enhanceErrorInfo(
      new ApiError('RAW_VALIDATION_MESSAGE', 'VALIDATION_ERROR', 400, 'email'),
      'fr',
    )

    expect(info.title).toBe(t('fr', 'feedback.validationTitle'))
    expect(info.message).toContain(t('fr', 'apiErrorFields.email'))
    expect(info.message).not.toContain('RAW_VALIDATION_MESSAGE')
  })

  it('does not expose an unknown ASCII technical error in a non-English UI', () => {
    const info = enhanceErrorInfo(new Error('socket exploded at internal transport'), 'vi')

    expect(info.message).toBe(t('vi', 'toast.unexpectedError'))
  })
})
