import { describe, expect, it } from 'vitest'
import {
  dedupeDiscoverProgrammeRecords,
  discoverProgramSubjectIdentity,
  isSameDiscoverProgramme,
} from './discover-program-identity.js'

const partial = {
  status: 'partial',
  officialSourceCount: 1,
  advisorSourceCount: 0,
  issues: [],
}

const verified = {
  status: 'verified',
  officialSourceCount: 2,
  advisorSourceCount: 1,
  issues: [],
}

describe('Discover semantic programme identity', () => {
  it('collapses the real DTU institution-wide overview and intro pages', () => {
    const programs = dedupeDiscoverProgrammeRecords([
      {
        id: 'dtu-overview',
        school: 'Technical University of Denmark',
        program: 'Get a PhD education at DTU',
        website: 'https://www.dtu.dk/english/education/phd',
        sources: ['https://www.dtu.dk/english/education/phd'],
        researchFocus: 'Institution-wide doctoral education overview.',
        pis: [],
        factSources: {},
        verification: partial,
        provenance: 'ai',
      },
      {
        id: 'dtu-intro',
        school: 'Technical University of Denmark',
        program: 'About the PhD programme at DTU',
        website: 'https://www.dtu.dk/english/education/phd/intro',
        sources: [
          'https://www.dtu.dk/english/education/phd/intro',
          'https://www.dtu.dk/english/education/phd/admission',
        ],
        degreeStructure: 'DTU describes its doctoral programme structure on the official page.',
        pis: [{
          id: 'advisor-ada',
          name: 'Dr Ada Example',
          url: 'https://www.dtu.dk/english/person/ada',
        }],
        factSources: {
          degreeStructure: 'https://www.dtu.dk/english/education/phd/intro',
        },
        verification: verified,
        provenance: 'ai',
      },
    ])

    expect(programs).toHaveLength(1)
    expect(programs[0]).toMatchObject({
      id: 'dtu-intro',
      program: 'About the PhD programme at DTU',
      website: 'https://www.dtu.dk/english/education/phd/intro',
      verification: {
        status: 'verified',
        officialSourceCount: 2,
        advisorSourceCount: 1,
      },
    })
    expect(programs[0].sources).toHaveLength(3)
    expect(programs[0].pis).toEqual([
      expect.objectContaining({ id: 'advisor-ada', name: 'Dr Ada Example' }),
    ])
    expect(programs[0].researchFocus).toBe('Institution-wide doctoral education overview.')
  })

  it('collapses sibling intro and admissions process pages within one doctoral root', () => {
    const intro = {
      school: 'Technical University of Denmark',
      program: 'About the PhD programme at DTU',
      website: 'https://www.dtu.dk/english/education/phd/intro',
    }
    const admissions = {
      school: 'DTU',
      program: 'PhD admissions at DTU',
      website: 'https://www.dtu.dk/english/education/phd/admission',
    }

    expect(discoverProgramSubjectIdentity(intro)).toBe('')
    expect(discoverProgramSubjectIdentity(admissions)).toBe('')
    expect(isSameDiscoverProgramme(intro, admissions)).toBe(true)
    expect(dedupeDiscoverProgrammeRecords([intro, admissions])).toHaveLength(1)
  })

  it('does not merge different concrete projects in a shared doctoral directory', () => {
    const sharedDirectory = 'https://example.edu/study/doctoral/projects'
    const programs = dedupeDiscoverProgrammeRecords([
      {
        id: 'quantum-sensing',
        school: 'Example University',
        program: 'Quantum Sensing Doctoral Project',
        website: sharedDirectory,
        sources: [sharedDirectory],
        verification: verified,
      },
      {
        id: 'climate-ml',
        school: 'Example University',
        program: 'Machine Learning for Climate Doctoral Project',
        website: sharedDirectory,
        sources: [sharedDirectory],
        verification: verified,
      },
    ])

    expect(discoverProgramSubjectIdentity(programs[0])).toBe('quantum sensing project')
    expect(discoverProgramSubjectIdentity(programs[1])).toBe('machine learning for climate project')
    expect(programs.map((program) => program.id)).toEqual(['quantum-sensing', 'climate-ml'])
  })

  it('does not absorb a concrete project into its generic doctoral directory row', () => {
    const programs = dedupeDiscoverProgrammeRecords([
      {
        id: 'directory',
        school: 'Example University',
        program: 'Doctoral programmes at Example University',
        website: 'https://example.edu/study/doctoral',
      },
      {
        id: 'robotics-project',
        school: 'Example University',
        program: 'Safe Robotics Doctoral Project',
        website: 'https://example.edu/study/doctoral/robotics-project',
      },
    ])

    expect(programs).toHaveLength(2)
  })

  it('keeps Education as an explicit subject rather than treating it as boilerplate', () => {
    expect(discoverProgramSubjectIdentity({
      program: 'PhD Programme in Education',
    })).toBe('education')
  })
})
