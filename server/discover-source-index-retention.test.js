import { describe, expect, it } from 'vitest'
import {
  applyDiscoverSourceIndexRetention,
  DISCOVER_SOURCE_INDEX_MAX_BYTES,
  normalizeDiscoverSourceIndex,
} from './discover-catalog.js'

function normalizePages(pages) {
  return normalizeDiscoverSourceIndex({
    schemaVersion: 2,
    schools: [{
      school: 'Evidence University',
      officialUrl: 'https://evidence.example.edu/',
      pages,
    }],
  }).schools[0].pages
}

describe('Discover source-index retention', () => {
  it('caps the top-level index by bytes and evicts older less-relevant schools first', () => {
    const index = normalizeDiscoverSourceIndex({
      schemaVersion: 2,
      schools: [
        {
          school: 'Old State University',
          officialUrl: 'https://old.example.edu/',
          collectedAt: '2026-01-01T00:00:00.000Z',
          pages: [{ url: 'https://old.example.edu/', types: ['homepage'], fetched: false }],
        },
        {
          school: 'New Evidence University',
          officialUrl: 'https://new.example.edu/',
          collectedAt: '2026-08-01T00:00:00.000Z',
          pages: [{
            url: 'https://new.example.edu/phd',
            types: ['program'],
            declaredKinds: ['doctoral'],
            fetched: true,
          }],
        },
      ],
    })
    const newSchoolOnly = normalizeDiscoverSourceIndex({
      ...index,
      schools: [index.schools[1]],
    })

    const retained = applyDiscoverSourceIndexRetention(index, {
      maxBytes: Buffer.byteLength(JSON.stringify(newSchoolOnly), 'utf8') + 1,
    })

    expect(retained.schools.map((school) => school.school)).toEqual(['New Evidence University'])
    expect(retained.sourceCount).toBe(1)
    expect(Buffer.byteLength(JSON.stringify(retained), 'utf8'))
      .toBeLessThanOrEqual(Buffer.byteLength(JSON.stringify(newSchoolOnly), 'utf8') + 1)
    expect(DISCOVER_SOURCE_INDEX_MAX_BYTES).toBeGreaterThan(8_783_275)
  })

  it('round-trips bounded multi-provider scholarly provenance without requiring an OpenAlex author id', () => {
    const candidateResearchers = [
      {
        name: 'Ada Europe',
        orcid: 'https://orcid.org/0000-0002-0000-0001',
        profileUrl: 'https://orcid.org/0000-0002-0000-0001',
        providers: ['europepmc'],
        score: 1.75,
        matchedQueries: Array.from({ length: 20 }, (_, index) => `query-${index}`),
        matchedTopics: [{
          id: 'T10158',
          name: 'Cancer Immunotherapy',
          domain: { id: 'D4', displayName: 'Health Sciences' },
          field: { id: 'F17', displayName: 'Medicine' },
          confidence: 0.875,
        }],
        recentWorks: [{
          title: 'Evidence from Europe PMC',
          year: 2025,
          citedByCount: 9,
          source: 'https://doi.org/10.1000/europepmc',
          matchedQuery: 'cancer immunotherapy',
          meshHeadings: ['Immunotherapy', 'Neoplasms'],
        }],
      },
      {
        name: 'Casey Crossref',
        providers: ['crossref'],
        score: 0.9,
        recentWorks: [{
          title: 'Crossref-only affiliation evidence',
          year: 2024,
          citedByCount: 3,
          source: 'https://doi.org/10.1000/crossref',
          matchedQuery: 'materials informatics',
        }],
      },
      ...Array.from({ length: 125 }, (_, index) => ({
        name: `Bounded Researcher ${index}`,
        providers: ['crossref'],
        recentWorks: [{
          title: `Bounded work ${index}`,
          source: `https://doi.org/10.1000/bounded-${index}`,
        }],
      })),
    ]
    const index = normalizeDiscoverSourceIndex({
      schemaVersion: 2,
      schools: [{
        school: 'Evidence University',
        officialUrl: 'https://evidence.example.edu/',
        scholarlyEvidence: {
          provider: 'openalex+ror+europepmc+crossref',
          queriedAt: '2026-08-02T12:00:00.000Z',
          query: 'cancer immunotherapy | materials informatics',
          status: 'partial',
          error: 'OpenAlex institution unavailable; publication fallbacks retained.',
          sourceStatus: {
            openalex: 'unavailable',
            openalexTopics: 'ok',
            ror: 'ok',
            europepmc: 'ok',
            mesh: 'indexed-by-europepmc',
            crossref: 'ok',
          },
          sourceCounts: { openalex: 0, europepmc: 1, crossref: 1, merged: 2 },
          topicResolution: {
            status: 'ok',
            searchedTerms: ['cancer immunotherapy', 'materials informatics'],
            failures: 0,
            topics: [{
              query: 'cancer immunotherapy',
              id: 'T10158',
              displayName: 'Cancer Immunotherapy and Biomarkers',
              confidence: 0.875,
              primaryForQuery: true,
              domain: { id: 'D4', displayName: 'Health Sciences' },
              field: { id: 'F17', displayName: 'Medicine' },
              subfield: { id: 'S111', displayName: 'Oncology' },
            }],
          },
          disciplinePlan: {
            taxonomyVersion: 'ford-professional-v1',
            broadDomains: [{ id: 'medical_and_health_sciences', label: 'Medical and health sciences' }],
            disciplines: [{
              id: 'oncology-cancer',
              label: 'Oncology and cancer research',
              broadDomain: 'medical_and_health_sciences',
              canonicalTerm: 'cancer immunotherapy',
              providers: ['openalex', 'europepmc'],
              vocabularies: ['mesh'],
            }],
            providerHints: ['openalex', 'ror', 'crossref', 'europepmc'],
            vocabularies: ['mesh'],
          },
          candidateResearchers,
        },
      }],
    })
    const evidence = index.schools[0].scholarlyEvidence

    expect(evidence).toMatchObject({
      provider: 'openalex+ror+europepmc+crossref',
      providers: ['openalex', 'ror', 'europepmc', 'crossref'],
      status: 'partial',
      sourceStatus: {
        openalex: 'unavailable',
        openalexTopics: 'ok',
        europepmc: 'ok',
        mesh: 'indexed-by-europepmc',
        crossref: 'ok',
      },
      sourceCounts: { openalex: 0, europepmc: 1, crossref: 1, merged: 2 },
      topicResolution: {
        status: 'ok',
        topics: [{
          id: 'T10158',
          domain: { id: 'D4', displayName: 'Health Sciences' },
          field: { id: 'F17', displayName: 'Medicine' },
        }],
      },
      disciplinePlan: {
        taxonomyVersion: 'ford-professional-v1',
        providerHints: ['openalex', 'ror', 'crossref', 'europepmc'],
      },
    })
    expect(evidence.candidateResearchers).toHaveLength(120)
    expect(evidence.candidateResearchers[0]).toMatchObject({
      openAlexId: null,
      orcid: 'https://orcid.org/0000-0002-0000-0001',
      providers: ['europepmc'],
      score: 1.75,
      matchedTopics: [{
        id: 'T10158',
        name: 'Cancer Immunotherapy',
        confidence: 0.875,
      }],
      recentWorks: [{ meshHeadings: ['Immunotherapy', 'Neoplasms'] }],
    })
    expect(evidence.candidateResearchers[0].matchedQueries).toHaveLength(12)
    expect(evidence.candidateResearchers[1]).toMatchObject({
      name: 'Casey Crossref',
      openAlexId: null,
      orcid: null,
      profileUrl: null,
      providers: ['crossref'],
    })
    expect(normalizeDiscoverSourceIndex(index)).toEqual(index)
  })

  it('retains fetched evidence discovered after the 180th ordinary candidate', () => {
    const candidates = Array.from({ length: 190 }, (_, index) => ({
      url: `https://evidence.example.edu/candidate/${index}`,
      types: ['homepage'],
      fetched: false,
    }))
    const pages = normalizePages([
      ...candidates,
      {
        url: 'https://evidence.example.edu/phd/computer-science',
        types: ['program'],
        declaredKinds: ['doctoral'],
        fetched: true,
      },
      {
        url: 'https://evidence.example.edu/fetched/navigation',
        types: ['homepage'],
        fetched: true,
      },
      {
        url: 'https://evidence.example.edu/unsafe/phd',
        types: ['program'],
        declaredKinds: ['doctoral'],
        fetched: true,
        promptInjectionSuspected: true,
      },
    ])

    expect(pages).toHaveLength(180)
    expect(pages.slice(0, 3).map((page) => page.url)).toEqual([
      'https://evidence.example.edu/phd/computer-science',
      'https://evidence.example.edu/fetched/navigation',
      'https://evidence.example.edu/unsafe/phd',
    ])
    expect(pages.some((page) => page.url.endsWith('/candidate/189'))).toBe(false)
  })

  it('keeps ordinary candidates bounded and stable when priorities are equal', () => {
    const pages = normalizePages(Array.from({ length: 220 }, (_, index) => ({
      url: `https://evidence.example.edu/candidate/${index}`,
      fetched: false,
    })))

    expect(pages).toHaveLength(180)
    expect(pages[0].url).toBe('https://evidence.example.edu/candidate/0')
    expect(pages[179].url).toBe('https://evidence.example.edu/candidate/179')
  })

  it('deduplicates stably, merges stronger observations, and denies injection evidence priority', () => {
    const input = [
      {
        url: 'https://evidence.example.edu/unsafe',
        types: ['program'],
        declaredKinds: ['doctoral'],
        fetched: true,
        promptInjectionSuspected: true,
      },
      {
        url: 'https://evidence.example.edu/plain',
        types: ['homepage'],
        fetched: true,
      },
      {
        url: 'https://evidence.example.edu/program',
        types: ['homepage'],
        fetched: false,
      },
      {
        url: 'https://evidence.example.edu/program',
        types: ['program'],
        declaredKinds: ['doctoral'],
        fetched: true,
        title: 'Computer Science PhD',
      },
      {
        url: 'https://evidence.example.edu/candidate',
        types: ['program'],
        declaredKinds: ['doctoral'],
        fetched: false,
      },
    ]
    const first = normalizePages(input)
    const second = normalizePages(input)

    expect(second).toEqual(first)
    expect(first.map((page) => page.url)).toEqual([
      'https://evidence.example.edu/program',
      'https://evidence.example.edu/plain',
      'https://evidence.example.edu/unsafe',
      'https://evidence.example.edu/candidate',
    ])
    expect(first.filter((page) => page.url.endsWith('/program'))).toHaveLength(1)
    expect(first[0]).toMatchObject({
      fetched: true,
      title: 'Computer Science PhD',
      types: ['homepage', 'program'],
      declaredKinds: ['doctoral'],
    })
  })
})
