/**
 * The single declaration of what a user setting is.
 *
 * A setting used to be described four times, in three dialects: a Zod shape in
 * `validation.js`, a hand-written `json_extract` column list in the focused
 * session SQL, a hand-written row→object mapper beside it, and the public
 * projection in `publicUser`. Nothing tied them together, so they drifted — and
 * a setting missing from one of them does not fail loudly. It either vanishes
 * on the next load, or the browser's durability check reports a committed write
 * as a generic failure, which is how "add a correspondence category" ended up
 * broken while quietly persisting.
 *
 * Every mechanical layer is now derived from this list, so a setting cannot
 * exist in one layer and not another. What stays hand-written is the part that
 * is genuinely logic rather than plumbing: plan-dependent quotas, mailbox
 * reconciliation, and the fixed-shape AI profile, all of which the registry
 * marks as `derived` so the contract test knows to expect them from
 * `normalizeUserSettings` instead of from here.
 *
 * Adding a setting is one entry here plus its Zod rule; the contract test in
 * `server/settingsProjectionContract.test.js` fails if those two disagree.
 */

/** Reader shapes the focused login projection knows how to emit and decode. */
export const SETTING_READERS = Object.freeze({
  /** Value copied straight through; SQLite's own type is preserved. */
  scalar: 'scalar',
  /** Always a boolean, absent reads as false. */
  bool: 'bool',
  /** Boolean that must stay distinguishable from "never set". */
  optionalBool: 'optionalBool',
  /** Bounded text. Over its cap the projection substitutes `fallback`. */
  text: 'text',
  /** Bounded JSON array/object, parsed on the way out. */
  json: 'json',
  /**
   * A stored secret. The projection may only ever learn whether one is set:
   * the value itself is never selected, so it cannot reach a response by
   * mistake. See `assertNoSecretValues` below.
   */
  secret: 'secret',
})

const SECRET_PRESENCE_MARKER = '__configured__'

/**
 * Size caps are load-bearing, not defensive. This projection runs on the login
 * and workspace-hydration paths, so an unbounded field would put an arbitrary
 * amount of a single account's data on a hot path shared by every signed-in
 * request. A field over its cap degrades to `fallback` rather than being
 * allowed through.
 */
const BYTES = {
  avatar: 600_000,
  mailboxes: 32_768,
  token: 512,
  phrase: 65_536,
  taxonomy: 8_192,
  aiProfile: 65_536,
  presets: 1_048_576,
  recommenders: 786_432,
}

/**
 * Declaration order is the projection's column order, kept close to the shape a
 * session actually reads: identity and appearance, then delivery, then quotas,
 * then the account's own libraries.
 */
export const USER_SETTINGS_FIELDS = Object.freeze([
  /**
   * Interface language is the one setting that is a real column rather than a
   * key inside the settings document, because authentication and transactional
   * mail need it without decoding the blob. It is declared here anyway so the
   * accepted-key contract can see it.
   */
  { key: 'language', reader: 'scalar', column: 'account_language' },
  { key: 'contentLanguagePrimary', reader: 'scalar' },
  { key: 'contentLanguageSecondary', reader: 'scalar' },
  { key: 'highContrast', reader: 'bool' },
  { key: 'themeAccent', reader: 'scalar' },
  // Shed by blanking rather than removal: the session still needs the key.
  { key: 'avatarDataUrl', reader: 'text', maxBytes: BYTES.avatar, fallback: '', shed: 'blank' },

  { key: 'sendFrom', reader: 'scalar' },
  { key: 'receiveAt', reader: 'scalar' },
  { key: 'receiveEmails', reader: 'json', jsonType: 'array', maxBytes: BYTES.mailboxes },
  { key: 'emailNotificationsEnabled', reader: 'optionalBool' },
  { key: 'browserNotificationsEnabled', reader: 'optionalBool' },

  { key: 'membershipPlan', reader: 'scalar', derived: true },
  { key: 'personalMembershipPlan', reader: 'scalar', derived: true },
  { key: 'autoBackup', reader: 'bool' },
  { key: 'backupFrequency', reader: 'scalar' },
  { key: 'maxBackupsPerApp', reader: 'scalar' },

  { key: 'smtpHost', reader: 'scalar' },
  { key: 'smtpPort', reader: 'scalar' },
  { key: 'smtpUser', reader: 'scalar' },
  { key: 'smtpPass', reader: 'secret' },
  { key: 'smtpTls', reader: 'optionalBool' },
  { key: 'incomingProtocol', reader: 'scalar' },
  { key: 'incomingHost', reader: 'scalar' },
  { key: 'incomingPort', reader: 'scalar' },
  { key: 'incomingUser', reader: 'scalar' },
  { key: 'incomingPass', reader: 'secret' },
  { key: 'incomingTls', reader: 'optionalBool' },
  { key: 'autoFetchMail', reader: 'bool' },

  { key: 'storageQuotaMb', reader: 'scalar', derived: true },
  { key: 'applicationQuota', reader: 'scalar', derived: true },
  { key: 'applicationCreateQuota', reader: 'scalar', derived: true },
  { key: 'applicationCreatedCount', reader: 'scalar', derived: true },
  { key: 'shareQuota', reader: 'scalar', derived: true },
  { key: 'shareCreateQuota', reader: 'scalar', derived: true },
  { key: 'shareCreatedCount', reader: 'scalar', derived: true },
  { key: 'trashRetentionDays', reader: 'scalar', derived: true },
  { key: 'sessionDurationMinutes', reader: 'scalar', derived: true },
  { key: 'calendarToken', reader: 'text', maxBytes: BYTES.token, fallback: null },

  { key: 'snippetPhraseLeadZh', reader: 'text', maxBytes: BYTES.phrase, fallback: '' },
  { key: 'snippetPhraseTailZh', reader: 'text', maxBytes: BYTES.phrase, fallback: '' },
  { key: 'snippetPhraseLeadEn', reader: 'text', maxBytes: BYTES.phrase, fallback: '' },
  { key: 'snippetPhraseTailEn', reader: 'text', maxBytes: BYTES.phrase, fallback: '' },

  { key: 'customApplicationStatuses', reader: 'json', jsonType: 'array', maxBytes: BYTES.taxonomy },
  { key: 'customChecklistStatuses', reader: 'json', jsonType: 'array', maxBytes: BYTES.taxonomy },
  { key: 'customChecklistMaterialFormats', reader: 'json', jsonType: 'array', maxBytes: BYTES.taxonomy },
  { key: 'customMailCategories', reader: 'json', jsonType: 'array', maxBytes: BYTES.taxonomy },
  { key: 'aiProfile', reader: 'json', jsonType: 'object', maxBytes: BYTES.aiProfile, derived: true },
  { key: 'profilePresets', reader: 'json', jsonType: 'array', maxBytes: BYTES.presets, shed: true },
  {
    key: 'profileRecommenders',
    reader: 'json',
    jsonType: 'array',
    maxBytes: BYTES.recommenders,
    shed: true,
    // Written only through its own atomic endpoint; PATCH /api/settings refuses it.
    dedicatedRoute: true,
  },
])

const FIELDS_BY_KEY = new Map(USER_SETTINGS_FIELDS.map((field) => [field.key, field]))

export function userSettingsField(key) {
  return FIELDS_BY_KEY.get(key) ?? null
}

export function userSettingsKeys() {
  return USER_SETTINGS_FIELDS.map((field) => field.key)
}

/** Secrets never leave the server; only their presence does. */
export function userSettingsSecretKeys() {
  return USER_SETTINGS_FIELDS.filter((field) => field.reader === 'secret').map((field) => field.key)
}

/**
 * Large optional values, dropped in size order when a legacy account's settings
 * exceed the session budget. Declared here so the shedding order can never name
 * a field that no longer exists. `shed: 'blank'` keeps the key and empties it;
 * `shed: true` removes it outright.
 */
export function userSettingsShedKeys() {
  return USER_SETTINGS_FIELDS.filter((field) => field.shed === true).map((field) => field.key)
}

export function userSettingsBlankOnShedKeys() {
  return USER_SETTINGS_FIELDS.filter((field) => field.shed === 'blank').map((field) => field.key)
}

/** `themeAccent` → `theme_accent`. */
export function settingColumnName(key) {
  const field = FIELDS_BY_KEY.get(key)
  if (field?.column) return field.column
  const snake = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase()
  if (field?.reader === 'secret') return `${snake}_marker`
  if (field?.reader === 'json') return `${snake}_json`
  return snake
}

function sqlJsonPath(key) {
  // Keys are code-owned identifiers, never user input; this assertion keeps it
  // that way rather than trusting the call site.
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(key)) {
    throw new TypeError(`Unsafe user settings key: ${key}`)
  }
  return `'$.${key}'`
}

function sqlTextLiteral(value) {
  return `'${String(value).replace(/'/gu, "''")}'`
}

function columnSql(field) {
  const path = sqlJsonPath(field.key)
  const column = settingColumnName(field.key)
  const extract = `json_extract(settings, ${path})`
  switch (field.reader) {
    case 'secret':
      // The value is deliberately never selected — only whether one exists.
      return `CASE WHEN COALESCE(LENGTH(${extract}), 0) > 0
           THEN ${sqlTextLiteral(SECRET_PRESENCE_MARKER)} ELSE '' END AS ${column}`
    case 'text': {
      const fallback = field.fallback === null ? 'NULL' : sqlTextLiteral(field.fallback ?? '')
      return `CASE
           WHEN json_type(settings, ${path}) = 'text'
            AND LENGTH(CAST(${extract} AS BLOB)) <= ${field.maxBytes}
           THEN ${extract} ELSE ${fallback}
         END AS ${column}`
    }
    case 'json':
      return `CASE
           WHEN json_type(settings, ${path}) = ${sqlTextLiteral(field.jsonType)}
            AND LENGTH(CAST(${extract} AS BLOB)) <= ${field.maxBytes}
           THEN ${extract} ELSE NULL
         END AS ${column}`
    default:
      return `${extract} AS ${column}`
  }
}

/**
 * The generated `SELECT` list for the focused session projection. Fields backed
 * by a real column are already selected by the surrounding query and are not
 * extracted from the settings document.
 */
export function focusedSessionSettingsColumnsSql() {
  return USER_SETTINGS_FIELDS
    .filter((field) => !field.column)
    .map((field) => `         ${columnSql(field)}`)
    .join(',\n')
}

/**
 * Decode one focused session row back into a settings object, using the same
 * declarations that produced its columns. `parseJson` is injected so this module
 * stays free of storage concerns.
 */
export function focusedSessionSettingsFromRow(row, parseJson) {
  const settings = {}
  for (const field of USER_SETTINGS_FIELDS) {
    const value = row?.[settingColumnName(field.key)]
    switch (field.reader) {
      case 'bool':
        settings[field.key] = Boolean(value)
        break
      case 'optionalBool':
        settings[field.key] = value === null || value === undefined ? undefined : Boolean(value)
        break
      case 'text':
        settings[field.key] = field.fallback === null ? (value ?? undefined) : (value ?? field.fallback)
        break
      case 'json':
        settings[field.key] = parseJson(value)
        break
      case 'secret':
        // Already reduced to a presence marker by the projection.
        settings[field.key] = value
        break
      default:
        settings[field.key] = value
    }
  }
  return settings
}

/**
 * Structural guarantee that a secret cannot be served. `publicUser` masks these
 * by hand today; this makes a forgotten mask a failing assertion rather than a
 * silent credential leak, and it runs over the projection every test exercises.
 */
export function assertNoSecretValues(settings) {
  for (const key of userSettingsSecretKeys()) {
    const value = settings?.[key]
    if (value === undefined || value === '' || value === SECRET_PRESENCE_MARKER) continue
    throw new Error(`User settings projection leaked the stored secret "${key}".`)
  }
}

export { SECRET_PRESENCE_MARKER }
