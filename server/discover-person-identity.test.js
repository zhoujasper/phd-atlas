import { describe, expect, it } from 'vitest'
import { isLikelyAdvisorPersonName } from './discover-person-identity.js'

describe('Discover advisor person identity', () => {
  it.each([
    'Center For Computational Biology',
    'Advisory Board',
    'Principal Investigators',
    'Machine Learning Research Group',
    'Curriculum Vitae',
    'Key Contacts',
    'C Luca',
    'S Emmanuel',
    'Frequently Asked Questions',
  ])('rejects organisation or directory label %s', (value) => {
    expect(isLikelyAdvisorPersonName(value)).toBe(false)
  })

  it.each([
    'H. Sebastian Seung',
    'Wulfram Gerstner',
    'José García',
    '王伟',
  ])('retains plausible Unicode person name %s', (value) => {
    expect(isLikelyAdvisorPersonName(value)).toBe(true)
  })
})
