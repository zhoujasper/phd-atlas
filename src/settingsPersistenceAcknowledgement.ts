import {
  SETTINGS_PERSISTENCE_ACK_PROTOCOL,
  type PublicUser,
  type SettingsPersistenceAcknowledgement,
  type UserSettings,
  type UserSettingsPatch,
} from './api/phdApi'

export class SettingsPersistenceAcknowledgementError extends Error {
  readonly code = 'SETTINGS_PERSISTENCE_NOT_ACKNOWLEDGED'

  constructor() {
    super('Settings could not be confirmed as saved.')
    this.name = 'SettingsPersistenceAcknowledgementError'
  }
}

type SettingsResponseUser = PublicUser & {
  settingsAcknowledgement?: Partial<SettingsPersistenceAcknowledgement>
}

const SETTINGS_MUTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u

const PATCH_COMMAND_KEYS = new Set<keyof UserSettingsPatch>([
  'clearSmtpPass',
  'clearIncomingPass',
  'generateCalendarToken',
])

function fail(): never {
  throw new SettingsPersistenceAcknowledgementError()
}

export function isNewerSettingsPersistenceVersion(current: unknown, candidate: unknown) {
  const currentVersion = Number(current)
  const candidateVersion = Number(candidate)
  return Number.isSafeInteger(currentVersion)
    && Number.isSafeInteger(candidateVersion)
    && candidateVersion > currentVersion
}

function own(object: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function submittedKeys(patch: UserSettingsPatch) {
  return Object.keys(patch)
    .filter((key) => (patch as Record<string, unknown>)[key] !== undefined)
    .sort()
}

function sameKeyReceipt(actual: unknown, expected: readonly string[]) {
  if (!Array.isArray(actual) || actual.some((key) => typeof key !== 'string')) return false
  const normalized = [...new Set(actual)].sort()
  return normalized.length === actual.length
    && normalized.length === expected.length
    && normalized.every((key, index) => key === expected[index])
}

function submittedValueMatches(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) return true
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => submittedValueMatches(value, actual[index]))
  }
  if (!expected || typeof expected !== 'object' || !actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return false
  }
  return Object.entries(expected).every(([key, value]) => (
    own(actual, key) && submittedValueMatches(value, (actual as Record<string, unknown>)[key])
  ))
}

const TRIMMED_PROFILE_PRESET_KEYS = new Set([
  'kind',
  'nameZh',
  'nameEn',
  'descriptionZh',
  'descriptionEn',
  'contentZh',
  'contentEn',
  'icon',
])

function canonicalSubmittedValue(key: keyof UserSettingsPatch, value: unknown): unknown {
  if (key === 'aiProfile' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [
      field,
      typeof fieldValue === 'string' ? fieldValue.trim() : fieldValue,
    ]))
  }
  if (key === 'profilePresets' && Array.isArray(value)) {
    return value.map((preset) => {
      if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return preset
      return Object.fromEntries(Object.entries(preset).map(([field, fieldValue]) => [
        field,
        TRIMMED_PROFILE_PRESET_KEYS.has(field) && typeof fieldValue === 'string'
          ? fieldValue.trim()
          : fieldValue,
      ]))
    })
  }
  if (
    (key === 'customApplicationStatuses'
      || key === 'customChecklistStatuses'
      || key === 'customChecklistMaterialFormats')
    && Array.isArray(value)
  ) {
    return value.map((status) => typeof status === 'string' ? status.trim() : status)
  }
  return value
}

function receiveEmailsMatch(
  expected: NonNullable<UserSettingsPatch['receiveEmails']>,
  actual: UserSettings['receiveEmails'],
  receiveAt: string | undefined,
) {
  if (!Array.isArray(actual) || expected.length !== actual.length) return false
  const actualByAddress = new Map(actual.map((email) => [email.address.trim().toLowerCase(), email]))
  if (actualByAddress.size !== actual.length) return false

  for (const submitted of expected) {
    const canonical = actualByAddress.get(submitted.address.trim().toLowerCase())
    if (!canonical) return false
    const verified = canonical.verified === true
    if (canonical.notify !== Boolean(submitted.notify && verified)) return false
  }

  const requestedPrimary = expected.find((email) => {
    const canonical = actualByAddress.get(email.address.trim().toLowerCase())
    return email.isPrimary && canonical?.verified === true
  })
  const fallbackPrimary = actual.find((email) => email.verified === true)
  const expectedPrimaryAddress = (requestedPrimary?.address ?? fallbackPrimary?.address)?.trim().toLowerCase()
  const canonicalPrimary = actual.filter((email) => email.isPrimary)
  if (expectedPrimaryAddress) {
    if (
      canonicalPrimary.length !== 1
      || canonicalPrimary[0].address.trim().toLowerCase() !== expectedPrimaryAddress
    ) return false
    if (receiveAt?.trim().toLowerCase() !== expectedPrimaryAddress) return false
  } else if (canonicalPrimary.length > 0) {
    return false
  }
  return true
}

function expectedSecretMutation(
  _previous: UserSettings,
  patch: UserSettingsPatch,
  secret: 'smtpPass' | 'incomingPass',
  clear: 'clearSmtpPass' | 'clearIncomingPass',
) {
  if (patch[clear] === true) return { operation: 'clear' as const, present: false }
  const submitted = patch[secret]
  if (typeof submitted === 'string' && submitted.length > 0) {
    return { operation: 'set' as const, present: true }
  }
  return null
}

/**
 * Throws unless the response proves a durable, current-protocol commit and its
 * canonical settings contain every submitted value. Raw secrets are never
 * compared or returned; their explicit presence receipts are authoritative.
 */
export function assertSettingsPersistenceAcknowledged({
  previous,
  patch,
  response,
  requireDurableReceipt = true,
}: {
  previous: PublicUser
  patch: UserSettingsPatch
  response: SettingsResponseUser
  /** Dedicated durable endpoints may provide their own operation receipt. */
  requireDurableReceipt?: boolean
}) {
  const canonical = response.settings
  if (!canonical || typeof canonical !== 'object') fail()

  const expectedKeys = submittedKeys(patch)
  const receipt = response.settingsAcknowledgement
  if (requireDurableReceipt) {
    if (
      receipt?.protocol !== SETTINGS_PERSISTENCE_ACK_PROTOCOL
      || receipt.version !== 1
      || receipt.durable !== true
      || typeof receipt.mutationId !== 'string'
      || !SETTINGS_MUTATION_ID_PATTERN.test(receipt.mutationId)
      || !Number.isSafeInteger(previous.settingsVersion)
      || !Number.isSafeInteger(receipt.settingsVersion)
      || receipt.settingsVersion! <= previous.settingsVersion!
      || response.settingsVersion !== receipt.settingsVersion
      || !sameKeyReceipt(receipt.keys, expectedKeys)
    ) fail()
  }

  const previousSettings = previous.settings
  const smtpMutation = expectedSecretMutation(previousSettings, patch, 'smtpPass', 'clearSmtpPass')
  const incomingMutation = expectedSecretMutation(previousSettings, patch, 'incomingPass', 'clearIncomingPass')
  const smtpPassSet = smtpMutation?.present ?? Boolean(previousSettings.smtpPassSet)
  const incomingPassSet = incomingMutation?.present ?? Boolean(previousSettings.incomingPassSet)
  if (canonical.smtpPassSet !== smtpPassSet || canonical.incomingPassSet !== incomingPassSet) fail()
  if ((canonical.smtpPass ?? '') !== '' || (canonical.incomingPass ?? '') !== '') fail()
  if (requireDurableReceipt) {
    const receipts = receipt?.secretReceipts
    if (!receipts || typeof receipts !== 'object') fail()
    for (const [secret, expected] of [
      ['smtpPass', smtpMutation],
      ['incomingPass', incomingMutation],
    ] as const) {
      const actual = receipts[secret]
      if (!expected) {
        if (actual !== undefined) fail()
        continue
      }
      if (
        actual?.operation !== expected.operation
        || actual.present !== expected.present
        || actual.version !== receipt?.settingsVersion
      ) fail()
    }
  }

  for (const key of expectedKeys as Array<keyof UserSettingsPatch>) {
    if (PATCH_COMMAND_KEYS.has(key) || key === 'smtpPass' || key === 'incomingPass') continue
    if (key === 'receiveEmails') {
      if (!patch.receiveEmails || !receiveEmailsMatch(patch.receiveEmails, canonical.receiveEmails, canonical.receiveAt)) {
        fail()
      }
      continue
    }
    if (
      !own(canonical, key)
      || !submittedValueMatches(
        canonicalSubmittedValue(key, patch[key]),
        canonical[key as keyof UserSettings],
      )
    ) fail()
  }

  if (patch.generateCalendarToken === true) {
    if (!canonical.calendarToken || canonical.calendarToken === previousSettings.calendarToken) fail()
  }
}
