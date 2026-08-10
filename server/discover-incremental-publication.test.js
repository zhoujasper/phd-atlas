import { describe, expect, it } from 'vitest'
import { prepareDiscoverIncrementalPublication } from './discover-research.js'

const programUrl = 'https://www.example.edu/graduate/computer-science-phd'

function sourceIndex({ fetched = true, crawlStatus = 'ok', poisoned = false } = {}) {
  const page = {
    url: programUrl,
    title: 'PhD in Computer Science',
    types: ['program'],
    declaredKinds: ['doctoral'],
    fetched,
    promptInjectionSuspected: poisoned,
  }
  return {
    schools: [{
      school: 'Example University',
      officialUrl: 'https://www.example.edu/',
      allowedHosts: ['example.edu'],
      crawlStatus,
      pages: [page],
      programPages: [page],
      advisorPages: [],
    }],
  }
}

function candidate() {
  return {
    id: 'example-computer-science-phd',
    school: 'Example University',
    program: 'PhD in Computer Science',
    region: 'US',
    provenance: 'ai',
    website: programUrl,
    sources: [programUrl],
    verification: {
      status: 'verified',
      officialSourceCount: 1,
      advisorSourceCount: 0,
      issues: [],
    },
  }
}

const qualityOptions = {
  requestedPrograms: 5,
  scopedSourceCount: 1,
  minimumReadableSites: 1,
  minimumPrograms: 1,
  minimumAdvisors: 1,
}

describe('Discover incremental verified publication', () => {
  it('publishes a verified row only after its programme page was fetched by the server', () => {
    const result = prepareDiscoverIncrementalPublication({
      programs: [candidate()],
      sourceIndex: sourceIndex(),
      qualityOptions,
    })

    expect(result.quality.passed).toBe(true)
    expect(result.programs).toHaveLength(1)
    expect(result.programs[0]).toMatchObject({
      id: 'example-computer-science-phd',
      website: programUrl,
      sources: [programUrl],
    })
  })

  it('keeps a phase/native-search citation provisional when the crawler did not fetch it', () => {
    const result = prepareDiscoverIncrementalPublication({
      programs: [candidate()],
      sourceIndex: sourceIndex({ fetched: false }),
      qualityOptions,
    })

    expect(result.programs).toEqual([])
    expect(result.quality.passed).toBe(false)
    expect(result.quality.failures).toContain('no-source-grounded-programs')
    expect(result.rejected).toContainEqual({
      id: 'example-computer-science-phd',
      reason: 'no-program-specific-official-source',
    })
  })

  it('does not publish fetched rows when the shared integrity quality gate fails', () => {
    const result = prepareDiscoverIncrementalPublication({
      programs: [candidate()],
      sourceIndex: sourceIndex({ crawlStatus: 'blocked' }),
      qualityOptions,
    })

    expect(result.programs).toEqual([])
    expect(result.quality.failures).toContain('no-readable-official-sites')
    expect(result.rejected[0]).toMatchObject({
      id: 'example-computer-science-phd',
    })
    expect(result.rejected[0].reason).toContain('incremental-quality-gate:no-readable-official-sites')
  })

  it('never treats a prompt-injection-marked fetched page as publishable evidence', () => {
    const result = prepareDiscoverIncrementalPublication({
      programs: [candidate()],
      sourceIndex: sourceIndex({ poisoned: true }),
      qualityOptions,
    })

    expect(result.programs).toEqual([])
    expect(result.rejected).toContainEqual({
      id: 'example-computer-science-phd',
      reason: 'no-program-specific-official-source',
    })
  })
})
