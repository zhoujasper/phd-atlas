import { describe, expect, it } from 'vitest'
import { normalizeRequirements } from './discover-requirements.js'

const assertedTemplate = {
  deadlines: [{
    id: 'main',
    label: 'Official deadline',
    date: '2027-01-15',
    kind: 'application',
    certainty: 'official',
    notes: 'Published by the programme.',
  }],
  tests: [{ id: 'gre', name: 'GRE', status: 'required', notes: '' }],
  materials: [{ id: 'letters', name: 'Recommendation letters', required: true, count: 3 }],
  fees: { amountUSD: 125, currency: 'USD', waiverAvailable: true },
  restrictions: {
    multiApply: 'single',
    supervisorContact: 'required',
    priorDegree: 'Bachelor\u2019s degree',
    intlEligible: true,
    other: ['Only one application'],
    summary: 'One programme per cycle.',
  },
  route: { type: 'portal', label: 'Graduate portal', steps: ['Submit online'], notes: '' },
  degreeMilestones: ['Qualifying exam'],
  verified: { deadlines: true, restrictions: true, fees: true },
}

describe('Discover AI requirement evidence safety', () => {
  it('does not import plausible defaults without field-level official evidence', () => {
    const requirements = normalizeRequirements(assertedTemplate, {
      provenance: 'ai',
      factSources: {},
      deadlineIso: '2027-01-15',
      applicationRoute: 'Graduate portal',
      degreeStructure: 'Qualifying exam',
      multiApply: 'single',
    })

    expect(requirements.deadlines).toEqual([expect.objectContaining({ date: null, certainty: 'unknown' })])
    expect(requirements.tests).toEqual([])
    expect(requirements.materials).toEqual([])
    expect(requirements.fees).toMatchObject({ amountUSD: null, waiverAvailable: false })
    expect(requirements.restrictions).toMatchObject({
      multiApply: 'unknown',
      supervisorContact: 'unknown',
      priorDegree: '',
      intlEligible: null,
      other: [],
      summary: '',
    })
    expect(requirements.route).toMatchObject({ type: 'unknown' })
    expect(requirements.degreeMilestones).toEqual([])
    expect(requirements.verified).toEqual({ deadlines: false, restrictions: false, fees: false })
  })

  it('retains only requirement categories backed by their corresponding fact sources', () => {
    const requirements = normalizeRequirements(assertedTemplate, {
      provenance: 'ai',
      factSources: {
        deadline: 'https://example.edu/phd/deadlines',
        restrictions: 'https://example.edu/phd/rules',
        international: 'https://example.edu/phd/international',
        admissionsBackgrounds: 'https://example.edu/phd/eligibility',
        applicationRoute: 'https://example.edu/phd/apply',
        degreeStructure: 'https://example.edu/phd/structure',
      },
    })

    expect(requirements.deadlines[0]).toMatchObject({ date: '2027-01-15', certainty: 'official' })
    expect(requirements.restrictions).toMatchObject({
      multiApply: 'single',
      supervisorContact: 'required',
      priorDegree: 'Bachelor\u2019s degree',
      intlEligible: true,
    })
    expect(requirements.route).toMatchObject({ type: 'portal' })
    expect(requirements.degreeMilestones).toEqual(['Qualifying exam'])
    expect(requirements.tests).toEqual([])
    expect(requirements.materials).toEqual([])
    expect(requirements.verified).toEqual({ deadlines: true, restrictions: true, fees: false })
  })

  it('preserves explicit manual requirements', () => {
    expect(normalizeRequirements(assertedTemplate, { provenance: 'manual' })).toMatchObject({
      tests: assertedTemplate.tests,
      materials: assertedTemplate.materials,
      restrictions: assertedTemplate.restrictions,
      route: assertedTemplate.route,
      degreeMilestones: assertedTemplate.degreeMilestones,
    })
  })
})
