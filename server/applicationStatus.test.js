import { describe, expect, it } from 'vitest'
import {
  ApplicationStatusSchema,
  UserSettingsPatchSchema,
} from './validation.js'

describe('account-scoped custom application statuses', () => {
  it('accepts a bounded custom status on application records', () => {
    expect(ApplicationStatusSchema.parse('  Committee review  ')).toBe('Committee review')
    expect(ApplicationStatusSchema.parse(' Accepted ')).toBe('Accepted')
    expect(() => ApplicationStatusSchema.parse('accepted')).toThrow()
  })

  it('accepts unique custom statuses in user settings', () => {
    expect(UserSettingsPatchSchema.parse({
      customApplicationStatuses: ['Committee review', 'Funding pending'],
    })).toEqual({
      customApplicationStatuses: ['Committee review', 'Funding pending'],
    })
  })

  it('rejects built-in duplicates and case-insensitive custom duplicates', () => {
    expect(() => UserSettingsPatchSchema.parse({
      customApplicationStatuses: ['Draft'],
    })).toThrow()
    expect(() => UserSettingsPatchSchema.parse({
      customApplicationStatuses: ['Committee review', 'committee review'],
    })).toThrow()
  })
})
