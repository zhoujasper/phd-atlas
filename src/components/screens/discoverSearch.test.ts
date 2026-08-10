import { describe, expect, it } from 'vitest'
import type { ScoredDiscoverPi, ScoredDiscoverProgram } from '../../data/discover'
import { normalizeDiscoverQuery, piMatchesDiscoverQuery, programMatchesDiscoverQuery } from './discoverSearch'

const advisor = {
  id: 'pi-1',
  name: 'Dr Ada Lovelace',
  email: 'ada@example.edu',
  category: 'rising_star',
  hIndex: 12,
  citations: 500,
  scholarUrl: '',
  startedApprox: '2021',
  labSize: 'small',
  wetDry: 'dry',
  research: 'Neural phase-field solvers',
  whyFit: 'Matches mesoscale modelling',
  recruiting: '陶瓷方向招生',
  url: '',
} as ScoredDiscoverProgram['pis'][number]

const program = {
  id: 'program-1',
  school: 'Example University',
  program: 'Materials Science PhD',
  city: 'London',
  country: 'United Kingdom',
  researchFocus: 'Computational materials',
  fitRationale: 'Strong modelling group',
  tags: ['ceramics'],
  pis: [advisor],
} as ScoredDiscoverProgram

describe('Discover local catalog search', () => {
  it('finds a program through nested advisor identity and research fields', () => {
    expect(programMatchesDiscoverQuery(program, normalizeDiscoverQuery('ADA LOVELACE'))).toBe(true)
    expect(programMatchesDiscoverQuery(program, normalizeDiscoverQuery('phase-field'))).toBe(true)
    expect(programMatchesDiscoverQuery(program, normalizeDiscoverQuery('陶瓷方向'))).toBe(true)
  })

  it('searches flattened PI rows and rejects unrelated text', () => {
    const pi = { ...advisor, programId: program.id, school: program.school, program: program.program, region: 'UK', city: program.city, matchScore: 80 } as ScoredDiscoverPi
    expect(piMatchesDiscoverQuery(pi, normalizeDiscoverQuery('mesoscale'))).toBe(true)
    expect(piMatchesDiscoverQuery(pi, normalizeDiscoverQuery('quantum gravity'))).toBe(false)
  })
})
