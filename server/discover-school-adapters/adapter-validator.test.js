import { describe, expect, it } from 'vitest'
import {
  mergeSchoolAdapterBatches,
  validateSchoolAdapterCoverage,
} from './adapter-validator.js'

const hints = {
  faculty: ['people'],
  lab: ['lab'],
  department: ['department'],
  program: ['doctoral'],
}

function completeAdapter(school = 'Example University') {
  return {
    school,
    region: 'US',
    allowedHosts: ['example.edu'],
    seeds: [
      { kind: 'faculty', url: 'https://people.example.edu/faculty/' },
      { kind: 'departments', url: 'https://example.edu/departments/' },
      { kind: 'research', url: 'https://research.example.edu/labs/' },
      { kind: 'doctoral', url: 'https://example.edu/doctoral/' },
    ],
    pathHints: hints,
    verifiedAt: '2026-07-22',
  }
}

describe('school adapter coverage gate', () => {
  it('merges independent entries for the same school without losing hosts, seeds or hints', () => {
    const [merged] = mergeSchoolAdapterBatches([
      [{ ...completeAdapter(), seeds: completeAdapter().seeds.slice(0, 2) }],
      [{
        ...completeAdapter(),
        allowedHosts: ['research.example.edu'],
        seeds: completeAdapter().seeds.slice(2),
        pathHints: { ...hints, lab: ['group'] },
      }],
    ])

    expect(merged.allowedHosts).toEqual(['example.edu', 'research.example.edu'])
    expect(merged.seeds).toHaveLength(4)
    expect(merged.pathHints.lab).toEqual(['lab', 'group'])
  })

  it('requires four deep, typed entry points and cannot be satisfied by a homepage row', () => {
    const adapter = {
      ...completeAdapter(),
      seeds: [{ kind: 'homepage', url: 'https://example.edu/' }],
    }
    const report = validateSchoolAdapterCoverage([adapter], [{
      school: 'Example University', region: 'US', url: 'https://example.edu/',
    }], { minimumSchools: 1 })

    expect(report.passed).toBe(false)
    expect(report.fullyTypedSchoolCount).toBe(0)
    expect(report.errors).toEqual(expect.arrayContaining([
      'Example University: missing faculty seed',
      'Example University: missing departments seed',
      'Example University: missing research seed',
      'Example University: missing doctoral seed',
    ]))
  })

  it('accepts a complete school-specific adapter with official subdomains', () => {
    const report = validateSchoolAdapterCoverage([completeAdapter()], [{
      school: 'Example University', region: 'US', url: 'https://example.edu/',
    }], { minimumSchools: 1 })

    expect(report).toMatchObject({
      passed: true,
      coveredSchoolCount: 1,
      fullyTypedSchoolCount: 1,
      seedCount: 4,
      missingSchools: [],
      errors: [],
    })
  })
})
