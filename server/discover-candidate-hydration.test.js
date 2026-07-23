import { describe, expect, it } from 'vitest'
import {
  discoverCandidateHydrationScore,
  selectDiscoverCandidateHydrationPrograms,
} from './discover-candidate-hydration.js'

function candidate(overrides = {}) {
  return {
    url: 'https://example.edu/estudios/programas/doctorado-ia',
    title: null,
    label: 'Doctorado en inteligencia artificial',
    types: ['program'],
    priority: 180,
    relevanceScore: 20,
    fetched: false,
    ...overrides,
  }
}

describe('Discover indexed candidate hydration', () => {
  it('recognises multilingual doctoral links and rejects unsafe or irrelevant pages', () => {
    expect(discoverCandidateHydrationScore(candidate())).toBeGreaterThan(0)
    expect(discoverCandidateHydrationScore(candidate({
      url: 'https://example.edu/大学院/博士/情報科学',
      label: '情報科学 博士課程',
    }))).toBeGreaterThan(0)
    expect(discoverCandidateHydrationScore(candidate({
      url: 'https://example.edu/dottorato',
      label: 'Dottorati di ricerca',
    }))).toBeGreaterThan(0)
    expect(discoverCandidateHydrationScore(candidate({
      url: 'https://example.edu/news-all/new-doctorado',
    }))).toBe(Number.NEGATIVE_INFINITY)
    expect(discoverCandidateHydrationScore(candidate({
      url: 'https://example.edu/etudes/toutes-nouvelles/nouveau-doctorat',
      label: 'Nouveau doctorat',
    }))).toBe(Number.NEGATIVE_INFINITY)
    expect(discoverCandidateHydrationScore(candidate({
      url: 'https://example.edu/people/ada/doctoral',
    }))).toBe(Number.NEGATIVE_INFINITY)
    expect(discoverCandidateHydrationScore(candidate({ fetched: true }))).toBe(Number.NEGATIVE_INFINITY)
    expect(discoverCandidateHydrationScore(candidate({ promptInjectionSuspected: true }))).toBe(Number.NEGATIVE_INFINITY)
  })

  it('balances high-confidence links across universities before taking a second page', () => {
    const rows = selectDiscoverCandidateHydrationPrograms([
      {
        source: { school: 'Alpha University', region: 'OTHER' },
        candidatePages: [
          candidate({ url: 'https://alpha.example.edu/programs/phd-ai', label: 'AI PhD', priority: 300 }),
          candidate({ url: 'https://alpha.example.edu/programs/phd-robotics', label: 'Robotics PhD', priority: 250 }),
        ],
      },
      {
        source: { school: 'Beta University', region: 'EU' },
        candidatePages: [
          candidate({ url: 'https://beta.example.edu/doctorat/data', label: 'Doctorat en données', priority: 280 }),
          candidate({ url: 'https://beta.example.edu/doctorat/vision', label: 'Doctorat en vision', priority: 220 }),
        ],
      },
    ], { schoolLimit: 2, perSchool: 2, totalLimit: 3 })

    expect(rows).toHaveLength(3)
    expect(rows.slice(0, 2).map((row) => row.school)).toEqual([
      'Alpha University',
      'Beta University',
    ])
    expect(rows.every((row) => row.candidateHydrationOnly && row.sources[0] === row.website)).toBe(true)
  })
})
