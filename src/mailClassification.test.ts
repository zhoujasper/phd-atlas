import { describe, expect, it } from 'vitest'
import {
  customMailCategoryId,
  effectiveMailCategories,
  effectiveMailCategory,
  hasManualMailCategory,
  normalizedCustomMailCategories,
  normalizedMailCategoryList,
  resolveMailCategoryLabel,
  resolveMailCategoryTone,
  MAX_MAIL_CATEGORIES_PER_MESSAGE,
  mailCategories,
  mailClassificationActionLabelKey,
  mailClassificationActions,
  mailClassificationCommunicationIdBatches,
  mailConfidencePercent,
  mergeMailClassificationDeltas,
  forgetMailClassificationRequestId,
  persistedMailClassificationRequestId,
  rememberMailClassificationRequestId,
} from './mailClassification'
import type { MailCategorizedRecord } from './mailClassification'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('mail classification contract', () => {
  it('keeps the persisted category and action codes stable', () => {
    expect(mailCategories).toEqual([
      'outreach',
      'positive_reply',
      'neutral_reply',
      'negative_reply',
      'interview_invite',
      'interview_followup',
      'offer',
      'rejection',
      'application_update',
      'funding',
      'recommendation',
      'administrative',
      'other',
      'not_relevant',
    ])
    expect(mailClassificationActions).toEqual([
      'reply',
      'follow_up',
      'schedule_interview',
      'prepare_interview',
      'submit_materials',
      'review_funding',
      'update_application',
      'track_deadline',
      'review_security',
      'none',
    ])
  })

  it('maps every classifier action to a stable dossier translation key', () => {
    expect(mailClassificationActions.map(mailClassificationActionLabelKey)).toEqual([
      'dossier.mailClassificationActions.reply',
      'dossier.mailClassificationActions.followUp',
      'dossier.mailClassificationActions.scheduleInterview',
      'dossier.mailClassificationActions.prepareInterview',
      'dossier.mailClassificationActions.submitMaterials',
      'dossier.mailClassificationActions.reviewFunding',
      'dossier.mailClassificationActions.updateApplication',
      'dossier.mailClassificationActions.trackDeadline',
      'dossier.mailClassificationActions.reviewSecurity',
      'dossier.mailClassificationActions.none',
    ])
  })

  it('uses a manual category ahead of the AI result and falls back after it is cleared', () => {
    const classifiedMail = {
      mailCategoryOverride: 'interview_invite' as const,
      mailClassification: {
        category: 'positive_reply' as const,
        confidence: 0.91,
      },
    }

    expect(hasManualMailCategory(classifiedMail)).toBe(true)
    expect(effectiveMailCategory(classifiedMail)).toBe('interview_invite')
    expect(hasManualMailCategory({ ...classifiedMail, mailCategoryOverride: null })).toBe(false)
    expect(effectiveMailCategory({ ...classifiedMail, mailCategoryOverride: null })).toBe('positive_reply')
    expect(effectiveMailCategory({ mailCategoryOverride: null })).toBeNull()
  })

  it('normalizes confidence for compact UI percentages', () => {
    expect(mailConfidencePercent(0.914)).toBe(91)
    expect(mailConfidencePercent(-1)).toBe(0)
    expect(mailConfidencePercent(2)).toBe(100)
  })

  it('merges bounded classification deltas without dropping unselected mail', () => {
    const existing: Array<{ id: string; subject: string } & MailCategorizedRecord> = [
      { id: 'mail_1', subject: 'one', mailCategoryOverride: 'other' as const },
      { id: 'mail_2', subject: 'two', mailCategoryOverride: 'funding' as const },
    ]
    const merged = mergeMailClassificationDeltas(existing, [{
      id: 'mail_1',
      mailCategoryOverride: null,
      mailClassification: {
        category: 'interview_invite',
        confidence: 0.9,
        summary: 'Interview invitation',
        evidence: [],
        actions: ['prepare_interview'],
        source: 'ai',
        classifiedAt: '2026-08-02T00:00:00.000Z',
        inputHash: 'hash',
        version: 1,
      },
    }])

    expect(merged).toHaveLength(2)
    expect(merged[0]).not.toHaveProperty('mailCategoryOverride')
    expect(merged[0].mailClassification?.category).toBe('interview_invite')
    expect(merged[1]).toBe(existing[1])
  })

  it('merges and clears the persisted multi-category manual list', () => {
    const existing = [{
      id: 'mail_1',
      mailCategories: ['funding', 'custom:committee'],
    }]
    const classified = mergeMailClassificationDeltas(existing, [{
      id: 'mail_1',
      mailCategories: ['custom:committee', 'application_update'],
      mailCategoryOverride: 'application_update',
    }])
    expect(classified[0].mailCategories).toEqual(['custom:committee', 'application_update'])
    expect(effectiveMailCategories(classified[0])).toEqual(['custom:committee', 'application_update'])

    const cleared = mergeMailClassificationDeltas(classified, [{
      id: 'mail_1',
      mailCategories: null,
      mailCategoryOverride: null,
    }])
    expect(cleared[0]).not.toHaveProperty('mailCategories')
    expect(cleared[0]).not.toHaveProperty('mailCategoryOverride')
  })

  it('keeps an ambiguous idempotency key through reload, scoped by account and TTL', () => {
    const storage = memoryStorage()
    const at = Date.UTC(2026, 7, 2, 12)
    rememberMailClassificationRequestId('user_1', 'app-1:mail-1', 'request-1', storage, at)

    expect(persistedMailClassificationRequestId('user_1', 'app-1:mail-1', storage, at + 1_000))
      .toBe('request-1')
    expect(persistedMailClassificationRequestId('user_2', 'app-1:mail-1', storage, at + 1_000))
      .toBeNull()
    expect(persistedMailClassificationRequestId('user_1', 'app-1:mail-1', storage, at + 25 * 60 * 60_000))
      .toBeNull()

    rememberMailClassificationRequestId('user_1', 'app-1:mail-1', 'request-2', storage, at)
    forgetMailClassificationRequestId('user_1', 'app-1:mail-1', storage, at)
    expect(persistedMailClassificationRequestId('user_1', 'app-1:mail-1', storage, at)).toBeNull()
  })

  it('splits large selections into stable server-sized batches without duplicate ids', () => {
    const ids = Array.from({ length: 105 }, (_, index) => `mail-${index}`)
    const batches = mailClassificationCommunicationIdBatches([...ids, 'mail-1'])

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 5])
    expect(batches.flat()).toEqual(ids)
  })

  it('refuses to report durable request identity when storage throws or discards writes', () => {
    const throwingStorage = memoryStorage()
    throwingStorage.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') }
    const silentStorage = memoryStorage()
    silentStorage.setItem = () => undefined

    expect(rememberMailClassificationRequestId(
      'user_1',
      'app-1:mail-1',
      'request-1',
      throwingStorage,
    )).toBe(false)
    expect(rememberMailClassificationRequestId(
      'user_1',
      'app-1:mail-1',
      'request-1',
      silentStorage,
    )).toBe(false)
    expect(persistedMailClassificationRequestId(
      'user_1',
      'app-1:mail-1',
      silentStorage,
    )).toBeNull()
  })
})

describe('multi-label and custom mail categories', () => {
  it('keeps every category a message carries, with manual selection winning outright', () => {
    const classified = {
      mailClassification: { category: 'interview_invite', categories: ['interview_invite', 'funding'] },
    } as const
    expect(effectiveMailCategories(classified)).toEqual(['interview_invite', 'funding'])

    // A decision replaces the classifier's opinion rather than merging with it.
    const decided = { ...classified, mailCategories: ['custom:visa'] }
    expect(effectiveMailCategories(decided)).toEqual(['custom:visa'])
    expect(hasManualMailCategory(decided)).toBe(true)
    expect(effectiveMailCategory(decided)).toBe('custom:visa')
  })

  it('still honours a row written before the list existed', () => {
    const legacy = { mailCategoryOverride: 'offer' } as const
    expect(effectiveMailCategories(legacy)).toEqual(['offer'])
    expect(hasManualMailCategory(legacy)).toBe(true)
  })

  it('derives a stable id from a label and never reuses one already taken', () => {
    const taken = new Set(['custom:visa'])
    expect(customMailCategoryId('Visa', new Set())).toBe('custom:visa')
    expect(customMailCategoryId('Visa', taken)).toBe('custom:visa-2')
    // Punctuation and non-ASCII collapse rather than producing an empty id.
    expect(customMailCategoryId('!!!', new Set())).toBe('custom:category')
  })

  it('resolves labels for built-in, custom, and orphaned ids', () => {
    const custom = [{ id: 'custom:visa', label: 'Visa', tone: 'info' as const }]
    const translate = (key: string) => `t:${key}`
    expect(resolveMailCategoryLabel('offer', custom, translate)).toBe('t:dossier.mailCategories.offer')
    expect(resolveMailCategoryLabel('custom:visa', custom, translate)).toBe('Visa')
    // A category deleted after messages were filed under it still reads.
    expect(resolveMailCategoryLabel('custom:old-thing', custom, translate)).toBe('old thing')
    expect(resolveMailCategoryTone('custom:visa', custom)).toBe('info')
    expect(resolveMailCategoryTone('custom:gone', custom)).toBe('neutral')
  })

  it('drops malformed custom definitions instead of trusting stored settings', () => {
    expect(normalizedCustomMailCategories([
      { id: 'custom:a', label: 'Kept', tone: 'accent' },
      { id: 'not-prefixed', label: 'Rejected' },
      { id: 'custom:a', label: 'Duplicate id' },
      { id: 'custom:b', label: '   ' },
      { id: 'custom:c', label: 'Unknown tone', tone: 'chartreuse' },
    ] as unknown[])).toEqual([
      { id: 'custom:a', label: 'Kept', tone: 'accent' },
      { id: 'custom:c', label: 'Unknown tone', tone: 'neutral' },
    ])
  })

  it('bounds and de-duplicates the categories stored on one message', () => {
    expect(normalizedMailCategoryList(['offer', 'offer', 'funding'])).toEqual(['offer', 'funding'])
    expect(normalizedMailCategoryList(
      Array.from({ length: 12 }, (_, index) => `custom:c${index}`),
    )).toHaveLength(MAX_MAIL_CATEGORIES_PER_MESSAGE)
  })
})
