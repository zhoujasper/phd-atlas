import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDiscoverGlobalSourceCache,
  discoverGlobalInstitutionSources,
} from './discover-global-sources.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function openAlexFixtureFetch(calls) {
  return async (value) => {
    const url = new URL(String(value))
    calls.push(url)
    if (url.pathname === '/works' && url.searchParams.get('group_by') === 'authorships.institutions.country_code') {
      return jsonResponse({
        group_by: [
          { key: 'https://openalex.org/countries/US', key_display_name: 'United States', count: 9_000 },
          { key: 'https://openalex.org/countries/GB', key_display_name: 'United Kingdom', count: 8_000 },
          { key: 'https://openalex.org/countries/DE', key_display_name: 'Germany', count: 7_000 },
          { key: 'https://openalex.org/countries/CA', key_display_name: 'Canada', count: 6_000 },
          { key: 'https://openalex.org/countries/SG', key_display_name: 'Singapore', count: 5_000 },
          { key: 'https://openalex.org/countries/HK', key_display_name: 'Hong Kong', count: 4_000 },
          { key: 'https://openalex.org/countries/CN', key_display_name: 'China', count: 3_000 },
          { key: 'https://openalex.org/countries/AU', key_display_name: 'Australia', count: 2_000 },
          { key: 'https://openalex.org/countries/IN', key_display_name: 'India', count: 1_000 },
        ],
      })
    }
    if (url.pathname === '/works' && url.searchParams.get('group_by') === 'authorships.institutions.id') {
      const country = url.searchParams.get('filter').match(/country_code:([A-Z]{2})/)?.[1]
      return jsonResponse({
        group_by: [{
          key: `https://openalex.org/I${country.charCodeAt(0)}${country.charCodeAt(1)}`,
          key_display_name: `${country} Research University`,
          count: 100,
        }],
      })
    }
    const institutionId = url.pathname.match(/^\/institutions\/(I\d+)$/)?.[1]
    if (institutionId) {
      const country = String.fromCharCode(
        Number(institutionId.slice(1, -2)),
        Number(institutionId.slice(-2)),
      )
      return jsonResponse({
        id: `https://openalex.org/${institutionId}`,
        display_name: `${country} Research University`,
        type: 'education',
        country_code: country,
        homepage_url: `https://www.research-${country.toLowerCase()}.edu/`,
        cited_by_count: 25_000,
        summary_stats: { h_index: 80 },
      })
    }
    return jsonResponse({}, 404)
  }
}

describe('Discover global institution sources', () => {
  beforeEach(() => clearDiscoverGlobalSourceCache())

  it('round-robins every selected region before spending extra country slots', async () => {
    const calls = []
    const sources = await discoverGlobalInstitutionSources({
      terms: ['machine learning'],
      regions: ['US', 'UK', 'EU', 'CA', 'SG', 'HK', 'CN', 'AU', 'OTHER'],
      limit: 9,
      fetchImpl: openAlexFixtureFetch(calls),
    })

    expect(new Set(sources.map((source) => source.region))).toEqual(new Set([
      'US', 'UK', 'EU', 'CA', 'SG', 'HK', 'CN', 'AU', 'OTHER',
    ]))
    expect(sources.every((source) => (
      source.sourceProvenance === 'openalex-field-institution'
      && source.seeds[0].kind === 'homepage'
      && source.url.startsWith('https://')
    ))).toBe(true)
    expect(calls.every((url) => url.hostname === 'api.openalex.org')).toBe(true)
  })

  it('treats non-curated countries as OTHER and removes existing official domains', async () => {
    const calls = []
    const sources = await discoverGlobalInstitutionSources({
      terms: ['robotics'],
      regions: ['OTHER'],
      existingSources: [{
        school: 'Existing India University',
        url: 'https://www.research-in.edu/',
        allowedHosts: ['research-in.edu'],
      }],
      limit: 4,
      fetchImpl: openAlexFixtureFetch(calls),
    })

    expect(sources).toEqual([])
    expect(calls.some((url) => url.searchParams.get('filter')?.includes('country_code:IN'))).toBe(true)
  })
})
