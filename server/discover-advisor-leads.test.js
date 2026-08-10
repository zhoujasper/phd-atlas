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
        { url: 'https://example.edu/people/jose-garcia', label: 'José García', types: ['advisor'], declaredKinds: ['advisor'] },
        { url: 'https://example.edu/people/jane-smith', label: 'Professor Jane Smith', types: ['advisor'], declaredKinds: ['advisor'] },
        { url: 'https://example.edu/people/%E7%8E%8B%E4%BC%9F', label: '王伟', types: ['advisor'], declaredKinds: ['advisor'] },
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

  it('keeps more than the former forty-profile quota when official identities match', () => {
    const program = {
      id: 'example-neuro', school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'],
    }
    const researchers = Array.from({ length: 55 }, (_, index) => ({
      name: `Researcher Person ${index}`,
      openAlexId: `https://openalex.org/A${index}`,
      matchedQueries: ['computational neuroscience'],
    }))
    const sourceIndex = { schools: [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      advisorPages: researchers.map((researcher, index) => ({
        url: `https://example.edu/people/researcher-person-${index}`,
        label: researcher.name,
        types: ['advisor'],
        declaredKinds: ['advisor'],
        fetched: true,
      })),
      scholarlyEvidence: { candidateResearchers: researchers },
    }] }

    const leads = deriveOfficialAdvisorProfileLeads([program], sourceIndex, { maxProfilesPerSchool: 120 })
    expect(leads[0].pis).toHaveLength(55)
  })

  it('retains individually named official profiles when a scholarly index misses the person', () => {
    const program = {
      id: 'example-ai', school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'],
    }
    const sourceIndex = { schools: [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      advisorPages: [
        { url: 'https://example.edu/people/mira-patel', title: 'Mira Patel | Faculty profile', excerpt: 'Mira Patel is a professor researching neural systems.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/faculty-directory', title: 'Faculty directory', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/advisory-board', title: 'Advisory Board | Example University', excerpt: 'Faculty serving on the advisory board.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/principal-investigators', title: 'Principal Investigators', excerpt: 'Faculty and publications.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/phd-students', title: 'PhD Students', excerpt: 'Researchers and publications.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/facilities-staff', title: 'Facilities and Engineering Services', excerpt: 'Staff and faculty services.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/graham-m.html', title: 'Graham M.html', excerpt: 'Faculty publications.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/doctoral-studies', title: 'Doctoral Studies', excerpt: 'Professor and faculty publications.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/graduate-academy', title: 'Graduate Academy', excerpt: 'Faculty and lecturer profiles.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/people/pub-night', title: 'Pub Night', excerpt: 'Professor and researcher event.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/research/team/advisory-board', title: 'Advisory Board', excerpt: 'The centre is advised by a Professor at Saarland University.', types: ['advisor'], individualAdvisor: true, fetched: true },
        { url: 'https://example.edu/research/team/wissenschaftlicher-beirat', title: 'Wissenschaftlicher Beirat', excerpt: 'Sie ist Professor an der Universität.', types: ['advisor'], individualAdvisor: true, fetched: true },
      ],
      scholarlyEvidence: { candidateResearchers: [] },
    }] }

    const leads = deriveOfficialAdvisorProfileLeads([program], sourceIndex)
    expect(leads[0].pis).toEqual([expect.objectContaining({
      name: 'Mira Patel',
      url: 'https://example.edu/people/mira-patel',
    })])
  })

  it('matches a declared short-path advisor seed through its fetched official excerpt', () => {
    const program = {
      id: 'example-neuro', school: 'EPFL', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'],
    }
    const advisorUrl = 'https://people.example.edu/alexander.mathis'
    const sourceIndex = { schools: [{
      school: 'EPFL',
      officialUrl: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      advisorPages: [{
        url: advisorUrl,
        title: 'Example - Alexander Mathis',
        excerpt: 'Associate Professor Alexander Mathis works in machine learning and computational neuroscience.',
        types: ['homepage'],
        declaredKinds: ['advisor'],
        fetched: true,
      }],
      scholarlyEvidence: {
        candidateResearchers: [{
          name: 'Alexander Mathis',
          openAlexId: 'https://openalex.org/A1',
          matchedQueries: ['computational neuroscience'],
        }],
      },
    }] }

    const leads = deriveOfficialAdvisorProfileLeads([program], sourceIndex)
    expect(leads[0].pis).toEqual([expect.objectContaining({
      name: 'Alexander Mathis',
      url: advisorUrl,
    })])
  })

  it('retains multiple scholarly identities from one fetched official leadership page', () => {
    const program = {
      id: 'example-leadership', school: 'Example University', website: 'https://example.edu/phd', sources: ['https://example.edu/phd'],
    }
    const leadershipUrl = 'https://example.edu/research/people/team/leadership/'
    const sourceIndex = { schools: [{
      school: 'Example University',
      officialUrl: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      advisorPages: [{
        url: leadershipUrl,
        title: 'Leadership',
        excerpt: 'Professor Grace Hopper and Professor Ada Lovelace jointly lead the research centre.',
        types: ['advisor'],
        declaredKinds: ['advisor'],
        individualAdvisor: true,
        fetched: true,
      }],
      scholarlyEvidence: {
        candidateResearchers: [
          { name: 'Grace Hopper', openAlexId: 'https://openalex.org/A1' },
          { name: 'Ada Lovelace', openAlexId: 'https://openalex.org/A2' },
        ],
      },
    }] }

    const leads = deriveOfficialAdvisorProfileLeads([program], sourceIndex)
    expect(leads[0].pis.map((pi) => pi.name)).toEqual(['Grace Hopper', 'Ada Lovelace'])
    expect(leads[0].pis.every((pi) => pi.url === leadershipUrl)).toBe(true)
  })
})
