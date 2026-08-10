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

describe('account-scoped checklist statuses', () => {
  it('accepts one shared taxonomy for materials and tasks', () => {
    expect(UserSettingsPatchSchema.parse({
      customChecklistStatuses: ['Faculty review', 'Waiting on portal'],
    })).toEqual({
      customChecklistStatuses: ['Faculty review', 'Waiting on portal'],
    })
  })

  it('rejects built-in checklist statuses and case-insensitive duplicates', () => {
    expect(() => UserSettingsPatchSchema.parse({
      customChecklistStatuses: ['Done'],
    })).toThrow()
    expect(() => UserSettingsPatchSchema.parse({
      customChecklistStatuses: ['Faculty review', 'faculty review'],
    })).toThrow()
  })
})

describe('account-scoped checklist material formats', () => {
  it('accepts one taxonomy shared by every application', () => {
    expect(UserSettingsPatchSchema.parse({
      customChecklistMaterialFormats: ['Portal upload', 'Sealed envelope'],
    })).toEqual({
      customChecklistMaterialFormats: ['Portal upload', 'Sealed envelope'],
    })
  })

  it('rejects built-in formats and case-insensitive duplicates', () => {
    expect(() => UserSettingsPatchSchema.parse({
      customChecklistMaterialFormats: ['PDF'],
    })).toThrow()
    expect(() => UserSettingsPatchSchema.parse({
      customChecklistMaterialFormats: ['Online form'],
    })).toThrow()
    expect(() => UserSettingsPatchSchema.parse({
      customChecklistMaterialFormats: ['Portal upload', 'portal upload'],
    })).toThrow()
  })
})
