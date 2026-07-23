import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SOURCE_REGISTRY,
  listDiscoverResearchSources,
  prioritizeDiscoverResearchSources,
} from './discover-source-registry.js'
import {
  allowsDiscoverCrawl,
  buildDiscoverSourceIndex,
  compactDiscoverCrawlEvidence,
  crawlDiscoverSource,
  crawlDiscoverSources,
  constrainDiscoverPageTypes,
  discoverEvidenceSourceTargetCount,
  isDiscoverPublicNetworkTarget,
} from './discover-source-crawler.js'

describe('Discover official-source registry', () => {
  it('ships broad, region-scoped coverage from curated university HTTPS origins', () => {
    expect(DISCOVER_SOURCE_REGISTRY.length).toBeGreaterThanOrEqual(100)
    expect(new Set(DISCOVER_SOURCE_REGISTRY.map((source) => source.region)).size).toBeGreaterThanOrEqual(6)
    expect(DISCOVER_SOURCE_REGISTRY.every((source) => source.url.startsWith('https://'))).toBe(true)
    expect(DISCOVER_SOURCE_REGISTRY.every((source) => source.seeds?.length >= 1)).toBe(true)
    expect(DISCOVER_SOURCE_REGISTRY.find((source) => source.school === 'Massachusetts Institute of Technology')?.seeds.length).toBeGreaterThanOrEqual(3)
    expect(listDiscoverResearchSources(['UK']).every((source) => source.region === 'UK')).toBe(true)
  })
})

describe('Discover expanded crawl recall', () => {
  it('prioritizes field-active dynamic universities inside each regional crawl bucket', () => {
    const prioritized = prioritizeDiscoverResearchSources([
      { region: 'OTHER', school: 'Alphabetical University', url: 'https://alpha.example.edu/' },
      {
        region: 'OTHER',
        school: 'Field Active University',
        url: 'https://field.example.edu/',
        discoveryScore: 99,
      },
    ], [], 1)

    expect(prioritized[0].school).toBe('Field Active University')
  })

  it('inherits a directory page type when following multilingual pagination controls', async () => {
    const fetched = []
    const fetchImpl = async (value) => {
      const url = String(value)
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url === 'https://example.edu/faculty/') {
        return new Response([
          '<title>Faculty directory</title>',
          '<a href="?page=2">下一页</a>',
        ].join(''), { status: 200 })
      }
      if (url === 'https://example.edu/faculty/?page=2') {
        return new Response('<title>Faculty directory page 2</title><a href="/people/ada">Ada Lovelace</a>', { status: 200 })
      }
      return new Response('', { status: 404 })
    }
    const result = await crawlDiscoverSource({
      region: 'OTHER',
      school: 'Example University',
      url: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      seeds: [{ kind: 'faculty', url: 'https://example.edu/faculty/' }],
    }, { fetchImpl, maxPages: 2 })

    expect(fetched).toContain('https://example.edu/faculty/?page=2')
    expect(result.pages.find((page) => page.url === 'https://example.edu/faculty/?page=2')?.types)
      .toContain('advisor')
  })

  it('spends a bounded programme slot on a doctoral page before generic programme links', async () => {
    const fetched = []
    const fetchImpl = async (value) => {
      const url = String(value)
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      if (url === 'https://example.edu/') {
        return new Response([
          ...Array.from({ length: 20 }, (_, index) => (
            `<a href="/volunteering/program-${index}">Community programme ${index}</a>`
          )),
          '<a href="/graduate/phd-artificial-intelligence">Artificial Intelligence PhD</a>',
        ].join(''), { status: 200 })
      }
      return new Response(`<title>${url.includes('/phd-') ? 'Artificial Intelligence PhD' : 'Community programme'}</title>`, { status: 200 })
    }
    await crawlDiscoverSource({
      region: 'OTHER',
      school: 'Example University',
      url: 'https://example.edu/',
      allowedHosts: ['example.edu'],
    }, { fetchImpl, maxPages: 2 })

    expect(fetched).toContain('https://example.edu/graduate/phd-artificial-intelligence')
  })

  it('uses the prompt budget to expose up to 24 universities instead of a fixed 12', () => {
    expect(discoverEvidenceSourceTargetCount(60, 120, 72_000)).toBe(24)
    expect(discoverEvidenceSourceTargetCount(20, 120, 72_000)).toBe(20)
    expect(discoverEvidenceSourceTargetCount(60, 120, 12_000)).toBe(5)
  })
})

describe('Discover source crawler', () => {
  it('isolates an unexpected single-site crawler exception and continues other universities', async () => {
    const sources = [
      { region: 'US', school: 'Broken University', url: 'https://broken.example.edu/' },
      { region: 'US', school: 'Healthy University', url: 'https://healthy.example.edu/' },
    ]
    const progress = []
    const results = await crawlDiscoverSources({
      sources,
      concurrency: 2,
      crawlSourceImpl: async (source) => {
        if (source.school === 'Broken University') throw Object.assign(new Error('adapter crash'), { code: 'ADAPTER_CRASH' })
        return {
          source,
          pages: [{ url: 'https://healthy.example.edu/phd', fetched: true }],
          candidatePages: [],
          skipped: null,
          health: { status: 'ok' },
        }
      },
      onProgress: async ({ result }) => progress.push(result.source.school),
    })

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      source: { school: 'Broken University' },
      skipped: 'unavailable',
      health: { status: 'unavailable', fetchFailureReasons: ['crawler-exception'], errorCode: 'ADAPTER_CRASH' },
    })
    expect(results[1]).toMatchObject({ source: { school: 'Healthy University' }, skipped: null })
    expect(progress).toHaveLength(2)
  })

  it('keeps person and directory paths out of every programme evidence bucket', () => {
    expect(constrainDiscoverPageTypes(
      'https://example.edu/people/ada-lovelace/phd',
      ['program', 'admissions', 'funding', 'research'],
    )).toEqual(['research', 'advisor'])
    expect(constrainDiscoverPageTypes(
      'https://example.edu/graduate/programs/phd',
      ['program', 'admissions'],
    )).toEqual(['program', 'admissions'])
  })

  it('allows a resolved public IPv4 target while rejecting private and mapped targets', async () => {
    expect(await isDiscoverPublicNetworkTarget('https://university.example/', async () => ([
      { address: '93.184.216.34', family: 4 },
    ]))).toBe(true)
    expect(await isDiscoverPublicNetworkTarget('https://university.example/', async () => ([
      { address: '127.0.0.1', family: 4 },
    ]))).toBe(false)
    expect(await isDiscoverPublicNetworkTarget('https://[::ffff:7f00:1]/')).toBe(false)
  })

  it('honours an applicable robots disallow rule', () => {
    expect(allowsDiscoverCrawl('User-agent: *\nDisallow: /graduate', '/graduate/phd')).toBe(false)
    expect(allowsDiscoverCrawl('User-agent: *\nDisallow: /graduate\nAllow: /graduate/public', '/graduate/public')).toBe(true)
  })

  it('does not let an arbitrary user-agent substring override the wildcard policy', () => {
    const policy = [
      'User-agent: health',
      'Allow: /private',
      'User-agent: *',
      'Disallow: /private',
    ].join('\n')
    expect(allowsDiscoverCrawl(policy, '/private/data', 'PhDAtlasAdapterHealth/1.0')).toBe(false)
    expect(allowsDiscoverCrawl(
      'User-agent: PhD\nAllow: /private\nUser-agent: *\nDisallow: /private',
      '/private/data',
      'PhDAtlasAdapterHealth/1.0',
    )).toBe(false)
    expect(allowsDiscoverCrawl(
      'User-agent: PhDAtlasAdapterHealth\nAllow: /private\nUser-agent: *\nDisallow: /private',
      '/private/data',
      'PhDAtlasAdapterHealth/1.0',
    )).toBe(true)
  })

  it('builds a typed same-origin index for advisor and application subpages', async () => {
    const fetched = []
    const fetchImpl = async (url) => {
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /private', { status: 200 })
      if (url === 'https://university.example/') {
        return new Response('<title>Example University</title><a href="/graduate/phd">PhD admissions</a><a href="/people/faculty">Faculty directory</a><a href="/funding">PhD funding</a><a href="https://untrusted.example/graduate">Outside</a>', { status: 200 })
      }
      if (url === 'https://university.example/graduate/phd') {
        return new Response('<title>PhD programmes</title><main>Official doctoral funding and faculty information.</main>', { status: 200 })
      }
      if (url === 'https://university.example/people/faculty') {
        return new Response('<title>Faculty directory</title><main>Professor Example and research supervisors.</main>', { status: 200 })
      }
      if (url === 'https://university.example/funding') {
        return new Response('<title>Funding</title><main>Doctoral stipend information.</main>', { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    const result = await crawlDiscoverSource({ region: 'US', school: 'Example University', url: 'https://university.example/' }, { fetchImpl })

    expect(result.skipped).toBeNull()
    expect(result.pages.map((page) => page.url)).toContain('https://university.example/graduate/phd')
    expect(result.pages.find((page) => page.url.endsWith('/graduate/phd'))?.excerpt).toContain('Official doctoral funding')
    expect(result.candidatePages.find((page) => page.url.endsWith('/people/faculty'))?.types).toContain('advisor')
    expect(result.candidatePages.find((page) => page.url.endsWith('/graduate/phd'))?.types).toEqual(expect.arrayContaining(['program', 'admissions']))
    expect(fetched).not.toContain('https://untrusted.example/graduate')

    const index = buildDiscoverSourceIndex([result], { generatedAt: '2026-07-21T00:00:00.000Z' })
    expect(index.schemaVersion).toBe(1)
    expect(index.schools[0].advisorPages.map((page) => page.url)).toContain('https://university.example/people/faculty')
    expect(index.schools[0].admissionsPages.map((page) => page.url)).toContain('https://university.example/graduate/phd')
  })

  it('crawls declared school-specific seeds across approved university subdomains', async () => {
    const fetched = []
    const source = {
      region: 'US',
      school: 'Example University',
      url: 'https://www.example.edu/',
      allowedHosts: ['example.edu'],
      seeds: [
        { kind: 'faculty', url: 'https://engineering.example.edu/people/faculty/' },
        { kind: 'research', url: 'https://research.example.edu/labs/' },
        { kind: 'doctoral', url: 'https://grad.example.edu/programs/phd/' },
      ],
      pathHints: {
        faculty: ['people'],
        lab: ['labs'],
        department: ['departments'],
        program: ['programs'],
      },
    }
    const fetchImpl = async (url) => {
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url === 'https://engineering.example.edu/people/faculty/') {
        return new Response('<title>Faculty</title><a href="/people/professor-example/">Professor Example</a>', { status: 200 })
      }
      if (url === 'https://engineering.example.edu/people/professor-example/') {
        return new Response('<title>Professor Example</title><main>Research interests and laboratory.</main>', { status: 200 })
      }
      if (url === 'https://research.example.edu/labs/') return new Response('<title>Research laboratories</title>', { status: 200 })
      if (url === 'https://grad.example.edu/programs/phd/') return new Response('<title>Doctoral programmes</title>', { status: 200 })
      return new Response('', { status: 404 })
    }

    const result = await crawlDiscoverSource(source, { fetchImpl, maxPages: 8 })
    expect(result.skipped).toBeNull()
    expect(result.pages.map((page) => page.url)).toEqual(expect.arrayContaining([
      'https://engineering.example.edu/people/faculty/',
      'https://research.example.edu/labs/',
      'https://grad.example.edu/programs/phd/',
    ]))
    expect(result.candidatePages.find((page) => page.url.includes('professor-example'))?.types).toContain('advisor')
    expect(fetched).toContain('https://engineering.example.edu/robots.txt')
    expect(fetched).toContain('https://research.example.edu/robots.txt')
    expect(fetched).toContain('https://grad.example.edu/robots.txt')
  })

  it('preserves every declared kind when two adapter seeds share one URL', async () => {
    const fetchImpl = async (value) => {
      const url = String(value)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      return new Response('<html><head><title>Schools and research groups</title></head><body>Departments and laboratories</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    const result = await crawlDiscoverSource({
      school: 'Example University',
      region: 'US',
      url: 'https://www.example.edu/',
      allowedHosts: ['example.edu'],
      seeds: [
        { kind: 'departments', url: 'https://www.example.edu/academics/' },
        { kind: 'research', url: 'https://www.example.edu/academics/' },
      ],
      pathHints: { faculty: [], lab: ['research'], department: ['academics'], program: [] },
    }, { fetchImpl, maxPages: 2 })

    const page = result.pages.find((item) => item.url === 'https://www.example.edu/academics/')
    expect(page?.types).toContain('research')
    expect(page?.declaredKinds).toEqual(['departments', 'research'])
    expect(result.health).toMatchObject({ declaredSeedCount: 2, distinctSeedUrlCount: 1 })
  })

  it('does not follow a redirect outside the school adapter allow-list', async () => {
    const source = {
      region: 'US',
      school: 'Example University',
      url: 'https://example.edu/',
      allowedHosts: ['example.edu'],
    }
    const fetched = []
    const fetchImpl = async (url) => {
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      return new Response('', { status: 302, headers: { location: 'https://untrusted.example/faculty' } })
    }
    const result = await crawlDiscoverSource(source, { fetchImpl })
    expect(result.skipped).toBe('unavailable')
    expect(fetched).not.toContain('https://untrusted.example/faculty')
  })

  it('fetches every declared seed before high-volume discovered advisor links', async () => {
    const source = {
      region: 'US',
      school: 'Example University',
      url: 'https://example.edu/',
      allowedHosts: ['example.edu'],
      seeds: [
        { kind: 'faculty', url: 'https://cs.example.edu/faculty/' },
        { kind: 'doctoral', url: 'https://grad.example.edu/phd/' },
      ],
    }
    const fetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url === 'https://cs.example.edu/faculty/') {
        return new Response(Array.from({ length: 20 }, (_, index) => (
          `<a href="/faculty/person-${index}">Professor Person ${index}</a>`
        )).join(''), { status: 200 })
      }
      if (url === 'https://grad.example.edu/phd/') return new Response('<title>Computer Science PhD</title>', { status: 200 })
      return new Response('', { status: 404 })
    }

    const result = await crawlDiscoverSource(source, { fetchImpl, maxPages: 2 })
    expect(result.pages.map((page) => page.url)).toEqual(expect.arrayContaining([
      'https://cs.example.edu/faculty/',
      'https://grad.example.edu/phd/',
    ]))
  })

  it('uses a robots sitemap to discover a programme page on an approved subdomain', async () => {
    const source = {
      region: 'US', school: 'Example University', url: 'https://www.example.edu/', allowedHosts: ['example.edu'],
    }
    const fetchImpl = async (url) => {
      if (url === 'https://www.example.edu/robots.txt') {
        return new Response('User-agent: *\nAllow: /\nSitemap: https://www.example.edu/sitemap.xml', { status: 200 })
      }
      if (url === 'https://www.example.edu/sitemap.xml') {
        return new Response('<urlset><url><loc>https://cs.example.edu/graduate/phd</loc></url></urlset>', {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        })
      }
      if (url === 'https://www.example.edu/') return new Response('<title>Home</title>', { status: 200 })
      if (url === 'https://cs.example.edu/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url === 'https://cs.example.edu/graduate/phd') return new Response('<title>Computer Science PhD</title>', { status: 200 })
      return new Response('', { status: 404 })
    }

    const result = await crawlDiscoverSource(source, { fetchImpl, maxPages: 3 })
    expect(result.pages.map((page) => page.url)).toContain('https://cs.example.edu/graduate/phd')
    expect(result.health).toMatchObject({ status: 'ok', sitemapCount: 1 })
  })

  it('uses the research query and balanced scheduling instead of spending the page budget on news links', async () => {
    const source = {
      region: 'US',
      school: 'Example University',
      url: 'https://example.edu/',
      allowedHosts: ['example.edu'],
    }
    const fetched = []
    const fetchImpl = async (value) => {
      const url = String(value)
      fetched.push(url)
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      if (url === 'https://example.edu/') {
        const news = Array.from({ length: 30 }, (_, index) => (
          `<a href="/news/faculty-award-${index}">Faculty research award ${index}</a>`
        )).join('')
        return new Response([
          '<title>Example University</title>',
          news,
          '<a href="/graduate/phd-computational-genomics">Computational Genomics PhD programme</a>',
          '<a href="/people/ada-lovelace">Professor Ada Lovelace</a>',
          '<a href="/research/computational-genomics-lab">Computational Genomics Laboratory</a>',
          '<a href="/people/faculty">Faculty directory</a>',
        ].join(''), { status: 200 })
      }
      if (url.endsWith('/graduate/phd-computational-genomics')) {
        return new Response('<title>PhD in Computational Genomics</title><main>Doctoral admissions.</main>', { status: 200 })
      }
      if (url.endsWith('/people/ada-lovelace')) {
        return new Response('<title>Professor Ada Lovelace</title><main>Computational genomics faculty profile.</main>', { status: 200 })
      }
      if (url.endsWith('/research/computational-genomics-lab')) {
        return new Response('<title>Computational Genomics Laboratory</title><main>Research group.</main>', { status: 200 })
      }
      return new Response('<title>News story</title>', { status: 200 })
    }

    const result = await crawlDiscoverSource(source, {
      fetchImpl,
      maxPages: 4,
      researchQuery: { field: 'Computer Science', subfields: ['Computational Genomics'] },
    })

    expect(result.pages.map((page) => page.url)).toEqual(expect.arrayContaining([
      'https://example.edu/graduate/phd-computational-genomics',
      'https://example.edu/people/ada-lovelace',
      'https://example.edu/research/computational-genomics-lab',
    ]))
    expect(fetched.some((url) => url.includes('/news/faculty-award-'))).toBe(false)
    expect(result.candidatePages.find((page) => page.url.endsWith('/people/ada-lovelace'))).toMatchObject({
      individualAdvisor: true,
      fetched: true,
    })
    expect(result.health.balancedFetchCounts).toMatchObject({
      program: 1,
      'individual-advisor': 1,
      research: 1,
    })
  })

  it('compacts late relevant fetched pages and typed candidates ahead of early junk pages', () => {
    const newsPages = Array.from({ length: 10 }, (_, index) => ({
      url: `https://example.edu/news/faculty-award-${index}`,
      title: `Faculty award news ${index}`,
      types: ['advisor'],
      excerpt: 'A university news story.',
      fetched: true,
    }))
    const relevantPages = [
      {
        url: 'https://example.edu/graduate/phd-computational-genomics',
        title: 'PhD in Computational Genomics',
        types: ['program', 'admissions'],
        excerpt: 'Official doctoral programme and admissions requirements.',
        fetched: true,
        declaredKinds: ['doctoral'],
      },
      {
        url: 'https://example.edu/research/computational-genomics-lab',
        title: 'Computational Genomics Laboratory',
        types: ['research'],
        excerpt: 'Official laboratory research themes.',
        fetched: true,
        declaredKinds: ['research'],
      },
      {
        url: 'https://example.edu/people/ada-lovelace',
        title: 'Professor Ada Lovelace',
        types: ['advisor'],
        excerpt: 'Individual faculty profile in computational genomics.',
        fetched: true,
        individualAdvisor: true,
      },
    ]
    const candidates = [
      ...Array.from({ length: 20 }, (_, index) => ({
        url: `https://example.edu/people/faculty?page=${index}`,
        label: `Faculty directory ${index}`,
        types: ['advisor'],
        fetched: false,
      })),
      ...relevantPages.map((page) => ({ ...page, label: page.title })),
    ]

    const [entry] = compactDiscoverCrawlEvidence([{
      source: {
        school: 'Example University',
        region: 'US',
        url: 'https://example.edu/',
        allowedHosts: ['example.edu'],
      },
      pages: [...newsPages, ...relevantPages],
      candidatePages: candidates,
    }], {
      maxChars: 6_000,
      researchQuery: ['Computational Genomics'],
    })

    expect(entry.pages.map((page) => page.url)).toEqual(expect.arrayContaining(
      relevantPages.map((page) => page.url),
    ))
    expect(entry.pages.some((page) => page.url.includes('/news/'))).toBe(false)
    expect(entry.advisorPages[0]).toMatchObject({
      url: 'https://example.edu/people/ada-lovelace',
      fetched: true,
      individualAdvisor: true,
    })
    expect(entry.programPages[0].url).toBe('https://example.edu/graduate/phd-computational-genomics')
    expect(entry.researchPages[0].url).toBe('https://example.edu/research/computational-genomics-lab')
    expect(JSON.stringify(entry).length).toBeLessThanOrEqual(6_000)
  })

  it('shares a bounded agent context across many schools instead of letting the first entries consume it', () => {
    const results = Array.from({ length: 20 }, (_, schoolIndex) => ({
      source: {
        school: `University ${schoolIndex}`,
        region: 'US',
        url: `https://u${schoolIndex}.example.edu/`,
        allowedHosts: [`u${schoolIndex}.example.edu`],
      },
      pages: Array.from({ length: 8 }, (_, pageIndex) => ({
        url: `https://u${schoolIndex}.example.edu/graduate/phd-computer-science/${pageIndex}`,
        title: `Computer Science PhD ${pageIndex}`,
        types: pageIndex === 0 ? ['program', 'admissions'] : ['research'],
        excerpt: `Official computer science doctoral evidence ${'detail '.repeat(300)}`,
        fetched: true,
        declaredKinds: pageIndex === 0 ? ['doctoral'] : [],
      })),
      candidatePages: Array.from({ length: 30 }, (_, candidateIndex) => ({
        url: `https://u${schoolIndex}.example.edu/people/professor-${candidateIndex}`,
        label: `Professor ${candidateIndex}`,
        types: ['advisor'],
        fetched: candidateIndex < 2,
        individualAdvisor: true,
      })),
    }))

    const evidence = compactDiscoverCrawlEvidence(results, {
      maxChars: 36_000,
      researchQuery: { field: 'Computer Science' },
    })

    expect(evidence.length).toBeGreaterThanOrEqual(12)
    expect(evidence.every((entry) => entry.pages.some((page) => page.types.includes('program')))).toBe(true)
    expect(JSON.stringify(evidence).length).toBeLessThanOrEqual(36_000)
  })
})
