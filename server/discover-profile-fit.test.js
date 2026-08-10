import { describe, expect, it } from 'vitest'
import { enrichDiscoverAdvisorProfileMatches } from './discover-profile-fit.js'

const programUrl = 'https://example.edu/phd-computational-neuroscience'
const advisorUrl = 'https://example.edu/people/ada-lovelace'

function sourceIndex(excerpt, overrides = {}) {
  const advisor = {
    url: advisorUrl,
    title: 'Ada Lovelace — Faculty profile',
    types: ['advisor'],
    individualAdvisor: true,
    fetched: true,
    excerpt,
    ...overrides,
  }
  return {
    schools: [{
      school: 'Example University',
      pages: [advisor],
      advisorPages: [advisor],
      researchPages: [],
    }],
  }
}

function program(pi = {}) {
  return {
    id: 'example-program',
    school: 'Example University',
    program: 'PhD in Computational Neuroscience',
    website: programUrl,
    pis: [{
      id: 'ada',
      name: 'Ada Lovelace',
      url: advisorUrl,
      research: 'A model-written unsupported biography.',
      whyFit: 'A model-written unsupported fit claim.',
      ...pi,
    }],
  }
}

function withScholarly(index, researchers) {
  index.schools[0].scholarlyEvidence = {
    institution: { openAlexId: 'https://openalex.org/I123' },
    candidateResearchers: researchers,
  }
  return index
}

describe('Discover deterministic applicant-to-advisor fit', () => {
  it('retains only profile terms that occur in the fetched official individual profile', () => {
    const [matched] = enrichDiscoverAdvisorProfileMatches(
      [program()],
      sourceIndex('Our group studies graph neural networks for brain connectivity using Python and causal inference.'),
      {
        applicantProfile: {
          researchInterests: 'graph neural networks, protein design',
          researchMethods: 'Python; causal inference; wet lab microscopy',
          goals: 'brain connectivity',
        },
        researchTerms: ['computational neuroscience', 'network dynamics'],
        checkedAt: '2026-08-09T00:00:00.000Z',
      },
    )

    expect(matched.pis[0].profileMatch).toMatchObject({
      confidence: 'medium',
      matchedInterests: ['graph neural networks', 'brain connectivity'],
      matchedMethods: ['python', 'causal inference'],
      evidenceUrl: advisorUrl,
      basis: 'applicant-profile+official-individual-profile',
    })
    expect(matched.pis[0].profileMatch.matchedInterests).not.toContain('protein design')
    expect(matched.pis[0].research).not.toContain('unsupported biography')
    expect(matched.pis[0].research).toContain('graph neural networks for brain connectivity')
    expect(matched.pis[0].whyFit).not.toContain('unsupported fit claim')
  })

  it('reports no verified overlap instead of inventing an attractive fit', () => {
    const [matched] = enrichDiscoverAdvisorProfileMatches(
      [program()],
      sourceIndex('Ada studies medieval manuscript preservation and archival history.'),
      {
        applicantProfile: { researchInterests: 'graph neural networks', researchMethods: 'Python' },
        researchTerms: ['computational neuroscience'],
      },
    )

    expect(matched.pis[0].profileMatch).toMatchObject({
      score: 0,
      confidence: 'unknown',
      matchedInterests: [],
      matchedMethods: [],
      matchedResearchTerms: [],
    })
    expect(matched.pis[0].research).toContain('medieval manuscript preservation')
    expect(matched.pis[0].whyFit).toContain('No explicit overlap')
  })

  it('fails closed when the page was not fetched or was flagged for prompt injection', () => {
    for (const overrides of [{ fetched: false }, { promptInjectionSuspected: true }]) {
      const [matched] = enrichDiscoverAdvisorProfileMatches(
        [program()],
        sourceIndex('Graph neural networks and Python.', overrides),
        { applicantProfile: { researchInterests: 'graph neural networks' } },
      )
      expect(matched.pis[0].profileMatch.evidenceUrl).toBe('')
      expect(matched.pis[0].research).toBe('')
      expect(matched.pis[0].whyFit).toContain('No fetched individual official profile')
    }
  })

  it('joins a unique institution-scoped scholarly record only after the official person page is verified', () => {
    const evidence = withScholarly(
      sourceIndex('Ada studies graph neural networks for brain connectivity and causal inference.'),
      [{
        name: 'Ada Lovelace',
        openAlexId: 'https://openalex.org/A123',
        orcid: 'https://orcid.org/0000-0001-2345-6789',
        profileUrl: 'https://openalex.org/A123',
        providers: ['openalex', 'crossref'],
        matchedQueries: ['graph neural networks'],
        matchedTopics: [{ name: 'Computational neuroscience' }],
        recentWorks: [{
          title: 'Graph learning for brain connectivity',
          year: 2025,
          citedByCount: 12,
          source: 'https://doi.org/10.1000/example',
          matchedQuery: 'graph neural networks',
          matchedTopic: 'Computational neuroscience',
        }],
      }],
    )
    const [matched] = enrichDiscoverAdvisorProfileMatches([program()], evidence, {
      researchTerms: ['graph neural networks'],
      checkedAt: '2026-08-09T00:00:00.000Z',
    })

    expect(matched.pis[0].scholarly).toMatchObject({
      openAlexId: 'https://openalex.org/A123',
      orcid: 'https://orcid.org/0000-0001-2345-6789',
      providers: ['openalex', 'crossref'],
      match: {
        basis: 'institution-scoped-scholarly-record+official-individual-profile',
        nameMatch: 'exact',
        officialProfileUrl: advisorUrl,
        institutionId: 'https://openalex.org/I123',
      },
    })
    expect(matched.pis[0].scholarly.recentWorks[0].title).toBe('Graph learning for brain connectivity')
  })

  it('does not attach an ambiguous same-name publication identity', () => {
    const candidates = ['graph learning', 'causal inference'].map((query, index) => ({
      name: 'Ada Lovelace',
      openAlexId: `https://openalex.org/A${index + 1}`,
      providers: ['openalex'],
      matchedQueries: [query],
      recentWorks: [],
    }))
    const evidence = withScholarly(
      sourceIndex('Ada leads a computational neuroscience laboratory.'),
      candidates,
    )
    const [matched] = enrichDiscoverAdvisorProfileMatches([program()], evidence)
    expect(matched.pis[0].scholarly).toBeUndefined()
  })
})
