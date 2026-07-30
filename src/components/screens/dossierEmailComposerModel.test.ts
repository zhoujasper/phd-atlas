import { describe, expect, it } from 'vitest'
import {
  defaultScheduledEmailTime,
  emailContentMentionsAttachment,
  isFutureScheduledEmail,
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
