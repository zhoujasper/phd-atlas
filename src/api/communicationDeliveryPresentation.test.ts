import { describe, expect, it } from 'vitest'
import de from '../i18n/de/shared.json'
import en from '../i18n/en/shared.json'
import es from '../i18n/es/shared.json'
import fr from '../i18n/fr/shared.json'
import itLocale from '../i18n/it/shared.json'
import ja from '../i18n/ja/shared.json'
import ko from '../i18n/ko/shared.json'
import pt from '../i18n/pt/shared.json'
import ru from '../i18n/ru/shared.json'
import th from '../i18n/th/shared.json'
import vi from '../i18n/vi/shared.json'
import zh from '../i18n/zh/shared.json'
import { communicationDeliveryPresentation } from './phdApi'

describe('communication delivery presentation', () => {
  it('never describes an unreconciled SMTP outcome as queued or clears the composer', () => {
    expect(communicationDeliveryPresentation({
      sent: false,
      delivery: 'ambiguous',
      errorCode: 'SMTP_OUTCOME_UNKNOWN',
      outcomeUnknown: true,
      requiresReconciliation: true,
    })).toEqual({
      toastKey: 'toast.commOutcomeUnknown',
      tone: 'warning',
      composerSettled: false,
    })
  })

  it('preserves the existing sent and safely queued presentations', () => {
    expect(communicationDeliveryPresentation({ sent: true, delivery: 'smtp' })).toMatchObject({
      toastKey: 'toast.commSent',
      tone: 'success',
      composerSettled: true,
    })
    expect(communicationDeliveryPresentation({
      sent: false,
      delivery: 'queued',
      errorCode: 'NOT_CONFIGURED',
    })).toMatchObject({
      toastKey: 'toast.commQueued',
      tone: 'info',
      composerSettled: true,
    })
  })

  it('provides the reconciliation warning in every supported language', () => {
    for (const shared of [de, en, es, fr, itLocale, ja, ko, pt, ru, th, vi, zh]) {
      expect(shared.toast.commOutcomeUnknown).toEqual(expect.any(String))
      expect(shared.toast.commOutcomeUnknown.trim().length).toBeGreaterThan(20)
    }
  })
})
