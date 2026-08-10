import { describe, expect, it } from 'vitest'
import {
  extractOfficialAdmissionFacts,
  resolveOfficialProgramSource,
} from './officialProgramHistory.js'

describe('official programme history evidence', () => {
  it('extracts explicit official counts and percentages with their original sentence', () => {
    const facts = extractOfficialAdmissionFacts([{
      url: 'https://example.edu/phd/admissions-statistics',
      title: 'Doctoral admissions statistics',
      fetched: true,
      types: ['program', 'admissions'],
      excerpt: 'In 2024, we received 1,240 applications. We admitted 62 applicants. The 2024 acceptance rate was 5%. The incoming cohort of 41 began in September.',
    }], { fetchedAt: '2026-08-09T00:00:00.000Z' })

    expect(facts.map((fact) => fact.value.factType)).toEqual([
      'applications',
      'offers-or-admits',
      'acceptance-rate',
      'enrolled-or-cohort',
    ])
    expect(facts.map((fact) => fact.value.value)).toEqual([1240, 62, 5, 41])
    // A year is attached only when it appears in the same official sentence;
    // the extractor does not carry 2024 across sentence boundaries by guess.
    expect(facts.map((fact) => fact.value.year)).toEqual([2024, null, 2024, null])
    expect(facts.every((fact) => fact.sourceUrl.includes('example.edu'))).toBe(true)
  })

  it('does not infer a rate, use an unfetched page, or trust injected text', () => {
    const pages = [
      {
        url: 'https://example.edu/phd',
        fetched: true,
        excerpt: 'We received many applications and enrolled a selective cohort.',
      },
      {
        url: 'https://example.edu/unfetched',
        fetched: false,
        excerpt: 'The acceptance rate was 99%.',
      },
      {
        url: 'https://example.edu/injected',
        fetched: true,
        promptInjectionSuspected: true,
        excerpt: 'The acceptance rate was 99%.',
      },
    ]
    expect(extractOfficialAdmissionFacts(pages)).toEqual([])
  })

  it('resolves a curated school exactly and accepts an explicit HTTPS school URL conservatively', () => {
    const curated = resolveOfficialProgramSource({ school: 'University of Oxford' })
    expect(curated?.school).toBe('University of Oxford')

    const explicit = resolveOfficialProgramSource({
      school: 'A New Research University',
      officialUrl: 'https://research.example.edu/doctoral/program',
    })
    expect(explicit).toMatchObject({
      school: 'A New Research University',
      url: 'https://research.example.edu/',
      allowedHosts: ['research.example.edu'],
    })
    expect(resolveOfficialProgramSource({ school: 'Unknown University', officialUrl: 'http://unsafe.example' })).toBe(null)
  })
})
