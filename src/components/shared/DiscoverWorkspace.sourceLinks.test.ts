import { describe, expect, it } from 'vitest'
import { uniqueDiscoverSourceLinks } from './discoverSourceLinks'

describe('uniqueDiscoverSourceLinks', () => {
  it('keeps the first occurrence of each non-empty source URL', () => {
    const profileUrl = 'https://www.birmingham.ac.uk/staff/profiles/computer-science/research-fellow/canducci-marco'

    expect(uniqueDiscoverSourceLinks([
      profileUrl,
      profileUrl,
      '',
      'https://scholar.google.com/citations?user=example',
    ])).toEqual([
      profileUrl,
      'https://scholar.google.com/citations?user=example',
    ])
  })
})
