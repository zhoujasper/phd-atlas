import { describe, expect, it } from 'vitest'
import {
  clearRecoverableEmailComposer,
  defaultScheduledEmailTime,
  editableDraftEmailSubject,
  emailContentMentionsAttachment,
  isFutureScheduledEmail,
  loadRecoverableEmailComposer,
  saveRecoverableEmailComposer,
  scheduledEmailIso,
  shouldConfirmMissingEmailAttachment,
} from './dossierEmailComposerModel'

describe('dossier email attachment reminder', () => {
  it.each([
    ['English', 'Please see the attached CV.'],
    ['Chinese', '请查收附件中的研究计划。'],
    ['Japanese', '履歴書を添付しました。'],
    ['Korean', '이력서를 첨부했습니다.'],
    ['Spanish', 'Adjunto mi currículum.'],
    ['French', 'Veuillez trouver ma pièce jointe.'],
    ['German', 'Meinen Lebenslauf finden Sie im Anhang.'],
    ['Italian', 'Ho allegato il mio CV.'],
    ['Portuguese', 'Envio o meu currículo em anexo.'],
    ['Russian', 'Я прикрепил резюме.'],
    ['Thai', 'ฉันได้แนบประวัติย่อแล้ว'],
    ['Vietnamese', 'Tôi đã đính kèm CV.'],
  ])('detects an attachment reference in %s', (_language, body) => {
    expect(emailContentMentionsAttachment('', body)).toBe(true)
  })

  it('checks the subject as well as the body', () => {
    expect(emailContentMentionsAttachment('Attached research proposal', 'Thank you.')).toBe(true)
  })

  it('does not warn for ordinary email copy', () => {
    expect(emailContentMentionsAttachment('Research follow-up', 'Thank you for your time.')).toBe(false)
  })

  it('warns only when the composer has no attachment', () => {
    const draft = {
      subject: 'Research follow-up',
      body: 'Please see the attached proposal.',
    }
    expect(shouldConfirmMissingEmailAttachment({ ...draft, attachmentCount: 0 })).toBe(true)
    expect(shouldConfirmMissingEmailAttachment({ ...draft, attachmentCount: 1 })).toBe(false)
  })
})

describe('scheduled email time model', () => {
  it('defaults to the next quarter-hour and crosses midnight safely', () => {
    expect(defaultScheduledEmailTime(new Date(2026, 6, 29, 10, 7))).toEqual({
      date: '2026-07-29',
      time: '10:15',
    })
    expect(defaultScheduledEmailTime(new Date(2026, 6, 29, 23, 52))).toEqual({
      date: '2026-07-30',
      time: '00:00',
    })
  })

  it('converts a valid local selection to an absolute instant', () => {
    const iso = scheduledEmailIso('2026-07-29', '14:30')
    expect(iso).not.toBeNull()
    const parsed = new Date(iso!)
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(6)
    expect(parsed.getDate()).toBe(29)
    expect(parsed.getHours()).toBe(14)
    expect(parsed.getMinutes()).toBe(30)
  })

  it('rejects malformed, impossible, and non-future selections', () => {
    expect(scheduledEmailIso('2026-02-31', '10:00')).toBeNull()
    expect(scheduledEmailIso('2026-07-29', '25:00')).toBeNull()
    const future = new Date(2026, 6, 29, 10, 30).getTime()
    expect(isFutureScheduledEmail('2026-07-29', '10:45', future)).toBe(true)
    expect(isFutureScheduledEmail('2026-07-29', '10:15', future)).toBe(false)
  })
})

describe('saved email draft recovery', () => {
  it.each([
    ['[DRAFT] Research fit', 'Research fit'],
    ['[草稿] 研究匹配', '研究匹配'],
    ['[ENTWURF] Betreuung', 'Betreuung'],
    ['[Bản nháp] Hướng nghiên cứu', 'Hướng nghiên cứu'],
    ['[DRAFT] [草稿] Research fit', 'Research fit'],
    ['[DRAFT] [Nature] Research fit', '[Nature] Research fit'],
    ['[Action Required] Research fit', '[Action Required] Research fit'],
  ])('removes only a known system marker from %s', (subject, expected) => {
    expect(editableDraftEmailSubject(subject)).toBe(expected)
  })

  it('round-trips a tab-scoped composer snapshot and clears it explicitly', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const draft = {
      activeDraftId: 'comm_draft',
      attachments: [{ id: 'att_1', name: 'proposal.pdf', fileId: 'file_1' }],
      body: 'Dear Professor,\n\nThank you.',
      deliveryId: 'delivery-recovery-1',
      recipient: 'professor@example.edu',
      scheduledDate: '2026-08-03',
      scheduledTime: '09:30',
      subject: 'Research fit',
      updatedAt: 1,
    }

    expect(saveRecoverableEmailComposer('user_1', 'app_1', draft, storage)).toBe(true)
    expect(loadRecoverableEmailComposer('user_1', 'app_1', storage)).toEqual(draft)
    expect(loadRecoverableEmailComposer('user_2', 'app_1', storage)).toBeNull()
    expect(clearRecoverableEmailComposer('user_1', 'app_1', storage)).toBe(true)
    expect(loadRecoverableEmailComposer('user_1', 'app_1', storage)).toBeNull()
  })

  it('ignores malformed and empty recovery entries', () => {
    const malformed = { getItem: () => '{"subject":42}' }
    const invalidDelivery = {
      getItem: () => JSON.stringify({
        attachments: [],
        body: 'Keep me',
        deliveryId: 'short',
        recipient: '',
        scheduledDate: '2026-08-03',
        scheduledTime: '09:30',
        subject: '',
        updatedAt: 1,
      }),
    }
    const empty = {
      getItem: () => JSON.stringify({
        attachments: [],
        body: '',
        deliveryId: 'delivery-empty',
        recipient: '',
        scheduledDate: '2026-08-03',
        scheduledTime: '09:30',
        subject: '',
        updatedAt: 1,
      }),
    }
    expect(loadRecoverableEmailComposer('user_1', 'app_1', malformed)).toBeNull()
    expect(loadRecoverableEmailComposer('user_1', 'app_1', invalidDelivery)).toBeNull()
    expect(loadRecoverableEmailComposer('user_1', 'app_1', empty)).toBeNull()
  })

  it('keeps recovery unacknowledged when a privacy shim silently drops writes or deletes', () => {
    const draft = {
      attachments: [],
      body: 'A resident message',
      deliveryId: 'delivery-privacy-shim',
      recipient: 'professor@example.edu',
      scheduledDate: '',
      scheduledTime: '',
      subject: 'Research fit',
      updatedAt: 1,
    }
    expect(saveRecoverableEmailComposer('user_1', 'app_1', draft, {
      getItem: () => null,
      setItem: () => undefined,
    })).toBe(false)
    expect(clearRecoverableEmailComposer('user_1', 'app_1', {
      getItem: () => JSON.stringify(draft),
      removeItem: () => undefined,
    })).toBe(false)
  })
})
