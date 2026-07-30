import { describe, expect, it } from 'vitest'
import {
  buildScholarlyQueryPlan,
  collectScholarlyEvidence,
  shouldUseEuropePmcForDiscipline,
} from './discover-scholarly-data.js'

describe('Discover multi-source scholarly leads', () => {
  it('routes specialist biomedical search only from the taxonomy or a primary topic', () => {
    expect(shouldUseEuropePmcForDiscipline({
      providerHints: ['openalex', 'europepmc'],
    }, { topics: [] })).toBe(true)
    expect(shouldUseEuropePmcForDiscipline({
      providerHints: ['openalex'],
    }, {
      topics: [
        { primaryForQuery: true, domain: { displayName: 'Social Sciences' } },
        { primaryForQuery: false, domain: { displayName: 'Health Sciences' } },
      ],
    })).toBe(false)
    expect(shouldUseEuropePmcForDiscipline({
      providerHints: ['openalex'],
    }, {
      topics: [{ primaryForQuery: true, domain: { displayName: 'Life Sciences' } }],
    })).toBe(true)
  })

  it('prioritizes distinct Latin aliases while retaining native-language terms', () => {
    expect(buildScholarlyQueryPlan([
      '机器学习',
      'machine learning',
      '计算机视觉',
      'computer vision',
      '机器人',
    ], { limit: 4 })).toEqual([
      'machine learning',
      'computer vision',
      '机器学习',
      '计算机视觉',
    ])
  })

  it('widens OpenAlex retrieval and fuses affiliation-checked Crossref authors', async () => {
    const openAlexQueries = []
    const fetchImpl = async (value) => {
      const url = new URL(value)
      if (url.hostname === 'api.ror.org') {
        return new Response(JSON.stringify({
          items: [{
            id: 'https://ror.org/example',
            names: [{ value: 'Example University', types: ['ror_display'] }],
            domains: ['example.edu'],
          }],
        }), { status: 200 })
      }
      if (url.hostname === 'api.openalex.org' && url.pathname.endsWith('/institutions')) {
        return new Response(JSON.stringify({
          results: [{
            id: 'https://openalex.org/I1',
            display_name: 'Example University',
            ror: 'https://ror.org/example',
            homepage_url: 'https://example.edu/',
          }],
        }), { status: 200 })
      }
      if (url.hostname === 'api.openalex.org' && url.pathname.endsWith('/works')) {
        openAlexQueries.push({
          query: url.searchParams.get('search'),
          perPage: url.searchParams.get('per-page'),
        })
        return new Response(JSON.stringify({
          results: [{
            id: `https://openalex.org/W${openAlexQueries.length}`,
            doi: `https://doi.org/10.1000/openalex-${openAlexQueries.length}`,
            display_name: `Phase-field evidence ${openAlexQueries.length}`,
            publication_year: 2025,
            cited_by_count: 12,
            authorships: [{
              author: {
                id: 'https://openalex.org/A1',
                display_name: 'Jose Garcia',
                orcid: 'https://orcid.org/0000-0001-2345-6789',
              },
              institutions: [{ id: 'https://openalex.org/I1' }],
            }, {
              author: {
                id: 'https://openalex.org/A-group',
                display_name: 'Digital Scholarship at Example University',
              },
              institutions: [{ id: 'https://openalex.org/I1' }],
            }],
          }],
        }), { status: 200 })
      }
      if (url.hostname === 'api.crossref.org') {
        const query = url.searchParams.get('query.bibliographic')
        return new Response(JSON.stringify({
          message: {
            items: query === 'phase-field modeling' ? [{
              DOI: '10.1000/crossref',
              title: ['Phase-field modeling of microstructure evolution'],
              published: { 'date-parts': [[2025]] },
              'is-referenced-by-count': 8,
              author: [
                {
                  given: 'José',
                  family: 'García',
                  ORCID: 'https://orcid.org/0000-0001-2345-6789',
                  affiliation: [{ name: 'Example University' }],
                },
                {
                  given: 'Wei',
                  family: 'Wang',
                  affiliation: [{ name: 'Example University' }],
                },
                {
                  given: 'Outside',
                  family: 'Researcher',
                  affiliation: [{ name: 'Other University' }],
                },
              ],
            }] : [],
          },
        }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    const [entry] = await collectScholarlyEvidence({
      schools: [{
        school: 'Example University',
        officialUrl: 'https://example.edu/',
        crawlStatus: 'ok',
      }],
      query: ['phase-field modeling', '相场模型', 'materials informatics'],
      fetchImpl,
      maxResearchersPerSchool: 48,
    })

    expect(openAlexQueries).toEqual([
      { query: 'phase-field modeling', perPage: '100' },
      { query: 'materials informatics', perPage: '100' },
      { query: '相场模型', perPage: '100' },
    ])
    expect(entry.evidence.status).toBe('ok')
    expect(entry.evidence.sourceStatus.crossref).toBe('ok')
    expect(entry.evidence.sourceCounts).toEqual({
      openalex: 1,
      europepmc: 0,
      crossref: 2,
      merged: 2,
    })
    expect(entry.evidence.candidateResearchers[0]).toEqual(expect.objectContaining({
      openAlexId: 'https://openalex.org/A1',
      orcid: 'https://orcid.org/0000-0001-2345-6789',
      providers: ['openalex', 'crossref'],
    }))
    expect(entry.evidence.candidateResearchers.map((candidate) => candidate.name)).toContain('Wei Wang')
    expect(entry.evidence.candidateResearchers.map((candidate) => candidate.name))
      .not.toContain('Digital Scholarship at Example University')
  })

  it('routes biomedical fields through Europe PMC/MeSH while retaining topic-ID OpenAlex filtering', async () => {
    const openAlexFilters = []
    const fetchImpl = async (value) => {
      const url = new URL(value)
      if (url.hostname === 'api.ror.org') {
        return new Response(JSON.stringify({
          items: [{
            id: 'https://ror.org/cambridge',
            names: [{ value: 'University of Cambridge', types: ['ror_display'] }],
            domains: ['cam.ac.uk'],
          }],
        }), { status: 200 })
      }
      if (url.hostname === 'api.openalex.org' && url.pathname.endsWith('/institutions')) {
        return new Response(JSON.stringify({
          results: [{
            id: 'https://openalex.org/I2',
            display_name: 'University of Cambridge',
            ror: 'https://ror.org/cambridge',
            homepage_url: 'https://www.cam.ac.uk/',
          }],
        }), { status: 200 })
      }
      if (url.hostname === 'api.openalex.org' && url.pathname.endsWith('/works')) {
        openAlexFilters.push(url.searchParams.get('filter'))
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }
      if (url.hostname === 'www.ebi.ac.uk') {
        return new Response(JSON.stringify({
          resultList: {
            result: [{
              id: '12345',
              source: 'MED',
              doi: '10.1000/biomed',
              title: 'Cancer immunotherapy and the tumor microenvironment',
              abstractText: 'Immunotherapy response in cancer.',
              pubYear: '2025',
              citedByCount: 9,
              meshHeadingList: {
                meshHeading: [
                  { descriptorName: 'Neoplasms', majorTopic_YN: 'Y' },
                  { descriptorName: 'Immunotherapy', majorTopic_YN: 'Y' },
                ],
              },
              authorList: {
                author: [{
                  firstName: 'Ada',
                  lastName: 'Lovelace',
                  authorId: { type: 'ORCID', value: '0000-0002-0000-0001' },
                  authorAffiliationDetailsList: {
                    authorAffiliation: [{
                      affiliation: 'Department of Medicine, University of Cambridge, Cambridge, UK.',
                    }],
                  },
                }],
              },
            }],
          },
        }), { status: 200 })
      }
      if (url.hostname === 'api.crossref.org') {
        return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    const [entry] = await collectScholarlyEvidence({
      schools: [{
        school: 'University of Cambridge',
        officialUrl: 'https://www.cam.ac.uk/',
        crawlStatus: 'ok',
      }],
      query: ['cancer immunotherapy', 'tumor microenvironment'],
      disciplinePlan: {
        taxonomyVersion: 'test',
        broadDomains: [{ id: 'medical_and_health_sciences' }],
        disciplines: [{ id: 'oncology-cancer' }],
        providerHints: ['openalex', 'europepmc'],
        vocabularies: ['mesh'],
      },
      topicResolution: {
        status: 'ok',
        searchedTerms: ['cancer immunotherapy'],
        failures: 0,
        topics: [{
          query: 'cancer immunotherapy',
          id: 'T10158',
          displayName: 'Cancer Immunotherapy and Biomarkers',
          confidence: 1,
          domain: { displayName: 'Health Sciences' },
          field: { displayName: 'Medicine' },
        }],
      },
      fetchImpl,
      maxResearchersPerSchool: 48,
    })

    expect(openAlexFilters.some((filter) => filter.includes('topics.id:T10158'))).toBe(true)
    expect(entry.evidence.sourceStatus).toMatchObject({
      openalexTopics: 'ok',
      europepmc: 'ok',
      mesh: 'indexed-by-europepmc',
    })
    expect(entry.evidence.sourceCounts.europepmc).toBe(1)
    expect(entry.evidence.candidateResearchers[0]).toMatchObject({
      name: 'Ada Lovelace',
      orcid: 'https://orcid.org/0000-0002-0000-0001',
      providers: ['europepmc'],
    })
    expect(entry.evidence.candidateResearchers[0].recentWorks[0].meshHeadings).toContain('Immunotherapy')
  })
})
