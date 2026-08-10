import { describe, expect, it } from 'vitest'
import { DISCOVER_EXTERNAL_LINK_PROPS, uniqueDiscoverSourceLinks } from './discoverSourceLinks'

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

  it('keeps only canonical HTTPS sources and exposes hardened external-link attributes', () => {
    expect(uniqueDiscoverSourceLinks([
      'example.edu/admissions',
      'http://example.edu/insecure',
      'javascript:alert(1)',
      'data:text/html,bad',
      'https://user:password@example.edu/private',
    ])).toEqual(['https://example.edu/admissions'])
    expect(DISCOVER_EXTERNAL_LINK_PROPS).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
      referrerPolicy: 'no-referrer',
    })
  })
})
