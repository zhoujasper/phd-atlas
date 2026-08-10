import { describe, expect, it } from 'vitest'
import {
  BACKUP_FREQUENCIES,
  DEFAULT_BACKUP_FREQUENCY,
  normalizeBackupFrequency as sharedNormalize,
} from '../../../shared/backupFrequency.js'
import {
  backupFrequencyOptions,
  backupFrequencyOptionsFor,
  normalizeBackupFrequency as adminNormalize,
} from './adminScreenModel'

/**
 * The browser and the server each normalized backup cadence with their own
 * copy, and the browser's validated against whatever its picker happened to
 * offer. The admin console lists four cadences; the server accepts eleven, and
 * its default — `15m` — is not among the four. An account on any sub-hourly
 * schedule therefore displayed "Daily", and saving anything on that screen
 * wrote `daily` back, changing a backup schedule nobody had touched.
 */
describe('backup cadence survives a round trip through the browser', () => {
  it('preserves every cadence the server accepts', () => {
    for (const frequency of BACKUP_FREQUENCIES) {
      expect(adminNormalize(frequency)).toBe(frequency)
    }
  })

  it('preserves the server default, which the admin picker does not list', () => {
    expect(backupFrequencyOptions.some((option) => option.value === DEFAULT_BACKUP_FREQUENCY)).toBe(false)
    expect(adminNormalize(DEFAULT_BACKUP_FREQUENCY)).toBe(DEFAULT_BACKUP_FREQUENCY)
    // And the picker can still show it, so the next change starts from the
    // cadence the account is actually on.
    expect(backupFrequencyOptionsFor(DEFAULT_BACKUP_FREQUENCY).some(
      (option) => option.value === DEFAULT_BACKUP_FREQUENCY,
    )).toBe(true)
  })

  it('agrees with the shared normalizer on legacy and unknown values', () => {
    for (const value of ['weekly', 'monthly', 'nonsense', '', undefined]) {
      expect(adminNormalize(value as string | undefined)).toBe(sharedNormalize(value as string))
    }
    expect(sharedNormalize('weekly')).toBe('7d')
  })

  it('does not add an option when the cadence is already listed', () => {
    expect(backupFrequencyOptionsFor('daily')).toBe(backupFrequencyOptions)
  })
})
