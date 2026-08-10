import { describe, expect, it } from 'vitest'
import {
  SETTINGS_PERSISTENCE_ACK_PROTOCOL,
  type PublicUser,
  type SettingsPersistenceAcknowledgement,
  type UserSettings,
  type UserSettingsPatch,
} from './api/phdApi'
import {
  assertSettingsPersistenceAcknowledged,
  isNewerSettingsPersistenceVersion,
  SettingsPersistenceAcknowledgementError,
} from './settingsPersistenceAcknowledgement'

const baseSettings: UserSettings = {
  language: 'en',
  highContrast: false,
  themeAccent: '#0071e3',
  smtpPass: '',
  smtpPassSet: false,
  incomingPass: '',
  incomingPassSet: false,
}

const aiProfile = {
  preferredName: 'Jasper',
  pronouns: '',
  location: '',
  timezone: '',
  citizenship: '',
  currentRole: '',
  institution: '',
  degree: '',
  field: '',
  graduation: '',
  researchInterests: '',
  researchMethods: '',
  achievements: '',
  goals: 'Finish the application',
  writingLanguage: '',
  writingTone: '',
  signature: '',
  boundaries: '',
}

function user(
  settings: UserSettings,
  acknowledgement?: SettingsPersistenceAcknowledgement,
  settingsVersion = acknowledgement?.settingsVersion ?? 2,
): PublicUser & {
  settingsAcknowledgement?: SettingsPersistenceAcknowledgement
} {
  return {
    id: 'user-1',
    name: 'Researcher',
    email: 'researcher@example.com',
    role: 'user',
    createdAt: '2026-08-03T00:00:00.000Z',
    lastLoginAt: null,
    settingsVersion,
    settings,
    ...(acknowledgement ? { settingsAcknowledgement: acknowledgement } : {}),
  }
}

function secretMutation(
  patch: UserSettingsPatch,
  secret: 'smtpPass' | 'incomingPass',
  clear: 'clearSmtpPass' | 'clearIncomingPass',
) {
  if (patch[clear] === true) return { operation: 'clear' as const, present: false, version: 2 }
  if (typeof patch[secret] === 'string' && patch[secret]!.length > 0) {
    return { operation: 'set' as const, present: true, version: 2 }
  }
  return undefined
}

function receipt(patch: UserSettingsPatch, _settings: UserSettings): SettingsPersistenceAcknowledgement {
  return {
    protocol: SETTINGS_PERSISTENCE_ACK_PROTOCOL,
    version: 1,
    durable: true,
    mutationId: 'settings-test-mutation-0001',
    settingsVersion: 2,
    keys: Object.keys(patch).sort(),
    secretReceipts: {
      ...(secretMutation(patch, 'smtpPass', 'clearSmtpPass')
        ? { smtpPass: secretMutation(patch, 'smtpPass', 'clearSmtpPass') }
        : {}),
      ...(secretMutation(patch, 'incomingPass', 'clearIncomingPass')
        ? { incomingPass: secretMutation(patch, 'incomingPass', 'clearIncomingPass') }
        : {}),
    },
  }
}

function verify(patch: UserSettingsPatch, settings: UserSettings, response = user(settings, receipt(patch, settings))) {
  return assertSettingsPersistenceAcknowledged({
    previous: user(baseSettings, undefined, 1),
    patch,
    response,
  })
}

describe('settings durable persistence acknowledgement', () => {
  it('accepts only a strictly newer resident settings revision', () => {
    expect(isNewerSettingsPersistenceVersion(11, 12)).toBe(true)
    expect(isNewerSettingsPersistenceVersion(12, 12)).toBe(false)
    expect(isNewerSettingsPersistenceVersion(12, 11)).toBe(false)
    expect(isNewerSettingsPersistenceVersion(12, undefined)).toBe(false)
  })

  it('accepts a canonical response that acknowledges every submitted field', () => {
    const patch = {
      aiProfile,
      snippetPhraseLeadEn: 'Please see',
    }
    const settings = {
      ...baseSettings,
      aiProfile,
      snippetPhraseLeadEn: 'Please see',
    }

    expect(() => verify(patch, settings)).not.toThrow()
  })

  it.each([
    ['missing receipt', (_patch: UserSettingsPatch, settings: UserSettings) => user(settings)],
    ['old canonical value', (patch: UserSettingsPatch, settings: UserSettings) => user({
      ...settings,
      snippetPhraseLeadEn: 'Old value',
    }, receipt(patch, settings))],
    ['mixed-version missing field', (patch: UserSettingsPatch, settings: UserSettings) => user({
      ...settings,
      aiProfile: undefined,
    }, receipt(patch, settings))],
  ])('rejects a %s response', (_label, responseFor) => {
    const patch = {
      aiProfile,
      snippetPhraseLeadEn: 'New value',
    }
    const settings = {
      ...baseSettings,
      aiProfile,
      snippetPhraseLeadEn: 'New value',
    }

    expect(() => verify(patch, settings, responseFor(patch, settings))).toThrow(
      SettingsPersistenceAcknowledgementError,
    )
  })

  it('uses secret-presence receipts and rejects raw secret reflection', () => {
    const patch = { smtpPass: 'server-only-secret' }
    const settings = { ...baseSettings, smtpPassSet: true }
    expect(() => verify(patch, settings)).not.toThrow()
    expect(() => verify(patch, { ...settings, smtpPass: 'server-only-secret' })).toThrow(
      SettingsPersistenceAcknowledgementError,
    )
  })

  it('rejects a stale secret response even when a password was already present', () => {
    const previousSettings = { ...baseSettings, smtpPassSet: true }
    const patch = { smtpPass: 'replacement-secret' }
    const settings = { ...previousSettings }
    const staleReceipt = {
      ...receipt(patch, settings),
      settingsVersion: 7,
      secretReceipts: {
        smtpPass: { operation: 'set' as const, present: true, version: 7 },
      },
    }

    expect(() => assertSettingsPersistenceAcknowledged({
      previous: user(previousSettings, undefined, 7),
      patch,
      response: user(settings, staleReceipt, 7),
    })).toThrow(SettingsPersistenceAcknowledgementError)
  })

  it('normalizes submitted and canonical receive-email addresses before comparison', () => {
    const patch: UserSettingsPatch = {
      receiveEmails: [{
        address: 'Professor@Example.COM',
        isPrimary: true,
        notify: true,
        verified: true,
      }],
    }
    const settings: UserSettings = {
      ...baseSettings,
      receiveAt: 'professor@example.com',
      receiveEmails: [{
        address: 'professor@example.com',
        isPrimary: true,
        notify: true,
        verified: true,
      }],
    }
    expect(() => verify(patch, settings)).not.toThrow()
  })

  it('rejects an unchanged calendar token after a generation command', () => {
    const previous = { ...baseSettings, calendarToken: 'old-token' }
    const patch = { generateCalendarToken: true }
    const settings = { ...previous }
    expect(() => assertSettingsPersistenceAcknowledged({
      previous: user(previous, undefined, 1),
      patch,
      response: user(settings, receipt(patch, settings)),
    })).toThrow(SettingsPersistenceAcknowledgementError)
  })
})
