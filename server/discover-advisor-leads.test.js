import { describe, expect, it } from 'vitest'
import { deriveOfficialAdvisorProfileLeads } from './discover-advisor-leads.js'

describe('Discover advisor profile leads', () => {
  it('matches scholarly researchers to individual official profile links only', () => {
    const program = {
      id: 'example-cs', school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'],
    }
    const sourceIndex = { schools: [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      advisorPages: [
        { url: 'https://cs.example.edu/people/', label: 'People', types: ['advisor'], fetched: true },
        { url: 'https://cs.example.edu/people/ada-lovelace', label: 'Professor Ada Lovelace', types: ['advisor'], fetched: false },
        { url: 'https://outside.example/people/ada-lovelace', label: 'Ada Lovelace', types: ['advisor'], fetched: false },
      ],
      scholarlyEvidence: {
        candidateResearchers: [
          { name: 'Ada Lovelace', openAlexId: 'https://openalex.org/A1', matchedQueries: ['machine learning'] },
          { name: 'Grace Hopper', openAlexId: 'https://openalex.org/A2' },
        ],
      },
    }] }

    const leads = deriveOfficialAdvisorProfileLeads([program], sourceIndex)
    expect(leads).toHaveLength(1)
    expect(leads[0].pis).toEqual([expect.objectContaining({
      name: 'Ada Lovelace',
      url: 'https://cs.example.edu/people/ada-lovelace',
      leadOnly: true,
    })])
  })

  it('fails closed when a directory has no individually matching profile', () => {
    const program = { school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'] }
    const sourceIndex = { schools: [{
      school: 'Example University', officialUrl: 'https://example.edu/', advisorPages: [
        { url: 'https://example.edu/faculty/', label: 'Faculty directory', types: ['advisor'], fetched: true },
      ],
      scholarlyEvidence: { candidateResearchers: [{ name: 'Ada Lovelace' }] },
    }] }
    expect(deriveOfficialAdvisorProfileLeads([program], sourceIndex)).toEqual([])
  })

  it('matches diacritics, scholarly initials, and exact CJK profile names', () => {
    const program = {
      id: 'example-materials',
      school: 'Example University',
      website: 'https://example.edu/phd',
      sources: ['https://example.edu/phd'],
    }
    const sourceIndex = { schools: [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      advisorPages: [
        { url: 'https://example.edu/people/jose-garcia', label: 'José García', types: ['advisor'] },
        { url: 'https://example.edu/people/jane-smith', label: 'Professor Jane Smith', types: ['advisor'] },
        { url: 'https://example.edu/people/%E7%8E%8B%E4%BC%9F', label: '王伟', types: ['advisor'] },
      ],
      scholarlyEvidence: {
        candidateResearchers: [
          { name: 'Jose Garcia', providers: ['openalex'] },
          { name: 'J. Smith', providers: ['crossref'] },
          { name: '王伟', providers: ['openalex', 'crossref'] },
        ],
      },
    }] }

    const leads = deriveOfficialAdvisorProfileLeads([program], sourceIndex, { maxProfilesPerSchool: 40 })
    expect(leads[0].pis.map((pi) => pi.name)).toEqual(['Jose Garcia', 'J. Smith', '王伟'])
    expect(leads[0].pis[2].scholarlyProviders).toEqual(['openalex', 'crossref'])
  })
})
