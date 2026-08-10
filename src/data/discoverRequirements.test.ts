import { describe, expect, it } from 'vitest'
import { DEFAULT_REQUIREMENT_FILTERS, programMatchesRequirementFilters, type DiscoverRequirements } from './discoverRequirements'

function requirements(certainty: 'official' | 'rolling', date: string | null): DiscoverRequirements {
  return {
    deadlines: [{ id: 'application', label: 'Application', kind: 'application', certainty, date }],
    tests: [],
    materials: [],
    fees: { amountUSD: null, waiverAvailable: false },
    restrictions: { multiApply: 'multi', supervisorContact: 'optional', priorDegree: '', intlEligible: true, other: [], summary: '' },
    route: { type: 'portal', label: '', steps: [] },
    degreeMilestones: [],
    verified: { deadlines: true, restrictions: true, fees: true },
  }
}

describe('rolling requirement filter', () => {
  it('keeps rolling applications and excludes fixed-deadline applications', () => {
    const filters = { ...DEFAULT_REQUIREMENT_FILTERS, rollingOk: true }
    expect(programMatchesRequirementFilters(requirements('rolling', null), 'multi', filters)).toBe(true)
    expect(programMatchesRequirementFilters(requirements('official', '2027-01-15'), 'multi', filters)).toBe(false)
  })
})
