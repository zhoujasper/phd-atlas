import { describe, expect, it } from 'vitest'
import {
  buildDiscoverEvidenceHydrationSources,
  hydrateDiscoverOfficialEvidence,
  mergeDiscoverCrawlResults,
} from './discover-evidence-hydration.js'

function fixture() {
  const source = {
    region: 'US',
    school: 'Example University',
    url: 'https://www.example.edu/',
    allowedHosts: ['example.edu'],
    seeds: [{ kind: 'faculty', url: 'https://www.example.edu/faculty/' }],
  }
  const crawls = [{
    source,
    pages: [{ url: source.url, title: 'Example', types: ['homepage'], fetched: true }],
    candidatePages: [],
    skipped: null,
    health: { status: 'ok' },
  }]
  const sourceIndex = {
    schools: [{
      school: source.school,
      region: source.region,
      officialUrl: source.url,
      allowedHosts: source.allowedHosts,
      pages: [], programPages: [], admissionsPages: [], advisorPages: [],
    }],
  }
  return { source, crawls, sourceIndex }
}

describe('Discover official evidence hydration', () => {
  it('hydrates only school-owned URLs and does not label an arbitrary news path as a programme', () => {
    const { crawls, sourceIndex } = fixture()
    const [source] = buildDiscoverEvidenceHydrationSources({
      crawls,
      sourceIndex,
      programs: [{
        school: 'Example University',
        website: 'https://cs.example.edu/graduate/phd-computer-science',
        sources: [
          'https://cs.example.edu/news-all/phd-award',
          'https://attacker.example/phd',
        ],
        pis: [{ name: 'Ada Lovelace', url: 'https://cs.example.edu/people/ada-lovelace' }],
      }],
    })

    expect(source.seeds).toEqual(expect.arrayContaining([
      { kind: 'doctoral', url: 'https://cs.example.edu/graduate/phd-computer-science' },
      { kind: 'research', url: 'https://cs.example.edu/news-all/phd-award' },
      { kind: 'faculty', url: 'https://cs.example.edu/people/ada-lovelace' },
    ]))
    expect(source.seeds.some((seed) => seed.url.includes('attacker.example'))).toBe(false)
  })

  it('can deep-fetch indexed candidates without repeating every declared adapter seed', () => {
    const { crawls, sourceIndex } = fixture()
    const [source] = buildDiscoverEvidenceHydrationSources({
      crawls,
      sourceIndex,
      includeDeclaredSeeds: false,
      programs: [{
        school: 'Example University',
        website: 'https://cs.example.edu/graduate/phd-computer-science',
        sources: ['https://cs.example.edu/graduate/phd-computer-science'],
        pis: [],
      }],
    })

    expect(source.seeds).toEqual([{
      kind: 'doctoral',
      url: 'https://cs.example.edu/graduate/phd-computer-science',
    }])
    expect(source.seeds).not.toContainEqual({
      kind: 'faculty',
      url: 'https://www.example.edu/faculty/',
    })
    expect(source.crawlPolicy.maxPages).toBe(3)
  })

  it('fetches direct programme and individual profile citations through the guarded crawler', async () => {
    const { crawls, sourceIndex } = fixture()
    const fetched = []
    const fetchImpl = async (value) => {
      const url = String(value)
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      if (url.endsWith('/graduate/phd-computer-science')) return new Response('<title>PhD in Computer Science</title><main>Official doctoral programme.</main>', { status: 200 })
      if (url.endsWith('/people/ada-lovelace')) return new Response('<title>Ada Lovelace | Faculty</title><main>Machine learning research.</main>', { status: 200 })
      if (url.endsWith('/faculty/')) return new Response('<title>Faculty directory</title>', { status: 200 })
      return new Response('', { status: 404 })
    }
    const result = await hydrateDiscoverOfficialEvidence({
      crawls,
      sourceIndex,
      fetchImpl,
      dnsLookup: null,
      programs: [{
        school: 'Example University',
        website: 'https://cs.example.edu/graduate/phd-computer-science',
        sources: ['https://cs.example.edu/graduate/phd-computer-science'],
        pis: [{ name: 'Ada Lovelace', url: 'https://cs.example.edu/people/ada-lovelace' }],
      }],
    })

    const merged = result.crawls[0]
    expect(merged.pages.map((page) => page.url)).toEqual(expect.arrayContaining([
      'https://cs.example.edu/graduate/phd-computer-science',
      'https://cs.example.edu/people/ada-lovelace',
    ]))
    expect(fetched).not.toContain('https://attacker.example/phd')
  })

  it('merges hydration pages without losing prior evidence types', () => {
    const base = [{ source: { url: 'https://example.edu/' }, pages: [{ url: 'https://example.edu/phd', types: ['program'], fetched: true }], candidatePages: [], health: {} }]
    const additions = [{ source: { url: 'https://example.edu/' }, pages: [{ url: 'https://example.edu/phd', types: ['admissions'], fetched: true }], candidatePages: [], health: {} }]
    const [merged] = mergeDiscoverCrawlResults(base, additions)
    expect(merged.pages[0].types).toEqual(['program', 'admissions'])
  })
})
