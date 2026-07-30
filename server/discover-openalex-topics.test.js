import { describe, expect, it } from 'vitest'
import {
  buildOpenAlexWorkQueryPlan,
  clearDiscoverOpenAlexTopicCache,
  resolveDiscoverOpenAlexTopics,
} from './discover-openalex-topics.js'

describe('Discover OpenAlex dynamic topic resolution', () => {
  it('accepts professionally relevant topics and penalizes unrequested geography', async () => {
    clearDiscoverOpenAlexTopicCache()
    const fetchImpl = async (value) => {
      const url = new URL(value)
      const search = url.searchParams.get('search')
      const results = search === 'phase-field modeling'
        ? [{
            id: 'https://openalex.org/T10514',
            display_name: 'Numerical Methods in Engineering',
            description: 'Computational mechanics and numerical simulation.',
            keywords: ['Phase-Field Modeling', 'Finite Element Method'],
            subfield: { id: 'https://openalex.org/subfields/2210', display_name: 'Mechanical Engineering' },
            field: { id: 'https://openalex.org/fields/22', display_name: 'Engineering' },
            domain: { id: 'https://openalex.org/domains/3', display_name: 'Physical Sciences' },
            works_count: 20000,
          }]
        : [
            {
              id: 'https://openalex.org/T1',
              display_name: 'American Constitutional Law and Politics',
              description: 'Constitutional law in the United States.',
              keywords: ['Constitutional Law', 'American Politics'],
              field: { id: 'https://openalex.org/fields/33', display_name: 'Social Sciences' },
              domain: { id: 'https://openalex.org/domains/2', display_name: 'Social Sciences' },
              works_count: 10000,
            },
            {
              id: 'https://openalex.org/T2',
              display_name: 'Comparative Constitutional Law',
              description: 'Comparative constitutional jurisprudence and public law.',
              keywords: ['Constitutional Law', 'Comparative Law'],
              field: { id: 'https://openalex.org/fields/33', display_name: 'Social Sciences' },
              domain: { id: 'https://openalex.org/domains/2', display_name: 'Social Sciences' },
              works_count: 4000,
            },
          ]
      return new Response(JSON.stringify({ results }), { status: 200 })
    }

    const result = await resolveDiscoverOpenAlexTopics({
      terms: ['phase-field modeling', 'constitutional law'],
      fetchImpl,
      limit: 4,
    })

    expect(result.status).toBe('ok')
    expect(result.topics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'T10514', query: 'phase-field modeling' }),
      expect.objectContaining({ id: 'T2', query: 'constitutional law' }),
    ]))
    expect(result.topics.find((topic) => topic.query === 'constitutional law')?.id).toBe('T2')
  })

  it('keeps an eight-request work budget with a text fallback', () => {
    const plan = buildOpenAlexWorkQueryPlan({
      terms: Array.from({ length: 12 }, (_, index) => `specialist query ${index}`),
      topics: Array.from({ length: 10 }, (_, index) => ({
        id: `T${index + 1}`,
        query: `specialist query ${index}`,
        displayName: `Specialist Topic ${index}`,
      })),
      limit: 8,
    })

    expect(plan).toHaveLength(8)
    expect(plan.filter((item) => item.kind === 'topic')).toHaveLength(6)
    expect(plan.filter((item) => item.kind === 'text')).toHaveLength(2)
  })
})
