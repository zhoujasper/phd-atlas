import { describe, expect, it } from 'vitest'
import { normalizeDiscoverSourceIndex } from './discover-catalog.js'

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
