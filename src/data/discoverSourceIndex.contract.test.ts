import { describe, expect, it } from 'vitest'
import type { DiscoverScholarlyEvidence } from './discover'

const partialEvidence = {
  provider: 'openalex+ror+europepmc+crossref',
  providers: ['crossref', 'europepmc'],
  queriedAt: '2026-08-02T00:00:00.000Z',
  query: 'phase field',
  status: 'partial',
  error: null,
  institution: null,
  sourceStatus: { openalex: 'unavailable', openalexTopics: 'unavailable', ror: 'unavailable', europepmc: 'ok', mesh: 'ok', crossref: 'ok' },
  sourceCounts: { openalex: 0, openalexTopics: 0, ror: 0, europepmc: 1, mesh: 2, crossref: 1, merged: 2 },
  topicResolution: { status: 'partial', searchedTerms: ['phase field'], failures: 1, topics: [] },
  disciplinePlan: { taxonomyVersion: '1', broadDomains: [], disciplines: [], providerHints: ['europepmc', 'crossref'], vocabularies: ['MeSH'] },
  candidateResearchers: [{
    openAlexId: null,
    name: 'Crossref Researcher',
    orcid: null,
    profileUrl: null,
    providers: ['crossref', 'europepmc'],
    score: 0.7,
    matchedQueries: ['phase field'],
    matchedTopics: [],
    recentWorks: [{ title: 'A study', year: 2025, citedByCount: 0, source: 'crossref', matchedQuery: 'phase field', matchedTopic: null, meshHeadings: [] }],
  }],
} satisfies DiscoverScholarlyEvidence

describe('Discover scholarly source-index contract', () => {
  it('accepts partial multi-provider evidence without OpenAlex identity', () => {
    expect(partialEvidence.status).toBe('partial')
    expect(partialEvidence.candidateResearchers[0].openAlexId).toBeNull()
  })
})
