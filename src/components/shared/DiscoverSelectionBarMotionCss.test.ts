import { describe, expect, it } from 'vitest'
import discoverStyles from '../../styles/discover.css?raw'

describe('Discover selection bar motion', () => {
  it('keeps the existing smooth motion and matches the surrounding surface', () => {
    const presenceRule = discoverStyles.match(
      /\.discover-list-count > \.explorer-selection-presence\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const clipRule = discoverStyles.match(
      /\.discover-list-count \.explorer-selection-presence-clip\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const barRule = discoverStyles.match(
      /\.discover-list-count \.explorer-selection-bar\s*\{([^}]*)\}/s,
    )?.[1] ?? ''

    expect(presenceRule).toContain('transform: translate3d(0, -3px, 0)')
    expect(presenceRule).toContain('contain: layout paint')
    expect(discoverStyles).toMatch(
      /\.discover-list-count > \.explorer-selection-presence\.is-open\s*\{[^}]*transform:\s*translate3d\(0, 0, 0\)/s,
    )
    expect(clipRule).toContain('overflow: hidden')
    expect(barRule).toContain('background: var(--surface)')
    expect(barRule).toContain('box-shadow: none')
    expect(barRule).not.toContain('background: var(--surface-secondary)')
  })
})
