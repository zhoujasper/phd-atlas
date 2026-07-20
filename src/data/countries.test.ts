import { describe, expect, it } from 'vitest'
import {
  COUNTRIES,
  countryDisplayName,
  countryFlagEmoji,
  formatApplicationIdentity,
  resolveCountry,
} from './countries'

describe('countries', () => {
  it('resolves common aliases and ISO codes', () => {
    expect(resolveCountry('US')?.name).toBe('United States')
    expect(resolveCountry('USA')?.code).toBe('US')
    expect(resolveCountry('United States')?.code).toBe('US')
    expect(resolveCountry('UK')?.code).toBe('GB')
    expect(resolveCountry('China')?.code).toBe('CN')
    expect(resolveCountry('Hong Kong')?.code).toBe('HK')
    expect(resolveCountry('Switzerland')?.code).toBe('CH')
  })

  it('localizes display names when possible', () => {
    expect(countryDisplayName('United States', 'en')).toMatch(/United States|US/i)
    expect(countryDisplayName('China', 'zh')).toContain('中国')
    expect(countryDisplayName('Unknown Place', 'en')).toBe('Unknown Place')
    expect(countryDisplayName('', 'en')).toBe('')
  })

  it('builds flag emoji for ISO codes', () => {
    expect(countryFlagEmoji('US')).toBeTruthy()
    expect(countryFlagEmoji('GB').length).toBeGreaterThan(0)
    expect(countryFlagEmoji('')).toBe('')
  })

  it('formats application identity as advisor - school - region', () => {
    const label = formatApplicationIdentity({
      professor: { english: 'Prof. Hannah Lee', chinese: '李教授' },
      school: { name: 'Stanford University', country: 'United States' },
    }, 'en')
    expect(label).toBe('Prof. Hannah Lee - Stanford University - United States')
  })

  it('has unique ISO codes', () => {
    const codes = COUNTRIES.map((entry) => entry.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
