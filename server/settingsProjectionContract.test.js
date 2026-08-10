import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { publicUser } from './storage.js'
import {
  USER_SETTINGS_FIELDS,
  assertNoSecretValues,
  focusedSessionSettingsColumnsSql,
  focusedSessionSettingsFromRow,
  settingColumnName,
  userSettingsKeys,
  userSettingsSecretKeys,
} from './userSettingsRegistry.js'

/**
 * A user setting used to be declared four times in three dialects — a Zod
 * shape, a `json_extract` column list, a row→object mapper, and the public
 * projection — with nothing tying them together. They drifted, and a setting
 * missing from one layer fails quietly: it either disappears on the next load,
 * or a committed write is reported to the person as a generic failure because
 * the browser cannot find the key it submitted.
 *
 * The mechanical layers are now generated from `userSettingsRegistry.js`. What
 * remains to pin is the boundary between that registry and the two things it
 * cannot generate: the Zod schema that accepts a write, and the plan-dependent
 * logic in `normalizeUserSettings`.
 */
const PATCH_COMMAND_KEYS = new Set([
  // Instructions rather than stored values, resolved before persistence.
  'clearSmtpPass',
  'clearIncomingPass',
  'generateCalendarToken',
])

function userSettingsPatchKeys() {
  const source = readFileSync(path.join(process.cwd(), 'server', 'validation.js'), 'utf8')
  const start = source.indexOf('export const UserSettingsPatchSchema = z.object({')
  expect(start).toBeGreaterThan(-1)
  const body = source.slice(start, source.indexOf('\n})', start))
  return [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gmu)].map((match) => match[1])
}

describe('user settings registry contract', () => {
  it('declares every key the settings endpoint accepts', () => {
    const declared = new Set(userSettingsKeys())
    const undeclared = userSettingsPatchKeys()
      .filter((key) => !PATCH_COMMAND_KEYS.has(key) && !declared.has(key))

    // An accepted key with no declaration cannot be read back out of SQLite.
    expect(undeclared).toEqual([])
  })

  it('selects and decodes every declared key', () => {
    const sql = focusedSessionSettingsColumnsSql()
    for (const field of USER_SETTINGS_FIELDS) {
      // A field backed by a real column is selected by the surrounding query.
      if (field.column) continue
      expect(sql).toContain(`$.${field.key}`)
      expect(sql).toContain(`AS ${settingColumnName(field.key)}`)
    }

    // Decoding is driven by the same declarations, so a row built from the
    // generated column names round-trips every key.
    const row = Object.fromEntries(USER_SETTINGS_FIELDS.map((field) => {
      const column = settingColumnName(field.key)
      if (field.reader === 'json') return [column, JSON.stringify(field.jsonType === 'object' ? {} : [])]
      if (field.reader === 'secret') return [column, '__configured__']
      if (field.reader === 'bool' || field.reader === 'optionalBool') return [column, 1]
      return [column, 'value']
    }))
    const decoded = focusedSessionSettingsFromRow(row, (value) => JSON.parse(value))
    expect(Object.keys(decoded).sort()).toEqual(userSettingsKeys().sort())
  })

  it('keeps a stored credential inside the process', () => {
    expect(userSettingsSecretKeys()).toEqual(['smtpPass', 'incomingPass'])
    // The projection may only ever learn that a secret exists.
    const sql = focusedSessionSettingsColumnsSql()
    for (const key of userSettingsSecretKeys()) {
      expect(sql).toContain(`COALESCE(LENGTH(json_extract(settings, '$.${key}')), 0) > 0`)
    }
    expect(() => assertNoSecretValues({ smtpPass: 'hunter2' })).toThrow(/leaked the stored secret/u)
    expect(() => assertNoSecretValues({ smtpPass: '', incomingPass: '__configured__' })).not.toThrow()

    // And the account projection every authenticated response uses enforces it.
    const projected = publicUser({
      id: 'user_secret',
      name: 'Jasper',
      email: 'jasper@example.com',
      role: 'user',
      settingsVersion: 3,
      settings: { smtpPass: 'hunter2', incomingPass: 'hunter2' },
    }).settings
    expect(projected.smtpPass).toBe('')
    expect(projected.incomingPass).toBe('')
    expect(projected.smtpPassSet).toBe(true)
  })

  it('emits every accepted settings key from the public projection', () => {
    const stored = {
      customApplicationStatuses: ['Shortlisted'],
      customChecklistStatuses: ['Chasing'],
      customChecklistMaterialFormats: ['Poster'],
      customMailCategories: [{ id: 'custom:offer', label: 'Offer', tone: 'success' }],
      profilePresets: [],
      aiProfile: { preferredName: 'Jasper' },
    }
    const projected = publicUser({
      id: 'user_projection',
      name: 'Jasper',
      email: 'jasper@example.com',
      role: 'user',
      settingsVersion: 2,
      settings: stored,
    }).settings

    const missing = USER_SETTINGS_FIELDS
      .filter((field) => !field.dedicatedRoute && !Object.hasOwn(projected, field.key))
      .map((field) => field.key)
    expect(missing).toEqual([])

    for (const [key, value] of Object.entries(stored)) {
      // aiProfile is a fixed-shape record: the projection fills every field it
      // owns, so it is checked for containment rather than equality.
      if (key === 'aiProfile') expect(projected[key]).toMatchObject(value)
      else expect(projected[key]).toEqual(value)
    }
  })

  it('keeps the login projection bounded so one account cannot slow the hot path', () => {
    // This projection runs on sign-in and on every workspace hydration, so an
    // unbounded field would put one account's data on a path shared by every
    // signed-in request. Anything large must declare a cap.
    const uncapped = USER_SETTINGS_FIELDS
      .filter((field) => (field.reader === 'text' || field.reader === 'json') && !field.maxBytes)
      .map((field) => field.key)
    expect(uncapped).toEqual([])

    // And the largest fields must be sheddable, or a legacy account carrying
    // them could not be reduced to fit the session budget at all.
    const unsheddable = USER_SETTINGS_FIELDS
      .filter((field) => (field.maxBytes ?? 0) >= 512 * 1024 && !field.shed)
      .map((field) => field.key)
    expect(unsheddable).toEqual([])
  })
})
