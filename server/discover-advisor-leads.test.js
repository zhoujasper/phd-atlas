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
})
